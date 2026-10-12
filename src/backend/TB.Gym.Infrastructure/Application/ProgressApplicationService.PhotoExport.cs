using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Progress;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A client's before-and-after (R6.1b, PRG-013). The server records who made it, when and from which two
/// photos before the picture is made on the client's device; it never receives the picture. Progress is
/// the client's own (PRG-008), so neither their plan nor a coach's block stands in the way, while a
/// former client is refused at the workspace (ADR 0027) and a returning one has only their new profile's
/// photos.
/// </summary>
internal sealed partial class ProgressApplicationService
{
    public async Task<ProgressPhotoExportCommandResult> ExportOwnPhotosAsync(
        ExportProgressPhotosRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (currentUser.UserId is not { } userId ||
            await FindSelfAsync(cancellationToken) is not { } client)
        {
            return new ProgressPhotoExportCommandResult(ProgressCommandStatus.NotFound);
        }

        if (request.BeforePhotoId == Guid.Empty || request.AfterPhotoId == Guid.Empty)
        {
            return ExportInvalid("Choose two photos.");
        }

        if (request.BeforePhotoId == request.AfterPhotoId)
        {
            return ExportInvalid("Choose two different photos.");
        }

        // Only this client's own photos, in this workspace; anyone else's answer as missing.
        var photos = await dbContext.ProgressPhotos
            .AsNoTracking()
            .Where(item => item.ClientProfileId == client.Id &&
                           (item.Id == request.BeforePhotoId || item.Id == request.AfterPhotoId))
            .ToArrayAsync(cancellationToken);
        var before = photos.SingleOrDefault(item => item.Id == request.BeforePhotoId);
        var after = photos.SingleOrDefault(item => item.Id == request.AfterPhotoId);
        if (before is null || after is null)
        {
            return new ProgressPhotoExportCommandResult(ProgressCommandStatus.NotFound);
        }

        // The client still sees a photo they removed, but it cannot leave in a picture.
        if (before.Status != ProgressPhotoStatus.Active || after.Status != ProgressPhotoStatus.Active)
        {
            return RemovedPhotoConflict();
        }

        if (before.Pose != after.Pose)
        {
            return ExportInvalid("Both photos must show the same pose.");
        }

        if (before.PhotoDate >= after.PhotoDate)
        {
            return ExportInvalid("The before photo must be the earlier one.");
        }

        var export = ProgressPhotoExport.BeforeAndAfter(before, after, clock.UtcNow, userId);
        dbContext.ProgressPhotoExports.Add(export);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsRemovedPhotoExport(exception))
        {
            // A removal committed between the read above and this insert; the trigger saw it.
            dbContext.Entry(export).State = EntityState.Detached;
            return RemovedPhotoConflict();
        }

        return new ProgressPhotoExportCommandResult(
            ProgressCommandStatus.Success,
            new ProgressPhotoExportView(
                export.Id,
                export.Pose,
                new ProgressPhotoExportPhotoView(before.Id, before.PhotoDate, before.MediaAssetId),
                new ProgressPhotoExportPhotoView(after.Id, after.PhotoDate, after.MediaAssetId),
                export.ExportedAtUtc));
    }

    /// <summary>The insert trigger's refusal of a photo that is no longer active. Anything else is a fault.</summary>
    internal static bool IsRemovedPhotoExport(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.CheckViolation,
            ConstraintName: DatabaseConstraintNames.ProgressPhotoExportNamesActivePhotos,
        };

    private static ProgressPhotoExportCommandResult ExportInvalid(string message) =>
        new(
            ProgressCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { ["photos"] = [message] });

    private static ProgressPhotoExportCommandResult RemovedPhotoConflict() =>
        new(
            ProgressCommandStatus.Conflict,
            Code: "ProgressPhotoRemoved",
            Message: "A removed photo cannot be used. Choose another.");
}
