using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    /// <summary>
    /// The two action-mail queues, kept structurally apart because they are owned by different things.
    /// </summary>
    /// <remarks>
    /// <c>identity."ActionMailRequests"</c> has <b>no <c>TenantId</c> column at all</b>, and that
    /// absence is the design rather than an omission. ADR 0021 refuses assigning a fabricated,
    /// arbitrary or "first available" workspace to global Identity mail so it can fit a tenant-shaped
    /// queue: it would put one workspace's operator in the dead-letter view of another person's
    /// password reset. A column that does not exist cannot be fabricated, cannot be joined on, and
    /// cannot be leaked by a tenant-scoped export — which is a stronger guarantee than any check
    /// constraint over a nullable one.
    /// <para>
    /// <c>invitations."ActionMailRequests"</c> is the opposite and equally deliberate: an invitation is
    /// a workspace's own act, so it carries <c>TenantId</c>, a global query filter, tenant-composite
    /// foreign keys throughout, and the write-scope guard. The invitee is not a member, so the
    /// authorization that governs it is the invitation aggregate and never a membership row.
    /// </para>
    /// </remarks>
    private void ConfigureActionMail(ModelBuilder builder)
    {
        ConfigureAccountActionMail(builder);
        ConfigureInvitationActionMail(builder);
    }

    private static void ConfigureAccountActionMail(ModelBuilder builder)
    {
        builder.Entity<AccountActionMailRequest>(entity =>
        {
            entity.ToTable("ActionMailRequests", "identity");
            entity.HasKey(item => item.Id);
            // Including the action kind in the principal key is what makes an attempt whose kind
            // disagrees with its request structurally impossible rather than merely unlikely.
            entity.HasAlternateKey(item => new { item.Id, item.ActionKind });
            entity.Property(item => item.ActionKind).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.RequestSource).HasMaxLength(60).IsRequired();
            entity.Property(item => item.SubjectSecurityStampHash).HasMaxLength(64).IsFixedLength();
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.TransportAdapter).HasMaxLength(40);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            // The due-work index the claim query rides. Status first so the scan touches only the
            // states a sweep can act on, then the instants it orders and filters by.
            entity.HasIndex(item => new { item.Status, item.NextAttemptAtUtc, item.Id })
                .HasDatabaseName("IX_AccountActionMailRequests_Status_NextAttemptAtUtc_Id");
            entity.HasIndex(item => new { item.Status, item.ClaimExpiresAtUtc })
                .HasDatabaseName("IX_AccountActionMailRequests_Status_ClaimExpiresAtUtc");
            entity.HasIndex(item => new { item.SubjectUserId, item.ActionKind, item.RequestedAtUtc })
                .HasDatabaseName("IX_AccountActionMailRequests_Subject_ActionKind_RequestedAtUtc");
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.SubjectUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RequestedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Counters",
                    "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1");
                // A claim is a matched pair or nothing at all, and only Processing may hold one. A
                // terminal row keeping a live lease is what would let a stale worker finalize somebody
                // else's work, so the database refuses the shape outright.
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Claim",
                    "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Vocabulary",
                    "\"ActionKind\" IN ('ConfirmEmail', 'ResetPassword') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");
                // A request either names a subject and the credential state it was made against, or
                // neither. The "neither" shape is the enumeration-resistant row an unknown address
                // produces, and it must carry nothing that could be resolved back to an address.
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Subject",
                    "((\"SubjectUserId\" IS NULL) = (\"SubjectSecurityStampHash\" IS NULL)) AND (\"SubjectSecurityStampHash\" IS NULL OR \"SubjectSecurityStampHash\" ~ '^[0-9a-f]{64}$')");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Materialized",
                    "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_DeadLettered",
                    "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Completion",
                    "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_NextAttempt",
                    "\"NextAttemptAtUtc\" >= \"RequestedAtUtc\"");
                // Provider evidence is a matched pair, only on a materialized request, and only from an
                // adapter that actually contacted a provider. The captured adapter is named explicitly
                // as well as excluded by the allowlist, because "no provider was asked" is the fact
                // being protected and it must not depend on listing every future adapter correctly.
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_ProviderEvidence",
                    "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_CapturedHasNoProvider",
                    "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Transport",
                    "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                table.HasCheckConstraint(
                    "CK_AccountActionMailRequests_Failure",
                    "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<AccountActionMailAttempt>(entity =>
        {
            entity.ToTable("ActionMailAttempts", "identity");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ActionKind).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Outcome).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.ProviderIdempotencyKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            entity.HasIndex(item => new { item.RequestId, item.AttemptNumber })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneAccountActionAttemptPerNumber);
            entity.HasIndex(item => new { item.RequestId, item.ClaimToken })
                .IsUnique()
                .HasDatabaseName("IX_AccountActionMailAttempts_RequestId_ClaimToken");
            // Global, and this is the constraint that makes "one provider key, one tokenized payload"
            // a property of the schema. A re-minted token is a different message, so it must present a
            // different key; a row that reused one would be the one shape a provider answers with a
            // conflict instead of a send.
            entity.HasIndex(item => item.ProviderIdempotencyKey)
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneAccountActionProviderKey);
            entity.HasOne<AccountActionMailRequest>()
                .WithMany()
                .HasForeignKey(item => new { item.RequestId, item.ActionKind })
                .HasPrincipalKey(item => new { item.Id, item.ActionKind })
                .OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_AttemptNumber",
                    "\"AttemptNumber\" >= 1");
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_Completion",
                    "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_Success",
                    "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_Vocabulary",
                    "\"ActionKind\" IN ('ConfirmEmail', 'ResetPassword') AND \"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_ProviderEvidence",
                    "\"ProviderMessageId\" IS NULL OR \"Outcome\" = 'Succeeded'");
                // The key names its own request and attempt, so a key copied from another attempt
                // cannot pass. Combined with the unique index, that is what ties provider keys to
                // exactly one tokenized payload.
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_ProviderKeyShape",
                    "\"ProviderIdempotencyKey\" = 'account-action:' || replace(\"RequestId\"::text, '-', '') || ':a' || \"AttemptNumber\"::text || ':v1:' || right(\"ProviderIdempotencyKey\", 32) AND right(\"ProviderIdempotencyKey\", 32) ~ '^[0-9a-f]{32}$'");
                table.HasCheckConstraint(
                    "CK_AccountActionMailAttempts_TokenMinted",
                    "\"TokenMintedAtUtc\" IS NULL OR \"TokenMintedAtUtc\" >= \"StartedAtUtc\"");
            });
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureInvitationActionMail(ModelBuilder builder)
    {
        builder.Entity<InvitationActionMailRequest>(entity =>
        {
            entity.ToTable("ActionMailRequests", "invitations");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id, item.LogicalSendGeneration });
            entity.HasAlternateKey(item => new
            {
                item.TenantId,
                item.Id,
                item.InvitationId,
                item.LogicalSendGeneration,
            });
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.RequestSource).HasMaxLength(60).IsRequired();
            entity.Property(item => item.PayloadFingerprint).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.TransportAdapter).HasMaxLength(40);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            // One request per invitation and generation. This is the structural half of the
            // resend-versus-retry rule: a transport retry re-enters an existing row and therefore
            // cannot rotate a generation, because there is nowhere for it to write a new one.
            entity.HasIndex(item => new { item.TenantId, item.InvitationId, item.LogicalSendGeneration })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneInvitationRequestPerGeneration);
            // One spent idempotency key per workspace, so two concurrent presses of Resend converge on
            // one new generation instead of racing to create two.
            entity.HasIndex(item => new { item.TenantId, item.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneInvitationActionCommandPerKey);
            entity.HasIndex(item => new { item.Status, item.NextAttemptAtUtc, item.Id })
                .HasDatabaseName("IX_InvitationActionMailRequests_Status_NextAttemptAtUtc_Id");
            entity.HasIndex(item => new { item.Status, item.ClaimExpiresAtUtc })
                .HasDatabaseName("IX_InvitationActionMailRequests_Status_ClaimExpiresAtUtc");
            // Tenant-composite: a request cannot be attached to another workspace's invitation.
            entity.HasOne<ClientInvitation>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.InvitationId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RequestedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Counters",
                    "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1 AND \"LogicalSendGeneration\" >= 1");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Claim",
                    "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Vocabulary",
                    "\"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered') AND \"PayloadFingerprint\" ~ '^[0-9a-f]{64}$'");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Materialized",
                    "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_DeadLettered",
                    "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Completion",
                    "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_NextAttempt",
                    "\"NextAttemptAtUtc\" >= \"RequestedAtUtc\"");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_ProviderEvidence",
                    "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_CapturedHasNoProvider",
                    "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Transport",
                    "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailRequests_Failure",
                    "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<InvitationActionMailAttempt>(entity =>
        {
            entity.ToTable("ActionMailAttempts", "invitations");
            entity.HasKey(item => item.Id);
            // Everything a token issue has to agree with, in one principal key: the workspace, the
            // attempt, the request it belongs to, the generation it was started for, and its number.
            entity.HasAlternateKey(item => new
            {
                item.TenantId,
                item.Id,
                item.RequestId,
                item.LogicalSendGeneration,
                item.AttemptNumber,
            });
            entity.Property(item => item.Outcome).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.ProviderIdempotencyKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.ProviderMessageId).HasMaxLength(200);
            entity.HasIndex(item => new { item.TenantId, item.RequestId, item.AttemptNumber })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneInvitationActionAttemptPerNumber);
            entity.HasIndex(item => new { item.TenantId, item.RequestId, item.ClaimToken })
                .IsUnique()
                .HasDatabaseName("IX_InvitationActionMailAttempts_TenantId_RequestId_ClaimToken");
            entity.HasIndex(item => item.ProviderIdempotencyKey)
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneInvitationActionProviderKey);
            // Tenant, request and generation together: an attempt cannot belong to another workspace's
            // request, and cannot claim a generation its request does not have.
            entity.HasOne<InvitationActionMailRequest>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.RequestId, item.LogicalSendGeneration })
                .HasPrincipalKey(item => new { item.TenantId, item.Id, item.LogicalSendGeneration })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_AttemptNumber",
                    "\"AttemptNumber\" >= 1 AND \"LogicalSendGeneration\" >= 1");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_Completion",
                    "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_Success",
                    "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_Vocabulary",
                    "\"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_ProviderEvidence",
                    "\"ProviderMessageId\" IS NULL OR \"Outcome\" = 'Succeeded'");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_ProviderKeyShape",
                    "\"ProviderIdempotencyKey\" = 'invitation-action:' || replace(\"RequestId\"::text, '-', '') || ':a' || \"AttemptNumber\"::text || ':v1:' || right(\"ProviderIdempotencyKey\", 32) AND right(\"ProviderIdempotencyKey\", 32) ~ '^[0-9a-f]{32}$'");
                table.HasCheckConstraint(
                    "CK_InvitationActionMailAttempts_TokenMinted",
                    "\"TokenMintedAtUtc\" IS NULL OR \"TokenMintedAtUtc\" >= \"StartedAtUtc\"");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<InvitationTokenIssue>(entity =>
        {
            entity.ToTable("TokenIssues", "invitations");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.TokenHash).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(item => item.RevocationReason).HasMaxLength(100);
            // Global rather than tenant-scoped, and deliberately so. Acceptance resolves a workspace
            // *from* this hash, so a hash that could exist in two workspaces would be one that resolves
            // to two answers — and the anonymous acceptance route would have to pick one.
            entity.HasIndex(item => item.TokenHash)
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneInvitationTokenPerHash);
            entity.HasIndex(item => new { item.TenantId, item.InvitationId, item.LogicalSendGeneration })
                .HasDatabaseName("IX_InvitationTokenIssues_TenantId_InvitationId_Generation");
            entity.HasIndex(item => new { item.TenantId, item.ActionMailRequestId })
                .HasDatabaseName("IX_InvitationTokenIssues_TenantId_ActionMailRequestId");
            entity.HasOne<ClientInvitation>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.InvitationId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            // The request this token was minted for must be the same workspace's request, for the same
            // invitation, at the same generation. A token hash attached to another invitation or
            // another generation is refused by the foreign key rather than by a code path.
            entity.HasOne<InvitationActionMailRequest>()
                .WithMany()
                .HasForeignKey(item => new
                {
                    item.TenantId,
                    item.ActionMailRequestId,
                    item.InvitationId,
                    item.LogicalSendGeneration,
                })
                .HasPrincipalKey(item => new
                {
                    item.TenantId,
                    item.Id,
                    item.InvitationId,
                    item.LogicalSendGeneration,
                })
                .OnDelete(DeleteBehavior.Restrict);
            // And a token row without a real started materialization attempt is impossible: the
            // attempt, its request and its generation and number all have to agree.
            entity.HasOne<InvitationActionMailAttempt>()
                .WithMany()
                .HasForeignKey(item => new
                {
                    item.TenantId,
                    item.ActionMailAttemptId,
                    item.ActionMailRequestId,
                    item.LogicalSendGeneration,
                    item.AttemptNumber,
                })
                .HasPrincipalKey(item => new
                {
                    item.TenantId,
                    item.Id,
                    item.RequestId,
                    item.LogicalSendGeneration,
                    item.AttemptNumber,
                })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.RedeemedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_InvitationTokenIssues_Shape",
                    "\"TokenHash\" ~ '^[0-9a-f]{64}$' AND \"LogicalSendGeneration\" >= 1 AND \"AttemptNumber\" >= 1");
                table.HasCheckConstraint(
                    "CK_InvitationTokenIssues_Expiry",
                    "\"ExpiresAtUtc\" > \"IssuedAtUtc\"");
                table.HasCheckConstraint(
                    "CK_InvitationTokenIssues_Revocation",
                    "(\"RevokedAtUtc\" IS NULL) = (\"RevocationReason\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_InvitationTokenIssues_Redemption",
                    "(\"RedeemedAtUtc\" IS NULL) = (\"RedeemedByUserId\" IS NULL)");
                // A token is either revoked or redeemed, never both. Revoking a redeemed token would
                // be a way to erase that a link was used; redeeming a revoked one is the thing
                // revocation exists to prevent.
                table.HasCheckConstraint(
                    "CK_InvitationTokenIssues_SingleTerminalFact",
                    "\"RevokedAtUtc\" IS NULL OR \"RedeemedAtUtc\" IS NULL");
            });
            ConfigureAuditable(entity);
        });
    }
}
