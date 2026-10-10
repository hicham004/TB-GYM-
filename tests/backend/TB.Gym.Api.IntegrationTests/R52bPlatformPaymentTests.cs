using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.PlatformBilling;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The platform admin's screen (R5.2b, ADR 0028, PBL-007): a payment is dated the day the money arrived,
/// from the day its invoice was issued up to the day it is recorded, in the service and in the database;
/// and the workspace list says when the oldest unpaid invoice fell due and when the workspace goes
/// read-only. Prices are the seeded placeholder plan: $15 a seat, due in 7 days, read-only 7 days after.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task PlatformAdminDatesAPaymentTheDayTheMoneyArrivedAndTheListSaysWhenTheOldestInvoiceFallsDue()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "dating-owner@example.test", "Dating Owner", "Dating Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "dating-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, clientId, BillingLocalDate());

        // August 1st, just after midnight UTC: July is invoiced, due August 8th, read-only from the 15th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        using var admin = await SignInPlatformAdminAsync("dating-admin@example.test");
        await RefreshCsrfAsync(admin);
        var run = await RequiredJsonAsync<BillingRun>(
            await admin.PostAsJsonAsync("/api/platform-admin/invoices/issue", new { periodStart = (DateOnly?)null }));
        Assert.AreEqual(1, run.Issued);
        var invoiceId = (await DatingDetailAsync(admin, workspaceId)).Invoices.Single().Id;
        var payments = $"/api/platform-admin/invoices/{invoiceId}/payments";

        var row = await DatingRowAsync(admin, workspaceId);
        Assert.AreEqual("Active", row.Status);
        Assert.AreEqual(15.00m, row.UnpaidTotal);
        Assert.AreEqual(new DateOnly(2026, 8, 8), row.OldestUnpaidDueOn, "The list names when the oldest unpaid invoice falls due.");
        Assert.AreEqual(new DateOnly(2026, 8, 15), row.ReadOnlyFrom, "And when the workspace goes read-only.");

        // Money cannot have arrived after today, nor before the invoice existed.
        await RefreshCsrfAsync(admin);
        var tomorrow = await admin.PostAsJsonAsync(payments, new { amount = 15m, reference = "WH-D1", receivedOn = new DateOnly(2026, 8, 2) });
        await AssertStatusAsync(tomorrow, HttpStatusCode.BadRequest);
        StringAssert.Contains(await tomorrow.Content.ReadAsStringAsync(), "ReceivedOn");
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(payments, new { amount = 15m, reference = "WH-D1", receivedOn = new DateOnly(2026, 7, 31) }),
            HttpStatusCode.BadRequest);
        Assert.IsNull(
            (await DatingDetailAsync(admin, workspaceId)).Invoices.Single().Payment,
            "A refused date records nothing.");

        // The database holds the same line when something other than the service inserts a payment.
        await AssertSqlStateAsync(
            "23514",
            """
            INSERT INTO billing."Payments" ("Id", "TenantId", "InvoiceId", "Amount", "CurrencyCode", "Reference", "ReceivedOn", "RecordedAtUtc", "RecordedByUserId", "CreatedAtUtc", "UpdatedAtUtc")
            SELECT gen_random_uuid(), "TenantId", "Id", "Total", "CurrencyCode", 'raw', DATE '2026-07-31', now(), gen_random_uuid(), now(), now()
            FROM billing."Invoices" WHERE "Id" = @id
            """,
            ("id", invoiceId));
        await AssertSqlStateAsync(
            "23514",
            """
            INSERT INTO billing."Payments" ("Id", "TenantId", "InvoiceId", "Amount", "CurrencyCode", "Reference", "ReceivedOn", "RecordedAtUtc", "RecordedByUserId", "CreatedAtUtc", "UpdatedAtUtc")
            SELECT gen_random_uuid(), "TenantId", "Id", "Total", "CurrencyCode", 'raw', DATE '2999-01-01', now(), gen_random_uuid(), now(), now()
            FROM billing."Invoices" WHERE "Id" = @id
            """,
            ("id", invoiceId));

        // Recorded two days after it was issued, dated the day it arrived: that day is kept.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 3, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(admin);
        var payment = await RequiredJsonAsync<DatingPayment>(
            await admin.PostAsJsonAsync(payments, new { amount = 15m, reference = "WH-D2", receivedOn = new DateOnly(2026, 8, 2) }));
        Assert.AreEqual(new DateOnly(2026, 8, 2), payment.ReceivedOn);

        // The same payment sent again is that payment, whatever date the retry carries.
        var retried = await RequiredJsonAsync<DatingPayment>(
            await admin.PostAsJsonAsync(payments, new { amount = 15m, reference = "WH-D2", receivedOn = new DateOnly(2026, 8, 3) }));
        Assert.AreEqual(payment.Id, retried.Id);
        Assert.AreEqual(new DateOnly(2026, 8, 2), retried.ReceivedOn);
        Assert.AreEqual(new DateOnly(2026, 8, 2), (await DatingDetailAsync(admin, workspaceId)).Invoices.Single().Payment!.ReceivedOn);

        // Paid: nothing falls due, nothing locks.
        row = await DatingRowAsync(admin, workspaceId);
        Assert.AreEqual(0m, row.UnpaidTotal);
        Assert.IsNull(row.OldestUnpaidDueOn);
        Assert.IsNull(row.ReadOnlyFrom);

        // Left blank, the day is today.
        RequiredTestClock.Set(new DateTimeOffset(2026, 9, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 8));
        var august = (await DatingDetailAsync(admin, workspaceId)).Invoices.Single(item => item.Payment is null);
        await RefreshCsrfAsync(admin);
        var today = await RequiredJsonAsync<DatingPayment>(
            await admin.PostAsJsonAsync(
                $"/api/platform-admin/invoices/{august.Id}/payments",
                new { amount = 15m, reference = "WH-D3" }));
        Assert.AreEqual(new DateOnly(2026, 9, 1), today.ReceivedOn);
    }

    private static async Task<DatingRow> DatingRowAsync(HttpClient admin, Guid workspaceId) =>
        (await RequiredJsonAsync<DatingRow[]>(await admin.GetAsync("/api/platform-admin/workspaces")))
            .Single(item => item.TenantId == workspaceId);

    private static async Task<DatingDetail> DatingDetailAsync(HttpClient admin, Guid workspaceId) =>
        await RequiredJsonAsync<DatingDetail>(await admin.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"));

    private sealed record DatingPayment(Guid Id, DateOnly ReceivedOn);
    private sealed record DatingInvoice(Guid Id, DatingPayment? Payment);
    private sealed record DatingRow(
        Guid TenantId,
        string Status,
        decimal UnpaidTotal,
        DateOnly? OldestUnpaidDueOn,
        DateOnly? ReadOnlyFrom);
    private sealed record DatingDetail(DatingRow Summary, DatingInvoice[] Invoices);
}
