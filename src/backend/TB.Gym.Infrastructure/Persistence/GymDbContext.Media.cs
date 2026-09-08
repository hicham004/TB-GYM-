using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    /// <summary>
    /// A durable storage location: lower-case, starts alphanumeric, no separators of any kind.
    /// </summary>
    private const string StorageLocationGrammar = "'^[a-z0-9][a-z0-9._-]{0,79}$'";

    /// <summary>
    /// The canonical storage-key grammar, stated in the database as well as in
    /// <see cref="StorageObjectLocator"/>: the row's own tenant as a 32-hex first segment, then one
    /// or more segments of lower-case letters, digits, dot, underscore and hyphen, no segment that
    /// is nothing but dots, and no segment ending in a dot.
    /// </summary>
    /// <remarks>
    /// The original <c>LIKE tenant || '/%'</c> check asserted tenant ownership that the key did not
    /// actually carry: <c>&lt;tenantA&gt;/../&lt;tenantB&gt;/object</c> satisfies it while naming
    /// tenant B's object under any adapter that resolves a key as a path. The dot-segment clauses
    /// close that, and the character class excludes backslashes, control characters, whitespace and
    /// drive/scheme punctuation — so a rooted or traversing key cannot be written in either
    /// separator form, on Windows or Unix. Case and trailing dots are excluded because both alias
    /// to one object on a case-insensitive store or a Windows path, which would let two rows and
    /// two unique-index entries address the same bytes.
    /// </remarks>
    private const string StorageKeyGrammar =
        "\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[a-z0-9._-]+)+$') " +
        "AND \"StorageKey\" !~ '(^|/)[.]+(/|$)' " +
        "AND \"StorageKey\" !~ '[.](/|$)'";

    private const string AssetStorageLocatorCheck =
        "\"StorageLocation\" IS NULL OR (\"StorageLocation\" ~ " + StorageLocationGrammar +
        " AND (\"StorageKey\" IS NULL OR (" + StorageKeyGrammar + ")))";

    private const string SubordinateStorageLocatorCheck =
        "\"StorageLocation\" ~ " + StorageLocationGrammar +
        " AND (\"StorageKey\" IS NULL OR (" + StorageKeyGrammar + "))";

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
            entity.Property(item => item.StorageLocation)
                .HasMaxLength(StorageObjectLocator.MaximumLocationLength);
            entity.Property(item => item.StorageKey).HasMaxLength(StorageObjectLocator.MaximumKeyLength);
            entity.Property(item => item.ExternalProvider).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.ExternalMediaId).HasMaxLength(100);
            ConfigureScanEvidence(entity);
            entity.Property(item => item.TombstonedAtUtc);
            entity.Property(item => item.PurgeFailureCode).HasMaxLength(100);
            entity.HasIndex(item => new { item.TenantId, item.Status, item.CreatedAtUtc });
            entity.HasIndex(item => new
                { item.Status, item.PurgeAfterUtc, item.PurgeClaimExpiresAtUtc })
                .HasFilter("\"PurgeAfterUtc\" IS NOT NULL");
            entity.HasIndex(item => new
                { item.TenantId, item.StorageLocation, item.StorageKey })
                .IsUnique()
                .HasFilter("\"StorageKey\" IS NOT NULL");
            // Purged rows only. A purge clears the live key, but scan evidence keeps naming the exact
            // object it covered, which is what lets reconciliation tell "the database says these
            // bytes were deleted" apart from "the database has never heard of this object". Without
            // this index that lookup would be a sequential scan for every unknown object.
            entity.HasIndex(item => new
                { item.TenantId, item.ScanStorageLocation, item.ScanStorageKey })
                .HasFilter("\"StorageKey\" IS NULL AND \"ScanStorageKey\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.ExternalProvider, item.ExternalMediaId })
                .IsUnique()
                .HasFilter("\"ExternalMediaId\" IS NOT NULL");
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.OwnerUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MediaAssets_Source",
                    "(\"Source\" = 'Upload' AND \"StorageLocation\" IS NOT NULL AND (\"StorageKey\" IS NOT NULL OR \"Status\" = 'Purged') AND \"ExternalMediaId\" IS NULL) OR (\"Source\" = 'ExternalEmbed' AND \"StorageLocation\" IS NULL AND \"StorageKey\" IS NULL AND \"ExternalMediaId\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_Purged",
                    "(\"Status\" = 'Purged') = (\"PurgedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_Length",
                    "\"Length\" IS NULL OR (\"Length\" > 0 AND \"Length\" <= 524288000)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_Hash",
                    "\"Sha256\" IS NULL OR \"Sha256\" ~ '^[0-9a-f]{64}$'");
                table.HasCheckConstraint(
                    "CK_MediaAssets_StorageLocator",
                    AssetStorageLocatorCheck);
                table.HasCheckConstraint(
                    "CK_MediaAssets_PurgeClaim",
                    "(\"PurgeClaimToken\" IS NULL) = (\"PurgeClaimExpiresAtUtc\" IS NULL) AND (\"Status\" <> 'Purged' OR \"PurgeClaimToken\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_MediaAssets_ScanEvidence",
                    "((\"ScanEvidenceState\" = 'None' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL AND \"ScannerKey\" IS NULL AND \"ScannerVersion\" IS NULL AND \"ScanFailureCode\" IS NULL) OR (\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"Sha256\" AND \"ScanSha256\" ~ '^[0-9a-f]{64}$' AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" IS NOT NULL)) AND (\"Source\" <> 'Upload' OR \"Status\" = 'PendingScan' OR \"ScanEvidenceState\" IN ('Complete', 'LegacyUnavailable')) AND (\"ScanEvidenceState\" <> 'Complete' OR (\"ScanOutcome\" = 'Refused' AND \"Status\" IN ('Rejected', 'Tombstoned', 'Purged')) OR (\"ScanOutcome\" = 'Allowed' AND \"Status\" IN ('Ready', 'Tombstoned', 'Purged')))");
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
            entity.Property(item => item.StorageLocation)
                .HasMaxLength(StorageObjectLocator.MaximumLocationLength)
                .IsRequired();
            entity.Property(item => item.StorageKey).HasMaxLength(StorageObjectLocator.MaximumKeyLength);
            ConfigureScanEvidence(entity);
            entity.HasIndex(item => new { item.TenantId, item.MediaAssetId, item.Variant })
                .IsUnique();
            // The derivative half of the purged-evidence lookup, for the same reason.
            entity.HasIndex(item => new
                { item.TenantId, item.ScanStorageLocation, item.ScanStorageKey })
                .HasFilter("\"StorageKey\" IS NULL AND \"ScanStorageKey\" IS NOT NULL");
            entity.HasIndex(item => new
                { item.TenantId, item.StorageLocation, item.StorageKey })
                .IsUnique()
                .HasFilter("\"StorageKey\" IS NOT NULL");
            entity.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MediaAssetId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
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
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_Purged",
                    "(\"PurgedAtUtc\" IS NULL) = (\"StorageKey\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_StorageLocator",
                    SubordinateStorageLocatorCheck);
                table.HasCheckConstraint(
                    "CK_MediaAssetDerivatives_ScanEvidence",
                    "(\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"Sha256\" AND \"ScanSha256\" ~ '^[0-9a-f]{64}$' AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" = 'Allowed')");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MediaIngestObject>(entity =>
        {
            entity.ToTable("IngestObjects", "media");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.StorageLocation)
                .HasMaxLength(StorageObjectLocator.MaximumLocationLength)
                .IsRequired();
            entity.Property(item => item.StoredSha256).HasMaxLength(64).IsFixedLength();
            entity.Property(item => item.StorageKey).HasMaxLength(StorageObjectLocator.MaximumKeyLength);
            entity.Property(item => item.Purpose).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.PurgeFailureCode).HasMaxLength(100);
            ConfigureScanEvidence(entity);
            entity.HasIndex(item => new
                { item.Status, item.PurgeAfterUtc, item.PurgeClaimExpiresAtUtc });
            entity.HasIndex(item => new
                { item.TenantId, item.StorageLocation, item.StorageKey })
                .IsUnique()
                .HasFilter("\"StorageKey\" IS NOT NULL");
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.Status });
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MediaIngestObjects_Bytes",
                    "\"AccountedBytes\" > 0 AND \"AccountedBytes\" <= 524288000");
                table.HasCheckConstraint(
                    "CK_MediaIngestObjects_Purged",
                    "(\"Status\" = 'Purged') = (\"PurgedAtUtc\" IS NOT NULL AND \"StorageKey\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_MediaIngestObjects_Client",
                    "\"Purpose\" <> 'ProgressPhoto' OR \"ClientProfileId\" IS NOT NULL");
                table.HasCheckConstraint(
                    "CK_MediaIngestObjects_StorageLocator",
                    SubordinateStorageLocatorCheck);
                table.HasCheckConstraint(
                    "CK_MediaIngestObjects_PurgeClaim",
                    "(\"PurgeClaimToken\" IS NULL) = (\"PurgeClaimExpiresAtUtc\" IS NULL) AND (\"Status\" <> 'Purged' OR \"PurgeClaimToken\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_MediaIngestObjects_ScanEvidence",
                    "((\"StoredSha256\" IS NULL AND \"StoredAtUtc\" IS NULL) OR (\"StoredSha256\" ~ '^[0-9a-f]{64}$' AND \"StoredAtUtc\" IS NOT NULL) OR \"ScanEvidenceState\" = 'LegacyUnavailable') AND ((\"ScanEvidenceState\" = 'None' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL AND \"ScannerKey\" IS NULL AND \"ScannerVersion\" IS NULL AND \"ScanFailureCode\" IS NULL) OR (\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"StoredSha256\" AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" IS NOT NULL))");
            });
            ConfigureTenantEntity(entity);
        });
    }

    /// <summary>
    /// The two tables reconciliation owns. They are additive and stand apart from the three that own
    /// stored objects: nothing here is read by upload, access, delivery or purge, so a defect in
    /// this phase can make a report wrong and cannot make a media row wrong.
    /// </summary>
    private void ConfigureMediaInventory(ModelBuilder builder)
    {
        builder.Entity<MediaInventoryRun>(entity =>
        {
            entity.ToTable("InventoryRuns", "media");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Location)
                .HasMaxLength(StorageObjectLocator.MaximumLocationLength)
                .IsRequired();
            entity.Property(item => item.State).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.ProbeStage).HasConversion<string>().HasMaxLength(24);
            // A resume cursor is an opaque provider value, so it is stored as given and never
            // parsed, trimmed or interpreted here.
            entity.Property(item => item.InventoryCursor).HasMaxLength(2048);
            entity.Property(item => item.LastFailureCode).HasMaxLength(100);
            // One unfinished run per location, in the database rather than in a lock. Two replicas
            // ticking at the same moment both try to start one and exactly one of them succeeds.
            entity.HasIndex(item => item.Location)
                .IsUnique()
                .HasFilter("\"State\" = 'Running'");
            entity.HasIndex(item => new { item.Location, item.StartedAtUtc });
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MediaInventoryRuns_Lease",
                    "(\"LeaseToken\" IS NULL) = (\"LeaseExpiresAtUtc\" IS NULL) AND (\"State\" = 'Running' OR \"LeaseToken\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_MediaInventoryRuns_Completed",
                    "(\"State\" = 'Completed') = (\"CompletedAtUtc\" IS NOT NULL)");
                // The honesty rule, in the database as well as in the domain: a run that still has a
                // cursor, an unfinished probe stage or a failed page is not a completed inventory,
                // and "it found nothing" means something entirely different for one that is not.
                table.HasCheckConstraint(
                    "CK_MediaInventoryRuns_CompletionEvidence",
                    "\"State\" <> 'Completed' OR (\"InventoryCompleted\" AND \"InventoryCursor\" IS NULL AND \"ProbeStage\" = 'Completed' AND \"PageFailureCount\" = 0)");
                table.HasCheckConstraint(
                    "CK_MediaInventoryRuns_Counters",
                    "\"ObjectsScanned\" >= 0 AND \"ObjectsSkippedRecent\" >= 0 AND \"ObjectsSkippedOwnedByPurge\" >= 0 AND \"UnattributableKeyCount\" >= 0 AND \"OwnersProbed\" >= 0 AND \"OwnersSkippedNotReconciled\" >= 0 AND \"OwnersSkippedOwnedByPurge\" >= 0 AND \"FindingsOpened\" >= 0 AND \"FindingsResolved\" >= 0 AND \"PageFailureCount\" >= 0 AND \"TotalPageFailureCount\" >= \"PageFailureCount\"");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<MediaInventoryFinding>(entity =>
        {
            entity.ToTable("InventoryFindings", "media");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(40);
            entity.Property(item => item.OwnerKind).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.StorageLocation)
                .HasMaxLength(StorageObjectLocator.MaximumLocationLength)
                .IsRequired();
            entity.Property(item => item.StorageKey)
                .HasMaxLength(StorageObjectLocator.MaximumKeyLength)
                .IsRequired();
            entity.Property(item => item.ResolutionCode).HasMaxLength(60);
            // One open finding per condition per object. This index is the idempotency guarantee: a
            // resumed pass, a re-run and a second replica all converge on the same row rather than
            // filing the same disagreement again.
            entity.HasIndex(item => new
                { item.TenantId, item.Kind, item.StorageLocation, item.StorageKey })
                .IsUnique()
                .HasFilter("\"ResolvedAtUtc\" IS NULL");
            entity.HasIndex(item => new { item.TenantId, item.ResolvedAtUtc, item.Kind });
            entity.HasOne<MediaInventoryRun>()
                .WithMany()
                .HasForeignKey(item => item.FirstRunId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MediaInventoryRun>()
                .WithMany()
                .HasForeignKey(item => item.LastRunId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MediaInventoryFindings_StorageLocator",
                    "\"StorageLocation\" ~ " + StorageLocationGrammar + " AND (" + StorageKeyGrammar + ")");
                table.HasCheckConstraint(
                    "CK_MediaInventoryFindings_Owner",
                    "(\"OwnerKind\" = 'None') = (\"OwnerId\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_MediaInventoryFindings_Resolution",
                    "(\"ResolvedAtUtc\" IS NULL) = (\"ResolutionCode\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_MediaInventoryFindings_Observations",
                    "\"ConsecutiveObservations\" >= 1 AND \"LastObservedAtUtc\" >= \"FirstObservedAtUtc\"");
            });
            ConfigureTenantEntity(entity);
        });
    }

    private static void ConfigureScanEvidence<TEntity>(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> entity)
        where TEntity : class
    {
        entity.Property("ScanEvidenceState").HasConversion<string>().HasMaxLength(24);
        entity.Property("ScanStorageLocation").HasMaxLength(StorageObjectLocator.MaximumLocationLength);
        entity.Property("ScanStorageKey").HasMaxLength(StorageObjectLocator.MaximumKeyLength);
        entity.Property("ScanSha256").HasMaxLength(64).IsFixedLength();
        entity.Property("ScannerKey").HasMaxLength(80);
        entity.Property("ScannerVersion").HasMaxLength(40);
        entity.Property("ScanOutcome").HasConversion<string>().HasMaxLength(24);
        entity.Property("ScanFailureCode").HasMaxLength(100);
    }
}
