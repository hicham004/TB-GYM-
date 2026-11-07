using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The certificate record (notes plan N4a, CLI-021, ADR 0039), against PostgreSQL: only the platform admin reads or
/// writes it; a line is added only for active staff of the space, confirmed once, dropped only while it waits, taken
/// down only once confirmed and erased on request with its words gone and its dates kept; a stale or misplaced action
/// conflicts; the database refuses what the service refuses; a space reads its own lines alone; and neither a line's
/// words nor who confirmed it reach the log.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N4aCoachesUrl = "/api/platform-admin/coaches";

    private static readonly string[] N4aRouteNames =
    [
        "ListCertificateCoaches",
        "ListCoachCertificateLines",
        "AddCoachCertificateLine",
        "ConfirmCoachCertificateLine",
        "DropCoachCertificateLine",
        "TakeDownCoachCertificateLine",
        "EraseCoachCertificateLines",
    ];

    private static readonly string[] N4aRouteParameters = ["userId", "tenantId", "lineId"];

    [TestMethod]
    public async Task N4aOnlyThePlatformAdminReachesTheCertificateRecord()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-who-owner@example.test", "Karim Haddad", "N4a Who Gym");
        using var coach = CreateClient();
        var coachId = await JoinAsCoachAsync(owner, coach, "n4a-who-coach@example.test", "Lea Khoury");
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "n4a-who-client@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n4a-who-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);
        var line = await N4aAddedAsync(admin, coachId, spaceId, "NASM CPT, 2019", today);
        var routes = N4aEveryRoute(coachId, spaceId, line.Id, today, line.Version);
        CollectionAssert.AreEqual(N4aRouteNames, routes.Select(route => route.Name).ToArray());

        // Nobody signed in: 401 on every route, a token or not.
        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        foreach (var (name, call) in routes)
        {
            var answer = await call(anonymous);
            Assert.AreEqual(HttpStatusCode.Unauthorized, answer.StatusCode, $"{name}: {await answer.Content.ReadAsStringAsync()}");
        }

        // The space's owner, its coach (the line's own) and its client, each with their workspace header still set:
        // 403 on every route, their own lines included.
        foreach (var caller in new[] { owner, coach, client })
        {
            await RefreshCsrfAsync(caller);
            foreach (var (name, call) in routes)
            {
                var answer = await call(caller);
                Assert.AreEqual(HttpStatusCode.Forbidden, answer.StatusCode, $"{name}: {await answer.Content.ReadAsStringAsync()}");
            }
        }

        // The admin without the antiforgery header (the cookie kept): no write goes through.
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        foreach (var (name, call) in routes.Where(route => route.Name is not ("ListCertificateCoaches" or "ListCoachCertificateLines")))
        {
            Assert.AreEqual("antiforgery_token_invalid", (await A16aAnswerAsync(await call(admin), HttpStatusCode.BadRequest)).Code, name);
        }

        // Reads need no token, and nothing reached the line.
        var unchanged = (await N4aLinesAsync(admin, coachId, spaceId)).Lines.Single();
        Assert.AreEqual((line.Id, "Waiting", line.Version), (unchanged.Id, unchanged.State, unchanged.Version));
        Assert.AreEqual(1L, await N4aLineCountAsync(spaceId));

        // The role is read again on every request: revoked, the same session is refused at once.
        Assert.AreEqual(0, await RunPlatformAdminCommandAsync(new StringWriter(), "revoke", "n4a-who-admin@example.test"));
        var afterRevoke = await admin.GetAsync(N4aCoachesUrl);
        Assert.IsTrue(
            afterRevoke.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden,
            $"A revoked admin was answered {(int)afterRevoke.StatusCode}.");
    }

    [TestMethod]
    public void N4aEveryCertificateRouteIsThePlatformAdminsAndEveryWriteNamesTheSensitiveLimit()
    {
        var routes = A10bApiRoutes()
            .Where(route => route.RoutePattern.RawText!.StartsWith(N4aCoachesUrl, StringComparison.Ordinal))
            .ToArray();
        CollectionAssert.AreEquivalent(N4aRouteNames, routes.Select(A10bName).ToArray());

        foreach (var route in routes)
        {
            var name = A10bName(route);
            Assert.IsTrue(
                route.Metadata.GetOrderedMetadata<IAuthorizeData>().Any(data => data.Policy == AuthorizationPolicies.PlatformAdmin),
                $"{name} is not behind the PlatformAdmin policy.");
            Assert.IsNull(route.Metadata.GetMetadata<IAllowAnonymous>(), name);
            var isWrite = WriteRateLimiting.IsStateChanging(route.Metadata.GetMetadata<IHttpMethodMetadata>());
            Assert.AreEqual(isWrite ? RateLimitPolicies.SensitiveWrite : null, A10bPolicy(route), name);
            CollectionAssert.IsSubsetOf(route.RoutePattern.Parameters.Select(parameter => parameter.Name).ToArray(), N4aRouteParameters, name);
        }

        Assert.AreEqual(5, routes.Count(route => A10bPolicy(route) == RateLimitPolicies.SensitiveWrite));
    }

    [TestMethod]
    public async Task N4aALineIsAddedConfirmedTakenDownAndErasedWithItsAnswersAndTheDatabaseKeepsIt()
    {
        // Midday, so the minutes the clock moves on between steps never cross into another day.
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-flow-owner@example.test", "Karim Haddad", "N4a Flow Gym");
        using var coach = CreateClient();
        var coachId = await JoinAsCoachAsync(owner, coach, "n4a-flow-coach@example.test", "Lea Khoury");
        using var admin = await SignInPlatformAdminAsync("n4a-flow-admin@example.test");
        var adminId = await SignedInUserIdAsync(admin);
        var shownOn = today.AddDays(-4);
        await RefreshCsrfAsync(admin);

        // Before any line: the coach is listed once, active staff of the space, with nothing counted.
        var before = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual(
            ("Lea Khoury", "n4a-flow-coach@example.test", "N4a Flow Gym", "Coach", true),
            (before.Name, before.Email, before.SpaceName, before.Role, before.IsActiveStaff));
        Assert.AreEqual((0, 0, 0, 0), (before.WaitingLines, before.ConfirmedLines, before.TakenDownLines, before.ErasedLines));
        Assert.AreEqual("Owner", (await N4aRowAsync(admin, await SignedInUserIdAsync(owner), spaceId)).Role);
        var empty = await N4aLinesAsync(admin, coachId, spaceId);
        Assert.IsEmpty(empty.Lines);
        Assert.AreEqual((coachId, spaceId, "Lea Khoury", "Coach", true, today), (empty.UserId, empty.TenantId, empty.Name, empty.Role, empty.IsActiveStaff, empty.SpaceToday));

        // Added: a waiting line, its words tidied, its sentence written in the space's English.
        var added = await N4aAddAsync(admin, coachId, spaceId, "  NASM   CPT, 2019 ", shownOn);
        await AssertStatusAsync(added, HttpStatusCode.Created);
        Assert.AreEqual(N4aLinesUrl(coachId, spaceId), added.Headers.Location?.OriginalString);
        var first = await RequiredJsonAsync<N4aLine>(added);
        Assert.AreEqual("Waiting", first.State);
        Assert.AreEqual("NASM CPT, 2019", first.What);
        Assert.AreEqual(shownOn, first.ShownOn);
        Assert.AreEqual(N4aSentence("NASM CPT, 2019", shownOn, "en-LB"), first.Text);
        Assert.AreEqual(1, first.WordingVersion);
        Assert.AreEqual("Platform Admin", first.RecordedByName);
        Assert.AreEqual(RequiredTestClock.UtcNow, first.RecordedAtUtc);
        Assert.AreEqual(today, first.RecordedOn);
        Assert.IsTrue(first.CoachShows);
        Assert.IsNull(first.ConfirmedAtUtc);
        Assert.IsNull(first.ConfirmedOn);
        Assert.IsNull(first.ConfirmedByName);
        Assert.IsNull(first.TakenDownAtUtc);
        Assert.IsNull(first.TakenDownByName);
        Assert.IsNull(first.ErasedAtUtc);
        Assert.IsNull(first.ErasureReason);
        Assert.IsNull(first.RequestedOn);
        Assert.IsNull(first.ErasedByName);

        // The same words and day again answer the same line, and the table holds one row.
        var again = await N4aAddAsync(admin, coachId, spaceId, "NASM CPT, 2019", shownOn);
        await AssertStatusAsync(again, HttpStatusCode.OK);
        var sameLine = await RequiredJsonAsync<N4aLine>(again);
        Assert.AreEqual((first.Id, first.Version, "Waiting"), (sameLine.Id, sameLine.Version, sameLine.State));
        Assert.AreEqual(1L, await N4aLineCountAsync(spaceId));
        var listed = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual(("Coach", true, 1, 0, 0, 0), (listed.Role, listed.IsActiveStaff, listed.WaitingLines, listed.ConfirmedLines, listed.TakenDownLines, listed.ErasedLines));

        // Confirmed, by the person who confirmed it with the coach, their name tidied.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var confirmed = await N4aAnswerAsync(await N4aConfirmAsync(admin, coachId, spaceId, first.Id, "  Rami   Saade ", first.Version));
        Assert.AreEqual("Confirmed", confirmed.State);
        Assert.AreEqual("Rami Saade", confirmed.ConfirmedByName);
        Assert.AreEqual(RequiredTestClock.UtcNow, confirmed.ConfirmedAtUtc);
        Assert.AreEqual(today, confirmed.ConfirmedOn);
        Assert.AreEqual((first.Text, first.What, first.ShownOn), (confirmed.Text, confirmed.What, confirmed.ShownOn));
        Assert.AreNotEqual(first.Version, confirmed.Version);
        var confirmedRow = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual((0, 1, 0, 0), (confirmedRow.WaitingLines, confirmedRow.ConfirmedLines, confirmedRow.TakenDownLines, confirmedRow.ErasedLines));

        // The database refuses any change to a confirmed line's words, day, confirmation, coach or recorder, and its deletion.
        foreach (var change in new[]
        {
            """SET "What" = 'Changed'""",
            """SET "ConfirmedByName" = 'Someone else'""",
            """SET "ShownOn" = "ShownOn" - 1""",
            """SET "ConfirmedAtUtc" = "ConfirmedAtUtc" + interval '1 day'""",
            """SET "RecordedByUserId" = "CoachUserId" """,
            """SET "CoachUserId" = "RecordedByUserId" """,
        })
        {
            await AssertSqlStateAsync("55000", $"""UPDATE identity."CoachCertificateLines" {change} WHERE "Id" = @id""", ("id", first.Id));
        }

        await AssertSqlStateAsync("55000", """DELETE FROM identity."CoachCertificateLines" WHERE "Id" = @id""", ("id", first.Id));

        // The coach's own switch (N4b) is the one thing that may still change on it.
        await Phase6ExecuteAsync("""UPDATE identity."CoachCertificateLines" SET "CoachShows" = NOT "CoachShows" WHERE "Id" = @id""", ("id", first.Id));
        await Phase6ExecuteAsync("""UPDATE identity."CoachCertificateLines" SET "CoachShows" = NOT "CoachShows" WHERE "Id" = @id""", ("id", first.Id));
        var reread = await N4aLineAsync(admin, coachId, spaceId, first.Id);
        Assert.AreEqual(("Confirmed", "NASM CPT, 2019", "Rami Saade", true), (reread.State, reread.What, reread.ConfirmedByName, reread.CoachShows));

        // Taken down: its words and who confirmed it kept, with who took it down.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var takenDown = await N4aAnswerAsync(await N4aTakeDownAsync(admin, coachId, spaceId, first.Id, reread.Version));
        Assert.AreEqual("TakenDown", takenDown.State);
        Assert.AreEqual("Platform Admin", takenDown.TakenDownByName);
        Assert.AreEqual(RequiredTestClock.UtcNow, takenDown.TakenDownAtUtc);
        Assert.AreEqual(today, takenDown.TakenDownOn);
        Assert.AreEqual((first.Text, "Rami Saade", confirmed.ConfirmedAtUtc), (takenDown.Text, takenDown.ConfirmedByName, takenDown.ConfirmedAtUtc));

        // A second and a third line; the lines read newest first.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var second = await N4aAddedAsync(admin, coachId, spaceId, "Owns Iron Gym since 2015", shownOn);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var third = await N4aAddedAsync(admin, coachId, spaceId, "Coached for 8 years", today);
        CollectionAssert.AreEqual(
            new[] { third.Id, second.Id, first.Id },
            (await N4aLinesAsync(admin, coachId, spaceId)).Lines.Select(item => item.Id).ToArray(),
            "Newest first.");

        // The second, dropped while it waits: nothing about it is kept.
        var drop = await N4aDropAsync(admin, coachId, spaceId, second.Id, second.Version);
        await AssertStatusAsync(drop, HttpStatusCode.OK);
        Assert.AreEqual(new N4aDrop(second.Id), await RequiredJsonAsync<N4aDrop>(drop));
        Assert.AreEqual(0L, await N4aRowsWithIdAsync(second.Id));
        CollectionAssert.AreEqual(
            new[] { third.Id, first.Id },
            (await N4aLinesAsync(admin, coachId, spaceId)).Lines.Select(item => item.Id).ToArray());

        // A waiting line may go from the table too: the trigger lets an unconfirmed line be deleted.
        var fourth = await N4aAddedAsync(admin, coachId, spaceId, "BSc Physiotherapy, 2012", shownOn);
        await Phase6ExecuteAsync("""DELETE FROM identity."CoachCertificateLines" WHERE "Id" = @id""", ("id", fourth.Id));
        Assert.AreEqual(0L, await N4aRowsWithIdAsync(fourth.Id));
        var beforeErase = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual((1, 0, 1, 0), (beforeErase.WaitingLines, beforeErase.ConfirmedLines, beforeErase.TakenDownLines, beforeErase.ErasedLines));

        // Erased on the coach's request of today: the taken-down line erased, the waiting one dropped, counts only.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var erasedAt = RequiredTestClock.UtcNow;
        var erase = await N4aEraseAsync(admin, coachId, spaceId, today);
        await AssertStatusAsync(erase, HttpStatusCode.OK);
        Assert.AreEqual(new N4aErasure(1, 1), await RequiredJsonAsync<N4aErasure>(erase));
        Assert.AreEqual(0L, await N4aRowsWithIdAsync(third.Id));

        var erased = (await N4aLinesAsync(admin, coachId, spaceId)).Lines.Single();
        Assert.AreEqual((first.Id, "Erased"), (erased.Id, erased.State));
        Assert.IsNull(erased.Text);
        Assert.IsNull(erased.What);
        Assert.IsNull(erased.ShownOn);
        Assert.IsNull(erased.ConfirmedByName);
        Assert.AreEqual("Request", erased.ErasureReason);
        Assert.AreEqual(today, erased.RequestedOn);
        Assert.AreEqual("Platform Admin", erased.ErasedByName);
        Assert.AreEqual(erasedAt, erased.ErasedAtUtc);
        Assert.AreEqual(today, erased.ErasedOn);
        Assert.AreEqual(confirmed.ConfirmedAtUtc, erased.ConfirmedAtUtc, "The confirmation's date is kept.");
        Assert.AreEqual(today, erased.ConfirmedOn);
        Assert.AreEqual((takenDown.TakenDownAtUtc, "Platform Admin"), (erased.TakenDownAtUtc, erased.TakenDownByName));
        Assert.AreEqual((first.RecordedAtUtc, "Platform Admin"), (erased.RecordedAtUtc, erased.RecordedByName));
        Assert.AreEqual((1, true), (erased.WordingVersion, erased.CoachShows));
        var erasedRow = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual((true, 0, 0, 0, 1), (erasedRow.IsActiveStaff, erasedRow.WaitingLines, erasedRow.ConfirmedLines, erasedRow.TakenDownLines, erasedRow.ErasedLines));

        // A second request finds nothing left to erase.
        var nothingLeft = await N4aEraseAsync(admin, coachId, spaceId, today);
        await AssertStatusAsync(nothingLeft, HttpStatusCode.OK);
        Assert.AreEqual(new N4aErasure(0, 0), await RequiredJsonAsync<N4aErasure>(nothingLeft));

        // The row read straight from the table: the words and the confirmer gone, the dates and who acted kept.
        var stored = await N4aStoredLineAsync(first.Id);
        Assert.AreEqual(string.Empty, stored.What);
        Assert.IsNull(stored.ShownOn);
        Assert.AreEqual(string.Empty, stored.ConfirmedByName);
        Assert.AreEqual(confirmed.ConfirmedAtUtc, stored.ConfirmedAtUtc);
        Assert.AreEqual(adminId, stored.RecordedByUserId);
        Assert.AreEqual(adminId, stored.ErasedByUserId);
        Assert.AreEqual("Request", stored.ErasureReason);
        Assert.AreEqual(today, stored.RequestedOn);
        Assert.AreEqual(erasedAt, stored.ErasedAtUtc);
        Assert.AreEqual((takenDown.TakenDownAtUtc, (Guid?)adminId), (stored.TakenDownAtUtc, stored.TakenDownByUserId));
        Assert.AreEqual((coachId, spaceId, true), (stored.CoachUserId, stored.TenantId, stored.CoachShows));

        // And nothing changes it any more, the coach's switch included; it is never deleted.
        foreach (var change in new[]
        {
            """SET "CoachShows" = NOT "CoachShows" """,
            """SET "What" = 'NASM CPT, 2019', "ShownOn" = DATE '2026-11-03'""",
            """SET "ErasedAtUtc" = NULL, "ErasedByUserId" = NULL, "ErasureReason" = NULL, "RequestedOn" = NULL""",
            """SET "RequestedOn" = "RequestedOn" - 1""",
        })
        {
            await AssertSqlStateAsync("55000", $"""UPDATE identity."CoachCertificateLines" {change} WHERE "Id" = @id""", ("id", first.Id));
        }

        await AssertSqlStateAsync("55000", """DELETE FROM identity."CoachCertificateLines" WHERE "Id" = @id""", ("id", first.Id));
        Assert.AreEqual(1L, await N4aLineCountAsync(spaceId));
    }

    [TestMethod]
    public async Task N4aEachRefusalNamesItsFieldAndNeverRepeatsTheWords()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-refuse-owner@example.test", "Karim Haddad", "N4a Refusal Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-refuse-admin@example.test");
        var today = Phase6WorkspaceToday();
        var url = N4aLinesUrl(ownerId, spaceId);
        await RefreshCsrfAsync(admin);

        // The words: missing, too long, on two lines.
        Assert.AreEqual(CoachCertificateText.WhatRequired, await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, "", today), "what"));
        Assert.AreEqual(CoachCertificateText.WhatRequired, await N4aRefusalAsync(await admin.PostAsJsonAsync(url, new { shownOn = today }), "what"));
        Assert.AreEqual("Use 120 characters or fewer.", await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, new string('a', 121), today), "what"));
        Assert.AreEqual(CoachCertificateText.OneLine, await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, "NASM CPT\n2019", today), "what"));

        // A reserved word or a protected title: the one sentence, which never repeats what it found.
        foreach (var (what, words) in new (string, string[])[]
        {
            ("Verified trainer", new[] { "Verified" }),
            ("Licensed physio", new[] { "Licensed", "physio" }),
            ("QUALIFIED coach, 2019", new[] { "QUALIFIED" }),
            ("Physical  therapist, AUB", new[] { "Physical", "therapist" }),
            ("Approved by the federation", new[] { "Approved" }),
        })
        {
            var refused = await N4aAddAsync(admin, ownerId, spaceId, what, today);
            var body = await refused.Content.ReadAsStringAsync();
            Assert.AreEqual(CoachCertificateText.WhatRefused, await N4aRefusalAsync(refused, "what"), what);
            foreach (var word in words)
            {
                Assert.DoesNotContain(word, body, StringComparison.OrdinalIgnoreCase, what);
            }
        }

        // The day: missing, after the space's today, before 2000; with the words wrong too, both named.
        Assert.AreEqual(CoachCertificateText.ShownOnRequired, await N4aRefusalAsync(await admin.PostAsJsonAsync(url, new { what = "NASM CPT, 2019" }), "shownOn"));
        Assert.AreEqual(CoachCertificateText.DayAfterToday, await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, "NASM CPT, 2019", today.AddDays(1)), "shownOn"));
        Assert.AreEqual(CoachCertificateText.DayTooEarly, await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, "NASM CPT, 2019", new DateOnly(1999, 12, 31)), "shownOn"));
        await N4aAssertInvalidAsync(await admin.PostAsJsonAsync(url, new { what = " " }), "what", "shownOn");
        Assert.AreEqual(0L, await N4aLineCountAsync(spaceId), "No refusal stored anything.");

        // Confirm, drop and take down need the version the page read, and a confirm the name of who confirmed it.
        var line = await N4aAddedAsync(admin, ownerId, spaceId, "NASM CPT, 2019", today);
        Assert.AreEqual(
            CoachCertificateText.VersionRequired,
            await N4aRefusalAsync(await admin.PostAsJsonAsync(N4aLineUrl(ownerId, spaceId, line.Id, "confirm"), new { confirmedByName = "Rami Saade" }), "version"));
        Assert.AreEqual(
            CoachCertificateText.ConfirmedByNameRequired,
            await N4aRefusalAsync(await N4aConfirmAsync(admin, ownerId, spaceId, line.Id, "  ", line.Version), "confirmedByName"));
        Assert.AreEqual(
            "Use 80 characters or fewer.",
            await N4aRefusalAsync(await N4aConfirmAsync(admin, ownerId, spaceId, line.Id, new string('n', 81), line.Version), "confirmedByName"));
        await N4aAssertInvalidAsync(await admin.PostAsJsonAsync(N4aLineUrl(ownerId, spaceId, line.Id, "confirm"), new { }), "confirmedByName", "version");
        Assert.AreEqual(
            CoachCertificateText.VersionRequired,
            await N4aRefusalAsync(await admin.PostAsJsonAsync(N4aLineUrl(ownerId, spaceId, line.Id, "drop"), new { }), "version"));
        Assert.AreEqual(
            CoachCertificateText.VersionRequired,
            await N4aRefusalAsync(await admin.PostAsJsonAsync(N4aLineUrl(ownerId, spaceId, line.Id, "take-down"), new { version = (uint?)null }), "version"));

        // An erasure needs the day the coach asked: today or earlier, from 2000.
        Assert.AreEqual(CoachCertificateText.RequestedOnRequired, await N4aRefusalAsync(await admin.PostAsJsonAsync(N4aEraseUrl(ownerId, spaceId), new { }), "requestedOn"));
        Assert.AreEqual(CoachCertificateText.DayAfterToday, await N4aRefusalAsync(await N4aEraseAsync(admin, ownerId, spaceId, today.AddDays(1)), "requestedOn"));
        Assert.AreEqual(CoachCertificateText.DayTooEarly, await N4aRefusalAsync(await N4aEraseAsync(admin, ownerId, spaceId, new DateOnly(1999, 12, 31)), "requestedOn"));

        // Nothing moved: the line still waits as it was added.
        var unchanged = (await N4aLinesAsync(admin, ownerId, spaceId)).Lines.Single();
        Assert.AreEqual((line.Id, "Waiting", line.Version, "NASM CPT, 2019"), (unchanged.Id, unchanged.State, unchanged.Version, unchanged.What));
    }

    [TestMethod]
    public async Task N4aTheLatestDayALineOrARequestMayNameIsTodayInTheSpacesZone()
    {
        // 00:30 in Beirut: the space's day has begun while the UTC day is still yesterday.
        var today = Phase6WorkspaceToday();
        B4aSetWorkspaceClock(today, new TimeOnly(0, 30));
        Assert.AreEqual(today.AddDays(-1), B4aUtcDay());
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-zone-owner@example.test", "Karim Haddad", "N4a Zone Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-zone-admin@example.test");
        await RefreshCsrfAsync(admin);

        var line = await N4aAddedAsync(admin, ownerId, spaceId, "Owns Iron Gym", today);
        Assert.AreEqual(((DateOnly?)today, today), (line.ShownOn, line.RecordedOn));
        Assert.AreEqual(today, (await N4aLinesAsync(admin, ownerId, spaceId)).SpaceToday);
        Assert.AreEqual(
            CoachCertificateText.DayAfterToday,
            await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, "Owns Iron Gym", today.AddDays(1)), "shownOn"));

        var confirmed = await N4aAnswerAsync(await N4aConfirmAsync(admin, ownerId, spaceId, line.Id, "Rami Saade", line.Version));
        Assert.AreEqual(today, confirmed.ConfirmedOn, "Confirmed on the space's day, not UTC's.");
        Assert.AreEqual(
            CoachCertificateText.DayAfterToday,
            await N4aRefusalAsync(await N4aEraseAsync(admin, ownerId, spaceId, today.AddDays(1)), "requestedOn"));
        var erase = await N4aEraseAsync(admin, ownerId, spaceId, today);
        await AssertStatusAsync(erase, HttpStatusCode.OK);
        Assert.AreEqual(new N4aErasure(1, 0), await RequiredJsonAsync<N4aErasure>(erase));
        var erased = (await N4aLinesAsync(admin, ownerId, spaceId)).Lines.Single();
        Assert.AreEqual(((DateOnly?)today, (DateOnly?)today), (erased.RequestedOn, erased.ErasedOn));
    }

    [TestMethod]
    public async Task N4aAStaleVersionOrAnActionTheLineIsPastConflicts()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-conflict-owner@example.test", "Karim Haddad", "N4a Conflict Gym");
        using var coach = CreateClient();
        var coachId = await JoinAsCoachAsync(owner, coach, "n4a-conflict-coach@example.test", "Lea Khoury");
        using var admin = await SignInPlatformAdminAsync("n4a-conflict-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);
        var line = await N4aAddedAsync(admin, coachId, spaceId, "NASM CPT, 2019", today);
        var other = await N4aAddedAsync(admin, coachId, spaceId, "Owns Iron Gym", today);

        // A version the page never read: changed, whatever the action, and the line still waits.
        var unread = unchecked(other.Version + 1);
        await N4aAssertConflictAsync(await N4aConfirmAsync(admin, coachId, spaceId, other.Id, "Rami Saade", unread), CoachCertificateText.ChangedCode, CoachCertificateText.Changed);
        await N4aAssertConflictAsync(await N4aDropAsync(admin, coachId, spaceId, other.Id, unread), CoachCertificateText.ChangedCode, CoachCertificateText.Changed);
        await N4aAssertConflictAsync(await N4aTakeDownAsync(admin, coachId, spaceId, other.Id, unread), CoachCertificateText.ChangedCode, CoachCertificateText.Changed);
        Assert.AreEqual(("Waiting", other.Version), N4aStateAndVersion(await N4aLineAsync(admin, coachId, spaceId, other.Id)));

        // A waiting line is not taken down.
        await N4aAssertConflictAsync(
            await N4aTakeDownAsync(admin, coachId, spaceId, line.Id, line.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.TakeDownNotConfirmed);

        // Confirmed: the version before it is stale, and with the current one the line is past waiting.
        var confirmed = await N4aAnswerAsync(await N4aConfirmAsync(admin, coachId, spaceId, line.Id, "Rami Saade", line.Version));
        await N4aAssertConflictAsync(
            await N4aConfirmAsync(admin, coachId, spaceId, line.Id, "Someone Else", line.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);
        await N4aAssertConflictAsync(
            await N4aConfirmAsync(admin, coachId, spaceId, line.Id, "Someone Else", confirmed.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.ConfirmNotWaiting);

        // A confirmed line is never dropped: it stays, confirmed by whoever confirmed it.
        await N4aAssertConflictAsync(
            await N4aDropAsync(admin, coachId, spaceId, line.Id, confirmed.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.DropNotWaiting);
        await N4aAssertConflictAsync(
            await N4aDropAsync(admin, coachId, spaceId, line.Id, line.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);
        var kept = await N4aLineAsync(admin, coachId, spaceId, line.Id);
        Assert.AreEqual(("Confirmed", confirmed.Version, "Rami Saade"), (kept.State, kept.Version, kept.ConfirmedByName));

        // Taken down once; a second time conflicts, with the current version or the one before.
        var takenDown = await N4aAnswerAsync(await N4aTakeDownAsync(admin, coachId, spaceId, line.Id, confirmed.Version));
        Assert.AreEqual("TakenDown", takenDown.State);
        await N4aAssertConflictAsync(
            await N4aTakeDownAsync(admin, coachId, spaceId, line.Id, takenDown.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.TakeDownNotConfirmed);
        await N4aAssertConflictAsync(
            await N4aTakeDownAsync(admin, coachId, spaceId, line.Id, confirmed.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);
        await N4aAssertConflictAsync(
            await N4aConfirmAsync(admin, coachId, spaceId, line.Id, "Someone Else", takenDown.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.ConfirmNotWaiting);
        await N4aAssertConflictAsync(
            await N4aDropAsync(admin, coachId, spaceId, line.Id, takenDown.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.DropNotWaiting);

        // Erased (the other line dropped with it): no action fits it any more.
        var erase = await N4aEraseAsync(admin, coachId, spaceId, today);
        Assert.AreEqual(new N4aErasure(1, 1), await RequiredJsonAsync<N4aErasure>(erase));
        var erased = await N4aLineAsync(admin, coachId, spaceId, line.Id);
        Assert.AreEqual("Erased", erased.State);
        await N4aAssertConflictAsync(
            await N4aConfirmAsync(admin, coachId, spaceId, line.Id, "Someone Else", erased.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.ConfirmNotWaiting);
        await N4aAssertConflictAsync(
            await N4aDropAsync(admin, coachId, spaceId, line.Id, erased.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.DropNotWaiting);
        await N4aAssertConflictAsync(
            await N4aTakeDownAsync(admin, coachId, spaceId, line.Id, erased.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.TakeDownNotConfirmed);
        Assert.AreEqual(1L, await N4aLineCountAsync(spaceId));
    }

    [TestMethod]
    public async Task N4aALineIsOnlyForActiveStaffAndOnlyReachedUnderItsOwnCoachAndSpace()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-found-owner@example.test", "Karim Haddad", "N4a Found Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4a-found-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n4a-found-omar@example.test", "Omar Nassar");
        using var departed = CreateClient();
        var departedId = await JoinAsCoachAsync(owner, departed, "n4a-found-departed@example.test", "Nadim Fares");
        await RemoveCoachForBillingAsync(owner, departedId);
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "n4a-found-client@example.test", true);
        var clientId = await SignedInUserIdAsync(client);
        using var otherOwner = CreateClient();
        var otherSpaceId = await RegisterCoachAsync(otherOwner, "n4a-found-other@example.test", "Rana Aoun", "N4a Other Gym");
        var otherOwnerId = await SignedInUserIdAsync(otherOwner);
        using var otherCoach = CreateClient();
        var otherCoachId = await JoinAsCoachAsync(otherOwner, otherCoach, "n4a-found-other-coach@example.test", "Hadi Saleh");
        using var admin = await SignInPlatformAdminAsync("n4a-found-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);

        // No line for anyone who is not active staff of the space, nor in a space that is not there.
        foreach (var (userId, tenantId, who) in new[]
        {
            (clientId, spaceId, "a client of the space"),
            (otherCoachId, spaceId, "a coach of another space"),
            (otherOwnerId, spaceId, "another space's owner"),
            (departedId, spaceId, "a removed coach"),
            (leaId, Guid.NewGuid(), "an unknown space"),
            (Guid.NewGuid(), spaceId, "an unknown person"),
            (leaId, otherSpaceId, "a coach under a space they are not in"),
        })
        {
            var answer = await N4aAddAsync(admin, userId, tenantId, "NASM CPT, 2019", today);
            Assert.AreEqual(HttpStatusCode.NotFound, answer.StatusCode, $"{who}: {await answer.Content.ReadAsStringAsync()}");
        }

        Assert.AreEqual(0L, await N4aLineCountAsync(spaceId) + await N4aLineCountAsync(otherSpaceId));

        // The owner is staff too; a removed coach with no line is not on the list.
        var ownersLine = await N4aAddedAsync(admin, ownerId, spaceId, "Owns N4a Found Gym since 2018", today);
        var ownersLines = await N4aLinesAsync(admin, ownerId, spaceId);
        Assert.AreEqual(("Owner", true, ownersLine.Id), (ownersLines.Role, ownersLines.IsActiveStaff, ownersLines.Lines.Single().Id));
        var leasLine = await N4aAddedAsync(admin, leaId, spaceId, "NASM CPT, 2019", today);
        var list = await N4aCoachesAsync(admin);
        Assert.IsFalse(list.Any(row => row.UserId == departedId), "A departed coach with no line is not listed.");
        Assert.IsFalse(list.Any(row => row.UserId == clientId), "A client is never listed.");
        Assert.IsTrue(list.Any(row => row.UserId == omarId && row.TenantId == spaceId && row.WaitingLines == 0));

        // Lines are read for a member of the space who is staff or holds one, and for nobody else.
        foreach (var (userId, tenantId, who) in new[]
        {
            (otherCoachId, spaceId, "a coach of another space"),
            (otherOwnerId, spaceId, "another space's owner"),
            (clientId, spaceId, "a client of the space"),
            (leaId, otherSpaceId, "a coach under a space they are not in"),
            (Guid.NewGuid(), spaceId, "an unknown person"),
            (leaId, Guid.NewGuid(), "an unknown space"),
        })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await admin.GetAsync(N4aLinesUrl(userId, tenantId))).StatusCode, who);
        }

        var departedLines = await N4aLinesAsync(admin, departedId, spaceId);
        Assert.AreEqual((false, 0), (departedLines.IsActiveStaff, departedLines.Lines.Length), "A departed coach's page reads, empty.");

        // Lea's line, reached under another person's name, under another space, or by an id that is no line of
        // hers there: not found, whatever the action.
        var dropped = await N4aAddedAsync(admin, leaId, spaceId, "Owns Iron Gym", today);
        await AssertStatusAsync(await N4aDropAsync(admin, leaId, spaceId, dropped.Id, dropped.Version), HttpStatusCode.OK);
        foreach (var (userId, tenantId, lineId, who) in new[]
        {
            (omarId, spaceId, leasLine.Id, "under another coach of the space"),
            (ownerId, spaceId, leasLine.Id, "under the space's owner"),
            (leaId, otherSpaceId, leasLine.Id, "under another space"),
            (leaId, spaceId, ownersLine.Id, "the owner's line under Lea's name"),
            (leaId, spaceId, Guid.NewGuid(), "an id that is no line"),
            (leaId, spaceId, dropped.Id, "a line that was dropped"),
        })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await N4aConfirmAsync(admin, userId, tenantId, lineId, "Rami Saade", leasLine.Version)).StatusCode, $"Confirm {who}");
            Assert.AreEqual(HttpStatusCode.NotFound, (await N4aDropAsync(admin, userId, tenantId, lineId, leasLine.Version)).StatusCode, $"Drop {who}");
            Assert.AreEqual(HttpStatusCode.NotFound, (await N4aTakeDownAsync(admin, userId, tenantId, lineId, leasLine.Version)).StatusCode, $"Take down {who}");
        }

        // An erasure is for the same people the lines are read for.
        foreach (var (userId, tenantId, who) in new[]
        {
            (clientId, spaceId, "a client of the space"),
            (otherCoachId, spaceId, "a coach of another space"),
            (otherOwnerId, spaceId, "another space's owner"),
            (leaId, Guid.NewGuid(), "an unknown space"),
            (Guid.NewGuid(), spaceId, "an unknown person"),
        })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await N4aEraseAsync(admin, userId, tenantId, today)).StatusCode, who);
        }

        // Nothing moved.
        Assert.AreEqual(("Waiting", leasLine.Version), N4aStateAndVersion(await N4aLineAsync(admin, leaId, spaceId, leasLine.Id)));
        Assert.AreEqual(("Waiting", ownersLine.Version), N4aStateAndVersion(await N4aLineAsync(admin, ownerId, spaceId, ownersLine.Id)));
        Assert.AreEqual(2L, await N4aLineCountAsync(spaceId));
        Assert.AreEqual(0L, await N4aLineCountAsync(otherSpaceId));
    }

    [TestMethod]
    public async Task N4aACoachInTwoSpacesHasTheLineInOneAndTheOtherReadsNothing()
    {
        using var ownerA = CreateClient();
        var spaceA = await RegisterCoachAsync(ownerA, "n4a-two-owner-a@example.test", "Karim Haddad", "N4a Two A");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(ownerA, lea, "n4a-two-lea@example.test", "Lea Khoury");
        using var ownerB = CreateClient();
        var spaceB = await RegisterCoachAsync(ownerB, "n4a-two-owner-b@example.test", "Rana Aoun", "N4a Two B");
        await B4bJoinSignedInAsCoachAsync(ownerB, lea, spaceB, "n4a-two-lea@example.test", "Lea");
        using var admin = await SignInPlatformAdminAsync("n4a-two-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);

        var line = await N4aAddedAsync(admin, leaId, spaceA, "NASM CPT, 2019", today);

        // B's page for Lea holds nothing; the list has a row per membership, each counted apart.
        var inB = await N4aLinesAsync(admin, leaId, spaceB);
        Assert.IsEmpty(inB.Lines);
        Assert.AreEqual(("N4a Two B", "Coach", true), (inB.SpaceName, inB.Role, inB.IsActiveStaff));
        var rows = (await N4aCoachesAsync(admin)).Where(row => row.UserId == leaId).OrderBy(row => row.SpaceName, StringComparer.Ordinal).ToArray();
        Assert.HasCount(2, rows);
        Assert.AreEqual((spaceA, "N4a Two A", 1), (rows[0].TenantId, rows[0].SpaceName, rows[0].WaitingLines));
        Assert.AreEqual((spaceB, "N4a Two B", 0), (rows[1].TenantId, rows[1].SpaceName, rows[1].WaitingLines));

        // A's line is not reached under B, although Lea coaches there; B's erasure leaves it.
        Assert.AreEqual(HttpStatusCode.NotFound, (await N4aConfirmAsync(admin, leaId, spaceB, line.Id, "Rami Saade", line.Version)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N4aDropAsync(admin, leaId, spaceB, line.Id, line.Version)).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await N4aTakeDownAsync(admin, leaId, spaceB, line.Id, line.Version)).StatusCode);
        var eraseInB = await N4aEraseAsync(admin, leaId, spaceB, today);
        await AssertStatusAsync(eraseInB, HttpStatusCode.OK);
        Assert.AreEqual(new N4aErasure(0, 0), await RequiredJsonAsync<N4aErasure>(eraseInB));
        Assert.AreEqual(("Waiting", line.Version), N4aStateAndVersion(await N4aLineAsync(admin, leaId, spaceA, line.Id)));

        // Inside a space the filtered set reads that space's lines alone, and with no space set it reads none.
        Assert.AreEqual(1, await N4aCountInScopeAsync(spaceA));
        Assert.AreEqual(0, await N4aCountInScopeAsync(spaceB));
        Assert.AreEqual(0, await N4aCountInScopeAsync(null));

        // A scope holds one space, and a write outside the space it holds is refused before it reaches the table.
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var tenant = scope.ServiceProvider.GetRequiredService<IMutableTenantContext>();
            tenant.SetTenant(spaceB);
            Assert.ThrowsExactly<InvalidOperationException>(() => tenant.SetTenant(spaceA), "One space per scope.");
            var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            Assert.AreEqual(
                1,
                await context.CoachCertificateLines.IgnoreQueryFilters().CountAsync(item => item.CoachUserId == leaId, TestContext.CancellationTokenSource.Token),
                "The row is there; only the filter hides it.");
            context.CoachCertificateLines.Add(CoachCertificateLine.Add(spaceA, leaId, "Written from B", today, today, leaId));
            var refused = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => context.SaveChangesAsync(TestContext.CancellationTokenSource.Token));
            Assert.AreEqual("A tenant-owned record cannot be written outside the active tenant scope.", refused.Message);
        }

        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            context.CoachCertificateLines.Add(CoachCertificateLine.Add(spaceA, leaId, "Written from no space", today, today, leaId));
            var refused = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => context.SaveChangesAsync(TestContext.CancellationTokenSource.Token));
            Assert.AreEqual("A tenant-owned record cannot be written outside the active tenant scope.", refused.Message);
        }

        Assert.AreEqual(1L, await N4aLineCountAsync(spaceA));
        Assert.AreEqual(0L, await N4aLineCountAsync(spaceB));
    }

    [TestMethod]
    public async Task N4aNeitherALinesWordsNorWhoConfirmedItReachTheLog()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-log-owner@example.test", "Karim Haddad", "N4a Log Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-log-admin@example.test");
        var today = Phase6WorkspaceToday();
        var wordsMarker = Guid.NewGuid().ToString("N");
        var nameMarker = Guid.NewGuid().ToString("N");
        var what = $"Marker{wordsMarker} CPT";
        var name = $"Confirmer{nameMarker}";
        await RefreshCsrfAsync(admin);

        var line = await N4aAddedAsync(admin, ownerId, spaceId, what, today);
        await AssertStatusAsync(await N4aAddAsync(admin, ownerId, spaceId, what, today), HttpStatusCode.OK);
        Assert.AreEqual(CoachCertificateText.WhatRefused, await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, $"{what} Approved", today), "what"));
        Assert.AreEqual(CoachCertificateText.OneLine, await N4aRefusalAsync(await N4aAddAsync(admin, ownerId, spaceId, $"{what}\nsecond line", today), "what"));
        var confirmed = await N4aAnswerAsync(await N4aConfirmAsync(admin, ownerId, spaceId, line.Id, name, line.Version));
        Assert.AreEqual(name, confirmed.ConfirmedByName);
        await N4aAssertConflictAsync(
            await N4aConfirmAsync(admin, ownerId, spaceId, line.Id, name, line.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);
        var takenDown = await N4aAnswerAsync(await N4aTakeDownAsync(admin, ownerId, spaceId, line.Id, confirmed.Version));
        Assert.AreEqual(what, (await N4aLineAsync(admin, ownerId, spaceId, takenDown.Id)).What);
        await N4aCoachesAsync(admin);
        var erase = await N4aEraseAsync(admin, ownerId, spaceId, today);
        Assert.AreEqual(new N4aErasure(1, 0), await RequiredJsonAsync<N4aErasure>(erase));

        // Every line logged, with the exception any of them carried: an exception's text is a log line too.
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("/api/platform-admin/coaches/", log, "The requests were logged, so the markers' absence means something.");
        Assert.DoesNotContain(wordsMarker, log, StringComparison.OrdinalIgnoreCase, "A line's words reached the log.");
        Assert.DoesNotContain(nameMarker, log, StringComparison.OrdinalIgnoreCase, "Who confirmed a line reached the log.");
    }

    [TestMethod]
    public async Task N4aADepartedCoachKeepsTheirRowSoTheirLineCanBeTakenDownAndErased()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-gone-owner@example.test", "Karim Haddad", "N4a Gone Gym");
        using var coach = CreateClient();
        var coachId = await JoinAsCoachAsync(owner, coach, "n4a-gone-coach@example.test", "Lea Khoury");
        using var admin = await SignInPlatformAdminAsync("n4a-gone-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);
        var line = await N4aAddedAsync(admin, coachId, spaceId, "NASM CPT, 2019", today);
        var confirmed = await N4aAnswerAsync(await N4aConfirmAsync(admin, coachId, spaceId, line.Id, "Rami Saade", line.Version));

        await RemoveCoachForBillingAsync(owner, coachId);

        // Still listed, as no longer staff, the confirmed line counted.
        var row = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual(
            ("Lea Khoury", "Coach", false, 0, 1, 0, 0),
            (row.Name, row.Role, row.IsActiveStaff, row.WaitingLines, row.ConfirmedLines, row.TakenDownLines, row.ErasedLines));
        var lines = await N4aLinesAsync(admin, coachId, spaceId);
        Assert.AreEqual((false, line.Id), (lines.IsActiveStaff, lines.Lines.Single().Id));

        // No new line for them, but their line is still taken down and erased on their request.
        var refused = await N4aAddAsync(admin, coachId, spaceId, "Owns Iron Gym", today);
        await AssertStatusAsync(refused, HttpStatusCode.NotFound);
        var takenDown = await N4aAnswerAsync(await N4aTakeDownAsync(admin, coachId, spaceId, line.Id, confirmed.Version));
        Assert.AreEqual("TakenDown", takenDown.State);
        var erase = await N4aEraseAsync(admin, coachId, spaceId, today);
        await AssertStatusAsync(erase, HttpStatusCode.OK);
        Assert.AreEqual(new N4aErasure(1, 0), await RequiredJsonAsync<N4aErasure>(erase));

        // Erased, their row stays on the list as the record of it.
        var afterwards = await N4aRowAsync(admin, coachId, spaceId);
        Assert.AreEqual(
            (false, 0, 0, 0, 1),
            (afterwards.IsActiveStaff, afterwards.WaitingLines, afterwards.ConfirmedLines, afterwards.TakenDownLines, afterwards.ErasedLines));
        Assert.AreEqual(1L, await N4aLineCountAsync(spaceId));
    }

    [TestMethod]
    public async Task N4aTwoIdenticalAddsAtOnceStoreOneLine()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-race-owner@example.test", "Karim Haddad", "N4a Race Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-race-admin@example.test");
        var today = Phase6WorkspaceToday();
        var marker = Guid.NewGuid().ToString("N");
        var what = $"Race{marker} CPT";

        // A double press. The token is refreshed once, before the race; the barrier holds both requests at the
        // membership row's lock until both are past their checks, so the lock is what decides: the second waits
        // for the first to commit, then finds its line.
        await RefreshCsrfAsync(admin);
        RequiredInsertBarrier.Arm("/* certificate-add */", 2, "SELECT 1 FROM tenancy");
        HttpResponseMessage[] answers;
        try
        {
            answers = await Task.WhenAll(
                N4aAddAsync(admin, ownerId, spaceId, what, today),
                N4aAddAsync(admin, ownerId, spaceId, what, today));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two adds never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.Created, HttpStatusCode.OK },
            answers.Select(answer => answer.StatusCode).ToArray(),
            await N4aBodiesAsync(answers));
        var lines = await Task.WhenAll(answers.Select(RequiredJsonAsync<N4aLine>));
        Assert.AreEqual(lines[0].Id, lines[1].Id, "Both answer the one line.");
        Assert.AreEqual(1L, await N4aLineCountAsync(spaceId));
        Assert.AreEqual(lines[0].Id, (await N4aLinesAsync(admin, ownerId, spaceId)).Lines.Single().Id);

        // No insert was refused: the unique index's refusal is what PostgreSQL would write to its own log with the
        // words, past any redaction of the app's. Nothing of the words reached the app's log either.
        var log = RequiredEveryLogLine.Text;
        Assert.DoesNotContain("UX_CoachCertificateLines_OneLine", log, "The second add tripped the unique index.");
        Assert.DoesNotContain(marker, log, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task N4aTwoConfirmsOfOneLineAtOnceLeaveOneConfirmation()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-confirm-race-owner@example.test", "Karim Haddad", "N4a Confirm Race Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-confirm-race-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);
        var line = await N4aAddedAsync(admin, ownerId, spaceId, "NASM CPT, 2019", today);

        // Both held at their update, both past the version check: the row's version decides.
        RequiredInsertBarrier.Arm("UPDATE identity.\"CoachCertificateLines\"", 2, "UPDATE");
        HttpResponseMessage[] answers;
        try
        {
            answers = await Task.WhenAll(
                N4aConfirmAsync(admin, ownerId, spaceId, line.Id, "Rami Saade", line.Version),
                N4aConfirmAsync(admin, ownerId, spaceId, line.Id, "Nadim Fares", line.Version));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two confirms never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        Assert.AreEqual(1, answers.Count(answer => answer.StatusCode == HttpStatusCode.OK), await N4aBodiesAsync(answers));
        await N4aAssertConflictAsync(
            answers.Single(answer => answer.StatusCode != HttpStatusCode.OK),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);
        var winner = await RequiredJsonAsync<N4aLine>(answers.Single(answer => answer.StatusCode == HttpStatusCode.OK));
        var stored = await N4aLineAsync(admin, ownerId, spaceId, line.Id);
        Assert.AreEqual(("Confirmed", winner.ConfirmedByName, winner.Version), (stored.State, stored.ConfirmedByName, stored.Version));
    }

    [TestMethod]
    public async Task N4aALinesSentenceWritesTheDayInTheSpacesLanguage()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-arabic-owner@example.test", "Karim Haddad", "N4a Arabic Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-arabic-admin@example.test");
        var day = new DateOnly(2026, 11, 3);
        await RefreshCsrfAsync(admin);

        // Added while the space is in English.
        var english = await N4aAddedAsync(admin, ownerId, spaceId, "NASM CPT, 2019", day);
        Assert.AreEqual("NASM CPT, 2019, shown to TB Gym on 3 Nov 2026", english.Text);

        // The owner switches the space to Arabic: the day reads in Arabic from then on, in every line. Built from
        // CultureInfo, never pasted, since ICU's Arabic differs between machines (and the raw JSON escapes it).
        await AssertStatusAsync(await A16bSetLanguageAsync(owner, "ar-lb"), HttpStatusCode.OK);
        var arabicDay = day.ToString("d MMM yyyy", CultureInfo.GetCultureInfo("ar-LB"));
        Assert.DoesNotContain("Nov", arabicDay);
        var added = await N4aAddedAsync(admin, ownerId, spaceId, "Owns Iron Gym", day);
        Assert.AreEqual($"Owns Iron Gym, shown to TB Gym on {arabicDay}", added.Text);
        Assert.AreEqual(N4aSentence("Owns Iron Gym", day, "ar-LB"), added.Text);
        var lines = await N4aLinesAsync(admin, ownerId, spaceId);
        var reread = lines.Lines.Single(item => item.Id == english.Id);
        Assert.AreEqual($"NASM CPT, 2019, shown to TB Gym on {arabicDay}", reread.Text);
        Assert.AreEqual("NASM CPT, 2019", reread.What, "Only the sentence's day changes language; the words are as typed.");
    }

    [TestMethod]
    public async Task N4aTheDatabaseRefusesARowTheRecordsRulesForbid()
    {
        // Midday, a whole minute: an instant the API answers carries no tick the database's microseconds drop.
        N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4a-check-owner@example.test", "Karim Haddad", "N4a Check Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4a-check-admin@example.test");
        var adminId = await SignedInUserIdAsync(admin);
        await RefreshCsrfAsync(admin);
        var line = await N4aAddedAsync(admin, ownerId, spaceId, "NASM CPT, 2019", new DateOnly(2026, 11, 3));
        Assert.AreEqual(
            1L,
            await A16aScalarAsync("SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_CoachCertificateLines_Protect' AND tgrelid = 'identity.\"CoachCertificateLines\"'::regclass"));
        (string, object)[] ids = [("tenant", spaceId), ("coach", ownerId), ("admin", adminId)];

        // The shapes a line may take, written past the application, each storable.
        var waiting = new N4aSqlRow();
        var confirmed = waiting with { What = "'Confirmed CPT'", ConfirmedAt = N4aSqlConfirmedAt, ConfirmedBy = "'Rami Saade'" };
        var erased = new N4aSqlRow(
            What: "''",
            ShownOn: "NULL",
            ConfirmedAt: N4aSqlConfirmedAt,
            ConfirmedBy: "''",
            ErasedAt: N4aSqlErasedAt,
            ErasedBy: "@admin",
            Reason: "'Request'",
            RequestedOn: "DATE '2026-11-05'");
        var keepingPeriod = erased with { ErasedBy = "NULL", Reason = "'KeepingPeriod'", RequestedOn = "NULL" };
        foreach (var valid in new[]
        {
            waiting,
            confirmed,
            confirmed with { What = "'Taken down CPT'", TakenDownAt = N4aSqlTakenDownAt, TakenDownBy = "@admin" },
            erased,
            erased with { TakenDownAt = N4aSqlTakenDownAt, TakenDownBy = "@admin" },
            keepingPeriod,
        })
        {
            await Phase6ExecuteAsync(N4aInsertSql(valid), ids);
        }

        // Each row below breaks one rule, and the check named for it refuses it.
        foreach (var (constraint, because, row) in new (string, string, N4aSqlRow)[]
        {
            ("CK_CoachCertificateLines_Words", "no words", waiting with { What = "''" }),
            ("CK_CoachCertificateLines_Words", "words with a space around them", waiting with { What = "' Padded CPT'" }),
            ("CK_CoachCertificateLines_Words", "no day", waiting with { What = "'No day CPT'", ShownOn = "NULL" }),
            ("CK_CoachCertificateLines_Words", "an erased line that kept its words", erased with { What = "'Kept CPT'" }),
            ("CK_CoachCertificateLines_Words", "an erased line that kept its day", erased with { ShownOn = "DATE '2026-11-03'" }),
            ("CK_CoachCertificateLines_Confirmed", "a confirmation without a name", waiting with { What = "'No name CPT'", ConfirmedAt = N4aSqlConfirmedAt }),
            ("CK_CoachCertificateLines_Confirmed", "a name without a confirmation", waiting with { What = "'No date CPT'", ConfirmedBy = "'Rami Saade'" }),
            ("CK_CoachCertificateLines_Confirmed", "a name with a space around it", confirmed with { What = "'Padded name CPT'", ConfirmedBy = "' Rami Saade'" }),
            ("CK_CoachCertificateLines_Confirmed", "an erased line that kept who confirmed it", erased with { ConfirmedBy = "'Rami Saade'" }),
            ("CK_CoachCertificateLines_Confirmed", "confirmed before it was added", confirmed with { What = "'Early CPT'", ConfirmedAt = "TIMESTAMPTZ '2026-11-03 08:00:00+00'" }),
            ("CK_CoachCertificateLines_TakenDown", "taken down by nobody", confirmed with { What = "'Nobody CPT'", TakenDownAt = N4aSqlTakenDownAt }),
            ("CK_CoachCertificateLines_TakenDown", "a waiting line taken down", waiting with { What = "'Waiting down CPT'", TakenDownAt = N4aSqlTakenDownAt, TakenDownBy = "@admin" }),
            ("CK_CoachCertificateLines_TakenDown", "taken down before it was confirmed", confirmed with { What = "'Down early CPT'", TakenDownAt = "TIMESTAMPTZ '2026-11-03 09:30:00+00'", TakenDownBy = "@admin" }),
            ("CK_CoachCertificateLines_Erased", "erased for no reason", erased with { ErasedBy = "NULL", Reason = "NULL", RequestedOn = "NULL" }),
            ("CK_CoachCertificateLines_Erased", "a reason that is neither", erased with { Reason = "'Forgotten'" }),
            ("CK_CoachCertificateLines_Erased", "a request nobody erased", erased with { ErasedBy = "NULL" }),
            ("CK_CoachCertificateLines_Erased", "a request without its day", erased with { RequestedOn = "NULL" }),
            ("CK_CoachCertificateLines_Erased", "the keeping period with someone who erased it", keepingPeriod with { ErasedBy = "@admin" }),
            ("CK_CoachCertificateLines_Erased", "the keeping period with a request's day", keepingPeriod with { RequestedOn = "DATE '2026-11-05'" }),
            ("CK_CoachCertificateLines_Erased", "a waiting line erased", keepingPeriod with { ConfirmedAt = "NULL", ConfirmedBy = "NULL" }),
            ("CK_CoachCertificateLines_Erased", "erased before it was confirmed", erased with { ErasedAt = "TIMESTAMPTZ '2026-11-03 09:30:00+00'" }),
            ("CK_CoachCertificateLines_Erased", "a reason on a line not erased", confirmed with { What = "'Reason CPT'", Reason = "'Request'", ErasedBy = "@admin", RequestedOn = "DATE '2026-11-05'" }),
        })
        {
            var refused = await N4aRefusedAsync(N4aInsertSql(row), ids);
            Assert.AreEqual((PostgresErrorCodes.CheckViolation, constraint), (refused.SqlState, refused.ConstraintName), because);
        }

        // One line per words and day while it is not erased, and only about a member of the space, recorded by an account.
        var duplicate = await N4aRefusedAsync(N4aInsertSql(waiting with { What = "'NASM CPT, 2019'" }), ids);
        Assert.AreEqual((PostgresErrorCodes.UniqueViolation, "UX_CoachCertificateLines_OneLine"), (duplicate.SqlState, duplicate.ConstraintName));
        var stranger = await N4aRefusedAsync(
            N4aInsertSql(waiting with { What = "'Stranger CPT'" }),
            ("tenant", spaceId), ("coach", adminId), ("admin", adminId));
        Assert.AreEqual(
            (PostgresErrorCodes.ForeignKeyViolation, "FK_CoachCertificateLines_Memberships_TenantId_CoachUserId"),
            (stranger.SqlState, stranger.ConstraintName));
        var nobody = await N4aRefusedAsync(
            N4aInsertSql(waiting with { What = "'Nobody recorded CPT'" }),
            ("tenant", spaceId), ("coach", ownerId), ("admin", Guid.NewGuid()));
        Assert.AreEqual(
            (PostgresErrorCodes.ForeignKeyViolation, "FK_CoachCertificateLines_Users_RecordedByUserId"),
            (nobody.SqlState, nobody.ConstraintName));

        // The trigger: a waiting line's words never change either, and it is dropped, never erased.
        await AssertSqlStateAsync("55000", """UPDATE identity."CoachCertificateLines" SET "What" = 'Changed CPT' WHERE "Id" = @id""", ("id", line.Id));
        await AssertSqlStateAsync(
            "55000",
            """
            UPDATE identity."CoachCertificateLines"
            SET "What" = '', "ShownOn" = NULL, "ErasedAtUtc" = "CreatedAtUtc" + interval '1 day', "ErasureReason" = 'KeepingPeriod'
            WHERE "Id" = @id
            """,
            ("id", line.Id));

        // Confirmed and taken down through the API, an erasure must blank the words and the name and keep the rest.
        var current = await N4aAnswerAsync(await N4aConfirmAsync(admin, ownerId, spaceId, line.Id, "Rami Saade", line.Version));
        current = await N4aAnswerAsync(await N4aTakeDownAsync(admin, ownerId, spaceId, line.Id, current.Version));

        // A take-down is written once, and a line never moves to another space, short of an erasure too.
        foreach (var (change, because) in new[]
        {
            (""" "TakenDownAtUtc" = NULL, "TakenDownByUserId" = NULL""", "a taken-down line put back up"),
            (""" "TakenDownAtUtc" = "TakenDownAtUtc" + interval '1 day'""", "the take-down re-dated"),
            (""" "TenantId" = gen_random_uuid()""", "the line moved to another space"),
        })
        {
            var refused = await N4aRefusedAsync($"""UPDATE identity."CoachCertificateLines" SET {change} WHERE "Id" = @id""", ("id", line.Id));
            Assert.AreEqual("55000", refused.SqlState, because);
        }

        const string Blanked = """ "What" = '', "ShownOn" = NULL, "ConfirmedByName" = '', "ErasedAtUtc" = "TakenDownAtUtc" + interval '30 days', "ErasureReason" = 'KeepingPeriod' """;
        foreach (var (change, because) in new[]
        {
            (""" "ErasedAtUtc" = "TakenDownAtUtc" + interval '30 days', "ErasureReason" = 'KeepingPeriod' """, "the words kept"),
            (""" "What" = '', "ShownOn" = NULL, "ErasedAtUtc" = "TakenDownAtUtc" + interval '30 days', "ErasureReason" = 'KeepingPeriod' """, "the name kept"),
            (Blanked + """, "CoachShows" = false""", "the coach's switch moved"),
            (Blanked + """, "ConfirmedAtUtc" = NULL""", "the confirmation's date gone"),
            (Blanked + """, "TakenDownAtUtc" = NULL, "TakenDownByUserId" = NULL""", "the take-down gone"),
        })
        {
            var refused = await N4aRefusedAsync($"""UPDATE identity."CoachCertificateLines" SET {change} WHERE "Id" = @id""", ("id", line.Id));
            Assert.AreEqual("55000", refused.SqlState, because);
        }

        // The keeping period's erasure as N4b's sweep will write it goes through, and the admin reads it so.
        await Phase6ExecuteAsync($"""UPDATE identity."CoachCertificateLines" SET {Blanked} WHERE "Id" = @id""", ("id", line.Id));
        var swept = await N4aLineAsync(admin, ownerId, spaceId, line.Id);
        Assert.AreEqual(("Erased", "KeepingPeriod"), (swept.State, swept.ErasureReason));
        Assert.IsNull(swept.ErasedByName, "Nobody erased it: the keeping period did.");
        Assert.IsNull(swept.RequestedOn);
        Assert.IsNull(swept.What);
        Assert.AreEqual(current.TakenDownAtUtc, swept.TakenDownAtUtc);
    }

    // ---------- certificate helpers ----------

    /// <summary>Every line the host logged, each with the exception it carried (<see cref="CapturedLog"/>).</summary>
    private CapturedLog RequiredEveryLogLine =>
        everyLogLine ?? throw new InvalidOperationException("The full log capture is not initialized.");

    private const string N4aSqlCreatedAt = "TIMESTAMPTZ '2026-11-03 09:00:00+00'";

    private const string N4aSqlConfirmedAt = "TIMESTAMPTZ '2026-11-03 10:00:00+00'";

    private const string N4aSqlTakenDownAt = "TIMESTAMPTZ '2026-11-04 10:00:00+00'";

    private const string N4aSqlErasedAt = "TIMESTAMPTZ '2026-11-05 10:00:00+00'";

    private static string N4aLinesUrl(Guid userId, Guid tenantId) => $"{N4aCoachesUrl}/{userId}/spaces/{tenantId}/lines";

    private static string N4aLineUrl(Guid userId, Guid tenantId, Guid lineId, string action) =>
        $"{N4aLinesUrl(userId, tenantId)}/{lineId}/{action}";

    private static string N4aEraseUrl(Guid userId, Guid tenantId) => $"{N4aCoachesUrl}/{userId}/spaces/{tenantId}/erase";

    /// <summary>The sentence of wording version 1, its day written in <paramref name="culture"/>.</summary>
    private static string N4aSentence(string what, DateOnly day, string culture) =>
        $"{what}, shown to TB Gym on {day.ToString("d MMM yyyy", CultureInfo.GetCultureInfo(culture))}";

    /// <summary>Puts the frozen clock at midday in the space's zone, on the day it already reads, and returns that day.</summary>
    private DateOnly N4aStartAtMidday()
    {
        var today = Phase6WorkspaceToday();
        B4aSetWorkspaceClock(today, new TimeOnly(12, 0));
        return today;
    }

    /// <summary>Every route of the record, called with a body it would accept, in the order of <see cref="N4aRouteNames"/>.</summary>
    private static (string Name, Func<HttpClient, Task<HttpResponseMessage>> Call)[] N4aEveryRoute(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        DateOnly day,
        uint version) =>
    [
        ("ListCertificateCoaches", caller => caller.GetAsync(N4aCoachesUrl)),
        ("ListCoachCertificateLines", caller => caller.GetAsync(N4aLinesUrl(userId, tenantId))),
        ("AddCoachCertificateLine", caller => N4aAddAsync(caller, userId, tenantId, "Owns Iron Gym", day)),
        ("ConfirmCoachCertificateLine", caller => N4aConfirmAsync(caller, userId, tenantId, lineId, "Rami Saade", version)),
        ("DropCoachCertificateLine", caller => N4aDropAsync(caller, userId, tenantId, lineId, version)),
        ("TakeDownCoachCertificateLine", caller => N4aTakeDownAsync(caller, userId, tenantId, lineId, version)),
        ("EraseCoachCertificateLines", caller => N4aEraseAsync(caller, userId, tenantId, day)),
    ];

    private static Task<HttpResponseMessage> N4aAddAsync(HttpClient admin, Guid userId, Guid tenantId, string? what, DateOnly? shownOn) =>
        admin.PostAsJsonAsync(N4aLinesUrl(userId, tenantId), new { what, shownOn });

    private static async Task<N4aLine> N4aAddedAsync(HttpClient admin, Guid userId, Guid tenantId, string what, DateOnly shownOn)
    {
        var response = await N4aAddAsync(admin, userId, tenantId, what, shownOn);
        await AssertStatusAsync(response, HttpStatusCode.Created);
        return await RequiredJsonAsync<N4aLine>(response);
    }

    private static Task<HttpResponseMessage> N4aConfirmAsync(
        HttpClient admin,
        Guid userId,
        Guid tenantId,
        Guid lineId,
        string? confirmedByName,
        uint? version) =>
        admin.PostAsJsonAsync(N4aLineUrl(userId, tenantId, lineId, "confirm"), new { confirmedByName, version });

    private static Task<HttpResponseMessage> N4aDropAsync(HttpClient admin, Guid userId, Guid tenantId, Guid lineId, uint? version) =>
        admin.PostAsJsonAsync(N4aLineUrl(userId, tenantId, lineId, "drop"), new { version });

    private static Task<HttpResponseMessage> N4aTakeDownAsync(HttpClient admin, Guid userId, Guid tenantId, Guid lineId, uint? version) =>
        admin.PostAsJsonAsync(N4aLineUrl(userId, tenantId, lineId, "take-down"), new { version });

    private static Task<HttpResponseMessage> N4aEraseAsync(HttpClient admin, Guid userId, Guid tenantId, DateOnly? requestedOn) =>
        admin.PostAsJsonAsync(N4aEraseUrl(userId, tenantId), new { requestedOn });

    /// <summary>A line the server answered 200 with.</summary>
    private static async Task<N4aLine> N4aAnswerAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N4aLine>(response);
    }

    private static async Task<N4aLines> N4aLinesAsync(HttpClient admin, Guid userId, Guid tenantId)
    {
        var response = await admin.GetAsync(N4aLinesUrl(userId, tenantId));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N4aLines>(response);
    }

    private static async Task<N4aLine> N4aLineAsync(HttpClient admin, Guid userId, Guid tenantId, Guid lineId) =>
        (await N4aLinesAsync(admin, userId, tenantId)).Lines.Single(line => line.Id == lineId);

    private static (string State, uint Version) N4aStateAndVersion(N4aLine line) => (line.State, line.Version);

    private static async Task<N4aCoachRow[]> N4aCoachesAsync(HttpClient admin)
    {
        var response = await admin.GetAsync(N4aCoachesUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N4aCoachRow[]>(response);
    }

    /// <summary>The list's one row for this membership (every admin also owns a space of their own).</summary>
    private static async Task<N4aCoachRow> N4aRowAsync(HttpClient admin, Guid userId, Guid tenantId) =>
        (await N4aCoachesAsync(admin)).Single(row => row.UserId == userId && row.TenantId == tenantId);

    /// <summary>The one message a 400 gives, under <paramref name="field"/>, the only field it names.</summary>
    private static async Task<string> N4aRefusalAsync(HttpResponseMessage response, string field) =>
        (await N4aAssertInvalidAsync(response, field)).Errors[field].Single();

    private static async Task<N4aValidation> N4aAssertInvalidAsync(HttpResponseMessage response, params string[] fields)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<N4aValidation>(response);
        CollectionAssert.AreEquivalent(fields, problem.Errors.Keys.ToArray(), string.Join(", ", problem.Errors.Keys));
        return problem;
    }

    private static async Task N4aAssertConflictAsync(HttpResponseMessage response, string code, string message)
    {
        var answer = await A16aAnswerAsync(response, HttpStatusCode.Conflict);
        Assert.AreEqual((code, message), (answer.Code, answer.Message));
    }

    private static async Task<string> N4aBodiesAsync(IEnumerable<HttpResponseMessage> answers) =>
        string.Join(
            " | ",
            await Task.WhenAll(answers.Select(async answer => $"{(int)answer.StatusCode} {await answer.Content.ReadAsStringAsync()}")));

    private Task<long> N4aLineCountAsync(Guid tenantId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM identity."CoachCertificateLines" WHERE "TenantId" = @id""",
        tenantId);

    private Task<long> N4aRowsWithIdAsync(Guid lineId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM identity."CoachCertificateLines" WHERE "Id" = @id""",
        lineId);

    /// <summary>The lines the tenant-filtered set reads in a scope holding <paramref name="tenantId"/>, or no space.</summary>
    private async Task<int> N4aCountInScopeAsync(Guid? tenantId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        if (tenantId is { } space)
        {
            scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(space);
        }

        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.CoachCertificateLines.CountAsync(TestContext.CancellationTokenSource.Token);
    }

    private async Task<PostgresException> N4aRefusedAsync(string sql, params (string Name, object Value)[] parameters) =>
        await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, parameters));

    /// <summary>A row written past the application, about <c>@coach</c> in <c>@tenant</c>, recorded by <c>@admin</c>.</summary>
    private static string N4aInsertSql(N4aSqlRow row) => $"""
        INSERT INTO identity."CoachCertificateLines"
            ("Id", "TenantId", "CoachUserId", "RecordedByUserId", "CoachShows", "CreatedAtUtc", "UpdatedAtUtc",
             "What", "ShownOn", "ConfirmedAtUtc", "ConfirmedByName", "TakenDownAtUtc", "TakenDownByUserId",
             "ErasedAtUtc", "ErasedByUserId", "ErasureReason", "RequestedOn")
        VALUES (gen_random_uuid(), @tenant, @coach, @admin, true, {N4aSqlCreatedAt}, {N4aSqlCreatedAt},
                {row.What}, {row.ShownOn}, {row.ConfirmedAt}, {row.ConfirmedBy}, {row.TakenDownAt}, {row.TakenDownBy},
                {row.ErasedAt}, {row.ErasedBy}, {row.Reason}, {row.RequestedOn})
        """;

    private async Task<N4aStoredLine> N4aStoredLineAsync(Guid lineId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "What", "ShownOn", "ConfirmedByName", "ConfirmedAtUtc", "RecordedByUserId", "ErasedByUserId",
                   "ErasureReason", "RequestedOn", "ErasedAtUtc", "TakenDownAtUtc", "TakenDownByUserId", "CoachUserId",
                   "TenantId", "CoachShows"
            FROM identity."CoachCertificateLines"
            WHERE "Id" = @id
            """;
        command.Parameters.AddWithValue("id", lineId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync(), "The erased line's row is kept.");
        return new N4aStoredLine(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetFieldValue<DateOnly>(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3),
            reader.GetGuid(4),
            reader.IsDBNull(5) ? null : reader.GetGuid(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.IsDBNull(7) ? null : reader.GetFieldValue<DateOnly>(7),
            reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
            reader.IsDBNull(10) ? null : reader.GetGuid(10),
            reader.GetGuid(11),
            reader.GetGuid(12),
            reader.GetBoolean(13));
    }

    private sealed record N4aCoachRow(
        Guid UserId,
        string Name,
        string Email,
        Guid TenantId,
        string SpaceName,
        string Role,
        bool IsActiveStaff,
        int WaitingLines,
        int ConfirmedLines,
        int TakenDownLines,
        int ErasedLines);
    private sealed record N4aLines(
        Guid UserId,
        string Name,
        string Email,
        Guid TenantId,
        string SpaceName,
        string Role,
        bool IsActiveStaff,
        DateOnly SpaceToday,
        N4aLine[] Lines);
    private sealed record N4aLine(
        Guid Id,
        string State,
        string? Text,
        string? What,
        DateOnly? ShownOn,
        int WordingVersion,
        string RecordedByName,
        DateTimeOffset RecordedAtUtc,
        DateOnly RecordedOn,
        DateTimeOffset? ConfirmedAtUtc,
        DateOnly? ConfirmedOn,
        string? ConfirmedByName,
        DateTimeOffset? TakenDownAtUtc,
        DateOnly? TakenDownOn,
        string? TakenDownByName,
        DateTimeOffset? ErasedAtUtc,
        DateOnly? ErasedOn,
        string? ErasureReason,
        DateOnly? RequestedOn,
        string? ErasedByName,
        bool CoachShows,
        bool ShownToClients,
        uint Version);
    private sealed record N4aDrop(Guid LineId);
    private sealed record N4aErasure(int Erased, int Dropped);
    private sealed record N4aValidation(Dictionary<string, string[]> Errors);
    private sealed record N4aStoredLine(
        string What,
        DateOnly? ShownOn,
        string? ConfirmedByName,
        DateTimeOffset? ConfirmedAtUtc,
        Guid RecordedByUserId,
        Guid? ErasedByUserId,
        string? ErasureReason,
        DateOnly? RequestedOn,
        DateTimeOffset? ErasedAtUtc,
        DateTimeOffset? TakenDownAtUtc,
        Guid? TakenDownByUserId,
        Guid CoachUserId,
        Guid TenantId,
        bool CoachShows);

    /// <summary>The SQL for each column a test varies; the default is a valid waiting line shown on 3 Nov 2026.</summary>
    private sealed record N4aSqlRow(
        string What = "'Waiting CPT'",
        string ShownOn = "DATE '2026-11-03'",
        string ConfirmedAt = "NULL",
        string ConfirmedBy = "NULL",
        string TakenDownAt = "NULL",
        string TakenDownBy = "NULL",
        string ErasedAt = "NULL",
        string ErasedBy = "NULL",
        string Reason = "NULL",
        string RequestedOn = "NULL");
}
