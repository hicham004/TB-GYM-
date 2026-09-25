using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

/// <summary>
/// Platform billing (ADR 0028): what TB Gym charges workspaces, in its own <c>billing</c> schema. The
/// immutability and money invariants are also database triggers, written in the migration.
/// </summary>
public sealed partial class GymDbContext
{
    public DbSet<PlatformPricePlan> PlatformPricePlans => Set<PlatformPricePlan>();

    public DbSet<PlatformInvoice> PlatformInvoices => Set<PlatformInvoice>();

    public DbSet<PlatformInvoiceVoid> PlatformInvoiceVoids => Set<PlatformInvoiceVoid>();

    public DbSet<PlatformPayment> PlatformPayments => Set<PlatformPayment>();

    public DbSet<WorkspaceDiscount> WorkspaceDiscounts => Set<WorkspaceDiscount>();

    /// <summary>Append-only membership status history, written by a database trigger (ADR 0028).</summary>
    public DbSet<MembershipStatusChange> MembershipStatusChanges => Set<MembershipStatusChange>();

    /// <summary>Append-only enrollment status history, written by a database trigger (ADR 0028).</summary>
    public DbSet<EnrollmentStatusChange> EnrollmentStatusChanges => Set<EnrollmentStatusChange>();

    private void ConfigurePlatformBilling(ModelBuilder builder)
    {
        builder.Entity<MembershipStatusChange>(entity =>
        {
            entity.ToTable("MembershipStatusChanges", "tenancy");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Role).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.MembershipId, item.ChangedAtUtc });
        });

        builder.Entity<EnrollmentStatusChange>(entity =>
        {
            entity.ToTable("EnrollmentStatusChanges", "subscriptions");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.EnrollmentId, item.ChangedAtUtc });
        });

        builder.Entity<PlatformPricePlan>(entity =>
        {
            entity.ToTable("PricePlans", "billing");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.VersionNumber).IsUnique();
            entity.Property(item => item.CurrencyCode).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.Property(item => item.SeatPrice).HasPrecision(18, 2);
            entity.Property(item => item.ExtraClientPrice).HasPrecision(18, 2);
            entity.Property(item => item.GymFee).HasPrecision(18, 2);
            entity.Property(item => item.Note).HasMaxLength(500);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_PricePlans_Version", "\"VersionNumber\" >= 1");
                table.HasCheckConstraint("CK_PricePlans_Currency", "\"CurrencyCode\" = 'USD'");
                table.HasCheckConstraint(
                    "CK_PricePlans_Prices",
                    "\"SeatPrice\" >= 0 AND \"ExtraClientPrice\" >= 0 AND \"GymFee\" >= 0");
                table.HasCheckConstraint(
                    "CK_PricePlans_Counts",
                    "\"IncludedClientsPerSeat\" >= 0 AND \"GymFeeMinimumSeats\" >= 1 AND \"TrialDays\" >= 0 AND \"PaymentTermDays\" >= 0 AND \"GraceDays\" >= 0");
            });
        });

        builder.Entity<PlatformInvoice>(entity =>
        {
            entity.ToTable("Invoices", "billing");
            entity.HasKey(item => item.Id);
            ConfigureTenantEntity(entity);
            entity.Property(item => item.CalculationName).HasMaxLength(40).IsRequired();
            entity.Property(item => item.CurrencyCode).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.Property(item => item.PlanSeatPrice).HasPrecision(18, 2);
            entity.Property(item => item.PlanExtraClientPrice).HasPrecision(18, 2);
            entity.Property(item => item.PlanGymFee).HasPrecision(18, 2);
            entity.Property(item => item.PeriodStart).HasColumnType("date");
            entity.Property(item => item.PeriodEndExclusive).HasColumnType("date");
            entity.Property(item => item.SeatAmount).HasPrecision(18, 2);
            entity.Property(item => item.ExtraClientAmount).HasPrecision(18, 2);
            entity.Property(item => item.GymFeeAmount).HasPrecision(18, 2);
            entity.Property(item => item.Subtotal).HasPrecision(18, 2);
            entity.Property(item => item.DiscountPercent).HasPrecision(5, 2);
            entity.Property(item => item.DiscountAmount).HasPrecision(18, 2);
            entity.Property(item => item.Total).HasPrecision(18, 2);
            entity.Property(item => item.ReferenceCode).HasMaxLength(40).IsRequired();
            entity.Property(item => item.DueOn).HasColumnType("date");
            entity.Property(item => item.ReadOnlyFrom).HasColumnType("date");
            entity.Ignore(item => item.Period);
            entity.HasIndex(item => item.ReferenceCode).IsUnique();
            // One original invoice per workspace and month, so the monthly run can never bill twice.
            entity.HasIndex(item => new { item.TenantId, item.PeriodStart })
                .IsUnique()
                .HasFilter("\"ReplacesInvoiceId\" IS NULL")
                .HasDatabaseName("IX_Invoices_TenantId_PeriodStart_Original");
            // One replacement per voided invoice.
            entity.HasIndex(item => new { item.TenantId, item.ReplacesInvoiceId })
                .IsUnique()
                .HasFilter("\"ReplacesInvoiceId\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.ReadOnlyFrom });
            entity.HasOne<PlatformPricePlan>()
                .WithMany()
                .HasForeignKey(item => item.PricePlanId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            // A replacement names a voided invoice: the key points at the void, not the invoice.
            entity.HasOne<PlatformInvoiceVoid>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ReplacesInvoiceId })
                .HasPrincipalKey(item => new { item.TenantId, item.InvoiceId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_Invoices_Currency", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                table.HasCheckConstraint(
                    "CK_Invoices_Period",
                    "EXTRACT(DAY FROM \"PeriodStart\") = 1 AND \"PeriodEndExclusive\" = (\"PeriodStart\" + INTERVAL '1 month')::date");
                table.HasCheckConstraint(
                    "CK_Invoices_Quantities",
                    "\"Seats\" >= 1 AND \"BillableClients\" >= 0 AND \"IncludedClients\" = \"Seats\" * \"PlanIncludedClientsPerSeat\" AND \"ExtraClients\" = GREATEST(0, \"BillableClients\" - \"IncludedClients\")");
                table.HasCheckConstraint(
                    "CK_Invoices_Amounts",
                    "\"SeatAmount\" >= 0 AND \"ExtraClientAmount\" >= 0 AND \"GymFeeAmount\" >= 0 AND \"DiscountAmount\" >= 0 AND \"Subtotal\" = \"SeatAmount\" + \"ExtraClientAmount\" + \"GymFeeAmount\" AND \"Total\" = \"Subtotal\" - \"DiscountAmount\" AND \"Total\" >= 0");
                table.HasCheckConstraint(
                    "CK_Invoices_Discount",
                    "\"DiscountPercent\" >= 0 AND \"DiscountPercent\" <= 100");
                table.HasCheckConstraint(
                    "CK_Invoices_Dates",
                    "\"DueOn\" >= (\"IssuedAtUtc\" AT TIME ZONE 'UTC')::date AND \"ReadOnlyFrom\" > \"DueOn\" AND \"IssuedAtUtc\" >= (\"PeriodEndExclusive\"::timestamp AT TIME ZONE 'UTC')");
            });
        });

        builder.Entity<PlatformInvoiceVoid>(entity =>
        {
            entity.ToTable("InvoiceVoids", "billing");
            entity.HasKey(item => item.Id);
            ConfigureTenantEntity(entity);
            entity.HasAlternateKey(item => new { item.TenantId, item.InvoiceId });
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasOne<PlatformInvoice>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.InvoiceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<PlatformPayment>(entity =>
        {
            entity.ToTable("Payments", "billing");
            entity.HasKey(item => item.Id);
            ConfigureTenantEntity(entity);
            // One payment per invoice: no partial payments yet (ADR 0028).
            entity.HasIndex(item => new { item.TenantId, item.InvoiceId }).IsUnique();
            entity.Property(item => item.Amount).HasPrecision(18, 2);
            entity.Property(item => item.CurrencyCode).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.Property(item => item.Reference).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Note).HasMaxLength(500);
            entity.Property(item => item.ReceivedOn).HasColumnType("date");
            entity.HasOne<PlatformInvoice>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.InvoiceId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_Payments_Amount", "\"Amount\" > 0"));
        });

        builder.Entity<WorkspaceDiscount>(entity =>
        {
            entity.ToTable("WorkspaceDiscounts", "billing");
            entity.HasKey(item => item.Id);
            ConfigureTenantEntity(entity);
            entity.Property(item => item.Percent).HasPrecision(5, 2);
            entity.Property(item => item.StartsOn).HasColumnType("date");
            entity.Property(item => item.EndsOnExclusive).HasColumnType("date");
            entity.Property(item => item.Note).HasMaxLength(200).IsRequired();
            entity.Ignore(item => item.IsRevoked);
            entity.Ignore(item => item.StartsAtUtc);
            entity.Ignore(item => item.EndsAtUtc);
            entity.HasIndex(item => new { item.TenantId, item.StartsOn });
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_WorkspaceDiscounts_Percent", "\"Percent\" > 0 AND \"Percent\" <= 100");
                table.HasCheckConstraint("CK_WorkspaceDiscounts_Dates", "\"EndsOnExclusive\" > \"StartsOn\"");
                table.HasCheckConstraint(
                    "CK_WorkspaceDiscounts_Revocation",
                    "(\"RevokedAtUtc\" IS NULL) = (\"RevokedByUserId\" IS NULL)");
            });
        });
    }
}
