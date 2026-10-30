using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;

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
            entity.Property(item => item.Kind)
                .HasConversion<string>()
                .HasMaxLength(32)
                .HasDefaultValue(ProductKind.CoachingPlan)
                .HasSentinel(default(ProductKind));
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
            // ADR 0034's slot, with a pack's count in it; a coaching plan's options all have none, so its
            // nulls must clash as they always did.
            entity.HasIndex(item => new
                { item.TenantId, item.ProductId, item.SessionCount, item.DurationCount, item.DurationUnit, item.PriceCurrency })
                .IsUnique()
                .HasFilter("\"IsActive\"")
                .AreNullsDistinct(false)
                .HasDatabaseName(DatabaseConstraintNames.OneActiveOfferPerDurationAndCurrency);
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
                table.HasCheckConstraint(
                    "CK_ProductOffers_SessionCount",
                    "\"SessionCount\" IS NULL OR \"SessionCount\" BETWEEN 1 AND 100");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<OfferPriceChange>(entity =>
        {
            entity.ToTable("OfferPriceChanges", "subscriptions", table =>
                table.HasCheckConstraint("CK_OfferPriceChanges_PriceAmount", "\"PriceAmount\" >= 0"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.PriceAmount).HasPrecision(18, 2);
            entity.HasIndex(item => new { item.TenantId, item.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneOfferPriceChangePerKey);
            entity.HasOne<ProductOffer>().WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceOfferId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ProductOffer>().WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ReplacementOfferId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
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
                table.HasCheckConstraint(
                    "CK_ClientEnrollments_SessionCountSnapshot",
                    "\"SessionCountSnapshot\" IS NULL OR \"SessionCountSnapshot\" BETWEEN 1 AND 100");
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

        // ADR 0038. Append-only and guarded by triggers (SessionPacks migration); one Issued row per pack, one
        // correction per row. Each row carries the pack's client, so a read of one client needs no join.
        builder.Entity<SessionLedgerEntry>(entity =>
        {
            entity.ToTable("SessionLedgerEntries", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Day).HasColumnType("date");
            entity.Property(item => item.Note).HasMaxLength(SessionLedgerEntry.TextLimit);
            entity.Property(item => item.Reason).HasMaxLength(SessionLedgerEntry.TextLimit);
            entity.HasIndex(item => new { item.TenantId, item.IdempotencyKey }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId, item.Day });
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.Day });
            entity.HasIndex(item => new { item.TenantId, item.CoachUserId, item.Day });
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId })
                .IsUnique()
                .HasFilter("\"Kind\" = 'Issued'")
                .HasDatabaseName("UX_SessionLedgerEntries_OneIssuedPerPack");
            entity.HasIndex(item => new { item.TenantId, item.VoidsEntryId })
                .IsUnique()
                .HasFilter("\"VoidsEntryId\" IS NOT NULL")
                .HasDatabaseName("UX_SessionLedgerEntries_OneVoidPerEntry");
            entity.HasOne<ClientEnrollment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.EnrollmentId })
                .HasPrincipalKey(enrollment => new { enrollment.TenantId, enrollment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<TenantMembership>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.CoachUserId })
                .HasPrincipalKey(membership => new { membership.TenantId, membership.UserId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<SessionLedgerEntry>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.VoidsEntryId })
                .HasPrincipalKey(entry => new { entry.TenantId, entry.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_SessionLedgerEntries_Count",
                    "(\"Kind\" = 'Issued' AND \"Count\" BETWEEN 1 AND 100) OR (\"Kind\" <> 'Issued' AND \"Count\" = 1)");
                table.HasCheckConstraint(
                    "CK_SessionLedgerEntries_Coach",
                    "(\"Kind\" IN ('Held', 'Charged')) = (\"CoachUserId\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_SessionLedgerEntries_Reason",
                    "(\"Kind\" = 'Charged') = (\"Reason\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_SessionLedgerEntries_Note",
                    "\"Kind\" = 'Held' OR \"Note\" IS NULL");
                table.HasCheckConstraint(
                    "CK_SessionLedgerEntries_Voids",
                    "(\"Kind\" = 'Voided') = (\"VoidsEntryId\" IS NOT NULL)");
            });
            ConfigureAuditable(entity);
        });

        // ADR 0029. Append-only (trigger) and at most one request per client in any 7 days (the
        // exclusion constraint added in the RenewalRequests migration, over [RequestedOn, AskAgainFrom)).
        builder.Entity<RenewalRequest>(entity =>
        {
            entity.ToTable("RenewalRequests", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.RequestedOn).HasColumnType("date");
            entity.Property(item => item.AskAgainFrom).HasColumnType("date");
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.RequestedOn });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientEnrollment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.EndedEnrollmentId })
                .HasPrincipalKey(enrollment => new { enrollment.TenantId, enrollment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.CoachUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_RenewalRequests_Window",
                $"\"AskAgainFrom\" = \"RequestedOn\" + {RenewalRequest.WindowDays}"));
            ConfigureAuditable(entity);
        });
    }
}
