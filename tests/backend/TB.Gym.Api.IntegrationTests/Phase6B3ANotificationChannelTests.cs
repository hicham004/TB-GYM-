
using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-3A independent channel delivery, preferences, quiet hours and consent, against real
/// PostgreSQL.
/// </summary>
/// <remarks>
/// Everything asserted here depends on behaviour SQLite and the in-memory provider cannot reproduce:
/// <c>FOR UPDATE SKIP LOCKED</c>, real transaction isolation, deferred constraint triggers, composite
/// foreign keys and advisory locks. Time is moved by the injected clock, so quiet-hours boundaries and
/// retry schedules are asserted without a test ever waiting for one.
/// </remarks>
public sealed partial class Phase6B1NotificationDispatchTests
{
    /// <summary>Opt in, opt out, opt in again: three decisions, three append-only rows.</summary>
    private static readonly string[] ExpectedConsentSequence = ["Granted", "Withdrawn", "Granted"];

    /// <summary>
    /// The headline guarantee: two channels of one notification succeed and fail independently. The
    /// in-app row is written and stays written while the email retries, and neither can see, block or
    /// complete the other's state.
    /// </summary>
    [TestMethod]
    public async Task InAppCompletionAndEmailRetryAreIndependent()
    {
        var workspace = await CreateWorkspaceAsync("independent");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        Assert.AreEqual(2L, await ChannelDeliveryCountAsync(intent), "Opting in selects a second channel.");

        // The email transport fails while the in-app write is untouched.
        Faults.FailEmailTransport = true;
        var outcome = await SweepAsync();

        Assert.AreEqual(2, outcome.Claimed, "Both channels are claimed, separately.");
        Assert.AreEqual(1, outcome.Materialized);
        Assert.AreEqual(1, outcome.Retried);

        var inApp = await DeliveryAsync(intent);
        Assert.AreEqual("Materialized", inApp.Status);
        Assert.AreEqual(1, inApp.AttemptCount);
        Assert.IsNull(inApp.FailureCode);
        Assert.AreEqual(1L, await NotificationCountAsync(intent));

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Pending", email.Status, "Email failed and is waiting on its own schedule.");
        Assert.AreEqual(1, email.AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.EmailTransportTransient, email.FailureCode);
        Assert.AreEqual(inApp.ScheduledAtUtc.AddMinutes(1), email.NextAttemptAtUtc);
        Assert.IsEmpty(CapturedEmail.Captured);

        // The intent itself says nothing about either, which is the whole point of the split.
        Assert.AreEqual("Scheduled", await IntentStatusAsync(intent));

        // Email recovers on its own schedule and still cannot touch the inbox row.
        Faults.FailEmailTransport = false;
        Clock.Set(email.NextAttemptAtUtc);
        var recovery = await SweepAsync();

        Assert.AreEqual(1, recovery.Materialized);
        var recovered = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Materialized", recovered.Status);
        Assert.AreEqual(2, recovered.AttemptCount);
        Assert.AreEqual(NotificationEmailAdapters.CapturedAdapterName, recovered.TransportAdapter);
        Assert.HasCount(1, CapturedEmail.Captured);

        // One inbox row, still exactly one, and it did not move.
        Assert.AreEqual(1L, await NotificationCountAsync(intent));
        var afterEmail = await DeliveryAsync(intent);
        Assert.AreEqual(1, afterEmail.AttemptCount, "An email retry cannot spend an in-app attempt.");
        Assert.AreEqual(inApp.MaterializedAtUtc, afterEmail.MaterializedAtUtc);
    }

    /// <summary>
    /// Whatever happens to email, it never writes, rewrites or duplicates the inbox row. Six email
    /// attempts and a dead letter later, the inbox still has exactly one notification.
    /// </summary>
    [TestMethod]
    public async Task EmailCompletionCannotDuplicateTheInAppInboxRow()
    {
        var workspace = await CreateWorkspaceAsync("no-duplicate");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        Faults.FailEmailTransport = true;
        await SweepAsync();
        Assert.AreEqual(1L, await NotificationCountAsync(intent));

        // Drive the email channel through its whole schedule. The inbox is checked after every round.
        for (var attempt = 1; attempt < NotificationDispatchOptions.DefaultMaximumAttempts; attempt++)
        {
            Clock.Set((await DeliveryAsync(intent, NotificationChannel.Email)).NextAttemptAtUtc);
            await SweepAsync();
            Assert.AreEqual(
                1L,
                await NotificationCountAsync(intent),
                $"Email attempt {attempt + 1} changed the inbox.");
        }

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("DeadLettered", email.Status);
        Assert.AreEqual(NotificationDispatchOptions.DefaultMaximumAttempts, email.AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, email.FailureCode);

        // And the in-app channel is untouched by any of it.
        var inApp = await DeliveryAsync(intent);
        Assert.AreEqual("Materialized", inApp.Status);
        Assert.AreEqual(1, inApp.AttemptCount);
        Assert.AreEqual(1L, await NotificationCountAsync(intent));
        Assert.AreEqual(1L, await AttemptCountAsync(intent));
    }

    /// <summary>
    /// Each channel gets its own budget. Exhausting email's does not consume, shorten or share the
    /// in-app one, and vice versa.
    /// </summary>
    [TestMethod]
    public async Task MaximumAttemptsAreCountedPerChannelAndNeverShared()
    {
        // MaximumAttempts is 3 for tests whose name contains "MaximumAttempts".
        var workspace = await CreateWorkspaceAsync("per-channel-max");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        Faults.FailEmailTransport = true;
        await SweepAsync();
        for (var round = 0; round < 2; round++)
        {
            Clock.Set((await DeliveryAsync(intent, NotificationChannel.Email)).NextAttemptAtUtc);
            await SweepAsync();
        }

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("DeadLettered", email.Status);
        Assert.AreEqual(3, email.AttemptCount, "Exactly the configured maximum, never maximum plus one.");
        Assert.HasCount(3, await AttemptsAsync(intent, NotificationChannel.Email));

        var inApp = await DeliveryAsync(intent);
        Assert.AreEqual("Materialized", inApp.Status);
        Assert.AreEqual(1, inApp.AttemptCount, "In-app spent one attempt and owes nothing to email.");
        Assert.HasCount(1, await AttemptsAsync(intent));
    }

    /// <summary>
    /// Two workers sweeping the same backlog claim each channel delivery exactly once. Run three
    /// times, because a race that passes once has proved nothing.
    /// </summary>
    [TestMethod]
    public async Task DuplicateWorkersCannotMaterializeTheSameChannelDeliveryTwice()
    {
        for (var round = 1; round <= 3; round++)
        {
            var workspace = await CreateWorkspaceAsync($"race-{round}");
            await EnableServiceEmailAsync(workspace.Client);
            var enrollment = await AssignPaidLaterAsync(workspace, 120m);
            var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

            // The first sweep is held inside its claim transaction, holding the row locks, while a
            // second sweep runs to completion against the same backlog.
            Barrier.Arm("INSERT INTO notifications.\"DeliveryAttempts\"", 2);
            var first = SweepAsync();
            await Barrier.ArrivedAsync(1).WaitAsync(TimeSpan.FromSeconds(30));
            var second = await SweepAsync();
            Barrier.Release();
            var firstOutcome = await first.WaitAsync(TimeSpan.FromSeconds(60));
            Barrier.Disarm();

            // Two channels, so the winning sweep inserts two attempts: the first is held while the
            // contender runs, the second lands once the barrier is released. Asserting the exact count
            // keeps a renamed table or a changed statement shape from letting this pass without racing.
            Assert.AreEqual(
                2,
                Barrier.Arrived,
                $"Round {round}: the barrier must hold one attempt insert per channel.");
            Assert.AreEqual(0, second.Claimed, $"Round {round}: locked rows must be skipped, not taken.");
            Assert.AreEqual(2, firstOutcome.Claimed, $"Round {round}: both channels, claimed once each.");
            Assert.AreEqual(2, firstOutcome.Materialized);
            Assert.AreEqual(1L, await NotificationCountAsync(intent), $"Round {round}: one inbox row.");
            Assert.HasCount(1, await AttemptsAsync(intent), $"Round {round}: one in-app attempt.");
            Assert.HasCount(
                1,
                await AttemptsAsync(intent, NotificationChannel.Email),
                $"Round {round}: one email attempt.");
            Assert.HasCount(1, CapturedEmail.Captured, $"Round {round}: one captured email.");
            CapturedEmail.Clear();
        }
    }

    /// <summary>
    /// A member who turns email off after the delivery was scheduled but before it was claimed gets no
    /// email, and keeps their inbox notification.
    /// </summary>
    [TestMethod]
    public async Task OptingOutBeforeMaterializationSuppressesOnlyTheEmailChannel()
    {
        var workspace = await CreateWorkspaceAsync("opt-out-pre");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        Assert.AreEqual(2L, await ChannelDeliveryCountAsync(intent));

        await DisableServiceEmailAsync(workspace.Client);
        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.Materialized);
        Assert.AreEqual(1, outcome.Suppressed);
        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Suppressed", email.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EmailOptedOut, email.FailureCode);
        Assert.AreEqual(0, email.AttemptCount, "A pre-claim suppression costs no attempt.");
        Assert.IsEmpty(CapturedEmail.Captured);

        // The preference never removes the inbox notification.
        Assert.AreEqual("Materialized", await DeliveryStatusAsync(intent));
        Assert.AreEqual(1L, await NotificationCountAsync(intent));
    }

    /// <summary>
    /// The post-claim recheck. A worker holds a committed claim on the email delivery when the member
    /// opts out; nothing is captured, and the attempt it already started closes honestly.
    /// </summary>
    [TestMethod]
    public async Task OptingOutAfterTheClaimCommitsPreventsCapture()
    {
        var workspace = await CreateWorkspaceAsync("opt-out-post");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        CheckpointBarrier.Arm(intent);
        var sweep = SweepAsync();
        await CheckpointBarrier.ArrivedAsync().WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            // The barrier holds after the claim committed and before anything was materialized.
            Assert.AreEqual("Processing", await DeliveryStatusAsync(intent));
            await DisableServiceEmailAsync(workspace.Client);
        }
        finally
        {
            CheckpointBarrier.Release();
        }

        await sweep.WaitAsync(TimeSpan.FromSeconds(60));
        CheckpointBarrier.Disarm();

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Suppressed", email.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EmailOptedOut, email.FailureCode);
        Assert.AreEqual(1, email.AttemptCount, "The started attempt is real history and is kept.");
        var attempts = await AttemptsAsync(intent, NotificationChannel.Email);
        Assert.HasCount(1, attempts);
        Assert.AreEqual("Suppressed", attempts[0].Outcome);
        Assert.AreEqual(NotificationSuppressionCodes.EmailOptedOut, attempts[0].FailureCode);
        Assert.IsEmpty(CapturedEmail.Captured, "Nothing may be captured after an opt-out.");
    }

    /// <summary>
    /// Opting in is a decision about the future. Notifications scheduled before it keep the channels
    /// they were planned with, so nobody is mailed a month of history the day they turn email on.
    /// </summary>
    [TestMethod]
    public async Task OptingInDoesNotResurrectNotificationsScheduledBeforeIt()
    {
        var workspace = await CreateWorkspaceAsync("no-resurrect");
        var before = await AssignPaidLaterAsync(workspace, 120m);
        var beforeIntent = await IntentIdAsync(before.Id, CommercialNotificationKind.PaymentRequired);
        Assert.AreEqual(1L, await ChannelDeliveryCountAsync(beforeIntent));

        await EnableServiceEmailAsync(workspace.Client);

        Assert.AreEqual(
            1L,
            await ChannelDeliveryCountAsync(beforeIntent),
            "An earlier notification must not gain an email channel retroactively.");

        var after = await AssignPaidLaterAsync(workspace, 200m, "Nutrition");
        var afterIntent = await IntentIdAsync(after.Id, CommercialNotificationKind.PaymentRequired);
        Assert.AreEqual(2L, await ChannelDeliveryCountAsync(afterIntent));

        await SweepAsync();
        Assert.HasCount(1, CapturedEmail.Captured, "Only the notification planned with email is mailed.");
        Assert.AreEqual(afterIntent, CapturedEmail.Captured[0].OutboxItemId);
    }

    /// <summary>
    /// Quiet hours defer email without spending an attempt, without touching in-app, and without the
    /// worker polling the deferred row.
    /// </summary>
    [TestMethod]
    public async Task QuietHoursDeferEmailWithoutConsumingAnAttempt()
    {
        var workspace = await CreateWorkspaceAsync("quiet-hours");
        await EnableServiceEmailAsync(workspace.Client);
        // The fixture clock is 06:00 UTC, which is 09:00 in Beirut. A window covering it defers.
        await SetQuietHoursAsync(workspace.Client, "08:00", "17:00");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.Materialized, "In-app materialization is unaffected by quiet hours.");
        Assert.AreEqual(1, outcome.Deferred);
        Assert.AreEqual(1, outcome.Claimed, "Only in-app was claimed; a deferral is not a claim.");

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Pending", email.Status);
        Assert.AreEqual(0, email.AttemptCount, "A deferral costs no attempt.");
        Assert.AreEqual(1, email.DeferralCount);
        Assert.AreEqual(NotificationDeferralCodes.QuietHours, email.DeferralCode);
        Assert.IsEmpty(await AttemptsAsync(intent, NotificationChannel.Email));
        Assert.IsEmpty(CapturedEmail.Captured);

        // 17:00 Beirut is 14:00 UTC, and the deferred row is invisible to a sweep until then.
        Assert.AreEqual(new DateTimeOffset(2026, 8, 31, 14, 0, 0, TimeSpan.Zero), email.DeferredUntilUtc);
        Clock.Set(email.NextAttemptAtUtc.AddSeconds(-1));
        Assert.AreEqual(0, (await SweepAsync()).Total, "The worker must not poll a deferred delivery.");
        Assert.AreEqual(0, (await DeliveryAsync(intent, NotificationChannel.Email)).AttemptCount);

        // And at the boundary it becomes due and is captured.
        Clock.Set(email.NextAttemptAtUtc);
        Assert.AreEqual(1, (await SweepAsync()).Materialized);
        Assert.AreEqual("Materialized", await DeliveryStatusAsync(intent, NotificationChannel.Email));
        Assert.HasCount(1, CapturedEmail.Captured);
    }

    /// <summary>
    /// An overnight window is the ordinary case, and it is evaluated in the workspace's own zone
    /// rather than the server's.
    /// </summary>
    [TestMethod]
    public async Task AnOvernightQuietWindowIsEvaluatedInTheWorkspaceZone()
    {
        var workspace = await CreateWorkspaceAsync("quiet-overnight");
        await EnableServiceEmailAsync(workspace.Client);
        await SetQuietHoursAsync(workspace.Client, "22:00", "07:00");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        // 20:00 UTC is 23:00 in Beirut: inside the window, though a naive UTC reading would call it
        // early evening and send. The intent is left unswept until then, so both channels are due at
        // once and the difference between them is entirely the quiet-hours decision.
        Clock.Set(new DateTimeOffset(2026, 8, 31, 20, 0, 0, TimeSpan.Zero));
        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.Materialized, "In-app is never deferred by quiet hours.");
        Assert.AreEqual("Materialized", await DeliveryStatusAsync(intent));
        Assert.AreEqual(1, outcome.Deferred);
        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        // 07:00 Beirut the next morning is 04:00 UTC.
        Assert.AreEqual(new DateTimeOffset(2026, 9, 1, 4, 0, 0, TimeSpan.Zero), email.DeferredUntilUtc);
        Assert.AreEqual(0, email.AttemptCount);
    }

    /// <summary>
    /// A member setting quiet hours after a delivery was claimed still gets no email at that hour: the
    /// recheck runs immediately before materialization, and the deferral releases the claim.
    /// </summary>
    [TestMethod]
    public async Task QuietHoursSetAfterTheClaimStillDeferTheEmail()
    {
        var workspace = await CreateWorkspaceAsync("quiet-post-claim");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        CheckpointBarrier.Arm(intent);
        var sweep = SweepAsync();
        await CheckpointBarrier.ArrivedAsync().WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            await SetQuietHoursAsync(workspace.Client, "08:00", "17:00");
        }
        finally
        {
            CheckpointBarrier.Release();
        }

        await sweep.WaitAsync(TimeSpan.FromSeconds(60));
        CheckpointBarrier.Disarm();

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Pending", email.Status, "A deferral is not terminal; the notification is still wanted.");
        Assert.AreEqual(NotificationDeferralCodes.QuietHours, email.DeferralCode);
        Assert.AreEqual(new DateTimeOffset(2026, 8, 31, 14, 0, 0, TimeSpan.Zero), email.DeferredUntilUtc);
        Assert.IsFalse(email.HasClaim, "The deferral released the lease.");
        Assert.IsEmpty(CapturedEmail.Captured);
        // Quiet-hours deferral occurs before a durable attempt starts, even after claim reservation.
        var attempts = await AttemptsAsync(intent, NotificationChannel.Email);
        Assert.IsEmpty(attempts);
        Assert.AreEqual(0, email.AttemptCount);
    }

    /// <summary>
    /// A member removed from the workspace between scheduling and materialization is not emailed, and
    /// the address is never even resolved.
    /// </summary>
    [TestMethod]
    public async Task ARemovedMemberCannotBeEmailed()
    {
        var workspace = await CreateWorkspaceAsync("removed-member");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        await ExecuteAsync(
            """
            UPDATE tenancy."Memberships" SET "Status" = 'Suspended'
            WHERE "TenantId" = @tenantId AND "UserId" = @userId
            """,
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));

        var outcome = await SweepAsync();

        Assert.AreEqual(0, outcome.Materialized);
        Assert.AreEqual(2, outcome.Suppressed, "Both channels stop for a member who is no longer here.");
        Assert.AreEqual(
            NotificationSuppressionCodes.MembershipInactive,
            (await DeliveryAsync(intent, NotificationChannel.Email)).FailureCode);
        Assert.IsEmpty(CapturedEmail.Captured);
        Assert.AreEqual(0L, await NotificationCountAsync(intent));
    }

    /// <summary>
    /// The address, the subject and the body exist only inside the captured adapter's memory. No
    /// notification column and no log line carries any of them.
    /// </summary>
    [TestMethod]
    public async Task NoRecipientOrRenderedContentReachesPostgreSqlOrTheLog()
    {
        var workspace = await CreateWorkspaceAsync("no-leak");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        await SweepAsync();

        var captured = CapturedEmail.Captured.Single();
        Assert.Contains("@tbgym.test", captured.RecipientAddress);
        Assert.AreEqual(NotificationTemplateCatalog.ServiceEmailV1.Title, captured.Subject);

        // Every column of every notification table, dumped and searched.
        var dumped = await DumpNotificationTablesAsync();
        foreach (var forbidden in new[]
                 {
                     captured.RecipientAddress,
                     captured.Subject,
                     NotificationTemplateCatalog.ServiceEmailV1.Body,
                     workspace.Suffix,
                     "@tbgym.test",
                 })
        {
            Assert.DoesNotContain(
                forbidden,
                dumped,
                StringComparison.OrdinalIgnoreCase,
                $"'{forbidden}' was written to a notification table.");
        }

        AssertLogIsSafe(
            workspace,
            captured.RecipientAddress,
            captured.Subject,
            NotificationTemplateCatalog.ServiceEmailV1.Body);

        // The captured adapter reports capture, never provider acceptance, so both stay null.
        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Materialized", email.Status);
        Assert.AreEqual(NotificationEmailAdapters.CapturedAdapterName, email.TransportAdapter);
        Assert.IsNull(email.ProviderMessageId);
        Assert.IsNull(email.ProviderAcceptedAtUtc);
        Assert.IsNull(
            (await AttemptsAsync(intent, NotificationChannel.Email)).Single().ProviderMessageId);
    }

    // ---------- preferences API ----------

    /// <summary>
    /// A member reads and writes only their own settings, under optimistic concurrency, with in-app
    /// stated rather than implied and the workspace's own zone reported alongside the local times.
    /// </summary>
    [TestMethod]
    public async Task AMemberReadsAndUpdatesTheirOwnPreferences()
    {
        var workspace = await CreateWorkspaceAsync("prefs-own");

        var initial = await PreferencesAsync(workspace.Client);
        Assert.IsTrue(initial.InAppEnabled, "In-app is always on and the screen must be able to say so.");
        Assert.IsFalse(initial.EmailServiceEnabled, "Email is opt-in; silence is not consent.");
        Assert.IsFalse(initial.EmailMarketingEnabled);
        Assert.IsTrue(initial.EmailChannelAvailable);
        Assert.IsFalse(initial.QuietHoursEnabled);
        Assert.AreEqual("Asia/Beirut", initial.TenantTimeZoneId);
        Assert.AreEqual(NotificationPreferencePolicy.CurrentVersion, initial.PolicyVersion);
        Assert.AreEqual(0u, initial.Version, "A member who has never decided anything has no row yet.");

        var saved = await EnableServiceEmailAsync(workspace.Client);
        Assert.IsTrue(saved.EmailServiceEnabled);
        Assert.AreNotEqual(0u, saved.Version);

        var withQuietHours = await SetQuietHoursAsync(workspace.Client, "22:00", "07:00");
        Assert.IsTrue(withQuietHours.QuietHoursEnabled);
        Assert.AreEqual("22:00", withQuietHours.QuietHoursStartLocal);
        Assert.AreEqual("07:00", withQuietHours.QuietHoursEndLocal);
        Assert.IsTrue(withQuietHours.EmailServiceEnabled, "Setting quiet hours is not an opt-out.");

        var reread = await PreferencesAsync(workspace.Client);
        Assert.AreEqual(withQuietHours.Version, reread.Version);
    }

    /// <summary>
    /// Every email decision appends evidence that is never rewritten, and the mutable row agrees with
    /// it. A withdrawal appends a withdrawal; it does not erase the grant.
    /// </summary>
    [TestMethod]
    public async Task EveryEmailDecisionAppendsConsentEvidenceThatIsNeverRewritten()
    {
        var workspace = await CreateWorkspaceAsync("consent");

        await EnableServiceEmailAsync(workspace.Client);
        await DisableServiceEmailAsync(workspace.Client);
        await EnableServiceEmailAsync(workspace.Client);

        var evidence = await ConsentEvidenceAsync(workspace.ClientUserId);
        Assert.HasCount(3, evidence);
        CollectionAssert.AreEqual(
            ExpectedConsentSequence,
            evidence.Select(row => row.Decision).ToArray());
        foreach (var row in evidence)
        {
            Assert.AreEqual("Email", row.Channel);
            Assert.AreEqual("ServiceTransactional", row.Purpose);
            Assert.AreEqual(NotificationPreferencePolicy.OwnSettingsSource, row.Source);
            Assert.AreEqual(NotificationPreferencePolicy.CurrentVersion, row.PolicyVersion);
            Assert.AreEqual(workspace.ClientUserId, row.ActorUserId, "Nobody consents on somebody else's behalf.");
        }

        // A save that changes nothing appends nothing: the history is decisions, not button presses.
        await EnableServiceEmailAsync(workspace.Client);
        Assert.HasCount(3, await ConsentEvidenceAsync(workspace.ClientUserId));

        // And the append-only guarantee is the database's, not just the application's.
        var conflict = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """UPDATE notifications."ConsentEvents" SET "Decision" = 'Withdrawn' WHERE "UserId" = @id""",
            ("id", workspace.ClientUserId)));
        Assert.Contains("append-only", conflict.MessageText);
    }

    /// <summary>
    /// The idempotency contract: an identical retry replays, concurrent identical retries converge on
    /// one decision, and a reused key with a changed payload conflicts and writes nothing. Run three
    /// times, because a race that passes once has proved nothing.
    /// </summary>
    [TestMethod]
    public async Task PreferenceCommandsAreIdempotentUnderRealRaces()
    {
        for (var round = 1; round <= 3; round++)
        {
            var workspace = await CreateWorkspaceAsync($"prefs-idem-{round}");
            var current = await PreferencesAsync(workspace.Client);
            var key = Guid.NewGuid();
            object body = new
            {
                emailServiceEnabled = true,
                quietHoursEnabled = false,
                quietHoursStartLocal = (string?)null,
                quietHoursEndLocal = (string?)null,
                idempotencyKey = key,
                version = current.Version,
            };

            // Two concurrent identical requests meet at the advisory lock on the key.
            Barrier.Arm("notification-preference-idempotency", 2);
            var second = CreateClient();
            await SignInAsync(second, $"client-prefs-idem-{round}-{workspace.Suffix}@tbgym.test");
            SetTenant(second, workspace.TenantId);
            var firstCall = SavePreferencesAsync(workspace.Client, body);
            var secondCall = SavePreferencesAsync(second, body);
            var responses = await Task.WhenAll(firstCall, secondCall).WaitAsync(TimeSpan.FromSeconds(60));
            Barrier.Disarm();

            Assert.AreEqual(2, Barrier.Arrived, $"Round {round}: the barrier matched nothing, so nothing raced.");
            var firstResults = new List<PreferenceView>();
            foreach (var response in responses)
            {
                await AssertStatusAsync(response, HttpStatusCode.OK);
                firstResults.Add(await RequiredJsonAsync<PreferenceView>(response));
            }

            Assert.AreEqual(firstResults[0], firstResults[1], "Concurrent retries replay the same exact response.");
            var originalResult = firstResults[0];
            Assert.IsTrue(originalResult.EmailServiceEnabled);

            // One decision, one evidence row, one spent key.
            Assert.HasCount(1, await ConsentEvidenceAsync(workspace.ClientUserId));
            Assert.AreEqual(1L, await ScalarAsync<long>(
                """SELECT count(*) FROM notifications."PreferenceCommandRecords" WHERE "IdempotencyKey" = @id""",
                ("id", key)));

            // A sequential identical retry replays the settled result rather than deciding again.
            var immediateReplay = await SavePreferencesAsync(workspace.Client, body);
            await AssertStatusAsync(immediateReplay, HttpStatusCode.OK);
            Assert.AreEqual(originalResult, await RequiredJsonAsync<PreferenceView>(immediateReplay));
            Assert.HasCount(1, await ConsentEvidenceAsync(workspace.ClientUserId));

            // A spent command replays its own historical response, not whatever the mutable settings
            // happen to contain later.
            var changedLater = await SavePreferencesAsync(workspace.Client, new
            {
                emailServiceEnabled = false,
                quietHoursEnabled = true,
                quietHoursStartLocal = "22:00",
                quietHoursEndLocal = "07:00",
                idempotencyKey = Guid.NewGuid(),
                version = (await PreferencesAsync(workspace.Client)).Version,
            });
            await AssertStatusAsync(changedLater, HttpStatusCode.OK);
            Assert.IsFalse((await RequiredJsonAsync<PreferenceView>(changedLater)).EmailServiceEnabled);

            var historicalReplay = await SavePreferencesAsync(workspace.Client, body);
            await AssertStatusAsync(historicalReplay, HttpStatusCode.OK);
            Assert.AreEqual(originalResult, await RequiredJsonAsync<PreferenceView>(historicalReplay));
            var currentAfterReplay = await PreferencesAsync(workspace.Client);
            Assert.IsFalse(currentAfterReplay.EmailServiceEnabled, "Replaying history must not restore old state.");
            Assert.IsTrue(currentAfterReplay.QuietHoursEnabled);

            // The same key with different content conflicts, and changes nothing.
            var changed = await SavePreferencesAsync(workspace.Client, new
            {
                emailServiceEnabled = false,
                quietHoursEnabled = false,
                quietHoursStartLocal = (string?)null,
                quietHoursEndLocal = (string?)null,
                idempotencyKey = key,
                version = (await PreferencesAsync(workspace.Client)).Version,
            });
            await AssertStatusAsync(changed, HttpStatusCode.Conflict);
            Assert.IsFalse((await PreferencesAsync(workspace.Client)).EmailServiceEnabled);
            Assert.HasCount(2, await ConsentEvidenceAsync(workspace.ClientUserId));
            second.Dispose();
        }
    }

    /// <summary>
    /// Optimistic concurrency: a caller working from a version somebody else has already replaced is
    /// told so rather than silently overwriting them.
    /// </summary>
    [TestMethod]
    public async Task AStaleVersionConflictsRatherThanOverwriting()
    {
        var workspace = await CreateWorkspaceAsync("prefs-concurrency");
        var initial = await PreferencesAsync(workspace.Client);
        await EnableServiceEmailAsync(workspace.Client);

        var stale = await SavePreferencesAsync(workspace.Client, new
        {
            emailServiceEnabled = false,
            quietHoursEnabled = true,
            quietHoursStartLocal = "22:00",
            quietHoursEndLocal = "07:00",
            idempotencyKey = Guid.NewGuid(),
            version = initial.Version,
        });

        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        var current = await PreferencesAsync(workspace.Client);
        Assert.IsTrue(current.EmailServiceEnabled, "The stale write must not have landed.");
        Assert.IsFalse(current.QuietHoursEnabled);
    }

    /// <summary>
    /// Server-side validation of the local times and their combination, with sanitized messages that
    /// name a field and a rule and nothing else.
    /// </summary>
    [TestMethod]
    public async Task InvalidQuietHoursAreRefusedWithSanitizedMessages()
    {
        var workspace = await CreateWorkspaceAsync("prefs-validation");
        var current = await PreferencesAsync(workspace.Client);

        foreach (var (start, end) in new[]
                 {
                     ("22:00", "22:00"),
                     ("9", "17:00"),
                     ("22:00", "07:00:00"),
                     ("10:00 PM", "07:00"),
                     ("25:00", "07:00"),
                     (null, "07:00"),
                     ("22:00", null),
                 })
        {
            var response = await SavePreferencesAsync(workspace.Client, new
            {
                emailServiceEnabled = false,
                quietHoursEnabled = true,
                quietHoursStartLocal = start,
                quietHoursEndLocal = end,
                idempotencyKey = Guid.NewGuid(),
                version = current.Version,
            });

            await AssertStatusAsync(response, HttpStatusCode.BadRequest);
            var body = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("@tbgym.test", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(workspace.Suffix, body, StringComparison.OrdinalIgnoreCase);
        }

        Assert.IsFalse((await PreferencesAsync(workspace.Client)).QuietHoursEnabled);
    }

    /// <summary>
    /// Preferences are user-owned and tenant-scoped. A coach cannot opt a client into email, another
    /// workspace's member cannot reach these settings, and an unauthenticated caller gets nothing.
    /// </summary>
    [TestMethod]
    public async Task PreferencesAreUserOwnedAndTenantScoped()
    {
        var alpha = await CreateWorkspaceAsync("prefs-alpha");
        var beta = await CreateWorkspaceAsync("prefs-beta");
        await EnableServiceEmailAsync(alpha.Client);

        // The coach's own settings are their own, and saving them cannot touch the client's.
        var coachPreferences = await PreferencesAsync(alpha.Coach);
        Assert.IsFalse(coachPreferences.EmailServiceEnabled);
        await EnableServiceEmailAsync(alpha.Coach);
        Assert.IsTrue((await PreferencesAsync(alpha.Client)).EmailServiceEnabled);
        Assert.AreEqual(
            2L,
            await ScalarAsync<long>(
                """SELECT count(*) FROM notifications."ChannelPreferences" WHERE "TenantId" = @id""",
                ("id", alpha.TenantId)),
            "Two members, two rows; neither wrote the other's.");

        // There is no route that names a subject, so the surface itself cannot be misused.
        await AssertStatusAsync(
            await alpha.Coach.GetAsync($"/api/notifications/preferences/{alpha.ClientUserId}"),
            HttpStatusCode.NotFound);

        // Naming another workspace in the header is refused: membership is verified server-side.
        SetTenant(beta.Client, alpha.TenantId);
        await AssertStatusAsync(
            await beta.Client.GetAsync("/api/notifications/preferences"),
            HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(beta.Client);
        await AssertStatusAsync(
            await beta.Client.PutAsJsonAsync("/api/notifications/preferences", new
            {
                emailServiceEnabled = false,
                quietHoursEnabled = false,
                quietHoursStartLocal = (string?)null,
                quietHoursEndLocal = (string?)null,
                idempotencyKey = Guid.NewGuid(),
                version = 0u,
            }),
            HttpStatusCode.Forbidden);
        Assert.IsTrue((await PreferencesAsync(alpha.Client)).EmailServiceEnabled, "Nothing was changed.");

        // The same person in two workspaces keeps two independent settings rows. This is the case
        // that only the tenant query filter defends: the read matches on the user alone, so a
        // preference lookup that forgot its workspace would answer with the wrong one here and
        // nowhere else in this test.
        var dual = await InviteAndAcceptAsync(
            beta.Coach,
            alpha.Client,
            $"client-prefs-alpha-{alpha.Suffix}@tbgym.test",
            newAccount: false);
        Assert.AreNotEqual(alpha.TenantId, dual.TenantId, "The second acceptance is a second workspace.");

        SetTenant(alpha.Client, beta.TenantId);
        var inBeta = await PreferencesAsync(alpha.Client);
        Assert.IsFalse(
            inBeta.EmailServiceEnabled,
            "Email consent given in one workspace must not follow the member into another.");
        Assert.IsFalse(inBeta.QuietHoursEnabled);

        // Changing it there must not reach back into the first workspace's row.
        await EnableServiceEmailAsync(alpha.Client);
        SetTenant(alpha.Client, alpha.TenantId);
        Assert.IsTrue((await PreferencesAsync(alpha.Client)).EmailServiceEnabled);
        Assert.AreEqual(
            2L,
            await ScalarAsync<long>(
                """SELECT count(*) FROM notifications."ChannelPreferences" WHERE "UserId" = @id""",
                ("id", alpha.ClientUserId)),
            "One row per workspace for the same person, never one shared row.");

        // Anonymous callers get nothing at all.
        var anonymous = CreateClient();
        SetTenant(anonymous, alpha.TenantId);
        await AssertStatusAsync(
            await anonymous.GetAsync("/api/notifications/preferences"),
            HttpStatusCode.Unauthorized);
        anonymous.Dispose();
    }

    /// <summary>A state change without an antiforgery token is refused and writes nothing.</summary>
    [TestMethod]
    public async Task SavingPreferencesRequiresAntiforgery()
    {
        var workspace = await CreateWorkspaceAsync("prefs-csrf");
        workspace.Client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");

        var response = await workspace.Client.PutAsJsonAsync("/api/notifications/preferences", new
        {
            emailServiceEnabled = true,
            quietHoursEnabled = false,
            quietHoursStartLocal = (string?)null,
            quietHoursEndLocal = (string?)null,
            idempotencyKey = Guid.NewGuid(),
            version = 0u,
        });

        // The status is deliberately not pinned: this repository's endpoints all call
        // ValidateRequestAsync directly and its AntiforgeryValidationException reaches the generic
        // handler, so a missing token is reported as 500 rather than 400. That is pre-existing across
        // every write endpoint and is recorded rather than changed here.
        Assert.IsFalse(response.IsSuccessStatusCode, "A write without an antiforgery token must be refused.");
        Assert.IsFalse((await PreferencesAsync(workspace.Client)).EmailServiceEnabled);
    }

    // ---------- database protections, by direct SQL ----------

    /// <summary>
    /// The critical invariants are the database's, not the application's. Each of these is a write the
    /// domain would never make, issued directly, and each must be refused.
    /// </summary>
    [TestMethod]
    public async Task DirectSqlCannotViolateTheCriticalDeliveryInvariants()
    {
        var workspace = await CreateWorkspaceAsync("db-guards");
        await EnableServiceEmailAsync(workspace.Client);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        var deliveryId = await ScalarGuidAsync(
            """
            SELECT "Id" FROM notifications."ChannelDeliveries"
            WHERE "OutboxItemId" = @id AND "Channel" = 'InApp'
            """,
            ("id", intent));

        // The outbox is the immutable logical fact; only its scheduled -> cancelled lifecycle moves.
        await AssertRefusedAsync(
            """UPDATE notifications."OutboxItems" SET "PayloadJson" = '{"schemaVersion":1}'::jsonb WHERE "Id" = @id""",
            "immutable logical notification",
            ("id", intent));

        // A second delivery for the same intent and channel.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ChannelDeliveries"
                ("Id","TenantId","OutboxItemId","Channel","Purpose","SelectionReason",
                 "SelectionPolicyVersion","Status","AttemptCount","DueAtUtc","NextAttemptAtUtc",
                 "DeferralCount","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @intent, 'InApp', 'ServiceTransactional', 'x', 1,
                    'Pending', 0, now(), now(), 0, now(), now())
            """,
            "duplicate channel delivery",
            ("tenantId", workspace.TenantId),
            ("intent", intent));

        // A delivery pointing at another workspace's intent.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ChannelDeliveries"
                ("Id","TenantId","OutboxItemId","Channel","Purpose","SelectionReason",
                 "SelectionPolicyVersion","Status","AttemptCount","DueAtUtc","NextAttemptAtUtc",
                 "DeferralCount","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), gen_random_uuid(), @intent, 'Email', 'ServiceTransactional', 'x', 1,
                    'Pending', 0, now(), now(), 0, now(), now())
            """,
            "cross-tenant delivery",
            ("intent", intent));

        // A delivery cannot relabel a service intent as marketing even when tenant and intent match.
        var purposeWorkspace = await CreateWorkspaceAsync("db-purpose");
        var purposeEnrollment = await AssignPaidLaterAsync(purposeWorkspace, 120m);
        var purposeIntent = await IntentIdAsync(
            purposeEnrollment.Id,
            CommercialNotificationKind.PaymentRequired);
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ChannelDeliveries"
                ("Id","TenantId","OutboxItemId","Channel","Purpose","SelectionReason",
                 "SelectionPolicyVersion","Status","AttemptCount","DueAtUtc","NextAttemptAtUtc",
                 "DeferralCount","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @intent, 'Email', 'Marketing', 'x', 1,
                    'Pending', 0, now(), now(), 0, now(), now())
            """,
            "delivery purpose disagreement",
            ("tenantId", purposeWorkspace.TenantId),
            ("intent", purposeIntent));

        // A claim on a row that is not Processing.
        await AssertRefusedAsync(
            """
            UPDATE notifications."ChannelDeliveries"
            SET "ClaimToken" = gen_random_uuid(), "ClaimExpiresAtUtc" = now()
            WHERE "Id" = @id
            """,
            "impossible claim",
            ("id", deliveryId));

        // Provider evidence for an adapter that never contacted a provider.
        await AssertRefusedAsync(
            """UPDATE notifications."ChannelDeliveries" SET "ProviderMessageId" = 'p-1' WHERE "Id" = @id""",
            "provider message id",
            ("id", deliveryId));
        await AssertRefusedAsync(
            """UPDATE notifications."ChannelDeliveries" SET "ProviderAcceptedAtUtc" = now() WHERE "Id" = @id""",
            "provider acceptance",
            ("id", deliveryId));

        // An attempt whose channel disagrees with its delivery, and a cross-tenant attempt.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."DeliveryAttempts"
                ("Id","TenantId","ChannelDeliveryId","Channel","AttemptNumber","ClaimToken",
                 "IdempotencyKey","StartedAtUtc","Outcome","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @delivery, 'Email', 9, gen_random_uuid(), 'k', now(),
                    'Started', now(), now())
            """,
            "attempt channel disagreement",
            ("tenantId", workspace.TenantId),
            ("delivery", deliveryId));
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."DeliveryAttempts"
                ("Id","TenantId","ChannelDeliveryId","Channel","AttemptNumber","ClaimToken",
                 "IdempotencyKey","StartedAtUtc","Outcome","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), gen_random_uuid(), @delivery, 'InApp', 9, gen_random_uuid(), 'k', now(),
                    'Started', now(), now())
            """,
            "cross-tenant attempt",
            ("delivery", deliveryId));

        // An attempt inserted already completed, which would be history nobody ever tried to make.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."DeliveryAttempts"
                ("Id","TenantId","ChannelDeliveryId","Channel","AttemptNumber","ClaimToken",
                 "IdempotencyKey","StartedAtUtc","CompletedAtUtc","Outcome","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @delivery, 'InApp', 9, gen_random_uuid(), 'k', now(), now(),
                    'Succeeded', now(), now())
            """,
            "attempt born completed",
            ("tenantId", workspace.TenantId),
            ("delivery", deliveryId));

        // An attempt count that disagrees with the attempts that actually exist.
        await AssertRefusedAsync(
            """UPDATE notifications."ChannelDeliveries" SET "AttemptCount" = 1 WHERE "Id" = @id""",
            "attempt count without an attempt",
            ("id", deliveryId));

        // A lease reservation is not an attempt and therefore cannot be finalized as if work ran.
        var reservedWorkspace = await CreateWorkspaceAsync("db-reservation");
        var reservedEnrollment = await AssignPaidLaterAsync(reservedWorkspace, 120m);
        var reservedIntent = await IntentIdAsync(
            reservedEnrollment.Id,
            CommercialNotificationKind.PaymentRequired);
        var reservedDelivery = await ScalarGuidAsync(
            """
            SELECT "Id" FROM notifications."ChannelDeliveries"
            WHERE "OutboxItemId" = @id AND "Channel" = 'InApp'
            """,
            ("id", reservedIntent));
        await ExecuteAsync(
            """
            UPDATE notifications."ChannelDeliveries"
            SET "Status" = 'Processing', "ClaimToken" = @claim,
                "ClaimExpiresAtUtc" = now() + interval '10 minutes'
            WHERE "Id" = @id
            """,
            ("claim", Guid.NewGuid()),
            ("id", reservedDelivery));
        await AssertRefusedAsync(
            """
            UPDATE notifications."ChannelDeliveries"
            SET "Status" = 'Materialized', "ClaimToken" = NULL, "ClaimExpiresAtUtc" = NULL,
                "MaterializedAtUtc" = now(), "CompletedAtUtc" = now()
            WHERE "Id" = @id
            """,
            "finalization without a started attempt",
            ("id", reservedDelivery));

        // A terminal delivery mutated by a stale claimant.
        await SweepAsync();
        await AssertRefusedAsync(
            """
            UPDATE notifications."ChannelDeliveries"
            SET "Status" = 'Pending', "MaterializedAtUtc" = NULL, "CompletedAtUtc" = NULL
            WHERE "Id" = @id
            """,
            "terminal delivery mutation",
            ("id", deliveryId));

        // And history is never deleted.
        await AssertRefusedAsync(
            """DELETE FROM notifications."ChannelDeliveries" WHERE "Id" = @id""",
            "delivery deletion",
            ("id", deliveryId));
        await AssertRefusedAsync(
            """
            DELETE FROM notifications."DeliveryAttempts" WHERE "ChannelDeliveryId" = @id
            """,
            "attempt deletion",
            ("id", deliveryId));
    }

    /// <summary>
    /// The mutable preference is a read optimisation over append-only evidence, and the database
    /// refuses a decision that no evidence explains.
    /// </summary>
    [TestMethod]
    public async Task DirectSqlCannotEnableEmailWithoutMatchingConsentEvidence()
    {
        var workspace = await CreateWorkspaceAsync("db-consent");

        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ChannelPreferences"
                ("Id","TenantId","UserId","EmailServiceEnabled","EmailMarketingEnabled",
                 "QuietHoursEnabled","PolicyVersion","EmailServiceDecidedAtUtc","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @userId, true, false, false, 1, now(), now(), now())
            """,
            "preference without evidence",
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));

        // Quiet hours whose start equals its end are refused by the database as well as the domain.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ChannelPreferences"
                ("Id","TenantId","UserId","EmailServiceEnabled","EmailMarketingEnabled",
                 "QuietHoursEnabled","QuietHoursStartLocal","QuietHoursEndLocal","PolicyVersion",
                 "CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @userId, false, false, true, '22:00', '22:00', 1, now(), now())
            """,
            "zero-length quiet window",
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));

        // Consent recorded by somebody other than its subject.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ConsentEvents"
                ("Id","TenantId","UserId","Channel","Purpose","Decision","RecordedAtUtc",
                 "PolicyVersion","Source","ActorUserId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @userId, 'Email', 'ServiceTransactional', 'Granted', now(),
                    1, 'x', @tenantId, now(), now())
            """,
            "consent by another actor",
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));

        // Even structurally valid evidence cannot be appended as an unreferenced contradictory fact.
        await EnableServiceEmailAsync(workspace.Client);
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ConsentEvents"
                ("Id","TenantId","UserId","Channel","Purpose","Decision","RecordedAtUtc",
                 "PolicyVersion","Source","ActorUserId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @userId, 'Email', 'ServiceTransactional', 'Withdrawn', now(),
                    1, 'notification-preferences-own-settings', @userId, now(), now())
            """,
            "unreferenced contradictory consent evidence",
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));
    }

    /// <summary>Tenant/user relationships remain structural under direct SQL, not API convention.</summary>
    [TestMethod]
    public async Task DirectSqlCannotAttachPreferenceFactsToAnotherTenantsMember()
    {
        var alpha = await CreateWorkspaceAsync("db-pref-owner-a");
        var beta = await CreateWorkspaceAsync("db-pref-owner-b");

        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ChannelPreferences"
                ("Id","TenantId","UserId","EmailServiceEnabled","EmailMarketingEnabled",
                 "QuietHoursEnabled","PolicyVersion","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @userId, false, false, false, 1, now(), now())
            """,
            "cross-tenant preference subject",
            ("tenantId", alpha.TenantId),
            ("userId", beta.ClientUserId));

        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ConsentEvents"
                ("Id","TenantId","UserId","Channel","Purpose","Decision","RecordedAtUtc",
                 "PolicyVersion","Source","ActorUserId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, @userId, 'Email', 'ServiceTransactional', 'Granted', now(),
                    1, 'notification-preferences-own-settings', @userId, now(), now())
            """,
            "cross-tenant consent subject",
            ("tenantId", alpha.TenantId),
            ("userId", beta.ClientUserId));

        await AssertRefusedAsync(
            """
            INSERT INTO notifications."PreferenceCommandRecords"
                ("Id","TenantId","IdempotencyKey","CommandType","PayloadFingerprint",
                 "ActorUserId","RecordedAtUtc","ResultEmailServiceEnabled",
                 "ResultEmailMarketingEnabled","ResultEmailChannelAvailable",
                 "ResultQuietHoursEnabled","ResultTimeZoneId","ResultPolicyVersion",
                 "ResultPreferenceVersion","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenantId, gen_random_uuid(), 'UpdateOwnPreferences', repeat('0', 64),
                    @userId, now(), false, false, true, false, 'Asia/Beirut', 1, 0, now(), now())
            """,
            "cross-tenant preference command actor",
            ("tenantId", alpha.TenantId),
            ("userId", beta.ClientUserId));
    }

    // ---------- helpers ----------

    private static async Task<PreferenceView> DisableServiceEmailAsync(HttpClient client)
    {
        var current = await PreferencesAsync(client);
        var response = await SavePreferencesAsync(client, new
        {
            emailServiceEnabled = false,
            quietHoursEnabled = current.QuietHoursEnabled,
            quietHoursStartLocal = current.QuietHoursStartLocal,
            quietHoursEndLocal = current.QuietHoursEndLocal,
            idempotencyKey = Guid.NewGuid(),
            version = current.Version,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<PreferenceView>(response);
    }

    private async Task<IReadOnlyList<ConsentRow>> ConsentEvidenceAsync(Guid userId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Channel", "Purpose", "Decision", "Source", "PolicyVersion", "ActorUserId", "RecordedAtUtc"
            FROM notifications."ConsentEvents"
            WHERE "UserId" = @id
            ORDER BY "RecordedAtUtc", "Id"
            """;
        command.Parameters.AddWithValue("id", userId);
        var rows = new List<ConsentRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new ConsentRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetInt32(4),
                reader.GetGuid(5),
                reader.GetFieldValue<DateTimeOffset>(6)));
        }

        return rows;
    }

    /// <summary>
    /// Every column of every notification table, concatenated. A privacy assertion that names columns
    /// stops proving anything the moment somebody adds one, so this reads the catalog instead.
    /// </summary>
    private async Task<string> DumpNotificationTablesAsync()
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        var dumped = new System.Text.StringBuilder();
        foreach (var table in new[]
                 {
                     "OutboxItems", "ChannelDeliveries", "DeliveryAttempts", "Notifications",
                     "ChannelPreferences", "ConsentEvents", "PreferenceCommandRecords",
                 })
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                $"""SELECT coalesce(string_agg(t::text, ' '), '') FROM notifications."{table}" t""";
            dumped.Append(await command.ExecuteScalarAsync() as string).Append(' ');
        }

        return dumped.ToString();
    }

    private async Task AssertRefusedAsync(
        string sql,
        string description,
        params (string Name, object Value)[] parameters)
    {
        try
        {
            await ExecuteAsync(sql, parameters);
        }
        catch (PostgresException)
        {
            return;
        }

        Assert.Fail($"The database accepted a write that violates '{description}'.");
    }

    /// <summary>
    /// A single identifier. Separate from the general scalar helper because <c>Convert.ChangeType</c>
    /// has no conversion for <c>Guid</c> and would throw rather than return one.
    /// </summary>
    private async Task<Guid> ScalarGuidAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return await command.ExecuteScalarAsync() is Guid identifier ? identifier : Guid.Empty;
    }

    private sealed record ConsentRow(
        string Channel,
        string Purpose,
        string Decision,
        string Source,
        int PolicyVersion,
        Guid ActorUserId,
        DateTimeOffset RecordedAtUtc);
}
