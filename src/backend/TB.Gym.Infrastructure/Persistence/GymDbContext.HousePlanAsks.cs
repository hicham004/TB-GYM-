using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    public DbSet<HousePlanAsk> HousePlanAsks => Set<HousePlanAsk>();

    public DbSet<HousePlanTransfer> HousePlanTransfers => Set<HousePlanTransfer>();

    public DbSet<HousePlanAskOutcome> HousePlanAskOutcomes => Set<HousePlanAskOutcome>();

    /// <summary>
    /// The house's asks for a paid plan (SUB-020): the Subscriptions module's, tenant-owned like any other row and
    /// kept in the house alone by a trigger. Each table is append-only; the one change a trainee's word on the money
    /// ever takes is the erasure of its Whish details when the account closes (CLI-027).
    /// </summary>
    private void ConfigureHousePlanAsks(ModelBuilder builder)
    {
        builder.Entity<HousePlanAsk>(entity =>
        {
            entity.ToTable("HousePlanAsks", "subscriptions", table =>
                table.HasCheckConstraint("CK_HousePlanAsks_Tier", "\"Tier\" IN ('ProPlus', 'Max')"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Tier).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.AskedOn).HasColumnType("date");
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.AskedAtUtc });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CoachingProduct>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ProductId })
                .HasPrincipalKey(product => new { product.TenantId, product.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ProductOffer>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.OfferId })
                .HasPrincipalKey(offer => new { offer.TenantId, offer.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.AskedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<HousePlanTransfer>(entity =>
        {
            entity.ToTable("HousePlanTransfers", "subscriptions", table =>
                // The Whish details are there until the account closes, then gone, both at once.
                table.HasCheckConstraint(
                    "CK_HousePlanTransfers_Anonymised",
                    "(\"AnonymisedAtUtc\" IS NULL AND \"WhishName\" IS NOT NULL AND \"WhishNumber\" IS NOT NULL) OR " +
                    "(\"AnonymisedAtUtc\" IS NOT NULL AND \"WhishName\" IS NULL AND \"WhishNumber\" IS NULL)"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.WhishName).HasMaxLength(HousePlanAskRule.WhishNameMaximumLength);
            entity.Property(item => item.WhishNumber).HasMaxLength(HousePlanAskRule.WhishNumberMaximumLength);
            entity.Property(item => item.SentOn).HasColumnType("date");
            entity.HasIndex(item => new { item.TenantId, item.AskId }, DatabaseConstraintNames.OneHousePlanTransfer)
                .IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId });
            entity.HasOne<HousePlanAsk>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.AskId })
                .HasPrincipalKey(ask => new { ask.TenantId, ask.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<HousePlanAskOutcome>(entity =>
        {
            entity.ToTable("HousePlanAskOutcomes", "subscriptions", table =>
            {
                // A booking names its plan, its receipt and the key both carry, and no reason; a closing a reason alone.
                table.HasCheckConstraint(
                    "CK_HousePlanAskOutcomes_Kind",
                    "(\"Kind\" = 'Booked' AND \"EnrollmentId\" IS NOT NULL AND \"PaymentRecordId\" IS NOT NULL AND \"CommandId\" IS NOT NULL AND \"Reason\" IS NULL) OR " +
                    "(\"Kind\" = 'Closed' AND \"EnrollmentId\" IS NULL AND \"PaymentRecordId\" IS NULL AND \"CommandId\" IS NULL AND \"Reason\" IS NOT NULL AND \"Reason\" <> '')");
            });
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Reason).HasMaxLength(HousePlanAskRule.ReasonMaximumLength);
            entity.Property(item => item.DecidedOn).HasColumnType("date");
            entity.HasIndex(item => new { item.TenantId, item.AskId }, DatabaseConstraintNames.OneHousePlanAskOutcome)
                .IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId }).IsUnique()
                .HasFilter("\"EnrollmentId\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.CommandId }).IsUnique()
                .HasFilter("\"CommandId\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId });
            entity.HasOne<HousePlanAsk>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.AskId })
                .HasPrincipalKey(ask => new { ask.TenantId, ask.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientEnrollment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.EnrollmentId })
                .HasPrincipalKey(enrollment => new { enrollment.TenantId, enrollment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PaymentRecord>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.PaymentRecordId })
                .HasPrincipalKey(payment => new { payment.TenantId, payment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.DecidedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });
    }
}
