using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Persisted direct messaging: conversations, participants, message history, read state, editing and
/// one-way removal.
/// </summary>
/// <remarks>
/// Two requirements are checked separately and both must hold for every operation: the caller must
/// have an explicit <see cref="ConversationParticipant"/> row, and the conversation's client profile
/// must currently pass <see cref="CoachingFeature.Messaging"/> through
/// <see cref="ICoachingFeatureAccessService"/>. Workspace membership alone grants neither, which is
/// why another Owner or Coach of the same workspace is refused exactly as a stranger is.
/// <para>
/// <b>Resolve before validate.</b> Every conversation operation establishes participation and feature
/// access before it looks at the payload. A handler that rejected a malformed cursor, a blank
/// moderation reason or a negative read sequence first would answer a stranger differently from a
/// participant and thereby confirm that an identifier exists.
/// </para>
/// <para>
/// <b>One lock order, everywhere.</b> A command takes the workspace-wide idempotency-key lock first
/// and an aggregate lock — the direct-conversation pair, the conversation row, the participant row —
/// second. Because the order never varies, two commands can queue but never deadlock, and the key
/// lock is what makes <c>(TenantId, IdempotencyKey)</c> a genuinely serialized namespace rather than
/// one that only happens to be safe when two callers touch the same aggregate.
/// </para>
/// <para>
/// A conversation nobody may reach is still stored. An expired, unpaid, paused, cancelled or blocked
/// relationship exposes no message content and accepts no writes; restoring access restores the
/// thread, because nothing was deleted to produce the refusal.
/// </para>
/// <para>
/// Message bodies, revision bodies, moderation reasons, names and email addresses never reach a log,
/// an exception message or a diagnostic. Nothing in this class writes one.
/// </para>
/// </remarks>
internal sealed class MessagingApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService)
    : IMessagingApplicationService
{
    /// <summary>
    /// Messaging decisions for the client profiles seen in this request. The decision is per client
    /// profile, not per conversation, so a coach listing several conversations with the same client
    /// evaluates it once. The cache lives exactly as long as the scoped service.
    /// </summary>
    private readonly Dictionary<Guid, FeatureAccessDecision> accessCache = [];

    public async Task<ConversationPage> ListConversationsAsync(
        DateTimeOffset? beforeActivityAtUtc,
        Guid? beforeConversationId,
        int take,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new ConversationPage([], false, null, null);
        }

        var normalizedTake = MessagingPaging.NormalizeConversationTake(take);
        var ordered = await ConversationKeysetAsync(
            userId,
            beforeActivityAtUtc,
            beforeConversationId,
            normalizedTake + 1,
            cancellationToken);
        var hasMore = ordered.Count > normalizedTake;
        if (hasMore)
        {
            ordered = ordered.Take(normalizedTake).ToList();
        }

        if (ordered.Count == 0)
        {
            return new ConversationPage([], false, null, null);
        }

        var summaries = await SummarizeAsync(ordered, userId, cancellationToken);
        var last = summaries[^1];
        return new ConversationPage(
            summaries,
            hasMore,
            hasMore ? last.LastActivityAtUtc : null,
            hasMore ? last.Id : null);
    }

    public async Task<ConversationCommandResult> CreateDirectConversationAsync(
        CreateDirectConversationRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } coachUserId || !tenantContext.HasTenant)
        {
            return ConversationCommandResult.NotFound();
        }

        // An active Owner or Coach of this workspace. The route policy already verified the role;
        // this re-establishes it from the authoritative row rather than trusting the claim alone.
        var isActiveStaff = await dbContext.TenantMemberships
            .AsNoTracking()
            .AnyAsync(
                membership =>
                    membership.TenantId == tenantContext.TenantId &&
                    membership.UserId == coachUserId &&
                    membership.Status == MembershipStatus.Active &&
                    (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach),
                cancellationToken);
        if (!isActiveStaff)
        {
            return ConversationCommandResult.NotFound();
        }

        // A client profile of another workspace is filtered out entirely, so it is the same answer as
        // one that does not exist. An unlinked profile — invited but never accepted — has nobody to
        // talk to and is refused the same way.
        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(profile => profile.Id == request.ClientProfileId)
            .Select(profile => new { profile.Id, profile.UserId })
            .SingleOrDefaultAsync(cancellationToken);
        if (client?.UserId is not { } clientUserId)
        {
            return ConversationCommandResult.NotFound();
        }

        // Membership, platform block, relationship block, entitlement, dates, lifecycle and payment,
        // all in one decision. A blocked or unpaid relationship cannot be given a new conversation.
        var decision = await EvaluateAsync(request.ClientProfileId, cancellationToken);
        if (!decision.IsAllowed)
        {
            return ConversationCommandResult.Forbidden(decision.Reason);
        }

        if (clientUserId == coachUserId)
        {
            return ConversationCommandResult.Invalid(
                "clientProfileId",
                "A direct conversation needs two different people.");
        }

        var fingerprint = MessagingCommandFingerprint.ForCreateConversation(
            tenantContext.TenantId,
            coachUserId,
            request.ClientProfileId);

        return await RunIdempotentAsync(
            request.IdempotencyKey,
            MessagingCommandType.CreateConversation,
            fingerprint,
            invalidKey: () => ConversationCommandResult.Invalid(
                "idempotencyKey",
                "An idempotency key is required."),
            conflict: ConversationKeyReused,
            replayAsync: record => ConversationSuccessAsync(record.ConversationId, coachUserId, cancellationToken),
            executeAsync: async token =>
            {
                // Second lock, after the key. Serializes the coach/client pair across replicas so two
                // concurrent creates carrying different keys produce one conversation deterministically;
                // the unique index remains the actual guarantee behind it.
                await LockDirectPairAsync(request.ClientProfileId, coachUserId, token);

                var existing = await dbContext.Conversations
                    .AsNoTracking()
                    .Where(conversation =>
                        conversation.ClientProfileId == request.ClientProfileId &&
                        conversation.CoachUserId == coachUserId)
                    .Select(conversation => (Guid?)conversation.Id)
                    .SingleOrDefaultAsync(token);

                var now = clock.UtcNow;
                Guid targetId;
                Conversation? created = null;
                if (existing is { } found)
                {
                    targetId = found;
                }
                else
                {
                    var conversation = Conversation.StartDirect(
                        tenantContext.TenantId,
                        request.ClientProfileId,
                        coachUserId,
                        clientUserId,
                        now);
                    dbContext.Conversations.Add(conversation);
                    dbContext.ConversationParticipants.AddRange(conversation.CreateDirectParticipants());
                    targetId = conversation.Id;
                    created = conversation;
                }

                var record = MessagingCommandRecord.Record(
                    tenantContext.TenantId,
                    request.IdempotencyKey,
                    MessagingCommandType.CreateConversation,
                    fingerprint,
                    coachUserId,
                    targetId,
                    messageId: null,
                    now);
                dbContext.MessagingCommandRecords.Add(record);
                // Only a conversation that was actually created is an event. A fresh key presented
                // against a conversation that already exists returns it and changes nothing
                // externally visible, so publishing "a conversation was created" would be a lie the
                // other side would have to reconcile against a thread it already had.
                if (created is not null)
                {
                    EmitRealtimeEvent(
                        created,
                        MessagingRealtimeEventKind.ConversationCreated,
                        message: null,
                        record,
                        now);
                }

                return new CommandOutcome<ConversationCommandResult>(null, targetId);
            },
            successAsync: id => ConversationSuccessAsync(id, coachUserId, cancellationToken),
            staleConflict: ConversationKeyReused,
            cancellationToken);
    }

    public async Task<MessagePageResult> ListMessagesAsync(
        Guid conversationId,
        long? beforeSequence,
        int take,
        CancellationToken cancellationToken)
    {
        // Resolve first: a malformed cursor must not distinguish an unknown conversation from a real
        // one the caller is simply not in.
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? MessagePageResult.Forbidden(access.Reason!.Value)
                : MessagePageResult.NotFound();
        }

        if (beforeSequence is <= 0)
        {
            return MessagePageResult.Invalid("beforeSequence", "A history cursor must be a positive sequence.");
        }

        var conversation = access.Conversation!;
        var participant = access.Participant!;
        var normalizedTake = MessagingPaging.NormalizeMessageTake(take);

        var query = dbContext.Messages
            .AsNoTracking()
            .Where(message => message.ConversationId == conversationId);
        if (beforeSequence is { } before)
        {
            query = query.Where(message => message.Sequence < before);
        }

        // Retrieved newest first because that is the direction the index serves and the direction a
        // reader pages in; returned oldest first because that is the direction a thread is read in.
        var rows = await query
            .OrderByDescending(message => message.Sequence)
            .Take(normalizedTake + 1)
            .ToListAsync(cancellationToken);
        var hasOlder = rows.Count > normalizedTake;
        if (hasOlder)
        {
            rows = rows.Take(normalizedTake).ToList();
        }

        rows.Reverse();

        var bodies = await CurrentBodiesAsync(rows, cancellationToken);
        var views = rows
            .Select(message => ToView(message, participant, bodies))
            .ToArray();

        return MessagePageResult.Success(new MessagePage(
            conversationId,
            views,
            hasOlder,
            views.Length == 0 ? null : views[0].Sequence,
            conversation.LastSequence,
            // The realtime watermark this read establishes. The browser subscribes to the
            // conversation and then catches up from here, so an event committed between this read
            // and that subscription is returned rather than lost.
            conversation.LastEventSequence,
            await ReadStateAsync(conversation, participant, cancellationToken)));
    }

    public async Task<MessageCommandResult> SendAsync(
        Guid conversationId,
        SendMessageRequest request,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? MessageCommandResult.Forbidden(access.Reason!.Value)
                : MessageCommandResult.NotFound();
        }

        if (!MessageContentPolicy.TryNormalize(request.Body, out var body, out var failure))
        {
            return MessageCommandResult.Invalid("body", BodyFailureMessage(failure));
        }

        var participant = access.Participant!;
        var senderUserId = participant.UserId;
        var fingerprint = MessagingCommandFingerprint.ForSend(
            tenantContext.TenantId,
            conversationId,
            senderUserId,
            body);

        return await RunMessageCommandAsync(
            request.IdempotencyKey,
            MessagingCommandType.SendMessage,
            fingerprint,
            participant,
            async token =>
            {
                // The sequence allocator, taken after the key lock. Reading MAX(sequence) without a
                // lock lets two senders compute the same number, and the loser then fails on the
                // unique index instead of being ordered behind the winner. Locking the conversation
                // row makes the allocation a queue: every committed sequence is unique, gap-free and
                // in commit order, and a rolled-back send returns its number rather than a hole.
                await LockConversationAsync(conversationId, token);

                var conversation = await dbContext.Conversations
                    .SingleAsync(item => item.Id == conversationId, token);
                var now = clock.UtcNow;
                var sequence = conversation.AllocateNextSequence();
                var message = Message.Send(
                    tenantContext.TenantId,
                    conversationId,
                    senderUserId,
                    sequence,
                    body,
                    now,
                    out var initialRevision);
                conversation.RecordMessage(message.Id, now);

                dbContext.Messages.Add(message);
                dbContext.MessageRevisions.Add(initialRevision);
                var record = MessagingCommandRecord.Record(
                    tenantContext.TenantId,
                    request.IdempotencyKey,
                    MessagingCommandType.SendMessage,
                    fingerprint,
                    senderUserId,
                    conversationId,
                    message.Id,
                    now);
                dbContext.MessagingCommandRecords.Add(record);
                // The realtime event commits with the message, the revision, the sequence, the
                // activity update and the spent key, or none of them commits. A publication intent
                // written after the command's transaction is a message that exists and an event that
                // does not, which is exactly the gap a reconnecting client cannot detect.
                EmitRealtimeEvent(
                    conversation,
                    MessagingRealtimeEventKind.MessageSent,
                    message,
                    record,
                    now);
                return new CommandOutcome<MessageCommandResult>(null, message.Id);
            },
            cancellationToken);
    }

    public async Task<MessageCommandResult> EditAsync(
        Guid conversationId,
        Guid messageId,
        EditMessageRequest request,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? MessageCommandResult.Forbidden(access.Reason!.Value)
                : MessageCommandResult.NotFound();
        }

        if (!MessageContentPolicy.TryNormalize(request.Body, out var body, out var failure))
        {
            return MessageCommandResult.Invalid("body", BodyFailureMessage(failure));
        }

        var participant = access.Participant!;
        var fingerprint = MessagingCommandFingerprint.ForEdit(
            tenantContext.TenantId,
            conversationId,
            messageId,
            participant.UserId,
            body);

        return await RunMessageCommandAsync(
            request.IdempotencyKey,
            MessagingCommandType.EditMessage,
            fingerprint,
            participant,
            async token =>
            {
                // The conversation row lock, taken before the message is touched. An edit allocates
                // an event position from the same counter a send does, so it queues behind concurrent
                // sends in exactly the same way; taking it in the same order everywhere is what keeps
                // two commands able to wait for each other without being able to deadlock.
                await LockConversationAsync(conversationId, token);
                var conversation = await dbContext.Conversations
                    .SingleAsync(item => item.Id == conversationId, token);

                var message = await dbContext.Messages
                    .SingleOrDefaultAsync(
                        item => item.Id == messageId && item.ConversationId == conversationId,
                        token);
                if (message is null)
                {
                    return Refuse(MessageCommandResult.NotFound());
                }

                // Somebody else's message is not editable, and its existence is not confirmed as
                // editable: a participant who may read a message still may not learn that.
                if (message.SenderUserId != participant.UserId)
                {
                    return Refuse(MessageCommandResult.Invalid(
                        "messageId",
                        "Only the sender of a message may edit it."));
                }

                if (message.IsDeleted)
                {
                    return Refuse(MessageCommandResult.Conflict(
                        MessagingConflictCodes.MessageAlreadyRemoved,
                        "A removed message cannot be edited."));
                }

                if (message.Version != request.ExpectedVersion)
                {
                    return Refuse(StaleVersion());
                }

                dbContext.Entry(message).Property(item => item.Version).OriginalValue = request.ExpectedVersion;
                var now = clock.UtcNow;
                dbContext.MessageRevisions.Add(message.Edit(participant.UserId, body, now));
                var record = MessagingCommandRecord.Record(
                    tenantContext.TenantId,
                    request.IdempotencyKey,
                    MessagingCommandType.EditMessage,
                    fingerprint,
                    participant.UserId,
                    conversationId,
                    messageId,
                    now);
                dbContext.MessagingCommandRecords.Add(record);
                // A new event position for an old message position. This is the whole reason the two
                // counters are separate: newer messages have been sent since, so a client resuming
                // from the message sequence would never ask for this and would keep showing the
                // sentence that was replaced.
                EmitRealtimeEvent(
                    conversation,
                    MessagingRealtimeEventKind.MessageEdited,
                    message,
                    record,
                    now);
                return new CommandOutcome<MessageCommandResult>(null, messageId);
            },
            cancellationToken);
    }

    public Task<MessageCommandResult> DeleteAsync(
        Guid conversationId,
        Guid messageId,
        DeleteMessageRequest request,
        CancellationToken cancellationToken) =>
        RemoveAsync(
            conversationId,
            messageId,
            request.ExpectedVersion,
            request.IdempotencyKey,
            MessagingCommandType.DeleteMessage,
            rawReason: null,
            cancellationToken);

    public Task<MessageCommandResult> ModerateAsync(
        Guid conversationId,
        Guid messageId,
        ModerateMessageRequest request,
        CancellationToken cancellationToken) =>
        // The reason is normalized inside RemoveAsync, after participation and feature access have
        // been resolved. Validating it here would answer a stranger differently from a participant.
        RemoveAsync(
            conversationId,
            messageId,
            request.ExpectedVersion,
            request.IdempotencyKey,
            MessagingCommandType.ModerateMessage,
            request.Reason,
            cancellationToken);

    public async Task<ReadStateCommandResult> AdvanceReadCursorAsync(
        Guid conversationId,
        AdvanceReadCursorRequest request,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? ReadStateCommandResult.Forbidden(access.Reason!.Value)
                : ReadStateCommandResult.NotFound();
        }

        if (request.ThroughSequence < 0)
        {
            return ReadStateCommandResult.Invalid("throughSequence", "A read cursor cannot be negative.");
        }

        var userId = access.Participant!.UserId;
        await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

            // The cursor is read, compared and written under this row's lock, so two concurrent
            // advances resolve to the greater sequence rather than to whichever wrote last. A trigger
            // refuses a decrease whatever produced it.
            await LockReadCursorAsync(conversationId, userId, cancellationToken);

            var participant = await dbContext.ConversationParticipants
                .SingleAsync(
                    item => item.ConversationId == conversationId && item.UserId == userId,
                    cancellationToken);
            var latest = await dbContext.Conversations
                .AsNoTracking()
                .Where(item => item.Id == conversationId)
                .Select(item => item.LastSequence)
                .SingleAsync(cancellationToken);

            if (participant.AdvanceReadCursor(request.ThroughSequence, latest, clock.UtcNow))
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        });

        dbContext.ChangeTracker.Clear();
        var refreshed = await dbContext.ConversationParticipants
            .AsNoTracking()
            .SingleAsync(item => item.ConversationId == conversationId && item.UserId == userId, cancellationToken);
        var conversation = await dbContext.Conversations
            .AsNoTracking()
            .SingleAsync(item => item.Id == conversationId, cancellationToken);
        return ReadStateCommandResult.Success(
            await ReadStateAsync(conversation, refreshed, cancellationToken));
    }

    public async Task<MessagingUnreadCount> CountUnreadAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new MessagingUnreadCount(0);
        }

        // Only conversations the caller is an explicit participant of, and only those currently
        // available. An inaccessible conversation contributes nothing at all, so the badge never
        // reveals that one exists.
        var memberships = await (
            from participant in dbContext.ConversationParticipants.AsNoTracking()
            join conversation in dbContext.Conversations.AsNoTracking()
                on new { participant.TenantId, Id = participant.ConversationId }
                equals new { conversation.TenantId, conversation.Id }
            where participant.UserId == userId
            select new
            {
                conversation.Id,
                conversation.ClientProfileId,
                participant.LastReadSequence,
            })
            .ToListAsync(cancellationToken);
        if (memberships.Count == 0)
        {
            return new MessagingUnreadCount(0);
        }

        var available = new List<Guid>(memberships.Count);
        foreach (var membership in memberships)
        {
            var decision = await EvaluateAsync(membership.ClientProfileId, cancellationToken);
            if (decision.IsAllowed)
            {
                available.Add(membership.Id);
            }
        }

        if (available.Count == 0)
        {
            return new MessagingUnreadCount(0);
        }

        var unread = await UnreadByConversationAsync([.. available], userId, cancellationToken);
        return new MessagingUnreadCount(unread.Values.Sum());
    }

    // ---------- realtime catch-up and acknowledgement ----------

    public async Task<RealtimeEventPageResult> ListRealtimeEventsAsync(
        Guid conversationId,
        long? afterEventSequence,
        int take,
        CancellationToken cancellationToken)
    {
        // Resolve before validate, exactly as every other conversation operation does. A malformed
        // cursor must not distinguish an unknown conversation from a real one the caller is not in.
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? RealtimeEventPageResult.Forbidden(access.Reason!.Value)
                : RealtimeEventPageResult.NotFound();
        }

        if (afterEventSequence is < 0)
        {
            return RealtimeEventPageResult.Invalid(
                "afterEventSequence",
                "A realtime cursor cannot be negative.");
        }

        var conversation = access.Conversation!;
        var participant = access.Participant!;
        var normalizedTake = MessagingRealtimePaging.NormalizeEventTake(take);
        var after = afterEventSequence ?? 0;

        // Only events this participant was actually addressed by, which for a direct conversation is
        // every one of them; the join is what keeps that a property of the data rather than of a
        // comment. Ascending, because a catch-up cursor advances forwards.
        var rows = await (
            from realtimeEvent in dbContext.MessagingRealtimeEvents.AsNoTracking()
            join recipient in dbContext.MessagingRealtimeRecipients.AsNoTracking()
                on new { realtimeEvent.TenantId, RealtimeEventId = realtimeEvent.Id }
                equals new { recipient.TenantId, recipient.RealtimeEventId }
            where realtimeEvent.ConversationId == conversationId &&
                  realtimeEvent.EventSequence > after &&
                  recipient.RecipientUserId == participant.UserId
            orderby realtimeEvent.EventSequence
            select realtimeEvent)
            .Take(normalizedTake + 1)
            .ToListAsync(cancellationToken);

        var hasMore = rows.Count > normalizedTake;
        if (hasMore)
        {
            rows = rows.Take(normalizedTake).ToList();
        }

        // The current safe projection, loaded now and only now. The event row holds identifiers; the
        // body it implies is fetched after this caller's current authorization has already succeeded,
        // so an event that outlived somebody's access can never be replayed into content.
        var projections = await MessagingMessageProjection.ProjectManyAsync(
            dbContext,
            [.. rows.Where(item => item.MessageId is not null).Select(item => item.MessageId!.Value)],
            participant,
            cancellationToken);

        var items = rows
            .Select(item => new RealtimeEventView(
                item.TenantId,
                item.ConversationId,
                item.Id,
                item.EventSequence,
                item.Kind,
                item.OccurredAtUtc,
                item.MessageId is { } messageId ? projections.GetValueOrDefault(messageId) : null))
            .ToArray();

        return RealtimeEventPageResult.Success(new RealtimeEventPage(
            conversationId,
            items,
            hasMore,
            items.Length == 0 ? null : items[^1].EventSequence,
            Math.Max(
                conversation.LastEventSequence,
                items.Length == 0 ? 0 : items[^1].EventSequence)));
    }

    public async Task<RealtimeAcknowledgementCommandResult> AcknowledgeRealtimeEventsAsync(
        Guid conversationId,
        AcknowledgeRealtimeEventsRequest request,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? RealtimeAcknowledgementCommandResult.Forbidden(access.Reason!.Value)
                : RealtimeAcknowledgementCommandResult.NotFound();
        }

        // Bounded and deterministic. Duplicates in one request collapse, a negative or zero position
        // names no event and is refused outright, and an oversized batch is a request error rather
        // than an unbounded amount of work somebody can ask for.
        var requested = request.EventSequences ?? [];
        if (requested.Count > MessagingRealtimePaging.MaximumAcknowledgementBatch)
        {
            return RealtimeAcknowledgementCommandResult.Invalid(
                "eventSequences",
                $"At most {MessagingRealtimePaging.MaximumAcknowledgementBatch} events can be acknowledged at once.");
        }

        if (requested.Any(sequence => sequence < 1))
        {
            return RealtimeAcknowledgementCommandResult.Invalid(
                "eventSequences",
                "A realtime event position is a positive number.");
        }

        var conversation = access.Conversation!;
        var participant = access.Participant!;
        var sequences = requested.Distinct().ToArray();
        if (sequences.Length == 0)
        {
            return RealtimeAcknowledgementCommandResult.Success(new RealtimeAcknowledgementResult(
                conversationId,
                0,
                0,
                conversation.LastEventSequence));
        }

        // Only events actually addressed to this participant, in this conversation. The join to the
        // recipient row is the same fact the acknowledgement's foreign key enforces; doing it here
        // as well means an unaddressed position is silently ignored rather than reaching the database
        // as a constraint violation.
        var addressed = await (
            from realtimeEvent in dbContext.MessagingRealtimeEvents.AsNoTracking()
            join recipient in dbContext.MessagingRealtimeRecipients.AsNoTracking()
                on new { realtimeEvent.TenantId, RealtimeEventId = realtimeEvent.Id }
                equals new { recipient.TenantId, recipient.RealtimeEventId }
            where realtimeEvent.ConversationId == conversationId &&
                  sequences.Contains(realtimeEvent.EventSequence) &&
                  recipient.RecipientUserId == participant.UserId
            select new { realtimeEvent.Id, realtimeEvent.MessageId })
            .ToListAsync(cancellationToken);
        if (addressed.Count == 0)
        {
            return RealtimeAcknowledgementCommandResult.Success(new RealtimeAcknowledgementResult(
                conversationId,
                0,
                0,
                conversation.LastEventSequence));
        }

        var eventIds = addressed.Select(item => item.Id).ToArray();

        var accepted = await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var insertedEventIds = new HashSet<Guid>();

            // The unique key is the concurrency primitive, but a conflict on one event must not roll
            // back unrelated events in the same bounded batch. PostgreSQL resolves each insert
            // independently: an overlapping tab contributes zero rows for that event while every
            // non-overlapping event still commits in this transaction.
            foreach (var item in addressed)
            {
                var acknowledgementId = Guid.CreateVersion7();
                var inserted = await dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    INSERT INTO messaging."RealtimeAcknowledgements"
                        ("Id", "TenantId", "ConversationId", "RealtimeEventId",
                         "AcknowledgedByUserId", "AcknowledgedAtUtc", "CreatedAtUtc",
                         "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId")
                    VALUES ({acknowledgementId}, {tenantContext.TenantId}, {conversationId}, {item.Id},
                            {participant.UserId}, {now}, {now}, {participant.UserId}, {now},
                            {participant.UserId})
                    ON CONFLICT ("TenantId", "RealtimeEventId", "AcknowledgedByUserId") DO NOTHING
                    """,
                    cancellationToken);
                if (inserted == 1)
                {
                    insertedEventIds.Add(item.Id);
                }
            }

            var messageIds = addressed
                .Where(item => insertedEventIds.Contains(item.Id) && item.MessageId is not null)
                .Select(item => item.MessageId!.Value)
                .Distinct()
                .ToArray();
            var messages = messageIds.Length == 0
                ? []
                : await dbContext.Messages
                    .Where(message => messageIds.Contains(message.Id))
                    .ToListAsync(cancellationToken);

            // The counterpart-delivery timestamp, and the one rule that keeps it honest: it is set
            // only from an acknowledgement by somebody who is not the sender. A second tab of the
            // sender's own browser acknowledging its own event is a real acknowledgement of that
            // event and evidence about nobody else, so the aggregate refuses to write it. It is also
            // written once and never moved, because at-least-once delivery makes repetition normal.
            foreach (var message in messages)
            {
                message.AcknowledgeRealtimeDelivery(participant.UserId, now);
            }

            await dbContext.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return insertedEventIds.Count;
        });

        dbContext.ChangeTracker.Clear();
        // Read back rather than counting what was attempted, so a concurrent duplicate reports the
        // same settled truth as the request that won.
        var settled = await dbContext.MessagingRealtimeAcknowledgements
            .AsNoTracking()
            .CountAsync(
                item => eventIds.Contains(item.RealtimeEventId) &&
                        item.AcknowledgedByUserId == participant.UserId,
                cancellationToken);
        return RealtimeAcknowledgementCommandResult.Success(new RealtimeAcknowledgementResult(
            conversationId,
            accepted,
            settled - accepted,
            conversation.LastEventSequence));
    }

    /// <summary>
    /// Writes the durable realtime event and one publication state per explicit participant, inside
    /// the command's own transaction.
    /// </summary>
    /// <remarks>
    /// The conversation must already be tracked and its row already locked by the caller, because the
    /// event position comes from the same allocator discipline the message sequence uses: read,
    /// increment and write under the row lock, so committed positions are unique, gap-free and in
    /// commit order and a rolled-back command gives its number back.
    /// <para>
    /// Nothing here reads or copies a body, a previous revision or a moderation reason. The event is
    /// identifiers, a position, a kind and an instant; what a participant is allowed to see is built
    /// later, from the live tables, after that participant's authorization has been re-established.
    /// </para>
    /// </remarks>
    private void EmitRealtimeEvent(
        Conversation conversation,
        MessagingRealtimeEventKind kind,
        Message? message,
        MessagingCommandRecord sourceCommand,
        DateTimeOffset now)
    {
        var realtimeEvent = MessagingRealtimeEvent.Record(
            tenantContext.TenantId,
            conversation.Id,
            conversation.AllocateNextEventSequence(),
            kind,
            message?.Id,
            message?.Sequence,
            message?.CurrentRevisionNumber,
            sourceCommand.Id,
            now);
        dbContext.MessagingRealtimeEvents.Add(realtimeEvent);
        // Both sides get a row, including whoever caused the event: their own other tabs still have
        // to be told, and giving the actor a row is what makes a sender acknowledgement expressible
        // without letting it be mistaken for the counterpart's.
        dbContext.MessagingRealtimeRecipients.AddRange(realtimeEvent.CreateRecipients(
            [conversation.CoachUserId, conversation.ClientUserId],
            now));
    }

    // ---------- shared removal path ----------

    /// <summary>
    /// Self-deletion and coach moderation are the same transaction with different authority and a
    /// different recorded kind, so they share one path rather than two that could drift apart on the
    /// parts that matter — one-way removal, idempotency, concurrency and the append-only event.
    /// </summary>
    private async Task<MessageCommandResult> RemoveAsync(
        Guid conversationId,
        Guid messageId,
        uint expectedVersion,
        Guid idempotencyKey,
        MessagingCommandType commandType,
        string? rawReason,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAsync(conversationId, cancellationToken);
        if (access.Status != MessagingCommandStatus.Success)
        {
            return access.Status == MessagingCommandStatus.Forbidden
                ? MessageCommandResult.Forbidden(access.Reason!.Value)
                : MessageCommandResult.NotFound();
        }

        var isModeration = commandType == MessagingCommandType.ModerateMessage;
        var reason = string.Empty;
        if (isModeration &&
            !MessageContentPolicy.TryNormalizeModerationReason(rawReason, out reason, out var reasonFailure))
        {
            return MessageCommandResult.Invalid("reason", ReasonFailureMessage(reasonFailure));
        }

        var participant = access.Participant!;
        var fingerprint = isModeration
            ? MessagingCommandFingerprint.ForModerate(
                tenantContext.TenantId,
                conversationId,
                messageId,
                participant.UserId,
                reason)
            : MessagingCommandFingerprint.ForDelete(
                tenantContext.TenantId,
                conversationId,
                messageId,
                participant.UserId);

        return await RunMessageCommandAsync(
            idempotencyKey,
            commandType,
            fingerprint,
            participant,
            async token =>
            {
                // Same lock order as every other command: the key, then the conversation row whose
                // event counter this removal may advance, then the message.
                await LockConversationAsync(conversationId, token);
                var conversation = await dbContext.Conversations
                    .SingleAsync(item => item.Id == conversationId, token);

                var message = await dbContext.Messages
                    .SingleOrDefaultAsync(
                        item => item.Id == messageId && item.ConversationId == conversationId,
                        token);
                if (message is null)
                {
                    return Refuse(MessageCommandResult.NotFound());
                }

                if (isModeration)
                {
                    // Moderation is the explicit coach participant's power over the other
                    // participant's message. A non-participant Owner or Coach never reaches here,
                    // because they have no participant row and the conversation is a 404 to them.
                    if (!participant.CanModerate)
                    {
                        return Refuse(MessageCommandResult.Invalid(
                            "messageId",
                            "Only the coach in this conversation may remove the other participant's message."));
                    }

                    if (message.SenderUserId == participant.UserId)
                    {
                        return Refuse(MessageCommandResult.Invalid(
                            "messageId",
                            "Moderation removes the other participant's message; use delete for your own."));
                    }
                }
                else if (message.SenderUserId != participant.UserId)
                {
                    return Refuse(MessageCommandResult.Invalid(
                        "messageId",
                        "Only the sender of a message may remove it."));
                }

                var now = clock.UtcNow;
                var removedNow = false;
                if (!message.IsDeleted)
                {
                    if (message.Version != expectedVersion)
                    {
                        return Refuse(StaleVersion());
                    }

                    dbContext.Entry(message).Property(item => item.Version).OriginalValue = expectedVersion;
                    var recorded = isModeration
                        ? message.ModerateRemove(participant.UserId, reason, now)
                        : message.DeleteBySender(participant.UserId, now);
                    if (recorded is not null)
                    {
                        dbContext.MessageDeletionEvents.Add(recorded);
                        removedNow = true;
                    }
                }

                // Removal is idempotent: a repeated request against an already-removed message
                // reports the current removed state instead of failing, because the caller's intent
                // has already been satisfied. The key is still spent, so a later retry replays.
                var record = MessagingCommandRecord.Record(
                    tenantContext.TenantId,
                    idempotencyKey,
                    commandType,
                    fingerprint,
                    participant.UserId,
                    conversationId,
                    messageId,
                    now);
                dbContext.MessagingCommandRecords.Add(record);
                // Only an actual removal is an event. A second request against a message that was
                // already removed satisfies the caller and changes nothing, so it allocates no event
                // position and gives the other side nothing to reconcile.
                if (removedNow)
                {
                    EmitRealtimeEvent(
                        conversation,
                        isModeration
                            ? MessagingRealtimeEventKind.MessageCoachModerated
                            : MessagingRealtimeEventKind.MessageSenderRemoved,
                        message,
                        record,
                        now);
                }

                return new CommandOutcome<MessageCommandResult>(null, messageId);
            },
            cancellationToken);
    }

    // ---------- idempotency ----------

    /// <summary>
    /// Runs one message command inside the workspace-wide idempotency boundary.
    /// </summary>
    /// <remarks>
    /// The key lock is taken before any aggregate lock, and the command record is reread from
    /// committed state once it is held. That is what makes the outcome the same whether two identical
    /// requests contend on one message, one conversation, two conversations, two client pairs or two
    /// different command types: none of those share an aggregate, and only the key does.
    /// </remarks>
    private Task<MessageCommandResult> RunMessageCommandAsync(
        Guid idempotencyKey,
        MessagingCommandType commandType,
        string fingerprint,
        ConversationParticipant participant,
        Func<CancellationToken, Task<CommandOutcome<MessageCommandResult>>> executeAsync,
        CancellationToken cancellationToken) =>
        RunIdempotentAsync(
            idempotencyKey,
            commandType,
            fingerprint,
            invalidKey: () => MessageCommandResult.Invalid("idempotencyKey", "An idempotency key is required."),
            conflict: MessageKeyReused,
            replayAsync: record => record.MessageId is { } id
                ? MessageSuccessAsync(id, participant, cancellationToken)
                : Task.FromResult(MessageCommandResult.NotFound()),
            executeAsync: executeAsync,
            successAsync: id => MessageSuccessAsync(id, participant, cancellationToken),
            staleConflict: StaleVersion,
            cancellationToken);

    /// <summary>
    /// The one implementation of "spend this key exactly once, in this workspace, for this command".
    /// </summary>
    /// <param name="invalidKey">The answer when no key was supplied at all.</param>
    /// <param name="conflict">The answer when the key was already spent on a different command.</param>
    /// <param name="replayAsync">Projects the original result of an identical earlier command.</param>
    /// <param name="executeAsync">
    /// Runs inside the transaction with the key lock held. It may take aggregate locks, and returns
    /// either a refusal — which rolls the transaction back — or the identifier the success projection
    /// needs.
    /// </param>
    /// <param name="successAsync">Projects the committed result.</param>
    /// <param name="staleConflict">
    /// The answer for a residual unique violation that is not the idempotency index: something else
    /// changed underneath, and the caller should reload rather than be shown a server error.
    /// </param>
    private async Task<TResult> RunIdempotentAsync<TResult>(
        Guid idempotencyKey,
        MessagingCommandType commandType,
        string fingerprint,
        Func<TResult> invalidKey,
        Func<TResult> conflict,
        Func<MessagingCommandRecord, Task<TResult>> replayAsync,
        Func<CancellationToken, Task<CommandOutcome<TResult>>> executeAsync,
        Func<Guid, Task<TResult>> successAsync,
        Func<TResult> staleConflict,
        CancellationToken cancellationToken)
    {
        if (idempotencyKey == Guid.Empty)
        {
            return invalidKey();
        }

        // The cheap path: a key that has already settled answers without taking a lock at all.
        if (await FindCommandAsync(idempotencyKey, cancellationToken) is { } settled)
        {
            return settled.Matches(commandType, fingerprint) ? await replayAsync(settled) : conflict();
        }

        var decision = await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            // The strategy may replay this whole block after a transient failure. Starting from
            // committed state is what keeps the sequence allocator honest and stops an abandoned
            // attempt's tracked rows from being inserted a second time.
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await LockIdempotencyKeyAsync(idempotencyKey, cancellationToken);

            // Reread under the lock. In READ COMMITTED each statement takes a fresh snapshot, so this
            // sees whatever the previous holder of the lock committed.
            var raced = await FindCommandAsync(idempotencyKey, cancellationToken);
            if (raced is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new IdempotentDecision<TResult>(raced, default, null);
            }

            var outcome = await executeAsync(cancellationToken);
            if (outcome.Refusal is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new IdempotentDecision<TResult>(null, outcome.Refusal, null);
            }

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                await transaction.RollbackAsync(cancellationToken);
                return new IdempotentDecision<TResult>(null, staleConflict(), null);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                // Belt and braces behind the key lock. A unique violation is an implementation
                // detail and must never reach the caller as a server error, so it is translated into
                // whichever answer the winning row justifies.
                await transaction.RollbackAsync(cancellationToken);
                dbContext.ChangeTracker.Clear();
                var winner = await FindCommandAsync(idempotencyKey, cancellationToken);
                return winner is null
                    ? new IdempotentDecision<TResult>(null, staleConflict(), null)
                    : new IdempotentDecision<TResult>(winner, default, null);
            }

            await transaction.CommitAsync(cancellationToken);
            return new IdempotentDecision<TResult>(null, default, outcome.TargetId);
        });

        if (decision.Replay is { } record)
        {
            return record.Matches(commandType, fingerprint) ? await replayAsync(record) : conflict();
        }

        return decision.Refusal is not null
            ? decision.Refusal
            : await successAsync(decision.TargetId!.Value);
    }

    /// <summary>
    /// The first lock every command takes. Advisory rather than a row lock, because the row whose
    /// existence is being serialized does not exist yet.
    /// </summary>
    /// <remarks>
    /// The marker comment is deliberate: the integration barriers arm on it, so a race test can prove
    /// both requests reached this exact boundary rather than some other statement that happens to
    /// mention the same table.
    /// </remarks>
    private async Task LockIdempotencyKeyAsync(Guid idempotencyKey, CancellationToken cancellationToken) =>
        // The affected-row count of a lock statement means nothing, so it is deliberately discarded.
        await dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({IdempotencyLockKey(tenantContext.TenantId, idempotencyKey)}) /* messaging-idempotency */",
            cancellationToken);

    private async Task LockDirectPairAsync(Guid clientProfileId, Guid coachUserId, CancellationToken cancellationToken) =>
        await dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({DirectConversationLockKey(clientProfileId, coachUserId)}) /* messaging-direct-pair */",
            cancellationToken);

    private async Task LockConversationAsync(Guid conversationId, CancellationToken cancellationToken) =>
        await dbContext.Database.ExecuteSqlAsync(
            $"""SELECT "LastSequence" FROM messaging."Conversations" WHERE "TenantId" = {tenantContext.TenantId} AND "Id" = {conversationId} FOR UPDATE /* messaging-sequence */""",
            cancellationToken);

    private async Task LockReadCursorAsync(Guid conversationId, Guid userId, CancellationToken cancellationToken) =>
        await dbContext.Database.ExecuteSqlAsync(
            $"""SELECT "LastReadSequence" FROM messaging."ConversationParticipants" WHERE "TenantId" = {tenantContext.TenantId} AND "ConversationId" = {conversationId} AND "UserId" = {userId} FOR UPDATE /* messaging-read-cursor */""",
            cancellationToken);

    // ---------- access ----------

    /// <summary>
    /// The one place a conversation operation decides whether the caller may act.
    /// </summary>
    /// <remarks>
    /// An unknown conversation, another workspace's conversation and a same-workspace non-participant
    /// are all <see cref="MessagingCommandStatus.NotFound"/>, deliberately indistinguishable: telling
    /// them apart confirms that an identifier exists and who is in it. A known participant whose
    /// Messaging entitlement is currently denied receives the ordinary stable refusal instead, with no
    /// message content.
    /// </remarks>
    private async Task<ConversationAccess> ResolveAsync(
        Guid conversationId,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new ConversationAccess(MessagingCommandStatus.NotFound, null, null, null);
        }

        var participant = await dbContext.ConversationParticipants
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.ConversationId == conversationId && item.UserId == userId,
                cancellationToken);
        if (participant is null)
        {
            return new ConversationAccess(MessagingCommandStatus.NotFound, null, null, null);
        }

        var conversation = await dbContext.Conversations
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == conversationId, cancellationToken);
        if (conversation is null)
        {
            return new ConversationAccess(MessagingCommandStatus.NotFound, null, null, null);
        }

        var decision = await EvaluateAsync(conversation.ClientProfileId, cancellationToken);
        return decision.IsAllowed
            ? new ConversationAccess(MessagingCommandStatus.Success, conversation, participant, null)
            : new ConversationAccess(MessagingCommandStatus.Forbidden, conversation, participant, decision.Reason);
    }

    private async Task<FeatureAccessDecision> EvaluateAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        if (accessCache.TryGetValue(clientProfileId, out var cached))
        {
            return cached;
        }

        var decision = await featureAccessService.EvaluateAsync(
            tenantContext.TenantId,
            clientProfileId,
            CoachingFeature.Messaging,
            cancellationToken);
        accessCache[clientProfileId] = decision;
        return decision;
    }

    // ---------- projection ----------

    private async Task<IReadOnlyList<ConversationSummary>> SummarizeAsync(
        IReadOnlyList<Guid> orderedIds,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var conversations = await dbContext.Conversations
            .AsNoTracking()
            .Where(conversation => orderedIds.Contains(conversation.Id))
            .ToDictionaryAsync(conversation => conversation.Id, cancellationToken);
        var participants = await dbContext.ConversationParticipants
            .AsNoTracking()
            .Where(participant =>
                orderedIds.Contains(participant.ConversationId) && participant.UserId == userId)
            .ToDictionaryAsync(participant => participant.ConversationId, cancellationToken);

        var ordered = orderedIds
            .Where(id => conversations.ContainsKey(id) && participants.ContainsKey(id))
            .Select(id => conversations[id])
            .ToArray();

        // Feature access is decided before any message row is touched. Fetching a body and then
        // removing it from the response is not the same as never fetching it: the refusal has to be a
        // reason not to read, rather than a filter applied afterwards.
        var decisions = new Dictionary<Guid, FeatureAccessDecision>(ordered.Length);
        var reachable = new List<Conversation>(ordered.Length);
        foreach (var conversation in ordered)
        {
            var decision = await EvaluateAsync(conversation.ClientProfileId, cancellationToken);
            decisions[conversation.Id] = decision;
            if (decision.IsAllowed)
            {
                reachable.Add(conversation);
            }
        }

        var available = reachable.ToArray();
        // A counterpart display name is safe for an unavailable row too — a refused list entry still
        // has to say who it is with — so it is the one projection resolved for every conversation.
        var names = await CounterpartNamesAsync(ordered, userId, cancellationToken);
        var unread = await UnreadByConversationAsync(
            [.. available.Select(conversation => conversation.Id)],
            userId,
            cancellationToken);
        var previews = await PreviewsAsync(available, userId, cancellationToken);

        var summaries = new List<ConversationSummary>(ordered.Length);
        foreach (var conversation in ordered)
        {
            var participant = participants[conversation.Id];
            var decision = decisions[conversation.Id];
            var counterpartId = conversation.CounterpartOf(userId);
            summaries.Add(new ConversationSummary(
                conversation.Id,
                conversation.ClientProfileId,
                new ConversationCounterpart(
                    counterpartId,
                    names.GetValueOrDefault(counterpartId, string.Empty),
                    participant.Role == ConversationParticipantRole.Coach
                        ? ConversationParticipantRole.Client
                        : ConversationParticipantRole.Coach),
                participant.Role,
                participant.CanModerate,
                conversation.StartedAtUtc,
                conversation.LastActivityAtUtc,
                conversation.LastSequence,
                decision.IsAllowed ? unread.GetValueOrDefault(conversation.Id, 0L) : 0L,
                participant.LastReadSequence,
                participant.LastReadAtUtc,
                decision.IsAllowed,
                decision.Reason,
                decision.IsAllowed ? previews.GetValueOrDefault(conversation.Id) : null));
        }

        return summaries;
    }

    /// <summary>
    /// The counterpart's display name, and nothing else about them.
    /// </summary>
    /// <remarks>
    /// A coach reading a client sees the tenant-local client profile name, which is the name that
    /// workspace already gave them; a client reading their coach sees the coach's account display
    /// name, because a coach has no client profile in their own workspace. Neither read exposes an
    /// email address, a phone number or any intake field.
    /// </remarks>
    private async Task<Dictionary<Guid, string>> CounterpartNamesAsync(
        Conversation[] conversations,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var names = new Dictionary<Guid, string>();
        if (conversations.Length == 0)
        {
            return names;
        }

        var clientProfileIds = conversations
            .Where(conversation => conversation.CounterpartOf(userId) == conversation.ClientUserId)
            .Select(conversation => conversation.ClientProfileId)
            .Distinct()
            .ToArray();
        if (clientProfileIds.Length > 0)
        {
            var profiles = await dbContext.ClientProfiles
                .AsNoTracking()
                .Where(profile => clientProfileIds.Contains(profile.Id))
                .Select(profile => new { profile.Id, profile.UserId, profile.FirstName, profile.LastName })
                .ToListAsync(cancellationToken);
            foreach (var profile in profiles.Where(item => item.UserId is not null))
            {
                names[profile.UserId!.Value] = $"{profile.FirstName} {profile.LastName}".Trim();
            }
        }

        var staffUserIds = conversations
            .Select(conversation => conversation.CounterpartOf(userId))
            .Where(counterpart => !names.ContainsKey(counterpart))
            .Distinct()
            .ToArray();
        if (staffUserIds.Length > 0)
        {
            var accounts = await dbContext.Users
                .AsNoTracking()
                .Where(user => staffUserIds.Contains(user.Id))
                .Select(user => new { user.Id, user.DisplayName })
                .ToListAsync(cancellationToken);
            foreach (var account in accounts)
            {
                names[account.Id] = account.DisplayName ?? string.Empty;
            }
        }

        return names;
    }

    private async Task<Dictionary<Guid, long>> UnreadByConversationAsync(
        Guid[] conversationIds,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (conversationIds.Length == 0)
        {
            return [];
        }

        // Written by the other participant, past this participant's own cursor, and still present.
        // The caller's own messages are excluded because sending is not being told something, and a
        // removed message is excluded because a badge pointing at a body nobody can read is noise.
        return await (
            from participant in dbContext.ConversationParticipants.AsNoTracking()
            join message in dbContext.Messages.AsNoTracking()
                on new { participant.TenantId, participant.ConversationId }
                equals new { message.TenantId, message.ConversationId }
            where participant.UserId == userId &&
                  conversationIds.Contains(participant.ConversationId) &&
                  message.SenderUserId != userId &&
                  message.DeletedAtUtc == null &&
                  message.Sequence > participant.LastReadSequence
            group message by message.ConversationId into grouped
            select new { ConversationId = grouped.Key, Count = grouped.LongCount() })
            .ToDictionaryAsync(item => item.ConversationId, item => item.Count, cancellationToken);
    }

    private async Task<Dictionary<Guid, ConversationMessagePreview>> PreviewsAsync(
        Conversation[] conversations,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var messageIds = conversations
            .Select(conversation => conversation.LastMessageId)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .ToArray();
        if (messageIds.Length == 0)
        {
            return [];
        }

        var messages = await dbContext.Messages
            .AsNoTracking()
            .Where(message => messageIds.Contains(message.Id))
            .ToListAsync(cancellationToken);
        var bodies = await CurrentBodiesAsync(messages, cancellationToken);

        return messages.ToDictionary(
            message => message.ConversationId,
            message => new ConversationMessagePreview(
                message.Id,
                message.Sequence,
                message.SenderUserId,
                message.SenderUserId == userId,
                message.SentAtUtc,
                message.IsDeleted || !bodies.TryGetValue(message.Id, out var body)
                    ? null
                    : MessageContentPolicy.Preview(body),
                message.IsDeleted,
                message.DeletionKind));
    }

    /// <summary>
    /// The current body of each message that still has one. A removed message is not asked for at all,
    /// so its retained revisions cannot escape through this path.
    /// </summary>
    private Task<Dictionary<Guid, string>> CurrentBodiesAsync(
        IReadOnlyList<Message> messages,
        CancellationToken cancellationToken) =>
        MessagingMessageProjection.CurrentBodiesAsync(dbContext, messages, cancellationToken);

    /// <summary>
    /// One caller-safe message. Shared with the realtime dispatcher and the catch-up endpoint, so
    /// there is exactly one place that decides a removed message loses its body and that a moderation
    /// reason reaches nobody.
    /// </summary>
    private static MessageView ToView(
        Message message,
        ConversationParticipant participant,
        IReadOnlyDictionary<Guid, string> bodies) =>
        MessagingMessageProjection.ToView(message, participant, bodies);

    private async Task<ConversationReadState> ReadStateAsync(
        Conversation conversation,
        ConversationParticipant participant,
        CancellationToken cancellationToken)
    {
        var unread = await UnreadByConversationAsync(
            [conversation.Id],
            participant.UserId,
            cancellationToken);
        return new ConversationReadState(
            conversation.Id,
            participant.UserId,
            participant.Role,
            participant.LastReadSequence,
            participant.LastReadAtUtc,
            unread.GetValueOrDefault(conversation.Id, 0L),
            conversation.LastSequence);
    }

    // ---------- helpers ----------

    private async Task<IReadOnlyList<Guid>> ConversationKeysetAsync(
        Guid userId,
        DateTimeOffset? beforeActivityAtUtc,
        Guid? beforeConversationId,
        int limit,
        CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;

        // A row-value comparison, so PostgreSQL can walk the (LastActivityAtUtc, Id) index from the
        // cursor rather than filtering after sorting. Written as SQL because the tie-breaker compares
        // two uuids, which LINQ has no operator for.
        if (beforeActivityAtUtc is { } activity && beforeConversationId is { } cursorId)
        {
            return await dbContext.Database.SqlQuery<Guid>($"""
                SELECT c."Id" AS "Value"
                FROM messaging."Conversations" AS c
                INNER JOIN messaging."ConversationParticipants" AS p
                    ON p."TenantId" = c."TenantId" AND p."ConversationId" = c."Id"
                WHERE c."TenantId" = {tenantId}
                  AND p."UserId" = {userId}
                  AND (c."LastActivityAtUtc", c."Id") < ({activity}, {cursorId})
                ORDER BY c."LastActivityAtUtc" DESC, c."Id" DESC
                LIMIT {limit}
                """).ToListAsync(cancellationToken);
        }

        return await dbContext.Database.SqlQuery<Guid>($"""
            SELECT c."Id" AS "Value"
            FROM messaging."Conversations" AS c
            INNER JOIN messaging."ConversationParticipants" AS p
                ON p."TenantId" = c."TenantId" AND p."ConversationId" = c."Id"
            WHERE c."TenantId" = {tenantId}
              AND p."UserId" = {userId}
            ORDER BY c."LastActivityAtUtc" DESC, c."Id" DESC
            LIMIT {limit}
            """).ToListAsync(cancellationToken);
    }

    private Task<MessagingCommandRecord?> FindCommandAsync(
        Guid idempotencyKey,
        CancellationToken cancellationToken) =>
        dbContext.MessagingCommandRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);

    private async Task<MessageCommandResult> MessageSuccessAsync(
        Guid messageId,
        ConversationParticipant participant,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var message = await dbContext.Messages
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == messageId, cancellationToken);
        if (message is null)
        {
            return MessageCommandResult.NotFound();
        }

        var bodies = await CurrentBodiesAsync([message], cancellationToken);
        return MessageCommandResult.Success(ToView(message, participant, bodies));
    }

    private async Task<ConversationCommandResult> ConversationSuccessAsync(
        Guid conversationId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var conversation = await dbContext.Conversations
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == conversationId, cancellationToken);
        var participant = await dbContext.ConversationParticipants
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.ConversationId == conversationId && item.UserId == userId,
                cancellationToken);
        if (conversation is null || participant is null)
        {
            return ConversationCommandResult.NotFound();
        }

        var summaries = await SummarizeAsync([conversationId], userId, cancellationToken);
        return summaries.Count == 0
            ? ConversationCommandResult.NotFound()
            : ConversationCommandResult.Success(new ConversationDetail(
                summaries[0],
                await ReadStateAsync(conversation, participant, cancellationToken)));
    }

    private static CommandOutcome<MessageCommandResult> Refuse(MessageCommandResult refusal) =>
        new(refusal, null);

    private static MessageCommandResult MessageKeyReused() =>
        MessageCommandResult.Conflict(
            MessagingConflictCodes.IdempotencyKeyReused,
            "That idempotency key was already used for a different messaging command.");

    private static ConversationCommandResult ConversationKeyReused() =>
        ConversationCommandResult.Conflict(
            MessagingConflictCodes.IdempotencyKeyReused,
            "That idempotency key was already used for a different messaging command.");

    private static MessageCommandResult StaleVersion() =>
        MessageCommandResult.Conflict(
            MessagingConflictCodes.StaleMessageVersion,
            "This message changed since it was read. Reload the conversation and try again.");

    private static string BodyFailureMessage(MessageContentFailure failure) => failure switch
    {
        MessageContentFailure.TooLong =>
            $"A message can be at most {MessageContentPolicy.MaximumLength} characters.",
        MessageContentFailure.InvalidCharacter => "A message can only contain ordinary text.",
        _ => "A message cannot be blank.",
    };

    private static string ReasonFailureMessage(MessageContentFailure failure) => failure switch
    {
        MessageContentFailure.TooLong =>
            $"A removal reason can be at most {MessageContentPolicy.MaximumModerationReasonLength} characters.",
        MessageContentFailure.InvalidCharacter => "A removal reason can only contain ordinary text.",
        _ => "A removal reason is required.",
    };

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    /// <summary>
    /// Advisory locks share one 64-bit key space across the database, so each use is mixed with a
    /// constant that namespaces it and keeps it clear of the media quota lock and of the other
    /// messaging lock. Two different keys can collide in this space; the only consequence is that
    /// they serialize with each other, which costs a little concurrency and breaks nothing.
    /// </summary>
    private const long DirectConversationLockNamespace = 0x6B2_0000_0000_0000L;

    private const long IdempotencyLockNamespace = 0x6B2_1000_0000_0000L;

    private static long DirectConversationLockKey(Guid clientProfileId, Guid coachUserId) =>
        BitConverter.ToInt64(clientProfileId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(coachUserId.ToByteArray(), 8)
        ^ DirectConversationLockNamespace;

    private static long IdempotencyLockKey(Guid tenantId, Guid idempotencyKey) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(idempotencyKey.ToByteArray(), 0)
        ^ BitConverter.ToInt64(idempotencyKey.ToByteArray(), 8)
        ^ IdempotencyLockNamespace;

    private sealed record ConversationAccess(
        MessagingCommandStatus Status,
        Conversation? Conversation,
        ConversationParticipant? Participant,
        FeatureAccessReason? Reason);

    /// <summary>What a command body decided: either a refusal that rolls back, or what it wrote.</summary>
    private sealed record CommandOutcome<TResult>(TResult? Refusal, Guid? TargetId);

    private sealed record IdempotentDecision<TResult>(
        MessagingCommandRecord? Replay,
        TResult? Refusal,
        Guid? TargetId);
}
