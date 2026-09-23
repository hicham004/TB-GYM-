using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Domain.Tests;

/// <summary>Gym team support (ADR 0026): coach membership, client assignment and coach invitations.</summary>
[TestClass]
public sealed class TeamCoachAssignmentDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000026");
    private static readonly Guid ClientUserId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid CoachUserId = Guid.Parse("20000000-0000-0000-0000-000000000003");
    private static readonly DateTimeOffset Now = new(2026, 9, 23, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void AClientStartsWithTheCoachWhoseInvitationTheyAccepted()
    {
        var profile = CreateProfile(CoachUserId);

        Assert.AreEqual(CoachUserId, profile.AssignedCoachUserId);
    }

    [TestMethod]
    public void AClientCannotBeTheirOwnCoachOrHaveNone()
    {
        Assert.Throws<ArgumentException>(() => CreateProfile(ClientUserId));
        Assert.Throws<ArgumentException>(() => CreateProfile(Guid.Empty));

        var profile = CreateProfile(OwnerUserId);
        Assert.Throws<ArgumentException>(() => profile.AssignCoach(ClientUserId));
        Assert.Throws<ArgumentException>(() => profile.AssignCoach(Guid.Empty));
        Assert.AreEqual(OwnerUserId, profile.AssignedCoachUserId);
    }

    [TestMethod]
    public void ReassigningToTheSameCoachChangesNothing()
    {
        var profile = CreateProfile(OwnerUserId);

        Assert.IsFalse(profile.AssignCoach(OwnerUserId), "A repeated request records no history.");
        Assert.IsTrue(profile.AssignCoach(CoachUserId));
        Assert.AreEqual(CoachUserId, profile.AssignedCoachUserId);
    }

    [TestMethod]
    public void TheFirstHistoryEntryNamesNoPredecessor()
    {
        var entry = ClientCoachAssignment.ForInvitation(TenantId, Guid.NewGuid(), CoachUserId, Now);

        Assert.AreEqual(1, entry.Sequence);
        Assert.IsNull(entry.PreviousCoachUserId);
        Assert.AreEqual(ClientCoachAssignmentReason.Invitation, entry.Reason);
        Assert.AreEqual(Now, entry.AssignedAtUtc);
    }

    [TestMethod]
    public void ALaterHistoryEntryNamesTheDifferentCoachItReplaced()
    {
        var clientProfileId = Guid.NewGuid();
        var entry = ClientCoachAssignment.ForChange(
            TenantId,
            clientProfileId,
            2,
            OwnerUserId,
            CoachUserId,
            ClientCoachAssignmentReason.Reassigned,
            "  Evening sessions suit Sam better.  ",
            Now);

        Assert.AreEqual(2, entry.Sequence);
        Assert.AreEqual(OwnerUserId, entry.PreviousCoachUserId);
        Assert.AreEqual("Evening sessions suit Sam better.", entry.Note);

        Assert.Throws<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForChange(
            TenantId, clientProfileId, 1, OwnerUserId, CoachUserId, ClientCoachAssignmentReason.Reassigned, null, Now));
        Assert.Throws<ArgumentException>(() => ClientCoachAssignment.ForChange(
            TenantId, clientProfileId, 2, CoachUserId, CoachUserId, ClientCoachAssignmentReason.Reassigned, null, Now));
        Assert.Throws<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForChange(
            TenantId, clientProfileId, 2, OwnerUserId, CoachUserId, ClientCoachAssignmentReason.Invitation, null, Now));
        Assert.Throws<ArgumentException>(() => ClientCoachAssignment.ForChange(
            TenantId,
            clientProfileId,
            2,
            OwnerUserId,
            CoachUserId,
            ClientCoachAssignmentReason.Reassigned,
            new string('x', ClientCoachAssignment.NoteMaximumLength + 1),
            Now));
    }

    [TestMethod]
    public void OnlyAnActiveCoachCanBeRemovedAndOnlyARemovedCoachCanRejoin()
    {
        var owner = TenantMembership.Create(TenantId, OwnerUserId, TenantRole.Owner);
        var client = TenantMembership.Create(TenantId, ClientUserId, TenantRole.Client);
        var coach = TenantMembership.Create(TenantId, CoachUserId, TenantRole.Coach);

        Assert.Throws<InvalidOperationException>(owner.RemoveCoach, "The owner is never removed from the team.");
        Assert.Throws<InvalidOperationException>(client.RemoveCoach, "A client is not a coach.");
        Assert.Throws<InvalidOperationException>(coach.RejoinAsCoach, "An active coach has nothing to rejoin.");

        Assert.IsTrue(coach.IsActiveStaff);
        coach.RemoveCoach();
        Assert.AreEqual(MembershipStatus.Removed, coach.Status);
        Assert.IsFalse(coach.IsActiveStaff);
        Assert.Throws<InvalidOperationException>(coach.RemoveCoach, "Removal happens once.");

        coach.RejoinAsCoach();
        Assert.AreEqual(MembershipStatus.Active, coach.Status);
        Assert.AreEqual(TenantRole.Coach, coach.Role);
        Assert.IsTrue(owner.IsActiveStaff);
        Assert.IsFalse(client.IsActiveStaff);
    }

    [TestMethod]
    public void ACoachInvitationCarriesNoClientPrefillAndNobodyToBeAssignedTo()
    {
        var invitation = ClientInvitation.CreateForCoach(
            TenantId,
            " Coach@Example.com ",
            "Rami",
            "Khoury",
            Now.AddDays(7),
            Now);

        Assert.AreEqual(InvitationKind.Coach, invitation.Kind);
        Assert.AreEqual("coach@example.com", invitation.Email);
        Assert.IsNull(invitation.AssignedCoachUserId);
        Assert.IsNull(invitation.PhoneNumber);
        Assert.IsNull(invitation.BirthDate);
        Assert.Throws<InvalidOperationException>(() => invitation.HandOverTo(OwnerUserId));
    }

    [TestMethod]
    public void APendingClientInvitationIsHandedToTheOwnerWhenItsCoachLeaves()
    {
        var invitation = ClientInvitation.Create(
            TenantId,
            "client@example.com",
            "Mira",
            "Haddad",
            null,
            null,
            Now.AddDays(7),
            Now,
            CoachUserId);
        Assert.AreEqual(InvitationKind.Client, invitation.Kind);
        Assert.AreEqual(CoachUserId, invitation.AssignedCoachUserId);

        Assert.IsTrue(invitation.HandOverTo(OwnerUserId));
        Assert.IsFalse(invitation.HandOverTo(OwnerUserId));
        Assert.AreEqual(OwnerUserId, invitation.AssignedCoachUserId);

        invitation.Revoke(Now.AddMinutes(1));
        Assert.Throws<InvalidOperationException>(() => invitation.HandOverTo(CoachUserId));
        Assert.Throws<ArgumentException>(() => ClientInvitation.Create(
            TenantId, "other@example.com", "A", "B", null, null, Now.AddDays(7), Now, Guid.Empty));
    }

    [TestMethod]
    public void ACoachInvitationEmailUsesItsOwnPublishedWording()
    {
        var coach = InvitationActionEmailTemplates.Render("https://tbgym.test/invite?token=x", InvitationKind.Coach);
        var client = InvitationActionEmailTemplates.Render("https://tbgym.test/invite?token=x");

        Assert.AreEqual(InvitationActionEmailTemplates.CoachInviteKey, coach.TemplateKey);
        Assert.AreEqual(InvitationActionEmailTemplates.InviteKey, client.TemplateKey);
        CollectionAssert.Contains(InvitationActionEmailTemplates.PublishedKeys.ToList(), coach.TemplateKey);
        Assert.Contains("as a coach", coach.Body);
        Assert.Contains("https://tbgym.test/invite?token=x", coach.Body);
    }

    private static ClientProfile CreateProfile(Guid coachUserId) =>
        ClientProfile.CreateForAcceptedInvitation(
            TenantId,
            ClientUserId,
            coachUserId,
            "Mira",
            "Haddad",
            "mira@example.com",
            null,
            null);
}
