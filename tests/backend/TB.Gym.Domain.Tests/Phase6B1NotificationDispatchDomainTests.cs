using TB.Gym.Modules.Notifications;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The dispatch state machine, in isolation from the database and from the clock.
/// </summary>
/// <remarks>
/// Every instant here is supplied, never observed: the retry schedule is asserted at its exact
/// boundaries without a test ever waiting for wall-clock time to pass.
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
    public void ScheduledItemIsPendingAndDueAtItsScheduledInstant()
    {
        var item = Schedule(Now.AddHours(2));

        Assert.AreEqual(NotificationOutboxStatus.Pending, item.Status);
        Assert.AreEqual(Now.AddHours(2), item.NextAttemptAtUtc);
        Assert.AreEqual(0, item.AttemptCount);
        Assert.IsNull(item.ClaimToken);
        Assert.IsFalse(item.IsTerminal);
        Assert.IsFalse(item.IsClaimable(Now.AddHours(2).AddTicks(-1)));
        Assert.IsTrue(item.IsClaimable(Now.AddHours(2)));
    }

    [TestMethod]
    public void ClaimingTakesALeaseStartsAnAttemptAndBlocksASecondClaimant()
    {
        var item = Schedule(Now);

        var claim = item.Claim(Now, Lease);

        Assert.AreEqual(NotificationOutboxStatus.Processing, item.Status);
        Assert.AreEqual(1, item.AttemptCount);
        Assert.AreEqual(claim, item.ClaimToken);
        Assert.AreEqual(Now.Add(Lease), item.ClaimExpiresAtUtc);
        // While the lease holds, nobody else may take the item, however often they sweep.
        Assert.IsFalse(item.IsClaimable(Now.Add(Lease).AddTicks(-1)));
        Assert.ThrowsExactly<InvalidOperationException>(() => item.Claim(Now, Lease));
    }

    [TestMethod]
    public void AnExpiredLeaseMakesTheItemClaimableAgainAndIncrementsTheAttemptNumber()
    {
        var item = Schedule(Now);
        var abandoned = item.Claim(Now, Lease);

        var expiry = Now.Add(Lease);
        Assert.IsTrue(item.IsClaimExpired(expiry));
        Assert.IsTrue(item.IsClaimable(expiry));

        var replacement = item.Claim(expiry, Lease);

        Assert.AreNotEqual(abandoned, replacement);
        Assert.AreEqual(2, item.AttemptCount);
        Assert.AreEqual(replacement, item.ClaimToken);
    }

    [TestMethod]
    public void AStaleClaimantCannotFinalizeWorkThatWasTakenOverFromIt()
    {
        var item = Schedule(Now);
        var stale = item.Claim(Now, Lease);
        var current = item.Claim(Now.Add(Lease), Lease);

        Assert.ThrowsExactly<InvalidOperationException>(() => item.MarkDispatched(stale, Now.Add(Lease)));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => item.MarkRetrying(stale, Now.AddHours(1), NotificationFailureCodes.DispatchTransient));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => item.MarkDeadLettered(stale, Now, NotificationFailureCodes.AttemptsExhausted));

        // The current claimant still owns it, so the newer result is the one that lands.
        item.MarkDispatched(current, Now.Add(Lease));
        Assert.AreEqual(NotificationOutboxStatus.Dispatched, item.Status);
    }

    [TestMethod]
    public void FinalizingRequiresAClaimAtAll()
    {
        var item = Schedule(Now);

        Assert.ThrowsExactly<InvalidOperationException>(() => item.MarkDispatched(Guid.CreateVersion7(), Now));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => item.MarkDeadLettered(Guid.CreateVersion7(), Now, NotificationFailureCodes.PayloadInvalid));
    }

    [TestMethod]
    public void DispatchRecordsItsCompletionInstantClearsTheClaimAndIsTerminal()
    {
        var item = Schedule(Now);
        var claim = item.Claim(Now, Lease);

        item.MarkDispatched(claim, Now.AddSeconds(3));

        Assert.AreEqual(NotificationOutboxStatus.Dispatched, item.Status);
        Assert.AreEqual(Now.AddSeconds(3), item.DispatchedAtUtc);
        Assert.IsNull(item.FailureCode);
        // A terminal row never keeps a live lease; that is what stops a stale worker finalizing it.
        Assert.IsNull(item.ClaimToken);
        Assert.IsNull(item.ClaimExpiresAtUtc);
        Assert.IsTrue(item.IsTerminal);
        Assert.IsFalse(item.IsClaimable(Now.AddYears(1)));
    }

    [TestMethod]
    public void ARetryableFailureReturnsToPendingAtItsScheduledNextAttempt()
    {
        var item = Schedule(Now);
        var claim = item.Claim(Now, Lease);

        item.MarkRetrying(claim, Now.AddMinutes(1), NotificationFailureCodes.DispatchTransient);

        Assert.AreEqual(NotificationOutboxStatus.Pending, item.Status);
        Assert.AreEqual(Now.AddMinutes(1), item.NextAttemptAtUtc);
        Assert.AreEqual(NotificationFailureCodes.DispatchTransient, item.FailureCode);
        Assert.IsNull(item.ClaimToken);
        Assert.IsFalse(item.IsClaimable(Now.AddSeconds(59)));
        Assert.IsTrue(item.IsClaimable(Now.AddMinutes(1)));
    }

    [TestMethod]
    public void DeadLetteringIsTerminalAndRecordsWhenAndWhy()
    {
        var item = Schedule(Now);
        var claim = item.Claim(Now, Lease);

        item.MarkDeadLettered(claim, Now.AddSeconds(2), NotificationFailureCodes.PayloadInvalid);

        Assert.AreEqual(NotificationOutboxStatus.DeadLettered, item.Status);
        Assert.AreEqual(Now.AddSeconds(2), item.DeadLetteredAtUtc);
        Assert.AreEqual(NotificationFailureCodes.PayloadInvalid, item.FailureCode);
        Assert.IsNull(item.ClaimToken);
        Assert.IsTrue(item.IsTerminal);
        Assert.ThrowsExactly<InvalidOperationException>(
            () => item.Suppress(NotificationSuppressionCodes.StateChanged));
    }

    /// <summary>
    /// Cancellation and dead-lettering are different facts. Cancelled means nobody should be told any
    /// more; dead-lettered means somebody should have been and the dispatcher could not do it.
    /// </summary>
    [TestMethod]
    public void SuppressionAndDeadLetteringAreDifferentTerminalStates()
    {
        var suppressed = Schedule(Now);
        suppressed.Claim(Now, Lease);
        suppressed.Suppress(NotificationSuppressionCodes.EnrollmentCancelled);

        Assert.AreEqual(NotificationOutboxStatus.Cancelled, suppressed.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EnrollmentCancelled, suppressed.FailureCode);
        Assert.IsNull(suppressed.DeadLetteredAtUtc);
        Assert.IsNull(suppressed.ClaimToken);

        var deadLettered = Schedule(Now);
        var claim = deadLettered.Claim(Now, Lease);
        deadLettered.MarkDeadLettered(claim, Now, NotificationFailureCodes.TemplateMissing);

        Assert.AreEqual(NotificationOutboxStatus.DeadLettered, deadLettered.Status);
        Assert.IsNotNull(deadLettered.DeadLetteredAtUtc);
    }

    /// <summary>
    /// Commercial cancellation is a no-op on an item a worker is currently holding: the dispatcher
    /// re-establishes eligibility before it renders anything and suppresses the item itself.
    /// </summary>
    [TestMethod]
    public void CommercialCancellationOnlyAffectsPendingItems()
    {
        var pending = Schedule(Now);
        pending.Cancel();
        Assert.AreEqual(NotificationOutboxStatus.Cancelled, pending.Status);

        var held = Schedule(Now);
        var claim = held.Claim(Now, Lease);
        held.Cancel();
        Assert.AreEqual(NotificationOutboxStatus.Processing, held.Status);
        Assert.AreEqual(claim, held.ClaimToken);

        var dispatched = Schedule(Now);
        var dispatchClaim = dispatched.Claim(Now, Lease);
        dispatched.MarkDispatched(dispatchClaim, Now);
        dispatched.Cancel();
        Assert.AreEqual(NotificationOutboxStatus.Dispatched, dispatched.Status);
    }

    [TestMethod]
    public void ATerminalItemAcceptsNoFurtherTransition()
    {
        foreach (var item in TerminalItems())
        {
            var status = item.Status;
            Assert.IsFalse(item.IsClaimable(Now.AddYears(5)));
            Assert.ThrowsExactly<InvalidOperationException>(() => item.Claim(Now.AddYears(5), Lease));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => item.MarkDispatched(Guid.CreateVersion7(), Now));
            Assert.ThrowsExactly<InvalidOperationException>(
                () => item.MarkRetrying(Guid.CreateVersion7(), Now.AddHours(1), NotificationFailureCodes.DispatchTransient));
            item.Cancel();
            Assert.AreEqual(status, item.Status, "A terminal item must not change status.");
        }
    }

    [TestMethod]
    public void ClaimingRejectsANonPositiveLease()
    {
        var item = Schedule(Now);

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => item.Claim(Now, TimeSpan.Zero));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => item.Claim(Now, TimeSpan.FromSeconds(-1)));
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
        var item = Schedule(Now);
        var now = Now;

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var claim = item.Claim(now, Lease);
            var next = NotificationRetryPolicy.NextAttemptAtUtc(attempt, 6, now);
            Assert.IsNotNull(next, $"Attempt {attempt} should still have been retryable.");
            item.MarkRetrying(claim, next.Value, NotificationFailureCodes.DispatchTransient);
            Assert.AreEqual(NotificationOutboxStatus.Pending, item.Status);
            now = next.Value;
        }

        var finalClaim = item.Claim(now, Lease);
        Assert.AreEqual(6, item.AttemptCount);
        Assert.IsNull(NotificationRetryPolicy.NextAttemptAtUtc(6, 6, now));
        item.MarkDeadLettered(finalClaim, now, NotificationFailureCodes.AttemptsExhausted);

        Assert.AreEqual(NotificationOutboxStatus.DeadLettered, item.Status);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, item.FailureCode);
        Assert.AreEqual(6, item.AttemptCount);
    }

    [TestMethod]
    public void AbandonedClaimsConsumeTheMaximumAndCannotCreateAttemptFour()
    {
        const int MaximumAttempts = 3;
        var item = Schedule(Now);
        var now = Now;

        for (var attempt = 1; attempt <= MaximumAttempts; attempt++)
        {
            item.Claim(now, Lease, MaximumAttempts);
            Assert.AreEqual(attempt, item.AttemptCount);
            now = now.Add(Lease);
        }

        Assert.IsTrue(item.IsClaimExpired(now));
        Assert.ThrowsExactly<InvalidOperationException>(() => item.Claim(now, Lease, MaximumAttempts));
        item.MarkAttemptsExhausted(now);

        Assert.AreEqual(NotificationOutboxStatus.DeadLettered, item.Status);
        Assert.AreEqual(NotificationFailureCodes.AttemptsExhausted, item.FailureCode);
        Assert.AreEqual(MaximumAttempts, item.AttemptCount);
        Assert.IsNull(item.ClaimToken);
    }

    [TestMethod]
    public void APermanentFailureDeadLettersOnItsFirstAttempt()
    {
        var item = Schedule(Now);
        var claim = item.Claim(Now, Lease);

        item.MarkDeadLettered(claim, Now, NotificationFailureCodes.AggregateMismatch);

        Assert.AreEqual(1, item.AttemptCount);
        Assert.AreEqual(NotificationOutboxStatus.DeadLettered, item.Status);
        Assert.AreEqual(NotificationFailureCodes.AggregateMismatch, item.FailureCode);
    }

    [TestMethod]
    public void AnAttemptRecordsItsClaimAndAStableProviderIdempotencyKey()
    {
        var outboxItemId = Guid.CreateVersion7();
        var claim = Guid.CreateVersion7();
        var attempt = NotificationDeliveryAttempt.Start(
            TenantId,
            outboxItemId,
            NotificationChannel.InApp,
            1,
            claim,
            Now);

        Assert.AreEqual(NotificationDeliveryOutcome.Started, attempt.Outcome);
        Assert.IsFalse(attempt.IsCompleted);
        Assert.IsNull(attempt.CompletedAtUtc);
        Assert.IsNull(attempt.ProviderMessageId);
        Assert.AreEqual(claim, attempt.ClaimToken);
        // Stable for the intent and channel, deliberately not for the attempt: a retry has to be
        // recognisable by a provider as the same message.
        Assert.AreEqual(
            NotificationDeliveryAttempt.BuildIdempotencyKey(outboxItemId, NotificationChannel.InApp),
            attempt.IdempotencyKey);
        Assert.AreEqual(
            attempt.IdempotencyKey,
            NotificationDeliveryAttempt.Start(TenantId, outboxItemId, NotificationChannel.InApp, 2, Guid.CreateVersion7(), Now)
                .IdempotencyKey);
    }

    [TestMethod]
    public void ACompletedAttemptIsImmutableWhateverItCompletedAs()
    {
        foreach (var complete in CompletionActions())
        {
            var attempt = NotificationDeliveryAttempt.Start(
                TenantId,
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

    private static IEnumerable<NotificationOutboxItem> TerminalItems()
    {
        var dispatched = Schedule(Now);
        dispatched.MarkDispatched(dispatched.Claim(Now, Lease), Now);
        yield return dispatched;

        var deadLettered = Schedule(Now);
        deadLettered.MarkDeadLettered(
            deadLettered.Claim(Now, Lease),
            Now,
            NotificationFailureCodes.AttemptsExhausted);
        yield return deadLettered;

        var cancelled = Schedule(Now);
        cancelled.Cancel();
        yield return cancelled;
    }

    private static NotificationOutboxItem Schedule(DateTimeOffset scheduledAtUtc) =>
        NotificationOutboxItem.Schedule(
            TenantId,
            RecipientId,
            EnrollmentId,
            CommercialNotificationKind.EnrollmentEndingSoon,
            $"enrollment:{EnrollmentId:N}:ending-soon:v1",
            $"{{\"enrollmentId\":\"{EnrollmentId}\",\"clientProfileId\":\"{Guid.CreateVersion7()}\",\"schemaVersion\":1}}",
            scheduledAtUtc,
            "Asia/Beirut");
}
