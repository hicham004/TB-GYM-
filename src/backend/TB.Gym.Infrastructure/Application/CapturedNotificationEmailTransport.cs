using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The only email transport in this phase: it captures the message in memory and contacts nothing.
/// </summary>
/// <remarks>
/// Registered exclusively outside Production, where startup validation refuses it outright. It exists
/// so that the whole channel — planning, preference rechecks, quiet hours, claiming, retrying,
/// suppression and materialization — can be built and proven end to end without a provider, and so
/// that adding one later is a new implementation of this interface rather than a change to the model.
/// <para>
/// What it captures never becomes durable. The bounded buffer lives in this process, is dropped when
/// the process ends, and is the only place a recipient address or a rendered body exists at all: no
/// column, no dead-letter row and no log line carries either, and an integration test dumps every
/// notification column and every captured log line to prove it.
/// </para>
/// <para>
/// It returns <see cref="NotificationEmailTransportOutcome.Captured"/> and a null provider message
/// identifier, deliberately. Reporting a capture as sent, accepted or delivered would be a claim about
/// a provider that was never asked, and a database trigger refuses the columns that would record one.
/// </para>
/// </remarks>
internal sealed class CapturedNotificationEmailTransport : INotificationEmailTransport
{
    /// <summary>
    /// Bounded so a long development session cannot grow the buffer without limit. The oldest capture
    /// is dropped rather than the newest refused: a full buffer must never turn into a delivery
    /// failure, because that would make the adapter's own bookkeeping change the domain outcome.
    /// </summary>
    private const int Capacity = 200;

    private readonly ConcurrentQueue<string> captureOrder = new();
    private readonly ConcurrentDictionary<string, CapturedNotificationEmail> captured = new(StringComparer.Ordinal);

    public string AdapterName => NotificationEmailAdapters.CapturedAdapterName;

    public Task<NotificationEmailTransportResult> SendAsync(
        NotificationEmailMessage message,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        cancellationToken.ThrowIfCancellationRequested();

        var capture = new CapturedNotificationEmail(
            message.TenantId,
            message.OutboxItemId,
            message.IdempotencyKey,
            message.RecipientAddress,
            message.Subject,
            message.TextBody);
        if (captured.TryAdd(message.IdempotencyKey, capture))
        {
            captureOrder.Enqueue(message.IdempotencyKey);
        }

        while (captured.Count > Capacity && captureOrder.TryDequeue(out var oldestKey))
        {
            captured.TryRemove(oldestKey, out _);
        }

        return Task.FromResult(NotificationEmailTransportResult.Captured());
    }

    /// <summary>Everything captured so far, newest last. For development inspection and tests only.</summary>
    public IReadOnlyList<CapturedNotificationEmail> Captured =>
        [.. captureOrder.Select(key => captured.TryGetValue(key, out var capture) ? capture : null)
            .OfType<CapturedNotificationEmail>()];

    /// <summary>Empties the buffer. Development and test convenience; it deletes nothing durable.</summary>
    public void Clear()
    {
        captured.Clear();
        while (captureOrder.TryDequeue(out _))
        {
            // Drain.
        }
    }
}

/// <summary>
/// One captured email. Exists only in the adapter's memory, and only outside Production.
/// </summary>
internal sealed record CapturedNotificationEmail(
    Guid TenantId,
    Guid OutboxItemId,
    string IdempotencyKey,
    string RecipientAddress,
    string Subject,
    string TextBody);

/// <summary>
/// Resolves a recipient's current address at materialization, and only for a current member.
/// </summary>
/// <remarks>
/// This is the narrow authorized contract the Notifications module is given instead of a way to read
/// Identity's tables. Infrastructure is what composes the modules, so it is the right place for the
/// join; the module itself holds no reference that would let it do this, and an architecture test
/// asserts that.
/// <para>
/// It re-establishes active membership of the workspace before returning anything, so a delivery row
/// planned while somebody was a member cannot mail them after they were removed — even if some future
/// caller forgot the check. Two narrowings for the same fact is the point.
/// </para>
/// </remarks>
internal sealed class NotificationRecipientContacts(GymDbContext dbContext) : INotificationRecipientContacts
{
    public async Task<NotificationRecipientContact?> ResolveAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var isActiveMember = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(
                membership =>
                    membership.TenantId == tenantId &&
                    membership.UserId == userId &&
                    membership.Status == MembershipStatus.Active,
                cancellationToken);
        if (!isActiveMember)
        {
            return null;
        }

        var account = await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId && !user.IsPlatformBlocked)
            .Select(user => new { user.Email, user.EmailConfirmed })
            .SingleOrDefaultAsync(cancellationToken);
        return account is null || string.IsNullOrWhiteSpace(account.Email)
            ? null
            : new NotificationRecipientContact(account.Email, account.EmailConfirmed);
    }
}
