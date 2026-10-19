using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Website;

/// <summary>
/// One Talk-to-us request from a gym, as it was received, and the state of the one email that tells
/// the owner about it (UI plan R6.2g, WEB-001).
/// </summary>
/// <remarks>
/// The request is the fact and it is never edited: what the person wrote is what the owner is told,
/// and the columns that change afterwards are only the ones that say whether the email went out. The
/// email rides the action-mail sweep as its fourth queue, with the same claim, lease, attempt budget
/// and retry schedule as the account, invitation and workspace-notice queues, because "send one plain
/// email, reliably, from the Worker" is the same job. There is no suppression: the recipient is this
/// deployment's own configured address, not a mailbox anybody could withdraw.
/// <para>
/// There is no <c>TenantId</c> column at all. A gym that writes to us has no workspace yet, and a
/// column that does not exist cannot be joined on or exported with somebody else's data (ADR 0021
/// makes the same argument for global account mail).
/// </para>
/// </remarks>
public sealed class ContactRequest : AuditableEntity
{
    public const int CurrentSchemaVersion = 1;

    private ContactRequest()
    {
    }

    private ContactRequest(ContactRequestFacts facts, DateTimeOffset receivedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(facts);
        Name = facts.Name;
        GymName = facts.GymName;
        Contact = facts.Contact;
        ContactKind = facts.ContactKind;
        Message = facts.Message;
        ReceivedAtUtc = receivedAtUtc;
        SchemaVersion = CurrentSchemaVersion;
        Status = ContactRequestMailStatus.Pending;
        NextAttemptAtUtc = receivedAtUtc;
    }

    // ---- the request, as received ----

    public string Name { get; private set; } = string.Empty;

    public string GymName { get; private set; } = string.Empty;

    /// <summary>The email address or the WhatsApp number, as <see cref="ContactRequestRules"/> normalized it.</summary>
    public string Contact { get; private set; } = string.Empty;

    public ContactKind ContactKind { get; private set; }

    public string? Message { get; private set; }

    public DateTimeOffset ReceivedAtUtc { get; private set; }

    public int SchemaVersion { get; private set; }

    // ---- the email to the owner ----

    public ContactRequestMailStatus Status { get; private set; }

    public int AttemptCount { get; private set; }

    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    public Guid? ClaimToken { get; private set; }

    public DateTimeOffset? ClaimExpiresAtUtc { get; private set; }

    /// <summary>The provider idempotency key of the attempt in flight, or of the last one made.</summary>
    public string? ProviderIdempotencyKey { get; private set; }

    public DateTimeOffset? MaterializedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public DateTimeOffset? DeadLetteredAtUtc { get; private set; }

    public string? FailureCode { get; private set; }

    public string? TransportAdapter { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public DateTimeOffset? ProviderAcceptedAtUtc { get; private set; }

    public bool IsTerminal => Status is ContactRequestMailStatus.Materialized or ContactRequestMailStatus.DeadLettered;

    /// <summary>Records a request a visitor sent. The facts have passed <see cref="ContactRequestRules"/>.</summary>
    public static ContactRequest Receive(ContactRequestFacts facts, DateTimeOffset receivedAtUtc) =>
        new(facts, receivedAtUtc);

    public bool IsClaimable(DateTimeOffset now) =>
        (Status == ContactRequestMailStatus.Pending && NextAttemptAtUtc <= now) || IsClaimExpired(now);

    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == ContactRequestMailStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    public Guid Claim(DateTimeOffset now, TimeSpan lease, int maximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        ContactRequestMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This contact request is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This contact request has exhausted its attempts.");
        }

        Status = ContactRequestMailStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    /// <summary>Counts an attempt and fixes its provider key, before the provider is called.</summary>
    public int StartAttempt(Guid claimToken, int maximumAttempts)
    {
        RequireClaim(claimToken);
        ContactRequestMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This contact request has exhausted its attempts.");
        }

        AttemptCount++;
        ProviderIdempotencyKey = BuildProviderIdempotencyKey(Id, AttemptCount);
        return AttemptCount;
    }

    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal contact request cannot exhaust attempts again.");
        }

        if (Status != ContactRequestMailStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can exhaust its attempts.");
        }

        Status = ContactRequestMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = ContactRequestMailCodes.AttemptsExhausted;
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
        if (providerMessageId is not null && !ContactRequestMailProviderId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        Status = ContactRequestMailStatus.Materialized;
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

        Status = ContactRequestMailStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = ContactRequestMailStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    /// <summary>An expired claim is released so the next sweep can take the request over.</summary>
    public void Abandon(DateTimeOffset now)
    {
        if (!IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only an expired claim can be abandoned.");
        }

        Status = ContactRequestMailStatus.Pending;
        FailureCode = ContactRequestMailCodes.ClaimExpired;
        ReleaseClaim();
    }

    /// <summary>
    /// The provider idempotency key of one attempt: the request and the attempt number. There is no
    /// address fingerprint in it, because the recipient is this deployment's own setting.
    /// </summary>
    public static string BuildProviderIdempotencyKey(Guid requestId, int attemptNumber)
    {
        if (requestId == Guid.Empty)
        {
            throw new ArgumentException("A request id is required.", nameof(requestId));
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        return $"contact-request:{requestId:N}:a{attemptNumber}:v1";
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != ContactRequestMailStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed contact request can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This contact request is held by a different claim.");
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

/// <summary>How the person asked to be reached: the one field takes either.</summary>
public enum ContactKind
{
    Email = 1,
    WhatsApp = 2,
}

public enum ContactRequestMailStatus
{
    Pending = 1,
    Processing = 2,
    Materialized = 3,
    DeadLettered = 4,
}

/// <summary>
/// Stable, bounded, non-sensitive classifications for the owner's email about a contact request.
/// None may contain what the person wrote.
/// </summary>
public static class ContactRequestMailCodes
{
    public const string AttemptsExhausted = "contact-request-attempts-exhausted";

    public const string ClaimExpired = "contact-request-claim-expired";

    /// <summary>
    /// No longer written: since audit BEB-1 a deployment with email off claims nothing and the request
    /// waits. Rows retried before that change may still carry it.
    /// </summary>
    public const string TransportUnavailable = "contact-request-transport-unavailable";

    public const string TransportTransient = "contact-request-transport-transient";

    public const string TransportPermanent = "contact-request-transport-permanent";
}

/// <summary>The attempt budget: the same bounds and default as the other action-mail queues.</summary>
public static class ContactRequestMailLimits
{
    public const int DefaultMaximumAttempts = 4;

    public const int MinimumMaximumAttempts = 1;

    public const int MaximumMaximumAttempts = 10;

    public static void ValidateMaximumAttempts(int maximumAttempts)
    {
        if (maximumAttempts is < MinimumMaximumAttempts or > MaximumMaximumAttempts)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumAttempts),
                $"Maximum attempts must be between {MinimumMaximumAttempts} and {MaximumMaximumAttempts}.");
        }
    }
}

/// <summary>The same named, versioned schedule as the other action-mail queues: 1, 5, then 30 minutes.</summary>
public static class ContactRequestMailRetryPolicy
{
    public const string Name = "action-mail-exponential-v1";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(30),
    ];

    public static IReadOnlyList<TimeSpan> Schedule => Backoff;

    /// <summary>
    /// When the attempt numbered <paramref name="attemptNumber"/> should next be tried, or null when
    /// the schedule is exhausted and the request must be dead-lettered instead.
    /// </summary>
    public static DateTimeOffset? NextAttemptAtUtc(int attemptNumber, int maximumAttempts, DateTimeOffset now)
    {
        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        ContactRequestMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (attemptNumber >= maximumAttempts)
        {
            return null;
        }

        return now.Add(Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)]);
    }
}

/// <summary>Shape validation for an identifier an external provider returned.</summary>
public static class ContactRequestMailProviderId
{
    public const int MaximumLength = 200;

    public static bool IsValid(string? candidate) =>
        !string.IsNullOrWhiteSpace(candidate) &&
        candidate.Length <= MaximumLength &&
        candidate.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '.' or ':' or '-');
}
