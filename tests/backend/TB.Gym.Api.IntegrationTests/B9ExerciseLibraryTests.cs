using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using ExerciseView = TB.Gym.Modules.ExerciseLibrary.ExerciseView;
using MediaAssetStatus = TB.Gym.Modules.Media.MediaAssetStatus;
using MediaAssetView = TB.Gym.Modules.Media.MediaAssetView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The exercise library (critique B9): "Your exercises" and "Archived (n)" read on the server (LIB-004), seven
/// types with Other's own name in the Type filter (LIB-005), the tags with their counts, and a video link that
/// carries its watch address and its own title, read once from its provider when it is added (MED-015).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B9TheLibraryReadsInUseArchivedOrBothAndOffersItsTagsAndOwnTypes()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b9-library-coach@example.test", "B9 Coach", "B9 Library");
        await B9ExerciseAsync(coach, "Back Squat", "Strength", tags: ["knee-friendly", "Home"]);
        await B9ExerciseAsync(coach, "Box Jump", "Power", tags: ["plyo"]);
        var couch = await B9ExerciseAsync(coach, "Couch Stretch", "Mobility", tags: ["home"]);
        await B9ExerciseAsync(coach, "Step-down", "Other", typeName: "Rehab", tags: ["Knee-friendly"]);
        await B9ExerciseAsync(coach, "Terminal Knee Extension", "Other", typeName: "rehab", tags: ["knee-friendly"]);
        await B9ExerciseAsync(coach, "Plank", "Other");
        await B9ExerciseAsync(coach, "Band Pull-apart", "WarmUp");
        await B9ArchiveAsync(coach, couch);

        // Your exercises: those in use, as every picker reads them; the old switch is not read any more.
        Assert.AreEqual(
            "Back Squat | Band Pull-apart | Box Jump | Plank | Step-down | Terminal Knee Extension",
            (await A13cSearchAsync(coach, "/api/exercises", patterns: false)).Names);
        Assert.AreEqual(6, (await A13cSearchAsync(coach, "/api/exercises?includeArchived=true", patterns: false)).Total);
        Assert.AreEqual("Couch Stretch", (await A13cSearchAsync(coach, "/api/exercises?status=Archived", patterns: false)).Names);
        Assert.AreEqual(7, (await A13cSearchAsync(coach, "/api/exercises?status=Both", patterns: false)).Total);

        // The page's filters: both counts, the tags in use with how many carry each (one choice in any case,
        // spelled as most spell it), and Other's own names once each, whatever the search and the other filters.
        var facets = await B9FacetsAsync(coach, "/api/exercises?facets=true&query=plank&classification=Other");
        Assert.AreEqual((6, 1), (facets.Active, facets.Archived));
        Assert.AreEqual("Home 1, knee-friendly 3, plyo 1", facets.Tags, "The archived stretch's home is not counted here.");
        Assert.AreEqual("Rehab", facets.TypeNames);
        var archived = await B9FacetsAsync(coach, "/api/exercises?facets=true&status=Archived");
        Assert.AreEqual(((6, 1), "home 1", string.Empty), ((archived.Active, archived.Archived), archived.Tags, archived.TypeNames));
        using (var plain = JsonDocument.Parse(await coach.GetStringAsync("/api/exercises")))
        {
            Assert.AreEqual(JsonValueKind.Null, plain.RootElement.GetProperty("facets").ValueKind, "Only the library page asks.");
        }

        // An own name filters in any case, within Other; Other alone holds all three; a tag in any case.
        Assert.AreEqual("Step-down | Terminal Knee Extension", (await A13cSearchAsync(
            coach, "/api/exercises?classification=Other&typeName=REHAB", patterns: false)).Names);
        Assert.AreEqual(string.Empty, (await A13cSearchAsync(
            coach, "/api/exercises?classification=Strength&typeName=Rehab", patterns: false)).Names);
        Assert.AreEqual(3, (await A13cSearchAsync(coach, "/api/exercises?classification=Other", patterns: false)).Total);
        Assert.AreEqual("Back Squat | Step-down | Terminal Knee Extension", (await A13cSearchAsync(
            coach, "/api/exercises?tag=KNEE-FRIENDLY", patterns: false)).Names);
        using (var page = JsonDocument.Parse(await coach.GetStringAsync("/api/exercises?typeName=rehab")))
        {
            Assert.AreEqual(
                "Rehab, rehab",
                string.Join(", ", page.RootElement.GetProperty("items").EnumerateArray()
                    .Select(item => item.GetProperty("typeName").GetString())),
                "Each exercise keeps its own spelling.");
        }

        // A status the server does not know is refused in words; General is no longer a type.
        foreach (var url in new[] { "/api/exercises?status=Deleted", "/api/exercises?status=9", "/api/exercises?classification=General" })
        {
            await AssertStatusAsync(await coach.GetAsync(url), HttpStatusCode.BadRequest);
        }

        StringAssert.Contains(await (await coach.GetAsync("/api/exercises?status=9")).Content.ReadAsStringAsync(), "Ask for Active, Archived or Both.");

        // Another workspace counts and lists only its own; a client of this one reads none of it.
        using var other = CreateClient();
        await RegisterCoachAsync(other, "b9-library-other@example.test", "B9 Other", "B9 Other Gym");
        await B9ExerciseAsync(other, "Their Rehab Row", "Other", typeName: "Prehab", tags: ["theirs"]);
        var theirs = await B9FacetsAsync(other, "/api/exercises?facets=true&status=Both");
        Assert.AreEqual(((1, 0), "theirs 1", "Prehab"), ((theirs.Active, theirs.Archived), theirs.Tags, theirs.TypeNames));
        Assert.AreEqual(0, (await A13cSearchAsync(other, "/api/exercises?typeName=Rehab", patterns: false)).Total);
        using var client = CreateClient();
        await R31InviteAsync(coach, client, tenant, "b9-library-maya@example.test", "Maya", "Rahman");
        SetTenant(client, tenant);
        await AssertStatusAsync(await client.GetAsync("/api/exercises?facets=true"), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task B9OtherTakesANameOfTheCoachsOwnAndTheDatabaseKeepsTheTypes()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b9-types-coach@example.test", "B9 Coach", "B9 Types");

        // Refused in words: a name on another type, a long name, another type's name, a type that is gone.
        foreach (var (classification, typeName, words) in new[]
                 {
                     ("Strength", "Rehab", "Only an exercise of type Other takes a name of your own."),
                     ("Other", new string('r', 41), "Keep the type's name to 40 characters."),
                     ("Other", "Warm-up and activation", "Warm-up and activation is one of the types already. Choose it as the type, or give this one another name."),
                 })
        {
            var refused = await B9PostExerciseAsync(coach, "Step-down", classification, typeName);
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            StringAssert.Contains(await refused.Content.ReadAsStringAsync(), words);
        }

        await AssertStatusAsync(await B9PostExerciseAsync(coach, "Step-down", "General", null), HttpStatusCode.BadRequest);

        // Kept trimmed; "Other" itself is no name; a change of type drops the name.
        var step = await B9ExerciseAsync(coach, "Step-down", "Other", typeName: "  Knee rehab  ");
        Assert.AreEqual(("Other", "Knee rehab"), (step.Classification.ToString(), step.TypeName));
        Assert.IsNull((await B9ExerciseAsync(coach, "Plank", "Other", typeName: "other")).TypeName);
        await RefreshCsrfAsync(coach);
        var changed = await coach.PutAsJsonAsync($"/api/exercises/{step.Id}", B9Body("Step-down", "Strength", null, step.Version));
        await AssertStatusAsync(changed, HttpStatusCode.OK);
        var strength = await ReadSlicePayloadAsync<ExerciseView>(changed);
        Assert.AreEqual(("Strength", (string?)null), (strength.Classification.ToString(), strength.TypeName));

        // The database keeps the seven types, and an own name on Other alone, whatever writes to it.
        foreach (var (sql, constraint) in new[]
                 {
                     ("UPDATE exercise_library.\"Exercises\" SET \"Classification\" = 'General' WHERE \"Id\" = @id", "CK_Exercises_Classification"),
                     ("UPDATE exercise_library.\"Exercises\" SET \"TypeName\" = 'Rehab' WHERE \"Id\" = @id", "CK_Exercises_TypeName"),
                     ("UPDATE exercise_library.\"Exercises\" SET \"Classification\" = 'Other', \"TypeName\" = ' Rehab' WHERE \"Id\" = @id", "CK_Exercises_TypeName"),
                 })
        {
            var violation = await Assert.ThrowsExactlyAsync<PostgresException>(() => B9ExecuteAsync(sql, step.Id));
            Assert.AreEqual(constraint, violation.ConstraintName);
        }
    }

    [TestMethod]
    public async Task B9TheMigrationMakesEveryGeneralExerciseOther()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b9-migration-coach@example.test", "B9 Coach", "B9 Migration");
        var plank = await B9ExerciseAsync(coach, "Plank", "Other");
        var squat = await B9ExerciseAsync(coach, "Back Squat", "Strength");

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_B9ExerciseTypesAndVideoTitles", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        await migrator.MigrateAsync(previous);
        Assert.AreEqual("General", await B9ClassificationAsync(plank.Id), "Going back, Other is General again.");
        await migrator.MigrateAsync(migration);
        Assert.AreEqual(("Other", "Strength"), (await B9ClassificationAsync(plank.Id), await B9ClassificationAsync(squat.Id)));

        // With every later migration back, the coach reads it as Other.
        await migrator.MigrateAsync();
        Assert.AreEqual("Plank", (await A13cSearchAsync(coach, "/api/exercises?classification=Other", patterns: false)).Names);
    }

    [TestMethod]
    public async Task B9AVideoLinkCarriesItsWatchAddressAndItsOwnTitleAskedOnce()
    {
        var fake = oEmbed ?? throw new InvalidOperationException("The video title fake is not running.");
        fake.Titles["dQw4w9WgXcQ"] = "  How to Back Squat\n‮| Starting Strength  ";
        fake.Titles["76979871"] = "The Hip Hinge";
        fake.Titles["LongTitle01"] = new string('a', 260);
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b9-video-coach@example.test", "B9 Coach", "B9 Video");

        // The provider's title, made one clean line, beside the name the coach's screen gave; the address it
        // was asked at is the provider's own oEmbed page for the video's own page.
        var squat = await R51bAddLinkOkAsync(coach, "dQw4w9WgXcQ", "Back Squat");
        Assert.AreEqual(
            ("Back Squat", "How to Back Squat | Starting Strength", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            (squat.Title, squat.ExternalTitle, squat.WatchUrl));
        CollectionAssert.Contains(
            fake.Asked.ToArray(),
            "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
        await RefreshCsrfAsync(coach);
        var vimeoResponse = await coach.PostAsJsonAsync("/api/media/external", new { title = "Hinge", provider = "Vimeo", externalMediaId = "76979871" });
        await AssertStatusAsync(vimeoResponse, HttpStatusCode.OK);
        var hinge = await ReadSlicePayloadAsync<MediaAssetView>(vimeoResponse);
        Assert.AreEqual(("The Hip Hinge", "https://vimeo.com/76979871"), (hinge.ExternalTitle, hinge.WatchUrl));
        CollectionAssert.Contains(fake.Asked.ToArray(), "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871");
        Assert.AreEqual(new string('a', 199) + "…", (await R51bAddLinkOkAsync(coach, "LongTitle01", "Long")).ExternalTitle);

        // A provider that cannot say adds the link without a title; adding it again once it can fills it in.
        foreach (var silent in new[] { OEmbedFake.NotFoundId, OEmbedFake.UnreachableId, OEmbedFake.TimeoutId, OEmbedFake.NotJsonId, OEmbedFake.NoTitleId, OEmbedFake.TooLongId })
        {
            var link = await R51bAddLinkOkAsync(coach, silent, "Untitled demo");
            Assert.AreEqual((MediaAssetStatus.Ready, (string?)null), (link.Status, link.ExternalTitle), silent);
        }

        fake.Titles[OEmbedFake.NotFoundId] = "Found at last";
        Assert.AreEqual("Found at last", (await R51bAddLinkOkAsync(coach, OEmbedFake.NotFoundId, "Again")).ExternalTitle);

        // A link with its title is not asked about again, by this coach or a colleague.
        var asked = fake.Asked.Count;
        fake.Titles["dQw4w9WgXcQ"] = "Renamed on YouTube";
        Assert.AreEqual("How to Back Squat | Starting Strength", (await R51bAddLinkOkAsync(coach, "dQw4w9WgXcQ", "Squat")).ExternalTitle);
        Assert.HasCount(asked, fake.Asked);

        // The coach's media list carries both, so the library's tile opens the video with no grant; so does a grant.
        using (var list = JsonDocument.Parse(await coach.GetStringAsync("/api/media?skip=0&take=100")))
        {
            var row = list.RootElement.GetProperty("items").EnumerateArray()
                .Single(item => item.GetProperty("id").GetGuid() == squat.Id);
            Assert.AreEqual(
                ("How to Back Squat | Starting Strength", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
                (row.GetProperty("externalTitle").GetString(), row.GetProperty("watchUrl").GetString()));
        }

        await RefreshCsrfAsync(coach);
        var grant = await coach.PostAsync($"/api/media/{hinge.Id}/access", null);
        await AssertStatusAsync(grant, HttpStatusCode.OK);
        var access = await grant.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual(
            ("The Hip Hinge", "https://vimeo.com/76979871"),
            (access.GetProperty("externalTitle").GetString(), access.GetProperty("watchUrl").GetString()));

        // Another workspace adding the same video asks for itself and keeps its own copy.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b9-video-stranger@example.test", "B9 Stranger", "B9 Stranger Gym");
        var theirs = await R51bAddLinkOkAsync(stranger, "dQw4w9WgXcQ", "Their squat");
        Assert.AreEqual(("Renamed on YouTube", true), (theirs.ExternalTitle, theirs.Id != squat.Id));

        // Only a link holds a provider's title, and never an empty one.
        var violation = await Assert.ThrowsExactlyAsync<PostgresException>(() => B9ExecuteAsync(
            "UPDATE media.\"Assets\" SET \"ExternalTitle\" = '' WHERE \"Id\" = @id", squat.Id));
        Assert.AreEqual("CK_MediaAssets_ExternalTitle", violation.ConstraintName);
    }

    private static object B9Body(string name, string classification, string? typeName, uint? version = null, string[]? tags = null) => version is { } current
        ? new
        {
            name,
            instructions = (string?)null,
            equipment = "Bodyweight",
            movementPattern = "Other",
            classification,
            muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
            tags = tags ?? [],
            alternatives = Array.Empty<object>(),
            mediaAssetIds = Array.Empty<Guid>(),
            version = current,
            typeName,
        }
        : new
        {
            name,
            instructions = (string?)null,
            equipment = "Bodyweight",
            movementPattern = "Other",
            classification,
            muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
            tags = tags ?? [],
            alternatives = Array.Empty<object>(),
            mediaAssetIds = Array.Empty<Guid>(),
            typeName,
        };

    private static async Task<HttpResponseMessage> B9PostExerciseAsync(
        HttpClient coach,
        string name,
        string classification,
        string? typeName,
        string[]? tags = null)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync("/api/exercises/", B9Body(name, classification, typeName, tags: tags));
    }

    private static async Task<ExerciseView> B9ExerciseAsync(
        HttpClient coach,
        string name,
        string classification,
        string? typeName = null,
        string[]? tags = null)
    {
        var response = await B9PostExerciseAsync(coach, name, classification, typeName, tags);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ExerciseView>(response);
    }

    private static async Task B9ArchiveAsync(HttpClient coach, ExerciseView exercise)
    {
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/exercises/{exercise.Id}/archive", new { isArchived = true, version = exercise.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>The facets as lines: both counts, "tag n" per tag, and the own names.</summary>
    private static async Task<(int Active, int Archived, string Tags, string TypeNames)> B9FacetsAsync(HttpClient coach, string url)
    {
        var response = await coach.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        using var page = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var facets = page.RootElement.GetProperty("facets");
        return (
            facets.GetProperty("active").GetInt32(),
            facets.GetProperty("archived").GetInt32(),
            string.Join(", ", facets.GetProperty("tags").EnumerateArray()
                .Select(item => $"{item.GetProperty("tag").GetString()} {item.GetProperty("count").GetInt32()}")),
            string.Join(", ", facets.GetProperty("typeNames").EnumerateArray().Select(item => item.GetString())));
    }

    private async Task B9ExecuteAsync(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<string> B9ClassificationAsync(Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT \"Classification\" FROM exercise_library.\"Exercises\" WHERE \"Id\" = @id";
        command.Parameters.AddWithValue("id", id);
        return (string)(await command.ExecuteScalarAsync())!;
    }
}

/// <summary>
/// YouTube's and Vimeo's oEmbed answers for the tests (critique B9): a title per video id, which a test may
/// change, and each failure a provider can give. It records every address asked; every client the factory makes
/// shares it, and it holds nothing a disposal would end.
/// </summary>
internal sealed class OEmbedFake : HttpMessageHandler
{
    public const string NotFoundId = "NotFound001";
    public const string UnreachableId = "Unreach0001";
    public const string TimeoutId = "TimeOut0001";
    public const string NotJsonId = "NotJson0001";
    public const string NoTitleId = "NoTitle0001";
    public const string TooLongId = "TooLong0001";

    public ConcurrentDictionary<string, string> Titles { get; } = new(StringComparer.Ordinal);

    public ConcurrentQueue<string> Asked { get; } = new();

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var address = request.RequestUri!.AbsoluteUri;
        Asked.Enqueue(address);
        var page = Uri.UnescapeDataString(request.RequestUri.Query);
        var id = page.Contains("youtube.com/watch?v=", StringComparison.Ordinal)
            ? page[(page.IndexOf("watch?v=", StringComparison.Ordinal) + "watch?v=".Length)..]
            : page[(page.LastIndexOf('/') + 1)..];
        switch (id)
        {
            case UnreachableId:
                throw new HttpRequestException("No connection could be made (test).");
            case TimeoutId:
                throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout (test).");
            case NotJsonId:
                return Task.FromResult(Answer("<html>Sign in</html>", "text/html"));
            case NoTitleId:
                return Task.FromResult(Answer("{\"type\":\"video\",\"title\":42}"));
            case TooLongId:
                return Task.FromResult(Answer("{\"title\":\"" + new string('x', 70_000) + "\"}"));
        }

        return Task.FromResult(Titles.TryGetValue(id, out var title)
            ? Answer(JsonSerializer.Serialize(new { type = "video", title, provider_name = "Test" }))
            : new HttpResponseMessage(HttpStatusCode.NotFound) { RequestMessage = request });
    }


    private static HttpResponseMessage Answer(string body, string mediaType = "application/json") =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, mediaType) };
}
