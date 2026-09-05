using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One channel's own durable delivery of one logical notification.
/// </summary>
/// <remarks>
/// Phase 6B-1 kept the dispatch lifecycle on the outbox item itself, which was honest while exactly
/// one channel existed and stops being honest the moment a second one does: an item cannot be both
/// "the in-app row was written" and "the email is waiting to retry". This row is that missing thing.
/// <para>
/// The logical notification — who should be told what, and when it became due — stays on
/// <see cref="NotificationOutboxItem"/> and never moves again. Everything that can differ between
/// channels lives here: status, due instant, attempt count, claim lease, terminal result, transport
/// metadata and quiet-hours deferrals. At most one delivery exists per intent and channel, and no
/// channel can read, block or complete another one's state.
/// </para>
/// <para>
/// Lifecycle: Pending -&gt; Processing -&gt; Materialized | Suppressed | DeadLettered, with a
/// retryable failure returning to Pending at a later <see cref="NextAttemptAtUtc"/>, and a
/// quiet-hours deferral moving that instant forward without consuming an attempt. Materialized means
/// this channel produced its own artefact — an inbox row for in-app, a message handed to the
/// configured transport for email. It is deliberately not called delivered: nothing here claims a
/// provider accepted anything, that a recipient's mail server took it, or that a person read it.
/// </para>
/// </remarks>
public sealed class NotificationChannelDelivery : TenantEntity
{
    private NotificationChannelDelivery()
    {
    }

    private NotificationChannelDelivery(
        Guid tenantId,
        Guid outboxItemId,
        NotificationChannel channel,
        NotificationPurpose purpose,
        string selectionReason,
        int selectionPolicyVersion,
        DateTimeOffset dueAtUtc)
        : base(tenantId)
    {
        if (outboxItemId == Guid.Empty || !Enum.IsDefined(channel) || !Enum.IsDefined(purpose))
        {
            throw new ArgumentException("A channel delivery needs an intent, a channel, and a purpose.");
        }

        if (selectionPolicyVersion < 1)
        {
            throw new ArgumentOutOfRangeException(
                nameof(selectionPolicyVersion),
                "A channel selection policy version starts at 1.");
        }

        OutboxItemId = outboxItemId;
        Channel = channel;
        Purpose = purpose;
        SelectionReason = Normalize(selectionReason, 100, nameof(selectionReason));
        SelectionPolicyVersion = selectionPolicyVersion;
        DueAtUtc = dueAtUtc;
        NextAttemptAtUtc = dueAtUtc;
        Status = NotificationDeliveryStatus.Pending;
    }

    public Guid OutboxItemId { get; private set; }

    public NotificationChannel Channel { get; private set; }

    /// <summary>
    /// Why this notification exists at all, as an explicit owned classification rather than something
    /// inferred from the wording. Marketing may never ride on a service preference.
    /// </summary>
    public NotificationPurpose Purpose { get; private set; }

    /// <summary>
    /// The stable code explaining why this channel was selected when the intent was scheduled.
    /// Snapshotted so historical behaviour can be explained without re-reading a preference that has
    /// since changed.
    /// </summary>
    public string SelectionReason { get; private set; } = string.Empty;

    /// <summary>The channel-selection policy version in force when this row was created.</summary>
    public int SelectionPolicyVersion { get; private set; }

    public NotificationDeliveryStatus Status { get; private set; }

    /// <summary>Every durably started attempt, including one abandoned when a lease expired.</summary>
    public int AttemptCount { get; private set; }

    /// <summary>When this channel first became due. Never rewritten.</summary>
    public DateTimeOffset DueAtUtc { get; private set; }

    /// <summary>
    /// The earliest instant a dispatcher may claim this delivery. Moves forward with every retryable
    /// failure and with every quiet-hours deferral, so both are durable state rather than something a
    /// worker holds in memory — and a deferred row is invisible to the sweep instead of being polled.
    /// </summary>
    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    public Guid? ClaimToken { get; private set; }

    public DateTimeOffset? ClaimExpiresAtUtc { get; private set; }

    /// <summary>
    /// When this channel produced its own artefact. For in-app that is the inbox row; for email it is
    /// a message materialized and handed to the configured transport. Not provider acceptance.
    /// </summary>
    public DateTimeOffset? MaterializedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public DateTimeOffset? DeadLetteredAtUtc { get; private set; }

    /// <summary>
    /// A stable, bounded, non-sensitive classification of the last thing that went wrong, or of why
    /// this channel was suppressed. Never an exception message, an address, or payload content.
    /// </summary>
    public string? FailureCode { get; private set; }

    /// <summary>
    /// Which transport produced <see cref="MaterializedAtUtc"/>, when one was involved. In-app has no
    /// transport and leaves this null; the captured development adapter records <c>captured</c> and
    /// can never record a provider identifier, because it never contacted one.
    /// </summary>
    public string? TransportAdapter { get; private set; }

    /// <summary>
    /// The identifier a real provider returned for the request it accepted, or null when no provider
    /// was contacted. The captured adapter can never set it — inventing an identifier for a capture
    /// would be a lie about where it came from — and a database check and a trigger both refuse it.
    /// </summary>
    public string? ProviderMessageId { get; private set; }

    /// <summary>
    /// When a real provider accepted responsibility for the request.
    /// </summary>
    /// <remarks>
    /// Written in the same statement that makes this delivery terminal, because it is synchronous:
    /// the provider answered before the transaction committed. Everything the provider says
    /// afterwards — that a mail server accepted it, that it bounced, that somebody complained —
    /// arrives asynchronously and out of order and belongs to
    /// <see cref="NotificationProviderMessage"/>, so a terminal delivery stays immutable.
    /// <para>
    /// Provider acceptance, recipient-server acceptance and human read are three separate facts and
    /// none is ever written from another.
    /// </para>
    /// </remarks>
    public DateTimeOffset? ProviderAcceptedAtUtc { get; private set; }

    /// <summary>How many times quiet hours have moved this delivery forward. Never an attempt.</summary>
    public int DeferralCount { get; private set; }

    public DateTimeOffset? DeferredUntilUtc { get; private set; }

    /// <summary>A stable code explaining the most recent deferral. Never a recipient or a wording.</summary>
    public string? DeferralCode { get; private set; }

    public bool IsTerminal => Status is NotificationDeliveryStatus.Materialized
        or NotificationDeliveryStatus.Suppressed
        or NotificationDeliveryStatus.DeadLettered;

    public static NotificationChannelDelivery Select(
        Guid tenantId,
        Guid outboxItemId,
        NotificationChannel channel,
        NotificationPurpose purpose,
        string selectionReason,
        int selectionPolicyVersion,
        DateTimeOffset dueAtUtc) =>
        new(
            tenantId,
            outboxItemId,
            channel,
            purpose,
            selectionReason,
            selectionPolicyVersion,
            dueAtUtc);

    public bool IsClaimable(DateTimeOffset now) =>
        (Status == NotificationDeliveryStatus.Pending && NextAttemptAtUtc <= now) || IsClaimExpired(now);

    /// <summary>
    /// A claim whose lease has run out. The worker that held it either crashed or lost its
    /// connection; either way this channel must become visible again, or one crash could hide it
    /// permanently — and it must do so without disturbing any other channel of the same intent.
    /// </summary>
    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == NotificationDeliveryStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    /// <summary>
    /// Takes a lease without yet spending an attempt. Eligibility, including quiet hours, is checked
    /// again after this claim commits; only work that survives that final check starts an attempt.
    /// The returned token is what every later transition must present, so a stale worker cannot
    /// overwrite a newer claimant's result.
    /// </summary>
    public Guid Claim(
        DateTimeOffset now,
        TimeSpan lease,
        int maximumAttempts = NotificationDispatchOptions.DefaultMaximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        NotificationDispatchOptions.ValidateMaximumAttempts(maximumAttempts);

        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This channel delivery is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This channel delivery has exhausted its delivery attempts.");
        }

        Status = NotificationDeliveryStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    /// <summary>
    /// Starts the attempt held by a claim after its final eligibility check. This is separate from
    /// <see cref="Claim"/> so a post-claim quiet-hours deferral releases the lease with no attempt.
    /// </summary>
    public int StartAttempt(
        Guid claimToken,
        int maximumAttempts = NotificationDispatchOptions.DefaultMaximumAttempts)
    {
        RequireClaim(claimToken);
        NotificationDispatchOptions.ValidateMaximumAttempts(maximumAttempts);
        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This channel delivery has exhausted its delivery attempts.");
        }

        AttemptCount++;
        return AttemptCount;
    }

    /// <summary>
    /// Quiet hours moved this channel out of the way. The delivery stays Pending and simply becomes
    /// invisible until <paramref name="nextAllowedAtUtc"/>, so the worker never polls it and no
    /// attempt is spent on a decision that nothing was wrong with.
    /// </summary>
    public void Defer(DateTimeOffset now, DateTimeOffset nextAllowedAtUtc, string reasonCode)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal channel delivery cannot be deferred.");
        }

        if (nextAllowedAtUtc <= now)
        {
            throw new ArgumentOutOfRangeException(
                nameof(nextAllowedAtUtc),
                "A deferral must move the delivery into the future.");
        }

        Status = NotificationDeliveryStatus.Pending;
        NextAttemptAtUtc = nextAllowedAtUtc;
        DeferredUntilUtc = nextAllowedAtUtc;
        DeferralCode = Normalize(reasonCode, 100, nameof(reasonCode));
        DeferralCount++;
        ReleaseClaim();
    }

    /// <summary>
    /// Ends due work whose already-started attempts consumed the configured budget. No replacement
    /// attempt is invented merely to record exhaustion: the last real attempt remains in history with
    /// its own outcome, including <c>Abandoned</c> when its lease expired.
    /// </summary>
    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal channel delivery cannot exhaust attempts again.");
        }

        if (Status != NotificationDeliveryStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can exhaust its attempts.");
        }

        Status = NotificationDeliveryStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = NotificationFailureCodes.AttemptsExhausted;
        ReleaseClaim();
    }

    /// <summary>
    /// This channel produced its artefact. <paramref name="transportAdapter"/> names what did it, or
    /// is null for in-app, which has no transport at all.
    /// </summary>
    /// <remarks>
    /// <paramref name="providerMessageId"/> is supplied only when a real provider accepted the
    /// request and returned a usable identifier for it. Passing one for in-app, or for the captured
    /// adapter, is refused here before the database refuses it: recording provider evidence for
    /// something no provider was told about is the exact confusion the whole vocabulary exists to
    /// prevent.
    /// </remarks>
    public void MarkMaterialized(
        Guid claimToken,
        DateTimeOffset now,
        string? transportAdapter = null,
        string? providerMessageId = null)
    {
        RequireClaim(claimToken);
        var adapter = transportAdapter is null
            ? null
            : Normalize(transportAdapter, 40, nameof(transportAdapter));
        if (providerMessageId is not null)
        {
            if (Channel != NotificationChannel.Email || !NotificationEmailAdapters.IsProviderAdapterName(adapter))
            {
                throw new InvalidOperationException(
                    "Only an email delivery materialized by a real provider adapter may record provider evidence.");
            }

            if (!NotificationProviderMessageId.IsValid(providerMessageId))
            {
                throw new ArgumentException(
                    "A provider message identifier must be bounded and use a safe alphabet.",
                    nameof(providerMessageId));
            }
        }

        Status = NotificationDeliveryStatus.Materialized;
        MaterializedAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = null;
        TransportAdapter = adapter;
        ProviderMessageId = providerMessageId;
        ProviderAcceptedAtUtc = providerMessageId is null ? null : now;
        ReleaseClaim();
    }

    /// <summary>A transient failure. This channel alone waits; every other channel is untouched.</summary>
    public void MarkRetrying(Guid claimToken, DateTimeOffset nextAttemptAtUtc, string failureCode)
    {
        RequireClaim(claimToken);
        Status = NotificationDeliveryStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = NotificationDeliveryStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    /// <summary>
    /// Suppression discovered after a claim commits. The already-started attempt is real history and
    /// completes as suppressed; no replacement attempt is created and no retry is earned.
    /// </summary>
    public void Suppress(Guid claimToken, DateTimeOffset now, string reasonCode)
    {
        RequireClaim(claimToken);
        CompleteSuppression(now, reasonCode);
    }

    /// <summary>
    /// Suppression discovered before anything was tried — inside the claim transaction, or from the
    /// business command that withdrew the intent. It costs no attempt, because nothing was tried.
    /// </summary>
    public void SuppressBeforeClaim(DateTimeOffset now, string reasonCode)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal channel delivery cannot be suppressed again.");
        }

        if (Status != NotificationDeliveryStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can be suppressed before a claim.");
        }

        CompleteSuppression(now, reasonCode);
    }

    /// <summary>
    /// The business withdrew the intent.
    /// </summary>
    /// <remarks>
    /// Deliberately a no-op on anything a worker currently holds, and on anything already terminal.
    /// A delivery under an active claim is left alone rather than pulled out from under its worker:
    /// the dispatcher re-establishes eligibility before it materializes anything, finds the reason
    /// gone, and suppresses its own claimed row honestly with the attempt it already started.
    /// </remarks>
    public bool CancelIfPending(DateTimeOffset now)
    {
        if (Status != NotificationDeliveryStatus.Pending)
        {
            return false;
        }

        CompleteSuppression(now, NotificationSuppressionCodes.IntentCancelled);
        return true;
    }

    private void CompleteSuppression(DateTimeOffset now, string reasonCode)
    {
        Status = NotificationDeliveryStatus.Suppressed;
        CompletedAtUtc = now;
        FailureCode = Normalize(reasonCode, 100, nameof(reasonCode));
        ReleaseClaim();
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != NotificationDeliveryStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed channel delivery can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This channel delivery is held by a different claim.");
        }
    }

    private void ReleaseClaim()
    {
        ClaimToken = null;
        ClaimExpiresAtUtc = null;
    }

    private static string Normalize(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }
}

/// <summary>
/// What one channel's delivery has managed to do.
/// </summary>
/// <remarks>
/// Every member names exactly one fact and no member is a synonym for another. In particular there is
/// no <c>Delivered</c>: this phase can establish that an inbox row exists or that a message was
/// materialized and captured, and neither of those is a claim that a provider accepted anything, that
/// a recipient's mail server took it, or that a person read it.
/// </remarks>
public enum NotificationDeliveryStatus
{
    /// <summary>Selected for this channel and waiting for its due instant, or for quiet hours to end.</summary>
    Pending = 1,

    /// <summary>Reserved by one dispatcher under a lease; an attempt may start after the final recheck.</summary>
    Processing = 2,

    /// <summary>This channel produced its artefact. Not provider acceptance, and not read.</summary>
    Materialized = 3,

    /// <summary>The reason to deliver over this channel went away. Not a failure and not a dead letter.</summary>
    Suppressed = 4,

    /// <summary>Eligible, and the dispatcher could not safely complete it.</summary>
    DeadLettered = 5,
}

/// <summary>
/// Why a notification exists, as an owned classification rather than something inferred from wording.
/// </summary>
/// <remarks>
/// Every notification this repository produces is service/transactional: it states a fact about a
/// relationship or a service the recipient already has with the workspace. <see cref="Marketing"/>
/// reserves the vocabulary and nothing produces it in this phase; the planner fails it closed without
/// current affirmative consent, and it may never ride on the service-email preference. Describing
/// promotional material as transactional to avoid consent and opt-out obligations is exactly the
/// thing this separation exists to make impossible.
/// </remarks>
public enum NotificationPurpose
{
    ServiceTransactional = 1,
    Marketing = 2,
}
