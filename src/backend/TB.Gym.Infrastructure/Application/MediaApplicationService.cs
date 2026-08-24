using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class MediaApplicationService(
    GymDbContext dbContext,
    IObjectStorage objectStorage,
    IMediaScanner scanner,
    MediaUploadConcurrencyGate uploadConcurrencyGate,
    IDataProtectionProvider dataProtectionProvider,
    IOptions<MediaStorageOptions> storageOptions,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService,
    IClock clock)
    : IMediaApplicationService
{
    private readonly ITimeLimitedDataProtector tokenProtector = dataProtectionProvider
        // Kept in lockstep with the payload version so a format change makes stale grants
        // undecryptable rather than merely unparseable.
        .CreateProtector("TB.Gym.Media.Access.v2")
        .ToTimeLimitedDataProtector();
    private readonly MediaStorageOptions storageOptions = storageOptions.Value;
    private readonly TimeSpan accessLifetime = TimeSpan.FromSeconds(storageOptions.Value.AccessLifetimeSeconds);

    public async Task<MediaCommandResult> UploadAsync(
        string title,
        string fileName,
        string contentType,
        Stream content,
        CancellationToken cancellationToken,
        MediaPurpose purpose = MediaPurpose.ExerciseMedia,
        Guid? clientProfileId = null)
    {
        string? objectKey = null;
        string? thumbnailKey = null;
        try
        {
            if (currentUser.UserId is not { } ownerUserId)
            {
                return new MediaCommandResult(MediaCommandStatus.NotFound);
            }

            using var uploadLease = uploadConcurrencyGate.TryEnter(tenantContext.TenantId);
            if (uploadLease is null)
            {
                return new MediaCommandResult(MediaCommandStatus.RateLimited);
            }

            // An unlocked pre-check, used only to bound the accepted stream and to refuse an upload
            // that is already hopeless. It is not the guarantee: the binding check runs under an
            // advisory lock once the real byte count is known.
            var remainingBytes = storageOptions.MaxWorkspaceStorageBytes
                - await MeasureWorkspaceBytesAsync(cancellationToken);
            if (remainingBytes <= 0)
            {
                return QuotaExceeded(
                    MediaQuotaCodes.WorkspaceStorageExceeded,
                    "The workspace media-storage allowance is full.");
            }

            // A progress photo can only ever be an image, so cap the accepted stream at the image
            // limit rather than streaming up to the video limit before rejecting it.
            var acceptedBytes = purpose == MediaPurpose.ProgressPhoto
                ? MediaUploadPolicy.MaximumImageBytes
                : MediaUploadPolicy.MaximumVideoBytes;
            objectKey = $"{tenantContext.TenantId:N}/{Guid.CreateVersion7():N}";
            var quotaBoundsTheStream = remainingBytes < acceptedBytes;
            StoredObject stored;
            try
            {
                stored = await objectStorage.PutAsync(
                    new ObjectUpload(
                        objectKey,
                        contentType,
                        content,
                        tenantContext.TenantId,
                        Math.Min(acceptedBytes, remainingBytes)),
                    cancellationToken);
            }
            catch (ArgumentOutOfRangeException) when (quotaBoundsTheStream)
            {
                // The stream was cut short by the remaining allowance rather than by the format's
                // own limit, so this is a full workspace and must say so. Reporting it as an
                // oversized file would blame the upload for a condition it did not cause. The
                // storage layer removes its own partial object, so nothing is left behind.
                objectKey = null;
                return QuotaExceeded(
                    MediaQuotaCodes.WorkspaceStorageExceeded,
                    "The workspace media-storage allowance is full.");
            }

            var validation = MediaUploadPolicy.Validate(fileName, contentType, stored.Length, stored.Signature);
            ProgressPhotoRendition? rendition = null;
            if (purpose == MediaPurpose.ProgressPhoto)
            {
                // Re-encode the pixels so EXIF/GPS never reaches permanent storage, and render the
                // thumbnail from those same sanitised pixels. The ingest stream stayed bounded
                // above, the original object is deleted, and both sets of stored bytes are
                // re-validated and scanned below, so no protection is skipped.
                rendition = await SanitizeProgressPhotoAsync(stored, validation, cancellationToken);
                if (rendition is null)
                {
                    await objectStorage.DeleteAsync(stored.ObjectKey, cancellationToken);
                    objectKey = null;
                    return Invalid("file", "The progress photo could not be processed as a valid image.");
                }

                await objectStorage.DeleteAsync(stored.ObjectKey, cancellationToken);
                stored = rendition.Image;
                objectKey = stored.ObjectKey;
                thumbnailKey = rendition.Thumbnail.ObjectKey;
            }

            var asset = MediaAsset.RegisterUpload(
                tenantContext.TenantId,
                ownerUserId,
                title,
                validation.Kind,
                Path.GetFileName(fileName),
                contentType,
                validation.VerifiedContentType,
                stored.Length,
                stored.Sha256,
                stored.ObjectKey,
                purpose);
            var scan = await scanner.ScanAsync(stored.ObjectKey, validation.VerifiedContentType, cancellationToken);
            if (rendition is not null && scan.IsAllowed)
            {
                // The thumbnail is bytes this workspace actually stores and serves, so the scanner
                // runs against it too. A rendition the scanner refuses fails the whole upload
                // closed rather than being quietly dropped, because the two share a source image.
                var thumbnailScan = await scanner.ScanAsync(
                    rendition.Thumbnail.ObjectKey,
                    MediaThumbnailPolicy.ContentType,
                    cancellationToken);
                if (!thumbnailScan.IsAllowed)
                {
                    scan = thumbnailScan;
                }
            }

            if (!scan.IsAllowed && thumbnailKey is not null)
            {
                await objectStorage.DeleteAsync(thumbnailKey, cancellationToken);
                thumbnailKey = null;
                rendition = null;
            }

            asset.RecordScan(scan);
            var derivative = rendition is null
                ? null
                : MediaAssetDerivative.RegisterThumbnail(
                    tenantContext.TenantId,
                    asset.Id,
                    rendition.Thumbnail.Length,
                    rendition.Thumbnail.Sha256,
                    rendition.Thumbnail.ObjectKey,
                    rendition.Width,
                    rendition.Height);

            var admitted = await AdmitWithinQuotaAsync(asset, derivative, clientProfileId, cancellationToken);
            if (admitted is not null)
            {
                // Rejected after the bytes were written, so remove them: the row that would have
                // accounted for them is never committed.
                if (thumbnailKey is not null)
                {
                    await objectStorage.DeleteAsync(thumbnailKey, cancellationToken);
                    thumbnailKey = null;
                }

                await objectStorage.DeleteAsync(objectKey, cancellationToken);
                objectKey = null;
                return admitted;
            }

            return Success(asset);
        }
        catch (ArgumentException exception)
        {
            if (objectKey is not null)
            {
                await objectStorage.DeleteAsync(objectKey, cancellationToken);
            }

            if (thumbnailKey is not null)
            {
                await objectStorage.DeleteAsync(thumbnailKey, cancellationToken);
            }

            return Invalid("file", exception.Message);
        }
    }

    public async Task<MediaCommandResult> RegisterExternalAsync(
        RegisterExternalMediaRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            if (currentUser.UserId is not { } ownerUserId)
            {
                return new MediaCommandResult(MediaCommandStatus.NotFound);
            }

            var asset = MediaAsset.RegisterExternalEmbed(
                tenantContext.TenantId,
                ownerUserId,
                request.Title,
                request.Provider,
                request.ExternalMediaId);
            dbContext.MediaAssets.Add(asset);
            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(asset);
        }
        catch (ArgumentException exception)
        {
            return Invalid("media", exception.Message);
        }
    }

    public async Task<MediaAssetPage> ListAsync(
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        // The coach media library is exercise content only; progress photos are reachable solely
        // through the progress endpoints for the client they depict.
        var query = dbContext.MediaAssets.AsNoTracking()
            .Where(item => item.Purpose == MediaPurpose.ExerciseMedia);
        var total = await query.CountAsync(cancellationToken);
        var items = (await query
            .OrderByDescending(item => item.CreatedAtUtc)
            .ThenByDescending(item => item.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken))
        .Select(ToView)
        .ToArray();
        return new MediaAssetPage(total, skip, take, items);
    }

    public async Task<MediaAccessResult> CreateAccessAsync(
        Guid assetId,
        CancellationToken cancellationToken)
    {
        var asset = await dbContext.MediaAssets.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == assetId, cancellationToken);
        if (asset is null)
        {
            return new MediaAccessResult(MediaAccessStatus.NotFound);
        }

        // A purged asset has no bytes left to grant. It reports NotFound rather than NotReady,
        // because "not ready yet" implies waiting will help and nothing will bring it back.
        if (asset.Status == MediaAssetStatus.Purged)
        {
            return new MediaAccessResult(MediaAccessStatus.NotFound);
        }

        if (asset.Status is not (MediaAssetStatus.Ready or MediaAssetStatus.Tombstoned))
        {
            return new MediaAccessResult(MediaAccessStatus.NotReady);
        }

        if (!await IsAuthorizedAsync(assetId, cancellationToken))
        {
            return new MediaAccessResult(MediaAccessStatus.Forbidden);
        }

        var expires = clock.UtcNow.Add(accessLifetime);
        var isUpload = asset.Source == MediaSource.Upload;
        var url = isUpload
            ? MediaAccessCookie.Path(asset.Id)
            : BuildExternalEmbedUrl(asset);
        var grant = isUpload
            ? tokenProtector.Protect(
                BuildTokenPayload(tenantContext.TenantId, asset.Id, currentUser.UserId!.Value, expires),
                expires)
            : null;
        // The thumbnail path is only advertised when the rendition exists. The single grant issued
        // above already covers it, so this adds no second authorization decision.
        var thumbnailUrl = isUpload && await HasThumbnailAsync(asset.Id, cancellationToken)
            ? MediaAccessCookie.ThumbnailPath(asset.Id)
            : null;
        return new MediaAccessResult(
            MediaAccessStatus.Success,
            new MediaAccessView(
                asset.Id,
                asset.Kind,
                asset.Source,
                asset.VerifiedContentType,
                url,
                expires,
                DownloadAllowed: false,
                thumbnailUrl),
            grant,
            accessLifetime);
    }

    public Task<MediaContentResult> OpenContentAsync(
        Guid assetId,
        string grant,
        CancellationToken cancellationToken) =>
        OpenAsync(assetId, grant, thumbnail: false, cancellationToken);

    public Task<MediaContentResult> OpenThumbnailAsync(
        Guid assetId,
        string grant,
        CancellationToken cancellationToken) =>
        OpenAsync(assetId, grant, thumbnail: true, cancellationToken);

    /// <summary>
    /// Resolves the bytes of one asset, or of its thumbnail rendition, behind a single grant and a
    /// single authorization decision.
    /// </summary>
    /// <remarks>
    /// The variant is chosen only after the grant has been unprotected and
    /// <see cref="IsAuthorizedAsync"/> has approved the parent asset, so a thumbnail cannot be
    /// reached by any caller who could not already reach the original. Keeping both variants in one
    /// method is deliberate: a second copy of this check is a second place for the rules to drift.
    /// </remarks>
    private async Task<MediaContentResult> OpenAsync(
        Guid assetId,
        string grant,
        bool thumbnail,
        CancellationToken cancellationToken)
    {
        try
        {
            var payload = tokenProtector.Unprotect(grant, out _);
            if (!TryParseTokenPayload(
                    payload,
                    out var grantTenantId,
                    out var grantAssetId,
                    out var grantUserId,
                    out var grantExpiresAtUtc) ||
                grantAssetId != assetId ||
                currentUser.UserId != grantUserId ||
                clock.UtcNow >= grantExpiresAtUtc)
            {
                return new MediaContentResult(MediaContentStatus.Forbidden);
            }

            tenantContext.SetTenant(grantTenantId);
            if (!await IsAuthorizedAsync(assetId, cancellationToken))
            {
                return new MediaContentResult(MediaContentStatus.Forbidden);
            }
        }
        catch (Exception exception) when (exception is CryptographicException or InvalidOperationException)
        {
            return new MediaContentResult(MediaContentStatus.Forbidden);
        }

        var asset = await dbContext.MediaAssets.AsNoTracking().SingleOrDefaultAsync(
            item =>
                item.Id == assetId &&
                (item.Status == MediaAssetStatus.Ready || item.Status == MediaAssetStatus.Tombstoned) &&
                item.Source == MediaSource.Upload,
            cancellationToken);
        if (asset?.StorageKey is null)
        {
            return new MediaContentResult(MediaContentStatus.NotFound);
        }

        var storageKey = asset.StorageKey;
        var contentType = asset.VerifiedContentType;
        var length = asset.Length;
        if (thumbnail)
        {
            var derivative = await dbContext.MediaAssetDerivatives.AsNoTracking().SingleOrDefaultAsync(
                item =>
                    item.MediaAssetId == assetId &&
                    item.Variant == MediaDerivativeVariant.Thumbnail,
                cancellationToken);
            // The row survives a purge as history with its storage key cleared, so a missing key is
            // as much a "gone" as a missing row. Both are NotFound; neither may reach storage with
            // a null key and surface as a 500.
            if (derivative?.StorageKey is null)
            {
                return new MediaContentResult(MediaContentStatus.NotFound);
            }

            storageKey = derivative.StorageKey;
            contentType = derivative.VerifiedContentType;
            length = derivative.Length;
        }

        try
        {
            var stream = await objectStorage.OpenReadAsync(storageKey, cancellationToken);
            return new MediaContentResult(
                MediaContentStatus.Success,
                stream,
                contentType,
                length);
        }
        catch (FileNotFoundException)
        {
            return new MediaContentResult(MediaContentStatus.NotFound);
        }
    }

    /// <summary>
    /// Bytes this workspace currently occupies on disk.
    /// </summary>
    /// <remarks>
    /// The original and every derivative count, because both are real objects. Tombstoned but
    /// not-yet-purged bytes count too: they are still physically stored, and pretending otherwise
    /// would let a workspace overshoot its allowance by everything awaiting deletion, which is the
    /// unsafe direction to be wrong in. Purged bytes are excluded, which is what finally releases
    /// the space. External embeds occupy nothing and are not counted.
    /// </remarks>
    private async Task<long> MeasureWorkspaceBytesAsync(CancellationToken cancellationToken)
    {
        var assetBytes = await dbContext.MediaAssets.AsNoTracking()
            .Where(item =>
                item.Source == MediaSource.Upload &&
                item.Status != MediaAssetStatus.Purged &&
                item.Length != null)
            .SumAsync(item => item.Length ?? 0L, cancellationToken);
        var derivativeBytes = await dbContext.MediaAssetDerivatives.AsNoTracking()
            .Where(item => item.PurgedAtUtc == null)
            .SumAsync(item => item.Length, cancellationToken);
        return assetBytes + derivativeBytes;
    }

    /// <summary>
    /// Bytes one client's progress photos occupy, under the same rules as the workspace total.
    /// </summary>
    private async Task<long> MeasureClientProgressPhotoBytesAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var assetBytes = await (
            from photo in dbContext.ProgressPhotos.AsNoTracking()
            join asset in dbContext.MediaAssets.AsNoTracking()
                on new { photo.TenantId, Id = photo.MediaAssetId }
                equals new { asset.TenantId, asset.Id }
            where photo.ClientProfileId == clientProfileId &&
                  asset.Status != MediaAssetStatus.Purged &&
                  asset.Length != null
            select asset.Length ?? 0L)
            .SumAsync(cancellationToken);
        var derivativeBytes = await (
            from photo in dbContext.ProgressPhotos.AsNoTracking()
            join derivative in dbContext.MediaAssetDerivatives.AsNoTracking()
                on new { photo.TenantId, Id = photo.MediaAssetId }
                equals new { derivative.TenantId, Id = derivative.MediaAssetId }
            where photo.ClientProfileId == clientProfileId && derivative.PurgedAtUtc == null
            select derivative.Length)
            .SumAsync(cancellationToken);
        return assetBytes + derivativeBytes;
    }

    /// <summary>
    /// Commits the asset only if it still fits, and returns a rejection when it does not.
    /// </summary>
    /// <remarks>
    /// A read-then-write check cannot hold: two uploads can both observe the same free space and
    /// both commit. The measurement, the decision, and the insert therefore happen inside one
    /// transaction holding a PostgreSQL advisory lock keyed on the tenant, so a second upload in
    /// the same workspace — in this process or in another replica — blocks until the first has
    /// either committed its bytes or rolled back. The lock is transaction-scoped, so it is released
    /// by commit or rollback and cannot be leaked by a crash. It is taken after the object is
    /// stored, so it is held for the decision rather than for the whole ingest.
    /// </remarks>
    private async Task<MediaCommandResult?> AdmitWithinQuotaAsync(
        MediaAsset asset,
        MediaAssetDerivative? derivative,
        Guid? clientProfileId,
        CancellationToken cancellationToken)
    {
        // The connection retries on transient failure, and that strategy owns transaction
        // boundaries: the whole check-and-commit has to be one retriable unit rather than a
        // hand-rolled transaction it cannot replay.
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await dbContext.Database.ExecuteSqlAsync(
                $"SELECT pg_advisory_xact_lock({QuotaLockKey(tenantContext.TenantId)})",
                cancellationToken);

            var incoming = (asset.Length ?? 0L) + (derivative?.Length ?? 0L);
            if (await MeasureWorkspaceBytesAsync(cancellationToken) + incoming
                > storageOptions.MaxWorkspaceStorageBytes)
            {
                await transaction.RollbackAsync(cancellationToken);
                return QuotaExceeded(
                    MediaQuotaCodes.WorkspaceStorageExceeded,
                    "The workspace media-storage allowance is full.");
            }

            if (clientProfileId is { } client &&
                await MeasureClientProgressPhotoBytesAsync(client, cancellationToken) + incoming
                > storageOptions.MaxClientProgressPhotoBytes)
            {
                await transaction.RollbackAsync(cancellationToken);
                return QuotaExceeded(
                    MediaQuotaCodes.ClientProgressPhotoStorageExceeded,
                    "This client's progress-photo allowance is full.");
            }

            dbContext.MediaAssets.Add(asset);
            if (derivative is not null)
            {
                dbContext.MediaAssetDerivatives.Add(derivative);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return null;
        });
    }

    /// <summary>
    /// Advisory locks share one 64-bit key space across the whole database, so the workspace key is
    /// mixed with a constant that namespaces this use and keeps it clear of any other advisory lock
    /// the application might take later. Locking the workspace also serialises every client inside
    /// it, so a single lock covers both allowances and no lock ordering can deadlock.
    /// </summary>
    private const long QuotaLockNamespace = 0x5B5_0000_0000_0000L;

    private static long QuotaLockKey(Guid tenantId) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0) ^ QuotaLockNamespace;

    private Task<bool> HasThumbnailAsync(Guid assetId, CancellationToken cancellationToken) =>
        dbContext.MediaAssetDerivatives.AsNoTracking().AnyAsync(
            item =>
                item.MediaAssetId == assetId &&
                item.Variant == MediaDerivativeVariant.Thumbnail,
            cancellationToken);

    public async Task<MediaCommandResult> DeleteAsync(
        Guid assetId,
        DeleteMediaRequest request,
        CancellationToken cancellationToken)
    {
        var asset = await dbContext.MediaAssets.SingleOrDefaultAsync(item => item.Id == assetId, cancellationToken);
        if (asset is null)
        {
            return new MediaCommandResult(MediaCommandStatus.NotFound);
        }

        try
        {
            dbContext.Entry(asset).Property(item => item.Version).OriginalValue = request.Version;
            var isHistoricallyReferenced =
                await dbContext.ExercisePrescriptionMediaSnapshots.AsNoTracking()
                    .AnyAsync(item => item.MediaAssetId == assetId, cancellationToken) ||
                await dbContext.WorkoutExerciseMediaSnapshots.AsNoTracking()
                    .AnyAsync(item => item.MediaAssetId == assetId, cancellationToken);
            asset.MarkTombstoned(clock.UtcNow, MediaRetentionPolicy.DeleteRetention, isHistoricallyReferenced);
            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(asset);
        }
        catch (DbUpdateConcurrencyException)
        {
            return new MediaCommandResult(MediaCommandStatus.Conflict);
        }
    }

    private async Task<bool> IsAuthorizedAsync(Guid assetId, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return false;
        }

        // Progress photos are health-adjacent client data, not shared library content. They must
        // never fall through to the exercise-media rules below, which grant every coach in the
        // workspace unconditional access and require a training entitlement the subject may not
        // have. Authorization is resolved from the owning client instead.
        var purpose = await dbContext.MediaAssets.AsNoTracking()
            .Where(item => item.Id == assetId)
            .Select(item => (MediaPurpose?)item.Purpose)
            .SingleOrDefaultAsync(cancellationToken);
        if (purpose is null)
        {
            return false;
        }

        if (purpose == MediaPurpose.ProgressPhoto)
        {
            return await IsProgressPhotoAuthorizedAsync(assetId, userId, cancellationToken);
        }

        var role = await dbContext.TenantMemberships.AsNoTracking()
            .Where(item =>
                item.TenantId == tenantContext.TenantId &&
                item.UserId == userId &&
                item.Status == MembershipStatus.Active)
            .Select(item => (TenantRole?)item.Role)
            .SingleOrDefaultAsync(cancellationToken);
        if (role is TenantRole.Owner or TenantRole.Coach)
        {
            return true;
        }

        if (role != TenantRole.Client)
        {
            return false;
        }

        var client = await dbContext.ClientProfiles.AsNoTracking()
            .Where(item => item.UserId == userId)
            .Select(item => new { item.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (client is null)
        {
            return false;
        }

        var access = await featureAccessService.EvaluateAsync(
            tenantContext.TenantId,
            client.Id,
            CoachingFeature.Training,
            cancellationToken);
        if (!access.IsAllowed)
        {
            return false;
        }

        var prescribedReference = await (
            from media in dbContext.ExercisePrescriptionMediaSnapshots.AsNoTracking()
            join prescription in dbContext.ExercisePrescriptions.AsNoTracking()
                on new { media.TenantId, Id = media.ExercisePrescriptionId }
                equals new { prescription.TenantId, prescription.Id }
            join session in dbContext.TrainingSessions.AsNoTracking()
                on new { prescription.TenantId, Id = prescription.TrainingSessionId }
                equals new { session.TenantId, session.Id }
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId }
                equals new { week.TenantId, week.Id }
            join mesocycle in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId }
                equals new { mesocycle.TenantId, mesocycle.Id }
            where media.MediaAssetId == assetId && mesocycle.ClientProfileId == client.Id
            select media.Id)
            .AnyAsync(cancellationToken);
        if (prescribedReference)
        {
            return true;
        }

        return await (
            from media in dbContext.WorkoutExerciseMediaSnapshots.AsNoTracking()
            join performance in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { media.TenantId, Id = media.WorkoutExercisePerformanceId }
                equals new { performance.TenantId, performance.Id }
            join execution in dbContext.WorkoutExecutions.AsNoTracking()
                on new { performance.TenantId, Id = performance.WorkoutExecutionId }
                equals new { execution.TenantId, execution.Id }
            where media.MediaAssetId == assetId && execution.ClientProfileId == client.Id
            select media.Id)
            .AnyAsync(cancellationToken);
    }

    /// <summary>
    /// Re-encodes a stored progress photo without metadata, renders its thumbnail from the same
    /// decoded pixels, and stores both under new keys. Returns null when the bytes cannot be
    /// decoded, or when either output no longer passes the same signature and size validation as
    /// the original, in which case nothing it stored is left behind.
    /// </summary>
    private async Task<ProgressPhotoRendition?> SanitizeProgressPhotoAsync(
        StoredObject stored,
        MediaFileValidation validation,
        CancellationToken cancellationToken)
    {
        SanitizedProgressPhoto? produced = null;
        StoredObject? rewritten = null;
        try
        {
            await using (var original = await objectStorage.OpenReadAsync(stored.ObjectKey, cancellationToken))
            {
                if (!ProgressPhotoSanitizer.TrySanitize(original, validation.VerifiedContentType, out produced) ||
                    produced is null)
                {
                    return null;
                }
            }

            rewritten = await StoreValidatedAsync(
                produced.Image,
                validation.VerifiedContentType,
                validation.MaximumBytes,
                cancellationToken);
            if (rewritten is null)
            {
                return null;
            }

            // The thumbnail is validated exactly like the sanitised original: it is only kept if
            // the bytes on disk still carry an allowed image signature within the image byte cap.
            var thumbnail = await StoreValidatedAsync(
                produced.Thumbnail,
                MediaThumbnailPolicy.ContentType,
                MediaUploadPolicy.MaximumImageBytes,
                cancellationToken);
            if (thumbnail is null)
            {
                // The sanitised original is reclaimed below rather than left behind without the
                // rendition this method promised alongside it.
                return null;
            }

            var result = new ProgressPhotoRendition(
                rewritten,
                thumbnail,
                produced.ThumbnailWidth,
                produced.ThumbnailHeight);
            rewritten = null;
            return result;
        }
        finally
        {
            if (rewritten is not null)
            {
                await objectStorage.DeleteAsync(rewritten.ObjectKey, cancellationToken);
            }

            if (produced is not null)
            {
                await produced.DisposeAsync();
            }
        }
    }

    /// <summary>
    /// Stores re-encoded bytes and keeps them only if the stored object still passes the upload
    /// policy for its declared image type; anything else is deleted rather than trusted.
    /// </summary>
    private async Task<StoredObject?> StoreValidatedAsync(
        Stream content,
        string verifiedContentType,
        long maximumBytes,
        CancellationToken cancellationToken)
    {
        content.Position = 0;
        var stored = await objectStorage.PutAsync(
            new ObjectUpload(
                $"{tenantContext.TenantId:N}/{Guid.CreateVersion7():N}",
                verifiedContentType,
                content,
                tenantContext.TenantId,
                maximumBytes),
            cancellationToken);
        try
        {
            MediaUploadPolicy.Validate(
                $"sanitized{ExtensionFor(verifiedContentType)}",
                verifiedContentType,
                stored.Length,
                stored.Signature);
            return stored;
        }
        catch (Exception exception) when (exception is ArgumentException or ArgumentOutOfRangeException)
        {
            await objectStorage.DeleteAsync(stored.ObjectKey, cancellationToken);
            return null;
        }
    }

    private static string ExtensionFor(string verifiedContentType) => verifiedContentType switch
    {
        "image/png" => ".png",
        _ => ".jpg",
    };

    /// <summary>
    /// A progress photo is readable by the client it depicts, and by an Owner/Coach of the same
    /// workspace only while the coaching relationship is not blocked. Removed photos stop being
    /// readable by the coach but remain readable by the client who owns them.
    /// </summary>
    private async Task<bool> IsProgressPhotoAuthorizedAsync(
        Guid assetId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var photo = await dbContext.ProgressPhotos.AsNoTracking()
            .Where(item => item.MediaAssetId == assetId)
            .Select(item => new { item.ClientProfileId, item.Status })
            .SingleOrDefaultAsync(cancellationToken);
        if (photo is null)
        {
            return false;
        }

        var subject = await dbContext.ClientProfiles.AsNoTracking()
            .Where(item => item.Id == photo.ClientProfileId)
            .Select(item => new { item.UserId, item.IsCoachBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        if (subject is null)
        {
            return false;
        }

        if (subject.UserId == userId)
        {
            return true;
        }

        if (photo.Status != ProgressPhotoStatus.Active || subject.IsCoachBlocked)
        {
            return false;
        }

        var role = await dbContext.TenantMemberships.AsNoTracking()
            .Where(item =>
                item.TenantId == tenantContext.TenantId &&
                item.UserId == userId &&
                item.Status == MembershipStatus.Active)
            .Select(item => (TenantRole?)item.Role)
            .SingleOrDefaultAsync(cancellationToken);
        return role is TenantRole.Owner or TenantRole.Coach;
    }

    // The expiry travels inside the protected payload so the business decision is made against
    // IClock and stays deterministic under a test clock. The data-protection envelope keeps its
    // own expiry as a defence-in-depth ceiling enforced on the provider's real clock; the two are
    // issued from the same instant and the payload value is floored to whole seconds, so the
    // payload check is always the tighter bound and can never extend a grant.
    private static string BuildTokenPayload(
        Guid tenantId,
        Guid assetId,
        Guid userId,
        DateTimeOffset expiresAtUtc) =>
        $"v2:{tenantId:N}:{assetId:N}:{userId:N}:{expiresAtUtc.ToUnixTimeSeconds()}";

    private static bool TryParseTokenPayload(
        string payload,
        out Guid tenantId,
        out Guid assetId,
        out Guid userId,
        out DateTimeOffset expiresAtUtc)
    {
        tenantId = Guid.Empty;
        assetId = Guid.Empty;
        userId = Guid.Empty;
        expiresAtUtc = DateTimeOffset.MinValue;
        var parts = payload.Split(':', StringSplitOptions.None);
        if (parts.Length != 5 ||
            parts[0] != "v2" ||
            !Guid.TryParseExact(parts[1], "N", out tenantId) ||
            !Guid.TryParseExact(parts[2], "N", out assetId) ||
            !Guid.TryParseExact(parts[3], "N", out userId) ||
            !long.TryParse(parts[4], NumberStyles.None, CultureInfo.InvariantCulture, out var expiresAtUnixSeconds) ||
            // Keep the parser total: FromUnixTimeSeconds throws outside this range, and an
            // escaping exception would surface as 500 instead of the intended denial.
            expiresAtUnixSeconds is < 0 or > 253402300799)
        {
            return false;
        }

        expiresAtUtc = DateTimeOffset.FromUnixTimeSeconds(expiresAtUnixSeconds);
        return true;
    }

    private static string BuildExternalEmbedUrl(MediaAsset asset) => asset.ExternalProvider switch
    {
        ExternalMediaProvider.YouTube => $"https://www.youtube-nocookie.com/embed/{asset.ExternalMediaId}",
        ExternalMediaProvider.Vimeo => $"https://player.vimeo.com/video/{asset.ExternalMediaId}",
        _ => throw new InvalidOperationException("The external media provider is unsupported."),
    };

    private static MediaAssetView ToView(MediaAsset item) =>
        new(
            item.Id,
            item.Title,
            item.Kind,
            item.Source,
            item.Status,
            item.VerifiedContentType,
            item.Length,
            item.ExternalProvider,
            item.ExternalMediaId,
            item.IsCoachProtected,
            item.CreatedAtUtc,
            item.Version);

    private static MediaCommandResult Success(MediaAsset item) =>
        new(MediaCommandStatus.Success, ToView(item));

    private static MediaCommandResult Invalid(string field, string message) =>
        new(
            MediaCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static MediaCommandResult QuotaExceeded(string code, string message) =>
        new(MediaCommandStatus.QuotaExceeded, Code: code, Message: message);

    /// <summary>
    /// The two objects a sanitised progress photo occupies in storage: the metadata-free original
    /// and its thumbnail rendition, plus the dimensions the rendition was scaled to.
    /// </summary>
    private sealed record ProgressPhotoRendition(
        StoredObject Image,
        StoredObject Thumbnail,
        int Width,
        int Height);
}
