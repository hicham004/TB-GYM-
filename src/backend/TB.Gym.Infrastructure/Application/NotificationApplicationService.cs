using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The signed-in recipient's own inbox, plus the owner-only dead-letter read.
/// </summary>
/// <remarks>
/// Two independent narrowings apply to every inbox read and write. The workspace comes from the
/// tenant authorization handler, which has already verified an active membership, and is enforced
/// again by the global query filter; the recipient comes from the authentication cookie and is
/// applied as a predicate here. Being a member of a workspace therefore does not make somebody a
/// reader of another member's notifications, and a workspace owner is no exception.
/// <para>
/// Nothing here returns the payload, a delivery attempt, a failure code, an address or any provider
/// data. What a recipient sees is the rendered snapshot and their own read state.
/// </para>
/// </remarks>
internal sealed class NotificationApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
    : INotificationApplicationService
{
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<NotificationPage> ListOwnAsync(
        int skip,
        int take,
        bool unreadOnly,
        CancellationToken cancellationToken,
        Guid? beforeId = null)
    {
        if (!TryResolveRecipient(out var recipientUserId))
        {
            return new NotificationPage(0, 0, []);
        }

        var own = dbContext.Notifications
            .AsNoTracking()
            .Where(item => item.RecipientUserId == recipientUserId);
        var unread = await own.LongCountAsync(item => item.ReadAtUtc == null, cancellationToken);
        var listed = unreadOnly ? own.Where(item => item.ReadAtUtc == null) : own;
        var total = unreadOnly ? unread : await own.LongCountAsync(cancellationToken);

        if (beforeId is { } cursor)
        {
            var anchor = await own.Where(item => item.Id == cursor)
                .Select(item => new { item.Id, item.CreatedAtUtc }).SingleOrDefaultAsync(cancellationToken);
            if (anchor is null) return new NotificationPage(total, unread, []);
            listed = listed.Where(item => item.CreatedAtUtc < anchor.CreatedAtUtc ||
                (item.CreatedAtUtc == anchor.CreatedAtUtc && item.Id.CompareTo(anchor.Id) < 0));
            skip = 0;
        }

        // Newest first, with the identifier as the tiebreaker. UUIDv7 identifiers are time-ordered,
        // so two notifications written in the same instant still page deterministically instead of
        // swapping places between requests and duplicating or skipping a row.
        var items = await listed
            .OrderByDescending(item => item.CreatedAtUtc)
            .ThenByDescending(item => item.Id)
            .Skip(skip)
            .Take(take + 1)
            .ToListAsync(cancellationToken);
        var hasMore = items.Count > take;
        if (hasMore) items.RemoveAt(items.Count - 1);
        var links = await ReadLinksAsync(items, cancellationToken);

        return new NotificationPage(
            total,
            unread,
            items.Select(item => ToView(item, links.GetValueOrDefault(item.SourceOutboxItemId))).ToList(), hasMore);
    }

    public async Task<NotificationReadAllResult> MarkAllOwnReadAsync(CancellationToken cancellationToken)
    {
        if (!TryResolveRecipient(out var recipientUserId))
        {
            return new NotificationReadAllResult(0, 0);
        }

        var now = clock.UtcNow;
        // One statement over what is still unread, so a notice marked read on its own at the same moment
        // is skipped rather than conflicting: the loop it replaces answered 500 after its third conflict
        // (audit BEB-6). Read stays one-way and keeps its first instant, as Notification.MarkRead does and
        // the table's trigger enforces.
        var marked = await dbContext.Notifications
            .Where(item => item.RecipientUserId == recipientUserId && item.ReadAtUtc == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(item => item.ReadAtUtc, (DateTimeOffset?)now)
                    .SetProperty(item => item.UpdatedAtUtc, now)
                    .SetProperty(item => item.UpdatedByUserId, (Guid?)recipientUserId),
                cancellationToken);

        var left = await dbContext.Notifications
            .AsNoTracking()
            .LongCountAsync(item => item.RecipientUserId == recipientUserId && item.ReadAtUtc == null, cancellationToken);
        return new NotificationReadAllResult(marked, left);
    }

    public async Task<NotificationUnreadCount> CountOwnUnreadAsync(CancellationToken cancellationToken)
    {
        if (!TryResolveRecipient(out var recipientUserId))
        {
            return new NotificationUnreadCount(0);
        }

        var unread = await dbContext.Notifications
            .AsNoTracking()
            .LongCountAsync(
                item => item.RecipientUserId == recipientUserId && item.ReadAtUtc == null,
                cancellationToken);
        return new NotificationUnreadCount(unread);
    }

    public async Task<NotificationCommandResult> MarkOwnReadAsync(
        Guid notificationId,
        CancellationToken cancellationToken)
    {
        if (!TryResolveRecipient(out var recipientUserId))
        {
            return NotificationCommandResult.NotFound();
        }

        var notification = await dbContext.Notifications
            .SingleOrDefaultAsync(
                item => item.Id == notificationId && item.RecipientUserId == recipientUserId,
                cancellationToken);
        if (notification is null)
        {
            // Another workspace, another recipient, or nothing at all: one answer, so a caller cannot
            // use the response to learn that an identifier exists.
            return NotificationCommandResult.NotFound();
        }

        if (notification.MarkRead(clock.UtcNow))
        {
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Two taps on the same notification. Marking read is idempotent by definition, so the
                // loser re-reads the winner's row and reports success rather than a conflict the user
                // could do nothing about.
                await dbContext.Entry(notification).ReloadAsync(cancellationToken);
            }
        }

        var links = await ReadLinksAsync([notification], cancellationToken);
        return NotificationCommandResult.Success(
            ToView(notification, links.GetValueOrDefault(notification.SourceOutboxItemId)));
    }

    public async Task<NotificationDeadLetterPage> ListDeadLettersAsync(
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return new NotificationDeadLetterPage(0, []);
        }

        // Per channel delivery, because dead-lettering is per channel now: an intent whose inbox row
        // was written and whose email exhausted its retries has exactly one thing to show an operator,
        // and reporting it against the intent would either hide the failure or misrepresent the success.
        var deadLettered = dbContext.NotificationChannelDeliveries
            .AsNoTracking()
            .Where(delivery => delivery.Status == NotificationDeliveryStatus.DeadLettered);
        var total = await deadLettered.LongCountAsync(cancellationToken);
        var items = await deadLettered
            .OrderByDescending(delivery => delivery.DeadLetteredAtUtc)
            .ThenByDescending(delivery => delivery.Id)
            .Skip(skip)
            .Take(take)
            // The projection is the privacy boundary. Recipient, payload, rendered wording, address and
            // every transport detail are absent from the shape, so an operational view cannot become a
            // way to read somebody else's notifications.
            .Join(
                dbContext.NotificationOutboxItems.AsNoTracking(),
                delivery => delivery.OutboxItemId,
                item => item.Id,
                (delivery, item) => new NotificationDeadLetterView(
                    item.Id,
                    delivery.Id,
                    delivery.Channel,
                    item.Kind,
                    item.ScheduledAtUtc,
                    delivery.AttemptCount,
                    delivery.DeadLetteredAtUtc,
                    delivery.FailureCode))
            .ToListAsync(cancellationToken);

        return new NotificationDeadLetterPage(total, items);
    }

    private bool TryResolveRecipient(out Guid recipientUserId)
    {
        recipientUserId = currentUser.UserId ?? Guid.Empty;
        return tenantContext.HasTenant && recipientUserId != Guid.Empty;
    }

    /// <summary>
    /// Where each linked notice leads: identifiers its intent holds, read from the outbox row and never
    /// returned as a payload. Only the kinds a screen links to are read.
    /// </summary>
    private async Task<Dictionary<Guid, NotificationLink>> ReadLinksAsync(
        IReadOnlyCollection<Notification> notifications,
        CancellationToken cancellationToken)
    {
        var sources = notifications
            .Where(item => item.Kind == CommercialNotificationKind.RenewalRequested ||
                NotificationPurposeCatalog.IsTrainingKind(item.Kind))
            .Select(item => item.SourceOutboxItemId)
            .ToArray();
        if (sources.Length == 0)
        {
            return [];
        }

        var rows = await dbContext.NotificationOutboxItems.AsNoTracking()
            .Where(outbox => sources.Contains(outbox.Id))
            .Select(outbox => new { outbox.Id, outbox.Kind, outbox.AggregateId, outbox.PayloadJson })
            .ToListAsync(cancellationToken);
        var delivered = notifications.ToDictionary(item => item.SourceOutboxItemId, item => item.TargetWeeks);
        var training = rows
            .Where(row => row.Kind != CommercialNotificationKind.RenewalRequested)
            .Select(row => (row.Id, row.Kind, Payload: ReadTrainingPayload(row.PayloadJson)))
            .Where(row => row.Payload is not null)
            .Select(row => (row.Id, row.Kind, Payload: row.Payload!))
            .ToArray();
        var weekTargets = await ReadWeekTargetsAsync(
            training
                .Where(row => (row.Kind is CommercialNotificationKind.WeeksShared or CommercialNotificationKind.WeeksChanged) &&
                    delivered[row.Id] is { Length: > 0 })
                .Select(row => new WeekNotice(row.Id, row.Payload.MesocycleId, row.Payload.ClientProfileId, delivered[row.Id]!))
                .ToArray(),
            cancellationToken);

        var links = rows
            .Where(row => row.Kind == CommercialNotificationKind.RenewalRequested)
            .ToDictionary(row => row.Id, row => new NotificationLink(row.AggregateId, null, null, null));
        foreach (var (id, kind, payload) in training)
        {
            // A client's note links the coach to that client; every other training notice is the reader's own.
            links[id] = new NotificationLink(
                kind == CommercialNotificationKind.ClientWorkoutNote ? payload.ClientProfileId : null,
                payload.SessionId,
                payload.WorkoutExecutionId,
                weekTargets.GetValueOrDefault(id),
                payload.MesocycleId);
        }

        return links;
    }

    /// <summary>
    /// The week each week notice opens: the first of the weeks it was delivered with that the client can still
    /// open, or none. The delivered snapshot limits the candidates and current visibility can only narrow them.
    /// The page's programs and weeks are read once each, however many week notices it holds.
    /// </summary>
    private async Task<Dictionary<Guid, int?>> ReadWeekTargetsAsync(
        IReadOnlyCollection<WeekNotice> notices,
        CancellationToken cancellationToken)
    {
        if (notices.Count == 0)
        {
            return [];
        }

        var mesocycleIds = notices.Select(notice => notice.MesocycleId).Distinct().ToArray();
        var blocks = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => mesocycleIds.Contains(item.Id) &&
                item.Status != TB.Gym.Modules.Training.MesocycleStatus.Cancelled)
            .Select(item => new { item.Id, item.ClientProfileId, item.StartDate, item.TimeZoneId, item.RevealAllWeeks })
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        if (blocks.Count == 0)
        {
            return [];
        }

        var openIds = blocks.Keys.ToArray();
        var weekNumbers = notices.SelectMany(notice => notice.Delivered).Distinct().ToArray();
        var weeks = (await dbContext.MesocycleWeeks.AsNoTracking()
                .Where(item => openIds.Contains(item.MesocycleId) && weekNumbers.Contains(item.WeekNumber))
                .Select(item => new { item.MesocycleId, item.WeekNumber, item.IsPublished })
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.MesocycleId);

        var now = clock.UtcNow;
        var targets = new Dictionary<Guid, int?>();
        foreach (var notice in notices)
        {
            // A notice names its client's own program; a cancelled one, or another client's, opens no week.
            if (!blocks.TryGetValue(notice.MesocycleId, out var block) || block.ClientProfileId != notice.ClientProfileId)
            {
                continue;
            }

            targets[notice.OutboxItemId] = weeks[notice.MesocycleId]
                .Where(item => notice.Delivered.Contains(item.WeekNumber) &&
                    TB.Gym.Modules.Training.TrainingCalendarPolicy.GetWeekAvailability(
                        block.StartDate, item.WeekNumber, block.TimeZoneId, now, block.RevealAllWeeks, item.IsPublished).IsVisible)
                .Select(item => (int?)item.WeekNumber)
                .Min();
        }

        return targets;
    }

    private static TrainingNotificationPayload? ReadTrainingPayload(string payloadJson)
    {
        try
        {
            return JsonSerializer.Deserialize<TrainingNotificationPayload>(payloadJson, PayloadJsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static NotificationView ToView(Notification notification, NotificationLink? link) => new(
        notification.Id,
        notification.Kind,
        notification.Title,
        notification.Body,
        notification.CreatedAtUtc,
        notification.ReadAtUtc,
        notification.IsRead,
        notification.Version,
        link?.ClientProfileId,
        link?.SessionId,
        link?.WorkoutExecutionId,
        link?.WeekNumber,
        link?.MesocycleId);

    private sealed record NotificationLink(Guid? ClientProfileId, Guid? SessionId, Guid? WorkoutExecutionId, int? WeekNumber, Guid? MesocycleId = null);

    /// <summary>A week notice on the page: its intent, the program it names, and the weeks it was delivered with.</summary>
    private sealed record WeekNotice(Guid OutboxItemId, Guid MesocycleId, Guid ClientProfileId, int[] Delivered);
}
