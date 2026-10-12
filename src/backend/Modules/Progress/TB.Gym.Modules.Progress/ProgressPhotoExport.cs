using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

/// <summary>
/// The record that a client made a before-and-after picture from two of their own progress photos
/// (R6.1b, PRG-013). Photo exports are auditable (CLI-008), so it says who made it, when, and from which
/// two photos; it never holds the picture, which is made on the client's own device. Append-only.
/// </summary>
public sealed class ProgressPhotoExport : TenantEntity
{
    private ProgressPhotoExport()
    {
    }

    private ProgressPhotoExport(
        ProgressPhoto before,
        ProgressPhoto after,
        DateTimeOffset exportedAtUtc,
        Guid exportedByUserId)
        : base(before.TenantId)
    {
        ClientProfileId = before.ClientProfileId;
        Pose = before.Pose;
        BeforePhotoId = before.Id;
        AfterPhotoId = after.Id;
        ExportedAtUtc = exportedAtUtc;
        ExportedByUserId = exportedByUserId;
    }

    public Guid ClientProfileId { get; private set; }

    public ProgressPhotoPose Pose { get; private set; }

    public Guid BeforePhotoId { get; private set; }

    public Guid AfterPhotoId { get; private set; }

    public DateTimeOffset ExportedAtUtc { get; private set; }

    public Guid ExportedByUserId { get; private set; }

    /// <summary>
    /// Records a before-and-after of two active photos of one client and pose, the earlier one first.
    /// A removed photo cannot be used, even though its owner still sees it in their history.
    /// </summary>
    public static ProgressPhotoExport BeforeAndAfter(
        ProgressPhoto before,
        ProgressPhoto after,
        DateTimeOffset exportedAtUtc,
        Guid exportedByUserId)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);
        if (exportedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A photo export requires the person who made it.", nameof(exportedByUserId));
        }

        if (before.Id == after.Id)
        {
            throw new ArgumentException("A before-and-after needs two different photos.", nameof(after));
        }

        if (before.TenantId != after.TenantId || before.ClientProfileId != after.ClientProfileId)
        {
            throw new ArgumentException("Both photos must be of the same client.", nameof(after));
        }

        if (before.Pose != after.Pose)
        {
            throw new ArgumentException("Both photos must show the same pose.", nameof(after));
        }

        if (before.PhotoDate >= after.PhotoDate)
        {
            throw new ArgumentException("The before photo must be the earlier one.", nameof(before));
        }

        if (before.Status != ProgressPhotoStatus.Active || after.Status != ProgressPhotoStatus.Active)
        {
            throw new InvalidOperationException("A removed photo cannot be used in a before-and-after.");
        }

        return new ProgressPhotoExport(before, after, exportedAtUtc, exportedByUserId);
    }
}
