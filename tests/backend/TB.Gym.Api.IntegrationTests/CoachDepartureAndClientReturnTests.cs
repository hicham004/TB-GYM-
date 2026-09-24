using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Coach departure and client choice (ADR 0026/0027, 2026-09-24): a coach can resign, their clients
/// are told in-app and by email, a client can leave on their own, and a former client can be invited
/// back as a new relationship while the old record stays read-only.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task CoachResignsAndEachOfTheirClientsIsToldInAppAndByEmail()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "resign-owner@example.test", "Resign Owner", "Resign Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "resign-coach@example.test", "Rhea Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "resign-client@example.test", true);
        await InviteClientAsync(coach, "resign-pending@example.test");
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;

        // The owner cannot resign, since a workspace always has one; a client cannot use the route.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsync("/api/team/me/resign", null), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync("/api/team/me/resign", null), HttpStatusCode.Forbidden);

        await RefreshCsrfAsync(coach);
        var resigned = await coach.PostAsync("/api/team/me/resign", null);
        await AssertStatusAsync(resigned, HttpStatusCode.OK);
        var outcome = await RequiredJsonAsync<TeamRemoval>(resigned);
        Assert.AreEqual(1, outcome.ReassignedClientCount);
        Assert.AreEqual(1, outcome.ReassignedInvitationCount);
        await AssertStatusAsync(await coach.GetAsync("/api/clients"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsync("/api/team/me/resign", null), HttpStatusCode.Forbidden);

        // The client moves to the owner, recorded as a resignation by the coach themselves.
        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
        Assert.AreEqual("CoachResigned", history[^1].Reason);
        Assert.AreEqual(coachUserId, history[^1].PreviousCoachUserId);
        Assert.AreEqual(ownerUserId, history[^1].CoachUserId);
        Assert.AreEqual(coachUserId, history[^1].AssignedByUserId);

        // Told in-app ...
        await SweepDepartureNotificationsAsync();
        var inbox = await RequiredJsonAsync<DepartureInbox>(await client.GetAsync("/api/notifications"));
        var told = inbox.Items.Single(item => item.Kind == "CoachDeparted");
        Assert.AreEqual("Your coach has changed", told.Title);
        StringAssert.Contains(told.Body, "assign you a new coach");

        // ... and by one email that names nobody.
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        var mail = CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice);
        Assert.AreEqual("resign-client@example.test", mail.RecipientAddress);
        Assert.AreEqual("Your coach on TB Gym has changed", mail.Subject);
        Assert.DoesNotContain("Rhea", mail.TextBody);
        Assert.DoesNotContain("Resign Gym", mail.TextBody);
        Assert.AreEqual(0, (await SweepWorkspaceNoticesAsync()).Total, "Told once.");
    }

    [TestMethod]
    public async Task RemovingACoachTellsOnlyTheirOwnClients()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "rmtell-owner@example.test", "Owner", "Tell Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "rmtell-coach@example.test", "Tell Coach");
        using var coachesClient = CreateClient();
        await InviteAndAcceptAsync(coach, coachesClient, "rmtell-a@example.test", true);
        using var ownersClient = CreateClient();
        await InviteAndAcceptAsync(owner, ownersClient, "rmtell-b@example.test", true);
        var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == coachUserId);

        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version }),
            HttpStatusCode.OK);

        await SweepDepartureNotificationsAsync();
        var told = await RequiredJsonAsync<DepartureInbox>(await coachesClient.GetAsync("/api/notifications"));
        Assert.HasCount(1, told.Items.Where(item => item.Kind == "CoachDeparted"));
        var untouched = await RequiredJsonAsync<DepartureInbox>(await ownersClient.GetAsync("/api/notifications"));
        Assert.IsFalse(untouched.Items.Any(item => item.Kind == "CoachDeparted"), "The owner's own client kept their coach.");

        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        Assert.AreEqual(
            "rmtell-a@example.test",
            CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice).RecipientAddress);
    }

    [TestMethod]
    public async Task AClientLeavesAndTheOwnerAndTheirCoachAreToldInApp()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "leave-owner@example.test", "Leave Owner", "Leave Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "leave-coach@example.test", "Leave Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "leave-client@example.test", true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        var self = await RequiredJsonAsync<SelfProfile>(await client.GetAsync("/api/client-profile/me"));

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/client-profile/me/leave", new { reason = "Moving abroad", version = self.Version + 1 }),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/client-profile/me/leave", new { reason = "Moving abroad", version = self.Version }),
            HttpStatusCode.NoContent);

        // Out at once; the owner keeps the record, marked as the client's own decision.
        await AssertStatusAsync(await client.GetAsync("/api/client-profile/me"), HttpStatusCode.Forbidden);
        var former = (await owner.GetFromJsonAsync<DepartedClient[]>("/api/clients/former") ?? []).Single(item => item.Id == clientId);
        Assert.AreEqual("LeftByClient", former.DepartureKind);
        Assert.AreEqual("Moving abroad", former.Reason);
        var details = await RequiredJsonAsync<DepartedDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
        Assert.AreEqual("LeftByClient", details.Release!.DepartureKind);
        Assert.AreEqual("Training Client", details.Release.ReleasedByName);

        // Same ending as a release: open work closed with its own reason, history kept, read-only.
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM subscriptions."ClientEnrollments"
                WHERE "Id" = @id AND "Status" = 'Cancelled' AND "StatusReason" = 'Closed because the client left the workspace.'
                """,
                resources.Enrollment.Id));
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM training."Mesocycles" WHERE "Id" = @id AND "Status" = 'Cancelled'""",
                block.Id));
        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
        Assert.AreEqual("ClientLeft", history[^1].Reason);
        Assert.AreEqual(coachUserId, history[^1].PreviousCoachUserId);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync($"/api/clients/{clientId}/coach-notes", new { notes = "x", version = details.Version }),
            HttpStatusCode.Conflict);

        // The owner and the coach are told in-app; the client, who did it, is not emailed.
        await SweepDepartureNotificationsAsync();
        foreach (var staff in new[] { owner, coach })
        {
            var inbox = await RequiredJsonAsync<DepartureInbox>(await staff.GetAsync("/api/notifications"));
            Assert.AreEqual("A client left the workspace", inbox.Items.Single(item => item.Kind == "ClientLeft").Title);
        }

        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM tenancy."NoticeMailRequests" WHERE "SubjectId" = @id""",
                clientId));
    }

    [TestMethod]
    public async Task AFormerClientCanBeInvitedBackAsANewRelationship()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "back-owner@example.test", "Owner", "Return Gym");
        using var client = CreateClient();
        var oldId = await InviteAndAcceptAsync(owner, client, "back-client@example.test", true);
        await GrantFreeFeaturesAsync(owner, oldId, "Messaging");
        var oldThread = await StartChatAsync(owner, oldId);
        await SendChatAsync(client, oldThread, "See you later");
        await ReleaseAsync(owner, oldId, "Took a break");

        // Invited back and accepted with the same account.
        var link = await InviteClientAsync(owner, "back-client@example.test");
        await RefreshCsrfAsync(client);
        var accepted = await client.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token = QueryValue(link, "token"), displayName = (string?)null, password = (string?)null });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var newId = (await RequiredJsonAsync<TeamAcceptance>(accepted)).ClientProfileId!.Value;
        Assert.AreNotEqual(oldId, newId, "Coming back is a new relationship.");
        SetTenant(client, tenant);

        // Every self-service lookup resolves the new profile, not the old one.
        var self = await RequiredJsonAsync<SelfProfile>(await client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual(newId, self.Id);
        foreach (var url in new[] { "/api/client-access/me", "/api/training/me/today", "/api/training/me/upcoming", "/api/progress/me" })
        {
            await AssertStatusAsync(await client.GetAsync(url), HttpStatusCode.OK);
        }

        // These answer by the new profile's own access (none yet), which is a 403 or 404 by design; a
        // lookup that still matched both profiles would fail with a 500 instead.
        foreach (var url in new[] { $"/api/nutrition/me/day?localDate={TenantToday():yyyy-MM-dd}", "/api/checkins/me/assignments" })
        {
            Assert.AreNotEqual(HttpStatusCode.InternalServerError, (await client.GetAsync(url)).StatusCode, url);
        }

        // The old relationship's chat stays with the owner's record.
        Assert.IsFalse((await ChatListAsync(client)).Items.Any(item => item.Id == oldThread));
        await AssertStatusAsync(
            await client.GetAsync($"/api/messaging/conversations/{oldThread}/messages"),
            HttpStatusCode.NotFound);

        // The owner sees the new client as current and the old record as former, still read-only.
        Assert.IsTrue((await owner.GetFromJsonAsync<TeamClient[]>("/api/clients") ?? []).Any(item => item.Id == newId));
        var former = await owner.GetFromJsonAsync<DepartedClient[]>("/api/clients/former") ?? [];
        Assert.IsTrue(former.Any(item => item.Id == oldId));
        Assert.IsFalse(former.Any(item => item.Id == newId));
        var oldDetails = await RequiredJsonAsync<DepartedDetails>(await owner.GetAsync($"/api/clients/{oldId}"));
        var newDetails = await RequiredJsonAsync<DepartedDetails>(await owner.GetAsync($"/api/clients/{newId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync($"/api/clients/{oldId}/coach-notes", new { notes = "x", version = oldDetails.Version }),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync($"/api/clients/{newId}/coach-notes", new { notes = "Welcome back", version = newDetails.Version }),
            HttpStatusCode.OK);

        // One membership row, active again; two profiles, the old one ended.
        var userId = (await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{newId}"))).UserId!.Value;
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM tenancy."Memberships" WHERE "UserId" = @id AND "Status" = 'Active' AND "Role" = 'Client'""",
                userId));
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM clients."ClientProfiles" WHERE "UserId" = @id AND "ReleasedAtUtc" IS NOT NULL""",
                userId));
    }

    // ---------- departure helpers ----------

    private async Task SweepDepartureNotificationsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<INotificationDispatchService>().DispatchDueAsync(CancellationToken.None);
    }

    private sealed record SelfProfile(Guid Id, uint Version);
    private sealed record DepartureNotification(string Kind, string Title, string Body);
    private sealed record DepartureInbox(DepartureNotification[] Items);
    private sealed record DepartedRelease(string Reason, string ReleasedByName, string DepartureKind);
    private sealed record DepartedDetails(Guid Id, uint Version, DepartedRelease? Release);
    private sealed record DepartedClient(Guid Id, string Reason, string DepartureKind);
}
