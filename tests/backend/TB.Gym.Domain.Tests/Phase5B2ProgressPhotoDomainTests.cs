using TB.Gym.Modules.Media;
using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase5B2ProgressPhotoDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-00000000050b");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-00000000050b");
    private static readonly Guid MediaAssetId = Guid.Parse("30000000-0000-0000-0000-00000000050b");
    private static readonly Guid ActorId = Guid.Parse("40000000-0000-0000-0000-00000000050b");
    private static readonly DateTimeOffset Now = new(2026, 8, 23, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void ProgressPhotoMediaMustBeAnImage()
    {
        // A progress photo is only ever a still image, and the rule lives in the media domain so
        // no caller can register a video against the progress purpose.
        Assert.ThrowsExactly<ArgumentException>(() => MediaAsset.RegisterUpload(
            TenantId,
            ActorId,
            "Progress photo Front 2026-08-23",
            MediaKind.Video,
            "clip.mp4",
            "video/mp4",
            "video/mp4",
            1_024,
            new string('a', 64),
            "tenant/object",
            MediaPurpose.ProgressPhoto));

        var image = MediaAsset.RegisterUpload(
            TenantId,
            ActorId,
            "Progress photo Front 2026-08-23",
            MediaKind.Image,
            "front.jpg",
            "image/jpeg",
            "image/jpeg",
            1_024,
            new string('a', 64),
            "tenant/object",
            MediaPurpose.ProgressPhoto);
        Assert.AreEqual(MediaPurpose.ProgressPhoto, image.Purpose);
    }

    [TestMethod]
    public void ExerciseMediaRemainsTheDefaultPurpose()
    {
        // Existing call sites must keep their behaviour, so the discriminator defaults to the
        // coach library rather than silently reclassifying exercise content.
        var asset = MediaAsset.RegisterUpload(
            TenantId,
            ActorId,
            "Squat demo",
            MediaKind.Video,
            "squat.mp4",
            "video/mp4",
            "video/mp4",
            2_048,
            new string('b', 64),
            "tenant/object-2");

        Assert.AreEqual(MediaPurpose.ExerciseMedia, asset.Purpose);
    }

    [TestMethod]
    public void RemovalIsOneWayAndCapturesTheAuditTrail()
    {
        var photo = ProgressPhoto.Record(
            TenantId,
            ClientId,
            new DateOnly(2026, 8, 23),
            ProgressPhotoPose.Front,
            MediaAssetId,
            ProgressPhotoSource.Client);
        Assert.AreEqual(ProgressPhotoStatus.Active, photo.Status);

        photo.Remove();
        var removal = ProgressPhotoRemoval.Create(photo, "  Uploaded the wrong pose.  ", Now, ActorId);

        Assert.AreEqual(ProgressPhotoStatus.Removed, photo.Status);
        Assert.AreEqual("Uploaded the wrong pose.", removal.Reason);
        Assert.AreEqual(ActorId, removal.RemovedByUserId);
        Assert.AreEqual(MediaAssetId, removal.MediaAssetId);
        Assert.AreEqual(ProgressPhotoPose.Front, removal.Pose);
        Assert.ThrowsExactly<InvalidOperationException>(photo.Remove);
    }

    [TestMethod]
    public void RemovalRequiresAReasonAndAnActor()
    {
        var photo = ProgressPhoto.Record(
            TenantId,
            ClientId,
            new DateOnly(2026, 8, 23),
            ProgressPhotoPose.Back,
            MediaAssetId,
            ProgressPhotoSource.Coach);

        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoRemoval.Create(photo, "   ", Now, ActorId));
        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoRemoval.Create(photo, "Valid reason.", Now, Guid.Empty));
    }
}
