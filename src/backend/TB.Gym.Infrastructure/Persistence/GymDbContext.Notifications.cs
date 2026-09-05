using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureNotifications(ModelBuilder builder)
    {
        builder.Entity<NotificationOutboxItem>(entity =>
        {
            entity.ToTable("OutboxItems", "notifications");
            entity.HasKey(item => item.Id);
            // Every child of an outbox row carries TenantId in its foreign key, so a child can never
            // point at an intent belonging to another workspace.
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.HasAlternateKey(item => new { item.TenantId, item.Id, item.Purpose });
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(48);
            entity.Property(item => item.Purpose).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.DeduplicationKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.PayloadJson).HasColumnType("jsonb").IsRequired();
            entity.Property(item => item.TenantTimeZoneId).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.DeduplicationKey }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.AggregateId, item.Kind });
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RecipientUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_NotificationOutboxItems_Cancellation",
                "(\"Status\" = 'Cancelled') = (\"CancelledAtUtc\" IS NOT NULL)"));
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_NotificationOutboxItems_Vocabulary",
                "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed')"));
            ConfigureAuditable(entity);
        });

        // One channel's own delivery of one logical notification. Everything that can differ between
        // channels lives here, so an in-app success and an email retry can both be true at once.
        builder.Entity<NotificationChannelDelivery>(entity =>
        {
            entity.ToTable("ChannelDeliveries", "notifications");
            entity.HasKey(item => item.Id);
            // The principal key attempts point at. Including Channel is what makes an attempt whose
            // channel disagrees with its delivery impossible rather than merely unlikely.
            entity.HasAlternateKey(item => new { item.TenantId, item.Id, item.Channel });
            entity.Property(item => item.Channel).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Purpose).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.SelectionReason).HasMaxLength(100).IsRequired();
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.DeferralCode).HasMaxLength(100);
            entity.Property(item => item.TransportAdapter).HasMaxLength(40);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            // At most one delivery per intent and channel. Two workers racing to plan the same intent
            // cannot both create its email row, whatever the application believed.
            entity.HasIndex(item => new { item.TenantId, item.OutboxItemId, item.Channel })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneChannelDeliveryPerIntent);
            // The due-work index the claim query rides. Status first so the scan touches only the
            // states a sweep can act on, then the two instants it orders and filters by.
            entity.HasIndex(item => new { item.Status, item.NextAttemptAtUtc, item.Id })
                .HasDatabaseName("IX_ChannelDeliveries_Status_NextAttemptAtUtc_Id");
            entity.HasIndex(item => new { item.Status, item.ClaimExpiresAtUtc })
                .HasDatabaseName("IX_ChannelDeliveries_Status_ClaimExpiresAtUtc");
            entity.HasIndex(item => new { item.TenantId, item.Status, item.DeadLetteredAtUtc })
                .HasDatabaseName("IX_ChannelDeliveries_TenantId_Status_DeadLetteredAtUtc");
            entity.HasOne<NotificationOutboxItem>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.OutboxItemId, item.Purpose })
                .HasPrincipalKey(item => new { item.TenantId, item.Id, item.Purpose })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_AttemptCount",
                    "\"AttemptCount\" >= 0 AND \"DeferralCount\" >= 0 AND \"SelectionPolicyVersion\" >= 1");
                // A claim is a matched pair or nothing at all, and only Processing may hold one. A
                // terminal row keeping a live lease is what would let a stale worker finalize somebody
                // else's work, so the database refuses the shape outright.
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Claim",
                    "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Vocabulary",
                    "\"Channel\" IN ('InApp', 'Email') AND \"Purpose\" IN ('ServiceTransactional', 'Marketing') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Materialized",
                    "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_DeadLettered",
                    "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Completion",
                    "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_NextAttempt",
                    "\"NextAttemptAtUtc\" >= \"DueAtUtc\"");
                // In-app has no transport at all, so it can never carry transport or provider
                // metadata; and no channel may carry a provider identifier without naming the adapter
                // that produced it.
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_InAppHasNoProvider",
                    "\"Channel\" <> 'InApp' OR (\"TransportAdapter\" IS NULL AND \"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_ProviderEvidence",
                    "(\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL) OR (\"TransportAdapter\" IS NOT NULL AND \"Status\" = 'Materialized')");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Transport",
                    "\"TransportAdapter\" IS NULL OR (\"Channel\" = 'Email' AND \"Status\" = 'Materialized')");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Deferral",
                    "(\"DeferredUntilUtc\" IS NULL) = (\"DeferralCode\" IS NULL) AND ((\"DeferralCount\" = 0) = (\"DeferredUntilUtc\" IS NULL))");
                table.HasCheckConstraint(
                    "CK_NotificationChannelDeliveries_Failure",
                    "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<Notification>(entity =>
        {
            entity.ToTable("Notifications", "notifications");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(48);
            entity.Property(item => item.TemplateKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Culture).HasMaxLength(20).IsRequired();
            entity.Property(item => item.Title).HasMaxLength(200).IsRequired();
            entity.Property(item => item.Body).HasMaxLength(2_000).IsRequired();
            // One intent cannot become two notifications. This is what makes a replayed in-app
            // dispatch idempotent after a crash at any boundary, and it is why an email retry can
            // never produce a second inbox row: the email path does not write here at all, and the
            // constraint would refuse it if it tried.
            entity.HasIndex(item => new { item.TenantId, item.SourceOutboxItemId })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneNotificationPerOutboxItem);
            // The inbox read: newest first for one recipient in one workspace.
            entity.HasIndex(item => new { item.TenantId, item.RecipientUserId, item.CreatedAtUtc, item.Id })
                .HasDatabaseName("IX_Notifications_TenantId_RecipientUserId_CreatedAtUtc_Id");
            // The unread count, which is read on every navigation and must not scan an inbox.
            entity.HasIndex(item => new { item.TenantId, item.RecipientUserId })
                .HasFilter("\"ReadAtUtc\" IS NULL")
                .HasDatabaseName("IX_Notifications_TenantId_RecipientUserId_Unread");
            entity.HasOne<NotificationOutboxItem>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceOutboxItemId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RecipientUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Notifications_TemplateVersion",
                "\"TemplateVersion\" >= 1"));
            ConfigureAuditable(entity);
        });

        builder.Entity<NotificationDeliveryAttempt>(entity =>
        {
            entity.ToTable("DeliveryAttempts", "notifications");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Channel).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Outcome).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.IdempotencyKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            // One attempt number per channel delivery. Two workers racing on the same delivery cannot
            // both create attempt 1, whatever the application believed — and the two channels of one
            // intent number their attempts entirely independently.
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.ChannelDeliveryId,
                item.AttemptNumber,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneNotificationAttemptPerNumber);
            entity.HasIndex(item => new { item.TenantId, item.ChannelDeliveryId, item.StartedAtUtc });
            entity.HasIndex(item => new { item.TenantId, item.ChannelDeliveryId, item.ClaimToken })
                .IsUnique()
                .HasDatabaseName("IX_DeliveryAttempts_TenantId_ChannelDeliveryId_ClaimToken");
            // Tenant, delivery and channel together: the attempt cannot belong to another workspace's
            // delivery, and it cannot claim a channel its delivery does not have.
            entity.HasOne<NotificationChannelDelivery>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ChannelDeliveryId, item.Channel })
                .HasPrincipalKey(item => new { item.TenantId, item.Id, item.Channel })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_NotificationDeliveryAttempts_AttemptNumber",
                    "\"AttemptNumber\" >= 1");
                table.HasCheckConstraint(
                    "CK_NotificationDeliveryAttempts_Completion",
                    "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationDeliveryAttempts_Success",
                    "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationDeliveryAttempts_Vocabulary",
                    "\"Channel\" IN ('InApp', 'Email') AND \"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
            });
            ConfigureAuditable(entity);
        });

        // One member's own settings in one workspace. User-owned: there is no route by which anybody
        // writes somebody else's row, and the unique key is what makes "their row" a single thing.
        builder.Entity<NotificationChannelPreference>(entity =>
        {
            entity.ToTable("ChannelPreferences", "notifications");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.TenantId, item.UserId })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneNotificationPreferencePerMember);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<TenantMembership>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.UserId })
                .HasPrincipalKey(item => new { item.TenantId, item.UserId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<NotificationConsentEvent>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.UserId, item.EmailServiceConsentEventId })
                .HasPrincipalKey(item => new { item.TenantId, item.UserId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<NotificationConsentEvent>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.UserId, item.EmailMarketingConsentEventId })
                .HasPrincipalKey(item => new { item.TenantId, item.UserId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                // Quiet hours are all three columns or none of them, and a window whose start equals
                // its end is refused rather than silently read as a whole day.
                table.HasCheckConstraint(
                    "CK_NotificationChannelPreferences_QuietHours",
                    "(\"QuietHoursEnabled\" = (\"QuietHoursStartLocal\" IS NOT NULL)) AND (\"QuietHoursEnabled\" = (\"QuietHoursEndLocal\" IS NOT NULL)) AND (\"QuietHoursEnabled\" = false OR \"QuietHoursStartLocal\" <> \"QuietHoursEndLocal\")");
                table.HasCheckConstraint(
                    "CK_NotificationChannelPreferences_PolicyVersion",
                    "\"PolicyVersion\" >= 1");
                // An enabled email setting always has the instant it was decided, so the mutable row
                // can be reconciled against the append-only evidence that explains it.
                table.HasCheckConstraint(
                    "CK_NotificationChannelPreferences_Decisions",
                    "(\"EmailServiceDecidedAtUtc\" IS NULL) = (\"EmailServiceConsentEventId\" IS NULL) AND (\"EmailMarketingDecidedAtUtc\" IS NULL) = (\"EmailMarketingConsentEventId\" IS NULL) AND (\"EmailServiceEnabled\" = false OR \"EmailServiceConsentEventId\" IS NOT NULL) AND (\"EmailMarketingEnabled\" = false OR \"EmailMarketingConsentEventId\" IS NOT NULL)");
            });
            ConfigureAuditable(entity);
        });

        // Append-only consent evidence. Never updated, never deleted; a withdrawal appends a row and
        // does not erase the grant it withdraws.
        builder.Entity<NotificationConsentEvent>(entity =>
        {
            entity.ToTable("ConsentEvents", "notifications");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.UserId, item.Id });
            entity.Property(item => item.Channel).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Purpose).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Decision).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Source).HasMaxLength(100).IsRequired();
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.UserId,
                item.Channel,
                item.Purpose,
                item.RecordedAtUtc,
            })
                .HasDatabaseName("IX_NotificationConsentEvents_Subject_RecordedAtUtc");
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<TenantMembership>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.UserId })
                .HasPrincipalKey(item => new { item.TenantId, item.UserId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    // Nobody consents on somebody else's behalf in this phase, and the database says so
                    // rather than trusting every future write path to remember.
                    "CK_NotificationConsentEvents_OwnActor",
                    "\"ActorUserId\" = \"UserId\" AND \"PolicyVersion\" >= 1");
                table.HasCheckConstraint(
                    "CK_NotificationConsentEvents_Vocabulary",
                    "\"Channel\" = 'Email' AND \"Purpose\" IN ('ServiceTransactional', 'Marketing') AND \"Decision\" IN ('Granted', 'Withdrawn')");
            });
            ConfigureAuditable(entity);
        });

        // One spent preference idempotency key per workspace.
        builder.Entity<NotificationPreferenceCommandRecord>(entity =>
        {
            entity.ToTable("PreferenceCommandRecords", "notifications");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.CommandType).HasConversion<string>().HasMaxLength(48);
            entity.Property(item => item.PayloadFingerprint).HasMaxLength(64).IsRequired();
            entity.Property(item => item.ResultTimeZoneId).HasMaxLength(100).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneNotificationPreferenceCommandPerKey);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.ActorUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<TenantMembership>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ActorUserId })
                .HasPrincipalKey(item => new { item.TenantId, item.UserId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_NotificationPreferenceCommands_Vocabulary",
                    "\"CommandType\" = 'UpdateOwnPreferences' AND \"ResultPolicyVersion\" >= 1 AND \"ResultPreferenceVersion\" BETWEEN 0 AND 4294967295 AND btrim(\"ResultTimeZoneId\") <> '' AND \"PayloadFingerprint\" ~ '^[0-9a-f]{64}$'");
                table.HasCheckConstraint(
                    "CK_NotificationPreferenceCommands_QuietHours",
                    "(\"ResultQuietHoursEnabled\" = (\"ResultQuietHoursStartLocal\" IS NOT NULL)) AND (\"ResultQuietHoursEnabled\" = (\"ResultQuietHoursEndLocal\" IS NOT NULL)) AND (\"ResultQuietHoursEnabled\" = false OR \"ResultQuietHoursStartLocal\" <> \"ResultQuietHoursEndLocal\")");
            });
            ConfigureAuditable(entity);
        });
    }
}
