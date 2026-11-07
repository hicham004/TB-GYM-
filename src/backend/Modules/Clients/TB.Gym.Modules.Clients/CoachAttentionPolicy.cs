using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

/// <summary>
/// Coach attention v7 (CLI-018; v1 in R3.1, v2 in P4c added maxes to review, v3 in audit A8 a new client with no
/// plan, v4 in critique B4a an overdue check-in and the plan's own status, v5 in critique B10c packs running out, v6
/// in critique B13 a coaching plan that ran out reads as ended beside a running pack, SES-010, v7 in the notes plan's
/// N10a removed maxes to review on the owner's word, 7 Nov 2026):
/// which of a client's signals ask the coach to act, how the queue is ranked, the one status the client list shows
/// and the plan's status beside it.
/// The signals arrive already gated by the client's plan, so this rule only weighs them; what makes a check-in
/// overdue is the CheckIns module's rule (CHK-015, overdue check-ins v1), counted here.
/// </summary>
public static class CoachAttentionPolicy
{
    public const string Key = "CoachAttention";
    public const int Version = 7;

    /// <summary>
    /// A running plan whose last covered day falls within this many days, today counted, is ending soon: a last
    /// day 13 days from today is, one 14 days from today is not. The screens show the flag, never their own count.
    /// </summary>
    public const int PlanEndingWithinDays = 14;

    /// <summary>
    /// With this many sessions left or fewer, on the packs paid for and not over, a client's sessions are running
    /// out (SES-008). Their last day counts as a plan's does (<see cref="PlanEndingWithinDays"/>).
    /// </summary>
    public const int SessionsRunningOutAt = 2;

    /// <summary>Missed sessions since the last workout (TRN-021) that ask for the coach.</summary>
    public const int MissedSessionsThreshold = 2;

    /// <summary>A renewal request stays in the queue this many days while the plan is still ended.</summary>
    public const int RenewalRequestDays = 30;

    /// <summary>
    /// A plan whose last day falls within this many days, today counted, ran out lately: Today lists it under Ended,
    /// not renewed (CLI-020, critique B4b). A last day 29 days ago is listed, one 30 days ago is not.
    /// </summary>
    public const int PlanEndedWithinDays = 30;

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
        CoachAttentionKind.SessionsRunningOut,
        CoachAttentionKind.WeekNotShared,
        CoachAttentionKind.MissedSessions,
        CoachAttentionKind.CheckInOverdue,
        CoachAttentionKind.NoProgram,
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

        if (signals.SessionsLeft is { } sessionsLeft &&
            (sessionsLeft <= SessionsRunningOutAt ||
             (signals.SessionsLastDay is { } sessionsEnd && sessionsEnd < today.AddDays(PlanEndingWithinDays))))
        {
            flags.Add(CoachAttentionKind.SessionsRunningOut);
        }

        if (signals.HasWeekToShare)
        {
            flags.Add(CoachAttentionKind.WeekNotShared);
        }

        if (signals.MissedSinceLastWorkout >= MissedSessionsThreshold)
        {
            flags.Add(CoachAttentionKind.MissedSessions);
        }

        if (signals.CheckInsOverdue > 0)
        {
            flags.Add(CoachAttentionKind.CheckInOverdue);
        }

        if (signals.HasNoProgram)
        {
            flags.Add(CoachAttentionKind.NoProgram);
        }

        return flags;
    }

    /// <summary>
    /// Anything to act on besides a plan ending or sessions running out makes a client Needs attention; otherwise the
    /// plan's own status (<see cref="PlanStatus"/>).
    /// </summary>
    public static ClientOverviewStatus Status(
        IReadOnlyCollection<CoachAttentionKind> flags,
        ClientPlanState planState) =>
        flags.Any(flag => flag is not (CoachAttentionKind.PlanEndingSoon or CoachAttentionKind.SessionsRunningOut))
            ? ClientOverviewStatus.NeedsAttention
            : PlanStatus(flags, planState) switch
            {
                ClientPlanStatus.Paused => ClientOverviewStatus.Paused,
                ClientPlanStatus.EndingSoon => ClientOverviewStatus.EndingSoon,
                ClientPlanStatus.OnTrack => ClientOverviewStatus.OnTrack,
                _ => ClientOverviewStatus.NoActivePlan,
            };

    /// <summary>
    /// The plan's own status, whatever else waits for the coach (critique B4a: a plan's end keeps its own status,
    /// outside Needs attention): a paused plan Paused, a plan ending soon Ending soon, a running plan On track, a
    /// blocked client Access blocked (critique B11: a block changes no plan, SUB-010, so their plan is still shown
    /// and "no active plan" would contradict it), and anything else (ended, unpaid, not started, none) No active plan.
    /// </summary>
    public static ClientPlanStatus PlanStatus(
        IReadOnlyCollection<CoachAttentionKind> flags,
        ClientPlanState planState) =>
        planState == ClientPlanState.Paused ? ClientPlanStatus.Paused
        : flags.Contains(CoachAttentionKind.PlanEndingSoon) ? ClientPlanStatus.EndingSoon
        : planState == ClientPlanState.Running ? ClientPlanStatus.OnTrack
        : planState == ClientPlanState.Blocked ? ClientPlanStatus.AccessBlocked
        : ClientPlanStatus.NoActivePlan;

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

    /// <summary>The earliest last day of a plan that ran out lately (<see cref="PlanEndedWithinDays"/>).</summary>
    public static DateOnly EndedLatelyFrom(DateOnly today) => today.AddDays(1 - PlanEndedWithinDays);

    /// <summary>Whether a plan whose last covered day was <paramref name="lastDay"/> has run out, lately.</summary>
    public static bool EndedLately(DateOnly lastDay, DateOnly today) =>
        lastDay < today && lastDay >= EndedLatelyFrom(today);

    /// <summary>
    /// Whether the client's whole plan has lapsed (critique B4b): something ran out or waits for payment, and
    /// nothing else runs, is paused, is paid and still to come, was cancelled or is blocked. Every feature's
    /// decision is Expired, NoEntitlement or PaymentRequired: SUB-014's ended plan, or one whose next plan is
    /// booked but not paid (SUB-008), which covers nothing until it is.
    /// </summary>
    public static bool IsLapsed(IReadOnlyCollection<FeatureAccessDecision> decisions) =>
        decisions.Any(decision => decision.Reason is FeatureAccessReason.Expired or FeatureAccessReason.PaymentRequired) &&
        decisions.All(decision => decision.Reason is
            FeatureAccessReason.Expired or FeatureAccessReason.PaymentRequired or FeatureAccessReason.NoEntitlement);

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
/// <param name="JoinedOn">The workspace day the client joined, for a new client with no plan (audit COACH-9).</param>
/// <param name="CheckInsOverdue">
/// Check-ins the client has not sent that are overdue by the CheckIns module's rule (CHK-015): due 2 to 13 days ago,
/// read only while check-ins are in the plan.
/// </param>
/// <param name="SessionsLeft">
/// What is left on the packs paid for and not over (SES-008), read only while sessions are in today's plan.
/// </param>
/// <param name="SessionsLastDay">The last of those packs' last days, a day still to run.</param>
public sealed record ClientAttentionSignals(
    int CheckInsToReview,
    long UnreadMessages,
    DateOnly? RenewalRequestedOn,
    DateOnly? PlanLastDay,
    bool HasWeekToShare,
    int MissedSinceLastWorkout,
    bool HasNoProgram,
    DateOnly? JoinedOn = null,
    int CheckInsOverdue = 0,
    int? SessionsLeft = null,
    DateOnly? SessionsLastDay = null);
