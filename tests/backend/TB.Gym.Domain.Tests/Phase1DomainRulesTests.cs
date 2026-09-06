using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase1DomainRulesTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid UserId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly DateOnly Today = new(2026, 8, 20);

    [TestMethod]
    public void SoloCoachWorkspaceUsesLebanonDefaultsWithoutGymParent()
    {
        var workspace = Tenant.Create("Maya Coaching", "maya-coaching");

        Assert.AreEqual("Asia/Beirut", workspace.TimeZoneId);
        Assert.AreEqual("en-LB", workspace.DefaultCulture);
        Assert.AreEqual("USD", workspace.DefaultCurrencyCode);
        Assert.AreEqual(DayOfWeek.Monday, workspace.WeekStartsOn);
    }

    [TestMethod]
    public void WorkspaceNormalizesConfigurableCurrency()
    {
        var workspace = Tenant.Create(
            "Maya Coaching",
            "maya-coaching",
            defaultCurrencyCode: " eur ");

        Assert.AreEqual("EUR", workspace.DefaultCurrencyCode);
    }

    /// <summary>
    /// Phase 6B-3C moved the token off the invitation entirely. What a deliberate resend does at the
    /// domain boundary is advance the logical-send generation, which is what invalidates every token
    /// minted for the previous one; the tokens themselves live in append-only
    /// <c>InvitationTokenIssue</c> rows a dispatcher writes, and this aggregate never sees one.
    /// </summary>
    [TestMethod]
    public void DeliberateResendAdvancesTheLogicalSendGenerationAtDomainBoundary()
    {
        var now = new DateTimeOffset(2026, 8, 20, 9, 0, 0, TimeSpan.Zero);
        var invitation = ClientInvitation.Create(
            TenantId,
            "CLIENT@example.com",
            "Mira",
            "Haddad",
            null,
            new DateOnly(1995, 4, 2),
            now.AddDays(7),
            now);

        Assert.AreEqual(ClientInvitation.FirstLogicalSendGeneration, invitation.LogicalSendGeneration);

        var generation = invitation.BeginNewLogicalSend(now.AddDays(8), now.AddMinutes(1));

        Assert.AreEqual(2, generation);
        Assert.AreEqual(2, invitation.LogicalSendGeneration);
        Assert.AreEqual(2, invitation.SendCount);
        Assert.AreEqual(now.AddDays(8), invitation.ExpiresAtUtc);
        Assert.AreEqual("client@example.com", invitation.Email);
    }

    /// <summary>
    /// The other half of the same rule: only a person may advance a generation, and only while the
    /// invitation is still live. A revoked, accepted or expired invitation has nothing left to resend.
    /// </summary>
    [TestMethod]
    public void ARevokedInvitationCannotBeginANewLogicalSend()
    {
        var now = new DateTimeOffset(2026, 8, 20, 9, 0, 0, TimeSpan.Zero);
        var invitation = ClientInvitation.Create(
            TenantId,
            "client@example.com",
            "Mira",
            "Haddad",
            null,
            new DateOnly(1995, 4, 2),
            now.AddDays(7),
            now);
        invitation.Revoke(now.AddMinutes(1));

        Assert.Throws<InvalidOperationException>(() =>
            invitation.BeginNewLogicalSend(now.AddDays(8), now.AddMinutes(2)));
        Assert.AreEqual(ClientInvitation.FirstLogicalSendGeneration, invitation.LogicalSendGeneration);
    }

    [TestMethod]
    public void ClientOnboardingRequiresAdultBirthDateHeightAndGoal()
    {
        var profile = CreateProfile();
        var incomplete = Intake(birthDate: null, height: null, goals: null);

        Assert.Throws<InvalidOperationException>(() =>
            profile.CompleteOnboarding(
                incomplete,
                Today,
                new DateTimeOffset(2026, 8, 20, 9, 0, 0, TimeSpan.Zero)));
    }

    [TestMethod]
    public void ClientHeightPreservesEnteredUnitAndCanonicalCentimeters()
    {
        var profile = CreateProfile();

        profile.UpdateIntake(Intake(new DateOnly(1995, 4, 2), 70m, "Build strength"), Today);

        Assert.AreEqual(LengthUnit.Inch, profile.HeightEnteredUnit);
        Assert.AreEqual(70m, profile.HeightEnteredValue);
        Assert.AreEqual(177.80m, profile.HeightCentimeters);
    }

    [TestMethod]
    public void InitialBodyweightPreservesEntryAndCanonicalKilograms()
    {
        var observation = BodyweightObservation.CreateInitial(
            TenantId,
            Guid.Parse("30000000-0000-0000-0000-000000000001"),
            Today,
            220m,
            RecordedMassUnit.Pound);

        Assert.AreEqual(220m, observation.EnteredValue);
        Assert.AreEqual(RecordedMassUnit.Pound, observation.EnteredUnit);
        Assert.AreEqual(99.790m, observation.ValueKilograms);
    }

    private static ClientProfile CreateProfile() =>
        ClientProfile.CreateForAcceptedInvitation(
            TenantId,
            UserId,
            "Mira",
            "Haddad",
            "mira@example.com",
            null,
            null);

    private static ClientIntakeInput Intake(
        DateOnly? birthDate,
        decimal? height,
        string? goals) =>
        new(
            "Mira",
            "Haddad",
            null,
            birthDate,
            height,
            height is null ? null : LengthUnit.Inch,
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
