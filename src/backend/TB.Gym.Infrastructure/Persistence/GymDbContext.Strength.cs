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
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.MesocycleId,
                item.ExerciseId,
                item.EffectiveFromWeek,
            }).IsUnique();
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
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_WorkingMaxSnapshots_Value",
                    "\"Value\" > 0 AND \"Value\" <= 2000");
                table.HasCheckConstraint(
                    "CK_WorkingMaxSnapshots_EffectiveWeek",
                    "\"EffectiveFromWeek\" >= 1 AND \"EffectiveFromWeek\" <= 52");
            });
            ConfigureTenantEntity(entity);
        });
    }
}
