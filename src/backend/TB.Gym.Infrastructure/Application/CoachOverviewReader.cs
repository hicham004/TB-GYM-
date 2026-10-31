using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Read-side composition of Coach Today and the client list (R3.1), built like the progress
/// dashboard (ADR 0013): it owns no table, writes nothing and copies nothing.
/// </summary>
/// <remarks>
/// The Clients module owns the shape and the attention rule (CLI-018) and Training owns what a missed
/// session is (TRN-021); this class only reads. Each read is one set-based query over every client in
/// scope, so a coach with sixty clients costs what a coach with one does. Rows of a feature are read
/// only for clients whose plan includes it, decided once for all of them by the shared access
/// service, so a lapsed plan's training or check-ins never surface here when the screens that own them
/// would refuse.
/// </remarks>
internal sealed class CoachOverviewReader(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    CoachClientScope coachClientScope,
    ICoachingFeatureAccessService featureAccessService)
    : ICoachOverviewService
{
    /// <summary>Names the three record reads in the SQL they send, for logs and for the test that counts their rows.</summary>
    internal const string RecordSetsTag = "Coach overview: the sets of the workouts shown";

    internal const string EarlierBestTag = "Coach overview: each client's best loads before the workouts shown";

    internal const string RecentSetsTag = "Coach overview: the sets finished while the workouts shown began";

    /// <summary>Names This month's two reads (critique B4b) in the SQL they send, for logs and for the tests that count them.</summary>
    internal const string MoneyReceivedTag = "Coach overview: money received this month";

    internal const string CoachesTag = "Coach overview: the owner's team";

    /// <summary>Names the read of This month's 1-on-1 sessions (critique B10c), for logs and for the test that counts it.</summary>
    internal const string SessionsHeldTag = "Coach overview: 1-on-1 sessions held this month";

    public async Task<CoachTodayView> GetTodayAsync(CancellationToken cancellationToken)
    {
        var scope = await LoadScopeAsync(null, cancellationToken);
        var today = scope.Calendar.Today;
        // Critique B4b took the week's sessions off Today: missed sessions look back from today alone, and the plans
        // that ran out lately come with the plans read for their ends.
        var states = await LoadStatesAsync(
            scope,
            today.AddDays(-TrainingAttentionPolicy.MissedLookbackDays),
            today.AddDays(1),
            CoachAttentionPolicy.EndedLatelyFrom(today),
            cancellationToken);
        var activityFromUtc = clock.UtcNow.AddDays(-CoachAttentionPolicy.ActivityDays);
        var activity = await LoadActivityAsync(scope, activityFromUtc, cancellationToken);
        var month = await LoadMonthAsync(scope, states, cancellationToken);

        return new CoachTodayView(
            today,
            scope.Calendar.TimeZoneId,
            scope.Clients.Count,
            states.Count(state => state.Flags.Contains(CoachAttentionKind.PlanEndingSoon)),
            states.Count(state => state.Flags.Contains(CoachAttentionKind.RenewalRequested)),
            month,
            PlansEndingSoon(states),
            PlansEndedNotRenewed(scope, states),
            CoachAttentionPolicy.Rank(states.SelectMany(Items)),
            activityFromUtc,
            activity,
            CoachAttentionPolicy.Key,
            CoachAttentionPolicy.Version,
            TrainingAttentionPolicy.Key,
            TrainingAttentionPolicy.Version);
    }

    public async Task<ClientOverviewView> ListAsync(CancellationToken cancellationToken)
    {
        var scope = await LoadScopeAsync(null, cancellationToken);
        var today = scope.Calendar.Today;
        var recentFrom = today.AddDays(1 - CoachAttentionPolicy.RecentDays);
        var states = await LoadStatesAsync(
            scope,
            Earliest(today.AddDays(-TrainingAttentionPolicy.MissedLookbackDays), recentFrom),
            today.AddDays(1),
            endedFrom: null,
            cancellationToken);
        // List-only reads, kept out of LoadStatesAsync so Today and a client's page pay nothing for them.
        var (lastActivity, lastCheckIns) = await LoadLastActivityAsync(scope, cancellationToken);
        var plans = await ReadPlanSummariesAsync(
            [.. states.Select(state => state.PlanEnrollmentId).OfType<Guid>()],
            cancellationToken);

        var rows = states.Select(state =>
        {
            lastActivity.TryGetValue(state.Client.Id, out var last);
            return new ClientOverviewRow(
                state.Client.Ref,
                state.Client.Goals,
                state.JoinedOn,
                CoachAttentionPolicy.IsNew(state.JoinedOn, today),
                state.Client.OnboardingStatus,
                CoachAttentionPolicy.Status(state.Flags, state.PlanState),
                state.PlanState,
                state.PlanEndsOn,
                state.Flags,
                last?.Kind,
                last?.AtUtc,
                state.TrainingIncluded ? Days(state.Sessions, recentFrom, CoachAttentionPolicy.RecentDays) : null,
                state.Client.BirthDate,
                CoachAttentionPolicy.PlanStatus(state.Flags, state.PlanState),
                state.PlanEnrollmentId is { } enrollmentId ? plans.GetValueOrDefault(enrollmentId) : null,
                state.OtherPlanCount,
                state.PlanPausedSince,
                scope.FeaturesToday(state.Client.Id),
                CoachAttentionPolicy.Rank(Items(state)),
                last?.Title,
                lastCheckIns.TryGetValue(state.Client.Id, out var sentAtUtc) ? sentAtUtc : null,
                state.Signals.SessionsLeft);
        }).ToArray();
        return new ClientOverviewView(
            today,
            recentFrom,
            today.AddDays(1),
            rows,
            CoachAttentionPolicy.Key,
            CoachAttentionPolicy.Version,
            TrainingAttentionPolicy.Key,
            TrainingAttentionPolicy.Version);
    }

    /// <summary>
    /// One client's page (C3): the same state, status and attention items the list and Today derive,
    /// for the one client, plus the workspace calendar week's sessions, scheduled and completed, day by
    /// day, while training is in the plan (Today no longer counts the week, critique B4b).
    /// </summary>
    public async Task<ClientProfileOverviewView?> GetClientAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var scope = await LoadScopeAsync(clientProfileId, cancellationToken);
        if (scope.Clients.Count == 0)
        {
            return null;
        }

        var today = scope.Calendar.Today;
        var weekFrom = StartOfWeek(today, scope.Calendar.WeekStartsOn);
        var states = await LoadStatesAsync(
            scope,
            Earliest(today.AddDays(-TrainingAttentionPolicy.MissedLookbackDays), weekFrom),
            Latest(today.AddDays(1), weekFrom.AddDays(7)),
            endedFrom: null,
            cancellationToken);
        var state = states.Single();
        var (lastActivity, _) = await LoadLastActivityAsync(scope, cancellationToken);
        lastActivity.TryGetValue(state.Client.Id, out var last);
        var planName = state.RunningPlanName ?? await ReadPlanNameAsync(state.EndedPlan?.EnrollmentId, cancellationToken);
        var lastWorkout = state.TrainingIncluded
            ? await LoadLastWorkoutAsync(scope, state.Client.Id, cancellationToken)
            : null;

        var days = Days(state.Sessions, weekFrom, 7);
        return new ClientProfileOverviewView(
            today,
            state.Client.Ref,
            state.JoinedOn,
            CoachAttentionPolicy.IsNew(state.JoinedOn, today),
            CoachAttentionPolicy.Status(state.Flags, state.PlanState),
            state.PlanState,
            state.PlanEndsOn,
            planName,
            CoachAttentionPolicy.Rank(Items(state)),
            last?.Kind,
            last?.AtUtc,
            lastWorkout,
            state.TrainingIncluded
                ? new CoachWeekView(
                    weekFrom,
                    weekFrom.AddDays(7),
                    days.Sum(day => day.Scheduled),
                    days.Sum(day => day.Completed),
                    days)
                : null,
            CoachAttentionPolicy.Key,
            CoachAttentionPolicy.Version,
            TrainingAttentionPolicy.Key,
            TrainingAttentionPolicy.Version);
    }

    // ---------- scope and per-client state ----------

    /// <summary>
    /// The caller's clients (ADR 0026: a Coach's own, every one for the Owner; never a former client),
    /// or just <paramref name="onlyClientProfileId"/> when that one is among them, the workspace
    /// calendar, and every client's access decisions from one batched evaluation.
    /// </summary>
    private async Task<Scope> LoadScopeAsync(Guid? onlyClientProfileId, CancellationToken cancellationToken)
    {
        var calendar = await WorkspaceCalendarReader.ReadAsync(
            dbContext,
            clock,
            tenantContext.TenantId,
            cancellationToken);
        var query = dbContext.ClientProfiles.AsNoTracking().Where(client => client.ReleasedAtUtc == null);
        if (onlyClientProfileId is { } clientProfileId)
        {
            query = query.Where(client => client.Id == clientProfileId);
        }

        if (await coachClientScope.RestrictedCoachUserIdAsync(cancellationToken) is { } coachUserId)
        {
            query = query.Where(client => client.AssignedCoachUserId == coachUserId);
        }

        var clients = await (
            from client in query
            join coach in dbContext.Users.AsNoTracking() on client.AssignedCoachUserId equals coach.Id
            orderby client.LastName, client.FirstName, client.Id
            select new ScopedClient(
                client.Id,
                client.FirstName,
                client.LastName,
                client.Goals,
                client.AssignedCoachUserId,
                coach.DisplayName,
                client.CreatedAtUtc,
                client.IsCoachBlocked,
                client.OnboardingStatus,
                client.BirthDate,
                client.Version))
            .ToListAsync(cancellationToken);
        var access = await featureAccessService.EvaluateManyAsync(
            tenantContext.TenantId,
            [.. clients.Select(client => client.Id)],
            cancellationToken);
        return new Scope(
            calendar,
            TimeZoneInfo.FindSystemTimeZoneById(calendar.TimeZoneId),
            currentUser.UserId ?? Guid.Empty,
            await coachClientScope.IsOwnerAsync(cancellationToken),
            clients,
            access);
    }

    /// <summary>
    /// Everything the attention rule and the status read about each client, with the sessions of
    /// <c>[sessionsFrom, sessionsTo)</c> for clients whose plan includes training. With
    /// <paramref name="endedFrom"/> (Today's alone), also each lapsed client's plan that ran out on or after that
    /// day, for Ended, not renewed (critique B4b), read with the plans' ends at no extra query.
    /// </summary>
    private async Task<IReadOnlyList<ClientState>> LoadStatesAsync(
        Scope scope,
        DateOnly sessionsFrom,
        DateOnly sessionsTo,
        DateOnly? endedFrom,
        CancellationToken cancellationToken)
    {
        var today = scope.Calendar.Today;
        var training = scope.Allowed(CoachingFeature.Training);
        var checkIns = scope.Allowed(CoachingFeature.CheckIns);
        var messaging = scope.Allowed(CoachingFeature.Messaging);
        var sessionsOpen = scope.Allowed(CoachingFeature.Sessions).ToHashSet();
        var endedPlans = scope.Clients
            .Select(client => (client.Id, Plan: RenewalEligibility.EndedPlan(scope.Access[client.Id])))
            .Where(item => item.Plan is not null)
            .ToDictionary(item => item.Id, item => item.Plan!);

        var checkInRows = await ReadCheckInsAsync(checkIns, today, cancellationToken);
        var chats = await ReadChatsAsync(scope.CallerUserId, messaging, cancellationToken);
        var renewals = await ReadRenewalRequestsAsync([.. endedPlans.Keys], today, cancellationToken);
        var plans = await ReadPlanEndsAsync(scope.Ids, today, endedFrom, cancellationToken);
        var blocks = await ReadOpenBlocksAsync(training, today, cancellationToken);
        var sessions = await ReadSessionsAsync(training, sessionsFrom, sessionsTo, cancellationToken);
        var lastStarts = await ReadLastWorkoutStartsAsync(training, cancellationToken);
        var maxes = await ReadMaxSuggestionsAsync(training, today, cancellationToken);

        return scope.Clients.Select(client =>
        {
            var decisions = scope.Access[client.Id];
            var planState = CoachAttentionPolicy.PlanState(decisions);
            var trainingIncluded = training.Contains(client.Id);
            var clientSessions = sessions[client.Id].ToArray();
            DateOnly? lastWorkoutOn = lastStarts.TryGetValue(client.Id, out var startedAtUtc)
                ? scope.LocalDate(startedAtUtc)
                : null;
            var missed = trainingIncluded
                ? TrainingAttentionPolicy.MissedSinceLastWorkout(
                    clientSessions.Select(session => new AttentionSession(session.ScheduledDate, session.Workout)),
                    lastWorkoutOn,
                    today)
                : 0;
            var clientBlocks = blocks[client.Id].ToArray();
            var weekToShare = TrainingAttentionPolicy.WeekToShare(
                clientBlocks.Where(row => row.Week is not null).Select(row => row.Week!),
                today);
            var clientCheckIns = checkInRows[client.Id].ToArray();
            var checkIn = clientCheckIns
                .Where(item => item.Status == CheckInResponseStatus.Submitted && item.SubmittedAtUtc is not null)
                .Select(item => new WaitingCheckIn(item.ClientProfileId, item.AssignmentId, item.SubmittedAtUtc!.Value))
                .OrderBy(item => item.SubmittedAtUtc)
                .ToArray();
            var late = clientCheckIns
                .Where(item => CheckInAttentionPolicy.IsOverdue(item.DueDate, item.Status, checkIns.Contains(client.Id), today))
                .OrderBy(item => item.DueDate)
                .ThenBy(item => item.AssignmentId)
                .ToArray();
            var clientChats = chats[client.Id].ToArray();
            var conversations = clientChats
                .Where(item => item.UnreadCount > 0 && item.OldestUnreadAtUtc is not null)
                .Select(item => new UnreadConversation(
                    item.ClientProfileId,
                    item.ConversationId,
                    item.UnreadCount,
                    item.OldestUnreadAtUtc!.Value))
                .OrderBy(item => item.OldestUnreadAtUtc)
                .ToArray();
            // Only the client's own coach messages them, while messaging is in the plan (CLI-013, ADR 0026).
            var canMessage = client.CoachUserId == scope.CallerUserId && messaging.Contains(client.Id);
            endedPlans.TryGetValue(client.Id, out var endedPlan);
            var renewal = endedPlan is null
                ? null
                : renewals[client.Id]
                    .Where(item => item.RequestedOn > endedPlan.LastDay)
                    .MaxBy(item => item.RequestedAtUtc);
            // BEB-7 (the owner's decision of 2026-10-19): only a paid plan covers days, so a renewal still
            // waiting for payment neither moves the plan's end nor quiets Ending soon; it is counted instead,
            // for the item to ask for the payment. With nothing paid, the unpaid plan still names the plan.
            var livePlans = plans[client.Id].Where(item => !item.Ended).ToArray();

            // A pack runs beside a plan (ADR 0038): it says when the client's plan ends only with no coaching plan
            // left, so 90 days of sessions never hide a plan ending soon.
            var coachingPlans = livePlans.Where(item => !item.IsSessionPack).ToArray();
            var namingPlans = coachingPlans.Length > 0 ? coachingPlans : livePlans;
            var runningPlan = namingPlans.Where(item => item.Paid).MaxBy(item => item.EndDateExclusive)
                ?? namingPlans.MaxBy(item => item.EndDateExclusive);
            var unpaidRenewals = runningPlan is { Paid: true }
                ? namingPlans
                    .Where(item => !item.Paid && item.EndDateExclusive > runningPlan.EndDateExclusive)
                    .OrderBy(item => item.StartDate)
                    .ToArray()
                : [];
            // A pause has no end of its own (SUB-006), so the list says since when the plan covering today was
            // paused, and only while the plan is paused: another plan's pause is not this client's status.
            var pausedAtUtc = planState == ClientPlanState.Paused
                ? livePlans.Where(item => item.StartDate <= today).Min(item => item.PausedAtUtc)
                : null;

            // The client's balance (SES-008), said only while sessions are in today's plan: what is left on the packs
            // paid for and not over, one still to come included, so a pack already paid for quiets the item. A paused
            // pack takes no session (SES-006), and one waiting for payment holds none until it is paid.
            var paidPacks = sessionsOpen.Contains(client.Id)
                ? livePlans.Where(item => item is { IsSessionPack: true, Paid: true, PausedAtUtc: null }).ToArray()
                : [];
            var lastPack = paidPacks.MaxBy(item => item.EndDateExclusive);
            var unpaidPacks = paidPacks.Length > 0
                ? livePlans
                    .Where(item => item is { IsSessionPack: true, Paid: false })
                    .OrderBy(item => item.StartDate)
                    .ThenBy(item => item.EnrollmentId)
                    .ToArray()
                : [];
            var programs = maxes[client.Id].ToArray();
            var clientMaxes = Suggestions(programs.Where(item => item.IsOpen));

            // Between programs, the latest one's suggestions go with No program, for Assign program (STR-014).
            var lastProgram = clientBlocks.Length == 0
                ? programs.Where(item => !item.IsOpen).MaxBy(item => (item.StartDate, item.MesocycleId))
                : null;
            var carried = lastProgram is null
                ? []
                : Suggestions(programs.Where(item => item.MesocycleId == lastProgram.MesocycleId));
            var joinedOn = scope.LocalDate(client.CreatedAtUtc);

            // Ended, not renewed (critique B4b, CLI-020): the whole plan has lapsed and its plan that ran out last did
            // so lately; SUB-014's ended plan when there is one, as the client's Ask to renew and Needs you name it.
            // A plan booked after it and waiting for payment is named to record its payment instead of renewing.
            EndedNotRenewed? notRenewed = null;
            if (endedFrom is not null && CoachAttentionPolicy.IsLapsed(decisions))
            {
                var ranOut = plans[client.Id].Where(item => item.Ended).ToArray();
                var lapsed = endedPlan is { } ended
                    ? ranOut.FirstOrDefault(item => item.EnrollmentId == ended.EnrollmentId)
                    : ranOut.MaxBy(item => (item.EndDateExclusive, item.EnrollmentId));
                if (lapsed is not null && CoachAttentionPolicy.EndedLately(lapsed.EndDateExclusive.AddDays(-1), today))
                {
                    notRenewed = new EndedNotRenewed(
                        lapsed.EnrollmentId,
                        lapsed.PlanName,
                        lapsed.EndDateExclusive.AddDays(-1),
                        livePlans
                            .Where(item => !item.Paid)
                            .OrderBy(item => item.StartDate)
                            .ThenBy(item => item.EnrollmentId)
                            .FirstOrDefault()?.EnrollmentId);
                }
            }

            var signals = new ClientAttentionSignals(
                checkIn.Length,
                conversations.Sum(item => item.Count),
                renewal?.RequestedOn,
                runningPlan?.EndDateExclusive.AddDays(-1),
                weekToShare is not null,
                missed,
                trainingIncluded && clientBlocks.Length == 0,
                clientMaxes.Length,
                joinedOn,
                late.Length,
                lastPack is null ? null : paidPacks.Sum(item => item.SessionsLeft),
                lastPack?.EndDateExclusive.AddDays(-1));
            return new ClientState(
                client,
                joinedOn,
                planState,
                runningPlan?.EndDateExclusive.AddDays(-1) ?? endedPlan?.LastDay,
                runningPlan?.EnrollmentId,
                runningPlan?.PlanName,
                unpaidRenewals.Length,
                unpaidRenewals.FirstOrDefault()?.EnrollmentId,
                endedPlan,
                CoachAttentionPolicy.Flags(signals, planState, today),
                signals,
                checkIn.FirstOrDefault(),
                checkIn.LastOrDefault(),
                conversations.FirstOrDefault(),
                renewal,
                weekToShare,
                lastWorkoutOn,
                trainingIncluded,
                clientSessions,
                clientMaxes,
                lastProgram?.MesocycleId,
                carried,
                late.FirstOrDefault(),
                canMessage,
                canMessage
                    ? clientChats.OrderBy(item => item.ConversationId).Select(item => (Guid?)item.ConversationId).FirstOrDefault()
                    : null,
                pausedAtUtc is { } pausedAt ? scope.LocalDate(pausedAt) : null,
                livePlans.Count(item => item.EnrollmentId != runningPlan?.EnrollmentId),
                notRenewed,
                runningPlan is { IsSessionPack: true },
                unpaidPacks.Length,
                unpaidPacks.FirstOrDefault()?.EnrollmentId ?? lastPack?.EnrollmentId);
        }).ToArray();
    }

    /// <summary>The lifts of these program rows that suggest a new max, by name.</summary>
    private static MaxSuggestionRow[] Suggestions(IEnumerable<ProgramMaxRow> rows) =>
        [.. rows
            .Where(item => item.Suggestion is not null)
            .Select(item => item.Suggestion!)
            .OrderBy(item => item.ExerciseName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.ExerciseId)];

    /// <summary>One queue item for each kind the client raised, with what its one-tap action needs.</summary>
    private static IEnumerable<CoachAttentionItemView> Items(ClientState state) =>
        state.Flags.Where(kind => kind != CoachAttentionKind.SessionsRunningOut || !state.PackEndsAsPlan).Select(kind => kind switch
        {
            // The oldest waiting sets the rank; the newest is what the coach may not have seen yet (CLIENT-19).
            CoachAttentionKind.CheckInToReview => Item(kind, state, since: state.OldestCheckIn?.SubmittedAtUtc,
                count: state.Signals.CheckInsToReview, subjectId: state.OldestCheckIn?.AssignmentId,
                newestAt: state.NewestCheckIn?.SubmittedAtUtc),
            CoachAttentionKind.UnreadMessages => Item(kind, state, since: state.OldestUnread?.OldestUnreadAtUtc,
                count: (int)Math.Min(int.MaxValue, state.Signals.UnreadMessages),
                subjectId: state.OldestUnread?.ConversationId),
            CoachAttentionKind.RenewalRequested => Item(kind, state, since: state.Renewal?.RequestedAtUtc,
                date: state.EndedPlan?.LastDay, subjectId: state.EndedPlan?.EnrollmentId),
            CoachAttentionKind.PlanEndingSoon => Item(kind, state, date: state.PlanEndsOn,
                count: state.UnpaidRenewals > 0 ? state.UnpaidRenewals : null,
                subjectId: state.FirstUnpaidRenewalId ?? state.RunningEnrollmentId,
                sessionsLeft: state.PackEndsAsPlan ? state.Signals.SessionsLeft : null),
            CoachAttentionKind.SessionsRunningOut => Item(kind, state, date: state.Signals.SessionsLastDay,
                count: state.UnpaidPacks > 0 ? state.UnpaidPacks : null,
                subjectId: state.PackToActOn,
                sessionsLeft: state.Signals.SessionsLeft),
            CoachAttentionKind.WeekNotShared => Item(kind, state, date: state.WeekToShare?.StartsOn,
                weekNumber: state.WeekToShare?.WeekNumber, subjectId: state.WeekToShare?.MesocycleId),
            CoachAttentionKind.MissedSessions => Item(kind, state, date: state.LastWorkoutOn,
                count: state.Signals.MissedSinceLastWorkout),
            CoachAttentionKind.NoProgram => Item(kind, state, date: state.JoinedOn,
                subjectId: state.LastProgramId,
                maxes: state.CarriedSuggestions.Count == 0 ? null : MaxViews(state.CarriedSuggestions)),
            CoachAttentionKind.MaxesToReview => Item(kind, state,
                since: state.MaxSuggestions.Max(item => item.LoggedAtUtc),
                count: state.MaxSuggestions.Count,
                subjectId: state.MaxSuggestions.MaxBy(item => item.LoggedAtUtc)!.MesocycleId,
                maxes: MaxViews(state.MaxSuggestions)),
            CoachAttentionKind.NoPlan => Item(kind, state, date: state.JoinedOn),
            // The oldest overdue sets the day; Remind opens the caller's own chat, which only their own coach has
            // while messaging is in the plan (decided once, as CanMessage).
            CoachAttentionKind.CheckInOverdue => Item(kind, state, date: state.OldestOverdue?.DueDate,
                count: state.Signals.CheckInsOverdue, subjectId: state.CanMessage ? state.ChatId : null),
            _ => throw new InvalidOperationException($"Unknown attention kind {kind}."),
        });

    private static CoachAttentionItemView Item(
        CoachAttentionKind kind,
        ClientState state,
        DateTimeOffset? since = null,
        DateOnly? date = null,
        int? count = null,
        int? weekNumber = null,
        Guid? subjectId = null,
        IReadOnlyList<CoachMaxSuggestionView>? maxes = null,
        DateTimeOffset? newestAt = null,
        int? sessionsLeft = null) =>
        new(kind, state.Client.Ref, since, date, count, weekNumber, subjectId, maxes, newestAt, state.CanMessage, sessionsLeft);

    private static CoachMaxSuggestionView[] MaxViews(IEnumerable<MaxSuggestionRow> rows) =>
        [.. rows.Select(item => new CoachMaxSuggestionView(
            item.ExerciseId,
            item.ExerciseName,
            item.Current,
            item.Suggested,
            Unit(item.Unit),
            item.LoadIncrement))];

    private static SessionDayCountView[] Days(IEnumerable<SessionRow> sessions, DateOnly from, int dayCount)
    {
        var byDate = sessions
            .Where(session => session.ScheduledDate >= from && session.ScheduledDate < from.AddDays(dayCount))
            .ToLookup(session => session.ScheduledDate);
        return Enumerable.Range(0, dayCount)
            .Select(offset => from.AddDays(offset))
            .Select(date => new SessionDayCountView(
                date,
                byDate[date].Count(),
                byDate[date].Count(session => session.Workout == WorkoutExecutionStatus.Completed)))
            .ToArray();
    }

    // ---------- Today's This month and plan lists (critique B4b, CLI-020) ----------

    /// <summary>Each client whose running plan raised the ending-soon flag, the soonest end first.</summary>
    private static CoachPlanEndingView[] PlansEndingSoon(IEnumerable<ClientState> states) =>
        [.. states
            .Where(state => state.Flags.Contains(CoachAttentionKind.PlanEndingSoon) &&
                            state.RunningEnrollmentId is not null &&
                            state.PlanEndsOn is not null)
            .Select(state => new CoachPlanEndingView(
                state.Client.Ref,
                state.RunningEnrollmentId!.Value,
                state.RunningPlanName ?? string.Empty,
                state.PlanEndsOn!.Value,
                state.FirstUnpaidRenewalId,
                state.CanMessage,
                state.ChatId))
            .OrderBy(row => row.LastDay)
            .ThenBy(row => row.Client.LastName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Client.FirstName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Client.ClientProfileId)];

    /// <summary>
    /// Each lapsed client whose plan ran out lately, the latest end first. Only the owner ends a client's coaching
    /// (ADR 0027), so only the owner's rows carry the client's version it asks for.
    /// </summary>
    private static CoachPlanEndedView[] PlansEndedNotRenewed(Scope scope, IEnumerable<ClientState> states) =>
        [.. states
            .Where(state => state.NotRenewed is not null)
            .Select(state => new CoachPlanEndedView(
                state.Client.Ref,
                state.NotRenewed!.EnrollmentId,
                state.NotRenewed.PlanName,
                state.NotRenewed.LastDay,
                state.NotRenewed.UnpaidPlanId,
                state.Renewal?.RequestedOn,
                scope.IsOwner ? state.Client.Version : null))
            .OrderByDescending(row => row.LastDay)
            .ThenBy(row => row.Client.LastName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Client.FirstName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Client.ClientProfileId)];

    /// <summary>
    /// This month: money received by money received v1 (SUB-016) in the workspace's calendar month, the clients
    /// whose plan runs today, the 1-on-1 sessions held (SES-008), and for the owner alone the team with each member's
    /// clients. The owner reads every receipt and session of the workspace; anyone else only the receipts that count
    /// for them and the sessions they recorded, and no team.
    /// </summary>
    private async Task<CoachMonthView> LoadMonthAsync(
        Scope scope,
        IReadOnlyList<ClientState> states,
        CancellationToken cancellationToken)
    {
        var (from, toExclusive) = MoneyReceivedPolicy.MonthOf(scope.Calendar.Today);
        Guid? countsFor = scope.IsOwner ? null : scope.CallerUserId;
        var (readFromUtc, readToUtc) = MoneyReceivedPolicy.ReadWindowUtc(from, toExclusive, scope.TimeZone);
        var payments = await ReadPaymentsAsync(countsFor, readFromUtc, readToUtc, cancellationToken);
        var received = MoneyReceivedPolicy.Totals(payments, from, toExclusive, scope.TimeZone, countsFor);
        var active = states
            .Where(state => state.PlanState == ClientPlanState.Running)
            .Select(state => state.Client.Id)
            .ToHashSet();
        var held = await CountSessionsHeldAsync(countsFor, from, toExclusive, cancellationToken);
        return new CoachMonthView(
            from,
            toExclusive,
            [.. received.Select(total => new CoachMoneyReceivedView(total.CurrencyCode, total.Amount, total.PaymentCount))],
            active.Count,
            scope.IsOwner ? await ReadCoachesAsync(scope, active, cancellationToken) : null,
            MoneyReceivedPolicy.Key,
            MoneyReceivedPolicy.Version,
            held > 0 || scope.Allowed(CoachingFeature.Sessions).Length > 0 ? held : null);
    }

    /// <summary>
    /// The sessions held in the month that still stand: a session counts on its own workspace day, a former client's
    /// too, for the coach who recorded it (SES-003), and an undone one counts for nobody. A charge is no session held.
    /// </summary>
    private Task<int> CountSessionsHeldAsync(
        Guid? coachUserId,
        DateOnly from,
        DateOnly toExclusive,
        CancellationToken cancellationToken) =>
        dbContext.SessionLedgerEntries.AsNoTracking()
            .Where(entry => entry.Kind == SessionEntryKind.Held &&
                            entry.Day >= from &&
                            entry.Day < toExclusive &&
                            (coachUserId == null || entry.CoachUserId == coachUserId) &&
                            !dbContext.SessionLedgerEntries.Any(undo =>
                                undo.TenantId == entry.TenantId && undo.VoidsEntryId == entry.Id))
            .TagWith(SessionsHeldTag)
            .CountAsync(cancellationToken);

    /// <summary>
    /// In one read, the receipts whose instant falls in <c>[fromUtc, toUtc)</c>, the month and a day either side
    /// (<see cref="MoneyReceivedPolicy.ReadWindowUtc"/>), each with the coach history of the client it was for
    /// (ADR 0026). <see cref="MoneyReceivedPolicy"/> then decides each receipt's month, by its workspace day, and its
    /// coach. A coach's read is narrowed to clients they ever coached; the rule decides which receipts are theirs.
    /// Every client counts, a former one or one coached by someone else since included: the money arrived (ADR 0027
    /// keeps payments).
    /// </summary>
    private async Task<IReadOnlyList<ReceivedPayment>> ReadPaymentsAsync(
        Guid? coachUserId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from payment in dbContext.PaymentRecords.AsNoTracking()
            join enrollment in dbContext.ClientEnrollments.AsNoTracking()
                on new { payment.TenantId, Id = payment.EnrollmentId }
                equals new { enrollment.TenantId, enrollment.Id }
            where payment.Operation == PaymentOperation.Receipt &&
                  payment.ReceivedAtUtc >= fromUtc &&
                  payment.ReceivedAtUtc < toUtc &&
                  (coachUserId == null || dbContext.ClientCoachAssignments.Any(entry =>
                      entry.TenantId == enrollment.TenantId &&
                      entry.ClientProfileId == enrollment.ClientProfileId &&
                      entry.CoachUserId == coachUserId))
            select new
            {
                payment.Amount,
                payment.CurrencyCode,
                payment.ReceivedAtUtc,
                payment.Operation,
                History = dbContext.ClientCoachAssignments
                    .Where(entry =>
                        entry.TenantId == enrollment.TenantId &&
                        entry.ClientProfileId == enrollment.ClientProfileId)
                    .Select(entry => new CoachHistoryEntry(entry.Sequence, entry.CoachUserId, entry.AssignedAtUtc))
                    .ToList(),
            })
            .TagWith(MoneyReceivedTag)
            .ToListAsync(cancellationToken);
        return [.. rows.Select(row => new ReceivedPayment(
            row.Amount,
            row.CurrencyCode,
            row.ReceivedAtUtc,
            row.Operation,
            row.History))];
    }

    /// <summary>
    /// The owner's team on This month: every active owner and coach, the owner first, each with their current
    /// clients and how many have a plan running today, counted from the clients already in scope.
    /// </summary>
    private async Task<CoachClientCountView[]> ReadCoachesAsync(
        Scope scope,
        HashSet<Guid> active,
        CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var staff = await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
            where membership.TenantId == tenantId &&
                  membership.Status == MembershipStatus.Active &&
                  (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach)
            select new { membership.UserId, user.DisplayName, membership.Role })
            .TagWith(CoachesTag)
            .ToListAsync(cancellationToken);
        var clients = scope.Clients.ToLookup(client => client.CoachUserId);
        return [.. staff
            .OrderBy(member => member.Role == TenantRole.Owner ? 0 : 1)
            .ThenBy(member => member.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(member => member.UserId)
            .Select(member => new CoachClientCountView(
                member.UserId,
                member.DisplayName,
                member.UserId == scope.CallerUserId,
                clients[member.UserId].Count(client => active.Contains(client.Id)),
                clients[member.UserId].Count()))];
    }

    // ---------- signal reads: one query each, over every client in scope ----------

    /// <summary>
    /// In one read, the check-ins the attention rule weighs: every sent one waiting for its review, as the
    /// coach's review screen counts them, and every one due in the overdue window (CHK-015) with its response's
    /// status, or none. Only whether and when a response was sent is read, never an answer or what a draft
    /// holds (CHK-012, CHK-013); <see cref="CheckInAttentionPolicy.IsOverdue"/> decides which are overdue.
    /// </summary>
    private async Task<ILookup<Guid, CheckInRow>> ReadCheckInsAsync(
        Guid[] clientIds,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        if (clientIds.Length == 0)
        {
            return Empty<CheckInRow>();
        }

        var (firstDueDay, lastDueDay) = CheckInAttentionPolicy.OverdueDueDays(today);
        var waiting =
            from response in dbContext.CheckInResponses.AsNoTracking()
            join assignment in dbContext.CheckInAssignments.AsNoTracking()
                on new { response.TenantId, Id = response.AssignmentId }
                equals new { assignment.TenantId, assignment.Id }
            where clientIds.Contains(response.ClientProfileId) &&
                  response.Status == CheckInResponseStatus.Submitted &&
                  response.SubmittedAtUtc != null
            select new
            {
                assignment.ClientProfileId,
                AssignmentId = assignment.Id,
                assignment.DueDate,
                Status = (CheckInResponseStatus?)response.Status,
                response.SubmittedAtUtc,
            };
        var due =
            from assignment in dbContext.CheckInAssignments.AsNoTracking()
            where clientIds.Contains(assignment.ClientProfileId) &&
                  assignment.DueDate >= firstDueDay &&
                  assignment.DueDate <= lastDueDay
            from response in dbContext.CheckInResponses.AsNoTracking()
                .Where(response => response.TenantId == assignment.TenantId && response.AssignmentId == assignment.Id)
                .DefaultIfEmpty()
            select new
            {
                assignment.ClientProfileId,
                AssignmentId = assignment.Id,
                assignment.DueDate,
                Status = response == null ? null : (CheckInResponseStatus?)response.Status,
                SubmittedAtUtc = response == null ? null : response.SubmittedAtUtc,
            };

        // A sent check-in due in the window comes from both halves; it is the same row.
        return (await waiting.Concat(due).ToListAsync(cancellationToken))
            .DistinctBy(item => item.AssignmentId)
            .Select(item => new CheckInRow(
                item.ClientProfileId,
                item.AssignmentId,
                item.DueDate,
                item.Status,
                item.SubmittedAtUtc))
            .ToLookup(item => item.ClientProfileId);
    }

    /// <summary>
    /// The caller's own chats with these clients, each with its unread messages counted as the Messages badge
    /// counts messages: written by the client, past the caller's read cursor and not removed, in a thread the
    /// caller still coaches. A chat with nothing unread is here too, for Remind to open (critique B4a). A chat
    /// the caller marked unread (MSG-022) counts in the badge but holds no message to tell of, so it counts
    /// none here. Chats stay private (ADR 0026), so an Owner never sees another coach's conversation here,
    /// nor their own old thread with a client they handed to a coach (COACH-13).
    /// </summary>
    private async Task<ILookup<Guid, CallerChat>> ReadChatsAsync(
        Guid callerUserId,
        Guid[] clientIds,
        CancellationToken cancellationToken) =>
        clientIds.Length == 0
            ? Empty<CallerChat>()
            : (await (
                from participant in dbContext.ConversationParticipants.AsNoTracking()
                join conversation in dbContext.Conversations.AsNoTracking()
                    on new { participant.TenantId, Id = participant.ConversationId }
                    equals new { conversation.TenantId, conversation.Id }
                where participant.UserId == callerUserId &&
                      participant.Role == ConversationParticipantRole.Coach &&
                      conversation.CoachUserId == callerUserId &&
                      clientIds.Contains(conversation.ClientProfileId) &&
                      dbContext.ClientProfiles.Any(client =>
                          client.Id == conversation.ClientProfileId &&
                          client.AssignedCoachUserId == callerUserId)
                select new CallerChat(
                    conversation.ClientProfileId,
                    conversation.Id,
                    dbContext.Messages.LongCount(message =>
                        message.TenantId == participant.TenantId &&
                        message.ConversationId == participant.ConversationId &&
                        message.SenderUserId != callerUserId &&
                        message.DeletedAtUtc == null &&
                        message.Sequence > participant.LastReadSequence),
                    dbContext.Messages
                        .Where(message =>
                            message.TenantId == participant.TenantId &&
                            message.ConversationId == participant.ConversationId &&
                            message.SenderUserId != callerUserId &&
                            message.DeletedAtUtc == null &&
                            message.Sequence > participant.LastReadSequence)
                        .Min(message => (DateTimeOffset?)message.SentAtUtc)))
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId);

    /// <summary>Renewal requests of clients whose whole plan is still ended (ADR 0029), within the rule's window.</summary>
    private async Task<ILookup<Guid, RenewalAsk>> ReadRenewalRequestsAsync(
        Guid[] clientIds,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        if (clientIds.Length == 0)
        {
            return Empty<RenewalAsk>();
        }

        var floor = today.AddDays(-CoachAttentionPolicy.RenewalRequestDays);
        return (await dbContext.RenewalRequests.AsNoTracking()
                .Where(item => clientIds.Contains(item.ClientProfileId) && item.RequestedOn > floor)
                .Select(item => new RenewalAsk(item.ClientProfileId, item.RequestedOn, item.RequestedAtUtc))
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId);
    }

    /// <summary>
    /// Plans running now or still to come, each marked paid or not; the latest end of a paid one is the plan's
    /// last covered day (BEB-7). With <paramref name="endedFrom"/>, in the same query, also the plans that ran out
    /// with a last day on or after it, unless cancelled, marked <see cref="PlanEnd.Ended"/> (critique B4b). A pack
    /// carries what is left on it (critique B10c), summed here so a client's balance costs no query of its own.
    /// </summary>
    private async Task<ILookup<Guid, PlanEnd>> ReadPlanEndsAsync(
        Guid[] clientIds,
        DateOnly today,
        DateOnly? endedFrom,
        CancellationToken cancellationToken)
    {
        if (clientIds.Length == 0)
        {
            return Empty<PlanEnd>();
        }

        var plans = dbContext.ClientEnrollments.AsNoTracking().Where(item => clientIds.Contains(item.ClientProfileId));
        plans = endedFrom is { } from
            ? plans.Where(item =>
                (item.EndDateExclusive > today &&
                 (item.Status == EnrollmentStatus.Active ||
                  item.Status == EnrollmentStatus.PendingPayment ||
                  item.Status == EnrollmentStatus.Paused)) ||
                (item.EndDateExclusive <= today &&
                 item.EndDateExclusive > from &&
                 item.Status != EnrollmentStatus.Cancelled))
            : plans.Where(item =>
                item.EndDateExclusive > today &&
                (item.Status == EnrollmentStatus.Active ||
                 item.Status == EnrollmentStatus.PendingPayment ||
                 item.Status == EnrollmentStatus.Paused));
        return (await plans
                .Select(item => new PlanEnd(
                    item.ClientProfileId,
                    item.Id,
                    item.StartDate,
                    item.EndDateExclusive,
                    item.ProductNameSnapshot,
                    item.Status != EnrollmentStatus.PendingPayment,
                    item.Status == EnrollmentStatus.Paused ? item.PausedAtUtc : null,
                    item.EndDateExclusive <= today,
                    item.SessionCountSnapshot != null,
                    item.SessionCountSnapshot == null
                        ? 0
                        : dbContext.SessionLedgerEntries
                            .Where(entry => entry.TenantId == item.TenantId && entry.EnrollmentId == item.Id)
                            .Sum(SessionLedger.SignedCount)))
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId);
    }

    /// <summary>
    /// Blocks running or still to come, each with the weeks the unshared-week rule could flag (a row
    /// with no week when none falls near today). A client with no row has no program.
    /// </summary>
    private async Task<ILookup<Guid, OpenBlockWeek>> ReadOpenBlocksAsync(
        Guid[] clientIds,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        if (clientIds.Length == 0)
        {
            return Empty<OpenBlockWeek>();
        }

        // The rule flags a week with StartsOn + 7 > today and StartsOn <= today + lead.
        var earliestStart = today.AddDays(-6);
        var latestStart = today.AddDays(TrainingAttentionPolicy.UnsharedWeekLeadDays);
        var rows = await (
            from block in dbContext.TrainingMesocycles.AsNoTracking()
            where clientIds.Contains(block.ClientProfileId) &&
                  block.EndDateExclusive > today &&
                  block.Status != MesocycleStatus.Cancelled &&
                  block.Status != MesocycleStatus.Completed
            from week in dbContext.MesocycleWeeks.AsNoTracking()
                .Where(week => week.TenantId == block.TenantId &&
                               week.MesocycleId == block.Id &&
                               week.StartsOn >= earliestStart &&
                               week.StartsOn <= latestStart)
                .DefaultIfEmpty()
            select new
            {
                block.ClientProfileId,
                BlockId = block.Id,
                WeekNumber = (int?)week!.WeekNumber,
                StartsOn = (DateOnly?)week.StartsOn,
                IsPublished = (bool?)week.IsPublished,
            })
            .ToListAsync(cancellationToken);
        return rows.ToLookup(
            row => row.ClientProfileId,
            row => new OpenBlockWeek(row.BlockId, row.WeekNumber is { } number
                ? new AttentionWeek(row.BlockId, number, row.StartsOn!.Value, row.IsPublished!.Value)
                : null));
    }

    /// <summary>
    /// The sessions a client could see in the span: shared weeks of blocks that were not cancelled
    /// (TRN-006, TRN-020), plus any session with a workout, which a later change never withdraws
    /// (ADR 0013). A session in a week not shared yet is neither scheduled nor missed here.
    /// </summary>
    private async Task<ILookup<Guid, SessionRow>> ReadSessionsAsync(
        Guid[] clientIds,
        DateOnly fromDate,
        DateOnly toExclusive,
        CancellationToken cancellationToken) =>
        clientIds.Length == 0
            ? Empty<SessionRow>()
            : (await (
                from session in dbContext.TrainingSessions.AsNoTracking()
                join week in dbContext.MesocycleWeeks.AsNoTracking()
                    on new { session.TenantId, Id = session.MesocycleWeekId }
                    equals new { week.TenantId, week.Id }
                join block in dbContext.TrainingMesocycles.AsNoTracking()
                    on new { week.TenantId, Id = week.MesocycleId }
                    equals new { block.TenantId, block.Id }
                join execution in dbContext.WorkoutExecutions.AsNoTracking()
                    on new { session.TenantId, Id = session.Id }
                    equals new { execution.TenantId, Id = execution.TrainingSessionId }
                    into executions
                from execution in executions.DefaultIfEmpty()
                where clientIds.Contains(block.ClientProfileId) &&
                      session.ScheduledDate >= fromDate &&
                      session.ScheduledDate < toExclusive &&
                      (execution != null || (block.Status != MesocycleStatus.Cancelled && week.IsPublished))
                select new SessionRow(
                    block.ClientProfileId,
                    session.ScheduledDate,
                    execution == null ? null : (WorkoutExecutionStatus?)execution.Status))
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId);

    /// <summary>
    /// Each client's programs running or still to come, and their latest program (not cancelled) whatever its
    /// dates, with the lifts whose logged sets suggest a new max, as a program's Training maxes panel shows them
    /// (BestLoggedSet v1, STR-012, after any keep, STR-013). A program with no max still has a row, so a client
    /// between programs is known to have had one. A finished program's suggestions are for the next program
    /// (STR-014), so they go with No program rather than Maxes to review.
    /// </summary>
    private async Task<ILookup<Guid, ProgramMaxRow>> ReadMaxSuggestionsAsync(
        Guid[] clientIds,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        if (clientIds.Length == 0)
        {
            return Empty<ProgramMaxRow>();
        }

        // Two reads for every client at once: each program's maxes in use, with the lift's name and the coach's
        // last keep, then the logged sets that could speak for them. Two primary programs never share a start
        // date (they would overlap), so the latest is the one no other starts after.
        var maxes = await (
            from block in dbContext.TrainingMesocycles.AsNoTracking()
            where clientIds.Contains(block.ClientProfileId) &&
                  block.Status != MesocycleStatus.Cancelled &&
                  ((block.EndDateExclusive > today && block.Status != MesocycleStatus.Completed) ||
                   !dbContext.TrainingMesocycles.Any(later =>
                       later.TenantId == block.TenantId &&
                       later.ClientProfileId == block.ClientProfileId &&
                       later.Status != MesocycleStatus.Cancelled &&
                       later.StartDate > block.StartDate))
            from max in dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
                .Where(max => max.TenantId == block.TenantId &&
                              max.MesocycleId == block.Id &&
                              !dbContext.MesocycleWorkingMaxSnapshots.Any(next =>
                                  next.TenantId == max.TenantId && next.SupersedesSnapshotId == max.Id))
                .DefaultIfEmpty()
            join exercise in dbContext.Exercises.AsNoTracking()
                on new { max!.TenantId, Id = max.ExerciseId } equals new { exercise.TenantId, exercise.Id }
                into exercises
            from exercise in exercises.DefaultIfEmpty()
            select new
            {
                MesocycleId = block.Id,
                block.ClientProfileId,
                block.StartDate,
                IsOpen = block.EndDateExclusive > today && block.Status != MesocycleStatus.Completed,
                block.LoadUnit,
                block.LoadIncrement,
                block.TimeZoneId,
                Max = max,
                ExerciseName = exercise == null ? string.Empty : exercise.Name,
                LastKeptAtUtc = dbContext.WorkingMaxKeeps
                    .Where(keep => keep.TenantId == block.TenantId && keep.WorkingMaxSnapshotId == max!.Id)
                    .Max(keep => (DateTimeOffset?)keep.CreatedAtUtc),
            })
            .ToListAsync(cancellationToken);
        if (maxes.Count == 0)
        {
            return Empty<ProgramMaxRow>();
        }

        var withMaxes = maxes.Where(item => item.Max is not null).ToArray();
        var sets = await LoggedSetMaxSuggestions.LoadSetsAsync(
            dbContext,
            withMaxes
                .GroupBy(item => item.MesocycleId)
                .ToDictionary(group => group.Key, group => TimeZoneInfo.FindSystemTimeZoneById(group.First().TimeZoneId)),
            [.. withMaxes.Select(item => item.Max!.ExerciseId).Distinct()],
            [],
            cancellationToken);

        return maxes
            .Select(item =>
            {
                MaxSuggestionRow? row = null;
                if (item.Max is { } max &&
                    sets.TryGetValue((item.MesocycleId, max.ExerciseId), out var logged) &&
                    LoggedSetMaxSuggestions.Suggest(max, item.LastKeptAtUtc, logged, item.LoadUnit, item.LoadIncrement)
                        is { } suggestion)
                {
                    row = new MaxSuggestionRow(
                        item.MesocycleId,
                        max.ExerciseId,
                        item.ExerciseName,
                        max.Value,
                        suggestion.Estimate.Value,
                        item.LoadUnit,
                        item.LoadIncrement,
                        suggestion.Set.LoggedAtUtc);
                }

                return new ProgramMaxRow(item.ClientProfileId, item.MesocycleId, item.StartDate, item.IsOpen, row);
            })
            .ToLookup(row => row.ClientProfileId);
    }

    private async Task<Dictionary<Guid, DateTimeOffset>> ReadLastWorkoutStartsAsync(
        Guid[] clientIds,
        CancellationToken cancellationToken) =>
        clientIds.Length == 0
            ? []
            : await dbContext.WorkoutExecutions.AsNoTracking()
                .Where(item => clientIds.Contains(item.ClientProfileId))
                .GroupBy(item => item.ClientProfileId)
                .Select(group => new { ClientProfileId = group.Key, StartedAtUtc = group.Max(item => item.StartedAtUtc) })
                .ToDictionaryAsync(item => item.ClientProfileId, item => item.StartedAtUtc, cancellationToken);

    // ---------- activity ----------

    /// <summary>
    /// The newest finished workouts and sent check-ins since <paramref name="fromUtc"/>, each read only
    /// while the plan includes it. Weigh-ins stay out: most clients log one every morning, and on the
    /// demo workspace they filled 14 of 20 lines.
    /// </summary>
    private async Task<IReadOnlyList<CoachActivityItemView>> LoadActivityAsync(
        Scope scope,
        DateTimeOffset fromUtc,
        CancellationToken cancellationToken)
    {
        var limit = CoachAttentionPolicy.ActivityLimit;
        var training = scope.Allowed(CoachingFeature.Training);
        var checkIns = scope.Allowed(CoachingFeature.CheckIns);
        var items = new List<CoachActivityItemView>();

        if (training.Length > 0)
        {
            var workouts = await dbContext.WorkoutExecutions.AsNoTracking()
                .Where(item => training.Contains(item.ClientProfileId) &&
                               item.Status == WorkoutExecutionStatus.Completed &&
                               item.CompletedAtUtc >= fromUtc)
                .OrderByDescending(item => item.CompletedAtUtc).ThenByDescending(item => item.Id)
                .Take(limit)
                .Select(item => new FinishedWorkout(
                    item.Id,
                    item.ClientProfileId,
                    item.SessionNameSnapshot,
                    item.StartedAtUtc,
                    item.CompletedAtUtc!.Value))
                .ToListAsync(cancellationToken);
            var records = await ReadRecordsAsync(workouts, cancellationToken);
            items.AddRange(workouts.Select(workout => new CoachActivityItemView(
                CoachActivityKind.WorkoutCompleted,
                scope.Client(workout.ClientProfileId).Ref,
                workout.CompletedAtUtc,
                workout.Id,
                workout.SessionName,
                (int)Math.Max(0, Math.Floor((workout.CompletedAtUtc - workout.StartedAtUtc).TotalSeconds)),
                records[workout.Id].ToArray())));
        }

        if (checkIns.Length > 0)
        {
            var sent = await (
                from response in dbContext.CheckInResponses.AsNoTracking()
                join version in dbContext.CheckInFormVersions.AsNoTracking()
                    on new { response.TenantId, Id = response.FormVersionId }
                    equals new { version.TenantId, version.Id }
                join form in dbContext.CheckInForms.AsNoTracking()
                    on new { version.TenantId, Id = version.FormId }
                    equals new { form.TenantId, form.Id }
                where checkIns.Contains(response.ClientProfileId) &&
                      response.SubmittedAtUtc != null &&
                      response.SubmittedAtUtc >= fromUtc
                orderby response.SubmittedAtUtc descending, response.Id descending
                select new { response.ClientProfileId, response.AssignmentId, response.SubmittedAtUtc, form.Title })
                .Take(limit)
                .ToListAsync(cancellationToken);
            items.AddRange(sent.Select(item => new CoachActivityItemView(
                CoachActivityKind.CheckInSubmitted,
                scope.Client(item.ClientProfileId).Ref,
                item.SubmittedAtUtc!.Value,
                item.AssignmentId,
                item.Title,
                null,
                [])));
        }

        return items
            .OrderByDescending(item => item.OccurredAtUtc)
            .ThenByDescending(item => item.SubjectId)
            .Take(limit)
            .ToArray();
    }

    /// <summary>
    /// The records each workout set (TRN-019), against that client's workouts finished before it
    /// started: the same comparison the client's own history makes.
    /// </summary>
    /// <remarks>
    /// The history is read once, grouped by the database: each client's heaviest load at each lift, rep
    /// count and unit among the workouts finished before the earliest workout shown began. Only the sets of
    /// workouts finished since then, up to the latest start shown (the feed's own week), are read one by
    /// one, so each workout is compared with exactly the workouts finished before it began, itself left
    /// out. The rows read grow with the feed, never with a client's history (BEB-2), and there is no date
    /// floor: a record is the best ever lifted (ADR 0031).
    /// </remarks>
    private async Task<ILookup<Guid, CoachActivityRecordView>> ReadRecordsAsync(
        IReadOnlyList<FinishedWorkout> workouts,
        CancellationToken cancellationToken)
    {
        if (workouts.Count == 0)
        {
            return Empty<CoachActivityRecordView>();
        }

        var workoutIds = workouts.Select(item => item.Id).ToArray();
        var sets = await (
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join exercise in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { exercise.TenantId, exercise.Id }
            where workoutIds.Contains(exercise.WorkoutExecutionId) && set.IsCompleted
            orderby exercise.Position, set.Position
            select new
            {
                exercise.WorkoutExecutionId,
                exercise.ActualExerciseName,
                Set = new PerformedSet(set.Id, exercise.ActualExerciseId, set.ActualRepetitions,
                    set.ActualLoad, set.ActualLoadUnit, true),
            })
            .TagWith(RecordSetsTag)
            .ToListAsync(cancellationToken);
        if (sets.Count == 0)
        {
            return Empty<CoachActivityRecordView>();
        }

        var clientIds = workouts.Select(item => item.ClientProfileId).Distinct().ToArray();
        var exerciseIds = sets.Select(item => item.Set.ExerciseId).Distinct().ToArray();
        var earliestStart = workouts.Min(item => item.StartedAtUtc);
        var latestStart = workouts.Max(item => item.StartedAtUtc);
        var finished =
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join exercise in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { exercise.TenantId, exercise.Id }
            join workout in dbContext.WorkoutExecutions.AsNoTracking()
                on new { exercise.TenantId, Id = exercise.WorkoutExecutionId }
                equals new { workout.TenantId, workout.Id }
            where clientIds.Contains(workout.ClientProfileId) &&
                  workout.Status == WorkoutExecutionStatus.Completed &&
                  workout.CompletedAtUtc != null &&
                  exerciseIds.Contains(exercise.ActualExerciseId) &&
                  set.IsCompleted && set.ActualRepetitions != null &&
                  set.ActualLoad != null && set.ActualLoadUnit != null
            select new
            {
                WorkoutId = workout.Id,
                workout.ClientProfileId,
                CompletedAtUtc = workout.CompletedAtUtc!.Value,
                ExerciseId = exercise.ActualExerciseId,
                Repetitions = set.ActualRepetitions!.Value,
                Load = set.ActualLoad!.Value,
                Unit = set.ActualLoadUnit!.Value,
            };
        // The workouts shown are left out by id, and read with the sets since, so the comparison stays exact
        // even if a clock stepped back and stamped one as finished before it began.
        var before = await finished
            .Where(item => item.CompletedAtUtc < earliestStart && !workoutIds.Contains(item.WorkoutId))
            .GroupBy(item => new { item.ClientProfileId, item.ExerciseId, item.Repetitions, item.Unit })
            .Select(best => new
            {
                best.Key.ClientProfileId,
                best.Key.ExerciseId,
                best.Key.Repetitions,
                best.Key.Unit,
                Load = best.Max(item => item.Load),
            })
            .TagWith(EarlierBestTag)
            .ToListAsync(cancellationToken);
        var since = await finished
            .Where(item => (item.CompletedAtUtc >= earliestStart && item.CompletedAtUtc <= latestStart) ||
                           workoutIds.Contains(item.WorkoutId))
            .TagWith(RecentSetsTag)
            .ToListAsync(cancellationToken);

        var setsByWorkout = sets.ToLookup(item => item.WorkoutExecutionId);
        var beforeByClient = before.ToLookup(item => item.ClientProfileId);
        return workouts
            .SelectMany(workout =>
            {
                var earlierBest = beforeByClient[workout.ClientProfileId].ToDictionary(
                    item => new PersonalRecordKey(item.ExerciseId, item.Repetitions, item.Unit),
                    item => item.Load);
                foreach (var item in since.Where(item => item.ClientProfileId == workout.ClientProfileId &&
                                                         item.WorkoutId != workout.Id &&
                                                         item.CompletedAtUtc <= workout.StartedAtUtc))
                {
                    var key = new PersonalRecordKey(item.ExerciseId, item.Repetitions, item.Unit);
                    earlierBest[key] = earlierBest.TryGetValue(key, out var best)
                        ? Math.Max(best, item.Load)
                        : item.Load;
                }

                var own = setsByWorkout[workout.Id].ToArray();
                var recordIds = WorkoutPersonalRecordRule.RecordSetIds(own.Select(item => item.Set), earlierBest)
                    .ToHashSet();
                return own
                    .Where(item => recordIds.Contains(item.Set.SetId))
                    .Select(item => (workout.Id, Record: new CoachActivityRecordView(
                        item.ActualExerciseName,
                        item.Set.Repetitions!.Value,
                        item.Set.Load!.Value,
                        Unit(item.Set.Unit!.Value))));
            })
            .ToLookup(item => item.Id, item => item.Record);
    }

    /// <summary>
    /// One client's newest finished workout, with its duration and records, shaped as a line of Today's
    /// feed. The caller asks only for a client whose plan includes training.
    /// </summary>
    private async Task<CoachActivityItemView?> LoadLastWorkoutAsync(
        Scope scope,
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var workout = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId &&
                           item.Status == WorkoutExecutionStatus.Completed &&
                           item.CompletedAtUtc != null)
            .OrderByDescending(item => item.CompletedAtUtc).ThenByDescending(item => item.Id)
            .Select(item => new FinishedWorkout(
                item.Id,
                item.ClientProfileId,
                item.SessionNameSnapshot,
                item.StartedAtUtc,
                item.CompletedAtUtc!.Value))
            .FirstOrDefaultAsync(cancellationToken);
        if (workout is null)
        {
            return null;
        }

        var records = await ReadRecordsAsync([workout], cancellationToken);
        return new CoachActivityItemView(
            CoachActivityKind.WorkoutCompleted,
            scope.Client(workout.ClientProfileId).Ref,
            workout.CompletedAtUtc,
            workout.Id,
            workout.SessionName,
            (int)Math.Max(0, Math.Floor((workout.CompletedAtUtc - workout.StartedAtUtc).TotalSeconds)),
            records[workout.Id].ToArray());
    }

    /// <summary>
    /// What each plan includes, its length as it was sold and its price, exact, in its own currency (critique B4a),
    /// in one read: the enrollment's own snapshots and entitlements (SUB-003), and the length of its offer, whose
    /// terms never change (SUB-002). A label such as "Student rate" is not a length, so the offer's is read.
    /// </summary>
    private async Task<Dictionary<Guid, ClientPlanSummary>> ReadPlanSummariesAsync(
        Guid[] enrollmentIds,
        CancellationToken cancellationToken)
    {
        if (enrollmentIds.Length == 0)
        {
            return [];
        }

        var plans = await (
            from enrollment in dbContext.ClientEnrollments.AsNoTracking()
            join offer in dbContext.ProductOffers.AsNoTracking()
                on new { enrollment.TenantId, Id = enrollment.OfferId }
                equals new { offer.TenantId, offer.Id }
            where enrollmentIds.Contains(enrollment.Id)
            select new
            {
                enrollment.Id,
                enrollment.ProductNameSnapshot,
                Features = enrollment.Entitlements.Select(item => item.Feature).ToList(),
                offer.DurationCount,
                offer.DurationUnit,
                enrollment.PriceAmount,
                enrollment.PriceCurrency,
            })
            .ToListAsync(cancellationToken);
        return plans.ToDictionary(
            plan => plan.Id,
            plan => new ClientPlanSummary(
                plan.Id,
                plan.ProductNameSnapshot,
                [.. plan.Features.Distinct().Order()],
                plan.DurationCount,
                Length(plan.DurationUnit),
                plan.PriceAmount,
                plan.PriceCurrency));
    }

    /// <summary>The name a plan was sold under, kept on the enrollment when it was booked.</summary>
    private async Task<string?> ReadPlanNameAsync(Guid? enrollmentId, CancellationToken cancellationToken) =>
        enrollmentId is not { } id
            ? null
            : await dbContext.ClientEnrollments.AsNoTracking()
                .Where(item => item.Id == id)
                .Select(item => item.ProductNameSnapshot)
                .SingleOrDefaultAsync(cancellationToken);

    /// <summary>
    /// When each client last did something the coach may see: finished a workout, named by its session, or sent a
    /// check-in (while the plan includes it), or logged a weigh-in (while the relationship is not blocked); and,
    /// apart, when each last sent a check-in.
    /// </summary>
    private async Task<(Dictionary<Guid, LastActivity> Last, Dictionary<Guid, DateTimeOffset> LastCheckIns)>
        LoadLastActivityAsync(Scope scope, CancellationToken cancellationToken)
    {
        var training = scope.Allowed(CoachingFeature.Training);
        var checkIns = scope.Allowed(CoachingFeature.CheckIns);
        var unblocked = scope.Unblocked;
        var candidates = new List<(Guid ClientProfileId, LastActivity Activity)>();
        if (training.Length > 0)
        {
            candidates.AddRange((await dbContext.WorkoutExecutions.AsNoTracking()
                    .Where(item => training.Contains(item.ClientProfileId) &&
                                   item.Status == WorkoutExecutionStatus.Completed &&
                                   item.CompletedAtUtc != null)
                    .GroupBy(item => item.ClientProfileId)
                    .Select(group => group
                        .OrderByDescending(item => item.CompletedAtUtc)
                        .ThenByDescending(item => item.Id)
                        .Select(item => new { item.ClientProfileId, item.CompletedAtUtc, item.SessionNameSnapshot })
                        .First())
                    .ToListAsync(cancellationToken))
                .Select(item => (item.ClientProfileId, new LastActivity(
                    CoachActivityKind.WorkoutCompleted,
                    item.CompletedAtUtc!.Value,
                    item.SessionNameSnapshot))));
        }

        var lastCheckIns = new Dictionary<Guid, DateTimeOffset>();
        if (checkIns.Length > 0)
        {
            lastCheckIns = (await dbContext.CheckInResponses.AsNoTracking()
                    .Where(item => checkIns.Contains(item.ClientProfileId) && item.SubmittedAtUtc != null)
                    .GroupBy(item => item.ClientProfileId)
                    .Select(group => new { group.Key, At = group.Max(item => item.SubmittedAtUtc) })
                    .ToListAsync(cancellationToken))
                .Where(item => item.At is not null)
                .ToDictionary(item => item.Key, item => item.At!.Value);
            candidates.AddRange(lastCheckIns.Select(item =>
                (item.Key, new LastActivity(CoachActivityKind.CheckInSubmitted, item.Value))));
        }

        if (unblocked.Length > 0)
        {
            candidates.AddRange((await dbContext.BodyweightObservations.AsNoTracking()
                    .Where(item => unblocked.Contains(item.ClientProfileId) &&
                                   item.IsActive &&
                                   item.Source != BodyweightSource.Coach)
                    .GroupBy(item => item.ClientProfileId)
                    .Select(group => new { group.Key, At = group.Max(item => item.CreatedAtUtc) })
                    .ToListAsync(cancellationToken))
                .Select(item => (item.Key, new LastActivity(CoachActivityKind.WeighInLogged, item.At))));
        }

        var last = candidates
            .GroupBy(item => item.ClientProfileId)
            .ToDictionary(group => group.Key, group => group.MaxBy(item => item.Activity.AtUtc).Activity);
        return (last, lastCheckIns);
    }

    // ---------- helpers ----------

    private static DateOnly StartOfWeek(DateOnly date, DayOfWeek weekStartsOn) =>
        date.AddDays(-(((int)date.DayOfWeek - (int)weekStartsOn + 7) % 7));

    private static DateOnly Earliest(DateOnly left, DateOnly right) => left < right ? left : right;

    private static DateOnly Latest(DateOnly left, DateOnly right) => left > right ? left : right;

    private static ILookup<Guid, T> Empty<T>() => Array.Empty<(Guid Key, T Value)>().ToLookup(item => item.Key, item => item.Value);

    private static CoachActivityLoadUnit Unit(TrainingLoadUnit unit) => unit switch
    {
        TrainingLoadUnit.Kilogram => CoachActivityLoadUnit.Kilogram,
        TrainingLoadUnit.Pound => CoachActivityLoadUnit.Pound,
        _ => throw new InvalidOperationException($"Unknown load unit {unit}."),
    };

    private static ClientPlanLengthUnit Length(OfferDurationUnit unit) => unit switch
    {
        OfferDurationUnit.Day => ClientPlanLengthUnit.Day,
        OfferDurationUnit.Week => ClientPlanLengthUnit.Week,
        _ => throw new InvalidOperationException($"Unknown offer duration unit {unit}."),
    };

    /// <param name="IsOwner">The caller is the workspace's active Owner, who reads the workspace's money and team.</param>
    private sealed record Scope(
        WorkspaceCalendar Calendar,
        TimeZoneInfo TimeZone,
        Guid CallerUserId,
        bool IsOwner,
        IReadOnlyList<ScopedClient> Clients,
        IReadOnlyDictionary<Guid, IReadOnlyList<FeatureAccessDecision>> Access)
    {
        private readonly Dictionary<Guid, ScopedClient> byId = Clients.ToDictionary(client => client.Id);

        public Guid[] Ids => [.. Clients.Select(client => client.Id)];

        /// <summary>Clients whose plan includes the feature today.</summary>
        public Guid[] Allowed(CoachingFeature feature) =>
            [.. Clients
                .Where(client => Access[client.Id].Any(decision => decision.Feature == feature && decision.IsAllowed))
                .Select(client => client.Id)];

        /// <summary>Clients whose progress the coach may read: any relationship that is not blocked.</summary>
        public Guid[] Unblocked => [.. Clients.Where(client => !client.IsCoachBlocked).Select(client => client.Id)];

        /// <summary>The features the client's plan grants today, in the features' own order.</summary>
        public CoachingFeature[] FeaturesToday(Guid clientId) =>
            [.. Access[clientId].Where(decision => decision.IsAllowed).Select(decision => decision.Feature).Distinct().Order()];

        public ScopedClient Client(Guid id) => byId[id];

        public DateOnly LocalDate(DateTimeOffset instant) =>
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, TimeZone).DateTime);
    }

    private sealed record ScopedClient(
        Guid Id,
        string FirstName,
        string LastName,
        string? Goals,
        Guid CoachUserId,
        string? CoachName,
        DateTimeOffset CreatedAtUtc,
        bool IsCoachBlocked,
        ClientOnboardingStatus OnboardingStatus,
        DateOnly? BirthDate,
        uint Version)
    {
        public CoachClientRef Ref => new(
            Id,
            FirstName,
            LastName,
            CoachUserId,
            string.IsNullOrWhiteSpace(CoachName) ? null : CoachName);
    }

    private sealed record ClientState(
        ScopedClient Client,
        DateOnly JoinedOn,
        ClientPlanState PlanState,
        DateOnly? PlanEndsOn,
        Guid? RunningEnrollmentId,
        string? RunningPlanName,
        int UnpaidRenewals,
        Guid? FirstUnpaidRenewalId,
        EndedPlan? EndedPlan,
        IReadOnlyList<CoachAttentionKind> Flags,
        ClientAttentionSignals Signals,
        WaitingCheckIn? OldestCheckIn,
        WaitingCheckIn? NewestCheckIn,
        UnreadConversation? OldestUnread,
        RenewalAsk? Renewal,
        AttentionWeek? WeekToShare,
        DateOnly? LastWorkoutOn,
        bool TrainingIncluded,
        IReadOnlyList<SessionRow> Sessions,
        IReadOnlyList<MaxSuggestionRow> MaxSuggestions,
        Guid? LastProgramId,
        IReadOnlyList<MaxSuggestionRow> CarriedSuggestions,
        CheckInRow? OldestOverdue,
        bool CanMessage,
        Guid? ChatId,
        DateOnly? PlanPausedSince,
        int OtherPlanCount,
        EndedNotRenewed? NotRenewed,
        bool PlanIsSessionPack,
        int UnpaidPacks,
        Guid? PackToActOn)
    {
        /// <summary>The plan the client's page names (R3.5b), whose last day is <see cref="PlanEndsOn"/>.</summary>
        public Guid? PlanEnrollmentId => RunningEnrollmentId ?? EndedPlan?.EnrollmentId;

        /// <summary>
        /// A pack standing as the client's plan is ending (ADR 0038), so it says so once: on the plan's own item, which
        /// the client's page and the chat's panel read, with the sessions left.
        /// </summary>
        public bool PackEndsAsPlan => PlanIsSessionPack &&
            Flags.Contains(CoachAttentionKind.PlanEndingSoon) &&
            Flags.Contains(CoachAttentionKind.SessionsRunningOut);
    }

    /// <summary>A lapsed client's plan that ran out lately, and any plan after it waiting for payment (critique B4b).</summary>
    private sealed record EndedNotRenewed(Guid EnrollmentId, string PlanName, DateOnly LastDay, Guid? UnpaidPlanId);

    private sealed record WaitingCheckIn(Guid ClientProfileId, Guid AssignmentId, DateTimeOffset SubmittedAtUtc);

    /// <summary>A check-in as the attention rule reads it: its due day and its response's status, if any.</summary>
    private sealed record CheckInRow(
        Guid ClientProfileId,
        Guid AssignmentId,
        DateOnly DueDate,
        CheckInResponseStatus? Status,
        DateTimeOffset? SubmittedAtUtc);

    private sealed record UnreadConversation(
        Guid ClientProfileId,
        Guid ConversationId,
        long Count,
        DateTimeOffset OldestUnreadAtUtc);

    /// <summary>The caller's own chat with a client, with what is unread in it.</summary>
    private sealed record CallerChat(
        Guid ClientProfileId,
        Guid ConversationId,
        long UnreadCount,
        DateTimeOffset? OldestUnreadAtUtc);

    private sealed record RenewalAsk(Guid ClientProfileId, DateOnly RequestedOn, DateTimeOffset RequestedAtUtc);

    /// <param name="Ended">The plan ran out (read for Today's Ended, not renewed alone); otherwise it runs or is to come.</param>
    private sealed record PlanEnd(
        Guid ClientProfileId,
        Guid EnrollmentId,
        DateOnly StartDate,
        DateOnly EndDateExclusive,
        string PlanName,
        bool Paid,
        DateTimeOffset? PausedAtUtc,
        bool Ended,
        bool IsSessionPack,
        int SessionsLeft);

    private sealed record OpenBlockWeek(Guid BlockId, AttentionWeek? Week);

    private sealed record SessionRow(Guid ClientProfileId, DateOnly ScheduledDate, WorkoutExecutionStatus? Workout);

    /// <summary>One program of a client and, for one of its lifts, the suggestion its logged sets make (or none).</summary>
    private sealed record ProgramMaxRow(
        Guid ClientProfileId,
        Guid MesocycleId,
        DateOnly StartDate,
        bool IsOpen,
        MaxSuggestionRow? Suggestion);

    private sealed record MaxSuggestionRow(
        Guid MesocycleId,
        Guid ExerciseId,
        string ExerciseName,
        decimal Current,
        decimal Suggested,
        TrainingLoadUnit Unit,
        decimal LoadIncrement,
        DateTimeOffset LoggedAtUtc);

    private sealed record FinishedWorkout(
        Guid Id,
        Guid ClientProfileId,
        string SessionName,
        DateTimeOffset StartedAtUtc,
        DateTimeOffset CompletedAtUtc);

    private sealed record LastActivity(CoachActivityKind Kind, DateTimeOffset AtUtc, string? Title = null);
}
