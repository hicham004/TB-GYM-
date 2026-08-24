using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase5B6BodyweightVoidDomainTests
{
    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid ClientProfileId = Guid.CreateVersion7();
    private static readonly Guid ActorUserId = Guid.CreateVersion7();
    private static readonly DateTimeOffset VoidedAtUtc = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void VoidingIsOneWayAndRejectsASecondVoid()
    {
        var observation = CreateObservation();
        var replacementId = Guid.CreateVersion7();

        var record = observation.Void("Logged on the wrong day.", VoidedAtUtc, ActorUserId, replacementId);

        Assert.AreEqual(BodyweightObservationStatus.Voided, observation.Status);
        Assert.IsFalse(observation.IsActive);
        Assert.AreEqual(observation.Id, record.ObservationId);
        Assert.AreEqual(replacementId, record.ReplacementObservationId);
        Assert.AreEqual(ActorUserId, record.VoidedByUserId);
        Assert.AreEqual(VoidedAtUtc, record.VoidedAtUtc);
        Assert.AreEqual("Logged on the wrong day.", record.Reason);

        // The void keeps the fact it withdraws, so history still reads the original observation.
        Assert.AreEqual(80m, record.ValueKilograms);
        Assert.AreEqual(new DateOnly(2026, 8, 20), record.MeasurementDate);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            observation.Void("Voided twice.", VoidedAtUtc, ActorUserId, Guid.CreateVersion7()));

        // A voided observation is not current truth, so it cannot be value-corrected either.
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            observation.Correct(81m, RecordedMassUnit.Kilogram, BodyweightSource.Coach));
    }

    [TestMethod]
    public void AVoidWithoutAReasonOrAnActorIsRejectedAndLeavesTheObservationActive()
    {
        var observation = CreateObservation();

        Assert.ThrowsExactly<ArgumentException>(() =>
            observation.Void("   ", VoidedAtUtc, ActorUserId, null));
        Assert.ThrowsExactly<ArgumentException>(() =>
            observation.Void(new string('x', 501), VoidedAtUtc, ActorUserId, null));
        Assert.ThrowsExactly<ArgumentException>(() =>
            observation.Void("Missing actor.", VoidedAtUtc, Guid.Empty, null));
        Assert.ThrowsExactly<ArgumentException>(() =>
            observation.Void("Replaces itself.", VoidedAtUtc, ActorUserId, observation.Id));

        // The record is built before the status flips, so a rejected void changes nothing at all.
        Assert.AreEqual(BodyweightObservationStatus.Active, observation.Status);
        Assert.IsTrue(observation.IsActive);
    }

    private static BodyweightObservation CreateObservation() =>
        BodyweightObservation.CreateInitial(
            TenantId,
            ClientProfileId,
            new DateOnly(2026, 8, 20),
            80m,
            RecordedMassUnit.Kilogram,
            BodyweightSource.Client);
}
