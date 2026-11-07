using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    /// <summary>The certificate record (CLI-021): one line per proof, about a coach in one coaching space.</summary>
    public DbSet<CoachCertificateLine> CoachCertificateLines => Set<CoachCertificateLine>();

    private void ConfigureCoachCertificates(ModelBuilder builder)
    {
        builder.Entity<CoachCertificateLine>(entity =>
        {
            entity.ToTable("CoachCertificateLines", "identity");
            entity.HasKey(item => item.Id);
            ConfigureTenantEntity(entity);
            entity.Ignore(item => item.State);
            entity.Ignore(item => item.IsShownToClients);
            entity.Property(item => item.What).HasMaxLength(CoachCertificateLine.MaximumWhatLength).IsRequired();
            entity.Property(item => item.ShownOn).HasColumnType("date");
            entity.Property(item => item.ConfirmedByName).HasMaxLength(CoachCertificateLine.MaximumConfirmedByNameLength);
            entity.Property(item => item.ErasureReason).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.RequestedOn).HasColumnType("date");
            // The same words and day for the same coach in the same space are one line: a second add answers it.
            entity.HasIndex(item => new { item.TenantId, item.CoachUserId, item.What, item.ShownOn })
                .IsUnique()
                .HasFilter("\"ErasedAtUtc\" IS NULL")
                .HasDatabaseName(DatabaseConstraintNames.OneCoachCertificateLinePerWordsAndDay);
            // A coach's lines in a space, newest first, erased ones too.
            entity.HasIndex(item => new { item.TenantId, item.CoachUserId, item.CreatedAtUtc });
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(item => item.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            // About a member of the space: the membership row stays when they leave, so their lines do too.
            entity.HasOne<TenantMembership>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.CoachUserId })
                .HasPrincipalKey(membership => new { membership.TenantId, membership.UserId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RecordedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.TakenDownByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.ErasedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                // Words and day are there exactly until the line is erased, and nothing of them stays after.
                table.HasCheckConstraint(
                    "CK_CoachCertificateLines_Words",
                    $"(\"ErasedAtUtc\" IS NULL AND char_length(\"What\") BETWEEN 1 AND {CoachCertificateLine.MaximumWhatLength} " +
                    "AND \"What\" = btrim(\"What\") AND \"ShownOn\" IS NOT NULL) " +
                    "OR (\"ErasedAtUtc\" IS NOT NULL AND \"What\" = '' AND \"ShownOn\" IS NULL)");
                // Who confirmed it is there exactly when it was confirmed; an erasure blanks the name, not the date.
                table.HasCheckConstraint(
                    "CK_CoachCertificateLines_Confirmed",
                    "(\"ConfirmedAtUtc\" IS NULL) = (\"ConfirmedByName\" IS NULL) " +
                    $"AND (\"ConfirmedByName\" IS NULL OR (\"ErasedAtUtc\" IS NULL AND char_length(\"ConfirmedByName\") BETWEEN 1 AND {CoachCertificateLine.MaximumConfirmedByNameLength} " +
                    "AND \"ConfirmedByName\" = btrim(\"ConfirmedByName\")) OR (\"ErasedAtUtc\" IS NOT NULL AND \"ConfirmedByName\" = '')) " +
                    "AND (\"ConfirmedAtUtc\" IS NULL OR \"ConfirmedAtUtc\" >= \"CreatedAtUtc\")");
                // Only a confirmed line is taken down, once, by someone.
                table.HasCheckConstraint(
                    "CK_CoachCertificateLines_TakenDown",
                    "(\"TakenDownAtUtc\" IS NULL) = (\"TakenDownByUserId\" IS NULL) " +
                    "AND (\"TakenDownAtUtc\" IS NULL OR (\"ConfirmedAtUtc\" IS NOT NULL AND \"TakenDownAtUtc\" >= \"ConfirmedAtUtc\"))");
                // Only a confirmed line is erased (a waiting one is dropped); a request names its day and who
                // erased it, and the keeping period neither.
                table.HasCheckConstraint(
                    "CK_CoachCertificateLines_Erased",
                    "(\"ErasedAtUtc\" IS NULL) = (\"ErasureReason\" IS NULL) " +
                    "AND (\"ErasedAtUtc\" IS NULL OR (\"ConfirmedAtUtc\" IS NOT NULL AND \"ErasedAtUtc\" >= \"ConfirmedAtUtc\")) " +
                    "AND (\"ErasureReason\" IS NULL OR \"ErasureReason\" IN ('Request', 'KeepingPeriod')) " +
                    "AND (\"ErasureReason\" IS NOT DISTINCT FROM 'Request') = (\"ErasedByUserId\" IS NOT NULL) " +
                    "AND (\"ErasureReason\" IS NOT DISTINCT FROM 'Request') = (\"RequestedOn\" IS NOT NULL)");
            });
        });
    }

    /// <summary>
    /// A certificate line (CLI-021) may be dropped only while it waits; once confirmed its words, its day and who
    /// confirmed it never change and the row is never deleted. The one later change to them is the erasure,
    /// which blanks the text once, and nothing changes after that. The trigger is the guarantee; this names the
    /// mistake in the code path that made it.
    /// </summary>
    private void RejectCoachCertificateLineMutations()
    {
        foreach (var entry in ChangeTracker.Entries<CoachCertificateLine>())
        {
            var wasConfirmed =
                entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(CoachCertificateLine.ConfirmedAtUtc)) is not null;
            if (entry.State == EntityState.Deleted)
            {
                if (wasConfirmed)
                {
                    throw new InvalidOperationException(
                        "A confirmed certificate line is never deleted; take it down or erase it instead.");
                }

                continue;
            }

            if (entry.State != EntityState.Modified)
            {
                continue;
            }

            var wasTakenDown =
                entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(CoachCertificateLine.TakenDownAtUtc)) is not null;
            var erasing = entry.Entity.ErasedAtUtc is not null;
            if (entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(CoachCertificateLine.ErasedAtUtc)) is not null ||
                entry.Properties.Any(property =>
                    property.IsModified &&
                    property.Metadata.Name switch
                    {
                        nameof(CoachCertificateLine.UpdatedAtUtc)
                            or nameof(CoachCertificateLine.UpdatedByUserId) => false,
                        nameof(CoachCertificateLine.CoachShows) => erasing,
                        nameof(CoachCertificateLine.ConfirmedAtUtc) => wasConfirmed || erasing,
                        nameof(CoachCertificateLine.ConfirmedByName) => wasConfirmed && !erasing,
                        nameof(CoachCertificateLine.TakenDownAtUtc)
                            or nameof(CoachCertificateLine.TakenDownByUserId) => wasTakenDown || erasing,
                        nameof(CoachCertificateLine.What)
                            or nameof(CoachCertificateLine.ShownOn)
                            or nameof(CoachCertificateLine.ErasedAtUtc)
                            or nameof(CoachCertificateLine.ErasedByUserId)
                            or nameof(CoachCertificateLine.ErasureReason)
                            or nameof(CoachCertificateLine.RequestedOn) => !erasing,
                        _ => true,
                    }))
            {
                throw new InvalidOperationException(
                    "A certificate line's words never change once confirmed and an erased line never changes; it can be confirmed, taken down and erased, each once.");
            }
        }
    }
}
