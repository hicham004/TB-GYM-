using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
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
    private static readonly TimeSpan DeleteRetention = TimeSpan.FromDays(30);
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
        CancellationToken cancellationToken)
    {
        string? objectKey = null;
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

            var usedBytes = await dbContext.MediaAssets.AsNoTracking()
                .Where(item => item.Source == MediaSource.Upload && item.Length != null)
                .SumAsync(item => item.Length ?? 0L, cancellationToken);
            var remainingBytes = storageOptions.MaxWorkspaceStorageBytes - usedBytes;
            if (remainingBytes <= 0)
            {
                return Invalid("quota", "The workspace media-storage quota has been reached.");
            }

            objectKey = $"{tenantContext.TenantId:N}/{Guid.CreateVersion7():N}";
            var stored = await objectStorage.PutAsync(
                new ObjectUpload(
                    objectKey,
                    contentType,
                    content,
                    tenantContext.TenantId,
                    Math.Min(MediaUploadPolicy.MaximumVideoBytes, remainingBytes)),
                cancellationToken);

            var validation = MediaUploadPolicy.Validate(fileName, contentType, stored.Length, stored.Signature);
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
                stored.ObjectKey);
            var scan = await scanner.ScanAsync(stored.ObjectKey, validation.VerifiedContentType, cancellationToken);
            asset.RecordScan(scan);
            dbContext.MediaAssets.Add(asset);
            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(asset);
        }
        catch (ArgumentException exception)
        {
            if (objectKey is not null)
            {
                await objectStorage.DeleteAsync(objectKey, cancellationToken);
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
        var query = dbContext.MediaAssets.AsNoTracking();
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
        return new MediaAccessResult(
            MediaAccessStatus.Success,
            new MediaAccessView(
                asset.Id,
                asset.Kind,
                asset.Source,
                asset.VerifiedContentType,
                url,
                expires,
                DownloadAllowed: false),
            grant,
            accessLifetime);
    }

    public async Task<MediaContentResult> OpenContentAsync(
        Guid assetId,
        string grant,
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

        try
        {
            var stream = await objectStorage.OpenReadAsync(asset.StorageKey, cancellationToken);
            return new MediaContentResult(
                MediaContentStatus.Success,
                stream,
                asset.VerifiedContentType,
                asset.Length);
        }
        catch (FileNotFoundException)
        {
            return new MediaContentResult(MediaContentStatus.NotFound);
        }
    }

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
            asset.MarkTombstoned(clock.UtcNow, DeleteRetention, isHistoricallyReferenced);
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
}
