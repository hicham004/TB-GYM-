using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// R6.1b, PRG-013: a before-and-after records who made it, when and from which two photos of one client
/// and pose, the earlier one first, and never a removed photo.
/// </summary>
[TestClass]
public sealed class R61bProgressPhotoExportDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000061b0");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000061b0");
    private static readonly Guid ActorId = Guid.Parse("40000000-0000-0000-0000-0000000061b0");
    private static readonly DateTimeOffset Now = new(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void ABeforeAndAfterNamesItsClientPoseAndTwoPhotosEarlierFirst()
    {
        var before = Photo(new DateOnly(2026, 8, 3), ProgressPhotoPose.Front);
        var after = Photo(new DateOnly(2026, 10, 10), ProgressPhotoPose.Front);

        var export = ProgressPhotoExport.BeforeAndAfter(before, after, Now, ActorId);

        Assert.AreEqual(
            (TenantId, ClientId, ProgressPhotoPose.Front, before.Id, after.Id, Now, ActorId),
            (export.TenantId, export.ClientProfileId, export.Pose, export.BeforePhotoId, export.AfterPhotoId,
                export.ExportedAtUtc, export.ExportedByUserId));
    }

    [TestMethod]
    public void TheEarlierPhotoMustComeFirstAndTwoPhotosAreNeeded()
    {
        var august = Photo(new DateOnly(2026, 8, 3), ProgressPhotoPose.Side);
        var october = Photo(new DateOnly(2026, 10, 10), ProgressPhotoPose.Side);

        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoExport.BeforeAndAfter(october, august, Now, ActorId));
        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoExport.BeforeAndAfter(august, august, Now, ActorId));
    }

    [TestMethod]
    public void BothPhotosAreOfOneClientAndOnePose()
    {
        var front = Photo(new DateOnly(2026, 8, 3), ProgressPhotoPose.Front);
        var back = Photo(new DateOnly(2026, 10, 10), ProgressPhotoPose.Back);
        var someoneElse = ProgressPhoto.Record(
            TenantId,
            Guid.Parse("20000000-0000-0000-0000-0000000061b1"),
            new DateOnly(2026, 10, 10),
            ProgressPhotoPose.Front,
            Guid.NewGuid(),
            ProgressPhotoSource.Client);

        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoExport.BeforeAndAfter(front, back, Now, ActorId));
        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoExport.BeforeAndAfter(front, someoneElse, Now, ActorId));
    }

    [TestMethod]
    public void ARemovedPhotoCannotBeUsedAndSomeoneMustHaveMadeIt()
    {
        var before = Photo(new DateOnly(2026, 8, 3), ProgressPhotoPose.Front);
        var after = Photo(new DateOnly(2026, 10, 10), ProgressPhotoPose.Front);

        Assert.ThrowsExactly<ArgumentException>(() =>
            ProgressPhotoExport.BeforeAndAfter(before, after, Now, Guid.Empty));

        after.Remove();
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ProgressPhotoExport.BeforeAndAfter(before, after, Now, ActorId));
    }

    private static ProgressPhoto Photo(DateOnly date, ProgressPhotoPose pose) =>
        ProgressPhoto.Record(TenantId, ClientId, date, pose, Guid.NewGuid(), ProgressPhotoSource.Client);
}
