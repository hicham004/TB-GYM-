using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

/// <summary>
/// A dated progress photo for one client and pose. The image bytes live in the Media module; this
/// module owns only the clinical/coaching association, so the Progress assembly never references
/// Media. Removal is a one-way audited state change: the row and its media association are kept so
/// history cannot be silently rewritten.
/// </summary>
public sealed class ProgressPhoto : TenantEntity
{
    private ProgressPhoto()
    {
    }

    private ProgressPhoto(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly photoDate,
        ProgressPhotoPose pose,
        Guid mediaAssetId,
        ProgressPhotoSource source)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || mediaAssetId == Guid.Empty)
        {
            throw new ArgumentException("A progress photo requires a client and a stored image.");
        }

        if (!Enum.IsDefined(pose) || !Enum.IsDefined(source))
        {
            throw new ArgumentOutOfRangeException(nameof(pose), "A supported pose and source are required.");
        }

        ClientProfileId = clientProfileId;
        PhotoDate = photoDate;
        Pose = pose;
        MediaAssetId = mediaAssetId;
        Source = source;
        Status = ProgressPhotoStatus.Active;
    }

    public Guid ClientProfileId { get; private set; }

    public DateOnly PhotoDate { get; private set; }

    public ProgressPhotoPose Pose { get; private set; }

    public Guid MediaAssetId { get; private set; }

    public ProgressPhotoSource Source { get; private set; }

    public ProgressPhotoStatus Status { get; private set; }

    public static ProgressPhoto Record(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly photoDate,
        ProgressPhotoPose pose,
        Guid mediaAssetId,
        ProgressPhotoSource source) =>
        new(tenantId, clientProfileId, photoDate, pose, mediaAssetId, source);

    /// <summary>
    /// Withdraws the photo from coach-facing views. The client who owns it keeps access, and the
    /// row is retained so the removal itself stays auditable.
    /// </summary>
    public void Remove()
    {
        if (Status == ProgressPhotoStatus.Removed)
        {
            throw new InvalidOperationException("The progress photo is already removed.");
        }

        Status = ProgressPhotoStatus.Removed;
    }
}

/// <summary>
/// Append-only record of a progress photo removal.
/// </summary>
public sealed class ProgressPhotoRemoval : TenantEntity
{
    private ProgressPhotoRemoval()
    {
    }

    private ProgressPhotoRemoval(
        Guid tenantId,
        ProgressPhoto photo,
        string reason,
        DateTimeOffset removedAtUtc,
        Guid removedByUserId)
        : base(tenantId)
    {
        ArgumentNullException.ThrowIfNull(photo);
        if (removedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A progress photo removal requires the acting user.", nameof(removedByUserId));
        }

        ProgressPhotoId = photo.Id;
        ClientProfileId = photo.ClientProfileId;
        PhotoDate = photo.PhotoDate;
        Pose = photo.Pose;
        MediaAssetId = photo.MediaAssetId;
        Reason = ProgressText.RequiredReason(reason);
        RemovedAtUtc = removedAtUtc;
        RemovedByUserId = removedByUserId;
    }

    public Guid ProgressPhotoId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public DateOnly PhotoDate { get; private set; }

    public ProgressPhotoPose Pose { get; private set; }

    public Guid MediaAssetId { get; private set; }

    public string Reason { get; private set; } = string.Empty;

    public DateTimeOffset RemovedAtUtc { get; private set; }

    public Guid RemovedByUserId { get; private set; }

    public static ProgressPhotoRemoval Create(
        ProgressPhoto photo,
        string reason,
        DateTimeOffset removedAtUtc,
        Guid removedByUserId)
    {
        ArgumentNullException.ThrowIfNull(photo);
        return new ProgressPhotoRemoval(photo.TenantId, photo, reason, removedAtUtc, removedByUserId);
    }
}

public enum ProgressPhotoPose
{
    Front = 1,
    Side = 2,
    Back = 3,
}

public enum ProgressPhotoStatus
{
    Active = 1,
    Removed = 2,
}

public enum ProgressPhotoSource
{
    Client = 1,
    Coach = 2,
}

internal static class ProgressText
{
    public static string RequiredReason(string value)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length is 0 or > 500
            ? throw new ArgumentException("A reason between 1 and 500 characters is required.", nameof(value))
            : normalized;
    }
}
