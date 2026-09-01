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
    public async Task<NotificationPage> ListOwnAsync(
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        if (!TryResolveRecipient(out var recipientUserId))
        {
            return new NotificationPage(0, 0, []);
        }

        var own = dbContext.Notifications
            .AsNoTracking()
            .Where(item => item.RecipientUserId == recipientUserId);
        var total = await own.LongCountAsync(cancellationToken);
        var unread = await own.LongCountAsync(item => item.ReadAtUtc == null, cancellationToken);

        // Newest first, with the identifier as the tiebreaker. UUIDv7 identifiers are time-ordered,
        // so two notifications written in the same instant still page deterministically instead of
        // swapping places between requests and duplicating or skipping a row.
        var items = await own
            .OrderByDescending(item => item.CreatedAtUtc)
            .ThenByDescending(item => item.Id)
            .Skip(skip)
            .Take(take)
            .Select(item => new NotificationView(
                item.Id,
                item.Kind,
                item.Title,
                item.Body,
                item.CreatedAtUtc,
                item.ReadAtUtc,
                item.ReadAtUtc != null,
                item.Version))
            .ToListAsync(cancellationToken);

        return new NotificationPage(total, unread, items);
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

        return NotificationCommandResult.Success(ToView(notification));
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

        var deadLettered = dbContext.NotificationOutboxItems
            .AsNoTracking()
            .Where(item => item.Status == NotificationOutboxStatus.DeadLettered);
        var total = await deadLettered.LongCountAsync(cancellationToken);
        var items = await deadLettered
            .OrderByDescending(item => item.DeadLetteredAtUtc)
            .ThenByDescending(item => item.Id)
            .Skip(skip)
            .Take(take)
            // The projection is the privacy boundary. Recipient, payload, rendered wording and every
            // delivery detail are absent from the shape, so an operational view cannot become a way
            // to read somebody else's notifications.
            .Select(item => new NotificationDeadLetterView(
                item.Id,
                item.Kind,
                item.ScheduledAtUtc,
                item.AttemptCount,
                item.DeadLetteredAtUtc,
                item.FailureCode))
            .ToListAsync(cancellationToken);

        return new NotificationDeadLetterPage(total, items);
    }

    private bool TryResolveRecipient(out Guid recipientUserId)
    {
        recipientUserId = currentUser.UserId ?? Guid.Empty;
        return tenantContext.HasTenant && recipientUserId != Guid.Empty;
    }

    private static NotificationView ToView(Notification notification) => new(
        notification.Id,
        notification.Kind,
        notification.Title,
        notification.Body,
        notification.CreatedAtUtc,
        notification.ReadAtUtc,
        notification.IsRead,
        notification.Version);
}
