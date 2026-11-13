using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Progress;
using N9eStoredProfile = TB.Gym.Modules.Clients.ClientProfile;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9e, closing and anonymising an account (CLI-027): a client closes their own account with their
/// password, or the platform admin closes it on their request of a named day. Every coaching space they are a client
/// of is left as Leave leaves it, every client record of theirs, current or earlier, in every space is anonymised, the
/// invitations they accepted lose what was typed about them, their declared allergens go, their photos are removed and
/// purged at once, a sign-up still waiting is deleted, and the account is emptied so it never signs in again while its
/// email is free for a new person. Payments, plans, workouts and records stay under the anonymous record (SYS-004), the
/// database still refuses to delete or rewrite any of it, and a staff or platform admin account is not closed here.
/// Every name, address and health detail is invented, and each is unusual enough that finding it in a log is a leak.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9eCloseUrl = "/api/auth/account/close";

    private const string N9eAdminCloseUrl = "/api/platform-admin/accounts/close";

    private const string N9eLeftReason = "The client closed their TB Gym account.";

    private const string N9eClosureReason = "Closed because the client closed their TB Gym account.";

    private const string N9ePhotoReason = "Removed because the client closed their TB Gym account.";

    private const string N9eFirstName = "Zenobia";

    private const string N9eLastName = "Quarrington";

    private const string N9ePhone = "+96171555123";

    private const string N9eBirthDate = "1991-06-14";

    private const string N9eWorkType = "Night-shift pharmacist";

    private const string N9eBackground = "Rowing at the Kaslik club";

    private const string N9eFoodPreferences = "Lentil stews with sumac";

    private const string N9eFoodAversions = "Pickled turnip";

    private const string N9eGoals = "Deadlift 140 kg by spring";

    private const string N9eAllergies = "Penicillin rash, also Xylocaine";

    private const string N9eMedications = "Lisinopril 10 mg nightly";

    private const string N9eInjuries = "Left ACL reconstruction in 2019";

    private const string N9eCoachNotes = "Watch the left knee on walking lunges";

    private static readonly string[] N9ePasswordField = ["password"];

    private static readonly string[] N9eEmailField = ["email"];

    private static readonly string[] N9eRequestedOnField = ["requestedOn"];

    private static readonly string[] N9eEveryAdminField = ["email", "requestedOn"];

    private static readonly string[] N9eAllergenCodes = ["Milk", "Peanuts"];

    /// <summary>The reason the client typed when they removed a photo themselves, before closing.</summary>
    private static readonly string[] N9eEarlierRemovalReason = ["Wrong pose captured."];

    /// <summary>What a house trainee's record holds from the sign-up form, each field changed by the closing.</summary>
    private static readonly string[] N9eHouseRecordFields = ["AnonymisedAtUtc", "BirthDate", "Email", "FirstName", "LastName"];

    /// <summary>What a record set up by its client and written about by the coach also held.</summary>
    private static readonly string[] N9eSetUpRecordFields =
    [
        "PhoneNumber", "Height", "WorkType", "AverageDailySteps", "TrainingBackground", "FoodPreferences", "FoodAversions",
        "Goals", "Allergies", "Medications", "PreviousInjuries", "CoachNotes",
    ];

    // ---------- 1. what closing erases and keeps ----------

    [TestMethod]
    public async Task N9eAClientOfACoachAndOfTheHouseClosesTheirAccountAndIsAnonymisedEverywhereWhileTheFactsStay()
    {
        const string email = "n9e-whole-zenobia@example.test";
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-whole-owner@example.test", "Nadim Owner", "N9e Whole Gym");
        var ownerUserId = await N9a1UserIdAsync(owner);
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "n9e-whole-coach@example.test", "Joelle Coach");

        // The first relationship: invited, set up with health details, written about by the coach, then left.
        using var client = CreateClient();
        var oldId = await N9eInviteAsync(coach, client, tenant, email, newAccount: true);
        var userId = await N9a1UserIdAsync(client);
        await N9eCompleteOnboardingAsync(client);
        await N9eCoachNotesAsync(coach, oldId);
        await N9a1LeaveAsync(client, "Moving to Tripoli for a while");

        // Invited back with the same account: the earlier record stays, ended, beside a new one.
        var currentId = await N9eInviteAsync(coach, client, tenant, email, newAccount: false);
        Assert.AreNotEqual(oldId, currentId);
        await N9eCompleteOnboardingAsync(client);
        await N9eCoachNotesAsync(coach, currentId);
        await R53dStartNutritionAsync(coach, currentId);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/nutrition/clients/{currentId}/allergens", new { codes = N9eAllergenCodes }),
            HttpStatusCode.OK);
        var resources = await CreateTrainingResourcesAsync(coach, currentId, 8, 2, TenantToday());
        var block = await AssignAsync(coach, currentId, resources, TenantToday());
        var paid = await CreatePaidMessagingEnrollmentAsync(owner, currentId, 45m);
        await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 82.5m, "Kilogram", 8m));
        var photo = await UploadProgressPhotoAsync(client, $"/api/progress/me/photos?pose=Front&photoDate={N9a1Day(TenantToday())}");

        // The same person is also a trainee of the house, signed up from their signed-in account.
        using var house = await N9a1OpenHouseAsync("n9e-whole");
        var joined = await N9a1SignUpAsync(client, email, N9eFirstName, N9eLastName, N9eBirthDate, withPassword: false);
        await AssertStatusAsync(joined, HttpStatusCode.OK);
        SetTenant(client, house.TenantId);
        var houseId = (await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"))).Id;

        // The earlier leaving's notices are delivered now, naming the person: a delivered notice is a snapshot and stays.
        await SweepDepartureNotificationsAsync();
        foreach (var staff in new[] { owner, coach })
        {
            var told = (await RequiredJsonAsync<N9eInbox>(await staff.GetAsync("/api/notifications"))).Items
                .Single(item => item.Kind == "ClientLeft");
            Assert.AreEqual($"{N9eFirstName} {N9eLastName} left your coaching space", told.Title);
        }

        var noticesBefore = await N9eNotificationIdsAsync();

        // What there is before: three records of the person, two current, with everything the test typed.
        var before = await N9eProfilesAsync(userId);
        Assert.HasCount(3, before);
        Assert.IsTrue(before.All(profile => profile.AnonymisedAtUtc is null));
        Assert.AreEqual(N9eAllergies, before.Single(profile => profile.Id == oldId).Allergies);
        Assert.AreEqual(N9eCoachNotes, before.Single(profile => profile.Id == currentId).CoachNotes);
        Assert.AreEqual(2L, await N9eCountAsync("""SELECT count(*) FROM nutrition."ClientDeclaredAllergens" WHERE "ClientProfileId" = @id""", currentId));
        Assert.AreEqual("progress.jpg", (await N9eAssetAsync(photo.MediaAssetId)).OriginalFileName);
        var facts = await N9eFactsAsync(currentId, paid.Id);
        Assert.AreEqual(new N9eFacts(3, 1, 1, 1, 1, 1, 1, 1), facts, "The plans, the payment, the workout, its set, the max, the working max, the weigh-in, the program.");
        var stampBefore = (await N9a1AccountAsync(userId)).SecurityStamp;
        Assert.AreNotEqual(
            "Completed",
            await N9eScalarAsync("""SELECT "Status" FROM training."Mesocycles" WHERE "Id" = @id""", ("id", block.Id)),
            "The program runs on past the finished workout.");

        // The person closes their account with their password.
        var closedAt = RequiredTestClock.UtcNow;
        var logBefore = RequiredEveryLogLine.Text.Length;
        await AssertStatusAsync(await N9eCloseAsync(client, Password), HttpStatusCode.NoContent);

        // Every membership ended.
        CollectionAssert.AreEquivalent(
            new[] { (tenant, "Client", "Removed"), (house.TenantId, "Client", "Removed") },
            await N9eMembershipsAsync(userId));

        // Every record of theirs, in both spaces, anonymised in the same way, and each change kept by field name alone.
        var after = await N9eProfilesAsync(userId);
        Assert.HasCount(3, after, "No record is deleted.");
        foreach (var profile in after)
        {
            N9eAssertAnonymised(profile, closedAt);
        }

        Assert.IsTrue(after.Single(profile => profile.Id == houseId).IsSelfDirected);
        var changes = await N9eChangesAsync(after.Select(profile => profile.Id).ToArray());
        CollectionAssert.AreEquivalent(new[] { oldId, currentId, houseId }, changes.Select(change => change.ClientProfileId).ToArray());
        foreach (var change in changes)
        {
            // The fields that held something, by name: the house's record had only what the sign-up form asked.
            var fields = change.ChangedFields.Split(',');
            CollectionAssert.IsSubsetOf(N9eHouseRecordFields, fields, change.ChangedFields);
            if (change.ClientProfileId != houseId)
            {
                CollectionAssert.IsSubsetOf(N9eSetUpRecordFields, fields, change.ChangedFields);
            }

            Assert.DoesNotContain(N9eFirstName, change.ChangedFields, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(N9eAllergies, change.ChangedFields, StringComparison.OrdinalIgnoreCase);
        }

        // Each space records the leaving, with the closing's reason, for the two records that were current.
        foreach (var id in new[] { currentId, houseId })
        {
            Assert.AreEqual(
                1L,
                await N9eCountAsync(
                    """SELECT count(*) FROM clients."ClientRelationshipEvents" WHERE "ClientProfileId" = @id AND "EventType" = 'Left' AND "Reason" = 'The client closed their TB Gym account.'""",
                    id));
        }

        // The invitations they accepted keep nothing that was typed about them.
        var invitations = await N9eAcceptedInvitationsAsync(userId);
        Assert.HasCount(2, invitations);
        foreach (var invitation in invitations)
        {
            var address = $"closed-{invitation.Id:N}@closed.tbgym.invalid";
            Assert.AreEqual(("Closed", "account", address, address.ToUpperInvariant()), (invitation.FirstName, invitation.LastName, invitation.Email, invitation.NormalizedEmail));
            Assert.IsNull(invitation.PhoneNumber);
            Assert.IsNull(invitation.BirthDate);
            Assert.IsNotNull(invitation.AnonymisedAtUtc);
            Assert.AreEqual("Accepted", invitation.Status.ToString());
        }

        // The declared allergens are gone.
        Assert.AreEqual(0L, await N9eCountAsync("""SELECT count(*) FROM nutrition."ClientDeclaredAllergens" WHERE "ClientProfileId" = @id""", currentId));

        // The photo is removed with its reason, its bytes are due for the purge now and the device's file name is gone.
        var removed = await N9ePhotoAsync(photo.Id);
        Assert.AreEqual(ProgressPhotoStatus.Removed, removed.Status);
        Assert.AreEqual(N9ePhotoReason, (await N9ePhotoRemovalsAsync(photo.Id)).Single());
        var tombstoned = await N9eAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, tombstoned.Status);
        Assert.IsNotNull(tombstoned.PurgeAfterUtc);
        Assert.IsTrue(tombstoned.PurgeAfterUtc <= RequiredTestClock.UtcNow, "Due at once, not after the recoverable window.");
        Assert.IsNull(tombstoned.OriginalFileName);
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var outcome = await scope.ServiceProvider.GetRequiredService<IMediaPurgeService>().PurgeDueAsync(50, CancellationToken.None);
            Assert.IsGreaterThanOrEqualTo(1, outcome.Purged, $"The purge purged {outcome.Purged} and failed {outcome.Failed}.");
        }

        var purged = await N9eAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
        Assert.IsNull(purged.StorageKey);

        // The facts stay, in the same numbers: the plans (now cancelled), the payment, the finished workout and its
        // set, the maxes, the weigh-in and the program.
        Assert.AreEqual(facts, await N9eFactsAsync(currentId, paid.Id));
        Assert.AreEqual(
            3L,
            await N9eCountAsync(
                """SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "ClientProfileId" = @id AND "Status" = 'Cancelled' AND "StatusReason" = 'Closed because the client closed their TB Gym account.'""",
                currentId));
        // The program still running, its first week's workout finished, is cancelled as Leave cancels one.
        Assert.AreEqual(
            "Cancelled",
            await N9eScalarAsync("""SELECT "Status" FROM training."Mesocycles" WHERE "Id" = @id""", ("id", block.Id)));
        Assert.AreEqual(
            1L,
            await N9eCountAsync(
                $"""SELECT count(*) FROM training."MesocycleLifecycleEvents" WHERE "MesocycleId" = @id AND "EventType" = 'Cancelled' AND "Reason" = '{N9eClosureReason}'""",
                block.Id));

        // One record of the closing, the person's own, with what it did.
        var closure = (await N9eClosuresAsync(userId)).Single();
        Assert.AreEqual((AccountClosureSource.Self, userId, (DateOnly?)null), (closure.Source, closure.ClosedByUserId, closure.RequestedOn));
        Assert.AreEqual((2, 3, 1), (closure.SpacesLeft, closure.RecordsAnonymised, closure.PhotosRemoved));
        N9eAssertNear(closedAt, closure.ClosedAtUtc, "the closing");

        // The account itself is emptied: an address naming nobody, no name, no password, locked, every session spent.
        var account = await N9a1AccountAsync(userId);
        var closedAddress = $"closed-{userId:N}@closed.tbgym.invalid";
        Assert.AreEqual((closedAddress, closedAddress, closedAddress.ToUpperInvariant(), string.Empty), (account.Email, account.UserName, account.NormalizedEmail, account.DisplayName));
        Assert.IsFalse(account.HasPassword);
        Assert.IsTrue(account.LockoutEnd > closedAt.AddYears(99), "Locked for good.");
        Assert.AreNotEqual(stampBefore, account.SecurityStamp);
        Assert.AreEqual(0, await N9a1AccountsAsync(email));

        // The coaching space's owner and the coach are each told in-app; the house, whose trainee was self-directed, is not.
        Assert.AreEqual(2L, await N9a1QueuedAsync("ClientLeft", "AggregateId", currentId));
        foreach (var staff in new[] { ownerUserId, coachUserId })
        {
            Assert.AreEqual(
                1L,
                await N9eCountAsync(
                    """SELECT count(*) FROM notifications."OutboxItems" WHERE "Kind" = 'ClientLeft' AND "AggregateId" = @id AND "RecipientUserId" = @staff""",
                    currentId,
                    ("staff", staff)));
        }

        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientLeft", "AggregateId", houseId));
        Assert.AreEqual(0L, await N9eCountAsync("""SELECT count(*) FROM notifications."OutboxItems" WHERE "RecipientUserId" = @id""", house.OwnerUserId));

        // The confirmed sign-up row holds ids only and stays.
        Assert.AreEqual(1L, await N9eCountAsync("""SELECT count(*) FROM tenancy."TraineeSignUps" WHERE "UserId" = @id AND "ConfirmedAtUtc" IS NOT NULL""", userId));

        // The closing session is signed out.
        Assert.IsFalse(await N9eSignedInAsync(client));

        // Nothing the person typed or had typed about them reached a log line while the account closed and its photo
        // was purged; what the log does say is the counts.
        var log = RequiredEveryLogLine.Text[logBefore..];
        foreach (var secret in new[]
        {
            email, "n9e-whole-zenobia", N9eFirstName, N9eLastName, N9ePhone, "71555123", N9eBirthDate, "14/06/1991", "06/14/1991",
            N9eWorkType, N9eBackground, N9eFoodPreferences, N9eFoodAversions, N9eGoals, N9eAllergies, "Penicillin", "Xylocaine",
            N9eMedications, "Lisinopril", N9eInjuries, "reconstruction", N9eCoachNotes, "Kaslik", "progress.jpg",
        })
        {
            Assert.DoesNotContain(secret, log, StringComparison.OrdinalIgnoreCase, $"The log holds '{secret}'.");
        }

        Assert.Contains(
            "An account was closed (Self): 2 coaching spaces left, 3 client records anonymised, 1 photos removed.",
            log);

        // Delivered, the closing's notices tell the owner and the coach that a closed account left, and no notice the
        // closing made names the person anywhere.
        await SweepDepartureNotificationsAsync();
        foreach (var staff in new[] { owner, coach })
        {
            var leftNotices = (await RequiredJsonAsync<N9eInbox>(await staff.GetAsync("/api/notifications"))).Items
                .Where(item => item.Kind == "ClientLeft")
                .ToArray();
            Assert.HasCount(2, leftNotices, "The earlier leaving's notice and the closing's.");
            Assert.AreEqual("Closed account left your coaching space", leftNotices.Single(item => !noticesBefore.Contains(item.Id)).Title);
            Assert.AreEqual(
                $"{N9eFirstName} {N9eLastName} left your coaching space",
                leftNotices.Single(item => noticesBefore.Contains(item.Id)).Title,
                "A notice delivered before the closing is a snapshot and keeps its words.");
        }

        var made = (await N9eNotificationsAsync()).Where(notice => !noticesBefore.Contains(notice.Id)).ToArray();
        CollectionAssert.AreEquivalent(
            new[] { ownerUserId, coachUserId },
            made.Where(notice => notice.Kind == "ClientLeft").Select(notice => notice.RecipientUserId).ToArray());
        Assert.IsFalse(made.Any(notice => notice.RecipientUserId == house.OwnerUserId), "The house's staff are told nothing.");
        foreach (var notice in made)
        {
            foreach (var secret in new[] { N9eFirstName, N9eLastName, email, N9eAllergies, N9eCoachNotes })
            {
                Assert.DoesNotContain(secret, notice.Title + " " + notice.Body, StringComparison.OrdinalIgnoreCase, $"A {notice.Kind} notice names '{secret}'.");
            }
        }
    }

    // ---------- 2. signing in afterwards ----------

    [TestMethod]
    public async Task N9eAClosedAccountNeverSignsInAgainEverySessionEndsAndItsEmailReturnsAsANewPerson()
    {
        const string email = "n9e-again-client@example.test";
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-again-owner@example.test", "Rami Owner", "N9e Again Gym");
        using var client = CreateClient();
        var oldId = await N9eInviteAsync(owner, client, tenant, email, newAccount: true, "Ottilie", "Fanshawe");
        var oldUserId = await N9a1UserIdAsync(client);

        // A second session of the same account, in another browser.
        using var other = CreateClient();
        await AssertStatusAsync(await N9eLoginAsync(other, email), HttpStatusCode.OK);
        SetTenant(other, tenant);
        await AssertStatusAsync(await other.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);

        await AssertStatusAsync(await N9eCloseAsync(client, Password), HttpStatusCode.NoContent);

        // The other session's cookie is dead at once: a client route refuses it and the account reads as nobody.
        await AssertStatusAsync(await other.GetAsync("/api/client-profile/me"), HttpStatusCode.Unauthorized);
        Assert.IsFalse(await N9eSignedInAsync(other));
        Assert.IsFalse(await N9eSignedInAsync(client));
        await AssertStatusAsync(await client.GetAsync("/api/client-profile/me"), HttpStatusCode.Unauthorized);

        // The old email and password sign in to nothing, from a new browser too.
        using var fresh = CreateClient();
        await AssertStatusAsync(await N9eLoginAsync(fresh, email), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await N9eLoginAsync(client, email), HttpStatusCode.Unauthorized);
        Assert.IsFalse(await N9eSignedInAsync(fresh));

        // The email is free: the coach invites it again and a new person accepts, with a new account of their own.
        using var newcomer = CreateClient();
        var newId = await N9eInviteAsync(owner, newcomer, tenant, email, newAccount: true, "Wilhelmina", "Thornbury");
        var newUserId = await N9a1UserIdAsync(newcomer);
        Assert.AreNotEqual(oldUserId, newUserId, "A new person, not the closed account back.");
        Assert.AreNotEqual(oldId, newId);
        var self = await RequiredJsonAsync<N9a1Self>(await newcomer.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((newId, "Wilhelmina", "Thornbury", email), (self.Id, self.FirstName, self.LastName, self.Email));
        using var again = CreateClient();
        await AssertStatusAsync(await N9eLoginAsync(again, email), HttpStatusCode.OK);
        Assert.AreEqual(newUserId, await N9a1UserIdAsync(again));

        // The closed account stays closed and its old record stays anonymous beside the newcomer's.
        Assert.AreEqual($"closed-{oldUserId:N}@closed.tbgym.invalid", (await N9a1AccountAsync(oldUserId)).Email);
        N9eAssertAnonymised((await N9eProfilesAsync(oldUserId)).Single(), null);
        Assert.AreEqual(1, await N9a1AccountsAsync(email));
        var current = await RequiredJsonAsync<TeamClient[]>(await owner.GetAsync("/api/clients"));
        Assert.AreEqual(newId, current.Single().Id);
    }

    // ---------- 3. the database's guards ----------

    [TestMethod]
    public async Task N9eTheDatabaseRefusesToDeleteOrRewriteAnAnonymisedRecordOrTheRecordOfItsClosing()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-guard-owner@example.test", "Hiba Owner", "N9e Guard Gym");
        using var closing = CreateClient();
        var closedId = await N9eInviteAsync(owner, closing, tenant, "n9e-guard-closing@example.test", newAccount: true, "Philippa", "Gresham");
        var closedUserId = await N9a1UserIdAsync(closing);
        var paid = await CreatePaidMessagingEnrollmentAsync(owner, closedId, 30m);
        using var released = CreateClient();
        var releasedId = await N9eInviteAsync(owner, released, tenant, "n9e-guard-released@example.test", newAccount: true, "Barnaby", "Ellsworth");
        var releasedUserId = await N9a1UserIdAsync(released);
        await InviteClientAsync(owner, "n9e-guard-pending@example.test");
        var pendingInvitation = await N9eGuidAsync(
            """SELECT "Id" FROM invitations."ClientInvitations" WHERE "NormalizedEmail" = 'N9E-GUARD-PENDING@EXAMPLE.TEST' AND "Status" = 'Pending'""");

        // A current record is never marked anonymised: the check refuses it, whatever else the update says.
        await AssertSqlStateAsync(
            "23514",
            """UPDATE clients."ClientProfiles" SET "AnonymisedAtUtc" = CURRENT_TIMESTAMP WHERE "Id" = @client""",
            ("client", releasedId));
        await AssertSqlStateAsync(
            "23514",
            """
            UPDATE clients."ClientProfiles"
            SET "AnonymisedAtUtc" = CURRENT_TIMESTAMP, "FirstName" = 'Closed', "LastName" = 'account',
                "Email" = 'closed-' || replace("Id"::text, '-', '') || '@closed.tbgym.invalid',
                "NormalizedEmail" = upper('closed-' || replace("Id"::text, '-', '') || '@closed.tbgym.invalid'),
                "PhoneNumber" = NULL, "BirthDate" = NULL
            WHERE "Id" = @client
            """,
            ("client", releasedId));

        await ReleaseAsync(owner, releasedId, "Stopped coming");
        await AssertStatusAsync(await N9eCloseAsync(closing, Password), HttpStatusCode.NoContent);
        var closure = (await N9eClosuresAsync(closedUserId)).Single();

        // The anonymised record can never be deleted, renamed or brought back.
        await AssertSqlStateAsync("55000", """DELETE FROM clients."ClientProfiles" WHERE "Id" = @client""", ("client", closedId));
        await AssertSqlStateAsync("55000", """UPDATE clients."ClientProfiles" SET "FirstName" = 'Philippa' WHERE "Id" = @client""", ("client", closedId));
        await AssertSqlStateAsync("55000", """UPDATE clients."ClientProfiles" SET "AnonymisedAtUtc" = NULL WHERE "Id" = @client""", ("client", closedId));
        await AssertSqlStateAsync("55000", """UPDATE clients."ClientProfiles" SET "CoachNotes" = 'late note' WHERE "Id" = @client""", ("client", closedId));
        await AssertSqlStateAsync("55000", """UPDATE clients."ClientProfiles" SET "ReleasedAtUtc" = NULL WHERE "Id" = @client""", ("client", closedId));

        // A released record that was never anonymised stays as it was: never deleted, never rewritten, and the one
        // change it may take is the whole anonymisation, never a name kept or anything else moved alongside it.
        await AssertSqlStateAsync("55000", """DELETE FROM clients."ClientProfiles" WHERE "Id" = @client""", ("client", releasedId));
        await AssertSqlStateAsync("55000", """UPDATE clients."ClientProfiles" SET "CoachNotes" = 'rewritten' WHERE "Id" = @client""", ("client", releasedId));
        await AssertSqlStateAsync(
            "23514",
            """UPDATE clients."ClientProfiles" SET "AnonymisedAtUtc" = CURRENT_TIMESTAMP WHERE "Id" = @client""",
            ("client", releasedId));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE clients."ClientProfiles" SET "AnonymisedAtUtc" = CURRENT_TIMESTAMP, "IsCoachBlocked" = true WHERE "Id" = @client""",
            ("client", releasedId));
        var untouched = (await N9eProfilesAsync(releasedUserId)).Single();
        Assert.AreEqual(("Barnaby", "Ellsworth", (DateTimeOffset?)null), (untouched.FirstName, untouched.LastName, untouched.AnonymisedAtUtc));

        // The record of the closing is kept as written, one for each account, and says only what may be said.
        await AssertSqlStateAsync("55000", """UPDATE identity."AccountClosures" SET "PhotosRemoved" = 5 WHERE "Id" = @id""", ("id", closure.Id));
        await AssertSqlStateAsync("55000", """DELETE FROM identity."AccountClosures" WHERE "Id" = @id""", ("id", closure.Id));
        await AssertSqlStateAsync("23505", N9eInsertClosureSql("Self", "@user", "@user", "NULL", 0), ("user", closedUserId));
        await AssertSqlStateAsync("23514", N9eInsertClosureSql("Self", "@user", "@other", "NULL", 0), ("user", releasedUserId), ("other", closedUserId));
        await AssertSqlStateAsync("23514", N9eInsertClosureSql("OnRequest", "@user", "@user", "DATE '2026-11-01'", 0), ("user", releasedUserId));
        await AssertSqlStateAsync("23514", N9eInsertClosureSql("OnRequest", "@user", "@other", "NULL", 0), ("user", releasedUserId), ("other", closedUserId));
        await AssertSqlStateAsync("23514", N9eInsertClosureSql("Self", "@user", "@user", "NULL", -1), ("user", releasedUserId));
        Assert.HasCount(1, await N9eClosuresAsync(closedUserId));
        Assert.IsEmpty(await N9eClosuresAsync(releasedUserId));

        // An invitation's address changes only once, when the person who accepted it closes their account.
        var accepted = (await N9eAcceptedInvitationsAsync(closedUserId)).Single();
        await AssertSqlStateAsync(
            "23514",
            """UPDATE invitations."ClientInvitations" SET "Email" = 'moved@example.test', "NormalizedEmail" = 'MOVED@EXAMPLE.TEST' WHERE "Id" = @id""",
            ("id", pendingInvitation));
        await AssertSqlStateAsync(
            "23514",
            """
            UPDATE invitations."ClientInvitations"
            SET "AnonymisedAtUtc" = CURRENT_TIMESTAMP, "FirstName" = 'Closed', "LastName" = 'account', "PhoneNumber" = NULL, "BirthDate" = NULL,
                "Email" = 'closed-' || replace("Id"::text, '-', '') || '@closed.tbgym.invalid',
                "NormalizedEmail" = upper('closed-' || replace("Id"::text, '-', '') || '@closed.tbgym.invalid')
            WHERE "Id" = @id
            """,
            ("id", pendingInvitation));
        var releasedInvitation = (await N9eAcceptedInvitationsAsync(releasedUserId)).Single();
        await AssertSqlStateAsync(
            "23514",
            """UPDATE invitations."ClientInvitations" SET "Email" = 'moved@example.test', "NormalizedEmail" = 'MOVED@EXAMPLE.TEST' WHERE "Id" = @id""",
            ("id", releasedInvitation.Id));
        await AssertSqlStateAsync(
            "23514",
            """UPDATE invitations."ClientInvitations" SET "Email" = 'back@example.test', "NormalizedEmail" = 'BACK@EXAMPLE.TEST' WHERE "Id" = @id""",
            ("id", accepted.Id));
        await AssertSqlStateAsync("23514", """UPDATE invitations."ClientInvitations" SET "AnonymisedAtUtc" = NULL WHERE "Id" = @id""", ("id", accepted.Id));
        await AssertSqlStateAsync("23514", """UPDATE invitations."ClientInvitations" SET "FirstName" = 'Philippa' WHERE "Id" = @id""", ("id", accepted.Id));
        await AssertSqlStateAsync("23514", """DELETE FROM invitations."ClientInvitations" WHERE "Id" = @id""", ("id", accepted.Id));
        Assert.AreEqual(
            "n9e-guard-pending@example.test",
            await N9eScalarAsync("""SELECT "Email" FROM invitations."ClientInvitations" WHERE "Id" = @id""", ("id", pendingInvitation)));

        // The payment of the closed client's plan is still never deleted.
        await AssertSqlStateAsync("55000", """DELETE FROM subscriptions."PaymentRecords" WHERE "EnrollmentId" = @id""", ("id", paid.Id));
        Assert.AreEqual(1L, await N9eCountAsync("""SELECT count(*) FROM subscriptions."PaymentRecords" WHERE "EnrollmentId" = @id""", paid.Id));
    }

    // ---------- 4. who is refused ----------

    [TestMethod]
    public async Task N9eAWrongOrMissingPasswordOrNoTokenClosesNothingAndTheAccountStillSignsIn()
    {
        const string email = "n9e-refused-client@example.test";
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-refused-owner@example.test", "Maya Owner", "N9e Refused Gym");
        using var client = CreateClient();
        var profileId = await N9eInviteAsync(owner, client, tenant, email, newAccount: true, "Cordelia", "Wintringham");
        var userId = await N9a1UserIdAsync(client);
        var stamp = (await N9a1AccountAsync(userId)).SecurityStamp;

        // Nobody signed in: refused before anything is read.
        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(await anonymous.PostAsJsonAsync(N9eCloseUrl, new { password = Password }), HttpStatusCode.Unauthorized);

        // A wrong password, an empty one and none at all.
        var wrong = await N9eCloseAsync(client, Password + "x");
        await AssertStatusAsync(wrong, HttpStatusCode.BadRequest);
        var wrongErrors = (await RequiredJsonAsync<N9a1Problem>(wrong)).Errors;
        CollectionAssert.AreEqual(N9ePasswordField, wrongErrors.Keys.ToArray());
        Assert.AreEqual(AccountClosureText.PasswordWrong, wrongErrors["password"].Single());
        foreach (var body in new object[] { new { password = string.Empty }, new { password = (string?)null }, new { } })
        {
            await RefreshCsrfAsync(client);
            var missing = await client.PostAsJsonAsync(N9eCloseUrl, body);
            await AssertStatusAsync(missing, HttpStatusCode.BadRequest);
            var errors = (await RequiredJsonAsync<N9a1Problem>(missing)).Errors;
            CollectionAssert.AreEqual(N9ePasswordField, errors.Keys.ToArray());
            Assert.AreEqual(AccountClosureText.PasswordRequired, errors["password"].Single());
        }

        // The right password with no antiforgery token: refused as every write is.
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var noToken = await client.PostAsJsonAsync(N9eCloseUrl, new { password = Password });
        Assert.AreEqual("antiforgery_token_invalid", await N9eCodeAsync(noToken, HttpStatusCode.BadRequest));

        // Nothing changed: the account, its session, its record and its place in the space are as they were.
        Assert.IsEmpty(await N9eClosuresAsync(userId));
        Assert.AreEqual(stamp, (await N9a1AccountAsync(userId)).SecurityStamp);
        CollectionAssert.AreEqual(new[] { (tenant, "Client", "Active") }, await N9eMembershipsAsync(userId));
        var self = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((profileId, "Cordelia", "Wintringham", email), (self.Id, self.FirstName, self.LastName, self.Email));
        using var fresh = CreateClient();
        await AssertStatusAsync(await N9eLoginAsync(fresh, email), HttpStatusCode.OK);
        Assert.AreEqual(userId, await N9a1UserIdAsync(fresh));

        // And the right password with the token closes it.
        await AssertStatusAsync(await N9eCloseAsync(client, Password), HttpStatusCode.NoContent);
        Assert.HasCount(1, await N9eClosuresAsync(userId));
    }

    [TestMethod]
    public async Task N9eAnOwnerACoachWhoIsAlsoAClientElsewhereAndAPlatformAdminAreNotClosedHere()
    {
        using var owner = CreateClient();
        var ownerSpace = await RegisterCoachAsync(owner, "n9e-staff-owner@example.test", "Karim Owner", "N9e Staff Gym");
        var ownerUserId = await N9a1UserIdAsync(owner);
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "n9e-staff-coach@example.test", "Leila Coach");

        // The coach is also a client of another space, with their own signed-in account.
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9e-staff-other@example.test", "Fadi Owner", "N9e Other Gym");
        var coachAsClientId = await N9eInviteAsync(otherOwner, coach, otherSpace, "n9e-staff-coach@example.test", newAccount: false, "Leila", "Ashbourne");
        using var admin = await SignInPlatformAdminAsync("n9e-staff-admin@example.test");
        var adminUserId = await N9a1UserIdAsync(admin);

        // An owner, with the right password.
        var byOwner = await N9eCloseAsync(owner, Password);
        Assert.AreEqual("account_closure_staff", await N9eCodeAsync(byOwner, HttpStatusCode.Conflict));

        // A coach, whichever space their header names.
        foreach (var space in new[] { otherSpace, ownerSpace })
        {
            SetTenant(coach, space);
            var byCoach = await N9eCloseAsync(coach, Password);
            Assert.AreEqual("account_closure_staff", await N9eCodeAsync(byCoach, HttpStatusCode.Conflict));
        }

        // A platform admin, who here also owns a space: the admin's refusal is the one given.
        var byAdmin = await N9eCloseAsync(admin, Password);
        Assert.AreEqual("account_closure_platform_admin", await N9eCodeAsync(byAdmin, HttpStatusCode.Conflict));

        // Nothing changed in either space, and each account still signs in.
        foreach (var userId in new[] { ownerUserId, coachUserId, adminUserId })
        {
            Assert.IsEmpty(await N9eClosuresAsync(userId));
            Assert.IsTrue((await N9a1AccountAsync(userId)).HasPassword);
        }

        CollectionAssert.AreEquivalent(
            new[] { (ownerSpace, "Coach", "Active"), (otherSpace, "Client", "Active") },
            await N9eMembershipsAsync(coachUserId));
        var record = (await N9eProfilesAsync(coachUserId)).Single();
        Assert.AreEqual((coachAsClientId, "Leila", "Ashbourne", (DateTimeOffset?)null, (DateTimeOffset?)null), (record.Id, record.FirstName, record.LastName, record.ReleasedAtUtc, record.AnonymisedAtUtc));
        SetTenant(coach, otherSpace);
        await AssertStatusAsync(await coach.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);
        SetTenant(coach, ownerSpace);
        await AssertStatusAsync(await coach.GetAsync("/api/clients"), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync("/api/clients"), HttpStatusCode.OK);
        await AssertStatusAsync(await admin.GetAsync(N9a1HouseUrl), HttpStatusCode.OK);
        foreach (var email in new[] { "n9e-staff-owner@example.test", "n9e-staff-coach@example.test", "n9e-staff-admin@example.test" })
        {
            using var fresh = CreateClient();
            await AssertStatusAsync(await N9eLoginAsync(fresh, email), HttpStatusCode.OK);
        }
    }

    // ---------- 5. the platform admin, on a person's request ----------

    [TestMethod]
    public async Task N9eThePlatformAdminClosesAnAccountOnAPersonsRequestOfANamedDayAndNoOneElseCan()
    {
        const string email = "n9e-asked-client@example.test";
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-asked-owner@example.test", "Samir Owner", "N9e Asked Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9e-asked-coach@example.test", "Dina Coach");
        using var client = CreateClient();
        var profileId = await N9eInviteAsync(owner, client, tenant, email, newAccount: true, "Ghislaine", "Featherstonehaugh");
        var userId = await N9a1UserIdAsync(client);
        using var admin = await SignInPlatformAdminAsync("n9e-asked-admin@example.test");
        var adminUserId = await N9a1UserIdAsync(admin);
        var today = DateOnly.FromDateTime(RequiredTestClock.UtcNow.UtcDateTime);

        // Nobody else reaches the route: signed out, the owner, the coach, the client themselves.
        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(await anonymous.PostAsJsonAsync(N9eAdminCloseUrl, new { email, requestedOn = today }), HttpStatusCode.Unauthorized);
        foreach (var caller in new[] { owner, coach, client })
        {
            await AssertStatusAsync(await N9eAdminCloseAsync(caller, email, today), HttpStatusCode.Forbidden);
        }

        // The admin without the antiforgery token, then with what the form is missing or got wrong.
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Assert.AreEqual(
            "antiforgery_token_invalid",
            await N9eCodeAsync(await admin.PostAsJsonAsync(N9eAdminCloseUrl, new { email, requestedOn = today }), HttpStatusCode.BadRequest));
        CollectionAssert.AreEqual(N9eEmailField, await N9eErrorKeysAsync(await N9eAdminCloseAsync(admin, null, today)));
        CollectionAssert.AreEqual(N9eEmailField, await N9eErrorKeysAsync(await N9eAdminCloseAsync(admin, "   ", today)));
        CollectionAssert.AreEqual(N9eRequestedOnField, await N9eErrorKeysAsync(await N9eAdminCloseAsync(admin, email, null)));
        CollectionAssert.AreEqual(N9eRequestedOnField, await N9eErrorKeysAsync(await N9eAdminCloseAsync(admin, email, today.AddDays(2))));
        CollectionAssert.AreEqual(N9eRequestedOnField, await N9eErrorKeysAsync(await N9eAdminCloseAsync(admin, email, new DateOnly(2025, 12, 31))));
        CollectionAssert.AreEquivalent(N9eEveryAdminField, await N9eErrorKeysAsync(await N9eAdminCloseAsync(admin, null, null)));

        // An address no account has, a staff account's and the admin's own.
        Assert.AreEqual("account_not_found", await N9eCodeAsync(await N9eAdminCloseAsync(admin, "n9e-asked-nobody@example.test", today), HttpStatusCode.NotFound));
        Assert.AreEqual("account_closure_staff", await N9eCodeAsync(await N9eAdminCloseAsync(admin, "n9e-asked-coach@example.test", today), HttpStatusCode.Conflict));
        Assert.AreEqual("account_closure_staff", await N9eCodeAsync(await N9eAdminCloseAsync(admin, "n9e-asked-owner@example.test", today), HttpStatusCode.Conflict));
        Assert.AreEqual(
            "account_closure_platform_admin",
            await N9eCodeAsync(await N9eAdminCloseAsync(admin, "n9e-asked-admin@example.test", today), HttpStatusCode.Conflict));
        Assert.IsEmpty(await N9eClosuresAsync(userId));
        Assert.IsTrue(await N9eSignedInAsync(client));

        // The person's request, typed as it came in the letter: the account closes, and the admin reads what it did.
        var closedAt = RequiredTestClock.UtcNow;
        var response = await N9eAdminCloseAsync(admin, $"  {email.ToUpperInvariant()} ", today);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var view = await RequiredJsonAsync<N9eClosureView>(response);
        Assert.AreEqual(((DateOnly?)today, 1, 1, 0), (view.RequestedOn, view.SpacesLeft, view.RecordsAnonymised, view.PhotosRemoved));
        N9eAssertNear(closedAt, view.ClosedAtUtc, "the view");
        var closure = (await N9eClosuresAsync(userId)).Single();
        Assert.AreEqual((AccountClosureSource.OnRequest, adminUserId, (DateOnly?)today), (closure.Source, closure.ClosedByUserId, closure.RequestedOn));
        Assert.AreEqual((1, 1, 0), (closure.SpacesLeft, closure.RecordsAnonymised, closure.PhotosRemoved));
        Assert.Contains("An account was closed (OnRequest): 1 coaching spaces left, 1 client records anonymised, 0 photos removed.", RequiredEveryLogLine.Text);

        // Closed as by the person: out of the space, anonymised, signed out everywhere, never signing in again.
        CollectionAssert.AreEqual(new[] { (tenant, "Client", "Removed") }, await N9eMembershipsAsync(userId));
        N9eAssertAnonymised((await N9eProfilesAsync(userId)).Single(), closedAt);
        Assert.IsFalse(await N9eSignedInAsync(client));
        using var fresh = CreateClient();
        await AssertStatusAsync(await N9eLoginAsync(fresh, email), HttpStatusCode.Unauthorized);
        var former = await RequiredJsonAsync<N9eFormer[]>(await owner.GetAsync("/api/clients/former"));
        Assert.AreEqual((profileId, "Closed", "account", "LeftByClient"), (former.Single().Id, former.Single().FirstName, former.Single().LastName, former.Single().DepartureKind));

        // Asked again: the address names nobody now, and the account's own reserved address finds it closed already.
        Assert.AreEqual("account_not_found", await N9eCodeAsync(await N9eAdminCloseAsync(admin, email, today), HttpStatusCode.NotFound));
        Assert.AreEqual(
            "account_already_closed",
            await N9eCodeAsync(await N9eAdminCloseAsync(admin, $"closed-{userId:N}@closed.tbgym.invalid", today), HttpStatusCode.Conflict));
        Assert.HasCount(1, await N9eClosuresAsync(userId));
    }

    // ---------- 6. tenancy ----------

    [TestMethod]
    public async Task N9eClosingReachesTheCallerAloneWhateverSpaceTheHeaderNamesAndTheOwnerSeesAClosedAccount()
    {
        const string email = "n9e-only-client@example.test";
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-only-owner@example.test", "Lina Owner", "N9e Only Gym");
        using var client = CreateClient();
        var closingId = await N9eInviteAsync(owner, client, tenant, email, newAccount: true, "Peregrine", "Ashcombe");
        var userId = await N9a1UserIdAsync(client);
        await N9eCoachNotesAsync(owner, closingId);
        using var neighbour = CreateClient();
        var neighbourId = await N9eInviteAsync(owner, neighbour, tenant, "n9e-only-neighbour@example.test", newAccount: true, "Rosalind", "Pemberton");
        var neighbourUserId = await N9a1UserIdAsync(neighbour);

        // Another space, with a client of its own and an invitation to the closing person's email still waiting.
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9e-only-other@example.test", "Omar Owner", "N9e Only Other Gym");
        using var stranger = CreateClient();
        var strangerId = await N9eInviteAsync(otherOwner, stranger, otherSpace, "n9e-only-stranger@example.test", newAccount: true, "Theodora", "Blackwood");
        var strangerUserId = await N9a1UserIdAsync(stranger);
        await InviteClientAsync(otherOwner, email);

        // The person closes their account with the other space's header: the header names nothing the closing reads.
        SetTenant(client, otherSpace);
        await AssertStatusAsync(await N9eCloseAsync(client, Password), HttpStatusCode.NoContent);
        var closure = (await N9eClosuresAsync(userId)).Single();
        Assert.AreEqual((1, 1, 0), (closure.SpacesLeft, closure.RecordsAnonymised, closure.PhotosRemoved));
        N9eAssertAnonymised((await N9eProfilesAsync(userId)).Single(), null);

        // Their neighbour in the same space and the other space's client are as they were.
        foreach (var (person, personUserId, space, id, first, last) in new[]
        {
            (neighbour, neighbourUserId, tenant, neighbourId, "Rosalind", "Pemberton"),
            (stranger, strangerUserId, otherSpace, strangerId, "Theodora", "Blackwood"),
        })
        {
            Assert.IsEmpty(await N9eClosuresAsync(personUserId));
            CollectionAssert.AreEqual(new[] { (space, "Client", "Active") }, await N9eMembershipsAsync(personUserId));
            var record = (await N9eProfilesAsync(personUserId)).Single();
            Assert.AreEqual((id, first, last, (DateTimeOffset?)null, (DateTimeOffset?)null), (record.Id, record.FirstName, record.LastName, record.ReleasedAtUtc, record.AnonymisedAtUtc));
            var self = await RequiredJsonAsync<N9a1Self>(await person.GetAsync("/api/client-profile/me"));
            Assert.AreEqual((id, first), (self.Id, self.FirstName));
        }

        // The other space keeps its client and its waiting invitation, which still names the address it was sent to.
        Assert.AreEqual(strangerId, (await RequiredJsonAsync<TeamClient[]>(await otherOwner.GetAsync("/api/clients"))).Single().Id);
        Assert.IsEmpty(await RequiredJsonAsync<N9eFormer[]>(await otherOwner.GetAsync("/api/clients/former")));
        Assert.AreEqual(
            1L,
            await N9eCountAsync(
                """SELECT count(*) FROM invitations."ClientInvitations" WHERE "TenantId" = @id AND "Email" = 'n9e-only-client@example.test' AND "Status" = 'Pending'""",
                otherSpace));

        // The owner of the space they left sees a former client named "Closed account", and nothing of the person.
        var current = await RequiredJsonAsync<TeamClient[]>(await owner.GetAsync("/api/clients"));
        Assert.AreEqual(neighbourId, current.Single().Id);
        var former = (await RequiredJsonAsync<N9eFormer[]>(await owner.GetAsync("/api/clients/former"))).Single();
        Assert.AreEqual(
            (closingId, "Closed account", $"closed-{closingId:N}@closed.tbgym.invalid", N9eLeftReason, "LeftByClient"),
            (former.Id, $"{former.FirstName} {former.LastName}", former.Email, former.Reason, former.DepartureKind));
        var details = await RequiredJsonAsync<N9eDetails>(await owner.GetAsync($"/api/clients/{closingId}"));
        Assert.AreEqual(("Closed", "account", $"closed-{closingId:N}@closed.tbgym.invalid"), (details.FirstName, details.LastName, details.Email));
        Assert.IsNull(details.PhoneNumber);
        Assert.IsNull(details.BirthDate);
        Assert.IsNull(details.CoachNotes);
        Assert.IsNotNull(details.Release);
        Assert.AreEqual((N9eLeftReason, "LeftByClient"), (details.Release.Reason, details.Release.DepartureKind));
        Assert.DoesNotContain("Peregrine", details.Release.ReleasedByName, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Ashcombe", details.Release.ReleasedByName, StringComparison.OrdinalIgnoreCase);
    }

    // ---------- 7. a sign-up still waiting ----------

    [TestMethod]
    public async Task N9eATraineeStillWaitingForAPlaceClosesTheirAccountAndTheWaitingSignUpIsDeleted()
    {
        const string email = "n9e-waits-trainee@example.test";
        using var house = await N9a1OpenHouseAsync("n9e-waits", signUpsPerWeek: "1");

        // They send the form while the week's one place is free, someone else confirms first, and their own
        // confirmation then makes them nobody's client: the sign-up waits, holding the name and date typed.
        using var waiting = CreateClient();
        var response = await N9a1SignUpAsync(waiting, email, "Eglantine", "Marchbanks", "1988-02-29");
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        using var first = await N9a1TraineeAsync(house.TenantId, "n9e-waits-first@example.test");
        await AssertStatusAsync(
            await N9a1ConfirmAsync(waiting, (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        var person = await N9a1PersonAsync(email);
        var userId = person.UserId!.Value;
        Assert.IsEmpty(person.Memberships);
        Assert.IsEmpty(person.Profiles);
        Assert.AreEqual(("Eglantine", "Marchbanks", (DateTimeOffset?)null), (person.SignUps.Single().FirstName, person.SignUps.Single().LastName, person.SignUps.Single().ConfirmedAtUtc));
        await N9a1SignInAsync(waiting, email);
        Assert.AreEqual("Waiting", (await N9a1StatusAsync(waiting)).CallerSignUp);

        await AssertStatusAsync(await N9eCloseAsync(waiting, Password), HttpStatusCode.NoContent);

        // The waiting sign-up is deleted; the one who joined keeps theirs.
        Assert.AreEqual(0L, await N9eCountAsync("""SELECT count(*) FROM tenancy."TraineeSignUps" WHERE "UserId" = @id""", userId));
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
        Assert.AreEqual(1L, await N9eCountAsync("""SELECT count(*) FROM tenancy."TraineeSignUps" WHERE "UserId" = @id AND "ConfirmedAtUtc" IS NOT NULL""", first.UserId));
        var closure = (await N9eClosuresAsync(userId)).Single();
        Assert.AreEqual((AccountClosureSource.Self, 0, 0, 0), (closure.Source, closure.SpacesLeft, closure.RecordsAnonymised, closure.PhotosRemoved));
        Assert.AreEqual($"closed-{userId:N}@closed.tbgym.invalid", (await N9a1AccountAsync(userId)).Email);
        Assert.IsNull((await N9a1PersonAsync(email)).UserId, "No account has the address now.");
        Assert.IsFalse(await N9eSignedInAsync(waiting));
    }

    // ---------- 8. two at once ----------

    [TestMethod]
    public async Task N9eTwoClosingsAtOnceFromOneSessionCloseTheAccountOnceAndNeitherAnswersAnError()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-race-owner@example.test", "Rania Owner", "N9e Race Gym");
        using var client = CreateClient();
        var profileId = await N9eInviteAsync(owner, client, tenant, "n9e-race-client@example.test", newAccount: true, "Ignatius", "Fairbrother");
        var userId = await N9a1UserIdAsync(client);

        await RefreshCsrfAsync(client);
        var answers = await Task.WhenAll(
            client.PostAsJsonAsync(N9eCloseUrl, new { password = Password }),
            client.PostAsJsonAsync(N9eCloseUrl, new { password = Password }));
        foreach (var answer in answers)
        {
            Assert.IsTrue(
                answer.StatusCode is HttpStatusCode.NoContent or HttpStatusCode.Unauthorized,
                $"A closing raced by another answered {(int)answer.StatusCode}: {await answer.Content.ReadAsStringAsync()}");
        }

        Assert.IsTrue(answers.Any(answer => answer.StatusCode == HttpStatusCode.NoContent), "One of them closed the account.");
        var closure = (await N9eClosuresAsync(userId)).Single();
        Assert.AreEqual((1, 1, 0), (closure.SpacesLeft, closure.RecordsAnonymised, closure.PhotosRemoved));
        N9eAssertAnonymised((await N9eProfilesAsync(userId)).Single(), null);
        Assert.AreEqual(1L, await N9a1QueuedAsync("ClientLeft", "AggregateId", profileId), "The owner is told once.");
        Assert.AreEqual(
            1L,
            await N9eCountAsync("""SELECT count(*) FROM clients."ClientRelationshipEvents" WHERE "ClientProfileId" = @id AND "EventType" = 'Left'""", profileId));
        Assert.IsFalse(await N9eSignedInAsync(client));
    }

    // ---------- 9. nothing new for a closed account ----------

    [TestMethod]
    public async Task N9eTheDatabaseGivesAClosedAccountNoNewMembershipClientRecordOrUploadWhileOthersStillTakeThem()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-none-owner@example.test", "Nour Owner", "N9e None Gym");
        using var closing = CreateClient();
        await N9eInviteAsync(owner, closing, tenant, "n9e-none-closing@example.test", newAccount: true, "Aurelio", "Vantongeren");
        var closedUserId = await N9a1UserIdAsync(closing);
        var photo = await UploadProgressPhotoAsync(closing, $"/api/progress/me/photos?pose=Front&photoDate={N9a1Day(TenantToday())}");
        using var current = CreateClient();
        var currentId = await N9eInviteAsync(owner, current, tenant, "n9e-none-current@example.test", newAccount: true, "Bettina", "Holloway");
        var currentUserId = await N9a1UserIdAsync(current);
        using var former = CreateClient();
        var formerId = await N9eInviteAsync(owner, former, tenant, "n9e-none-former@example.test", newAccount: true, "Casimir", "Delacourt");
        var formerUserId = await N9a1UserIdAsync(former);
        await ReleaseAsync(owner, formerId, "Took a break");
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9e-none-other@example.test", "Ziad Owner", "N9e None Other Gym");
        using var stranger = CreateClient();
        await N9eInviteAsync(otherOwner, stranger, otherSpace, "n9e-none-stranger@example.test", newAccount: true, "Delphine", "Ravensworth");
        var strangerUserId = await N9a1UserIdAsync(stranger);

        await AssertStatusAsync(await N9eCloseAsync(closing, Password), HttpStatusCode.NoContent);
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<IMediaPurgeService>().PurgeDueAsync(50, CancellationToken.None);
        }

        Assert.AreEqual(MediaAssetStatus.Purged, (await N9eAssetAsync(photo.MediaAssetId)).Status);

        // An active client membership in another space, copied from that space's own client's row.
        var membership = await N9eCopyRowSqlAsync(
            "tenancy",
            "Memberships",
            "\"TenantId\" = @tenant AND \"UserId\" = @source",
            new Dictionary<string, string>(StringComparer.Ordinal) { ["Id"] = "gen_random_uuid()", ["UserId"] = "@user" });
        await N9eAssertRefusedAsClosedAsync([membership], ("tenant", otherSpace), ("source", strangerUserId), ("user", closedUserId));
        await N9eCommitAsync([membership], ("tenant", otherSpace), ("source", strangerUserId), ("user", currentUserId));
        CollectionAssert.AreEquivalent(
            new[] { (tenant, "Client", "Active"), (otherSpace, "Client", "Active") },
            await N9eMembershipsAsync(currentUserId),
            "The same insert for an account that is open is taken.");
        CollectionAssert.AreEqual(new[] { (tenant, "Client", "Removed") }, await N9eMembershipsAsync(closedUserId));

        // A new client record in the space they left, copied from a current client's with its coach history.
        var profile = await N9eCopyRowSqlAsync(
            "clients",
            "ClientProfiles",
            "\"Id\" = @source",
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["Id"] = "@profile",
                ["UserId"] = "@user",
                ["Email"] = "@email",
                ["NormalizedEmail"] = "upper(@email)",
            });
        var history = await N9eCopyRowSqlAsync(
            "clients",
            "ClientCoachAssignments",
            "\"ClientProfileId\" = @source",
            new Dictionary<string, string>(StringComparer.Ordinal) { ["Id"] = "gen_random_uuid()", ["ClientProfileId"] = "@profile" });
        await N9eAssertRefusedAsClosedAsync(
            [profile, history],
            ("source", currentId),
            ("profile", Guid.NewGuid()),
            ("user", closedUserId),
            ("email", "n9e-none-back@example.test"));
        var formerAgain = Guid.NewGuid();
        await N9eCommitAsync(
            [profile, history],
            ("source", currentId),
            ("profile", formerAgain),
            ("user", formerUserId),
            ("email", "n9e-none-former-again@example.test"));
        Assert.HasCount(2, await N9eProfilesAsync(formerUserId), "The same insert for an account that is open is taken.");
        Assert.HasCount(1, await N9eProfilesAsync(closedUserId));

        // An upload owned by them, copied from their own purged photo's row.
        var asset = await N9eCopyRowSqlAsync(
            "media",
            "Assets",
            "\"Id\" = @source",
            new Dictionary<string, string>(StringComparer.Ordinal) { ["Id"] = "gen_random_uuid()", ["OwnerUserId"] = "@user" });
        await N9eAssertRefusedAsClosedAsync([asset], ("source", photo.MediaAssetId), ("user", closedUserId));
        await N9eCommitAsync([asset], ("source", photo.MediaAssetId), ("user", currentUserId));
        Assert.AreEqual(
            1L,
            await N9eCountAsync("""SELECT count(*) FROM media."Assets" WHERE "OwnerUserId" = @id""", currentUserId),
            "The same insert for an account that is open is taken.");
        Assert.AreEqual(1L, await N9eCountAsync("""SELECT count(*) FROM media."Assets" WHERE "OwnerUserId" = @id""", closedUserId));
    }

    // ---------- 10. every photo of the person ----------

    [TestMethod]
    public async Task N9eEveryPhotoOfTheClientIsPurgedWhoeverRecordedItAndAPhotoRemovedEarlierIsNotRemovedAgain()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9e-photos-owner@example.test", "Hadi Owner", "N9e Photos Gym");
        var ownerUserId = await N9a1UserIdAsync(owner);
        using var client = CreateClient();
        var clientId = await N9eInviteAsync(owner, client, tenant, "n9e-photos-client@example.test", newAccount: true, "Evangeline", "Stroud");
        var userId = await N9a1UserIdAsync(client);
        var today = N9a1Day(TenantToday());

        // A photo the coach recorded for the client, so the coach's account owns its upload.
        var byCoach = await UploadProgressPhotoAsync(owner, $"/api/progress/clients/{clientId}/photos?pose=Side&photoDate={today}");
        Assert.AreEqual(ownerUserId, (await N9eAssetAsync(byCoach.MediaAssetId)).OwnerUserId);

        // A photo the client recorded and removed before closing: tombstoned, kept for the recoverable window.
        var removedEarlier = await UploadProgressPhotoAsync(client, $"/api/progress/me/photos?pose=Back&photoDate={today}");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/photos/{removedEarlier.Id}/remove",
                new { reason = "Wrong pose captured.", version = removedEarlier.Version }),
            HttpStatusCode.OK);
        var waitingOut = await N9eAssetAsync(removedEarlier.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, waitingOut.Status);
        Assert.IsTrue(waitingOut.PurgeAfterUtc > RequiredTestClock.UtcNow, "Recoverable until the window ends.");

        // The coach's own exercise upload, which is nobody's photo.
        var exerciseMedia = await UploadJpegAsync(owner);

        var closedAt = RequiredTestClock.UtcNow;
        await AssertStatusAsync(await N9eCloseAsync(client, Password), HttpStatusCode.NoContent);

        // Only the photo still showing is removed by the closing; the one removed earlier keeps its one removal.
        var closure = (await N9eClosuresAsync(userId)).Single();
        Assert.AreEqual(1, closure.PhotosRemoved, "Only the photos still active count.");
        Assert.AreEqual(ProgressPhotoStatus.Removed, (await N9ePhotoAsync(byCoach.Id)).Status);
        CollectionAssert.AreEqual(new[] { N9ePhotoReason }, await N9ePhotoRemovalsAsync(byCoach.Id));
        CollectionAssert.AreEqual(N9eEarlierRemovalReason, await N9ePhotoRemovalsAsync(removedEarlier.Id));

        // Both uploads fall due at once, whoever owns them, and forget the device's file name.
        foreach (var assetId in new[] { byCoach.MediaAssetId, removedEarlier.MediaAssetId })
        {
            var asset = await N9eAssetAsync(assetId);
            Assert.AreEqual(MediaAssetStatus.Tombstoned, asset.Status, $"Asset {assetId}");
            Assert.IsNotNull(asset.PurgeAfterUtc, $"Asset {assetId}");
            Assert.IsTrue(asset.PurgeAfterUtc <= closedAt, $"Asset {assetId} is due at {asset.PurgeAfterUtc:O}.");
            Assert.IsNull(asset.OriginalFileName, $"Asset {assetId}");
        }

        Assert.AreEqual(MediaAssetStatus.Ready, (await N9eAssetAsync(exerciseMedia.Id)).Status, "The coach's own upload is not the person's.");

        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var outcome = await scope.ServiceProvider.GetRequiredService<IMediaPurgeService>().PurgeDueAsync(50, CancellationToken.None);
            Assert.AreEqual(0, outcome.Failed);
        }

        foreach (var assetId in new[] { byCoach.MediaAssetId, removedEarlier.MediaAssetId })
        {
            var asset = await N9eAssetAsync(assetId);
            Assert.AreEqual((MediaAssetStatus.Purged, (string?)null), (asset.Status, asset.StorageKey), $"Asset {assetId}");
        }

        Assert.AreEqual(MediaAssetStatus.Ready, (await N9eAssetAsync(exerciseMedia.Id)).Status);
    }

    // ---------- 11. a former coach ----------

    [TestMethod]
    public async Task N9eAFormerCoachWhoIsNowAClientElsewhereIsNotClosedByThemselvesOrByTheAdmin()
    {
        const string email = "n9e-former-coach@example.test";
        using var owner = CreateClient();
        var coachedSpace = await RegisterCoachAsync(owner, "n9e-former-owner@example.test", "Tarek Owner", "N9e Former Gym");
        using var coach = CreateClient();
        var userId = await JoinAsCoachAsync(owner, coach, email, "Mireille Coach");
        using var otherOwner = CreateClient();
        var clientSpace = await RegisterCoachAsync(otherOwner, "n9e-former-other@example.test", "Joseph Owner", "N9e Former Other Gym");
        var profileId = await N9eInviteAsync(otherOwner, coach, clientSpace, email, newAccount: false, "Mireille", "Abernethy");

        // The owner removes them from the team: the Coach membership ends, the client one goes on.
        await RemoveCoachForBillingAsync(owner, userId);
        var memberships = await N9eMembershipsAsync(userId);
        CollectionAssert.AreEquivalent(new[] { (coachedSpace, "Coach", "Removed"), (clientSpace, "Client", "Active") }, memberships);
        var stamp = (await N9a1AccountAsync(userId)).SecurityStamp;

        // From Me, with the right password, under either space's header.
        foreach (var space in new[] { clientSpace, coachedSpace })
        {
            SetTenant(coach, space);
            var refused = await N9eCloseAsync(coach, Password);
            await AssertStatusAsync(refused, HttpStatusCode.Conflict);
            var answer = await RequiredJsonAsync<N9eRefusal>(refused);
            Assert.AreEqual(("account_closure_staff", AccountClosureText.Staff), (answer.Code, answer.Message));
        }

        // And by the platform admin, by email.
        using var admin = await SignInPlatformAdminAsync("n9e-former-admin@example.test");
        Assert.AreEqual(
            "account_closure_staff",
            await N9eCodeAsync(await N9eAdminCloseAsync(admin, email, DateOnly.FromDateTime(RequiredTestClock.UtcNow.UtcDateTime)), HttpStatusCode.Conflict));

        // Nothing changed: no record of a closing, the memberships, the client record, the account and its session.
        Assert.IsEmpty(await N9eClosuresAsync(userId));
        CollectionAssert.AreEquivalent(memberships, await N9eMembershipsAsync(userId));
        var record = (await N9eProfilesAsync(userId)).Single();
        Assert.AreEqual(
            (profileId, "Mireille", "Abernethy", email, (DateTimeOffset?)null, (DateTimeOffset?)null),
            (record.Id, record.FirstName, record.LastName, record.Email, record.ReleasedAtUtc, record.AnonymisedAtUtc));
        var account = await N9a1AccountAsync(userId);
        Assert.AreEqual((email, stamp, true), (account.Email, account.SecurityStamp, account.HasPassword));
        SetTenant(coach, clientSpace);
        await AssertStatusAsync(await coach.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);
        using var fresh = CreateClient();
        await AssertStatusAsync(await N9eLoginAsync(fresh, email), HttpStatusCode.OK);
        Assert.AreEqual(userId, await N9a1UserIdAsync(fresh));
    }

    // ---------- N9e helpers ----------

    /// <summary>
    /// The staff invite the person with the details they type, and the person accepts: as a new account with their name
    /// as its display name, or with their own signed-in account. Returns the new client record.
    /// </summary>
    private static async Task<Guid> N9eInviteAsync(
        HttpClient staff,
        HttpClient person,
        Guid tenantId,
        string email,
        bool newAccount,
        string firstName = N9eFirstName,
        string lastName = N9eLastName)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName,
            lastName,
            phoneNumber = N9ePhone,
            birthDate = N9eBirthDate,
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<Invitation>(response);
        await RefreshCsrfAsync(person);
        var acceptance = await person.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue(invitation.DevelopmentActionUrl!, "token"),
            displayName = newAccount ? $"{firstName} {lastName}" : null,
            password = newAccount ? Password : null,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        SetTenant(person, tenantId);
        return (await RequiredJsonAsync<InvitationAcceptance>(acceptance)).ClientProfileId;
    }

    /// <summary>The client's own set-up of the record their header names, with every intake and health detail filled.</summary>
    private static async Task N9eCompleteOnboardingAsync(HttpClient client)
    {
        var self = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/client-profile/me/complete-onboarding", new
        {
            intake = new
            {
                firstName = N9eFirstName,
                lastName = N9eLastName,
                phoneNumber = N9ePhone,
                birthDate = N9eBirthDate,
                heightValue = 171m,
                heightUnit = "Centimeter",
                workType = N9eWorkType,
                averageDailySteps = 9100,
                trainingBackground = N9eBackground,
                foodPreferences = N9eFoodPreferences,
                foodAversions = N9eFoodAversions,
                goals = N9eGoals,
                allergies = N9eAllergies,
                medications = N9eMedications,
                previousInjuries = N9eInjuries,
                version = self.Version,
            },
            initialBodyweightValue = 66.4m,
            initialBodyweightUnit = "Kilogram",
            measurementDate = N9a1Day(TenantToday().AddDays(-1)),
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
    }

    private static async Task N9eCoachNotesAsync(HttpClient staff, Guid clientId)
    {
        var details = await RequiredJsonAsync<TeamClientDetails>(await staff.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PutAsJsonAsync($"/api/clients/{clientId}/coach-notes", new { notes = N9eCoachNotes, version = details.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>Closing the signed-in account as Me sends it: the antiforgery token, then the password typed.</summary>
    private static async Task<HttpResponseMessage> N9eCloseAsync(HttpClient caller, string password)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync(N9eCloseUrl, new { password });
    }

    private static async Task<HttpResponseMessage> N9eAdminCloseAsync(HttpClient caller, string? email, DateOnly? requestedOn)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync(N9eAdminCloseUrl, new { email, requestedOn });
    }

    private static async Task<HttpResponseMessage> N9eLoginAsync(HttpClient caller, string email)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync("/api/auth/login", new { email, password = Password, rememberMe = false });
    }

    /// <summary>Whether this browser's cookie still names an account: <c>/api/auth/me</c> answers JSON null when not.</summary>
    private static async Task<bool> N9eSignedInAsync(HttpClient caller)
    {
        var response = await caller.GetAsync("/api/auth/me");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await response.Content.ReadAsStringAsync()).Trim() != "null";
    }

    private static async Task<string?> N9eCodeAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        await AssertStatusAsync(response, status);
        return (await RequiredJsonAsync<N9eRefusal>(response)).Code;
    }

    private static async Task<string[]> N9eErrorKeysAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        return [.. (await RequiredJsonAsync<N9a1Problem>(response)).Errors.Keys];
    }

    /// <summary>
    /// What an anonymised client record holds (CLI-027): the anonymous name, the reserved address of its own id, and no
    /// personal field, on an ended record, anonymised at the closing's instant when the test knows it.
    /// </summary>
    private static void N9eAssertAnonymised(N9eStoredProfile profile, DateTimeOffset? closedAt)
    {
        var address = $"closed-{profile.Id:N}@closed.tbgym.invalid";
        var which = $"Record {profile.Id}";
        Assert.AreEqual(("Closed", "account", address, address.ToUpperInvariant()), (profile.FirstName, profile.LastName, profile.Email, profile.NormalizedEmail), which);
        Assert.IsNotNull(profile.ReleasedAtUtc, which);
        Assert.IsNotNull(profile.AnonymisedAtUtc, which);
        if (closedAt is { } instant)
        {
            N9eAssertNear(instant, profile.AnonymisedAtUtc.Value, which);
        }

        Assert.IsNull(profile.PhoneNumber, which);
        Assert.IsNull(profile.BirthDate, which);
        Assert.IsNull(profile.HeightCentimeters, which);
        Assert.IsNull(profile.HeightEnteredValue, which);
        Assert.IsNull(profile.HeightEnteredUnit, which);
        Assert.IsNull(profile.WorkType, which);
        Assert.IsNull(profile.AverageDailySteps, which);
        Assert.IsNull(profile.TrainingBackground, which);
        Assert.IsNull(profile.FoodPreferences, which);
        Assert.IsNull(profile.FoodAversions, which);
        Assert.IsNull(profile.Goals, which);
        Assert.IsNull(profile.Allergies, which);
        Assert.IsNull(profile.Medications, which);
        Assert.IsNull(profile.PreviousInjuries, which);
        Assert.IsNull(profile.CoachNotes, which);
    }

    /// <summary>The same instant to the database's microsecond.</summary>
    private static void N9eAssertNear(DateTimeOffset expected, DateTimeOffset actual, string what) =>
        Assert.IsTrue((actual - expected).Duration() < TimeSpan.FromMilliseconds(1), $"{what}: {actual:O} is not {expected:O}.");

    /// <summary>An insert into the closings' record with the given source, people, day and photo count.</summary>
    private static string N9eInsertClosureSql(string source, string user, string closedBy, string requestedOn, int photos) =>
        $"""
        INSERT INTO identity."AccountClosures"
            ("Id", "UserId", "Source", "ClosedByUserId", "RequestedOn", "ClosedAtUtc", "SpacesLeft", "RecordsAnonymised", "PhotosRemoved")
        VALUES (gen_random_uuid(), {user}, '{source}', {closedBy}, {requestedOn}, CURRENT_TIMESTAMP, 0, 0, {photos})
        """;

    /// <summary>The facts closing must keep under a client record, counted.</summary>
    private async Task<N9eFacts> N9eFactsAsync(Guid clientProfileId, Guid paidEnrollmentId) =>
        new(
            await N9eCountAsync("""SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "ClientProfileId" = @id""", clientProfileId),
            await N9eCountAsync("""SELECT count(*) FROM subscriptions."PaymentRecords" WHERE "EnrollmentId" = @id""", paidEnrollmentId),
            await N9eCountAsync("""SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id AND "Status" = 'Completed'""", clientProfileId),
            await N9eCountAsync(
                """
                SELECT count(*) FROM training."WorkoutSetPerformances" AS s
                JOIN training."WorkoutExercisePerformances" AS e ON e."Id" = s."WorkoutExercisePerformanceId"
                JOIN training."WorkoutExecutions" AS w ON w."Id" = e."WorkoutExecutionId"
                WHERE w."ClientProfileId" = @id AND s."IsCompleted"
                """,
                clientProfileId),
            await N9eCountAsync("""SELECT count(*) FROM strength."MaxHistory" WHERE "ClientProfileId" = @id""", clientProfileId),
            await N9eCountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "ClientProfileId" = @id""", clientProfileId),
            await N9eCountAsync("""SELECT count(*) FROM progress."BodyweightObservations" WHERE "ClientProfileId" = @id""", clientProfileId),
            await N9eCountAsync("""SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id""", clientProfileId));

    private async Task<long> N9eCountAsync(string sql, Guid id, params (string Name, object Value)[] parameters) =>
        Convert.ToInt64(await N9eScalarAsync(sql, [("id", id), .. parameters]), System.Globalization.CultureInfo.InvariantCulture);

    private async Task<Guid> N9eGuidAsync(string sql) =>
        (Guid)(await N9eScalarAsync(sql) ?? throw new AssertFailedException($"No row for: {sql}"));

    private async Task<object?> N9eScalarAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return await command.ExecuteScalarAsync();
    }

    /// <summary>
    /// An insert that copies the rows <paramref name="where"/> picks into the same table, every column as it is but the
    /// ones <paramref name="replacements"/> names (each an SQL expression), so a row is valid by every other rule.
    /// </summary>
    private async Task<string> N9eCopyRowSqlAsync(
        string schema,
        string table,
        string where,
        IReadOnlyDictionary<string, string> replacements)
    {
        var columns = new List<string>();
        await using (var connection = new NpgsqlConnection(RequiredDatabaseConnection))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT column_name FROM information_schema.columns WHERE table_schema = @schema AND table_name = @table AND is_generated = 'NEVER' ORDER BY ordinal_position";
            command.Parameters.AddWithValue("schema", schema);
            command.Parameters.AddWithValue("table", table);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                columns.Add(reader.GetString(0));
            }
        }

        foreach (var column in replacements.Keys)
        {
            Assert.Contains(column, columns, $"{schema}.{table} has no column {column}.");
        }

        var names = string.Join(", ", columns.Select(column => $"\"{column}\""));
        var values = string.Join(", ", columns.Select(column => replacements.TryGetValue(column, out var value) ? value : $"\"{column}\""));
        return $"INSERT INTO {schema}.\"{table}\" ({names}) SELECT {values} FROM {schema}.\"{table}\" WHERE {where}";
    }

    /// <summary>The statements in one transaction, then its commit, which is when a deferred trigger answers.</summary>
    private async Task N9eCommitAsync(IReadOnlyList<string> statements, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        foreach (var sql in statements)
        {
            await using var command = new NpgsqlCommand(sql, connection, transaction);
            foreach (var (name, value) in parameters.Where(parameter => sql.Contains($"@{parameter.Name}", StringComparison.Ordinal)))
            {
                command.Parameters.AddWithValue(name, value);
            }

            Assert.AreEqual(1, await command.ExecuteNonQueryAsync(), sql);
        }

        await transaction.CommitAsync();
    }

    /// <summary>The statements are taken one by one, and their commit is refused because the account is closed.</summary>
    private async Task N9eAssertRefusedAsClosedAsync(IReadOnlyList<string> statements, params (string Name, object Value)[] parameters)
    {
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => N9eCommitAsync(statements, parameters));
        Assert.AreEqual(
            ("23514", "A closed account takes no new membership, client record or upload"),
            (failure.SqlState, failure.MessageText),
            failure.Where ?? string.Empty);
    }

    /// <summary>Every client record of the account, in every space, oldest first, read past every filter.</summary>
    private async Task<List<N9eStoredProfile>> N9eProfilesAsync(Guid userId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ClientProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(profile => profile.UserId == userId)
            .OrderBy(profile => profile.CreatedAtUtc)
            .ToListAsync();
    }

    private async Task<(Guid TenantId, string Role, string Status)[]> N9eMembershipsAsync(Guid userId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var rows = await context.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(membership => membership.UserId == userId)
            .ToListAsync();
        return [.. rows.Select(membership => (membership.TenantId, membership.Role.ToString(), membership.Status.ToString()))];
    }

    private async Task<ClientProfileChange[]> N9eChangesAsync(Guid[] profileIds)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ClientProfileChanges.IgnoreQueryFilters().AsNoTracking()
            .Where(change => profileIds.Contains(change.ClientProfileId) && change.Source == ClientChangeSource.AccountClosure)
            .ToArrayAsync();
    }

    private async Task<TB.Gym.Modules.Invitations.ClientInvitation[]> N9eAcceptedInvitationsAsync(Guid userId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ClientInvitations.IgnoreQueryFilters().AsNoTracking()
            .Where(invitation => invitation.AcceptedByUserId == userId)
            .ToArrayAsync();
    }

    private async Task<AccountClosure[]> N9eClosuresAsync(Guid userId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.AccountClosures.AsNoTracking().Where(closure => closure.UserId == userId).ToArrayAsync();
    }

    private async Task<ProgressPhoto> N9ePhotoAsync(Guid photoId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ProgressPhotos.IgnoreQueryFilters().AsNoTracking().SingleAsync(photo => photo.Id == photoId);
    }

    private async Task<string[]> N9ePhotoRemovalsAsync(Guid photoId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ProgressPhotoRemovals.IgnoreQueryFilters().AsNoTracking()
            .Where(removal => removal.ProgressPhotoId == photoId)
            .Select(removal => removal.Reason)
            .ToArrayAsync();
    }

    private async Task<TB.Gym.Modules.Media.MediaAsset> N9eAssetAsync(Guid assetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.MediaAssets.IgnoreQueryFilters().AsNoTracking().SingleAsync(asset => asset.Id == assetId);
    }

    private async Task<HashSet<Guid>> N9eNotificationIdsAsync() =>
        [.. (await N9eNotificationsAsync()).Select(notice => notice.Id)];

    /// <summary>Every delivered in-app notice of every space, read past every filter.</summary>
    private async Task<N9eStoredNotice[]> N9eNotificationsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var rows = await context.Notifications.IgnoreQueryFilters().AsNoTracking().ToListAsync();
        return [.. rows.Select(notice => new N9eStoredNotice(notice.Id, notice.RecipientUserId, notice.Kind.ToString(), notice.Title, notice.Body))];
    }

    private sealed record N9eStoredNotice(Guid Id, Guid RecipientUserId, string Kind, string Title, string Body);

    private sealed record N9eNotice(Guid Id, string Kind, string Title, string Body);

    private sealed record N9eInbox(N9eNotice[] Items);

    /// <param name="LoggedSets">The finished workouts' completed sets.</param>
    /// <param name="WorkingMaxes">The working maxes snapshotted for the program.</param>
    private sealed record N9eFacts(
        long Enrollments,
        long Payments,
        long FinishedWorkouts,
        long LoggedSets,
        long Maxes,
        long WorkingMaxes,
        long Weighins,
        long Programs);

    private sealed record N9eRefusal(string? Code, string? Message);

    private sealed record N9eClosureView(DateTimeOffset ClosedAtUtc, DateOnly? RequestedOn, int SpacesLeft, int RecordsAnonymised, int PhotosRemoved);

    private sealed record N9eFormer(Guid Id, string FirstName, string LastName, string Email, string Reason, string DepartureKind);

    private sealed record N9eRelease(string Reason, string ReleasedByName, string DepartureKind);

    private sealed record N9eDetails(
        Guid Id,
        string FirstName,
        string LastName,
        string Email,
        string? PhoneNumber,
        DateOnly? BirthDate,
        string? CoachNotes,
        N9eRelease? Release);
}
