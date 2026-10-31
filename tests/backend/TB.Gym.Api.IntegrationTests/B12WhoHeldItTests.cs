using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B12, who held a session (SES-003, SES-008): the gym owner says who held it, a coach logs only their own, the
/// ledger keeps both people, and Today, This month and the pack's History read who held it. Every test sets the frozen
/// clock to a fixed day at midday in the workspace's zone.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly DateOnly B12Day = new(2026, 10, 12);

    [TestMethod]
    public async Task B12TheOwnerSaysWhoHeldASessionAndItCountsForThem()
    {
        var team = await B12TeamAsync("held");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;

        // Lea's client: Omar stands in for her, Lea holds one, and the owner holds one themselves, named or not.
        var byOmar = await B10bRecordAsync(owner, team.MayaId, B12Day, note: "Stood in for Lea", heldBy: team.OmarId);
        var entry = byOmar.Sessions!.Entries.Single(item => item.Kind == SessionEntryKind.Held);
        Assert.AreEqual(("Omar Nasser", "Hicham Haddad", "Stood in for Lea"), (entry.CoachName, entry.RecordedByName, entry.Note));
        await B10bRecordAsync(owner, team.MayaId, B12Day, heldBy: team.LeaId);
        var named = await B10bRecordAsync(owner, team.MayaId, B12Day, heldBy: team.OwnerId);
        Assert.AreEqual(3, named.Sessions!.Held);
        var own = await B10bRecordAsync(owner, team.MayaId, B12Day);

        // The two people differ only on the rows the owner recorded for someone else.
        var who = own.Sessions!.Entries
            .Where(item => item.Kind == SessionEntryKind.Held)
            .Select(item => $"{item.CoachName} / {item.RecordedByName}")
            .Order(StringComparer.Ordinal);
        Assert.AreEqual(
            "Hicham Haddad / , Hicham Haddad / , Lea Khoury / Hicham Haddad, Omar Nasser / Hicham Haddad",
            string.Join(", ", who));

        // Each session counts for who held it, on Today and on This month, the owner's rows adding up.
        Assert.AreEqual(1, (await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).Month.SessionsHeld);
        Assert.AreEqual(1, (await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl)).Month.SessionsHeld, "Maya isn't Omar's, and it counts for him.");
        Assert.AreEqual(4, (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.SessionsHeld);
        Assert.AreEqual(1, (await ReadSliceAsync<CoachMonthReportView>(lea, CoachMonthUrl)).ThisMonth.SessionsHeld);
        Assert.AreEqual(1, (await ReadSliceAsync<CoachMonthReportView>(omar, CoachMonthUrl)).ThisMonth.SessionsHeld);
        var page = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual(4, page.ThisMonth.SessionsHeld);
        Assert.AreEqual(
            "Hicham Haddad 2, Lea Khoury 1, Omar Nasser 1",
            string.Join(", ", page.Coaches!.Select(row => $"{row.Name} {row.ThisMonth.SessionsHeld}")));
        B10dAssertRowsAddUp(page);

        // Undone, it counts for nobody, whoever holds the Undo.
        await B10bVoidOkAsync(lea, team.MayaId, entry.Id, Guid.NewGuid());
        Assert.AreEqual(0, (await ReadSliceAsync<CoachMonthReportView>(omar, CoachMonthUrl)).ThisMonth.SessionsHeld);

        // The client's coach reads both names on the History; the client reads neither.
        var history = (await B10bPackViewAsync(lea, team.MayaId, own.Id)).Entries.Single(item => item.Id == entry.Id);
        Assert.AreEqual(("Omar Nasser", "Hicham Haddad"), (history.CoachName, history.RecordedByName));
        B10aAssertNotIn(await maya.GetStringAsync(OwnPlansUrl), "Omar", "Hicham", "Stood in for Lea");
    }

    [TestMethod]
    public async Task B12ACoachLogsOnlyTheirOwnSessions()
    {
        var team = await B12TeamAsync("own");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;

        // Past the screen, the server refuses another name from a coach, the owner's and a colleague's alike.
        foreach (var someoneElse in new[] { team.OmarId, team.OwnerId })
        {
            var refused = await A7ConflictAsync(await B10bPostSessionAsync(lea, team.MayaId, B12Day, heldBy: someoneElse));
            Assert.AreEqual(
                ("session_held_by_someone_else", "A coach records their own sessions. The owner records one that someone else held."),
                refused);
        }

        // Another coach's client still reads as missing: the name changes nothing about that.
        await AssertStatusAsync(await B10bPostSessionAsync(omar, team.MayaId, B12Day, heldBy: team.LeaId), HttpStatusCode.NotFound);
        Assert.AreEqual(10, (await B10bPackViewAsync(lea, team.MayaId, team.PackId)).Left, "Nothing was recorded.");

        // Their own name is no one else's, and with none the session is theirs.
        var named = await B10bRecordAsync(lea, team.MayaId, B12Day, heldBy: team.LeaId);
        var unnamed = await B10bRecordAsync(lea, team.MayaId, B12Day);
        Assert.AreEqual((1, 2), (named.Sessions!.Held, unnamed.Sessions!.Held));
        foreach (var entry in unnamed.Sessions.Entries.Where(item => item.Kind == SessionEntryKind.Held))
        {
            Assert.AreEqual(("Lea Khoury", null), (entry.CoachName, entry.RecordedByName));
        }
    }

    [TestMethod]
    public async Task B12ANoShowKeepsWhoRecordedItAndNamesNobody()
    {
        var team = await B12TeamAsync("charge");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;

        // A charge is no session held: a name sent with one means nothing, the coach's and the owner's alike.
        var byLea = await B10bRecordAsync(lea, team.MayaId, B12Day, "Charged", reason: "No-show", heldBy: team.OmarId);
        var byOwner = await B10bRecordAsync(owner, team.MayaId, B12Day, "Charged", reason: "Late cancel", heldBy: team.OmarId);
        Assert.AreEqual(2, byOwner.Sessions!.Charged);
        Assert.AreEqual(9, byLea.Sessions!.Left);
        Assert.AreEqual(
            "Hicham Haddad / , Lea Khoury / ",
            string.Join(", ", byOwner.Sessions.Entries
                .Where(item => item.Kind == SessionEntryKind.Charged)
                .Select(item => $"{item.CoachName} / {item.RecordedByName}")
                .Order(StringComparer.Ordinal)));
        Assert.AreEqual(0, (await ReadSliceAsync<CoachMonthReportView>(omar, CoachMonthUrl)).ThisMonth.SessionsHeld);
        Assert.AreEqual(0, (await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl)).ThisMonth.SessionsHeld);
    }

    [TestMethod]
    public async Task B12OnlyActiveStaffOfTheWorkspaceCanHoldASession()
    {
        var team = await B12TeamAsync("staff");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b12-staff-stranger@example.test", "Other Owner", "B12 Elsewhere");
        var strangerId = await B12UserIdAsync(stranger);

        // Omar leaves the team, and his membership stays behind him.
        B4aSetWorkspaceClock(B12Day, new TimeOnly(13, 0));
        var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == team.OmarId);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{team.OmarId}/remove", new { version = member.Version }),
            HttpStatusCode.OK);

        var mayasUserId = await B12UserIdAsync(maya);
        foreach (var nobody in new[] { team.OmarId, mayasUserId, strangerId, Guid.NewGuid(), Guid.Empty })
        {
            var refused = await A7ConflictAsync(await B10bPostSessionAsync(owner, team.MayaId, B12Day, heldBy: nobody));
            Assert.AreEqual("session_holder_not_staff", refused.Code, $"{nobody}");
            StringAssert.Contains(refused.Message, "Choose someone on your team.");
        }

        Assert.AreEqual(10, (await B10bPackViewAsync(owner, team.MayaId, team.PackId)).Left, "Nothing was recorded.");

        // A pack still waiting for its money takes neither the session nor the money when the name is refused.
        var single = await B10bPackProductAsync(owner, "B12 Single", B10bPackOffer(1, 30, 35m));
        var waiting = await A7EnrollAsync(owner, team.MayaId, single.Offers[0].Id, B12Day);
        await AssertStatusAsync(
            await B10bPostSessionAsync(owner, team.MayaId, B12Day, receipt: B10bCash(35m), heldBy: team.OmarId),
            HttpStatusCode.Conflict);
        Assert.AreEqual(0m, (await ReadSliceAsync<ClientCommercialOverview>(owner, $"/api/commercial/clients/{team.MayaId}"))
            .Enrollments.Single(item => item.Id == waiting.Id).PaidAmount);

        // Nobody signed in and the client on the coach's route answer as ever, with a name or none.
        using var anonymous = CreateClient();
        SetTenant(anonymous, team.TenantId);
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(
            await B10bSendSessionAsync(anonymous, team.MayaId, B12Day, heldBy: team.LeaId),
            HttpStatusCode.Unauthorized);
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(
            await B10bSendSessionAsync(maya, team.MayaId, B12Day, heldBy: team.LeaId),
            HttpStatusCode.Forbidden);

        // Another workspace knows neither the client nor its people, and its own header proves nothing.
        await AssertStatusAsync(await B10bPostSessionAsync(stranger, team.MayaId, B12Day, heldBy: strangerId), HttpStatusCode.NotFound);
        SetTenant(stranger, team.TenantId);
        await AssertStatusAsync(await B10bPostSessionAsync(stranger, team.MayaId, B12Day, heldBy: team.LeaId), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task B12ATapRepeatedTakesOneSessionAndAKeyIsBoundToWhoHeldIt()
    {
        var team = await B12TeamAsync("key");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;
        var key = Guid.NewGuid();

        // The token is refreshed once, ahead of the race, as the sheet's one tap is.
        await RefreshCsrfAsync(owner);
        var raced = await Task.WhenAll(Enumerable.Range(0, 4)
            .Select(_ => B10bSendSessionAsync(owner, team.MayaId, B12Day, note: "One", key: key, heldBy: team.OmarId)));
        foreach (var response in raced)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        Assert.AreEqual(1, (await B10bPackViewAsync(owner, team.MayaId, team.PackId)).Held);

        // The same entry again, once settled, answers with what it did; Omar's name is what it was recorded with.
        var retried = await B10bRecordAsync(owner, team.MayaId, B12Day, note: "One", key: key, heldBy: team.OmarId);
        Assert.AreEqual(9, retried.Sessions!.Left);

        // Another name on that key is another session, however the name is said.
        foreach (var other in new Guid?[] { team.LeaId, team.OwnerId, null })
        {
            Assert.AreEqual(
                "idempotency_key_reused",
                (await A7ConflictAsync(await B10bPostSessionAsync(owner, team.MayaId, B12Day, note: "One", key: key, heldBy: other))).Code);
        }

        // And a retry after Omar left still says what it did: nothing new is asked of him.
        B4aSetWorkspaceClock(B12Day, new TimeOnly(13, 0));
        var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == team.OmarId);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{team.OmarId}/remove", new { version = member.Version }),
            HttpStatusCode.OK);
        var later = await B10bRecordAsync(owner, team.MayaId, B12Day, note: "One", key: key, heldBy: team.OmarId);
        Assert.AreEqual(1, later.Sessions!.Held);
    }

    [TestMethod]
    public async Task B12ACoachRemovedWhileASessionIsRecordedForThemEndsOneWayOrTheOther()
    {
        var team = await B12TeamAsync("race");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;

        for (var round = 0; round < 4; round++)
        {
            using var standIn = CreateClient();
            var standInId = await JoinAsCoachAsync(owner, standIn, $"b12-race-coach-{round}@example.test", $"Stand In {round}");
            var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == standInId);
            await RefreshCsrfAsync(owner);

            var removal = owner.PostAsJsonAsync($"/api/team/members/{standInId}/remove", new { version = member.Version });
            var recording = B10bSendSessionAsync(owner, team.MayaId, B12Day, heldBy: standInId);
            await Task.WhenAll(removal, recording);

            await AssertStatusAsync(await removal, HttpStatusCode.OK);
            var recorded = await recording;
            Assert.IsTrue(
                recorded.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict,
                $"Round {round}: {recorded.StatusCode}");
            if (recorded.StatusCode == HttpStatusCode.Conflict)
            {
                Assert.AreEqual("session_holder_not_staff", (await A7ConflictAsync(recorded)).Code);
            }

            // Whichever went first, they are gone now and a session can't be put on them.
            Assert.AreEqual(
                "session_holder_not_staff",
                (await A7ConflictAsync(await B10bPostSessionAsync(owner, team.MayaId, B12Day, heldBy: standInId))).Code);
        }
    }

    [TestMethod]
    public async Task B12TheDatabaseHoldsBothPeopleWhoeverWrites()
    {
        var team = await B12TeamAsync("sql");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;
        var mayasUserId = await B12UserIdAsync(maya);
        var recorded = await B10bRecordAsync(owner, team.MayaId, B12Day, heldBy: team.LeaId);
        var heldId = recorded.Sessions!.Entries.Single(item => item.Kind == SessionEntryKind.Held).Id;
        var issuedId = recorded.Sessions.Entries.Single(item => item.Kind == SessionEntryKind.Issued).Id;

        string Row(string kind, Guid? coachUser, Guid? recorder, string? reason = null, Guid? voids = null) =>
            $"""
            INSERT INTO subscriptions."SessionLedgerEntries"
                ("Id", "TenantId", "EnrollmentId", "ClientProfileId", "Kind", "Count", "Day", "CoachUserId", "RecordedByUserId", "Reason", "VoidsEntryId", "IdempotencyKey")
            SELECT '{Guid.NewGuid()}', "TenantId", '{team.PackId}', '{team.MayaId}', '{kind}', 1, '{B10bDay(B12Day)}',
                {(coachUser is { } id ? $"'{id}'" : "NULL")}, {(recorder is { } person ? $"'{person}'" : "NULL")}, {(reason is null ? "NULL" : $"'{reason}'")}, {(voids is { } target ? $"'{target}'" : "NULL")}, '{Guid.NewGuid()}'
            FROM subscriptions."ClientEnrollments" WHERE "Id" = '{team.PackId}'
            """;

        // A session from now on keeps who recorded it and names active staff: the guard refuses the rest.
        foreach (var sql in new[]
        {
            Row("Held", team.LeaId, null),
            Row("Charged", team.LeaId, null, "No-show"),
            Row("Held", mayasUserId, team.OwnerId),
            Row("Held", Guid.NewGuid(), team.OwnerId),
        })
        {
            var refused = await A7RefusedAsync(sql);
            Assert.AreEqual("23514", refused.SqlState, sql);
            Assert.IsNull(refused.ConstraintName, sql);
        }

        // The table's own check: only a session names who recorded it, and a charge's coach is the one who did.
        foreach (var sql in new[]
        {
            Row("Charged", team.LeaId, team.OwnerId, "No-show"),
            Row("Voided", null, team.OwnerId, voids: heldId),
        })
        {
            Assert.AreEqual("CK_SessionLedgerEntries_RecordedBy", (await A7RefusedAsync(sql)).ConstraintName, sql);
        }

        // Who recorded it is a member of this workspace, however the row arrives.
        Assert.AreEqual("23503", (await A7RefusedAsync(Row("Held", team.LeaId, Guid.NewGuid()))).SqlState);

        // Both people stay as written: the ledger is append-only.
        foreach (var sql in new[]
        {
            $"UPDATE subscriptions.\"SessionLedgerEntries\" SET \"CoachUserId\" = '{team.OmarId}' WHERE \"Id\" = '{heldId}'",
            $"UPDATE subscriptions.\"SessionLedgerEntries\" SET \"RecordedByUserId\" = '{team.LeaId}' WHERE \"Id\" = '{heldId}'",
            $"UPDATE subscriptions.\"SessionLedgerEntries\" SET \"RecordedByUserId\" = NULL WHERE \"Id\" = '{heldId}'",
            $"UPDATE subscriptions.\"SessionLedgerEntries\" SET \"RecordedByUserId\" = '{team.OwnerId}' WHERE \"Id\" = '{issuedId}'",
        })
        {
            Assert.AreEqual("55000", (await A7RefusedAsync(sql)).SqlState, sql);
        }
    }

    [TestMethod]
    public async Task B12TheMigrationLeavesASessionFromBeforeItWithWhoRecordedItAsWhoHeldIt()
    {
        var team = await B12TeamAsync("before");
        using var owner = team.Owner;
        using var lea = team.Lea;
        using var omar = team.Omar;
        using var maya = team.Maya;

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_SessionHeldAndRecordedBy", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Before the column, a row knew one person: who recorded it. Reverted, the guard asks for no one else.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A7ScalarAsync("SELECT count(*) FROM information_schema.columns WHERE table_name = 'SessionLedgerEntries' AND column_name = 'RecordedByUserId'"));
        var entryId = Guid.NewGuid();
        await A7SqlAsync($"""
            INSERT INTO subscriptions."SessionLedgerEntries"
                ("Id", "TenantId", "EnrollmentId", "ClientProfileId", "Kind", "Count", "Day", "CoachUserId", "IdempotencyKey")
            SELECT '{entryId}', "TenantId", "Id", "ClientProfileId", 'Held', 1, '{B10bDay(B12Day)}', '{team.LeaId}', '{Guid.NewGuid()}'
            FROM subscriptions."ClientEnrollments" WHERE "Id" = '{team.PackId}'
            """);

        // Every migration back on, nothing touched it and a session holds as ever.
        await migrator.MigrateAsync();
        Assert.AreEqual(1L, await A7ScalarAsync($"SELECT count(*) FROM subscriptions.\"SessionLedgerEntries\" WHERE \"Id\" = '{entryId}' AND \"RecordedByUserId\" IS NULL"));
        var history = (await B10bPackViewAsync(owner, team.MayaId, team.PackId)).Entries.Single(item => item.Id == entryId);
        Assert.AreEqual(("Lea Khoury", null), (history.CoachName, history.RecordedByName));
        Assert.AreEqual(1, (await ReadSliceAsync<CoachMonthReportView>(lea, CoachMonthUrl)).ThisMonth.SessionsHeld);
        Assert.AreEqual(1, (await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).Month.SessionsHeld);

        var next = await B10bRecordAsync(owner, team.MayaId, B12Day, heldBy: team.LeaId);
        Assert.AreEqual(2, next.Sessions!.Held);
        Assert.AreEqual(8, next.Sessions.Left);
    }

    /// <summary>The owner, Lea and Omar; Maya, Lea's client, on a free pack of ten, on the frozen day.</summary>
    private async Task<B12Team> B12TeamAsync(string slug)
    {
        B4aSetWorkspaceClock(B12Day, new TimeOnly(12, 0));
        var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, $"b12-{slug}-owner@example.test", "Hicham Haddad", $"B12 {slug}");
        var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, $"b12-{slug}-lea@example.test", "Lea Khoury");
        var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, $"b12-{slug}-omar@example.test", "Omar Nasser");
        var ownerId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, $"b12-{slug}-maya@example.test", "Maya", "Rahman");
        var product = await B10bPackProductAsync(owner, $"B12 Pack {slug}", B10bPackOffer(10, 90, 0m));
        var pack = await A7EnrollAsync(owner, mayaId, product.Offers[0].Id, B12Day);
        return new B12Team(tenant, owner, ownerId, lea, leaId, omar, omarId, maya, mayaId, pack.Id);
    }

    private static async Task<Guid> B12UserIdAsync(HttpClient person) =>
        (await person.GetFromJsonAsync<B12Me>("/api/auth/me") ?? throw new AssertFailedException("Nobody is signed in.")).Id;

    private sealed record B12Team(
        Guid TenantId,
        HttpClient Owner,
        Guid OwnerId,
        HttpClient Lea,
        Guid LeaId,
        HttpClient Omar,
        Guid OmarId,
        HttpClient Maya,
        Guid MayaId,
        Guid PackId);

    private sealed record B12Me(Guid Id);
}
