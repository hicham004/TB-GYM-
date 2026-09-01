namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A no-op production checkpoint at the exact boundary between a committed claim and delivery.
/// </summary>
/// <remarks>
/// Integration tests replace this with a deterministic barrier so authoritative changes and stale
/// claim takeovers can be committed after the claim is visible but before materialization begins.
/// Keeping the seam at that boundary makes those races reproducible without delaying production.
/// </remarks>
internal interface INotificationDispatchCheckpoint
{
    Task AfterClaimCommittedAsync(
        Guid tenantId,
        Guid outboxItemId,
        Guid claimToken,
        CancellationToken cancellationToken);
}

internal sealed class NoOpNotificationDispatchCheckpoint : INotificationDispatchCheckpoint
{
    public Task AfterClaimCommittedAsync(
        Guid tenantId,
        Guid outboxItemId,
        Guid claimToken,
        CancellationToken cancellationToken) => Task.CompletedTask;
}
