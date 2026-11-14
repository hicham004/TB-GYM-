using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9c3, the sessions of a program a trainee started from the house's list, against PostgreSQL: they
/// open only while the plan the program sits under grants (TRN-034), so a cancelled or paused pass shuts them while
/// Free still opens Training and a workout of one's own, though a workout already started still finishes; under the
/// next pass Start closes a block whose pass was cancelled once no workout of it is open, and a run's next block opens;
/// a program still to begin is never hidden (TRN-023); a self-directed trainee starts a session of the program's
/// current week before its day, never one of a later week (TRN-020), which Today lists and last time counts from the
/// day it was done; another trainee reaches none of it; a coach's space works as before; the database keeps a start as
/// written and a listing the house's; and the migration. Every name and figure is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9c3SHouseProgramsUrl = "/api/training/me/house-programs";

    private const string N9c3SProgramUrl = "/api/training/me/program";

    private const string N9c3SSuits = "Lifters with a year under the bar";

    private const string N9c3SClosedMessage =
        "This program came with a plan that isn't running now, so its sessions are closed. What you logged stays yours.";

    private const string N9c3SNotDueMessage = "This session is not due yet. It opens on its day.";

    /// <summary>The two tables, their four triggers, the start's guard function and three unique indexes.</summary>
    private const string N9c3SSchemaSql =
        """
        SELECT
            (SELECT count(*) FROM information_schema.tables
             WHERE table_schema = 'training' AND table_name IN ('HouseProgramListings', 'HouseProgramStarts'))
          + (SELECT count(*) FROM pg_trigger
             WHERE NOT tgisinternal AND tgname IN (
                 'TR_HouseProgramListings_House', 'TR_HouseProgramStarts_House',
                 'TR_HouseProgramStarts_Guard', 'TR_HouseProgramStarts_AppendOnly'))
          + (SELECT count(*) FROM pg_proc WHERE proname = 'guard_house_program_start')
          + (SELECT count(*) FROM pg_indexes
             WHERE schemaname = 'training' AND indexname IN (
                 'UX_HouseProgramListings_OfferedRunPlace', 'UX_HouseProgramListings_Template', 'UX_HouseProgramStarts_Mesocycle'))
        """;

    private const long N9c3SSchemaObjects = 10;

    /// <summary>The sets ticked done in one workout (@id).</summary>
    private const string N9c3SDoneSetsSql =
        """
        SELECT count(*) FROM training."WorkoutSetPerformances" set_
        JOIN training."WorkoutExercisePerformances" lift ON lift."Id" = set_."WorkoutExercisePerformanceId"
        WHERE lift."WorkoutExecutionId" = @id AND set_."IsCompleted"
        """;

    /// <summary>The sets of one workout (@id) neither ticked done nor given a weight or reps.</summary>
    private const string N9c3SEmptySetsSql =
        """
        SELECT count(*) FROM training."WorkoutSetPerformances" set_
        JOIN training."WorkoutExercisePerformances" lift ON lift."Id" = set_."WorkoutExercisePerformanceId"
        WHERE lift."WorkoutExecutionId" = @id AND NOT set_."IsCompleted"
          AND set_."ActualLoad" IS NULL AND set_."ActualRepetitions" IS NULL
        """;

    private const string N9c3SPassClosedReason =
        "Its Pro+ pass was cancelled; closed when the trainee started another program.";

    /// <summary>A program (@id) closed by Start: cancelled, holding no days, with one Cancelled event giving the reason.</summary>
    private const string N9c3SClosedByStartSql =
        $"""
        SELECT count(*) FROM training."Mesocycles" block
        JOIN training."MesocycleLifecycleEvents" event_ ON event_."MesocycleId" = block."Id"
        WHERE block."Id" = @id AND block."Status" = 'Cancelled' AND NOT block."BlocksPrimaryOverlap"
          AND event_."EventType" = 'Cancelled' AND event_."ToStatus" = 'Cancelled' AND event_."Reason" = '{N9c3SPassClosedReason}'
          AND (SELECT count(*) FROM training."MesocycleLifecycleEvents" other WHERE other."MesocycleId" = block."Id" AND other."EventType" = 'Cancelled') = 1
        """;

    /// <summary>A program (@id) still holding its days, with no Cancelled event.</summary>
    private const string N9c3SStillHoldingSql =
        """
        SELECT count(*) FROM training."Mesocycles" block
        WHERE block."Id" = @id AND block."Status" <> 'Cancelled' AND block."BlocksPrimaryOverlap"
          AND NOT EXISTS (SELECT 1 FROM training."MesocycleLifecycleEvents" event_
                          WHERE event_."MesocycleId" = block."Id" AND event_."EventType" = 'Cancelled')
        """;

    private const string N9c3SProgramsOfSql =
        """SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id""";

    // ---------- 1. the gate: a program's sessions close with its own plan ----------

    [TestMethod]
    public async Task N9c3SACancelledPassShutsItsProgramsSessionsWhileFreeStillOpensTrainingAndOwnWorkouts()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-gate");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-gate-talia@example.test", "Talia", "Wexford");
        var free = (await N9b1FRowsAsync(talia.ProfileId)).Single();
        var passId = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;

        // A one-week program of three days whose first set works its weight out from a max.
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Gate Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Gate Block", squat.Id, [[0, 1, 3]], N9c3SPercentSet(1), N9c3SDirectSet(2)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);

        // Without a max it cannot start; typed, it starts from it.
        var unready = (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single();
        Assert.AreEqual((false, (string?)HouseProgramCodes.NeedsMaxes), (unready.CanStart, unready.Refusal));
        await N9c3STypeMaxAsync(talia.Client, squat.Id, 100m);
        var ready = (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single();
        Assert.AreEqual(
            (true, (string?)null, (decimal?)100m, (HouseProgramMaxSource?)HouseProgramMaxSource.Typed),
            (ready.CanStart, ready.Refusal, ready.Maxes.Single().Value, ready.Maxes.Single().From));
        var started = await N9c3SStartedAsync(talia.Client, ready);
        Assert.AreEqual((today, today.AddDays(7)), (started.StartDate, started.EndDateExclusive));
        Assert.AreEqual(1L, await N9c1CountAsync(
            $"""SELECT count(*) FROM training."Mesocycles" WHERE "Id" = @id AND "EnrollmentId" = '{passId}'""",
            started.ProgramId), "The program sits under the pass.");

        // Day 0: today's session starts at 75% of the typed max, and a set is logged.
        var (workout, day) = await A3StartTodayAsync(talia.Client);
        var lift = day.Exercises.Single();
        Assert.AreEqual((decimal?)75m, lift.Sets[0].PrescribedLoad);
        var saved = await A3LogAsync(talia.Client, workout.Id, lift.Sets[0].PerformanceId!.Value, 5, 75m, null, workout.Version);

        // Day 1, the pass granting: today's session is listed, a later one of the week opens early, yesterday's
        // unfinished workout waits, and the week counts today's session.
        N9b1FSetHouseDay(today.AddDays(1));
        var sessions = await N9c3SSessionsAsync(talia.Client);
        var dayZero = sessions.Single(item => item.ScheduledDate == today);
        var dayOne = sessions.Single(item => item.ScheduledDate == today.AddDays(1));
        var dayThree = sessions.Single(item => item.ScheduledDate == today.AddDays(3));
        Assert.IsTrue(dayThree.CanStartEarly);
        Assert.AreEqual(dayOne.SessionId, (await N9b2ATodayAsync(talia.Client)).Workouts.Single().SessionId);
        var upcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(talia.Client, "/api/training/me/upcoming");
        Assert.AreEqual((Guid?)dayThree.SessionId, upcoming.NextSession?.SessionId);
        Assert.AreEqual((Guid?)workout.Id, upcoming.UnfinishedWorkouts.Single().Workout.WorkoutExecutionId);
        var week = await ReadSliceAsync<ClientTrainingWeekView>(talia.Client, "/api/training/me/week");
        Assert.AreEqual(1, week.Days.Single(item => item.Date == today.AddDays(1)).Scheduled);

        // The staff cancel the pass. Free still grants Training.
        await N9c3SStatusAsync(house.Owner, talia.ProfileId, passId, "cancel");
        await N9b1FAssertTrainingAsync(talia.Client, free.Id);

        // No session of the program starts: today's, a later day's of this week, nor the one already started.
        foreach (var (session, what) in new[]
        {
            (dayOne, "today's"),
            (dayThree, "a later day's of this week"),
            (dayZero, "the one already started"),
        })
        {
            Assert.AreEqual(
                (HouseProgramCodes.PlanClosed, N9c3SClosedMessage),
                await A7ConflictAsync(await N9c3SSessionAsync(talia.Client, session.SessionId)),
                what);
        }

        // The workout started under it takes no set, swap or note.
        foreach (var (route, response) in new[]
        {
            ("save a set", await N9b2ALogAsync(talia.Client, workout.Id, lift.Sets[1].PerformanceId!.Value, 5, 40m, null, saved.ExecutionVersion)),
            ("swap", await A3SwapAsync(talia.Client, workout.Id, lift.PerformanceId!.Value, squat.Id, saved.ExecutionVersion)),
            ("note", await N9b2ANoteAsync(talia.Client, workout.Id, null, "N9c3S felt light")),
        })
        {
            Assert.AreEqual((HouseProgramCodes.PlanClosed, N9c3SClosedMessage), await A7ConflictAsync(response), route);
        }

        // Today, Upcoming and the week leave the program out while Training stays open, and nothing starts early.
        var shutToday = await N9b2ATodayAsync(talia.Client);
        Assert.AreEqual((true, 0), (shutToday.IsAllowed, shutToday.Workouts.Count));
        var shutUpcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(talia.Client, "/api/training/me/upcoming");
        Assert.AreEqual((true, false), (shutUpcoming.IsAllowed, shutUpcoming.HasVisibleSessions));
        Assert.IsNull(shutUpcoming.NextSession);
        Assert.IsEmpty(shutUpcoming.UnfinishedWorkouts);
        var shutWeek = await ReadSliceAsync<ClientTrainingWeekView>(talia.Client, "/api/training/me/week");
        Assert.AreEqual((true, 0), (shutWeek.IsAllowed, shutWeek.Days.Sum(item => item.Scheduled)));
        Assert.IsFalse((await N9c3SSessionsAsync(talia.Client)).Single(item => item.SessionId == dayThree.SessionId).CanStartEarly);

        // What was logged stays, and nothing else was started.
        Assert.AreEqual(1L, await N9c1CountAsync(N9c3SDoneSetsSql + """ AND set_."ActualLoad" = 75""", workout.Id));
        Assert.AreEqual(1L, await N9c1CountAsync(
            """SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id""",
            talia.ProfileId));

        // The workout already started may still be finished (TRN-034), with what was logged and nothing more: the set
        // done at 75 kg, and the second set as it was, not done and empty.
        var finishing = await N9b2AFinishAsync(talia.Client, workout.Id, saved.ExecutionVersion);
        await AssertStatusAsync(finishing, HttpStatusCode.OK);
        var finished = await ReadSlicePayloadAsync<WorkoutExecutionView>(finishing);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, finished.Status);
        Assert.AreEqual(
            (1L, 1L, 1L),
            (await N9c1CountAsync(N9c3SDoneSetsSql, workout.Id),
             await N9c1CountAsync(N9c3SDoneSetsSql + """ AND set_."ActualLoad" = 75 AND set_."ActualRepetitions" = 5""", workout.Id),
             await N9c1CountAsync(N9c3SEmptySetsSql, workout.Id)),
            "The finished workout keeps the one set logged and the other empty.");

        // Finished, it still takes no set, swap or note, and no session of the program starts.
        foreach (var (route, response) in new[]
        {
            ("save a set", await N9b2ALogAsync(talia.Client, workout.Id, lift.Sets[1].PerformanceId!.Value, 5, 40m, null, finished.Version)),
            ("swap", await A3SwapAsync(talia.Client, workout.Id, lift.PerformanceId!.Value, squat.Id, finished.Version)),
            ("note", await N9b2ANoteAsync(talia.Client, workout.Id, null, "N9c3S felt light")),
            ("start today's session", await N9c3SSessionAsync(talia.Client, dayOne.SessionId)),
            ("start a later day's session", await N9c3SSessionAsync(talia.Client, dayThree.SessionId)),
        })
        {
            Assert.AreEqual((HouseProgramCodes.PlanClosed, N9c3SClosedMessage), await A7ConflictAsync(response), $"{route}, once finished");
        }

        Assert.AreEqual((1L, 1L), (
            await N9c1CountAsync(N9c3SDoneSetsSql, workout.Id),
            await N9c1CountAsync(
                """SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id""",
                talia.ProfileId)));
        Assert.IsEmpty((await N9b2ATodayAsync(talia.Client)).Workouts);

        // A workout of one's own still starts, takes a set and finishes.
        var own = await N9b2ABuildAsync(talia.Client, new N9b2ALift(squat.Id, [new N9b2ADone(5, 60m)]));
        await AssertStatusAsync(await N9b2AFinishAsync(talia.Client, own.WorkoutExecutionId, own.Version), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task N9c3SAPausedPassShutsItsProgramsSessionsUntilItResumes()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-pause");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-pause-talia@example.test", "Talia", "Wexford");
        var passId = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Pause Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Pause Block", squat.Id, [[0, 2]], N9c3SDirectSet(1)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);
        await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());
        var todays = (await N9c3SSessionsAsync(talia.Client)).Single(item => item.ScheduledDate == today);

        // Paused, the pass grants nothing: the session is shut and Today leaves it out.
        await N9c3SStatusAsync(house.Owner, talia.ProfileId, passId, "pause");
        Assert.AreEqual(
            HouseProgramCodes.PlanClosed,
            (await A7ConflictAsync(await N9c3SSessionAsync(talia.Client, todays.SessionId))).Code);
        var paused = await N9b2ATodayAsync(talia.Client);
        Assert.AreEqual((true, 0), (paused.IsAllowed, paused.Workouts.Count));

        // Resumed, it opens again.
        await N9c3SStatusAsync(house.Owner, talia.ProfileId, passId, "resume");
        Assert.AreEqual(todays.SessionId, (await N9b2ATodayAsync(talia.Client)).Workouts.Single().SessionId);
        await AssertStatusAsync(await N9c3SSessionAsync(talia.Client, todays.SessionId), HttpStatusCode.OK);
    }

    // ---------- 1b. a cancelled pass, then the next one ----------

    [TestMethod]
    public async Task N9c3SUnderTheNextPassStartClosesTheBlockWhosePassWasCancelledAndFreesItsDays()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-next-pass");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-next-talia@example.test", "Talia", "Wexford");
        var firstPass = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Next Squat", [], []);
        var longVersion = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Next Long Block", squat.Id, [[0, 2], [0, 2]], N9c3SDirectSet(1)));
        var shortVersion = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Next Short Block", squat.Id, [[0, 2]], N9c3SDirectSet(1)));
        var longListing = await N9c3SOfferAsync(house.Owner, longVersion.TemplateId);
        var shortListing = await N9c3SOfferAsync(house.Owner, shortVersion.TemplateId);
        var old = await N9c3SStartedAsync(talia.Client, await N9c3SListedAsync(talia.Client, longListing.ListingId));
        Assert.AreEqual((today, today.AddDays(14)), (old.StartDate, old.EndDateExclusive));

        // Day 0's workout is done.
        var (workout, day) = await A3StartTodayAsync(talia.Client);
        var saved = await A3LogAsync(talia.Client, workout.Id, day.Exercises.Single().Sets[0].PerformanceId!.Value, 5, 40m, null, workout.Version);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, (await A3FinishAsync(talia.Client, workout.Id, saved.ExecutionVersion)).Status);

        // Day 3, the pass running: the block runs and holds its days, so the other program waits for its end.
        N9b1FSetHouseDay(today.AddDays(3));
        var running = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual((Guid?)old.ProgramId, running.Running?.ProgramId);
        Assert.AreEqual(
            (false, (string?)HouseProgramCodes.Overlap, (DateOnly?)today.AddDays(14)),
            N9c3SVerdict(running, shortListing.ListingId));

        // The staff cancel the pass. On Free the block no longer runs for the read and nothing starts; reading closes
        // nothing.
        await N9c3SStatusAsync(house.Owner, talia.ProfileId, firstPass, "cancel");
        var onFree = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual(((HouseProgramPassView?)null, (HouseProgramRunningView?)null), (onFree.Pass, onFree.Running));
        CollectionAssert.AreEqual(
            new[] { HouseProgramCodes.NeedsPass, HouseProgramCodes.NeedsPass },
            onFree.Programs.Select(item => item.Refusal).ToArray());
        Assert.AreEqual(1L, await N9c1CountAsync(N9c3SStillHoldingSql, old.ProgramId));

        // The next pass, booked from today: both programs can start, and nothing names the old block as running.
        var nextPass = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;
        var ready = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual(
            ((Guid?)nextPass, (DateOnly?)today.AddDays(3), (HouseProgramRunningView?)null),
            (ready.Pass?.EnrollmentId, ready.Pass?.StartDate, ready.Running));
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), N9c3SVerdict(ready, shortListing.ListingId));
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), N9c3SVerdict(ready, longListing.ListingId));

        // Start: the short program runs from today under the next pass, over days the old block held; the old block is
        // closed, cancelled with its reason, and holds none of its days.
        var started = await N9c3SStartedAsync(talia.Client, ready.Programs.Single(item => item.ListingId == shortListing.ListingId));
        Assert.AreEqual((today.AddDays(3), today.AddDays(10)), (started.StartDate, started.EndDateExclusive));
        Assert.AreEqual(1L, await N9c1CountAsync(
            $"""SELECT count(*) FROM training."Mesocycles" WHERE "Id" = @id AND "EnrollmentId" = '{nextPass}' AND "Status" <> 'Cancelled'""",
            started.ProgramId));
        Assert.AreEqual(1L, await N9c1CountAsync(N9c3SClosedByStartSql, old.ProgramId));

        // The read names the new program as running; Today lists its session, never the old block's.
        var after = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual(((Guid?)started.ProgramId, 2), (after.Running?.ProgramId, after.Programs.Count(item => item.Refusal == HouseProgramCodes.Overlap)));
        var todays = (await N9b2ATodayAsync(talia.Client)).Workouts.Single();
        Assert.AreEqual(started.ProgramId, todays.MesocycleId);

        // What was logged under the old block stays, and two programs were started, one start each.
        Assert.AreEqual(
            (1L, 2L, 2L),
            (await N9c1CountAsync(N9c3SDoneSetsSql, workout.Id),
             await N9c1CountAsync(N9c3SProgramsOfSql, talia.ProfileId),
             await N9c3SStartsOfAsync(talia.ProfileId)));
    }

    [TestMethod]
    public async Task N9c3SAWorkoutStillOpenUnderACancelledPassHoldsTheNextStartUntilItIsFinished()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-open-workout");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-open-talia@example.test", "Talia", "Wexford");
        var firstPass = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Open Squat", [], []);
        var longVersion = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Open Long Block", squat.Id, [[0, 2], [0, 2]], N9c3SDirectSet(1), N9c3SDirectSet(2)));
        var shortVersion = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Open Short Block", squat.Id, [[0, 2]], N9c3SDirectSet(1)));
        var longListing = await N9c3SOfferAsync(house.Owner, longVersion.TemplateId);
        var shortListing = await N9c3SOfferAsync(house.Owner, shortVersion.TemplateId);
        var old = await N9c3SStartedAsync(talia.Client, await N9c3SListedAsync(talia.Client, longListing.ListingId));
        Assert.AreEqual("N9c3S Open Long Block", old.Name);

        // Day 0's workout: started, one set logged, left open.
        var (workout, day) = await A3StartTodayAsync(talia.Client);
        var saved = await A3LogAsync(talia.Client, workout.Id, day.Exercises.Single().Sets[0].PerformanceId!.Value, 5, 40m, null, workout.Version);

        // Day 1: the staff cancel the pass and book the next one.
        N9b1FSetHouseDay(today.AddDays(1));
        await N9c3SStatusAsync(house.Owner, talia.ProfileId, firstPass, "cancel");
        var nextPass = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;

        // The block with the open workout still runs for the read, and each program reads the overlap, with no day it
        // opens: it waits for the workout, not a date.
        var held = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual(((Guid?)nextPass, (Guid?)old.ProgramId), (held.Pass?.EnrollmentId, held.Running?.ProgramId));
        Assert.AreEqual((false, (string?)HouseProgramCodes.Overlap, (DateOnly?)null), N9c3SVerdict(held, shortListing.ListingId));
        Assert.AreEqual((false, (string?)HouseProgramCodes.Overlap, (DateOnly?)null), N9c3SVerdict(held, longListing.ListingId));

        // Start says why, and changes nothing: the old block is not cancelled and nothing new was written.
        var finishFirst =
            $"Finish the workout you started in \"{old.Name}\" first: its plan has ended, so it closes once that workout is done.";
        foreach (var listingId in new[] { shortListing.ListingId, longListing.ListingId })
        {
            Assert.AreEqual(
                (HouseProgramCodes.Overlap, finishFirst),
                await A7ConflictAsync(await N9c3SStartAsync(talia.Client, held.Programs.Single(item => item.ListingId == listingId))));
        }

        Assert.AreEqual(
            (1L, 1L, 1L),
            (await N9c1CountAsync(N9c3SStillHoldingSql, old.ProgramId),
             await N9c1CountAsync(N9c3SProgramsOfSql, talia.ProfileId),
             await N9c3SStartsOfAsync(talia.ProfileId)));

        // The workout finishes, with the set logged.
        var finished = await N9b2AFinishAsync(talia.Client, workout.Id, saved.ExecutionVersion);
        await AssertStatusAsync(finished, HttpStatusCode.OK);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, (await ReadSlicePayloadAsync<WorkoutExecutionView>(finished)).Status);
        Assert.AreEqual((1L, 1L), (await N9c1CountAsync(N9c3SDoneSetsSql, workout.Id), await N9c1CountAsync(N9c3SEmptySetsSql, workout.Id)));

        // Now nothing runs, the next Start succeeds under the next pass, and the old block is closed with its reason.
        var freed = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.IsNull(freed.Running);
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), N9c3SVerdict(freed, shortListing.ListingId));
        var started = await N9c3SStartedAsync(talia.Client, freed.Programs.Single(item => item.ListingId == shortListing.ListingId));
        Assert.AreEqual((today.AddDays(1), today.AddDays(8)), (started.StartDate, started.EndDateExclusive));
        Assert.AreEqual(1L, await N9c1CountAsync(
            $"""SELECT count(*) FROM training."Mesocycles" WHERE "Id" = @id AND "EnrollmentId" = '{nextPass}'""",
            started.ProgramId));
        Assert.AreEqual(1L, await N9c1CountAsync(N9c3SClosedByStartSql, old.ProgramId));
        Assert.AreEqual((Guid?)started.ProgramId, (await N9c3SHouseProgramsAsync(talia.Client)).Running?.ProgramId);
    }

    [TestMethod]
    public async Task N9c3SARunsNextBlockOpensUnderTheNextPassOnceTheBlockBeforeLostItsPassEvenAfterStartClosedIt()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-run-pass");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-run-talia@example.test", "Talia", "Wexford");
        var firstPass = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Ladder Squat", [], []);
        var one = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Ladder One", squat.Id, [[0, 2], [0, 2]], N9c3SDirectSet(1)));
        var two = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Ladder Two", squat.Id, [[0, 2]], N9c3SDirectSet(1)));
        var bridge = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Ladder Bridge", squat.Id, [[0]], N9c3SDirectSet(1)));
        var first = await N9c3SOfferAsync(house.Owner, one.TemplateId, "N9c3S Ladder", 1);
        var second = await N9c3SOfferAsync(house.Owner, two.TemplateId, "N9c3S Ladder", 2);
        var between = await N9c3SOfferAsync(house.Owner, bridge.TemplateId);
        var blockOne = await N9c3SStartedAsync(talia.Client, await N9c3SListedAsync(talia.Client, first.ListingId));
        Assert.AreEqual(today.AddDays(14), blockOne.EndDateExclusive);

        // While block 1's pass runs, block 2 opens on block 1's end.
        Assert.AreEqual(
            (false, (string?)HouseProgramCodes.BlockNotOpen, (DateOnly?)today.AddDays(14)),
            N9c3SVerdict(await N9c3SHouseProgramsAsync(talia.Client), second.ListingId));

        // Day 3, eleven days before block 1's end: its pass is cancelled and the next one booked. Block 2 opens now.
        N9b1FSetHouseDay(today.AddDays(3));
        await N9c3SStatusAsync(house.Owner, talia.ProfileId, firstPass, "cancel");
        var nextPass = (await N9c1AskAndBookAsync(space, talia)).Outcome!.EnrollmentId!.Value;
        var open = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual(((Guid?)nextPass, (HouseProgramRunningView?)null), (open.Pass?.EnrollmentId, open.Running));
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), N9c3SVerdict(open, second.ListingId));

        // The bridge starts first, which closes block 1. The run still counts block 1 as ended on the day its pass was
        // cancelled, not as a block the staff cancelled, so block 2 waits only for the bridge's days.
        var bridged = await N9c3SStartedAsync(talia.Client, open.Programs.Single(item => item.ListingId == between.ListingId));
        Assert.AreEqual((today.AddDays(3), today.AddDays(10)), (bridged.StartDate, bridged.EndDateExclusive));
        Assert.AreEqual(1L, await N9c1CountAsync(N9c3SClosedByStartSql, blockOne.ProgramId));
        var waiting = await N9c3SHouseProgramsAsync(talia.Client);
        Assert.AreEqual(
            (false, (string?)HouseProgramCodes.Overlap, (DateOnly?)today.AddDays(10)),
            N9c3SVerdict(waiting, second.ListingId));
        Assert.AreEqual(
            (HouseProgramCodes.Overlap,
             $"\"{bridged.Name}\" runs until {HouseProgramRules.Day(today.AddDays(9))}. One program at a time: this one can start from {HouseProgramRules.Day(today.AddDays(10))}."),
            await A7ConflictAsync(await N9c3SStartAsync(talia.Client, waiting.Programs.Single(item => item.ListingId == second.ListingId))));

        // Day 10: block 2 starts under the next pass, its start naming the run's place 2.
        N9b1FSetHouseDay(today.AddDays(10));
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), N9c3SVerdict(await N9c3SHouseProgramsAsync(talia.Client), second.ListingId));
        var blockTwo = await N9c3SStartedAsync(talia.Client, await N9c3SListedAsync(talia.Client, second.ListingId));
        Assert.AreEqual((today.AddDays(10), today.AddDays(17)), (blockTwo.StartDate, blockTwo.EndDateExclusive));
        Assert.AreEqual(1L, await N9c1CountAsync(
            $"""
            SELECT count(*) FROM training."HouseProgramStarts"
            WHERE "MesocycleId" = @id AND "EnrollmentId" = '{nextPass}' AND "ListingId" = '{second.ListingId}'
              AND "RunName" = 'N9c3S Ladder' AND "RunKey" = 'n9c3s ladder' AND "RunPosition" = 2
            """,
            blockTwo.ProgramId));
        Assert.AreEqual(3L, await N9c3SStartsOfAsync(talia.ProfileId));
    }

    // ---------- 2. the week (TRN-020) ----------

    [TestMethod]
    public async Task N9c3SATraineeStartsASessionOfTheProgramsCurrentWeekEarlyButNeverOneOfALaterWeek()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-week");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-week-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Week Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Week Block", squat.Id, [[0, 2, 4], [0, 2]], N9c3SDirectSet(1)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);
        var started = await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());
        Assert.AreEqual(today, started.StartDate);

        // Day 0: the later days of week 1 may start early; today's is due, so not early; week 2's wait.
        var sessions = await N9c3SSessionsAsync(talia.Client);
        Assert.AreEqual("0:False 2:True 4:True 7:False 9:False", N9c3SEarly(sessions, today));
        var byDay = sessions.ToDictionary(item => item.ScheduledDate.DayNumber - today.DayNumber, item => item.SessionId);

        // Day 2's starts today, on time and never late.
        await AssertStatusAsync(await N9c3SSessionAsync(talia.Client, byDay[2]), HttpStatusCode.OK);
        var early = (await N9c3SSessionsAsync(talia.Client)).Single(item => item.SessionId == byDay[2]);
        Assert.AreEqual(((DateOnly?)today, false, false), (early.StartedOn, early.IsLate, early.CanStartEarly));
        Assert.AreEqual("0:False 2:False 4:True 7:False 9:False", N9c3SEarly(await N9c3SSessionsAsync(talia.Client), today));

        // Week 2's sessions wait for their days, and nothing is started for them.
        foreach (var offset in new[] { 7, 9 })
        {
            Assert.AreEqual(
                ("session_not_due", N9c3SNotDueMessage),
                await A7ConflictAsync(await N9c3SSessionAsync(talia.Client, byDay[offset])),
                $"Day {offset}");
        }

        Assert.AreEqual(1L, await N9c1CountAsync(
            """SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id""",
            talia.ProfileId));

        // Day 6, the week's last day: day 4's is behind, and day 7's is tomorrow but in the next program week.
        N9b1FSetHouseDay(today.AddDays(6));
        Assert.AreEqual("0:False 2:False 4:False 7:False 9:False", N9c3SEarly(await N9c3SSessionsAsync(talia.Client), today));
        Assert.AreEqual("session_not_due", (await A7ConflictAsync(await N9c3SSessionAsync(talia.Client, byDay[7]))).Code);

        // Day 7, week 2: its later session opens early and starts.
        N9b1FSetHouseDay(today.AddDays(7));
        Assert.AreEqual("0:False 2:False 4:False 7:False 9:True", N9c3SEarly(await N9c3SSessionsAsync(talia.Client), today));
        await AssertStatusAsync(await N9c3SSessionAsync(talia.Client, byDay[9]), HttpStatusCode.OK);
        await AssertStatusAsync(await N9c3SSessionAsync(talia.Client, byDay[7]), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task N9c3STodayListsASessionStartedEarlyThatDayAndLastTimeCountsItFromTheDayItWasDone()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-early-today");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-early-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Early Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Early Block", squat.Id, [[0, 1, 3]], N9c3SDirectSet(1), N9c3SDirectSet(2)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);
        await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());
        var byDay = (await N9c3SSessionsAsync(talia.Client))
            .ToDictionary(item => item.ScheduledDate.DayNumber - today.DayNumber, item => item.SessionId);

        // Day 0: before anything is started, Today lists today's session alone.
        CollectionAssert.AreEqual(new[] { byDay[0] }, (await N9b2ATodayAsync(talia.Client)).Workouts.Select(item => item.SessionId).ToArray());

        // Day 3's session starts early: while its workout is open, Today lists it beside today's.
        var starting = await N9c3SSessionAsync(talia.Client, byDay[3]);
        await AssertStatusAsync(starting, HttpStatusCode.OK);
        var early = await ReadSlicePayloadAsync<WorkoutExecutionView>(starting);
        var open = await N9b2ATodayAsync(talia.Client);
        CollectionAssert.AreEquivalent(new[] { byDay[0], byDay[3] }, open.Workouts.Select(item => item.SessionId).ToArray());
        var listed = open.Workouts.Single(item => item.SessionId == byDay[3]);
        Assert.AreEqual(((Guid?)early.Id, (WorkoutExecutionStatus?)WorkoutExecutionStatus.InProgress), (listed.WorkoutExecutionId, listed.Status));
        Assert.AreEqual("none", N9c3SLastTime(listed.Exercises.Single().PreviousPerformance), "Nothing was done before.");

        // Two sets are logged and it is finished: Today still lists it that day, done.
        var sets = listed.Exercises.Single().Sets;
        var saved = await A3LogAsync(talia.Client, early.Id, sets[0].PerformanceId!.Value, 5, 62.5m, null, early.Version);
        saved = await A3LogAsync(talia.Client, early.Id, sets[1].PerformanceId!.Value, 4, 65m, null, saved.ExecutionVersion);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, (await A3FinishAsync(talia.Client, early.Id, saved.ExecutionVersion)).Status);
        var done = await N9b2ATodayAsync(talia.Client);
        CollectionAssert.AreEquivalent(new[] { byDay[0], byDay[3] }, done.Workouts.Select(item => item.SessionId).ToArray());
        Assert.AreEqual(
            (WorkoutExecutionStatus?)WorkoutExecutionStatus.Completed,
            done.Workouts.Single(item => item.SessionId == byDay[3]).Status);
        Assert.AreEqual(
            "none",
            N9c3SLastTime(done.Workouts.Single(item => item.SessionId == byDay[0]).Exercises.Single().PreviousPerformance),
            "A workout done today is not last time for today's session.");

        // Day 1: Today lists day 1's session alone, and last time for its lift is the workout done early.
        N9b1FSetHouseDay(today.AddDays(1));
        var next = (await N9b2ATodayAsync(talia.Client)).Workouts.Single();
        Assert.AreEqual(byDay[1], next.SessionId);
        var lastTime = next.Exercises.Single().PreviousPerformance;
        Assert.AreEqual("62.5x5 65x4", N9c3SLastTime(lastTime));
        Assert.AreEqual(((decimal?)65m, (int?)4, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram), (lastTime!.BestLoad, lastTime.Repetitions, lastTime.Unit));
    }

    /// <summary>
    /// TRN-034 and TRN-029: last time is the latest day the lift was done. A session done early is last time from the
    /// day it was done, so a session done after it, on a later day though due earlier, is last time from then on, and
    /// last time never reads a day still to come.
    /// </summary>
    [TestMethod]
    public async Task N9c3SLastTimeIsTheLiftsLatestWorkoutByTheDayItWasDoneWhenASessionWasDoneEarly()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-last-time");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-last-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Last Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Last Block", squat.Id, [[0, 1, 2, 4]], N9c3SDirectSet(1)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);
        await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());
        var byDay = (await N9c3SSessionsAsync(talia.Client))
            .ToDictionary(item => item.ScheduledDate.DayNumber - today.DayNumber, item => item.SessionId);

        // Day 0: day 4's session is done early, at 60 kg.
        var starting = await N9c3SSessionAsync(talia.Client, byDay[4]);
        await AssertStatusAsync(starting, HttpStatusCode.OK);
        var early = await ReadSlicePayloadAsync<WorkoutExecutionView>(starting);
        var earlySet = (await N9b2ATodayAsync(talia.Client)).Workouts.Single(item => item.SessionId == byDay[4]).Exercises.Single().Sets[0];
        var saved = await A3LogAsync(talia.Client, early.Id, earlySet.PerformanceId!.Value, 5, 60m, null, early.Version);
        await A3FinishAsync(talia.Client, early.Id, saved.ExecutionVersion);

        // Day 1: last time is day 0's workout. Day 1's session is done, at 70 kg.
        N9b1FSetHouseDay(today.AddDays(1));
        var (dayOne, dayOneView) = await A3StartTodayAsync(talia.Client);
        var onDayOne = dayOneView.Exercises.Single().PreviousPerformance;
        saved = await A3LogAsync(talia.Client, dayOne.Id, dayOneView.Exercises.Single().Sets[0].PerformanceId!.Value, 5, 70m, null, dayOne.Version);
        await A3FinishAsync(talia.Client, dayOne.Id, saved.ExecutionVersion);

        // Day 2: last time is day 1's workout, the latest done.
        N9b1FSetHouseDay(today.AddDays(2));
        var dayTwo = (await N9b2ATodayAsync(talia.Client)).Workouts.Single();
        Assert.AreEqual(byDay[2], dayTwo.SessionId);
        var onDayTwo = dayTwo.Exercises.Single().PreviousPerformance;

        Assert.AreEqual(
            ((DateOnly?)today, "60x5", (DateOnly?)today.AddDays(1), "70x5"),
            (onDayOne?.Date, N9c3SLastTime(onDayOne), onDayTwo?.Date, N9c3SLastTime(onDayTwo)),
            "Last time on day 1 is day 0's early workout, dated the day it was done; on day 2 it is day 1's workout.");
    }

    // ---------- 3 and 4. a coach's space is unchanged ----------

    [TestMethod]
    public async Task N9c3SACoachsClientStartsTodaysSessionAsBeforeAndWaitsForALaterDayOfTheWeek()
    {
        var today = N9b1FStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "n9c3s-coach@example.test", "N9c3S Coach", "N9c3S Coach Space");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "n9c3s-coach-client@example.test", true);
        SetTenant(client, tenant);
        var plan = await CreateTrainingEnrollmentAsync(coach, clientId, today, 8);
        await N9c3SBesidePlanAsync(coach, clientId, today);
        var squat = await CreateExerciseAsync(coach, "N9c3S Coach Squat", [], []);
        var version = await PublishProgramAsync(
            coach,
            N9c3SProgram("N9c3S Coach Block", squat.Id, [[0, 2]], N9c3SDirectSet(1), N9c3SDirectSet(2)));
        await AssertStatusAsync(await N9b1FAssignAsync(coach, clientId, plan.Id, version.Id, today), HttpStatusCode.OK);

        // A later day of this week waits for its day, and nothing offers to start it early.
        var sessions = await N9c3SSessionsAsync(client);
        Assert.AreEqual("0:False 2:False", N9c3SEarly(sessions, today));
        Assert.AreEqual(
            ("session_not_due", N9c3SNotDueMessage),
            await A7ConflictAsync(await N9c3SSessionAsync(client, sessions.Single(item => item.ScheduledDate == today.AddDays(2)).SessionId)));

        // Today's starts and takes a set as before.
        var (workout, day) = await A3StartTodayAsync(client);
        var sets = day.Exercises.Single().Sets;
        var saved = await A3LogAsync(client, workout.Id, sets[0].PerformanceId!.Value, 5, 40m, null, workout.Version);

        // The plan the program sits under is cancelled while another still grants Training: outside the house no plan
        // gate shuts the program, so its workout carries on and finishes.
        await N9c3SStatusAsync(coach, clientId, plan.Id, "cancel");
        saved = await A3LogAsync(client, workout.Id, sets[1].PerformanceId!.Value, 5, 40m, null, saved.ExecutionVersion);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, (await A3FinishAsync(client, workout.Id, saved.ExecutionVersion)).Status);
        Assert.AreEqual(day.SessionId, (await N9b2ATodayAsync(client)).Workouts.Single().SessionId);
    }

    /// <summary>
    /// TRN-034 with TRN-023: the house's plan gate leaves out a program that has begun under a plan no longer granting,
    /// never one still to begin. A client the house invited, with a paid plan now and a paid plan from a later day, reads a
    /// program its Coach shows now under the later plan exactly as a coach's client in their own space does.
    /// </summary>
    [TestMethod]
    public async Task N9c3SAProgramStillToBeginUnderALaterPaidPlanIsShownInTheHouseAsInACoachsSpace()
    {
        var today = N9b1FStartAtMidday();
        var later = today.AddDays(28);

        // The house: a client its Coach invited, not a trainee of their own.
        using var space = await N9c1OpenAsync("n9c3s-later", withCoach: true);
        var house = space.House;
        using var rita = CreateClient();
        var ritaId = await InviteAndAcceptAsync(house.Coach!, rita, "n9c3s-later-rita@example.test", true);
        var (housesProgram, inHouse) = await N9c3SLaterProgramAsync(house.Owner, house.Coach!, rita, ritaId, today, later, "N9c3S Later House");

        // A coach's own space, the same.
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n9c3s-later-coach@example.test", "N9c3S Coach", "N9c3S Later Coach Space");
        using var karim = CreateClient();
        var karimId = await InviteAndAcceptAsync(coach, karim, "n9c3s-later-karim@example.test", true);
        var (_, inCoachSpace) = await N9c3SLaterProgramAsync(coach, coach, karim, karimId, today, later, "N9c3S Later Coach");

        // Before its first day: the program is had and coming, its first session is next, and today's coverage names
        // the day it begins, in the house as in the coach's space.
        var expected = (true, true, (DateOnly?)later, (string?)"Week 1 day 0",
            (TodayTrainingCoverageView?)new TodayTrainingCoverageView(null, later));
        Assert.AreEqual(expected, N9c3SUpcomingShape(inHouse), "In the house.");
        Assert.AreEqual(expected, N9c3SUpcomingShape(inCoachSpace), "In a coach's space.");
        Assert.IsTrue(inHouse.IsAllowed);
        Assert.IsEmpty(inHouse.UnfinishedWorkouts);

        // Shown early, its session still waits for its day: the client is no self-directed trainee.
        var firstSession = inHouse.NextSession!.SessionId;
        Assert.AreEqual(
            ("session_not_due", N9c3SNotDueMessage),
            await A7ConflictAsync(await N9c3SSessionAsync(rita, firstSession)));

        // On its first day, under the later plan, Today lists its session and it starts.
        N9b1FSetHouseDay(later);
        var onTheDay = await N9b2ATodayAsync(rita);
        Assert.AreEqual((housesProgram, firstSession), (onTheDay.Workouts.Single().MesocycleId, onTheDay.Workouts.Single().SessionId));
        await AssertStatusAsync(await N9c3SSessionAsync(rita, firstSession), HttpStatusCode.OK);
    }

    // ---------- 5. another trainee ----------

    [TestMethod]
    public async Task N9c3SAnotherTraineeReachesNeitherATraineesSessionsNorTheirProgramsSummary()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-other");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-other-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c3s-other-corin@example.test", "Corin", "Ashgrove");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Other Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Other Block", squat.Id, [[0, 2]], N9c3SDirectSet(1), N9c3SDirectSet(2)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);
        var started = await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());
        var sessions = await N9c3SSessionsAsync(talia.Client);
        var (workout, day) = await A3StartTodayAsync(talia.Client);
        var sets = day.Exercises.Single().Sets;
        var saved = await A3LogAsync(talia.Client, workout.Id, sets[0].PerformanceId!.Value, 5, 40m, null, workout.Version);

        // Corin, on Free with Training open, reaches none of Talia's sessions, her workout or her program.
        foreach (var session in sessions)
        {
            await AssertStatusAsync(await N9c3SSessionAsync(corin.Client, session.SessionId), HttpStatusCode.NotFound);
        }

        await AssertStatusAsync(
            await N9b2ALogAsync(corin.Client, workout.Id, sets[1].PerformanceId!.Value, 5, 40m, null, saved.ExecutionVersion),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9b2AFinishAsync(corin.Client, workout.Id, saved.ExecutionVersion), HttpStatusCode.NotFound);
        var corinsRead = await ReadSliceAsync<ClientTrainingProgramView>(corin.Client, N9c3SProgramUrl);
        Assert.AreEqual((true, (ClientProgramView?)null), (corinsRead.IsAllowed, corinsRead.Program));

        // Once the program has ended its summary is Talia's alone.
        N9b1FSetHouseDay(today.AddDays(7));
        var summaryUrl = $"/api/training/me/programs/{started.ProgramId}/summary";
        Assert.AreEqual(
            (Guid?)started.ProgramId,
            (await ReadSliceAsync<ClientProgramSummaryResult>(talia.Client, summaryUrl)).Program?.Id);
        await AssertStatusAsync(await corin.Client.GetAsync(summaryUrl), HttpStatusCode.NotFound);
        Assert.AreEqual(1L, await N9c1CountAsync(N9c3SDoneSetsSql, workout.Id));
    }

    // ---------- 6. the database ----------

    [TestMethod]
    public async Task N9c3SAStartIsNeverRewrittenAndNamesTheTraineesOwnProgramUnderTheirProPlusFromItsListing()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-start-guard");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-guard-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c3s-guard-corin@example.test", "Corin", "Ashgrove");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Guard Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Guard Block", squat.Id, [[0]], N9c3SDirectSet(1)));
        var listing = await N9c3SOfferAsync(house.Owner, version.TemplateId);
        var otherVersion = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Guard Other", squat.Id, [[0]], N9c3SDirectSet(1)));
        var otherListing = await N9c3SOfferAsync(house.Owner, otherVersion.TemplateId);
        var started = await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single(item => item.ListingId == listing.ListingId));
        var programId = started.ProgramId;
        Assert.AreEqual(1L, await N9c3SStartsOfAsync(talia.ProfileId));

        // Append-only.
        foreach (var sql in new[]
        {
            $"""UPDATE training."HouseProgramStarts" SET "StartDate" = "StartDate" + 1 WHERE "MesocycleId" = '{programId}'""",
            $"""DELETE FROM training."HouseProgramStarts" WHERE "MesocycleId" = '{programId}'""",
        })
        {
            var refused = await A7RefusedAsync(sql);
            Assert.AreEqual(("55000", "HouseProgramStarts is append-only"), (refused.SqlState, refused.MessageText), sql);
        }

        // A start names its trainee's own program.
        var notTheirs = await A7RefusedAsync(N9c3SCopyStartSql(programId, $"'{corin.ProfileId}'", "\"ListingId\""));
        Assert.AreEqual(
            ("23514", "A started program is the trainee's own program of that version under that plan"),
            (notTheirs.SqlState, notTheirs.MessageText));

        // A start names the list entry of its program.
        var wrongListing = await A7RefusedAsync(N9c3SCopyStartSql(programId, "\"ClientProfileId\"", $"'{otherListing.ListingId}'"));
        Assert.AreEqual(
            ("23514", "A started program names the list entry of its program"),
            (wrongListing.SqlState, wrongListing.MessageText));

        // A program the staff put under a plan without a tier is no start under Pro+. The house has no Coach, so Corin
        // waits for one (N9d1b) until the Owner takes them to coach them.
        await ReassignAsync(house.Owner, corin.ProfileId, house.OwnerUserId, null);
        var untiered = await N9b1FProductAsync(house.Owner, "N9c3S Untiered Pass", 4, 0m, null);
        var enrolled = await N9c1EnrollAsync(house.Owner, corin.ProfileId, untiered.Offers[0].Id, today, Guid.NewGuid());
        await AssertStatusAsync(enrolled, HttpStatusCode.OK);
        var corinsPlan = await ReadSlicePayloadAsync<ClientEnrollmentView>(enrolled);
        var assigned = await N9b1FAssignAsync(house.Owner, corin.ProfileId, corinsPlan.Id, version.Id, today);
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var corinsProgram = await RequiredJsonAsync<N9c3SBlock>(assigned);
        var notProPlus = await A7RefusedAsync(
            $"""
            INSERT INTO training."HouseProgramStarts"
                ("Id", "TenantId", "ClientProfileId", "MesocycleId", "ListingId", "TemplateId", "TemplateVersionId",
                 "EnrollmentId", "RunName", "RunKey", "RunPosition", "StartDate")
            SELECT gen_random_uuid(), block."TenantId", block."ClientProfileId", block."Id", '{listing.ListingId}',
                   block."SourceTemplateId", block."SourceTemplateVersionId", block."EnrollmentId", NULL, NULL, NULL, block."StartDate"
            FROM training."Mesocycles" block WHERE block."Id" = '{corinsProgram.Id}'
            """);
        Assert.AreEqual(
            ("23514", "A self-directed trainee starts a program under their own Pro+ plan"),
            (notProPlus.SqlState, notProPlus.MessageText));

        // Nothing was written, and the one start stands as it was.
        Assert.AreEqual(1L, await N9c3SStartsOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c3SStartsOfAsync(corin.ProfileId));
        Assert.AreEqual(1L, await N9c1CountAsync(
            $"""
            SELECT count(*) FROM training."HouseProgramStarts"
            WHERE "MesocycleId" = @id AND "ListingId" = '{listing.ListingId}' AND "TemplateVersionId" = '{version.Id}'
              AND "StartDate" = '{N9a1Day(today)}' AND "RunKey" IS NULL
            """,
            programId));
    }

    [TestMethod]
    public async Task N9c3SAListingIsTheHousesAloneAndOneOfferedListingHoldsARunsPlace()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-listing-guard");
        var house = space.House;
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Listing Squat", [], []);
        var first = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Run Block A", squat.Id, [[0]], N9c3SDirectSet(1)));
        var second = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Run Block B", squat.Id, [[0]], N9c3SDirectSet(1)));
        var offered = await N9c3SOfferAsync(house.Owner, first.TemplateId, "Strength  Run", 1);
        Assert.AreEqual(("Strength Run", (int?)1, true), (offered.RunName, offered.RunPosition, offered.IsOffered));

        // A coaching space that is not the house keeps no listing.
        using var coach = CreateClient();
        var coachSpace = await RegisterCoachAsync(coach, "n9c3s-listing-coach@example.test", "N9c3S Coach", "N9c3S Listing Coach");
        var coachSquat = await CreateExerciseAsync(coach, "N9c3S Coach Squat", [], []);
        var coachProgram = await PublishProgramAsync(coach, N9c3SProgram("N9c3S Coach Block", coachSquat.Id, [[0]], N9c3SDirectSet(1)));
        var notHouse = await A7RefusedAsync(N9c3SListingSql(coachSpace, coachProgram.TemplateId, null, null, null, 2.5m, true));
        Assert.AreEqual(("23514", "HouseProgramListings rows belong to the house alone"), (notHouse.SqlState, notHouse.MessageText));

        // Its checks: a place only in a named run and from 1 to 52, a step above nothing and at most 50, and whom it
        // suits. (A run named with no place is the next test's.)
        foreach (var (sql, constraint) in new[]
        {
            (N9c3SListingSql(house.TenantId, second.TemplateId, null, null, 2, 2.5m, true), "CK_HouseProgramListings_Run"),
            (N9c3SListingSql(house.TenantId, second.TemplateId, "Strength Run", "strength run", 53, 2.5m, true), "CK_HouseProgramListings_Run"),
            (N9c3SListingSql(house.TenantId, second.TemplateId, null, null, null, 0m, true), "CK_HouseProgramListings_LoadIncrement"),
            (N9c3SListingSql(house.TenantId, second.TemplateId, null, null, null, 50.5m, true), "CK_HouseProgramListings_LoadIncrement"),
            (N9c3SListingSql(house.TenantId, second.TemplateId, null, null, null, 2.5m, true, suits: "   "), "CK_HouseProgramListings_Suits"),
        })
        {
            var refused = await A7RefusedAsync(sql);
            Assert.AreEqual(("23514", constraint), (refused.SqlState, refused.ConstraintName), sql);
        }

        // One offered listing holds a run's place; a withdrawn one may share it.
        var taken = await A7RefusedAsync(N9c3SListingSql(house.TenantId, second.TemplateId, "Strength Run", "strength run", 1, 2.5m, true));
        Assert.AreEqual(("23505", "UX_HouseProgramListings_OfferedRunPlace"), (taken.SqlState, taken.ConstraintName));
        await A7SqlAsync(N9c3SListingSql(house.TenantId, second.TemplateId, "Strength Run", "strength run", 1, 2.5m, false));

        // One listing a program.
        var twice = await A7RefusedAsync(N9c3SListingSql(house.TenantId, first.TemplateId, null, null, null, 2.5m, false));
        Assert.AreEqual(("23505", "UX_HouseProgramListings_Template"), (twice.SqlState, twice.ConstraintName));
        Assert.AreEqual(2L, await A7ScalarAsync(
            $"""SELECT count(*) FROM training."HouseProgramListings" WHERE "TenantId" = '{house.TenantId}'"""));
    }

    /// <summary>
    /// SPEC.md: a listing's (and a start's) run name, key and place are null together. A run named with no place must be
    /// refused by the database as well as by the API's rule.
    /// </summary>
    [TestMethod]
    public async Task N9c3SARunNamedWithNoPlaceIsRefusedByTheDatabaseForAListingAndAStart()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-run-place");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-place-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Place Squat", [], []);
        var listed = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Place Block A", squat.Id, [[0]], N9c3SDirectSet(1)));
        var bare = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Place Block B", squat.Id, [[0]], N9c3SDirectSet(1)));
        await N9c3SOfferAsync(house.Owner, listed.TemplateId);
        var started = await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());

        // A listing whose run has a name and no place.
        var listing = await N9c3SOutcomeAsync(
            N9c3SListingSql(house.TenantId, bare.TemplateId, "Strength Run", "strength run", null, 2.5m, true));

        // A copy of the start with a run named and no place: its guard passes (the same trainee, program, plan and
        // listing), so its check answers before the unique index on the program would.
        var start = await N9c3SOutcomeAsync(
            $"""
            INSERT INTO training."HouseProgramStarts"
                ("Id", "TenantId", "ClientProfileId", "MesocycleId", "ListingId", "TemplateId", "TemplateVersionId",
                 "EnrollmentId", "RunName", "RunKey", "RunPosition", "StartDate")
            SELECT gen_random_uuid(), "TenantId", "ClientProfileId", "MesocycleId", "ListingId", "TemplateId", "TemplateVersionId",
                   "EnrollmentId", 'Strength Run', 'strength run', NULL, "StartDate"
            FROM training."HouseProgramStarts" WHERE "MesocycleId" = '{started.ProgramId}'
            """);

        Assert.AreEqual(
            ("23514 CK_HouseProgramListings_Run", "23514 CK_HouseProgramStarts_Run"),
            (listing, start),
            "A run named with no place must be refused by each table's check.");
        Assert.AreEqual(1L, await A7ScalarAsync(
            $"""SELECT count(*) FROM training."HouseProgramListings" WHERE "TenantId" = '{house.TenantId}'"""));
        Assert.AreEqual(1L, await N9c3SStartsOfAsync(talia.ProfileId));
    }

    [TestMethod]
    public async Task N9c3STwoStaffOfferingTwoProgramsAtOneRunPlaceAtOnceKeepOneAndTellTheOther()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9c3s-race", withCoach: true);
        var house = space.House;
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Race Squat", [], []);
        var first = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Race Block A", squat.Id, [[0]], N9c3SDirectSet(1)));
        var second = await PublishProgramAsync(house.Owner, N9c3SProgram("N9c3S Race Block B", squat.Id, [[0]], N9c3SDirectSet(1)));
        var body = new { suits = N9c3SSuits, runName = "Race Run", runPosition = 1 };

        // Both get past the check before either writes.
        await RefreshCsrfAsync(house.Owner);
        await RefreshCsrfAsync(house.Coach!);
        RequiredInsertBarrier.Arm("training.\"HouseProgramListings\"", 2);
        HttpResponseMessage[] answers;
        try
        {
            answers = await Task.WhenAll(
                house.Owner.PutAsJsonAsync(N9c3SListingUrl(first.TemplateId), body),
                house.Coach!.PutAsJsonAsync(N9c3SListingUrl(second.TemplateId), body));
            Assert.IsGreaterThanOrEqualTo(2, RequiredInsertBarrier.Arrived, "Both inserts were held past their checks.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            answers.Select(item => item.StatusCode).ToArray());
        var lost = answers.Single(item => item.StatusCode == HttpStatusCode.Conflict);
        Assert.AreEqual(HouseProgramCodes.PositionTaken, (await A7ConflictAsync(lost)).Code);
        Assert.AreEqual(1L, await A7ScalarAsync(
            $"""SELECT count(*) FROM training."HouseProgramListings" WHERE "TenantId" = '{house.TenantId}'"""));
    }

    // ---------- 7. the migration ----------

    [TestMethod]
    public async Task N9c3STheMigrationRevertsAndReappliesOnAnEmptyDatabase()
    {
        Assert.AreEqual(N9c3SSchemaObjects, await A7ScalarAsync(N9c3SSchemaSql));
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_HousePrograms", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        Assert.EndsWith("_HousePlanAsks", previous);
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Back: the tables, their triggers, the guard and the indexes go; the shared guards of earlier rows stay.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A7ScalarAsync(N9c3SSchemaSql));
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(2L, await A7ScalarAsync(
            """SELECT count(*) FROM pg_proc WHERE proname IN ('assert_house_row', 'reject_append_only_mutation')"""));

        // Forward again: all of it is back.
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9c3SSchemaObjects, await A7ScalarAsync(N9c3SSchemaSql));
    }

    [TestMethod]
    public async Task N9c3STheMigrationRefusesToRevertOnceATraineeHasStartedAProgram()
    {
        var today = N9b1FStartAtMidday();
        // With a house Coach, so Talia has one: the way back passes WaitingForACoach's Down first, which refuses while a
        // client waits.
        using var space = await N9c1OpenAsync("n9c3s-revert", withCoach: true);
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3s-revert-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(space, talia);
        var squat = await CreateExerciseAsync(house.Owner, "N9c3S Revert Squat", [], []);
        var version = await PublishProgramAsync(
            house.Owner,
            N9c3SProgram("N9c3S Revert Block", squat.Id, [[0, 2]], N9c3SDirectSet(1)));
        await N9c3SOfferAsync(house.Owner, version.TemplateId);
        var started = await N9c3SStartedAsync(talia.Client, (await N9c3SHouseProgramsAsync(talia.Client)).Programs.Single());

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_HousePrograms", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // A program a trainee started is a fact the schema before cannot hold: the way back stops with a plain message
        // and the migration stays applied (Npgsql retries 55000 first, each time rolled back).
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refusal = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual(
            ("55000", "Trainees started the house's programs; roll forward instead of reverting this migration."),
            (refusal.SqlState, refusal.MessageText));
        Assert.Contains("roll forward", refusal.MessageText);
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9c3SSchemaObjects, await A7ScalarAsync(N9c3SSchemaSql));

        // Nothing was lost: the start and its listing stand, and the trainee's program still runs and opens today.
        await migrator.MigrateAsync();
        Assert.AreEqual(1L, await N9c3SStartsOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await A7ScalarAsync(
            $"""SELECT count(*) FROM training."HouseProgramListings" WHERE "TenantId" = '{house.TenantId}'"""));
        Assert.AreEqual((Guid?)started.ProgramId, (await N9c3SHouseProgramsAsync(talia.Client)).Running?.ProgramId);
        var (workout, _) = await A3StartTodayAsync(talia.Client);
        Assert.AreEqual(WorkoutExecutionStatus.InProgress, workout.Status);
        Assert.AreEqual(today, started.StartDate);
    }

    // ---------- helpers ----------

    /// <summary>A program of one lift: each week's sessions on the day offsets given, each session these sets.</summary>
    private static object N9c3SProgram(string name, Guid exerciseId, int[][] weeks, params object[] sets) => new
    {
        name,
        description = "N9c3S block",
        weeks = weeks.Select((offsets, index) => new
        {
            label = $"Week {index + 1}",
            isPublished = true,
            sessions = offsets.Select(offset => new
            {
                name = $"Week {index + 1} day {offset}",
                dayOffset = offset,
                coachNotes = (string?)null,
                exercises = new[] { N6bLift(exerciseId, 1, sets) },
            }).ToArray(),
        }).ToArray(),
    };

    /// <summary>A typed 40 kg set of 5, which needs no max.</summary>
    private static object N9c3SDirectSet(int position) => P1Set(position, "Direct", rpe: null, direct: 40m);

    /// <summary>A set of 5 at 75% of the lift's training max.</summary>
    private static object N9c3SPercentSet(int position) => P1Set(position, "PercentageWorkingMax", rpe: null, percentage: 75m);

    private static string N9c3SListingUrl(Guid templateId) => $"/api/training/templates/{templateId}/house-listing";

    /// <summary>The staff offer a program to the house's trainees, in a run's place when one is given.</summary>
    private static async Task<HouseProgramListingView> N9c3SOfferAsync(
        HttpClient staff,
        Guid templateId,
        string? runName = null,
        int? runPosition = null)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PutAsJsonAsync(N9c3SListingUrl(templateId), new { suits = N9c3SSuits, runName, runPosition });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HouseProgramListingView>(response);
    }

    private static Task<HouseProgramsView> N9c3SHouseProgramsAsync(HttpClient trainee) =>
        ReadSliceAsync<HouseProgramsView>(trainee, N9c3SHouseProgramsUrl);

    /// <summary>The trainee asks to start the program as read, under a new key.</summary>
    private static async Task<HttpResponseMessage> N9c3SStartAsync(HttpClient trainee, HouseProgramView program)
    {
        await RefreshCsrfAsync(trainee);
        return await trainee.PostAsJsonAsync(
            $"{N9c3SHouseProgramsUrl}/{program.ListingId}/start",
            new { templateVersionId = program.TemplateVersionId, idempotencyKey = Guid.NewGuid() });
    }

    /// <summary>The trainee starts the program as read, under a new key.</summary>
    private static async Task<HouseProgramStartedView> N9c3SStartedAsync(HttpClient trainee, HouseProgramView program)
    {
        var response = await N9c3SStartAsync(trainee, program);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HouseProgramStartedView>(response);
    }

    /// <summary>The list entry as the trainee reads it now.</summary>
    private static async Task<HouseProgramView> N9c3SListedAsync(HttpClient trainee, Guid listingId) =>
        (await N9c3SHouseProgramsAsync(trainee)).Programs.Single(item => item.ListingId == listingId);

    /// <summary>Whether the trainee can start the entry, the code if not and the day it opens, as the read says.</summary>
    private static (bool CanStart, string? Refusal, DateOnly? OpensOn) N9c3SVerdict(HouseProgramsView read, Guid listingId)
    {
        var program = read.Programs.Single(item => item.ListingId == listingId);
        return (program.CanStart, program.Refusal, program.OpensOn);
    }

    /// <summary>
    /// The coach puts a program under a plan from the day given, shown now (TRN-023), with no training max.
    /// </summary>
    private static async Task<HttpResponseMessage> N9c3SAssignShownAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid enrollmentId,
        Guid templateVersionId,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync($"/api/training/clients/{clientProfileId}/mesocycles", new
        {
            enrollmentId,
            templateVersionId,
            startDate = N9a1Day(startDate),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = Array.Empty<object>(),
            idempotencyKey = Guid.NewGuid(),
            revealAllWeeks = true,
        });
    }

    /// <summary>
    /// A client of the staff's with a paid four-week Training plan from today and another from <paramref name="later"/>,
    /// and a program of two sessions the coach puts under the later plan from its first day, shown now: the program's id
    /// and what the client's Upcoming reads.
    /// </summary>
    private static async Task<(Guid ProgramId, ClientTrainingUpcomingView Upcoming)> N9c3SLaterProgramAsync(
        HttpClient owner,
        HttpClient coach,
        HttpClient client,
        Guid clientProfileId,
        DateOnly today,
        DateOnly later,
        string tag)
    {
        var plan = await N9b1FProductAsync(owner, $"{tag} Plan", 4, 30m, null);
        var now = await A7EnrollAsync(owner, clientProfileId, plan.Offers[0].Id, today);
        await A7PayAsync(owner, now.Id, 30m, today, Guid.NewGuid());
        var next = await A7EnrollAsync(owner, clientProfileId, plan.Offers[0].Id, later);
        await A7PayAsync(owner, next.Id, 30m, today, Guid.NewGuid());
        var squat = await CreateExerciseAsync(owner, $"{tag} Squat", [], []);
        var version = await PublishProgramAsync(owner, N9c3SProgram($"{tag} Block", squat.Id, [[0, 2]], N9c3SDirectSet(1)));
        var assigned = await N9c3SAssignShownAsync(coach, clientProfileId, next.Id, version.Id, later);
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var program = await RequiredJsonAsync<N9c3SBlock>(assigned);
        return (program.Id, await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming"));
    }

    /// <summary>What Upcoming says of a program still to begin, ids left out so two spaces compare.</summary>
    private static (bool HasProgram, bool HasVisibleSessions, DateOnly? NextDate, string? NextName, TodayTrainingCoverageView? Coverage)
        N9c3SUpcomingShape(ClientTrainingUpcomingView upcoming) =>
        (upcoming.HasAssignedProgram, upcoming.HasVisibleSessions, upcoming.NextSession?.Date, upcoming.NextSession?.Name,
         upcoming.TodayCoverage);

    /// <summary>"62.5x5 65x4": each set last time shows for a lift, its weight and reps, in set order.</summary>
    private static string N9c3SLastTime(PreviousExercisePerformanceView? previous) =>
        previous?.Sets is null
            ? "none"
            : string.Join(' ', previous.Sets.Select(set =>
                $"{set.Load?.ToString("0.##", CultureInfo.InvariantCulture)}x{set.Repetitions}"));

    /// <summary>The trainee types their own training max for a lift (STR-021).</summary>
    private static async Task N9c3STypeMaxAsync(HttpClient trainee, Guid exerciseId, decimal value)
    {
        await RefreshCsrfAsync(trainee);
        await AssertStatusAsync(
            await trainee.PostAsJsonAsync("/api/strength/me/maxes", new { exerciseId, value, unit = "Kilogram" }),
            HttpStatusCode.OK);
    }

    private static async Task<HttpResponseMessage> N9c3SSessionAsync(HttpClient client, Guid sessionId)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsync($"/api/training/me/sessions/{sessionId}/start", null);
    }

    /// <summary>The sessions of the program the client's Training page describes, in date order.</summary>
    private static async Task<ClientProgramSessionView[]> N9c3SSessionsAsync(HttpClient client)
    {
        var read = await ReadSliceAsync<ClientTrainingProgramView>(client, N9c3SProgramUrl);
        Assert.IsNotNull(read.Program, "The Training page describes a program.");
        return [.. read.Program.Weeks.SelectMany(week => week.Sessions).OrderBy(item => item.ScheduledDate)];
    }

    /// <summary>"0:False 2:True": each session's day from the program's first, with whether it may start early.</summary>
    private static string N9c3SEarly(IEnumerable<ClientProgramSessionView> sessions, DateOnly programStart) =>
        string.Join(' ', sessions.Select(item => $"{item.ScheduledDate.DayNumber - programStart.DayNumber}:{item.CanStartEarly}"));

    /// <summary>The staff pause, resume or cancel a plan of the client's, at the version their page reads.</summary>
    private static async Task N9c3SStatusAsync(HttpClient staff, Guid clientProfileId, Guid enrollmentId, string change)
    {
        var plan = (await ReadSliceAsync<ClientCommercialOverview>(staff, $"/api/commercial/clients/{clientProfileId}"))
            .Enrollments.Single(item => item.Id == enrollmentId);
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollmentId}/{change}",
            new { reason = $"N9c3S {change}", version = plan.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
    }

    /// <summary>A free Training plan that covers beside another, from the day given.</summary>
    private static async Task N9c3SBesidePlanAsync(HttpClient coach, Guid clientProfileId, DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var product = await coach.PostAsJsonAsync(A7ProductsUrl, new
        {
            name = "N9c3S Beside Plan",
            description = (string?)null,
            initialOffer = new
            {
                label = "8 weeks",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = new[] { new { feature = "Training", allowsConcurrentCoverage = true } },
            },
        });
        await AssertStatusAsync(product, HttpStatusCode.OK);
        var offerId = (await ReadSlicePayloadAsync<CoachingProductView>(product)).Offers[0].Id;
        await AssertStatusAsync(
            await N9c1EnrollAsync(coach, clientProfileId, offerId, startDate, Guid.NewGuid()),
            HttpStatusCode.OK);
    }

    /// <summary>A copy of a start's row under a new id, with the trainee and the listing given as SQL.</summary>
    private static string N9c3SCopyStartSql(Guid programId, string clientProfileId, string listingId) =>
        $"""
        INSERT INTO training."HouseProgramStarts"
            ("Id", "TenantId", "ClientProfileId", "MesocycleId", "ListingId", "TemplateId", "TemplateVersionId",
             "EnrollmentId", "RunName", "RunKey", "RunPosition", "StartDate")
        SELECT gen_random_uuid(), "TenantId", {clientProfileId}, "MesocycleId", {listingId}, "TemplateId", "TemplateVersionId",
               "EnrollmentId", "RunName", "RunKey", "RunPosition", "StartDate"
        FROM training."HouseProgramStarts" WHERE "MesocycleId" = '{programId}'
        """;

    /// <summary>A listing's row, written past the API.</summary>
    private static string N9c3SListingSql(
        Guid tenantId,
        Guid templateId,
        string? runName,
        string? runKey,
        int? runPosition,
        decimal loadIncrement,
        bool offered,
        string suits = N9c3SSuits) =>
        $"""
        INSERT INTO training."HouseProgramListings"
            ("Id", "TenantId", "TemplateId", "Suits", "RunName", "RunKey", "RunPosition", "LoadIncrement", "LoadRoundingMode", "IsOffered")
        VALUES (gen_random_uuid(), '{tenantId}', '{templateId}', '{suits}', {N9c3SText(runName)}, {N9c3SText(runKey)},
                {(runPosition is null ? "NULL" : runPosition.Value.ToString(CultureInfo.InvariantCulture))},
                {loadIncrement.ToString(CultureInfo.InvariantCulture)}, 'Nearest', {(offered ? "true" : "false")})
        """;

    private static string N9c3SText(string? value) => value is null ? "NULL" : $"'{value}'";

    /// <summary>"23514 CK_Name" for a statement PostgreSQL refuses, "written" for one it keeps.</summary>
    private async Task<string> N9c3SOutcomeAsync(string sql)
    {
        try
        {
            await A7SqlAsync(sql);
            return "written";
        }
        catch (PostgresException refused)
        {
            return $"{refused.SqlState} {refused.ConstraintName ?? refused.MessageText}";
        }
    }

    private Task<long> N9c3SStartsOfAsync(Guid clientProfileId) => N9c1CountAsync(
        """SELECT count(*) FROM training."HouseProgramStarts" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    private sealed record N9c3SBlock(Guid Id);
}
