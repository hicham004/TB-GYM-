using TB.Gym.Modules.Notifications;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The dispatch state machine, in isolation from the database and from the clock.
/// </summary>
/// <remarks>
/// Every instant here is supplied, never observed: the retry schedule is asserted at its exact
/// boundaries without a test ever waiting for wall-clock time to pass.
/// <para>
/// Phase 6B-3A moved this lifecycle from the intent onto <see cref="NotificationChannelDelivery"/>,
/// one per channel. The assertions below are the Phase 6B-1 guarantees restated against the row that
/// now owns them, so a regression in claiming, leasing, retrying, exhaustion or stale finalization
/// still fails here.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B1NotificationDispatchDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 31, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid RecipientId = Guid.CreateVersion7();
    private static readonly Guid EnrollmentId = Guid.CreateVersion7();
    private static readonly TimeSpan Lease = TimeSpan.FromSeconds(120);

    [TestMethod]
    public void ScheduledDeliveryIsPendingAndDueAtItsScheduledInstant()
    {
        var delivery = Select(Now.AddHours(2));

        Assert.AreEqual(NotificationDeliveryStatus.Pending, delivery.Status);
        Assert.AreEqual(Now.AddHours(2), delivery.NextAttemptAtUtc);
        Assert.AreEqual(Now.AddHours(2), delivery.DueAtUtc);
        Assert.AreEqual(0, delivery.AttemptCount);
        Assert.IsNull(delivery.ClaimToken);
        Assert.IsFalse(delivery.IsTerminal);
        Assert.IsFalse(delivery.IsClaimable(Now.AddHours(2).AddTicks(-1)));
        Assert.IsTrue(delivery.IsClaimable(Now.AddHours(2)));
    }

    /// <summary>
    /// The intent itself now carries no dispatch state at all, which is what lets two channels of one
    /// notification hold different truths at the same time.
    /// </summary>
    [TestMethod]
    public void TheLogicalNotificationCarriesNoChannelState()
    {
        var item = ScheduleIntent();

        Assert.AreEqual(NotificationIntentStatus.Scheduled, item.Status);
        Assert.IsFalse(item.IsCancelled);
        Assert.IsNull(item.CancelledAtUtc);
        Assert.AreEqual(NotificationPurpose.ServiceTransactional, item.Purpose);

        var properties = typeof(NotificationOutboxItem)
            .GetProperties()
            .Select(property => property.Name)
            .ToArray();
        foreach (var channelState in new[]
                 {
                     "AttemptCount", "ClaimToken", "ClaimExpiresAtUtc", "NextAttemptAtUtc",
                     "DispatchedAtUtc", "DeadLetteredAtUtc", "FailureCode",
                 })
        {
            Assert.DoesNotContain(
                channelState,
                properties,
                $"{channelState} is per-channel state and cannot live on the logical notification.");
        }
    }

    [TestMethod]
    public void ClaimingTakesALeaseAndAnExplicitStartConsumesTheAttempt()
    {
        var delivery = Select(Now);

        var claim = delivery.Claim(Now, Lease);

        Assert.AreEqual(NotificationDeliveryStatus.Processing, delivery.Status);
        Assert.AreEqual(0, delivery.AttemptCount, "A reservation is not an attempt.");
        Assert.AreEqual(1, delivery.StartAttempt(claim));
        Assert.AreEqual(1, delivery.AttemptCount);
        Assert.AreEqual(claim, delivery.ClaimToken);
        Assert.AreEqual(Now.Add(Lease), delivery.ClaimExpiresAtUtc);
        // While the lease holds, nobody else may take the delivery, however often they sweep.
        Assert.IsFalse(delivery.IsClaimable(Now.Add(Lease).AddTicks(-1)));
        Assert.ThrowsExactly<InvalidOperationException>(() => delivery.Claim(Now, Lease));
    }

    [TestMethod]
    public void AnExpiredStartedAttemptConsumesCapacityButAnUnusedReservationDoesNot()
    {
        var delivery = Select(Now);
        var abandoned = delivery.Claim(Now, Lease);
        delivery.StartAttempt(abandoned);

        var expiry = Now.Add(Lease);
        Assert.IsTrue(delivery.IsClaimExpired(expiry));
        Assert.IsTrue(delivery.IsClaimable(expiry));

        var replacement = delivery.Claim(expiry, Lease);

        Assert.AreNotEqual(abandoned, replacement);
        Assert.AreEqual(1, delivery.AttemptCount);
        delivery.StartAttempt(replacement);
        Assert.AreEqual(2, delivery.AttemptCount);
        Assert.AreEqual(replacement, delivery.ClaimToken);
    }

    [TestMethod]
    public void AStaleClaimantCannotFinalizeWorkThatWasTakenOverFromIt()
    {
        var delivery = Select(Now);
        var stale = delivery.Claim(Now, Lease);
        var current = delivery.Claim(Now.Add(Lease), Lease);

        Assert.ThrowsExactly<InvalidOperationException>(() => delivery.MarkMaterialized(stale, Now.Add(Lease)));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => delivery.MarkRetrying(stale, Now.AddHours(1), NotificationFailureCodes.DispatchTransient));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => delivery.MarkDeadLettered(stale, Now, NotificationFailureCodes.AttemptsExhausted));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => delivery.Suppress(stale, Now, NotificationSuppressionCodes.EmailOptedOut));

        // The current claimant still owns it, so the newer result is the one that lands.
        delivery.MarkMaterialized(current, Now.Add(Lease));
        Assert.AreEqual(NotificationDeliveryStatus.Materialized, delivery.Status);
    }

    [TestMethod]
    public void FinalizingRequiresAClaimAtAll()
    {
        var delivery = Select(Now);

        Assert.ThrowsExactly<InvalidOperationException>(() => delivery.MarkMaterialized(Guid.CreateVersion7(), Now));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => delivery.MarkDeadLettered(Guid.CreateVersion7(), Now, NotificationFailureCodes.PayloadInvalid));
    }

    [TestMethod]
    public void MaterializationRecordsItsCompletionInstantClearsTheClaimAndIsTerminal()
    {
        var delivery = Select(Now);
        var claim = delivery.Claim(Now, Lease);

        delivery.MarkMaterialized(claim, Now.AddSeconds(3));

        Assert.AreEqual(NotificationDeliveryStatus.Materialized, delivery.Status);
        Assert.AreEqual(Now.AddSeconds(3), delivery.MaterializedAtUtc);
        Assert.AreEqual(Now.AddSeconds(3), delivery.CompletedAtUtc);
        Assert.IsNull(delivery.FailureCode);
        // In-app has no transport and no provider, so neither is claimed.
        Assert.IsNull(delivery.TransportAdapter);
        Assert.IsNull(delivery.ProviderMessageId);
        Assert.IsNull(delivery.ProviderAcceptedAtUtc);
        // A terminal row never keeps a live lease; that is what stops a stale worker finalizing it.
        Assert.IsNull(delivery.ClaimToken);
        Assert.IsNull(delivery.ClaimExpiresAtUtc);
        Assert.IsTrue(delivery.IsTerminal);
        Assert.IsFalse(delivery.IsClaimable(Now.AddYears(1)));
    }

    [TestMethod]
    public void ARetryableFailureReturnsToPendingAtItsScheduledNextAttempt()
    {
        var delivery = Select(Now);
        var claim = delivery.Claim(Now, Lease);

        delivery.MarkRetrying(claim, Now.AddMinutes(1), NotificationFailureCodes.DispatchTransient);

        Assert.AreEqual(NotificationDeliveryStatus.Pending, delivery.Status);
        Assert.AreEqual(Now.AddMinutes(1), delivery.NextAttemptAtUtc);
        Assert.AreEqual(NotificationFailureCodes.DispatchTransient, delivery.FailureCode);
        Assert.IsNull(delivery.ClaimToken);
        Assert.IsFalse(delivery.IsClaimable(Now.AddSeconds(59)));
        Assert.IsTrue(delivery.IsClaimable(Now.AddMinutes(1)));
    }

    [TestMethod]
    public void DeadLetteringIsTerminalAndRecordsWhenAndWhy()
    {
        var delivery = Select(Now);
        var claim = delivery.Claim(Now, Lease);

        delivery.MarkDeadLettered(claim, Now.AddSeconds(2), NotificationFailureCodes.PayloadInvalid);

        Assert.AreEqual(NotificationDeliveryStatus.DeadLettered, delivery.Status);
        Assert.AreEqual(Now.AddSeconds(2), delivery.DeadLetteredAtUtc);
        Assert.AreEqual(NotificationFailureCodes.PayloadInvalid, delivery.FailureCode);
        Assert.IsNull(delivery.ClaimToken);
        Assert.IsTrue(delivery.IsTerminal);
        Assert.ThrowsExactly<InvalidOperationException>(
            () => delivery.SuppressBeforeClaim(Now, NotificationSuppressionCodes.StateChanged));
    }

    /// <summary>
    /// Cancellation and dead-lettering are different facts. Suppressed means nobody should be told any
    /// more; dead-lettered means somebody should have been and the dispatcher could not do it.
    /// </summary>
    [TestMethod]
    public void SuppressionAndDeadLetteringAreDifferentTerminalStates()
    {
        var suppressed = Select(Now);
        var suppressedClaim = suppressed.Claim(Now, Lease);
        suppressed.Suppress(suppressedClaim, Now, NotificationSuppressionCodes.EnrollmentCancelled);

        Assert.AreEqual(NotificationDeliveryStatus.Suppressed, suppressed.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EnrollmentCancelled, suppressed.FailureCode);
        Assert.IsNull(suppressed.DeadLetteredAtUtc);
        Assert.IsNull(suppressed.MaterializedAtUtc);
        Assert.IsNotNull(suppressed.CompletedAtUtc);
        Assert.IsNull(suppressed.ClaimToken);

        var deadLettered = Select(Now);
        var claim = deadLettered.Claim(Now, Lease);
        deadLettered.MarkDeadLettered(claim, Now, NotificationFailureCodes.TemplateMissing);

        Assert.AreEqual(NotificationDeliveryStatus.DeadLettered, deadLettered.Status);
        Assert.IsNotNull(deadLettered.DeadLetteredAtUtc);
    }

    /// <summary>
    /// Business cancellation is a no-op on a delivery a worker is currently holding: the dispatcher
    /// re-establishes eligibility before it materializes anything and suppresses its own claimed row.
    /// </summary>
    [TestMethod]
    public void BusinessCancellationOnlyAffectsPendingDeliveries()
    {
        var pending = Select(Now);
        Assert.IsTrue(pending.CancelIfPending(Now));
        Assert.AreEqual(NotificationDeliveryStatus.Suppressed, pending.Status);
        Assert.AreEqual(NotificationSuppressionCodes.IntentCancelled, pending.FailureCode);

        var held = Select(Now);
        var claim = held.Claim(Now, Lease);
        Assert.IsFalse(held.CancelIfPending(Now));
        Assert.AreEqual(NotificationDeliveryStatus.Processing, held.Status);
        Assert.AreEqual(claim, held.ClaimToken);

        var materialized = Select(Now);
        materialized.MarkMaterialized(materialized.Claim(Now, Lease), Now);
        Assert.IsFalse(materialized.CancelIfPending(Now));
        Assert.AreEqual(NotificationDeliveryStatus.Materialized, materialized.Status);
    }

    /// <summary>
    /// Cancelling the intent is idempotent and one way, and it is deliberately a different fact from
    /// what any one channel did with it.
    /// </summary>
    [TestMethod]
    public void CancellingTheIntentIsIdempotentAndRecordsItsInstant()
    {
        var item = ScheduleIntent();

        item.Cancel(Now);
        Assert.IsTrue(item.IsCancelled);
        Assert.AreEqual(NotificationIntentStatus.Cancelled, item.Status);
        Assert.AreEqual(Now, item.CancelledAtUtc);

        item.Cancel(Now.AddHours(1));
        Assert.AreEqual(Now, item.CancelledAtUtc, "A second cancellation must not move the instant.");
    }

    [TestMethod]
    public void ATerminalDeliveryAcceptsNoFurtherTransition()
    {
        foreach (var delivery in TerminalDeliveries())
        {
            var status = delivery.Status;
            Assert.IsFalse(delivery.IsClaimable(Now.AddYears(5)));
            Assert.ThrowsExactly<InvalidOperationException>(() => delivery.Claim(Now.AddYears(5), Lease));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => delivery.MarkMaterialized(Guid.CreateVersion7(), Now));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => delivery.MarkRetrying(Guid.CreateVersion7(), Now.AddHours(1), NotificationFailureCodes.DispatchTransient));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => delivery.Defer(Now, Now.AddHours(1), NotificationDeferralCodes.QuietHours));
            Assert.ThrowsExactly<InvalidOperationException>(() => delivery.MarkAttemptsExhausted(Now));
            Assert.IsFalse(delivery.CancelIfPending(Now));
            Assert.AreEqual(status, delivery.Status, "A terminal delivery must not change status.");
        }
    }

    [TestMethod]
    public void ClaimingRejectsANonPositiveLease()
    {
        var delivery = Select(Now);

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => delivery.Claim(Now, TimeSpan.Zero));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => delivery.Claim(Now, TimeSpan.FromSeconds(-1)));
    }

    /// <summary>
    /// The exact <c>notification-exponential-v1</c> table, at its boundaries. The last permitted
    /// attempt has no next instant: it dead-letters instead of waiting again.
    /// </summary>
    [TestMethod]
    public void RetryScheduleMatchesTheNamedPolicyAtEveryBoundary()
    {
        // Five waits and then a dead letter, which is what the documented policy name promises.
        Assert.HasCount(5, NotificationRetryPolicy.Schedule);

        (int Attempt, TimeSpan Delay)[] expected =
        [
            (1, TimeSpan.FromMinutes(1)),
            (2, TimeSpan.FromMinutes(5)),
            (3, TimeSpan.FromMinutes(15)),
            (4, TimeSpan.FromHours(1)),
            (5, TimeSpan.FromHours(6)),
        ];

        foreach (var (attempt, delay) in expected)
        {
            Assert.AreEqual(
                Now.Add(delay),
                NotificationRetryPolicy.NextAttemptAtUtc(attempt, 6, Now),
                $"Attempt {attempt} must wait {delay}.");
        }

        // Failure on the sixth attempt exhausts the schedule.
        Assert.IsNull(NotificationRetryPolicy.NextAttemptAtUtc(6, 6, Now));
        // A tighter configured maximum shortens the schedule rather than extending it.
        Assert.IsNull(NotificationRetryPolicy.NextAttemptAtUtc(2, 2, Now));
        Assert.AreEqual(Now.AddMinutes(1), NotificationRetryPolicy.NextAttemptAtUtc(1, 2, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => NotificationRetryPolicy.NextAttemptAtUtc(0, 6, Now));
    }

    [TestMethod]
    public void ConfiguredMaximumAboveSixRepeatsTheSixHourCeiling()
    {
        Assert.AreEqual(Now.AddHours(6), NotificationRetryPolicy.NextAttemptAtUtc(5, 8, Now));
        Assert.AreEqual(Now.AddHours(6), NotificationRetryPolicy.NextAttemptAtUtc(6, 8, Now));
        Assert.AreEqual(Now.AddHours(6), NotificationRetryPolicy.NextAttemptAtUtc(7, 8, Now));
        Assert.IsNull(NotificationRetryPolicy.NextAttemptAtUtc(8, 8, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => NotificationRetryPolicy.NextAttemptAtUtc(1, 21, Now));
    }

    [TestMethod]
    public void MaximumAttemptsDeadLettersRatherThanRetryingForever()
    {
        var delivery = Select(Now);
        var now = Now;

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var claim = delivery.Claim(now, Lease);
            delivery.StartAttempt(claim, 6);
            var next = NotificationRetryPolicy.NextAttemptAtUtc(attempt, 6, now);
            Assert.IsNotNull(next, $"Attempt {attempt} should still have been retryable.");
            delivery.MarkRetrying(claim, next.Value, NotificationFailureCodes.DispatchTransient);
            Assert.AreEqual(NotificationDeliveryStatus.Pending, delivery.Status);
            now = next.Value;
        }

        var finalClaim = delivery.Claim(now, Lease);
        delivery.StartAttempt(finalClaim, 6);
        Assert.AreEqual(6, delivery.AttemptCount);
        Assert.IsNull(NotificationRetryPolicy.NextAttemptAtUtc(6, 6, now));
        delivery.MarkDeadLettered(finalClaim, now, NotificationFailureCodes.AttemptsExhausted);

        Assert.AreEqual(NotificationDeliveryStatus.DeadLettered, delivery.Status);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, delivery.FailureCode);
        Assert.AreEqual(6, delivery.AttemptCount);
    }

    [TestMethod]
    public void AbandonedClaimsConsumeTheMaximumAndCannotCreateAttemptFour()
    {
        const int MaximumAttempts = 3;
        var delivery = Select(Now);
        var now = Now;

        for (var attempt = 1; attempt <= MaximumAttempts; attempt++)
        {
            var claim = delivery.Claim(now, Lease, MaximumAttempts);
            delivery.StartAttempt(claim, MaximumAttempts);
            Assert.AreEqual(attempt, delivery.AttemptCount);
            now = now.Add(Lease);
        }

        Assert.IsTrue(delivery.IsClaimExpired(now));
        Assert.ThrowsExactly<InvalidOperationException>(() => delivery.Claim(now, Lease, MaximumAttempts));
        delivery.MarkAttemptsExhausted(now);

        Assert.AreEqual(NotificationDeliveryStatus.DeadLettered, delivery.Status);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, delivery.FailureCode);
        Assert.AreEqual(MaximumAttempts, delivery.AttemptCount);
        Assert.IsNull(delivery.ClaimToken);
    }

    [TestMethod]
    public void APermanentFailureDeadLettersOnItsFirstAttempt()
    {
        var delivery = Select(Now);
        var claim = delivery.Claim(Now, Lease);
        delivery.StartAttempt(claim);

        delivery.MarkDeadLettered(claim, Now, NotificationFailureCodes.AggregateMismatch);

        Assert.AreEqual(1, delivery.AttemptCount);
        Assert.AreEqual(NotificationDeliveryStatus.DeadLettered, delivery.Status);
        Assert.AreEqual(NotificationFailureCodes.AggregateMismatch, delivery.FailureCode);
    }

    [TestMethod]
    public void AnAttemptRecordsItsClaimAndAStableProviderIdempotencyKey()
    {
        var outboxItemId = Guid.CreateVersion7();
        var deliveryId = Guid.CreateVersion7();
        var claim = Guid.CreateVersion7();
        var attempt = NotificationDeliveryAttempt.Start(
            TenantId,
            outboxItemId,
            deliveryId,
            NotificationChannel.InApp,
            1,
            claim,
            Now);

        Assert.AreEqual(NotificationDeliveryOutcome.Started, attempt.Outcome);
        Assert.IsFalse(attempt.IsCompleted);
        Assert.IsNull(attempt.CompletedAtUtc);
        Assert.IsNull(attempt.ProviderMessageId);
        Assert.AreEqual(claim, attempt.ClaimToken);
        Assert.AreEqual(deliveryId, attempt.ChannelDeliveryId);
        // Stable for the intent and channel, deliberately not for the attempt: a retry has to be
        // recognisable by a provider as the same message.
        Assert.AreEqual(
            NotificationDeliveryAttempt.BuildIdempotencyKey(outboxItemId, NotificationChannel.InApp),
            attempt.IdempotencyKey);
        Assert.AreEqual(
            attempt.IdempotencyKey,
            NotificationDeliveryAttempt.Start(TenantId, outboxItemId, deliveryId, NotificationChannel.InApp, 2, Guid.CreateVersion7(), Now)
                .IdempotencyKey);
        // Two channels of one notification are two different messages, so they carry two keys.
        Assert.AreNotEqual(
            attempt.IdempotencyKey,
            NotificationDeliveryAttempt.BuildIdempotencyKey(outboxItemId, NotificationChannel.Email));
    }

    [TestMethod]
    public void ACompletedAttemptIsImmutableWhateverItCompletedAs()
    {
        foreach (var complete in CompletionActions())
        {
            var attempt = NotificationDeliveryAttempt.Start(
                TenantId,
                Guid.CreateVersion7(),
                Guid.CreateVersion7(),
                NotificationChannel.InApp,
                1,
                Guid.CreateVersion7(),
                Now);
            complete(attempt);

            Assert.IsTrue(attempt.IsCompleted);
            Assert.AreEqual(Now.AddSeconds(1), attempt.CompletedAtUtc);
            Assert.ThrowsExactly<InvalidOperationException>(() => attempt.Succeed(Now.AddSeconds(2)));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => attempt.FailTransiently(Now.AddSeconds(2), NotificationFailureCodes.DispatchTransient));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => attempt.Abandon(Now.AddSeconds(2), NotificationFailureCodes.ClaimExpired));
        }
    }

    [TestMethod]
    public void AnAttemptRejectsANumberBelowOne()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => NotificationDeliveryAttempt.Start(
            TenantId,
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            NotificationChannel.InApp,
            0,
            Guid.CreateVersion7(),
            Now));
    }

    [TestMethod]
    public void NotificationSnapshotsItsTemplateAndReadsIdempotently()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.EnrollmentActivated,
            "en-LB",
            out var template));
        var outboxItemId = Guid.CreateVersion7();
        var notification = Notification.Materialize(
            TenantId,
            RecipientId,
            outboxItemId,
            CommercialNotificationKind.EnrollmentActivated,
            template);

        Assert.AreEqual(template.Key, notification.TemplateKey);
        Assert.AreEqual(1, notification.TemplateVersion);
        Assert.AreEqual("en", notification.Culture);
        Assert.AreEqual(template.Title, notification.Title);
        Assert.AreEqual(template.Body, notification.Body);
        Assert.AreEqual(outboxItemId, notification.SourceOutboxItemId);
        Assert.IsFalse(notification.IsRead);
        Assert.IsNull(notification.ReadAtUtc);

        Assert.IsTrue(notification.MarkRead(Now));
        Assert.IsTrue(notification.IsRead);
        Assert.AreEqual(Now, notification.ReadAtUtc);

        // Reading twice is a success that changes nothing, not a conflict and not a new instant.
        Assert.IsFalse(notification.MarkRead(Now.AddMinutes(5)));
        Assert.AreEqual(Now, notification.ReadAtUtc);
    }

    [TestMethod]
    public void NotificationRejectsAnIncompleteIdentity()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.PaymentRequired,
            "en",
            out var template));

        Assert.ThrowsExactly<ArgumentException>(() => Notification.Materialize(
            TenantId,
            Guid.Empty,
            Guid.CreateVersion7(),
            CommercialNotificationKind.PaymentRequired,
            template));
        Assert.ThrowsExactly<ArgumentException>(() => Notification.Materialize(
            TenantId,
            RecipientId,
            Guid.Empty,
            CommercialNotificationKind.PaymentRequired,
            template));
    }

    /// <summary>
    /// The published wording, checked against what it must never say. A notification is a pointer to
    /// look at the workspace, not a place to restate commercial facts to whoever is holding the phone.
    /// </summary>
    [TestMethod]
    public void EveryPublishedTemplateIsGenericAndPrivacySafe()
    {
        string[] forbidden =
        [
            "$", "USD", "amount", "price", "paid", "invoice", "receipt",
            "@", "kg", "weight", "calorie", "client name", "coach name",
        ];

        foreach (var kind in Enum.GetValues<CommercialNotificationKind>())
        {
            Assert.IsTrue(
                NotificationTemplateCatalog.TryResolve(kind, "en", out var template),
                $"{kind} has no published English template.");
            Assert.AreEqual(1, template.Version);
            Assert.AreEqual("en", template.Culture);
            Assert.IsFalse(string.IsNullOrWhiteSpace(template.Title));
            Assert.IsFalse(string.IsNullOrWhiteSpace(template.Body));
            // No format placeholder of any kind: the catalog renders fixed text, so nothing a coach
            // types or a payload carries can reach the wording.
            Assert.DoesNotContain("{", template.Title + template.Body);

            foreach (var term in forbidden)
            {
                Assert.IsFalse(
                    (template.Title + " " + template.Body).Contains(term, StringComparison.OrdinalIgnoreCase),
                    $"The {kind} template mentions '{term}'.");
            }
        }

        // A renewal may still be awaiting payment, so its wording must not imply active access.
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.EnrollmentRenewed,
            "en",
            out var renewal));
        Assert.DoesNotContain("active", renewal.Title + renewal.Body, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public void OnlyEnglishTemplatesArePublished()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.PaymentRequired,
            "en-LB",
            out _));
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.PaymentRequired,
            "en",
            out _));
        // Arabic is deferred. A missing template is refused rather than answered in the wrong
        // language, and the dispatcher turns that refusal into a permanent dead letter.
        Assert.IsFalse(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.PaymentRequired,
            "ar-LB",
            out _));
        Assert.IsFalse(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.PaymentRequired,
            string.Empty,
            out _));
        Assert.HasCount(
            Enum.GetValues<CommercialNotificationKind>().Length,
            NotificationTemplateCatalog.Published);
    }

    [TestMethod]
    public void PagingBoundsAreEnforcedByTheContract()
    {
        Assert.AreEqual(25, NotificationPaging.NormalizeTake(null));
        Assert.AreEqual(25, NotificationPaging.NormalizeTake(0));
        Assert.AreEqual(25, NotificationPaging.NormalizeTake(-5));
        Assert.AreEqual(10, NotificationPaging.NormalizeTake(10));
        Assert.AreEqual(100, NotificationPaging.NormalizeTake(100));
        Assert.AreEqual(100, NotificationPaging.NormalizeTake(1_000_000));
        Assert.AreEqual(0, NotificationPaging.NormalizeSkip(null));
        Assert.AreEqual(0, NotificationPaging.NormalizeSkip(-1));
        Assert.AreEqual(7, NotificationPaging.NormalizeSkip(7));
    }

    private static IEnumerable<Action<NotificationDeliveryAttempt>> CompletionActions() =>
    [
        attempt => attempt.Succeed(Now.AddSeconds(1)),
        attempt => attempt.FailTransiently(Now.AddSeconds(1), NotificationFailureCodes.DispatchTransient),
        attempt => attempt.FailPermanently(Now.AddSeconds(1), NotificationFailureCodes.PayloadInvalid),
        attempt => attempt.Abandon(Now.AddSeconds(1), NotificationFailureCodes.ClaimExpired),
        attempt => attempt.Suppress(Now.AddSeconds(1), NotificationSuppressionCodes.StateChanged),
    ];

    private static IEnumerable<NotificationChannelDelivery> TerminalDeliveries()
    {
        var materialized = Select(Now);
        materialized.MarkMaterialized(materialized.Claim(Now, Lease), Now);
        yield return materialized;

        var deadLettered = Select(Now);
        deadLettered.MarkDeadLettered(
            deadLettered.Claim(Now, Lease),
            Now,
            NotificationFailureCodes.AttemptsExhausted);
        yield return deadLettered;

        var suppressed = Select(Now);
        suppressed.SuppressBeforeClaim(Now, NotificationSuppressionCodes.IntentCancelled);
        yield return suppressed;
    }

    private static NotificationChannelDelivery Select(DateTimeOffset dueAtUtc) =>
        NotificationChannelDelivery.Select(
            TenantId,
            Guid.CreateVersion7(),
            NotificationChannel.InApp,
            NotificationPurpose.ServiceTransactional,
            NotificationChannelPlanner.InAppAlways,
            NotificationChannelPlanner.PolicyVersion,
            dueAtUtc);

    private static NotificationOutboxItem ScheduleIntent() =>
        NotificationOutboxItem.Schedule(
            TenantId,
            RecipientId,
            EnrollmentId,
            CommercialNotificationKind.EnrollmentEndingSoon,
            $"enrollment:{EnrollmentId:N}:ending-soon:v1",
            $"{{\"enrollmentId\":\"{EnrollmentId}\",\"clientProfileId\":\"{Guid.CreateVersion7()}\",\"schemaVersion\":1}}",
            Now,
            "Asia/Beirut");
}
