namespace TB.Gym.Modules.Notifications;

/// <summary>
/// Stable, bounded, non-sensitive classifications. These reach logs, the owner-only dead-letter view
/// and the outbox row itself, so every one of them must be safe to show to somebody who is not the
/// recipient: no address, no name, no amount, no payload content, no exception text.
/// </summary>
public static class NotificationFailureCodes
{
    /// <summary>The payload is not readable, or declares a schema version this build cannot read.</summary>
    public const string PayloadInvalid = "notification-payload-invalid";

    /// <summary>No template is published for this kind and culture.</summary>
    public const string TemplateMissing = "notification-template-missing";

    /// <summary>A referenced row is absent, or belongs to a different workspace or client.</summary>
    public const string AggregateMismatch = "notification-aggregate-mismatch";

    /// <summary>Something failed in a way that may succeed later.</summary>
    public const string DispatchTransient = "notification-dispatch-transient";

    /// <summary>The retry schedule ran out.</summary>
    public const string AttemptsExhausted = "notification-attempts-exhausted";

    /// <summary>A claim lease expired before its attempt finished.</summary>
    public const string ClaimExpired = "notification-claim-expired";
}

/// <summary>
/// Why a still-eligible-looking intent stopped being worth delivering. Suppression is not failure:
/// nothing went wrong, the business reason simply no longer holds, so it costs no delivery attempt
/// and produces no dead letter.
/// </summary>
public static class NotificationSuppressionCodes
{
    public const string TenantInactive = "notification-tenant-inactive";

    public const string RecipientBlocked = "notification-recipient-blocked";

    public const string MembershipInactive = "notification-membership-inactive";

    public const string RelationshipBlocked = "notification-relationship-blocked";

    /// <summary>The client profile is no longer linked to the recipient account.</summary>
    public const string RecipientUnlinked = "notification-recipient-unlinked";

    public const string EnrollmentCancelled = "notification-enrollment-cancelled";

    /// <summary>The kind-specific state this notification described no longer holds.</summary>
    public const string StateChanged = "notification-state-changed";
}

/// <summary>
/// The named retry schedule, <c>notification-exponential-v1</c>.
/// </summary>
/// <remarks>
/// The schedule is a fixed table rather than a computed curve so it can be asserted exactly and so
/// changing it is a visible, named decision. Failure after attempt 1 waits a minute; then 5 minutes,
/// 15 minutes, 1 hour, then 6 hours. Configured attempts beyond six repeat that 6-hour ceiling; a
/// failure on the last permitted attempt dead-letters instead of waiting again. Every instant comes
/// from <c>IClock</c>, so tests move time rather than spending it.
/// </remarks>
public static class NotificationRetryPolicy
{
    public const string Name = "notification-exponential-v1";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(15),
        TimeSpan.FromHours(1),
        TimeSpan.FromHours(6),
    ];

    /// <summary>
    /// When the attempt numbered <paramref name="attemptNumber"/> should next be tried, or null when
    /// the schedule is exhausted and the item must be dead-lettered instead.
    /// </summary>
    public static DateTimeOffset? NextAttemptAtUtc(int attemptNumber, int maximumAttempts, DateTimeOffset now)
    {
        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        NotificationDispatchOptions.ValidateMaximumAttempts(maximumAttempts);

        if (attemptNumber >= maximumAttempts)
        {
            return null;
        }

        var index = Math.Min(attemptNumber - 1, Backoff.Length - 1);
        return now.Add(Backoff[index]);
    }

    /// <summary>The backoff table, for tests and documentation.</summary>
    public static IReadOnlyList<TimeSpan> Schedule => Backoff;
}

/// <summary>
/// Engineering parameters for the dispatch sweep. Validated at worker startup, so a misconfigured
/// deployment fails to start rather than silently hammering the database or holding leases for hours.
/// </summary>
public sealed class NotificationDispatchOptions
{
    public const string SectionName = "Notifications:Dispatch";

    public const int DefaultMaximumAttempts = 6;

    public const int MinimumMaximumAttempts = 1;

    public const int MaximumMaximumAttempts = 20;

    /// <summary>How long the worker waits between sweeps. Allowed 1 to 300 seconds.</summary>
    public int PollIntervalSeconds { get; set; } = 5;

    /// <summary>
    /// The most items one sweep may claim in total, across every workspace. Global, not per
    /// workspace: a per-workspace cap multiplied by the number of workspaces is not a bound.
    /// Allowed 1 to 200.
    /// </summary>
    public int BatchSize { get; set; } = 25;

    /// <summary>How long a claim stays valid before another worker may take it over. Allowed 30 to 900 seconds.</summary>
    public int ClaimLeaseSeconds { get; set; } = 120;

    /// <summary>How many attempts an item gets before it is dead-lettered. Allowed 1 to 20.</summary>
    public int MaximumAttempts { get; set; } = DefaultMaximumAttempts;

    /// <summary>Lets a deployment or a test turn the sweep off without removing the worker.</summary>
    public bool Enabled { get; set; } = true;

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
