using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureCheckIns(ModelBuilder builder)
    {
        builder.Entity<CheckInForm>(entity =>
        {
            entity.ToTable("CheckInForms", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Title).HasMaxLength(160).IsRequired();
            entity.Property(item => item.Description).HasMaxLength(2_000);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(item => new { item.TenantId, item.IsArchived, item.Title });
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_CheckInForms_CurrentVersionNumber",
                "\"CurrentVersionNumber\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInFormVersion>(entity =>
        {
            entity.ToTable("CheckInFormVersions", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(item => new { item.TenantId, item.FormId, item.VersionNumber }).IsUnique();

            // At most one open draft per lineage, so "the draft" is never ambiguous. The predicate
            // column is redundant with Status on purpose and a check constraint keeps them aligned,
            // the same shape the active-bodyweight index uses.
            entity.HasIndex(item => new { item.TenantId, item.FormId })
                .IsUnique()
                .HasFilter("\"IsDraft\"");
            entity.HasOne<CheckInForm>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.FormId })
                .HasPrincipalKey(form => new { form.TenantId, form.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CheckInFormVersion>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.DerivedFromVersionId })
                .HasPrincipalKey(version => new { version.TenantId, version.Id })
                .OnDelete(DeleteBehavior.Restrict);

            // Cascade so replacing a draft's question set deletes the rows it removed. A version is
            // never deleted, so the cascade only ever fires through the application's own edit.
            entity.HasMany(item => item.Questions)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.FormVersionId })
                .HasPrincipalKey(version => new { version.TenantId, version.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_CheckInFormVersions_IsDraft",
                    "(\"Status\" = 'Draft') = \"IsDraft\"");
                table.HasCheckConstraint(
                    "CK_CheckInFormVersions_Published",
                    "\"Status\" <> 'Published' OR (\"PublishedAtUtc\" IS NOT NULL AND \"PublishedByUserId\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_CheckInFormVersions_VersionNumber",
                    "\"VersionNumber\" >= 1");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInQuestion>(entity =>
        {
            entity.ToTable("CheckInQuestions", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.QuestionKey).HasMaxLength(32).IsFixedLength().IsRequired();
            entity.Property(item => item.QuestionType).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Prompt).HasMaxLength(500).IsRequired();
            entity.Property(item => item.HelpText).HasMaxLength(1_000);
            entity.Property(item => item.ScaleMinimum).HasPrecision(10, 3);
            entity.Property(item => item.ScaleMaximum).HasPrecision(10, 3);
            entity.Property(item => item.ScaleStep).HasPrecision(10, 3);

            // Deliberately not unique: contiguity and per-version key uniqueness are enforced by one
            // deferred constraint trigger, which tolerates the delete-then-insert of a draft rewrite
            // that a plain unique index would reject mid-statement.
            entity.HasIndex(item => new { item.TenantId, item.FormVersionId, item.Order });
            entity.HasIndex(item => new { item.TenantId, item.QuestionKey });
            entity.HasMany(item => item.Options)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.QuestionId })
                .HasPrincipalKey(question => new { question.TenantId, question.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_CheckInQuestions_Order", "\"Order\" >= 1");
                table.HasCheckConstraint(
                    "CK_CheckInQuestions_QuestionKey",
                    "\"QuestionKey\" ~ '^[0-9a-f]{32}$'");

                // The scale is all three columns or none, and the step has to land exactly on the
                // maximum. Numeric modulo is exact in PostgreSQL, so this is the same arithmetic the
                // domain performs rather than an approximation of it.
                table.HasCheckConstraint(
                    "CK_CheckInQuestions_Scale",
                    "(\"QuestionType\" = 'NumericScale' AND \"ScaleMinimum\" IS NOT NULL AND \"ScaleMaximum\" IS NOT NULL " +
                    "AND \"ScaleStep\" IS NOT NULL AND \"ScaleMinimum\" < \"ScaleMaximum\" AND \"ScaleStep\" > 0 " +
                    "AND (\"ScaleMaximum\" - \"ScaleMinimum\") % \"ScaleStep\" = 0) OR " +
                    "(\"QuestionType\" <> 'NumericScale' AND \"ScaleMinimum\" IS NULL AND \"ScaleMaximum\" IS NULL " +
                    "AND \"ScaleStep\" IS NULL)");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInQuestionOption>(entity =>
        {
            entity.ToTable("CheckInQuestionOptions", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Label).HasMaxLength(200).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.QuestionId, item.Order });
            entity.ToTable(table => table.HasCheckConstraint("CK_CheckInQuestionOptions_Order", "\"Order\" >= 1"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInAssignment>(entity =>
        {
            entity.ToTable("CheckInAssignments", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.DueDate).HasColumnType("date");

            // One check-in of a given form due on a given day per client. Assigning the same form for
            // a later date is a new assignment, which is how a weekly check-in repeats.
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.ClientProfileId,
                item.FormId,
                item.DueDate,
            }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.DueDate });
            entity.HasIndex(item => new { item.TenantId, item.FormVersionId });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CheckInFormVersion>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.FormVersionId })
                .HasPrincipalKey(version => new { version.TenantId, version.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CheckInForm>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.FormId })
                .HasPrincipalKey(form => new { form.TenantId, form.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInLifecycleEvent>(entity =>
        {
            entity.ToTable("CheckInLifecycleEvents", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EventType).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.FormId, item.OccurredAtUtc });
            entity.HasIndex(item => new { item.TenantId, item.AssignmentId });
            entity.HasOne<CheckInForm>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.FormId })
                .HasPrincipalKey(form => new { form.TenantId, form.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CheckInFormVersion>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.FormVersionId })
                .HasPrincipalKey(version => new { version.TenantId, version.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CheckInAssignment>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.AssignmentId })
                .HasPrincipalKey(assignment => new { assignment.TenantId, assignment.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_CheckInLifecycleEvents_Assignment",
                "(\"EventType\" = 'AssignmentCreated') = (\"AssignmentId\" IS NOT NULL) AND " +
                "(\"EventType\" = 'AssignmentCreated') = (\"ClientProfileId\" IS NOT NULL)"));
            ConfigureTenantEntity(entity);
        });

        ConfigureCheckInResponses(builder);
    }

    /// <summary>
    /// The answering half. Its foreign keys are deliberately wider than they need to be to find a row:
    /// each one carries the parent's discriminating columns as well, so "this answer belongs to a
    /// question of the version this response answers" and "this selection belongs to the question it
    /// answers" are decided by referential integrity rather than by application code that could be
    /// bypassed by a repair script or forgotten in a new code path.
    /// </summary>
    private void ConfigureCheckInResponses(ModelBuilder builder)
    {
        builder.Entity<CheckInResponse>(entity =>
        {
            entity.ToTable("CheckInResponses", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.SubmittedDate).HasColumnType("date");

            // Exactly one response per assignment: answering is not something a client can start twice.
            entity.HasIndex(item => new { item.TenantId, item.AssignmentId }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.Status });
            entity.HasIndex(item => new { item.TenantId, item.FormVersionId });

            // One key pins the assignment, the version it named and the client all at once, so a
            // response cannot drift onto another version or another client than the one it was for.
            entity.HasOne<CheckInAssignment>()
                .WithMany()
                .HasForeignKey(item => new
                {
                    item.TenantId,
                    item.AssignmentId,
                    item.FormVersionId,
                    item.ClientProfileId,
                })
                .HasPrincipalKey(assignment => new
                {
                    assignment.TenantId,
                    assignment.Id,
                    assignment.FormVersionId,
                    assignment.ClientProfileId,
                })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(item => item.Answers)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.ResponseId, item.FormVersionId })
                .HasPrincipalKey(response => new { response.TenantId, response.Id, response.FormVersionId })
                .OnDelete(DeleteBehavior.Cascade);

            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_CheckInResponses_Submission",
                    "(\"Status\" = 'Draft') = (\"SubmittedAtUtc\" IS NULL) AND " +
                    "(\"SubmittedAtUtc\" IS NULL) = (\"SubmittedDate\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_CheckInResponses_Review",
                    "(\"Status\" = 'Reviewed') = (\"ReviewedAtUtc\" IS NOT NULL) AND " +
                    "(\"ReviewedAtUtc\" IS NULL) = (\"ReviewedByUserId\" IS NULL)");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInAnswer>(entity =>
        {
            entity.ToTable("CheckInAnswers", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.QuestionType).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.TextValue).HasMaxLength(CheckInAnswerLimits.LongTextLength);
            entity.Property(item => item.NumericValue).HasPrecision(10, 3);

            // One answer row per question per response.
            entity.HasIndex(item => new { item.TenantId, item.ResponseId, item.QuestionId }).IsUnique();

            // The question must belong to this response's version and its type must match what the
            // answer claims, both decided by this one key.
            entity.HasOne<CheckInQuestion>()
                .WithMany()
                .HasForeignKey(item => new
                {
                    item.TenantId,
                    item.FormVersionId,
                    item.QuestionId,
                    item.QuestionType,
                })
                .HasPrincipalKey(question => new
                {
                    question.TenantId,
                    question.FormVersionId,
                    question.Id,
                    question.QuestionType,
                })
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(item => item.Choices)
                .WithOne()
                .HasForeignKey(item => new { item.TenantId, item.AnswerId, item.QuestionId })
                .HasPrincipalKey(answer => new { answer.TenantId, answer.Id, answer.QuestionId })
                .OnDelete(DeleteBehavior.Cascade);

            entity.ToTable(table => table.HasCheckConstraint(
                "CK_CheckInAnswers_ValueShape",
                "(\"QuestionType\" IN ('ShortText', 'LongText') AND \"NumericValue\" IS NULL) OR " +
                "(\"QuestionType\" = 'NumericScale' AND \"TextValue\" IS NULL) OR " +
                "(\"QuestionType\" IN ('SingleChoice', 'MultipleChoice') AND \"TextValue\" IS NULL " +
                "AND \"NumericValue\" IS NULL)"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInAnswerChoice>(entity =>
        {
            entity.ToTable("CheckInAnswerChoices", "checkins");
            entity.HasKey(item => item.Id);

            // The same option cannot be selected twice in one answer.
            entity.HasIndex(item => new { item.TenantId, item.AnswerId, item.QuestionOptionId }).IsUnique();

            // The option has to be one of that question's own options. Every version owns its own
            // option rows, so an option from another version simply is not reachable through this key.
            entity.HasOne<CheckInQuestionOption>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.QuestionId, item.QuestionOptionId })
                .HasPrincipalKey(option => new { option.TenantId, option.QuestionId, option.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CheckInResponseEvent>(entity =>
        {
            entity.ToTable("CheckInResponseEvents", "checkins");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EventType).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(item => new { item.TenantId, item.ResponseId, item.OccurredAtUtc });
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.OccurredAtUtc });

            // At most one submit and one review per response, so the history cannot claim a response
            // was submitted twice even if a caller found a way to ask for it.
            entity.HasIndex(item => new { item.TenantId, item.ResponseId, item.EventType }).IsUnique();
            entity.HasOne<CheckInResponse>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ResponseId })
                .HasPrincipalKey(response => new { response.TenantId, response.Id })
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });
    }
}
