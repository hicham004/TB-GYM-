using TB.Gym.Modules.Clients;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Audit batch A10a (docs/FULL-AUDIT-2026-10.md, section 11): a set-up profile keeps what completing asked for,
/// refused by the domain in words before anything changes (SEC-3), where only the database's check said so, as a 500.
/// </summary>
[TestClass]
public sealed class A10ErrorWordsDomainTests
{
    private static readonly DateOnly Today = new(2026, 10, 20);

    [TestMethod]
    public void ASetUpProfileRefusesAnUpdateThatLeavesOutWhatCompletingAskedFor()
    {
        var profile = SetUpProfile();

        foreach (var (input, missing) in new[]
        {
            (Intake("Mirra", birthDate: null, height: 168m, goals: "Build strength"), "birth date"),
            (Intake("Mirra", birthDate: new DateOnly(1995, 4, 2), height: null, goals: "Build strength"), "height"),
            (Intake("Mirra", birthDate: new DateOnly(1995, 4, 2), height: 168m, goals: "   "), "goal"),
        })
        {
            var refused = Assert.ThrowsExactly<ArgumentException>(() => profile.UpdateIntake(input, Today), missing);
            Assert.AreEqual("Birth date, height and at least one goal stay required once the profile is set up.", refused.Message);
            Assert.AreEqual("Mira", profile.FirstName, "Refused before anything changed.");
        }

        Assert.IsNotNull(profile.BirthDate);
        Assert.IsNotNull(profile.HeightCentimeters);
        Assert.AreEqual("Build strength", profile.Goals);
        CollectionAssert.Contains(
            profile.UpdateIntake(Intake("Mirra", new DateOnly(1995, 4, 2), 168m, "Run a 10k"), Today).ToArray(),
            nameof(ClientProfile.FirstName));
    }

    [TestMethod]
    public void AProfileNotYetSetUpStillSavesPartOfItsIntake()
    {
        var profile = Profile();

        profile.UpdateIntake(Intake("Mira", birthDate: null, height: null, goals: null), Today);

        // Saved, and the profile is on its way to being set up; nothing it lacks is asked for yet.
        Assert.AreEqual(ClientOnboardingStatus.InProgress, profile.OnboardingStatus);
        Assert.IsNull(profile.Goals);
        Assert.AreEqual("Office", profile.WorkType);
    }

    private static ClientProfile SetUpProfile()
    {
        var profile = Profile();
        profile.CompleteOnboarding(
            Intake("Mira", new DateOnly(1995, 4, 2), 168m, "Build strength"),
            Today,
            new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual(ClientOnboardingStatus.Completed, profile.OnboardingStatus);
        return profile;
    }

    private static ClientProfile Profile() =>
        ClientProfile.CreateForAcceptedInvitation(
            Guid.Parse("10000000-0000-0000-0000-00000000a010"),
            Guid.Parse("20000000-0000-0000-0000-00000000a010"),
            Guid.Parse("20000000-0000-0000-0000-00000000a011"),
            "Mira",
            "Haddad",
            "mira.a10@example.com",
            null,
            null);

    private static ClientIntakeInput Intake(string firstName, DateOnly? birthDate, decimal? height, string? goals) =>
        new(
            firstName,
            "Haddad",
            null,
            birthDate,
            height,
            height is null ? null : LengthUnit.Centimeter,
            "Office",
            7000,
            null,
            null,
            null,
            goals,
            null,
            null,
            null);
}
