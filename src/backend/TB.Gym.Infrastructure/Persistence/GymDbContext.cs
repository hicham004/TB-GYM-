using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Persistence;

public sealed class GymDbContext(
    DbContextOptions<GymDbContext> options,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();

    public DbSet<TenantMembership> TenantMemberships => Set<TenantMembership>();

    public DbSet<ClientProfile> ClientProfiles => Set<ClientProfile>();

    public DbSet<ClientProfileChange> ClientProfileChanges => Set<ClientProfileChange>();

    public DbSet<ClientInvitation> ClientInvitations => Set<ClientInvitation>();

    public DbSet<InvitationDelivery> InvitationDeliveries => Set<InvitationDelivery>();

    public DbSet<AccountEmailDelivery> AccountEmailDeliveries => Set<AccountEmailDelivery>();

    public DbSet<BodyweightObservation> BodyweightObservations => Set<BodyweightObservation>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        ConfigureIdentity(builder);
        ConfigureTenancy(builder);
        ConfigureClients(builder);
        ConfigureInvitations(builder);
        ConfigureProgress(builder);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyPersistenceRules();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        ApplyPersistenceRules();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private static void ConfigureIdentity(ModelBuilder builder)
    {
        builder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("Users", "identity");
            entity.Property(user => user.DisplayName).HasMaxLength(200);
            entity.Property(user => user.PreferredCulture).HasMaxLength(20).HasDefaultValue("en-LB");
            entity.Property(user => user.CreatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(user => user.UpdatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
        });

        builder.Entity<AccountEmailDelivery>(entity =>
        {
            entity.ToTable("AccountEmailDeliveries", "identity");
            entity.HasKey(delivery => delivery.Id);
            entity.Property(delivery => delivery.Recipient).HasMaxLength(320).IsRequired();
            entity.Property(delivery => delivery.Purpose).HasConversion<string>().HasMaxLength(32);
            entity.Property(delivery => delivery.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(delivery => delivery.ProviderMessageId).HasMaxLength(200);
            entity.Property(delivery => delivery.FailureCode).HasMaxLength(100);
            entity.HasIndex(delivery => new { delivery.UserId, delivery.CreatedAtUtc });
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(delivery => delivery.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            ConfigureAuditable(entity);
        });

        builder.Entity<IdentityRole<Guid>>().ToTable("Roles", "identity");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("UserRoles", "identity");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("UserClaims", "identity");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("UserLogins", "identity");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("RoleClaims", "identity");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("UserTokens", "identity");
    }

    private static void ConfigureTenancy(ModelBuilder builder)
    {
        builder.Entity<Tenant>(entity =>
        {
            entity.ToTable("Tenants", "tenancy");
            entity.HasKey(tenant => tenant.Id);
            entity.Property(tenant => tenant.Name).HasMaxLength(200).IsRequired();
            entity.Property(tenant => tenant.Slug).HasMaxLength(100).IsRequired();
            entity.Property(tenant => tenant.TimeZoneId)
                .HasMaxLength(100)
                .HasDefaultValue("Asia/Beirut")
                .IsRequired();
            entity.Property(tenant => tenant.DefaultCulture)
                .HasMaxLength(20)
                .HasDefaultValue("en-LB")
                .IsRequired();
            entity.Property(tenant => tenant.DefaultCurrencyCode)
                .HasMaxLength(3)
                .IsFixedLength()
                .HasDefaultValue("USD")
                .IsRequired();
            entity.Property(tenant => tenant.WeekStartsOn)
                .HasConversion<string>()
                .HasMaxLength(16)
                .HasDefaultValue(DayOfWeek.Monday)
                .HasSentinel((DayOfWeek)(-1));
            entity.HasIndex(tenant => tenant.Slug).IsUnique();
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Tenants_DefaultCurrencyCode",
                "\"DefaultCurrencyCode\" ~ '^[A-Z]{3}$'"));
            ConfigureAuditable(entity);
        });

        builder.Entity<TenantMembership>(entity =>
        {
            entity.ToTable("Memberships", "tenancy");
            entity.HasKey(membership => membership.Id);
            entity.Property(membership => membership.Role).HasConversion<string>().HasMaxLength(32);
            entity.Property(membership => membership.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(membership => new { membership.TenantId, membership.UserId }).IsUnique();
            entity.HasIndex(membership => new { membership.UserId, membership.Status });
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(membership => membership.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(membership => membership.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureClients(ModelBuilder builder)
    {
        builder.Entity<ClientProfile>(entity =>
        {
            entity.ToTable("ClientProfiles", "clients");
            entity.HasKey(client => client.Id);
            entity.HasAlternateKey(client => new { client.TenantId, client.Id });
            entity.Property(client => client.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(client => client.LastName).HasMaxLength(100).IsRequired();
            entity.Property(client => client.Email).HasMaxLength(320).IsRequired();
            entity.Property(client => client.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(client => client.PhoneNumber).HasMaxLength(32);
            entity.Property(client => client.BirthDate).HasColumnType("date");
            entity.Property(client => client.HeightCentimeters).HasPrecision(6, 2);
            entity.Property(client => client.HeightEnteredValue).HasPrecision(7, 2);
            entity.Property(client => client.HeightEnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(client => client.WorkType).HasMaxLength(200);
            entity.Property(client => client.TrainingBackground).HasMaxLength(4_000);
            entity.Property(client => client.FoodPreferences).HasMaxLength(4_000);
            entity.Property(client => client.FoodAversions).HasMaxLength(4_000);
            entity.Property(client => client.Goals).HasMaxLength(4_000);
            entity.Property(client => client.Allergies).HasMaxLength(4_000);
            entity.Property(client => client.Medications).HasMaxLength(4_000);
            entity.Property(client => client.PreviousInjuries).HasMaxLength(4_000);
            entity.Property(client => client.CoachNotes).HasMaxLength(8_000);
            entity.Property(client => client.OnboardingStatus)
                .HasConversion<string>()
                .HasMaxLength(32)
                .HasDefaultValue(ClientOnboardingStatus.NotStarted)
                .HasSentinel((ClientOnboardingStatus)0);
            entity.HasIndex(client => new { client.TenantId, client.NormalizedEmail }).IsUnique();
            entity.HasIndex(client => new { client.TenantId, client.UserId })
                .IsUnique()
                .HasFilter("\"UserId\" IS NOT NULL");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(client => client.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(client => client.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(client =>
                tenantContext.HasTenant && client.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ClientProfiles_HeightCentimeters",
                    "\"HeightCentimeters\" IS NULL OR (\"HeightCentimeters\" >= 50 AND \"HeightCentimeters\" <= 300)");
                table.HasCheckConstraint(
                    "CK_ClientProfiles_AverageDailySteps",
                    "\"AverageDailySteps\" IS NULL OR (\"AverageDailySteps\" >= 0 AND \"AverageDailySteps\" <= 100000)");
                table.HasCheckConstraint(
                    "CK_ClientProfiles_CompletedOnboarding",
                    "\"OnboardingStatus\" <> 'Completed' OR (\"BirthDate\" IS NOT NULL AND \"HeightCentimeters\" IS NOT NULL AND \"Goals\" IS NOT NULL AND \"OnboardingCompletedAtUtc\" IS NOT NULL)");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<ClientProfileChange>(entity =>
        {
            entity.ToTable("ClientProfileChanges", "clients");
            entity.HasKey(change => change.Id);
            entity.Property(change => change.Source).HasConversion<string>().HasMaxLength(32);
            entity.Property(change => change.ChangedFields).HasMaxLength(1_000).IsRequired();
            entity.HasIndex(change => new { change.TenantId, change.ClientProfileId, change.CreatedAtUtc });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(change => new { change.TenantId, change.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(change =>
                tenantContext.HasTenant && change.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureInvitations(ModelBuilder builder)
    {
        builder.Entity<ClientInvitation>(entity =>
        {
            entity.ToTable("ClientInvitations", "invitations");
            entity.HasKey(invitation => invitation.Id);
            entity.HasAlternateKey(invitation => new { invitation.TenantId, invitation.Id });
            entity.Property(invitation => invitation.Email).HasMaxLength(320).IsRequired();
            entity.Property(invitation => invitation.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(invitation => invitation.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(invitation => invitation.LastName).HasMaxLength(100).IsRequired();
            entity.Property(invitation => invitation.PhoneNumber).HasMaxLength(32);
            entity.Property(invitation => invitation.BirthDate).HasColumnType("date");
            entity.Property(invitation => invitation.TokenHash).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(invitation => invitation.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(invitation => invitation.TokenHash).IsUnique();
            entity.HasIndex(invitation => new { invitation.TenantId, invitation.NormalizedEmail })
                .IsUnique()
                .HasFilter("\"Status\" = 'Pending'");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(invitation => invitation.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(invitation => invitation.AcceptedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(invitation =>
                tenantContext.HasTenant && invitation.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ClientInvitations_SendCount",
                    "\"SendCount\" >= 1");
                table.HasCheckConstraint(
                    "CK_ClientInvitations_AcceptedState",
                    "\"Status\" <> 'Accepted' OR (\"AcceptedByUserId\" IS NOT NULL AND \"AcceptedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_ClientInvitations_TokenHash",
                    "char_length(\"TokenHash\") = 64");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<InvitationDelivery>(entity =>
        {
            entity.ToTable("InvitationDeliveries", "invitations");
            entity.HasKey(delivery => delivery.Id);
            entity.Property(delivery => delivery.Recipient).HasMaxLength(320).IsRequired();
            entity.Property(delivery => delivery.Channel).HasConversion<string>().HasMaxLength(16);
            entity.Property(delivery => delivery.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(delivery => delivery.ProviderMessageId).HasMaxLength(200);
            entity.Property(delivery => delivery.FailureCode).HasMaxLength(100);
            entity.HasIndex(delivery => new { delivery.TenantId, delivery.InvitationId, delivery.AttemptNumber })
                .IsUnique();
            entity.HasOne<ClientInvitation>()
                .WithMany()
                .HasForeignKey(delivery => new { delivery.TenantId, delivery.InvitationId })
                .HasPrincipalKey(invitation => new { invitation.TenantId, invitation.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(delivery =>
                tenantContext.HasTenant && delivery.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureProgress(ModelBuilder builder)
    {
        builder.Entity<BodyweightObservation>(entity =>
        {
            entity.ToTable("BodyweightObservations", "progress");
            entity.HasKey(observation => observation.Id);
            entity.Property(observation => observation.MeasurementDate).HasColumnType("date");
            entity.Property(observation => observation.ValueKilograms).HasPrecision(7, 3);
            entity.Property(observation => observation.EnteredValue).HasPrecision(8, 3);
            entity.Property(observation => observation.EnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(observation => observation.Source).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(observation => new
            {
                observation.TenantId,
                observation.ClientProfileId,
                observation.MeasurementDate,
            }).IsUnique();
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(observation => new { observation.TenantId, observation.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(observation =>
                tenantContext.HasTenant && observation.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_BodyweightObservations_ValueKilograms",
                "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500"));
            ConfigureAuditable(entity);
        });
    }

    private static void ConfigureAuditable<TEntity>(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> entity)
        where TEntity : AuditableEntity
    {
        entity.Property(item => item.CreatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
        entity.Property(item => item.UpdatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
        entity.Property(item => item.Version).IsRowVersion();
    }

    private void ApplyPersistenceRules()
    {
        var now = clock.UtcNow;
        var userId = currentUser.UserId;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.StampCreation(now, userId);
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.StampUpdate(now, userId);
            }
        }

        foreach (var entry in ChangeTracker.Entries<ITenantOwnedEntity>()
                     .Where(item => item.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            if (!tenantContext.HasTenant || entry.Entity.TenantId != tenantContext.TenantId)
            {
                throw new InvalidOperationException("A tenant-owned record cannot be written outside the active tenant scope.");
            }
        }
    }
}
