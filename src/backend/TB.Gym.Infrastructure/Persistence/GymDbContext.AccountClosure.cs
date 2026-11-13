using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    public DbSet<AccountClosure> AccountClosures => Set<AccountClosure>();

    /// <summary>
    /// What an anonymised client record holds (CLI-027), in SQL: the anonymous name, the reserved address of its
    /// own id, and nothing else personal. A check, so no later write can put a person back into it.
    /// </summary>
    internal const string AnonymisedClientProfileSql =
        "\"AnonymisedAtUtc\" IS NULL OR (\"ReleasedAtUtc\" IS NOT NULL"
        + " AND \"FirstName\" = 'Closed' AND \"LastName\" = 'account'"
        + " AND \"Email\" = 'closed-' || replace(\"Id\"::text, '-', '') || '@closed.tbgym.invalid'"
        + " AND \"NormalizedEmail\" = upper(\"Email\")"
        + " AND \"PhoneNumber\" IS NULL AND \"BirthDate\" IS NULL"
        + " AND \"HeightCentimeters\" IS NULL AND \"HeightEnteredValue\" IS NULL AND \"HeightEnteredUnit\" IS NULL"
        + " AND \"WorkType\" IS NULL AND \"AverageDailySteps\" IS NULL AND \"TrainingBackground\" IS NULL"
        + " AND \"FoodPreferences\" IS NULL AND \"FoodAversions\" IS NULL AND \"Goals\" IS NULL"
        + " AND \"Allergies\" IS NULL AND \"Medications\" IS NULL AND \"PreviousInjuries\" IS NULL"
        + " AND \"CoachNotes\" IS NULL)";

    /// <summary>What an anonymised invitation holds (CLI-027): an accepted one, with nothing the coach typed left.</summary>
    internal const string AnonymisedClientInvitationSql =
        "\"AnonymisedAtUtc\" IS NULL OR (\"Status\" = 'Accepted'"
        + " AND \"FirstName\" = 'Closed' AND \"LastName\" = 'account'"
        + " AND \"Email\" = 'closed-' || replace(\"Id\"::text, '-', '') || '@closed.tbgym.invalid'"
        + " AND \"PhoneNumber\" IS NULL AND \"BirthDate\" IS NULL)";

    /// <summary>
    /// Closing an account (CLI-027): the append-only record of each closing, on the account and not in any workspace,
    /// and the anonymised shapes of a client record and of an invitation. The triggers that let an ended record and
    /// an accepted invitation take this one change, and no other, are the migration's.
    /// </summary>
    private static void ConfigureAccountClosure(ModelBuilder builder)
    {
        builder.Entity<AccountClosure>(entity =>
        {
            entity.ToTable("AccountClosures", "identity", table =>
            {
                table.HasCheckConstraint(
                    "CK_AccountClosures_Counts",
                    "\"SpacesLeft\" >= 0 AND \"RecordsAnonymised\" >= 0 AND \"PhotosRemoved\" >= 0");
                // A person closes their own account; the platform admin closes one on a request of a named day.
                table.HasCheckConstraint(
                    "CK_AccountClosures_Source",
                    "(\"Source\" = 'Self' AND \"ClosedByUserId\" = \"UserId\" AND \"RequestedOn\" IS NULL)"
                    + " OR (\"Source\" = 'OnRequest' AND \"ClosedByUserId\" <> \"UserId\" AND \"RequestedOn\" IS NOT NULL)");
            });
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.RequestedOn).HasColumnType("date");
            // One closing an account: a second request finds it closed.
            entity.HasIndex(item => item.UserId).IsUnique();
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.ClosedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureAuditable(entity);
        });

        builder.Entity<ClientProfile>(entity =>
            entity.ToTable(table => table.HasCheckConstraint("CK_ClientProfiles_Anonymised", AnonymisedClientProfileSql)));

        builder.Entity<ClientInvitation>(entity =>
            entity.ToTable(table => table.HasCheckConstraint("CK_ClientInvitations_Anonymised", AnonymisedClientInvitationSql)));
    }
}
