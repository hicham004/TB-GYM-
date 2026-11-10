using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LastTimeStepSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets");

            migrationBuilder.AddColumn<string>(
                name: "LoadStrategySnapshot",
                schema: "training",
                table: "WorkoutSetPerformances",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PrescribedLoadStep",
                schema: "training",
                table: "WorkoutSetPerformances",
                type: "numeric(8,3)",
                precision: 8,
                scale: 3,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "LoadStep",
                schema: "training",
                table: "SetPrescriptions",
                type: "numeric(8,3)",
                precision: 8,
                scale: 3,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "LoadStep",
                schema: "training",
                table: "ProgramTemplateSets",
                type: "numeric(8,3)",
                precision: 8,
                scale: 3,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkoutSetPerformances_LoadStep",
                schema: "training",
                table: "WorkoutSetPerformances",
                sql: "(\"LoadStrategySnapshot\" IS DISTINCT FROM 'LastTimeStep' AND \"PrescribedLoadStep\" IS NULL) OR (\"LoadStrategySnapshot\" IS NOT DISTINCT FROM 'LastTimeStep' AND \"PrescribedLoadStep\" IS NOT NULL AND \"PrescribedLoadStep\" > 0 AND \"PrescribedLoadStep\" <= 50 AND \"PrescribedLoadUnit\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SetPrescriptions_LoadStep",
                schema: "training",
                table: "SetPrescriptions",
                sql: "\"LoadStep\" IS NULL OR \"LoadStrategy\" = 'LastTimeStep'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" IN ('RpeBasedEpley', 'RpeChart') AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'LastTimeStep' AND \"LoadStep\" IS NOT NULL AND \"LoadStep\" > 0 AND \"LoadStep\" <= 50 AND mod(\"LoadStep\" * 100, 1) = 0 AND \"LoadUnit\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND (\"DirectLoad\" IS NULL OR \"DirectLoad\" > 0))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStep",
                schema: "training",
                table: "ProgramTemplateSets",
                sql: "\"LoadStep\" IS NULL OR \"LoadStrategy\" = 'LastTimeStep'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" IN ('RpeBasedEpley', 'RpeChart') AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'LastTimeStep' AND \"LoadStep\" IS NOT NULL AND \"LoadStep\" > 0 AND \"LoadStep\" <= 50 AND mod(\"LoadStep\" * 100, 1) = 0 AND \"LoadUnit\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND (\"DirectLoad\" IS NULL OR \"DirectLoad\" > 0))");

            // A started workout keeps the weight choice and the step it was started with (N6a): Phase 3's
            // function, unchanged but for the two new snapshot columns in the list of what never changes.
            migrationBuilder.Sql(
                """
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Sets that already use last time + step are history the old checks refuse, and they are never
            // rewritten, so going back is a forward fix (ADR 0036): stop with a plain message instead.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM training."ProgramTemplateSets" WHERE "LoadStrategy" = 'LastTimeStep')
                       OR EXISTS (SELECT 1 FROM training."SetPrescriptions" WHERE "LoadStrategy" = 'LastTimeStep') THEN
                        RAISE EXCEPTION 'Some sets use Last time + step; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            // Phase 3's function as it was, before the columns it would name are dropped.
            migrationBuilder.Sql(
                """
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
                name: "CK_WorkoutSetPerformances_LoadStep",
                schema: "training",
                table: "WorkoutSetPerformances");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SetPrescriptions_LoadStep",
                schema: "training",
                table: "SetPrescriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStep",
                schema: "training",
                table: "ProgramTemplateSets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets");

            migrationBuilder.DropColumn(
                name: "LoadStrategySnapshot",
                schema: "training",
                table: "WorkoutSetPerformances");

            migrationBuilder.DropColumn(
                name: "PrescribedLoadStep",
                schema: "training",
                table: "WorkoutSetPerformances");

            migrationBuilder.DropColumn(
                name: "LoadStep",
                schema: "training",
                table: "SetPrescriptions");

            migrationBuilder.DropColumn(
                name: "LoadStep",
                schema: "training",
                table: "ProgramTemplateSets");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" IN ('RpeBasedEpley', 'RpeChart') AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" IN ('RpeBasedEpley', 'RpeChart') AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");
        }
    }
}
