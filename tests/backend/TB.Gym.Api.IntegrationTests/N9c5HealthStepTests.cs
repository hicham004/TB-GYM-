using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Notes plan N9c5a, part C, against PostgreSQL: the Health step opens only on Max (CLI-028, decision 33). Off Max (on
/// Free, on Pro+, with Max asked for but not booked, booked but not yet started, paused, ended, or with the trainee
/// blocked) an intake save that adds or changes a health answer is refused 409 <c>health_step_closed</c> on every
/// route that saves the intake, the trainee's own and the house Coach's alike, while the rest of the intake still
/// saves; on a paid Max the answers save, the house's Coach reads them and the Owner never does (N9d1a). Answers kept
/// from Max stay and read as before, may be sent again unchanged and may be emptied. The own read carries
/// <c>coachedByTheHouse</c> and <c>healthStepOpen</c>, and the staff's read <c>healthStepOpen</c>; a client a coach
/// invited, in the house or elsewhere, keeps the step open. A Max trainee is told of a new coach as a coach's client
/// is, and their leaving or closing their account tells the Owner and their coach. No health answer reaches a log.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9c5HSelfUrl = "/api/client-profile/me";

    private const string N9c5HOwnIntakeUrl = "/api/client-profile/me/intake";

    private const string N9c5HClosedCode = "health_step_closed";

    private const string N9c5HClosedMessage =
        "Health answers open on Max, TB Gym's coaching. Your other answers can still be saved.";

    /// <summary>Health answers in words found nowhere else, for the log's check.</summary>
    private static readonly N9a1Health N9c5HMarkers = new(
        "n9c5h-marker-allergy-loquat-5821",
        "n9c5h-marker-medication-travomide-3364",
        "n9c5h-marker-injury-scaphoid-7408");

    private static readonly N9a1Health N9c5HNoHealth = new(null, null, null);

    // ---------- 1. off Max, every route that saves the intake ----------

    [TestMethod]
    public async Task N9c5HOnFreeEveryIntakeRouteRefusesAHealthAnswerAndSavesTheRest()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("h-free");
        var house = space.House;
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c5h-free-trainee@example.test");

        // On Free the step is closed and nobody coaches the trainee, on their own read and on the staff's.
        var self = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((true, false, false), (self.SelfDirected, self.CoachedByTheHouse, self.HealthStepOpen));
        var byCoach = await N9c5HStaffAsync(house.Coach!, trainee.ProfileId);
        Assert.AreEqual((true, false), (byCoach.MayCoach, byCoach.HealthStepOpen));
        var byOwner = await N9c5HStaffAsync(house.Owner, trainee.ProfileId);
        Assert.AreEqual((false, false), (byOwner.MayCoach, byOwner.HealthStepOpen));

        // The trainee's own save, their set-up's finish and the house Coach's save, each with health answers: refused,
        // the same conflict on each, and nothing written.
        await N9c5HAssertClosedAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, self.Version, N9c5HMarkers, "Build strength"));
        await N9c5HAssertClosedAsync(
            await N9a1CompleteOnboardingAsync(trainee.Client, N9c5HBorn, self.Version, today, N9c5HMarkers));
        await N9c5HAssertClosedAsync(
            await N9c5HSaveAsync(house.Coach!, N9c5HStaffIntakeUrl(trainee.ProfileId), byCoach.Version, N9c5HMarkers, "Build strength"));
        // One answer alone is a health answer too.
        await N9c5HAssertClosedAsync(await N9c5HSaveAsync(
            trainee.Client, N9c5HOwnIntakeUrl, self.Version, N9c5HNoHealth with { Medications = N9c5HMarkers.Medications }, "Build strength"));
        var untouched = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual(
            (self.Version, (string?)null, "NotStarted", N9c5HNoHealth),
            (untouched.Version, untouched.Goals, untouched.OnboardingStatus, untouched.Health));
        Assert.AreEqual(0L, await N9c5HWeighInsAsync(trainee.ProfileId), "The refused set-up added no weigh-in.");

        // Someone signed out, and the coach of another space with the trainee's id, are answered as before: the closed
        // step is no one else's to learn.
        using var anonymous = CreateClient();
        SetTenant(anonymous, house.TenantId);
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(
            await anonymous.PutAsJsonAsync(N9c5HOwnIntakeUrl, N9c5HIntake(self.Version, N9c5HMarkers, "Build strength")),
            HttpStatusCode.Unauthorized);
        using var otherOwner = CreateClient();
        await RegisterCoachAsync(otherOwner, "n9c5h-free-other@example.test", "Zeina Aoun", "N9c5H Free Other Gym");
        var elsewhere = await N9c5HSaveAsync(
            otherOwner, N9c5HStaffIntakeUrl(trainee.ProfileId), self.Version, N9c5HMarkers, "Build strength");
        await AssertStatusAsync(elsewhere, HttpStatusCode.NotFound);
        Assert.DoesNotContain(N9c5HClosedCode, await elsewhere.Content.ReadAsStringAsync());

        // Without health answers each route saves the rest, and each answer says the step is closed.
        var saved = await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, self.Version, N9c5HNoHealth, "Build strength");
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var savedSelf = await RequiredJsonAsync<N9c5HSelf>(saved);
        Assert.AreEqual(("Build strength", true, false, false), (savedSelf.Goals, savedSelf.SelfDirected, savedSelf.CoachedByTheHouse, savedSelf.HealthStepOpen));

        byCoach = await N9c5HStaffAsync(house.Coach!, trainee.ProfileId);
        var coachSaved = await N9c5HSaveAsync(
            house.Coach!, N9c5HStaffIntakeUrl(trainee.ProfileId), byCoach.Version, N9c5HNoHealth, "Run a 10k");
        await AssertStatusAsync(coachSaved, HttpStatusCode.OK);
        var coachView = await ReadSlicePayloadAsync<CoachClientDetails>(coachSaved);
        Assert.AreEqual(("Run a 10k", false), (coachView.Goals, coachView.HealthStepOpen));

        var setUp = await N9a1CompleteOnboardingAsync(trainee.Client, N9c5HBorn, coachView.Version, today, N9c5HNoHealth);
        await AssertStatusAsync(setUp, HttpStatusCode.OK);
        var setUpSelf = await RequiredJsonAsync<N9c5HSelf>(setUp);
        Assert.AreEqual(("Completed", false, false, N9c5HNoHealth), (setUpSelf.OnboardingStatus, setUpSelf.CoachedByTheHouse, setUpSelf.HealthStepOpen, setUpSelf.Health));

        // Once set up, a health answer is still refused, and the profile stays as it was.
        await N9c5HAssertClosedAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, setUpSelf.Version, N9c5HMarkers, "Build strength", setUp: true));
        Assert.AreEqual(setUpSelf.Version, (await N9c5HSelfAsync(trainee.Client)).Version);

        N9c5HAssertNoMarkerLogged();
    }

    // ---------- 2. Pro+, Max not granting yet, Max granting, Max paused ----------

    [TestMethod]
    public async Task N9c5HProPlusAndAMaxNotGrantingKeepTheStepClosedAndAPaidMaxOpensItToTheTraineeAndTheirCoachAlone()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("h-paid");
        var house = space.House;
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c5h-paid-trainee@example.test");

        // A paid Pro+ running from today: closed.
        await N9c1AskAndBookAsync(space.Space, trainee);
        await N9c5HAssertStepAsync(trainee, house, open: false, "on Pro+");

        // Max asked for and not booked: an unpaid ask grants nothing, so still closed.
        var ask = await N9c5AskForMaxAsync(space, trainee);
        await N9c5HAssertStepAsync(trainee, house, open: false, "with Max asked for");

        // Max booked with its whole price behind the running Pro+: it starts when Pro+ ends, so still closed today.
        var booking = await N9c5BookMaxAsync(space, trainee, ask.Id);
        await AssertStatusAsync(booking, HttpStatusCode.OK);
        var booked = await ReadSlicePayloadAsync<TB.Gym.Modules.Subscriptions.HousePlanAskView>(booking);
        var maxId = booked.Outcome!.EnrollmentId!.Value;
        Assert.AreEqual((DateOnly?)today.AddDays(28), booked.Outcome.PlanStartDate);
        await N9c5HAssertStepAsync(trainee, house, open: false, "with Max booked to start after Pro+");

        // The day Max starts: open, and the house coaches the trainee.
        N9b1FSetHouseDay(today.AddDays(28));
        var self = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((true, true, true), (self.SelfDirected, self.CoachedByTheHouse, self.HealthStepOpen));

        // The trainee saves their health answers, and the answer says the step is open.
        var saved = await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, self.Version, N9c5HMarkers, "Build strength");
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var savedSelf = await RequiredJsonAsync<N9c5HSelf>(saved);
        Assert.AreEqual((N9c5HMarkers, true, true), (savedSelf.Health, savedSelf.CoachedByTheHouse, savedSelf.HealthStepOpen));

        // The house's Coach, who coaches the trainee, reads them; the Owner, who does not, reads none and may not write.
        var byCoach = await N9c5HStaffAsync(house.Coach!, trainee.ProfileId);
        Assert.AreEqual(
            (true, true, N9c5HMarkers),
            (byCoach.MayCoach, byCoach.HealthStepOpen, new N9a1Health(byCoach.Allergies, byCoach.Medications, byCoach.PreviousInjuries)));
        var byOwner = await N9c5HStaffAsync(house.Owner, trainee.ProfileId);
        Assert.AreEqual(
            (false, true, N9c5HNoHealth),
            (byOwner.MayCoach, byOwner.HealthStepOpen, new N9a1Health(byOwner.Allergies, byOwner.Medications, byOwner.PreviousInjuries)));
        var ownerWrite = await N9c5HSaveAsync(
            house.Owner, N9c5HStaffIntakeUrl(trainee.ProfileId), byOwner.Version, N9c5HMarkers with { Allergies = "n9c5h-owner-allergy" }, "Build strength");
        await AssertStatusAsync(ownerWrite, HttpStatusCode.NotFound);
        Assert.AreEqual(string.Empty, await ownerWrite.Content.ReadAsStringAsync(), "As for a client that does not exist.");

        // The house's Coach changes one answer for the trainee: open to them as well.
        var coachChange = N9c5HMarkers with { PreviousInjuries = "n9c5h-marker-injury-ulna-6620" };
        var coachSaved = await N9c5HSaveAsync(
            house.Coach!, N9c5HStaffIntakeUrl(trainee.ProfileId), byCoach.Version, coachChange, "Build strength");
        await AssertStatusAsync(coachSaved, HttpStatusCode.OK);
        Assert.IsTrue((await ReadSlicePayloadAsync<CoachClientDetails>(coachSaved)).HealthStepOpen);
        Assert.AreEqual(coachChange, (await N9c5HSelfAsync(trainee.Client)).Health);

        // The Owner pauses Max: closed again, with the answers kept and read as before.
        await N9c5HPauseAsync(house.Owner, maxId);
        var paused = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((false, false, coachChange), (paused.CoachedByTheHouse, paused.HealthStepOpen, paused.Health));
        await N9c5HAssertClosedAsync(await N9c5HSaveAsync(
            trainee.Client, N9c5HOwnIntakeUrl, paused.Version, coachChange with { Allergies = "n9c5h-marker-allergy-fig-1180" }, "Build strength"));
        await AssertStatusAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, paused.Version, coachChange, "Run a 10k"),
            HttpStatusCode.OK);
        var pausedSaved = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual(("Run a 10k", coachChange), (pausedSaved.Goals, pausedSaved.Health));
        Assert.IsFalse((await N9c5HStaffAsync(house.Coach!, trainee.ProfileId)).HealthStepOpen);

        // A second trainee finishes setting up on Max: the set-up takes the health answers too.
        using var second = await N9a1TraineeAsync(house.TenantId, "n9c5h-paid-second@example.test", address: "203.0.113.191");
        await N9c5OnMaxAsync(space, second);
        var secondSelf = await N9c5HSelfAsync(second.Client);
        Assert.AreEqual((true, true), (secondSelf.CoachedByTheHouse, secondSelf.HealthStepOpen));
        var setUp = await N9a1CompleteOnboardingAsync(second.Client, N9c5HBorn, secondSelf.Version, today.AddDays(28), N9c5HMarkers);
        await AssertStatusAsync(setUp, HttpStatusCode.OK);
        var setUpSelf = await RequiredJsonAsync<N9c5HSelf>(setUp);
        Assert.AreEqual((N9c5HMarkers, true, true), (setUpSelf.Health, setUpSelf.CoachedByTheHouse, setUpSelf.HealthStepOpen));

        N9c5HAssertNoMarkerLogged("n9c5h-owner-allergy", "n9c5h-marker-injury-ulna-6620", "n9c5h-marker-allergy-fig-1180");
    }

    // ---------- 3. after Max ends ----------

    [TestMethod]
    public async Task N9c5HAfterMaxTheAnswersAreKeptAndMaySeeTheirEndButNotChange()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("h-after");
        var house = space.House;
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c5h-after-trainee@example.test");
        await N9c5OnMaxAsync(space, trainee);

        var self = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((true, true), (self.CoachedByTheHouse, self.HealthStepOpen));
        await AssertStatusAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, self.Version, N9c5HMarkers, "Build strength"),
            HttpStatusCode.OK);

        // Blocked by the house, Max grants nothing: closed, and open again once unblocked.
        await N9c1RelationshipAsync(house.Owner, trainee.ProfileId, "block");
        var blocked = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((false, false, N9c5HMarkers), (blocked.CoachedByTheHouse, blocked.HealthStepOpen, blocked.Health));
        await N9c1RelationshipAsync(house.Owner, trainee.ProfileId, "unblock");
        Assert.IsTrue((await N9c5HSelfAsync(trainee.Client)).HealthStepOpen);

        // Max's four weeks end: the step closes on the house's next day by itself, and the answers stay.
        N9b1FSetHouseDay(today.AddDays(27));
        Assert.IsTrue((await N9c5HSelfAsync(trainee.Client)).HealthStepOpen, "Max's last day.");
        N9b1FSetHouseDay(today.AddDays(28));
        var after = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((true, false, false, N9c5HMarkers), (after.SelfDirected, after.CoachedByTheHouse, after.HealthStepOpen, after.Health));
        var byCoach = await N9c5HStaffAsync(house.Coach!, trainee.ProfileId);
        Assert.AreEqual(
            (true, false, N9c5HMarkers),
            (byCoach.MayCoach, byCoach.HealthStepOpen, new N9a1Health(byCoach.Allergies, byCoach.Medications, byCoach.PreviousInjuries)));
        var byOwner = await N9c5HStaffAsync(house.Owner, trainee.ProfileId);
        Assert.AreEqual(
            (false, N9c5HNoHealth),
            (byOwner.MayCoach, new N9a1Health(byOwner.Allergies, byOwner.Medications, byOwner.PreviousInjuries)));

        // Sent again unchanged with another answer changed, as the form sends every saved answer: saved.
        var unchanged = await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, after.Version, N9c5HMarkers, "Run a 10k");
        await AssertStatusAsync(unchanged, HttpStatusCode.OK);
        var kept = await RequiredJsonAsync<N9c5HSelf>(unchanged);
        Assert.AreEqual(("Run a 10k", N9c5HMarkers, false), (kept.Goals, kept.Health, kept.HealthStepOpen));

        // A changed answer, by the trainee or by their coach: refused, nothing written.
        var changed = N9c5HMarkers with { Medications = "n9c5h-marker-medication-orvane-2291" };
        await N9c5HAssertClosedAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, kept.Version, changed, "Swim a mile"));
        byCoach = await N9c5HStaffAsync(house.Coach!, trainee.ProfileId);
        await N9c5HAssertClosedAsync(
            await N9c5HSaveAsync(house.Coach!, N9c5HStaffIntakeUrl(trainee.ProfileId), byCoach.Version, changed, "Swim a mile"));
        var still = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((kept.Version, "Run a 10k", N9c5HMarkers), (still.Version, still.Goals, still.Health));

        // Emptied, one answer and then the rest: saved.
        var oneEmptied = N9c5HMarkers with { Allergies = null };
        var emptiedOne = await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, still.Version, oneEmptied, "Run a 10k");
        await AssertStatusAsync(emptiedOne, HttpStatusCode.OK);
        var afterOne = await RequiredJsonAsync<N9c5HSelf>(emptiedOne);
        Assert.AreEqual(oneEmptied, afterOne.Health);
        await AssertStatusAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, afterOne.Version, N9c5HNoHealth, "Run a 10k"),
            HttpStatusCode.OK);
        var emptied = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual(N9c5HNoHealth, emptied.Health);

        // And once emptied, giving one again is adding it: refused.
        await N9c5HAssertClosedAsync(
            await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, emptied.Version, N9c5HMarkers, "Run a 10k"));
        Assert.AreEqual(N9c5HNoHealth, (await N9c5HSelfAsync(trainee.Client)).Health);

        N9c5HAssertNoMarkerLogged("n9c5h-marker-medication-orvane-2291");
    }

    // ---------- 4. clients a coach invited ----------

    [TestMethod]
    public async Task N9c5HAClientACoachInvitedInTheHouseOrElsewhereKeepsTheStepOpen()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("h-invited");
        var house = space.House;
        using var invited = CreateClient();
        var invitedId = await R31InviteAsync(house.Coach!, invited, house.TenantId, "n9c5h-invited-rita@example.test", "Rita", "Daher");
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9c5h-invited-other@example.test", "Zeina Aoun", "N9c5H Invited Other Gym");
        using var elsewhere = CreateClient();
        var elsewhereId = await R31InviteAsync(otherOwner, elsewhere, otherSpace, "n9c5h-invited-karim@example.test", "Karim", "Nassar");

        foreach (var (client, clientId, coach, where) in new[]
                 {
                     (invited, invitedId, house.Coach!, "the house"),
                     (elsewhere, elsewhereId, otherOwner, "another coaching space"),
                 })
        {
            var own = await N9c5HSelfAsync(client);
            Assert.AreEqual((false, false, true), (own.SelfDirected, own.CoachedByTheHouse, own.HealthStepOpen), where);
            var byCoach = await N9c5HStaffAsync(coach, clientId);
            Assert.IsTrue(byCoach.HealthStepOpen, where);

            // Their own save, their coach's and their set-up's finish each keep health answers.
            var saved = await N9c5HSaveAsync(client, N9c5HOwnIntakeUrl, own.Version, N9c5HMarkers, "Build strength");
            await AssertStatusAsync(saved, HttpStatusCode.OK);
            var savedSelf = await RequiredJsonAsync<N9c5HSelf>(saved);
            Assert.AreEqual((N9c5HMarkers, true, false), (savedSelf.Health, savedSelf.HealthStepOpen, savedSelf.CoachedByTheHouse), where);
            var change = N9c5HMarkers with { Allergies = "n9c5h-marker-allergy-plum-4402" };
            var coachSaved = await N9c5HSaveAsync(coach, N9c5HStaffIntakeUrl(clientId), savedSelf.Version, change, "Build strength");
            await AssertStatusAsync(coachSaved, HttpStatusCode.OK);
            var coachView = await ReadSlicePayloadAsync<CoachClientDetails>(coachSaved);
            Assert.AreEqual((true, "n9c5h-marker-allergy-plum-4402"), (coachView.HealthStepOpen, coachView.Allergies), where);
            var setUp = await N9a1CompleteOnboardingAsync(client, N9c5HBorn, coachView.Version, today, N9c5HMarkers);
            await AssertStatusAsync(setUp, HttpStatusCode.OK);
            Assert.AreEqual(N9c5HMarkers, (await RequiredJsonAsync<N9c5HSelf>(setUp)).Health, where);
        }

        N9c5HAssertNoMarkerLogged("n9c5h-marker-allergy-plum-4402");
    }

    // ---------- 5. the notices ----------

    [TestMethod]
    public async Task N9c5HAMaxTraineeIsToldOfANewCoachAsACoachsClientIsAndAFreeTraineeInWordsOfTheirOwn()
    {
        N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("h-reassign");
        var house = space.House;
        using var onMax = await N9a1TraineeAsync(house.TenantId, "n9c5h-reassign-max@example.test", "Mira", "Saab", address: "198.51.100.151");
        using var onFree = await N9a1TraineeAsync(house.TenantId, "n9c5h-reassign-free@example.test", "Hadi", "Zein", address: "198.51.100.152");
        await N9c5OnMaxAsync(space, onMax);

        // The Owner takes each from the house's Coach.
        await ReassignAsync(house.Owner, onMax.ProfileId, house.OwnerUserId, null);
        await ReassignAsync(house.Owner, onFree.ProfileId, house.OwnerUserId, null);

        // The Max trainee hears they have a new coach, keyed by the history entry, as a coach's client does.
        var maxEntry = (await N9d1bHistoryAsync(house.Owner, onMax.ProfileId))[^1];
        var assigned = (await N9d1bQueuedAsync("CoachAssigned", onMax.UserId)).Single();
        Assert.AreEqual((maxEntry.Id, $"coach-assigned:{maxEntry.Id:N}:v1"), (assigned.AggregateId, assigned.DeduplicationKey));
        Assert.IsEmpty(await N9d1bQueuedAsync("TraineeStaffChanged", onMax.UserId));

        // The Free trainee keeps their own words: who can see their training changed.
        Assert.HasCount(1, await N9d1bQueuedAsync("TraineeStaffChanged", onFree.UserId));
        Assert.IsEmpty(await N9d1bQueuedAsync("CoachAssigned", onFree.UserId));

        await SweepDepartureNotificationsAsync();
        Assert.AreEqual(
            "You have a new coach",
            (await N9d1bInboxAsync(onMax.Client)).Single(item => item.Kind == "CoachAssigned").Title);
        Assert.AreEqual(
            "Who can see your training changed",
            (await N9d1bInboxAsync(onFree.Client)).Single(item => item.Kind == "TraineeStaffChanged").Title);

        // The Owner now coaches the Max trainee, whose step is open on the read the reassignment answered.
        var details = await N9c5HStaffAsync(house.Owner, onMax.ProfileId);
        Assert.AreEqual((true, true), (details.MayCoach, details.HealthStepOpen));
    }

    [TestMethod]
    public async Task N9c5HAMaxTraineeLeavingOrClosingTheirAccountTellsTheOwnerAndTheirCoachAndAFreeTraineeTellsNobody()
    {
        N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("h-leave");
        var house = space.House;
        using var maxLeaver = await N9a1TraineeAsync(house.TenantId, "n9c5h-leave-max@example.test", "Mira", "Saab", address: "198.51.100.161");
        using var maxCloser = await N9a1TraineeAsync(house.TenantId, "n9c5h-close-max@example.test", "Tala", "Rizk", address: "198.51.100.162");
        using var freeLeaver = await N9a1TraineeAsync(house.TenantId, "n9c5h-leave-free@example.test", "Hadi", "Zein", address: "198.51.100.163");
        using var freeCloser = await N9a1TraineeAsync(house.TenantId, "n9c5h-close-free@example.test", "Rami", "Aoun", address: "198.51.100.164");
        var maxLeaverAsk = await N9c5OnMaxAsync(space, maxLeaver);
        await N9c5OnMaxAsync(space, maxCloser);
        var staff = new[] { house.OwnerUserId, house.CoachUserId!.Value };

        // A Max trainee leaves the house: the Owner and their coach are each told, once, and Max ends with the leaving.
        await N9a1LeaveAsync(maxLeaver.Client, "Moving to Tripoli");
        CollectionAssert.AreEquivalent(staff, await N9c1RecipientsAsync("ClientLeft", maxLeaver.ProfileId));
        Assert.AreEqual(
            "Cancelled",
            await N9c5HEnrollmentStatusAsync(maxLeaverAsk.Outcome!.EnrollmentId!.Value),
            "The tier was read before the leaving cancelled Max.");

        // A Max trainee closes their account: the house is told as well, in that space's own scope.
        await AssertStatusAsync(await N9eCloseAsync(maxCloser.Client, Password), HttpStatusCode.NoContent);
        CollectionAssert.AreEquivalent(staff, await N9c1RecipientsAsync("ClientLeft", maxCloser.ProfileId));

        // A Free trainee's leaving and closing tell no staff inbox, as before.
        await N9a1LeaveAsync(freeLeaver.Client, "Trying it alone");
        await AssertStatusAsync(await N9eCloseAsync(freeCloser.Client, Password), HttpStatusCode.NoContent);
        Assert.IsEmpty(await N9c1RecipientsAsync("ClientLeft", freeLeaver.ProfileId));
        Assert.IsEmpty(await N9c1RecipientsAsync("ClientLeft", freeCloser.ProfileId));

        // Swept: the Owner's and the Coach's inboxes name the Max trainee who left, and nobody else.
        await SweepDepartureNotificationsAsync();
        foreach (var reader in new[] { house.Owner, house.Coach! })
        {
            var left = (await N9d1bInboxAsync(reader)).Where(item => item.Kind == "ClientLeft").Select(item => item.Title).ToArray();
            Assert.HasCount(2, left);
            Assert.Contains("Mira Saab left your coaching space", left);
            foreach (var title in left)
            {
                Assert.DoesNotContain("Hadi", title);
                Assert.DoesNotContain("Rami", title);
            }
        }
    }

    // ---------- helpers ----------

    private static readonly DateOnly N9c5HBorn = DateOnly.ParseExact(N9a1BirthDate, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string N9c5HStaffIntakeUrl(Guid clientProfileId) => $"/api/clients/{clientProfileId}/intake";

    private static async Task<N9c5HSelf> N9c5HSelfAsync(HttpClient client) =>
        await RequiredJsonAsync<N9c5HSelf>(await client.GetAsync(N9c5HSelfUrl));

    private static Task<CoachClientDetails> N9c5HStaffAsync(HttpClient staff, Guid clientProfileId) =>
        ReadSliceAsync<CoachClientDetails>(staff, $"/api/clients/{clientProfileId}");

    /// <summary>
    /// The intake as the form sends it for a trainee who signed up with <see cref="N9a1BirthDate"/>: the same names and
    /// date of birth, a goal and the health answers given; a set-up profile also keeps its height.
    /// </summary>
    private static object N9c5HIntake(uint version, N9a1Health health, string goals, bool setUp = false) => new
    {
        firstName = "Dalia",
        lastName = "Mansour",
        birthDate = N9a1BirthDate,
        heightValue = setUp ? 168m : (decimal?)null,
        heightUnit = setUp ? "Centimeter" : null,
        goals,
        allergies = health.Allergies,
        medications = health.Medications,
        previousInjuries = health.PreviousInjuries,
        version,
    };

    private static async Task<HttpResponseMessage> N9c5HSaveAsync(
        HttpClient caller,
        string url,
        uint version,
        N9a1Health health,
        string goals,
        bool setUp = false)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PutAsJsonAsync(url, N9c5HIntake(version, health, goals, setUp));
    }

    /// <summary>The Health step's refusal: a conflict with its code and its words, repeating nothing that was sent.</summary>
    private static async Task N9c5HAssertClosedAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode, body);
        using var json = JsonDocument.Parse(body);
        Assert.AreEqual(
            (N9c5HClosedCode, N9c5HClosedMessage),
            (json.RootElement.GetProperty("code").GetString(), json.RootElement.GetProperty("message").GetString()));
        Assert.DoesNotContain("n9c5h-marker", body);
    }

    /// <summary>
    /// The step, closed or open, as the trainee and the house's Coach read it, and a health save from the trainee
    /// refused while it is closed.
    /// </summary>
    private static async Task N9c5HAssertStepAsync(N9a1Trainee trainee, N9a1House house, bool open, string when)
    {
        var self = await N9c5HSelfAsync(trainee.Client);
        Assert.AreEqual((open, open), (self.CoachedByTheHouse, self.HealthStepOpen), when);
        Assert.AreEqual(open, (await N9c5HStaffAsync(house.Coach!, trainee.ProfileId)).HealthStepOpen, when);
        if (!open)
        {
            await N9c5HAssertClosedAsync(
                await N9c5HSaveAsync(trainee.Client, N9c5HOwnIntakeUrl, self.Version, N9c5HMarkers, "Build strength"));
            Assert.AreEqual(N9c5HNoHealth, (await N9c5HSelfAsync(trainee.Client)).Health, when);
        }
    }

    /// <summary>The Owner pauses a plan, as the client's page does.</summary>
    private async Task N9c5HPauseAsync(HttpClient staff, Guid enrollmentId)
    {
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollmentId}/pause",
                new { reason = "Travelling for two weeks", version = await N9c5HEnrollmentVersionAsync(enrollmentId) }),
            HttpStatusCode.OK);
    }

    private async Task<uint> N9c5HEnrollmentVersionAsync(Guid enrollmentId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ClientEnrollments.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.Id == enrollmentId)
            .Select(item => item.Version)
            .SingleAsync();
    }

    private async Task<string> N9c5HEnrollmentStatusAsync(Guid enrollmentId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return (await context.ClientEnrollments.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.Id == enrollmentId)
            .Select(item => item.Status)
            .SingleAsync()).ToString();
    }

    private Task<long> N9c5HWeighInsAsync(Guid clientProfileId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM progress."BodyweightObservations" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    /// <summary>No health answer the test sent, the markers or <paramref name="others"/>, is in any log line.</summary>
    private void N9c5HAssertNoMarkerLogged(params string[] others)
    {
        var logged = RequiredEveryLogLine.Text;
        Assert.IsGreaterThan(0, logged.Length, "The capture was reading all along.");
        foreach (var marker in new[] { N9c5HMarkers.Allergies!, N9c5HMarkers.Medications!, N9c5HMarkers.PreviousInjuries! }.Concat(others))
        {
            Assert.DoesNotContain(marker, logged, StringComparison.OrdinalIgnoreCase, $"The log holds '{marker}'.");
        }

        Assert.DoesNotContain("n9c5h-marker", logged, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The person's own profile as the client's screens read it.</summary>
    private sealed record N9c5HSelf(
        Guid Id,
        uint Version,
        string? Goals,
        string OnboardingStatus,
        string? Allergies,
        string? Medications,
        string? PreviousInjuries,
        bool SelfDirected,
        bool CoachedByTheHouse,
        bool HealthStepOpen)
    {
        public N9a1Health Health => new(Allergies, Medications, PreviousInjuries);
    }
}
