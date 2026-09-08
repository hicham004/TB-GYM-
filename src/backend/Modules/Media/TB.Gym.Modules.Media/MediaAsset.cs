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
        StorageObjectLocator storageLocator,
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
        Sha256 = MediaText.Sha256(sha256);
        if (storageLocator.TenantId != tenantId)
        {
            throw new ArgumentException("A media asset cannot use another tenant's storage locator.");
        }

        StorageLocation = storageLocator.Location;
        StorageKey = storageLocator.ObjectKey;
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

    /// <summary>
    /// Durable storage identity. It remains after purge so history never reinterprets the cleared
    /// key under whichever adapter a deployment selects later.
    /// </summary>
    public string? StorageLocation { get; private set; }

    public ExternalMediaProvider? ExternalProvider { get; private set; }

    public string? ExternalMediaId { get; private set; }

    public string? ScannerKey { get; private set; }

    public string? ScannerVersion { get; private set; }

    public string? ScanFailureCode { get; private set; }

    public MediaScanEvidenceState ScanEvidenceState { get; private set; }

    public string? ScanStorageLocation { get; private set; }

    public string? ScanStorageKey { get; private set; }

    public string? ScanSha256 { get; private set; }

    public DateTimeOffset? ScannedAtUtc { get; private set; }

    public MediaScanOutcome? ScanOutcome { get; private set; }

    public bool IsCoachProtected { get; private set; }

    public DateTimeOffset? TombstonedAtUtc { get; private set; }

    /// <summary>
    /// When the bytes become eligible for physical deletion. Null means never: the object is
    /// referenced by history that must remain resolvable, so it is retained indefinitely.
    /// </summary>
    public DateTimeOffset? PurgeAfterUtc { get; private set; }

    public DateTimeOffset? PurgedAtUtc { get; private set; }

    /// <summary>
    /// How many times physical deletion has been attempted, and why the last attempt failed. Both
    /// are kept on the row so a stuck object is visible rather than silently retried forever.
    /// </summary>
    public int PurgeAttemptCount { get; private set; }

    public DateTimeOffset? LastPurgeAttemptAtUtc { get; private set; }

    public string? PurgeFailureCode { get; private set; }

    public Guid? PurgeClaimToken { get; private set; }

    public DateTimeOffset? PurgeClaimExpiresAtUtc { get; private set; }

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
        StorageObjectLocator storageLocator,
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
            storageLocator,
            purpose);

    public static MediaAsset RegisterExternalEmbed(
        Guid tenantId,
        Guid ownerUserId,
        string title,
        ExternalMediaProvider provider,
        string externalMediaId) =>
        new(tenantId, ownerUserId, title, provider, externalMediaId);

    public StorageObjectLocator GetStorageLocator()
    {
        if (Source != MediaSource.Upload || StorageLocation is null || StorageKey is null)
        {
            throw new InvalidOperationException("The media asset has no live stored object.");
        }

        return new StorageObjectLocator(TenantId, StorageLocation, StorageKey);
    }

    public void RecordScan(MediaScanEvidence evidence)
    {
        if (Status != MediaAssetStatus.PendingScan)
        {
            throw new InvalidOperationException("Only pending media can receive a scan result.");
        }

        ArgumentNullException.ThrowIfNull(evidence);
        if (!evidence.Covers(GetStorageLocator(), Sha256!))
        {
            throw new InvalidOperationException("Scan evidence does not cover this stored media object.");
        }

        ScannerKey = evidence.ScannerKey;
        ScannerVersion = evidence.ScannerVersion;
        ScanFailureCode = evidence.FailureCode;
        ScanEvidenceState = MediaScanEvidenceState.Complete;
        ScanStorageLocation = evidence.StorageLocation;
        ScanStorageKey = evidence.StorageKey;
        ScanSha256 = evidence.Sha256;
        ScannedAtUtc = evidence.ScannedAtUtc;
        ScanOutcome = evidence.Outcome;
        Status = evidence.IsAllowed ? MediaAssetStatus.Ready : MediaAssetStatus.Rejected;
    }

    /// <summary>
    /// Schedules the bytes for physical deletion. A refused original may travel this way too: its
    /// Complete/Refused evidence stays exactly as recorded, so the row keeps saying the scanner
    /// refused these precise bytes while the cleanup lifecycle reclaims them.
    /// </summary>
    /// <remarks>
    /// Tombstoned is a readable state for ordinary media — a mistaken removal stays recoverable for
    /// the retention window — so a refused asset passing through it must not become readable. The
    /// access and content paths therefore decide on <see cref="ScanOutcome"/> rather than on
    /// <see cref="Status"/> alone.
    /// </remarks>
    public void MarkTombstoned(DateTimeOffset now, TimeSpan retention, bool isHistoricallyReferenced)
    {
        if (Status == MediaAssetStatus.Tombstoned)
        {
            return;
        }

        // Purging is terminal. Re-tombstoning a purged asset would reschedule bytes that no longer
        // exist and make a deleted object look recoverable.
        if (Status == MediaAssetStatus.Purged)
        {
            throw new InvalidOperationException("A purged media asset cannot be tombstoned again.");
        }

        Status = MediaAssetStatus.Tombstoned;
        TombstonedAtUtc = now;
        PurgeAfterUtc = isHistoricallyReferenced ? null : now.Add(retention);
    }

    /// <summary>
    /// Whether the bytes may be physically deleted at <paramref name="now"/>. An asset that is not
    /// tombstoned, one retained indefinitely because history references it, and one whose retention
    /// has not elapsed are all ineligible.
    /// </summary>
    public bool IsPurgeDue(DateTimeOffset now) =>
        Status == MediaAssetStatus.Tombstoned &&
        Source == MediaSource.Upload &&
        PurgeAfterUtc is { } purgeAfter &&
        now >= purgeAfter;

    public bool IsPurgeClaimable(DateTimeOffset now) =>
        IsPurgeDue(now) &&
        (PurgeClaimToken is null || PurgeClaimExpiresAtUtc <= now);

    /// <summary>
    /// Records that physical deletion is being attempted. Called before any object is touched so a
    /// process that dies mid-purge still leaves evidence of the attempt.
    /// </summary>
    public void ClaimPurge(DateTimeOffset now, TimeSpan lease, Guid claimToken)
    {
        EnsurePurgeable();
        if (!IsPurgeClaimable(now) || lease <= TimeSpan.Zero || claimToken == Guid.Empty)
        {
            throw new InvalidOperationException("The media asset cannot be claimed for purge.");
        }

        PurgeClaimToken = claimToken;
        PurgeClaimExpiresAtUtc = now.Add(lease);
        PurgeAttemptCount++;
        LastPurgeAttemptAtUtc = now;
    }

    /// <summary>
    /// Every object belonging to this asset is gone. The row is kept as history, but its storage
    /// key is cleared: there is nothing left for it to address.
    /// </summary>
    public bool CompletePurge(DateTimeOffset now, Guid claimToken)
    {
        EnsurePurgeable();
        if (!OwnsPurgeClaim(claimToken))
        {
            return false;
        }

        Status = MediaAssetStatus.Purged;
        PurgedAtUtc = now;
        StorageKey = null;
        PurgeFailureCode = null;
        PurgeClaimToken = null;
        PurgeClaimExpiresAtUtc = null;
        return true;
    }

    /// <summary>
    /// Physical deletion failed. The asset stays tombstoned and due, so the next sweep retries it,
    /// and the reason stays on the row so a persistently stuck object can be found.
    /// </summary>
    public bool RecordPurgeFailure(DateTimeOffset now, Guid claimToken, string failureCode)
    {
        EnsurePurgeable();
        if (!OwnsPurgeClaim(claimToken))
        {
            return false;
        }

        LastPurgeAttemptAtUtc = now;
        PurgeFailureCode = MediaText.Required(failureCode, 100, nameof(failureCode));
        PurgeClaimToken = null;
        PurgeClaimExpiresAtUtc = null;
        return true;
    }

    public bool OwnsPurgeClaim(Guid claimToken) =>
        claimToken != Guid.Empty && PurgeClaimToken == claimToken;

    private void EnsurePurgeable()
    {
        if (Status == MediaAssetStatus.Purged)
        {
            throw new InvalidOperationException("The media asset has already been purged.");
        }

        if (Status != MediaAssetStatus.Tombstoned)
        {
            throw new InvalidOperationException("Only tombstoned media can be purged.");
        }

        if (PurgeAfterUtc is null)
        {
            throw new InvalidOperationException(
                "Media retained for historical reference cannot be purged.");
        }
    }

    private static string ValidateExternalId(string value)
    {
        var normalized = MediaText.Required(value, 100, nameof(value));
        return normalized.All(character => char.IsLetterOrDigit(character) || character is '-' or '_')
            ? normalized
            : throw new ArgumentException("The external media id contains unsupported characters.", nameof(value));
    }
}

/// <summary>
/// How long tombstoned bytes are retained before they may be physically deleted.
/// </summary>
/// <remarks>
/// The delay exists so a deletion can be reversed by a human before it becomes irreversible, and
/// so a client can still see a photo they removed by mistake. Shared by every path that tombstones,
/// so coach media and progress photos cannot drift onto different retentions.
/// </remarks>
public static class MediaRetentionPolicy
{
    public static readonly TimeSpan DeleteRetention = TimeSpan.FromDays(30);
}

public static class MediaUploadPolicy
{
    public const long MaximumImageBytes = 15 * 1024 * 1024;
    public const long MaximumVideoBytes = 500 * 1024 * 1024;

    /// <summary>
    /// The widest and tallest image the decoder is allowed to expand an upload into.
    /// </summary>
    /// <remarks>
    /// The compressed byte cap does not bound decoded memory: PNG and JPEG both express an
    /// enormous uniform bitmap in a few kilobytes, so a 40 KB file can demand gigabytes of RAM the
    /// moment it is decoded. These are the bounds that actually hold, and they are checked against
    /// the encoded header before a single pixel is allocated.
    /// </remarks>
    public const int MaximumImageWidth = 8_000;

    public const int MaximumImageHeight = 8_000;

    /// <summary>
    /// 30 megapixels: enough detail for the progress-photo use case while keeping one four-byte
    /// decoded pixel buffer at a documented 120 MB ceiling.
    /// </summary>
    public const long MaximumImagePixels = 30_000_000;

    /// <summary>
    /// RGBA8888, the colour type the sanitiser decodes into. Stated rather than assumed, because
    /// the decoded-size arithmetic below is only meaningful against a known pixel width.
    /// </summary>
    public const int DecodedBytesPerPixel = 4;

    /// <summary>
    /// 120 MB, the product of the pixel ceiling and the bytes each pixel occupies once decoded.
    /// This is one pixel buffer, not the process peak: orientation can require a second full bitmap,
    /// and codec/encoder buffers, managed output streams, and the thumbnail surface add more. Both
    /// per-tenant upload admission and a configurable process-wide decode limit bound concurrency;
    /// the pixel and concurrency limits are engineering policy parameters, not a memory forecast.
    /// </summary>
    public const long MaximumDecodedImageBytes = MaximumImagePixels * DecodedBytesPerPixel;

    /// <summary>
    /// Whether an image of these encoded dimensions may be decoded, and how many bytes that would
    /// take. Called with the dimensions the codec read out of the header, so a pathological image
    /// is refused while it is still only a few kilobytes on disk.
    /// </summary>
    /// <remarks>
    /// The dimension guards run first and are what make the multiplications safe: both factors are
    /// bounded by <see cref="MaximumImageWidth"/>/<see cref="MaximumImageHeight"/> before they are
    /// multiplied, so the 64-bit products cannot overflow whatever a malformed header claims. The
    /// arithmetic is <c>checked</c> anyway, so a future change to those bounds fails loudly instead
    /// of wrapping into a small number that passes.
    /// </remarks>
    public static bool TryValidateDecodedImage(int width, int height, out long decodedBytes)
    {
        decodedBytes = 0;
        if (width <= 0 ||
            height <= 0 ||
            width > MaximumImageWidth ||
            height > MaximumImageHeight)
        {
            return false;
        }

        var pixels = checked((long)width * height);
        if (pixels > MaximumImagePixels)
        {
            return false;
        }

        var bytes = checked(pixels * DecodedBytesPerPixel);
        if (bytes > MaximumDecodedImageBytes)
        {
            return false;
        }

        decodedBytes = bytes;
        return true;
    }

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

    /// <summary>
    /// The bytes have been physically deleted. Terminal: the row survives as history, but nothing
    /// can resurrect the object it used to address.
    /// </summary>
    Purged = 5,
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

    /// <summary>
    /// Shared by assets and their derivatives so both record a content hash in the same shape the
    /// database check constraint enforces.
    /// </summary>
    public static string Sha256(string value)
    {
        var normalized = Required(value, 64, nameof(value)).ToLowerInvariant();
        if (normalized.Length != 64 || normalized.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new ArgumentException("Media requires a SHA-256 content hash.", nameof(value));
        }

        return normalized;
    }
}
