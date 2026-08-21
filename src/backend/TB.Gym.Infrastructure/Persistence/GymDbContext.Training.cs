using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureTraining(ModelBuilder builder)
    {
        ConfigureProgramTemplates(builder);
        ConfigureMesocycles(builder);
        ConfigureWorkoutExecution(builder);
    }

    private void ConfigureProgramTemplates(ModelBuilder builder)
    {
        builder.Entity<ProgramTemplate>(entity =>
        {
            entity.ToTable("ProgramTemplates", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.IsArchived, item.Name });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgramTemplateVersion>(entity =>
        {
            entity.ToTable("ProgramTemplateVersions", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.NameSnapshot).HasMaxLength(160).IsRequired();
            entity.Property(item => item.DescriptionSnapshot).HasMaxLength(4_000);
            entity.HasIndex(item => new { item.TenantId, item.TemplateId, item.VersionNumber }).IsUnique();
            entity.HasOne<ProgramTemplate>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.TemplateId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Weeks)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.TemplateVersionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ProgramTemplateVersions_Number",
                "\"VersionNumber\" >= 1"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgramTemplateWeek>(entity =>
        {
            entity.ToTable("ProgramTemplateWeeks", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Label).HasMaxLength(120);
            entity.HasIndex(item => new { item.TenantId, item.TemplateVersionId, item.WeekNumber }).IsUnique();
            entity.HasMany(item => item.Sessions)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.TemplateWeekId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ProgramTemplateWeeks_Number",
                "\"WeekNumber\" >= 1 AND \"WeekNumber\" <= 52"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgramTemplateSession>(entity =>
        {
            entity.ToTable("ProgramTemplateSessions", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.Property(item => item.CoachNotes).HasMaxLength(4_000);
            entity.HasIndex(item => new { item.TenantId, item.TemplateWeekId, item.Position }).IsUnique();
            entity.HasMany(item => item.Exercises)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.TemplateSessionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_ProgramTemplateSessions_Position", "\"Position\" >= 0");
                table.HasCheckConstraint("CK_ProgramTemplateSessions_DayOffset", "\"DayOffset\" >= 0 AND \"DayOffset\" <= 6");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgramTemplateExercise>(entity =>
        {
            entity.ToTable("ProgramTemplateExercises", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ExerciseNameSnapshot).HasMaxLength(160).IsRequired();
            entity.Property(item => item.ModificationPolicy).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.CoachNotes).HasMaxLength(2_000);
            entity.HasIndex(item => new { item.TenantId, item.TemplateSessionId, item.Position }).IsUnique();
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Sets)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.TemplateExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Alternatives)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.TemplateExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ProgramTemplateExercises_MainLiftPolicy",
                "NOT \"IsMainLift\" OR \"ModificationPolicy\" = 'Locked'"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgramTemplateExerciseAlternative>(entity =>
        {
            entity.ToTable("ProgramTemplateExerciseAlternatives", "training");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.TemplateExerciseId, item.ExerciseId }).IsUnique();
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgramTemplateSet>(entity =>
        {
            entity.ToTable("ProgramTemplateSets", "training");
            entity.HasKey(item => item.Id);
            ConfigureTemplateSetProperties(entity);
            entity.HasIndex(item => new { item.TenantId, item.TemplateExerciseId, item.Position }).IsUnique();
            ConfigureTenantEntity(entity);
        });

        builder.Entity<SavedSessionTemplate>(entity =>
        {
            entity.ToTable("SavedSessionTemplates", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.IsArchived, item.Name });
            entity.HasIndex(item => new { item.TenantId, item.SourceTemplateVersionId, item.SourceTemplateSessionId });
            entity.HasOne<ProgramTemplateVersion>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceTemplateVersionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ProgramTemplateSession>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceTemplateSessionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });
    }

    private void ConfigureMesocycles(ModelBuilder builder)
    {
        builder.Entity<TrainingMesocycle>(entity =>
        {
            entity.ToTable("Mesocycles", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.Property(item => item.StartDate).HasColumnType("date");
            entity.Property(item => item.EndDateExclusive).HasColumnType("date");
            entity.Property(item => item.TimeZoneId).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.LoadUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.LoadIncrement).HasPrecision(8, 3);
            entity.Property(item => item.LoadRoundingMode).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.MutationSequence);
            entity.HasIndex(item => new { item.TenantId, item.AssignmentCommandId }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.StartDate, item.EndDateExclusive });
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientEnrollment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.EnrollmentId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ProgramTemplate>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceTemplateId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ProgramTemplateVersion>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceTemplateVersionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Weeks)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_Mesocycles_Period", "\"EndDateExclusive\" > \"StartDate\"");
                table.HasCheckConstraint("CK_Mesocycles_LoadIncrement", "\"LoadIncrement\" > 0 AND \"LoadIncrement\" <= 50");
                table.HasCheckConstraint("CK_Mesocycles_Phase3Kind", "\"Kind\" = 'Primary'");
                table.HasCheckConstraint(
                    "CK_Mesocycles_StoredStatus",
                    "\"Status\" IN ('Planned', 'Completed', 'Cancelled')");
                table.HasCheckConstraint("CK_Mesocycles_MutationSequence", "\"MutationSequence\" >= 0");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MesocycleLifecycleEvent>(entity =>
        {
            entity.ToTable("MesocycleLifecycleEvents", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EventType).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.FromStatus).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.ToStatus).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.MesocycleId, item.OccurredAtUtc });
            entity.HasOne<TrainingMesocycle>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MesocycleWeek>(entity =>
        {
            entity.ToTable("MesocycleWeeks", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.StartsOn).HasColumnType("date");
            entity.Property(item => item.Label).HasMaxLength(120);
            entity.HasIndex(item => new { item.TenantId, item.MesocycleId, item.WeekNumber }).IsUnique();
            entity.HasMany(item => item.Sessions)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleWeekId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_MesocycleWeeks_Number",
                "\"WeekNumber\" >= 1 AND \"WeekNumber\" <= 52"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<TrainingSession>(entity =>
        {
            entity.ToTable("Sessions", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ScheduledDate).HasColumnType("date");
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.Property(item => item.CoachNotes).HasMaxLength(4_000);
            entity.HasIndex(item => new { item.TenantId, item.MesocycleWeekId, item.Position }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ScheduledDate });
            entity.HasMany(item => item.Exercises)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.TrainingSessionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_TrainingSessions_Position", "\"Position\" >= 0");
                table.HasCheckConstraint("CK_TrainingSessions_DayOffset", "\"DayOffset\" >= 0 AND \"DayOffset\" <= 6");
                table.HasCheckConstraint(
                    "CK_TrainingSessions_ExecutionState",
                    "NOT \"IsCompleted\" OR \"HasStarted\"");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExercisePrescription>(entity =>
        {
            entity.ToTable("ExercisePrescriptions", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ExerciseNameSnapshot).HasMaxLength(160).IsRequired();
            entity.Property(item => item.ModificationPolicy).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.CoachNotes).HasMaxLength(2_000);
            entity.HasIndex(item => new { item.TenantId, item.TrainingSessionId, item.Position }).IsUnique();
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Sets)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExercisePrescriptionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Alternatives)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExercisePrescriptionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Media)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExercisePrescriptionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ExercisePrescriptions_MainLiftPolicy",
                "NOT \"IsMainLift\" OR \"ModificationPolicy\" = 'Locked'"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExercisePrescriptionMediaSnapshot>(entity =>
        {
            entity.ToTable("ExercisePrescriptionMediaSnapshots", "training");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.ExercisePrescriptionId, item.DisplayOrder }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.MediaAssetId });
            entity.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MediaAssetId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ExercisePrescriptionMediaSnapshots_DisplayOrder",
                "\"DisplayOrder\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExercisePrescriptionAlternative>(entity =>
        {
            entity.ToTable("ExercisePrescriptionAlternatives", "training");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.ExercisePrescriptionId, item.ExerciseId }).IsUnique();
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<SetPrescription>(entity =>
        {
            entity.ToTable("SetPrescriptions", "training");
            entity.HasKey(item => item.Id);
            ConfigureSetProperties(entity);
            entity.Property(item => item.UnroundedRecommendedLoad).HasPrecision(8, 3);
            entity.Property(item => item.PrescribedLoad).HasPrecision(8, 3);
            entity.Property(item => item.CalculationStrategyKey).HasMaxLength(80);
            entity.Property(item => item.CalculationStrategyVersion).HasMaxLength(40);
            entity.Property(item => item.CalculationExplanation).HasMaxLength(1_000);
            entity.HasIndex(item => new { item.TenantId, item.ExercisePrescriptionId, item.Position }).IsUnique();
            entity.HasOne<MesocycleWorkingMaxSnapshot>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.WorkingMaxSnapshotId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });
    }

    private void ConfigureWorkoutExecution(ModelBuilder builder)
    {
        builder.Entity<WorkoutExecution>(entity =>
        {
            entity.ToTable("WorkoutExecutions", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ScheduledDateSnapshot).HasColumnType("date");
            entity.Property(item => item.SessionNameSnapshot).HasMaxLength(160).IsRequired();
            entity.Property(item => item.SessionCoachNotesSnapshot).HasMaxLength(4_000);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.MutationSequence);
            entity.HasIndex(item => new { item.TenantId, item.TrainingSessionId }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.ScheduledDateSnapshot });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<TrainingMesocycle>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<TrainingSession>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.TrainingSessionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Exercises)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.WorkoutExecutionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_WorkoutExecutions_CompletedState",
                    "\"Status\" <> 'Completed' OR \"CompletedAtUtc\" IS NOT NULL");
                table.HasCheckConstraint("CK_WorkoutExecutions_MutationSequence", "\"MutationSequence\" >= 0");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<WorkoutExercisePerformance>(entity =>
        {
            entity.ToTable("WorkoutExercisePerformances", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.PrescribedExerciseName).HasMaxLength(160).IsRequired();
            entity.Property(item => item.ActualExerciseName).HasMaxLength(160).IsRequired();
            entity.Property(item => item.ModificationPolicySnapshot).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.CoachNotesSnapshot).HasMaxLength(2_000);
            entity.HasIndex(item => new { item.TenantId, item.WorkoutExecutionId, item.Position }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ActualExerciseId, item.WorkoutExecutionId });
            entity.HasMany(item => item.Sets)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.WorkoutExercisePerformanceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.ApprovedAlternatives)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.WorkoutExercisePerformanceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Media)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.WorkoutExercisePerformanceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_WorkoutExercisePerformances_Substitution",
                "(NOT \"WasSubstituted\" AND \"ActualExerciseId\" = \"PrescribedExerciseId\") OR (\"WasSubstituted\" AND \"ActualExerciseId\" <> \"PrescribedExerciseId\" AND \"ModificationPolicySnapshot\" = 'CoachApprovedSwap')"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<WorkoutExerciseMediaSnapshot>(entity =>
        {
            entity.ToTable("WorkoutExerciseMediaSnapshots", "training");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.WorkoutExercisePerformanceId, item.DisplayOrder }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.MediaAssetId });
            entity.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MediaAssetId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_WorkoutExerciseMediaSnapshots_DisplayOrder",
                "\"DisplayOrder\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<WorkoutExerciseAlternativeSnapshot>(entity =>
        {
            entity.ToTable("WorkoutExerciseAlternativeSnapshots", "training");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.WorkoutExercisePerformanceId, item.ExerciseId }).IsUnique();
            ConfigureTenantEntity(entity);
        });

        builder.Entity<WorkoutSetPerformance>(entity =>
        {
            entity.ToTable("WorkoutSetPerformances", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.SetTypeSnapshot).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.PrescribedLoad).HasPrecision(8, 3);
            entity.Property(item => item.PrescribedLoadUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.PrescribedTargetRpe).HasPrecision(3, 1);
            entity.Property(item => item.PrescribedTempo).HasMaxLength(32);
            entity.Property(item => item.CoachNotesSnapshot).HasMaxLength(1_000);
            entity.Property(item => item.CalculationStrategyKeySnapshot).HasMaxLength(80);
            entity.Property(item => item.CalculationStrategyVersionSnapshot).HasMaxLength(40);
            entity.Property(item => item.UnroundedRecommendedLoadSnapshot).HasPrecision(8, 3);
            entity.Property(item => item.ActualLoad).HasPrecision(8, 3);
            entity.Property(item => item.ActualLoadUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.ActualRpe).HasPrecision(3, 1);
            entity.Property(item => item.ClientNote).HasMaxLength(1_000);
            entity.HasIndex(item => new { item.TenantId, item.WorkoutExercisePerformanceId, item.Position }).IsUnique();
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_WorkoutSetPerformances_ActualReps", "\"ActualRepetitions\" IS NULL OR (\"ActualRepetitions\" >= 0 AND \"ActualRepetitions\" <= 200)");
                table.HasCheckConstraint("CK_WorkoutSetPerformances_ActualLoad", "\"ActualLoad\" IS NULL OR (\"ActualLoad\" >= 0 AND \"ActualLoad\" <= 2000)");
                table.HasCheckConstraint("CK_WorkoutSetPerformances_ActualRpe", "\"ActualRpe\" IS NULL OR (\"ActualRpe\" >= 5 AND \"ActualRpe\" <= 10 AND mod(\"ActualRpe\" * 2, 1) = 0)");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<WorkoutNote>(entity =>
        {
            entity.ToTable("WorkoutNotes", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.AuthorRole).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Text).HasMaxLength(2_000).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.WorkoutExecutionId, item.CreatedAtUtc });
            entity.HasOne<WorkoutExecution>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.WorkoutExecutionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<WorkoutExercisePerformance>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.WorkoutExercisePerformanceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.AuthorUserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ProgressionApplication>(entity =>
        {
            entity.ToTable("ProgressionApplications", "training");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.TransformKey).HasMaxLength(80).IsRequired();
            entity.Property(item => item.TransformVersion).HasMaxLength(40).IsRequired();
            entity.Property(item => item.PreviewHash).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(item => item.RequestJson).HasColumnType("jsonb").IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.MesocycleId, item.PreviewHash }).IsUnique();
            entity.HasOne<TrainingMesocycle>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ProgressionApplications_Hash",
                "\"PreviewHash\" ~ '^[0-9a-f]{64}$'"));
            ConfigureTenantEntity(entity);
        });
    }

    private static void ConfigureTemplateSetProperties(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<ProgramTemplateSet> entity)
    {
        entity.Property(item => item.SetType).HasConversion<string>().HasMaxLength(24);
        entity.Property(item => item.LoadStrategy).HasConversion<string>().HasMaxLength(32);
        entity.Property(item => item.DirectLoad).HasPrecision(8, 3);
        entity.Property(item => item.LoadUnit).HasConversion<string>().HasMaxLength(16);
        entity.Property(item => item.PercentageWorkingMax).HasPrecision(6, 3);
        entity.Property(item => item.TargetRpe).HasPrecision(3, 1);
        entity.Property(item => item.ExertionDisplayPreference).HasConversion<string>().HasMaxLength(16);
        entity.Property(item => item.Tempo).HasMaxLength(32);
        entity.Property(item => item.CoachNotes).HasMaxLength(1_000);
        entity.ToTable(table => ConfigureSetChecks(table, "ProgramTemplateSets"));
    }

    private static void ConfigureSetProperties(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<SetPrescription> entity)
    {
        entity.Property(item => item.SetType).HasConversion<string>().HasMaxLength(24);
        entity.Property(item => item.LoadStrategy).HasConversion<string>().HasMaxLength(32);
        entity.Property(item => item.DirectLoad).HasPrecision(8, 3);
        entity.Property(item => item.LoadUnit).HasConversion<string>().HasMaxLength(16);
        entity.Property(item => item.PercentageWorkingMax).HasPrecision(6, 3);
        entity.Property(item => item.TargetRpe).HasPrecision(3, 1);
        entity.Property(item => item.ExertionDisplayPreference).HasConversion<string>().HasMaxLength(16);
        entity.Property(item => item.Tempo).HasMaxLength(32);
        entity.Property(item => item.CoachNotes).HasMaxLength(1_000);
        entity.ToTable(table => ConfigureSetChecks(table, "SetPrescriptions"));
    }

    private static void ConfigureSetChecks(
        Microsoft.EntityFrameworkCore.Metadata.Builders.TableBuilder table,
        string prefix)
    {
        table.HasCheckConstraint($"CK_{prefix}_Position", "\"Position\" >= 0");
        table.HasCheckConstraint(
            $"CK_{prefix}_Repetitions",
            "(\"RepetitionsMinimum\" IS NULL OR (\"RepetitionsMinimum\" >= 1 AND \"RepetitionsMinimum\" <= 100)) AND (\"RepetitionsMaximum\" IS NULL OR (\"RepetitionsMaximum\" >= 1 AND \"RepetitionsMaximum\" <= 100)) AND (\"RepetitionsMinimum\" IS NULL OR \"RepetitionsMaximum\" IS NULL OR \"RepetitionsMinimum\" <= \"RepetitionsMaximum\")");
        table.HasCheckConstraint(
            $"CK_{prefix}_TargetRpe",
            "\"TargetRpe\" IS NULL OR (\"TargetRpe\" >= 5 AND \"TargetRpe\" <= 10 AND mod(\"TargetRpe\" * 2, 1) = 0)");
        table.HasCheckConstraint(
            $"CK_{prefix}_Rest",
            "\"RestSeconds\" IS NULL OR (\"RestSeconds\" >= 0 AND \"RestSeconds\" <= 3600)");
        table.HasCheckConstraint(
            $"CK_{prefix}_LoadStrategy",
            "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'RpeBasedEpley' AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");
    }
}
