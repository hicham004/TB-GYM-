using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Engineering parameters for the two action-mail sweeps, and the one rule about which transport may
/// carry them.
/// </summary>
/// <remarks>
/// Action mail deliberately has no <c>Enabled</c> switch of the kind the notification email channel
/// has. A deployment may reasonably decide not to email people about their payments; there is no
/// corresponding decision to make about a password-reset link, so there is no switch for it.
/// <para>
/// What action mail does <b>not</b> do is refuse to start when a deployment has configured no provider
/// at all. Phase 6B-3A decided that a deployment may run with email switched off, and reversing that
/// is not this phase's call. The consequence is stated where an operator will act on it — a Production
/// deployment without a provider dead-letters its action mail with
/// <c>*-transport-unavailable</c>, and <c>LAUNCH-CHECKLIST.md</c> carries it as a release gate rather
/// than a startup refusal.
/// </para>
/// <para>
/// There is no separate adapter setting, and no separate provider credentials. One provider is
/// configured once, under <c>Notifications:Email:Provider</c>, and both the notification channel and
/// action mail reach it through the same client. A second set of settings would be a second thing to
/// rotate and a second way for the two to disagree about who is sending on this domain's behalf.
/// </para>
/// </remarks>
public sealed class ActionMailDispatchOptions
{
    public const string SectionName = "Application:ActionMail";

    /// <summary>How long the worker waits between sweeps. Allowed 1 to 300 seconds.</summary>
    public int PollIntervalSeconds { get; set; } = 5;

    /// <summary>The most requests one sweep may claim, across both queues. Allowed 1 to 200.</summary>
    public int BatchSize { get; set; } = 25;

    /// <summary>How long a claim stays valid before another worker may take it over. Allowed 30 to 900.</summary>
    public int ClaimLeaseSeconds { get; set; } = 120;

    /// <summary>
    /// How many durable attempts a request gets before it is dead-lettered.
    /// </summary>
    /// <remarks>
    /// Every attempt mints a new live credential, so this is deliberately small. It is bounded by the
    /// tighter of the two modules' limits, which are the same by construction and asserted to be.
    /// </remarks>
    public int MaximumAttempts { get; set; } = AccountActionMailLimits.DefaultMaximumAttempts;

    /// <summary>Lets a deployment or a test turn the sweep off without removing the worker.</summary>
    public bool SweepEnabled { get; set; } = true;

    /// <summary>
    /// The startup rule, in one place so both composition roots and the tests assert the same thing.
    /// </summary>
    public string? Validate(NotificationEmailOptions email, bool isProduction)
    {
        ArgumentNullException.ThrowIfNull(email);

        if (PollIntervalSeconds is < 1 or > 300)
        {
            return $"{SectionName}:PollIntervalSeconds must be between 1 and 300 seconds.";
        }

        if (BatchSize is < 1 or > 200)
        {
            return $"{SectionName}:BatchSize must be between 1 and 200.";
        }

        if (ClaimLeaseSeconds is < 30 or > 900)
        {
            return $"{SectionName}:ClaimLeaseSeconds must be between 30 and 900 seconds.";
        }

        var lowerBound = Math.Max(
            AccountActionMailLimits.MinimumMaximumAttempts,
            InvitationActionMailLimits.MinimumMaximumAttempts);
        var upperBound = Math.Min(
            AccountActionMailLimits.MaximumMaximumAttempts,
            InvitationActionMailLimits.MaximumMaximumAttempts);
        if (MaximumAttempts < lowerBound || MaximumAttempts > upperBound)
        {
            return $"{SectionName}:MaximumAttempts must be between {lowerBound} and {upperBound}.";
        }

        // The provider forgets an idempotency key after a bounded window, and every action-mail attempt
        // presents its own key. A schedule longer than that window would present a key the provider has
        // already forgotten — which is harmless for deduplication but means the attempt is genuinely a
        // second message, so the check exists to make that a deliberate configuration rather than a
        // surprise. Checked here, where both the schedule and the retention are visible.
        if (email.UsesProviderAdapter)
        {
            var retention = TimeSpan.FromHours(email.Provider.IdempotencyRetentionHours);
            var span = AccountActionMailRetryPolicy.MaximumRetrySpan(MaximumAttempts);
            if (span > retention)
            {
                return $"{SectionName}:MaximumAttempts of {MaximumAttempts} spans {span.TotalHours:0.##} " +
                    $"hours under '{AccountActionMailRetryPolicy.Name}', which exceeds the " +
                    $"{email.Provider.IdempotencyRetentionHours}-hour provider idempotency retention " +
                    $"window in {NotificationEmailOptions.SectionName}:Provider:IdempotencyRetentionHours.";
            }
        }

        return null;
    }
}

/// <summary>The stable scope codes an action-mail log line or capture may carry.</summary>
public static class ActionMailScopes
{
    /// <summary>Global Identity mail: account confirmation and password reset.</summary>
    public const string Account = "account";

    /// <summary>Tenant-owned invitation mail.</summary>
    public const string Invitation = "invitation";
}
