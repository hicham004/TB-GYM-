using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

/// <summary>
/// One durable request to email one person one fact about their place in a workspace.
/// </summary>
/// <remarks>
/// The third action-mail queue, beside account mail and invitation mail, and deliberately the plainest:
/// it carries no link and no credential, only a fixed wording chosen by <see cref="Kind"/>. It is
/// tenant-owned because a workspace decided it, and it is addressed through a membership row rather than
/// an address, because the people it tells — a released client today, an owner about billing later —
/// have or had one. A membership row is never deleted, so the recipient stays resolvable after they
/// leave, which is exactly when this queue is used.
/// <para>
/// One request per workspace, kind and subject, enforced by a unique index: a release happens once, so
/// its notice is sent once. What the request carries is identifiers only. The address is resolved and
/// the wording rendered at materialization, in memory, and dropped.
/// </para>
/// </remarks>
public sealed class WorkspaceNoticeMailRequest : TenantEntity
{
    public const int CurrentSchemaVersion = 1;

    private WorkspaceNoticeMailRequest()
    {
    }

    private WorkspaceNoticeMailRequest(
        Guid tenantId,
        WorkspaceNoticeKind kind,
        Guid recipientUserId,
        Guid subjectId,
        Guid? requestedByUserId,
        DateTimeOffset requestedAtUtc)
        : base(tenantId)
    {
        if (!Enum.IsDefined(kind))
        {
            throw new ArgumentOutOfRangeException(nameof(kind), "A notice kind is required.");
        }

        if (recipientUserId == Guid.Empty || subjectId == Guid.Empty)
        {
            throw new ArgumentException("A recipient and a subject are required.");
        }

        Kind = kind;
        RecipientUserId = recipientUserId;
        SubjectId = subjectId;
        SchemaVersion = CurrentSchemaVersion;
        RequestedByUserId = requestedByUserId;
        RequestedAtUtc = requestedAtUtc;
        NextAttemptAtUtc = requestedAtUtc;
        Status = WorkspaceNoticeMailStatus.Pending;
    }

    public WorkspaceNoticeKind Kind { get; private set; }

    /// <summary>The member, current or former, this notice is for.</summary>
    public Guid RecipientUserId { get; private set; }

    /// <summary>
    /// What the notice is about: for <see cref="WorkspaceNoticeKind.ClientReleased"/> the client
    /// profile, for <see cref="WorkspaceNoticeKind.CoachDeparted"/> the coach-history entry that moved
    /// the client, so a client whose coach leaves twice is told twice.
    /// </summary>
    public Guid SubjectId { get; private set; }

    public int SchemaVersion { get; private set; }

    public Guid? RequestedByUserId { get; private set; }

    public DateTimeOffset RequestedAtUtc { get; private set; }

    public WorkspaceNoticeMailStatus Status { get; private set; }

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

    public bool IsTerminal => Status is WorkspaceNoticeMailStatus.Materialized
        or WorkspaceNoticeMailStatus.Suppressed
        or WorkspaceNoticeMailStatus.DeadLettered;

    /// <summary>The notice that a client's access to the workspace has ended.</summary>
    public static WorkspaceNoticeMailRequest ClientReleased(
        Guid tenantId,
        Guid clientUserId,
        Guid clientProfileId,
        Guid? releasedByUserId,
        DateTimeOffset releasedAtUtc) =>
        new(
            tenantId,
            WorkspaceNoticeKind.ClientReleased,
            clientUserId,
            clientProfileId,
            releasedByUserId,
            releasedAtUtc);

    /// <summary>The notice that a client's coach left the workspace and the client moved to the owner.</summary>
    public static WorkspaceNoticeMailRequest CoachDeparted(
        Guid tenantId,
        Guid clientUserId,
        Guid coachAssignmentId,
        Guid? requestedByUserId,
        DateTimeOffset requestedAtUtc) =>
        new(
            tenantId,
            WorkspaceNoticeKind.CoachDeparted,
            clientUserId,
            coachAssignmentId,
            requestedByUserId,
            requestedAtUtc);

    public bool IsClaimable(DateTimeOffset now) =>
        (Status == WorkspaceNoticeMailStatus.Pending && NextAttemptAtUtc <= now) || IsClaimExpired(now);

    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == WorkspaceNoticeMailStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    public Guid Claim(DateTimeOffset now, TimeSpan lease, int maximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        WorkspaceNoticeMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This workspace notice is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This workspace notice has exhausted its attempts.");
        }

        Status = WorkspaceNoticeMailStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    public int StartAttempt(Guid claimToken, int maximumAttempts)
    {
        RequireClaim(claimToken);
        WorkspaceNoticeMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This workspace notice has exhausted its attempts.");
        }

        AttemptCount++;
        return AttemptCount;
    }

    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal notice cannot exhaust attempts again.");
        }

        if (Status != WorkspaceNoticeMailStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can exhaust its attempts.");
        }

        Status = WorkspaceNoticeMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = WorkspaceNoticeMailCodes.AttemptsExhausted;
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
        if (providerMessageId is not null && !WorkspaceNoticeMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Status = WorkspaceNoticeMailStatus.Materialized;
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
            throw new ArgumentOutOfRangeException(nameof(nextAttemptAtUtc), "A retry must move the request forward.");
        }

        Status = WorkspaceNoticeMailStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = WorkspaceNoticeMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void Suppress(Guid claimToken, DateTimeOffset now, string reasonCode)
    {
        RequireClaim(claimToken);
        Status = WorkspaceNoticeMailStatus.Suppressed;
        CompletedAtUtc = now;
        FailureCode = Normalize(reasonCode, 100, nameof(reasonCode));
        ReleaseClaim();
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != WorkspaceNoticeMailStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed notice can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This notice is held by a different claim.");
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
/// One try at materializing one workspace notice.
/// </summary>
/// <remarks>
/// Started and committed before the provider is called, so a crash mid-send leaves evidence that work
/// began. The provider idempotency key is per attempt and unique across the deployment.
/// </remarks>
public sealed class WorkspaceNoticeMailAttempt : TenantEntity
{
    private WorkspaceNoticeMailAttempt()
    {
    }

    private WorkspaceNoticeMailAttempt(
        Guid tenantId,
        Guid requestId,
        int attemptNumber,
        Guid claimToken,
        string providerIdempotencyKey,
        DateTimeOffset startedAtUtc)
        : base(tenantId)
    {
        if (requestId == Guid.Empty || claimToken == Guid.Empty)
        {
            throw new ArgumentException("Request and claim token are required.");
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        RequestId = requestId;
        AttemptNumber = attemptNumber;
        ClaimToken = claimToken;
        ProviderIdempotencyKey = providerIdempotencyKey;
        StartedAtUtc = startedAtUtc;
        Outcome = WorkspaceNoticeMailOutcome.Started;
    }

    public Guid RequestId { get; private set; }

    public int AttemptNumber { get; private set; }

    public Guid ClaimToken { get; private set; }

    public string ProviderIdempotencyKey { get; private set; } = string.Empty;

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public WorkspaceNoticeMailOutcome Outcome { get; private set; }

    public string? FailureCode { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public bool IsCompleted => Outcome != WorkspaceNoticeMailOutcome.Started;

    /// <summary>
    /// The provider idempotency key for one materialization: request, attempt number, and the exact
    /// mailbox as a truncated keyed fingerprint.
    /// </summary>
    public static string BuildProviderIdempotencyKey(Guid requestId, int attemptNumber, string addressFingerprint)
    {
        if (requestId == Guid.Empty)
        {
            throw new ArgumentException("A request id is required.", nameof(requestId));
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        if (!WorkspaceNoticeMailDigest.IsValid(addressFingerprint))
        {
            throw new ArgumentException(
                "A provider idempotency key binds a valid address fingerprint.",
                nameof(addressFingerprint));
        }

        return $"workspace-notice:{requestId:N}:a{attemptNumber}:v1:{addressFingerprint[..32]}";
    }

    public static WorkspaceNoticeMailAttempt Start(
        Guid tenantId,
        Guid requestId,
        int attemptNumber,
        Guid claimToken,
        string providerIdempotencyKey,
        DateTimeOffset startedAtUtc) =>
        new(tenantId, requestId, attemptNumber, claimToken, providerIdempotencyKey, startedAtUtc);

    public void Succeed(DateTimeOffset now, string? providerMessageId = null)
    {
        if (providerMessageId is not null && !WorkspaceNoticeMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Complete(WorkspaceNoticeMailOutcome.Succeeded, now, null);
        ProviderMessageId = providerMessageId;
    }

    public void FailTransiently(DateTimeOffset now, string failureCode) =>
        Complete(WorkspaceNoticeMailOutcome.TransientFailure, now, failureCode);

    public void FailPermanently(DateTimeOffset now, string failureCode) =>
        Complete(WorkspaceNoticeMailOutcome.PermanentFailure, now, failureCode);

    public void Suppress(DateTimeOffset now, string reasonCode) =>
        Complete(WorkspaceNoticeMailOutcome.Suppressed, now, reasonCode);

    public void Abandon(DateTimeOffset now, string failureCode) =>
        Complete(WorkspaceNoticeMailOutcome.Abandoned, now, failureCode);

    private void Complete(WorkspaceNoticeMailOutcome outcome, DateTimeOffset now, string? failureCode)
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

public enum WorkspaceNoticeKind
{
    /// <summary>The owner released the recipient, a client, from the workspace.</summary>
    ClientReleased = 1,

    /// <summary>The recipient's coach resigned or was removed; the workspace will assign a new one.</summary>
    CoachDeparted = 2,
}

public enum WorkspaceNoticeMailStatus
{
    Pending = 1,
    Processing = 2,
    Materialized = 3,
    Suppressed = 4,
    DeadLettered = 5,
}

public enum WorkspaceNoticeMailOutcome
{
    Started = 1,
    Succeeded = 2,
    TransientFailure = 3,
    PermanentFailure = 4,
    Abandoned = 5,
    Suppressed = 6,
}
