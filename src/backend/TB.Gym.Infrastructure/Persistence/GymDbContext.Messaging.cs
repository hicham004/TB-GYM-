using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    /// <summary>
    /// The Messaging schema.
    /// </summary>
    /// <remarks>
    /// Every foreign key in this graph carries <c>TenantId</c>, so a child pointing at another
    /// workspace's parent is refused by referential integrity rather than by a code path somebody has
    /// to remember to write. The chain is:
    /// <code>
    /// ConversationParticipants (TenantId, ConversationId) -> Conversations (TenantId, Id)
    /// Messages                 (TenantId, ConversationId) -> Conversations (TenantId, Id)
    /// Messages   (TenantId, ConversationId, SenderUserId) -> ConversationParticipants (TenantId, ConversationId, UserId)
    /// MessageRevisions              (TenantId, MessageId) -> Messages (TenantId, Id)
    /// MessageDeletionEvents         (TenantId, MessageId) -> Messages (TenantId, Id)
    /// CommandRecords           (TenantId, ConversationId) -> Conversations (TenantId, Id)
    /// </code>
    /// The sender key is the load-bearing one: a message whose sender is not an explicit participant
    /// of that exact conversation cannot be inserted at all.
    /// </remarks>
    private void ConfigureMessaging(ModelBuilder builder)
    {
        builder.Entity<Conversation>(entity =>
        {
            entity.ToTable("Conversations", "messaging");
            entity.HasKey(conversation => conversation.Id);
            entity.HasAlternateKey(conversation => new { conversation.TenantId, conversation.Id });
            // At most one direct conversation per workspace, client and coach. A second coach may
            // open their own with the same client; the same coach cannot open a second with them.
            entity.HasIndex(conversation => new
            {
                conversation.TenantId,
                conversation.ClientProfileId,
                conversation.CoachUserId,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneDirectConversationPerCoachAndClient);
            // The conversation-list keyset: newest activity first, identifier as tie-breaker.
            entity.HasIndex(conversation => new
            {
                conversation.TenantId,
                conversation.LastActivityAtUtc,
                conversation.Id,
            })
                .HasDatabaseName("IX_Conversations_TenantId_LastActivityAtUtc_Id");
            entity.HasIndex(conversation => new { conversation.TenantId, conversation.ClientProfileId });
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(conversation => conversation.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(conversation => new { conversation.TenantId, conversation.ClientProfileId })
                .HasPrincipalKey(profile => new { profile.TenantId, profile.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(conversation => conversation.CoachUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(conversation => conversation.ClientUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(conversation =>
                tenantContext.HasTenant && conversation.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_Conversations_DistinctParticipants",
                    "\"CoachUserId\" <> \"ClientUserId\"");
                table.HasCheckConstraint(
                    "CK_Conversations_LastSequence",
                    "\"LastSequence\" >= 0");
                // The allocator and the activity pointer move together, so a conversation cannot
                // claim messages it has no newest message for, or the reverse.
                table.HasCheckConstraint(
                    "CK_Conversations_LastMessage",
                    "(\"LastMessageId\" IS NULL) = (\"LastSequence\" = 0)");
                table.HasCheckConstraint(
                    "CK_Conversations_Activity",
                    "\"LastActivityAtUtc\" >= \"StartedAtUtc\"");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<ConversationParticipant>(entity =>
        {
            entity.ToTable("ConversationParticipants", "messaging");
            entity.HasKey(participant => participant.Id);
            // One participant row per workspace, conversation and person, and the key a message's
            // sender foreign key points at.
            entity.HasAlternateKey(participant => new
            {
                participant.TenantId,
                participant.ConversationId,
                participant.UserId,
            });
            // Exactly one Coach-side and one Client-side identity. A third participant is refused by
            // this index because there is no third role, and the deferred constraint trigger added by
            // the migration asserts that both sides exist and match the conversation.
            entity.HasIndex(participant => new
            {
                participant.TenantId,
                participant.ConversationId,
                participant.Role,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneParticipantPerConversationSide);
            // The caller's own conversation list and unread count ride this.
            entity.HasIndex(participant => new { participant.TenantId, participant.UserId, participant.ConversationId })
                .HasDatabaseName("IX_ConversationParticipants_TenantId_UserId_ConversationId");
            entity.Property(participant => participant.Role).HasConversion<string>().HasMaxLength(16);
            entity.HasOne<Conversation>()
                .WithMany()
                .HasForeignKey(participant => new { participant.TenantId, participant.ConversationId })
                .HasPrincipalKey(conversation => new { conversation.TenantId, conversation.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(participant => participant.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(participant =>
                tenantContext.HasTenant && participant.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ConversationParticipants_ReadCursor",
                    "\"LastReadSequence\" >= 0");
                table.HasCheckConstraint(
                    "CK_ConversationParticipants_ReadInstant",
                    "(\"LastReadAtUtc\" IS NULL) = (\"LastReadSequence\" = 0)");
                // The unique (TenantId, ConversationId, Role) index only prevents a duplicate of a
                // role that already exists. An unconstrained text column would let a third
                // participant sit beside the Coach and the Client under any other spelling, which is
                // a participant this domain has no concept of.
                table.HasCheckConstraint(
                    "CK_ConversationParticipants_Role",
                    "\"Role\" IN ('Coach', 'Client')");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<Message>(entity =>
        {
            entity.ToTable("Messages", "messaging");
            entity.HasKey(message => message.Id);
            entity.HasAlternateKey(message => new { message.TenantId, message.Id });
            // Two more keys that exist only so children can carry the discriminating columns in
            // their own foreign keys: a revision's author must be this message's sender, and a
            // deletion event or command record naming this message must name its conversation too.
            entity.HasAlternateKey(message => new { message.TenantId, message.Id, message.SenderUserId });
            entity.HasAlternateKey(message => new { message.TenantId, message.Id, message.ConversationId });
            // The ordering invariant. Two senders racing for the same number cannot both commit.
            entity.HasIndex(message => new { message.TenantId, message.ConversationId, message.Sequence })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneMessageSequencePerConversation);
            entity.Property(message => message.DeletionKind).HasConversion<string>().HasMaxLength(24);
            entity.Property(message => message.ModerationReason)
                .HasMaxLength(MessageContentPolicy.MaximumModerationReasonLength);
            entity.HasOne<Conversation>()
                .WithMany()
                .HasForeignKey(message => new { message.TenantId, message.ConversationId })
                .HasPrincipalKey(conversation => new { conversation.TenantId, conversation.Id })
                .OnDelete(DeleteBehavior.Restrict);
            // A sender who is not an explicit participant of this conversation, in this workspace,
            // cannot be inserted. Explicit participation is therefore a database fact rather than an
            // application convention.
            entity.HasOne<ConversationParticipant>()
                .WithMany()
                .HasForeignKey(message => new
                {
                    message.TenantId,
                    message.ConversationId,
                    message.SenderUserId,
                })
                .HasPrincipalKey(participant => new
                {
                    participant.TenantId,
                    participant.ConversationId,
                    participant.UserId,
                })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(message =>
                tenantContext.HasTenant && message.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_Messages_Sequence", "\"Sequence\" >= 1");
                table.HasCheckConstraint("CK_Messages_RevisionNumber", "\"CurrentRevisionNumber\" >= 1");
                // Revision 1 is what was originally sent, so an edit instant exists exactly when a
                // later revision does.
                table.HasCheckConstraint(
                    "CK_Messages_Edited",
                    "(\"EditedAtUtc\" IS NULL) = (\"CurrentRevisionNumber\" = 1)");
                // Removal is one fact with three columns, and a half-removed row is not a state this
                // domain has.
                table.HasCheckConstraint(
                    "CK_Messages_Deleted",
                    "(\"DeletedAtUtc\" IS NULL) = (\"DeletionKind\" IS NULL) AND (\"DeletedAtUtc\" IS NULL) = (\"DeletedByUserId\" IS NULL)");
                // A reason belongs to a moderation and only to a moderation, and a moderation always
                // has one.
                table.HasCheckConstraint(
                    "CK_Messages_ModerationReason",
                    "(\"ModerationReason\" IS NOT NULL) = (\"DeletionKind\" = 'CoachModerated')");
                // A removal kind nobody can interpret is worse than no removal at all: a reader
                // would see a body withheld and no way to say why.
                table.HasCheckConstraint(
                    "CK_Messages_DeletionKindValue",
                    "\"DeletionKind\" IS NULL OR \"DeletionKind\" IN ('SenderRemoved', 'CoachModerated')");
                // Delivery metadata is ordered and never precedes persistence. Both acknowledgement
                // columns are null throughout Phase 6B-2A and are reserved for later channels.
                table.HasCheckConstraint(
                    "CK_Messages_Available",
                    "\"AvailableAtUtc\" >= \"SentAtUtc\"");
                table.HasCheckConstraint(
                    "CK_Messages_Acknowledgements",
                    "(\"RealtimeAcknowledgedAtUtc\" IS NULL OR \"RealtimeAcknowledgedAtUtc\" >= \"AvailableAtUtc\") AND (\"ProviderAcknowledgedAtUtc\" IS NULL OR \"ProviderAcknowledgedAtUtc\" >= \"AvailableAtUtc\")");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<MessageRevision>(entity =>
        {
            entity.ToTable("MessageRevisions", "messaging");
            entity.HasKey(revision => revision.Id);
            // What makes "the current revision" unambiguous, and what makes pointing at another
            // workspace's or another message's revision inexpressible: the message row names only a
            // number, and the number is resolved through this key.
            entity.HasIndex(revision => new
            {
                revision.TenantId,
                revision.MessageId,
                revision.RevisionNumber,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneMessageRevisionPerNumber);
            entity.Property(revision => revision.Body)
                .HasMaxLength(MessageContentPolicy.MaximumLength)
                .IsRequired();
            // The author carried into the key rather than checked in code: only the sender may edit,
            // so only the sender can have authored any revision of the message. A rewrite under
            // somebody else's name is refused by referential integrity.
            entity.HasOne<Message>()
                .WithMany()
                .HasForeignKey(revision => new
                {
                    revision.TenantId,
                    revision.MessageId,
                    revision.AuthoredByUserId,
                })
                .HasPrincipalKey(message => new
                {
                    message.TenantId,
                    message.Id,
                    message.SenderUserId,
                })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(revision =>
                tenantContext.HasTenant && revision.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_MessageRevisions_RevisionNumber",
                "\"RevisionNumber\" >= 1"));
            ConfigureAuditable(entity);
        });

        builder.Entity<MessageDeletionEvent>(entity =>
        {
            entity.ToTable("MessageDeletionEvents", "messaging");
            entity.HasKey(item => item.Id);
            // Removal is one-way, so there is one event per message and never a second.
            entity.HasIndex(item => new { item.TenantId, item.MessageId })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneMessageDeletionEvent);
            entity.Property(item => item.Kind).HasConversion<string>().HasMaxLength(24);
            entity.Property(item => item.Reason)
                .HasMaxLength(MessageContentPolicy.MaximumModerationReasonLength);
            // The conversation is part of the key, so an event cannot name one conversation while
            // its message lives in another.
            entity.HasOne<Message>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MessageId, item.ConversationId })
                .HasPrincipalKey(message => new { message.TenantId, message.Id, message.ConversationId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MessageDeletionEvents_Revision",
                    "\"RevisionNumberAtRemoval\" >= 1");
                table.HasCheckConstraint(
                    "CK_MessageDeletionEvents_Reason",
                    "(\"Reason\" IS NOT NULL) = (\"Kind\" = 'CoachModerated')");
                table.HasCheckConstraint(
                    "CK_MessageDeletionEvents_KindValue",
                    "\"Kind\" IN ('SenderRemoved', 'CoachModerated')");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<MessagingCommandRecord>(entity =>
        {
            entity.ToTable("CommandRecords", "messaging");
            entity.HasKey(record => record.Id);
            // One spent key per workspace, whatever it was spent on. A key used for a send cannot
            // later be honoured as an edit, because there is one index rather than one per command.
            entity.HasIndex(record => new { record.TenantId, record.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneMessagingCommandPerKey);
            entity.HasIndex(record => new { record.TenantId, record.ConversationId, record.RecordedAtUtc });
            entity.Property(record => record.CommandType).HasConversion<string>().HasMaxLength(32);
            entity.Property(record => record.PayloadFingerprint)
                .HasMaxLength(64)
                .IsFixedLength()
                .IsRequired();
            entity.HasOne<Conversation>()
                .WithMany()
                .HasForeignKey(record => new { record.TenantId, record.ConversationId })
                .HasPrincipalKey(conversation => new { conversation.TenantId, conversation.Id })
                .OnDelete(DeleteBehavior.Restrict);
            // A command that names a message names its conversation too. MessageId is null for a
            // create, and PostgreSQL's MATCH SIMPLE leaves such a row unconstrained by this key,
            // which is exactly the intent.
            entity.HasOne<Message>()
                .WithMany()
                .HasForeignKey(record => new { record.TenantId, record.MessageId, record.ConversationId })
                .HasPrincipalKey(message => new { message.TenantId, message.Id, message.ConversationId })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(record =>
                tenantContext.HasTenant && record.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_MessagingCommandRecords_Fingerprint",
                    "\"PayloadFingerprint\" ~ '^[0-9a-f]{64}$'");
                // Creating a conversation produces no message; every other command names one.
                table.HasCheckConstraint(
                    "CK_MessagingCommandRecords_Message",
                    "(\"MessageId\" IS NULL) = (\"CommandType\" = 'CreateConversation')");
                table.HasCheckConstraint(
                    "CK_MessagingCommandRecords_CommandTypeValue",
                    "\"CommandType\" IN ('CreateConversation', 'SendMessage', 'EditMessage', "
                    + "'DeleteMessage', 'ModerateMessage')");
            });
            ConfigureAuditable(entity);
        });
    }
}
