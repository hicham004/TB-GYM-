using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Messaging;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A coach's own saved replies (MSG-023): listed, added, changed and removed by their owner only.
/// </summary>
/// <remarks>
/// Every read and write is narrowed to the signed-in caller inside the active workspace, so another
/// person's reply, in this workspace or another, is simply not found. Bodies and titles never reach a
/// log or an exception message, like message bodies (MSG-011).
/// </remarks>
internal sealed class SavedReplyService(
    GymDbContext dbContext,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
    : ISavedReplyService
{
    private const long LockNamespace = 0x5a7ed_2e91;

    public async Task<SavedReplyList> ListAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new SavedReplyList([], SavedReplyText.MaximumPerOwner);
        }

        var items = await dbContext.SavedReplies
            .AsNoTracking()
            .Where(reply => reply.OwnerUserId == userId)
            .Select(reply => new SavedReplyView(reply.Id, reply.Title, reply.Body, reply.UpdatedAtUtc, reply.Version))
            .ToListAsync(cancellationToken);
        // At most a hundred, so they are put in title order here, ignoring case, in any script.
        return new SavedReplyList(
            [.. items.OrderBy(item => item.Title, StringComparer.InvariantCultureIgnoreCase).ThenBy(item => item.Id)],
            SavedReplyText.MaximumPerOwner);
    }

    public async Task<SavedReplyCommandResult> CreateAsync(
        CreateSavedReplyRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return SavedReplyCommandResult.NotFound();
        }

        if (!SavedReplyText.TryCreate(request?.Title, request?.Body, out var text, out var field, out var problem))
        {
            return SavedReplyCommandResult.Invalid(field, problem);
        }

        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // One add at a time per person, so two quick saves cannot both slip under the limit.
            await dbContext.Database.ExecuteSqlAsync(
                $"SELECT pg_advisory_xact_lock({LockKey(tenantContext.TenantId, userId)}) /* saved-replies */",
                cancellationToken);
            var kept = await dbContext.SavedReplies.CountAsync(reply => reply.OwnerUserId == userId, cancellationToken);
            if (kept >= SavedReplyText.MaximumPerOwner)
            {
                await transaction.RollbackAsync(cancellationToken);
                return SavedReplyCommandResult.Conflict(
                    SavedReplyConflictCodes.LimitReached,
                    $"You can keep up to {SavedReplyText.MaximumPerOwner} saved replies. Delete one to add another.");
            }

            var reply = SavedReply.Create(tenantContext.TenantId, userId, text);
            dbContext.SavedReplies.Add(reply);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return SavedReplyCommandResult.Success(View(reply));
        });
    }

    public async Task<SavedReplyCommandResult> EditAsync(
        Guid savedReplyId,
        EditSavedReplyRequest request,
        CancellationToken cancellationToken)
    {
        // Found before the payload is read, so a stranger's identifier answers the same whatever it
        // is sent with.
        if (await FindOwnAsync(savedReplyId, cancellationToken) is not { } reply)
        {
            return SavedReplyCommandResult.NotFound();
        }

        if (!SavedReplyText.TryCreate(request?.Title, request?.Body, out var text, out var field, out var problem))
        {
            return SavedReplyCommandResult.Invalid(field, problem);
        }

        dbContext.Entry(reply).Property(item => item.Version).OriginalValue = request!.Version;
        reply.Change(text);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleVersion();
        }

        return SavedReplyCommandResult.Success(View(reply));
    }

    public async Task<SavedReplyCommandResult> DeleteAsync(
        Guid savedReplyId,
        DeleteSavedReplyRequest request,
        CancellationToken cancellationToken)
    {
        if (await FindOwnAsync(savedReplyId, cancellationToken) is not { } reply)
        {
            return SavedReplyCommandResult.NotFound();
        }

        // A writing aid, not a record: removing it leaves nothing behind. The version still guards
        // against removing a reply another window has just changed.
        dbContext.Entry(reply).Property(item => item.Version).OriginalValue = request?.Version ?? 0;
        dbContext.SavedReplies.Remove(reply);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleVersion();
        }

        return SavedReplyCommandResult.Success(null);
    }

    private async Task<SavedReply?> FindOwnAsync(Guid savedReplyId, CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId || !tenantContext.HasTenant
            ? null
            : await dbContext.SavedReplies.SingleOrDefaultAsync(
                reply => reply.Id == savedReplyId && reply.OwnerUserId == userId,
                cancellationToken);

    private static SavedReplyCommandResult StaleVersion() =>
        SavedReplyCommandResult.Conflict(
            SavedReplyConflictCodes.StaleVersion,
            "This reply was changed in another window. Open it again to see the latest version.");

    private static SavedReplyView View(SavedReply reply) =>
        new(reply.Id, reply.Title, reply.Body, reply.UpdatedAtUtc, reply.Version);

    private static long LockKey(Guid tenantId, Guid userId) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 8)
        ^ LockNamespace;
}
