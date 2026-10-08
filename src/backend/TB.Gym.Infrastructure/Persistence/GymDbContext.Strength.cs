using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureStrength(ModelBuilder builder)
    {
        builder.Entity<StrengthMaxRecord>(entity =>
        {
            entity.ToTable("MaxHistory", "strength");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Value).HasPrecision(8, 3);
            entity.Property(item => item.Unit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.EffectiveDate).HasColumnType("date");
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.MethodKey).HasMaxLength(80).IsRequired();
            entity.Property(item => item.MethodVersion).HasMaxLength(40).IsRequired();
            entity.Property(item => item.Note).HasMaxLength(1_000);
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.ClientProfileId,
                item.ExerciseId,
                item.EffectiveDate,
                item.CreatedAtUtc,
            });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<WorkoutExecution>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceWorkoutExecutionId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_StrengthMaxHistory_Value",
                "\"Value\" > 0 AND \"Value\" <= 2000"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MesocycleWorkingMaxSnapshot>(entity =>
        {
            entity.ToTable("WorkingMaxSnapshots", "strength");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Value).HasPrecision(8, 3);
            entity.Property(item => item.Unit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.Property(item => item.BasisLoad).HasPrecision(8, 3);
            entity.Property(item => item.BasisRpe).HasPrecision(3, 1);
            entity.Property(item => item.EstimateMethodKey).HasMaxLength(80);
            entity.Property(item => item.EstimateMethodVersion).HasMaxLength(40);
            entity.Ignore(item => item.Source);
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.MesocycleId,
                item.ExerciseId,
                item.EffectiveFromWeek,
            });

            // A lift's maxes in one program form a single chain (STR-002): one first max, and each max
            // superseded by at most one newer one, so two updates cannot both supersede the same max.
            entity.HasIndex(item => new { item.TenantId, item.MesocycleId, item.ExerciseId })
                .IsUnique()
                .HasFilter("\"SupersedesSnapshotId\" IS NULL")
                .HasDatabaseName(DatabaseConstraintNames.OneFirstTrainingMaxPerLift);
            entity.HasIndex(item => new { item.TenantId, item.SupersedesSnapshotId })
                .IsUnique()
                .HasFilter("\"SupersedesSnapshotId\" IS NOT NULL")
                .HasDatabaseName(DatabaseConstraintNames.OneSuccessorPerTrainingMax);
            entity.HasOne<TrainingMesocycle>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<StrengthMaxRecord>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceMaxRecordId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MesocycleWorkingMaxSnapshot>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SupersedesSnapshotId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<WorkoutSetPerformance>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceSetPerformanceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                // A max estimated from a logged set keeps that set's numbers beside the link (P4b, STR-007).
                table.HasCheckConstraint(
                    "CK_WorkingMaxSnapshots_LoggedSetBasis",
                    "\"SourceSetPerformanceId\" IS NULL OR \"BasisLoad\" IS NOT NULL");
                table.HasCheckConstraint(
                    "CK_WorkingMaxSnapshots_Value",
                    "\"Value\" > 0 AND \"Value\" <= 2000");
                table.HasCheckConstraint(
                    "CK_WorkingMaxSnapshots_EffectiveWeek",
                    "\"EffectiveFromWeek\" >= 1 AND \"EffectiveFromWeek\" <= 52");

                // A max worked out from a set (week 1's weight, or a logged set) keeps the set and the method
                // behind it, all or nothing, and has no saved max behind it (STR-011).
                table.HasCheckConstraint(
                    "CK_WorkingMaxSnapshots_WeekOneBasis",
                    "(\"BasisLoad\" IS NULL AND \"BasisRepetitions\" IS NULL AND \"BasisRpe\" IS NULL AND \"EstimateMethodKey\" IS NULL AND \"EstimateMethodVersion\" IS NULL) OR (\"BasisLoad\" > 0 AND \"BasisLoad\" <= 2000 AND \"BasisRepetitions\" >= 1 AND \"BasisRepetitions\" <= 100 AND \"BasisRpe\" >= 5 AND \"BasisRpe\" <= 10 AND \"EstimateMethodKey\" IS NOT NULL AND \"EstimateMethodVersion\" IS NOT NULL AND \"SourceMaxRecordId\" IS NULL)");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<WorkingMaxUpdate>(entity =>
        {
            entity.ToTable("WorkingMaxUpdates", "strength");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.RequestFingerprint).HasMaxLength(64).IsRequired();
            entity.Property(item => item.PreviewHash).HasMaxLength(64).IsRequired();
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneTrainingMaxUpdatePerKey);
            entity.HasIndex(item => new { item.TenantId, item.MesocycleId, item.CreatedAtUtc });
            entity.HasOne<TrainingMesocycle>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_WorkingMaxUpdates_Counts",
                    "\"EffectiveFromWeek\" >= 1 AND \"EffectiveFromWeek\" <= 52 AND \"LiftCount\" >= 1 AND \"SessionCount\" >= 0 AND \"SetCount\" >= 0");
                table.HasCheckConstraint(
                    "CK_WorkingMaxUpdates_Hashes",
                    "char_length(\"RequestFingerprint\") = 64 AND char_length(\"PreviewHash\") = 64");
            });
            ConfigureTenantEntity(entity);
        });
    }
}
