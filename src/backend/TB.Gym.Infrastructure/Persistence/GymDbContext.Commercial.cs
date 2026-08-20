using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureCommercial(ModelBuilder builder)
    {
        builder.Entity<CoachingProduct>(entity =>
        {
            entity.ToTable("CoachingProducts", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.Property(item => item.Name).HasMaxLength(160).IsRequired();
            entity.Property(item => item.Description).HasMaxLength(2_000);
            entity.HasIndex(item => new { item.TenantId, item.Name });
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });

        builder.Entity<ProductOffer>(entity =>
        {
            entity.ToTable("ProductOffers", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.Property(item => item.Label).HasMaxLength(120).IsRequired();
            entity.Property(item => item.BillingModel).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.DurationUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.PriceAmount).HasPrecision(18, 2);
            entity.Property(item => item.PriceCurrency).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ProductId, item.IsActive });
            entity.HasOne<CoachingProduct>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ProductId })
                .HasPrincipalKey(product => new { product.TenantId, product.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Entitlements)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.OfferId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ProductOffers_Duration",
                    "\"DurationCount\" > 0 AND \"DurationCount\" <= 3650");
                table.HasCheckConstraint(
                    "CK_ProductOffers_PriceAmount",
                    "\"PriceAmount\" >= 0");
                table.HasCheckConstraint(
                    "CK_ProductOffers_PriceCurrency",
                    "\"PriceCurrency\" ~ '^[A-Z]{3}$'");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<OfferEntitlement>(entity =>
        {
            entity.ToTable("OfferEntitlements", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Feature).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.OfferId, item.Feature }).IsUnique();
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });

        builder.Entity<ClientEnrollment>(entity =>
        {
            entity.ToTable("ClientEnrollments", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.Property(item => item.ProductNameSnapshot).HasMaxLength(160).IsRequired();
            entity.Property(item => item.OfferLabelSnapshot).HasMaxLength(120).IsRequired();
            entity.Property(item => item.PriceAmount).HasPrecision(18, 2);
            entity.Property(item => item.PriceCurrency).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.Property(item => item.StartDate).HasColumnType("date");
            entity.Property(item => item.EndDateExclusive).HasColumnType("date");
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.StatusReason).HasMaxLength(500);
            entity.HasIndex(item => new { item.TenantId, item.AssignmentCommandId }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.StartDate });
            entity.HasIndex(item => new { item.TenantId, item.RenewedFromEnrollmentId });
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
            entity.HasMany(item => item.Entitlements)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.EnrollmentId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ClientEnrollments_Period",
                    "\"EndDateExclusive\" > \"StartDate\"");
                table.HasCheckConstraint(
                    "CK_ClientEnrollments_PriceAmount",
                    "\"PriceAmount\" >= 0");
                table.HasCheckConstraint(
                    "CK_ClientEnrollments_PriceCurrency",
                    "\"PriceCurrency\" ~ '^[A-Z]{3}$'");
                table.HasCheckConstraint(
                    "CK_ClientEnrollments_CancelledState",
                    "\"Status\" <> 'Cancelled' OR \"CancelledAtUtc\" IS NOT NULL");
                table.HasCheckConstraint(
                    "CK_ClientEnrollments_ExpiredState",
                    "\"Status\" <> 'Expired' OR \"ExpiredAtUtc\" IS NOT NULL");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<EnrollmentEntitlement>(entity =>
        {
            entity.ToTable("EnrollmentEntitlements", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.StartDate).HasColumnType("date");
            entity.Property(item => item.EndDateExclusive).HasColumnType("date");
            entity.Property(item => item.Feature).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId, item.Feature }).IsUnique();
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.ClientProfileId,
                item.Feature,
                item.StartDate,
                item.EndDateExclusive,
            });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_EnrollmentEntitlements_Period",
                "\"EndDateExclusive\" > \"StartDate\""));
            ConfigureAuditable(entity);
        });

        builder.Entity<PaymentRecord>(entity =>
        {
            entity.ToTable("PaymentRecords", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Amount).HasPrecision(18, 2);
            entity.Property(item => item.CurrencyCode).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.Property(item => item.Method).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Reference).HasMaxLength(200);
            entity.Property(item => item.Note).HasMaxLength(2_000);
            entity.Property(item => item.Operation).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.IdempotencyKey }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId, item.ReceivedAtUtc });
            entity.HasOne<ClientEnrollment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.EnrollmentId })
                .HasPrincipalKey(enrollment => new { enrollment.TenantId, enrollment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RecordedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_PaymentRecords_Amount", "\"Amount\" > 0");
                table.HasCheckConstraint(
                    "CK_PaymentRecords_CurrencyCode",
                    "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
            });
            ConfigureAuditable(entity);
        });
    }
}
