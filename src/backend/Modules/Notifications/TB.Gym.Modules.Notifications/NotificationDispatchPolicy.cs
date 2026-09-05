namespace TB.Gym.Modules.Notifications;

/// <summary>
/// Stable, bounded, non-sensitive classifications. These reach logs, the owner-only dead-letter view
/// and the channel-delivery row itself, so every one of them must be safe to show to somebody who is not the
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

    /// <summary>The configured email transport refused the message in a way that may work later.</summary>
    public const string EmailTransportTransient = "notification-email-transport-transient";

    /// <summary>The configured email transport refused the message permanently.</summary>
    public const string EmailTransportPermanent = "notification-email-transport-permanent";

    /// <summary>The provider refused because this sender is over its rate limit. Retryable.</summary>
    public const string EmailProviderRateLimited = "notification-email-provider-rate-limited";

    /// <summary>The provider did not answer inside the adapter's bounded timeout. Retryable.</summary>
    public const string EmailProviderTimeout = "notification-email-provider-timeout";

    /// <summary>The provider could not be reached, or answered with a server error. Retryable.</summary>
    public const string EmailProviderUnavailable = "notification-email-provider-unavailable";

    /// <summary>
    /// The provider rejected the request itself — a malformed sender, an unverified domain, a
    /// recipient it will not accept. Permanent: the same request will be rejected again.
    /// </summary>
    public const string EmailProviderRejected = "notification-email-provider-rejected";

    /// <summary>
    /// The provider refused this deployment's credentials or configuration.
    /// </summary>
    /// <remarks>
    /// Classified retryable rather than permanent, and logged as an operational fault rather than a
    /// message-level one. A revoked or mistyped API key is a deployment problem, not a problem with
    /// the notification: dead-lettering every due email the moment a key rotates badly would
    /// silently discard work that becomes deliverable again the moment somebody fixes the
    /// configuration. The bounded retry schedule still ends in a dead letter, so nothing retries
    /// forever, and the distinct code is what an alert is keyed on.
    /// </remarks>
    public const string EmailProviderUnauthorized = "notification-email-provider-unauthorized";

    /// <summary>
    /// The provider answered successfully with a body this build cannot use — no identifier, or one
    /// that fails validation. Permanent, because accepting it would mean inventing evidence.
    /// </summary>
    public const string EmailProviderResponseInvalid = "notification-email-provider-response-invalid";

    /// <summary>
    /// The provider says this idempotency key was already used for a different request. Permanent:
    /// the key is derived from the immutable message and the exact recipient, so retrying it
    /// unchanged cannot resolve the conflict.
    /// </summary>
    public const string EmailProviderIdempotencyConflict = "notification-email-provider-idempotency-conflict";
}

/// <summary>
/// Why a still-eligible-looking intent stopped being worth delivering. Suppression is not failure:
/// nothing went wrong, the business reason simply no longer holds, so it costs no delivery attempt
/// and produces no dead letter. A decision made before work starts costs no attempt; one discovered
/// by the required post-claim recheck closes the already-started attempt as suppressed.
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

    /// <summary>The business withdrew the intent before this channel had been claimed.</summary>
    public const string IntentCancelled = "notification-intent-cancelled";

    /// <summary>
    /// The recipient's current preference no longer wants this channel. Suppresses email only; the
    /// in-app delivery of the same intent is untouched, because preferences never remove it.
    /// </summary>
    public const string EmailOptedOut = "notification-email-opted-out";

    /// <summary>Marketing selection without current affirmative consent. Fails closed.</summary>
    public const string MarketingConsentMissing = "notification-marketing-consent-missing";

    /// <summary>No usable address, or an address the account has never confirmed.</summary>
    public const string EmailAddressUnavailable = "notification-email-address-unavailable";

    /// <summary>This deployment has no configured email transport any more.</summary>
    public const string EmailChannelUnavailable = "notification-email-channel-unavailable";

    /// <summary>
    /// The recipient's current mailbox is durably suppressed by a verified permanent bounce, a
    /// complaint, or the provider's own suppression list. Suppresses email only; the in-app delivery
    /// of the same notification is untouched, because a mailbox refusing mail is not a member losing
    /// what they are entitled to be told.
    /// </summary>
    public const string EmailAddressSuppressed = "notification-email-address-suppressed";

    /// <summary>The workspace time zone cannot be resolved, so quiet hours cannot be honoured.</summary>
    public const string QuietHoursUnresolvable = "notification-quiet-hours-unresolvable";
}

/// <summary>
/// Why a delivery was moved forward without being tried. A deferral is neither a failure nor a
/// suppression: nothing went wrong and the notification is still wanted, this is simply not a moment
/// the recipient agreed to be interrupted in.
/// </summary>
public static class NotificationDeferralCodes
{
    public const string QuietHours = "notification-email-quiet-hours";
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

    /// <summary>
    /// The longest this schedule can stretch between the first attempt and the last, for a given
    /// configured maximum.
    /// </summary>
    /// <remarks>
    /// Exists because a provider's idempotency key has a retention window. A schedule longer than
    /// that window means a late retry presents a key the provider has already forgotten, and the
    /// "duplicate" it was supposed to collapse becomes a second real message in somebody's inbox.
    /// Startup validation compares this span against the configured retention rather than leaving it
    /// as a documented hazard nobody would notice crossing.
    /// </remarks>
    public static TimeSpan MaximumRetrySpan(int maximumAttempts)
    {
        NotificationDispatchOptions.ValidateMaximumAttempts(maximumAttempts);
        var span = TimeSpan.Zero;
        for (var attemptNumber = 1; attemptNumber < maximumAttempts; attemptNumber++)
        {
            span += Backoff[Math.Min(attemptNumber - 1, Backoff.Length - 1)];
        }

        return span;
    }
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
