using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R3.5c: a coach's saved replies (MSG-023) belong to that coach in that workspace and to nobody
/// else, the owner included; they keep the message rules for their text, change only from the version
/// read, and stop at a hundred even when two saves race.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R35cRepliesUrl = "/api/messaging/saved-replies";

    private static readonly string[] R35cTitleOrder =
        ["A warm welcome", "b: deload week", "Check-in reminder", "Évaluation"];

    /// <summary>Two writes racing for one place: one lands and the other is refused.</summary>
    private static readonly HttpStatusCode[] R35cOneWins = [HttpStatusCode.OK, HttpStatusCode.Conflict];

    [TestMethod]
    public async Task R35cACoachKeepsTheirOwnSavedRepliesAndNobodyElseReadsThem()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35c-owner@example.test", "Hicham Haddad", "R35c Replies");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "r35c-coach@example.test", "Lina Saad");
        using var client = CreateClient();
        await R31InviteAsync(coach, client, tenant, "r35c-client@example.test", "Maya", "Rahman");

        // Saved as the message rules keep text: the title on one line, the body plain and trimmed.
        var checkIn = await R35cCreateAsync(coach, "  Check-in\treminder  ", "  Hi! Your check-in is due today.\r\nIt takes 5 minutes.  ");
        Assert.AreEqual(("Check-in reminder", "Hi! Your check-in is due today.\nIt takes 5 minutes."), (checkIn.Title, checkIn.Body));
        await R35cCreateAsync(coach, "b: deload week", "Lighter this week, same sessions.");
        await R35cCreateAsync(coach, "A warm welcome", "Welcome aboard!");
        await R35cCreateAsync(coach, "Évaluation", "On refait le point dimanche.");

        // Listed by title, ignoring case and accents; the limit travels with the list.
        var list = await ReadSliceAsync<SavedReplyList>(coach, R35cRepliesUrl);
        CollectionAssert.AreEqual(R35cTitleOrder, list.Items.Select(item => item.Title).ToArray());
        Assert.AreEqual(SavedReplyText.MaximumPerOwner, list.Maximum);

        // A coach's wording is their own: the owner of the workspace neither lists nor touches it.
        Assert.IsEmpty((await ReadSliceAsync<SavedReplyList>(owner, R35cRepliesUrl)).Items);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/edit",
            new { title = "Mine now", body = "x", version = checkIn.Version }), HttpStatusCode.NotFound);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/delete",
            new { version = checkIn.Version }), HttpStatusCode.NotFound);

        // A client keeps no saved replies, and nobody signed out reaches any.
        await AssertStatusAsync(await client.GetAsync(R35cRepliesUrl), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync(R35cRepliesUrl, new { title = "Hi", body = "Hello" }),
            HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R35cRepliesUrl), HttpStatusCode.Unauthorized);

        // Another workspace's owner is refused this one and finds nothing of it in their own.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r35c-stranger@example.test", "Other Owner", "R35c Elsewhere");
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R35cRepliesUrl), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
        Assert.IsEmpty((await ReadSliceAsync<SavedReplyList>(stranger, R35cRepliesUrl)).Items);
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(await stranger.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/edit",
            new { title = "Mine now", body = "x", version = checkIn.Version }), HttpStatusCode.NotFound);

        // Text the message rules refuse is refused here, field by field.
        await R35cAssertInvalidAsync(coach, "   ", "Hello", "title");
        await R35cAssertInvalidAsync(coach, new string('t', SavedReplyText.MaximumTitleLength + 1), "Hello", "title");
        await R35cAssertInvalidAsync(coach, "Bell", "Ring\u0007", "body");
        await R35cAssertInvalidAsync(coach, "Long", new string('b', MessageContentPolicy.MaximumLength + 1), "body");
        await R35cAssertInvalidAsync(coach, "Empty", " \r\n ", "body");

        // A change is made from the version read; a second window holding the old one is told so.
        await RefreshCsrfAsync(coach);
        var edited = await RequiredJsonAsync<SavedReplyView>(await coach.PostAsJsonAsync(
            $"{R35cRepliesUrl}/{checkIn.Id}/edit",
            new { title = "Check-in due", body = "Your check-in is due today.", version = checkIn.Version }));
        Assert.AreEqual(("Check-in due", "Your check-in is due today."), (edited.Title, edited.Body));
        Assert.AreNotEqual(checkIn.Version, edited.Version);
        await RefreshCsrfAsync(coach);
        var stale = await coach.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/edit",
            new { title = "Old window", body = "x", version = checkIn.Version });
        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        StringAssert.Contains(await stale.Content.ReadAsStringAsync(), SavedReplyConflictCodes.StaleVersion);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/delete",
            new { version = checkIn.Version }), HttpStatusCode.Conflict);

        // Removed, it is gone; removing it again finds nothing.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/delete",
            new { version = edited.Version }), HttpStatusCode.NoContent);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"{R35cRepliesUrl}/{checkIn.Id}/delete",
            new { version = edited.Version }), HttpStatusCode.NotFound);
        Assert.HasCount(3, (await ReadSliceAsync<SavedReplyList>(coach, R35cRepliesUrl)).Items);

        // The database holds the same lines: no blank title, and no owner from outside the workspace.
        await AssertSqlStateAsync("23514", """
            INSERT INTO messaging."SavedReplies" ("Id", "TenantId", "OwnerUserId", "Title", "Body")
            VALUES (@id, @tenant, @owner, '   ', 'Body')
            """, ("id", Guid.NewGuid()), ("tenant", tenant), ("owner", coachUserId));
        await AssertSqlStateAsync("23503", """
            INSERT INTO messaging."SavedReplies" ("Id", "TenantId", "OwnerUserId", "Title", "Body")
            VALUES (@id, @tenant, @owner, 'Title', 'Body')
            """, ("id", Guid.NewGuid()), ("tenant", strangerTenant), ("owner", coachUserId));
    }

    [TestMethod]
    public async Task R35cAPersonKeepsAtMostAHundredSavedRepliesEvenWhenTwoSavesRace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35c-limit-owner@example.test", "Hicham Haddad", "R35c Limit");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "r35c-limit-coach@example.test", "Lina Saad");

        // Ninety-nine already kept.
        await Phase6ExecuteAsync("""
            INSERT INTO messaging."SavedReplies" ("Id", "TenantId", "OwnerUserId", "Title", "Body")
            SELECT gen_random_uuid(), @tenant, @owner, 'Reply ' || n, 'Text ' || n
            FROM generate_series(1, 99) AS n
            """, ("tenant", tenant), ("owner", coachUserId));

        // Two saves at once for the last place: exactly one is kept.
        await RefreshCsrfAsync(coach);
        var racing = await Task.WhenAll(
            coach.PostAsJsonAsync(R35cRepliesUrl, new { title = "First", body = "One" }),
            coach.PostAsJsonAsync(R35cRepliesUrl, new { title = "Second", body = "Two" }));
        CollectionAssert.AreEquivalent(
            R35cOneWins,
            racing.Select(response => response.StatusCode).ToArray());
        var refused = racing.Single(response => response.StatusCode == HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), SavedReplyConflictCodes.LimitReached);
        Assert.HasCount(SavedReplyText.MaximumPerOwner, (await ReadSliceAsync<SavedReplyList>(coach, R35cRepliesUrl)).Items);

        // The limit is per person: the owner still keeps their own.
        await R35cCreateAsync(owner, "Owner's own", "Mine");

        // Two edits from the same version: one lands, the other is told the reply moved on.
        var reply = (await ReadSliceAsync<SavedReplyList>(coach, R35cRepliesUrl)).Items[0];
        await RefreshCsrfAsync(coach);
        var edits = await Task.WhenAll(
            coach.PostAsJsonAsync($"{R35cRepliesUrl}/{reply.Id}/edit", new { title = "Left", body = "L", version = reply.Version }),
            coach.PostAsJsonAsync($"{R35cRepliesUrl}/{reply.Id}/edit", new { title = "Right", body = "R", version = reply.Version }));
        CollectionAssert.AreEquivalent(
            R35cOneWins,
            edits.Select(response => response.StatusCode).ToArray());
    }

    private static async Task<SavedReplyView> R35cCreateAsync(HttpClient caller, string title, string body)
    {
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsJsonAsync(R35cRepliesUrl, new { title, body });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<SavedReplyView>(response);
    }

    private static async Task R35cAssertInvalidAsync(HttpClient caller, string title, string body, string field)
    {
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsJsonAsync(R35cRepliesUrl, new { title, body });
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), $"\"{field}\"");
    }
}
