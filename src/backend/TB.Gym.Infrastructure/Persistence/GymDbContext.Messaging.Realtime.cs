using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    /// <summary>
    /// The Phase 6B-2B realtime delivery graph.
    /// </summary>
    /// <remarks>
    /// Four tables, and none of them is a second copy of a message. An event says that something
    /// happened and where in the conversation's own event order; a recipient row says how far one
    /// participant's publication of it has got; an attempt row says what one try did; an
    /// acknowledgement says that a participant's application accepted it. The body, the previous
    /// revisions and the moderation reason stay exactly where 6B-2A put them, and are read at
    /// delivery time through the live tables after that participant's current authorization has been
    /// re-established.
    /// <para>
    /// Every foreign key carries <c>TenantId</c>, and several carry more than that so a cross-row
    /// mismatch is inexpressible rather than merely refused:
    /// </para>
    /// <code>
    /// RealtimeEvents      (TenantId, ConversationId)                    -> Conversations (TenantId, Id)
    /// RealtimeEvents      (TenantId, MessageId, ConversationId)         -> Messages (TenantId, Id, ConversationId)
    /// RealtimeEvents      (TenantId, SourceCommandRecordId)             -> CommandRecords (TenantId, Id)
    /// RealtimeRecipients  (TenantId, RealtimeEventId, ConversationId)   -> RealtimeEvents (TenantId, Id, ConversationId)
    /// RealtimeRecipients  (TenantId, ConversationId, RecipientUserId)   -> ConversationParticipants (TenantId, ConversationId, UserId)
    /// RealtimeAttempts    (TenantId, RecipientId)                       -> RealtimeRecipients (TenantId, Id)
    /// RealtimeAcks        (TenantId, RealtimeEventId, ConversationId)   -> RealtimeEvents (TenantId, Id, ConversationId)
    /// RealtimeAcks        (TenantId, RealtimeEventId, AckedByUserId)    -> RealtimeRecipients (TenantId, RealtimeEventId, RecipientUserId)
    /// </code>
    /// <para>
    /// The last two are the load-bearing ones. A recipient row can only name a participant of the
    /// exact conversation the event belongs to, and an acknowledgement can only answer a recipient row
    /// that was actually addressed — so "acknowledge somebody else's event", "acknowledge an event
    /// nobody sent you" and "acknowledge across workspaces" are not expressible rather than checked.
    /// </para>
    /// </remarks>
    private void ConfigureMessagingRealtime(ModelBuilder builder)
    {
        builder.Entity<MessagingRealtimeEvent>(entity =>
        {
            entity.ToTable("RealtimeEvents", "messaging");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            // The key the recipient rows and the acknowledgements point at, so a child can never name
            // one conversation while its event belongs to another.
            entity.HasAlternateKey(item => new { item.TenantId, item.Id, item.ConversationId });
            // One event per position, per conversation. The catch-up cursor depends on this being
            // unique and gap-free; the deferred tip trigger added by the migration is what makes the
            // gap-free half true.
            entity.HasIndex(item => new { item.TenantId, item.ConversationId, item.EventSequence })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneRealtimeEventPerConversationSequence);
            // One event per source mutation. A settled idempotent replay returns the original result
            // and cannot allocate a second event, and this is what says so in the database rather
            // than only in the code path that happens to be running.
            entity.HasIndex(item => new { item.TenantId, item.SourceCommandRecordId })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneRealtimeEventPerSourceCommand);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(32);
            entity.HasOne<Conversation>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ConversationId })
                .HasPrincipalKey(conversation => new { conversation.TenantId, conversation.Id })
                .OnDelete(DeleteBehavior.Restrict);
            // MessageId is null for a conversation creation, and PostgreSQL's MATCH SIMPLE leaves
            // such a row unconstrained by this key, which is exactly the intent.
            entity.HasOne<Message>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MessageId, item.ConversationId })
                .HasPrincipalKey(message => new { message.TenantId, message.Id, message.ConversationId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MessagingCommandRecord>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.SourceCommandRecordId })
                .HasPrincipalKey(record => new { record.TenantId, record.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_RealtimeEvents_EventSequence",
                    "\"EventSequence\" >= 1");
                table.HasCheckConstraint(
                    "CK_RealtimeEvents_KindValue",
                    "\"Kind\" IN ('ConversationCreated', 'MessageSent', 'MessageEdited', "
                    + "'MessageSenderRemoved', 'MessageCoachModerated')");
                // Every kind but a creation is about exactly one message, and all three message
                // columns travel together: half a reference is a row nothing can be projected from.
                table.HasCheckConstraint(
                    "CK_RealtimeEvents_Message",
                    "(\"MessageId\" IS NULL) = (\"Kind\" = 'ConversationCreated') "
                    + "AND (\"MessageId\" IS NULL) = (\"MessageSequence\" IS NULL) "
                    + "AND (\"MessageId\" IS NULL) = (\"MessageRevisionNumber\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_RealtimeEvents_MessagePosition",
                    "(\"MessageSequence\" IS NULL OR \"MessageSequence\" >= 1) "
                    + "AND (\"MessageRevisionNumber\" IS NULL OR \"MessageRevisionNumber\" >= 1)");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<MessagingRealtimeRecipient>(entity =>
        {
            entity.ToTable("RealtimeRecipients", "messaging");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            // One publication state per event and participant, and the key an acknowledgement answers.
            entity.HasAlternateKey(item => new
            {
                item.TenantId,
                item.RealtimeEventId,
                item.RecipientUserId,
            });
            // The claim scan: due Pending work and Processing work whose lease has run out, oldest
            // first. Ordered so two replicas sweeping at once walk the backlog the same way and
            // SKIP LOCKED simply divides it between them.
            entity.HasIndex(item => new { item.TenantId, item.Status, item.NextAttemptAtUtc })
                .HasDatabaseName("IX_RealtimeRecipients_TenantId_Status_NextAttemptAtUtc");
            entity.HasIndex(item => new { item.TenantId, item.ConversationId, item.RecipientUserId })
                .HasDatabaseName("IX_RealtimeRecipients_TenantId_ConversationId_RecipientUserId");
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.HasOne<MessagingRealtimeEvent>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.RealtimeEventId, item.ConversationId })
                .HasPrincipalKey(source => new { source.TenantId, source.Id, source.ConversationId })
                .OnDelete(DeleteBehavior.Restrict);
            // A recipient who is not an explicit participant of this exact conversation, in this
            // workspace, cannot be inserted. Forged recipient state is therefore refused by
            // referential integrity rather than by a predicate somebody has to remember to write.
            entity.HasOne<ConversationParticipant>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ConversationId, item.RecipientUserId })
                .HasPrincipalKey(participant => new
                {
                    participant.TenantId,
                    participant.ConversationId,
                    participant.UserId,
                })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_StatusValue",
                    "\"Status\" IN ('Pending', 'Processing', 'Published', 'Suppressed', 'DeadLettered')");
                // The hard ceiling the database can know. The configured maximum is validated at
                // startup and is never allowed above this, so an attempt number beyond it is a bug or
                // a raw write rather than a configuration choice.
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_AttemptCount",
                    "\"AttemptCount\" >= 0 AND \"AttemptCount\" <= 20");
                // A lease belongs to Processing and to nothing else, and its two halves travel
                // together. A terminal row carrying a live claim is how a stale worker finalizes over
                // a newer one.
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_Claim",
                    "(\"ClaimToken\" IS NOT NULL) = (\"Status\" = 'Processing') "
                    + "AND (\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL)");
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_Published",
                    "(\"PublishedAtUtc\" IS NOT NULL) = (\"Status\" = 'Published')");
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_Completed",
                    "(\"CompletedAtUtc\" IS NOT NULL) = "
                    + "(\"Status\" IN ('Published', 'Suppressed', 'DeadLettered'))");
                // A published row explains nothing and must carry no failure code; a suppressed or
                // dead-lettered one must carry the stable reason it ended.
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_FailureCode",
                    "(\"Status\" = 'Published' AND \"FailureCode\" IS NULL) "
                    + "OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) "
                    + "OR \"Status\" IN ('Pending', 'Processing')");
                // A publication cannot have happened before there was anything to publish.
                table.HasCheckConstraint(
                    "CK_RealtimeRecipients_PublishedAttempt",
                    "\"PublishedAtUtc\" IS NULL OR \"AttemptCount\" >= 1");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<MessagingRealtimeAttempt>(entity =>
        {
            entity.ToTable("RealtimeAttempts", "messaging");
            entity.HasKey(item => item.Id);
            // Append-only and one row per attempt number. With the deferred chain assertion in the
            // migration, the attempt history is exactly 1..AttemptCount: a try cannot be deleted to
            // buy another one, and a number cannot be skipped to hide one.
            entity.HasIndex(item => new { item.TenantId, item.RecipientId, item.AttemptNumber })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneRealtimeAttemptPerNumber);
            entity.Property(item => item.Outcome).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.HasOne<MessagingRealtimeRecipient>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.RecipientId })
                .HasPrincipalKey(recipient => new { recipient.TenantId, recipient.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_RealtimeAttempts_AttemptNumber",
                    "\"AttemptNumber\" >= 1 AND \"AttemptNumber\" <= 20");
                table.HasCheckConstraint(
                    "CK_RealtimeAttempts_OutcomeValue",
                    "\"Outcome\" IN ('Started', 'Published', 'TransientFailure', "
                    + "'PermanentFailure', 'Abandoned', 'Suppressed')");
                table.HasCheckConstraint(
                    "CK_RealtimeAttempts_Completion",
                    "(\"CompletedAtUtc\" IS NOT NULL) = (\"Outcome\" <> 'Started') "
                    + "AND (\"CompletedAtUtc\" IS NULL OR \"CompletedAtUtc\" >= \"StartedAtUtc\")");
                // A published attempt succeeded and has nothing to explain; every other completed
                // outcome is a reason and must name it.
                table.HasCheckConstraint(
                    "CK_RealtimeAttempts_FailureCode",
                    "(\"Outcome\" IN ('Started', 'Published') AND \"FailureCode\" IS NULL) "
                    + "OR (\"Outcome\" NOT IN ('Started', 'Published') AND \"FailureCode\" IS NOT NULL)");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<MessagingRealtimeAcknowledgement>(entity =>
        {
            entity.ToTable("RealtimeAcknowledgements", "messaging");
            entity.HasKey(item => item.Id);
            // One acknowledgement per event and participant. This is what makes a concurrent or
            // repeated acknowledgement one durable fact rather than a race, and it is the database
            // key the endpoint's idempotency rests on rather than a check-then-insert.
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.RealtimeEventId,
                item.AcknowledgedByUserId,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneRealtimeAcknowledgementPerRecipient);
            entity.HasIndex(item => new { item.TenantId, item.ConversationId, item.AcknowledgedAtUtc })
                .HasDatabaseName(DatabaseConstraintNames.RealtimeAcknowledgementsByConversation);
            entity.HasOne<MessagingRealtimeEvent>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.RealtimeEventId, item.ConversationId })
                .HasPrincipalKey(source => new { source.TenantId, source.Id, source.ConversationId })
                .OnDelete(DeleteBehavior.Restrict);
            // Only an event actually addressed to this participant can be acknowledged by them, and
            // the key says so. Somebody else's event, an event from another workspace and an event
            // this participant was never a recipient of are all simply not insertable.
            entity.HasOne<MessagingRealtimeRecipient>()
                .WithMany()
                .HasForeignKey(item => new
                {
                    item.TenantId,
                    item.RealtimeEventId,
                    item.AcknowledgedByUserId,
                })
                .HasPrincipalKey(recipient => new
                {
                    recipient.TenantId,
                    recipient.RealtimeEventId,
                    recipient.RecipientUserId,
                })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(item => item.AcknowledgedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });
    }
}
