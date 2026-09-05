using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

/// <summary>
/// One durable request to mail one logical send of one invitation.
/// </summary>
/// <remarks>
/// Tenant-owned, because an invitation is a workspace's own act — unlike account confirmation and
/// password reset, which belong to a global Identity account and are queued separately. The invitee
/// may not be a member yet, and may never become one, so the recipient is resolved through the
/// invitation aggregate at materialization rather than through membership.
/// <para>
/// It carries identifiers and provenance and nothing else: no address, no token, no link, no wording.
/// The token is minted at materialization, its hash is committed before the provider is invoked, and
/// the raw value never leaves the local variable it was created in.
/// </para>
/// <para>
/// The row is pinned to one <see cref="LogicalSendGeneration"/> and is unique on it. That is what makes
/// the two operations structurally different rather than merely intended to be: a transport retry
/// re-uses this row and therefore this generation, while a deliberate resend creates a
/// <i>new</i> row at the next generation. A retry cannot rotate a generation because it has nowhere to
/// write a new one.
/// </para>
/// </remarks>
public sealed class InvitationActionMailRequest : TenantEntity
{
    public const int CurrentSchemaVersion = 1;

    private InvitationActionMailRequest()
    {
    }

    private InvitationActionMailRequest(
        Guid tenantId,
        Guid invitationId,
        int logicalSendGeneration,
        Guid idempotencyKey,
        string payloadFingerprint,
        string requestSource,
        Guid? requestedByUserId,
        DateTimeOffset requestedAtUtc)
        : base(tenantId)
    {
        if (invitationId == Guid.Empty)
        {
            throw new ArgumentException("An invitation id is required.", nameof(invitationId));
        }

        if (logicalSendGeneration < ClientInvitation.FirstLogicalSendGeneration)
        {
            throw new ArgumentOutOfRangeException(
                nameof(logicalSendGeneration),
                "Logical send generations start at 1.");
        }

        if (idempotencyKey == Guid.Empty)
        {
            throw new ArgumentException("An idempotency key is required.", nameof(idempotencyKey));
        }

        if (!InvitationTokenHash.IsValid(payloadFingerprint))
        {
            throw new ArgumentException(
                "A payload fingerprint is 64 lowercase hexadecimal characters.",
                nameof(payloadFingerprint));
        }

        InvitationId = invitationId;
        LogicalSendGeneration = logicalSendGeneration;
        SchemaVersion = CurrentSchemaVersion;
        IdempotencyKey = idempotencyKey;
        PayloadFingerprint = payloadFingerprint;
        RequestSource = Normalize(requestSource, 60, nameof(requestSource));
        RequestedByUserId = requestedByUserId;
        RequestedAtUtc = requestedAtUtc;
        NextAttemptAtUtc = requestedAtUtc;
        Status = InvitationActionMailStatus.Pending;
    }

    public Guid InvitationId { get; private set; }

    public int LogicalSendGeneration { get; private set; }

    public int SchemaVersion { get; private set; }

    /// <summary>The caller's key for this command. Unique per workspace.</summary>
    public Guid IdempotencyKey { get; private set; }

    /// <summary>
    /// The normalized command payload this key was spent on. A repeat with the same key and the same
    /// payload replays; a repeat with the same key and a different payload conflicts.
    /// </summary>
    public string PayloadFingerprint { get; private set; } = string.Empty;

    public string RequestSource { get; private set; } = string.Empty;

    /// <summary>The coach or owner who asked. Null only for a system-originated first send.</summary>
    public Guid? RequestedByUserId { get; private set; }

    public DateTimeOffset RequestedAtUtc { get; private set; }

    public InvitationActionMailStatus Status { get; private set; }

    public int AttemptCount { get; private set; }

    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    public Guid? ClaimToken { get; private set; }

    public DateTimeOffset? ClaimExpiresAtUtc { get; private set; }

    public DateTimeOffset? MaterializedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public DateTimeOffset? DeadLetteredAtUtc { get; private set; }

    public string? FailureCode { get; private set; }

    public string? TransportAdapter { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public DateTimeOffset? ProviderAcceptedAtUtc { get; private set; }

    public bool IsTerminal => Status is InvitationActionMailStatus.Materialized
        or InvitationActionMailStatus.Suppressed
        or InvitationActionMailStatus.DeadLettered;

    public static InvitationActionMailRequest For(
        Guid tenantId,
        Guid invitationId,
        int logicalSendGeneration,
        Guid idempotencyKey,
        string payloadFingerprint,
        string requestSource,
        Guid? requestedByUserId,
        DateTimeOffset requestedAtUtc) =>
        new(
            tenantId,
            invitationId,
            logicalSendGeneration,
            idempotencyKey,
            payloadFingerprint,
            requestSource,
            requestedByUserId,
            requestedAtUtc);

    public bool IsClaimable(DateTimeOffset now) =>
        (Status == InvitationActionMailStatus.Pending && NextAttemptAtUtc <= now) || IsClaimExpired(now);

    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == InvitationActionMailStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    public Guid Claim(DateTimeOffset now, TimeSpan lease, int maximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        InvitationActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This invitation action mail request is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This invitation action mail request has exhausted its attempts.");
        }

        Status = InvitationActionMailStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    public int StartAttempt(Guid claimToken, int maximumAttempts)
    {
        RequireClaim(claimToken);
        InvitationActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This invitation action mail request has exhausted its attempts.");
        }

        AttemptCount++;
        return AttemptCount;
    }

    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal request cannot exhaust attempts again.");
        }

        if (Status != InvitationActionMailStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can exhaust its attempts.");
        }

        Status = InvitationActionMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = InvitationActionMailCodes.AttemptsExhausted;
        ReleaseClaim();
    }

    public void MarkMaterialized(
        Guid claimToken,
        DateTimeOffset now,
        string transportAdapter,
        string? providerMessageId = null)
    {
        RequireClaim(claimToken);
        var adapter = Normalize(transportAdapter, 40, nameof(transportAdapter));
        if (providerMessageId is not null && !InvitationActionMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Status = InvitationActionMailStatus.Materialized;
        MaterializedAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = null;
        TransportAdapter = adapter;
        ProviderMessageId = providerMessageId;
        ProviderAcceptedAtUtc = providerMessageId is null ? null : now;
        ReleaseClaim();
    }

    public void MarkRetrying(Guid claimToken, DateTimeOffset nextAttemptAtUtc, string failureCode)
    {
        RequireClaim(claimToken);
        if (nextAttemptAtUtc <= NextAttemptAtUtc)
        {
            throw new ArgumentOutOfRangeException(
                nameof(nextAttemptAtUtc),
                "A retry must move the request forward.");
        }

        Status = InvitationActionMailStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = InvitationActionMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void Suppress(Guid claimToken, DateTimeOffset now, string reasonCode)
    {
        RequireClaim(claimToken);
        CompleteSuppression(now, reasonCode);
    }

    public void SuppressBeforeClaim(DateTimeOffset now, string reasonCode)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal request cannot be suppressed again.");
        }

        if (Status != InvitationActionMailStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can be suppressed before a claim.");
        }

        CompleteSuppression(now, reasonCode);
    }

    private void CompleteSuppression(DateTimeOffset now, string reasonCode)
    {
        Status = InvitationActionMailStatus.Suppressed;
        CompletedAtUtc = now;
        FailureCode = Normalize(reasonCode, 100, nameof(reasonCode));
        ReleaseClaim();
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != InvitationActionMailStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed request can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This request is held by a different claim.");
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
/// One try at materializing one invitation action email.
/// </summary>
/// <remarks>
/// Started, and committed, before a token is minted. The token hash it issues names this attempt, so
/// a token row without a real started attempt is structurally impossible rather than merely unlikely.
/// <para>
/// <see cref="ProviderIdempotencyKey"/> is per attempt, because the payload changes: a later durable
/// attempt mints a new token, so presenting the earlier attempt's key would offer the provider one key
/// with two bodies. It stays unique across the deployment, and a database constraint refuses a second
/// attempt that tries to reuse one.
/// </remarks>
public sealed class InvitationActionMailAttempt : TenantEntity
{
    private InvitationActionMailAttempt()
    {
    }

    private InvitationActionMailAttempt(
        Guid tenantId,
        Guid requestId,
        Guid invitationId,
        int logicalSendGeneration,
        int attemptNumber,
        Guid claimToken,
        string providerIdempotencyKey,
        DateTimeOffset startedAtUtc)
        : base(tenantId)
    {
        if (requestId == Guid.Empty || invitationId == Guid.Empty || claimToken == Guid.Empty)
        {
            throw new ArgumentException("Request, invitation, and claim token are required.");
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        if (logicalSendGeneration < ClientInvitation.FirstLogicalSendGeneration)
        {
            throw new ArgumentOutOfRangeException(
                nameof(logicalSendGeneration),
                "Logical send generations start at 1.");
        }

        RequestId = requestId;
        InvitationId = invitationId;
        LogicalSendGeneration = logicalSendGeneration;
        AttemptNumber = attemptNumber;
        ClaimToken = claimToken;
        ProviderIdempotencyKey = providerIdempotencyKey;
        StartedAtUtc = startedAtUtc;
        Outcome = InvitationActionMailOutcome.Started;
    }

    public Guid RequestId { get; private set; }

    public Guid InvitationId { get; private set; }

    /// <summary>
    /// Carried on the attempt as well as the request, so the composite foreign key makes an attempt
    /// whose generation disagrees with its request impossible.
    /// </summary>
    public int LogicalSendGeneration { get; private set; }

    public int AttemptNumber { get; private set; }

    public Guid ClaimToken { get; private set; }

    public string ProviderIdempotencyKey { get; private set; } = string.Empty;

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset? TokenMintedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public InvitationActionMailOutcome Outcome { get; private set; }

    public string? FailureCode { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public bool IsCompleted => Outcome != InvitationActionMailOutcome.Started;

    /// <summary>
    /// The provider idempotency key for one materialization: request, attempt number, and the exact
    /// mailbox as a truncated keyed fingerprint.
    /// </summary>
    public static string BuildProviderIdempotencyKey(
        Guid requestId,
        int attemptNumber,
        string addressFingerprint)
    {
        if (requestId == Guid.Empty)
        {
            throw new ArgumentException("A request id is required.", nameof(requestId));
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        if (!InvitationTokenHash.IsValid(addressFingerprint))
        {
            throw new ArgumentException(
                "A provider idempotency key binds a valid address fingerprint.",
                nameof(addressFingerprint));
        }

        return $"invitation-action:{requestId:N}:a{attemptNumber}:v1:{addressFingerprint[..32]}";
    }

    public static InvitationActionMailAttempt Start(
        Guid tenantId,
        Guid requestId,
        Guid invitationId,
        int logicalSendGeneration,
        int attemptNumber,
        Guid claimToken,
        string providerIdempotencyKey,
        DateTimeOffset startedAtUtc) =>
        new(
            tenantId,
            requestId,
            invitationId,
            logicalSendGeneration,
            attemptNumber,
            claimToken,
            providerIdempotencyKey,
            startedAtUtc);

    public void RecordTokenMinted(DateTimeOffset now)
    {
        if (IsCompleted)
        {
            throw new InvalidOperationException("A completed attempt is immutable.");
        }

        if (TokenMintedAtUtc is not null)
        {
            throw new InvalidOperationException("One attempt mints one token.");
        }

        TokenMintedAtUtc = now;
    }

    public void Succeed(DateTimeOffset now, string? providerMessageId = null)
    {
        if (providerMessageId is not null && !InvitationActionMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Complete(InvitationActionMailOutcome.Succeeded, now, null);
        ProviderMessageId = providerMessageId;
    }

    public void FailTransiently(DateTimeOffset now, string failureCode) =>
        Complete(InvitationActionMailOutcome.TransientFailure, now, failureCode);

    public void FailPermanently(DateTimeOffset now, string failureCode) =>
        Complete(InvitationActionMailOutcome.PermanentFailure, now, failureCode);

    public void Suppress(DateTimeOffset now, string reasonCode) =>
        Complete(InvitationActionMailOutcome.Suppressed, now, reasonCode);

    public void Abandon(DateTimeOffset now, string failureCode) =>
        Complete(InvitationActionMailOutcome.Abandoned, now, failureCode);

    private void Complete(InvitationActionMailOutcome outcome, DateTimeOffset now, string? failureCode)
    {
        if (IsCompleted)
        {
            throw new InvalidOperationException("A completed attempt is immutable.");
        }

        Outcome = outcome;
        CompletedAtUtc = now;
        FailureCode = failureCode is null ? null : Normalize(failureCode, 100, nameof(failureCode));
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

public enum InvitationActionMailStatus
{
    Pending = 1,
    Processing = 2,
    Materialized = 3,
    Suppressed = 4,
    DeadLettered = 5,
}

public enum InvitationActionMailOutcome
{
    Started = 1,
    Succeeded = 2,
    TransientFailure = 3,
    PermanentFailure = 4,
    Abandoned = 5,
    Suppressed = 6,
}
