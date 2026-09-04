using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The one way a message becomes something a participant is allowed to see.
/// </summary>
/// <remarks>
/// Shared by the REST reads, the realtime dispatcher and the catch-up endpoint deliberately. Three
/// projections of the same row would be three chances for one of them to forget that a removed
/// message loses its body, that a moderation reason is never returned to anybody, or that an old
/// revision is audit history rather than content. There is one, and every path goes through it.
/// <para>
/// It is caller-specific: what may be edited, removed or moderated, and what is still unread, are
/// properties of who is asking. A realtime frame is therefore built once per recipient, after that
/// recipient's own authorization has been re-established, and never broadcast as one shared payload.
/// </para>
/// </remarks>
internal static class MessagingMessageProjection
{
    /// <summary>
    /// The current body of each message that still has one.
    /// </summary>
    /// <remarks>
    /// A removed message is not asked about at all, so its retained revisions cannot escape through
    /// this path. The join is on <c>(TenantId, MessageId, CurrentRevisionNumber)</c>, so it can only
    /// ever return the current revision — reaching an earlier one is not expressible here.
    /// </remarks>
    public static async Task<Dictionary<Guid, string>> CurrentBodiesAsync(
        GymDbContext dbContext,
        IReadOnlyList<Message> messages,
        CancellationToken cancellationToken)
    {
        var ids = messages
            .Where(message => !message.IsDeleted)
            .Select(message => message.Id)
            .ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        return await (
            from revision in dbContext.MessageRevisions.AsNoTracking()
            join message in dbContext.Messages.AsNoTracking()
                on new { revision.TenantId, revision.MessageId, revision.RevisionNumber }
                equals new
                {
                    message.TenantId,
                    MessageId = message.Id,
                    RevisionNumber = message.CurrentRevisionNumber,
                }
            where ids.Contains(message.Id)
            select new { message.Id, revision.Body })
            .ToDictionaryAsync(item => item.Id, item => item.Body, cancellationToken);
    }

    public static MessageView ToView(
        Message message,
        ConversationParticipant participant,
        IReadOnlyDictionary<Guid, string> bodies)
    {
        var isFromCaller = message.SenderUserId == participant.UserId;
        return new MessageView(
            message.Id,
            message.ConversationId,
            message.Sequence,
            message.SenderUserId,
            isFromCaller,
            message.SentAtUtc,
            message.AvailableAtUtc,
            message.EditedAtUtc,
            message.CurrentRevisionNumber,
            // A removed message keeps its place and its metadata and loses its body. The moderation
            // reason is never projected at all, by anybody, so no participant-facing response and no
            // realtime frame can carry it.
            message.IsDeleted ? null : bodies.GetValueOrDefault(message.Id),
            message.IsDeleted,
            message.DeletionKind,
            message.DeletedAtUtc,
            // Persisted, or acknowledged by the other participant's application. Never "delivered"
            // and never "read": one is a claim about a network nobody can make from here, and the
            // other belongs to the participant row and to nothing else.
            message.DeliveryState,
            CanEdit: isFromCaller && !message.IsDeleted,
            CanDelete: isFromCaller && !message.IsDeleted,
            CanModerate: participant.CanModerate && !isFromCaller && !message.IsDeleted,
            // The same rule the unread count aggregates, applied to one message, so the thread can
            // mark where the reader left off without a second definition of "unread".
            IsUnreadByCaller: participant.CountsAsUnread(message),
            message.Version);
    }

    /// <summary>
    /// The caller-safe projection of one message, loaded now.
    /// </summary>
    /// <returns>
    /// Null when the message is gone or belongs elsewhere. Messages are never hard-deleted, so this
    /// is an inconsistency rather than an ordinary outcome, and the caller records it as one.
    /// </returns>
    public static async Task<MessageView?> ProjectAsync(
        GymDbContext dbContext,
        Guid messageId,
        ConversationParticipant participant,
        CancellationToken cancellationToken)
    {
        var message = await dbContext.Messages
            .AsNoTracking()
            .SingleOrDefaultAsync(
                candidate =>
                    candidate.Id == messageId &&
                    candidate.ConversationId == participant.ConversationId,
                cancellationToken);
        if (message is null)
        {
            return null;
        }

        var bodies = await CurrentBodiesAsync(dbContext, [message], cancellationToken);
        return ToView(message, participant, bodies);
    }

    /// <summary>The caller-safe projections of several messages in one round trip.</summary>
    public static async Task<Dictionary<Guid, MessageView>> ProjectManyAsync(
        GymDbContext dbContext,
        IReadOnlyList<Guid> messageIds,
        ConversationParticipant participant,
        CancellationToken cancellationToken)
    {
        if (messageIds.Count == 0)
        {
            return [];
        }

        var distinct = messageIds.Distinct().ToArray();
        var messages = await dbContext.Messages
            .AsNoTracking()
            .Where(message =>
                distinct.Contains(message.Id) &&
                message.ConversationId == participant.ConversationId)
            .ToListAsync(cancellationToken);
        var bodies = await CurrentBodiesAsync(dbContext, messages, cancellationToken);
        return messages.ToDictionary(
            message => message.Id,
            message => ToView(message, participant, bodies));
    }
}
