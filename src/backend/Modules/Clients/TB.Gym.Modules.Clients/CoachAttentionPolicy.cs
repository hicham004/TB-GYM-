using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

/// <summary>
/// Coach attention v3 (CLI-018; v1 in R3.1, v2 in P4c added maxes to review, v3 in audit A8 a new client with no
/// plan): which of a client's signals ask the coach to act, how the queue is ranked, and the one status the client
/// list shows. The signals arrive already gated by the client's plan, so this rule only weighs them.
/// </summary>
public static class CoachAttentionPolicy
{
    public const string Key = "CoachAttention";
    public const int Version = 3;

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

    /// <summary>
    /// The queue's order, most urgent first. A new client with no plan comes after a renewal request: both wait
    /// for the coach to sell a plan, and nothing else can reach the coach from that client until one runs.
    /// </summary>
    private static readonly CoachAttentionKind[] RankOrder =
    [
        CoachAttentionKind.CheckInToReview,
        CoachAttentionKind.UnreadMessages,
        CoachAttentionKind.RenewalRequested,
        CoachAttentionKind.NoPlan,
        CoachAttentionKind.PlanEndingSoon,
        CoachAttentionKind.WeekNotShared,
        CoachAttentionKind.MissedSessions,
        CoachAttentionKind.NoProgram,
        CoachAttentionKind.MaxesToReview,
    ];

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

        // Audit COACH-9 (the owner's decision of 2026-10-19): a client who joined lately and has no plan at all
        // asks for one; an ended, unpaid, coming or blocked plan is not "no plan".
        if (planState == ClientPlanState.None &&
            signals.JoinedOn is { } joinedOn &&
            IsNew(joinedOn, today))
        {
            flags.Add(CoachAttentionKind.NoPlan);
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

        if (signals.MaxesToReview > 0)
        {
            flags.Add(CoachAttentionKind.MaxesToReview);
        }

        return flags;
    }

    /// <summary>
    /// Anything to act on besides a plan ending or maxes to review makes a client Needs attention; otherwise a
    /// paused plan shows Paused, a plan ending soon Ending soon, a running plan On track, and anything else
    /// (ended, unpaid, not started, none, blocked) No active plan. A client whose sets suggest heavier maxes is
    /// doing well, so that alone never turns them to Needs attention.
    /// </summary>
    public static ClientOverviewStatus Status(
        IReadOnlyCollection<CoachAttentionKind> flags,
        ClientPlanState planState) =>
        flags.Any(flag => flag is not (CoachAttentionKind.PlanEndingSoon or CoachAttentionKind.MaxesToReview))
            ? ClientOverviewStatus.NeedsAttention
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
            .OrderBy(item => RankOf(item.Kind))
            .ThenByDescending(item => item.Kind == CoachAttentionKind.MissedSessions ? item.Count ?? 0 : 0)
            .ThenBy(item => item.Since ?? DateTimeOffset.MaxValue)
            .ThenBy(item => item.Date ?? DateOnly.MaxValue)
            .ThenBy(item => item.Client.LastName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Client.FirstName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Client.ClientProfileId)
            .ToArray();

    /// <summary>Where a kind stands in the queue; a kind this rule does not know goes last.</summary>
    public static int RankOf(CoachAttentionKind kind)
    {
        var index = Array.IndexOf(RankOrder, kind);
        return index < 0 ? RankOrder.Length : index;
    }
}

/// <summary>
/// What the attention rule weighs about one client. Each signal is already limited to what the
/// client's plan includes: no check-ins, messages or training signals for a feature it does not cover.
/// </summary>
/// <param name="RenewalRequestedOn">The latest request's date, set only while the whole plan is still ended (ADR 0029).</param>
/// <param name="PlanLastDay">The last day the current and following plans cover.</param>
/// <param name="MissedSinceLastWorkout">Training rule TRN-021.</param>
/// <param name="HasNoProgram">Training is in the plan but no block is running or coming.</param>
/// <param name="MaxesToReview">Lifts of a running block whose logged sets suggest a new max (STR-012).</param>
/// <param name="JoinedOn">The workspace day the client joined, for a new client with no plan (audit COACH-9).</param>
public sealed record ClientAttentionSignals(
    int CheckInsToReview,
    long UnreadMessages,
    DateOnly? RenewalRequestedOn,
    DateOnly? PlanLastDay,
    bool HasWeekToShare,
    int MissedSinceLastWorkout,
    bool HasNoProgram,
    int MaxesToReview = 0,
    DateOnly? JoinedOn = null);
