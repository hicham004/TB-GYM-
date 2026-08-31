namespace TB.Gym.Modules.Media;

public interface IMediaApplicationService
{
    /// <summary>
    /// Streams and stores one upload. <paramref name="clientProfileId"/> is required for a progress
    /// photo, because that purpose is additionally bounded by a per-client allowance.
    /// </summary>
    Task<MediaCommandResult> UploadAsync(
        string title,
        string fileName,
        string contentType,
        Stream content,
        CancellationToken cancellationToken,
        MediaPurpose purpose = MediaPurpose.ExerciseMedia,
        Guid? clientProfileId = null);

    Task<MediaCommandResult> RegisterExternalAsync(
        RegisterExternalMediaRequest request,
        CancellationToken cancellationToken);

    Task<MediaAssetPage> ListAsync(int skip, int take, CancellationToken cancellationToken);

    Task<MediaAccessResult> CreateAccessAsync(Guid assetId, CancellationToken cancellationToken);

    /// <summary>
    /// Grants access to several assets in one authorized call, each still bound to its own asset
    /// and its own content path.
    /// </summary>
    /// <remarks>
    /// A screen that displays many protected thumbnails would otherwise issue one grant request per
    /// tile, which is unbounded in the number of assets shown. This is bounded instead: the request
    /// carries at most <see cref="MediaAccessBatchPolicy.MaximumAssets"/> ids and each one is
    /// authorized separately by exactly the same decision as the single-asset route. An asset the
    /// caller may not read is omitted from the result rather than reported, so the batch cannot be
    /// used to probe for assets.
    /// </remarks>
    Task<MediaAccessBatchResult> CreateAccessBatchAsync(
        IReadOnlyList<Guid> assetIds,
        CancellationToken cancellationToken);

    Task<MediaContentResult> OpenContentAsync(
        Guid assetId,
        string grant,
        CancellationToken cancellationToken);

    /// <summary>
    /// Serves the thumbnail rendition of <paramref name="assetId"/> under the same grant and the
    /// same authorization as the asset itself.
    /// </summary>
    Task<MediaContentResult> OpenThumbnailAsync(
        Guid assetId,
        string grant,
        CancellationToken cancellationToken);

    Task<MediaCommandResult> DeleteAsync(
        Guid assetId,
        DeleteMediaRequest request,
        CancellationToken cancellationToken);
}

public sealed record RegisterExternalMediaRequest(
    string Title,
    ExternalMediaProvider Provider,
    string ExternalMediaId);

public sealed record DeleteMediaRequest(uint Version);

public sealed record MediaAssetView(
    Guid Id,
    string Title,
    MediaKind Kind,
    MediaSource Source,
    MediaAssetStatus Status,
    string? ContentType,
    long? Length,
    ExternalMediaProvider? ExternalProvider,
    string? ExternalMediaId,
    bool IsCoachProtected,
    DateTimeOffset CreatedAtUtc,
    uint Version);

public sealed record MediaAssetPage(
    int Total,
    int Skip,
    int Take,
    IReadOnlyList<MediaAssetView> Items);

public sealed record MediaAccessView(
    Guid AssetId,
    MediaKind Kind,
    MediaSource Source,
    string? ContentType,
    string Url,
    DateTimeOffset ExpiresAtUtc,
    bool DownloadAllowed,
    // Null when the asset has no thumbnail rendition, which is every external embed and every
    // asset that is not a progress photo. The same grant covers it, so a viewer that wants a
    // preview never asks for a second one.
    string? ThumbnailUrl = null);

public sealed record MediaContentResult(
    MediaContentStatus Status,
    Stream? Content = null,
    string? ContentType = null,
    long? Length = null);

public sealed record MediaAccessResult(
    MediaAccessStatus Status,
    MediaAccessView? Access = null,
    string? BrowserGrant = null,
    // Carried so the cookie can use Max-Age. An absolute Expires is evaluated against the
    // browser's clock, so a skewed client would discard a grant the server still honours.
    TimeSpan? GrantLifetime = null);

/// <summary>
/// The ids a caller may present to <see cref="IMediaApplicationService.CreateAccessBatchAsync"/>.
/// </summary>
public sealed record MediaAccessBatchRequest(IReadOnlyList<Guid> AssetIds);

/// <summary>
/// One granted asset. <see cref="BrowserGrant"/> becomes a cookie scoped to that asset's own
/// content path, so the batch issues one path-scoped grant per asset rather than one broad one.
/// </summary>
public sealed record MediaAccessGrant(
    Guid AssetId,
    MediaAccessView Access,
    string BrowserGrant);

/// <summary>
/// What the batch route returns: the access views for the assets that were granted. The grants
/// themselves travel as one path-scoped cookie per asset and never appear in the body.
/// </summary>
public sealed record MediaAccessBatchView(IReadOnlyList<MediaAccessView> Items);

/// <summary>
/// Only the assets the caller may read. An id that was unknown, not ready, or refused is simply
/// absent, which is the same non-disclosure the single-asset route applies.
/// </summary>
public sealed record MediaAccessBatchResult(
    MediaAccessBatchStatus Status,
    IReadOnlyList<MediaAccessGrant> Grants,
    TimeSpan? GrantLifetime = null);

public enum MediaAccessBatchStatus
{
    Success = 1,

    /// <summary>More ids than the policy accepts, or none at all.</summary>
    Invalid = 2,
}

/// <summary>
/// How many assets one batch grant may cover. The progress dashboard's bounded photo preview is
/// the caller this was sized for — three poses of at most eight tiles each, which is 24 — and the
/// remaining headroom keeps the cap from being exactly one screen's worth. Each granted asset costs
/// one <c>Set-Cookie</c> header, so an unbounded batch would exhaust a browser's per-domain cookie
/// budget as surely as it would the response header limit.
/// </summary>
public static class MediaAccessBatchPolicy
{
    public const int MaximumAssets = 32;
}

public sealed record MediaCommandResult(
    MediaCommandStatus Status,
    MediaAssetView? Asset = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    // Carried for quota rejections so a caller can distinguish "this workspace is full" from
    // "this client is full" and act on it, rather than parsing prose.
    string? Code = null,
    string? Message = null);

public enum MediaCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    RateLimited = 5,

    /// <summary>
    /// A storage allowance is full. Distinct from <see cref="Invalid"/>, which means the file
    /// itself was rejected: nothing is wrong with the upload, there is simply no room for it.
    /// </summary>
    QuotaExceeded = 6,

    /// <summary>
    /// A dependency the upload cannot proceed without — the malware scanner — is not configured or
    /// could not be reached. Distinct from <see cref="Invalid"/> because nothing is wrong with the
    /// request: this deployment cannot accept any upload until the dependency is available, and
    /// saying so is what makes the closed state honest instead of blaming the file.
    /// </summary>
    Unavailable = 7,
}

/// <summary>
/// Stable machine-readable codes for a rejected upload. These are part of the API contract.
/// </summary>
public static class MediaQuotaCodes
{
    public const string WorkspaceStorageExceeded = "MediaWorkspaceStorageExceeded";
    public const string ClientProgressPhotoStorageExceeded = "ClientProgressPhotoStorageExceeded";
}

public enum MediaAccessStatus
{
    Success = 1,
    NotFound = 2,
    Forbidden = 3,
    NotReady = 4,
}

public enum MediaContentStatus
{
    Success = 1,
    NotFound = 2,
    Forbidden = 3,
}

public sealed class MediaStorageOptions
{
    public const string SectionName = "Media";

    public long MaxWorkspaceStorageBytes { get; set; } = 20L * 1024L * 1024L * 1024L;

    /// <summary>
    /// A single client's progress photos cannot consume the whole workspace allowance. 500 MB is
    /// roughly a thousand sanitised phone photos with their renditions, which is years of weekly
    /// three-pose sets, so it constrains a runaway account without constraining ordinary use.
    /// </summary>
    public long MaxClientProgressPhotoBytes { get; set; } = 500L * 1024L * 1024L;

    /// <summary>
    /// How often the purge sweep looks for due objects. Retention is measured in days, so the poll
    /// interval only decides how late a deletion runs, not whether it runs.
    /// </summary>
    public int PurgeIntervalSeconds { get; set; } = 900;

    /// <summary>
    /// The most assets one sweep claims in total, across every workspace it visits. Each batch
    /// holds row locks for the duration of its storage calls, so this bounds how long another
    /// replica can be kept waiting. Workspaces with work due share this budget rather than each
    /// receiving it, so the ceiling is the number written here and not a multiple of it.
    /// </summary>
    public int PurgeBatchSize { get; set; } = 25;

    /// <summary>
    /// Engineering policy: maximum progress-photo decodes admitted across this API process.
    /// Decoding can hold an RGBA bitmap, an orientation copy, Skia encoding buffers, managed output
    /// streams and a thumbnail surface at once, so the per-tenant upload gate is not a process-wide
    /// memory bound when many workspaces upload together.
    /// </summary>
    public int MaxConcurrentProgressPhotoDecodes { get; set; } = 2;

    /// <summary>
    /// Engineering policy for one immediate compensating storage delete. Cleanup uses its own
    /// token rather than the request token; exceeding this bound leaves durable state for the
    /// reconciliation sweep instead of holding the request indefinitely.
    /// </summary>
    public int IngestCleanupAttemptTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// Whether the sweep runs at all. Disabled in tests that drive the purge explicitly, so a
    /// background pass cannot race the assertions.
    /// </summary>
    public bool PurgeEnabled { get; set; } = true;

    // A grant must outlive one viewing session, not one request. The initial response survives
    // expiry because the grant is checked once at request start, but a seek outside the buffered
    // range and a resume after a pause each issue a new Range request that must re-present the
    // grant. At 500 MB, the video ceiling, 300 seconds implies roughly 14 Mbit/s sustained, which
    // a gym connection will not hold; 1800 covers about 2.3 Mbit/s and one paused-and-scrubbed
    // demo. Shortening it buys little: the grant is HttpOnly, SameSite=Strict, path-scoped to one
    // asset, bound to tenant/asset/user, useless without a concurrent authenticated session for
    // that same user, and the content route re-authorizes membership and entitlement on every
    // request, so revocation already takes effect before this value expires.
    public int AccessLifetimeSeconds { get; set; } = 1800;
}

public static class MediaAccessCookie
{
    public const string Name = "tb-gym.media";

    public static string Path(Guid assetId) => $"/api/media/{assetId:D}/content";

    /// <summary>
    /// The thumbnail lives beneath the asset's content path, so the cookie scoped to
    /// <see cref="Path"/> already covers it under RFC 6265 path matching. A rendition therefore
    /// needs no grant, cookie, or scope of its own.
    /// </summary>
    public static string ThumbnailPath(Guid assetId) => $"{Path(assetId)}/thumbnail";
}
