using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// One durable request to send one global Identity action email, holding identifiers and nothing else.
/// </summary>
/// <remarks>
/// This is ADR 0021's tokenless materialization for the two mails that belong to a global account
/// rather than to a workspace: account confirmation and password reset. Both can happen before the
/// account has any membership at all, and one account may belong to several workspaces, so neither is
/// a fact about a tenant and neither may be assigned one.
/// <para>
/// The row records <b>that somebody asked</b>: which action, which account, when, from where, and on
/// whose authority. It never records the credential, the address, the link or the wording. A raw token
/// is minted at materialization from the same Identity token provider that mints it today, held in a
/// local variable for the duration of one transport call and dropped, so a queue row that never held a
/// credential cannot leak one whatever a backup, an export, an operator view or a log aggregator later
/// does with it.
/// </para>
/// <para>
/// Lifecycle: Pending -&gt; Processing -&gt; Materialized | Suppressed | DeadLettered, with a retryable
/// failure returning to Pending at a later <see cref="NextAttemptAtUtc"/>. Every finalization presents
/// the claim token it was issued, so a worker whose lease expired cannot overwrite a newer claimant's
/// result. There is no quiet-hours deferral and no preference gate: this is mail the person asked for
/// seconds ago and cannot proceed without, and it is not a tenant notification.
/// </para>
/// <para>
/// <see cref="SubjectUserId"/> is nullable for one reason, and it is the important one. A password
/// reset for an address nobody has registered must do the same bounded work as one for an address that
/// exists, or the difference is an account-enumeration oracle. So both write a request row; the unknown
/// one carries no subject, no address and nothing reversible to an address, and terminates safely at
/// materialization with a stable suppression code.
/// </para>
/// </remarks>
public sealed class AccountActionMailRequest : AuditableEntity
{
    /// <summary>The payload schema this build writes and can read back.</summary>
    public const int CurrentSchemaVersion = 1;

    private AccountActionMailRequest()
    {
    }

    private AccountActionMailRequest(
        Guid? subjectUserId,
        string? subjectSecurityStampHash,
        AccountActionKind actionKind,
        string requestSource,
        Guid? requestedByUserId,
        DateTimeOffset requestedAtUtc)
    {
        if (!Enum.IsDefined(actionKind))
        {
            throw new ArgumentException("An action mail request needs a known action kind.", nameof(actionKind));
        }

        if (subjectUserId == Guid.Empty)
        {
            throw new ArgumentException(
                "A subject is either a real account or absent; it is never an empty identifier.",
                nameof(subjectUserId));
        }

        if (subjectSecurityStampHash is not null && !AccountActionMailFingerprint.IsValid(subjectSecurityStampHash))
        {
            throw new ArgumentException(
                "A security stamp hash is 64 lowercase hexadecimal characters.",
                nameof(subjectSecurityStampHash));
        }

        if ((subjectUserId is null) != (subjectSecurityStampHash is null))
        {
            throw new ArgumentException(
                "A request either names a subject and the credential state it was made against, or neither.");
        }

        SubjectUserId = subjectUserId;
        SubjectSecurityStampHash = subjectSecurityStampHash;
        ActionKind = actionKind;
        SchemaVersion = CurrentSchemaVersion;
        RequestSource = Normalize(requestSource, 60, nameof(requestSource));
        RequestedByUserId = requestedByUserId;
        RequestedAtUtc = requestedAtUtc;
        NextAttemptAtUtc = requestedAtUtc;
        Status = AccountActionMailStatus.Pending;
    }

    /// <summary>
    /// The account this action concerns, or null when the request was made for an address that
    /// resolves to no account.
    /// </summary>
    public Guid? SubjectUserId { get; private set; }

    /// <summary>
    /// SHA-256 of the account's security stamp at the instant the request was made, or null when there
    /// is no subject.
    /// </summary>
    /// <remarks>
    /// This is how a materialization minutes or hours later knows whether the world the request
    /// described still exists. ASP.NET Core Identity rotates the security stamp on a password change, an
    /// email change and an explicit session revocation, and its own token providers already refuse a
    /// token minted against a stamp that has since moved — so comparing it here means the dispatcher
    /// suppresses rather than mints a credential that would be rejected, and the suppression is a
    /// recorded fact rather than a confusing failure at redemption.
    /// <para>
    /// An unkeyed digest is honest here, unlike one of an email address. A security stamp is a
    /// high-entropy value this application generated; it is not drawn from a small enumerable space, so
    /// the digest is a pseudonym for it rather than a synonym. It is also not a credential: possessing
    /// it proves nothing and it cannot be presented anywhere.
    /// </para>
    /// </remarks>
    public string? SubjectSecurityStampHash { get; private set; }

    public AccountActionKind ActionKind { get; private set; }

    public int SchemaVersion { get; private set; }

    /// <summary>Which flow asked. A stable code, never a URL, an address or free text from a caller.</summary>
    public string RequestSource { get; private set; } = string.Empty;

    /// <summary>
    /// Authorization provenance: the signed-in actor who asked, or null for an anonymous public
    /// request. Recorded because "who asked for this credential to be sent" is a question an incident
    /// has to be able to answer.
    /// </summary>
    public Guid? RequestedByUserId { get; private set; }

    public DateTimeOffset RequestedAtUtc { get; private set; }

    public AccountActionMailStatus Status { get; private set; }

    /// <summary>Every durably started attempt, including one abandoned when a lease expired.</summary>
    public int AttemptCount { get; private set; }

    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    public Guid? ClaimToken { get; private set; }

    public DateTimeOffset? ClaimExpiresAtUtc { get; private set; }

    /// <summary>When a token was minted, rendered and handed to the configured transport.</summary>
    public DateTimeOffset? MaterializedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public DateTimeOffset? DeadLetteredAtUtc { get; private set; }

    /// <summary>A stable, bounded, non-sensitive classification. Never an address or an exception.</summary>
    public string? FailureCode { get; private set; }

    public string? TransportAdapter { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public DateTimeOffset? ProviderAcceptedAtUtc { get; private set; }

    public bool IsTerminal => Status is AccountActionMailStatus.Materialized
        or AccountActionMailStatus.Suppressed
        or AccountActionMailStatus.DeadLettered;

    /// <summary>A request for a real, currently eligible account.</summary>
    public static AccountActionMailRequest For(
        Guid subjectUserId,
        string subjectSecurityStampHash,
        AccountActionKind actionKind,
        string requestSource,
        Guid? requestedByUserId,
        DateTimeOffset requestedAtUtc)
    {
        if (subjectUserId == Guid.Empty)
        {
            throw new ArgumentException("A subject account is required.", nameof(subjectUserId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(subjectSecurityStampHash);
        return new AccountActionMailRequest(
            subjectUserId,
            subjectSecurityStampHash,
            actionKind,
            requestSource,
            requestedByUserId,
            requestedAtUtc);
    }

    /// <summary>
    /// A request whose subject could not be resolved, so that the unresolved path costs the same
    /// bounded work as the resolved one.
    /// </summary>
    /// <remarks>
    /// It carries no address, no hash of an address and no identifier anything could be recovered
    /// from — only the fact that a request of this kind arrived. Materialization terminates it
    /// immediately as suppressed, so it contacts nothing and consumes no attempt budget.
    /// </remarks>
    public static AccountActionMailRequest ForUnresolvedSubject(
        AccountActionKind actionKind,
        string requestSource,
        DateTimeOffset requestedAtUtc) =>
        new(null, null, actionKind, requestSource, null, requestedAtUtc);

    public bool IsClaimable(DateTimeOffset now) =>
        (Status == AccountActionMailStatus.Pending && NextAttemptAtUtc <= now) || IsClaimExpired(now);

    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == AccountActionMailStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    /// <summary>
    /// Takes a lease without yet spending an attempt. Authorization is re-established after this claim
    /// commits and immediately before a token is minted; a committed claim is ownership of work and
    /// never durable permission to send a credential.
    /// </summary>
    public Guid Claim(DateTimeOffset now, TimeSpan lease, int maximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        AccountActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This action mail request is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This action mail request has exhausted its attempts.");
        }

        Status = AccountActionMailStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    public int StartAttempt(Guid claimToken, int maximumAttempts)
    {
        RequireClaim(claimToken);
        AccountActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This action mail request has exhausted its attempts.");
        }

        AttemptCount++;
        return AttemptCount;
    }

    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal action mail request cannot exhaust attempts again.");
        }

        if (Status != AccountActionMailStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can exhaust its attempts.");
        }

        Status = AccountActionMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = AccountActionMailCodes.AttemptsExhausted;
        ReleaseClaim();
    }

    /// <summary>
    /// A token was minted, a link was built from the configured origin, a message was rendered and the
    /// configured transport took it. Not a claim that anything was delivered or read.
    /// </summary>
    public void MarkMaterialized(
        Guid claimToken,
        DateTimeOffset now,
        string transportAdapter,
        string? providerMessageId = null)
    {
        RequireClaim(claimToken);
        var adapter = Normalize(transportAdapter, 40, nameof(transportAdapter));
        if (providerMessageId is not null && !AccountActionMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Status = AccountActionMailStatus.Materialized;
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

        Status = AccountActionMailStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = AccountActionMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    /// <summary>The action is no longer authorized. Discovered after a claim, so its attempt is real.</summary>
    public void Suppress(Guid claimToken, DateTimeOffset now, string reasonCode)
    {
        RequireClaim(claimToken);
        CompleteSuppression(now, reasonCode);
    }

    /// <summary>The action is no longer authorized, discovered before anything was tried.</summary>
    public void SuppressBeforeClaim(DateTimeOffset now, string reasonCode)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal action mail request cannot be suppressed again.");
        }

        if (Status != AccountActionMailStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can be suppressed before a claim.");
        }

        CompleteSuppression(now, reasonCode);
    }

    private void CompleteSuppression(DateTimeOffset now, string reasonCode)
    {
        Status = AccountActionMailStatus.Suppressed;
        CompletedAtUtc = now;
        FailureCode = Normalize(reasonCode, 100, nameof(reasonCode));
        ReleaseClaim();
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != AccountActionMailStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed action mail request can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This action mail request is held by a different claim.");
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
/// One try at materializing one global action email.
/// </summary>
/// <remarks>
/// Started before any token is minted, so a process that dies between minting and sending leaves
/// evidence rather than silence. A completed attempt is immutable and is never deleted.
/// <para>
/// <see cref="ProviderIdempotencyKey"/> is per attempt, deliberately, and this is where action mail
/// parts company with commercial notification mail. A commercial notification's rendered payload is
/// the same on every retry, so the provider may be given one stable key for the logical message. An
/// action email's payload contains a freshly minted token, so a later durable attempt is a
/// <i>different</i> message; presenting the earlier key with different content is exactly what a
/// provider answers with a conflict instead of a send. A new materialization therefore mints a new
/// token and presents a new key, and the guarantee stays at-least-once rather than exactly-once.
/// </para>
/// </remarks>
public sealed class AccountActionMailAttempt : AuditableEntity
{
    private AccountActionMailAttempt()
    {
    }

    private AccountActionMailAttempt(
        Guid requestId,
        AccountActionKind actionKind,
        int attemptNumber,
        Guid claimToken,
        string providerIdempotencyKey,
        DateTimeOffset startedAtUtc)
    {
        if (requestId == Guid.Empty || claimToken == Guid.Empty || !Enum.IsDefined(actionKind))
        {
            throw new ArgumentException("Request, claim token, and action kind are required.");
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        RequestId = requestId;
        ActionKind = actionKind;
        AttemptNumber = attemptNumber;
        ClaimToken = claimToken;
        ProviderIdempotencyKey = providerIdempotencyKey;
        StartedAtUtc = startedAtUtc;
        Outcome = ActionMailAttemptOutcome.Started;
    }

    public Guid RequestId { get; private set; }

    public AccountActionKind ActionKind { get; private set; }

    public int AttemptNumber { get; private set; }

    /// <summary>The claim this attempt was started under, so a stale worker cannot finish it.</summary>
    public Guid ClaimToken { get; private set; }

    /// <summary>The key this attempt's provider request carries. Unique across the deployment.</summary>
    public string ProviderIdempotencyKey { get; private set; } = string.Empty;

    public DateTimeOffset StartedAtUtc { get; private set; }

    /// <summary>
    /// When this attempt minted a raw token. The instant is a durable fact; the token is not, and
    /// exists only as a local variable for the duration of one transport call.
    /// </summary>
    public DateTimeOffset? TokenMintedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public ActionMailAttemptOutcome Outcome { get; private set; }

    public string? FailureCode { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public bool IsCompleted => Outcome != ActionMailAttemptOutcome.Started;

    /// <summary>
    /// The provider idempotency key for one materialization of one action request.
    /// </summary>
    /// <remarks>
    /// It binds the request, the attempt number and the exact mailbox as a truncated keyed
    /// fingerprint. The attempt number is what makes a re-minted token a different key; the mailbox is
    /// what stops a corrected address colliding with the key the provider still remembers for the old
    /// one. The address participates only as a fingerprint, so the key is safe to persist and quote.
    /// </remarks>
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

        if (!AccountActionMailFingerprint.IsValid(addressFingerprint))
        {
            throw new ArgumentException(
                "A provider idempotency key binds a valid address fingerprint.",
                nameof(addressFingerprint));
        }

        return $"account-action:{requestId:N}:a{attemptNumber}:v1:{addressFingerprint[..32]}";
    }

    public static AccountActionMailAttempt Start(
        Guid requestId,
        AccountActionKind actionKind,
        int attemptNumber,
        Guid claimToken,
        string providerIdempotencyKey,
        DateTimeOffset startedAtUtc) =>
        new(requestId, actionKind, attemptNumber, claimToken, providerIdempotencyKey, startedAtUtc);

    /// <summary>Records that this attempt minted a raw token, before the transport is invoked.</summary>
    public void RecordTokenMinted(DateTimeOffset now)
    {
        if (IsCompleted)
        {
            throw new InvalidOperationException("A completed action mail attempt is immutable.");
        }

        if (TokenMintedAtUtc is not null)
        {
            throw new InvalidOperationException("One attempt mints one token.");
        }

        TokenMintedAtUtc = now;
    }

    public void Succeed(DateTimeOffset now, string? providerMessageId = null)
    {
        if (providerMessageId is not null && !AccountActionMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Complete(ActionMailAttemptOutcome.Succeeded, now, null);
        ProviderMessageId = providerMessageId;
    }

    public void FailTransiently(DateTimeOffset now, string failureCode) =>
        Complete(ActionMailAttemptOutcome.TransientFailure, now, failureCode);

    public void FailPermanently(DateTimeOffset now, string failureCode) =>
        Complete(ActionMailAttemptOutcome.PermanentFailure, now, failureCode);

    public void Suppress(DateTimeOffset now, string reasonCode) =>
        Complete(ActionMailAttemptOutcome.Suppressed, now, reasonCode);

    public void Abandon(DateTimeOffset now, string failureCode) =>
        Complete(ActionMailAttemptOutcome.Abandoned, now, failureCode);

    private void Complete(ActionMailAttemptOutcome outcome, DateTimeOffset now, string? failureCode)
    {
        if (IsCompleted)
        {
            throw new InvalidOperationException("A completed action mail attempt is immutable.");
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

/// <summary>
/// The global Identity actions that produce an email.
/// </summary>
/// <remarks>
/// Both belong to the account rather than to a workspace, and neither may be given a tenant to make it
/// fit a tenant-shaped queue. See ADR 0021.
/// </remarks>
public enum AccountActionKind
{
    ConfirmEmail = 1,
    ResetPassword = 2,
}

public enum AccountActionMailStatus
{
    Pending = 1,
    Processing = 2,

    /// <summary>A token was minted, a message was rendered, and the transport took it.</summary>
    Materialized = 3,

    /// <summary>The action stopped being authorized. Not a failure and not a dead letter.</summary>
    Suppressed = 4,

    DeadLettered = 5,
}

public enum ActionMailAttemptOutcome
{
    Started = 1,
    Succeeded = 2,
    TransientFailure = 3,
    PermanentFailure = 4,
    Abandoned = 5,
    Suppressed = 6,
}
