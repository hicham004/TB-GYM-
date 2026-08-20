using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureNotifications(ModelBuilder builder)
    {
        builder.Entity<NotificationOutboxItem>(entity =>
        {
            entity.ToTable("OutboxItems", "notifications");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(48);
            entity.Property(item => item.DeduplicationKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.PayloadJson).HasColumnType("jsonb").IsRequired();
            entity.Property(item => item.TenantTimeZoneId).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.HasIndex(item => new { item.TenantId, item.DeduplicationKey }).IsUnique();
            entity.HasIndex(item => new { item.Status, item.ScheduledAtUtc });
            entity.HasIndex(item => new { item.TenantId, item.AggregateId, item.Kind });
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RecipientUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_NotificationOutboxItems_AttemptCount",
                "\"AttemptCount\" >= 0"));
            ConfigureAuditable(entity);
        });
    }
}
