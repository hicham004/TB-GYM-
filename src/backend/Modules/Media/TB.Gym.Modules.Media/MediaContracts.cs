namespace TB.Gym.Modules.Media;

public interface IMediaApplicationService
{
    Task<MediaCommandResult> UploadAsync(
        string title,
        string fileName,
        string contentType,
        Stream content,
        CancellationToken cancellationToken);

    Task<MediaCommandResult> RegisterExternalAsync(
        RegisterExternalMediaRequest request,
        CancellationToken cancellationToken);

    Task<MediaAssetPage> ListAsync(int skip, int take, CancellationToken cancellationToken);

    Task<MediaAccessResult> CreateAccessAsync(Guid assetId, CancellationToken cancellationToken);

    Task<MediaContentResult> OpenContentAsync(
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
    bool DownloadAllowed);

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

public sealed record MediaCommandResult(
    MediaCommandStatus Status,
    MediaAssetView? Asset = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public enum MediaCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    RateLimited = 5,
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
}
