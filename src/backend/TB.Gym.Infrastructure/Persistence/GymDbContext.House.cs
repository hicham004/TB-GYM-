using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    public DbSet<HouseSettingChange> HouseSettingChanges => Set<HouseSettingChange>();

    public DbSet<TraineeSignUp> TraineeSignUps => Set<TraineeSignUp>();

    /// <summary>
    /// The house (ADR 0041): the mark on one workspace, its settings and its sign-ups, all the Tenancy module's.
    /// The rows are tenant-owned like any other, so a coaching space never reads them; database triggers keep them
    /// in the house alone and keep the mark while the house holds anyone.
    /// </summary>
    private void ConfigureHouse(ModelBuilder builder)
    {
        builder.Entity<Tenant>(entity =>
        {
            entity.Property(tenant => tenant.IsHouse).HasDefaultValue(false);
            // At most one house (CLI-022): a second mark is refused by the index, whoever writes it.
            entity.HasIndex(tenant => tenant.IsHouse, "UX_Tenants_House")
                .IsUnique()
                .HasFilter("\"IsHouse\"");
        });

        builder.Entity<HouseSettingChange>(entity =>
        {
            entity.ToTable("HouseSettingChanges", "tenancy", table =>
            {
                table.HasCheckConstraint("CK_HouseSettingChanges_Sequence", "\"Sequence\" >= 1");
                table.HasCheckConstraint(
                    "CK_HouseSettingChanges_Value",
                    "\"Value\" IS NULL OR (\"Value\" <> '' AND btrim(\"Value\") = \"Value\")");
            });
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Setting).HasConversion<string>().HasMaxLength(40);
            entity.Property(item => item.Value).HasMaxLength(HouseSettingRule.ValueMaximumLength);
            // The highest number of a setting is in force; two admins saving at once cannot both take one.
            entity.HasIndex(item => new { item.TenantId, item.Setting, item.Sequence }).IsUnique();
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.ChangedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<TraineeSignUp>(entity =>
        {
            entity.ToTable("TraineeSignUps", "tenancy", table =>
            {
                // A waiting sign-up holds what the person typed and no profile; a confirmed one names its
                // profile and holds nothing typed, which lives on the profile alone.
                table.HasCheckConstraint(
                    "CK_TraineeSignUps_State",
                    "(\"ConfirmedAtUtc\" IS NULL AND \"ClientProfileId\" IS NULL AND \"FirstName\" IS NOT NULL AND \"LastName\" IS NOT NULL AND \"BirthDate\" IS NOT NULL) OR " +
                    "(\"ConfirmedAtUtc\" IS NOT NULL AND \"ConfirmedAtUtc\" >= \"RequestedAtUtc\" AND \"ClientProfileId\" IS NOT NULL AND \"FirstName\" IS NULL AND \"LastName\" IS NULL AND \"BirthDate\" IS NULL)");
            });
            entity.HasKey(item => item.Id);
            entity.Property(item => item.FirstName).HasMaxLength(TraineeSignUp.NameMaximumLength);
            entity.Property(item => item.LastName).HasMaxLength(TraineeSignUp.NameMaximumLength);
            entity.Property(item => item.BirthDate).HasColumnType("date");
            // The week's count.
            entity.HasIndex(item => new { item.TenantId, item.RequestedAtUtc });
            // One waiting sign-up per account; the confirmation and the sweep find it by the account.
            entity.HasIndex(item => item.UserId, "UX_TraineeSignUps_Waiting")
                .IsUnique()
                .HasFilter("\"ConfirmedAtUtc\" IS NULL");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });
    }
}
