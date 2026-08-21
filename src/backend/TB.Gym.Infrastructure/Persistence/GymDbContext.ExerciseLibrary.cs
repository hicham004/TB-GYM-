using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureExerciseLibrary(ModelBuilder builder)
    {
        builder.Entity<Exercise>(entity =>
        {
            entity.ToTable("Exercises", "exercise_library");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.Property(item => item.NormalizedName).HasMaxLength(160).IsRequired();
            entity.Property(item => item.Instructions).HasMaxLength(8_000);
            entity.Property(item => item.Equipment).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.MovementPattern).HasConversion<string>().HasMaxLength(40);
            entity.Property(item => item.Classification).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.NormalizedName }).IsUnique();
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.IsArchived,
                item.Classification,
                item.Equipment,
                item.MovementPattern,
            });
            entity.HasMany(item => item.Muscles)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Tags)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Alternatives)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(item => item.Media)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExerciseMuscle>(entity =>
        {
            entity.ToTable("ExerciseMuscles", "exercise_library");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Muscle).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Role).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(item => new { item.TenantId, item.ExerciseId, item.Muscle, item.Role }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.Muscle, item.Role });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExerciseTag>(entity =>
        {
            entity.ToTable("ExerciseTags", "exercise_library");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Value).HasMaxLength(60).IsRequired();
            entity.Property(item => item.NormalizedValue).HasMaxLength(60).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ExerciseId, item.NormalizedValue }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.NormalizedValue });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExerciseAlternative>(entity =>
        {
            entity.ToTable("ExerciseAlternatives", "exercise_library");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Note).HasMaxLength(500);
            entity.HasIndex(item => new { item.TenantId, item.ExerciseId, item.AlternativeExerciseId }).IsUnique();
            entity.HasOne<Exercise>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.AlternativeExerciseId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ExerciseAlternatives_DifferentExercise",
                "\"ExerciseId\" <> \"AlternativeExerciseId\""));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ExerciseMediaLink>(entity =>
        {
            entity.ToTable("ExerciseMediaLinks", "exercise_library");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.ExerciseId, item.MediaAssetId }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.MediaAssetId });
            entity.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MediaAssetId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ExerciseMediaLinks_DisplayOrder",
                "\"DisplayOrder\" >= 0"));
            ConfigureTenantEntity(entity);
        });
    }
}
