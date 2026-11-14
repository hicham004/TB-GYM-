using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9d1b, waiting for a coach (C8, CLI-012, CLI-014): a client whose coach left the team, who accepted
/// an invitation after its coach had left, or who signed up into a house with no Coach has no coach until the Owner gives
/// them one; the Owner never gets them automatically. The record and its history name nobody for the wait, a pending
/// invitation of a departed coach names nobody, and the client hears when their coach leaves and when they have one; a
/// self-directed trainee hears, in words of their own, when their record goes to another member of the team.
/// </summary>
[TestClass]
public sealed class N9d1bWaitingDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000d91b0");
    private static readonly Guid ClientUserId = Guid.Parse("20000000-0000-0000-0000-0000000d91b1");
    private static readonly Guid OwnerUserId = Guid.Parse("20000000-0000-0000-0000-0000000d91b2");
    private static readonly Guid CoachUserId = Guid.Parse("20000000-0000-0000-0000-0000000d91b3");
    private static readonly Guid OtherCoachUserId = Guid.Parse("20000000-0000-0000-0000-0000000d91b4");
    private static readonly Guid ProfileId = Guid.Parse("30000000-0000-0000-0000-0000000d91b1");
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 9, 0, 0, TimeSpan.Zero);

    /// <summary>System words the glossary (UI plan section 6) keeps off screens, as A12 lists them.</summary>
    private static readonly string[] SystemWords = ["workspace", "service", "access", "enrollment", "activated"];

    // ---------- the client's record ----------

    [TestMethod]
    public void AClientWhoseInvitationNamesNobodyStartsWaitingAndIsNeverTheirOwnCoach()
    {
        var waiting = InvitedProfile(null);
        Assert.IsNull(waiting.AssignedCoachUserId);
        Assert.IsTrue(waiting.IsWaitingForCoach);
        Assert.IsFalse(waiting.IsSelfDirected, "An invited client is coached, once they have a coach.");
        Assert.IsFalse(waiting.IsReleased);

        var coached = InvitedProfile(CoachUserId);
        Assert.AreEqual(CoachUserId, coached.AssignedCoachUserId);
        Assert.IsFalse(coached.IsWaitingForCoach);

        // Null is nobody; an empty id is neither a coach nor nobody, and nobody is their own coach.
        Assert.ThrowsExactly<ArgumentException>(() => InvitedProfile(Guid.Empty));
        Assert.ThrowsExactly<ArgumentException>(() => InvitedProfile(ClientUserId));
    }

    [TestMethod]
    public void AHouseSignUpWithNoCoachWaitsAndStillTrainsAsTheirOwnCoach()
    {
        var waiting = HouseProfile(null);
        Assert.IsNull(waiting.AssignedCoachUserId, "The house's owner never gets the trainee automatically (C8).");
        Assert.IsTrue(waiting.IsWaitingForCoach);
        Assert.IsTrue(waiting.IsSelfDirected);

        var named = HouseProfile(CoachUserId);
        Assert.AreEqual(CoachUserId, named.AssignedCoachUserId);
        Assert.IsFalse(named.IsWaitingForCoach);

        Assert.ThrowsExactly<ArgumentException>(() => HouseProfile(Guid.Empty));
        Assert.ThrowsExactly<ArgumentException>(() => HouseProfile(ClientUserId));
    }

    [TestMethod]
    public void AClientWaitsOnceWhenTheirCoachLeavesAndIsGivenACoachFromWaiting()
    {
        var profile = InvitedProfile(CoachUserId);

        Assert.IsTrue(profile.WaitForCoach(), "Their coach left the team.");
        Assert.IsNull(profile.AssignedCoachUserId);
        Assert.IsTrue(profile.IsWaitingForCoach);
        Assert.IsFalse(profile.WaitForCoach(), "Waiting already: a repeated departure records no history.");
        Assert.IsTrue(profile.IsWaitingForCoach);

        // The owner gives them a coach, themselves included; a repeat changes nothing.
        Assert.IsTrue(profile.AssignCoach(OwnerUserId));
        Assert.AreEqual(OwnerUserId, profile.AssignedCoachUserId);
        Assert.IsFalse(profile.IsWaitingForCoach);
        Assert.IsFalse(profile.AssignCoach(OwnerUserId));
        Assert.IsTrue(profile.AssignCoach(OtherCoachUserId));
        Assert.AreEqual(OtherCoachUserId, profile.AssignedCoachUserId);
    }

    [TestMethod]
    public void AWaitingClientIsNeverGivenAnEmptyCoachOrThemselves()
    {
        var profile = InvitedProfile(null);

        Assert.ThrowsExactly<ArgumentException>(() => profile.AssignCoach(Guid.Empty));
        Assert.ThrowsExactly<ArgumentException>(() => profile.AssignCoach(ClientUserId));
        Assert.IsTrue(profile.IsWaitingForCoach, "A refused assignment leaves them waiting.");
        Assert.IsTrue(profile.AssignCoach(CoachUserId));
        Assert.AreEqual(CoachUserId, profile.AssignedCoachUserId);
    }

    [TestMethod]
    public void AWaitingClientIsMovedToTheOwnerBeforeBeingReleasedAndAReleasedOneNeverWaits()
    {
        var profile = InvitedProfile(CoachUserId);
        profile.WaitForCoach();

        Assert.ThrowsExactly<InvalidOperationException>(
            () => profile.Release(OwnerUserId, Now),
            "A released client always names the owner, as the record's keeper (ADR 0027).");
        Assert.IsFalse(profile.IsReleased);
        Assert.IsTrue(profile.IsWaitingForCoach);

        Assert.IsTrue(profile.AssignCoach(OwnerUserId));
        profile.Release(OwnerUserId, Now);
        Assert.IsTrue(profile.IsReleased);
        Assert.AreEqual(Now, profile.ReleasedAtUtc);

        Assert.ThrowsExactly<ClientReleasedException>(() => profile.WaitForCoach());
        Assert.AreEqual(OwnerUserId, profile.AssignedCoachUserId, "The keeper stays.");
        Assert.IsFalse(profile.IsWaitingForCoach);
    }

    [TestMethod]
    public void AClientReleasedWithNoWaitBeforeNeverWaitsEither()
    {
        // Released the ordinary way, with no wait before: the record refuses a wait all the same.
        var profile = InvitedProfile(OwnerUserId);
        profile.Release(OwnerUserId, Now);

        Assert.ThrowsExactly<ClientReleasedException>(() => profile.WaitForCoach());
        Assert.AreEqual(OwnerUserId, profile.AssignedCoachUserId);
    }

    // ---------- the coach history ----------

    [TestMethod]
    public void AFirstHistoryEntryMayNameNobodyButNeverAnEmptyCoach()
    {
        var invited = ClientCoachAssignment.ForInvitation(TenantId, ProfileId, null, Now);
        Assert.AreEqual(
            (1, (Guid?)null, (Guid?)null, ClientCoachAssignmentReason.Invitation, Now),
            (invited.Sequence, invited.CoachUserId, invited.PreviousCoachUserId, invited.Reason, invited.AssignedAtUtc));
        Assert.IsNull(invited.Note);
        Assert.AreEqual((TenantId, ProfileId), (invited.TenantId, invited.ClientProfileId));

        var signedUp = ClientCoachAssignment.ForSignUp(TenantId, ProfileId, null, Now);
        Assert.AreEqual(
            (1, (Guid?)null, (Guid?)null, ClientCoachAssignmentReason.SignUp, Now),
            (signedUp.Sequence, signedUp.CoachUserId, signedUp.PreviousCoachUserId, signedUp.Reason, signedUp.AssignedAtUtc));

        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForInvitation(TenantId, ProfileId, Guid.Empty, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForSignUp(TenantId, ProfileId, Guid.Empty, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForInvitation(TenantId, Guid.Empty, null, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForSignUp(TenantId, Guid.Empty, null, Now));
    }

    [TestMethod]
    public void AChangeFromWaitingNamesNobodyBeforeTheCoachItGives()
    {
        // Taking a waiting client is a reassignment with no previous coach; no new reason exists for it.
        var reassigned = ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 3, null, OtherCoachUserId, ClientCoachAssignmentReason.Reassigned, "  Mornings suit her.  ", Now);
        Assert.AreEqual(
            (3, (Guid?)OtherCoachUserId, (Guid?)null, ClientCoachAssignmentReason.Reassigned),
            (reassigned.Sequence, reassigned.CoachUserId, reassigned.PreviousCoachUserId, reassigned.Reason));
        Assert.AreEqual("Mornings suit her.", reassigned.Note);

        // A release or a leave from waiting names the owner as the record's keeper, after nobody.
        foreach (var reason in new[] { ClientCoachAssignmentReason.Released, ClientCoachAssignmentReason.ClientLeft })
        {
            var ended = ClientCoachAssignment.ForChange(TenantId, ProfileId, 3, null, OwnerUserId, reason, null, Now);
            Assert.AreEqual(
                (3, (Guid?)OwnerUserId, (Guid?)null, reason),
                (ended.Sequence, ended.CoachUserId, ended.PreviousCoachUserId, ended.Reason),
                reason.ToString());
        }

        // Nobody before is null, never an empty id, and a change always names a different coach.
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 3, Guid.Empty, OwnerUserId, ClientCoachAssignmentReason.Reassigned, null, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 3, OwnerUserId, OwnerUserId, ClientCoachAssignmentReason.Reassigned, null, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 3, null, Guid.Empty, ClientCoachAssignmentReason.Reassigned, null, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 1, null, OwnerUserId, ClientCoachAssignmentReason.Reassigned, null, Now));
    }

    [TestMethod]
    public void AChangeThatNamesACoachIsNeverADeparture()
    {
        static bool Taken(ClientCoachAssignmentReason reason)
        {
            try
            {
                return ClientCoachAssignment.ForChange(
                    TenantId, ProfileId, 2, CoachUserId, OwnerUserId, reason, null, Now).Reason == reason;
            }
            catch (ArgumentOutOfRangeException)
            {
                return false;
            }
        }

        Assert.AreEqual(
            "Reassigned, Released, ClientLeft",
            string.Join(", ", Enum.GetValues<ClientCoachAssignmentReason>().Where(Taken)),
            "A departure leaves the client waiting, so it goes through ForDeparture and never names the owner.");
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 2, CoachUserId, OwnerUserId, ClientCoachAssignmentReason.CoachRemoved, null, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForChange(
            TenantId, ProfileId, 2, CoachUserId, OwnerUserId, ClientCoachAssignmentReason.CoachResigned, null, Now));
    }

    [TestMethod]
    public void ADepartureNamesTheCoachWhoLeftAndNobodyAfterThem()
    {
        foreach (var reason in new[] { ClientCoachAssignmentReason.CoachRemoved, ClientCoachAssignmentReason.CoachResigned })
        {
            var entry = ClientCoachAssignment.ForDeparture(TenantId, ProfileId, 4, CoachUserId, reason, Now);

            Assert.AreEqual(
                (4, (Guid?)null, (Guid?)CoachUserId, reason, Now),
                (entry.Sequence, entry.CoachUserId, entry.PreviousCoachUserId, entry.Reason, entry.AssignedAtUtc),
                reason.ToString());
            Assert.IsNull(entry.Note, "A departure carries no note.");
            Assert.AreEqual((TenantId, ProfileId), (entry.TenantId, entry.ClientProfileId));
        }
    }

    [TestMethod]
    public void ADepartureIsOnlyACoachRemovedOrResigningAfterTheFirstEntryOfARealCoach()
    {
        static bool Taken(ClientCoachAssignmentReason reason)
        {
            try
            {
                return ClientCoachAssignment.ForDeparture(TenantId, ProfileId, 2, CoachUserId, reason, Now).Reason == reason;
            }
            catch (ArgumentOutOfRangeException)
            {
                return false;
            }
        }

        Assert.AreEqual(
            "CoachRemoved, CoachResigned",
            string.Join(", ", Enum.GetValues<ClientCoachAssignmentReason>().Where(Taken)));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForDeparture(
            TenantId, ProfileId, 2, CoachUserId, ClientCoachAssignmentReason.Reassigned, Now));

        // A departure follows the first entry; the coach who left is a real one; the client is named.
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForDeparture(
            TenantId, ProfileId, 1, CoachUserId, ClientCoachAssignmentReason.CoachRemoved, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ClientCoachAssignment.ForDeparture(
            TenantId, ProfileId, 0, CoachUserId, ClientCoachAssignmentReason.CoachRemoved, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForDeparture(
            TenantId, ProfileId, 2, Guid.Empty, ClientCoachAssignmentReason.CoachRemoved, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForDeparture(
            TenantId, Guid.Empty, 2, CoachUserId, ClientCoachAssignmentReason.CoachResigned, Now));
        Assert.ThrowsExactly<ArgumentException>(() => ClientCoachAssignment.ForDeparture(
            Guid.Empty, ProfileId, 2, CoachUserId, ClientCoachAssignmentReason.CoachResigned, Now));
    }

    // ---------- a departed coach's pending invitation ----------

    [TestMethod]
    public void APendingClientInvitationWaitsForACoachOnceAndOnlyWhilePending()
    {
        var invitation = PendingInvitation(CoachUserId);
        Assert.IsTrue(invitation.WaitForCoach());
        Assert.IsNull(invitation.AssignedCoachUserId, "Whoever accepts it lands waiting; the link keeps working.");
        Assert.AreEqual(InvitationStatus.Pending, invitation.Status);
        Assert.IsFalse(invitation.WaitForCoach(), "It names nobody already.");

        // One sent before coach assignment existed already names nobody.
        Assert.IsFalse(PendingInvitation(null).WaitForCoach());

        var accepted = PendingInvitation(CoachUserId);
        accepted.MarkAccepted(ClientUserId, Now.AddMinutes(1));
        Assert.ThrowsExactly<InvalidOperationException>(() => accepted.WaitForCoach());
        Assert.AreEqual(CoachUserId, accepted.AssignedCoachUserId, "An accepted invitation keeps who it was for.");

        var revoked = PendingInvitation(CoachUserId);
        revoked.Revoke(Now.AddMinutes(1));
        Assert.ThrowsExactly<InvalidOperationException>(() => revoked.WaitForCoach());

        var expired = PendingInvitation(CoachUserId);
        Assert.IsTrue(expired.MarkExpired(Now.AddDays(8)));
        Assert.ThrowsExactly<InvalidOperationException>(() => expired.WaitForCoach());

        var coach = ClientInvitation.CreateForCoach(TenantId, "rami@example.com", "Rami", "Khoury", Now.AddDays(7), Now);
        Assert.ThrowsExactly<InvalidOperationException>(() => coach.WaitForCoach(), "A coach invitation has no client to wait.");
    }

    // ---------- what the client and the owner are told ----------

    [TestMethod]
    public void TheWaitingNoticesSayTheseWordsAtTheseVersions()
    {
        Assert.AreEqual(
            new NotificationTemplate(
                "workspace.coach-assigned",
                1,
                "en",
                "You have a new coach",
                "Open Today to see who coaches you now. Your plan and history stay as they are."),
            Resolve(CommercialNotificationKind.CoachAssigned));
        Assert.AreEqual(
            new NotificationTemplate(
                "workspace.coach-departed",
                3,
                "en",
                "Your coach has left",
                "Your coaching space will give you a new coach and tell you when it does. Your plan and history stay as they are."),
            Resolve(CommercialNotificationKind.CoachDeparted));
        // A self-directed trainee trains as their own coach (CLI-026): what changed is who on the team sees their training.
        Assert.AreEqual(
            new NotificationTemplate(
                "workspace.trainee-staff-changed",
                1,
                "en",
                "Who can see your training changed",
                "Another member of your coaching space's team can now see your training and progress. Your plan and history stay as they are."),
            Resolve(CommercialNotificationKind.TraineeStaffChanged));
        Assert.AreEqual(
            new NotificationTemplate(
                "workspace.coach-resigned",
                3,
                "en",
                "A coach left your team",
                "Their clients now wait for a coach, as will anyone who accepts one of their invitations. Give each one a coach from Clients, yourself included."),
            Resolve(CommercialNotificationKind.CoachResigned));
    }

    [TestMethod]
    public void TheWaitingNoticesNameNobodyAndSpeakNoSystemWords()
    {
        foreach (var kind in new[]
        {
            CommercialNotificationKind.CoachAssigned,
            CommercialNotificationKind.TraineeStaffChanged,
            CommercialNotificationKind.CoachDeparted,
            CommercialNotificationKind.CoachResigned,
        })
        {
            var template = Resolve(kind);
            var words = template.Title + " " + template.Body;
            Assert.DoesNotContain("{", words, $"The {kind} notice composes nothing in: it names no coach and no client.");
            foreach (var word in SystemWords)
            {
                Assert.DoesNotContain(word, words, StringComparison.OrdinalIgnoreCase, $"The {kind} notice says '{word}'.");
            }

            // An Arabic workspace hears the same English words until Arabic is written (audit INV-8).
            Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, "ar-LB", out var arabic), kind.ToString());
            Assert.AreSame(template, arabic, kind.ToString());
        }
    }

    [TestMethod]
    public void ACoachAssignedNoticeIsAnInAppWorkspaceServiceNoticeAndNotATrainingOne()
    {
        Assert.AreEqual(17, (int)Enum.Parse<CommercialNotificationKind>("CoachAssigned"), "Stored by name; its number is its own.");
        Assert.IsTrue(NotificationPurposeCatalog.IsWorkspaceKind(CommercialNotificationKind.CoachAssigned));
        Assert.AreEqual(
            NotificationPurpose.ServiceTransactional,
            NotificationPurposeCatalog.For(CommercialNotificationKind.CoachAssigned));
        Assert.IsFalse(NotificationPurposeCatalog.IsTrainingKind(CommercialNotificationKind.CoachAssigned));

        // A service notice planned with no email and no push reaches the app alone.
        var channels = NotificationChannelPlanner.Plan(
            NotificationPurpose.ServiceTransactional,
            new NotificationChannelPlanInputs(false, false, false));
        Assert.AreEqual(NotificationChannel.InApp, channels.Single().Channel);

        // The departure stays a workspace kind too: its email is the workspace notice queue's, unchanged.
        Assert.IsTrue(NotificationPurposeCatalog.IsWorkspaceKind(CommercialNotificationKind.CoachDeparted));
        Assert.IsTrue(NotificationPurposeCatalog.IsWorkspaceKind(CommercialNotificationKind.CoachResigned));
        var email = WorkspaceNoticeEmailTemplates.Render(WorkspaceNoticeKind.CoachDeparted);
        Assert.AreEqual(WorkspaceNoticeEmailTemplates.CoachDepartedKey, email.TemplateKey);
        Assert.Contains("assign you a new coach", email.Body);
    }

    [TestMethod]
    public void ATraineeStaffChangedNoticeIsAnInAppWorkspaceServiceNoticeAndNotATrainingOne()
    {
        Assert.AreEqual(18, (int)Enum.Parse<CommercialNotificationKind>("TraineeStaffChanged"), "Stored by name; its number is its own.");
        Assert.IsTrue(NotificationPurposeCatalog.IsWorkspaceKind(CommercialNotificationKind.TraineeStaffChanged));
        Assert.AreEqual(
            NotificationPurpose.ServiceTransactional,
            NotificationPurposeCatalog.For(CommercialNotificationKind.TraineeStaffChanged));
        Assert.IsFalse(NotificationPurposeCatalog.IsTrainingKind(CommercialNotificationKind.TraineeStaffChanged));

        // Its own words, not CoachAssigned's: a trainee has no new coach to read on Today.
        Assert.AreNotEqual(
            Resolve(CommercialNotificationKind.CoachAssigned).Key,
            Resolve(CommercialNotificationKind.TraineeStaffChanged).Key);
        Assert.DoesNotContain("coach", Resolve(CommercialNotificationKind.TraineeStaffChanged).Title, StringComparison.OrdinalIgnoreCase);
    }

    private static NotificationTemplate Resolve(CommercialNotificationKind kind)
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, "en", out var template), kind.ToString());
        return template;
    }

    private static ClientProfile InvitedProfile(Guid? coachUserId) =>
        ClientProfile.CreateForAcceptedInvitation(
            TenantId,
            ClientUserId,
            coachUserId,
            "Mira",
            "Haddad",
            "mira@example.com",
            null,
            null);

    private static ClientProfile HouseProfile(Guid? coachUserId) =>
        ClientProfile.CreateForHouseSignUp(
            TenantId,
            ClientUserId,
            coachUserId,
            "Lina",
            "Haddad",
            "lina@example.com",
            new DateOnly(2001, 5, 3));

    private static ClientInvitation PendingInvitation(Guid? coachUserId) =>
        ClientInvitation.Create(
            TenantId,
            "mira@example.com",
            "Mira",
            "Haddad",
            null,
            null,
            Now.AddDays(7),
            Now,
            coachUserId);
}
