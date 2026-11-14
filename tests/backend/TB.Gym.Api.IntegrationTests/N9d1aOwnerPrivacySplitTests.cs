using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Notes plan N9d1a, the owner privacy split (C8, ADR 0026). The Owner reaches the business side of every client (name,
/// coach, plan, payments, sessions, the relationship) and the private side (training, food, check-in answers, weigh-ins,
/// measurements, photos, intake and health, the coach's notes) only of the clients they coach themselves. Every route
/// naming a client is sorted into one side; the mixed reads (a client's record, Today, the client list and page) give
/// the Owner the business side alone. A Coach is still refused another coach's client on both sides.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9d1aToReviewUrl = "/api/checkins/to-review";
    private const string N9d1aTargetsUrl = "/api/nutrition/client-targets";
    private const string N9d1aGoals = "Run a 10k in May";
    private const string N9d1aCoachNotes = "Left knee: no deep lunges.";

    /// <summary>The reviewed routes naming a client that reach its business side; every other one is private.</summary>
    private static readonly string[] N9d1aBusinessClientRoutes =
    [
        "AssignProductToClient",
        "BlockClientRelationship",
        "BookHousePlanAsk",
        "CloseHousePlanAsk",
        "GetClientCommercialOverview",
        "GetClientForCoach",
        "GetClientOverview",
        "ListClientCoachAssignments",
        "ListClientHousePlanAsks",
        "ReassignClientCoach",
        "RecordClientSession",
        "ReleaseClient",
        "UnblockClientRelationship",
        "VoidClientSession",
    ];

    /// <summary>Words only the private side holds: none may reach the Owner on another coach's client.</summary>
    private static readonly string[] N9d1aPrivateWords =
        [N9d1aGoals, N9d1aCoachNotes, "Peanuts", "Ventolin", "Sprained left ankle", "Two years of gym work"];

    // Pins that every route naming a client carries a side, that the business list is exactly the reviewed one, and that
    // a request the handler cannot place reads as private.
    [TestMethod]
    public void N9d1aEveryClientRouteIsSortedIntoTheBusinessOrThePrivateSide()
    {
        var clientRoutes = RequiredFactory.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.Parameters.Any(parameter =>
                TenantRoleAuthorizationHandler.ClientRouteParameters.Contains(parameter.Name)))
            .ToArray();
        Assert.IsNotEmpty(clientRoutes, "No route names a client, so this test checks nothing.");

        var unsorted = clientRoutes
            .Where(endpoint => endpoint.Metadata.GetMetadata<ClientSide>() is null)
            .Select(endpoint => $"{N9d1aEndpointName(endpoint)} ({endpoint.RoutePattern.RawText})")
            .ToArray();
        Assert.IsEmpty(unsorted, $"Client routes with no side: {string.Join(", ", unsorted)}");

        var business = clientRoutes
            .Where(endpoint => endpoint.Metadata.GetMetadata<ClientSide>()!.IsBusiness)
            .Select(N9d1aEndpointName)
            .Order(StringComparer.Ordinal)
            .ToArray();
        CollectionAssert.AreEqual(N9d1aBusinessClientRoutes, business, string.Join(", ", business));

        // No endpoint reads as private; a route's own marker wins over its group's (the client record sits in the
        // private /api/clients group), and a route of that group without one stays private.
        Assert.AreSame(ClientSide.Private, TenantRoleAuthorizationHandler.RouteClientSide(new DefaultHttpContext()));
        Assert.AreSame(ClientSide.Business, N9d1aSideOf(clientRoutes, "GetClientForCoach"));
        Assert.AreSame(ClientSide.Private, N9d1aSideOf(clientRoutes, "UpdateClientIntakeForCoach"));
        Assert.AreSame(ClientSide.Business, N9d1aSideOf(clientRoutes, "AssignProductToClient"));
        Assert.AreSame(ClientSide.Private, N9d1aSideOf(clientRoutes, "ListClientMesocycles"));
    }

    // Pins the Owner on another coach's client route by route: every private read answers 404 while the coach reads it,
    // the business reads answer 200 with no private word in them, and the record comes without its private fields.
    [TestMethod]
    public async Task N9d1aTheOwnerReadsACoachsClientsBusinessSideAndNothingOfItsPrivateSide()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-reads-owner@example.test", "Karim Haddad", "N9d1a Reads");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "n9d1a-reads-coach@example.test", "Lea Khoury");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "n9d1a-reads-other@example.test", "Omar Nassar");
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            coach, mayaClient, tenant, "n9d1a-reads-maya@example.test", "Maya", "Rahman", await N9d1aFormAsync(coach), null, today);

        // Training, strength, food, check-in answers and progress are Lea's alone; another coach is refused as before.
        foreach (var url in N9d1aPrivateReads(maya))
        {
            await N9d1aAssertReadAsync(coach, "Lea, her coach", url, HttpStatusCode.OK);
            await N9d1aAssertReadAsync(owner, "the owner", url, HttpStatusCode.NotFound);
            await N9d1aAssertReadAsync(otherCoach, "another coach", url, HttpStatusCode.NotFound);
        }

        // The record, the client's page, the plans and the coach history are the business side: the owner reads them,
        // and nothing of the private side is in them. Another coach still gets 404 (the history is the owner's alone).
        string[] businessReads =
        [
            $"/api/clients/{maya.Id}",
            R33bOverviewUrl(maya.Id),
            $"/api/commercial/clients/{maya.Id}",
            $"/api/clients/{maya.Id}/coach-assignments",
        ];
        foreach (var url in businessReads)
        {
            var answer = await owner.GetAsync(url);
            await AssertStatusAsync(answer, HttpStatusCode.OK);
            var body = await answer.Content.ReadAsStringAsync();
            foreach (var secret in N9d1aPrivateWords.Concat([maya.WorkoutId.ToString(), maya.FirstAssignmentId.ToString()]))
            {
                Assert.IsFalse(body.Contains(secret, StringComparison.OrdinalIgnoreCase), $"{url} told the owner \"{secret}\".");
            }
        }

        foreach (var url in businessReads.Take(3))
        {
            await N9d1aAssertReadAsync(otherCoach, "another coach", url, HttpStatusCode.NotFound);
        }

        // The record: the same business side as Lea's, with the private side withheld from the owner.
        var forCoach = await ReadSliceAsync<CoachClientDetails>(coach, $"/api/clients/{maya.Id}");
        var forOwner = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{maya.Id}");
        Assert.IsTrue(forCoach.MayCoach, "Lea coaches Maya.");
        Assert.IsFalse(forOwner.MayCoach, "The owner does not coach Maya.");
        Assert.AreEqual(N9d1aBusinessSide(forCoach), N9d1aBusinessSide(forOwner));
        Assert.AreEqual(
            ("Maya", "Rahman", "n9d1a-reads-maya@example.test", "+96170000000", coachUserId, "Lea Khoury"),
            (forOwner.FirstName, forOwner.LastName, forOwner.Email, forOwner.PhoneNumber, forOwner.AssignedCoachUserId,
                forOwner.AssignedCoachName));
        N9d1aAssertPrivateSideShown(forCoach);
        N9d1aAssertPrivateSideWithheld(forOwner);

        // Her progress photo is Lea's alone too (the grant resyncs the clock, so it comes last).
        await AssertPhotoReadableAsync(owner, maya.PhotoAssetId, expected: false);
        await AssertPhotoReadableAsync(otherCoach, maya.PhotoAssetId, expected: false);
        await AssertPhotoReadableAsync(coach, maya.PhotoAssetId, expected: true);
    }

    // Pins that the Owner's private writes on another coach's client answer 404 and change nothing, while the business
    // writes (block, unblock, a plan and its payment) go through and answer with the record's business side alone.
    [TestMethod]
    public async Task N9d1aTheOwnerWritesNothingPrivateOnACoachsClientAndStillRunsItsBusiness()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-writes-owner@example.test", "Karim Haddad", "N9d1a Writes");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9d1a-writes-coach@example.test", "Lea Khoury");
        var form = await N9d1aFormAsync(coach);
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            coach, mayaClient, tenant, "n9d1a-writes-maya@example.test", "Maya", "Rahman", form, null, today);
        var before = await ReadSliceAsync<CoachClientDetails>(coach, $"/api/clients/{maya.Id}");
        var maxesBefore = await N9d1aTotalAsync(coach, $"/api/strength/clients/{maya.Id}/maxes");

        // Each would be a valid write for her coach; from the owner it is refused as for a client that does not exist.
        var attempts = new (string Name, Func<Task<HttpResponseMessage>> Send)[]
        {
            ("intake", () => owner.PutAsJsonAsync($"/api/clients/{maya.Id}/intake", N9d1aIntake(before, "The owner's goal"))),
            ("coach notes", () => owner.PutAsJsonAsync(
                $"/api/clients/{maya.Id}/coach-notes", new { notes = "The owner's note", version = before.Version })),
            ("weigh-in", () => owner.PostAsJsonAsync(
                $"/api/progress/clients/{maya.Id}/bodyweight", new { value = 99m, unit = "Kilogram", measurementDate = today })),
            ("program", () => owner.PostAsJsonAsync(
                $"/api/training/clients/{maya.Id}/mesocycles", AssignmentRequestAt(maya.Training, today.AddDays(14), Guid.NewGuid()))),
            ("max", () => owner.PostAsJsonAsync(
                $"/api/strength/clients/{maya.Id}/maxes", N9d1aMaxRequest(maya.Training.Exercise.Id, 140m))),
            ("check-in", () => owner.PostAsJsonAsync(
                $"/api/checkins/clients/{maya.Id}/assignments", new { formVersionId = form.Id, dueDate = today.AddDays(7) })),
            ("review", () => owner.PostAsJsonAsync(
                $"/api/checkins/clients/{maya.Id}/assignments/{maya.FirstAssignmentId}/response/review", new { version = 1u })),
            ("allergens", () => owner.PutAsJsonAsync($"/api/nutrition/clients/{maya.Id}/allergens", new { codes = MilkAllergen })),
            ("finished programs", () => owner.PutAsJsonAsync(
                $"/api/training/clients/{maya.Id}/finished-programs", new { canSeeFinishedPrograms = true, version = 0u })),
        };
        foreach (var (name, send) in attempts)
        {
            await RefreshCsrfAsync(owner);
            var refused = await send();
            Assert.AreEqual(
                HttpStatusCode.NotFound,
                refused.StatusCode,
                $"The owner's {name} on Lea's client: {await refused.Content.ReadAsStringAsync()}");
        }

        // Nothing was written.
        var after = await ReadSliceAsync<CoachClientDetails>(coach, $"/api/clients/{maya.Id}");
        Assert.AreEqual((before.Version, N9d1aGoals, N9d1aCoachNotes), (after.Version, after.Goals, after.CoachNotes));
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            "SELECT count(*) FROM progress.\"BodyweightObservations\" WHERE \"ClientProfileId\" = @id",
            maya.Id));
        Assert.HasCount(1, await RequiredJsonAsync<N9d1aId[]>(await coach.GetAsync($"/api/training/clients/{maya.Id}/mesocycles")));
        Assert.AreEqual(maxesBefore, await N9d1aTotalAsync(coach, $"/api/strength/clients/{maya.Id}/maxes"));
        Assert.AreEqual(2L, await N9d1aTotalAsync(coach, $"/api/checkins/clients/{maya.Id}/assignments"));
        Assert.AreEqual(2, (await ReadSliceAsync<CheckInToReviewList>(coach, N9d1aToReviewUrl)).Total, "Both still wait for Lea.");

        // The relationship and the money are the business side: the owner blocks and unblocks Maya, and each write
        // answers with her record's business side alone.
        await RefreshCsrfAsync(owner);
        var block = await owner.PostAsJsonAsync(
            $"/api/clients/{maya.Id}/relationship/block", new { reason = "Two months unpaid", version = before.Version });
        await AssertStatusAsync(block, HttpStatusCode.OK);
        var blocked = await ReadSlicePayloadAsync<CoachClientDetails>(block);
        Assert.AreEqual((true, false), (blocked.IsCoachBlocked, blocked.MayCoach));
        N9d1aAssertPrivateSideWithheld(blocked);
        await RefreshCsrfAsync(owner);
        var unblock = await owner.PostAsJsonAsync(
            $"/api/clients/{maya.Id}/relationship/unblock", new { reason = "Paid in full", version = blocked.Version });
        await AssertStatusAsync(unblock, HttpStatusCode.OK);
        var unblocked = await ReadSlicePayloadAsync<CoachClientDetails>(unblock);
        Assert.AreEqual((false, false), (unblocked.IsCoachBlocked, unblocked.MayCoach));
        N9d1aAssertPrivateSideWithheld(unblocked);

        // The owner books her a plan and records its payment.
        var paid = await B4aPaidPlanAsync(owner, maya.Id, "N9d1a chat plan", 120m, 4, "Messaging");
        Assert.AreEqual((120m, 0m), (paid.PaidAmount, paid.BalanceAmount));

        // Lea still reads every word she wrote.
        N9d1aAssertPrivateSideShown(await ReadSliceAsync<CoachClientDetails>(coach, $"/api/clients/{maya.Id}"));
    }

    // Pins the routes that reach a coach's client through another row: a program by its id, its maxes and a workout's
    // notes are private (404 for the Owner), a progress photo is the coach's alone, a plan by its id is business.
    [TestMethod]
    public async Task N9d1aRoutesReachingACoachsClientThroughAnotherRowFollowTheSameSplit()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-rows-owner@example.test", "Karim Haddad", "N9d1a Rows");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9d1a-rows-coach@example.test", "Lea Khoury");
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            coach, mayaClient, tenant, "n9d1a-rows-maya@example.test", "Maya", "Rahman", await N9d1aFormAsync(coach), null, today);

        // A program by its id, and its maxes.
        foreach (var url in new[] { $"/api/training/mesocycles/{maya.Block.Id}", $"/api/training/mesocycles/{maya.Block.Id}/training-maxes" })
        {
            await N9d1aAssertReadAsync(coach, "Lea, her coach", url, HttpStatusCode.OK);
            await N9d1aAssertReadAsync(owner, "the owner", url, HttpStatusCode.NotFound);
        }

        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync(
                $"/api/training/mesocycles/{maya.Block.Id}/visibility", new { revealAllWeeks = true, version = maya.Block.Version }),
            HttpStatusCode.NotFound);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync(
                $"/api/training/mesocycles/{maya.Block.Id}/name", new { name = "The owner's name", version = maya.Block.Version }),
            HttpStatusCode.NotFound);

        // A note on her workout: Lea's to write, not the owner's.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/training/workouts/{maya.WorkoutId}/notes", new { text = "Nice work, Maya" }),
            HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/workouts/{maya.WorkoutId}/notes", new { text = "Nice work, Maya" }),
            HttpStatusCode.OK);

        // Her plan by its id is the business side: the owner pauses and resumes it.
        await RefreshCsrfAsync(owner);
        var paused = await owner.PostAsJsonAsync(
            $"/api/commercial/enrollments/{maya.Training.Enrollment.Id}/pause",
            new { reason = "Travelling for work", version = maya.Training.Enrollment.Version });
        await AssertStatusAsync(paused, HttpStatusCode.OK);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/commercial/enrollments/{maya.Training.Enrollment.Id}/resume",
                new { version = (await RequiredJsonAsync<N9d1aVersioned>(paused)).Version }),
            HttpStatusCode.OK);

        // Her photo by its media id, alone and in a batch: Lea's alone.
        await AssertPhotoReadableAsync(owner, maya.PhotoAssetId, expected: false);
        var ownersBatch = await Phase6GrantBatchAsync(owner, maya.PhotoAssetId);
        await AssertStatusAsync(ownersBatch, HttpStatusCode.OK);
        Assert.IsEmpty((await RequiredJsonAsync<Phase6GrantBatch>(ownersBatch)).Items, "The batch grants the owner nothing.");
        await AssertPhotoReadableAsync(coach, maya.PhotoAssetId, expected: true);
        var coachsBatch = await Phase6GrantBatchAsync(coach, maya.PhotoAssetId);
        await AssertStatusAsync(coachsBatch, HttpStatusCode.OK);
        Assert.AreEqual(maya.PhotoAssetId, (await RequiredJsonAsync<Phase6GrantBatch>(coachsBatch)).Items.Single().AssetId);
    }

    // Pins that nothing changed for the Owner's own clients: every private read, the record, the page, the list row,
    // Today, the lists and the photo stay theirs, and a team coach is still refused them.
    [TestMethod]
    public async Task N9d1aTheOwnerStillReadsEveryPrivateSideOfAClientTheyCoachThemselves()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-own-owner@example.test", "Karim Haddad", "N9d1a Own");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9d1a-own-coach@example.test", "Lea Khoury");
        using var ramiClient = CreateClient();
        var rami = await N9d1aCoachedClientAsync(
            owner, ramiClient, tenant, "n9d1a-own-rami@example.test", "Rami", "Saliba", await N9d1aFormAsync(owner), null, today);

        string[] reads =
        [
            .. N9d1aPrivateReads(rami),
            $"/api/training/mesocycles/{rami.Block.Id}",
            $"/api/training/mesocycles/{rami.Block.Id}/training-maxes",
        ];
        foreach (var url in reads)
        {
            await N9d1aAssertReadAsync(owner, "the owner, his coach", url, HttpStatusCode.OK);
            await N9d1aAssertReadAsync(coach, "a team coach", url, HttpStatusCode.NotFound);
        }

        var details = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{rami.Id}");
        Assert.IsTrue(details.MayCoach);
        N9d1aAssertPrivateSideShown(details);

        var page = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(rami.Id));
        Assert.AreEqual((true, (Guid?)rami.WorkoutId), (page.Client.MayCoach, page.LastWorkout?.SubjectId));
        Assert.IsNotNull(page.LastActivityKind);
        var row = (await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((true, N9d1aGoals, (DateOnly?)new DateOnly(1995, 4, 2)), (row.Client.MayCoach, row.Goals, row.BirthDate));
        Assert.IsNotNull(row.LastActivityKind);

        var todayView = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        var checkIn = todayView.Attention.Single(item => item.Kind == CoachAttentionKind.CheckInToReview);
        Assert.AreEqual((rami.Id, true, 2, (Guid?)rami.FirstAssignmentId),
            (checkIn.Client.ClientProfileId, checkIn.Client.MayCoach, checkIn.Count, checkIn.SubjectId));
        Assert.AreEqual(
            rami.WorkoutId,
            todayView.Activity.Single(item => item.Kind == CoachActivityKind.WorkoutCompleted).SubjectId);
        Assert.AreEqual(2, (await ReadSliceAsync<CheckInToReviewList>(owner, N9d1aToReviewUrl)).Total);
        Assert.AreEqual(rami.Id, (await ReadSliceAsync<ClientTargetsList>(owner, N9d1aTargetsUrl)).Items.Single().ClientProfileId);

        await AssertPhotoReadableAsync(coach, rami.PhotoAssetId, expected: false);
        await AssertPhotoReadableAsync(owner, rami.PhotoAssetId, expected: true);
    }

    // Pins that taking a coach's client on makes the Owner its coach, with its private side open (and closed to the coach),
    // and that handing it back closes it again, a photo the Owner had already opened included.
    [TestMethod]
    public async Task N9d1aTheOwnerWhoTakesOnACoachsClientOpensItsPrivateSideAndHandingItBackClosesIt()
    {
        // No midday clock here: the photo grant resyncs the clock to now and a reassignment follows it.
        var today = TenantToday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-takes-owner@example.test", "Karim Haddad", "N9d1a Takes");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "n9d1a-takes-coach@example.test", "Lea Khoury");
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            coach, mayaClient, tenant, "n9d1a-takes-maya@example.test", "Maya", "Rahman", await N9d1aFormAsync(coach), null, today);
        await N9d1aAssertReadAsync(owner, "the owner", $"/api/training/clients/{maya.Id}/mesocycles", HttpStatusCode.NotFound);

        // Lea goes on leave and the owner takes Maya on: her private side opens to them and closes to Lea.
        await ReassignAsync(owner, maya.Id, ownerUserId, "Lea is on leave");
        foreach (var url in N9d1aPrivateReads(maya))
        {
            await N9d1aAssertReadAsync(owner, "the owner, now her coach", url, HttpStatusCode.OK);
            await N9d1aAssertReadAsync(coach, "Lea, on leave", url, HttpStatusCode.NotFound);
        }

        var whileTheirs = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{maya.Id}");
        Assert.IsTrue(whileTheirs.MayCoach);
        N9d1aAssertPrivateSideShown(whileTheirs);
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(owner);
        var grant = await owner.PostAsync($"/api/media/{maya.PhotoAssetId}/access", null);
        await AssertStatusAsync(grant, HttpStatusCode.OK);
        var photoUrl = (await RequiredJsonAsync<Phase5B2Access>(grant)).Url;
        await AssertStatusAsync(await owner.GetAsync(photoUrl), HttpStatusCode.OK);

        // Handing her back closes it again, and the photo the owner holds a grant for stops answering at once.
        await ReassignAsync(owner, maya.Id, coachUserId, "Lea is back");
        foreach (var url in N9d1aPrivateReads(maya))
        {
            await N9d1aAssertReadAsync(owner, "the owner, no longer her coach", url, HttpStatusCode.NotFound);
            await N9d1aAssertReadAsync(coach, "Lea, back", url, HttpStatusCode.OK);
        }

        var afterwards = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{maya.Id}");
        Assert.IsFalse(afterwards.MayCoach);
        N9d1aAssertPrivateSideWithheld(afterwards);
        var photo = await owner.GetAsync(photoUrl);
        Assert.IsTrue(
            photo.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"The owner's old grant still opened Maya's photo: {(int)photo.StatusCode}.");
        await AssertPhotoReadableAsync(coach, maya.PhotoAssetId, expected: true);
    }

    // Pins Today, the client list, the client's page, To review and the client targets for a coach's client: the coach
    // has all of it, the Owner the business side alone (counts, plan, no private kind, no feed item, no subject to open).
    [TestMethod]
    public async Task N9d1aTodayTheListAndTheClientPageGiveTheOwnerOnlyTheBusinessSideOfACoachsClient()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-today-owner@example.test", "Karim Haddad", "N9d1a Today");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9d1a-today-coach@example.test", "Lea Khoury");
        var form = await N9d1aFormAsync(coach);

        // Lea's Maya trained today and sent two check-ins; Nour's program starts in two days with its week not shared;
        // Omar has training in his plan and no program; Sara joined with no plan at all.
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            coach, mayaClient, tenant, "n9d1a-today-maya@example.test", "Maya", "Rahman", form, null, today);
        using var nourClient = CreateClient();
        var nourId = await R31InviteAsync(coach, nourClient, tenant, "n9d1a-today-nour@example.test", "Nour", "Fares");
        var nourBlock = await AssignAsync(coach, nourId, maya.Training with
        {
            Enrollment = await CreateTrainingEnrollmentAsync(coach, nourId, today, 8),
            Max = await RecordWorkingMaxAsync(coach, nourId, maya.Training.Exercise.Id, 100m),
        }, today.AddDays(2));
        await R31ShareWeekAsync(coach, nourBlock.Id, 1, false);
        using var omarClient = CreateClient();
        var omarId = await R31InviteAsync(coach, omarClient, tenant, "n9d1a-today-omar@example.test", "Omar", "Nasser");
        await CreateTrainingEnrollmentAsync(coach, omarId, today, 8);
        using var saraClient = CreateClient();
        var saraId = await R31InviteAsync(coach, saraClient, tenant, "n9d1a-today-sara@example.test", "Sara", "Khoury");
        Guid[] leasClients = [maya.Id, nourId, omarId, saraId];

        // The owner's own Rami sent a check-in too.
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1a-today-rami@example.test", "Rami", "Saliba");
        await Phase6EnrollAsync(owner, ramiId, "N9d1a owner's check-ins", "CheckIns");
        var ramiAssignment = await B4aAssignAsync(owner, ramiId, form.Id, today);
        await Phase6SubmitWholeAsync(ramiClient, ramiAssignment, form);

        // Lea, their coach, has it all: the check-in to open, the week to share, the program to start, the feed.
        var leasToday = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        var leasCheckIn = leasToday.Attention.Single(item => item.Kind == CoachAttentionKind.CheckInToReview);
        Assert.AreEqual((maya.Id, true, 2, (Guid?)maya.FirstAssignmentId),
            (leasCheckIn.Client.ClientProfileId, leasCheckIn.Client.MayCoach, leasCheckIn.Count, leasCheckIn.SubjectId));
        CollectionAssert.Contains(N9d1aKindsOf(leasToday.Attention, nourId), CoachAttentionKind.WeekNotShared);
        CollectionAssert.Contains(N9d1aKindsOf(leasToday.Attention, omarId), CoachAttentionKind.NoProgram);
        CollectionAssert.Contains(N9d1aKindsOf(leasToday.Attention, saraId), CoachAttentionKind.NoPlan);
        Assert.AreEqual(
            maya.WorkoutId,
            leasToday.Activity.Single(item => item.Kind == CoachActivityKind.WorkoutCompleted).SubjectId);
        Assert.IsTrue(leasToday.Activity.Any(item =>
            item.Kind == CoachActivityKind.CheckInSubmitted && item.Client.ClientProfileId == maya.Id));

        // The owner: Lea's clients carry no private kind and nothing to open; the counts and the plan matters stay.
        var ownersToday = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        foreach (var item in ownersToday.Attention.Where(item => leasClients.Contains(item.Client.ClientProfileId)))
        {
            Assert.IsFalse(item.Client.MayCoach, $"{item.Kind} on {item.Client.FirstName}: the owner does not coach her.");
            Assert.IsFalse(
                item.Kind is CoachAttentionKind.WeekNotShared or CoachAttentionKind.NoProgram or CoachAttentionKind.WeightsToApply,
                $"{item.Kind} on {item.Client.FirstName} opens Lea's program to the owner.");
        }

        var ownersCheckIn = ownersToday.Attention.Single(item =>
            item.Kind == CoachAttentionKind.CheckInToReview && item.Client.ClientProfileId == maya.Id);
        Assert.AreEqual((2, (Guid?)null), (ownersCheckIn.Count, ownersCheckIn.SubjectId));
        CollectionAssert.Contains(N9d1aKindsOf(ownersToday.Attention, saraId), CoachAttentionKind.NoPlan);
        var ramisCheckIn = ownersToday.Attention.Single(item =>
            item.Kind == CoachAttentionKind.CheckInToReview && item.Client.ClientProfileId == ramiId);
        Assert.AreEqual((true, (Guid?)ramiAssignment), (ramisCheckIn.Client.MayCoach, ramisCheckIn.SubjectId));
        Assert.IsFalse(
            ownersToday.Activity.Any(item => leasClients.Contains(item.Client.ClientProfileId)),
            "What Lea's clients did is not in the owner's feed.");
        var ownersActivity = ownersToday.Activity.Single();
        Assert.AreEqual((CoachActivityKind.CheckInSubmitted, ramiId), (ownersActivity.Kind, ownersActivity.Client.ClientProfileId));

        // The client list: Lea's row has Maya's goals, age and last activity; the owner's has her plan and counts alone.
        var leasList = await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl);
        var leasRow = leasList.Clients.Single(row => row.Client.ClientProfileId == maya.Id);
        Assert.AreEqual((true, N9d1aGoals, (DateOnly?)new DateOnly(1995, 4, 2)), (leasRow.Client.MayCoach, leasRow.Goals, leasRow.BirthDate));
        Assert.IsNotNull(leasRow.LastActivityKind);
        Assert.IsNotNull(leasRow.LastActivityAtUtc);
        CollectionAssert.Contains(leasList.Clients.Single(row => row.Client.ClientProfileId == nourId).Attention.ToList(),
            CoachAttentionKind.WeekNotShared);
        CollectionAssert.Contains(leasList.Clients.Single(row => row.Client.ClientProfileId == omarId).Attention.ToList(),
            CoachAttentionKind.NoProgram);
        var ownersList = await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl);
        var ownersRow = ownersList.Clients.Single(row => row.Client.ClientProfileId == maya.Id);
        Assert.IsFalse(ownersRow.Client.MayCoach);
        Assert.IsNull(ownersRow.Goals);
        Assert.IsNull(ownersRow.BirthDate);
        Assert.IsNull(ownersRow.LastActivityKind);
        Assert.IsNull(ownersRow.LastActivityAtUtc);
        Assert.IsNull(ownersRow.LastActivityTitle);
        Assert.IsNotNull(ownersRow.Plan, "Her plan is the business side.");
        CollectionAssert.Contains(ownersRow.Attention.ToList(), CoachAttentionKind.CheckInToReview);
        foreach (var row in ownersList.Clients.Where(row => leasClients.Contains(row.Client.ClientProfileId)))
        {
            Assert.IsFalse(row.Client.MayCoach, row.Client.FirstName);
            Assert.IsFalse(
                row.Attention.Any(kind => kind is CoachAttentionKind.WeekNotShared or CoachAttentionKind.NoProgram or CoachAttentionKind.WeightsToApply),
                $"{row.Client.FirstName}'s row raises a private kind for the owner: {string.Join(", ", row.Attention)}.");
        }

        Assert.IsTrue(ownersList.Clients.Single(row => row.Client.ClientProfileId == ramiId).Client.MayCoach);

        // Maya's page: the week of sessions and the plan for both, her last workout and activity for Lea alone.
        var leasPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(maya.Id));
        Assert.AreEqual((true, (Guid?)maya.WorkoutId), (leasPage.Client.MayCoach, leasPage.LastWorkout?.SubjectId));
        Assert.IsNotNull(leasPage.LastActivityKind);
        var ownersPage = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(maya.Id));
        Assert.IsFalse(ownersPage.Client.MayCoach);
        Assert.IsNull(ownersPage.LastWorkout);
        Assert.IsNull(ownersPage.LastActivityKind);
        Assert.IsNull(ownersPage.LastActivityAtUtc);
        var leasWeek = leasPage.Week ?? throw new AssertFailedException("Training is in Maya's plan.");
        var ownersWeek = ownersPage.Week ?? throw new AssertFailedException("The week's counts are the business side.");
        Assert.AreEqual((leasWeek.Scheduled, leasWeek.Completed), (ownersWeek.Scheduled, ownersWeek.Completed));
        Assert.AreEqual(1, ownersWeek.Completed);
        Assert.AreEqual(leasPage.PlanName, ownersPage.PlanName);
        Assert.IsNotNull(ownersPage.PlanName);
        var pageCheckIn = ownersPage.Attention.Single(item => item.Kind == CoachAttentionKind.CheckInToReview);
        Assert.AreEqual((2, (Guid?)null), (pageCheckIn.Count, pageCheckIn.SubjectId));

        // To review and the client targets open the private side: each lists only the caller's own clients.
        CollectionAssert.AreEqual(
            new[] { ramiAssignment },
            (await ReadSliceAsync<CheckInToReviewList>(owner, N9d1aToReviewUrl)).Items.Select(item => item.AssignmentId).ToArray());
        var leasToReview = await ReadSliceAsync<CheckInToReviewList>(coach, N9d1aToReviewUrl);
        Assert.AreEqual(2, leasToReview.Total);
        Assert.IsTrue(leasToReview.Items.All(item => item.ClientProfileId == maya.Id));
        Assert.IsEmpty((await ReadSliceAsync<ClientTargetsList>(owner, N9d1aTargetsUrl)).Items, "Maya's targets are Lea's.");
        Assert.AreEqual(maya.Id, (await ReadSliceAsync<ClientTargetsList>(coach, N9d1aTargetsUrl)).Items.Single().ClientProfileId);
    }

    // Pins Missed sessions on a coach's client: the Owner reads the count, a business activity count, but not the day of
    // the last workout, which is the private side; the client's coach reads both, on Today, the list and the page.
    [TestMethod]
    public async Task N9d1aMissedSessionsGiveTheOwnerTheCountButNeverTheDayOfTheLastWorkout()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-missed-owner@example.test", "Karim Haddad", "N9d1a Missed");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "n9d1a-missed-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "n9d1a-missed-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(lea, mayaId, 4, 4, start);
        var block = await AssignAsync(lea, mayaId, resources, start);
        foreach (var week in new[] { 2, 3, 4 })
        {
            await R31ShareWeekAsync(lea, block.Id, week, true);
        }

        // Maya trains on the first day, then misses the next two weeks' sessions.
        await R25bFinishTodaysWorkoutAsync(maya, 60m);
        RequiredTestClock.Advance(TimeSpan.FromDays(15));

        static CoachAttentionItemView Missed(IEnumerable<CoachAttentionItemView> items, Guid clientId) =>
            items.Single(item => item.Kind == CoachAttentionKind.MissedSessions && item.Client.ClientProfileId == clientId);

        var leasToday = Missed((await ReadSliceAsync<CoachTodayView>(lea, "/api/coach-today")).Attention, mayaId);
        Assert.AreEqual(((int?)2, (DateOnly?)start, true), (leasToday.Count, leasToday.Date, leasToday.Client.MayCoach));

        var ownersToday = Missed((await ReadSliceAsync<CoachTodayView>(owner, "/api/coach-today")).Attention, mayaId);
        Assert.AreEqual(((int?)2, (DateOnly?)null, false), (ownersToday.Count, ownersToday.Date, ownersToday.Client.MayCoach));
        var ownersRow = (await ReadSliceAsync<ClientOverviewView>(owner, "/api/clients/overview")).Clients
            .Single(row => row.Client.ClientProfileId == mayaId);
        Assert.IsNull(Missed(ownersRow.AttentionItems, mayaId).Date);
        Assert.IsNull(ownersRow.LastActivityAtUtc);
        var ownersPage = await ReadSliceAsync<ClientProfileOverviewView>(owner, $"/api/clients/{mayaId}/overview");
        Assert.AreEqual(((int?)2, (DateOnly?)null), (Missed(ownersPage.Attention, mayaId).Count, Missed(ownersPage.Attention, mayaId).Date));
        Assert.IsNull(ownersPage.LastWorkout);
        var leasPage = await ReadSliceAsync<ClientProfileOverviewView>(lea, $"/api/clients/{mayaId}/overview");
        Assert.AreEqual((DateOnly?)start, Missed(leasPage.Attention, mayaId).Date);
        Assert.IsNotNull(leasPage.LastWorkout);
    }

    // Pins former clients: the Owner's own released client keeps its private side for the Owner (read-only, so a write
    // is 409), while a coach's client the Owner released stays closed to the Owner (404) and is on Former clients.
    [TestMethod]
    public async Task N9d1aAFormerClientsPrivateSideStaysWithWhoeverCoachedThemWhenTheyLeft()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-former-owner@example.test", "Karim Haddad", "N9d1a Former");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9d1a-former-coach@example.test", "Lea Khoury");
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1a-former-rami@example.test", "Rami", "Saliba");
        var training = await CreateTrainingResourcesAsync(owner, ramiId, 8, 2, today);
        await AssignAsync(owner, ramiId, training, today);
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(coach, mayaClient, tenant, "n9d1a-former-maya@example.test", "Maya", "Rahman");
        await N9d1aWriteIntakeAsync(coach, mayaId);
        await AssignAsync(coach, mayaId, training with
        {
            Enrollment = await CreateTrainingEnrollmentAsync(coach, mayaId, today, 8),
            Max = await RecordWorkingMaxAsync(coach, mayaId, training.Exercise.Id, 100m),
        }, today);

        await ReleaseAsync(owner, ramiId, "Moved to Dubai");
        await ReleaseAsync(owner, mayaId, "Stopped training");

        // Rami was the owner's own client: his record stays theirs to read, and read-only.
        await N9d1aAssertReadAsync(owner, "the owner, his coach", $"/api/training/clients/{ramiId}/mesocycles", HttpStatusCode.OK);
        await N9d1aAssertReadAsync(owner, "the owner, his coach", $"/api/strength/clients/{ramiId}/maxes", HttpStatusCode.OK);
        var rami = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{ramiId}");
        Assert.AreEqual((true, ClientDepartureKind.ReleasedByOwner), (rami.MayCoach, rami.Release?.DepartureKind));
        await RefreshCsrfAsync(owner);
        var ramisWeighIn = await owner.PostAsJsonAsync(
            $"/api/progress/clients/{ramiId}/bodyweight", new { value = 80m, unit = "Kilogram", measurementDate = today });
        await AssertStatusAsync(ramisWeighIn, HttpStatusCode.Conflict);
        Assert.IsTrue((await ramisWeighIn.Content.ReadAsStringAsync()).Contains("client_released", StringComparison.Ordinal));

        // Maya was Lea's: the release made the owner her record's keeper, never her coach.
        await N9d1aAssertReadAsync(owner, "the owner, her keeper", $"/api/training/clients/{mayaId}/mesocycles", HttpStatusCode.NotFound);
        await N9d1aAssertReadAsync(owner, "the owner, her keeper", $"/api/progress/clients/{mayaId}/dashboard", HttpStatusCode.NotFound);
        var maya = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{mayaId}");
        Assert.AreEqual(
            (false, ownerUserId, ClientDepartureKind.ReleasedByOwner),
            (maya.MayCoach, maya.AssignedCoachUserId, maya.Release?.DepartureKind));
        N9d1aAssertPrivateSideWithheld(maya);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/progress/clients/{mayaId}/bodyweight", new { value = 60m, unit = "Kilogram", measurementDate = today }),
            HttpStatusCode.NotFound);
        var former = await ReadSliceAsync<FormerClientSummary[]>(owner, "/api/clients/former");
        CollectionAssert.AreEquivalent(new[] { ramiId, mayaId }, former.Select(item => item.Id).ToArray());

        // Lea no longer has her either, on either side.
        await N9d1aAssertReadAsync(coach, "Lea, her old coach", $"/api/clients/{mayaId}", HttpStatusCode.NotFound);
        await N9d1aAssertReadAsync(coach, "Lea, her old coach", $"/api/training/clients/{mayaId}/mesocycles", HttpStatusCode.NotFound);
    }

    // Pins that another workspace's owner reaches neither side: naming this workspace is 403, and in their own workspace
    // this one's clients answer 404 on business and private routes alike.
    [TestMethod]
    public async Task N9d1aAnotherWorkspacesOwnerReachesNeitherSideOfAClient()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1a-stranger-owner@example.test", "Karim Haddad", "N9d1a Here");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n9d1a-stranger-coach@example.test", "Lea Khoury");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(coach, mayaClient, tenant, "n9d1a-stranger-maya@example.test", "Maya", "Rahman");
        var training = await CreateTrainingResourcesAsync(coach, mayaId, 8, 1, today);
        await AssignAsync(coach, mayaId, training, today);
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1a-stranger-rami@example.test", "Rami", "Saliba");

        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9d1a-stranger-other@example.test", "Nadim Aoun", "N9d1a Elsewhere");

        // In their own workspace, neither client exists, on either side.
        foreach (var clientId in new[] { mayaId, ramiId })
        {
            foreach (var url in N9d1aBothSides(clientId))
            {
                await N9d1aAssertReadAsync(stranger, "another workspace's owner", url, HttpStatusCode.NotFound);
            }

            await RefreshCsrfAsync(stranger);
            await AssertStatusAsync(
                await stranger.PostAsJsonAsync(
                    $"/api/clients/{clientId}/relationship/block", new { reason = "Not my client", version = 0u }),
                HttpStatusCode.NotFound);
        }

        // Naming this workspace, they are refused at the door.
        SetTenant(stranger, tenant);
        foreach (var url in N9d1aBothSides(mayaId).Append(CoachTodayUrl))
        {
            await N9d1aAssertReadAsync(stranger, "another workspace's owner in this one", url, HttpStatusCode.Forbidden);
        }
    }

    // ---------- N9d1a helpers ----------

    /// <summary>
    /// A client of <paramref name="staff"/>'s with every private side filled: the intake with health answers and the
    /// coach's notes, a program with today's workout finished, a weigh-in, two sent check-ins, targets and a photo.
    /// </summary>
    private async Task<N9d1aClient> N9d1aCoachedClientAsync(
        HttpClient staff,
        HttpClient client,
        Guid tenant,
        string email,
        string firstName,
        string lastName,
        Phase6Version form,
        TrainingResources? training,
        DateOnly today)
    {
        var clientId = await R31InviteAsync(staff, client, tenant, email, firstName, lastName);
        await N9d1aWriteIntakeAsync(staff, clientId);
        training = training is null
            ? await CreateTrainingResourcesAsync(staff, clientId, 8, 2, today)
            : training with
            {
                Enrollment = await CreateTrainingEnrollmentAsync(staff, clientId, today, 8),
                Max = await RecordWorkingMaxAsync(staff, clientId, training.Exercise.Id, 100m),
            };
        var block = await AssignAsync(staff, clientId, training, today);
        var workoutId = await R25bFinishTodaysWorkoutAsync(client, 80m);
        await R31WeighInAsync(client, today, 70m);
        await Phase6EnrollAsync(staff, clientId, "N9d1a check-ins and food", "CheckIns", "Nutrition");
        var first = await B4aAssignAsync(staff, clientId, form.Id, today);
        var firstResponse = await Phase6SubmitWholeAsync(client, first, form);
        var second = await B4aAssignAsync(staff, clientId, form.Id, today.AddDays(1));
        var secondResponse = await Phase6SubmitWholeAsync(client, second, form);
        await R53dCalculateAsync(staff, clientId, weight: 70m, protein: 130m);
        var photo = await UploadProgressPhotoAsync(
            staff,
            $"/api/progress/clients/{clientId}/photos?pose=Front&photoDate={today:yyyy-MM-dd}");
        return new N9d1aClient(clientId, training, block, workoutId, first, firstResponse, secondResponse, photo.MediaAssetId);
    }

    /// <summary>The coach fills in the intake, health answers included, and writes their notes.</summary>
    private static async Task N9d1aWriteIntakeAsync(HttpClient staff, Guid clientId)
    {
        var details = await ReadSliceAsync<CoachClientDetails>(staff, $"/api/clients/{clientId}");
        await RefreshCsrfAsync(staff);
        var intake = await staff.PutAsJsonAsync($"/api/clients/{clientId}/intake", N9d1aIntake(details, N9d1aGoals));
        await AssertStatusAsync(intake, HttpStatusCode.OK);
        var written = await ReadSlicePayloadAsync<CoachClientDetails>(intake);
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PutAsJsonAsync(
                $"/api/clients/{clientId}/coach-notes", new { notes = N9d1aCoachNotes, version = written.Version }),
            HttpStatusCode.OK);
    }

    private static object N9d1aIntake(CoachClientDetails details, string goals) => new
    {
        firstName = details.FirstName,
        lastName = details.LastName,
        phoneNumber = details.PhoneNumber,
        birthDate = new DateOnly(1995, 4, 2),
        heightValue = 168m,
        heightUnit = "Centimeter",
        workType = "Office",
        averageDailySteps = 8000,
        trainingBackground = "Two years of gym work",
        foodPreferences = "Mediterranean",
        foodAversions = "Liver",
        goals,
        allergies = "Peanuts",
        medications = "Ventolin",
        previousInjuries = "Sprained left ankle",
        version = details.Version,
    };

    private static object N9d1aMaxRequest(Guid exerciseId, decimal value) => new
    {
        exerciseId,
        kind = "CoachWorkingMax",
        value,
        unit = "Kilogram",
        effectiveDate = TenantToday(),
        source = "Manual",
        methodKey = (string?)null,
        methodVersion = (string?)null,
        sourceWorkoutExecutionId = (Guid?)null,
        note = "The owner's max",
    };

    private static async Task<Phase6Version> N9d1aFormAsync(HttpClient staff)
    {
        var form = await Phase6CreateFormAsync(staff, "Weekly check-in", Phase6ShortText("How was your week?"));
        return await Phase6PublishAsync(staff, form.Form.Id, form.Versions[0]);
    }

    /// <summary>Every private read about the client, each answering 200 to the client's own coach.</summary>
    private static string[] N9d1aPrivateReads(N9d1aClient client) =>
    [
        $"/api/training/clients/{client.Id}/mesocycles",
        $"/api/training/clients/{client.Id}/program",
        $"/api/training/clients/{client.Id}/exercises/{client.Training.Exercise.Id}/history",
        $"/api/training/clients/{client.Id}/personal-records",
        $"/api/training/clients/{client.Id}/previous-maxes",
        $"/api/training/clients/{client.Id}/workouts/{client.WorkoutId}",
        $"/api/strength/clients/{client.Id}/maxes",
        $"/api/nutrition/clients/{client.Id}/plans",
        $"/api/nutrition/clients/{client.Id}/calculations",
        $"/api/nutrition/clients/{client.Id}/allergens",
        $"/api/checkins/clients/{client.Id}/assignments",
        $"/api/checkins/clients/{client.Id}/assignments/{client.FirstAssignmentId}/response",
        $"/api/checkins/clients/{client.Id}/checkin-comparison" +
            $"?firstResponseId={client.FirstResponseId}&secondResponseId={client.SecondResponseId}",
        $"/api/progress/clients/{client.Id}",
        $"/api/progress/clients/{client.Id}/span",
        $"/api/progress/clients/{client.Id}/measurements",
        $"/api/progress/clients/{client.Id}/photos",
        $"/api/progress/clients/{client.Id}/dashboard",
    ];

    /// <summary>Business reads and private reads about one client.</summary>
    private static string[] N9d1aBothSides(Guid clientId) =>
    [
        $"/api/clients/{clientId}",
        R33bOverviewUrl(clientId),
        $"/api/commercial/clients/{clientId}",
        $"/api/training/clients/{clientId}/mesocycles",
        $"/api/progress/clients/{clientId}/dashboard",
        $"/api/checkins/clients/{clientId}/assignments",
    ];

    private static async Task N9d1aAssertReadAsync(HttpClient caller, string who, string url, HttpStatusCode expected)
    {
        var response = await caller.GetAsync(url);
        Assert.AreEqual(expected, response.StatusCode, $"{who}, GET {url}: {await response.Content.ReadAsStringAsync()}");
    }

    private static async Task<long> N9d1aTotalAsync(HttpClient caller, string url) =>
        (await RequiredJsonAsync<N9d1aTotal>(await caller.GetAsync(url))).Total;

    private static List<CoachAttentionKind> N9d1aKindsOf(IEnumerable<CoachAttentionItemView> items, Guid clientId) =>
        [.. items.Where(item => item.Client.ClientProfileId == clientId).Select(item => item.Kind)];

    /// <summary>What a client's record carries whoever may manage them: the same for the coach and the owner.</summary>
    private static (Guid, Guid?, string, string, string, string?, ClientOnboardingStatus, DateTimeOffset?, bool, uint, Guid?, string)
        N9d1aBusinessSide(CoachClientDetails details) =>
        (details.Id, details.UserId, details.FirstName, details.LastName, details.Email, details.PhoneNumber,
            details.OnboardingStatus, details.OnboardingCompletedAtUtc, details.IsCoachBlocked, details.Version,
            details.AssignedCoachUserId, details.AssignedCoachName);

    private static void N9d1aAssertPrivateSideShown(CoachClientDetails details)
    {
        Assert.AreEqual((new DateOnly(1995, 4, 2), 168m, "Office", 8000), (details.BirthDate, details.HeightCentimeters, details.WorkType, details.AverageDailySteps));
        Assert.AreEqual(
            ("Two years of gym work", "Mediterranean", "Liver", N9d1aGoals, "Peanuts", "Ventolin", "Sprained left ankle", N9d1aCoachNotes),
            (details.TrainingBackground, details.FoodPreferences, details.FoodAversions, details.Goals, details.Allergies,
                details.Medications, details.PreviousInjuries, details.CoachNotes));
    }

    private static void N9d1aAssertPrivateSideWithheld(CoachClientDetails details)
    {
        (string Name, object? Value)[] fields =
        [
            (nameof(details.BirthDate), details.BirthDate),
            (nameof(details.HeightCentimeters), details.HeightCentimeters),
            (nameof(details.HeightEnteredValue), details.HeightEnteredValue),
            (nameof(details.HeightEnteredUnit), details.HeightEnteredUnit),
            (nameof(details.WorkType), details.WorkType),
            (nameof(details.AverageDailySteps), details.AverageDailySteps),
            (nameof(details.TrainingBackground), details.TrainingBackground),
            (nameof(details.FoodPreferences), details.FoodPreferences),
            (nameof(details.FoodAversions), details.FoodAversions),
            (nameof(details.Goals), details.Goals),
            (nameof(details.Allergies), details.Allergies),
            (nameof(details.Medications), details.Medications),
            (nameof(details.PreviousInjuries), details.PreviousInjuries),
            (nameof(details.CoachNotes), details.CoachNotes),
        ];
        foreach (var (name, value) in fields)
        {
            Assert.IsNull(value, $"{name} is the private side and reached someone who does not coach the client.");
        }
    }

    private static string N9d1aEndpointName(Endpoint endpoint) =>
        endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ?? endpoint.DisplayName ?? "(unnamed)";

    /// <summary>The side the tenant handler reads for a request routed to the named endpoint.</summary>
    private static ClientSide N9d1aSideOf(RouteEndpoint[] routes, string name)
    {
        var endpoint = routes.Single(item => N9d1aEndpointName(item) == name);
        var context = new DefaultHttpContext();
        context.SetEndpoint(endpoint);
        return TenantRoleAuthorizationHandler.RouteClientSide(context);
    }

    private sealed record N9d1aClient(
        Guid Id,
        TrainingResources Training,
        ScenarioMesocycle Block,
        Guid WorkoutId,
        Guid FirstAssignmentId,
        Guid FirstResponseId,
        Guid SecondResponseId,
        Guid PhotoAssetId);

    private sealed record N9d1aId(Guid Id);

    private sealed record N9d1aTotal(long Total);

    private sealed record N9d1aVersioned(uint Version);
}
