using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Security;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Gym team support (ADR 0026): coach invitations, one coach per client, owner-only reassignment and
/// removal, and a Coach who sees and acts only on their own clients — enforced by the API and backed
/// by the database. Runs in the Phase 3 harness because it needs its full composition: training,
/// progress photos, commercial, messaging and media together.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task TeamOwnerInvitesACoachAndEachCoachSeesOnlyTheirOwnClients()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "team-owner@example.test", "Olivia Owner", "Team Gym");
        using var ownersClient = CreateClient();
        var ownersClientId = await InviteAndAcceptAsync(owner, ownersClient, "team-client-a@example.test", true);

        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "team-coach@example.test", "Cara Coach");
        var memberships = await coach.GetFromJsonAsync<TeamWorkspace[]>("/api/tenants")
            ?? throw new AssertFailedException("The coach has no workspaces.");
        Assert.AreEqual("Coach", memberships.Single(item => item.TenantId == tenant).Role);

        // A client the coach invites is the coach's client.
        using var coachesClient = CreateClient();
        var coachesClientId = await InviteAndAcceptAsync(coach, coachesClient, "team-client-b@example.test", true);

        var coachList = await coach.GetFromJsonAsync<TeamClient[]>("/api/clients")
            ?? throw new AssertFailedException("Coach client list was empty.");
        Assert.AreEqual(coachesClientId, coachList.Single().Id, "A Coach lists only their own clients.");
        Assert.AreEqual(coachUserId, coachList.Single().AssignedCoachUserId);

        var ownerList = await owner.GetFromJsonAsync<TeamClient[]>("/api/clients")
            ?? throw new AssertFailedException("Owner client list was empty.");
        Assert.HasCount(2, ownerList, "The Owner sees every client.");
        Assert.AreEqual("Cara Coach", ownerList.Single(item => item.Id == coachesClientId).AssignedCoachName);
        Assert.AreEqual("Olivia Owner", ownerList.Single(item => item.Id == ownersClientId).AssignedCoachName);

        await AssertStatusAsync(await coach.GetAsync($"/api/clients/{ownersClientId}"), HttpStatusCode.NotFound);
        await AssertStatusAsync(await coach.GetAsync($"/api/clients/{coachesClientId}"), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync($"/api/clients/{coachesClientId}"), HttpStatusCode.OK);

        // Client invitations follow the same split; coach invitations never appear among them.
        var coachInvitations = await coach.GetFromJsonAsync<TeamInvitation[]>("/api/invitations")
            ?? throw new AssertFailedException("Coach invitations were empty.");
        Assert.AreEqual("team-client-b@example.test", coachInvitations.Single().Email);
        var ownerInvitations = await owner.GetFromJsonAsync<TeamInvitation[]>("/api/invitations")
            ?? throw new AssertFailedException("Owner invitations were empty.");
        Assert.HasCount(2, ownerInvitations);
        Assert.IsTrue(ownerInvitations.All(item => item.Kind == "Client"));

        var team = await TeamMembersAsync(owner);
        Assert.HasCount(2, team);
        Assert.AreEqual(1, team.Single(member => member.Role == "Owner").AssignedClientCount);
        Assert.AreEqual(1, team.Single(member => member.UserId == coachUserId).AssignedClientCount);

        // Team management is the owner's alone.
        await AssertStatusAsync(await coach.GetAsync("/api/team/members"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coach.GetAsync("/api/team/invitations"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coachesClient.GetAsync("/api/team/members"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync("/api/team/invitations", new { email = "x@example.test", firstName = "X", lastName = "Y" }),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/clients/{coachesClientId}/coach", new { coachUserId, version = 0u }),
            HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task TeamACoachIsRefusedEverywhereOnAnotherCoachsClientUntilReassigned()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "scope-owner@example.test", "Owner", "Scope Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "scope-client@example.test", true);
        var resources = await CreateTrainingResourcesAsync(owner, clientId, 8, 1, TenantToday());
        var block = await AssignAsync(owner, clientId, resources, TenantToday());
        var schedule = await RequiredJsonAsync<Mesocycle>(
            await owner.GetAsync($"/api/training/mesocycles/{block.Id}"));
        await RefreshCsrfAsync(client);
        var started = await client.PostAsync($"/api/training/me/sessions/{schedule.Weeks[0].Sessions[0].Id}/start", null);
        await AssertStatusAsync(started, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(started);
        var photo = await UploadProgressPhotoAsync(
            owner,
            $"/api/progress/clients/{clientId}/photos?pose=Front&photoDate={TenantToday():yyyy-MM-dd}");

        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "scope-coach@example.test", "Scope Coach");

        // Every route that names the client, in every module, answers like a missing client.
        string[] reads =
        [
            $"/api/clients/{clientId}",
            $"/api/commercial/clients/{clientId}",
            $"/api/training/clients/{clientId}/mesocycles",
            $"/api/training/mesocycles/{block.Id}",
            $"/api/training/clients/{clientId}/workouts/{execution.Id}",
            $"/api/training/clients/{clientId}/exercises/{resources.Exercise.Id}/history",
            $"/api/strength/clients/{clientId}/maxes",
            $"/api/nutrition/clients/{clientId}/plans",
            $"/api/checkins/clients/{clientId}/assignments",
            $"/api/checkins/clients/{clientId}/checkin-comparison",
            $"/api/progress/clients/{clientId}",
            $"/api/progress/clients/{clientId}/measurements",
            $"/api/progress/clients/{clientId}/photos",
            $"/api/progress/clients/{clientId}/dashboard",
        ];
        foreach (var url in reads)
        {
            await AssertStatusAsync(await coach.GetAsync(url), HttpStatusCode.NotFound);
            Assert.AreNotEqual(
                HttpStatusCode.NotFound,
                (await owner.GetAsync(url)).StatusCode,
                $"The owner must reach {url}, or the refusal above proves nothing.");
        }

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/clients/{clientId}/coach-notes", new { notes = "mine now", version = 0u }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/progress/clients/{clientId}/bodyweight",
                new { value = 80m, unit = "Kilogram", measurementDate = TenantToday() }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/visibility", new { revealAllWeeks = true, version = 0u }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { text = "not my client" }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{resources.Enrollment.Id}/pause",
                new { reason = "Not my client", version = resources.Enrollment.Version }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{resources.Enrollment.Id}/payments",
                new
                {
                    amount = 10m,
                    currencyCode = "USD",
                    receivedAtUtc = DateTimeOffset.UtcNow,
                    method = "Cash",
                    reference = (string?)null,
                    note = (string?)null,
                    idempotencyKey = Guid.NewGuid(),
                }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                "/api/messaging/conversations",
                new { clientProfileId = clientId, idempotencyKey = Guid.NewGuid() }),
            HttpStatusCode.NotFound);
        await AssertPhotoReadableAsync(coach, photo.MediaAssetId, expected: false);
        await AssertPhotoReadableAsync(owner, photo.MediaAssetId, expected: true);

        // The owner moves the client to the coach; the coach now gets exactly the owner's answer on
        // every route (a feature the client has no entitlement for is refused to both alike).
        await ReassignAsync(owner, clientId, coachUserId, "Better schedule fit");
        foreach (var url in reads)
        {
            Assert.AreEqual(
                (await owner.GetAsync(url)).StatusCode,
                (await coach.GetAsync(url)).StatusCode,
                $"After reassignment the coach and the owner disagree about {url}.");
        }

        await AssertStatusAsync(await coach.GetAsync($"/api/training/mesocycles/{block.Id}"), HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { text = "now mine" }),
            HttpStatusCode.OK);
        await AssertPhotoReadableAsync(coach, photo.MediaAssetId, expected: true);

        // And the owner still sees everything.
        await AssertStatusAsync(await owner.GetAsync($"/api/training/mesocycles/{block.Id}"), HttpStatusCode.OK);
        await AssertPhotoReadableAsync(owner, photo.MediaAssetId, expected: true);
    }

    [TestMethod]
    public async Task TeamReassigningMovesTheChatToReadOnlyAndKeepsAnAppendOnlyHistory()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "chat-owner@example.test", "Owner", "Chat Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "chat-coach@example.test", "Chat Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "chat-client@example.test", true);
        SetTenant(client, tenant);
        await GrantFreeFeaturesAsync(coach, clientId, "Messaging");

        var oldThread = await StartChatAsync(coach, clientId);
        await SendChatAsync(coach, oldThread, "Welcome aboard");
        await SendChatAsync(client, oldThread, "Thanks coach");

        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        var moved = await ReassignAsync(owner, clientId, ownerUserId, "Coach is on leave");
        Assert.AreEqual(ownerUserId, moved.AssignedCoachUserId);

        // The old coach loses the client and the thread, including its unread badge.
        Assert.IsEmpty(await coach.GetFromJsonAsync<TeamClient[]>("/api/clients") ?? []);
        await AssertStatusAsync(
            await coach.GetAsync($"/api/messaging/conversations/{oldThread}/messages"),
            HttpStatusCode.NotFound);
        Assert.IsEmpty((await ChatListAsync(coach)).Items);
        Assert.AreEqual(0L, (await coach.GetFromJsonAsync<TeamUnread>("/api/messaging/unread-count"))!.Unread);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                "/api/messaging/conversations",
                new { clientProfileId = clientId, idempotencyKey = Guid.NewGuid() }),
            HttpStatusCode.NotFound);

        // The client keeps the history, read-only.
        var clientThreads = (await ChatListAsync(client)).Items;
        Assert.IsTrue(clientThreads.Single(item => item.Id == oldThread).IsReadOnly);
        await AssertStatusAsync(
            await client.GetAsync($"/api/messaging/conversations/{oldThread}/messages"),
            HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        var refused = await client.PostAsJsonAsync(
            $"/api/messaging/conversations/{oldThread}/messages",
            new { body = "Are you there?", idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "messaging_conversation_read_only");

        // The new coach starts a fresh thread and does not see the old one.
        var newThread = await StartChatAsync(owner, clientId);
        Assert.AreNotEqual(oldThread, newThread);
        await AssertStatusAsync(
            await owner.GetAsync($"/api/messaging/conversations/{oldThread}/messages"),
            HttpStatusCode.NotFound);
        await SendChatAsync(client, newThread, "Hello new coach");
        Assert.IsFalse((await ChatListAsync(client)).Items.Single(item => item.Id == newThread).IsReadOnly);

        // History: the invitation, then the reassignment with its note and actor.
        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
        Assert.HasCount(2, history);
        Assert.AreEqual("Invitation", history[0].Reason);
        Assert.AreEqual(coachUserId, history[0].CoachUserId);
        Assert.AreEqual("Reassigned", history[1].Reason);
        Assert.AreEqual(coachUserId, history[1].PreviousCoachUserId);
        Assert.AreEqual(ownerUserId, history[1].CoachUserId);
        Assert.AreEqual("Coach is on leave", history[1].Note);
        Assert.AreEqual(ownerUserId, history[1].AssignedByUserId);
        // No longer their client, so it answers like a missing one before the owner-only rule does.
        await AssertStatusAsync(
            await coach.GetAsync($"/api/clients/{clientId}/coach-assignments"),
            HttpStatusCode.NotFound);

        // Reassigning back reopens the old thread for the old coach, because nothing was deleted.
        await ReassignAsync(owner, clientId, coachUserId, null);
        await AssertStatusAsync(
            await coach.GetAsync($"/api/messaging/conversations/{oldThread}/messages"),
            HttpStatusCode.OK);
        Assert.IsFalse((await ChatListAsync(client)).Items.Single(item => item.Id == oldThread).IsReadOnly);
    }

    [TestMethod]
    public async Task TeamReassignmentValidatesTheCoachTheVersionAndTheWorkspace()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "rv-owner@example.test", "Owner", "Validation Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "rv-client@example.test", true);
        using var other = CreateClient();
        var otherClientId = await InviteAndAcceptAsync(owner, other, "rv-other@example.test", true);
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "rv-coach@example.test", "RV Coach");
        var details = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
        var otherUserId = (await RequiredJsonAsync<TeamClientDetails>(
            await owner.GetAsync($"/api/clients/{otherClientId}"))).UserId!.Value;

        await RefreshCsrfAsync(owner);
        // Not staff: another client of the same workspace, and a stranger.
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/coach", new { coachUserId = otherUserId, version = details.Version }),
            HttpStatusCode.BadRequest);
        using var foreignOwner = CreateClient();
        await RegisterCoachAsync(foreignOwner, "rv-foreign@example.test", "Foreign", "Foreign Gym");
        var foreignOwnerId = (await TeamMembersAsync(foreignOwner)).Single().UserId;
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/coach", new { coachUserId = foreignOwnerId, version = details.Version }),
            HttpStatusCode.BadRequest);

        // Another workspace's owner cannot reach this client at all.
        await RefreshCsrfAsync(foreignOwner);
        await AssertStatusAsync(
            await foreignOwner.PostAsJsonAsync($"/api/clients/{clientId}/coach", new { coachUserId = foreignOwnerId, version = details.Version }),
            HttpStatusCode.NotFound);

        // A stale screen conflicts rather than overwriting a newer assignment.
        await ReassignAsync(owner, clientId, coachUserId, null);
        await RefreshCsrfAsync(owner);
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/coach", new { coachUserId = ownerUserId, version = details.Version }),
            HttpStatusCode.Conflict);

        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
        Assert.HasCount(2, history, "Refused attempts leave no history.");
    }

    [TestMethod]
    public async Task TeamRemovingACoachMovesTheirClientsAndPendingInvitationsToTheOwner()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "rm-owner@example.test", "Owner", "Removal Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "rm-coach@example.test", "Leaving Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "rm-client@example.test", true);
        var pendingLink = await InviteClientAsync(coach, "rm-pending@example.test");
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == coachUserId);

        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version + 1 }),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{ownerUserId}/remove", new { version = 0u }),
            HttpStatusCode.NotFound);

        var removed = await owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version });
        await AssertStatusAsync(removed, HttpStatusCode.OK);
        var outcome = await RequiredJsonAsync<TeamRemoval>(removed);
        Assert.AreEqual(1, outcome.ReassignedClientCount);
        Assert.AreEqual(1, outcome.ReassignedInvitationCount);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version }),
            HttpStatusCode.NotFound);

        // The coach is out of the workspace immediately; the client and their data stay.
        await AssertStatusAsync(await coach.GetAsync("/api/clients"), HttpStatusCode.Forbidden);
        Assert.HasCount(1, await TeamMembersAsync(owner));
        var details = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
        Assert.AreEqual(ownerUserId, details.AssignedCoachUserId);
        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
        Assert.AreEqual("CoachRemoved", history[^1].Reason);
        Assert.AreEqual(coachUserId, history[^1].PreviousCoachUserId);
        await AssertStatusAsync(await client.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);

        // The pending invitation still works and lands with the owner.
        using var late = CreateClient();
        var lateClientId = await AcceptClientLinkAsync(late, pendingLink);
        var lateDetails = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{lateClientId}"));
        Assert.AreEqual(ownerUserId, lateDetails.AssignedCoachUserId);

        // A removed coach can be invited back; their old clients stay where the owner put them.
        await RefreshCsrfAsync(owner);
        var again = await owner.PostAsJsonAsync(
            "/api/team/invitations",
            new { email = "rm-coach@example.test", firstName = "Leaving", lastName = "Coach" });
        await AssertStatusAsync(again, HttpStatusCode.Created);
        var link = (await RequiredJsonAsync<TeamInvitation>(again)).DevelopmentActionUrl!;
        await RefreshCsrfAsync(coach);
        var rejoined = await coach.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token = QueryValue(link, "token"), displayName = (string?)null, password = (string?)null });
        await AssertStatusAsync(rejoined, HttpStatusCode.OK);
        Assert.AreEqual("Coach", (await RequiredJsonAsync<TeamAcceptance>(rejoined)).Kind);
        SetTenant(coach, tenant);
        Assert.IsEmpty(await coach.GetFromJsonAsync<TeamClient[]>("/api/clients") ?? []);
        Assert.HasCount(2, await TeamMembersAsync(owner));
    }

    [TestMethod]
    public async Task TeamCoachInvitationsAreSeparateFromClientInvitationsAndRefuseExistingMembers()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "inv-owner@example.test", "Owner", "Invite Gym");
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "inv-client@example.test", true);

        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync("/api/team/invitations", new { email = "inv-client@example.test", firstName = "A", lastName = "B" }),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync("/api/team/invitations", new { email = "inv-owner@example.test", firstName = "A", lastName = "B" }),
            HttpStatusCode.Conflict);

        var created = await owner.PostAsJsonAsync(
            "/api/team/invitations",
            new { email = "inv-coach@example.test", firstName = "Ina", lastName = "Coach" });
        await AssertStatusAsync(created, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<TeamInvitation>(created);
        Assert.AreEqual("Coach", invitation.Kind);

        // A coach invitation is not a client invitation, on either list or on either route.
        Assert.IsTrue((await owner.GetFromJsonAsync<TeamInvitation[]>("/api/invitations"))!.All(item => item.Kind == "Client"));
        Assert.AreEqual(invitation.Id, (await owner.GetFromJsonAsync<TeamInvitation[]>("/api/team/invitations"))!.Single().Id);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/invitations/{invitation.Id}/revoke", new { version = invitation.Version }),
            HttpStatusCode.NotFound);

        // The public page says what the invitation is for.
        var details = await RequiredJsonAsync<TeamPublicInvitation>(await CreateClient().GetAsync(
            $"/api/invitations/public/{Uri.EscapeDataString(QueryValue(invitation.DevelopmentActionUrl!, "token"))}"));
        Assert.AreEqual("Coach", details.Kind);

        // Resend kills the old link; revoke kills the new one.
        var resent = await owner.PostAsJsonAsync(
            $"/api/team/invitations/{invitation.Id}/resend",
            new { idempotencyKey = Guid.NewGuid(), version = invitation.Version });
        await AssertStatusAsync(resent, HttpStatusCode.OK);
        var current = await RequiredJsonAsync<TeamInvitation>(resent);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/team/invitations/{invitation.Id}/revoke", new { version = current.Version }),
            HttpStatusCode.OK);
        using var invitee = CreateClient();
        await RefreshCsrfAsync(invitee);
        await AssertStatusAsync(
            await invitee.PostAsJsonAsync(
                "/api/invitations/accept",
                new { token = QueryValue(current.DevelopmentActionUrl!, "token"), displayName = "Ina", password = Password }),
            HttpStatusCode.Gone);

        // Another workspace's owner cannot touch this workspace's coach invitations.
        using var foreignOwner = CreateClient();
        await RegisterCoachAsync(foreignOwner, "inv-foreign@example.test", "Foreign", "Foreign Invite Gym");
        await RefreshCsrfAsync(foreignOwner);
        await AssertStatusAsync(
            await foreignOwner.PostAsJsonAsync(
                $"/api/team/invitations/{invitation.Id}/resend",
                new { idempotencyKey = Guid.NewGuid(), version = current.Version }),
            HttpStatusCode.NotFound);
        Assert.IsEmpty(await foreignOwner.GetFromJsonAsync<TeamInvitation[]>("/api/team/invitations") ?? []);

        // A coach who already owns a workspace signs in and joins a second one as a coach.
        await RefreshCsrfAsync(owner);
        var existing = await owner.PostAsJsonAsync(
            "/api/team/invitations",
            new { email = "inv-foreign@example.test", firstName = "Foreign", lastName = "Owner" });
        await AssertStatusAsync(existing, HttpStatusCode.Created);
        var existingLink = (await RequiredJsonAsync<TeamInvitation>(existing)).DevelopmentActionUrl!;
        await RefreshCsrfAsync(foreignOwner);
        await AssertStatusAsync(
            await foreignOwner.PostAsJsonAsync(
                "/api/invitations/accept",
                new { token = QueryValue(existingLink, "token"), displayName = (string?)null, password = (string?)null }),
            HttpStatusCode.OK);
        var workspaces = await foreignOwner.GetFromJsonAsync<TeamWorkspace[]>("/api/tenants") ?? [];
        Assert.HasCount(2, workspaces);
        Assert.AreEqual("Coach", workspaces.Single(item => item.TenantId == tenant).Role);
    }

    [TestMethod]
    public async Task TeamRemovingACoachWhileTheirClientAcceptsNeverStrandsTheClient()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "race-owner@example.test", "Owner", "Race Gym");
        var ownerUserId = (await TeamMembersAsync(owner)).Single().UserId;

        for (var round = 0; round < 4; round++)
        {
            using var coach = CreateClient();
            var coachUserId = await JoinAsCoachAsync(owner, coach, $"race-coach-{round}@example.test", $"Race Coach {round}");
            var link = await InviteClientAsync(coach, $"race-client-{round}@example.test");
            var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == coachUserId);
            using var invitee = CreateClient();
            await RefreshCsrfAsync(invitee);
            await RefreshCsrfAsync(owner);

            var removal = owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version });
            var acceptance = invitee.PostAsJsonAsync(
                "/api/invitations/accept",
                new { token = QueryValue(link, "token"), displayName = "Race Client", password = Password });
            await Task.WhenAll(removal, acceptance);

            await AssertStatusAsync(await removal, HttpStatusCode.OK);
            await AssertStatusAsync(await acceptance, HttpStatusCode.OK);
            var clientId = (await RequiredJsonAsync<TeamAcceptance>(await acceptance)).ClientProfileId!.Value;
            var details = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
            Assert.AreEqual(ownerUserId, details.AssignedCoachUserId, $"Round {round}: the client landed with a removed coach.");
        }

        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM clients."ClientProfiles" AS client
                WHERE @id = @id AND NOT EXISTS (
                    SELECT 1 FROM tenancy."Memberships" AS membership
                    WHERE membership."TenantId" = client."TenantId"
                      AND membership."UserId" = client."AssignedCoachUserId"
                      AND membership."Status" = 'Active')
                """,
                Guid.Empty),
            "Every client's coach is active staff.");
    }

    [TestMethod]
    public async Task TeamTheDatabaseRefusesUnrecordedCoachChangesAndOrphanedClients()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "db-owner@example.test", "Owner", "Guard Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "db-client@example.test", true);
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "db-coach@example.test", "Guard Coach");
        await ReassignAsync(owner, clientId, coachUserId, null);

        // A coach change without a history entry.
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        await AssertSqlStateAsync(
            "23514",
            """UPDATE clients."ClientProfiles" SET "AssignedCoachUserId" = @owner WHERE "Id" = @client""",
            ("owner", ownerUserId),
            ("client", clientId));

        // The history is append-only.
        await AssertSqlStateAsync(
            "55000",
            """UPDATE clients."ClientCoachAssignments" SET "Note" = 'rewritten' WHERE "ClientProfileId" = @client""",
            ("client", clientId));
        await AssertSqlStateAsync(
            "55000",
            """DELETE FROM clients."ClientCoachAssignments" WHERE "ClientProfileId" = @client""",
            ("client", clientId));

        // A coach with clients cannot simply stop being staff.
        await AssertSqlStateAsync(
            "23514",
            """UPDATE tenancy."Memberships" SET "Status" = 'Removed' WHERE "TenantId" = @tenant AND "UserId" = @coach""",
            ("tenant", tenant),
            ("coach", coachUserId));

        // One owner per workspace.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "db-stranger@example.test", "Stranger", "Stranger Gym");
        var strangerId = (await TeamMembersAsync(stranger)).Single().UserId;
        await AssertSqlStateAsync(
            "23505",
            """
            INSERT INTO tenancy."Memberships" ("Id", "TenantId", "UserId", "Role", "Status", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (gen_random_uuid(), @tenant, @user, 'Owner', 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("tenant", tenant),
            ("user", strangerId));

        // An invitation's kind never changes.
        await InviteClientAsync(owner, "db-pending@example.test");
        await AssertSqlStateAsync(
            "23514",
            """UPDATE invitations."ClientInvitations" SET "Kind" = 'Coach', "PhoneNumber" = NULL, "BirthDate" = NULL, "AssignedCoachUserId" = NULL WHERE "TenantId" = @tenant""",
            ("tenant", tenant));
    }

    /// <summary>
    /// The coach scope is checked centrally for route parameters named <c>clientProfileId</c> or
    /// <c>clientId</c>. A new route that names a client any other way would bypass that check, so
    /// every client-naming route parameter in the application must be one of those two.
    /// </summary>
    [TestMethod]
    public void TeamEveryClientNamingRouteParameterIsCheckedByTheCoachScope()
    {
        var parameters = RequiredFactory.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint => endpoint.RoutePattern.Parameters.Select(parameter => (endpoint, parameter)))
            .Where(item => item.parameter.Name.Contains("client", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        Assert.IsNotEmpty(parameters, "No client-naming route was discovered, so this test checks nothing.");
        var outsideTheCheck = parameters
            .Where(item => !TenantRoleAuthorizationHandler.ClientRouteParameters.Contains(item.parameter.Name))
            .Select(item => $"{item.endpoint.RoutePattern.RawText} ({item.parameter.Name})")
            .ToArray();
        Assert.IsEmpty(outsideTheCheck, $"Client routes outside the coach scope check: {string.Join(", ", outsideTheCheck)}");
    }

    // ---------- team helpers ----------

    /// <summary>The owner invites a coach; a new account accepts. Returns the coach's user id.</summary>
    private static async Task<Guid> JoinAsCoachAsync(HttpClient owner, HttpClient coach, string email, string displayName)
    {
        await RefreshCsrfAsync(owner);
        var created = await owner.PostAsJsonAsync(
            "/api/team/invitations",
            new { email, firstName = displayName.Split(' ')[0], lastName = "Coach" });
        await AssertStatusAsync(created, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<TeamInvitation>(created);
        await RefreshCsrfAsync(coach);
        var accepted = await coach.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token = QueryValue(invitation.DevelopmentActionUrl!, "token"), displayName, password = Password });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var acceptance = await RequiredJsonAsync<TeamAcceptance>(accepted);
        Assert.AreEqual("Coach", acceptance.Kind);
        Assert.IsNull(acceptance.ClientProfileId, "A coach invitation creates no client profile.");
        SetTenant(coach, acceptance.TenantId);
        return (await TeamMembersAsync(owner)).Single(member => member.Email == email).UserId;
    }

    private static async Task<TeamMember[]> TeamMembersAsync(HttpClient owner) =>
        await owner.GetFromJsonAsync<TeamMember[]>("/api/team/members")
        ?? throw new AssertFailedException("The team list was empty.");

    private static async Task<TeamClientDetails> ReassignAsync(
        HttpClient owner,
        Guid clientId,
        Guid coachUserId,
        string? note)
    {
        var details = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(owner);
        var response = await owner.PostAsJsonAsync(
            $"/api/clients/{clientId}/coach",
            new { coachUserId, note, version = details.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var moved = await RequiredJsonAsync<TeamClientDetails>(response);
        Assert.AreEqual(coachUserId, moved.AssignedCoachUserId);
        return moved;
    }

    /// <summary>Sends a client invitation and returns its development link without accepting it.</summary>
    private static async Task<string> InviteClientAsync(HttpClient sender, string email)
    {
        await RefreshCsrfAsync(sender);
        var response = await sender.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName = "Pending",
            lastName = "Client",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        return (await RequiredJsonAsync<TeamInvitation>(response)).DevelopmentActionUrl!;
    }

    private static async Task<Guid> AcceptClientLinkAsync(HttpClient invitee, string link)
    {
        await RefreshCsrfAsync(invitee);
        var response = await invitee.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token = QueryValue(link, "token"), displayName = "Late Client", password = Password });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<TeamAcceptance>(response)).ClientProfileId!.Value;
    }

    private static async Task GrantFreeFeaturesAsync(HttpClient coach, Guid clientId, params string[] features)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Team plan {Guid.NewGuid():N}",
            description = "Team support",
            initialOffer = new
            {
                label = "8 weeks",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var product = await RequiredJsonAsync<Product>(productResponse);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/commercial/clients/{clientId}/enrollments",
                new { offerId = product.Offers[0].Id, startDate = TenantToday(), idempotencyKey = Guid.NewGuid() }),
            HttpStatusCode.OK);
    }

    private static async Task<Guid> StartChatAsync(HttpClient coach, Guid clientId)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/messaging/conversations",
            new { clientProfileId = clientId, idempotencyKey = Guid.NewGuid() });
        Assert.IsTrue(
            response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Created,
            $"Starting a chat returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await RequiredJsonAsync<TeamChatDetail>(response)).Conversation.Id;
    }

    private static async Task SendChatAsync(HttpClient sender, Guid conversationId, string body)
    {
        await RefreshCsrfAsync(sender);
        var response = await sender.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages",
            new { body, idempotencyKey = Guid.NewGuid() });
        Assert.IsTrue(
            response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Created,
            $"Sending returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    }

    private static async Task<TeamChatPage> ChatListAsync(HttpClient caller) =>
        await caller.GetFromJsonAsync<TeamChatPage>("/api/messaging/conversations")
        ?? throw new AssertFailedException("The conversation list was empty.");

    private async Task AssertSqlStateAsync(string sqlState, string sql, params (string Name, object Value)[] parameters)
    {
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, parameters));
        Assert.AreEqual(sqlState, failure.SqlState, failure.MessageText);
    }

    private sealed record TeamWorkspace(Guid TenantId, string Role);
    private sealed record TeamMember(Guid UserId, string DisplayName, string Email, string Role, int AssignedClientCount, uint Version);
    private sealed record TeamClient(Guid Id, Guid AssignedCoachUserId, string AssignedCoachName);
    private sealed record TeamClientDetails(Guid Id, Guid? UserId, Guid AssignedCoachUserId, string AssignedCoachName, uint Version);
    private sealed record TeamInvitation(Guid Id, string Email, string Kind, uint Version, string? DevelopmentActionUrl);
    private sealed record TeamPublicInvitation(string WorkspaceName, string Kind);
    private sealed record TeamAcceptance(Guid TenantId, Guid? ClientProfileId, bool SignedIn, string Kind);
    private sealed record TeamAssignment(
        int Sequence,
        Guid CoachUserId,
        Guid? PreviousCoachUserId,
        string Reason,
        string? Note,
        Guid? AssignedByUserId);
    private sealed record TeamRemoval(int ReassignedClientCount, int ReassignedInvitationCount);
    private sealed record TeamChatDetail(TeamChat Conversation);
    private sealed record TeamChat(Guid Id, bool IsReadOnly);
    private sealed record TeamChatPage(TeamChat[] Items);
    private sealed record TeamUnread(long Unread);
}
