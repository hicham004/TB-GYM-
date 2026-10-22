using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private static void ConfigureLegalConsent(ModelBuilder builder)
    {
        builder.Entity<LegalDocumentVersion>(entity =>
        {
            entity.ToTable("LegalDocumentVersions", "identity");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(40);
            entity.Property(item => item.VersionLabel).HasMaxLength(LegalDocumentVersion.MaximumVersionLength).IsRequired();
            entity.Property(item => item.Culture).HasMaxLength(20).IsRequired();
            entity.Property(item => item.Context).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.ContentUri).HasMaxLength(1_000).IsRequired();
            entity.Property(item => item.ContentSha256).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(item => item.Content).HasColumnType("text").IsRequired();
            entity.Property(item => item.AcceptanceStatement)
                .HasMaxLength(LegalDocumentVersion.MaximumStatementLength)
                .IsRequired();
            entity.Property(item => item.ReviewStatus).HasConversion<string>().HasMaxLength(40);
            // A version name is used once per document and language, whoever accepts it.
            entity.HasIndex(item => new { item.Kind, item.VersionLabel, item.Culture }).IsUnique();
            entity.HasIndex(item => new { item.Kind, item.Culture, item.PublishedAtUtc, item.RetiredAtUtc });
            // One version of a document in a language is in force at a time, whoever accepts it (CLI-010):
            // a document asked both once per person and in each space would put two boxes of one name on a
            // page, so moving it to the other context replaces it.
            entity.HasIndex(item => new { item.Kind, item.Culture })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneCurrentLegalDocumentVersion)
                .HasFilter("\"PublishedAtUtc\" IS NOT NULL AND \"RetiredAtUtc\" IS NULL");
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_LegalDocumentVersions_ContentHash",
                    "\"ContentSha256\" ~ '^[0-9a-f]{64}$'");
                // The hash is the text's, worked out by the database itself, so it can never describe other words.
                table.HasCheckConstraint(
                    "CK_LegalDocumentVersions_HashMatchesContent",
                    "\"ContentSha256\" = encode(sha256(convert_to(\"Content\", 'UTF8')), 'hex')");
                table.HasCheckConstraint(
                    "CK_LegalDocumentVersions_PublishedReviewed",
                    "\"PublishedAtUtc\" IS NULL OR \"ReviewStatus\" = 'Approved'");
                table.HasCheckConstraint(
                    "CK_LegalDocumentVersions_RetiredAfterPublished",
                    "\"RetiredAtUtc\" IS NULL OR (\"PublishedAtUtc\" IS NOT NULL AND \"RetiredAtUtc\" >= \"PublishedAtUtc\")");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<LegalConsentAcceptance>(entity =>
        {
            entity.ToTable("LegalConsentAcceptances", "identity");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Context).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.ContextKey).HasMaxLength(32).IsRequired();
            entity.HasIndex(item => new { item.UserId, item.DocumentVersionId, item.ContextKey }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.UserId, item.AcceptedAtUtc });
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<LegalDocumentVersion>()
                .WithMany()
                .HasForeignKey(item => item.DocumentVersionId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_LegalConsentAcceptances_Context",
                "(\"Context\" = 'Workspace' AND \"TenantId\" IS NOT NULL) OR (\"Context\" = 'Platform' AND \"TenantId\" IS NULL)"));
            ConfigureAuditable(entity);
        });
    }
}
