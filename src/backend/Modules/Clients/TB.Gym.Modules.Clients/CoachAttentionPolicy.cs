using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

/// <summary>
/// Coach attention v1 (CLI-018, R3.1): which of a client's signals ask the coach to act, how the
/// queue is ranked, and the one status the client list shows. The signals arrive already gated by the
/// client's plan, so this rule only weighs them.
/// </summary>
public static class CoachAttentionPolicy
{
    public const string Key = "CoachAttention";
    public const int Version = 1;

    /// <summary>A running plan whose last covered day falls within this many days is ending soon.</summary>
    public const int PlanEndingWithinDays = 14;

    /// <summary>Missed sessions since the last workout (TRN-021) that ask for the coach.</summary>
    public const int MissedSessionsThreshold = 2;

    /// <summary>A renewal request stays in the queue this many days while the plan is still ended.</summary>
    public const int RenewalRequestDays = 30;

    /// <summary>A client who joined within this many days is new.</summary>
    public const int NewClientDays = 14;

    /// <summary>Presentation spans, stated in the payloads rather than assumed by the screens.</summary>
    public const int RecentDays = 7;

    public const int ActivityDays = 7;

    public const int ActivityLimit = 20;

    /// <summary>The kinds this client raises, in rank order.</summary>
    public static IReadOnlyList<CoachAttentionKind> Flags(
        ClientAttentionSignals signals,
        ClientPlanState planState,
        DateOnly today)
    {
        var flags = new List<CoachAttentionKind>();
        if (signals.CheckInsToReview > 0)
        {
            flags.Add(CoachAttentionKind.CheckInToReview);
        }

        if (signals.UnreadMessages > 0)
        {
            flags.Add(CoachAttentionKind.UnreadMessages);
        }

        if (planState == ClientPlanState.Ended &&
            signals.RenewalRequestedOn is { } asked &&
            asked > today.AddDays(-RenewalRequestDays))
        {
            flags.Add(CoachAttentionKind.RenewalRequested);
        }

        if (planState == ClientPlanState.Running &&
            signals.PlanLastDay is { } lastDay &&
            lastDay < today.AddDays(PlanEndingWithinDays))
        {
            flags.Add(CoachAttentionKind.PlanEndingSoon);
        }

        if (signals.HasWeekToShare)
        {
            flags.Add(CoachAttentionKind.WeekNotShared);
        }

        if (signals.MissedSinceLastWorkout >= MissedSessionsThreshold)
        {
            flags.Add(CoachAttentionKind.MissedSessions);
        }

        if (signals.HasNoProgram)
        {
            flags.Add(CoachAttentionKind.NoProgram);
        }

        return flags;
    }

    /// <summary>
    /// Anything to act on besides a plan ending makes a client Needs attention; otherwise a paused plan
    /// shows Paused, a plan ending soon Ending soon, a running plan On track, and anything else (ended,
    /// unpaid, not started, none, blocked) No active plan.
    /// </summary>
    public static ClientOverviewStatus Status(
        IReadOnlyCollection<CoachAttentionKind> flags,
        ClientPlanState planState) =>
        flags.Any(flag => flag != CoachAttentionKind.PlanEndingSoon) ? ClientOverviewStatus.NeedsAttention
        : planState == ClientPlanState.Paused ? ClientOverviewStatus.Paused
        : flags.Contains(CoachAttentionKind.PlanEndingSoon) ? ClientOverviewStatus.EndingSoon
        : planState == ClientPlanState.Running ? ClientOverviewStatus.OnTrack
        : ClientOverviewStatus.NoActivePlan;

    /// <summary>
    /// The plan read from the client's per-feature decisions: one feature granted keeps it Running;
    /// otherwise the first of Paused, payment due, not started, ended, blocked, or none applies.
    /// </summary>
    public static ClientPlanState PlanState(IReadOnlyCollection<FeatureAccessDecision> decisions)
    {
        if (decisions.Any(decision => decision.IsAllowed))
        {
            return ClientPlanState.Running;
        }

        if (decisions.Any(decision => decision.Reason == FeatureAccessReason.Paused))
        {
            return ClientPlanState.Paused;
        }

        if (decisions.Any(decision => decision.Reason == FeatureAccessReason.PaymentRequired))
        {
            return ClientPlanState.PaymentDue;
        }

        if (decisions.Any(decision => decision.Reason == FeatureAccessReason.NotStarted))
        {
            return ClientPlanState.NotStarted;
        }

        if (decisions.Any(decision => decision.Reason is FeatureAccessReason.Expired or FeatureAccessReason.Cancelled))
        {
            return ClientPlanState.Ended;
        }

        return decisions.Any(decision =>
            decision.Reason is FeatureAccessReason.RelationshipBlocked or FeatureAccessReason.PlatformBlocked)
            ? ClientPlanState.Blocked
            : ClientPlanState.None;
    }

    public static bool IsNew(DateOnly joinedOn, DateOnly today) => joinedOn > today.AddDays(-NewClientDays);

    /// <summary>
    /// Most urgent kind first; within a kind, more missed sessions first, then whatever has waited
    /// longest or falls soonest, then by name so the order is stable.
    /// </summary>
    public static IReadOnlyList<CoachAttentionItemView> Rank(IEnumerable<CoachAttentionItemView> items) =>
        items
            .OrderBy(item => item.Kind)
            .ThenByDescending(item => item.Kind == CoachAttentionKind.MissedSessions ? item.Count ?? 0 : 0)
            .ThenBy(item => item.Since ?? DateTimeOffset.MaxValue)
            .ThenBy(item => item.Date ?? DateOnly.MaxValue)
            .ThenBy(item => item.Client.LastName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Client.FirstName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Client.ClientProfileId)
            .ToArray();
}

/// <summary>
/// What the attention rule weighs about one client. Each signal is already limited to what the
/// client's plan includes: no check-ins, messages or training signals for a feature it does not cover.
/// </summary>
/// <param name="RenewalRequestedOn">The latest request's date, set only while the whole plan is still ended (ADR 0029).</param>
/// <param name="PlanLastDay">The last day the current and following plans cover.</param>
/// <param name="MissedSinceLastWorkout">Training rule TRN-021.</param>
/// <param name="HasNoProgram">Training is in the plan but no block is running or coming.</param>
public sealed record ClientAttentionSignals(
    int CheckInsToReview,
    long UnreadMessages,
    DateOnly? RenewalRequestedOn,
    DateOnly? PlanLastDay,
    bool HasWeekToShare,
    int MissedSinceLastWorkout,
    bool HasNoProgram);
