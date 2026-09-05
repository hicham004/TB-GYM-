using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-1 durable dispatch, against real PostgreSQL.
/// </summary>
/// <remarks>
/// Every claim, lease, retry and race assertion here depends on behaviour SQLite and the in-memory
/// provider cannot reproduce: <c>FOR UPDATE SKIP LOCKED</c>, real transaction isolation, partial and
/// composite unique indexes, and check constraints. Time is moved by the injected clock, so the exact
/// retry schedule is asserted without a test ever waiting for it.
/// </remarks>
[TestClass]
public sealed partial class Phase6B1NotificationDispatchTests
{
    /// <summary>The three intents a priced assignment schedules, in no particular order.</summary>
    private static readonly string[] ScheduledKindsOnAssignment =
        ["PaymentRequired", "EnrollmentEndingSoon", "EnrollmentExpired"];

    /// <summary>
    /// Requirement 1: the Phase 2 scheduling contract is unchanged. Assignment still writes its
    /// intents in the same transaction as the enrollment, with unique deduplication keys, and an
    /// identical retried command produces no second set.
    /// </summary>
    [TestMethod]
    public async Task CommercialAssignmentStillSchedulesUniqueIntentsAtomically()
    {
        var workspace = await CreateWorkspaceAsync("atomic");
        var offerId = await CreateOfferAsync(workspace.Coach, 120m, 8, "8 weeks");
        var idempotencyKey = Guid.NewGuid();
        var enrollment = await AssignAsync(
            workspace.Coach,
            workspace.ClientProfileId,
            offerId,
            TenantToday(),
            idempotencyKey);

        var intents = await IntentsAsync(enrollment.Id);
        CollectionAssert.AreEquivalent(
            ScheduledKindsOnAssignment,
            intents.Select(intent => intent.Kind).ToArray());
        Assert.HasCount(
            intents.Count,
            intents.Select(intent => intent.DeduplicationKey).Distinct(StringComparer.Ordinal).ToArray(),
            "Deduplication keys must be unique per workspace.");
        Assert.IsTrue(intents.All(intent => intent.Status == "Scheduled"));
        // Every intent gets its channels in the same transaction. Email is off by default, so the plan
        // is in-app alone until somebody opts in.
        foreach (var intent in intents)
        {
            Assert.AreEqual(1L, await ChannelDeliveryCountAsync(intent.Id));
            Assert.AreEqual("Pending", await DeliveryStatusAsync(intent.Id));
        }

        // The same command with the same idempotency key resolves to the original enrollment, and
        // therefore to the original intents.
        var retried = await AssignAsync(
            workspace.Coach,
            workspace.ClientProfileId,
            offerId,
            TenantToday(),
            idempotencyKey);
        Assert.AreEqual(enrollment.Id, retried.Id);
        Assert.HasCount(3, await IntentsAsync(enrollment.Id));
    }

    /// <summary>
    /// Requirements 2 and 3: a due eligible intent produces exactly one notification and becomes
    /// Dispatched; the intents scheduled for later are not touched.
    /// </summary>
    [TestMethod]
    public async Task DueItemMaterializesExactlyOneNotificationAndLeavesFutureWorkAlone()
    {
        var workspace = await CreateWorkspaceAsync("due");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        var endingSoon = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.EnrollmentEndingSoon);

        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.Claimed);
        Assert.AreEqual(1, outcome.Materialized);
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
        var dispatched = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Materialized", dispatched.Status);
        Assert.AreEqual(1, dispatched.AttemptCount);
        Assert.IsNotNull(dispatched.MaterializedAtUtc);
        Assert.IsFalse(dispatched.HasClaim, "A terminal item must not keep a live claim.");

        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(1, attempts);
        Assert.AreEqual("Succeeded", attempts[0].Outcome);
        Assert.AreEqual(1, attempts[0].AttemptNumber);
        Assert.IsNull(attempts[0].FailureCode);
        // Reserved for a future adapter; the in-app channel has no provider to have returned one.
        Assert.IsNull(attempts[0].ProviderMessageId);

        // The ending-soon intent is weeks away and must be untouched.
        var future = await OutboxAsync(endingSoon);
        Assert.AreEqual("Pending", future.Status);
        Assert.AreEqual(0, future.AttemptCount);
        Assert.AreEqual(0L, await AttemptCountAsync(endingSoon));
        Assert.AreEqual(0L, await NotificationCountAsync(endingSoon));

        // A second sweep finds nothing to do and creates nothing.
        var repeat = await SweepAsync();
        Assert.AreEqual(0, repeat.Claimed);
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
    }

    /// <summary>Requirement 4: a cancelled intent is never dispatched, however often it is swept.</summary>
    [TestMethod]
    public async Task CancelledItemIsNeverDispatched()
    {
        var workspace = await CreateWorkspaceAsync("cancelled");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        await ChangeStatusAsync(
            workspace.Coach,
            enrollment,
            "cancel",
            new { reason = "The client changed their mind.", version = enrollment.Version });
        Assert.AreEqual("Suppressed", await OutboxStatusAsync(paymentRequired));

        var outcome = await SweepAsync();

        Assert.AreEqual(0, outcome.Claimed);
        Assert.AreEqual("Suppressed", await OutboxStatusAsync(paymentRequired));
        Assert.AreEqual(0L, await NotificationCountAsync(paymentRequired));
        Assert.AreEqual(0L, await AttemptCountAsync(paymentRequired));
    }

    /// <summary>
    /// Requirement 5: each common eligibility requirement, failed one at a time. Every one suppresses
    /// with its own stable code, writes no notification, and — because nothing was tried — costs no
    /// delivery attempt.
    /// </summary>
    [TestMethod]
    public async Task EachCommonEligibilityFailureSuppressesDeliveryWithItsOwnCode()
    {
        await AssertSuppressedAsync(
            "tenant-inactive",
            NotificationSuppressionCodes.TenantInactive,
            (_, workspace) => ExecuteAsync(
                """UPDATE tenancy."Tenants" SET "IsActive" = false WHERE "Id" = @id""",
                ("id", workspace.TenantId)));

        await AssertSuppressedAsync(
            "recipient-blocked",
            NotificationSuppressionCodes.RecipientBlocked,
            (_, workspace) => ExecuteAsync(
                """UPDATE identity."Users" SET "IsPlatformBlocked" = true WHERE "Id" = @id""",
                ("id", workspace.ClientUserId)));

        await AssertSuppressedAsync(
            "membership-inactive",
            NotificationSuppressionCodes.MembershipInactive,
            (_, workspace) => ExecuteAsync(
                """UPDATE tenancy."Memberships" SET "Status" = 'Removed' WHERE "UserId" = @id""",
                ("id", workspace.ClientUserId)));

        await AssertSuppressedAsync(
            "relationship-blocked",
            NotificationSuppressionCodes.RelationshipBlocked,
            (_, workspace) => BlockClientAsync(workspace.Coach, workspace.ClientProfileId));

        await AssertSuppressedAsync(
            "recipient-unlinked",
            NotificationSuppressionCodes.RecipientUnlinked,
            (_, workspace) => ExecuteAsync(
                """UPDATE clients."ClientProfiles" SET "UserId" = NULL WHERE "Id" = @id""",
                ("id", workspace.ClientProfileId)));

        await AssertSuppressedAsync(
            "enrollment-cancelled",
            NotificationSuppressionCodes.EnrollmentCancelled,
            async (enrollment, workspace) =>
            {
                await ChangeStatusAsync(
                    workspace.Coach,
                    enrollment,
                    "cancel",
                    new { reason = "Cancelled after the worker had already claimed the item.", version = enrollment.Version });
                // Reproduces the interleaving the dispatcher's own recheck exists for: a worker had
                // the item in flight when the coach cancelled, so the request's own cancellation
                // could not reach it and the recheck is what has to catch up.
                await WithoutNotificationGuardsAsync(
                    """
                    UPDATE notifications."ChannelDeliveries" d
                    SET "Status" = 'Pending', "FailureCode" = NULL, "CompletedAtUtc" = NULL
                    FROM notifications."OutboxItems" o
                    WHERE o."Id" = d."OutboxItemId"
                      AND o."AggregateId" = @id AND o."Kind" = 'PaymentRequired';
                    UPDATE notifications."OutboxItems"
                    SET "Status" = 'Scheduled', "CancelledAtUtc" = NULL
                    WHERE "AggregateId" = @id AND "Kind" = 'PaymentRequired';
                    """,
                    ("id", enrollment.Id));
            });
    }

    [TestMethod]
    public Task FullPaymentCommittedAfterClaimPreventsMaterialization() =>
        AssertPostClaimSuppressedAsync(
            "post-claim-payment",
            NotificationSuppressionCodes.IntentCancelled,
            (enrollment, workspace) => PayInFullAsync(workspace.Coach, enrollment, 120m));

    [TestMethod]
    public Task CancellationCommittedAfterClaimPreventsMaterialization() =>
        AssertPostClaimSuppressedAsync(
            "post-claim-cancellation",
            NotificationSuppressionCodes.IntentCancelled,
            (enrollment, workspace) => ChangeStatusAsync(
                workspace.Coach,
                enrollment,
                "cancel",
                new { reason = "Cancelled after the durable claim committed.", version = enrollment.Version }));

    [TestMethod]
    public Task MembershipRemovalCommittedAfterClaimPreventsMaterialization() =>
        AssertPostClaimSuppressedAsync(
            "post-claim-membership",
            NotificationSuppressionCodes.MembershipInactive,
            (_, workspace) => ExecuteAsync(
                """UPDATE tenancy."Memberships" SET "Status" = 'Removed' WHERE "TenantId" = @tenantId AND "UserId" = @userId""",
                ("tenantId", workspace.TenantId),
                ("userId", workspace.ClientUserId)));

    [TestMethod]
    public Task RelationshipBlockCommittedAfterClaimPreventsMaterialization() =>
        AssertPostClaimSuppressedAsync(
            "post-claim-block",
            NotificationSuppressionCodes.RelationshipBlocked,
            (_, workspace) => BlockClientAsync(workspace.Coach, workspace.ClientProfileId));

    /// <summary>
    /// Requirement 6, the affirmative half: each kind is dispatched when its own state still holds.
    /// </summary>
    [TestMethod]
    public async Task EveryNotificationKindDispatchesWhenItsOwnStateStillHolds()
    {
        var workspace = await CreateWorkspaceAsync("kinds");

        // PaymentRequired: PendingPayment, and the period has not ended.
        var unpaid = await AssignPaidLaterAsync(workspace, 120m, "Training");
        var paymentRequired = await IntentIdAsync(unpaid.Id, CommercialNotificationKind.PaymentRequired);
        await SweepAsync();
        Assert.AreEqual("Materialized", await OutboxStatusAsync(paymentRequired));

        // EnrollmentActivated: paying in full activates the enrollment and schedules the notice.
        await PayInFullAsync(workspace.Coach, unpaid, 120m);
        var activated = await IntentIdAsync(unpaid.Id, CommercialNotificationKind.EnrollmentActivated);
        await SweepAsync();
        Assert.AreEqual("Materialized", await OutboxStatusAsync(activated));

        // EnrollmentEndingSoon: still Active three days before the end.
        var endingSoon = await IntentIdAsync(unpaid.Id, CommercialNotificationKind.EnrollmentEndingSoon);
        var endingSoonDue = (await OutboxAsync(endingSoon)).ScheduledAtUtc;
        Clock.Set(endingSoonDue);
        await SweepAsync();
        Assert.AreEqual("Materialized", await OutboxStatusAsync(endingSoon));

        // EnrollmentExpired: the tenant's own today has reached the exclusive end date.
        var expired = await IntentIdAsync(unpaid.Id, CommercialNotificationKind.EnrollmentExpired);
        Clock.Set((await OutboxAsync(expired)).ScheduledAtUtc);
        await SweepAsync();
        Assert.AreEqual("Materialized", await OutboxStatusAsync(expired));

        // EnrollmentRenewed: a renewal exists and its own period has not ended.
        Clock.Set(StartInstant);
        var renewalOffer = await CreateOfferAsync(workspace.Coach, 90m, 6, "6 weeks", "Nutrition");
        var original = await AssignAsync(
            workspace.Coach,
            workspace.ClientProfileId,
            renewalOffer,
            TenantToday(),
            Guid.NewGuid());
        var renewal = await RenewAsync(
            workspace.Coach,
            original.Id,
            renewalOffer,
            original.EndDateExclusive);
        var renewed = await IntentIdAsync(renewal.Id, CommercialNotificationKind.EnrollmentRenewed);
        await SweepAsync();
        Assert.AreEqual("Materialized", await OutboxStatusAsync(renewed));

        var renewalNotification = await NotificationCountAsync(renewed);
        Assert.AreEqual(1L, renewalNotification);
    }

    /// <summary>
    /// Requirement 6, the negative half: when a kind's own state no longer holds, the item is
    /// suppressed rather than delivered. Each branch of the matrix is exercised on its own item.
    /// </summary>
    [TestMethod]
    public async Task EveryNotificationKindIsSuppressedWhenItsOwnStateNoLongerHolds()
    {
        var workspace = await CreateWorkspaceAsync("kinds-negative");

        // PaymentRequired after the money arrived: the enrollment is Active, so the notice is wrong.
        var paid = await AssignPaidLaterAsync(workspace, 120m, "Training");
        var paymentRequired = await IntentIdAsync(paid.Id, CommercialNotificationKind.PaymentRequired);
        await PayInFullAsync(workspace.Coach, paid, 120m);
        await RestoreToPendingAsync(paymentRequired);
        await SweepAsync();
        await AssertSuppressedWithAsync(paymentRequired, NotificationSuppressionCodes.StateChanged);

        // EnrollmentEndingSoon on an enrollment nobody ever paid for: it is still PendingPayment, so
        // there is no coaching access to warn about ending.
        var neverPaid = await AssignPaidLaterAsync(workspace, 200m, "Nutrition");
        var endingSoon = await IntentIdAsync(neverPaid.Id, CommercialNotificationKind.EnrollmentEndingSoon);
        Clock.Set((await OutboxAsync(endingSoon)).ScheduledAtUtc);
        await SweepAsync();
        await AssertSuppressedWithAsync(endingSoon, NotificationSuppressionCodes.StateChanged);

        // EnrollmentActivated after the period has ended: the notice would invite the client into
        // coaching that is already over. The item is paid for and never swept before the end date.
        Clock.Set(StartInstant);
        var lateActivation = await AssignPaidLaterAsync(workspace, 50m, "CheckIns");
        await PayInFullAsync(workspace.Coach, lateActivation, 50m);
        var activatedIntent = await IntentIdAsync(
            lateActivation.Id,
            CommercialNotificationKind.EnrollmentActivated);
        var expiryIntent = await IntentIdAsync(
            lateActivation.Id,
            CommercialNotificationKind.EnrollmentExpired);
        Clock.Set((await OutboxAsync(expiryIntent)).ScheduledAtUtc);
        await SweepAsync();
        await AssertSuppressedWithAsync(activatedIntent, NotificationSuppressionCodes.StateChanged);
        // The expiry notice for the same enrollment does hold at that instant, which is the other
        // side of the same boundary.
        Assert.AreEqual("Materialized", await OutboxStatusAsync(expiryIntent));

        // EnrollmentRenewed once the renewal's own period has ended.
        Clock.Set(StartInstant);
        var renewalOffer = await CreateOfferAsync(workspace.Coach, 40m, 4, "4 weeks", "Messaging");
        var original = await AssignAsync(
            workspace.Coach,
            workspace.ClientProfileId,
            renewalOffer,
            TenantToday());
        var renewal = await RenewAsync(
            workspace.Coach,
            original.Id,
            renewalOffer,
            original.EndDateExclusive);
        var renewedIntent = await IntentIdAsync(renewal.Id, CommercialNotificationKind.EnrollmentRenewed);
        var renewalExpiry = await IntentIdAsync(renewal.Id, CommercialNotificationKind.EnrollmentExpired);
        Clock.Set((await OutboxAsync(renewalExpiry)).ScheduledAtUtc);
        await SweepAsync();
        await AssertSuppressedWithAsync(renewedIntent, NotificationSuppressionCodes.StateChanged);
    }

    /// <summary>
    /// The eligibility recheck reads the workspace's <em>current</em> time zone, not the one stored on
    /// the row when the notification was scheduled.
    /// </summary>
    /// <remarks>
    /// The stored zone is scheduling provenance; what "today" means now is a question about the
    /// workspace now. A workspace that moves west far enough is not yet on its enrollment's end date
    /// at the instant the expiry notice comes due, so the notice is suppressed rather than sent a day
    /// early. Reading the stored zone instead would send it.
    /// </remarks>
    [TestMethod]
    public async Task EligibilityUsesTheWorkspaceCurrentTimeZoneRatherThanTheStoredOne()
    {
        var workspace = await CreateWorkspaceAsync("timezone");
        var enrollment = await AssignPaidLaterAsync(workspace, 60m);
        var expired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.EnrollmentExpired);
        var due = (await OutboxAsync(expired)).ScheduledAtUtc;

        // Scheduled from Asia/Beirut, but the workspace has since moved thirteen hours west.
        await SetWorkspaceTimeZoneAsync(workspace.Coach, "Pacific/Honolulu");
        Clock.Set(due);

        await SweepAsync();

        await AssertSuppressedWithAsync(expired, NotificationSuppressionCodes.StateChanged);
        Assert.AreEqual(
            "Asia/Beirut",
            await ScalarAsync<string>(
                """SELECT "TenantTimeZoneId" FROM notifications."OutboxItems" WHERE "Id" = @id""",
                ("id", expired)),
            "The stored zone is provenance and must not be rewritten.");
    }

    /// <summary>
    /// Requirement 7: a payload this build cannot read is a permanent dead letter, and nothing it
    /// contained reaches the outbox row, the attempt row or the log.
    /// </summary>
    [TestMethod]
    public async Task UnreadablePayloadBecomesARedactedPermanentDeadLetter()
    {
        const string Marker = "PAYLOAD-SECRET-MARKER-4471";
        var workspace = await CreateWorkspaceAsync("payload");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        // A schema version this build does not know, carrying something that must never escape.
        await WithoutIntentGuardAsync(
            """
            UPDATE notifications."OutboxItems"
            SET "PayloadJson" = @payload::jsonb
            WHERE "Id" = @id
            """,
            ("id", paymentRequired),
            ("payload", $$"""{"enrollmentId":"{{enrollment.Id}}","clientProfileId":"{{workspace.ClientProfileId}}","schemaVersion":99,"note":"{{Marker}}"}"""));

        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.DeadLettered);
        var row = await OutboxAsync(paymentRequired);
        Assert.AreEqual("DeadLettered", row.Status);
        Assert.AreEqual(NotificationFailureCodes.PayloadInvalid, row.FailureCode);
        Assert.IsNotNull(row.DeadLetteredAtUtc);
        Assert.IsFalse(row.HasClaim);
        Assert.AreEqual(0L, await NotificationCountAsync(paymentRequired));

        // The attempt exists as evidence and is permanently failed, not merely started.
        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(1, attempts);
        Assert.AreEqual("PermanentFailure", attempts[0].Outcome);
        Assert.AreEqual(NotificationFailureCodes.PayloadInvalid, attempts[0].FailureCode);

        AssertLogIsSafe(workspace, Marker);
    }

    [TestMethod]
    public async Task LegacyPhase2PayloadWithoutSchemaVersionStillDispatches()
    {
        var workspace = await CreateWorkspaceAsync("legacy-payload");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        // The intent is immutable once scheduled, so the fixture rewrites the payload with that guard
        // lifted rather than pretending the application could ever do this.
        await WithoutIntentGuardAsync(
            """
            UPDATE notifications."OutboxItems"
            SET "PayloadJson" = @payload::jsonb
            WHERE "Id" = @id
            """,
            ("id", paymentRequired),
            ("payload", $$"""{"enrollmentId":"{{enrollment.Id}}","clientProfileId":"{{workspace.ClientProfileId}}"}"""));

        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.Materialized);
        Assert.AreEqual("Materialized", await OutboxStatusAsync(paymentRequired));
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
        Assert.AreEqual("Succeeded", (await AttemptsAsync(paymentRequired)).Single().Outcome);
    }

    /// <summary>
    /// Requirement 7, second branch: an intent whose aggregates no longer line up is a permanent dead
    /// letter rather than a retry, because no amount of waiting will make them line up.
    /// </summary>
    [TestMethod]
    public async Task AggregateMismatchBecomesAPermanentDeadLetter()
    {
        var workspace = await CreateWorkspaceAsync("mismatch");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        // A client profile that does not exist in this workspace, or anywhere. Written with the
        // immutable-intent guard lifted, because only a fixture may rewrite a scheduled intent.
        await WithoutIntentGuardAsync(
            """
            UPDATE notifications."OutboxItems"
            SET "PayloadJson" = @payload::jsonb
            WHERE "Id" = @id
            """,
            ("id", paymentRequired),
            ("payload", $$"""{"enrollmentId":"{{enrollment.Id}}","clientProfileId":"{{Guid.CreateVersion7()}}","schemaVersion":1}"""));

        await SweepAsync();

        var row = await OutboxAsync(paymentRequired);
        Assert.AreEqual("DeadLettered", row.Status);
        Assert.AreEqual(NotificationFailureCodes.AggregateMismatch, row.FailureCode);
        Assert.AreEqual(0L, await NotificationCountAsync(paymentRequired));
    }

    /// <summary>
    /// Requirement 8: a transient failure follows <c>notification-exponential-v1</c> exactly, is
    /// invisible until its next attempt is due, and succeeds when the fault is removed.
    /// </summary>
    [TestMethod]
    public async Task TransientFailureFollowsTheRetryScheduleAndLaterSucceeds()
    {
        var workspace = await CreateWorkspaceAsync("retry");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        var scheduled = (await OutboxAsync(paymentRequired)).ScheduledAtUtc;

        Faults.FailMaterializationCommit = true;
        var first = await SweepAsync();
        Assert.AreEqual(1, first.Retried);

        var afterFirst = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Pending", afterFirst.Status);
        Assert.AreEqual(1, afterFirst.AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.DispatchTransient, afterFirst.FailureCode);
        Assert.IsFalse(afterFirst.HasClaim);
        Assert.AreEqual(Clock.UtcNow.AddMinutes(1), afterFirst.NextAttemptAtUtc);
        Assert.AreEqual(0L, await NotificationCountAsync(paymentRequired));

        // Invisible until it is due again: a sweep a second before must claim nothing.
        Clock.Set(afterFirst.NextAttemptAtUtc.AddSeconds(-1));
        Assert.AreEqual(0, (await SweepAsync()).Claimed);
        Assert.AreEqual(1, (await OutboxAsync(paymentRequired)).AttemptCount);

        // Attempt 2 fails, so the next wait is five minutes.
        Clock.Set(afterFirst.NextAttemptAtUtc);
        Assert.AreEqual(1, (await SweepAsync()).Retried);
        var afterSecond = await OutboxAsync(paymentRequired);
        Assert.AreEqual(2, afterSecond.AttemptCount);
        Assert.AreEqual(Clock.UtcNow.AddMinutes(5), afterSecond.NextAttemptAtUtc);

        // The fault clears and the third attempt lands.
        Faults.FailMaterializationCommit = false;
        Clock.Set(afterSecond.NextAttemptAtUtc);
        Assert.AreEqual(1, (await SweepAsync()).Materialized);

        var dispatched = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Materialized", dispatched.Status);
        Assert.AreEqual(3, dispatched.AttemptCount);
        Assert.IsNull(dispatched.FailureCode);
        // The scheduled instant is provenance and is never rewritten by a retry.
        Assert.AreEqual(scheduled, dispatched.ScheduledAtUtc);
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));

        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(3, attempts);
        Assert.AreEqual("TransientFailure", attempts[0].Outcome);
        Assert.AreEqual("TransientFailure", attempts[1].Outcome);
        Assert.AreEqual("Succeeded", attempts[2].Outcome);
        // The provider idempotency key is the same on every attempt: a retry has to be recognisable
        // as the same message, which is the entire purpose of the key.
        Assert.HasCount(1, attempts.Select(attempt => attempt.IdempotencyKey).Distinct(StringComparer.Ordinal).ToArray());
    }

    /// <summary>
    /// Requirement 9: the schedule ends in a dead letter rather than in another wait. The fixture
    /// shortens the maximum to three attempts, so the boundary is reached without a long test.
    /// </summary>
    [TestMethod]
    public async Task ReachingMaximumAttemptsDeadLettersTheItem()
    {
        var workspace = await CreateWorkspaceAsync("exhausted");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        Faults.FailMaterializationCommit = true;
        Assert.AreEqual(1, (await SweepAsync()).Retried);
        Clock.Set((await OutboxAsync(paymentRequired)).NextAttemptAtUtc);
        Assert.AreEqual(1, (await SweepAsync()).Retried);
        Clock.Set((await OutboxAsync(paymentRequired)).NextAttemptAtUtc);
        Assert.AreEqual(1, (await SweepAsync()).DeadLettered);

        var row = await OutboxAsync(paymentRequired);
        Assert.AreEqual("DeadLettered", row.Status);
        Assert.AreEqual(3, row.AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, row.FailureCode);
        Assert.IsNotNull(row.DeadLetteredAtUtc);
        Assert.IsFalse(row.HasClaim);
        Assert.AreEqual(0L, await NotificationCountAsync(paymentRequired));

        // A dead letter is terminal: later sweeps leave it alone rather than retrying forever.
        Clock.Advance(TimeSpan.FromDays(1));
        Assert.AreEqual(0, (await SweepAsync()).Claimed);
        Assert.HasCount(3, await AttemptsAsync(paymentRequired));
    }

    [TestMethod]
    public async Task AbandonedClaimsAtMaximumAttemptsNeverCreateAnotherAttempt()
    {
        var workspace = await CreateWorkspaceAsync("abandoned-maximum");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        Faults.CrashDuringMaterialization = true;
        for (var attempt = 1; attempt <= MaximumAttempts; attempt++)
        {
            await Assert.ThrowsExactlyAsync<OperationCanceledException>(() => SweepAsync());
            Assert.AreEqual(attempt, (await OutboxAsync(paymentRequired)).AttemptCount);
            Clock.Advance(TimeSpan.FromSeconds(ClaimLeaseSeconds));
        }

        // Reclaiming the third expired claim abandons attempt 3 and exhausts the item. There is no
        // materialization work left on which the armed crash can fire, and no attempt 4 is created.
        var exhausted = await SweepAsync();
        Assert.AreEqual(1, exhausted.Reclaimed);
        Assert.AreEqual(1, exhausted.DeadLettered);
        Assert.AreEqual(0, exhausted.Claimed);

        var row = await OutboxAsync(paymentRequired);
        Assert.AreEqual("DeadLettered", row.Status);
        Assert.AreEqual(MaximumAttempts, row.AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, row.FailureCode);
        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(MaximumAttempts, attempts);
        Assert.IsTrue(attempts.All(attempt => attempt.Outcome == "Abandoned"));
        Assert.AreEqual(MaximumAttempts, attempts.Max(attempt => attempt.AttemptNumber));
    }

    [TestMethod]
    public async Task ConfiguredMaximumAboveSixRepeatsTheSixHourCeilingUntilAttemptEight()
    {
        var workspace = await CreateWorkspaceAsync("maximum-above-six");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        TimeSpan[] expectedWaits =
        [
            TimeSpan.FromMinutes(1),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(15),
            TimeSpan.FromHours(1),
            TimeSpan.FromHours(6),
            TimeSpan.FromHours(6),
            TimeSpan.FromHours(6),
        ];

        Faults.FailMaterializationCommit = true;
        foreach (var expectedWait in expectedWaits)
        {
            var failedAt = Clock.UtcNow;
            Assert.AreEqual(1, (await SweepAsync()).Retried);
            var retrying = await OutboxAsync(paymentRequired);
            Assert.AreEqual(failedAt.Add(expectedWait), retrying.NextAttemptAtUtc);
            Clock.Set(retrying.NextAttemptAtUtc);
        }

        Assert.AreEqual(1, (await SweepAsync()).DeadLettered);
        var row = await OutboxAsync(paymentRequired);
        Assert.AreEqual("DeadLettered", row.Status);
        Assert.AreEqual(8, row.AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, row.FailureCode);
        Assert.HasCount(8, await AttemptsAsync(paymentRequired));
    }

    /// <summary>
    /// Requirements 10 and 11: a worker that dies mid-attempt leaves the item held, the lease expires,
    /// the next sweep reclaims it, and the interrupted attempt is marked Abandoned before its
    /// replacement is created. No item becomes permanently invisible.
    /// </summary>
    [TestMethod]
    public async Task AnExpiredLeaseIsReclaimedAndTheAbandonedAttemptIsRecordedFirst()
    {
        var workspace = await CreateWorkspaceAsync("lease");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        // A crash, not a failure: the sweep dies after committing its claim and before it can record
        // anything, which is exactly the state a killed process leaves behind.
        Faults.CrashDuringMaterialization = true;
        await Assert.ThrowsExactlyAsync<OperationCanceledException>(() => SweepAsync());
        Faults.CrashDuringMaterialization = false;

        var held = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Processing", held.Status);
        Assert.IsTrue(held.HasClaim);
        Assert.AreEqual(1, held.AttemptCount);
        Assert.AreEqual("Started", (await AttemptsAsync(paymentRequired))[0].Outcome);

        // While the lease holds, nobody may take it. That is the price of a lease, and it is bounded.
        Clock.Advance(TimeSpan.FromSeconds(ClaimLeaseSeconds - 1));
        Assert.AreEqual(0, (await SweepAsync()).Claimed);
        Assert.AreEqual("Processing", await OutboxStatusAsync(paymentRequired));

        // Once it expires the item becomes visible again and is delivered.
        Clock.Advance(TimeSpan.FromSeconds(1));
        var outcome = await SweepAsync();
        Assert.AreEqual(1, outcome.Reclaimed);
        Assert.AreEqual(1, outcome.Materialized);

        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(2, attempts);
        Assert.AreEqual(1, attempts[0].AttemptNumber);
        Assert.AreEqual("Abandoned", attempts[0].Outcome);
        Assert.AreEqual(NotificationFailureCodes.ClaimExpired, attempts[0].FailureCode);
        Assert.AreEqual(2, attempts[1].AttemptNumber);
        Assert.AreEqual("Succeeded", attempts[1].Outcome);

        var dispatched = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Materialized", dispatched.Status);
        Assert.IsFalse(dispatched.HasClaim);
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
    }

    [TestMethod]
    public async Task NewWorkerReclaimsAndCompletesBeforeTheOriginalStaleClaimantResumes()
    {
        var workspace = await CreateWorkspaceAsync("stale-claimant");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        CheckpointBarrier.Arm(paymentRequired);
        var original = SweepAsync();
        await CheckpointBarrier.ArrivedAsync().WaitAsync(TimeSpan.FromSeconds(30));
        Assert.AreEqual("Processing", await OutboxStatusAsync(paymentRequired));

        Clock.Advance(TimeSpan.FromSeconds(ClaimLeaseSeconds));
        var replacement = await SweepAsync().WaitAsync(TimeSpan.FromSeconds(30));
        Assert.AreEqual(1, replacement.Reclaimed);
        Assert.AreEqual(1, replacement.Materialized);

        CheckpointBarrier.Release();
        var stale = await original.WaitAsync(TimeSpan.FromSeconds(30));
        CheckpointBarrier.Disarm();

        Assert.AreEqual(1, stale.Claimed, "The original really did own the first committed claim.");
        Assert.AreEqual(0, stale.Materialized, "A stale claimant cannot finalize the newer result.");
        var settled = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Materialized", settled.Status);
        Assert.IsFalse(settled.HasClaim, "The replacement released its lease; the stale one owns nothing.");
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));

        // The original was held between its committed claim and its first eligibility recheck, so it
        // held a reservation and had started no attempt. A reservation costs no capacity — that is
        // exactly what lets a post-claim quiet-hours deferral release the lease for free — so the
        // replacement starts attempt 1 rather than inheriting an abandoned number. The abandoned-
        // attempt path is the sibling case above, where the crash happens after the attempt started.
        Assert.AreEqual(1, settled.AttemptCount, "An interrupted reservation spends no attempt.");
        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(1, attempts);
        Assert.AreEqual(1, attempts[0].AttemptNumber);
        Assert.AreEqual("Succeeded", attempts[0].Outcome, "The replacement's attempt, not the stale one's.");
    }

    /// <summary>
    /// Requirement 12, run three times: two dispatchers contending for one item produce exactly one
    /// notification, one successful terminal dispatch, no duplicate attempt number, and no failure.
    /// </summary>
    /// <remarks>
    /// The barrier makes the contention deterministic. The first sweep is held inside its claim
    /// transaction, after it has locked the row and started its attempt but before it commits; the
    /// second sweep then runs to completion against a genuinely locked row. Starting two sweeps and
    /// hoping the scheduler interleaves them would prove nothing.
    /// </remarks>
    [TestMethod]
    public async Task CompetingDispatchersOnOneItemProduceOneNotification()
    {
        var workspace = await CreateWorkspaceAsync("race");

        for (var round = 1; round <= 3; round++)
        {
            var client = await AddClientAsync(workspace, $"race-{round}");
            var offerId = await CreateOfferAsync(workspace.Coach, 120m, 8, $"round {round}");
            var enrollment = await AssignAsync(workspace.Coach, client, offerId, TenantToday());
            var paymentRequired = await IntentIdAsync(
                enrollment.Id,
                CommercialNotificationKind.PaymentRequired);

            Barrier.Arm("INSERT INTO notifications.\"DeliveryAttempts\"", 2);
            var first = SweepAsync();
            await Barrier.ArrivedAsync(1).WaitAsync(TimeSpan.FromSeconds(30));

            // The contender runs to completion while the first sweep holds the row lock.
            var second = await SweepAsync();
            Assert.AreEqual(0, second.Claimed, $"Round {round}: the locked item must be skipped, not taken.");
            Assert.AreEqual(0, second.Materialized);

            Barrier.Release();
            var firstOutcome = await first;
            Barrier.Disarm();

            Assert.AreEqual(1, Barrier.Arrived, $"Round {round}: the barrier matched nothing, so nothing raced.");
            Assert.AreEqual(1, firstOutcome.Materialized);
            Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
            Assert.AreEqual("Materialized", await OutboxStatusAsync(paymentRequired));
            var attempts = await AttemptsAsync(paymentRequired);
            Assert.HasCount(1, attempts);
            Assert.AreEqual(1, attempts[0].AttemptNumber);
            Assert.AreEqual("Succeeded", attempts[0].Outcome);
        }
    }

    /// <summary>
    /// Requirement 13: two dispatchers working on different items both make progress rather than one
    /// blocking behind the other. The barrier holds both inside their claim transactions at once, so
    /// the test cannot pass by the two sweeps simply running one after the other.
    /// </summary>
    [TestMethod]
    public async Task TwoDispatchersOnDifferentItemsBothMakeProgress()
    {
        var alpha = await CreateWorkspaceAsync("progress-alpha");
        var beta = await CreateWorkspaceAsync("progress-beta");
        var alphaIntent = await IntentIdAsync(
            (await AssignPaidLaterAsync(alpha, 120m)).Id,
            CommercialNotificationKind.PaymentRequired);
        var betaIntent = await IntentIdAsync(
            (await AssignPaidLaterAsync(beta, 120m)).Id,
            CommercialNotificationKind.PaymentRequired);

        Barrier.Arm("INSERT INTO notifications.\"DeliveryAttempts\"", 2);
        var first = SweepAsync();
        var second = SweepAsync();
        var outcomes = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(60));
        Barrier.Disarm();

        Assert.AreEqual(2, Barrier.Arrived, "Both sweeps must have reached the barrier at once.");
        Assert.AreEqual(2, outcomes.Sum(outcome => outcome.Materialized));
        Assert.IsTrue(
            outcomes.All(outcome => outcome.Materialized >= 1),
            "Each dispatcher must have delivered something rather than one doing all the work.");
        Assert.AreEqual("Materialized", await OutboxStatusAsync(alphaIntent));
        Assert.AreEqual("Materialized", await OutboxStatusAsync(betaIntent));
        Assert.AreEqual(1L, await NotificationCountAsync(alphaIntent));
        Assert.AreEqual(1L, await NotificationCountAsync(betaIntent));
    }

    /// <summary>
    /// Requirement 14: the batch cap is a total, not a per-workspace allowance. With a cap of two and
    /// six due items spread over three workspaces, one sweep does two of them.
    /// </summary>
    [TestMethod]
    public async Task BatchCapIsGlobalAcrossWorkspacesRatherThanPerWorkspace()
    {
        var intents = new List<Guid>();
        for (var index = 1; index <= 3; index++)
        {
            var workspace = await CreateWorkspaceAsync($"batchcap-{index}");
            foreach (var feature in new[] { "Training", "Nutrition" })
            {
                var enrollment = await AssignPaidLaterAsync(workspace, 100m, feature);
                intents.Add(await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired));
            }
        }

        Assert.HasCount(6, intents);

        var outcome = await SweepAsync();

        Assert.AreEqual(2, outcome.Claimed, "The cap is 2 in total, not 2 per workspace.");
        Assert.AreEqual(2, outcome.Materialized);
        var statuses = new List<string>();
        foreach (var intent in intents)
        {
            statuses.Add(await OutboxStatusAsync(intent));
        }

        Assert.AreEqual(2, statuses.Count(status => status == "Materialized"));
        Assert.AreEqual(4, statuses.Count(status => status == "Pending"));

        // Nothing is lost: the backlog drains over further sweeps.
        await SweepAsync();
        await SweepAsync();
        await SweepAsync();
        foreach (var intent in intents)
        {
            Assert.AreEqual("Materialized", await OutboxStatusAsync(intent));
        }
    }

    [TestMethod]
    public async Task WorkspaceBatchCapFairnessPreventsSustainedReplenishmentFromStarvingOlderWork()
    {
        var workspaces = new List<Workspace>();
        var originalIntents = new Dictionary<Guid, Guid>();
        for (var index = 1; index <= 5; index++)
        {
            var workspace = await CreateWorkspaceAsync($"fairness-{index}");
            workspaces.Add(workspace);
            var enrollment = await AssignPaidLaterAsync(workspace, 100m);
            originalIntents[workspace.TenantId] = await IntentIdAsync(
                enrollment.Id,
                CommercialNotificationKind.PaymentRequired);
        }

        var first = await SweepAsync();
        Assert.AreEqual(2, first.Claimed);
        var continuouslyBusy = new List<Workspace>();
        foreach (var workspace in workspaces)
        {
            if (await OutboxStatusAsync(originalIntents[workspace.TenantId]) == "Materialized")
            {
                continuouslyBusy.Add(workspace);
            }
        }

        Assert.HasCount(2, continuouslyBusy);
        for (var round = 1; round <= 3; round++)
        {
            Clock.Advance(TimeSpan.FromMinutes(1));
            foreach (var workspace in continuouslyBusy)
            {
                var clientProfileId = await AddClientAsync(workspace, $"fairness-replenish-{round}");
                var offerId = await CreateOfferAsync(workspace.Coach, 100m, 8, $"fairness {round}");
                await AssignAsync(workspace.Coach, clientProfileId, offerId, TenantToday());
            }

            var outcome = await SweepAsync();
            Assert.IsLessThanOrEqualTo(2, outcome.Claimed, "The global cap must hold on every round.");
        }

        foreach (var intent in originalIntents.Values)
        {
            Assert.AreEqual(
                "Materialized",
                await OutboxStatusAsync(intent),
                "A due workspace must progress even while the initially selected workspaces replenish.");
        }
    }

    [TestMethod]
    public async Task UnusedBatchCapacityIsRedistributedWithoutExceedingTheGlobalCap()
    {
        var sparse = await CreateWorkspaceAsync("redistribute-sparse");
        await AssignPaidLaterAsync(sparse, 100m);

        var busy = await CreateWorkspaceAsync("redistribute-busy");
        for (var index = 1; index <= 5; index++)
        {
            var clientProfileId = index == 1
                ? busy.ClientProfileId
                : await AddClientAsync(busy, $"redistribute-{index}");
            var offerId = await CreateOfferAsync(busy.Coach, 100m, 8, $"redistribute {index}");
            await AssignAsync(busy.Coach, clientProfileId, offerId, TenantToday());
        }

        var outcome = await SweepAsync();

        Assert.AreEqual(5, outcome.Claimed, "The sparse workspace's unused share must be reused.");
        Assert.AreEqual(5, outcome.Materialized);
        Assert.IsLessThanOrEqualTo(5, outcome.Claimed);
    }

    /// <summary>
    /// Requirement 21: the notification, the successful attempt and the completed outbox row commit
    /// together. The fault fails the commit itself, after all three statements have run inside the
    /// transaction, so anything that survives was not atomic.
    /// </summary>
    [TestMethod]
    public async Task MaterializationRollsBackAsOneUnitWhenItsCommitFails()
    {
        var workspace = await CreateWorkspaceAsync("atomic-rollback");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        Faults.FailMaterializationCommit = true;
        await SweepAsync();

        Assert.AreEqual(0L, await NotificationCountAsync(paymentRequired), "The notification must not survive.");
        var row = await OutboxAsync(paymentRequired);
        Assert.AreEqual("Pending", row.Status, "The outbox row must not have been completed.");
        Assert.IsNull(row.MaterializedAtUtc);
        var attempts = await AttemptsAsync(paymentRequired);
        Assert.HasCount(1, attempts);
        Assert.AreNotEqual("Succeeded", attempts[0].Outcome, "The attempt must not have been completed as a success.");
        Assert.AreEqual("TransientFailure", attempts[0].Outcome);

        // And the item is still owed, which is the point of rolling back rather than half-committing.
        Faults.FailMaterializationCommit = false;
        Clock.Set(row.NextAttemptAtUtc);
        Assert.AreEqual(1, (await SweepAsync()).Materialized);
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
    }

    /// <summary>
    /// Requirement 22: the Worker's own loop survives an unavailable database. A sweep that threw and
    /// ended the loop would leave every due notification stranded until somebody noticed.
    /// </summary>
    [TestMethod]
    public async Task WorkerRecoversAfterTheDatabaseIsUnavailable()
    {
        var workspace = await CreateWorkspaceAsync("outage");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        Faults.DatabaseUnavailable = true;
        var options = Options.Create(new NotificationDispatchOptions
        {
            Enabled = true,
            PollIntervalSeconds = 1,
            BatchSize = 25,
            ClaimLeaseSeconds = ClaimLeaseSeconds,
            MaximumAttempts = 6,
        });
        var worker = new TB.Gym.Worker.NotificationDispatchWorker(
            RequiredFactory.Services.GetRequiredService<IServiceScopeFactory>(),
            options,
            RequiredFactory.Services.GetRequiredService<ILogger<TB.Gym.Worker.NotificationDispatchWorker>>());

        using var stopping = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        await worker.StartAsync(stopping.Token);
        try
        {
            // Two refused connections prove the loop tried, failed and came back rather than ending.
            await WaitForAsync(
                () => Task.FromResult(Faults.RefusedConnections >= 2),
                "the worker to retry after a refused connection");
            Assert.AreEqual("Pending", await OutboxStatusAsync(paymentRequired));

            Faults.DatabaseUnavailable = false;
            await WaitForAsync(
                async () => await OutboxStatusAsync(paymentRequired) == "Materialized",
                "the worker to dispatch once the database returned");
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }

        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));
        Assert.Contains(
            "The notification sweep failed and will retry on the next tick.",
            Log.Text,
            "The outage must be reported as a retryable sweep failure.");
    }
}
