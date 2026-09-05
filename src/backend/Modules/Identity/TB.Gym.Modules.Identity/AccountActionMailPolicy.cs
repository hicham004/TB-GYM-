using System.Text.RegularExpressions;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// Stable, bounded, non-sensitive classifications for global account action mail.
/// </summary>
/// <remarks>
/// Every one of these reaches a row and a log line, so every one must be safe to show to somebody who
/// is not the subject: no address, no token, no URL, no wording, no exception text. They are owned by
/// this module rather than shared with the Notifications module because they describe Identity's own
/// actions, and a code that means two things in two places explains neither.
/// </remarks>
public static class AccountActionMailCodes
{
    // ---- failures: something went wrong ----

    /// <summary>The bounded attempt budget ran out.</summary>
    public const string AttemptsExhausted = "account-action-mail-attempts-exhausted";

    /// <summary>A claim lease expired before its attempt finished.</summary>
    public const string ClaimExpired = "account-action-mail-claim-expired";

    /// <summary>This deployment has no configured action-mail transport.</summary>
    public const string TransportUnavailable = "account-action-mail-transport-unavailable";

    /// <summary>The transport refused in a way that may work later.</summary>
    public const string TransportTransient = "account-action-mail-transport-transient";

    /// <summary>The transport refused permanently.</summary>
    public const string TransportPermanent = "account-action-mail-transport-permanent";

    /// <summary>
    /// The request declares a payload schema version this build cannot read. Permanent on the first
    /// attempt: no amount of waiting teaches an older build a newer shape.
    /// </summary>
    public const string SchemaUnsupported = "account-action-mail-schema-unsupported";

    /// <summary>
    /// The configured public origin could not produce a link. Permanent, because a link built from a
    /// request header instead would be the host-header injection this design exists to refuse.
    /// </summary>
    public const string PublicOriginUnavailable = "account-action-mail-origin-unavailable";

    /// <summary>Identity refused to mint a token for this account. Permanent.</summary>
    public const string TokenUnavailable = "account-action-mail-token-unavailable";

    // ---- suppressions: nothing went wrong, the reason stopped holding ----

    /// <summary>
    /// The request names no account, because the address it was made for resolved to none. It exists
    /// so the unknown path costs the same bounded work as the known one, and it terminates here.
    /// </summary>
    public const string SubjectUnresolved = "account-action-mail-subject-unresolved";

    /// <summary>The account no longer exists.</summary>
    public const string SubjectMissing = "account-action-mail-subject-missing";

    /// <summary>The account is platform-blocked.</summary>
    public const string SubjectBlocked = "account-action-mail-subject-blocked";

    /// <summary>The account has no usable address any more.</summary>
    public const string AddressUnavailable = "account-action-mail-address-unavailable";

    /// <summary>The address this confirmation was requested for is already confirmed.</summary>
    public const string AlreadyConfirmed = "account-action-mail-already-confirmed";

    /// <summary>
    /// The password or security stamp changed after the reset was requested, which already invalidated
    /// any outstanding reset token. Sending a new one would hand out a credential nobody asked for
    /// after the fact that made the request stale.
    /// </summary>
    public const string CredentialChanged = "account-action-mail-credential-changed";
}

/// <summary>
/// The attempt budget an action-mail request may be configured with.
/// </summary>
/// <remarks>
/// Deliberately smaller by default than the commercial notification schedule. A confirmation or a
/// reset link decays in value within minutes: a person who did not receive one asks for another long
/// before a six-hour retry ceiling would fire, and every extra durable attempt mints another live
/// credential for a request nobody is still waiting on.
/// </remarks>
public static class AccountActionMailLimits
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

/// <summary>
/// The named action-mail retry schedule, <c>action-mail-exponential-v1</c>.
/// </summary>
/// <remarks>
/// A fixed table rather than a computed curve, so it can be asserted exactly and so changing it is a
/// visible, named decision. It is deliberately tighter than
/// <c>notification-exponential-v1</c>: 1 minute, 5 minutes, then a 30-minute ceiling. A credential
/// whose value decays in minutes is not worth a six-hour retry, and every durable retry mints a new
/// token.
/// <para>
/// The Invitations module publishes the same named schedule for the same reason. The two are separate
/// declarations because a module owns its own rules and neither may reference the other; the ADR
/// records that they are the same policy, and a test asserts the tables match.
/// </para>
/// </remarks>
public static class AccountActionMailRetryPolicy
{
    public const string Name = "action-mail-exponential-v1";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(30),
    ];

    /// <summary>The backoff table, for tests and documentation.</summary>
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

        AccountActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        if (attemptNumber >= maximumAttempts)
        {
            return null;
        }

        return now.Add(Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)]);
    }

    /// <summary>The longest this schedule can stretch between the first attempt and the last.</summary>
    public static TimeSpan MaximumRetrySpan(int maximumAttempts)
    {
        AccountActionMailLimits.ValidateMaximumAttempts(maximumAttempts);
        var span = TimeSpan.Zero;
        for (var attemptNumber = 1; attemptNumber < maximumAttempts; attemptNumber++)
        {
            span += Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)];
        }

        return span;
    }
}

/// <summary>Shape validation for an identifier an external provider returned.</summary>
public static partial class AccountActionMailProviderId
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
/// Shape validation for a keyed address fingerprint.
/// </summary>
/// <remarks>
/// This module validates the shape and never computes one. Computing it needs the deployment's
/// fingerprint key, which lives with the provider configuration that Infrastructure composes; what the
/// domain needs is only the guarantee that what it is asked to bind into an idempotency key is a
/// fingerprint rather than an address somebody passed by mistake.
/// </remarks>
public static partial class AccountActionMailFingerprint
{
    public static bool IsValid(string? candidate) =>
        candidate is not null && HexDigest().IsMatch(candidate);

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex HexDigest();
}
