using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// A workout of one's own (notes plan N9b2, TRN-033): the same workout tables with no program, session or
    /// prescription behind the row, those ids empty together and only together, one unfinished at a time, and an
    /// exercise or set of such a workout deletable while it runs, while no row of a program's workout ever is.
    /// </summary>
    public partial class OwnWorkouts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "SetPrescriptionId",
                schema: "training",
                table: "WorkoutSetPerformances",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "ExercisePrescriptionId",
                schema: "training",
                table: "WorkoutExercisePerformances",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "TrainingSessionId",
                schema: "training",
                table: "WorkoutExecutions",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "MesocycleId",
                schema: "training",
                table: "WorkoutExecutions",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkoutSetPerformances_OwnHasNothingPrescribed",
                schema: "training",
                table: "WorkoutSetPerformances",
                sql: "\"SetPrescriptionId\" IS NOT NULL OR (\"PrescribedRepetitionsMinimum\" IS NULL AND \"PrescribedRepetitionsMaximum\" IS NULL AND \"PrescribedLoad\" IS NULL AND \"PrescribedLoadUnit\" IS NULL AND \"LoadStrategySnapshot\" IS NULL AND \"PrescribedLoadStep\" IS NULL AND \"PrescribedTargetRpe\" IS NULL AND \"PrescribedRestSeconds\" IS NULL AND \"PrescribedTempo\" IS NULL AND \"CoachNotesSnapshot\" IS NULL AND \"CalculationStrategyKeySnapshot\" IS NULL AND \"CalculationStrategyVersionSnapshot\" IS NULL AND \"UnroundedRecommendedLoadSnapshot\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkoutExercisePerformances_OwnIsItsOwnPrescription",
                schema: "training",
                table: "WorkoutExercisePerformances",
                sql: "\"ExercisePrescriptionId\" IS NOT NULL OR (NOT \"WasSubstituted\" AND \"ActualExerciseId\" = \"PrescribedExerciseId\" AND \"ModificationPolicySnapshot\" = 'Locked' AND NOT \"IsMainLiftSnapshot\" AND \"CoachNotesSnapshot\" IS NULL)");

            migrationBuilder.CreateIndex(
                name: "UX_WorkoutExecutions_OneOwnInProgress",
                schema: "training",
                table: "WorkoutExecutions",
                columns: new[] { "TenantId", "ClientProfileId" },
                unique: true,
                filter: "\"TrainingSessionId\" IS NULL AND \"Status\" = 'InProgress'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkoutExecutions_ProgramOrOwn",
                schema: "training",
                table: "WorkoutExecutions",
                sql: "(\"MesocycleId\" IS NOT NULL AND \"TrainingSessionId\" IS NOT NULL) OR (\"MesocycleId\" IS NULL AND \"TrainingSessionId\" IS NULL AND \"SessionCoachNotesSnapshot\" IS NULL AND \"PrescriptionVersionSnapshot\" = 0)");

            // An exercise row is a workout of one's own's exactly when its workout is: an insert that mixes the two is
            // refused, so a program's workout never takes a row that could be deleted. Only an exercise of an
            // unfinished workout of one's own is ever deleted (TRN-033); the rest of Phase 3's function is unchanged.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION training.protect_workout_exercise()
                RETURNS trigger AS $body$
                DECLARE execution_status text;
                DECLARE execution_session uuid;
                DECLARE execution_found boolean;
                BEGIN
                    SELECT w."Status", w."TrainingSessionId", true
                    INTO execution_status, execution_session, execution_found
                    FROM training."WorkoutExecutions" w
                    WHERE w."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND w."Id" = COALESCE(NEW."WorkoutExecutionId", OLD."WorkoutExecutionId");
                    IF TG_OP = 'DELETE' THEN
                        IF execution_found AND execution_session IS NULL AND execution_status = 'InProgress'
                           AND OLD."ExercisePrescriptionId" IS NULL THEN
                            RETURN OLD;
                        END IF;
                        RAISE EXCEPTION 'Workout exercise history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF execution_status = 'Completed' THEN
                        RAISE EXCEPTION 'Workout exercise history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'INSERT'
                       AND (execution_session IS NULL) IS DISTINCT FROM (NEW."ExercisePrescriptionId" IS NULL) THEN
                        RAISE EXCEPTION 'A workout of one''s own takes only exercises of its own, and a program''s workout only prescribed ones'
                            USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'UPDATE' AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."WorkoutExecutionId" IS DISTINCT FROM NEW."WorkoutExecutionId"
                        OR OLD."ExercisePrescriptionId" IS DISTINCT FROM NEW."ExercisePrescriptionId"
                        OR OLD."PrescribedExerciseId" IS DISTINCT FROM NEW."PrescribedExerciseId"
                        OR OLD."PrescribedExerciseName" IS DISTINCT FROM NEW."PrescribedExerciseName"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."ModificationPolicySnapshot" IS DISTINCT FROM NEW."ModificationPolicySnapshot"
                        OR OLD."IsMainLiftSnapshot" IS DISTINCT FROM NEW."IsMainLiftSnapshot"
                        OR OLD."CoachNotesSnapshot" IS DISTINCT FROM NEW."CoachNotesSnapshot") THEN
                        RAISE EXCEPTION 'Workout exercise prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;
                """);

            // A set row is a workout of one's own's exactly when its exercise is (the insert check). Only such a set is
            // ever deleted: by itself while its workout runs, or with its exercise, which only an unfinished workout of
            // one's own lets go and which the cascade no longer finds. N6a's function is otherwise unchanged.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION training.protect_workout_set()
                RETURNS trigger AS $body$
                DECLARE execution_status text;
                DECLARE exercise_prescription uuid;
                DECLARE exercise_found boolean;
                BEGIN
                    SELECT w."Status", e."ExercisePrescriptionId", true
                    INTO execution_status, exercise_prescription, exercise_found
                    FROM training."WorkoutExercisePerformances" e
                    JOIN training."WorkoutExecutions" w
                      ON w."TenantId" = e."TenantId" AND w."Id" = e."WorkoutExecutionId"
                    WHERE e."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND e."Id" = COALESCE(NEW."WorkoutExercisePerformanceId", OLD."WorkoutExercisePerformanceId");
                    IF TG_OP = 'DELETE' THEN
                        IF OLD."SetPrescriptionId" IS NULL
                           AND (execution_status = 'InProgress' OR exercise_found IS NULL) THEN
                            RETURN OLD;
                        END IF;
                        RAISE EXCEPTION 'Workout set history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF execution_status = 'Completed' THEN
                        RAISE EXCEPTION 'Workout set history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'INSERT'
                       AND (exercise_prescription IS NULL) IS DISTINCT FROM (NEW."SetPrescriptionId" IS NULL) THEN
                        RAISE EXCEPTION 'A workout of one''s own takes only sets of its own, and a program''s workout only prescribed ones'
                            USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'UPDATE' AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."WorkoutExercisePerformanceId" IS DISTINCT FROM NEW."WorkoutExercisePerformanceId"
                        OR OLD."SetPrescriptionId" IS DISTINCT FROM NEW."SetPrescriptionId"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."SetTypeSnapshot" IS DISTINCT FROM NEW."SetTypeSnapshot"
                        OR OLD."PrescribedRepetitionsMinimum" IS DISTINCT FROM NEW."PrescribedRepetitionsMinimum"
                        OR OLD."PrescribedRepetitionsMaximum" IS DISTINCT FROM NEW."PrescribedRepetitionsMaximum"
                        OR OLD."PrescribedLoad" IS DISTINCT FROM NEW."PrescribedLoad"
                        OR OLD."PrescribedLoadUnit" IS DISTINCT FROM NEW."PrescribedLoadUnit"
                        OR OLD."LoadStrategySnapshot" IS DISTINCT FROM NEW."LoadStrategySnapshot"
                        OR OLD."PrescribedLoadStep" IS DISTINCT FROM NEW."PrescribedLoadStep"
                        OR OLD."PrescribedTargetRpe" IS DISTINCT FROM NEW."PrescribedTargetRpe"
                        OR OLD."PrescribedRestSeconds" IS DISTINCT FROM NEW."PrescribedRestSeconds"
                        OR OLD."PrescribedTempo" IS DISTINCT FROM NEW."PrescribedTempo"
                        OR OLD."CoachNotesSnapshot" IS DISTINCT FROM NEW."CoachNotesSnapshot"
                        OR OLD."CalculationStrategyKeySnapshot" IS DISTINCT FROM NEW."CalculationStrategyKeySnapshot"
                        OR OLD."CalculationStrategyVersionSnapshot" IS DISTINCT FROM NEW."CalculationStrategyVersionSnapshot"
                        OR OLD."UnroundedRecommendedLoadSnapshot" IS DISTINCT FROM NEW."UnroundedRecommendedLoadSnapshot") THEN
                        RAISE EXCEPTION 'Workout set prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A workout of one's own is history the old columns cannot hold, and history is never rewritten
            // (TRN-012), so going back is a forward fix: stop with a plain message instead.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM training."WorkoutExecutions"
                               WHERE "TrainingSessionId" IS NULL OR "MesocycleId" IS NULL)
                       OR EXISTS (SELECT 1 FROM training."WorkoutExercisePerformances" WHERE "ExercisePrescriptionId" IS NULL)
                       OR EXISTS (SELECT 1 FROM training."WorkoutSetPerformances" WHERE "SetPrescriptionId" IS NULL) THEN
                        RAISE EXCEPTION 'Some workouts have no program behind them; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            // The functions as they were before this migration: Phase 3's for exercises, N6a's for sets.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION training.protect_workout_exercise()
                RETURNS trigger AS $body$
                DECLARE execution_status text;
                BEGIN
                    SELECT w."Status" INTO execution_status
                    FROM training."WorkoutExecutions" w
                    WHERE w."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND w."Id" = COALESCE(NEW."WorkoutExecutionId", OLD."WorkoutExecutionId");
                    IF TG_OP = 'DELETE' OR execution_status = 'Completed' THEN
                        RAISE EXCEPTION 'Workout exercise history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'UPDATE' AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."WorkoutExecutionId" IS DISTINCT FROM NEW."WorkoutExecutionId"
                        OR OLD."ExercisePrescriptionId" IS DISTINCT FROM NEW."ExercisePrescriptionId"
                        OR OLD."PrescribedExerciseId" IS DISTINCT FROM NEW."PrescribedExerciseId"
                        OR OLD."PrescribedExerciseName" IS DISTINCT FROM NEW."PrescribedExerciseName"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."ModificationPolicySnapshot" IS DISTINCT FROM NEW."ModificationPolicySnapshot"
                        OR OLD."IsMainLiftSnapshot" IS DISTINCT FROM NEW."IsMainLiftSnapshot"
                        OR OLD."CoachNotesSnapshot" IS DISTINCT FROM NEW."CoachNotesSnapshot") THEN
                        RAISE EXCEPTION 'Workout exercise prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE OR REPLACE FUNCTION training.protect_workout_set()
                RETURNS trigger AS $body$
                DECLARE execution_status text;
                BEGIN
                    SELECT w."Status" INTO execution_status
                    FROM training."WorkoutExercisePerformances" e
                    JOIN training."WorkoutExecutions" w
                      ON w."TenantId" = e."TenantId" AND w."Id" = e."WorkoutExecutionId"
                    WHERE e."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND e."Id" = COALESCE(NEW."WorkoutExercisePerformanceId", OLD."WorkoutExercisePerformanceId");
                    IF TG_OP = 'DELETE' OR execution_status = 'Completed' THEN
                        RAISE EXCEPTION 'Workout set history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'UPDATE' AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."WorkoutExercisePerformanceId" IS DISTINCT FROM NEW."WorkoutExercisePerformanceId"
                        OR OLD."SetPrescriptionId" IS DISTINCT FROM NEW."SetPrescriptionId"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."SetTypeSnapshot" IS DISTINCT FROM NEW."SetTypeSnapshot"
                        OR OLD."PrescribedRepetitionsMinimum" IS DISTINCT FROM NEW."PrescribedRepetitionsMinimum"
                        OR OLD."PrescribedRepetitionsMaximum" IS DISTINCT FROM NEW."PrescribedRepetitionsMaximum"
                        OR OLD."PrescribedLoad" IS DISTINCT FROM NEW."PrescribedLoad"
                        OR OLD."PrescribedLoadUnit" IS DISTINCT FROM NEW."PrescribedLoadUnit"
                        OR OLD."LoadStrategySnapshot" IS DISTINCT FROM NEW."LoadStrategySnapshot"
                        OR OLD."PrescribedLoadStep" IS DISTINCT FROM NEW."PrescribedLoadStep"
                        OR OLD."PrescribedTargetRpe" IS DISTINCT FROM NEW."PrescribedTargetRpe"
                        OR OLD."PrescribedRestSeconds" IS DISTINCT FROM NEW."PrescribedRestSeconds"
                        OR OLD."PrescribedTempo" IS DISTINCT FROM NEW."PrescribedTempo"
                        OR OLD."CoachNotesSnapshot" IS DISTINCT FROM NEW."CoachNotesSnapshot"
                        OR OLD."CalculationStrategyKeySnapshot" IS DISTINCT FROM NEW."CalculationStrategyKeySnapshot"
                        OR OLD."CalculationStrategyVersionSnapshot" IS DISTINCT FROM NEW."CalculationStrategyVersionSnapshot"
                        OR OLD."UnroundedRecommendedLoadSnapshot" IS DISTINCT FROM NEW."UnroundedRecommendedLoadSnapshot") THEN
                        RAISE EXCEPTION 'Workout set prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkoutSetPerformances_OwnHasNothingPrescribed",
                schema: "training",
                table: "WorkoutSetPerformances");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkoutExercisePerformances_OwnIsItsOwnPrescription",
                schema: "training",
                table: "WorkoutExercisePerformances");

            migrationBuilder.DropIndex(
                name: "UX_WorkoutExecutions_OneOwnInProgress",
                schema: "training",
                table: "WorkoutExecutions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkoutExecutions_ProgramOrOwn",
                schema: "training",
                table: "WorkoutExecutions");

            // No default: the columns never had one, and every row holds a value once the check above has passed.
            migrationBuilder.AlterColumn<Guid>(
                name: "SetPrescriptionId",
                schema: "training",
                table: "WorkoutSetPerformances",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ExercisePrescriptionId",
                schema: "training",
                table: "WorkoutExercisePerformances",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "TrainingSessionId",
                schema: "training",
                table: "WorkoutExecutions",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "MesocycleId",
                schema: "training",
                table: "WorkoutExecutions",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
