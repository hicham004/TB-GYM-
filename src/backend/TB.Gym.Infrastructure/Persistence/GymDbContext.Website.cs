using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Website;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    /// <summary>Talk-to-us requests from gyms (UI plan R6.2g), and the state of the owner's email about each.</summary>
    public DbSet<ContactRequest> ContactRequests => Set<ContactRequest>();

    /// <summary>
    /// The website's one table. It has <b>no <c>TenantId</c> column</b> and no query filter: a gym
    /// that writes to us has no workspace yet, and the request is TB Gym's own. The facts a person
    /// wrote are frozen by a trigger (the migration adds it) and by <see cref="ApplyPersistenceRules"/>;
    /// only the email's bookkeeping columns change afterwards, under the same shape checks as the
    /// other action-mail queues.
    /// </summary>
    private static void ConfigureWebsite(ModelBuilder builder)
    {
        builder.Entity<ContactRequest>(entity =>
        {
            entity.ToTable("ContactRequests", "website");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(ContactRequestRules.NameMaxLength).IsRequired();
            entity.Property(item => item.GymName).HasMaxLength(ContactRequestRules.GymNameMaxLength).IsRequired();
            entity.Property(item => item.Contact).HasMaxLength(ContactRequestRules.ContactMaxLength).IsRequired();
            entity.Property(item => item.ContactKind).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Message).HasMaxLength(ContactRequestRules.MessageMaxLength);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.TransportAdapter).HasMaxLength(40);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            entity.Property(item => item.ProviderIdempotencyKey).HasMaxLength(200);
            entity.HasIndex(item => new { item.Status, item.NextAttemptAtUtc, item.Id })
                .HasDatabaseName("IX_ContactRequests_Status_NextAttemptAtUtc_Id");
            entity.HasIndex(item => new { item.Status, item.ClaimExpiresAtUtc })
                .HasDatabaseName("IX_ContactRequests_Status_ClaimExpiresAtUtc");
            entity.HasIndex(item => item.ReceivedAtUtc)
                .HasDatabaseName("IX_ContactRequests_ReceivedAtUtc");
            entity.HasIndex(item => item.ProviderIdempotencyKey)
                .IsUnique()
                .HasDatabaseName("IX_ContactRequests_ProviderIdempotencyKey");
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ContactRequests_Facts",
                    "length(btrim(\"Name\")) > 0 AND length(btrim(\"GymName\")) > 0 AND length(btrim(\"Contact\")) > 0 AND (\"Message\" IS NULL OR length(btrim(\"Message\")) > 0)");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Counters",
                    "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Claim",
                    "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Vocabulary",
                    "\"ContactKind\" IN ('Email', 'WhatsApp') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'DeadLettered')");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Materialized",
                    "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_ContactRequests_DeadLettered",
                    "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Completion",
                    "(\"Status\" IN ('Materialized', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_ContactRequests_NextAttempt",
                    "\"NextAttemptAtUtc\" >= \"ReceivedAtUtc\"");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Attempted",
                    "(\"ProviderIdempotencyKey\" IS NULL) = (\"AttemptCount\" = 0)");
                table.HasCheckConstraint(
                    "CK_ContactRequests_ProviderEvidence",
                    "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                table.HasCheckConstraint(
                    "CK_ContactRequests_CapturedHasNoProvider",
                    "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Transport",
                    "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                table.HasCheckConstraint(
                    "CK_ContactRequests_Failure",
                    "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" = 'DeadLettered' AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
            });
            ConfigureAuditable(entity);
        });
    }

    /// <summary>A request's facts are what the person wrote; the email's bookkeeping is all that may change.</summary>
    private void RejectContactRequestFactMutations()
    {
        foreach (var entry in ChangeTracker.Entries<ContactRequest>())
        {
            if (entry.State == EntityState.Deleted)
            {
                throw new InvalidOperationException("Contact requests are never deleted.");
            }

            if (entry.State != EntityState.Modified)
            {
                continue;
            }

            if (entry.Property(item => item.Name).IsModified ||
                entry.Property(item => item.GymName).IsModified ||
                entry.Property(item => item.Contact).IsModified ||
                entry.Property(item => item.ContactKind).IsModified ||
                entry.Property(item => item.Message).IsModified ||
                entry.Property(item => item.ReceivedAtUtc).IsModified)
            {
                throw new InvalidOperationException("A contact request's facts are immutable.");
            }
        }
    }
}
