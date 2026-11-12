using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

/// <summary>
/// The coach's overview reads: Coach Today (C1) and the client list (C2) from R3.1, and one client's
/// own slice of them for the client page (C3, R3.3b). All cover the clients the caller coaches
/// (ADR 0026: a Coach their own, the Owner all) and leave out former clients. Each training, check-in
/// and message signal is read only while the client's plan includes that feature (ADR 0013), and a
/// weigh-in only while the relationship is not blocked.
/// </summary>
/// <remarks>
/// The shape lives here; the composition is in Infrastructure, because only that layer may read the
/// other modules. So these contracts carry dates, counts and this module's own enums, never another
/// module's types.
/// </remarks>
public interface ICoachOverviewService
{
    /// <summary>
    /// Who needs the caller now, this month's money received and active clients, the plans ending soon or ended
    /// and not renewed, and what their clients did lately.
    /// </summary>
    Task<CoachTodayView> GetTodayAsync(CancellationToken cancellationToken);

    /// <summary>Every client the caller coaches, with status, last activity and the last seven days.</summary>
    Task<ClientOverviewView> ListAsync(CancellationToken cancellationToken);

    /// <summary>
    /// One client the caller coaches, as Today and the list already work them out; null when the caller
    /// does not coach them, or they do not exist, or they are a former client.
    /// </summary>
    Task<ClientProfileOverviewView?> GetClientAsync(Guid clientProfileId, CancellationToken cancellationToken);
}

/// <summary>Something waiting for the coach, most urgent first (CLI-018).</summary>
public enum CoachAttentionKind
{
    CheckInToReview = 1,
    UnreadMessages = 2,
    RenewalRequested = 3,
    PlanEndingSoon = 4,
    WeekNotShared = 5,
    MissedSessions = 6,
    NoProgram = 7,

    // 8 was MaxesToReview (P4c), removed in Coach attention v7 on the owner's word (7 Nov 2026): kinds travel by name,
    // and 8 is never given to another kind.

    /// <summary>
    /// A client who joined within the last 14 days has no plan at all: start one (audit COACH-9). Ranked after a
    /// renewal request (<see cref="CoachAttentionPolicy.RankOf"/>), whatever its number.
    /// </summary>
    NoPlan = 9,

    /// <summary>
    /// A check-in the client has not sent, due 2 to 13 days ago, while check-ins are in the plan (CHK-015, critique
    /// B4a). Ranked after missed sessions (<see cref="CoachAttentionPolicy.RankOf"/>).
    /// </summary>
    CheckInOverdue = 10,

    /// <summary>
    /// The sessions a client has paid for are nearly used, or the last of their packs is close to its end (critique
    /// B10c, SES-008). A commercial matter like a plan's end, ranked right after it and outside Needs attention.
    /// </summary>
    SessionsRunningOut = 11,

    /// <summary>
    /// Lifts with a "Last time + step" set whose coming workout has a weight for the coach to apply (notes plan N6d,
    /// STR-019, STR-020): a step up, or last time's weight kept where the workout is set at another. The coach's
    /// weekly homework (decision 21), so it ranks last and never makes a client Needs attention.
    /// </summary>
    WeightsToApply = 12,
}

/// <summary>The one status a client shows in the coach's list (CLI-018).</summary>
public enum ClientOverviewStatus
{
    NeedsAttention = 1,
    Paused = 2,
    EndingSoon = 3,
    OnTrack = 4,
    NoActivePlan = 5,
}

/// <summary>
/// The plan's own status, shown beside whatever waits for the coach (critique B4a): a plan's end keeps its own
/// status, outside Needs attention (<see cref="CoachAttentionPolicy.PlanStatus"/>).
/// </summary>
public enum ClientPlanStatus
{
    OnTrack = 1,
    Paused = 2,
    EndingSoon = 3,
    NoActivePlan = 4,
    AccessBlocked = 5,
}

/// <summary>Where the client's plan stands today, read from their feature access decisions.</summary>
public enum ClientPlanState
{
    Running = 1,
    Paused = 2,
    PaymentDue = 3,
    NotStarted = 4,
    Ended = 5,
    None = 6,
    Blocked = 7,
}

/// <summary>
/// Something a client did. The feed carries workouts and check-ins; a weigh-in counts only as a
/// client's last activity, because most clients weigh in every day and would crowd the feed out.
/// </summary>
public enum CoachActivityKind
{
    WorkoutCompleted = 1,
    CheckInSubmitted = 2,
    WeighInLogged = 3,
}

/// <summary>The unit a load was lifted in. Values are never converted (SYS-007).</summary>
public enum CoachActivityLoadUnit
{
    Kilogram = 1,
    Pound = 2,
}

/// <summary>Who an item is about, and who coaches them, so an Owner can tell their team's clients apart.</summary>
public sealed record CoachClientRef(
    Guid ClientProfileId,
    string FirstName,
    string LastName,
    Guid AssignedCoachUserId,
    string? AssignedCoachName);

/// <summary>
/// One thing waiting for the coach. Which fields are set depends on <see cref="Kind"/>:
/// <list type="bullet">
/// <item><c>CheckInToReview</c>: Count waiting, Since the oldest was sent (the rank), NewestAt the newest (audit
/// CLIENT-19), SubjectId the oldest's assignment.</item>
/// <item><c>UnreadMessages</c>: Count unread, Since the oldest unread was sent, SubjectId the conversation.</item>
/// <item><c>RenewalRequested</c>: Since the client asked, Date the ended plan's last day, SubjectId that enrollment.</item>
/// <item><c>PlanEndingSoon</c>: Date the plan's last paid day (BEB-7). Count the renewals after it still waiting
/// for payment (null when none), and then SubjectId the first of them, the plan to record a payment on;
/// otherwise SubjectId the paid enrollment ending last, the plan to renew. SessionsLeft is set when that plan is a pack
/// standing as the client's plan (ADR 0038), which says its end once, here, rather than as SessionsRunningOut too.</item>
/// <item><c>WeekNotShared</c>: Date the week starts, WeekNumber, SubjectId the program block.</item>
/// <item><c>MissedSessions</c>: Count missed since the last workout, Date that workout's day (null if none).</item>
/// <item><c>NoProgram</c>: Date the client joined, SubjectId their latest program not cancelled (null if they never
/// had one).</item>
/// <item><c>NoPlan</c>: Date the client joined.</item>
/// <item><c>CheckInOverdue</c>: Count overdue, Date the oldest one's due day, SubjectId the caller's chat with the
/// client for Remind, set only when <see cref="CanMessage"/> holds and that chat exists. With CanMessage and no
/// chat yet, Remind starts it as the client page's Message does; without CanMessage (messaging not in the plan, or
/// another coach's client, CLI-013) there is no chat to open, and the screen links to the client's check-ins.</item>
/// <item><c>SessionsRunningOut</c>: SessionsLeft on the packs paid for and not over, Date the last of their last days.
/// Count the packs still waiting for payment (null when none), and then SubjectId the first of them, the pack to
/// record a payment on; otherwise SubjectId the paid pack ending last, the pack to renew.</item>
/// <item><c>WeightsToApply</c>: Count the lifts with a weight to apply (one per writing, as the client's Training tab
/// lists them), StepUps how many of those step up (the rest keep last time's weight), Date the soonest of their coming
/// workouts' days, in its program's calendar.</item>
/// </list>
/// <see cref="CanMessage"/> is set on every item: the caller may message this client now, being the client's own
/// coach with messaging in today's plan (CLI-013, ADR 0026).
/// </summary>
public sealed record CoachAttentionItemView(
    CoachAttentionKind Kind,
    CoachClientRef Client,
    DateTimeOffset? Since,
    DateOnly? Date,
    int? Count,
    int? WeekNumber,
    Guid? SubjectId,
    DateTimeOffset? NewestAt = null,
    bool CanMessage = false,
    int? SessionsLeft = null,
    int? StepUps = null);

/// <summary>Sessions programmed and completed on one workspace day.</summary>
public sealed record SessionDayCountView(DateOnly Date, int Scheduled, int Completed);

/// <summary>The workspace calendar week of one client's page (R3.3b), while their plan includes training.</summary>
public sealed record CoachWeekView(
    DateOnly From,
    DateOnly ToExclusive,
    int Scheduled,
    int Completed,
    IReadOnlyList<SessionDayCountView> Days);

/// <summary>A record set in a finished workout (TRN-019), in the unit it was lifted in.</summary>
public sealed record CoachActivityRecordView(
    string ExerciseName,
    int Repetitions,
    decimal Load,
    CoachActivityLoadUnit Unit);

/// <summary>
/// One line of the feed. A finished workout carries its session name as Title, its duration and its
/// records; a sent check-in its form title. SubjectId is the workout or the check-in's assignment.
/// </summary>
public sealed record CoachActivityItemView(
    CoachActivityKind Kind,
    CoachClientRef Client,
    DateTimeOffset OccurredAtUtc,
    Guid SubjectId,
    string? Title,
    int? DurationSeconds,
    IReadOnlyList<CoachActivityRecordView> PersonalRecords);

/// <summary>
/// Coach Today (C1). Counts come with what they were counted over: the month's dates, and the
/// activity's <see cref="ActivityFromUtc"/>. The attention queue is complete and ranked; the activity
/// feed is the newest <see cref="CoachAttentionPolicy.ActivityLimit"/> items since then. Critique B4b
/// took the workspace week's sessions off Today (a client's page keeps its own week) and added
/// <see cref="Month"/> and the two plan lists (CLI-020).
/// </summary>
/// <param name="ClientCount">Every current client the caller coaches (CLI-013), never a former one.</param>
/// <param name="PlansEndingSoon">
/// Each client whose running plan raises the ending-soon flag (CLI-018), the soonest end first, then by name.
/// </param>
/// <param name="PlansEndedNotRenewed">
/// Each client whose plan ran out in the last <see cref="CoachAttentionPolicy.PlanEndedWithinDays"/> days with
/// nothing after it but, at most, a plan waiting for payment (<see cref="CoachAttentionPolicy.IsLapsed"/>), the
/// latest end first, then by name. Never a cancelled plan, and never a former client.
/// </param>
public sealed record CoachTodayView(
    DateOnly Today,
    string TimeZoneId,
    int ClientCount,
    int PlansEndingSoonCount,
    int RenewalRequestCount,
    CoachMonthView Month,
    IReadOnlyList<CoachPlanEndingView> PlansEndingSoon,
    IReadOnlyList<CoachPlanEndedView> PlansEndedNotRenewed,
    IReadOnlyList<CoachAttentionItemView> Attention,
    DateTimeOffset ActivityFromUtc,
    IReadOnlyList<CoachActivityItemView> Activity,
    string AttentionRuleKey,
    int AttentionRuleVersion,
    string TrainingRuleKey,
    int TrainingRuleVersion);

/// <summary>
/// This month on Coach Today (critique B4b), for the workspace's calendar month <c>[From, ToExclusive)</c>, of which
/// <see cref="CoachTodayView.Today"/> is the last day so far.
/// </summary>
/// <param name="MoneyReceived">
/// Money received this month by money received v1 (SUB-016, <see cref="MoneyRuleKey"/>), one total per currency in
/// currency order, empty with none: never added, netted or converted across currencies, never profit or earnings.
/// The Owner's is every receipt of the workspace; a Coach's only the receipts that count for them, with no client
/// named.
/// </param>
/// <param name="ActiveClientCount">
/// The current clients the caller coaches whose plan runs today (any feature granted), out of
/// <see cref="CoachTodayView.ClientCount"/>.
/// </param>
/// <param name="Coaches">
/// The Owner's alone, null for a Coach (CLI-013): every active member of staff, the Owner first as You, then by
/// name, each with their current clients and how many of them are active.
/// </param>
/// <param name="SessionsHeld">
/// The 1-on-1 sessions held this month that still stand, on the workspace day they happened (SES-008): the Owner's
/// every one of the workspace, a Coach's those they held. Null while there is nothing to count from: none held this
/// month and no client the caller coaches with sessions in today's plan.
/// </param>
public sealed record CoachMonthView(
    DateOnly From,
    DateOnly ToExclusive,
    IReadOnlyList<CoachMoneyReceivedView> MoneyReceived,
    int ActiveClientCount,
    IReadOnlyList<CoachClientCountView>? Coaches,
    string MoneyRuleKey,
    int MoneyRuleVersion,
    int? SessionsHeld = null);

/// <summary>Money received in one currency, exact, with how many payments (part payments included) made it up.</summary>
public sealed record CoachMoneyReceivedView(string Currency, decimal Amount, int PaymentCount);

/// <summary>One member of staff on the Owner's This month: their current clients and how many have a plan running.</summary>
public sealed record CoachClientCountView(
    Guid CoachUserId,
    string Name,
    bool IsYou,
    int ActiveClientCount,
    int ClientCount);

/// <summary>
/// A plan ending soon (critique B4b): the paid plan whose last covered day raised the flag (BEB-7), to renew.
/// </summary>
/// <param name="EnrollmentId">The paid plan ending last: the plan Renew renews.</param>
/// <param name="UnpaidRenewalId">
/// The first renewal already booked after it and still waiting for payment, null with none: it covers nothing until
/// paid (SUB-008), so its payment is what to record rather than a second renewal.
/// </param>
/// <param name="CanMessage">
/// The caller may message the client now: their own coach, with messaging in today's plan (CLI-013, ADR 0026).
/// </param>
/// <param name="ChatId">The caller's chat with the client, set only with <see cref="CanMessage"/> once one exists.</param>
public sealed record CoachPlanEndingView(
    CoachClientRef Client,
    Guid EnrollmentId,
    string PlanName,
    DateOnly LastDay,
    Guid? UnpaidRenewalId,
    bool CanMessage,
    Guid? ChatId);

/// <summary>
/// A plan that ran out lately and was not renewed (critique B4b).
/// </summary>
/// <param name="EnrollmentId">The plan that ran out, the one ending last: the plan Renew renews.</param>
/// <param name="UnpaidRenewalId">
/// A plan booked after it and still waiting for payment, null with none: the row records its payment instead of
/// renewing.
/// </param>
/// <param name="RenewalRequestedOn">
/// The workspace day the client asked to renew (ADR 0029), within the last
/// <see cref="CoachAttentionPolicy.RenewalRequestDays"/> days, as Needs you's renewal request names it.
/// </param>
/// <param name="ClientVersion">
/// The Owner's alone, null for a Coach: the client's version, which ending their coaching asks for (ADR 0027).
/// </param>
public sealed record CoachPlanEndedView(
    CoachClientRef Client,
    Guid EnrollmentId,
    string PlanName,
    DateOnly LastDay,
    Guid? UnpaidRenewalId,
    DateOnly? RenewalRequestedOn,
    uint? ClientVersion);

/// <summary>
/// One client in the coach's list (C2). <see cref="RecentSessions"/> covers the view's recent days and
/// is null when the plan does not include training; <see cref="PlanEndsOn"/> is the last day the plan
/// covers, past when it has ended. <see cref="OnboardingStatus"/> says whether the client has finished
/// setting up their profile, for the list's "Not set up yet" (audit LOST-12).
/// </summary>
/// <param name="Attention">
/// Every kind the client raised, in rank order: the kinds of <see cref="AttentionItems"/>, and SessionsRunningOut even
/// when its pack, standing as the client's plan, says so on PlanEndingSoon's item.
/// </param>
/// <param name="BirthDate">
/// The current profile's date of birth, for the age worked out on screen for the view's today (CLI-005). A
/// returning client's new profile has its own (CLI-016), never the old one's.
/// </param>
/// <param name="PlanStatus">The plan's own status, shown beside the reasons whatever they are (critique B4a).</param>
/// <param name="Plan">
/// The plan whose last day <see cref="PlanEndsOn"/> is, as the client's page names it (R3.5b): the paid plan running
/// or booked that ends last, else an unpaid one, else the one that ran out. Null with none.
/// </param>
/// <param name="OtherPlanCount">
/// Further plans running or booked beside <see cref="Plan"/>: plans at once (SUB-004), a renewal already booked,
/// paid or waiting for payment. Their prices are never added to its price.
/// </param>
/// <param name="PlanPausedSince">
/// While the plan is paused (<see cref="ClientPlanState.Paused"/>), the workspace day it was paused. A pause has no
/// end of its own and resuming does not move the plan's end (SUB-006): the row says since when, never until when.
/// </param>
/// <param name="FeaturesToday">
/// The features the client's plan grants today, by the shared access decision, so a check-in or week that is not
/// shown reads as not in the plan rather than as nothing done (CHK-011).
/// </param>
/// <param name="AttentionItems">
/// What waits for the coach about this client, as Today's items, ranked as Today ranks them, each with what its
/// link needs. The plan's end is among them, though <see cref="PlanStatus"/> says it.
/// </param>
/// <param name="LastActivityTitle">The session's name when the last activity is a finished workout.</param>
/// <param name="LastCheckInSentAtUtc">
/// When the client last sent a check-in, read only while check-ins are in today's plan (CHK-011): null both when
/// none was sent and when check-ins are not in the plan, which <see cref="FeaturesToday"/> tells apart.
/// </param>
/// <param name="SessionsLeft">
/// What is left on the client's packs paid for and not over (SES-008), read only while sessions are in today's plan:
/// null with no pack running, as for a paused, blocked or unpaid one.
/// </param>
/// <param name="SelfDirected">
/// The client signed up into the house and trains as their own coach (CLI-026), which is why the row raises nothing.
/// </param>
public sealed record ClientOverviewRow(
    CoachClientRef Client,
    string? Goals,
    DateOnly JoinedOn,
    bool IsNew,
    ClientOnboardingStatus OnboardingStatus,
    ClientOverviewStatus Status,
    ClientPlanState PlanState,
    DateOnly? PlanEndsOn,
    IReadOnlyList<CoachAttentionKind> Attention,
    CoachActivityKind? LastActivityKind,
    DateTimeOffset? LastActivityAtUtc,
    IReadOnlyList<SessionDayCountView>? RecentSessions,
    DateOnly? BirthDate,
    ClientPlanStatus PlanStatus,
    ClientPlanSummary? Plan,
    int OtherPlanCount,
    DateOnly? PlanPausedSince,
    IReadOnlyList<CoachingFeature> FeaturesToday,
    IReadOnlyList<CoachAttentionItemView> AttentionItems,
    string? LastActivityTitle,
    DateTimeOffset? LastCheckInSentAtUtc,
    int? SessionsLeft = null,
    bool SelfDirected = false);

/// <summary>
/// One enrollment as a client's row sums it up (critique B4a): its name, what it includes, its length as it was
/// sold and its price, exact, in its own currency, all from what was booked (SUB-002, SUB-003). Never a total of
/// several plans, and never converted between currencies.
/// </summary>
public sealed record ClientPlanSummary(
    Guid EnrollmentId,
    string Name,
    IReadOnlyList<CoachingFeature> Features,
    int LengthCount,
    ClientPlanLengthUnit LengthUnit,
    decimal PriceAmount,
    string PriceCurrency);

/// <summary>The unit a plan's length was sold in.</summary>
public enum ClientPlanLengthUnit
{
    Day = 1,
    Week = 2,
}

/// <summary>
/// One client on their own page (C3): the status, what waits for the coach and the last activity the
/// list shows for them, with each waiting item carrying what its one-tap action needs, as Today's
/// queue does. <see cref="Week"/> is the workspace's calendar week (the same days Today counts), and
/// is null when the plan does not include training.
/// </summary>
/// <param name="PlanName">
/// The name the client's plan was sold under, for the plan <see cref="PlanEndsOn"/> is about: the
/// one running or booked that ends last, else the one that ran out (R3.5b). Null with no such plan.
/// </param>
/// <param name="LastWorkout">
/// The client's newest finished workout, with its duration and records, as Today's feed shows one;
/// null when the plan does not include training or nothing has been finished (R3.5b).
/// </param>
public sealed record ClientProfileOverviewView(
    DateOnly Today,
    CoachClientRef Client,
    DateOnly JoinedOn,
    bool IsNew,
    ClientOverviewStatus Status,
    ClientPlanState PlanState,
    DateOnly? PlanEndsOn,
    string? PlanName,
    IReadOnlyList<CoachAttentionItemView> Attention,
    CoachActivityKind? LastActivityKind,
    DateTimeOffset? LastActivityAtUtc,
    CoachActivityItemView? LastWorkout,
    CoachWeekView? Week,
    string AttentionRuleKey,
    int AttentionRuleVersion,
    string TrainingRuleKey,
    int TrainingRuleVersion);

/// <summary>The client list (C2), sorted by name, with the span the recent sessions were counted over.</summary>
public sealed record ClientOverviewView(
    DateOnly Today,
    DateOnly RecentFrom,
    DateOnly RecentToExclusive,
    IReadOnlyList<ClientOverviewRow> Clients,
    string AttentionRuleKey,
    int AttentionRuleVersion,
    string TrainingRuleKey,
    int TrainingRuleVersion);
