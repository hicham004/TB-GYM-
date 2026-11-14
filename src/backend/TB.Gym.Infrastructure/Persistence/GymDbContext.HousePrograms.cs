using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    public DbSet<HouseProgramListing> HouseProgramListings => Set<HouseProgramListing>();

    public DbSet<HouseProgramStart> HouseProgramStarts => Set<HouseProgramStart>();

    /// <summary>
    /// The house's programs for its trainees (TRN-034, notes plan N9c3): the Training module's, tenant-owned like any
    /// other row and kept in the house alone by a trigger. A listing is a mutable setting with a row version; a start
    /// is append-only and checked by a trigger to name the trainee's own program under their own Pro+ plan.
    /// </summary>
    private void ConfigureHousePrograms(ModelBuilder builder)
    {
        builder.Entity<HouseProgramListing>(entity =>
        {
            entity.ToTable("HouseProgramListings", "training", table =>
            {
                table.HasCheckConstraint(
                    "CK_HouseProgramListings_Run",
                    "(\"RunName\" IS NULL AND \"RunKey\" IS NULL AND \"RunPosition\" IS NULL) OR " +
                    "(\"RunName\" IS NOT NULL AND \"RunKey\" IS NOT NULL AND \"RunPosition\" IS NOT NULL AND \"RunPosition\" BETWEEN 1 AND 52)");
                table.HasCheckConstraint(
                    "CK_HouseProgramListings_Suits",
                    "length(btrim(\"Suits\")) > 0");
                table.HasCheckConstraint(
                    "CK_HouseProgramListings_LoadIncrement",
                    "\"LoadIncrement\" > 0 AND \"LoadIncrement\" <= 50");
            });
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Suits).HasMaxLength(HouseProgramRules.SuitsMaximumLength);
            entity.Property(item => item.RunName).HasMaxLength(HouseProgramRules.RunNameMaximumLength);
            entity.Property(item => item.RunKey).HasMaxLength(HouseProgramRules.RunNameMaximumLength);
            entity.Property(item => item.LoadIncrement).HasPrecision(8, 3);
            entity.Property(item => item.LoadRoundingMode).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(item => new { item.TenantId, item.TemplateId }, DatabaseConstraintNames.OneHouseProgramListing)
                .IsUnique();
            // Two blocks offered at one place of a run would leave the next block ambiguous (TRN-034).
            entity.HasIndex(
                    item => new { item.TenantId, item.RunKey, item.RunPosition },
                    DatabaseConstraintNames.OneOfferedBlockPerRunPlace)
                .IsUnique()
                .HasFilter("\"IsOffered\" AND \"RunKey\" IS NOT NULL");
            entity.HasOne<ProgramTemplate>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.TemplateId })
                .HasPrincipalKey(template => new { template.TenantId, template.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<HouseProgramStart>(entity =>
        {
            entity.ToTable("HouseProgramStarts", "training", table =>
                table.HasCheckConstraint(
                    "CK_HouseProgramStarts_Run",
                    "(\"RunName\" IS NULL AND \"RunKey\" IS NULL AND \"RunPosition\" IS NULL) OR " +
                    "(\"RunName\" IS NOT NULL AND \"RunKey\" IS NOT NULL AND \"RunPosition\" IS NOT NULL AND \"RunPosition\" BETWEEN 1 AND 52)"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.RunName).HasMaxLength(HouseProgramRules.RunNameMaximumLength);
            entity.Property(item => item.RunKey).HasMaxLength(HouseProgramRules.RunNameMaximumLength);
            entity.Property(item => item.StartDate).HasColumnType("date");
            entity.HasIndex(item => new { item.TenantId, item.MesocycleId }, DatabaseConstraintNames.OneHouseProgramStartPerProgram)
                .IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.RunKey, item.RunPosition });
            entity.HasIndex(item => new { item.TenantId, item.ListingId });
            entity.HasOne<TrainingMesocycle>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MesocycleId })
                .HasPrincipalKey(mesocycle => new { mesocycle.TenantId, mesocycle.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<HouseProgramListing>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ListingId })
                .HasPrincipalKey(listing => new { listing.TenantId, listing.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ProgramTemplateVersion>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.TemplateVersionId })
                .HasPrincipalKey(version => new { version.TenantId, version.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientEnrollment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.EnrollmentId })
                .HasPrincipalKey(enrollment => new { enrollment.TenantId, enrollment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });
    }
}
