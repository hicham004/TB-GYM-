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
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(48);
            entity.Property(item => item.DeduplicationKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.PayloadJson).HasColumnType("jsonb").IsRequired();
            entity.Property(item => item.TenantTimeZoneId).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.HasIndex(item => new { item.TenantId, item.DeduplicationKey }).IsUnique();
            // The due-work index the claim query rides. Status first so the scan touches only the
            // states a sweep can act on, then the two instants it orders and filters by.
            entity.HasIndex(item => new { item.Status, item.NextAttemptAtUtc, item.Id })
                .HasDatabaseName("IX_OutboxItems_Status_NextAttemptAtUtc_Id");
            entity.HasIndex(item => new { item.Status, item.ClaimExpiresAtUtc })
                .HasDatabaseName("IX_OutboxItems_Status_ClaimExpiresAtUtc");
            entity.HasIndex(item => new { item.TenantId, item.AggregateId, item.Kind });
            entity.HasIndex(item => new { item.TenantId, item.Status, item.DeadLetteredAtUtc })
                .HasDatabaseName("IX_OutboxItems_TenantId_Status_DeadLetteredAtUtc");
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RecipientUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_NotificationOutboxItems_AttemptCount",
                    "\"AttemptCount\" >= 0");
                // A claim is a matched pair or nothing at all, and only Processing may hold one. A
                // terminal row keeping a live lease is what would let a stale worker finalize
                // somebody else's work, so the database refuses the shape outright.
                table.HasCheckConstraint(
                    "CK_NotificationOutboxItems_Claim",
                    "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND (\"ClaimToken\" IS NULL OR \"Status\" = 'Processing')");
                table.HasCheckConstraint(
                    "CK_NotificationOutboxItems_Dispatched",
                    "(\"Status\" = 'Dispatched') = (\"DispatchedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationOutboxItems_DeadLettered",
                    "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_NotificationOutboxItems_NextAttempt",
                    "\"NextAttemptAtUtc\" >= \"ScheduledAtUtc\"");
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
            // One intent cannot become two notifications. This is what makes a replayed dispatch
            // idempotent after a crash at any boundary: the retry loses the insert and finishes the
            // outbox row instead of writing a duplicate.
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
            // One attempt number per intent and channel. Two workers racing on the same item cannot
            // both create attempt 1, whatever the application believed.
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.OutboxItemId,
                item.Channel,
                item.AttemptNumber,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneNotificationAttemptPerNumber);
            entity.HasIndex(item => new { item.TenantId, item.OutboxItemId, item.StartedAtUtc });
            entity.HasOne<NotificationOutboxItem>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.OutboxItemId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
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
                    "\"Outcome\" <> 'Succeeded' OR \"FailureCode\" IS NULL");
            });
            ConfigureAuditable(entity);
        });
    }
}
