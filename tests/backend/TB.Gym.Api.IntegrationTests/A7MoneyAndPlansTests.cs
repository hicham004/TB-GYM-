using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;
using CoachingProductView = TB.Gym.Modules.Subscriptions.CoachingProductView;
using CommercialOverview = TB.Gym.Modules.Subscriptions.ClientCommercialOverview;
using ProductCatalog = TB.Gym.Modules.Subscriptions.ProductCatalog;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A7, money and plans (docs/FULL-AUDIT-2026-10.md, section 11): money with a part of a cent
/// is refused, not rounded (BILL-1); a receipt is dated by the workspace's day, which the server stamps (WEA-6);
/// a new price option counts the clients of the options it replaced (COACH-2); a cancelled plan carries the day
/// it was cancelled (COACH-20); coverage rows and the intake history are append-only, except the overlap lock a
/// cancellation releases (SEC-5, SEC-6); a plan for sale cannot take another's name (BILL-7); only a paid
/// renewal counts as coverage on Coach Today (BEB-7); and a price plan gives at least one grace day (BILL-4).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string A7ProductsUrl = "/api/commercial/products";

    [TestMethod]
    public async Task A7MoneyIsKeptToTheCentAndAReceiptIsDatedByTheWorkspaceDay()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a7-money-coach@example.test", "Hicham Haddad", "A7 Money");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a7-money-maya@example.test", "Maya", "Rahman");

        // A price with a part of a cent is refused, on a new plan and on a new option, and nothing is saved.
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("Use at most two decimals.", await A7FieldErrorAsync(
            await coach.PostAsJsonAsync(A7ProductsUrl, A7ProductRequest("Sub-cent plan", 10.123m, 4, "Training")), "priceAmount"));
        Assert.AreEqual(0L, await A7ScalarAsync("SELECT count(*) FROM subscriptions.\"CoachingProducts\""));
        var product = await A7ProductAsync(coach, "Online Coaching", 130m, 4, "Training");
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("Use at most two decimals.", await A7FieldErrorAsync(
            await coach.PostAsJsonAsync($"{A7ProductsUrl}/{product.Id}/offers", A7OfferRequest(12, 10.125m, "Training")), "priceAmount"));
        var plan = await A7EnrollAsync(coach, mayaId, product.Offers.Single().Id, TenantToday());

        // A receipt of 1.005 or 10.005 is refused, never kept as 1.01 or 10.01 (BILL-1).
        var url = $"/api/commercial/enrollments/{plan.Id}/payments";
        foreach (var subCent in new[] { 1.005m, 10.005m, 2.345m })
        {
            await RefreshCsrfAsync(coach);
            Assert.AreEqual("Use at most two decimals.", await A7FieldErrorAsync(
                await coach.PostAsJsonAsync(url, A7PaymentRequest(subCent, TenantToday(), Guid.NewGuid())), "amount"));
        }

        // The day must be given, and cannot be one still to come.
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("A payment can't be received in the future.", await A7FieldErrorAsync(
            await coach.PostAsJsonAsync(url, A7PaymentRequest(63.36m, TenantToday().AddDays(1), Guid.NewGuid())), "receivedOn"));
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("Choose the day it was received.", await A7FieldErrorAsync(
            await coach.PostAsJsonAsync(url, new { amount = 63.36m, currencyCode = "USD", receivedAtUtc = DateTimeOffset.UtcNow, method = "Cash", idempotencyKey = Guid.NewGuid() }),
            "receivedOn"));
        Assert.AreEqual(0L, await A7ScalarAsync("SELECT count(*) FROM subscriptions.\"PaymentRecords\""));

        // Money received three days ago is stamped at midday that day in Beirut, and read back as that day.
        var threeDaysAgo = TenantToday().AddDays(-3);
        var key = Guid.NewGuid();
        var partPaid = await A7PayAsync(coach, plan.Id, 63.36m, threeDaysAgo, key);
        var first = partPaid.Payments.Single();
        Assert.AreEqual((63.36m, threeDaysAgo), (first.Amount, first.ReceivedOn));
        Assert.AreEqual(A7MiddayInBeirut(threeDaysAgo), first.ReceivedAtUtc);
        Assert.AreEqual(63.36m, partPaid.PaidAmount);

        // The same entry again is the same payment; the same key with another day is another request.
        Assert.HasCount(1, (await A7PayAsync(coach, plan.Id, 63.36m, threeDaysAgo, key)).Payments);
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("idempotency_key_reused", (await A7ConflictAsync(
            await coach.PostAsJsonAsync(url, A7PaymentRequest(63.36m, threeDaysAgo.AddDays(-1), key)))).Code);

        // Money received today is stamped now; the rest pays the plan in full.
        var paid = await A7PayAsync(coach, plan.Id, 66.64m, TenantToday(), Guid.NewGuid());
        var today = paid.Payments.Single(item => item.Amount == 66.64m);
        Assert.AreEqual(TenantToday(), today.ReceivedOn);
        Assert.IsLessThan(TimeSpan.FromMilliseconds(1), (today.ReceivedAtUtc - RequiredTestClock.UtcNow).Duration());
        Assert.AreEqual(("Active", 130m, 0m), (paid.StoredStatus.ToString(), paid.PaidAmount, paid.BalanceAmount));
        Assert.AreEqual(2L, await A7ScalarAsync("SELECT count(*) FROM subscriptions.\"PaymentRecords\""));
        Assert.AreEqual(0L, await A7ScalarAsync("SELECT count(*) FROM subscriptions.\"PaymentRecords\" WHERE \"Amount\" * 100 <> trunc(\"Amount\" * 100)"));
    }

    [TestMethod]
    public async Task A7ANewPriceOptionCountsTheClientsOfTheOptionsItReplaced()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "a7-price-owner@example.test", "Hicham Haddad", "A7 Price");
        var ids = new Dictionary<string, Guid>();
        foreach (var (first, last) in new[] { ("Maya", "Rahman"), ("Rami", "Tabet"), ("Lea", "Khoury") })
        {
            using var client = CreateClient();
            ids[first] = await R31InviteAsync(owner, client, tenant, $"a7-price-{first.ToLowerInvariant()}@example.test", first, last);
        }

        var product = await A7ProductAsync(owner, "Online Coaching", 130m, 4, "Training");
        var at130 = product.Offers.Single();
        var maya = await A7EnrollAsync(owner, ids["Maya"], at130.Id, TenantToday());
        await A7EnrollAsync(owner, ids["Rami"], at130.Id, TenantToday().AddDays(3));

        // 130 becomes 150: Maya and Rami stay on 130, and the option on sale counts them (COACH-2).
        var at150 = await A7ChangePriceAsync(owner, at130, 150m);
        var view = await A7CatalogProductAsync(owner, product.Id);
        var sale150 = view.Offers.Single(item => item.Id == at150.Id);
        var retired130 = view.Offers.Single(item => item.Id == at130.Id);
        Assert.AreEqual((1, 1), (sale150.Clients.Now, sale150.Clients.Starting), "The new price says who is on the plan.");
        Assert.AreEqual((1, 1), (retired130.Clients.Now, retired130.Clients.Starting), "The old price keeps its own clients.");
        Assert.AreEqual((at150.Id, (Guid?)null), (retired130.ReplacedByOfferId, sale150.ReplacedByOfferId));
        Assert.AreEqual((1, 1), (view.Clients.Now, view.Clients.Starting));

        // Lea joins at 150; then 150 becomes 170, which counts all three through both changes.
        await A7EnrollAsync(owner, ids["Lea"], at150.Id, TenantToday());
        var at170 = await A7ChangePriceAsync(owner, view.Offers.Single(item => item.Id == at150.Id), 170m);
        view = await A7CatalogProductAsync(owner, product.Id);
        var sale170 = view.Offers.Single(item => item.Id == at170.Id);
        Assert.AreEqual((2, 1), (sale170.Clients.Now, sale170.Clients.Starting));
        Assert.AreEqual((1, 0), (view.Offers.Single(item => item.Id == at150.Id).Clients.Now, view.Offers.Single(item => item.Id == at150.Id).Clients.Starting));
        Assert.AreEqual(at170.Id, view.Offers.Single(item => item.Id == at150.Id).ReplacedByOfferId);
        Assert.AreEqual(at150.Id, view.Offers.Single(item => item.Id == at130.Id).ReplacedByOfferId);
        Assert.AreEqual((2, 1), (view.Clients.Now, view.Clients.Starting), "Each client once.");

        // Maya renews on the option that replaced hers, at its price.
        await RefreshCsrfAsync(owner);
        var renewed = await owner.PostAsJsonAsync($"/api/commercial/enrollments/{maya.Id}/renew",
            new { offerId = at170.Id, startDate = maya.EndDateExclusive, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(renewed, HttpStatusCode.OK);
        Assert.AreEqual(170m, (await ReadSlicePayloadAsync<ClientEnrollmentView>(renewed)).PriceAmount);
    }

    [TestMethod]
    public async Task A7CoverageAndIntakeHistoryAreAppendOnlyAndACancelledPlanSaysWhen()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a7-guard-coach@example.test", "Hicham Haddad", "A7 Guards");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a7-guard-maya@example.test", "Maya", "Rahman");
        var product = await A7ProductAsync(coach, "Online Coaching", 0m, 4, "Training");
        var plan = await A7EnrollAsync(coach, mayaId, product.Offers.Single().Id, TenantToday());
        Assert.IsNull(plan.CancelledOn);
        var coverage = $"subscriptions.\"EnrollmentEntitlements\" WHERE \"EnrollmentId\" = '{plan.Id}'";

        // A client's paid coverage cannot be deleted, re-dated or moved by anyone with database access (SEC-5).
        foreach (var sql in new[]
                 {
                     $"DELETE FROM {coverage}",
                     $"UPDATE {coverage.Replace(" WHERE", " SET \"EndDateExclusive\" = '2030-01-01' WHERE", StringComparison.Ordinal)}",
                     $"UPDATE {coverage.Replace(" WHERE", " SET \"StartDate\" = \"StartDate\" - 30 WHERE", StringComparison.Ordinal)}",
                     $"UPDATE {coverage.Replace(" WHERE", " SET \"Feature\" = 'Nutrition' WHERE", StringComparison.Ordinal)}",
                     $"UPDATE {coverage.Replace(" WHERE", $" SET \"ClientProfileId\" = '{Guid.NewGuid()}' WHERE", StringComparison.Ordinal)}",
                 })
        {
            Assert.AreEqual("55000", (await A7RefusedAsync(sql)).SqlState, sql);
        }

        // The intake change history is append-only too (SEC-6).
        await A7SqlAsync($"""
            INSERT INTO clients."ClientProfileChanges" ("Id", "TenantId", "ClientProfileId", "Source", "ChangedFields")
            VALUES (gen_random_uuid(), '{tenant}', '{mayaId}', 'Coach', 'Goals')
            """);
        Assert.AreEqual("55000", (await A7RefusedAsync($"DELETE FROM clients.\"ClientProfileChanges\" WHERE \"ClientProfileId\" = '{mayaId}'")).SqlState);
        Assert.AreEqual("55000", (await A7RefusedAsync($"UPDATE clients.\"ClientProfileChanges\" SET \"ChangedFields\" = 'Allergies' WHERE \"ClientProfileId\" = '{mayaId}'")).SqlState);

        // Cancelling releases the overlap lock, the one change a coverage row takes, and says on which day.
        await RefreshCsrfAsync(coach);
        var cancelled = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/cancel", new { reason = "Wrong plan", plan.Version });
        await AssertStatusAsync(cancelled, HttpStatusCode.OK);
        var answer = await ReadSlicePayloadAsync<ClientEnrollmentView>(cancelled);
        Assert.AreEqual((TenantToday(), plan.LastActiveDate), (answer.CancelledOn, answer.LastActiveDate));
        Assert.AreEqual(TenantToday(), (await A7OverviewAsync(coach, mayaId)).Enrollments.Single().CancelledOn);
        Assert.AreEqual(0L, await A7ScalarAsync($"SELECT count(*) FROM {coverage} AND \"BlocksOverlap\""));
        Assert.AreEqual("55000", (await A7RefusedAsync(
            $"UPDATE {coverage.Replace(" WHERE", " SET \"BlocksOverlap\" = true WHERE", StringComparison.Ordinal)}")).SqlState,
            "A released lock is never taken again.");

        // The dates are free for another plan, and the cancelled one's rows are all still there.
        var replacement = await A7EnrollAsync(coach, mayaId, product.Offers.Single().Id, TenantToday());
        Assert.IsNull(replacement.CancelledOn);
        Assert.AreEqual(1L, await A7ScalarAsync($"SELECT count(*) FROM {coverage}"));

        // Releasing the lock straight in SQL is the one update the guard allows (rolled back here).
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var release = connection.CreateCommand();
        release.Transaction = transaction;
        release.CommandText = $"UPDATE subscriptions.\"EnrollmentEntitlements\" SET \"BlocksOverlap\" = false, \"UpdatedAtUtc\" = now() WHERE \"EnrollmentId\" = '{replacement.Id}'";
        Assert.AreEqual(1, await release.ExecuteNonQueryAsync());
        await transaction.RollbackAsync();
    }

    [TestMethod]
    public async Task A7APlanForSaleCannotTakeAnotherPlansNameButOldDuplicatesKeepTheirs()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a7-name-coach@example.test", "Hicham Haddad", "A7 Names");
        var formCheck = await A7ProductAsync(coach, "Form check (free)", 0m, 1, "Messaging");

        // The same name in other letters is refused for a new plan (BILL-7) and the coach is told which.
        await RefreshCsrfAsync(coach);
        var taken = await A7ConflictAsync(await coach.PostAsJsonAsync(A7ProductsUrl, A7ProductRequest("  FORM CHECK (free) ", 0m, 1, "Messaging")));
        Assert.AreEqual(("product_name_taken", "You already sell a plan called \"FORM CHECK (free)\". Choose another name, or rename that plan first."), (taken.Code, taken.Message));
        Assert.AreEqual(1L, await A7ScalarAsync("SELECT count(*) FROM subscriptions.\"CoachingProducts\""));

        // Another workspace may use it.
        using var other = CreateClient();
        await RegisterCoachAsync(other, "a7-name-other@example.test", "Other Coach", "A7 Other");
        await A7ProductAsync(other, "Form check (free)", 0m, 1, "Messaging");

        // A rename onto it is refused; a rename to a free name is fine.
        var video = await A7ProductAsync(coach, "Video review", 20m, 1, "Messaging");
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("product_name_taken", (await A7ConflictAsync(await coach.PutAsJsonAsync($"{A7ProductsUrl}/{video.Id}",
            new { name = "form check (FREE)", description = (string?)null, isActive = true, video.Version }))).Code);
        video = await A7UpdateProductAsync(coach, video, "Video review (paid)", isActive: true);

        // A plan no longer sold holds no name; selling it again while another holds it is refused.
        formCheck = await A7UpdateProductAsync(coach, formCheck, formCheck.Name, isActive: false);
        var newFormCheck = await A7ProductAsync(coach, "Form check (free)", 0m, 2, "Messaging");
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("product_name_taken", (await A7ConflictAsync(await coach.PutAsJsonAsync($"{A7ProductsUrl}/{formCheck.Id}",
            new { name = formCheck.Name, description = "Back on sale", isActive = true, formCheck.Version }))).Code);

        // Two plans that shared a name before the rule keep it until one is renamed (the owner's decision).
        await A7SqlAsync($"""
            ALTER TABLE subscriptions."CoachingProducts" DISABLE TRIGGER "TR_CoachingProducts_ActiveName";
            UPDATE subscriptions."CoachingProducts" SET "Name" = 'Form check (free)' WHERE "Id" = '{video.Id}';
            ALTER TABLE subscriptions."CoachingProducts" ENABLE TRIGGER "TR_CoachingProducts_ActiveName";
            """);
        var legacy = (await ReadSliceAsync<ProductCatalog>(coach, A7ProductsUrl)).Products.Single(item => item.Id == video.Id);
        legacy = await A7UpdateProductAsync(coach, legacy, legacy.Name, isActive: true, description: "Edited, name kept");
        Assert.AreEqual(("Form check (free)", "Edited, name kept"), (legacy.Name, legacy.Description));
        legacy = await A7UpdateProductAsync(coach, legacy, "Video review (paid)", isActive: true);
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("product_name_taken", (await A7ConflictAsync(await coach.PutAsJsonAsync($"{A7ProductsUrl}/{legacy.Id}",
            new { name = "Form check (free)", description = (string?)null, isActive = true, legacy.Version }))).Code);
        Assert.AreEqual("Form check (free)", newFormCheck.Name);

        // Two plans given one name at once: both pass the check, the database keeps one (the trigger's lock).
        await RefreshCsrfAsync(coach);
        RequiredInsertBarrier.Arm("subscriptions.\"CoachingProducts\"", 2);
        HttpResponseMessage[] saves;
        try
        {
            saves = await Task.WhenAll(
                coach.PostAsJsonAsync(A7ProductsUrl, A7ProductRequest("Strength block", 90m, 4, "Training")),
                coach.PostAsJsonAsync(A7ProductsUrl, A7ProductRequest("strength BLOCK", 95m, 6, "Training")));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two saves never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        CollectionAssert.AreEquivalent(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, saves.Select(item => item.StatusCode).ToArray());
        Assert.AreEqual("product_name_taken", (await A7ConflictAsync(saves.Single(item => item.StatusCode == HttpStatusCode.Conflict))).Code);
        Assert.AreEqual(1L, await A7ScalarAsync("SELECT count(*) FROM subscriptions.\"CoachingProducts\" WHERE lower(\"Name\") = 'strength block'"));

        // Straight SQL meets the same guard.
        var refused = await A7RefusedAsync($"""
            INSERT INTO subscriptions."CoachingProducts" ("Id", "TenantId", "Name", "IsActive")
            SELECT gen_random_uuid(), "TenantId", 'STRENGTH block', true FROM subscriptions."CoachingProducts" WHERE "Id" = '{video.Id}'
            """);
        Assert.AreEqual((PostgresErrorCodes.UniqueViolation, "UX_CoachingProducts_ActiveName"), (refused.SqlState, refused.ConstraintName));
    }

    [TestMethod]
    public async Task A7OnlyAPaidRenewalCountsAsCoverageOnCoachToday()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a7-renewal-coach@example.test", "Hicham Haddad", "A7 Renewal");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a7-renewal-maya@example.test", "Maya", "Rahman");
        var product = await A7ProductAsync(coach, "Chat coaching", 0m, 1, "Messaging");
        await RefreshCsrfAsync(coach);
        var added = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{product.Id}/offers", A7OfferRequest(8, 130m, "Messaging"));
        await AssertStatusAsync(added, HttpStatusCode.OK);
        var eightWeeks = (await ReadSlicePayloadAsync<CoachingProductView>(added)).Offers.Single(item => item.DurationCount == 8);
        var week = await A7EnrollAsync(coach, mayaId, product.Offers.Single().Id, TenantToday());
        var lastPaidDay = TenantToday().AddDays(6);

        var item = await A7EndingSoonAsync(coach, mayaId);
        Assert.AreEqual((lastPaidDay, (int?)null, week.Id), (item.Date, item.Count, item.SubjectId));

        // A renewal waiting for payment covers nothing (SUB-008), so the plan still ends in six days and the
        // item names the renewal to record a payment on (BEB-7, the owner's decision).
        await RefreshCsrfAsync(coach);
        var renewalResponse = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{week.Id}/renew",
            new { offerId = eightWeeks.Id, startDate = week.EndDateExclusive, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(renewalResponse, HttpStatusCode.OK);
        var renewal = await ReadSlicePayloadAsync<ClientEnrollmentView>(renewalResponse);
        Assert.AreEqual("PendingPayment", renewal.StoredStatus.ToString());

        item = await A7EndingSoonAsync(coach, mayaId);
        Assert.AreEqual((lastPaidDay, (int?)1, renewal.Id), (item.Date, item.Count, item.SubjectId));
        Assert.AreEqual(1, (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndingSoonCount);
        var row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single(client => client.Client.ClientProfileId == mayaId);
        Assert.AreEqual((ClientOverviewStatus.EndingSoon, (DateOnly?)lastPaidDay), (row.Status, row.PlanEndsOn));
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, $"/api/clients/{mayaId}/overview");
        Assert.AreEqual(("Chat coaching", (DateOnly?)lastPaidDay), (page.PlanName, page.PlanEndsOn));
        Assert.AreEqual((int?)1, page.Attention.Single(entry => entry.Kind == CoachAttentionKind.PlanEndingSoon).Count);

        // Paid, the renewal covers its eight weeks and nothing is ending soon.
        await A7PayAsync(coach, renewal.Id, 130m, TenantToday(), Guid.NewGuid());
        var today = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.IsFalse(today.Attention.Any(entry => entry.Kind == CoachAttentionKind.PlanEndingSoon));
        Assert.AreEqual(0, today.PlansEndingSoonCount);
        row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single(client => client.Client.ClientProfileId == mayaId);
        Assert.AreEqual((ClientOverviewStatus.OnTrack, (DateOnly?)renewal.LastActiveDate), (row.Status, row.PlanEndsOn));
    }

    [TestMethod]
    public async Task A7APricePlanGivesAtLeastOneGraceDay()
    {
        using var admin = await SignInPlatformAdminAsync("a7-grace-admin@example.test");
        var plans = await RequiredJsonAsync<BillingPlan[]>(await admin.GetAsync("/api/platform-admin/price-plans"));
        var current = plans.Single(plan => plan.IsCurrent).VersionNumber;
        object Plan(int graceDays) => new
        {
            seatPrice = 15m, includedClientsPerSeat = 5, extraClientPrice = 2m, gymFee = 10m, gymFeeMinimumSeats = 2,
            trialDays = 30, paymentTermDays = 7, graceDays, expectedCurrentVersion = current, note = "A7 grace days",
        };

        // Zero grace days was accepted and then applied as one; it is refused now (BILL-4).
        await RefreshCsrfAsync(admin);
        var refused = await admin.PostAsJsonAsync("/api/platform-admin/price-plans", Plan(0));
        await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "Enter a whole number from 1 to 90.");
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync("/api/platform-admin/price-plans", Plan(1)), HttpStatusCode.OK);

        var check = await A7RefusedAsync("""
            INSERT INTO billing."PricePlans"
                ("Id", "VersionNumber", "CurrencyCode", "SeatPrice", "IncludedClientsPerSeat", "ExtraClientPrice", "GymFee",
                 "GymFeeMinimumSeats", "TrialDays", "PaymentTermDays", "GraceDays", "Note", "PublishedAtUtc")
            VALUES (gen_random_uuid(), 99, 'USD', 15, 5, 2, 10, 2, 30, 7, 0, 'Straight SQL', now())
            """);
        Assert.AreEqual((PostgresErrorCodes.CheckViolation, "CK_PricePlans_GraceDays"), (check.SqlState, check.ConstraintName));
    }

    [TestMethod]
    public async Task A7TheGuardsSurviveARevertAndAReapplyOfTheirMigration()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a7-migration-coach@example.test", "Hicham Haddad", "A7 Migration");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a7-migration-maya@example.test", "Maya", "Rahman");
        var plan = await A7EnrollAsync(coach, mayaId, (await A7ProductAsync(coach, "Online Coaching", 0m, 4, "Training")).Offers.Single().Id, TenantToday());

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_MoneyAndPlanGuards", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Reverted, nothing guards those rows, and a plan with no grace day can be published as before.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A7ScalarAsync("SELECT count(*) FROM pg_trigger WHERE tgname IN ('TR_EnrollmentEntitlements_Protect', 'TR_ClientProfileChanges_AppendOnly', 'TR_CoachingProducts_ActiveName')"));
        await A7SqlAsync("""
            INSERT INTO billing."PricePlans"
                ("Id", "VersionNumber", "CurrencyCode", "SeatPrice", "IncludedClientsPerSeat", "ExtraClientPrice", "GymFee",
                 "GymFeeMinimumSeats", "TrialDays", "PaymentTermDays", "GraceDays", "Note", "PublishedAtUtc")
            VALUES (gen_random_uuid(), 2, 'USD', 15, 5, 2, 10, 2, 30, 7, 0, 'Published before the rule', now())
            """);

        // Applied again over that plan: it stays as published, and the guards hold again.
        await migrator.MigrateAsync(migration);
        Assert.AreEqual(1L, await A7ScalarAsync("SELECT count(*) FROM billing.\"PricePlans\" WHERE \"GraceDays\" = 0"));
        Assert.AreEqual(3L, await A7ScalarAsync("SELECT count(*) FROM pg_trigger WHERE tgname IN ('TR_EnrollmentEntitlements_Protect', 'TR_ClientProfileChanges_AppendOnly', 'TR_CoachingProducts_ActiveName')"));
        Assert.AreEqual("55000", (await A7RefusedAsync($"DELETE FROM subscriptions.\"EnrollmentEntitlements\" WHERE \"EnrollmentId\" = '{plan.Id}'")).SqlState);
        await A7ProductAsync(coach, "Second plan", 0m, 4, "Messaging");
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("product_name_taken", (await A7ConflictAsync(
            await coach.PostAsJsonAsync(A7ProductsUrl, A7ProductRequest("second PLAN", 0m, 4, "Messaging")))).Code);
    }

    private static async Task<CoachAttentionItemView> A7EndingSoonAsync(HttpClient coach, Guid clientId) =>
        (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention
            .Single(item => item.Kind == CoachAttentionKind.PlanEndingSoon && item.Client.ClientProfileId == clientId);

    private static object A7ProductRequest(string name, decimal price, int weeks, string feature) => new
    {
        name,
        description = (string?)null,
        initialOffer = A7OfferRequest(weeks, price, feature),
    };

    private static object A7OfferRequest(int weeks, decimal price, string feature) => new
    {
        label = $"{weeks} weeks",
        durationCount = weeks,
        durationUnit = "Week",
        priceAmount = price,
        priceCurrency = "USD",
        features = new[] { new { feature, allowsConcurrentCoverage = false } },
    };

    private static object A7PaymentRequest(decimal amount, DateOnly receivedOn, Guid key) => new
    {
        amount,
        currencyCode = "USD",
        receivedOn = receivedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        method = "Cash",
        reference = (string?)null,
        note = (string?)null,
        idempotencyKey = key,
    };

    private static async Task<CoachingProductView> A7ProductAsync(HttpClient coach, string name, decimal price, int weeks, string feature)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(A7ProductsUrl, A7ProductRequest(name, price, weeks, feature));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    private static async Task<CoachingProductView> A7UpdateProductAsync(
        HttpClient coach, CoachingProductView product, string name, bool isActive, string? description = null)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PutAsJsonAsync($"{A7ProductsUrl}/{product.Id}",
            new { name, description = description ?? product.Description, isActive, product.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    private static async Task<CoachingProductView> A7CatalogProductAsync(HttpClient coach, Guid productId) =>
        (await ReadSliceAsync<ProductCatalog>(coach, A7ProductsUrl)).Products.Single(item => item.Id == productId);

    private static async Task<TB.Gym.Modules.Subscriptions.ProductOfferView> A7ChangePriceAsync(
        HttpClient coach, TB.Gym.Modules.Subscriptions.ProductOfferView offer, decimal price)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/offers/{offer.Id}/price-changes",
            new { priceAmount = price, offer.Version, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<CoachingProductView>(response)).Offers.Single(item => item.IsActive && item.PriceAmount == price);
    }

    private static async Task<ClientEnrollmentView> A7EnrollAsync(HttpClient coach, Guid clientId, Guid offerId, DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/enrollments",
            new { offerId, startDate = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    private static async Task<ClientEnrollmentView> A7PayAsync(HttpClient coach, Guid enrollmentId, decimal amount, DateOnly receivedOn, Guid key)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{enrollmentId}/payments", A7PaymentRequest(amount, receivedOn, key));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    private static async Task<CommercialOverview> A7OverviewAsync(HttpClient coach, Guid clientId) =>
        await ReadSliceAsync<CommercialOverview>(coach, $"/api/commercial/clients/{clientId}");

    private static DateTimeOffset A7MiddayInBeirut(DateOnly day) => new(
        TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(new TimeOnly(12, 0)), TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")),
        TimeSpan.Zero);

    /// <summary>The one message a 400 gives for <paramref name="field"/>, read as JSON so its apostrophes decode.</summary>
    private static async Task<string> A7FieldErrorAsync(HttpResponseMessage response, string field)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("errors").GetProperty(field).EnumerateArray().Single().GetString()!;
    }

    private static async Task<(string Code, string Message)> A7ConflictAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return (body.RootElement.GetProperty("code").GetString()!, body.RootElement.GetProperty("message").GetString()!);
    }

    private async Task A7SqlAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private async Task<PostgresException> A7RefusedAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return await Assert.ThrowsExactlyAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
    }

    private async Task<long> A7ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    }
}
