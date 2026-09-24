using System.Text.RegularExpressions;

namespace TB.Gym.Modules.Tenancy;

/// <summary>
/// Stable, bounded, non-sensitive classifications for workspace notice mail. None may contain an
/// address, a name, a reason typed by the owner or an exception message.
/// </summary>
public static class WorkspaceNoticeMailCodes
{
    // ---- failures ----

    public const string AttemptsExhausted = "workspace-notice-attempts-exhausted";

    public const string ClaimExpired = "workspace-notice-claim-expired";

    public const string TransportUnavailable = "workspace-notice-transport-unavailable";

    public const string TransportTransient = "workspace-notice-transport-transient";

    public const string TransportPermanent = "workspace-notice-transport-permanent";

    // ---- suppressions ----

    /// <summary>The workspace is no longer active.</summary>
    public const string TenantInactive = "workspace-notice-tenant-inactive";

    /// <summary>The recipient's account is gone, has no address, or is blocked from the platform.</summary>
    public const string RecipientUnavailable = "workspace-notice-recipient-unavailable";

    /// <summary>
    /// What the notice states is no longer true — for a release, the client is not released or not
    /// the recipient — so saying it would be wrong.
    /// </summary>
    public const string StateChanged = "workspace-notice-state-changed";
}

/// <summary>
/// The attempt budget. The same bounds and default as the other two action-mail queues; a test asserts
/// all three agree, because each module declares its own rather than referencing another.
/// </summary>
public static class WorkspaceNoticeMailLimits
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

/// <summary>The named action-mail retry schedule, <c>action-mail-exponential-v1</c>, shared by name.</summary>
public static class WorkspaceNoticeMailRetryPolicy
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

        WorkspaceNoticeMailLimits.ValidateMaximumAttempts(maximumAttempts);
        return attemptNumber >= maximumAttempts
            ? null
            : now.Add(Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)]);
    }
}

/// <summary>Shape validation for an identifier an external provider returned.</summary>
public static partial class WorkspaceNoticeMailProviderId
{
    public static bool IsValid(string? candidate) =>
        !string.IsNullOrWhiteSpace(candidate) && candidate.Length <= 200 && SafeAlphabet().IsMatch(candidate);

    [GeneratedRegex("^[A-Za-z0-9_.:-]{1,200}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeAlphabet();
}

/// <summary>Shape validation for the keyed address fingerprint a provider idempotency key binds.</summary>
public static partial class WorkspaceNoticeMailDigest
{
    public static bool IsValid(string? candidate) => candidate is not null && HexDigest().IsMatch(candidate);

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex HexDigest();
}
