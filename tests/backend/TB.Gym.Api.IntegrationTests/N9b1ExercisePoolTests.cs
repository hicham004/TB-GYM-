using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using TB.Gym.Infrastructure.Security;
using TB.Gym.SharedKernel;
using ExerciseView = TB.Gym.Modules.ExerciseLibrary.ExerciseView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b1, the house's exercise pool and its demos (LIB-006, MED-017, MED-002's library grant), against
/// PostgreSQL: any current client of the house reads the house's exercises in use while Training is open to them,
/// searched and filtered as the coach's library is and in its natural order of name, each with what it is, how it is
/// done and the demos that open now, never the staff's tags, swaps, notes, version or archived flag; with Training
/// locked the read says why and lists nothing; a coach's workspace has no pool, the staff of any workspace and someone
/// signed out are refused, and nobody writes to the pool through it. A pool demo opens through the grant every demo
/// uses while it is ready and an exercise in use links it, checked again on every content request, and only under
/// the house's own header: a coach's client still opens no library demo that no program of theirs holds.
/// Every name, address and video id here is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b1PPoolUrl = "/api/exercise-pool";

    private static readonly string[] N9b1PRouteNames = ["SearchExercisePool", "GetExercisePoolExercise"];

    private static readonly string[] N9b1PRouteParameters = ["exerciseId"];

    private static readonly string[] N9b1PTenantClientPolicy = [AuthorizationPolicies.TenantClient];

    private static readonly string[] N9b1PGetOnly = ["GET"];

    private static readonly string[] N9b1PPageFields = ["isAllowed", "accessReason", "total", "items"];

    private static readonly string[] N9b1POneFields = ["isAllowed", "accessReason", "exercise"];

    /// <summary>All a trainee reads of an exercise: no tags, swaps, notes, version or archived flag.</summary>
    private static readonly string[] N9b1PExerciseFields =
        ["id", "name", "classification", "typeName", "equipment", "movementPattern", "muscles", "instructions", "demos"];

    private static readonly string[] N9b1PMuscleFields = ["muscle", "role"];

    private static readonly string[] N9b1PDemoFields = ["mediaAssetId", "kind"];

    /// <summary>
    /// What the staff keep for themselves in <see cref="N9b1PLibraryAsync"/>'s library, which no trainee reads: its
    /// tags, a swap's note, and the archived exercise's name.
    /// </summary>
    private static readonly string[] N9b1PStaffWords =
        ["knee-friendly", "anti-extension", "deltoid-burner", "grip-builder", "Swap when the bar is taken", "Goblet Squat"];

    /// <summary>
    /// <see cref="N9b1PLibraryAsync"/>'s exercises in use as a trainee reads them, in natural order of name: name, type,
    /// equipment, movement, muscles (the primary ones first), instructions and demos.
    /// </summary>
    private static readonly string[] N9b1PLibraryLines =
    [
        "arch hold | Other (Rehab) | Bodyweight | Other | Abdominals Primary | no instructions | no demos",
        "Back Squat | Strength | Barbell | Squat | Quadriceps Primary, Hamstrings Secondary, Glutes Secondary | Brace, then sit between the hips. | no demos",
        "Élévations latérales | Strength | Dumbbell | Isolation | Shoulders Primary | Raise to shoulder height, slowly. | no demos",
        "Zercher Carry | Conditioning | Barbell | Carry | FullBody Primary, Forearms Secondary | Walk tall with the bar in the elbows. | no demos",
    ];

    [TestMethod]
    public void N9b1PoolBothRoutesAreReadsOfAClientAloneWithNoLimitAndNoReadOnlyMark()
    {
        var routes = A10bApiRoutes()
            .Where(route => route.RoutePattern.RawText!.StartsWith(N9b1PPoolUrl, StringComparison.Ordinal))
            .ToArray();
        CollectionAssert.AreEquivalent(N9b1PRouteNames, routes.Select(A10bName).ToArray());

        foreach (var route in routes)
        {
            var name = A10bName(route);
            // A group of its own: inside the library's TenantCoach group both policies would have to pass, and
            // nobody is a client and the staff of one workspace at once.
            var policies = route.Metadata.GetOrderedMetadata<IAuthorizeData>()
                .Select(data => data.Policy)
                .OfType<string>()
                .ToArray();
            CollectionAssert.AreEqual(N9b1PTenantClientPolicy, policies, $"{name} is not behind the TenantClient policy alone.");
            Assert.IsNull(route.Metadata.GetMetadata<IAllowAnonymous>(), name);
            var methods = route.Metadata.GetMetadata<IHttpMethodMetadata>();
            CollectionAssert.AreEqual(N9b1PGetOnly, methods?.HttpMethods.ToArray(), $"{name}: nothing writes to the pool through it.");
            Assert.IsFalse(WriteRateLimiting.IsStateChanging(methods), name);
            Assert.IsNull(A10bPolicy(route), $"{name} is a read, which no write limit counts.");
            Assert.IsNull(
                route.Metadata.GetMetadata<AllowedWhileWorkspaceReadOnly>(),
                $"{name}: no client route is on the list kept open while a workspace is read-only.");
            CollectionAssert.IsSubsetOf(
                route.RoutePattern.Parameters.Select(parameter => parameter.Name).ToArray(),
                N9b1PRouteParameters,
                $"{name} names no client in its route.");
        }
    }

    [TestMethod]
    public async Task N9b1PoolATraineeReadsTheHousesExercisesInUseInNaturalOrderWithoutTheStaffsOwnWords()
    {
        using var house = await N9a1OpenHouseAsync("pool-read", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        // Another workspace's library holds a squat with the same tag, which no trainee of the house ever reads.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9b1-pool-read-rami@example.test", "Rami Saad", "N9b1 Pool Read Elsewhere");
        await N9b1PExerciseAsync(stranger, N9b1PBody(
            "Box Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, ["knee-friendly"]));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-read-yara@example.test", "Yara", "Haddad", address: "203.0.113.21");

        // Free opened Training when the email was confirmed, so the pool is open: the four exercises in use, in the
        // library's natural order of name (the test database sorts by byte, which would put "arch hold" and the
        // accented name last), the archived goblet squat and the other workspace's squat left out.
        var page = await N9b1PPageAsync(trainee.Client, string.Empty);
        Assert.AreEqual((true, "Granted", 4), (page.IsAllowed, page.AccessReason, page.Total));
        CollectionAssert.AreEqual(
            new[] { library.Hold.Id, library.Squat.Id, library.Raise.Id, library.Carry.Id },
            page.Items.Select(item => item.Id).ToArray());
        CollectionAssert.AreEqual(N9b1PLibraryLines, page.Items.Select(N9b1PLine).ToArray());

        // Each one carries what it is and how it is done, and nothing the staff keep for themselves: no field for
        // tags, swaps, notes, a version or the archived flag, and none of their words anywhere in the answer.
        var text = await trainee.Client.GetStringAsync(N9b1PPoolUrl);
        using var raw = JsonDocument.Parse(text);
        CollectionAssert.AreEquivalent(N9b1PPageFields, N9b1PFields(raw.RootElement));
        foreach (var item in raw.RootElement.GetProperty("items").EnumerateArray())
        {
            CollectionAssert.AreEquivalent(N9b1PExerciseFields, N9b1PFields(item), item.GetProperty("name").GetString());
            foreach (var muscle in item.GetProperty("muscles").EnumerateArray())
            {
                CollectionAssert.AreEquivalent(N9b1PMuscleFields, N9b1PFields(muscle));
            }
        }

        foreach (var words in N9b1PStaffWords.Append("Box Squat"))
        {
            Assert.IsFalse(text.Contains(words, StringComparison.OrdinalIgnoreCase), $"The pool says \"{words}\".");
        }
    }

    [TestMethod]
    public async Task N9b1PoolTheSearchFindsEveryWordInANameOrATagAndTheFiltersAndPagesNarrowIt()
    {
        using var house = await N9a1OpenHouseAsync("pool-search", withCoach: true);
        await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-search-omar@example.test", "Omar", "Khalil", address: "203.0.113.31");

        // Every word typed, in any order and any case, in the name or a tag (LIB-003): a tag is searched though the
        // trainee never reads it. Nothing finds the archived goblet squat, words no one exercise holds together find
        // none, and a wildcard typed is taken literally (SEC-10), so it lists nothing rather than everything.
        foreach (var (query, names) in new[]
                 {
                     ("squat", "Back Squat"),
                     ("KNEE%20squat", "Back Squat"),
                     ("anti", "arch hold"),
                     ("hold%20ARCH", "arch hold"),
                     ("goblet", string.Empty),
                     ("squat%20carry", string.Empty),
                     ("%25", string.Empty),
                     ("_", string.Empty),
                 })
        {
            Assert.AreEqual(names, N9b1PNames(await N9b1PPageAsync(trainee.Client, $"?query={query}")), query);
        }

        // An equipment, any of several movements, a muscle in either role, a type, and Other's own name in any case.
        foreach (var (filter, names) in new[]
                 {
                     ("equipment=Barbell", "Back Squat | Zercher Carry"),
                     ("movementPattern=Squat&movementPattern=Carry", "Back Squat | Zercher Carry"),
                     ("muscle=Glutes", "Back Squat"),
                     ("muscle=Shoulders", "Élévations latérales"),
                     ("classification=Strength", "Back Squat | Élévations latérales"),
                     ("classification=Other&typeName=REHAB", "arch hold"),
                     ("equipment=Kettlebell", string.Empty),
                     ("query=squat&equipment=Dumbbell", string.Empty),
                 })
        {
            Assert.AreEqual(names, N9b1PNames(await N9b1PPageAsync(trainee.Client, $"?{filter}")), filter);
        }

        // Pages follow the same order, each with the count of everything found; no page size reads the default page.
        var second = await N9b1PPageAsync(trainee.Client, "?skip=1&take=2");
        Assert.AreEqual((4, "Back Squat | Élévations latérales"), (second.Total, N9b1PNames(second)));
        var last = await N9b1PPageAsync(trainee.Client, "?skip=3&take=2");
        Assert.AreEqual((4, "Zercher Carry"), (last.Total, N9b1PNames(last)));
        var whole = await N9b1PPageAsync(trainee.Client, "?take=0");
        Assert.AreEqual(
            (4, "arch hold | Back Squat | Élévations latérales | Zercher Carry"),
            (whole.Total, N9b1PNames(whole)));
        var narrowed = await N9b1PPageAsync(trainee.Client, "?equipment=Barbell&take=1");
        Assert.AreEqual((2, "Back Squat"), (narrowed.Total, N9b1PNames(narrowed)), "The count is the filter's, not the page's.");
    }

    [TestMethod]
    public async Task N9b1PoolDemosComeInTheHousesOrderAsAPictureAClipOrAVideoLinkAndADeletedOneGoes()
    {
        using var house = await N9a1OpenHouseAsync("pool-demos", withCoach: true);
        var coach = house.Coach!;
        var link = await R51bAddLinkOkAsync(coach, "n9b1PoolSquatSide", "Back squat from the side");
        var picture = await UploadJpegAsync(coach);
        var clip = await N9b1PUploadClipAsync(coach);
        // The house's own order, which is not the order the demos were added in.
        var squat = await N9b1PExerciseAsync(coach, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], "Brace, then sit between the hips.", [],
            mediaAssetIds: [link.Id, clip.Id, picture.Id]));
        await N9b1PExerciseAsync(coach, N9b1PBody(
            "Front Plank", "Other", "Bodyweight", "Other", [("Abdominals", "Primary")], null, []));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-demos-lina@example.test", "Lina", "Saleh", address: "203.0.113.41");

        // Each demo says what it is, so a screen knows how to show it before it asks for it: a link that opens on
        // YouTube, a clip that plays in TB Gym, a picture. The page and the single read agree.
        var everyDemo = $"{link.Id} VideoLink, {clip.Id} Video, {picture.Id} Picture";
        var page = await N9b1PPageAsync(trainee.Client, string.Empty);
        Assert.AreEqual("Back Squat | Front Plank", N9b1PNames(page));
        Assert.AreEqual((everyDemo, "no demos"), (N9b1PDemos(page.Items[0]), N9b1PDemos(page.Items[1])));
        Assert.AreEqual(everyDemo, N9b1PDemos((await N9b1POneAsync(trainee.Client, squat.Id)).Exercise!));
        using (var raw = JsonDocument.Parse(await trainee.Client.GetStringAsync($"{N9b1PPoolUrl}/{squat.Id}")))
        {
            foreach (var demo in raw.RootElement.GetProperty("exercise").GetProperty("demos").EnumerateArray())
            {
                CollectionAssert.AreEquivalent(N9b1PDemoFields, N9b1PFields(demo));
            }
        }

        // The coach deletes the clip, then the link: each is gone from the pool at once and the others keep their
        // order, though the library keeps every row linking them (deleting media never removes a link), so it is the
        // pool that reads only what opens now.
        await AssertStatusAsync(await N9b1PDeleteMediaAsync(coach, clip.Id, clip.Version), HttpStatusCode.OK);
        Assert.AreEqual(
            $"{link.Id} VideoLink, {picture.Id} Picture",
            N9b1PDemos((await N9b1POneAsync(trainee.Client, squat.Id)).Exercise!));
        await AssertStatusAsync(await N9b1PDeleteMediaAsync(coach, link.Id, link.Version), HttpStatusCode.OK);
        Assert.AreEqual($"{picture.Id} Picture", N9b1PDemos((await N9b1PPageAsync(trainee.Client, string.Empty)).Items[0]));
        Assert.AreEqual(3L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            "SELECT count(*) FROM exercise_library.\"ExerciseMediaLinks\" WHERE \"ExerciseId\" = @id",
            squat.Id));
    }

    [TestMethod]
    public async Task N9b1PoolOneExerciseIsReadByItsIdAndAnArchivedUnknownOrForeignOneIsMissing()
    {
        using var house = await N9a1OpenHouseAsync("pool-one", withCoach: true);
        var coach = house.Coach!;
        var library = await N9b1PLibraryAsync(coach);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9b1-pool-one-rami@example.test", "Rami Saad", "N9b1 Pool One Elsewhere");
        var theirs = await N9b1PExerciseAsync(stranger, N9b1PBody(
            "Box Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, []));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-one-karim@example.test", "Karim", "Nassar", address: "203.0.113.51");

        // One exercise reads as it does on the page, in an answer of its own that says Training is open.
        var response = await trainee.Client.GetAsync($"{N9b1PPoolUrl}/{library.Squat.Id}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        using (var raw = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
        {
            CollectionAssert.AreEquivalent(N9b1POneFields, N9b1PFields(raw.RootElement));
            CollectionAssert.AreEquivalent(N9b1PExerciseFields, N9b1PFields(raw.RootElement.GetProperty("exercise")));
        }

        var one = await N9b1POneAsync(trainee.Client, library.Squat.Id);
        Assert.AreEqual((true, "Granted"), (one.IsAllowed, one.AccessReason));
        Assert.AreEqual((library.Squat.Id, N9b1PLibraryLines[1]), (one.Exercise!.Id, N9b1PLine(one.Exercise)));

        // Archived, unknown or another workspace's: missing, the one answer, which tells nothing of which it was.
        foreach (var (id, what) in new[]
                 {
                     (library.Goblet.Id, "archived"),
                     (Guid.NewGuid(), "unknown"),
                     (theirs.Id, "another workspace's"),
                 })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await trainee.Client.GetAsync($"{N9b1PPoolUrl}/{id}")).StatusCode, what);
        }

        // The coach archives the back squat: missing at once, here and on the page; restored, it reads again.
        var shelved = await N9b1PSetArchivedAsync(coach, library.Squat.Id, archived: true, library.Squat.Version);
        await AssertStatusAsync(await trainee.Client.GetAsync($"{N9b1PPoolUrl}/{library.Squat.Id}"), HttpStatusCode.NotFound);
        Assert.AreEqual(
            "arch hold | Élévations latérales | Zercher Carry",
            N9b1PNames(await N9b1PPageAsync(trainee.Client, string.Empty)));
        await N9b1PSetArchivedAsync(coach, library.Squat.Id, archived: false, shelved.Version);
        Assert.AreEqual(library.Squat.Id, (await N9b1POneAsync(trainee.Client, library.Squat.Id)).Exercise?.Id);
    }

    [TestMethod]
    public async Task N9b1PoolABlockedTraineeIsToldWhyAndAnInvitedClientReadsItAndItsDemosOnceAPlanCoversTraining()
    {
        using var house = await N9a1OpenHouseAsync("pool-access", withCoach: true);
        var coach = house.Coach!;
        var picture = await UploadJpegAsync(coach);
        var squat = await N9b1PExerciseAsync(coach, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], "Brace, then sit between the hips.", [],
            mediaAssetIds: [picture.Id]));
        await N9b1PExerciseAsync(coach, N9b1PBody(
            "Front Plank", "Other", "Bodyweight", "Other", [("Abdominals", "Primary")], null, []));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-access-sami@example.test", "Sami", "Aoun", address: "203.0.113.61");
        Assert.AreEqual(2, (await N9b1PPageAsync(trainee.Client, string.Empty)).Total);

        // The house blocks the trainee: Free still runs, yet Training is locked, so the read says why and lists
        // nothing, and the single read gives no exercise, the same for an id the pool does not hold.
        await B4aSetBlockedAsync(house.Owner, trainee.ProfileId, blocked: true);
        var page = await N9b1PPageAsync(trainee.Client, string.Empty);
        Assert.AreEqual((false, "RelationshipBlocked", 0), (page.IsAllowed, page.AccessReason, page.Total));
        Assert.IsEmpty(page.Items);
        foreach (var id in new[] { squat.Id, Guid.NewGuid() })
        {
            var one = await N9b1POneAsync(trainee.Client, id);
            Assert.AreEqual((false, "RelationshipBlocked"), (one.IsAllowed, one.AccessReason));
            Assert.IsNull(one.Exercise);
        }

        await B4aSetBlockedAsync(house.Owner, trainee.ProfileId, blocked: false);
        page = await N9b1PPageAsync(trainee.Client, string.Empty);
        Assert.AreEqual((true, "Granted", "Back Squat | Front Plank"), (page.IsAllowed, page.AccessReason, N9b1PNames(page)));

        // A client the house invited the ordinary way has no Free and no plan: the pool says so and lists nothing,
        // and its demo stays missing.
        using var invited = CreateClient();
        var invitedId = await InviteAndAcceptAsync(house.Owner, invited, "n9b1-pool-access-rana@example.test", newAccount: true);
        page = await N9b1PPageAsync(invited, string.Empty);
        Assert.AreEqual((false, "NoEntitlement", 0), (page.IsAllowed, page.AccessReason, page.Total));
        Assert.IsEmpty(page.Items);
        Assert.IsNull((await N9b1POneAsync(invited, squat.Id)).Exercise);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(invited, picture.Id)).StatusCode);

        // Once the house's staff book them a plan covering Training, the pool and its demos are theirs: any current
        // client of the house reads it, not only one who signed up.
        await CreateFreeTrainingEnrollmentAsync(house.Owner, invitedId, N9a1HouseToday());
        page = await N9b1PPageAsync(invited, string.Empty);
        Assert.AreEqual((true, "Granted", "Back Squat | Front Plank"), (page.IsAllowed, page.AccessReason, N9b1PNames(page)));
        var grant = await N9b1PGrantAsync(invited, picture.Id);
        await AssertStatusAsync(await invited.GetAsync(grant.Url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task N9b1PoolIsMissingOutsideTheHouseAndClosedToStaffStrangersAndATraineeWhoLeft()
    {
        using var house = await N9a1OpenHouseAsync("pool-who", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        var squatUrl = $"{N9b1PPoolUrl}/{library.Squat.Id}";
        using var zeina = CreateClient();
        await RegisterCoachAsync(zeina, "n9b1-pool-who-zeina@example.test", "Zeina Aoun", "N9b1 Pool Who Zeina Gym");
        var theirs = await N9b1PExerciseAsync(zeina, N9b1PBody(
            "Box Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, []));

        // A client of Zeina's, with Training open there: her workspace has no pool, by its list or by an id of her
        // own library or of the house's, and her library stays the staff's.
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(zeina, maya, "n9b1-pool-who-maya@example.test", newAccount: true);
        await CreateFreeTrainingEnrollmentAsync(zeina, mayaId, N9a1HouseToday());
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(maya));
        foreach (var url in new[] { N9b1PPoolUrl, $"{N9b1PPoolUrl}/{theirs.Id}", squatUrl })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await maya.GetAsync(url)).StatusCode, url);
        }

        await AssertStatusAsync(await maya.GetAsync("/api/exercises"), HttpStatusCode.Forbidden);

        // A trainee of the house who is Zeina's client too (CLI-024): under her header nothing of the pool, and her
        // library stays closed; under the house's, the pool is theirs.
        const string jadEmail = "n9b1-pool-who-jad@example.test";
        using var jad = await N9a1TraineeAsync(house.TenantId, jadEmail, "Jad", "Rizk", address: "203.0.113.71");
        var jadThere = await InviteAndAcceptAsync(zeina, jad.Client, jadEmail, newAccount: false);
        await CreateFreeTrainingEnrollmentAsync(zeina, jadThere, N9a1HouseToday());
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(jad.Client));
        await AssertStatusAsync(await jad.Client.GetAsync(N9b1PPoolUrl), HttpStatusCode.NotFound);
        await AssertStatusAsync(await jad.Client.GetAsync(squatUrl), HttpStatusCode.NotFound);
        await AssertStatusAsync(await jad.Client.GetAsync("/api/exercises"), HttpStatusCode.Forbidden);
        SetTenant(jad.Client, house.TenantId);
        Assert.AreEqual((true, 4), N9b1POpenCount(await N9b1PPageAsync(jad.Client, string.Empty)));

        // The house's own staff are refused by the policy, as the staff of any workspace are, and so is someone
        // signed out.
        foreach (var (staff, who) in new[] { (house.Owner, "owner"), (house.Coach!, "coach") })
        {
            Assert.AreEqual(HttpStatusCode.Forbidden, (await staff.GetAsync(N9b1PPoolUrl)).StatusCode, who);
            Assert.AreEqual(HttpStatusCode.Forbidden, (await staff.GetAsync(squatUrl)).StatusCode, who);
        }

        using var anonymous = CreateClient();
        SetTenant(anonymous, house.TenantId);
        await AssertStatusAsync(await anonymous.GetAsync(N9b1PPoolUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.GetAsync(squatUrl), HttpStatusCode.Unauthorized);

        // A trainee who leaves the house: their membership ends with their record, so the policy refuses them before
        // the pool is read at all.
        using var nour = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-who-nour@example.test", "Nour", "Fares", address: "203.0.113.72");
        Assert.AreEqual((true, 4), N9b1POpenCount(await N9b1PPageAsync(nour.Client, string.Empty)));
        await N9a1LeaveAsync(nour.Client, "Moving to another city");
        await AssertStatusAsync(await nour.Client.GetAsync(N9b1PPoolUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await nour.Client.GetAsync(squatUrl), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task N9b1PoolATraineeOpensAPoolDemoAndItsVideoLinkAndTheBatchCarriesTheUploads()
    {
        using var house = await N9a1OpenHouseAsync("pool-open", withCoach: true);
        var coach = house.Coach!;
        var picture = await UploadJpegAsync(coach);
        var clip = await N9b1PUploadClipAsync(coach);
        var link = await R51bAddLinkOkAsync(coach, "n9b1PoolHinge", "Hip hinge from the front");
        var loose = await UploadJpegAsync(coach);
        await N9b1PExerciseAsync(coach, N9b1PBody(
            "Romanian Deadlift", "Strength", "Barbell", "Hinge", [("Hamstrings", "Primary"), ("Glutes", "Secondary")],
            "Push the hips back.", [], mediaAssetIds: [picture.Id, link.Id, clip.Id]));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-open-maher@example.test", "Maher", "Awad", address: "203.0.113.81");

        // No program holds the picture, yet it opens through the private grant every demo uses: a cookie for its own
        // address, no download, and no thumbnail, which exercise media never has. Its bytes come back as uploaded.
        var grant = await N9b1PGrantAsync(trainee.Client, picture.Id);
        Assert.AreEqual(
            ($"/api/media/{picture.Id}/content", "Upload", "image/jpeg", false, (string?)null, (string?)null),
            (grant.Url, grant.Source, grant.ContentType, grant.DownloadAllowed, grant.ThumbnailUrl, grant.WatchUrl));
        var content = await trainee.Client.GetAsync(grant.Url);
        await AssertStatusAsync(content, HttpStatusCode.OK);
        Assert.AreEqual("image/jpeg", content.Content.Headers.ContentType?.MediaType);
        CollectionAssert.AreEqual(JpegBytes, await content.Content.ReadAsByteArrayAsync());

        // The video link opens on YouTube's own page.
        var watched = await N9b1PGrantAsync(trainee.Client, link.Id);
        Assert.AreEqual(
            ("ExternalEmbed", "YouTube", "https://www.youtube.com/watch?v=n9b1PoolHinge"),
            (watched.Source, watched.ExternalProvider, watched.WatchUrl));

        // The batch a screen sends for several demos at once grants both uploads, each with a cookie of its own. A
        // link has no cookie to carry, so no batch names one, for anybody; the upload in no exercise is left out as
        // the single route refuses it.
        N9b1PCatchUpClock();
        var batch = await Phase6GrantBatchAsync(trainee.Client, picture.Id, clip.Id, link.Id, loose.Id);
        await AssertStatusAsync(batch, HttpStatusCode.OK);
        CollectionAssert.AreEquivalent(
            new[] { picture.Id, clip.Id },
            (await RequiredJsonAsync<N9b1PBatch>(batch)).Items.Select(item => item.AssetId).ToArray());
        var played = await trainee.Client.GetAsync($"/api/media/{clip.Id}/content");
        await AssertStatusAsync(played, HttpStatusCode.OK);
        Assert.AreEqual("video/mp4", played.Content.Headers.ContentType?.MediaType);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(trainee.Client, loose.Id)).StatusCode);
    }

    [TestMethod]
    public async Task N9b1PoolADemoClosesWhenItsExerciseIsArchivedOrItIsDeletedAndOneInNoExerciseNeverOpens()
    {
        using var house = await N9a1OpenHouseAsync("pool-close", withCoach: true);
        var coach = house.Coach!;
        var squatDemo = await UploadJpegAsync(coach);
        var shared = await UploadJpegAsync(coach);
        var plankDemo = await UploadJpegAsync(coach);
        var loose = await UploadJpegAsync(coach);
        var squat = await N9b1PExerciseAsync(coach, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, [],
            mediaAssetIds: [squatDemo.Id, shared.Id]));
        await N9b1PExerciseAsync(coach, N9b1PBody(
            "Front Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, [],
            mediaAssetIds: [shared.Id]));
        await N9b1PExerciseAsync(coach, N9b1PBody(
            "Front Plank", "Other", "Bodyweight", "Other", [("Abdominals", "Primary")], null, [],
            mediaAssetIds: [plankDemo.Id]));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-close-hala@example.test", "Hala", "Daher", address: "203.0.113.85");

        var squatGrant = await N9b1PGrantAsync(trainee.Client, squatDemo.Id);
        await AssertStatusAsync(await trainee.Client.GetAsync(squatGrant.Url), HttpStatusCode.OK);
        var plankGrant = await N9b1PGrantAsync(trainee.Client, plankDemo.Id);
        await AssertStatusAsync(await trainee.Client.GetAsync(plankGrant.Url), HttpStatusCode.OK);
        // Media of the library that no exercise links is no demo of the pool.
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(trainee.Client, loose.Id)).StatusCode);

        // The coach archives the back squat. Its own demo closes at once, the grant already given with it, since
        // every content request asks again; the demo it shares with the front squat, still in use, stays open.
        var shelved = await N9b1PSetArchivedAsync(coach, squat.Id, archived: true, squat.Version);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(trainee.Client, squatDemo.Id)).StatusCode);
        await AssertStatusAsync(await trainee.Client.GetAsync(squatGrant.Url), HttpStatusCode.Forbidden);
        var sharedGrant = await N9b1PGrantAsync(trainee.Client, shared.Id);
        await AssertStatusAsync(await trainee.Client.GetAsync(sharedGrant.Url), HttpStatusCode.OK);

        // The coach deletes the plank's demo, which the exercise still links: missing, and its earlier grant refused.
        // The pool opens ready media alone; only a program or workout of the trainee's own keeps a deleted demo theirs
        // (ADR 0011), and none holds this one.
        await AssertStatusAsync(await N9b1PDeleteMediaAsync(coach, plankDemo.Id, plankDemo.Version), HttpStatusCode.OK);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(trainee.Client, plankDemo.Id)).StatusCode);
        await AssertStatusAsync(await trainee.Client.GetAsync(plankGrant.Url), HttpStatusCode.Forbidden);

        // Restored, the back squat's demo opens again: the archive was what closed it.
        await N9b1PSetArchivedAsync(coach, squat.Id, archived: false, shelved.Version);
        var again = await N9b1PGrantAsync(trainee.Client, squatDemo.Id);
        await AssertStatusAsync(await trainee.Client.GetAsync(again.Url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task N9b1PoolTheGrantIsTheHousesAloneNeverABlockedOrDepartedTraineesNorUnderACoachsHeader()
    {
        using var house = await N9a1OpenHouseAsync("pool-grant", withCoach: true);
        var demo = await UploadJpegAsync(house.Coach!);
        await N9b1PExerciseAsync(house.Coach!, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, [], mediaAssetIds: [demo.Id]));
        using var zeina = CreateClient();
        await RegisterCoachAsync(zeina, "n9b1-pool-grant-zeina@example.test", "Zeina Aoun", "N9b1 Pool Grant Zeina Gym");
        var theirDemo = await UploadJpegAsync(zeina);
        await N9b1PExerciseAsync(zeina, N9b1PBody(
            "Box Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, [], mediaAssetIds: [theirDemo.Id]));

        // A client of Zeina's with Training open still opens no demo of her library that no program of theirs holds
        // (MED-002): her workspace is no house. The house's demo is no asset of her workspace at all.
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(zeina, maya, "n9b1-pool-grant-maya@example.test", newAccount: true);
        await CreateFreeTrainingEnrollmentAsync(zeina, mayaId, N9a1HouseToday());
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(maya));
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(maya, theirDemo.Id)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(maya, demo.Id)).StatusCode);

        // A trainee of the house who is Zeina's client too, with Training open in both: under her header neither
        // demo opens, so being the house's widens nothing there; under the house's, the house's demo alone.
        const string jadEmail = "n9b1-pool-grant-jad@example.test";
        using var jad = await N9a1TraineeAsync(house.TenantId, jadEmail, "Jad", "Rizk", address: "203.0.113.91");
        var jadThere = await InviteAndAcceptAsync(zeina, jad.Client, jadEmail, newAccount: false);
        await CreateFreeTrainingEnrollmentAsync(zeina, jadThere, N9a1HouseToday());
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(jad.Client));
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(jad.Client, demo.Id)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(jad.Client, theirDemo.Id)).StatusCode);
        SetTenant(jad.Client, house.TenantId);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(jad.Client, theirDemo.Id)).StatusCode);
        await AssertStatusAsync(await N9b1PAccessAsync(jad.Client, demo.Id), HttpStatusCode.OK);

        // A trainee the house blocks: the grant given before is refused at once, and no new one is given.
        using var sami = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-grant-sami@example.test", "Sami", "Aoun", address: "203.0.113.92");
        var samiGrant = await N9b1PGrantAsync(sami.Client, demo.Id);
        await AssertStatusAsync(await sami.Client.GetAsync(samiGrant.Url), HttpStatusCode.OK);
        await B4aSetBlockedAsync(house.Owner, sami.ProfileId, blocked: true);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(sami.Client, demo.Id)).StatusCode);
        await AssertStatusAsync(await sami.Client.GetAsync(samiGrant.Url), HttpStatusCode.Forbidden);

        // A trainee who leaves: the policy refuses a new grant, their membership being over, and the earlier grant
        // with it.
        using var nour = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-grant-nour@example.test", "Nour", "Fares", address: "203.0.113.93");
        var nourGrant = await N9b1PGrantAsync(nour.Client, demo.Id);
        await N9a1LeaveAsync(nour.Client, "Moving to another city");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await N9b1PAccessAsync(nour.Client, demo.Id)).StatusCode);
        await AssertStatusAsync(await nour.Client.GetAsync(nourGrant.Url), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task N9b1PoolATraineeWhoComesBackReadsThePoolAndOpensItsDemosAsTheirNewRecord()
    {
        using var house = await N9a1OpenHouseAsync("pool-back", withCoach: true);
        var demo = await UploadJpegAsync(house.Coach!);
        await N9b1PExerciseAsync(house.Coach!, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, [], mediaAssetIds: [demo.Id]));
        const string email = "n9b1-pool-back-lina@example.test";
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Lina", "Saad", address: "203.0.113.97");
        Assert.AreEqual((true, 1), N9b1POpenCount(await N9b1PPageAsync(trainee.Client, string.Empty)));
        await N9a1LeaveAsync(trainee.Client, "Trying it alone");
        await AssertStatusAsync(await trainee.Client.GetAsync(N9b1PPoolUrl), HttpStatusCode.Forbidden);

        // A trainee signs up once a house week, so they come back in the next one: still signed in, they join at once
        // with a new record beside the ended one, and Free starts again for it.
        N9b1PNextHouseWeek();
        var back = await N9a1SignUpAsync(trainee.Client, email, "Lina", "Saad", withPassword: false);
        await AssertStatusAsync(back, HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<N9a1Answer>(back)).Joined);
        var profiles = (await N9a1PersonAsync(email)).Profiles;
        Assert.HasCount(2, profiles);
        Assert.AreEqual(trainee.ProfileId, profiles.Single(item => item.ReleasedAtUtc is not null).Id);

        // The pool and the grant read the current record alone (ADR 0027's CurrentFor): a lookup by the account
        // would find two records, or the ended one, whose Free was cancelled when they left.
        var page = await N9b1PPageAsync(trainee.Client, string.Empty);
        Assert.AreEqual((true, "Granted", "Back Squat"), (page.IsAllowed, page.AccessReason, N9b1PNames(page)));
        var grant = await N9b1PGrantAsync(trainee.Client, demo.Id);
        await AssertStatusAsync(await trainee.Client.GetAsync(grant.Url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task N9b1PoolATraineeWritesNothingToThePoolNorToItsDemos()
    {
        using var house = await N9a1OpenHouseAsync("pool-write", withCoach: true);
        var coach = house.Coach!;
        var demo = await UploadJpegAsync(coach);
        var squat = await N9b1PExerciseAsync(coach, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], "Brace, then sit between the hips.", [],
            mediaAssetIds: [demo.Id]));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b1-pool-write-dina@example.test", "Dina", "Mrad", address: "203.0.113.95");
        var client = trainee.Client;

        // The library's routes stay the staff's (LIB-006): a trainee reads none of them, adds, edits or archives no
        // exercise, adds no picture or video link and deletes no demo.
        await AssertStatusAsync(await client.GetAsync("/api/exercises"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync($"/api/exercises/{squat.Id}"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/exercises/", N9b1PBody(
                "Air Squat", "Strength", "Bodyweight", "Squat", [("Quadriceps", "Primary")], null, [])),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await client.PutAsJsonAsync($"/api/exercises/{squat.Id}", new
            {
                name = "Back Squat",
                instructions = "Mine now.",
                equipment = "Barbell",
                movementPattern = "Squat",
                classification = "Strength",
                muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
                tags = Array.Empty<string>(),
                alternatives = Array.Empty<object>(),
                mediaAssetIds = Array.Empty<Guid>(),
                version = squat.Version,
            }),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9b1PArchiveAsync(client, squat.Id, archived: true, squat.Version), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await R51bAddLinkAsync(client, "n9b1PoolMine", "My own squat"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(client);
        using (var form = new MultipartFormDataContent())
        {
            var file = new ByteArrayContent(JpegBytes);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            form.Add(new StringContent("My squat"), "title");
            form.Add(file, "file", "my-squat.jpg");
            await AssertStatusAsync(await client.PostAsync("/api/media/uploads", form), HttpStatusCode.Forbidden);
        }

        await AssertStatusAsync(await N9b1PDeleteMediaAsync(client, demo.Id, demo.Version), HttpStatusCode.Forbidden);

        // The pool is as the coach left it, and the house holds nothing the trainee sent.
        var page = await N9b1PPageAsync(client, string.Empty);
        var asTheCoachLeftIt = string.Join(
            " | ",
            "Back Squat", "Strength", "Barbell", "Squat", "Quadriceps Primary", "Brace, then sit between the hips.",
            $"{demo.Id} Picture");
        Assert.AreEqual((1, asTheCoachLeftIt), (page.Total, N9b1PLine(page.Items.Single())));
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            "SELECT count(*) FROM exercise_library.\"Exercises\" WHERE \"TenantId\" = @id",
            house.TenantId));
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            "SELECT count(*) FROM media.\"Assets\" WHERE \"TenantId\" = @id",
            house.TenantId));
    }

    // ---------- helpers ----------

    /// <summary>
    /// The house's library for the read tests, made by its staff: four exercises in use, each with its type,
    /// equipment, movement, muscles and instructions (Other's own name on one, none on another), a tag each, a swap
    /// with a note, and a fifth the staff archived. The names test natural order: a lower-case first letter and an
    /// accent.
    /// </summary>
    private static async Task<N9b1PLibrary> N9b1PLibraryAsync(HttpClient staff)
    {
        var squat = await N9b1PExerciseAsync(staff, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat",
            [("Glutes", "Secondary"), ("Quadriceps", "Primary"), ("Hamstrings", "Secondary")],
            "Brace, then sit between the hips.", ["knee-friendly"]));
        var hold = await N9b1PExerciseAsync(staff, N9b1PBody(
            "arch hold", "Other", "Bodyweight", "Other", [("Abdominals", "Primary")], null, ["anti-extension"],
            typeName: "Rehab"));
        var raise = await N9b1PExerciseAsync(staff, N9b1PBody(
            "Élévations latérales", "Strength", "Dumbbell", "Isolation", [("Shoulders", "Primary")],
            "Raise to shoulder height, slowly.", ["deltoid-burner"]));
        var carry = await N9b1PExerciseAsync(staff, N9b1PBody(
            "Zercher Carry", "Conditioning", "Barbell", "Carry", [("FullBody", "Primary"), ("Forearms", "Secondary")],
            "Walk tall with the bar in the elbows.", ["grip-builder"],
            alternatives: [(squat.Id, "Swap when the bar is taken")]));
        var goblet = await N9b1PExerciseAsync(staff, N9b1PBody(
            "Goblet Squat", "Strength", "Kettlebell", "Squat", [("Quadriceps", "Primary")], "Hold the bell at the chest.",
            ["knee-friendly"]));
        await B9ArchiveAsync(staff, goblet);
        return new N9b1PLibrary(squat, hold, raise, carry, goblet);
    }

    /// <summary>An exercise as the library page saves one.</summary>
    private static object N9b1PBody(
        string name,
        string classification,
        string equipment,
        string movementPattern,
        (string Muscle, string Role)[] muscles,
        string? instructions,
        string[] tags,
        Guid[]? mediaAssetIds = null,
        string? typeName = null,
        (Guid Id, string Note)[]? alternatives = null) => new
        {
            name,
            instructions,
            equipment,
            movementPattern,
            classification,
            muscles = muscles.Select(item => new { muscle = item.Muscle, role = item.Role }).ToArray(),
            tags,
            alternatives = (alternatives ?? []).Select(item => new { exerciseId = item.Id, note = item.Note }).ToArray(),
            mediaAssetIds = mediaAssetIds ?? [],
            typeName,
        };

    private static async Task<ExerciseView> N9b1PExerciseAsync(HttpClient staff, object body)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync("/api/exercises/", body);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ExerciseView>(response);
    }

    private static async Task<HttpResponseMessage> N9b1PArchiveAsync(HttpClient caller, Guid exerciseId, bool archived, uint version)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PutAsJsonAsync($"/api/exercises/{exerciseId}/archive", new { isArchived = archived, version });
    }

    /// <summary>Archives or restores an exercise; the answer carries the version the next change needs.</summary>
    private static async Task<ExerciseView> N9b1PSetArchivedAsync(HttpClient staff, Guid exerciseId, bool archived, uint version)
    {
        var response = await N9b1PArchiveAsync(staff, exerciseId, archived, version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ExerciseView>(response);
    }

    /// <summary>A clip as the library takes one: an MP4's signature in a few bytes, which the scanner lets through.</summary>
    private static async Task<MediaAsset> N9b1PUploadClipAsync(HttpClient staff)
    {
        var clip = new byte[64];
        "ftypisom"u8.CopyTo(clip.AsSpan(4));
        await RefreshCsrfAsync(staff);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Back squat from the side"), "title");
        var file = new ByteArrayContent(clip);
        file.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
        form.Add(file, "file", "back-squat-side.mp4");
        var response = await staff.PostAsync("/api/media/uploads", form);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MediaAsset>(response);
    }

    /// <summary>Deletes media from the library as its page does: the asset is kept, tombstoned, with its links.</summary>
    private static async Task<HttpResponseMessage> N9b1PDeleteMediaAsync(HttpClient caller, Guid assetId, uint version)
    {
        await RefreshCsrfAsync(caller);
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{assetId}")
        {
            Content = JsonContent.Create(new { version }),
        };
        return await caller.SendAsync(request);
    }

    private static async Task<N9b1PPage> N9b1PPageAsync(HttpClient caller, string query)
    {
        var response = await caller.GetAsync($"{N9b1PPoolUrl}{query}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N9b1PPage>(response);
    }

    private static async Task<N9b1POne> N9b1POneAsync(HttpClient caller, Guid exerciseId)
    {
        var response = await caller.GetAsync($"{N9b1PPoolUrl}/{exerciseId}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N9b1POne>(response);
    }

    /// <summary>Asks for one demo's grant as a screen does, whatever the answer.</summary>
    private async Task<HttpResponseMessage> N9b1PAccessAsync(HttpClient caller, Guid assetId)
    {
        N9b1PCatchUpClock();
        await RefreshCsrfAsync(caller);
        return await caller.PostAsync($"/api/media/{assetId}/access", null);
    }

    private async Task<N9b1PGrant> N9b1PGrantAsync(HttpClient caller, Guid assetId)
    {
        var response = await N9b1PAccessAsync(caller, assetId);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N9b1PGrant>(response);
    }

    /// <summary>
    /// Brings the test clock up to the wall clock before a grant is minted, never back. A grant's protection and its
    /// cookie also expire by the wall clock, so one minted on a clock a slow setup left behind would arrive stale, as
    /// <c>CreateMediaAccessAsync</c> says; setting the clock back could put the house's day before the day Free began.
    /// </summary>
    private void N9b1PCatchUpClock()
    {
        var now = DateTimeOffset.UtcNow;
        if (now > RequiredTestClock.UtcNow)
        {
            RequiredTestClock.Set(now);
        }
    }

    /// <summary>
    /// Moves the test clock on to ten in the morning of the house's next Monday, the first day of its next week. It
    /// only ever moves forward, so a grant minted after it is never stale by the wall clock, whatever today is.
    /// </summary>
    private void N9b1PNextHouseWeek()
    {
        var today = N9a1HouseToday();
        var days = ((int)DayOfWeek.Monday - (int)today.DayOfWeek + 7) % 7;
        var monday = today.AddDays(days == 0 ? 7 : days);
        var local = monday.ToDateTime(new TimeOnly(10, 0));
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        RequiredTestClock.Set(new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime());
        Assert.AreEqual(monday, N9a1HouseToday());
    }

    /// <summary>The caller's Training decision in the workspace their header names.</summary>
    private static async Task<string> N9b1PTrainingAsync(HttpClient client) =>
        (await RequiredJsonAsync<N9b1PAccess[]>(await client.GetAsync("/api/client-access/me")))
            .Single(item => item.Feature == "Training")
            .Reason;

    private static (bool IsAllowed, int Total) N9b1POpenCount(N9b1PPage page) => (page.IsAllowed, page.Total);

    private static string N9b1PNames(N9b1PPage page) => string.Join(" | ", page.Items.Select(item => item.Name));

    /// <summary>One exercise as a trainee reads it, on one line: name, type, equipment, movement, muscles, instructions, demos.</summary>
    private static string N9b1PLine(N9b1PItem item) => string.Join(
        " | ",
        item.Name,
        item.TypeName is null ? item.Classification : $"{item.Classification} ({item.TypeName})",
        item.Equipment,
        item.MovementPattern,
        string.Join(", ", item.Muscles.Select(muscle => $"{muscle.Muscle} {muscle.Role}")),
        item.Instructions ?? "no instructions",
        N9b1PDemos(item));

    private static string N9b1PDemos(N9b1PItem item) => item.Demos.Length == 0
        ? "no demos"
        : string.Join(", ", item.Demos.Select(demo => $"{demo.MediaAssetId} {demo.Kind}"));

    private static string[] N9b1PFields(JsonElement element) => [.. element.EnumerateObject().Select(property => property.Name)];

    private sealed record N9b1PLibrary(
        ExerciseView Squat,
        ExerciseView Hold,
        ExerciseView Raise,
        ExerciseView Carry,
        ExerciseView Goblet);

    private sealed record N9b1PPage(bool IsAllowed, string AccessReason, int Total, N9b1PItem[] Items);

    private sealed record N9b1POne(bool IsAllowed, string AccessReason, N9b1PItem? Exercise);

    private sealed record N9b1PItem(
        Guid Id,
        string Name,
        string Classification,
        string? TypeName,
        string Equipment,
        string MovementPattern,
        N9b1PMuscle[] Muscles,
        string? Instructions,
        N9b1PDemo[] Demos);

    private sealed record N9b1PMuscle(string Muscle, string Role);

    private sealed record N9b1PDemo(Guid MediaAssetId, string Kind);

    private sealed record N9b1PGrant(
        Guid AssetId,
        string Source,
        string? ContentType,
        string Url,
        bool DownloadAllowed,
        string? ThumbnailUrl,
        string? ExternalProvider,
        string? WatchUrl);

    private sealed record N9b1PBatch(N9b1PGrant[] Items);

    private sealed record N9b1PAccess(string Feature, bool IsAllowed, string Reason);
}
