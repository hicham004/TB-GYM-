using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Subscriptions;
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
    public async Task<CoachTodayView> GetTodayAsync(CancellationToken cancellationToken)
    {
        var scope = await LoadScopeAsync(cancellationToken);
        var today = scope.Calendar.Today;
        var weekFrom = StartOfWeek(today, scope.Calendar.WeekStartsOn);
        var states = await LoadStatesAsync(
            scope,
            Earliest(today.AddDays(-TrainingAttentionPolicy.MissedLookbackDays), weekFrom),
            Latest(today.AddDays(1), weekFrom.AddDays(7)),
            cancellationToken);
        var activityFromUtc = clock.UtcNow.AddDays(-CoachAttentionPolicy.ActivityDays);
        var activity = await LoadActivityAsync(scope, activityFromUtc, cancellationToken);

        var weekDays = Days(states.SelectMany(state => state.Sessions), weekFrom, 7);
        return new CoachTodayView(
            today,
            scope.Calendar.TimeZoneId,
            scope.Clients.Count,
            states.Count(state => state.Flags.Contains(CoachAttentionKind.PlanEndingSoon)),
            states.Count(state => state.Flags.Contains(CoachAttentionKind.RenewalRequested)),
            new CoachWeekView(
                weekFrom,
                weekFrom.AddDays(7),
                weekDays.Sum(day => day.Scheduled),
                weekDays.Sum(day => day.Completed),
                weekDays),
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
        var scope = await LoadScopeAsync(cancellationToken);
        var today = scope.Calendar.Today;
        var recentFrom = today.AddDays(1 - CoachAttentionPolicy.RecentDays);
        var states = await LoadStatesAsync(
            scope,
            Earliest(today.AddDays(-TrainingAttentionPolicy.MissedLookbackDays), recentFrom),
            today.AddDays(1),
            cancellationToken);
        var lastActivity = await LoadLastActivityAsync(scope, cancellationToken);

        var rows = states.Select(state =>
        {
            lastActivity.TryGetValue(state.Client.Id, out var last);
            return new ClientOverviewRow(
                state.Client.Ref,
                state.Client.Goals,
                state.JoinedOn,
                CoachAttentionPolicy.IsNew(state.JoinedOn, today),
                CoachAttentionPolicy.Status(state.Flags, state.PlanState),
                state.PlanState,
                state.PlanEndsOn,
                state.Flags,
                last?.Kind,
                last?.AtUtc,
                state.TrainingIncluded ? Days(state.Sessions, recentFrom, CoachAttentionPolicy.RecentDays) : null);
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

    // ---------- scope and per-client state ----------

    /// <summary>
    /// The caller's clients (ADR 0026: a Coach's own, every one for the Owner; never a former client),
    /// the workspace calendar, and every client's access decisions from one batched evaluation.
    /// </summary>
    private async Task<Scope> LoadScopeAsync(CancellationToken cancellationToken)
    {
        var calendar = await WorkspaceCalendarReader.ReadAsync(
            dbContext,
            clock,
            tenantContext.TenantId,
            cancellationToken);
        var query = dbContext.ClientProfiles.AsNoTracking().Where(client => client.ReleasedAtUtc == null);
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
                client.IsCoachBlocked))
            .ToListAsync(cancellationToken);
        var access = await featureAccessService.EvaluateManyAsync(
            tenantContext.TenantId,
            [.. clients.Select(client => client.Id)],
            cancellationToken);
        return new Scope(
            calendar,
            TimeZoneInfo.FindSystemTimeZoneById(calendar.TimeZoneId),
            currentUser.UserId ?? Guid.Empty,
            clients,
            access);
    }

    /// <summary>
    /// Everything the attention rule and the status read about each client, with the sessions of
    /// <c>[sessionsFrom, sessionsTo)</c> for clients whose plan includes training.
    /// </summary>
    private async Task<IReadOnlyList<ClientState>> LoadStatesAsync(
        Scope scope,
        DateOnly sessionsFrom,
        DateOnly sessionsTo,
        CancellationToken cancellationToken)
    {
        var today = scope.Calendar.Today;
        var training = scope.Allowed(CoachingFeature.Training);
        var checkIns = scope.Allowed(CoachingFeature.CheckIns);
        var messaging = scope.Allowed(CoachingFeature.Messaging);
        var endedPlans = scope.Clients
            .Select(client => (client.Id, Plan: RenewalEligibility.EndedPlan(scope.Access[client.Id])))
            .Where(item => item.Plan is not null)
            .ToDictionary(item => item.Id, item => item.Plan!);

        var waiting = await ReadWaitingCheckInsAsync(checkIns, cancellationToken);
        var unread = await ReadUnreadAsync(scope.CallerUserId, messaging, cancellationToken);
        var renewals = await ReadRenewalRequestsAsync([.. endedPlans.Keys], today, cancellationToken);
        var plans = await ReadPlanEndsAsync(scope.Ids, today, cancellationToken);
        var blocks = await ReadOpenBlocksAsync(training, today, cancellationToken);
        var sessions = await ReadSessionsAsync(training, sessionsFrom, sessionsTo, cancellationToken);
        var lastStarts = await ReadLastWorkoutStartsAsync(training, cancellationToken);

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
            var checkIn = waiting[client.Id].OrderBy(item => item.SubmittedAtUtc).ToArray();
            var conversations = unread[client.Id].OrderBy(item => item.OldestUnreadAtUtc).ToArray();
            endedPlans.TryGetValue(client.Id, out var endedPlan);
            var renewal = endedPlan is null
                ? null
                : renewals[client.Id]
                    .Where(item => item.RequestedOn > endedPlan.LastDay)
                    .MaxBy(item => item.RequestedAtUtc);
            var runningPlan = plans[client.Id].MaxBy(item => item.EndDateExclusive);
            var signals = new ClientAttentionSignals(
                checkIn.Length,
                conversations.Sum(item => item.Count),
                renewal?.RequestedOn,
                runningPlan?.EndDateExclusive.AddDays(-1),
                weekToShare is not null,
                missed,
                trainingIncluded && clientBlocks.Length == 0);
            return new ClientState(
                client,
                scope.LocalDate(client.CreatedAtUtc),
                planState,
                runningPlan?.EndDateExclusive.AddDays(-1) ?? endedPlan?.LastDay,
                runningPlan?.EnrollmentId,
                endedPlan,
                CoachAttentionPolicy.Flags(signals, planState, today),
                signals,
                checkIn.FirstOrDefault(),
                conversations.FirstOrDefault(),
                renewal,
                weekToShare,
                lastWorkoutOn,
                trainingIncluded,
                clientSessions);
        }).ToArray();
    }

    /// <summary>One queue item for each kind the client raised, with what its one-tap action needs.</summary>
    private static IEnumerable<CoachAttentionItemView> Items(ClientState state) =>
        state.Flags.Select(kind => kind switch
        {
            CoachAttentionKind.CheckInToReview => Item(kind, state, since: state.OldestCheckIn?.SubmittedAtUtc,
                count: state.Signals.CheckInsToReview, subjectId: state.OldestCheckIn?.AssignmentId),
            CoachAttentionKind.UnreadMessages => Item(kind, state, since: state.OldestUnread?.OldestUnreadAtUtc,
                count: (int)Math.Min(int.MaxValue, state.Signals.UnreadMessages),
                subjectId: state.OldestUnread?.ConversationId),
            CoachAttentionKind.RenewalRequested => Item(kind, state, since: state.Renewal?.RequestedAtUtc,
                date: state.EndedPlan?.LastDay, subjectId: state.EndedPlan?.EnrollmentId),
            CoachAttentionKind.PlanEndingSoon => Item(kind, state, date: state.PlanEndsOn,
                subjectId: state.RunningEnrollmentId),
            CoachAttentionKind.WeekNotShared => Item(kind, state, date: state.WeekToShare?.StartsOn,
                weekNumber: state.WeekToShare?.WeekNumber, subjectId: state.WeekToShare?.MesocycleId),
            CoachAttentionKind.MissedSessions => Item(kind, state, date: state.LastWorkoutOn,
                count: state.Signals.MissedSinceLastWorkout),
            CoachAttentionKind.NoProgram => Item(kind, state, date: state.JoinedOn),
            _ => throw new InvalidOperationException($"Unknown attention kind {kind}."),
        });

    private static CoachAttentionItemView Item(
        CoachAttentionKind kind,
        ClientState state,
        DateTimeOffset? since = null,
        DateOnly? date = null,
        int? count = null,
        int? weekNumber = null,
        Guid? subjectId = null) =>
        new(kind, state.Client.Ref, since, date, count, weekNumber, subjectId);

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

    // ---------- signal reads: one query each, over every client in scope ----------

    /// <summary>Submitted check-ins not yet reviewed, as the coach's review screen counts them.</summary>
    private async Task<ILookup<Guid, WaitingCheckIn>> ReadWaitingCheckInsAsync(
        Guid[] clientIds,
        CancellationToken cancellationToken) =>
        clientIds.Length == 0
            ? Empty<WaitingCheckIn>()
            : (await dbContext.CheckInResponses.AsNoTracking()
                .Where(item => clientIds.Contains(item.ClientProfileId) &&
                               item.Status == CheckInResponseStatus.Submitted &&
                               item.SubmittedAtUtc != null)
                .Select(item => new WaitingCheckIn(item.ClientProfileId, item.AssignmentId, item.SubmittedAtUtc!.Value))
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId);

    /// <summary>
    /// The caller's own unread messages, counted exactly as their Messages badge counts them: written by
    /// the client, past the caller's read cursor and not removed. Chats stay private (ADR 0026), so an
    /// Owner never sees another coach's conversation counted here.
    /// </summary>
    private async Task<ILookup<Guid, UnreadConversation>> ReadUnreadAsync(
        Guid callerUserId,
        Guid[] clientIds,
        CancellationToken cancellationToken) =>
        clientIds.Length == 0
            ? Empty<UnreadConversation>()
            : (await (
                from participant in dbContext.ConversationParticipants.AsNoTracking()
                join conversation in dbContext.Conversations.AsNoTracking()
                    on new { participant.TenantId, Id = participant.ConversationId }
                    equals new { conversation.TenantId, conversation.Id }
                join message in dbContext.Messages.AsNoTracking()
                    on new { participant.TenantId, participant.ConversationId }
                    equals new { message.TenantId, message.ConversationId }
                where participant.UserId == callerUserId &&
                      participant.Role == ConversationParticipantRole.Coach &&
                      conversation.CoachUserId == callerUserId &&
                      clientIds.Contains(conversation.ClientProfileId) &&
                      message.SenderUserId != callerUserId &&
                      message.DeletedAtUtc == null &&
                      message.Sequence > participant.LastReadSequence
                group message by new { conversation.Id, conversation.ClientProfileId } into grouped
                select new UnreadConversation(
                    grouped.Key.ClientProfileId,
                    grouped.Key.Id,
                    grouped.LongCount(),
                    grouped.Min(message => message.SentAtUtc)))
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

    /// <summary>Plans running now or still to come; the latest end is the plan's last covered day.</summary>
    private async Task<ILookup<Guid, PlanEnd>> ReadPlanEndsAsync(
        Guid[] clientIds,
        DateOnly today,
        CancellationToken cancellationToken) =>
        clientIds.Length == 0
            ? Empty<PlanEnd>()
            : (await dbContext.ClientEnrollments.AsNoTracking()
                .Where(item => clientIds.Contains(item.ClientProfileId) &&
                               item.EndDateExclusive > today &&
                               (item.Status == EnrollmentStatus.Active ||
                                item.Status == EnrollmentStatus.PendingPayment ||
                                item.Status == EnrollmentStatus.Paused))
                .Select(item => new PlanEnd(item.ClientProfileId, item.Id, item.EndDateExclusive))
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId);

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
            .ToListAsync(cancellationToken);
        var clientIds = workouts.Select(item => item.ClientProfileId).Distinct().ToArray();
        var exerciseIds = sets.Select(item => item.Set.ExerciseId).Distinct().ToArray();
        var latestStart = workouts.Max(item => item.StartedAtUtc);
        var earlier = await (
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join exercise in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { exercise.TenantId, exercise.Id }
            join workout in dbContext.WorkoutExecutions.AsNoTracking()
                on new { exercise.TenantId, Id = exercise.WorkoutExecutionId }
                equals new { workout.TenantId, workout.Id }
            where clientIds.Contains(workout.ClientProfileId) &&
                  workout.Status == WorkoutExecutionStatus.Completed &&
                  workout.CompletedAtUtc <= latestStart &&
                  exerciseIds.Contains(exercise.ActualExerciseId) &&
                  set.IsCompleted && set.ActualRepetitions != null &&
                  set.ActualLoad != null && set.ActualLoadUnit != null
            select new
            {
                WorkoutId = workout.Id,
                workout.ClientProfileId,
                CompletedAtUtc = workout.CompletedAtUtc!.Value,
                Set = new PerformedSet(set.Id, exercise.ActualExerciseId, set.ActualRepetitions,
                    set.ActualLoad, set.ActualLoadUnit, true),
            })
            .ToListAsync(cancellationToken);

        var setsByWorkout = sets.ToLookup(item => item.WorkoutExecutionId);
        return workouts
            .SelectMany(workout =>
            {
                var own = setsByWorkout[workout.Id].ToArray();
                var recordIds = WorkoutPersonalRecordRule.RecordSetIds(
                    own.Select(item => item.Set),
                    earlier
                        .Where(item => item.ClientProfileId == workout.ClientProfileId &&
                                       item.WorkoutId != workout.Id &&
                                       item.CompletedAtUtc <= workout.StartedAtUtc)
                        .Select(item => item.Set))
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
    /// When each client last did something the coach may see: finished a workout or sent a check-in
    /// (while the plan includes it), or logged a weigh-in (while the relationship is not blocked).
    /// </summary>
    private async Task<Dictionary<Guid, LastActivity>> LoadLastActivityAsync(
        Scope scope,
        CancellationToken cancellationToken)
    {
        var training = scope.Allowed(CoachingFeature.Training);
        var checkIns = scope.Allowed(CoachingFeature.CheckIns);
        var unblocked = scope.Unblocked;
        var candidates = new List<(Guid ClientProfileId, LastActivity Activity)>();
        if (training.Length > 0)
        {
            candidates.AddRange((await dbContext.WorkoutExecutions.AsNoTracking()
                    .Where(item => training.Contains(item.ClientProfileId) &&
                                   item.Status == WorkoutExecutionStatus.Completed)
                    .GroupBy(item => item.ClientProfileId)
                    .Select(group => new { group.Key, At = group.Max(item => item.CompletedAtUtc) })
                    .ToListAsync(cancellationToken))
                .Where(item => item.At is not null)
                .Select(item => (item.Key, new LastActivity(CoachActivityKind.WorkoutCompleted, item.At!.Value))));
        }

        if (checkIns.Length > 0)
        {
            candidates.AddRange((await dbContext.CheckInResponses.AsNoTracking()
                    .Where(item => checkIns.Contains(item.ClientProfileId) && item.SubmittedAtUtc != null)
                    .GroupBy(item => item.ClientProfileId)
                    .Select(group => new { group.Key, At = group.Max(item => item.SubmittedAtUtc) })
                    .ToListAsync(cancellationToken))
                .Where(item => item.At is not null)
                .Select(item => (item.Key, new LastActivity(CoachActivityKind.CheckInSubmitted, item.At!.Value))));
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

        return candidates
            .GroupBy(item => item.ClientProfileId)
            .ToDictionary(group => group.Key, group => group.MaxBy(item => item.Activity.AtUtc).Activity);
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

    private sealed record Scope(
        WorkspaceCalendar Calendar,
        TimeZoneInfo TimeZone,
        Guid CallerUserId,
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
        bool IsCoachBlocked)
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
        EndedPlan? EndedPlan,
        IReadOnlyList<CoachAttentionKind> Flags,
        ClientAttentionSignals Signals,
        WaitingCheckIn? OldestCheckIn,
        UnreadConversation? OldestUnread,
        RenewalAsk? Renewal,
        AttentionWeek? WeekToShare,
        DateOnly? LastWorkoutOn,
        bool TrainingIncluded,
        IReadOnlyList<SessionRow> Sessions);

    private sealed record WaitingCheckIn(Guid ClientProfileId, Guid AssignmentId, DateTimeOffset SubmittedAtUtc);

    private sealed record UnreadConversation(
        Guid ClientProfileId,
        Guid ConversationId,
        long Count,
        DateTimeOffset OldestUnreadAtUtc);

    private sealed record RenewalAsk(Guid ClientProfileId, DateOnly RequestedOn, DateTimeOffset RequestedAtUtc);

    private sealed record PlanEnd(Guid ClientProfileId, Guid EnrollmentId, DateOnly EndDateExclusive);

    private sealed record OpenBlockWeek(Guid BlockId, AttentionWeek? Week);

    private sealed record SessionRow(Guid ClientProfileId, DateOnly ScheduledDate, WorkoutExecutionStatus? Workout);

    private sealed record FinishedWorkout(
        Guid Id,
        Guid ClientProfileId,
        string SessionName,
        DateTimeOffset StartedAtUtc,
        DateTimeOffset CompletedAtUtc);

    private sealed record LastActivity(CoachActivityKind Kind, DateTimeOffset AtUtc);
}
