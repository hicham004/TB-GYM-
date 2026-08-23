using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

public sealed class MediaAsset : TenantEntity
{
    private MediaAsset()
    {
    }

    private MediaAsset(
        Guid tenantId,
        Guid ownerUserId,
        string title,
        MediaKind kind,
        string originalFileName,
        string declaredContentType,
        string verifiedContentType,
        long length,
        string sha256,
        string storageKey,
        MediaPurpose purpose)
        : base(tenantId)
    {
        if (ownerUserId == Guid.Empty || !Enum.IsDefined(kind) || !Enum.IsDefined(purpose))
        {
            throw new ArgumentException("Media owner, kind, and purpose are required.");
        }

        if (purpose == MediaPurpose.ProgressPhoto && kind != MediaKind.Image)
        {
            throw new ArgumentException("A progress photo must be an image.");
        }

        OwnerUserId = ownerUserId;
        Title = MediaText.Required(title, 200, nameof(title));
        Kind = kind;
        Source = MediaSource.Upload;
        OriginalFileName = MediaText.Required(originalFileName, 255, nameof(originalFileName));
        DeclaredContentType = MediaText.Required(declaredContentType, 100, nameof(declaredContentType));
        VerifiedContentType = MediaText.Required(verifiedContentType, 100, nameof(verifiedContentType));
        Length = length;
        Sha256 = ValidateHash(sha256);
        StorageKey = MediaText.Required(storageKey, 500, nameof(storageKey));
        Status = MediaAssetStatus.PendingScan;
        IsCoachProtected = true;
        Purpose = purpose;
    }

    private MediaAsset(
        Guid tenantId,
        Guid ownerUserId,
        string title,
        ExternalMediaProvider provider,
        string externalMediaId)
        : base(tenantId)
    {
        if (ownerUserId == Guid.Empty || !Enum.IsDefined(provider))
        {
            throw new ArgumentException("Media owner and provider are required.");
        }

        OwnerUserId = ownerUserId;
        Title = MediaText.Required(title, 200, nameof(title));
        Kind = MediaKind.Video;
        Source = MediaSource.ExternalEmbed;
        ExternalProvider = provider;
        ExternalMediaId = ValidateExternalId(externalMediaId);
        Status = MediaAssetStatus.Ready;
        IsCoachProtected = true;
        Purpose = MediaPurpose.ExerciseMedia;
    }

    /// <summary>
    /// Separates coach-owned exercise library media from client progress photos. Authorization
    /// differs fundamentally between the two, so it is never inferred from other fields.
    /// </summary>
    public MediaPurpose Purpose { get; private set; }

    public Guid OwnerUserId { get; private set; }

    public string Title { get; private set; } = string.Empty;

    public MediaKind Kind { get; private set; }

    public MediaSource Source { get; private set; }

    public MediaAssetStatus Status { get; private set; }

    public string? OriginalFileName { get; private set; }

    public string? DeclaredContentType { get; private set; }

    public string? VerifiedContentType { get; private set; }

    public long? Length { get; private set; }

    public string? Sha256 { get; private set; }

    public string? StorageKey { get; private set; }

    public ExternalMediaProvider? ExternalProvider { get; private set; }

    public string? ExternalMediaId { get; private set; }

    public string? ScannerKey { get; private set; }

    public string? ScannerVersion { get; private set; }

    public string? FailureCode { get; private set; }

    public bool IsCoachProtected { get; private set; }

    public DateTimeOffset? TombstonedAtUtc { get; private set; }

    public DateTimeOffset? PurgeAfterUtc { get; private set; }

    public static MediaAsset RegisterUpload(
        Guid tenantId,
        Guid ownerUserId,
        string title,
        MediaKind kind,
        string originalFileName,
        string declaredContentType,
        string verifiedContentType,
        long length,
        string sha256,
        string storageKey,
        MediaPurpose purpose = MediaPurpose.ExerciseMedia) =>
        new(
            tenantId,
            ownerUserId,
            title,
            kind,
            originalFileName,
            declaredContentType,
            verifiedContentType,
            length,
            sha256,
            storageKey,
            purpose);

    public static MediaAsset RegisterExternalEmbed(
        Guid tenantId,
        Guid ownerUserId,
        string title,
        ExternalMediaProvider provider,
        string externalMediaId) =>
        new(tenantId, ownerUserId, title, provider, externalMediaId);

    public void RecordScan(MediaScanResult result)
    {
        if (Status != MediaAssetStatus.PendingScan)
        {
            throw new InvalidOperationException("Only pending media can receive a scan result.");
        }

        ScannerKey = MediaText.Required(result.ScannerKey, 80, nameof(result));
        ScannerVersion = MediaText.Required(result.ScannerVersion, 40, nameof(result));
        FailureCode = MediaText.Optional(result.FailureCode, 100, nameof(result));
        Status = result.IsAllowed ? MediaAssetStatus.Ready : MediaAssetStatus.Rejected;
    }

    public void MarkTombstoned(DateTimeOffset now, TimeSpan retention, bool isHistoricallyReferenced)
    {
        if (Status == MediaAssetStatus.Tombstoned)
        {
            return;
        }

        Status = MediaAssetStatus.Tombstoned;
        TombstonedAtUtc = now;
        PurgeAfterUtc = isHistoricallyReferenced ? null : now.Add(retention);
    }

    private static string ValidateHash(string value)
    {
        var normalized = MediaText.Required(value, 64, nameof(value)).ToLowerInvariant();
        if (normalized.Length != 64 || normalized.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new ArgumentException("Media requires a SHA-256 content hash.", nameof(value));
        }

        return normalized;
    }

    private static string ValidateExternalId(string value)
    {
        var normalized = MediaText.Required(value, 100, nameof(value));
        return normalized.All(character => char.IsLetterOrDigit(character) || character is '-' or '_')
            ? normalized
            : throw new ArgumentException("The external media id contains unsupported characters.", nameof(value));
    }
}

public static class MediaUploadPolicy
{
    public const long MaximumImageBytes = 15 * 1024 * 1024;
    public const long MaximumVideoBytes = 500 * 1024 * 1024;

    public static MediaFileValidation Validate(
        string fileName,
        string declaredContentType,
        long length,
        ReadOnlySpan<byte> signature)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        var candidate = (extension, declaredContentType.ToLowerInvariant()) switch
        {
            (".jpg" or ".jpeg", "image/jpeg") when StartsWith(signature, [0xff, 0xd8, 0xff]) =>
                new MediaFileValidation(MediaKind.Image, "image/jpeg", MaximumImageBytes),
            (".png", "image/png") when StartsWith(signature, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) =>
                new MediaFileValidation(MediaKind.Image, "image/png", MaximumImageBytes),
            (".webm", "video/webm") when StartsWith(signature, [0x1a, 0x45, 0xdf, 0xa3]) =>
                new MediaFileValidation(MediaKind.Video, "video/webm", MaximumVideoBytes),
            (".mp4", "video/mp4") when IsMp4(signature) =>
                new MediaFileValidation(MediaKind.Video, "video/mp4", MaximumVideoBytes),
            _ => throw new ArgumentException("The file extension, content type, and signature are not an allowed media format."),
        };

        if (length is <= 0 || length > candidate.MaximumBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(length), "The uploaded media exceeds the allowed size.");
        }

        return candidate;
    }

    private static bool StartsWith(ReadOnlySpan<byte> source, ReadOnlySpan<byte> prefix) =>
        source.Length >= prefix.Length && source[..prefix.Length].SequenceEqual(prefix);

    private static bool IsMp4(ReadOnlySpan<byte> signature) =>
        signature.Length >= 12 && signature.Slice(4, 4).SequenceEqual("ftyp"u8);
}

public sealed record MediaFileValidation(MediaKind Kind, string VerifiedContentType, long MaximumBytes);

public enum MediaPurpose
{
    ExerciseMedia = 1,
    ProgressPhoto = 2,
}

public enum MediaKind
{
    Image = 1,
    Video = 2,
}

public enum MediaSource
{
    Upload = 1,
    ExternalEmbed = 2,
}

public enum MediaAssetStatus
{
    PendingScan = 1,
    Ready = 2,
    Rejected = 3,
    Tombstoned = 4,
}

public enum ExternalMediaProvider
{
    YouTube = 1,
    Vimeo = 2,
}

internal static class MediaText
{
    public static string Required(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    public static string? Optional(string? value, int maxLength, string parameterName) =>
        string.IsNullOrWhiteSpace(value) ? null : Required(value, maxLength, parameterName);
}
