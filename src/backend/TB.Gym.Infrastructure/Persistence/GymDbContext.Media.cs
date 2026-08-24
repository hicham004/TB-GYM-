using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureMedia(ModelBuilder builder)
    {
        builder.Entity<MediaAsset>(entity =>
        {
            entity.ToTable("Assets", "media");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Title).HasMaxLength(200).IsRequired();
            entity.Property(item => item.Purpose).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.OriginalFileName).HasMaxLength(255);
            entity.Property(item => item.DeclaredContentType).HasMaxLength(100);
            entity.Property(item => item.VerifiedContentType).HasMaxLength(100);
            entity.Property(item => item.Sha256).HasMaxLength(64).IsFixedLength();
            entity.Property(item => item.StorageKey).HasMaxLength(500);
            entity.Property(item => item.ExternalProvider).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.ExternalMediaId).HasMaxLength(100);
            entity.Property(item => item.ScannerKey).HasMaxLength(80);
            entity.Property(item => item.ScannerVersion).HasMaxLength(40);
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.TombstonedAtUtc);
            entity.Property(item => item.PurgeFailureCode).HasMaxLength(100);
            entity.HasIndex(item => new { item.TenantId, item.Status, item.CreatedAtUtc });
            // The purge sweep claims by status and due date across every tenant, so its index is
            // deliberately not tenant-leading and covers only rows that can ever be due.
            entity.HasIndex(item => new { item.Status, item.PurgeAfterUtc })
                .HasFilter("\"PurgeAfterUtc\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.StorageKey })
                .IsUnique()
                .HasFilter("\"StorageKey\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.ExternalProvider, item.ExternalMediaId })
                .IsUnique()
                .HasFilter("\"ExternalMediaId\" IS NOT NULL");
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.OwnerUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                // A purged upload keeps its row as history with no storage key, because there is no
                // longer an object for it to address.
                table.HasCheckConstraint(
                    "CK_MediaAssets_Source",
                    "(\"Source\" = 'Upload' AND (\"StorageKey\" IS NOT NULL OR \"Status\" = 'Purged') AND \"ExternalMediaId\" IS NULL) OR (\"Source\" = 'ExternalEmbed' AND \"StorageKey\" IS NULL AND \"ExternalMediaId\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_Purged",
                    "(\"Status\" = 'Purged') = (\"PurgedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_Length",
                    "\"Length\" IS NULL OR (\"Length\" > 0 AND \"Length\" <= 524288000)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_Hash",
                    "\"Sha256\" IS NULL OR \"Sha256\" ~ '^[0-9a-f]{64}$'");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MediaAssetDerivative>(entity =>
        {
            entity.ToTable("AssetDerivatives", "media");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Variant).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.VerifiedContentType).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Sha256).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(item => item.StorageKey).HasMaxLength(500);
            // One rendition per asset and variant. This is what makes a derivative addressable only
            // through its parent: naming the asset and the variant identifies at most one row, so
            // nothing needs to expose the derivative's own identifier.
            entity.HasIndex(item => new { item.TenantId, item.MediaAssetId, item.Variant })
                .IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.StorageKey })
                .IsUnique()
                .HasFilter("\"StorageKey\" IS NOT NULL");
            entity.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MediaAssetId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                // A rendition has no meaning without the asset it renders.
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_Length",
                    "\"Length\" > 0 AND \"Length\" <= 15728640");
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_Hash",
                    "\"Sha256\" ~ '^[0-9a-f]{64}$'");
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_Dimensions",
                    "\"Width\" > 0 AND \"Height\" > 0 AND (\"Variant\" <> 'Thumbnail' OR (\"Width\" <= 480 AND \"Height\" <= 480))");
                // A purged rendition has no key; an unpurged one must have one.
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_Purged",
                    "(\"PurgedAtUtc\" IS NULL) = (\"StorageKey\" IS NOT NULL)");
            });
            ConfigureTenantEntity(entity);
        });
    }
}
