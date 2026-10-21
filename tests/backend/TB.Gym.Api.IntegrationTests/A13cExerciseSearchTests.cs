using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A13c (WEA-14): the builders read the first page of the library and search the rest on the
/// server. A chip asks for its group of movement patterns, the program's own lifts are read by id, the first
/// page asks for the library's count per pattern so the chips need no full read, names come in natural order
/// on every server, and an alternative says whether it was archived.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] A13cNamesInByteOrder =
        ["Zercher Squat", "bench dip", "Élévations latérales", "Bench Press", "goblet squat"];

    [TestMethod]
    public async Task A13cTheLibrarySearchTakesSeveralPatternsAndIdsAndCountsEachPattern()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a13c-search-coach@example.test", "Coach", "Search");
        var squat = await A13cExerciseAsync(coach, "Back Squat", "Squat");
        var bench = await A13cExerciseAsync(coach, "Bench Press", "HorizontalPush");
        var press = await A13cExerciseAsync(coach, "Overhead Press", "VerticalPush");
        var row = await A13cExerciseAsync(coach, "Barbell Row", "HorizontalPull");
        var lunge = await A13cExerciseAsync(coach, "Walking Lunge", "Squat");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/exercises/{lunge.Id}/archive", new { isArchived = true, version = lunge.Version }),
            HttpStatusCode.OK);

        // A chip's group: both pushes, and the counts of the whole library beside them when asked for.
        var pushes = await A13cSearchAsync(
            coach, "/api/exercises?movementPattern=HorizontalPush&movementPattern=VerticalPush&patterns=true");
        Assert.AreEqual((2, "Bench Press | Overhead Press"), (pushes.Total, pushes.Names));
        Assert.AreEqual("Squat 1, HorizontalPush 1, VerticalPush 1, HorizontalPull 1", pushes.Patterns,
            "The archived lunge is not counted, and the counts ignore the chip.");
        Assert.AreEqual(string.Empty, (await A13cSearchAsync(coach, "/api/exercises?movementPattern=Squat")).Patterns,
            "A page that does not ask for the counts is not given them.");

        // The counts ignore the search too, and count the archived lunge when it is asked for. Every word of a
        // search must be found, in any order, as the builders' search did in the browser; the first eight are read.
        var typed = await A13cSearchAsync(coach, "/api/exercises?query=bench&patterns=true");
        Assert.AreEqual(("Bench Press", pushes.Patterns), (typed.Names, typed.Patterns));
        Assert.AreEqual("Bench Press", (await A13cSearchAsync(coach, "/api/exercises?query=press%20bench")).Names);
        Assert.AreEqual("Barbell Row | Bench Press", (await A13cSearchAsync(coach, "/api/exercises?query=b%20%20r")).Names);
        Assert.AreEqual("Barbell Row", (await A13cSearchAsync(
            coach, "/api/exercises?query=b%20a%20r%20e%20l%20o%20w%20r%20zzz")).Names, "A ninth word is not read.");
        var archived = await A13cSearchAsync(coach, "/api/exercises?includeArchived=true&patterns=true");
        Assert.AreEqual("Squat 2, HorizontalPush 1, VerticalPush 1, HorizontalPull 1", archived.Patterns);

        // A program's own lifts by id, archived ones only when asked for.
        var own = await A13cSearchAsync(coach, $"/api/exercises?ids={squat.Id}&ids={row.Id}&ids={lunge.Id}");
        Assert.AreEqual((2, "Back Squat | Barbell Row"), (own.Total, own.Names));
        var ownArchived = await A13cSearchAsync(
            coach, $"/api/exercises?ids={squat.Id}&ids={lunge.Id}&includeArchived=true");
        Assert.AreEqual("Back Squat | Walking Lunge", ownArchived.Names);
        var both = await A13cSearchAsync(coach, $"/api/exercises?ids={bench.Id}&ids={press.Id}&movementPattern=VerticalPush");
        Assert.AreEqual("Overhead Press", both.Names, "Ids and patterns narrow together.");

        // Another workspace's exercise is never found by its id, nor counted.
        using var other = CreateClient();
        var otherTenant = await RegisterCoachAsync(other, "a13c-search-other@example.test", "Other", "Coach");
        var theirs = await A13cExerciseAsync(other, "Their Squat", "Squat");
        var asked = await A13cSearchAsync(
            coach, $"/api/exercises?ids={theirs.Id}&ids={squat.Id}&includeArchived=true&patterns=true");
        Assert.AreEqual((1, "Back Squat", archived.Patterns), (asked.Total, asked.Names, asked.Patterns));

        // Only the workspace's staff read its library: never a client, a stranger or someone signed out.
        using var client = CreateClient();
        await R31InviteAsync(coach, client, tenant, "a13c-search-maya@example.test", "Maya", "Rahman");
        SetTenant(client, tenant);
        var byId = $"/api/exercises?ids={squat.Id}&patterns=true";
        await AssertStatusAsync(await client.GetAsync(byId), HttpStatusCode.Forbidden);
        SetTenant(other, tenant);
        await AssertStatusAsync(await other.GetAsync(byId), HttpStatusCode.Forbidden);
        SetTenant(other, otherTenant);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(byId), HttpStatusCode.Unauthorized);

        // More than a hundred ids is refused, naming the field; an unknown pattern is refused as before.
        var many = string.Join("&", Enumerable.Range(0, 101).Select(_ => $"ids={Guid.NewGuid()}"));
        var tooMany = await coach.GetAsync($"/api/exercises?{many}");
        await AssertStatusAsync(tooMany, HttpStatusCode.BadRequest);
        StringAssert.Contains(await tooMany.Content.ReadAsStringAsync(), "Ask for at most 100 exercises at once.");
        await AssertStatusAsync(await coach.GetAsync("/api/exercises?movementPattern=Cartwheel"), HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task A13cTheLibraryListsNamesInNaturalOrderAndSaysWhichSwapIsArchived()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a13c-order-coach@example.test", "Coach", "Order");
        foreach (var name in A13cNamesInByteOrder)
        {
            await A13cExerciseAsync(coach, name, "Squat");
        }

        // The test database sorts by byte, as production's alpine image does: capitals first, accents last.
        Assert.AreEqual(
            "bench dip | Bench Press | Élévations latérales | goblet squat | Zercher Squat",
            (await A13cSearchAsync(coach, "/api/exercises")).Names);
        Assert.AreEqual(
            "Élévations latérales | goblet squat",
            (await A13cSearchAsync(coach, "/api/exercises?skip=2&take=2")).Names,
            "Pages follow the same order.");

        // A swap that was archived says so, so the builder names it as an archived exercise.
        var old = await A13cExerciseAsync(coach, "Old Front Squat", "Squat");
        var front = await A13cExerciseAsync(coach, "Front Squat", "Squat", [old.Id]);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/exercises/{old.Id}/archive", new { isArchived = true, version = old.Version }),
            HttpStatusCode.OK);
        using var page = JsonDocument.Parse(await coach.GetStringAsync($"/api/exercises?ids={front.Id}"));
        var alternative = page.RootElement.GetProperty("items")[0].GetProperty("alternatives")[0];
        Assert.AreEqual(
            ("Old Front Squat", true),
            (alternative.GetProperty("exerciseName").GetString(), alternative.GetProperty("isArchived").GetBoolean()));
    }

    [TestMethod]
    public async Task A13cTheRecipeSearchFindsEveryWordInAnyOrder()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a13c-recipes-coach@example.test", "Coach", "Recipes");
        await R44aRecipeAsync(coach, "Chicken & rice bowl", 30m);
        await R44aRecipeAsync(coach, "Rice pudding", 5m);
        await R44aRecipeAsync(coach, "Chicken soup", 20m, publish: false);
        await R44aRecipeAsync(coach, "chickpea salad", 15m);

        Assert.AreEqual("Chicken & rice bowl", (await A13cSearchAsync(
            coach, "/api/nutrition/recipes?published=true&query=rice%20chicken", patterns: false)).Names);
        Assert.AreEqual("Chicken & rice bowl | Rice pudding", (await A13cSearchAsync(
            coach, "/api/nutrition/recipes?published=true&query=RICE", patterns: false)).Names);
        var chicken = await A13cSearchAsync(
            coach, "/api/nutrition/recipes?published=true&query=chick", patterns: false);
        Assert.AreEqual((2, "Chicken & rice bowl | chickpea salad"), (chicken.Total, chicken.Names),
            "A recipe not published is not offered to a plan.");
        Assert.AreEqual("Chicken & rice bowl | chickpea salad | Rice pudding", (await A13cSearchAsync(
            coach, "/api/nutrition/recipes?published=true", patterns: false)).Names,
            "Natural order, where the database's own puts every capital first.");
    }

    private static async Task<Exercise> A13cExerciseAsync(
        HttpClient coach,
        string name,
        string movementPattern,
        Guid[]? alternatives = null)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/exercises/", new
        {
            name,
            instructions = (string?)null,
            equipment = "Barbell",
            movementPattern,
            classification = "Strength",
            muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
            tags = Array.Empty<string>(),
            alternatives = (alternatives ?? []).Select(id => new { exerciseId = id, note = (string?)null }).ToArray(),
            mediaAssetIds = Array.Empty<Guid>(),
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Exercise>(response);
    }

    /// <summary>A page's total, its names in order, and (for exercises) its counts per pattern, each as one line.</summary>
    private static async Task<(int Total, string Names, string Patterns)> A13cSearchAsync(
        HttpClient coach,
        string url,
        bool patterns = true)
    {
        var response = await coach.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        using var page = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = page.RootElement;
        return (
            root.GetProperty("total").GetInt32(),
            string.Join(" | ", root.GetProperty("items").EnumerateArray()
                .Select(item => item.GetProperty("name").GetString()!)),
            patterns
                ? string.Join(", ", root.GetProperty("patterns").EnumerateArray()
                    .Select(item => $"{item.GetProperty("pattern").GetString()} {item.GetProperty("count").GetInt32()}"))
                : string.Empty);
    }
}
