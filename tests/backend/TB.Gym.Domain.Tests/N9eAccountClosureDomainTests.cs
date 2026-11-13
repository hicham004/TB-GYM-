using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Closing an account (notes plan N9e, CLI-027): anonymising erases the person and keeps the facts. A client record
/// ends before it is anonymised, keeps every id, date and link, and loses every personal field; an accepted invitation
/// loses what the coach typed; a photo falls due for the purge at once; the record of a closing says who closed it.
/// </summary>
[TestClass]
public sealed class N9eAccountClosureDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000009e1");
    private static readonly Guid ClientUserId = Guid.Parse("20000000-0000-0000-0000-0000000009e1");
    private static readonly Guid OwnerUserId = Guid.Parse("20000000-0000-0000-0000-0000000009e2");
    private static readonly Guid AdminUserId = Guid.Parse("20000000-0000-0000-0000-0000000009e3");
    private static readonly DateOnly Today = new(2026, 11, 13);
    private static readonly DateTimeOffset Joined = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 10, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void AnonymisingErasesEveryPersonalFieldAndKeepsTheRecordsFacts()
    {
        var profile = CompletedProfile();
        profile.UpdateCoachNotes("Knee surgery in 2024; keep lunges light.");
        profile.Release(OwnerUserId, Now);

        var changed = profile.Anonymise(Now);

        Assert.AreEqual(ClientProfile.ClosedFirstName, profile.FirstName);
        Assert.AreEqual(ClientProfile.ClosedLastName, profile.LastName);
        Assert.AreEqual($"closed-{profile.Id:N}@closed.tbgym.invalid", profile.Email);
        Assert.AreEqual(profile.Email.ToUpperInvariant(), profile.NormalizedEmail);
        Assert.IsNull(profile.PhoneNumber);
        Assert.IsNull(profile.BirthDate);
        Assert.IsNull(profile.HeightCentimeters);
        Assert.IsNull(profile.HeightEnteredValue);
        Assert.IsNull(profile.HeightEnteredUnit);
        Assert.IsNull(profile.WorkType);
        Assert.IsNull(profile.AverageDailySteps);
        Assert.IsNull(profile.TrainingBackground);
        Assert.IsNull(profile.FoodPreferences);
        Assert.IsNull(profile.FoodAversions);
        Assert.IsNull(profile.Goals);
        Assert.IsNull(profile.Allergies);
        Assert.IsNull(profile.Medications);
        Assert.IsNull(profile.PreviousInjuries);
        Assert.IsNull(profile.CoachNotes);
        Assert.AreEqual(Now, profile.AnonymisedAtUtc);
        Assert.IsTrue(profile.IsAnonymised);

        // The facts hung on the record stay: who it was, in which space, with which coach, how far it got and when it ended.
        Assert.AreEqual(TenantId, profile.TenantId);
        Assert.AreEqual(ClientUserId, profile.UserId);
        Assert.AreEqual(OwnerUserId, profile.AssignedCoachUserId);
        Assert.AreEqual(ClientOnboardingStatus.Completed, profile.OnboardingStatus);
        Assert.AreEqual(Joined, profile.OnboardingCompletedAtUtc);
        Assert.AreEqual(Now, profile.ReleasedAtUtc);

        CollectionAssert.IsSubsetOf(
            ExpectedChangedFields,
            changed.ToArray(),
            "Every personal field that held something is named in the history.");
    }

    [TestMethod]
    public void OnlyAnEndedRecordIsAnonymisedAndOnlyOnce()
    {
        var profile = CompletedProfile();

        Assert.Throws<InvalidOperationException>(() => profile.Anonymise(Now), "A current client is left first.");
        Assert.IsFalse(profile.IsAnonymised);
        Assert.AreEqual("Mira", profile.FirstName);

        profile.Release(OwnerUserId, Now);
        profile.Anonymise(Now);
        var again = profile.Anonymise(Now.AddHours(1));

        Assert.IsEmpty(again, "A second anonymising changes nothing.");
        Assert.AreEqual(Now, profile.AnonymisedAtUtc, "An anonymising is never re-dated.");
        Assert.Throws<ClientReleasedException>(
            () => profile.UpdateCoachNotes("Back again?"),
            "An anonymised record stays read-only, as any ended record is.");
    }

    [TestMethod]
    public void TheHistoryOfAnAnonymisingNamesFieldsNeverValues()
    {
        var profile = CompletedProfile();
        profile.Release(OwnerUserId, Now);

        var change = ClientProfileChange.Create(TenantId, profile.Id, ClientChangeSource.AccountClosure, profile.Anonymise(Now));

        Assert.AreEqual(ClientChangeSource.AccountClosure, change.Source);
        StringAssert.Contains(change.ChangedFields, "Allergies");
        StringAssert.Contains(change.ChangedFields, "Medications");
        Assert.DoesNotContain("Peanuts", change.ChangedFields, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Mira", change.ChangedFields, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public void AnAcceptedInvitationLosesWhatTheCoachTypedAndAPendingOneIsNeverRetargeted()
    {
        var invitation = ClientInvitation.Create(
            TenantId,
            "mira.n9e@example.com",
            "Mira",
            "Haddad",
            "+961 70 000 000",
            new DateOnly(1995, 4, 2),
            Now.AddDays(7),
            Now.AddDays(-1),
            OwnerUserId);

        Assert.Throws<InvalidOperationException>(() => invitation.Anonymise(Now), "A pending invitation keeps its address.");
        Assert.AreEqual("mira.n9e@example.com", invitation.Email);

        invitation.MarkAccepted(ClientUserId, Now.AddHours(-1));
        invitation.Anonymise(Now);

        Assert.AreEqual($"closed-{invitation.Id:N}@closed.tbgym.invalid", invitation.Email);
        Assert.AreEqual(invitation.Email.ToUpperInvariant(), invitation.NormalizedEmail);
        Assert.AreEqual("Closed", invitation.FirstName);
        Assert.AreEqual("account", invitation.LastName);
        Assert.IsNull(invitation.PhoneNumber);
        Assert.IsNull(invitation.BirthDate);
        Assert.AreEqual(Now, invitation.AnonymisedAtUtc);
        Assert.AreEqual(InvitationStatus.Accepted, invitation.Status);
        Assert.AreEqual(ClientUserId, invitation.AcceptedByUserId, "How the person joined stays on record.");

        invitation.Anonymise(Now.AddHours(1));
        Assert.AreEqual(Now, invitation.AnonymisedAtUtc, "Anonymised once.");
    }

    [TestMethod]
    public void AClosedAccountsPhotoFallsDueForThePurgeAtOnceAndForgetsItsFileName()
    {
        var ready = Photo("mira-front.jpg");
        ready.PurgeForClosedAccount(Now);

        Assert.AreEqual(MediaAssetStatus.Tombstoned, ready.Status);
        Assert.AreEqual(Now, ready.TombstonedAtUtc);
        Assert.AreEqual(Now, ready.PurgeAfterUtc, "Due at once, not after the recoverable window.");
        Assert.IsNull(ready.OriginalFileName);

        var removedEarlier = Photo("mira-side.jpg");
        var earlier = Now.AddDays(-3);
        removedEarlier.MarkTombstoned(earlier, MediaRetentionPolicy.DeleteRetention, isHistoricallyReferenced: false);
        removedEarlier.PurgeForClosedAccount(Now);

        Assert.AreEqual(earlier, removedEarlier.TombstonedAtUtc, "An earlier removal keeps its day.");
        Assert.AreEqual(Now, removedEarlier.PurgeAfterUtc, "Its bytes fall due now instead of in four weeks.");
        Assert.IsNull(removedEarlier.OriginalFileName);
    }

    [TestMethod]
    public void AClosingIsRecordedAsThePersonsOwnOrAsTheAdminsOnARequestOfANamedDay()
    {
        var own = AccountClosure.Record(ClientUserId, AccountClosureSource.Self, ClientUserId, null, Now, 2, 3, 1);
        Assert.AreEqual(AccountClosureSource.Self, own.Source);
        Assert.IsNull(own.RequestedOn);
        Assert.AreEqual(2, own.SpacesLeft);
        Assert.AreEqual(3, own.RecordsAnonymised);
        Assert.AreEqual(1, own.PhotosRemoved);

        var onRequest = AccountClosure.Record(ClientUserId, AccountClosureSource.OnRequest, AdminUserId, Today, Now, 0, 1, 0);
        Assert.AreEqual(AdminUserId, onRequest.ClosedByUserId);
        Assert.AreEqual(Today, onRequest.RequestedOn);

        Assert.Throws<ArgumentException>(
            () => AccountClosure.Record(ClientUserId, AccountClosureSource.Self, AdminUserId, null, Now, 0, 0, 0),
            "Somebody else never closes an account as its person.");
        Assert.Throws<ArgumentException>(
            () => AccountClosure.Record(ClientUserId, AccountClosureSource.OnRequest, AdminUserId, null, Now, 0, 0, 0),
            "A closing on request names the day it was asked for.");
        Assert.Throws<ArgumentException>(
            () => AccountClosure.Record(ClientUserId, AccountClosureSource.Self, ClientUserId, Today, Now, 0, 0, 0),
            "A person's own closing names no request.");
        Assert.Throws<ArgumentOutOfRangeException>(
            () => AccountClosure.Record(ClientUserId, AccountClosureSource.Self, ClientUserId, null, Now, -1, 0, 0));
    }

    [TestMethod]
    public void TheDayAPersonAskedIsNoLaterThanTodayAnywhere()
    {
        var lateUtc = new DateTimeOffset(2026, 11, 13, 22, 30, 0, TimeSpan.Zero);

        Assert.IsTrue(AccountClosure.IsValidRequestedOn(new DateOnly(2026, 11, 13), lateUtc));
        Assert.IsTrue(
            AccountClosure.IsValidRequestedOn(new DateOnly(2026, 11, 14), lateUtc),
            "Already the 14th east of UTC, as in Beirut after 22:00 UTC in winter.");
        Assert.IsFalse(AccountClosure.IsValidRequestedOn(new DateOnly(2026, 11, 15), lateUtc));
        Assert.IsTrue(AccountClosure.IsValidRequestedOn(AccountClosure.EarliestRequestedOn, lateUtc));
        Assert.IsFalse(AccountClosure.IsValidRequestedOn(AccountClosure.EarliestRequestedOn.AddDays(-1), lateUtc));
    }

    private static readonly string[] ExpectedChangedFields =
    [
        "FirstName", "LastName", "Email", "PhoneNumber", "BirthDate", "Height", "WorkType", "AverageDailySteps",
        "TrainingBackground", "FoodPreferences", "FoodAversions", "Goals", "Allergies", "Medications",
        "PreviousInjuries", "CoachNotes", "AnonymisedAtUtc",
    ];

    private static ClientProfile CompletedProfile()
    {
        var profile = ClientProfile.CreateForAcceptedInvitation(
            TenantId,
            ClientUserId,
            OwnerUserId,
            "Mira",
            "Haddad",
            "mira.n9e@example.com",
            "+961 70 000 000",
            new DateOnly(1995, 4, 2));
        profile.CompleteOnboarding(
            new ClientIntakeInput(
                "Mira",
                "Haddad",
                "+961 70 000 000",
                new DateOnly(1995, 4, 2),
                168m,
                LengthUnit.Centimeter,
                "Office",
                7_000,
                "Three years of lifting",
                "Mediterranean",
                "Liver",
                "Build strength",
                "Peanuts",
                "Iron supplement",
                "Left knee, 2024"),
            Today,
            Joined);
        return profile;
    }

    private static MediaAsset Photo(string fileName) =>
        MediaAsset.RegisterUpload(
            TenantId,
            ClientUserId,
            "Progress photo Front 2026-11-01",
            MediaKind.Image,
            fileName,
            "image/jpeg",
            "image/jpeg",
            2_048,
            new string('a', 64),
            new StorageObjectLocator(TenantId, MediaStorageLocations.LocalV1, $"{TenantId:N}/{fileName}"),
            MediaPurpose.ProgressPhoto);
}
