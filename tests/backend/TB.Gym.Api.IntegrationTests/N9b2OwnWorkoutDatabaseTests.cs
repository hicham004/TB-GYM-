using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b2, a workout of one's own (TRN-033), at the database: while one runs, a set of it goes by itself
/// and an exercise of it goes with its sets, and once it is finished neither does (TRN-012); its workout row never
/// goes and never takes a program or a session; a program's workout, running or finished, keeps every row and its
/// session; the workout triggers refuse an exercise or set of the other shape (23514), and the three checks a crafted
/// row of each table; one unfinished workout of one's own a client (TRN-008), beside finished ones and a program's
/// running workout; and the migration, which reverts over program workouts and refuses once a workout of one's own
/// exists. Own workouts are made through their routes by a trainee of the house, program workouts by a coach's client.
/// Every name and address here is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b2DDeleteWorkoutSql = """DELETE FROM training."WorkoutExecutions" WHERE "Id" = @id""";

    private const string N9b2DDeleteExerciseSql = """DELETE FROM training."WorkoutExercisePerformances" WHERE "Id" = @id""";

    private const string N9b2DDeleteSetSql = """DELETE FROM training."WorkoutSetPerformances" WHERE "Id" = @id""";

    private const string N9b2DWorkoutRowSql = """SELECT count(*) FROM training."WorkoutExecutions" WHERE "Id" = @id""";

    private const string N9b2DExerciseRowSql = """SELECT count(*) FROM training."WorkoutExercisePerformances" WHERE "Id" = @id""";

    private const string N9b2DSetRowSql = """SELECT count(*) FROM training."WorkoutSetPerformances" WHERE "Id" = @id""";

    private const string N9b2DSetsOfExerciseSql =
        """SELECT count(*) FROM training."WorkoutSetPerformances" WHERE "WorkoutExercisePerformanceId" = @id""";

    private const string N9b2DExerciseWords =
        "A workout of one's own takes only exercises of its own, and a program's workout only prescribed ones";

    private const string N9b2DSetWords =
        "A workout of one's own takes only sets of its own, and a program's workout only prescribed ones";

    /// <summary>
    /// What the migration adds: the four columns nullable, the three checks, the partial index, and in both trigger
    /// functions the refusal of the other shape (23514) and the delete that lets a row go (RETURN OLD).
    /// </summary>
    private const string N9b2DSchemaSql =
        """
        SELECT
            (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'training' AND is_nullable = 'YES'
               AND ((table_name = 'WorkoutExecutions' AND column_name IN ('MesocycleId', 'TrainingSessionId'))
                 OR (table_name = 'WorkoutExercisePerformances' AND column_name = 'ExercisePrescriptionId')
                 OR (table_name = 'WorkoutSetPerformances' AND column_name = 'SetPrescriptionId')))
          + (SELECT count(*) FROM pg_constraint
             WHERE conname IN ('CK_WorkoutExecutions_ProgramOrOwn', 'CK_WorkoutExercisePerformances_OwnIsItsOwnPrescription',
                               'CK_WorkoutSetPerformances_OwnHasNothingPrescribed'))
          + (SELECT count(*) FROM pg_indexes WHERE schemaname = 'training' AND indexname = 'UX_WorkoutExecutions_OneOwnInProgress')
          + (SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
             WHERE n.nspname = 'training' AND p.proname IN ('protect_workout_exercise', 'protect_workout_set')
               AND p.prosrc LIKE '%23514%')
          + (SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
             WHERE n.nspname = 'training' AND p.proname IN ('protect_workout_exercise', 'protect_workout_set')
               AND p.prosrc LIKE '%RETURN OLD%')
        """;

    private const long N9b2DSchemaObjects = 12;

    /// <summary>The four id columns the migration makes nullable, counted while they are NOT NULL.</summary>
    private const string N9b2DRequiredColumnsSql =
        """
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'training' AND is_nullable = 'NO'
          AND ((table_name = 'WorkoutExecutions' AND column_name IN ('MesocycleId', 'TrainingSessionId'))
            OR (table_name = 'WorkoutExercisePerformances' AND column_name = 'ExercisePrescriptionId')
            OR (table_name = 'WorkoutSetPerformances' AND column_name = 'SetPrescriptionId'))
        """;

    /// <summary>The exercise and set functions as they were before the migration: any delete is refused on its first test.</summary>
    private const string N9b2DEarlierGuardsSql =
        """
        SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'training' AND p.proname IN ('protect_workout_exercise', 'protect_workout_set')
          AND p.prosrc LIKE '%IF TG_OP = ''DELETE'' OR execution_status = ''Completed'' THEN%'
        """;

    /// <summary>The three workout guard functions and their three triggers, whichever way the migration stands.</summary>
    private const string N9b2DGuardsSql =
        """
        SELECT
            (SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
             WHERE n.nspname = 'training'
               AND p.proname IN ('protect_workout_execution', 'protect_workout_exercise', 'protect_workout_set'))
          + (SELECT count(*) FROM pg_trigger
             WHERE NOT tgisinternal
               AND tgname IN ('TR_WorkoutExecutions_ProtectHistory', 'TR_WorkoutExercisePerformances_ProtectHistory',
                              'TR_WorkoutSetPerformances_ProtectHistory'))
        """;

    /// <summary>
    /// TRN-033 and TRN-012 at the database: while a workout of one's own runs, a set of it goes by itself and an exercise
    /// of it goes with its sets; once it is finished neither goes; its workout row never goes and never takes a program
    /// or a session.
    /// </summary>
    [TestMethod]
    public async Task N9b2DAnOwnWorkoutsSetAndExerciseGoWhileItRunsAndNothingOfItGoesOnceItIsFinished()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2d-rows", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b2d-rows-dalia@example.test", address: "203.0.113.141");
        var workout = await N9b2DOwnWorkoutAsync(trainee.Client, (library.Squat.Id, 3), (library.Hold.Id, 2));
        var (squat, hold) = (workout.Exercises[0], workout.Exercises[1]);
        Assert.AreEqual((2L, 5L), await N9b2DRowsOfAsync(workout.WorkoutExecutionId));

        // While it runs, a set of its own goes by itself, and an exercise of its own goes with its sets.
        await Phase6ExecuteAsync(N9b2DDeleteSetSql, ("id", squat.Sets[2].PerformanceId));
        Assert.AreEqual(0L, await Phase6CountAsync(RequiredDatabaseConnection, N9b2DSetRowSql, squat.Sets[2].PerformanceId));
        await Phase6ExecuteAsync(N9b2DDeleteExerciseSql, ("id", hold.PerformanceId));
        Assert.AreEqual(
            (0L, 0L),
            (await Phase6CountAsync(RequiredDatabaseConnection, N9b2DExerciseRowSql, hold.PerformanceId),
                await Phase6CountAsync(RequiredDatabaseConnection, N9b2DSetsOfExerciseSql, hold.PerformanceId)));
        Assert.AreEqual((1L, 2L), await N9b2DRowsOfAsync(workout.WorkoutExecutionId));

        // The workout row itself never goes, and never takes a program or a session.
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteWorkoutSql, workout.WorkoutExecutionId, "Workout executions cannot be deleted");
        await N9b2DAssertGuardRefusesAsync(
            """UPDATE training."WorkoutExecutions" SET "MesocycleId" = gen_random_uuid() WHERE "Id" = @id""",
            workout.WorkoutExecutionId,
            "Workout prescription snapshots are immutable");
        await N9b2DAssertGuardRefusesAsync(
            """UPDATE training."WorkoutExecutions" SET "TrainingSessionId" = gen_random_uuid() WHERE "Id" = @id""",
            workout.WorkoutExecutionId,
            "Workout prescription snapshots are immutable");
        Assert.AreEqual(1L, await Phase6CountAsync(RequiredDatabaseConnection, N9b2DWorkoutRowSql, workout.WorkoutExecutionId));

        // Finished through its route, with one set logged and one not.
        var saved = await A3LogAsync(trainee.Client, workout.WorkoutExecutionId, squat.Sets[0].PerformanceId, 5, 100m, 8m, workout.Version);
        var finished = await A3FinishAsync(trainee.Client, workout.WorkoutExecutionId, saved.ExecutionVersion);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, finished.Status);

        // Once it is finished no row of it goes, logged or not, and the workout keeps its shape.
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteSetSql, squat.Sets[1].PerformanceId, "Workout set history is immutable");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteSetSql, squat.Sets[0].PerformanceId, "Workout set history is immutable");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteExerciseSql, squat.PerformanceId, "Workout exercise history is immutable");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteWorkoutSql, workout.WorkoutExecutionId, "Workout executions cannot be deleted");
        await N9b2DAssertGuardRefusesAsync(
            """UPDATE training."WorkoutExecutions" SET "MesocycleId" = gen_random_uuid() WHERE "Id" = @id""",
            workout.WorkoutExecutionId,
            "Completed workout history is immutable");

        // Nor does a row of its own shape go into it: finished history comes before the shape.
        var intoFinished = await N9a1RefusedBySqlAsync(N6aCopySql("WorkoutExercisePerformances", squat.PerformanceId, 10, string.Empty));
        Assert.AreEqual(("55000", "Workout exercise history is immutable"), (intoFinished.SqlState, intoFinished.MessageText));
        intoFinished = await N9a1RefusedBySqlAsync(N6aCopySql("WorkoutSetPerformances", squat.Sets[1].PerformanceId, 10, string.Empty));
        Assert.AreEqual(("55000", "Workout set history is immutable"), (intoFinished.SqlState, intoFinished.MessageText));
        Assert.AreEqual((1L, 2L), await N9b2DRowsOfAsync(workout.WorkoutExecutionId));
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."WorkoutExecutions"
                WHERE "Id" = @id AND "MesocycleId" IS NULL AND "TrainingSessionId" IS NULL AND "Status" = 'Completed'
                """,
                workout.WorkoutExecutionId));
    }

    /// <summary>
    /// TRN-012 and TRN-033 at the database: a program's workout, running or finished, keeps every set, exercise and the
    /// workout itself, and never loses its session or becomes a workout of one's own.
    /// </summary>
    [TestMethod]
    public async Task N9b2DAProgramsWorkoutKeepsEveryRowAndItsSessionRunningOrFinished()
    {
        var today = N9b1FStartAtMidday();
        using var program = await N9b2DProgramWorkoutAsync("n9b2d-program", today);

        await N9b2DAssertProgramWorkoutKeptAsync(program, "Workout prescription snapshots are immutable");
        var finished = await A3FinishAsync(program.Client, program.WorkoutId, program.Version);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, finished.Status);
        await N9b2DAssertProgramWorkoutKeptAsync(program, "Completed workout history is immutable");
    }

    /// <summary>
    /// TRN-033 at the database: the workout triggers refuse an exercise or a set of the other shape, one of one's own in
    /// a program's workout or a prescribed one in a workout of one's own, with 23514 and their own words, while a copy
    /// of either shape where it belongs is taken.
    /// </summary>
    [TestMethod]
    public async Task N9b2DTheWorkoutTriggersRefuseAnExerciseOrSetOfTheOtherShape()
    {
        using var shapes = await N9b2DBothShapesAsync("n9b2d-shape");
        var (squat, squatSet) = (shapes.Own.Exercises[0], shapes.Own.Exercises[0].Sets[0].PerformanceId);
        var before = await N9b2DAllRowsAsync();

        foreach (var (sql, words) in new[]
        {
            // An exercise of one's own put into the program's workout, or the program's lift stripped of its prescription.
            (N6aCopySql("WorkoutExercisePerformances", squat.PerformanceId, 10, $"r.\"WorkoutExecutionId\" := '{shapes.ProgramWorkoutId}';"), N9b2DExerciseWords),
            (N6aCopySql("WorkoutExercisePerformances", shapes.ProgramExerciseId, 10, "r.\"ExercisePrescriptionId\" := NULL;"), N9b2DExerciseWords),
            // A prescribed exercise put into the workout of one's own, or one of its own exercises given a prescription.
            (N6aCopySql("WorkoutExercisePerformances", shapes.ProgramExerciseId, 10, $"r.\"WorkoutExecutionId\" := '{shapes.Own.WorkoutExecutionId}';"), N9b2DExerciseWords),
            (N6aCopySql("WorkoutExercisePerformances", squat.PerformanceId, 10, "r.\"ExercisePrescriptionId\" := gen_random_uuid();"), N9b2DExerciseWords),
            // The same for sets: one of one's own under the program's exercise, or the program's set without its prescription.
            (N6aCopySql("WorkoutSetPerformances", squatSet, 10, $"r.\"WorkoutExercisePerformanceId\" := '{shapes.ProgramExerciseId}';"), N9b2DSetWords),
            (N6aCopySql("WorkoutSetPerformances", shapes.ProgramSetId, 10, "r.\"SetPrescriptionId\" := NULL;"), N9b2DSetWords),
            // A prescribed set under the exercise of one's own, or a set of one's own given a prescription.
            (N6aCopySql("WorkoutSetPerformances", shapes.ProgramSetId, 10, $"r.\"WorkoutExercisePerformanceId\" := '{squat.PerformanceId}';"), N9b2DSetWords),
            (N6aCopySql("WorkoutSetPerformances", squatSet, 10, "r.\"SetPrescriptionId\" := gen_random_uuid();"), N9b2DSetWords),
        })
        {
            var refused = await N9a1RefusedBySqlAsync(sql);
            Assert.AreEqual(("23514", words, (string?)null), (refused.SqlState, refused.MessageText, refused.ConstraintName), sql);
        }

        Assert.AreEqual(before, await N9b2DAllRowsAsync());

        // A copy of either shape where it belongs is taken: it was the shape that was refused.
        await Phase6ExecuteAsync(N6aCopySql("WorkoutExercisePerformances", squat.PerformanceId, 20, string.Empty));
        await Phase6ExecuteAsync(N6aCopySql("WorkoutExercisePerformances", shapes.ProgramExerciseId, 20, string.Empty));
        await Phase6ExecuteAsync(N6aCopySql("WorkoutSetPerformances", squatSet, 20, string.Empty));
        await Phase6ExecuteAsync(N6aCopySql("WorkoutSetPerformances", shapes.ProgramSetId, 20, string.Empty));
        Assert.AreEqual((before.Exercises + 2, before.Sets + 2), await N9b2DAllRowsAsync());
    }

    /// <summary>
    /// TRN-033 at the database: the three checks each refuse a crafted row that passes the triggers, with 23514 and the
    /// check's name: a workout with one of program and session but not the other, or with neither but a coach's note or
    /// a prescription version; an exercise of one's own that is not its own locked prescription; and a set of one's own
    /// holding anything prescribed or worked out, column by column.
    /// </summary>
    [TestMethod]
    public async Task N9b2DTheThreeChecksRefuseACraftedRowOfEachTable()
    {
        using var shapes = await N9b2DBothShapesAsync("n9b2d-checks");
        var (own, squat, holdId) = (shapes.Own, shapes.Own.Exercises[0], shapes.Own.Exercises[1].ExerciseId);
        var squatSet = squat.Sets[0].PerformanceId;
        var workoutsBefore = await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutExecutions" """);
        var rowsBefore = await N9b2DAllRowsAsync();

        foreach (var (workoutId, change) in new[]
        {
            (shapes.ProgramWorkoutId, "r.\"TrainingSessionId\" := NULL;"),
            (shapes.ProgramWorkoutId, "r.\"MesocycleId\" := NULL;"),
            (own.WorkoutExecutionId, $"r.\"MesocycleId\" := '{shapes.ProgramMesocycleId}';"),
            (own.WorkoutExecutionId, "r.\"SessionCoachNotesSnapshot\" := 'Brace before every rep.';"),
            (own.WorkoutExecutionId, "r.\"PrescriptionVersionSnapshot\" := 1;"),
        })
        {
            await N10bAssertRefusedByAsync("23514", "CK_WorkoutExecutions_ProgramOrOwn", N9b2DCopyWorkoutSql(workoutId, change));
        }

        foreach (var change in new[]
        {
            "r.\"ModificationPolicySnapshot\" := 'CoachApprovedSwap';",
            "r.\"IsMainLiftSnapshot\" := true;",
            "r.\"CoachNotesSnapshot\" := 'Controlled technique.';",
            $"r.\"WasSubstituted\" := true; r.\"ActualExerciseId\" := '{holdId}'; r.\"ModificationPolicySnapshot\" := 'CoachApprovedSwap';",
        })
        {
            await N10bAssertRefusedByAsync(
                "23514",
                "CK_WorkoutExercisePerformances_OwnIsItsOwnPrescription",
                N6aCopySql("WorkoutExercisePerformances", squat.PerformanceId, 10, change));
        }

        foreach (var change in new[]
        {
            "r.\"PrescribedRepetitionsMinimum\" := 5;",
            "r.\"PrescribedRepetitionsMaximum\" := 5;",
            "r.\"PrescribedLoad\" := 100;",
            "r.\"PrescribedLoadUnit\" := 'Kilogram';",
            "r.\"LoadStrategySnapshot\" := 'Direct';",
            "r.\"LoadStrategySnapshot\" := 'LastTimeStep'; r.\"PrescribedLoadStep\" := 2.5; r.\"PrescribedLoadUnit\" := 'Kilogram';",
            "r.\"PrescribedTargetRpe\" := 8;",
            "r.\"PrescribedRestSeconds\" := 120;",
            "r.\"PrescribedTempo\" := '3-1-1';",
            "r.\"CoachNotesSnapshot\" := 'Crisp reps';",
            "r.\"CalculationStrategyKeySnapshot\" := 'CoachDirect';",
            "r.\"CalculationStrategyVersionSnapshot\" := '1.0';",
            "r.\"UnroundedRecommendedLoadSnapshot\" := 101.25;",
        })
        {
            await N10bAssertRefusedByAsync(
                "23514",
                "CK_WorkoutSetPerformances_OwnHasNothingPrescribed",
                N6aCopySql("WorkoutSetPerformances", squatSet, 10, change));
        }

        Assert.AreEqual(workoutsBefore, await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutExecutions" """));
        Assert.AreEqual(rowsBefore, await N9b2DAllRowsAsync());

        // The same copies with nothing changed are taken (a finished copy of the workout, beside the running one).
        await Phase6ExecuteAsync(N9b2DCopyWorkoutSql(
            own.WorkoutExecutionId,
            "r.\"Status\" := 'Completed'; r.\"CompletedAtUtc\" := r.\"StartedAtUtc\";"));
        await Phase6ExecuteAsync(N6aCopySql("WorkoutExercisePerformances", squat.PerformanceId, 10, string.Empty));
        await Phase6ExecuteAsync(N6aCopySql("WorkoutSetPerformances", squatSet, 10, string.Empty));
        Assert.AreEqual(workoutsBefore + 1, await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutExecutions" """));
        Assert.AreEqual((rowsBefore.Exercises + 1, rowsBefore.Sets + 1), await N9b2DAllRowsAsync());
    }

    /// <summary>
    /// TRN-008 and TRN-033 at the database: a client holds one unfinished workout of their own at a time, the partial
    /// unique index refusing a second (23505), while their finished ones, a program's running workout and another
    /// client's unfinished one sit beside it.
    /// </summary>
    [TestMethod]
    public async Task N9b2DAClientHoldsOneUnfinishedOwnWorkoutBesideFinishedOnesAndAProgramsRunningWorkout()
    {
        // The workout of one's own was started through its route while the program's workout ran.
        using var shapes = await N9b2DBothShapesAsync("n9b2d-one");
        var (trainee, first) = (shapes.Trainee, shapes.Own);
        Assert.AreEqual((1L, 1L, 0L), await N9b2DWorkoutsOfAsync(trainee.ProfileId));

        // A second unfinished one for the same client is refused.
        await N10bAssertRefusedByAsync(
            "23505", "UX_WorkoutExecutions_OneOwnInProgress", N9b2DCopyWorkoutSql(first.WorkoutExecutionId, string.Empty));

        // Finished, it no longer counts: a finished copy is taken beside it, and so is the next one started.
        var saved = await A3LogAsync(trainee.Client, first.WorkoutExecutionId, first.Exercises[0].Sets[0].PerformanceId, 5, 100m, 8m, first.Version);
        await A3FinishAsync(trainee.Client, first.WorkoutExecutionId, saved.ExecutionVersion);
        await Phase6ExecuteAsync(N9b2DCopyWorkoutSql(first.WorkoutExecutionId, string.Empty));
        var second = await N9b2DOwnWorkoutAsync(trainee.Client);
        Assert.AreEqual((1L, 1L, 2L), await N9b2DWorkoutsOfAsync(trainee.ProfileId));
        await N10bAssertRefusedByAsync(
            "23505", "UX_WorkoutExecutions_OneOwnInProgress", N9b2DCopyWorkoutSql(second.WorkoutExecutionId, string.Empty));

        // The rule is one a client: another trainee of the house starts theirs while this one's runs.
        using var other = await N9a1TraineeAsync(
            shapes.House.TenantId, "n9b2d-one-rami@example.test", "Rami", "Saad", address: "198.51.100.151");
        await N9b2DOwnWorkoutAsync(other.Client);
        Assert.AreEqual((0L, 1L, 0L), await N9b2DWorkoutsOfAsync(other.ProfileId));
        Assert.AreEqual((1L, 1L, 2L), await N9b2DWorkoutsOfAsync(trainee.ProfileId));
    }

    /// <summary>
    /// The N9b2 migration: with program workouts alone it reverts, making the four columns NOT NULL again, dropping the
    /// checks and the partial index, and putting both trigger functions back as they were (no other-shape refusal, no
    /// delete), keeping every program row, and it applies again; once a workout of one's own exists, the way back stops
    /// with 55000 and "roll forward", and the migration stays applied.
    /// </summary>
    [TestMethod]
    public async Task N9b2DTheMigrationRevertsOverProgramWorkoutsAndRefusesOnceAWorkoutOfOnesOwnExists()
    {
        var today = N9b1FStartAtMidday();
        using var program = await N9b2DProgramWorkoutAsync("n9b2d-migration", today);
        using var house = await N9a1OpenHouseAsync("n9b2d-migration", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b2d-migration-dalia@example.test", address: "203.0.113.152");
        Assert.AreEqual((N9b2DSchemaObjects, 0L, 6L), await N9b2DSchemaAsync());
        Assert.AreEqual(0L, await A7ScalarAsync(N9b2DEarlierGuardsSql));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9b2DMigrations(context);
        Assert.EndsWith("_HouseFreePlan", previous);

        // With program workouts alone the way back passes, and keeps every row of them. Nothing asks the API anything
        // until the migration is back.
        await migrator.MigrateAsync(previous);
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual((0L, 4L, 6L), await N9b2DSchemaAsync());
        Assert.AreEqual(2L, await A7ScalarAsync(N9b2DEarlierGuardsSql));
        Assert.AreEqual(1L, await A7ScalarAsync(N6aWorkoutGuardSql("PrescribedLoadStep")), "N6a's set function is back, not Phase 3's.");
        Assert.AreEqual((1L, 1L, 1L), await N9b2DProgramRowsAsync(program));
        var refused = await N9a1RefusedBySqlAsync(N9b2DDeleteSetSql, ("id", program.SetId));
        Assert.AreEqual(("55000", "Workout set history is immutable"), (refused.SqlState, refused.MessageText));

        // Applied again, all of it is back.
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual((N9b2DSchemaObjects, 0L, 6L), await N9b2DSchemaAsync());
        Assert.AreEqual(0L, await A7ScalarAsync(N9b2DEarlierGuardsSql));

        // Once a workout of one's own exists, started through its route, the way back stops with a plain message and
        // the migration stays applied (Npgsql retries 55000 first, each time rolled back).
        var own = await N9b2DOwnWorkoutAsync(trainee.Client, (library.Squat.Id, 1));
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refusal = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual(
            ("55000", "Some workouts have no program behind them; roll forward instead of reverting this migration."),
            (refusal.SqlState, refusal.MessageText));
        Assert.Contains("roll forward", refusal.MessageText);
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual((N9b2DSchemaObjects, 0L, 6L), await N9b2DSchemaAsync());
        await migrator.MigrateAsync();

        // Nothing was lost on either side: the trainee carries on with theirs, and the program's workout finishes.
        var day = await ReadSliceAsync<ClientTrainingDayResult>(trainee.Client, "/api/training/me/today");
        Assert.IsNotNull(day.OwnWorkout);
        Assert.AreEqual(
            (own.WorkoutExecutionId, own.Version, 1, 1),
            (day.OwnWorkout.WorkoutExecutionId, day.OwnWorkout.Version, day.OwnWorkout.Exercises.Count, day.OwnWorkout.Exercises[0].Sets.Count));
        var finished = await A3FinishAsync(program.Client, program.WorkoutId, program.Version);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, finished.Status);
    }

    // ---------- helpers (writer D of N9b2: the database) ----------

    /// <summary>
    /// The trainee's workout of their own through its routes: started empty, then each exercise added from the pool and
    /// given that many sets one by one; the workout as the last answer read it.
    /// </summary>
    private static async Task<OwnWorkoutView> N9b2DOwnWorkoutAsync(HttpClient trainee, params (Guid ExerciseId, int Sets)[] exercises)
    {
        var workout = await N9b2DOwnWriteAsync(trainee, "/api/training/me/workouts", new { });
        foreach (var (exerciseId, sets) in exercises)
        {
            workout = await N9b2DOwnWriteAsync(
                trainee,
                $"/api/training/me/workouts/{workout.WorkoutExecutionId}/exercises",
                new { exerciseId, version = workout.Version });
            var added = workout.Exercises[^1];
            Assert.AreEqual((exerciseId, 0), (added.ExerciseId, added.Sets.Count));
            for (var count = 0; count < sets; count++)
            {
                workout = await N9b2DOwnWriteAsync(
                    trainee,
                    $"/api/training/me/workouts/{workout.WorkoutExecutionId}/exercises/{added.PerformanceId}/sets",
                    new { version = workout.Version });
            }
        }

        return workout;
    }

    private static async Task<OwnWorkoutView> N9b2DOwnWriteAsync(HttpClient trainee, string url, object body)
    {
        await RefreshCsrfAsync(trainee);
        var response = await trainee.PostAsJsonAsync(url, body);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<OwnWorkoutView>(response);
    }

    /// <summary>A coach's client's program workout started today, its one set logged, with the version the next write sends.</summary>
    private async Task<N9b2DProgram> N9b2DProgramWorkoutAsync(string tag, DateOnly today)
    {
        var coach = CreateClient();
        var client = CreateClient();
        await RegisterCoachAsync(coach, $"{tag}-zeina@example.test", "Zeina Rahme", $"{tag} Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, $"{tag}-maya@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        await AssignAsync(coach, clientId, resources, today);
        var (workout, day) = await A3StartTodayAsync(client);
        var exercise = day.Exercises.Single();
        var set = exercise.Sets.Single();
        var saved = await A3LogAsync(client, workout.Id, set.PerformanceId!.Value, 5, 80m, 8m, day.ExecutionVersion!.Value);
        return new N9b2DProgram(coach, client, workout.Id, exercise.PerformanceId!.Value, set.PerformanceId!.Value, saved.ExecutionVersion);
    }

    /// <summary>
    /// A trainee of the house holding, in that one workspace, a program's workout the house's staff gave them, running,
    /// and a workout of their own started through its route while it ran: a back squat with two sets and a hold with one.
    /// </summary>
    private async Task<N9b2DShapes> N9b2DBothShapesAsync(string tag)
    {
        var today = N9b1FStartAtMidday();
        var house = await N9a1OpenHouseAsync(tag, withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        var trainee = await N9a1TraineeAsync(house.TenantId, $"{tag}-dalia@example.test", address: "203.0.113.150");
        var training = await CreateTrainingResourcesAsync(house.Owner, trainee.ProfileId, 8, 1, today);
        await AssignAsync(house.Owner, trainee.ProfileId, training, today);
        var (program, day) = await A3StartTodayAsync(trainee.Client);
        var own = await N9b2DOwnWorkoutAsync(trainee.Client, (library.Squat.Id, 2), (library.Hold.Id, 1));
        var exercise = day.Exercises.Single();
        return new N9b2DShapes(
            house,
            trainee,
            program.Id,
            day.MesocycleId,
            exercise.PerformanceId!.Value,
            exercise.Sets.Single().PerformanceId!.Value,
            own);
    }

    /// <summary>
    /// Asserts a program's workout keeps its set, its exercise and itself, and its program and session: each refused
    /// with 55000 and the guard's words, the session's as <paramref name="sessionRefusal"/> says.
    /// </summary>
    private async Task N9b2DAssertProgramWorkoutKeptAsync(N9b2DProgram program, string sessionRefusal)
    {
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteSetSql, program.SetId, "Workout set history is immutable");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteExerciseSql, program.ExerciseId, "Workout exercise history is immutable");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteWorkoutSql, program.WorkoutId, "Workout executions cannot be deleted");
        await N9b2DAssertGuardRefusesAsync(
            """UPDATE training."WorkoutExecutions" SET "TrainingSessionId" = NULL WHERE "Id" = @id""",
            program.WorkoutId,
            sessionRefusal);
        // Written whole as a workout of one's own, which the check would take, it is still refused.
        await N9b2DAssertGuardRefusesAsync(
            """
            UPDATE training."WorkoutExecutions"
            SET "MesocycleId" = NULL, "TrainingSessionId" = NULL, "SessionCoachNotesSnapshot" = NULL, "PrescriptionVersionSnapshot" = 0
            WHERE "Id" = @id
            """,
            program.WorkoutId,
            sessionRefusal);
        Assert.AreEqual((1L, 1L, 1L), await N9b2DProgramRowsAsync(program));
    }

    /// <summary>The program's workout with its session and program, its exercise and its set, each counted.</summary>
    private async Task<(long Workout, long Exercise, long Set)> N9b2DProgramRowsAsync(N9b2DProgram program) =>
        (await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."WorkoutExecutions"
                WHERE "Id" = @id AND "MesocycleId" IS NOT NULL AND "TrainingSessionId" IS NOT NULL
                """,
                program.WorkoutId),
            await Phase6CountAsync(RequiredDatabaseConnection, N9b2DExerciseRowSql, program.ExerciseId),
            await Phase6CountAsync(RequiredDatabaseConnection, N9b2DSetRowSql, program.SetId));

    /// <summary>Asserts a workout guard refuses the statement about the row with 55000 and exactly these words.</summary>
    private async Task N9b2DAssertGuardRefusesAsync(string sql, Guid id, string words)
    {
        var refused = await N9a1RefusedBySqlAsync(sql, ("id", id));
        Assert.AreEqual(("55000", words), (refused.SqlState, refused.MessageText), sql);
    }

    /// <summary>One workout's exercise rows and set rows.</summary>
    private async Task<(long Exercises, long Sets)> N9b2DRowsOfAsync(Guid workoutId) =>
        (await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM training."WorkoutExercisePerformances" WHERE "WorkoutExecutionId" = @id""",
                workoutId),
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."WorkoutSetPerformances" AS s
                JOIN training."WorkoutExercisePerformances" AS e ON e."TenantId" = s."TenantId" AND e."Id" = s."WorkoutExercisePerformanceId"
                WHERE e."WorkoutExecutionId" = @id
                """,
                workoutId));

    /// <summary>Every exercise row and set row of every workout.</summary>
    private async Task<(long Exercises, long Sets)> N9b2DAllRowsAsync() =>
        (await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutExercisePerformances" """),
            await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutSetPerformances" """));

    /// <summary>A client's program workouts running, and their workouts of their own running and finished.</summary>
    private async Task<(long ProgramRunning, long OwnRunning, long OwnFinished)> N9b2DWorkoutsOfAsync(Guid clientProfileId) =>
        (await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."WorkoutExecutions"
                WHERE "ClientProfileId" = @id AND "TrainingSessionId" IS NOT NULL AND "Status" = 'InProgress'
                """,
                clientProfileId),
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."WorkoutExecutions"
                WHERE "ClientProfileId" = @id AND "TrainingSessionId" IS NULL AND "Status" = 'InProgress'
                """,
                clientProfileId),
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."WorkoutExecutions"
                WHERE "ClientProfileId" = @id AND "TrainingSessionId" IS NULL AND "Status" = 'Completed'
                """,
                clientProfileId));

    /// <summary>The migration's objects, the four columns while NOT NULL, and the three guard functions with their triggers.</summary>
    private async Task<(long Objects, long RequiredColumns, long Guards)> N9b2DSchemaAsync() =>
        (await A7ScalarAsync(N9b2DSchemaSql), await A7ScalarAsync(N9b2DRequiredColumnsSql), await A7ScalarAsync(N9b2DGuardsSql));

    /// <summary>A copy of one workout row under a new id with the given change (N6aCopySql's way; this table has no position).</summary>
    private static string N9b2DCopyWorkoutSql(Guid id, string change) =>
        $$"""
        DO $copy$
        DECLARE r training."WorkoutExecutions"%ROWTYPE;
        BEGIN
            SELECT * INTO STRICT r FROM training."WorkoutExecutions" WHERE "Id" = '{{id}}';
            r."Id" := gen_random_uuid();
            {{change}}
            INSERT INTO training."WorkoutExecutions" SELECT r.*;
        END $copy$;
        """;

    /// <summary>This row's migration, the one before it, and the migrator that moves between them.</summary>
    private static (string Migration, string Previous, IMigrator Migrator) N9b2DMigrations(GymDbContext context)
    {
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_OwnWorkouts", StringComparison.Ordinal));
        return (
            migration,
            migrations[Array.IndexOf(migrations, migration) - 1],
            context.Database.GetInfrastructure().GetRequiredService<IMigrator>());
    }

    private sealed record N9b2DProgram(
        HttpClient Coach,
        HttpClient Client,
        Guid WorkoutId,
        Guid ExerciseId,
        Guid SetId,
        uint Version) : IDisposable
    {
        public void Dispose()
        {
            Coach.Dispose();
            Client.Dispose();
        }
    }

    private sealed record N9b2DShapes(
        N9a1House House,
        N9a1Trainee Trainee,
        Guid ProgramWorkoutId,
        Guid ProgramMesocycleId,
        Guid ProgramExerciseId,
        Guid ProgramSetId,
        OwnWorkoutView Own) : IDisposable
    {
        public void Dispose()
        {
            Trainee.Dispose();
            House.Dispose();
        }
    }
}
