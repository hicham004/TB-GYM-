using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Initialization;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Manual platform billing (ADR 0028), against PostgreSQL: the monthly invoice from membership history
/// and plan coverage, idempotent issuing, immutability, read-only enforcement, the notice emails, and
/// the platform admin's authorization and operations. Prices are the seeded placeholder plan: $15 a
/// seat including 5 clients, $2 an extra client, a $10 gym fee from 2 seats, a 30-day trial, due in
/// 7 days, read-only 7 days after that.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly DateTimeOffset BillingWorkspaceCreated = new(2026, 6, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly BillingMonth BillingJuly = new(2026, 7);

    [TestMethod]
    public async Task PlatformBillingIssuesOneInvoicePerWorkspaceAndMonthFromSeatsAndCoveredClients()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "bill-owner@example.test", "Bill Owner", "Bill Gym");
        using var coachStays = CreateClient();
        await JoinAsCoachAsync(owner, coachStays, "bill-coach-a@example.test", "Stays Coach");
        using var coachLeavesInJuly = CreateClient();
        var leavesInJuly = await JoinAsCoachAsync(owner, coachLeavesInJuly, "bill-coach-b@example.test", "July Coach");
        using var coachLeavesInJune = CreateClient();
        var leavesInJune = await JoinAsCoachAsync(owner, coachLeavesInJune, "bill-coach-c@example.test", "June Coach");
        using var covered = CreateClient();
        var coveredId = await InviteAndAcceptAsync(owner, covered, "bill-client-a@example.test", true);
        using var cancelled = CreateClient();
        var cancelledId = await InviteAndAcceptAsync(owner, cancelled, "bill-client-b@example.test", true);
        using var neverEnrolled = CreateClient();
        await InviteAndAcceptAsync(owner, neverEnrolled, "bill-client-c@example.test", true);
        using var pausedPartOfJuly = CreateClient();
        var pausedPartOfJulyId = await InviteAndAcceptAsync(owner, pausedPartOfJuly, "bill-client-d@example.test", true);
        using var pausedAllJuly = CreateClient();
        var pausedAllJulyId = await InviteAndAcceptAsync(owner, pausedAllJuly, "bill-client-e@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, coveredId, BillingLocalDate());
        var toCancel = await CreateFreeTrainingEnrollmentAsync(owner, cancelledId, BillingLocalDate());
        var partlyPaused = await CreateFreeTrainingEnrollmentAsync(owner, pausedPartOfJulyId, BillingLocalDate());

        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 10, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/commercial/enrollments/{toCancel.Id}/cancel",
                new { reason = "Stopped before July", version = toCancel.Version }),
            HttpStatusCode.OK);
        partlyPaused = await PauseEnrollmentForBillingAsync(owner, partlyPaused);
        var wholeJulyPaused = await CreateFreeTrainingEnrollmentAsync(owner, pausedAllJulyId, BillingLocalDate());
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 20, 9, 0, 0, TimeSpan.Zero));
        await RemoveCoachForBillingAsync(owner, leavesInJune);
        wholeJulyPaused = await PauseEnrollmentForBillingAsync(owner, wholeJulyPaused);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 15, 9, 0, 0, TimeSpan.Zero));
        await RemoveCoachForBillingAsync(owner, leavesInJuly);
        await ResumeEnrollmentForBillingAsync(owner, partlyPaused);

        // Resumed just before the run: the plan is active now, but it was paused for all of July.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 5, 0, TimeSpan.Zero));
        await ResumeEnrollmentForBillingAsync(owner, wholeJulyPaused);
        Assert.AreEqual(
            3L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM subscriptions."EnrollmentStatusChanges" WHERE "EnrollmentId" = @id""",
                wholeJulyPaused.Id),
            "The trigger kept the plan's start, its pause and its resume.");

        // The trigger kept every status each membership entered, with the application's clock.
        Assert.AreEqual(
            2L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM tenancy."MembershipStatusChanges" WHERE "UserId" = @id""",
                leavesInJuly));

        // August 1st: two runs at once still bill July once.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        var runs = await Task.WhenAll(IssueBillingAsync(BillingJuly), IssueBillingAsync(BillingJuly));
        Assert.AreEqual(1, runs.Sum(run => run.Issued));
        Assert.AreEqual(1, runs.Sum(run => run.AlreadyIssued));
        Assert.AreEqual(1, (await IssueBillingAsync(BillingJuly)).AlreadyIssued, "Running it again creates nothing.");
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(RequiredDatabaseConnection, """SELECT count(*) FROM billing."Invoices" WHERE "TenantId" = @id""", workspaceId));

        // Owner, the coach who stayed and the coach who left mid-July. Two clients had access in July:
        // the covered one and the one resumed mid-month; the one paused all month is not billed.
        var billing = await RequiredJsonAsync<BillingView>(await owner.GetAsync("/api/billing"));
        var invoice = billing.Invoices.Single();
        Assert.AreEqual(3, invoice.Amounts.Seats);
        Assert.AreEqual(2, invoice.Amounts.BillableClients);
        Assert.AreEqual(15, invoice.Amounts.IncludedClients);
        Assert.AreEqual(0, invoice.Amounts.ExtraClients);
        Assert.AreEqual(45.00m, invoice.Amounts.SeatAmount);
        Assert.AreEqual(10.00m, invoice.Amounts.GymFeeAmount);
        Assert.AreEqual(55.00m, invoice.Amounts.Total);
        Assert.AreEqual(1, invoice.PricePlanVersion);
        Assert.AreEqual(new DateOnly(2026, 8, 8), invoice.DueOn);
        Assert.AreEqual(new DateOnly(2026, 8, 15), invoice.ReadOnlyFrom);
        Assert.AreEqual("Open", invoice.Status);
        StringAssert.StartsWith(invoice.ReferenceCode, "TBG-202607-");
        Assert.AreEqual("Active", billing.Status);
        Assert.AreEqual(55.00m, billing.UnpaidTotal);
        Assert.AreEqual(2, billing.CurrentMonth.Amounts.Seats, "August so far: the owner and the coach who stayed.");

        // Only the owner sees billing.
        await AssertStatusAsync(await coachStays.GetAsync("/api/billing"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await covered.GetAsync("/api/billing"), HttpStatusCode.Forbidden);

        // Another workspace sees none of it, and cannot ask for it by header.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "bill-stranger@example.test", "Stranger", "Other Gym");
        var theirs = await RequiredJsonAsync<BillingView>(await stranger.GetAsync("/api/billing"));
        Assert.IsEmpty(theirs.Invoices);
        Assert.AreEqual("Trial", theirs.Status);
        Assert.IsTrue(theirs.CurrentMonth.InTrial);
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync("/api/billing"), HttpStatusCode.Forbidden);

        // The owner is emailed once, in fixed wording without the amount.
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        var mail = CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice);
        Assert.AreEqual("bill-owner@example.test", mail.RecipientAddress);
        Assert.AreEqual("Your TB Gym invoice is ready", mail.Subject);
        Assert.DoesNotContain("55", mail.TextBody);

        // Issued means immutable, down to the database.
        await AssertSqlStateAsync("55000", """UPDATE billing."Invoices" SET "Total" = 0 WHERE "Id" = @id""", ("id", invoice.Id));
        await AssertSqlStateAsync("55000", """DELETE FROM billing."Invoices" WHERE "Id" = @id""", ("id", invoice.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."PricePlans" SET "SeatPrice" = 1""");
        await AssertSqlStateAsync(
            "55000",
            """DELETE FROM tenancy."MembershipStatusChanges" WHERE "UserId" = @id""",
            ("id", leavesInJuly));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE subscriptions."EnrollmentStatusChanges" SET "Status" = 'Active' WHERE "EnrollmentId" = @id""",
            ("id", wholeJulyPaused.Id));
    }

    [TestMethod]
    public async Task PlatformBillingMakesAnUnpaidWorkspaceReadOnlyForStaffOnlyAndPayingRestoresIt()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "ro-owner@example.test", "Read Owner", "Read Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "ro-coach@example.test", "Read Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "ro-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(coach, clientId, BillingLocalDate());

        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(BillingJuly);
        var invoice = (await RequiredJsonAsync<BillingView>(await owner.GetAsync("/api/billing"))).Invoices.Single();
        Assert.AreEqual(40.00m, invoice.Amounts.Total, "2 seats, 1 client within the 10 included, and the gym fee.");
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);

        // Two days before it is due: one reminder, once.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 6, 8, 0, 0, TimeSpan.Zero));
        Assert.AreEqual(1, await QueueBillingRemindersAsync());
        Assert.AreEqual(0, await QueueBillingRemindersAsync());
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);

        // The day after it was due: overdue, told once, and the owner is warned before anything locks.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 9, 8, 0, 0, TimeSpan.Zero));
        Assert.AreEqual(1, await QueueBillingRemindersAsync());
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        CollectionAssert.AreEqual(
            BillingNoticeSubjects,
            CapturedNoticeMail.Captured.Where(item => item.Scope == ActionMailScopes.WorkspaceNotice).Select(item => item.Subject).ToArray());
        var ownerWarning = await RequiredJsonAsync<BillingAccess>(await owner.GetAsync("/api/billing/access"));
        Assert.IsFalse(ownerWarning.IsReadOnly);
        Assert.IsTrue(ownerWarning.HasOverdueInvoice);
        Assert.AreEqual(new DateOnly(2026, 8, 15), ownerWarning.ReadOnlyFrom);
        var coachWarning = await RequiredJsonAsync<BillingAccess>(await coach.GetAsync("/api/billing/access"));
        Assert.IsFalse(coachWarning.HasOverdueInvoice, "A coach never learns about the bill itself.");
        Assert.IsNull(coachWarning.ReadOnlyFrom);
        await AssertStatusAsync(await InviteForBillingAsync(owner, "ro-before@example.test"), HttpStatusCode.Created);

        // Seven days after the due date: read-only for the owner and coaches, in every module.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 15, 8, 0, 0, TimeSpan.Zero));
        await AssertReadOnlyAsync(await InviteForBillingAsync(owner, "ro-owner-try@example.test"));
        await AssertReadOnlyAsync(await InviteForBillingAsync(coach, "ro-coach-try@example.test"));
        await RefreshCsrfAsync(coach);
        await AssertReadOnlyAsync(await coach.PutAsJsonAsync($"/api/clients/{clientId}/coach-notes", new { notes = "x", version = 1 }));
        await AssertStatusAsync(await owner.GetAsync("/api/clients"), HttpStatusCode.OK);
        await AssertStatusAsync(await coach.GetAsync($"/api/clients/{clientId}"), HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<BillingAccess>(await coach.GetAsync("/api/billing/access"))).IsReadOnly);
        var locked = await RequiredJsonAsync<BillingView>(await owner.GetAsync("/api/billing"));
        Assert.AreEqual("ReadOnly", locked.Status);
        Assert.IsTrue(locked.Invoices.Single().LocksWorkspace);

        // Clients keep full use.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(80m, BillingLocalDate().ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture))),
            HttpStatusCode.OK);

        // A coach can still leave an unpaid workspace; resigning is on the reviewed list.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsync("/api/team/me/resign", null), HttpStatusCode.OK);

        // Paying lifts it at once.
        using var admin = await SignInPlatformAdminAsync("ro-admin@example.test");
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(
                $"/api/platform-admin/invoices/{invoice.Id}/payments",
                new { amount = 40.00m, reference = "WHISH-778812", note = "Matched by phone" }),
            HttpStatusCode.OK);
        await AssertStatusAsync(await InviteForBillingAsync(owner, "ro-after@example.test"), HttpStatusCode.Created);
        var paid = await RequiredJsonAsync<BillingView>(await owner.GetAsync("/api/billing"));
        Assert.AreEqual("Active", paid.Status);
        Assert.AreEqual("Paid", paid.Invoices.Single().Status);
        Assert.AreEqual("WHISH-778812", paid.Invoices.Single().Payment!.Reference);
        Assert.IsNull(paid.Invoices.Single().Payment!.Note, "The admin's note stays on the admin screen.");
        Assert.AreEqual(0, await QueueBillingRemindersAsync());
        Assert.AreNotEqual(Guid.Empty, workspaceId);
    }

    [TestMethod]
    public async Task PlatformAdminEndpointsAreReachableOnlyByAPlatformAdmin()
    {
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync("/api/platform-admin/workspaces"), HttpStatusCode.Unauthorized);

        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "authz-owner@example.test", "Authz Owner", "Authz Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "authz-coach@example.test", "Authz Coach");
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "authz-client@example.test", true);

        // No workspace role reaches it, whatever workspace header is sent.
        foreach (var caller in new[] { owner, coach, client })
        {
            await AssertStatusAsync(await caller.GetAsync("/api/platform-admin/workspaces"), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await caller.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await caller.GetAsync("/api/platform-admin/price-plans"), HttpStatusCode.Forbidden);
            await RefreshCsrfAsync(caller);
            await AssertStatusAsync(
                await caller.PostAsJsonAsync("/api/platform-admin/price-plans", BillingPlanRequest(1, seatPrice: 1m)),
                HttpStatusCode.Forbidden);
            await AssertStatusAsync(
                await caller.PostAsJsonAsync("/api/platform-admin/invoices/issue", new { periodStart = (DateOnly?)null }),
                HttpStatusCode.Forbidden);
        }

        // The role cannot be had any other way than the command, which needs a confirmed account.
        var output = new StringWriter();
        Assert.AreEqual(2, await RunPlatformAdminCommandAsync(output, "grant", "nobody@example.test"));
        Assert.AreEqual(2, await RunPlatformAdminCommandAsync(output, "promote", "authz-owner@example.test"));
        Assert.AreEqual(0, await RunPlatformAdminCommandAsync(output, "grant", "authz-owner@example.test"));

        // Granted: the same session now reaches it, without a workspace header or with one. The clock
        // moves on a minute so "this month so far" includes the memberships made at its frozen instant.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var list = await RequiredJsonAsync<BillingAdminWorkspace[]>(await owner.GetAsync("/api/platform-admin/workspaces"));
        Assert.IsTrue(list.Any(item => item.TenantId == workspaceId && item.Status == "Trial" && item.SeatsThisMonth == 2));
        await AssertStatusAsync(await coach.GetAsync("/api/platform-admin/workspaces"), HttpStatusCode.Forbidden);
        output = new StringWriter();
        Assert.AreEqual(0, await RunPlatformAdminCommandAsync(output, "list"));
        StringAssert.Contains(output.ToString(), "authz-owner@example.test");

        // Revoked: refused from the very next request.
        Assert.AreEqual(0, await RunPlatformAdminCommandAsync(new StringWriter(), "revoke", "authz-owner@example.test"));
        var afterRevoke = await owner.GetAsync("/api/platform-admin/workspaces");
        Assert.IsTrue(
            afterRevoke.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden,
            $"A revoked admin was answered {(int)afterRevoke.StatusCode}.");
    }

    [TestMethod]
    public async Task PlatformAdminPublishesPlansVoidsAndReissuesRecordsExactPaymentsAndGrantsDiscounts()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "ops-owner@example.test", "Ops Owner", "Ops Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "ops-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, clientId, BillingLocalDate());

        // The admin signs up after July, so their own new workspace is still in its trial.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        using var admin = await SignInPlatformAdminAsync("ops-admin@example.test");
        await RefreshCsrfAsync(admin);
        var ran = await RequiredJsonAsync<BillingRun>(
            await admin.PostAsJsonAsync("/api/platform-admin/invoices/issue", new { periodStart = (DateOnly?)null }));
        Assert.AreEqual(new DateOnly(2026, 7, 1), ran.PeriodStart);
        Assert.AreEqual(1, ran.Issued);
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync("/api/platform-admin/invoices/issue", new { periodStart = new DateOnly(2026, 8, 1) }),
            HttpStatusCode.BadRequest);
        var july = (await BillingDetailAsync(admin, workspaceId)).Invoices.Single();
        Assert.AreEqual(15.00m, july.Amounts.Total);

        // A new plan version: new invoices use it, the July invoice keeps its own.
        var plans = await RequiredJsonAsync<BillingPlan[]>(await admin.GetAsync("/api/platform-admin/price-plans"));
        Assert.AreEqual(1, plans.Single(plan => plan.IsCurrent).VersionNumber);
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync("/api/platform-admin/price-plans", BillingPlanRequest(1, seatPrice: -1m)),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync("/api/platform-admin/price-plans", BillingPlanRequest(1, seatPrice: 20m)),
            HttpStatusCode.OK);
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync("/api/platform-admin/price-plans", BillingPlanRequest(1, seatPrice: 25m)),
            "price_plan_changed");
        Assert.AreEqual(15.00m, (await BillingDetailAsync(admin, workspaceId)).Invoices.Single().Amounts.Total);

        // A founding-coach discount, which may not overlap another.
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(
                $"/api/platform-admin/workspaces/{workspaceId}/discounts",
                new { percent = 50m, startsOn = new DateOnly(2026, 7, 1), endsOnExclusive = new DateOnly(2026, 10, 1), note = "Founding coach" }),
            HttpStatusCode.OK);
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync(
                $"/api/platform-admin/workspaces/{workspaceId}/discounts",
                new { percent = 30m, startsOn = new DateOnly(2026, 9, 1), endsOnExclusive = new DateOnly(2027, 9, 1), note = "Overlaps" }),
            "discount_overlap");

        // Void and reissue: both kept; the correction recounts at July's own prices with the discount.
        await AssertStatusAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{july.Id}/void", new { reason = "", reissue = true }),
            HttpStatusCode.BadRequest);
        var voided = await RequiredJsonAsync<BillingVoid>(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{july.Id}/void", new { reason = "Founding discount applied late", reissue = true }));
        Assert.AreEqual("Void", voided.Voided.Status);
        var reissued = voided.Reissued!;
        Assert.AreEqual(july.Id, reissued.ReplacesInvoiceId);
        Assert.AreEqual(1, reissued.PricePlanVersion, "A correction keeps the voided invoice's plan.");
        Assert.AreEqual(50m, reissued.Amounts.DiscountPercent);
        Assert.AreEqual(7.50m, reissued.Amounts.Total);
        Assert.AreNotEqual(july.ReferenceCode, reissued.ReferenceCode);
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{july.Id}/void", new { reason = "Again", reissue = false }),
            "invoice_void");
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{july.Id}/payments", new { amount = 15m, reference = "WH-1" }),
            "invoice_void");
        var history = (await BillingDetailAsync(admin, workspaceId)).Invoices;
        Assert.HasCount(2, history);
        Assert.AreEqual(reissued.Id, history.Single(item => item.Id == july.Id).ReplacedByInvoiceId);
        Assert.AreEqual("Founding discount applied late", history.Single(item => item.Id == july.Id).VoidReason);

        // A payment is exactly the total, once; the same one sent twice is the same payment.
        await AssertStatusAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{reissued.Id}/payments", new { amount = 7m, reference = "WH-2" }),
            HttpStatusCode.BadRequest);
        var payment = await RequiredJsonAsync<BillingPayment>(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{reissued.Id}/payments", new { amount = 7.50m, reference = "WH-2", note = "Whish" }));
        var retried = await RequiredJsonAsync<BillingPayment>(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{reissued.Id}/payments", new { amount = 7.50m, reference = "WH-2" }));
        Assert.AreEqual(payment.Id, retried.Id);
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{reissued.Id}/payments", new { amount = 7.50m, reference = "WH-3" }),
            "invoice_paid");
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{reissued.Id}/void", new { reason = "Refund", reissue = false }),
            "invoice_paid");
        await AssertStatusAsync(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{Guid.NewGuid()}/payments", new { amount = 1m, reference = "WH-4" }),
            HttpStatusCode.NotFound);

        // The database refuses what the service refuses.
        await AssertSqlStateAsync("55000", """UPDATE billing."Payments" SET "Amount" = 1 WHERE "Id" = @id""", ("id", payment.Id));
        await AssertSqlStateAsync("55000", """DELETE FROM billing."InvoiceVoids" WHERE "InvoiceId" = @id""", ("id", july.Id));
        await AssertSqlStateAsync(
            "23514",
            """
            INSERT INTO billing."Payments" ("Id", "TenantId", "InvoiceId", "Amount", "CurrencyCode", "Reference", "ReceivedOn", "RecordedAtUtc", "RecordedByUserId", "CreatedAtUtc", "UpdatedAtUtc")
            SELECT gen_random_uuid(), "TenantId", "Id", "Total", "CurrencyCode", 'raw', DATE '2026-08-01', now(), gen_random_uuid(), now(), now()
            FROM billing."Invoices" WHERE "Id" = @id
            """,
            ("id", july.Id));

        // August is billed with the new plan's $20 seat, still at half price.
        RequiredTestClock.Set(new DateTimeOffset(2026, 9, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 8));
        var august = (await BillingDetailAsync(admin, workspaceId)).Invoices.Single(item => item.PeriodStart == new DateOnly(2026, 8, 1));
        Assert.AreEqual(2, august.PricePlanVersion);
        Assert.AreEqual(20m, august.PlanSeatPrice);
        Assert.AreEqual(10.00m, august.Amounts.Total);

        // Revoking a discount is kept, and happens once.
        var discount = (await BillingDetailAsync(admin, workspaceId)).Discounts.Single();
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsync($"/api/platform-admin/discounts/{discount.Id}/revoke", null), HttpStatusCode.OK);
        await AssertBillingConflictAsync(await admin.PostAsync($"/api/platform-admin/discounts/{discount.Id}/revoke", null), "discount_revoked");
        Assert.IsNotNull((await BillingDetailAsync(admin, workspaceId)).Discounts.Single().RevokedAtUtc);
        var row = (await RequiredJsonAsync<BillingAdminWorkspace[]>(await admin.GetAsync("/api/platform-admin/workspaces")))
            .Single(item => item.TenantId == workspaceId);
        Assert.AreEqual(10.00m, row.UnpaidTotal);
    }

    /// <summary>
    /// A state-changing route stays open to staff of an unpaid workspace only if it is on this reviewed
    /// list: reads sent as POST, a person's own settings, and resigning (ADR 0028).
    /// </summary>
    [TestMethod]
    public void PlatformBillingOnlyTheReviewedRoutesStayOpenWhileAWorkspaceIsReadOnly()
    {
        var open = RequiredFactory.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .Where(endpoint => endpoint.Metadata.GetMetadata<AllowedWhileWorkspaceReadOnly>() is not null)
            .Select(endpoint => endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ?? endpoint.DisplayName)
            .Order(StringComparer.Ordinal)
            .ToArray();

        CollectionAssert.AreEqual(ReviewedReadOnlyExemptions, open);
    }

    // ---------- billing helpers ----------

    private static readonly string[] BillingNoticeSubjects =
    [
        "Your TB Gym invoice is ready",
        "Your TB Gym invoice is due soon",
        "Your TB Gym invoice is overdue",
    ];

    private static readonly string[] ReviewedReadOnlyExemptions =
    [
        "AcknowledgeConversationRealtimeEvents",
        "AdvanceOwnConversationReadCursor",
        "CreatePrivateMediaAccess",
        "CreatePrivateMediaAccessBatch",
        "EstimateOneRepMax",
        "MarkOwnNotificationRead",
        "PreviewTrainingProgression",
        "ResignFromTeam",
        "UpdateOwnNotificationPreferences",
    ];

    private static async Task<Enrollment> PauseEnrollmentForBillingAsync(HttpClient owner, Enrollment enrollment)
    {
        await RefreshCsrfAsync(owner);
        var response = await owner.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollment.Id}/pause",
            new { reason = "Travelling", version = enrollment.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(response);
    }

    private static async Task ResumeEnrollmentForBillingAsync(HttpClient owner, Enrollment enrollment)
    {
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/commercial/enrollments/{enrollment.Id}/resume", new { version = enrollment.Version }),
            HttpStatusCode.OK);
    }

    private DateOnly BillingLocalDate() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            RequiredTestClock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")).DateTime);

    private async Task<InvoiceRunOutcome> IssueBillingAsync(BillingMonth month)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IPlatformInvoiceRun>().IssueForMonthAsync(month, CancellationToken.None);
    }

    private async Task<int> QueueBillingRemindersAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IPlatformInvoiceRun>().QueueRemindersAsync(CancellationToken.None);
    }

    private Task<int> RunPlatformAdminCommandAsync(TextWriter output, params string[] args) =>
        PlatformAdminCommand.RunAsync(RequiredFactory.Services, [PlatformAdminCommand.Name, .. args], output);

    /// <summary>A registered, confirmed account that the command made a platform admin.</summary>
    private async Task<HttpClient> SignInPlatformAdminAsync(string email)
    {
        var admin = CreateClient();
        await RegisterCoachAsync(admin, email, "Platform Admin", $"Admin {Guid.NewGuid():N}");
        admin.DefaultRequestHeaders.Remove("X-Tenant-Id");
        Assert.AreEqual(0, await RunPlatformAdminCommandAsync(new StringWriter(), "grant", email));
        return admin;
    }

    private static async Task<BillingAdminDetail> BillingDetailAsync(HttpClient admin, Guid workspaceId) =>
        await RequiredJsonAsync<BillingAdminDetail>(await admin.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"));

    private static object BillingPlanRequest(int expectedCurrentVersion, decimal seatPrice) => new
    {
        seatPrice,
        includedClientsPerSeat = 5,
        extraClientPrice = 2m,
        gymFee = 10m,
        gymFeeMinimumSeats = 2,
        trialDays = 30,
        paymentTermDays = 7,
        graceDays = 7,
        expectedCurrentVersion,
        note = "Test plan",
    };

    private static async Task<HttpResponseMessage> InviteForBillingAsync(HttpClient staff, string email)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName = "Billing",
            lastName = "Invitee",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
    }

    private static async Task RemoveCoachForBillingAsync(HttpClient owner, Guid coachUserId)
    {
        var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == coachUserId);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version }),
            HttpStatusCode.OK);
    }

    private static async Task AssertReadOnlyAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Forbidden);
        Assert.AreEqual("workspace_read_only", (await RequiredJsonAsync<BillingProblem>(response)).Code);
    }

    private static async Task AssertBillingConflictAsync(HttpResponseMessage response, string code)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        Assert.AreEqual(code, (await RequiredJsonAsync<BillingProblem>(response)).Code);
    }

    private sealed record BillingProblem(string Code, string Message);
    private sealed record BillingRun(DateOnly PeriodStart, int Issued, int AlreadyIssued, int InTrial);
    private sealed record BillingAmounts(
        int Seats,
        int BillableClients,
        int IncludedClients,
        int ExtraClients,
        decimal SeatAmount,
        decimal ExtraClientAmount,
        decimal GymFeeAmount,
        decimal Subtotal,
        decimal DiscountPercent,
        decimal DiscountAmount,
        decimal Total,
        string CurrencyCode);
    private sealed record BillingPayment(Guid Id, decimal Amount, string Reference, string? Note);
    private sealed record BillingInvoice(
        Guid Id,
        string ReferenceCode,
        DateOnly PeriodStart,
        DateOnly DueOn,
        DateOnly ReadOnlyFrom,
        int PricePlanVersion,
        decimal PlanSeatPrice,
        BillingAmounts Amounts,
        string Status,
        bool LocksWorkspace,
        BillingPayment? Payment,
        string? VoidReason,
        Guid? ReplacesInvoiceId,
        Guid? ReplacedByInvoiceId);
    private sealed record BillingEstimate(bool InTrial, int PricePlanVersion, BillingAmounts Amounts);
    private sealed record BillingView(string Status, BillingEstimate CurrentMonth, BillingInvoice[] Invoices, decimal UnpaidTotal);
    private sealed record BillingAccess(bool IsReadOnly, bool HasOverdueInvoice, DateOnly? ReadOnlyFrom);
    private sealed record BillingAdminWorkspace(Guid TenantId, string Status, int SeatsThisMonth, int BillableClientsThisMonth, decimal UnpaidTotal);
    private sealed record BillingDiscount(Guid Id, decimal Percent, DateTimeOffset? RevokedAtUtc);
    private sealed record BillingAdminDetail(BillingAdminWorkspace Summary, BillingInvoice[] Invoices, BillingDiscount[] Discounts);
    private sealed record BillingPlan(Guid Id, int VersionNumber, decimal SeatPrice, bool IsCurrent);
    private sealed record BillingVoid(BillingInvoice Voided, BillingInvoice? Reissued);
}
