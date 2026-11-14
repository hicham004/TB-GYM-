using System.Net;
using System.Net.Http.Json;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Notes plan N9c5a, part B (CLI-026 as N9c5 amends it): a trainee of the house on Max is coached while Max grants, on
/// Coach Today, the client list, the waiting list and the activity feed, in the notices a coach's client gets, and with
/// their private side their coach's alone; the house's day Max ends they train as their own coach again, with nothing
/// written. A plan of the house is never chased on Today. Free and Pro+ trainees stay their own coach throughout.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly CoachAttentionKind[] N9c5CCoachsKinds =
    [
        CoachAttentionKind.CheckInToReview,
        CoachAttentionKind.UnreadMessages,
        CoachAttentionKind.NoProgram,
    ];

    private static readonly CoachAttentionKind[] N9c5COwnersKinds = [CoachAttentionKind.CheckInToReview];

    // ---------- 1. Coach Today, the list and the client's page ----------

    [TestMethod]
    public async Task N9c5CATraineeOnMaxIsOnCoachTodayWhileMaxGrantsAndOffItTheDayItEnds()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("today");
        var house = space.House;
        using var maya = await N9a1TraineeAsync(house.TenantId, "n9c5c-today-maya@example.test", "Maya", "Rahman");
        using var farah = await N9a1TraineeAsync(house.TenantId, "n9c5c-today-farah@example.test", "Farah", "Saleh");
        using var paul = await N9a1TraineeAsync(house.TenantId, "n9c5c-today-paul@example.test", "Paul", "Nader");
        await N9c1AskAndBookAsync(space.Space, paul);
        var staff = new[] { (Caller: house.Owner, Who: "the owner"), (Caller: house.Coach!, Who: "the Coach") };

        // On Free and Pro+ nobody raises anything, though each has Training and no program.
        foreach (var (caller, who) in staff)
        {
            Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl)).Attention, who);
            foreach (var row in (await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl)).Clients)
            {
                Assert.IsTrue(row.SelfDirected, $"{who}: {row.Client.FirstName}");
                Assert.IsEmpty(row.Attention, $"{who}: {row.Client.FirstName}");
            }
        }

        // Maya books Max. Her coach, the house's Coach, sends her a check-in she answers and a chat she writes in.
        var booked = await N9c5OnMaxAsync(space, maya);
        Assert.AreEqual(((DateOnly?)today, (DateOnly?)today.AddDays(27)), (booked.Outcome!.PlanStartDate, booked.Outcome.PlanLastDay));
        var form = await Phase6CreateFormAsync(house.Owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(house.Owner, form.Form.Id, form.Versions[0]);
        var checkIn = await B4aAssignAsync(house.Coach!, maya.ProfileId, version.Id, today.AddDays(2));
        R31Tick();
        await B4aSendAsync(maya.Client, checkIn, version);
        var chat = await StartChatAsync(house.Coach!, maya.ProfileId);
        R31Tick();
        await SendChatAsync(maya.Client, chat, "First week on Max.");

        // She raises what a coach's client does: her Coach reads all three and opens each; the Owner, who manages her
        // but does not coach her, reads the check-in's count with nothing to open (C8, notes plan N9d1a).
        await N9c5CAssertOnTodayAsync(space, maya, checkIn, chat, "on Max");
        foreach (var trainee in new[] { farah, paul })
        {
            await N9c5CAssertQuietAsync(space, trainee, "on Free or Pro+, beside Max");
        }

        // Two weeks on, Max's last day is 13 days away: a coach's plan would be ending soon, a plan of the house is never
        // chased. Nothing else changed.
        N9b1FSetHouseDay(today.AddDays(14));
        await N9c5CAssertOnTodayAsync(space, maya, checkIn, chat, "two weeks before Max ends");
        foreach (var (caller, who) in staff)
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            Assert.AreEqual(0, view.PlansEndingSoonCount, who);
            Assert.IsEmpty(view.PlansEndingSoon, who);
            Assert.IsFalse(view.Attention.Any(item => item.Kind == CoachAttentionKind.PlanEndingSoon), who);
            var row = (await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl)).Clients
                .Single(item => item.Client.ClientProfileId == maya.ProfileId);
            Assert.AreEqual((ClientPlanStatus.OnTrack, today.AddDays(27)), (row.PlanStatus, row.PlanEndsOn), who);
            Assert.DoesNotContain(CoachAttentionKind.PlanEndingSoon, row.Attention, who);
        }

        // The house's day Max ends she trains as her own coach again, and raises nothing; no plan is listed as ended.
        N9b1FSetHouseDay(today.AddDays(28));
        foreach (var trainee in new[] { maya, farah, paul })
        {
            await N9c5CAssertQuietAsync(space, trainee, "the day Max ended");
        }

        foreach (var (caller, who) in staff)
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            Assert.IsEmpty(view.PlansEndedNotRenewed, who);
            Assert.AreEqual(3, view.ClientCount, who);
        }
    }

    // ---------- 2. one read of the house's tiers ----------

    [TestMethod]
    public async Task N9c5CTodayReadsTheHousesTiersOnceWithATraineeInScopeAndNeverInACoachsSpace()
    {
        R61aStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("queries");
        var house = space.House;

        // No trainee yet: nothing to read.
        await N9c5CMeasureTiersAsync(house.Owner, CoachTodayUrl, "N9c5 house Today, no trainee", 0);

        using var maya = await N9a1TraineeAsync(house.TenantId, "n9c5c-queries-maya@example.test", "Maya", "Rahman");
        using var farah = await N9a1TraineeAsync(house.TenantId, "n9c5c-queries-farah@example.test", "Farah", "Saleh");
        using var paul = await N9a1TraineeAsync(house.TenantId, "n9c5c-queries-paul@example.test", "Paul", "Nader");
        await N9c5OnMaxAsync(space, maya);
        await N9c1AskAndBookAsync(space.Space, paul);
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9c5c-queries-rita@example.test", "Rita", "Daher");

        // One read for every trainee in scope, on Today, the list and a client's page alike, for the Owner and the Coach.
        var fewer = 0;
        foreach (var (caller, who) in new[] { (house.Owner, "owner"), (house.Coach!, "Coach") })
        {
            fewer = await N9c5CMeasureTiersAsync(caller, CoachTodayUrl, $"N9c5 house Today, three trainees, the {who}", 1);
            await N9c5CMeasureTiersAsync(caller, ClientOverviewUrl, $"N9c5 house client list, the {who}", 1);
            await N9c5CMeasureTiersAsync(caller, R33bOverviewUrl(maya.ProfileId), $"N9c5 a trainee's page, the {who}", 1);
            await N9c5CMeasureTiersAsync(caller, R33bOverviewUrl(ritaId), $"N9c5 an invited client's page, the {who}", 0);
        }

        // Another trainee on Max costs Today no query.
        using var nadia = await N9a1TraineeAsync(house.TenantId, "n9c5c-queries-nadia@example.test", "Nadia", "Haddad");
        await N9c5OnMaxAsync(space, nadia);
        var more = await N9c5CMeasureTiersAsync(house.Coach!, CoachTodayUrl, "N9c5 house Today, four trainees, the Coach", 1);
        Assert.AreEqual(fewer, more, "A trainee more costs the house's Today no query.");

        // A coach's own space never reads a tier.
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9c5c-queries-owner@example.test", "Karim Haddad", "N9c5 Queries");
        using var sami = CreateClient();
        await R31InviteAsync(owner, sami, tenant, "n9c5c-queries-sami@example.test", "Sami", "Aoun");
        await N9c5CMeasureTiersAsync(owner, CoachTodayUrl, "N9c5 a coach's Today", 0);
        await N9c5CMeasureTiersAsync(owner, ClientOverviewUrl, "N9c5 a coach's client list", 0);
    }

    // ---------- 3. the coach leaves ----------

    [TestMethod]
    public async Task N9c5CATraineeOnMaxWhoseCoachLeavesIsToldAndWaitsOnTheOwnersListWhileAFreeTraineeIsNeither()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("gone");
        var house = space.House;
        using var maya = await N9a1TraineeAsync(house.TenantId, "n9c5c-gone-maya@example.test", "Maya", "Rahman");
        using var farah = await N9a1TraineeAsync(house.TenantId, "n9c5c-gone-farah@example.test", "Farah", "Saleh");
        await N9c5OnMaxAsync(space, maya);
        var before = await ReadSliceAsync<CoachTodayView>(house.Owner, CoachTodayUrl);
        Assert.IsEmpty(before.WaitingForCoach!, "Both have the house's Coach.");

        await RemoveCoachForBillingAsync(house.Owner, house.CoachUserId!.Value);

        // Both records wait for a coach; Maya, whom Max coaches, is told in-app and by one email, as a coach's client
        // is (ADR 0027). Farah, her own coach on Free, is told nothing.
        foreach (var trainee in new[] { maya, farah })
        {
            Assert.IsNull((await N9a1ClientsAsync(house.Owner)).Single(item => item.Id == trainee.ProfileId).AssignedCoachUserId);
        }

        Assert.AreEqual(1L, await N9a1QueuedAsync("CoachDeparted", "RecipientUserId", maya.UserId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("CoachDeparted", "RecipientUserId", farah.UserId));
        await SweepDepartureNotificationsAsync();
        var mayasInbox = await RequiredJsonAsync<DepartureInbox>(await maya.Client.GetAsync("/api/notifications"));
        Assert.HasCount(1, mayasInbox.Items.Where(item => item.Kind == "CoachDeparted"));
        var farahsInbox = await RequiredJsonAsync<DepartureInbox>(await farah.Client.GetAsync("/api/notifications"));
        Assert.IsFalse(farahsInbox.Items.Any(item => item.Kind == "CoachDeparted"), "A trainee on Free has no coach to lose.");
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        Assert.AreEqual(
            "n9c5c-gone-maya@example.test",
            CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice).RecipientAddress);

        // The Owner's Today lists Maya waiting, after the Coach who left; Farah trains as her own coach and is not listed.
        var view = await ReadSliceAsync<CoachTodayView>(house.Owner, CoachTodayUrl);
        var waiting = view.WaitingForCoach!.Single();
        Assert.AreEqual((maya.ProfileId, "Lea Khoury"), (waiting.Client.ClientProfileId, waiting.PreviousCoachName));
        Assert.IsFalse(view.Attention.Any(item => item.Client.ClientProfileId == farah.ProfileId), "Farah raised something.");

        // Once Max ends she is her own coach again: off the list, with nothing written.
        N9b1FSetHouseDay(today.AddDays(28));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(house.Owner, CoachTodayUrl)).WaitingForCoach!);
        Assert.IsNull((await N9a1ClientsAsync(house.Owner)).Single(item => item.Id == maya.ProfileId).AssignedCoachUserId);
    }

    // ---------- 4. the workout and its note ----------

    [TestMethod]
    public async Task N9c5CATraineeOnMaxHasTheirWorkoutInTheirCoachsFeedAndTheirNoteToldWhileAFreeTraineesReachNobody()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("feed");
        var house = space.House;
        using var maya = await N9a1TraineeAsync(house.TenantId, "n9c5c-feed-maya@example.test", "Maya", "Rahman");
        using var farah = await N9a1TraineeAsync(house.TenantId, "n9c5c-feed-farah@example.test", "Farah", "Saleh");
        var booked = await N9c5OnMaxAsync(space, maya);

        // The house's Coach gives each the same one-week program from today: Farah's on a training plan of the staff's
        // (Free blocks no other plan), Maya's on Max, which covers training and blocks another plan's.
        var training = await CreateTrainingResourcesAsync(house.Coach!, farah.ProfileId, 8, 1, today);
        await AssignAsync(house.Coach!, farah.ProfileId, training, today);
        var mayas = training with
        {
            Enrollment = new CoverageEnrollment(booked.Outcome!.EnrollmentId!.Value, today.AddDays(28), 0),
            Max = await RecordWorkingMaxAsync(house.Coach!, maya.ProfileId, training.Exercise.Id, 100m),
        };
        await AssignAsync(house.Coach!, maya.ProfileId, mayas, today);

        // Each finishes today's workout and writes a note on it.
        var farahsWorkout = await R25bFinishTodaysWorkoutAsync(farah.Client, 80m);
        R31Tick();
        var mayasWorkout = await R25bFinishTodaysWorkoutAsync(maya.Client, 82.5m);
        R31Tick();
        await N9c5CNoteAsync(farah.Client, farahsWorkout, "Felt strong today");
        await N9c5CNoteAsync(maya.Client, mayasWorkout, "Left knee felt it on the last set");

        // Maya's workout is in her Coach's feed and her note reaches him; Farah's reach nobody. The Owner coaches neither
        // and reads no feed of theirs (C8).
        Assert.AreEqual(1L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", mayasWorkout));
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", farahsWorkout));
        await R51cSweepAsync();
        var coachsNotes = (await R51cInboxAsync(house.Coach!)).Items.Where(item => item.Kind == "ClientWorkoutNote").ToArray();
        Assert.AreEqual((mayasWorkout, (Guid?)maya.ProfileId), (coachsNotes.Single().WorkoutExecutionId, coachsNotes.Single().ClientProfileId));
        Assert.IsFalse((await R51cInboxAsync(house.Owner)).Items.Any(item => item.Kind == "ClientWorkoutNote"));

        var coachsView = await ReadSliceAsync<CoachTodayView>(house.Coach!, CoachTodayUrl);
        var workout = coachsView.Activity.Single(item => item.Kind == CoachActivityKind.WorkoutCompleted);
        Assert.AreEqual((mayasWorkout, maya.ProfileId), (workout.SubjectId, workout.Client.ClientProfileId));
        Assert.IsFalse(coachsView.Activity.Any(item => item.Client.ClientProfileId == farah.ProfileId), "Farah's workout is in the feed.");
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(house.Owner, CoachTodayUrl)).Activity);

        // The house's day Max ends, Maya trains as her own coach again: on a program the Coach puts on a training plan of
        // the staff's from that day, her note tells nobody, as Farah's did.
        var ended = today.AddDays(28);
        N9b1FSetHouseDay(ended);
        var next = mayas with { Enrollment = await CreateTrainingEnrollmentAsync(house.Coach!, maya.ProfileId, ended, 8) };
        await AssignAsync(house.Coach!, maya.ProfileId, next, ended);
        var afterMax = await N9a1NoteOnTodaysWorkoutAsync(maya.Client, "Back to training alone");
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", afterMax));
        Assert.AreEqual(1L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", mayasWorkout));
    }

    // ---------- 5. the private side is the coach's ----------

    [TestMethod]
    public async Task N9c5CTheOwnerIsRefusedATraineeOnMaxsPrivateSideWhileTheHousesCoachReadsIt()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("private");
        var house = space.House;
        using var maya = await N9a1TraineeAsync(house.TenantId, "n9c5c-private-maya@example.test", "Maya", "Rahman");
        using var farah = await N9a1TraineeAsync(house.TenantId, "n9c5c-private-farah@example.test", "Farah", "Saleh");
        var booked = await N9c5OnMaxAsync(space, maya);

        // Her coach gives her a program on Max and a check-in; she trains and answers it.
        var training = await CreateTrainingResourcesAsync(house.Coach!, farah.ProfileId, 8, 1, today);
        var mayas = training with
        {
            Enrollment = new CoverageEnrollment(booked.Outcome!.EnrollmentId!.Value, today.AddDays(28), 0),
            Max = await RecordWorkingMaxAsync(house.Coach!, maya.ProfileId, training.Exercise.Id, 100m),
        };
        await AssignAsync(house.Coach!, maya.ProfileId, mayas, today);
        var workoutId = await R25bFinishTodaysWorkoutAsync(maya.Client, 80m);
        var form = await Phase6CreateFormAsync(house.Owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(house.Owner, form.Form.Id, form.Versions[0]);
        var checkIn = await B4aAssignAsync(house.Coach!, maya.ProfileId, version.Id, today.AddDays(2));
        await B4aSendAsync(maya.Client, checkIn, version);

        // Every private read is the house's Coach's; the Owner gets the tenant handler's 404 (client_not_assigned), as on
        // any coach's client (notes plan N9d1a).
        string[] privateReads =
        [
            $"/api/training/clients/{maya.ProfileId}/mesocycles",
            $"/api/training/clients/{maya.ProfileId}/program",
            $"/api/training/clients/{maya.ProfileId}/workouts/{workoutId}",
            $"/api/strength/clients/{maya.ProfileId}/maxes",
            $"/api/nutrition/clients/{maya.ProfileId}/plans",
            $"/api/checkins/clients/{maya.ProfileId}/assignments",
            $"/api/checkins/clients/{maya.ProfileId}/assignments/{checkIn}/response",
            $"/api/progress/clients/{maya.ProfileId}/dashboard",
        ];
        foreach (var url in privateReads)
        {
            await N9d1aAssertReadAsync(house.Coach!, "the house's Coach", url, HttpStatusCode.OK);
            var refused = await house.Owner.GetAsync(url);
            Assert.AreEqual(HttpStatusCode.NotFound, refused.StatusCode, $"The owner, GET {url}");
            Assert.AreEqual(string.Empty, await refused.Content.ReadAsStringAsync(), $"The owner, GET {url}: the handler's 404 says nothing.");
        }

        // The record: the Coach reads her private side, the Owner its business side alone.
        var forCoach = await ReadSliceAsync<CoachClientDetails>(house.Coach!, $"/api/clients/{maya.ProfileId}");
        var forOwner = await ReadSliceAsync<CoachClientDetails>(house.Owner, $"/api/clients/{maya.ProfileId}");
        Assert.AreEqual((true, false), (forCoach.MayCoach, forOwner.MayCoach));
        Assert.IsNotNull(forCoach.BirthDate, "Her coach reads her date of birth.");
        N9d1aAssertPrivateSideWithheld(forOwner);

        // Nobody outside the house reads any of it: signed out 401, another space's owner naming the house 403.
        using var anonymous = CreateClient();
        SetTenant(anonymous, house.TenantId);
        await AssertStatusAsync(await anonymous.GetAsync(CoachTodayUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.GetAsync(privateReads[0]), HttpStatusCode.Unauthorized);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9c5c-private-stranger@example.test", "Omar Nassar", "N9c5 Elsewhere");
        SetTenant(stranger, house.TenantId);
        foreach (var url in privateReads.Take(2).Append(CoachTodayUrl))
        {
            await N9d1aAssertReadAsync(stranger, "another space's owner", url, HttpStatusCode.Forbidden);
        }
    }

    // ---------- N9c5C helpers ----------

    /// <summary>
    /// The trainee on Max raises, for their coach, a check-in to review, an unread message and no program, each with what
    /// it opens; for the Owner the check-in's count alone. Their row and page say so, and they are coached, not
    /// self-directed.
    /// </summary>
    private static async Task N9c5CAssertOnTodayAsync(
        N9c5MaxSpace space,
        N9a1Trainee trainee,
        Guid checkInId,
        Guid chatId,
        string when)
    {
        foreach (var (caller, who, kinds) in new[]
                 {
                     (space.House.Coach!, "the Coach", N9c5CCoachsKinds),
                     (space.House.Owner, "the owner", N9c5COwnersKinds),
                 })
        {
            var coaches = caller == space.House.Coach;
            var label = $"{who}, {when}";
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            var items = view.Attention.Where(item => item.Client.ClientProfileId == trainee.ProfileId).ToArray();
            CollectionAssert.AreEqual(kinds, items.Select(item => item.Kind).ToArray(), label);
            Assert.IsTrue(items.All(item => item.Client.MayCoach == coaches), label);
            var toReview = items.Single(item => item.Kind == CoachAttentionKind.CheckInToReview);
            Assert.AreEqual(((int?)1, coaches ? checkInId : (Guid?)null), (toReview.Count, toReview.SubjectId), label);
            if (coaches)
            {
                var unread = items.Single(item => item.Kind == CoachAttentionKind.UnreadMessages);
                Assert.AreEqual(((int?)1, (Guid?)chatId, true), (unread.Count, unread.SubjectId, unread.CanMessage), label);
            }

            var row = (await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl)).Clients
                .Single(item => item.Client.ClientProfileId == trainee.ProfileId);
            Assert.IsFalse(row.SelfDirected, label);
            CollectionAssert.AreEqual(kinds, row.Attention.ToArray(), label);
            Assert.AreEqual(ClientOverviewStatus.NeedsAttention, row.Status, label);
            CollectionAssert.AreEqual(
                kinds,
                (await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(trainee.ProfileId))).Attention
                    .Select(item => item.Kind).ToArray(),
                label);
        }
    }

    /// <summary>A trainee who trains as their own coach raises nothing on Today, their row or their page.</summary>
    private static async Task N9c5CAssertQuietAsync(N9c5MaxSpace space, N9a1Trainee trainee, string when)
    {
        foreach (var (caller, who) in new[] { (space.House.Coach!, "the Coach"), (space.House.Owner, "the owner") })
        {
            var label = $"{who}, {when}, trainee {trainee.ProfileId}";
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            Assert.IsFalse(view.Attention.Any(item => item.Client.ClientProfileId == trainee.ProfileId), label);
            var row = (await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl)).Clients
                .Single(item => item.Client.ClientProfileId == trainee.ProfileId);
            Assert.IsTrue(row.SelfDirected, label);
            Assert.IsEmpty(row.Attention, label);
            Assert.IsEmpty(row.AttentionItems, label);
            Assert.IsEmpty((await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(trainee.ProfileId))).Attention, label);
        }
    }

    /// <summary>Reads one view, checks how many commands read the house's tiers, and returns every command it took.</summary>
    private async Task<int> N9c5CMeasureTiersAsync(HttpClient caller, string url, string label, int tierReads)
    {
        RequiredTodayQueryCounter.Reset();
        var response = await caller.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var queries = RequiredTodayQueryCounter.Count;
        Console.WriteLine($"{label}: {queries} SQL commands.");
        Assert.AreEqual(tierReads, RequiredTodayQueryCounter.ReadsTagged(HouseTierReader.TiersTag).Commands, label);
        return queries;
    }

    /// <summary>The client writes a note on a workout of theirs.</summary>
    private static async Task N9c5CNoteAsync(HttpClient client, Guid workoutId, string text)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync($"/api/training/workouts/{workoutId}/notes", new { exercisePerformanceId = (Guid?)null, text }),
            HttpStatusCode.OK);
    }
}
