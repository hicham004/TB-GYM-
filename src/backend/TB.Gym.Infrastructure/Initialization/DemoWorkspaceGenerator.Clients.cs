using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;
using static TB.Gym.Infrastructure.Initialization.DemoStepFailedException;
using static TB.Gym.Infrastructure.Initialization.DemoWorkspaceCast;

namespace TB.Gym.Infrastructure.Initialization;

internal sealed partial class DemoWorkspaceGenerator
{
    private void PlanClient(DemoClientState state, int index)
    {
        var client = state.Client;
        var random = new Random(7919 * (index + 1));
        var name = client.FirstName;
        var invited = client.InvitedDay;

        timeline.At(calendar.At(invited, 11, index), $"{name}: invitation", () => InviteClientAsync(state, index));
        timeline.At(calendar.At(invited, 19, 30 + index), $"{name}: joins", () => JoinAsync(state, index));
        timeline.At(calendar.At(invited, 20, 45), $"{name}: coach notes", () => WriteCoachNotesAsync(state));

        // Chat opens with the plan: messaging is part of it, so the welcome goes out on its first morning.
        var seed = random.Next();
        timeline.At(calendar.At(client.Plans[0].StartDay, 6, index), $"{name}: welcome message",
            () => OpenConversationAsync(state, seed));
        PlanEnrollments(state, random);
        PlanBlocks(state);
        PlanWorkouts(state, random);
        PlanWeighIns(state, random);
        PlanMeasurements(state, random);
        PlanCheckIns(state, random);
        PlanMessages(state, random);
        if (client.Key is "maya" or "sara") PlanNutrition(state);

        if (client.PausedDay is { } pausedDay)
        {
            timeline.At(calendar.At(pausedDay, 12, 0), $"{name}: plan paused", () => PauseAsync(state));
        }

        if (client.AsksToRenewDay is { } renewalDay)
        {
            timeline.At(calendar.At(renewalDay, 10, 15), $"{name}: asks to renew", () => AskToRenewAsync(state));
        }
    }

    private async Task InviteClientAsync(DemoClientState state, int index)
    {
        var client = state.Client;
        var birthDate = calendar.Today.AddYears(-client.Age).AddDays(-(37 * (index + 3) % 300));
        var result = await As<IInvitationApplicationService, InvitationCommandResult>(
            CoachOf(state),
            (service, token) => service.CreateAsync(
                new CreateClientInvitationRequest(client.Email, client.FirstName, client.LastName, Phone(index), birthDate),
                token));
        state.InvitationToken = InvitationToken(Require(
            result.Invitation,
            result.Status == InvitationCommandStatus.Success,
            $"invite {client.FirstName}",
            result));
        state.BirthDate = birthDate;
    }

    private async Task JoinAsync(DemoClientState state, int index)
    {
        var client = state.Client;
        var accepted = await As<IInvitationApplicationService, InvitationAcceptanceResult>(
            DemoActor.Anonymous,
            (service, token) => service.AcceptAsync(
                new AcceptClientInvitationRequest(state.InvitationToken!, client.DisplayName, password),
                token));
        Require(
            accepted.Status == InvitationAcceptanceStatus.Accepted && accepted.ClientProfileId is not null,
            $"{client.FirstName} accepts",
            accepted);
        state.ClientProfileId = accepted.ClientProfileId!.Value;
        state.UserId = await FindUserIdAsync(client.Email);
        tally.Clients++;

        clock.Advance(TimeSpan.FromMinutes(6));
        var self = await As<IClientProfileApplicationService, ClientSelfProfile?>(
            ClientActor(state),
            (service, token) => service.GetSelfAsync(token));
        var profile = Require(self, self is not null, $"{client.FirstName} opens the intake", client.Email);
        var intake = new UpdateClientIntakeRequest(
            client.FirstName,
            client.LastName,
            Phone(index),
            state.BirthDate,
            client.HeightCentimeters,
            LengthUnit.Centimeter,
            client.WorkType,
            client.Steps,
            client.Background,
            client.FoodPreferences,
            client.FoodAversions,
            client.Goals,
            client.Allergies,
            client.Medications,
            client.Injuries,
            profile.Version);
        var completed = await As<IClientProfileApplicationService, ClientCommandResult>(
            ClientActor(state),
            (service, token) => service.CompleteSelfAsync(
                new CompleteClientOnboardingRequest(
                    intake,
                    client.StartWeight,
                    BodyweightUnit.Kilogram,
                    calendar.DateOf(clock.UtcNow)),
                token));
        Require(completed.Status == ClientCommandStatus.Success, $"{client.FirstName} completes the intake", completed);
        tally.WeighIns++;
    }

    private async Task WriteCoachNotesAsync(DemoClientState state)
    {
        var details = await As<IClientProfileApplicationService, CoachClientDetails?>(
            CoachOf(state),
            (service, token) => service.GetForCoachAsync(state.ClientProfileId, token));
        var current = Require(details, details is not null, $"{state.Client.FirstName}: open the profile", state.Client.Email);
        var result = await As<IClientProfileApplicationService, ClientCommandResult>(
            CoachOf(state),
            (service, token) => service.UpdateCoachNotesAsync(
                state.ClientProfileId,
                new UpdateCoachNotesRequest(state.Client.CoachNotes, current.Version),
                token));
        Require(result.Status == ClientCommandStatus.Success, $"{state.Client.FirstName}: coach notes", result);
    }

    private void PlanEnrollments(DemoClientState state, Random random)
    {
        var client = state.Client;
        for (var index = 0; index < client.Plans.Count; index++)
        {
            var plan = client.Plans[index];
            var renewal = index > 0;
            var at = renewal ? calendar.At(plan.StartDay - 3, 10, 0) : calendar.At(client.InvitedDay, 20, 30);
            var reference = random.Next(10_000, 99_999);
            timeline.At(at, $"{client.FirstName}: plan {index + 1}", () => BuyPlanAsync(state, plan, renewal, reference));
        }
    }

    private async Task BuyPlanAsync(DemoClientState state, DemoPlan plan, bool renewal, int reference)
    {
        var name = state.Client.FirstName;
        var offerId = offerIds[plan.Offer];
        var startDate = calendar.Day(plan.StartDay);
        var result = renewal
            ? await As<ICommercialApplicationService, CommercialCommandResult>(
                CoachOf(state),
                (service, token) => service.RenewAsync(
                    state.EnrollmentIds[^1],
                    new RenewEnrollmentRequest(offerId, startDate, Guid.CreateVersion7()),
                    token))
            : await As<ICommercialApplicationService, CommercialCommandResult>(
                CoachOf(state),
                (service, token) => service.AssignAsync(
                    state.ClientProfileId,
                    new AssignProductRequest(offerId, startDate, Guid.CreateVersion7()),
                    token));
        var enrollment = Require(result.Enrollment, result.Status == CommercialCommandStatus.Success, $"{name}: plan", result);
        state.EnrollmentIds.Add(enrollment.Id);

        clock.Advance(TimeSpan.FromMinutes(2));
        var (text, note) = plan.Method switch
        {
            ManualPaymentMethod.MobileWallet => ($"WHISH-{reference}", (string?)null),
            ManualPaymentMethod.BankTransfer => ($"TRF-{reference}", null),
            ManualPaymentMethod.Card => ($"POS-{reference}", null),
            _ => (null, "Paid at the studio."),
        };
        var paid = await As<ICommercialApplicationService, CommercialCommandResult>(
            CoachOf(state),
            (service, token) => service.RecordManualPaymentAsync(
                enrollment.Id,
                new RecordManualPaymentRequest(
                    enrollment.PriceAmount,
                    enrollment.PriceCurrency,
                    clock.UtcNow,
                    plan.Method,
                    text,
                    note,
                    Guid.CreateVersion7()),
                token));
        Require(paid.Status == CommercialCommandStatus.Success, $"{name}: payment", paid);
    }

    private void PlanBlocks(DemoClientState state)
    {
        var client = state.Client;
        for (var index = 0; index < client.Blocks.Count; index++)
        {
            var block = client.Blocks[index];
            var blockIndex = index;
            var at = block.AssignedDay is { } assignedDay
                ? calendar.At(assignedDay, 11, 0)
                : index == 0
                    ? calendar.At(client.InvitedDay, 21, 0)
                    : calendar.At(block.StartDay - 2, 11, 0);
            timeline.At(at, $"{client.FirstName}: program {index + 1}", () => AssignBlockAsync(state, blockIndex));
        }
    }

    private async Task AssignBlockAsync(DemoClientState state, int blockIndex)
    {
        var client = state.Client;
        var block = client.Blocks[blockIndex];
        var program = Program(block.ProgramKey);
        var workingMaxes = program.Sessions
            .SelectMany(session => session.Exercises)
            .Where(exercise => exercise.IsMainLift)
            .Select(exercise => exercise.ExerciseKey)
            .Distinct()
            .Select(key => new WorkingMaxSelectionRequest(
                exerciseIds[key],
                StrengthMaxRecordId: null,
                TrainingMax(client, key, blockIndex),
                TrainingLoadUnit.Kilogram))
            .ToList();
        var result = await As<ITrainingApplicationService, TrainingCommandResult>(
            CoachOf(state),
            (service, token) => service.AssignMesocycleAsync(
                state.ClientProfileId,
                new AssignMesocycleRequest(
                    state.EnrollmentIds[PlanIndexCovering(client, block.StartDay)],
                    templateVersionIds[block.ProgramKey],
                    calendar.Day(block.StartDay),
                    MesocycleKind.Primary,
                    TrainingLoadUnit.Kilogram,
                    2.5m,
                    TrainingLoadRoundingMode.Nearest,
                    workingMaxes,
                    Guid.CreateVersion7()),
                token));
        var mesocycle = Require(result.Mesocycle, result.Status == TrainingCommandStatus.Success, $"{client.FirstName}: {program.Name}", result);
        state.MesocycleIds[blockIndex] = mesocycle.Id;

        if (block.UnpublishWeek is { } weekNumber)
        {
            // The coach holds a week back to adjust it after the next check-in.
            clock.Advance(TimeSpan.FromMinutes(10));
            var week = mesocycle.Weeks.Single(item => item.WeekNumber == weekNumber);
            var held = await As<ITrainingApplicationService, TrainingCommandResult>(
                CoachOf(state),
                (service, token) => service.SetWeekPublishedAsync(
                    mesocycle.Id,
                    week.Id,
                    new SetWeekPublishedRequest(false, mesocycle.Version),
                    token));
            Require(held.Status == TrainingCommandStatus.Success, $"{client.FirstName}: hold week {weekNumber}", held);
        }
    }

    private void PlanWorkouts(DemoClientState state, Random random)
    {
        var client = state.Client;
        var sessions = new List<(int Block, int Week, DemoSessionPlan Session, int Day)>();
        for (var blockIndex = 0; blockIndex < client.Blocks.Count; blockIndex++)
        {
            var block = client.Blocks[blockIndex];
            var program = Program(block.ProgramKey);
            for (var week = 1; week <= program.Weeks.Count; week++)
            {
                if (block.UnpublishWeek == week)
                {
                    continue;
                }

                foreach (var session in program.Sessions)
                {
                    var day = block.StartDay + (7 * (week - 1)) + session.DayOffset;
                    var trainsToday = day == 0 && client.TrainedTodayAgo is { } ago &&
                        calendar.DateOf(calendar.Ago(ago)) == calendar.Today;
                    var afterPause = client.PausedDay is { } paused && day >= paused;
                    if ((day < 0 || trainsToday) && !afterPause)
                    {
                        sessions.Add((blockIndex, week, session, day));
                    }
                }
            }
        }

        var skippedAtTheEnd = sessions
            .Where(item => item.Day < 0)
            .OrderBy(item => item.Day)
            .TakeLast(client.MissLastSessions)
            .ToHashSet();
        foreach (var item in sessions)
        {
            var missed = random.NextDouble() > client.Adherence;
            if (missed || skippedAtTheEnd.Contains(item))
            {
                continue;
            }

            var at = item.Day == 0
                ? calendar.Ago(client.TrainedTodayAgo!.Value)
                : calendar.At(item.Day, client.TrainingHour, 0).AddMinutes(client.TrainingMinute + random.Next(-15, 26));
            var seed = random.Next();
            timeline.At(at, $"{client.FirstName}: {item.Session.Name}, week {item.Week}",
                () => TrainAsync(state, item.Block, item.Week, item.Session, item.Day, seed));
        }
    }

    private async Task TrainAsync(DemoClientState state, int blockIndex, int weekNumber, DemoSessionPlan session, int day, int seed)
    {
        var random = new Random(seed);
        var client = state.Client;
        var label = $"{client.FirstName}: {session.Name}";
        var scheme = Program(client.Blocks[blockIndex].ProgramKey).Weeks[weekNumber - 1];
        var mesocycleId = state.MesocycleIds[blockIndex];
        var workout = await FindWorkoutAsync(state, mesocycleId, session.Name, label);
        var started = await As<ITrainingApplicationService, TrainingCommandResult>(
            ClientActor(state),
            (service, token) => service.StartWorkoutAsync(workout.SessionId, token));
        var execution = Require(started.WorkoutExecution, started.Status == TrainingCommandStatus.Success, $"{label}: start", started);
        workout = await FindWorkoutAsync(state, mesocycleId, session.Name, label);
        var version = execution.Version;
        var weeksIn = (day - client.Plans[0].StartDay) / 7m;
        string? personalBest = null;
        clock.Advance(TimeSpan.FromMinutes(random.Next(5, 9)));

        foreach (var exercise in workout.Exercises)
        {
            var definition = exercisesById[exercise.ActualExerciseId];
            var plan = session.Exercises.First(item => item.ExerciseKey == definition.Key);
            var sets = exercise.Sets.OrderBy(set => set.Position).ToList();
            for (var index = 0; index < sets.Count; index++)
            {
                var set = sets[index];
                var last = index == sets.Count - 1;
                int repetitions;
                decimal? load;
                decimal rpe;
                if (plan.IsMainLift)
                {
                    load = set.PrescribedLoad;
                    repetitions = set.PrescribedRepetitionsMaximum ?? scheme.MainReps;
                    rpe = scheme.MainRpe + (last ? 0.5m : 0m) + Jitter(random);
                    if (last && client.SetsPersonalBests && !scheme.IsDeload && weekNumber >= 3 && random.NextDouble() < 0.45)
                    {
                        repetitions += random.Next(1, 3);
                        rpe = 9m;
                        personalBest = exercise.ActualExerciseName;
                    }
                }
                else
                {
                    load = AccessoryLoad(definition, client, weeksIn);
                    var minimum = set.PrescribedRepetitionsMinimum ?? plan.RepsMinimum;
                    var maximum = set.PrescribedRepetitionsMaximum ?? plan.RepsMaximum;
                    repetitions = Math.Min(maximum, minimum + ((weekNumber - 1) / 2) + random.Next(0, 2))
                        - (last && random.NextDouble() < 0.3 ? 1 : 0);
                    rpe = (scheme.IsDeload ? 7m : 8m) + (last ? 0.5m : 0m) + Jitter(random);
                }

                clock.Advance(TimeSpan.FromSeconds(plan.IsMainLift ? random.Next(150, 220) : random.Next(75, 130)));
                var saved = await As<ITrainingApplicationService, TrainingCommandResult>(
                    ClientActor(state),
                    (service, token) => service.RecordSetActualAsync(
                        execution.Id,
                        set.PerformanceId!.Value,
                        new RecordSetActualRequest(
                            Math.Max(1, repetitions),
                            load,
                            load is null ? null : TrainingLoadUnit.Kilogram,
                            Math.Clamp(rpe, 6m, 10m),
                            Rir: null,
                            IsCompleted: true,
                            ClientNote: null,
                            version),
                        token));
                version = Require(saved.SetSave, saved.Status == TrainingCommandStatus.Success, $"{label}: set", saved).ExecutionVersion;
                tally.Sets++;
            }
        }

        var note = personalBest is not null
            ? $"New best on {personalBest}! 🎉"
            : random.NextDouble() < 0.12 ? Pick(WorkoutNotes, random) : null;
        if (note is not null)
        {
            var noted = await As<ITrainingApplicationService, TrainingCommandResult>(
                ClientActor(state),
                (service, token) => service.AddWorkoutNoteAsync(execution.Id, new AddWorkoutNoteRequest(null, note), token));
            Require(noted.Status == TrainingCommandStatus.Success, $"{label}: note", noted);
            version = (await FindWorkoutAsync(state, mesocycleId, session.Name, label)).ExecutionVersion ?? version;
        }

        clock.Advance(TimeSpan.FromMinutes(random.Next(2, 6)));
        var completed = await As<ITrainingApplicationService, TrainingCommandResult>(
            ClientActor(state),
            (service, token) => service.CompleteWorkoutAsync(execution.Id, new CompleteWorkoutRequest(version), token));
        Require(completed.Status == TrainingCommandStatus.Success, $"{label}: complete", completed);
        tally.Workouts++;
        if (personalBest is not null)
        {
            tally.PersonalBests++;
        }

        if (note is not null && (personalBest is not null || random.NextDouble() < 0.6))
        {
            var reply = personalBest is not null
                ? $"Huge. That's a new best on {personalBest} 👏"
                : Pick(CoachWorkoutReplies, random);
            timeline.At(calendar.At(day + 1, 9, random.Next(0, 50)), $"{label}: coach reply", async () =>
            {
                var replied = await As<ITrainingApplicationService, TrainingCommandResult>(
                    CoachOf(state),
                    (service, token) => service.AddWorkoutNoteAsync(execution.Id, new AddWorkoutNoteRequest(null, reply), token));
                Require(replied.Status == TrainingCommandStatus.Success, $"{label}: coach reply", replied);
            });
        }
    }

    private async Task<ClientWorkoutView> FindWorkoutAsync(DemoClientState state, Guid mesocycleId, string sessionName, string label)
    {
        var today = await As<ITrainingApplicationService, ClientTrainingDayResult>(
            ClientActor(state),
            (service, token) => service.GetTodayAsync(token));
        var workout = today.Workouts.SingleOrDefault(item => item.MesocycleId == mesocycleId && item.Name == sessionName);
        return Require(workout, workout is not null, $"{label}: find today's session", today);
    }

    private void PlanWeighIns(DemoClientState state, Random random)
    {
        var client = state.Client;
        for (var day = client.InvitedDay + 1; day <= 0; day++)
        {
            if (random.NextDouble() > client.WeighInRate)
            {
                continue;
            }

            var weight = Weight(client, day, random);
            timeline.At(calendar.At(day, 7, random.Next(0, 55)), $"{client.FirstName}: weigh-in", async () =>
            {
                var result = await As<IProgressApplicationService, ProgressCommandResult>(
                    ClientActor(state),
                    (service, token) => service.RecordOwnAsync(new RecordBodyweightRequest(weight, RecordedMassUnit.Kilogram), token));
                Require(result.Status == ProgressCommandStatus.Success, $"{client.FirstName}: weigh-in", result);
                tally.WeighIns++;
            });
        }
    }

    private decimal Weight(DemoClient client, int day, Random random)
    {
        var start = client.InvitedDay;
        var change = client.StallFromDay is { } stall && day > stall
            ? (client.WeeklyTrend * (stall - start) / 7m) + (client.StallTrend * (day - stall) / 7m)
            : client.WeeklyTrend * (day - start) / 7m;
        var weekend = calendar.Day(day).DayOfWeek is DayOfWeek.Sunday or DayOfWeek.Monday ? 0.2m : 0m;
        return Math.Round(client.StartWeight + change + weekend + (decimal)(Gaussian(random) * 0.25), 1);
    }

    private void PlanMeasurements(DemoClientState state, Random random)
    {
        var client = state.Client;
        if (client.Waist is not { } waist)
        {
            return;
        }

        var start = client.Plans[0].StartDay;
        for (var day = start; day <= 0; day += 14)
        {
            var value = Math.Round(waist + (client.WaistTrend * (day - start) / 7m) + (decimal)(Gaussian(random) * 0.3), 1);
            timeline.At(calendar.At(day, 7, 58), $"{client.FirstName}: waist", async () =>
            {
                var result = await As<IProgressApplicationService, BodyMeasurementCommandResult>(
                    ClientActor(state),
                    (service, token) => service.RecordOwnMeasurementAsync(
                        new RecordBodyMeasurementRequest(MeasurementType.Waist, value, MeasurementUnit.Centimetre),
                        token));
                Require(result.Status == ProgressCommandStatus.Success, $"{client.FirstName}: waist", result);
                tally.Measurements++;
            });
        }
    }

    private void PlanCheckIns(DemoClientState state, Random random)
    {
        var client = state.Client;
        if (!Offer(client.Plans[0].Offer).Product.Features.Contains(CoachingFeature.CheckIns))
        {
            return;
        }

        var lastPlan = client.Plans[^1];
        var end = lastPlan.StartDay + (Offer(lastPlan.Offer).Offer.Weeks * 7);
        var dues = new List<int>();
        for (var due = client.Plans[0].StartDay + 6; due < end && due - 6 <= 0; due += 7)
        {
            dues.Add(due);
        }

        int? lastPastDue = dues.Where(due => due < 0).Select(due => (int?)due).LastOrDefault();
        var submissions = dues.ToDictionary(due => due, due => Submission(client, due, lastPastDue, end, random));
        int? lastSubmittedDue = submissions.Where(item => item.Value is not null).Select(item => (int?)item.Key).LastOrDefault();
        foreach (var due in dues)
        {
            var submission = submissions[due];
            var review = submission is { } submittedAt && !(client.CheckInWaiting && due == lastSubmittedDue)
                ? ReviewTime(submittedAt, end, random)
                : (DateTimeOffset?)null;
            var seed = random.Next();
            timeline.At(calendar.At(due - 6, 9, 0), $"{client.FirstName}: check-in due {calendar.Day(due):dd MMM}",
                () => AssignCheckInAsync(state, due, submission, review, seed));
        }
    }

    private DateTimeOffset? Submission(DemoClient client, int due, int? lastPastDue, int planEnd, Random random)
    {
        // Late means the next day, which only works while the plan still covers it.
        var late = random.NextDouble() < 0.12 && due + 1 < planEnd;
        var minutes = random.Next(0, 50);
        return due switch
        {
            > 0 => null,
            _ when due == lastPastDue && client.CheckInOverdue => null,
            _ when due == lastPastDue && client.SubmitsTodayAgo is { } ago => calendar.EarlierToday(ago),
            0 => null,
            // A late answer that would only arrive later today is on time instead, not missing.
            _ when late && calendar.At(due + 1, 13, minutes) < calendar.Now => calendar.At(due + 1, 13, minutes),
            _ => calendar.At(due, 20, minutes),
        };
    }

    /// <summary>The coach reviews the next morning, or the same evening when the plan ends overnight.</summary>
    private DateTimeOffset ReviewTime(DateTimeOffset submittedAt, int planEnd, Random random)
    {
        var nextDay = calendar.DateOf(submittedAt).AddDays(1);
        return nextDay < calendar.Day(planEnd)
            ? calendar.At(nextDay, 10, 30 + random.Next(0, 25))
            : submittedAt.AddMinutes(30 + random.Next(0, 40));
    }

    private async Task AssignCheckInAsync(DemoClientState state, int due, DateTimeOffset? submission, DateTimeOffset? review, int seed)
    {
        var name = state.Client.FirstName;
        var result = await As<ICheckInApplicationService, CheckInAssignmentCommandResult>(
            CoachOf(state),
            (service, token) => service.AssignAsync(
                state.ClientProfileId,
                new AssignCheckInRequest(checkInFormVersionId, calendar.Day(due)),
                token));
        var assignment = Require(result.Assignment, result.Status == CheckInCommandStatus.Success, $"{name}: assign check-in", result);
        if (submission is { } at)
        {
            timeline.At(at, $"{name}: submits check-in", () => SubmitCheckInAsync(state, assignment, review, seed));
        }
    }

    private async Task SubmitCheckInAsync(DemoClientState state, CheckInAssignmentDetail assignment, DateTimeOffset? review, int seed)
    {
        var random = new Random(seed);
        var client = state.Client;
        var answers = new List<CheckInAnswerRequest>();
        foreach (var question in assignment.Version.Questions)
        {
            // The server names each question; the demo knows them by their wording.
            var key = DemoWorkspaceCast.CheckInForm.Questions.Single(item => item.Prompt == question.Prompt).Key;
            CheckInAnswerRequest? answer = key switch
            {
                "energy" => new(question.Id, NumericValue: Scale(client.Mood.Energy, random)),
                "sleep" => new(question.Id, NumericValue: Scale(client.Mood.Sleep, random)),
                "stress" => new(question.Id, NumericValue: Scale(client.Mood.Stress, random)),
                "adherence" => new(question.Id, SelectedOptionIds: [question.Options.OrderBy(option => option.Order).ElementAt(AdherenceChoice(client, random)).Id]),
                "win" when random.NextDouble() < 0.75 => new(question.Id, TextValue: Pick(CheckInWins, random)),
                "notes" when random.NextDouble() < 0.45 => new(question.Id, TextValue: Pick(CheckInNotes, random)),
                _ => null,
            };
            if (answer is not null)
            {
                answers.Add(answer);
            }
        }

        var assignmentId = assignment.Assignment.Id;
        var draft = await As<ICheckInResponseApplicationService, CheckInResponseCommandResult>(
            ClientActor(state),
            (service, token) => service.SaveOwnDraftAsync(assignmentId, new SaveCheckInResponseRequest(answers), token));
        var saved = Require(draft.Response?.Response, draft.Status == CheckInCommandStatus.Success, $"{client.FirstName}: answer check-in", draft);
        clock.Advance(TimeSpan.FromMinutes(random.Next(2, 6)));
        var submitted = await As<ICheckInResponseApplicationService, CheckInResponseCommandResult>(
            ClientActor(state),
            (service, token) => service.SubmitOwnResponseAsync(assignmentId, new CheckInResponseConcurrencyRequest(saved.Version), token));
        var response = Require(
            submitted.Response?.Response,
            submitted.Status == CheckInCommandStatus.Success,
            $"{client.FirstName}: submit check-in",
            submitted);
        tally.CheckInsSubmitted++;

        if (review is { } reviewAt)
        {
            timeline.At(reviewAt, $"{client.FirstName}: check-in reviewed", async () =>
            {
                var reviewed = await As<ICheckInResponseApplicationService, CheckInResponseCommandResult>(
                    CoachOf(state),
                    (service, token) => service.ReviewAsync(
                        state.ClientProfileId,
                        assignmentId,
                        new CheckInResponseConcurrencyRequest(response.Version),
                        token));
                Require(reviewed.Status == CheckInCommandStatus.Success, $"{client.FirstName}: review check-in", reviewed);
                tally.CheckInsReviewed++;
            });
        }
    }

    private static int AdherenceChoice(DemoClient client, Random random)
    {
        var roll = random.NextDouble() * client.Adherence;
        return roll switch
        {
            > 0.75 => 0,
            > 0.55 => 1,
            > 0.3 => 2,
            _ => 3,
        };
    }

    private async Task OpenConversationAsync(DemoClientState state, int seed)
    {
        var created = await As<IMessagingApplicationService, ConversationCommandResult>(
            CoachOf(state),
            (service, token) => service.CreateDirectConversationAsync(
                new CreateDirectConversationRequest(state.ClientProfileId, Guid.CreateVersion7()),
                token));
        state.ConversationId = Require(
            created.Conversation,
            created.Status == MessagingCommandStatus.Success,
            $"{state.Client.FirstName}: open the conversation",
            created).Conversation.Id;
        await SendAsync(state, fromCoach: true, state.Client.Welcome);
        var readAt = clock.UtcNow.AddHours(3 + new Random(seed).Next(0, 6));
        timeline.At(readAt, $"{state.Client.FirstName}: reads the welcome", () => ReadAsync(state, byCoach: false));
    }

    private void PlanMessages(DemoClientState state, Random random)
    {
        foreach (var message in state.Client.Messages)
        {
            var at = message.Ago is { } ago
                ? calendar.EarlierToday(ago)
                : calendar.At(message.Day, message.Hour, message.Minute);
            timeline.At(at, $"{state.Client.FirstName}: message", () => SendAsync(state, message.FromCoach, message.Text));

            // Older messages get read a little later; the most recent ones stay unread.
            if (message.Ago is null)
            {
                timeline.At(at.AddMinutes(random.Next(40, 150)), $"{state.Client.FirstName}: reads a message",
                    () => ReadAsync(state, byCoach: !message.FromCoach));
            }
        }
    }

    private async Task SendAsync(DemoClientState state, bool fromCoach, string text)
    {
        // Nobody replies without reading what came before.
        await ReadAsync(state, fromCoach);
        var result = await As<IMessagingApplicationService, MessageCommandResult>(
            fromCoach ? CoachOf(state) : ClientActor(state),
            (service, token) => service.SendAsync(
                state.ConversationId,
                new SendMessageRequest(text, Guid.CreateVersion7()),
                token));
        var message = Require(result.Message, result.Status == MessagingCommandStatus.Success, $"{state.Client.FirstName}: send message", result);
        state.LatestSequence = message.Sequence;
        if (fromCoach)
        {
            state.CoachReadThrough = message.Sequence;
        }
        else
        {
            state.ClientReadThrough = message.Sequence;
        }

        tally.Messages++;
    }

    private async Task ReadAsync(DemoClientState state, bool byCoach)
    {
        var readThrough = byCoach ? state.CoachReadThrough : state.ClientReadThrough;
        if (readThrough >= state.LatestSequence)
        {
            return;
        }

        var result = await As<IMessagingApplicationService, ReadStateCommandResult>(
            byCoach ? CoachOf(state) : ClientActor(state),
            (service, token) => service.AdvanceReadCursorAsync(
                state.ConversationId,
                new AdvanceReadCursorRequest(state.LatestSequence),
                token));
        Require(result.Status == MessagingCommandStatus.Success, $"{state.Client.FirstName}: read messages", result);
        if (byCoach)
        {
            state.CoachReadThrough = state.LatestSequence;
        }
        else
        {
            state.ClientReadThrough = state.LatestSequence;
        }
    }

    private async Task PauseAsync(DemoClientState state)
    {
        var client = state.Client;
        var overview = await As<ICommercialApplicationService, ClientCommercialOverview?>(
            CoachOf(state),
            (service, token) => service.GetClientOverviewAsync(state.ClientProfileId, token));
        var enrollment = Require(overview, overview is not null, $"{client.FirstName}: open the plan", client.Email)
            .Enrollments.Single(item => item.Id == state.EnrollmentIds[^1]);
        var result = await As<ICommercialApplicationService, CommercialCommandResult>(
            CoachOf(state),
            (service, token) => service.PauseAsync(
                enrollment.Id,
                new ChangeEnrollmentStatusRequest(client.PauseReason ?? "Paused.", enrollment.Version),
                token));
        Require(result.Status == CommercialCommandStatus.Success, $"{client.FirstName}: pause", result);
    }

    private async Task AskToRenewAsync(DemoClientState state)
    {
        var result = await As<IClientRenewalService, RenewalRequestResult>(
            ClientActor(state),
            (service, _) => service.RequestAsync(cancellationToken));
        Require(result.Status == RenewalRequestStatus.Created, $"{state.Client.FirstName}: ask to renew", result);
    }

    private DemoActor CoachOf(DemoClientState state) => StaffActor(state.Client.CoachKey);

    private DemoActor ClientActor(DemoClientState state) => new(state.UserId, tenantId);

    private static int PlanIndexCovering(DemoClient client, int day)
    {
        for (var index = 0; index < client.Plans.Count; index++)
        {
            var plan = client.Plans[index];
            if (day >= plan.StartDay && day < plan.StartDay + (Offer(plan.Offer).Offer.Weeks * 7))
            {
                return index;
            }
        }

        throw new DemoStepFailedException($"{client.FirstName}: program", $"No plan covers day {day}.");
    }

    /// <summary>Each block after the first starts from a slightly higher training max.</summary>
    private static decimal TrainingMax(DemoClient client, string exerciseKey, int blockIndex)
    {
        var maxes = client.Maxes
            ?? throw new DemoStepFailedException($"{client.FirstName}: program", "This program needs training maxes.");
        var value = exerciseKey switch
        {
            "back-squat" => maxes.Squat,
            "bench-press" => maxes.Bench,
            "deadlift" => maxes.Deadlift,
            "overhead-press" => maxes.OverheadPress,
            _ => throw new DemoStepFailedException($"{client.FirstName}: program", $"No training max for {exerciseKey}."),
        };
        return Math.Round(value * (1m + (0.04m * blockIndex)) / 2.5m, MidpointRounding.AwayFromZero) * 2.5m;
    }

    private static decimal? AccessoryLoad(DemoExercise exercise, DemoClient client, decimal weeksIn)
    {
        if (exercise.BaseLoad is not { } baseLoad)
        {
            return null;
        }

        var raw = baseLoad * client.StrengthFactor * (1m + (0.015m * Math.Max(0m, weeksIn)));
        return Math.Max(exercise.LoadStep, Math.Round(raw / exercise.LoadStep, MidpointRounding.AwayFromZero) * exercise.LoadStep);
    }

    private static decimal Jitter(Random random) => random.Next(4) switch
    {
        0 => -0.5m,
        3 => 0.5m,
        _ => 0m,
    };

    private static decimal Scale(int typical, Random random) => Math.Clamp(typical + random.Next(-1, 2), 1, 10);

    private static string Pick(IReadOnlyList<string> items, Random random) => items[random.Next(items.Count)];

    private static double Gaussian(Random random) =>
        Math.Sqrt(-2.0 * Math.Log(1.0 - random.NextDouble())) * Math.Cos(2.0 * Math.PI * random.NextDouble());

    private static string Phone(int index) => $"+96170{(index * 7919 % 900_000) + 100_000}";

    private sealed class DemoClientState(DemoClient client)
    {
        public DemoClient Client { get; } = client;

        public string? InvitationToken { get; set; }

        public DateOnly? BirthDate { get; set; }

        public Guid UserId { get; set; }

        public Guid ClientProfileId { get; set; }

        public List<Guid> EnrollmentIds { get; } = [];

        public Dictionary<int, Guid> MesocycleIds { get; } = [];

        public Guid ConversationId { get; set; }

        public long LatestSequence { get; set; }

        public long CoachReadThrough { get; set; }

        public long ClientReadThrough { get; set; }
    }
}
