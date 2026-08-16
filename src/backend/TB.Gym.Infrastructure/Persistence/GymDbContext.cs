using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
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

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        ConfigureIdentity(builder);
        ConfigureTenancy(builder);
        ConfigureClients(builder);
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
            entity.Property(user => user.CreatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(user => user.UpdatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
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
            entity.HasIndex(tenant => tenant.Slug).IsUnique();
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
            entity.Property(client => client.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(client => client.LastName).HasMaxLength(100).IsRequired();
            entity.Property(client => client.Email).HasMaxLength(320).IsRequired();
            entity.Property(client => client.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(client => client.PhoneNumber).HasMaxLength(32);
            entity.Property(client => client.BirthDate).HasColumnType("date");
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
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasQueryFilter(client =>
                tenantContext.HasTenant && client.TenantId == tenantContext.TenantId);
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
