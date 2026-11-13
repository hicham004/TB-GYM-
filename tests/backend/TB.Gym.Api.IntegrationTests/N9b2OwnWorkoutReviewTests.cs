using System.Net;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b2 after its review (TRN-033): a note and a removal racing on one exercise answer a conflict, never
/// a server error; ten workouts of one's own a house day; a finished workout with no exercise has nothing to start from;
/// and the house keeps its mark while it holds a workout of one's own. Every name and figure here is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>
    /// TRN-033 with TRN-009: a note written on an exercise between the removal's read and its write holds the exercise,
    /// so the removal answers 409 own_exercise_has_note (the race made certain by a trigger of this test's database).
    /// </summary>
    [TestMethod]
    public async Task N9b2RANoteWrittenWhileItsExerciseIsTakenAwayKeepsTheExerciseWithAConflict()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2r-race", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2r-race-dana@example.test", "Dana", "Rizk", address: "203.0.113.171");
        var client = trainee.Client;
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        workout = await N9b2AOkAsync<OwnWorkoutView>(
            N9b2AAddExerciseAsync(client, workout.WorkoutExecutionId, library.Squat.Id, workout.Version));
        var squat = workout.Exercises.Single().PerformanceId;

        await Phase6ExecuteAsync(
            $$"""
            CREATE FUNCTION training.n9b2r_note_meanwhile() RETURNS trigger AS $body$
            BEGIN
                INSERT INTO training."WorkoutNotes"
                    ("Id", "TenantId", "WorkoutExecutionId", "WorkoutExercisePerformanceId", "AuthorUserId", "AuthorRole", "Text")
                VALUES (gen_random_uuid(), OLD."TenantId", OLD."WorkoutExecutionId", OLD."Id",
                    '{{trainee.UserId}}', 'Client', 'Written in another tab');
                RETURN OLD;
            END;
            $body$ LANGUAGE plpgsql;
            CREATE TRIGGER "TR_ZZ_N9b2RNoteMeanwhile" BEFORE DELETE ON training."WorkoutExercisePerformances"
            FOR EACH ROW EXECUTE FUNCTION training.n9b2r_note_meanwhile();
            """);
        var refused = await N9b2ARemoveExerciseAsync(client, workout.WorkoutExecutionId, squat, workout.Version);
        Assert.AreEqual(
            ("own_exercise_has_note", "This exercise has a note, so it stays in this workout."),
            await A7ConflictAsync(refused));
        await Phase6ExecuteAsync(
            """
            DROP TRIGGER "TR_ZZ_N9b2RNoteMeanwhile" ON training."WorkoutExercisePerformances";
            DROP FUNCTION training.n9b2r_note_meanwhile();
            """);

        // Nothing of the refused removal stays: the exercise is there, with no note, at the version it had.
        var after = await N9b2ACarryOnAsync(client);
        Assert.AreEqual((1, squat, workout.Version), (after.Exercises.Count, after.Exercises[0].PerformanceId, after.Version));
        Assert.IsEmpty(after.Notes);
    }

    /// <summary>
    /// TRN-033 with TRN-009: an exercise taken away between a note's read and its write leaves the note nothing to name,
    /// so the note answers 400 on exercisePerformanceId and stores nothing (the race made certain by a trigger).
    /// </summary>
    [TestMethod]
    public async Task N9b2RANoteOnAnExerciseTakenAwayMeanwhileIsRefusedWithItsField()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2r-gone", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2r-gone-karim@example.test", "Karim", "Nassar", address: "203.0.113.172");
        var client = trainee.Client;
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        workout = await N9b2AOkAsync<OwnWorkoutView>(
            N9b2AAddExerciseAsync(client, workout.WorkoutExecutionId, library.Raise.Id, workout.Version));
        var raise = workout.Exercises.Single().PerformanceId;

        await Phase6ExecuteAsync(
            """
            CREATE FUNCTION training.n9b2r_gone_meanwhile() RETURNS trigger AS $body$
            BEGIN
                DELETE FROM training."WorkoutExercisePerformances" WHERE "Id" = NEW."WorkoutExercisePerformanceId";
                RETURN NEW;
            END;
            $body$ LANGUAGE plpgsql;
            CREATE TRIGGER "TR_ZZ_N9b2RGoneMeanwhile" BEFORE INSERT ON training."WorkoutNotes"
            FOR EACH ROW WHEN (NEW."WorkoutExercisePerformanceId" IS NOT NULL)
            EXECUTE FUNCTION training.n9b2r_gone_meanwhile();
            """);
        var refused = await N9b2ANoteAsync(client, workout.WorkoutExecutionId, raise, "Felt this in my shoulder");
        Assert.AreEqual(
            "The exercise does not belong to this workout.",
            await A7FieldErrorAsync(refused, "exercisePerformanceId"));
        await Phase6ExecuteAsync(
            """
            DROP TRIGGER "TR_ZZ_N9b2RGoneMeanwhile" ON training."WorkoutNotes";
            DROP FUNCTION training.n9b2r_gone_meanwhile();
            """);

        // The refused note took the exercise's removal back with it: the exercise is there and holds no note.
        var after = await N9b2ACarryOnAsync(client);
        Assert.AreEqual((1, raise), (after.Exercises.Count, after.Exercises[0].PerformanceId));
        Assert.IsEmpty(after.Notes);
    }

    /// <summary>
    /// TRN-033's day cap: ten workouts of one's own started on one of the house's days, finished or not, and the
    /// eleventh answers 409 own_workout_daily_limit; the next house day opens again.
    /// </summary>
    [TestMethod]
    public async Task N9b2RTenWorkoutsOfOnesOwnStartOnOneHouseDayAndTheNextDayOpensAgain()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2r-ten", withCoach: true);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2r-ten-hala@example.test", "Hala", "Saad", address: "203.0.113.173");
        var client = trainee.Client;
        for (var count = 0; count < OwnWorkoutRule.MaximumStartedPerDay; count++)
        {
            var started = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
            await AssertStatusAsync(
                await N9b2AFinishAsync(client, started.WorkoutExecutionId, started.Version),
                HttpStatusCode.OK);
        }

        Assert.AreEqual(
            ("own_workout_daily_limit", "You have started 10 workouts today, the most one day holds. Start the next one tomorrow."),
            await A7ConflictAsync(await N9b2AStartAsync(client)));
        Assert.AreEqual(10L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id AND "TrainingSessionId" IS NULL""",
            trainee.ProfileId));

        N9b1FSetHouseDay(today.AddDays(1));
        var tomorrow = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        Assert.AreEqual(today.AddDays(1), tomorrow.Date);
    }

    /// <summary>
    /// TRN-033: a workout finished with no exercise in it has nothing to start from, and says so in its own words
    /// rather than claiming its exercises left the pool.
    /// </summary>
    [TestMethod]
    public async Task N9b2RAFinishedWorkoutWithNoExerciseHasNothingToStartFrom()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2r-empty", withCoach: true);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2r-empty-nour@example.test", "Nour", "Khalil", address: "203.0.113.174");
        var client = trainee.Client;
        var empty = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        await AssertStatusAsync(await N9b2AFinishAsync(client, empty.WorkoutExecutionId, empty.Version), HttpStatusCode.OK);

        Assert.AreEqual(
            ("own_workout_nothing_to_copy", "That workout has no exercises to start from."),
            await A7ConflictAsync(await N9b2AStartAsync(client, empty.WorkoutExecutionId)));
        Assert.IsNull((await N9b2ATodayAsync(client)).OwnWorkout);
    }

    /// <summary>
    /// CLI-022 with TRN-033: a client the house invited (not self-directed, no plan of the house's tiers, no sign-up)
    /// who logged a workout of their own keeps the mark on the house; `house clear` refuses and says why.
    /// </summary>
    [TestMethod]
    public async Task N9b2RTheHouseKeepsItsMarkWhileItHoldsAWorkoutOfOnesOwn()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2r-mark", withCoach: true);
        using var rana = CreateClient();
        var ranaId = await R31InviteAsync(house.Coach!, rana, house.TenantId, "n9b2r-mark-rana@example.test", "Rana", "Haddad");
        var training = await CreateTrainingResourcesAsync(house.Owner, ranaId, 8, 1, today);
        await AssignAsync(house.Owner, ranaId, training, today);
        var hers = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(rana));

        var (code, said) = await N9a1HouseCommandAsync("clear");
        Assert.AreEqual(2, code, said);
        StringAssert.Contains(said, "holds workouts its clients logged on their own and keeps its mark.");
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM tenancy."Tenants" WHERE "Id" = @id AND "IsHouse" """,
            house.TenantId));
        Assert.AreEqual(hers.WorkoutExecutionId, (await N9b2ACarryOnAsync(rana)).WorkoutExecutionId);
    }
}
