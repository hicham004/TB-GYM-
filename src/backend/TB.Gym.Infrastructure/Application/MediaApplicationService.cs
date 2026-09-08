using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
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
    IClock clock,
    ILogger<MediaApplicationService> logger)
    : IMediaApplicationService
{
    /// <summary>
    /// A refused upload is worth recording, but only as a shape: the purpose and whether a scanner
    /// exists at all. The scanner's key, version, failure code, the object key and the file name
    /// are all deliberately absent, because a progress photo's very existence is client health data
    /// and a scanner's verdict names the content it inspected.
    /// </summary>
    private static readonly Action<ILogger, MediaPurpose, bool, Exception?> LogScanRefused =
        LoggerMessage.Define<MediaPurpose, bool>(
            LogLevel.Warning,
            new EventId(5502, "MediaScanRefused"),
            "A {Purpose} upload received a scanner refusal during ingestion. Scanner available: {ScannerAvailable}.");

    private static readonly Action<ILogger, MediaPurpose, Exception?> LogScanUnavailable =
        LoggerMessage.Define<MediaPurpose>(
            LogLevel.Warning,
            new EventId(5503, "MediaScanUnavailable"),
            "A {Purpose} upload could not be scanned because the scanner failed operationally.");

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
        var ingestObjects = new List<MediaIngestObject>();
        try
        {
            if (currentUser.UserId is not { } ownerUserId)
            {
                return new MediaCommandResult(MediaCommandStatus.NotFound);
            }

            // Non-development composition supplies an unavailable adapter until production object
            // storage is configured. Refuse before reserving a key or reading one upload byte.
            if (!objectStorage.IsAvailable)
            {
                return StorageUnavailable();
            }

            // Fail before accepting a byte. A deployment that already knows it cannot scan must not
            // create a storage object merely to delete it again and call that fail-closed.
            if (!scanner.IsAvailable)
            {
                return ScannerUnavailable();
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
            var quotaBoundsTheStream = remainingBytes < acceptedBytes;
            var objectKey = $"{tenantContext.TenantId:N}/{Guid.CreateVersion7():N}";
            var originalLocator = new StorageObjectLocator(
                tenantContext.TenantId,
                objectStorage.WriteLocation,
                objectKey);
            var originalReservation = await ReserveIngestObjectAsync(
                originalLocator,
                Math.Min(acceptedBytes, remainingBytes),
                purpose,
                clientProfileId,
                cancellationToken);
            ingestObjects.Add(originalReservation);

            StoredObject stored;
            try
            {
                var write = await objectStorage.PutAsync(
                    new ObjectUpload(
                        originalLocator,
                        contentType,
                        content,
                        Math.Min(acceptedBytes, remainingBytes)),
                    cancellationToken);
                if (write is not { Status: ObjectStorageOperationStatus.Success, StoredObject: { } written })
                {
                    await CleanupIngestObjectsAsync(ingestObjects);
                    return StorageUnavailable();
                }

                stored = written;
            }
            catch (ArgumentOutOfRangeException) when (quotaBoundsTheStream)
            {
                // The stream was cut short by the remaining allowance rather than by the format's
                // own limit, so this is a full workspace and must say so. Reporting it as an
                // oversized file would blame the upload for a condition it did not cause. The
                // storage layer removes its own partial object, so nothing is left behind.
                await CleanupIngestObjectsAsync(ingestObjects);
                return QuotaExceeded(
                    MediaQuotaCodes.WorkspaceStorageExceeded,
                    "The workspace media-storage allowance is full.");
            }

            originalReservation.ConfirmStored(stored.Length, stored.Sha256, clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);

            var validation = MediaUploadPolicy.Validate(fileName, contentType, stored.Length, stored.Signature);
            ProgressPhotoRendition? rendition = null;
            if (purpose == MediaPurpose.ProgressPhoto)
            {
                using var decodeLease = uploadConcurrencyGate.TryEnterProgressPhotoDecode();
                if (decodeLease is null)
                {
                    await CleanupIngestObjectsAsync(ingestObjects);
                    return new MediaCommandResult(MediaCommandStatus.RateLimited);
                }

                // Re-encode the pixels so EXIF/GPS never reaches permanent storage, and render the
                // thumbnail from those same sanitised pixels. The ingest stream stayed bounded
                // above, the original object is deleted, and both sets of stored bytes are
                // re-validated and scanned below, so no protection is skipped.
                rendition = await SanitizeProgressPhotoAsync(
                    stored,
                    validation,
                    clientProfileId,
                    ingestObjects,
                    cancellationToken);
                if (rendition is null)
                {
                    await CleanupIngestObjectsAsync(ingestObjects);
                    return Invalid("file", "The progress photo could not be processed as a valid image.");
                }

                if (!await CleanupIngestObjectAsync(originalReservation))
                {
                    await CleanupIngestObjectsAsync(ingestObjects);
                    return new MediaCommandResult(
                        MediaCommandStatus.Unavailable,
                        Message: "Media storage cleanup is pending. Try the upload again later.");
                }

                stored = rendition.Image.Stored;
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
                stored.Locator,
                purpose);
            MediaScanEvidence assetScanEvidence;
            MediaScanEvidence? thumbnailScanEvidence = null;
            try
            {
                var scan = await scanner.ScanAsync(
                    stored.Locator,
                    validation.VerifiedContentType,
                    cancellationToken);
                assetScanEvidence = MediaScanEvidence.Record(
                    stored.Locator,
                    stored.Sha256,
                    scan,
                    clock.UtcNow);
                var assetReservation = rendition?.Image.Reservation ?? originalReservation;
                assetReservation.RecordScanEvidence(assetScanEvidence);

                if (rendition is not null && assetScanEvidence.IsAllowed)
                {
                    // The thumbnail is bytes this workspace actually stores and serves, so the
                    // scanner runs against it too. A refusal of the original already rejects the
                    // complete upload, so it must not invoke a second scan for bytes that will
                    // only be cleaned up.
                    var thumbnailScan = await scanner.ScanAsync(
                        rendition.Thumbnail.Stored.Locator,
                        MediaThumbnailPolicy.ContentType,
                        cancellationToken);
                    thumbnailScanEvidence = MediaScanEvidence.Record(
                        rendition.Thumbnail.Stored.Locator,
                        rendition.Thumbnail.Stored.Sha256,
                        thumbnailScan,
                        clock.UtcNow);
                    rendition.Thumbnail.Reservation.RecordScanEvidence(thumbnailScanEvidence);
                }

                // Evidence is durable before any refusal cleanup begins. If deletion then fails,
                // the surviving ingest row still says exactly which stored bytes were inspected.
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                await CleanupIngestObjectsAsync(ingestObjects);
                LogScanUnavailable(logger, purpose, null);
                return ScannerUnavailable();
            }
            catch (Exception exception) when (IsScannerOperationalFailure(exception))
            {
                await CleanupIngestObjectsAsync(ingestObjects);
                LogScanUnavailable(logger, purpose, null);
                return ScannerUnavailable();
            }

            if (!assetScanEvidence.IsAllowed || thumbnailScanEvidence is { IsAllowed: false })
            {
                // The upload fails, and it fails as an upload rather than as a stored asset in a
                // dead state. Reporting success for bytes the scanner refused is what let a caller
                // build a record on top of an unusable asset — a progress photo that occupied its
                // date/pose slot for ever without a readable image behind it.
                //
                // Every accepted object is independently deleted or left as immediately due durable
                // cleanup state. Partial success cannot make the remaining key undiscoverable.
                await CleanupIngestObjectsAsync(ingestObjects);
                LogScanRefused(logger, purpose, scanner.IsAvailable, null);
                return Invalid(
                    "file",
                    "This file was rejected. Any accepted bytes have been deleted or scheduled for secure cleanup.");
            }

            try
            {
                asset.RecordScan(assetScanEvidence);
            }
            catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
            {
                // A malformed provider result is an operational scanner failure, not evidence that
                // the caller supplied an invalid file.
                await CleanupIngestObjectsAsync(ingestObjects);
                LogScanUnavailable(logger, purpose, null);
                return ScannerUnavailable();
            }
            var derivative = rendition is null
                ? null
                : MediaAssetDerivative.RegisterThumbnail(
                    tenantContext.TenantId,
                    asset.Id,
                    rendition.Thumbnail.Stored.Length,
                    rendition.Thumbnail.Stored.Sha256,
                    rendition.Thumbnail.Stored.Locator,
                    thumbnailScanEvidence!,
                    rendition.Width,
                    rendition.Height);

            var attachmentReservations = rendition is null
                ? new[] { originalReservation }
                : new[] { rendition.Image.Reservation, rendition.Thumbnail.Reservation };

            var admitted = await AdmitWithinQuotaAsync(
                asset,
                derivative,
                clientProfileId,
                attachmentReservations,
                cancellationToken);
            if (admitted is not null)
            {
                await CleanupIngestObjectsAsync(ingestObjects);
                return admitted;
            }

            return Success(asset);
        }
        catch (OperationCanceledException)
        {
            await CleanupIngestObjectsAsync(ingestObjects);
            throw;
        }
        catch (ArgumentException exception)
        {
            await CleanupIngestObjectsAsync(ingestObjects);
            return Invalid("file", exception.Message);
        }
        catch (Exception exception) when (IsStorageOperationalFailure(exception))
        {
            await CleanupIngestObjectsAsync(ingestObjects);
            return new MediaCommandResult(
                MediaCommandStatus.Unavailable,
                Message: "Media storage is temporarily unavailable. Try again later.");
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
        //
        // Refused bytes are the same answer for the same reason. A refusal is terminal, and the
        // refused original still has to travel Rejected -> Tombstoned -> Purged so its bytes are
        // reclaimed — but Tombstoned is a readable state for everything else, so the outcome, not
        // the status, is what decides here.
        if (asset.Status == MediaAssetStatus.Purged ||
            asset.ScanOutcome == MediaScanOutcome.Refused)
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

    /// <summary>
    /// Grants several assets at once, each through the same decision the single-asset route makes.
    /// </summary>
    /// <remarks>
    /// Nothing here is a shortcut around authorization: the loop calls <see cref="CreateAccessAsync"/>
    /// per asset, so a caller gets exactly the grants they would have got one request at a time. The
    /// only thing this removes is the round trip. Refused, unknown and not-yet-ready assets are
    /// omitted without distinction, so a batch reveals no more than the caller already knew.
    /// </remarks>
    public async Task<MediaAccessBatchResult> CreateAccessBatchAsync(
        IReadOnlyList<Guid> assetIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(assetIds);
        var distinct = assetIds.Distinct().ToArray();
        if (distinct.Length is 0 || distinct.Length > MediaAccessBatchPolicy.MaximumAssets)
        {
            return new MediaAccessBatchResult(MediaAccessBatchStatus.Invalid, []);
        }

        var grants = new List<MediaAccessGrant>(distinct.Length);
        foreach (var assetId in distinct)
        {
            var result = await CreateAccessAsync(assetId, cancellationToken);
            if (result is { Status: MediaAccessStatus.Success, Access: { } access, BrowserGrant: { } grant })
            {
                grants.Add(new MediaAccessGrant(assetId, access, grant));
            }
        }

        return new MediaAccessBatchResult(MediaAccessBatchStatus.Success, grants, accessLifetime);
    }

    public Task<MediaContentResult> OpenContentAsync(
        Guid assetId,
        string grant,
        RequestedByteRange? range,
        CancellationToken cancellationToken) =>
        OpenAsync(assetId, grant, thumbnail: false, range, cancellationToken);

    public Task<MediaContentResult> OpenThumbnailAsync(
        Guid assetId,
        string grant,
        RequestedByteRange? range,
        CancellationToken cancellationToken) =>
        OpenAsync(assetId, grant, thumbnail: true, range, cancellationToken);

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
        RequestedByteRange? requestedRange,
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

        // Stated as the positive case rather than "not refused", so a legacy row that carries no
        // outcome at all stays readable while a refused one never is, without depending on how a
        // provider translates a comparison against NULL.
        var asset = await dbContext.MediaAssets.AsNoTracking().SingleOrDefaultAsync(
            item =>
                item.Id == assetId &&
                (item.Status == MediaAssetStatus.Ready || item.Status == MediaAssetStatus.Tombstoned) &&
                (item.ScanOutcome == null || item.ScanOutcome == MediaScanOutcome.Allowed) &&
                item.Source == MediaSource.Upload,
            cancellationToken);
        if (asset?.StorageKey is null || asset.StorageLocation is null)
        {
            return new MediaContentResult(MediaContentStatus.NotFound);
        }

        var storageLocation = asset.StorageLocation;
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
            if (derivative?.StorageKey is null || string.IsNullOrWhiteSpace(derivative.StorageLocation))
            {
                return new MediaContentResult(MediaContentStatus.NotFound);
            }

            storageLocation = derivative.StorageLocation;
            storageKey = derivative.StorageKey;
            contentType = derivative.VerifiedContentType;
            length = derivative.Length;
        }

        if (contentType is null || length is not { } objectLength || objectLength <= 0)
        {
            return new MediaContentResult(MediaContentStatus.NotFound);
        }

        ObjectByteRange? range = null;
        if (requestedRange is not null && !requestedRange.TryResolve(objectLength, out range))
        {
            return new MediaContentResult(
                MediaContentStatus.RangeNotSatisfiable,
                ObjectLength: objectLength);
        }

        var locator = new StorageObjectLocator(
            tenantContext.TenantId,
            storageLocation,
            storageKey);
        var read = await objectStorage.ReadAsync(
            new ObjectReadRequest(locator, contentType, range),
            cancellationToken);
        return read switch
        {
            { Status: ObjectStorageOperationStatus.Success, Content: { } content, Metadata: { } metadata } =>
                new MediaContentResult(
                    MediaContentStatus.Success,
                    content,
                    metadata.ContentType,
                    metadata.ObjectLength,
                    metadata.ContentLength,
                    metadata.Range),
            { Status: ObjectStorageOperationStatus.RangeNotSatisfiable, Metadata: { } metadata } =>
                new MediaContentResult(
                    MediaContentStatus.RangeNotSatisfiable,
                    ObjectLength: metadata.ObjectLength),
            { Status: ObjectStorageOperationStatus.NotFound } =>
                new MediaContentResult(MediaContentStatus.NotFound),
            _ => new MediaContentResult(MediaContentStatus.Unavailable),
        };
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
    private async Task<long> MeasureWorkspaceBytesAsync(
        CancellationToken cancellationToken,
        IReadOnlyCollection<Guid>? excludedIngestIds = null,
        IngestAdmissionPriority? admissionPriority = null)
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
        var ingestBytes = await MeasureIngestBytesAsync(
            dbContext.MediaIngestObjects.AsNoTracking()
                .Where(item => item.Status != MediaIngestObjectStatus.Purged),
            excludedIngestIds,
            admissionPriority,
            cancellationToken);
        return assetBytes + derivativeBytes + ingestBytes;
    }

    /// <summary>
    /// Bytes one client's progress photos occupy, under the same rules as the workspace total.
    /// </summary>
    private async Task<long> MeasureClientProgressPhotoBytesAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken,
        IReadOnlyCollection<Guid>? excludedIngestIds = null,
        IngestAdmissionPriority? admissionPriority = null)
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
        var ingestBytes = await MeasureIngestBytesAsync(
            dbContext.MediaIngestObjects.AsNoTracking()
                .Where(item =>
                    item.ClientProfileId == clientProfileId &&
                    item.Status != MediaIngestObjectStatus.Purged),
            excludedIngestIds,
            admissionPriority,
            cancellationToken);
        return assetBytes + derivativeBytes + ingestBytes;
    }

    /// <summary>
    /// Measures all durable reservations normally. During the serialized admission decision it
    /// measures only reservations ahead of the candidate in a stable queue.
    /// </summary>
    /// <remarks>
    /// Counting every peer reservation for every simultaneous candidate creates symmetric
    /// rejection: each upload can fit alone, but both see the other's bytes and neither wins. The
    /// advisory lock still serializes commits, so an earlier queued candidate may ignore later
    /// reservations; every later candidate then observes the winner as committed asset bytes. This
    /// preserves the hard allowance while giving a deterministic winner. Outside admission, every
    /// non-purged reservation continues to count.
    /// </remarks>
    private static async Task<long> MeasureIngestBytesAsync(
        IQueryable<MediaIngestObject> ingestQuery,
        IReadOnlyCollection<Guid>? excludedIngestIds,
        IngestAdmissionPriority? admissionPriority,
        CancellationToken cancellationToken)
    {
        if (excludedIngestIds is { Count: > 0 })
        {
            ingestQuery = ingestQuery.Where(item => !excludedIngestIds.Contains(item.Id));
        }

        if (admissionPriority is null)
        {
            return await ingestQuery.SumAsync(item => item.AccountedBytes, cancellationToken);
        }

        var earlierBytes = await ingestQuery
            .Where(item => item.CreatedAtUtc < admissionPriority.CreatedAtUtc)
            .SumAsync(item => item.AccountedBytes, cancellationToken);
        var sameInstant = await ingestQuery
            .Where(item => item.CreatedAtUtc == admissionPriority.CreatedAtUtc)
            .Select(item => new IngestUsage(item.Id, item.AccountedBytes))
            .ToArrayAsync(cancellationToken);
        return earlierBytes + sameInstant
            .Where(item => item.Id.CompareTo(admissionPriority.Id) < 0)
            .Sum(item => item.AccountedBytes);
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
        IReadOnlyCollection<MediaIngestObject> attachmentReservations,
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
            var attachmentIds = attachmentReservations.Select(item => item.Id).ToArray();
            var firstReservation = attachmentReservations
                .OrderBy(item => item.CreatedAtUtc)
                .ThenBy(item => item.Id)
                .First();
            var admissionPriority = new IngestAdmissionPriority(
                firstReservation.CreatedAtUtc,
                firstReservation.Id);
            if (await MeasureWorkspaceBytesAsync(
                    cancellationToken,
                    attachmentIds,
                    admissionPriority) + incoming
                > storageOptions.MaxWorkspaceStorageBytes)
            {
                await transaction.RollbackAsync(cancellationToken);
                return QuotaExceeded(
                    MediaQuotaCodes.WorkspaceStorageExceeded,
                    "The workspace media-storage allowance is full.");
            }

            if (clientProfileId is { } client &&
                await MeasureClientProgressPhotoBytesAsync(
                    client,
                    cancellationToken,
                    attachmentIds,
                    admissionPriority) + incoming
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

            // Once this transaction commits, the keys belong to the asset and derivative. Removing
            // the ingest reservations in that same commit avoids both double accounting and a gap
            // in which neither durable record owns them.
            dbContext.MediaIngestObjects.RemoveRange(attachmentReservations);

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

        var role = await ActiveMembershipRoleAsync(userId, cancellationToken);
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
        Guid? clientProfileId,
        ICollection<MediaIngestObject> ingestObjects,
        CancellationToken cancellationToken)
    {
        SanitizedProgressPhoto? produced = null;
        IngestStoredObject? rewritten = null;
        try
        {
            var read = await objectStorage.ReadAsync(
                new ObjectReadRequest(stored.Locator, validation.VerifiedContentType),
                cancellationToken);
            if (read is not { Status: ObjectStorageOperationStatus.Success, Content: { } original })
            {
                throw new MediaStorageException(read.FailureCode ?? "storage_unavailable");
            }

            await using (original)
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
                MediaPurpose.ProgressPhoto,
                clientProfileId,
                ingestObjects,
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
                MediaPurpose.ProgressPhoto,
                clientProfileId,
                ingestObjects,
                cancellationToken);
            if (thumbnail is null)
            {
                await CleanupIngestObjectAsync(rewritten.Reservation);
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
    private async Task<IngestStoredObject?> StoreValidatedAsync(
        Stream content,
        string verifiedContentType,
        long maximumBytes,
        MediaPurpose purpose,
        Guid? clientProfileId,
        ICollection<MediaIngestObject> ingestObjects,
        CancellationToken cancellationToken)
    {
        content.Position = 0;
        var objectKey = $"{tenantContext.TenantId:N}/{Guid.CreateVersion7():N}";
        var locator = new StorageObjectLocator(
            tenantContext.TenantId,
            objectStorage.WriteLocation,
            objectKey);
        var reservation = await ReserveIngestObjectAsync(
            locator,
            Math.Min(maximumBytes, content.Length),
            purpose,
            clientProfileId,
            cancellationToken);
        ingestObjects.Add(reservation);
        var write = await objectStorage.PutAsync(
            new ObjectUpload(
                locator,
                verifiedContentType,
                content,
                maximumBytes),
            cancellationToken);
        if (write is not { Status: ObjectStorageOperationStatus.Success, StoredObject: { } stored })
        {
            throw new MediaStorageException(write.FailureCode ?? "storage_unavailable");
        }

        reservation.ConfirmStored(stored.Length, stored.Sha256, clock.UtcNow);
        await dbContext.SaveChangesAsync(cancellationToken);
        try
        {
            MediaUploadPolicy.Validate(
                $"sanitized{ExtensionFor(verifiedContentType)}",
                verifiedContentType,
                stored.Length,
                stored.Signature);
            return new IngestStoredObject(stored, reservation);
        }
        catch (Exception exception) when (exception is ArgumentException or ArgumentOutOfRangeException)
        {
            await CleanupIngestObjectAsync(reservation);
            return null;
        }
    }

    private async Task<MediaIngestObject> ReserveIngestObjectAsync(
        StorageObjectLocator locator,
        long reservedBytes,
        MediaPurpose purpose,
        Guid? clientProfileId,
        CancellationToken cancellationToken)
    {
        var reservation = MediaIngestObject.Reserve(
            tenantContext.TenantId,
            locator,
            reservedBytes,
            purpose,
            clientProfileId,
            clock.UtcNow);
        dbContext.MediaIngestObjects.Add(reservation);
        await dbContext.SaveChangesAsync(cancellationToken);
        return reservation;
    }

    private async Task<bool> CleanupIngestObjectsAsync(IEnumerable<MediaIngestObject> objects)
    {
        var allPurged = true;
        foreach (var ingestObject in objects.DistinctBy(item => item.Id))
        {
            allPurged &= await CleanupIngestObjectAsync(ingestObject);
        }

        return allPurged;
    }

    /// <summary>
    /// Makes cleanup durable before touching storage, then attempts deletion with an internal,
    /// bounded token. Storage failure leaves the key immediately due for the reconciliation sweep.
    /// </summary>
    private async Task<bool> CleanupIngestObjectAsync(MediaIngestObject ingestObject)
    {
        if (ingestObject.Status == MediaIngestObjectStatus.Purged)
        {
            return true;
        }

        // One request makes one immediate attempt per object. A failed attempt is already durable
        // and immediately due; retrying it again in a later compensation branch of the same request
        // would turn a persistent provider outage into repeated work and obscure the failure state
        // the reconciliation sweep is responsible for.
        if (ingestObject.Status == MediaIngestObjectStatus.CleanupPending &&
            ingestObject.LastPurgeAttemptAtUtc is not null)
        {
            return false;
        }

        var now = clock.UtcNow;
        // The sweep must not claim the same row while this request is deleting it. Its lease is a
        // little longer than the storage timeout so the timeout handler can make it immediately
        // due; if the process dies instead, reconciliation takes over after this short bound.
        var cleanupTimeout = TimeSpan.FromSeconds(storageOptions.IngestCleanupAttemptTimeoutSeconds);
        var claimToken = Guid.NewGuid();
        ingestObject.ClaimImmediatePurge(
            now,
            cleanupTimeout.Add(TimeSpan.FromSeconds(5)),
            claimToken);
        await dbContext.SaveChangesAsync(CancellationToken.None);

        try
        {
            using var cleanupCancellation = new CancellationTokenSource(cleanupTimeout);
            if (ingestObject.StorageKey is not null)
            {
                var deletion = await objectStorage.DeleteAsync(
                    ingestObject.GetStorageLocator(),
                    cleanupCancellation.Token);
                if (deletion.Status != ObjectStorageOperationStatus.Success)
                {
                    ingestObject.RecordPurgeFailure(
                        clock.UtcNow,
                        claimToken,
                        deletion.FailureCode ?? "storage_unavailable");
                    await dbContext.SaveChangesAsync(CancellationToken.None);
                    return false;
                }
            }

            ingestObject.CompletePurge(clock.UtcNow, claimToken);
            await dbContext.SaveChangesAsync(CancellationToken.None);
            return true;
        }
        catch (Exception exception) when (IsStorageCleanupFailure(exception))
        {
            ingestObject.RecordPurgeFailure(
                clock.UtcNow,
                claimToken,
                StorageFailureCode(exception));
            await dbContext.SaveChangesAsync(CancellationToken.None);
            return false;
        }
    }

    /// <summary>
    /// Everything that means "the scanner did not produce a usable verdict", as opposed to "the
    /// scanner inspected the file and refused it".
    /// </summary>
    /// <remarks>
    /// <see cref="ArgumentException"/> belongs here because binding a verdict to the stored bytes
    /// validates the scanner's own metadata — its key, version, failure code and scan instant — and
    /// rejects unusable values by throwing it. That is the provider failing, not the caller
    /// supplying a bad file, and reporting it as a rejected upload would blame a file the scanner
    /// never faulted. <c>400</c> stays reserved for an actual refusal and for genuine caller
    /// validation, which happens outside the scan block.
    /// </remarks>
    private static bool IsScannerOperationalFailure(Exception exception) => exception is
        IOException or
        TimeoutException or
        HttpRequestException or
        InvalidOperationException or
        ArgumentException;

    private static bool IsStorageOperationalFailure(Exception exception) => exception is
        MediaStorageException or
        IOException or
        TimeoutException or
        UnauthorizedAccessException;

    private static bool IsStorageCleanupFailure(Exception exception) =>
        exception is OperationCanceledException or ArgumentException ||
        IsStorageOperationalFailure(exception);

    private static string StorageFailureCode(Exception exception) => exception switch
    {
        OperationCanceledException => "storage_timeout",
        UnauthorizedAccessException => "storage_access_denied",
        IOException => "storage_io_error",
        ArgumentException => "storage_key_invalid",
        MediaStorageException storage => storage.FailureCode,
        _ => "storage_unavailable",
    };

    private static MediaCommandResult ScannerUnavailable() =>
        new(
            MediaCommandStatus.Unavailable,
            Message: "Media uploads are unavailable. Try again later.");

    private static MediaCommandResult StorageUnavailable() =>
        new(
            MediaCommandStatus.Unavailable,
            Message: "Media storage is unavailable. Try again later.");

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
    /// <remarks>
    /// Active membership of the asset's workspace is required first, of every caller including the
    /// subject of the photo. Authentication plus an unexpired grant is not enough: the grant is
    /// minted once and may be configured for as long as four hours, so a subject whose membership
    /// was deactivated or removed in the meantime would otherwise keep reading their own images from
    /// that workspace until it expired. Checking here, on every original and every thumbnail
    /// request, is what makes removal take effect immediately instead of eventually.
    /// </remarks>
    private async Task<bool> IsProgressPhotoAuthorizedAsync(
        Guid assetId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var role = await ActiveMembershipRoleAsync(userId, cancellationToken);
        if (role is null)
        {
            return false;
        }

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

        return role is TenantRole.Owner or TenantRole.Coach;
    }

    /// <summary>
    /// The caller's role in the currently bound tenant, or null when they hold no active membership
    /// of it. Every media authorization decision starts here, so a removed or deactivated member is
    /// refused by the same statement whatever kind of asset they are asking for.
    /// </summary>
    private async Task<TenantRole?> ActiveMembershipRoleAsync(
        Guid userId,
        CancellationToken cancellationToken) =>
        await dbContext.TenantMemberships.AsNoTracking()
            .Where(item =>
                item.TenantId == tenantContext.TenantId &&
                item.UserId == userId &&
                item.Status == MembershipStatus.Active)
            .Select(item => (TenantRole?)item.Role)
            .SingleOrDefaultAsync(cancellationToken);

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
        IngestStoredObject Image,
        IngestStoredObject Thumbnail,
        int Width,
        int Height);

    private sealed record IngestStoredObject(
        StoredObject Stored,
        MediaIngestObject Reservation);

    private sealed record IngestAdmissionPriority(DateTimeOffset CreatedAtUtc, Guid Id);

    private sealed record IngestUsage(Guid Id, long AccountedBytes);

    private sealed class MediaStorageException(string failureCode) : Exception
    {
        public string FailureCode { get; } = failureCode;
    }
}
