using System.Text.RegularExpressions;

namespace TB.Gym.Modules.Invitations;

/// <summary>
/// Stable, bounded, non-sensitive classifications for invitation action mail.
/// </summary>
/// <remarks>
/// Every one reaches a row a coach may eventually be shown and a log line an operator reads, so none
/// of them may contain an address, a token, a link, a name or an exception message.
/// </remarks>
public static class InvitationActionMailCodes
{
    // ---- failures ----

    public const string AttemptsExhausted = "invitation-action-mail-attempts-exhausted";

    public const string ClaimExpired = "invitation-action-mail-claim-expired";

    public const string TransportUnavailable = "invitation-action-mail-transport-unavailable";

    public const string TransportTransient = "invitation-action-mail-transport-transient";

    public const string TransportPermanent = "invitation-action-mail-transport-permanent";

    public const string SchemaUnsupported = "invitation-action-mail-schema-unsupported";

    public const string PublicOriginUnavailable = "invitation-action-mail-origin-unavailable";

    // ---- suppressions ----

    /// <summary>The invitation row is gone, or belongs to a different workspace.</summary>
    public const string InvitationMissing = "invitation-action-mail-invitation-missing";

    /// <summary>The workspace is no longer active.</summary>
    public const string TenantInactive = "invitation-action-mail-tenant-inactive";

    /// <summary>Somebody already accepted it.</summary>
    public const string InvitationAccepted = "invitation-action-mail-already-accepted";

    /// <summary>A coach or owner revoked it.</summary>
    public const string InvitationRevoked = "invitation-action-mail-revoked";

    /// <summary>Its expiry passed before this attempt reached the front of the queue.</summary>
    public const string InvitationExpired = "invitation-action-mail-expired";

    /// <summary>
    /// A deliberate resend moved the invitation to a later generation while this request was waiting.
    /// The newer request carries the send; this one stops without contacting anybody.
    /// </summary>
    public const string GenerationSuperseded = "invitation-action-mail-generation-superseded";

    /// <summary>The invited address changed, so the request no longer describes the same target.</summary>
    public const string TargetChanged = "invitation-action-mail-target-changed";

    /// <summary>The invitation has no usable address.</summary>
    public const string AddressUnavailable = "invitation-action-mail-address-unavailable";

    // ---- token revocation reasons ----

    /// <summary>A person pressed Resend, so every earlier generation's link is dead immediately.</summary>
    public const string TokenSupersededByResend = "invitation-token-superseded-by-resend";

    /// <summary>The invitation was revoked, so every outstanding link is dead.</summary>
    public const string TokenInvitationRevoked = "invitation-token-invitation-revoked";

    /// <summary>Acceptance succeeded, so every other outstanding link for it is spent.</summary>
    public const string TokenInvitationAccepted = "invitation-token-invitation-accepted";
}

/// <summary>
/// The attempt budget an invitation action-mail request may be configured with.
/// </summary>
/// <remarks>
/// The same shape as the account limits, and deliberately the same defaults. It is declared here
/// rather than shared because a module owns its own rules and may not reference another module; a test
/// asserts the two agree, so the duplication cannot drift silently.
/// </remarks>
public static class InvitationActionMailLimits
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

/// <summary>The named action-mail retry schedule, <c>action-mail-exponential-v1</c>.</summary>
public static class InvitationActionMailRetryPolicy
{
    public const string Name = "action-mail-exponential-v1";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(30),
    ];

    public static IReadOnlyList<TimeSpan> Schedule => Backoff;

    public static DateTimeOffset? NextAttemptAtUtc(int attemptNumber, int maximumAttempts, DateTimeOffset now)
    {
        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        InvitationActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (attemptNumber >= maximumAttempts)
        {
            return null;
        }

        return now.Add(Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)]);
    }

    public static TimeSpan MaximumRetrySpan(int maximumAttempts)
    {
        InvitationActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        var span = TimeSpan.Zero;
        for (var attemptNumber = 1; attemptNumber < maximumAttempts; attemptNumber++)
        {
            span += Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)];
        }

        return span;
    }
}

/// <summary>Shape validation for an identifier an external provider returned.</summary>
public static partial class InvitationActionMailProviderId
{
    public const int MaximumLength = 200;

    public static bool IsValid(string? candidate) =>
        !string.IsNullOrWhiteSpace(candidate) &&
        candidate.Length <= MaximumLength &&
        SafeAlphabet().IsMatch(candidate);

    [GeneratedRegex("^[A-Za-z0-9_.:-]{1,200}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeAlphabet();
}

/// <summary>
/// Shape validation for the 64-character lowercase hexadecimal digests this module stores.
/// </summary>
/// <remarks>
/// Used for both an invitation token hash and the keyed address fingerprint an idempotency key binds.
/// Neither is computed here: hashing a token and fingerprinting a mailbox both need material that
/// belongs to composition, and what the domain needs is only the guarantee that it was handed a digest
/// rather than the value itself.
/// </remarks>
public static partial class InvitationTokenHash
{
    public const int Length = 64;

    public static bool IsValid(string? candidate) =>
        candidate is not null && HexDigest().IsMatch(candidate);

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex HexDigest();
}
