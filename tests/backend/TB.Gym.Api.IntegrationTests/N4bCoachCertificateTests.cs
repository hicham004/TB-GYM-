using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The certificate record shown (notes plan N4b, CLI-021, ADR 0039), against PostgreSQL: a coach reads their own
/// lines in the open space alone and switches a confirmed one that is still up on or off with the version they read,
/// even while the space's bill is unpaid; a client reads the switched-on confirmed lines of the coach of their current
/// profile in their space and nothing else; the keeping sweep erases, in every space, each line taken down longer ago
/// than the period, its words gone and its dates kept; and no line's words nor who confirmed it reach the log.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N4bOwnUrl = "/api/coach-certificates/me";

    private const string N4bCoachUrl = "/api/client-profile/me/coach";

    private static readonly string[] N4bRouteNames = ["GetOwnCoachCertificates", "SetOwnCoachCertificateLineShown"];

    private static readonly string[] N4bRouteParameters = ["lineId"];

    private static readonly string[] N4bTenantCoachPolicy = [AuthorizationPolicies.TenantCoach];

    private static readonly string[] N4bCoachFields = ["name", "foundingCoach", "lines"];

    private static readonly string[] N4bCoachLineFields = ["text", "what", "shownOn"];

    [TestMethod]
    public void N4bTheCoachsOwnRoutesAreTheTenantCoachsAndOnlyTheSwitchWrites()
    {
        var routes = A10bApiRoutes()
            .Where(route => route.RoutePattern.RawText!.StartsWith(N4bOwnUrl, StringComparison.Ordinal))
            .ToArray();
        CollectionAssert.AreEquivalent(N4bRouteNames, routes.Select(A10bName).ToArray());

        foreach (var route in routes)
        {
            var name = A10bName(route);
            var policies = route.Metadata.GetOrderedMetadata<IAuthorizeData>()
                .Select(data => data.Policy)
                .OfType<string>()
                .ToArray();
            CollectionAssert.AreEqual(N4bTenantCoachPolicy, policies, $"{name} is not behind the TenantCoach policy alone.");
            Assert.IsNull(route.Metadata.GetMetadata<IAllowAnonymous>(), name);
            var isWrite = WriteRateLimiting.IsStateChanging(route.Metadata.GetMetadata<IHttpMethodMetadata>());
            Assert.AreEqual(name == "SetOwnCoachCertificateLineShown", isWrite, name);
            Assert.AreEqual(isWrite ? RateLimitPolicies.RoutineWrite : null, A10bPolicy(route), name);
            Assert.AreEqual(
                isWrite,
                route.Metadata.GetMetadata<AllowedWhileWorkspaceReadOnly>() is not null,
                $"{name}: only the switch is kept open on a read-only space.");
            CollectionAssert.IsSubsetOf(
                route.RoutePattern.Parameters.Select(parameter => parameter.Name).ToArray(),
                N4bRouteParameters,
                name);
        }
    }

    [TestMethod]
    public async Task N4bOnlyActiveStaffOfTheSpaceReachTheirOwnLinesThere()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-who-owner@example.test", "Karim Haddad", "N4b Who Gym");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-who-lea@example.test", "Lea Khoury");
        using var departed = CreateClient();
        var departedId = await JoinAsCoachAsync(owner, departed, "n4b-who-departed@example.test", "Nadim Fares");
        using var client = CreateClient();
        await InviteAndAcceptAsync(lea, client, "n4b-who-client@example.test", true);
        using var otherOwner = CreateClient();
        var otherSpaceId = await RegisterCoachAsync(otherOwner, "n4b-who-other@example.test", "Rana Aoun", "N4b Other Gym");
        using var admin = await SignInPlatformAdminAsync("n4b-who-admin@example.test");
        var today = Phase6WorkspaceToday();
        await RefreshCsrfAsync(admin);
        var line = await N4bConfirmedAsync(admin, leaId, spaceId, "NASM CPT, 2019", today);
        var departedLine = await N4bConfirmedAsync(admin, departedId, spaceId, "Owns Iron Gym since 2015", today);
        await RemoveCoachForBillingAsync(owner, departedId);

        // Nobody signed in: 401 on both routes, a valid token and the space's header notwithstanding.
        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        SetTenant(anonymous, spaceId);
        await AssertStatusAsync(await anonymous.GetAsync(N4bOwnUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await N4bSetShownAsync(anonymous, line.Id, false, line.Version), HttpStatusCode.Unauthorized);

        // A client of the space, the platform admin who is no member of it, and the coach removed from it, about
        // their own line too: 403 on both routes.
        await N4bAssertRefusedAsync(client, line.Id, line.Version, "a client of the space");
        await N4bAssertRefusedAsync(admin, line.Id, line.Version, "the platform admin with no workspace header");
        SetTenant(admin, spaceId);
        await N4bAssertRefusedAsync(admin, line.Id, line.Version, "the platform admin under the space's header");
        admin.DefaultRequestHeaders.Remove("X-Tenant-Id");
        await N4bAssertRefusedAsync(departed, departedLine.Id, departedLine.Version, "the coach removed from the space");

        // The line's own coach under no space, a space she is not in, a space that is not there, or a header that
        // names no space: 403, since the header is checked against her memberships before anything is read.
        lea.DefaultRequestHeaders.Remove("X-Tenant-Id");
        await N4bAssertRefusedAsync(lea, line.Id, line.Version, "the coach with no workspace header");
        SetTenant(lea, otherSpaceId);
        await N4bAssertRefusedAsync(lea, line.Id, line.Version, "the coach under another space");
        SetTenant(lea, Guid.NewGuid());
        await N4bAssertRefusedAsync(lea, line.Id, line.Version, "the coach under an unknown space");
        lea.DefaultRequestHeaders.Remove("X-Tenant-Id");
        lea.DefaultRequestHeaders.TryAddWithoutValidation("X-Tenant-Id", "not-a-space");
        await N4bAssertRefusedAsync(lea, line.Id, line.Version, "the coach under a header that is no space");

        // Under her own space without the antiforgery header (the cookie kept), the switch is refused; reads need
        // no token, and nothing reached the line.
        SetTenant(lea, spaceId);
        lea.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Assert.AreEqual(
            "antiforgery_token_invalid",
            (await A16aAnswerAsync(await N4bSetShownAsync(lea, line.Id, false, line.Version), HttpStatusCode.BadRequest)).Code);
        CollectionAssert.AreEqual(new[] { N4bOwnLineOf(line) }, await N4bOwnLinesAsync(lea), "No refusal moved the line.");

        // Another space's owner reads her own lines, none, and Lea's line is not found from her space; the space's
        // owner is staff too and reads their own, none.
        Assert.IsEmpty(await N4bOwnLinesAsync(otherOwner));
        await RefreshCsrfAsync(otherOwner);
        await AssertStatusAsync(await N4bSetShownAsync(otherOwner, line.Id, false, line.Version), HttpStatusCode.NotFound);
        Assert.IsEmpty(await N4bOwnLinesAsync(owner));

        // With a fresh token the switch goes through; the removed coach's line is kept as it was.
        await RefreshCsrfAsync(lea);
        Assert.IsFalse((await N4bShownAsync(lea, line.Id, false, line.Version)).CoachShows);
        var kept = await N4aLineAsync(admin, departedId, spaceId, departedLine.Id);
        Assert.AreEqual(("Confirmed", true, departedLine.Version), (kept.State, kept.CoachShows, kept.Version));
    }

    [TestMethod]
    public async Task N4bACoachReadsTheirOwnLinesInTheirSpaceInTheOrderRecorded()
    {
        // Midday, so the minutes the clock moves on between lines never cross into another day.
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceA = await RegisterCoachAsync(owner, "n4b-read-owner@example.test", "Karim Haddad", "N4b Read A");
        var ownerId = await SignedInUserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-read-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n4b-read-omar@example.test", "Omar Nassar");
        using var ownerB = CreateClient();
        var spaceB = await RegisterCoachAsync(ownerB, "n4b-read-owner-b@example.test", "Rana Aoun", "N4b Read B");
        await B4bJoinSignedInAsCoachAsync(ownerB, lea, spaceB, "n4b-read-lea@example.test", "Lea");
        SetTenant(lea, spaceA);
        using var admin = await SignInPlatformAdminAsync("n4b-read-admin@example.test");
        await RefreshCsrfAsync(admin);

        // Nothing recorded yet.
        Assert.IsEmpty(await N4bOwnLinesAsync(lea));

        // The first line, confirmed, then erased on her request: no words are left, so it is never listed.
        var erased = await N4bConfirmedAsync(admin, leaId, spaceA, "First aid course, 2012", today.AddDays(-60));
        Assert.AreEqual(new N4aErasure(1, 0), await RequiredJsonAsync<N4aErasure>(await N4aEraseAsync(admin, leaId, spaceA, today)));

        // Then a confirmed, a taken-down and a waiting line, a minute apart, so the order recorded is neither the
        // order of the days shown, nor of the words, nor of the states, nor the admin's newest first.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var confirmed = await N4bConfirmedAsync(admin, leaId, spaceA, "NASM CPT, 2019", today.AddDays(-4));
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var takenDown = await N4bTakenDownAsync(admin, leaId, spaceA, "Coached for 8 years", today.AddDays(-30));
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var waiting = await N4aAddedAsync(admin, leaId, spaceA, "Owns Iron Gym since 2015", today);

        // Another coach's line and the owner's in the same space, and Lea's own in her other space.
        var omars = await N4aAddedAsync(admin, omarId, spaceA, "ACE CPT, 2021", today);
        var owners = await N4bConfirmedAsync(admin, ownerId, spaceA, "Owns N4b Read A since 2018", today);
        var inB = await N4bConfirmedAsync(admin, leaId, spaceB, "Coached at N4b Read B since 2020", today);

        // Hers in this space alone, in the order recorded, each with its sentence in the space's English, its
        // state, its days in the space's calendar, its switch and the version the switch needs.
        var own = await N4bOwnLinesAsync(lea);
        CollectionAssert.AreEqual(new[] { N4bOwnLineOf(confirmed), N4bOwnLineOf(takenDown), N4bOwnLineOf(waiting) }, own);
        Assert.AreEqual(
            ("Confirmed", "NASM CPT, 2019, shown to TB Gym on " + today.AddDays(-4).ToString("d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-LB"))),
            (own[0].State, own[0].Text));
        Assert.AreEqual(("TakenDown", (DateOnly?)today, (DateOnly?)today), (own[1].State, own[1].ConfirmedOn, own[1].TakenDownOn));
        Assert.AreEqual(("Waiting", (DateOnly?)null, (DateOnly?)null, true), (own[2].State, own[2].ConfirmedOn, own[2].TakenDownOn, own[2].CoachShows));
        Assert.AreEqual("Erased", (await N4aLineAsync(admin, leaId, spaceA, erased.Id)).State, "The erased line is still in the record.");

        // Under her other space's header she reads that space's line alone; the others read theirs.
        SetTenant(lea, spaceB);
        CollectionAssert.AreEqual(new[] { N4bOwnLineOf(inB) }, await N4bOwnLinesAsync(lea));
        CollectionAssert.AreEqual(new[] { N4bOwnLineOf(omars) }, await N4bOwnLinesAsync(omar));
        CollectionAssert.AreEqual(new[] { N4bOwnLineOf(owners) }, await N4bOwnLinesAsync(owner));
        Assert.IsEmpty(await N4bOwnLinesAsync(ownerB), "Lea's line in B is hers, not her owner's there.");
    }

    [TestMethod]
    public async Task N4bTheSwitchSavesWithTheVersionReadAndRefusesAnyOtherLineOrVersion()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceA = await RegisterCoachAsync(owner, "n4b-switch-owner@example.test", "Karim Haddad", "N4b Switch A");
        var ownerId = await SignedInUserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-switch-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n4b-switch-omar@example.test", "Omar Nassar");
        using var ownerB = CreateClient();
        var spaceB = await RegisterCoachAsync(ownerB, "n4b-switch-owner-b@example.test", "Rana Aoun", "N4b Switch B");
        await B4bJoinSignedInAsCoachAsync(ownerB, lea, spaceB, "n4b-switch-lea@example.test", "Lea");
        using var admin = await SignInPlatformAdminAsync("n4b-switch-admin@example.test");
        var shownOn = today.AddDays(-4);
        await RefreshCsrfAsync(admin);

        // In B, a line erased on Lea's request straight from confirmed, then one still up.
        var toErase = await N4bConfirmedAsync(admin, leaId, spaceB, "First aid course, 2012", shownOn);
        Assert.AreEqual(new N4aErasure(1, 0), await RequiredJsonAsync<N4aErasure>(await N4aEraseAsync(admin, leaId, spaceB, today)));
        var erased = await N4aLineAsync(admin, leaId, spaceB, toErase.Id);
        Assert.AreEqual("Erased", erased.State);
        var upInB = await N4bConfirmedAsync(admin, leaId, spaceB, "Coached at N4b Switch B since 2020", shownOn);

        // In A, Lea's confirmed, waiting and taken-down lines, another coach's and the owner's.
        var line = await N4bConfirmedAsync(admin, leaId, spaceA, "NASM CPT, 2019", shownOn);
        var waiting = await N4aAddedAsync(admin, leaId, spaceA, "Owns Iron Gym since 2015", shownOn);
        var beforeDown = await N4bConfirmedAsync(admin, leaId, spaceA, "Coached for 8 years", shownOn);
        var takenDown = await N4aAnswerAsync(await N4aTakeDownAsync(admin, leaId, spaceA, beforeDown.Id, beforeDown.Version));
        var omars = await N4bConfirmedAsync(admin, omarId, spaceA, "ACE CPT, 2021", shownOn);
        var owners = await N4bConfirmedAsync(admin, ownerId, spaceA, "Owns N4b Switch A since 2018", shownOn);
        SetTenant(lea, spaceA);
        await RefreshCsrfAsync(lea);

        // Off, then on again: each answer is the line with its new version, and only the switch moved, stamped
        // with when and by whom.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var off = await N4bShownAsync(lea, line.Id, false, line.Version);
        Assert.AreEqual(N4bOwnLineOf(line) with { CoachShows = false, Version = off.Version }, off);
        Assert.AreNotEqual(line.Version, off.Version);
        Assert.AreEqual((RequiredTestClock.UtcNow, (Guid?)leaId), await N4bUpdatedAsync(line.Id));
        // The admin's page follows the switch: a hidden line is shown to no client, a waiting one neither.
        var hiddenForAdmin = await N4aLineAsync(admin, leaId, spaceA, line.Id);
        Assert.AreEqual((false, false), (hiddenForAdmin.CoachShows, hiddenForAdmin.ShownToClients));
        Assert.IsFalse((await N4aLineAsync(admin, leaId, spaceA, waiting.Id)).ShownToClients);
        Assert.IsFalse((await N4aLineAsync(admin, leaId, spaceA, takenDown.Id)).ShownToClients);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var on = await N4bShownAsync(lea, line.Id, true, off.Version);
        Assert.AreEqual(N4bOwnLineOf(line) with { Version = on.Version }, on);
        Assert.AreNotEqual(off.Version, on.Version);
        Assert.IsTrue((await N4aLineAsync(admin, leaId, spaceA, line.Id)).ShownToClients);
        var switchedOnAt = RequiredTestClock.UtcNow;

        // The same choice again writes nothing and answers the line as it stands, its version unchanged.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        Assert.AreEqual(on, await N4bShownAsync(lea, line.Id, true, on.Version));
        Assert.AreEqual((switchedOnAt, (Guid?)leaId), await N4bUpdatedAsync(line.Id), "The same choice wrote the row again.");
        CollectionAssert.AreEqual(new[] { on }, (await N4bOwnLinesAsync(lea)).Where(item => item.Id == line.Id).ToArray());

        // A version read before a change: changed, whichever way the switch goes, the same choice included.
        foreach (var (shown, version) in new[] { (false, line.Version), (true, off.Version), (true, line.Version) })
        {
            await N4aAssertConflictAsync(
                await N4bSetShownAsync(lea, line.Id, shown, version),
                CoachCertificateText.ChangedCode,
                CoachCertificateText.Changed);
        }

        // The admin reads the line as it was confirmed, its words, day and confirmer untouched, and switched on;
        // the version the admin held before the coach's choices is stale now.
        var stored = await N4aLineAsync(admin, leaId, spaceA, line.Id);
        Assert.AreEqual(
            (line.Text, line.What, line.ShownOn, line.ConfirmedByName, line.ConfirmedAtUtc, line.RecordedAtUtc),
            (stored.Text, stored.What, stored.ShownOn, stored.ConfirmedByName, stored.ConfirmedAtUtc, stored.RecordedAtUtc));
        Assert.AreEqual(("Confirmed", true, on.Version), (stored.State, stored.CoachShows, stored.Version));
        await N4aAssertConflictAsync(
            await N4aTakeDownAsync(admin, leaId, spaceA, line.Id, line.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);

        // A line past confirmed, sent with the version it has now: its state, whichever way the switch goes. With
        // the version before its take-down, it is changed: the version is checked first.
        foreach (var (target, shown) in new[] { (waiting, false), (waiting, true), (takenDown, false), (takenDown, true) })
        {
            await N4aAssertConflictAsync(
                await N4bSetShownAsync(lea, target.Id, shown, target.Version),
                CoachCertificateText.StateCode,
                CoachCertificateText.ShownNotConfirmed);
        }

        await N4aAssertConflictAsync(
            await N4bSetShownAsync(lea, takenDown.Id, false, beforeDown.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);

        // Not hers in this space: another coach's line, the owner's, hers in her other space, an id that is no line.
        foreach (var (lineId, version, who) in new[]
        {
            (omars.Id, omars.Version, "another coach's line"),
            (owners.Id, owners.Version, "the owner's line"),
            (upInB.Id, upInB.Version, "her line in her other space"),
            (erased.Id, erased.Version, "her erased line in her other space"),
            (Guid.NewGuid(), on.Version, "an id that is no line"),
        })
        {
            var answer = await N4bSetShownAsync(lea, lineId, false, version);
            Assert.AreEqual(HttpStatusCode.NotFound, answer.StatusCode, $"{who}: {await answer.Content.ReadAsStringAsync()}");
        }

        await AssertStatusAsync(
            await lea.PutAsJsonAsync($"{N4bOwnUrl}/not-a-line/shown", new { shown = false, version = on.Version }),
            HttpStatusCode.NotFound);

        // The choice and the version must both be said, each refusal naming its field.
        Assert.AreEqual(
            CoachCertificateText.ShownRequired,
            await N4aRefusalAsync(await lea.PutAsJsonAsync(N4bShownUrl(line.Id), new { version = on.Version }), "shown"));
        Assert.AreEqual(
            CoachCertificateText.VersionRequired,
            await N4aRefusalAsync(await lea.PutAsJsonAsync(N4bShownUrl(line.Id), new { shown = false }), "version"));
        await N4aAssertInvalidAsync(await lea.PutAsJsonAsync(N4bShownUrl(line.Id), new { }), "shown", "version");
        await N4aAssertInvalidAsync(await N4bSetShownAsync(lea, line.Id, null, null), "shown", "version");

        // Under B's header the erased line is past any switch, and the line still up there switches.
        SetTenant(lea, spaceB);
        await N4aAssertConflictAsync(
            await N4bSetShownAsync(lea, erased.Id, false, erased.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.ShownNotConfirmed);
        var hiddenInB = await N4bShownAsync(lea, upInB.Id, false, upInB.Version);
        Assert.AreEqual((upInB.Id, false), (hiddenInB.Id, hiddenInB.CoachShows));

        // Nothing else moved: every other line keeps its state, its version and its switch.
        foreach (var (coachId, tenantId, before) in new[]
        {
            (leaId, spaceA, line with { CoachShows = true, Version = on.Version }),
            (leaId, spaceA, waiting),
            (leaId, spaceA, takenDown),
            (omarId, spaceA, omars),
            (ownerId, spaceA, owners),
            (leaId, spaceB, erased),
        })
        {
            var now = await N4aLineAsync(admin, coachId, tenantId, before.Id);
            Assert.AreEqual((before.State, before.Version, before.CoachShows), (now.State, now.Version, now.CoachShows), before.What ?? "the erased line");
        }
    }

    [TestMethod]
    public async Task N4bTheSwitchStaysOpenWhileAnUnpaidSpaceIsReadOnly()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-ro-owner@example.test", "Unpaid Owner", "N4b Unpaid Gym");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-ro-lea@example.test", "Lea Khoury");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(lea, client, "n4b-ro-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, clientId, BillingLocalDate());
        using var admin = await SignInPlatformAdminAsync("n4b-ro-admin@example.test");
        await RefreshCsrfAsync(admin);
        var line = await N4bConfirmedAsync(admin, leaId, spaceId, "NASM CPT, 2019", BillingLocalDate());

        // July's invoice is issued and never paid: seven days after its due date the space is read-only.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(BillingJuly);
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 15, 8, 0, 0, TimeSpan.Zero));
        await AssertReadOnlyAsync(await InviteForBillingAsync(lea, "n4b-ro-try@example.test"));
        Assert.IsTrue((await RequiredJsonAsync<BillingAccess>(await owner.GetAsync("/api/billing/access"))).IsReadOnly);

        // The coach still reads her lines and switches one off and on again; her client sees each choice at once.
        CollectionAssert.AreEqual(new[] { N4bOwnLineOf(line) }, await N4bOwnLinesAsync(lea));
        await RefreshCsrfAsync(lea);
        var hidden = await N4bShownAsync(lea, line.Id, false, line.Version);
        Assert.IsFalse(hidden.CoachShows);
        Assert.IsEmpty((await N4bOwnCoachAsync(client)).Lines);
        var shown = await N4bShownAsync(lea, line.Id, true, hidden.Version);
        Assert.IsTrue(shown.CoachShows);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(line) }, (await N4bOwnCoachAsync(client)).Lines);

        // Every other staff write in the space stays refused, the owner's too.
        await AssertReadOnlyAsync(await InviteForBillingAsync(lea, "n4b-ro-again@example.test"));
        await AssertReadOnlyAsync(await InviteForBillingAsync(owner, "n4b-ro-owner-try@example.test"));
    }

    [TestMethod]
    public async Task N4bAClientReadsTheLinesTheirCoachShowsAndNothingElseOldestFirst()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-client-owner@example.test", "Karim Haddad", "N4b Client Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-client-lea@example.test", "Lea Khoury");
        using var leasClient = CreateClient();
        await InviteAndAcceptAsync(lea, leasClient, "n4b-client-of-lea@example.test", true);
        using var ownersClient = CreateClient();
        await InviteAndAcceptAsync(owner, ownersClient, "n4b-client-of-owner@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n4b-client-admin@example.test");
        await RefreshCsrfAsync(admin);
        await RefreshCsrfAsync(lea);

        // Before any line: the coach's name and no lines, as the card was.
        var before = await N4bOwnCoachAsync(leasClient);
        Assert.AreEqual(("Lea Khoury", false), (before.Name, before.FoundingCoach));
        Assert.IsEmpty(before.Lines);

        // A line confirmed and erased on the coach's request straight from confirmed: never taken down, its
        // switch still on, and no words left.
        await N4bConfirmedAsync(admin, leaId, spaceId, "First aid course, 2012", today.AddDays(-60));
        Assert.AreEqual(new N4aErasure(1, 0), await RequiredJsonAsync<N4aErasure>(await N4aEraseAsync(admin, leaId, spaceId, today)));

        // Shown, waiting, taken down, switched off and shown again, a minute apart; the last one shown has the
        // earliest day, so the order is the order recorded.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var first = await N4bConfirmedAsync(admin, leaId, spaceId, "NASM CPT, 2019", today.AddDays(-4));
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await N4aAddedAsync(admin, leaId, spaceId, "Owns Iron Gym since 2015", today);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await N4bTakenDownAsync(admin, leaId, spaceId, "Coached for 8 years", today);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var switchedOff = await N4bConfirmedAsync(admin, leaId, spaceId, "ACE CPT, 2021", today);
        Assert.IsFalse((await N4bShownAsync(lea, switchedOff.Id, false, switchedOff.Version)).CoachShows);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var second = await N4bConfirmedAsync(admin, leaId, spaceId, "Precision Nutrition L1, 2022", today.AddDays(-30));
        var ownersLine = await N4bConfirmedAsync(admin, ownerId, spaceId, "Owns N4b Client Gym since 2018", today);

        // Lea's client reads her two shown lines, oldest first, each the sentence with its parts and nothing more.
        var response = await leasClient.GetAsync(N4bCoachUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var coach = await RequiredJsonAsync<N4bOwnCoach>(response);
        Assert.AreEqual(("Lea Khoury", false), (coach.Name, coach.FoundingCoach));
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(first), N4bCoachLineOf(second) }, coach.Lines);
        using (var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
        {
            CollectionAssert.AreEquivalent(N4bCoachFields, document.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
            foreach (var shownLine in document.RootElement.GetProperty("lines").EnumerateArray())
            {
                CollectionAssert.AreEquivalent(
                    N4bCoachLineFields,
                    shownLine.EnumerateObject().Select(property => property.Name).ToArray(),
                    "A client reads the sentence and its parts: never who confirmed it, an id or a version.");
            }
        }

        // The owner's client reads the owner's line alone.
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(ownersLine) }, (await N4bOwnCoachAsync(ownersClient)).Lines);

        // Switched off, a line leaves the client's card at once; switched on, it is back in its place.
        var hidden = await N4bShownAsync(lea, first.Id, false, first.Version);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(second) }, (await N4bOwnCoachAsync(leasClient)).Lines);
        await N4bShownAsync(lea, first.Id, true, hidden.Version);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(first), N4bCoachLineOf(second) }, (await N4bOwnCoachAsync(leasClient)).Lines);

        // Taken down, a line is gone for good.
        await N4aAnswerAsync(await N4aTakeDownAsync(admin, leaId, spaceId, second.Id, second.Version));
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(first) }, (await N4bOwnCoachAsync(leasClient)).Lines);

        // The sentence's day is written in the space's language, for the client and the coach alike.
        await AssertStatusAsync(await A16bSetLanguageAsync(owner, "ar-lb"), HttpStatusCode.OK);
        var arabic = N4aSentence("NASM CPT, 2019", today.AddDays(-4), "ar-LB");
        Assert.AreNotEqual(N4aSentence("NASM CPT, 2019", today.AddDays(-4), "en-LB"), arabic);
        CollectionAssert.AreEqual(
            new[] { new N4bCoachLine(arabic, "NASM CPT, 2019", today.AddDays(-4)) },
            (await N4bOwnCoachAsync(leasClient)).Lines);
        Assert.AreEqual(arabic, (await N4bOwnLinesAsync(lea)).Single(item => item.Id == first.Id).Text);
    }

    [TestMethod]
    public async Task N4bAClientInTheCoachsOtherSpaceReadsOnlyTheLinesRecordedThere()
    {
        var today = N4aStartAtMidday();
        using var ownerA = CreateClient();
        var spaceA = await RegisterCoachAsync(ownerA, "n4b-two-owner-a@example.test", "Karim Haddad", "N4b Two A");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(ownerA, lea, "n4b-two-lea@example.test", "Lea Khoury");
        using var clientA = CreateClient();
        await InviteAndAcceptAsync(lea, clientA, "n4b-two-client-a@example.test", true);
        using var ownerB = CreateClient();
        var spaceB = await RegisterCoachAsync(ownerB, "n4b-two-owner-b@example.test", "Rana Aoun", "N4b Two B");
        await B4bJoinSignedInAsCoachAsync(ownerB, lea, spaceB, "n4b-two-lea@example.test", "Lea");
        using var clientB = CreateClient();
        await InviteAndAcceptAsync(lea, clientB, "n4b-two-client-b@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n4b-two-admin@example.test");
        await RefreshCsrfAsync(admin);
        var inA = await N4bConfirmedAsync(admin, leaId, spaceA, "NASM CPT, 2019", today);

        // B's client reads Lea as their coach, and nothing of the line recorded in A.
        var nothingYet = await N4bOwnCoachAsync(clientB);
        Assert.AreEqual("Lea Khoury", nothingYet.Name);
        Assert.IsEmpty(nothingYet.Lines);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(inA) }, (await N4bOwnCoachAsync(clientA)).Lines);

        // A line recorded in B is for B's clients alone.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var inB = await N4bConfirmedAsync(admin, leaId, spaceB, "Coached at N4b Two B since 2020", today);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(inB) }, (await N4bOwnCoachAsync(clientB)).Lines);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(inA) }, (await N4bOwnCoachAsync(clientA)).Lines);

        // One account that is Lea's client in both spaces reads each space's line under that space's header.
        await InviteAndAcceptAsync(lea, clientA, "n4b-two-client-a@example.test", false);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(inB) }, (await N4bOwnCoachAsync(clientA)).Lines);
        SetTenant(clientA, spaceA);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(inA) }, (await N4bOwnCoachAsync(clientA)).Lines);

        // Switched off in A, it leaves A's card; B's line is untouched.
        SetTenant(lea, spaceA);
        await RefreshCsrfAsync(lea);
        await N4bShownAsync(lea, inA.Id, false, inA.Version);
        Assert.IsEmpty((await N4bOwnCoachAsync(clientA)).Lines);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(inB) }, (await N4bOwnCoachAsync(clientB)).Lines);
    }

    [TestMethod]
    public async Task N4bAReleasedClientIsRefusedAndAReturningOneReadsTheirNewCoachsLinesAlone()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-back-owner@example.test", "Karim Haddad", "N4b Back Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-back-lea@example.test", "Lea Khoury");
        using var client = CreateClient();
        var oldId = await InviteAndAcceptAsync(owner, client, "n4b-back-client@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n4b-back-admin@example.test");
        await RefreshCsrfAsync(admin);
        var ownersLine = await N4bConfirmedAsync(admin, ownerId, spaceId, "Owns N4b Back Gym since 2018", today);
        var leasLine = await N4bConfirmedAsync(admin, leaId, spaceId, "NASM CPT, 2019", today);

        // The owner's client reads the owner's line.
        var before = await N4bOwnCoachAsync(client);
        Assert.AreEqual("Karim Haddad", before.Name);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(ownersLine) }, before.Lines);

        // Released: refused at the door as every read of a released client is, so no line is read at all.
        await ReleaseAsync(owner, oldId, "Took a break");
        await AssertStatusAsync(await client.GetAsync(N4bCoachUrl), HttpStatusCode.Forbidden);

        // Invited back by Lea and accepted with the same account: a new profile, hers, while the ended one stays
        // the owner's.
        var newId = await InviteAndAcceptAsync(lea, client, "n4b-back-client@example.test", false);
        Assert.AreNotEqual(oldId, newId, "Coming back is a new relationship.");
        var ended = await RequiredJsonAsync<ReleasedDetails>(await owner.GetAsync($"/api/clients/{oldId}"));
        Assert.AreEqual((ownerId, true), (ended.AssignedCoachUserId, ended.Release is not null));
        var current = await RequiredJsonAsync<ReleasedDetails>(await owner.GetAsync($"/api/clients/{newId}"));
        Assert.AreEqual((leaId, false), (current.AssignedCoachUserId, current.Release is not null));

        // The current profile decides: the new coach's line, never the ended profile's coach's.
        var after = await N4bOwnCoachAsync(client);
        Assert.AreEqual("Lea Khoury", after.Name);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(leasLine) }, after.Lines);
    }

    [TestMethod]
    public async Task N4bAClientWhoseCoachLeftTheSpaceReadsNoLineOfTheirs()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-left-owner@example.test", "Karim Haddad", "N4b Left Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-left-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n4b-left-omar@example.test", "Omar Nassar");
        using var leasClient = CreateClient();
        await InviteAndAcceptAsync(lea, leasClient, "n4b-left-client-of-lea@example.test", true);
        using var omarsClient = CreateClient();
        await InviteAndAcceptAsync(omar, omarsClient, "n4b-left-client-of-omar@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n4b-left-admin@example.test");
        await RefreshCsrfAsync(admin);
        var ownersLine = await N4bConfirmedAsync(admin, ownerId, spaceId, "Owns N4b Left Gym since 2018", today);
        var leasLine = await N4bConfirmedAsync(admin, leaId, spaceId, "NASM CPT, 2019", today);
        var omarsLine = await N4bConfirmedAsync(admin, omarId, spaceId, "ACE CPT, 2021", today);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(leasLine) }, (await N4bOwnCoachAsync(leasClient)).Lines);
        CollectionAssert.AreEqual(new[] { N4bCoachLineOf(omarsLine) }, (await N4bOwnCoachAsync(omarsClient)).Lines);
        // The admin's page says what clients read, as the server decides it.
        Assert.IsTrue((await N4aLineAsync(admin, leaId, spaceId, leasLine.Id)).ShownToClients);

        // The owner removes Lea and Omar resigns: their clients move to the owner, whose line is the one they read.
        await RemoveCoachForBillingAsync(owner, leaId);
        await RefreshCsrfAsync(omar);
        await AssertStatusAsync(await omar.PostAsync("/api/team/me/resign", null), HttpStatusCode.OK);
        foreach (var movedClient in new[] { leasClient, omarsClient })
        {
            var coach = await N4bOwnCoachAsync(movedClient);
            Assert.AreEqual("Karim Haddad", coach.Name);
            CollectionAssert.AreEqual(new[] { N4bCoachLineOf(ownersLine) }, coach.Lines);
        }

        // Their lines are kept as they were, confirmed and switched on, and they can no longer reach them; the
        // admin's page reads them as shown to no client, as the server decides it.
        foreach (var (departedCoach, coachId, line) in new[] { (lea, leaId, leasLine), (omar, omarId, omarsLine) })
        {
            var kept = await N4aLineAsync(admin, coachId, spaceId, line.Id);
            Assert.AreEqual(
                ("Confirmed", true, false, line.Version),
                (kept.State, kept.CoachShows, kept.ShownToClients, kept.Version));
            await N4bAssertRefusedAsync(departedCoach, line.Id, line.Version, "a coach who left the space");
        }

        Assert.IsTrue((await N4aLineAsync(admin, ownerId, spaceId, ownersLine.Id)).ShownToClients);
    }

    [TestMethod]
    public async Task N4bTheKeepingSweepErasesEachLineTakenDownLongerAgoThanThePeriodInEverySpace()
    {
        // Midday, a whole minute: the instants the database keeps read back exactly, and months later the clock
        // is still at midday in the space, whatever its summer time.
        var today = N4aStartAtMidday();
        using var ownerA = CreateClient();
        var spaceA = await RegisterCoachAsync(ownerA, "n4b-sweep-owner-a@example.test", "Karim Haddad", "N4b Sweep A");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(ownerA, lea, "n4b-sweep-lea@example.test", "Lea Khoury");
        using var ownerB = CreateClient();
        var spaceB = await RegisterCoachAsync(ownerB, "n4b-sweep-owner-b@example.test", "Rana Aoun", "N4b Sweep B");
        var ranaId = await SignedInUserIdAsync(ownerB);
        using var admin = await SignInPlatformAdminAsync("n4b-sweep-admin@example.test");
        var adminId = await SignedInUserIdAsync(admin);
        var shownOn = today.AddDays(-4);
        await RefreshCsrfAsync(admin);
        await RefreshCsrfAsync(lea);

        // Taken down a minute after they were confirmed: two of Lea's lines in A, one she had switched off first,
        // and the owner's line in B.
        var dueInA = await N4bConfirmedAsync(admin, leaId, spaceA, "NASM CPT, 2019", shownOn);
        var dueOffInA = await N4bConfirmedAsync(admin, leaId, spaceA, "ACE CPT, 2021", shownOn);
        var dueInB = await N4bConfirmedAsync(admin, ranaId, spaceB, "Owns N4b Sweep B since 2016", shownOn);
        var offBeforeDown = await N4bShownAsync(lea, dueOffInA.Id, false, dueOffInA.Version);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var downA = await N4aAnswerAsync(await N4aTakeDownAsync(admin, leaId, spaceA, dueInA.Id, dueInA.Version));
        var downOffA = await N4aAnswerAsync(await N4aTakeDownAsync(admin, leaId, spaceA, dueOffInA.Id, offBeforeDown.Version));
        var downB = await N4aAnswerAsync(await N4aTakeDownAsync(admin, ranaId, spaceB, dueInB.Id, dueInB.Version));

        // A line still up, one the coach switched off, one waiting, and one that is taken down later.
        var up = await N4bConfirmedAsync(admin, leaId, spaceA, "Coached for 8 years", shownOn);
        var toSwitchOff = await N4bConfirmedAsync(admin, leaId, spaceA, "Precision Nutrition L1, 2022", shownOn);
        var off = await N4aLineAsync(admin, leaId, spaceA, (await N4bShownAsync(lea, toSwitchOff.Id, false, toSwitchOff.Version)).Id);
        var waiting = await N4aAddedAsync(admin, leaId, spaceA, "Owns Iron Gym since 2015", shownOn);
        var later = await N4bConfirmedAsync(admin, leaId, spaceA, "Kettlebell course, 2023", shownOn);

        // Two months on, the last one is taken down.
        RequiredTestClock.Set(RequiredTestClock.UtcNow.AddMonths(2));
        var laterDown = await N4aAnswerAsync(await N4aTakeDownAsync(admin, leaId, spaceA, later.Id, later.Version));

        // Eleven months more: three lines were taken down 13 months ago, the last one 11 months ago.
        RequiredTestClock.Set(RequiredTestClock.UtcNow.AddMonths(11));
        var sweptAt = RequiredTestClock.UtcNow;
        Assert.AreEqual(new CoachCertificateKeepingSweepResult(3, 2, 0), await N4bSweepAsync());

        // Each erased row, read straight from the table: the words, the day and who confirmed it gone; the reason
        // the keeping period, nobody who erased it and no request; the dates, who acted and the switch kept.
        foreach (var (down, coachId, tenantId, coachShows) in new[]
        {
            (downA, leaId, spaceA, true),
            (downOffA, leaId, spaceA, false),
            (downB, ranaId, spaceB, true),
        })
        {
            var because = down.What ?? "a taken-down line";
            var stored = await N4aStoredLineAsync(down.Id);
            Assert.AreEqual((string.Empty, (DateOnly?)null, string.Empty), (stored.What, stored.ShownOn, stored.ConfirmedByName), because);
            Assert.AreEqual(("KeepingPeriod", (Guid?)null, (DateOnly?)null), (stored.ErasureReason, stored.ErasedByUserId, stored.RequestedOn), because);
            Assert.AreEqual((DateTimeOffset?)sweptAt, stored.ErasedAtUtc, because);
            Assert.AreEqual(
                (down.ConfirmedAtUtc, down.TakenDownAtUtc, (Guid?)adminId),
                (stored.ConfirmedAtUtc, stored.TakenDownAtUtc, stored.TakenDownByUserId),
                because);
            Assert.AreEqual(
                (coachId, tenantId, adminId, coachShows),
                (stored.CoachUserId, stored.TenantId, stored.RecordedByUserId, stored.CoachShows),
                because);

            var read = await N4aLineAsync(admin, coachId, tenantId, down.Id);
            Assert.AreEqual(("Erased", "KeepingPeriod", (DateTimeOffset?)sweptAt), (read.State, read.ErasureReason, read.ErasedAtUtc), because);
            Assert.IsNull(read.ErasedByName, "Nobody erased it: the keeping period did.");
            Assert.IsNull(read.RequestedOn);
            Assert.IsNull(read.Text);
        }

        // The rest are untouched, each at the version it had: up, switched off, waiting, and taken down 11 months ago
        // with its words; the coach's own read no longer lists the erased lines.
        foreach (var kept in new[] { up, off, waiting, laterDown })
        {
            var because = kept.What ?? "a line not due";
            var now = await N4aLineAsync(admin, leaId, spaceA, kept.Id);
            Assert.AreEqual((kept.State, kept.What, kept.CoachShows, kept.Version), (now.State, now.What, now.CoachShows, now.Version), because);
            Assert.IsNull(now.ErasedAtUtc, because);
        }

        CollectionAssert.AreEquivalent(
            new[] { up.Id, off.Id, waiting.Id, laterDown.Id },
            (await N4bOwnLinesAsync(lea)).Select(item => item.Id).ToArray());

        // A second sweep finds nothing left to erase.
        Assert.AreEqual(new CoachCertificateKeepingSweepResult(0, 0, 0), await N4bSweepAsync());

        // Two months later the line taken down last has run out too; a line not taken down is never due.
        RequiredTestClock.Set(RequiredTestClock.UtcNow.AddMonths(2));
        Assert.AreEqual(new CoachCertificateKeepingSweepResult(1, 1, 0), await N4bSweepAsync());
        var lastStored = await N4aStoredLineAsync(laterDown.Id);
        Assert.AreEqual(("KeepingPeriod", string.Empty, (DateTimeOffset?)RequiredTestClock.UtcNow), (lastStored.ErasureReason, lastStored.What, lastStored.ErasedAtUtc));
        foreach (var kept in new[] { up, off, waiting })
        {
            var now = await N4aLineAsync(admin, leaId, spaceA, kept.Id);
            Assert.AreEqual((kept.State, kept.Version), (now.State, now.Version), kept.What ?? "a line not due");
        }

        // Each sweep that erased something said so, in counts alone.
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("Certificate keeping sweep: 3 taken-down lines erased in 2 coaching spaces.", log);
        Assert.Contains("Certificate keeping sweep: 1 taken-down lines erased in 1 coaching spaces.", log);
    }

    [TestMethod]
    public async Task N4bTheWorkersKeepingSweepErasesADueLineAsItStartsAndNothingWhileSwitchedOff()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-worker-owner@example.test", "Karim Haddad", "N4b Worker Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4b-worker-admin@example.test");
        await RefreshCsrfAsync(admin);
        var line = await N4bTakenDownAsync(admin, ownerId, spaceId, "NASM CPT, 2019", today);
        RequiredTestClock.Set(RequiredTestClock.UtcNow.AddMonths(13));
        var scopes = RequiredFactory.Services.GetRequiredService<IServiceScopeFactory>();
        var logger = RequiredFactory.Services.GetRequiredService<ILogger<TB.Gym.Worker.CoachCertificateKeepingWorker>>();

        // Switched off by its setting, the Worker says so and erases nothing.
        using (var switchedOff = new TB.Gym.Worker.CoachCertificateKeepingWorker(
                   scopes,
                   Microsoft.Extensions.Options.Options.Create(new CoachCertificateOptions { SweepEnabled = false }),
                   logger))
        {
            await switchedOff.StartAsync(CancellationToken.None);
            await (switchedOff.ExecuteTask ?? Task.CompletedTask);
            await switchedOff.StopAsync(CancellationToken.None);
        }

        Assert.AreEqual(0L, await N4bErasedCountAsync(line.Id));
        Assert.Contains("The certificate keeping sweep is disabled by configuration.", RequiredEveryLogLine.Text);

        // Switched on, it sweeps once as it starts, on the host's own clock and keeping period.
        using var worker = new TB.Gym.Worker.CoachCertificateKeepingWorker(
            scopes,
            Microsoft.Extensions.Options.Options.Create(new CoachCertificateOptions { SweepIntervalSeconds = 3_600 }),
            logger);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (await N4bErasedCountAsync(line.Id) == 0 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(100);
            }
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }

        var stored = await N4aStoredLineAsync(line.Id);
        Assert.AreEqual(("KeepingPeriod", string.Empty, (Guid?)null), (stored.ErasureReason, stored.What, stored.ErasedByUserId));
        Assert.AreEqual((DateTimeOffset?)RequiredTestClock.UtcNow, stored.ErasedAtUtc);
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("Certificate keeping sweep: 1 taken-down lines erased in 1 coaching spaces.", log);
        Assert.DoesNotContain("The certificate keeping sweep failed", log);
    }

    [TestMethod]
    public async Task N4bNeitherALinesWordsNorWhoConfirmedItReachTheLogWhenShownSwitchedOrSwept()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-log-owner@example.test", "Karim Haddad", "N4b Log Gym");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n4b-log-lea@example.test", "Lea Khoury");
        using var client = CreateClient();
        await InviteAndAcceptAsync(lea, client, "n4b-log-client@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n4b-log-admin@example.test");
        var wordsMarker = Guid.NewGuid().ToString("N");
        var nameMarker = Guid.NewGuid().ToString("N");
        var confirmer = $"Confirmer{nameMarker}";
        await RefreshCsrfAsync(admin);
        var shown = await N4bConfirmedAsync(admin, leaId, spaceId, $"Marker{wordsMarker} CPT", today, confirmer);
        var waiting = await N4aAddedAsync(admin, leaId, spaceId, $"Marker{wordsMarker} course", today);
        await N4bTakenDownAsync(admin, leaId, spaceId, $"Marker{wordsMarker} gym", today, confirmer);

        // The coach reads her lines and flips one, a stale flip, a waiting line and a missing choice refused.
        await RefreshCsrfAsync(lea);
        Assert.HasCount(3, await N4bOwnLinesAsync(lea));
        var hidden = await N4bShownAsync(lea, shown.Id, false, shown.Version);
        await N4aAssertConflictAsync(
            await N4bSetShownAsync(lea, shown.Id, true, shown.Version),
            CoachCertificateText.ChangedCode,
            CoachCertificateText.Changed);
        await N4aAssertConflictAsync(
            await N4bSetShownAsync(lea, waiting.Id, false, waiting.Version),
            CoachCertificateText.StateCode,
            CoachCertificateText.ShownNotConfirmed);
        await N4aAssertInvalidAsync(await N4bSetShownAsync(lea, shown.Id, null, hidden.Version), "shown");
        await N4bShownAsync(lea, shown.Id, true, hidden.Version);

        // The client reads the sentence, words and all.
        Assert.Contains(wordsMarker, (await N4bOwnCoachAsync(client)).Lines.Single().Text);

        // Thirteen months on, the sweep erases the line taken down.
        RequiredTestClock.Set(RequiredTestClock.UtcNow.AddMonths(13));
        Assert.AreEqual(new CoachCertificateKeepingSweepResult(1, 1, 0), await N4bSweepAsync());

        // Every line logged, with the exception any of them carried: the requests (logged by their route) and the
        // sweep were logged, so the markers' absence means something.
        var log = RequiredEveryLogLine.Text;
        Assert.Contains($"GET {N4bOwnUrl}", log, "The coach's read was logged.");
        Assert.Contains($"PUT {N4bOwnUrl}/{{lineId:guid}}/shown", log, "The switch was logged.");
        Assert.Contains($"GET {N4bCoachUrl}", log, "The client's read was logged.");
        Assert.Contains("Certificate keeping sweep: 1 taken-down lines erased in 1 coaching spaces.", log);
        Assert.DoesNotContain(wordsMarker, log, StringComparison.OrdinalIgnoreCase, "A line's words reached the log.");
        Assert.DoesNotContain(nameMarker, log, StringComparison.OrdinalIgnoreCase, "Who confirmed a line reached the log.");
    }

    [TestMethod]
    public async Task N4bTwoSwitchesOfOneLineAtOnceLeaveOneChange()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-race-owner@example.test", "Karim Haddad", "N4b Race Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4b-race-admin@example.test");
        await RefreshCsrfAsync(admin);
        var line = await N4bConfirmedAsync(admin, ownerId, spaceId, "Owns N4b Race Gym since 2018", Phase6WorkspaceToday());

        // A double press on another page: both read the same version and both switch the line off. Both are held
        // at their update until both are past the version check, so the row's version decides.
        await RefreshCsrfAsync(owner);
        RequiredInsertBarrier.Arm("UPDATE identity.\"CoachCertificateLines\"", 2, "UPDATE");
        HttpResponseMessage[] answers;
        try
        {
            answers = await Task.WhenAll(
                N4bSetShownAsync(owner, line.Id, false, line.Version),
                N4bSetShownAsync(owner, line.Id, false, line.Version));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two switches never raced.");
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
        var winner = await RequiredJsonAsync<N4bOwnLine>(answers.Single(answer => answer.StatusCode == HttpStatusCode.OK));
        CollectionAssert.AreEqual(new[] { winner }, await N4bOwnLinesAsync(owner));
        Assert.IsFalse(winner.CoachShows);
    }

    [TestMethod]
    public async Task N4bTheKeepingSweepRacingAnErasureOnRequestLeavesOneErasure()
    {
        var today = N4aStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n4b-sweep-race-owner@example.test", "Karim Haddad", "N4b Sweep Race Gym");
        var ownerId = await SignedInUserIdAsync(owner);
        using var admin = await SignInPlatformAdminAsync("n4b-sweep-race-admin@example.test");
        await RefreshCsrfAsync(admin);
        var line = await N4bTakenDownAsync(admin, ownerId, spaceId, "NASM CPT, 2019", today);
        RequiredTestClock.Set(RequiredTestClock.UtcNow.AddMonths(13));

        // The coach's request arrives as the keeping period runs out: both are held at their update until both have
        // read the line, so the row's version decides, and the one that loses reads again and finds nothing left.
        RequiredInsertBarrier.Arm("UPDATE identity.\"CoachCertificateLines\"", 2, "UPDATE");
        CoachCertificateKeepingSweepResult swept;
        HttpResponseMessage erase;
        try
        {
            var sweep = N4bSweepAsync();
            var request = N4aEraseAsync(admin, ownerId, spaceId, Phase6WorkspaceToday());
            await Task.WhenAll(sweep, request);
            (swept, erase) = (await sweep, await request);
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The sweep and the erasure never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        await AssertStatusAsync(erase, HttpStatusCode.OK);
        var erasure = await RequiredJsonAsync<N4aErasure>(erase);
        Assert.AreEqual(1, swept.Erased + erasure.Erased, $"The sweep answered {swept}, the request {erasure}.");
        Assert.AreEqual((0, 0, swept.Erased), (swept.Skipped, erasure.Dropped, swept.Spaces), "Counts only, of the winner.");
        var stored = await N4aStoredLineAsync(line.Id);
        Assert.AreEqual(swept.Erased == 1 ? "KeepingPeriod" : "Request", stored.ErasureReason);
        Assert.AreEqual((string.Empty, (DateOnly?)null, string.Empty), (stored.What, stored.ShownOn, stored.ConfirmedByName));
        Assert.AreEqual(1L, await N4bErasedCountAsync(line.Id));
    }

    // ---------- shown certificate helpers ----------

    private static string N4bShownUrl(Guid lineId) => $"{N4bOwnUrl}/{lineId}/shown";

    private static Task<HttpResponseMessage> N4bSetShownAsync(HttpClient coach, Guid lineId, bool? shown, uint? version) =>
        coach.PutAsJsonAsync(N4bShownUrl(lineId), new { shown, version });

    /// <summary>The coach's switch, answered 200 with the line.</summary>
    private static async Task<N4bOwnLine> N4bShownAsync(HttpClient coach, Guid lineId, bool shown, uint version)
    {
        var response = await N4bSetShownAsync(coach, lineId, shown, version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N4bOwnLine>(response);
    }

    private static async Task<N4bOwnLine[]> N4bOwnLinesAsync(HttpClient coach)
    {
        var response = await coach.GetAsync(N4bOwnUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<N4bOwnLines>(response)).Lines;
    }

    private static async Task<N4bOwnCoach> N4bOwnCoachAsync(HttpClient client)
    {
        var response = await client.GetAsync(N4bCoachUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N4bOwnCoach>(response);
    }

    /// <summary>Both of the coach's routes refuse <paramref name="caller"/> with 403, a fresh token or not.</summary>
    private static async Task N4bAssertRefusedAsync(HttpClient caller, Guid lineId, uint version, string who)
    {
        await RefreshCsrfAsync(caller);
        var read = await caller.GetAsync(N4bOwnUrl);
        Assert.AreEqual(HttpStatusCode.Forbidden, read.StatusCode, $"The read by {who}: {await read.Content.ReadAsStringAsync()}");
        var write = await N4bSetShownAsync(caller, lineId, false, version);
        Assert.AreEqual(HttpStatusCode.Forbidden, write.StatusCode, $"The switch by {who}: {await write.Content.ReadAsStringAsync()}");
    }

    /// <summary>A line the admin added and confirmed, as the confirmation answered it.</summary>
    private static async Task<N4aLine> N4bConfirmedAsync(
        HttpClient admin,
        Guid coachId,
        Guid spaceId,
        string what,
        DateOnly shownOn,
        string confirmedByName = "Rami Saade")
    {
        var added = await N4aAddedAsync(admin, coachId, spaceId, what, shownOn);
        return await N4aAnswerAsync(await N4aConfirmAsync(admin, coachId, spaceId, added.Id, confirmedByName, added.Version));
    }

    /// <summary>A line the admin added, confirmed and took down, as the take-down answered it.</summary>
    private static async Task<N4aLine> N4bTakenDownAsync(
        HttpClient admin,
        Guid coachId,
        Guid spaceId,
        string what,
        DateOnly shownOn,
        string confirmedByName = "Rami Saade")
    {
        var confirmed = await N4bConfirmedAsync(admin, coachId, spaceId, what, shownOn, confirmedByName);
        return await N4aAnswerAsync(await N4aTakeDownAsync(admin, coachId, spaceId, confirmed.Id, confirmed.Version));
    }

    /// <summary>What the coach's own read says of a line the admin answered with: the sentence of wording version 1.</summary>
    private static N4bOwnLine N4bOwnLineOf(N4aLine line) => new(
        line.Id,
        line.State,
        N4aSentence(line.What!, line.ShownOn!.Value, "en-LB"),
        line.What!,
        line.ShownOn!.Value,
        1,
        line.ConfirmedOn,
        line.TakenDownOn,
        line.CoachShows,
        line.Version);

    /// <summary>What a client of the coach reads of a line the admin answered with.</summary>
    private static N4bCoachLine N4bCoachLineOf(N4aLine line) =>
        new(N4aSentence(line.What!, line.ShownOn!.Value, "en-LB"), line.What!, line.ShownOn!.Value);

    /// <summary>The keeping sweep as the Worker runs it, from a scope of its own on the test host.</summary>
    private async Task<CoachCertificateKeepingSweepResult> N4bSweepAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ICoachCertificateKeepingSweep>().RunAsync(CancellationToken.None);
    }

    /// <summary>When the line's row was last written and by whom, read straight from the table.</summary>
    private async Task<(DateTimeOffset UpdatedAtUtc, Guid? UpdatedByUserId)> N4bUpdatedAsync(Guid lineId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """SELECT "UpdatedAtUtc", "UpdatedByUserId" FROM identity."CoachCertificateLines" WHERE "Id" = @id""";
        command.Parameters.AddWithValue("id", lineId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync(), "The line's row is there.");
        return (reader.GetFieldValue<DateTimeOffset>(0), reader.IsDBNull(1) ? null : reader.GetGuid(1));
    }

    private Task<long> N4bErasedCountAsync(Guid lineId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM identity."CoachCertificateLines" WHERE "Id" = @id AND "ErasedAtUtc" IS NOT NULL""",
        lineId);

    private sealed record N4bOwnLines(N4bOwnLine[] Lines);
    private sealed record N4bOwnLine(
        Guid Id,
        string State,
        string Text,
        string What,
        DateOnly ShownOn,
        int WordingVersion,
        DateOnly? ConfirmedOn,
        DateOnly? TakenDownOn,
        bool CoachShows,
        uint Version);
    private sealed record N4bOwnCoach(string Name, bool FoundingCoach, N4bCoachLine[] Lines);
    private sealed record N4bCoachLine(string Text, string What, DateOnly ShownOn);
}
