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
    /// <summary>Who needs the caller now, what their clients did lately, and this week's sessions.</summary>
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

    /// <summary>The client's logged sets suggest new training maxes (STR-012); good news, so last.</summary>
    MaxesToReview = 8,
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
/// <item><c>CheckInToReview</c>: Count waiting, Since the oldest was sent, SubjectId its assignment.</item>
/// <item><c>UnreadMessages</c>: Count unread, Since the oldest unread was sent, SubjectId the conversation.</item>
/// <item><c>RenewalRequested</c>: Since the client asked, Date the ended plan's last day, SubjectId that enrollment.</item>
/// <item><c>PlanEndingSoon</c>: Date the plan's last covered day, SubjectId the enrollment ending last.</item>
/// <item><c>WeekNotShared</c>: Date the week starts, WeekNumber, SubjectId the program block.</item>
/// <item><c>MissedSessions</c>: Count missed since the last workout, Date that workout's day (null if none).</item>
/// <item><c>NoProgram</c>: Date the client joined, SubjectId their latest program (null if they never had
/// one), and Maxes what its logged sets suggest, for the next program to start from (STR-014).</item>
/// <item><c>MaxesToReview</c>: Count of lifts, Since the newest set behind them was logged, SubjectId the
/// program, and Maxes each lift with its max and the suggestion.</item>
/// </list>
/// </summary>
public sealed record CoachAttentionItemView(
    CoachAttentionKind Kind,
    CoachClientRef Client,
    DateTimeOffset? Since,
    DateOnly? Date,
    int? Count,
    int? WeekNumber,
    Guid? SubjectId,
    IReadOnlyList<CoachMaxSuggestionView>? Maxes = null);

/// <summary>
/// A lift whose max the client's logged sets suggest changing (STR-012), named with both numbers so the coach
/// knows what happened before opening anything. Values are in the program's unit and never converted.
/// </summary>
public sealed record CoachMaxSuggestionView(
    Guid ExerciseId,
    string ExerciseName,
    decimal Current,
    decimal Suggested,
    CoachActivityLoadUnit Unit);

/// <summary>Sessions programmed and completed on one workspace day.</summary>
public sealed record SessionDayCountView(DateOnly Date, int Scheduled, int Completed);

/// <summary>This workspace week, counted over every client the caller coaches whose plan includes training.</summary>
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
/// Coach Today (C1). Counts come with what they were counted over: the week's dates, and the
/// activity's <see cref="ActivityFromUtc"/>. The attention queue is complete and ranked; the activity
/// feed is the newest <see cref="CoachAttentionPolicy.ActivityLimit"/> items since then.
/// </summary>
public sealed record CoachTodayView(
    DateOnly Today,
    string TimeZoneId,
    int ClientCount,
    int PlansEndingSoonCount,
    int RenewalRequestCount,
    CoachWeekView Week,
    IReadOnlyList<CoachAttentionItemView> Attention,
    DateTimeOffset ActivityFromUtc,
    IReadOnlyList<CoachActivityItemView> Activity,
    string AttentionRuleKey,
    int AttentionRuleVersion,
    string TrainingRuleKey,
    int TrainingRuleVersion);

/// <summary>
/// One client in the coach's list (C2). <see cref="RecentSessions"/> covers the view's recent days and
/// is null when the plan does not include training; <see cref="PlanEndsOn"/> is the last day the plan
/// covers, past when it has ended.
/// </summary>
public sealed record ClientOverviewRow(
    CoachClientRef Client,
    string? Goals,
    DateOnly JoinedOn,
    bool IsNew,
    ClientOverviewStatus Status,
    ClientPlanState PlanState,
    DateOnly? PlanEndsOn,
    IReadOnlyList<CoachAttentionKind> Attention,
    CoachActivityKind? LastActivityKind,
    DateTimeOffset? LastActivityAtUtc,
    IReadOnlyList<SessionDayCountView>? RecentSessions);

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
