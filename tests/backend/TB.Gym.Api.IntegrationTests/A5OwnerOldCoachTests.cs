using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A5, COACH-13: a thread belongs to the coach who has the client (ADR 0026), and the owner
/// is no exception. When the owner hands a client to a coach, the owner's old thread closes exactly as
/// a coach's does: gone for the owner, read-only for the client, no live delivery, no badge; reassigning
/// back reopens it, because nothing was deleted.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A5TheOwnerAsOldCoachLosesTheThreadAndTheClientKeepsItReadOnly()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "a5-old-owner@example.test", "Hicham Haddad", "A5 Old Coach Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "a5-new-coach@example.test", "Lea Khoury");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "a5-old-client@example.test", true);
        SetTenant(client, tenant);
        await GrantFreeFeaturesAsync(owner, clientId, "Messaging");
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;

        var ownerThread = await StartChatAsync(owner, clientId);
        await SendChatAsync(owner, ownerThread, "Hello from the owner");
        await SendChatAsync(client, ownerThread, "A question before I switch coach");
        Assert.AreEqual(1L, (await owner.GetFromJsonAsync<TeamUnread>("/api/messaging/unread-count"))!.Unread);

        await ReassignAsync(owner, clientId, coachUserId, "Lea takes the evening lifters");

        // The owner still sees the client, as the owner sees every client...
        await AssertStatusAsync(await owner.GetAsync($"/api/clients/{clientId}"), HttpStatusCode.OK);
        // ...but the old thread is closed for the owner exactly as for any old coach.
        await AssertStatusAsync(
            await owner.GetAsync($"/api/messaging/conversations/{ownerThread}/messages"),
            HttpStatusCode.NotFound);
        Assert.IsFalse((await ChatListAsync(owner)).Items.Any(item => item.Id == ownerThread));
        Assert.AreEqual(
            0L,
            (await owner.GetFromJsonAsync<TeamUnread>("/api/messaging/unread-count"))!.Unread,
            "The badge never counts a thread its reader can no longer open.");
        var today = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.IsFalse(
            today.Attention.Any(item => item.SubjectId == ownerThread),
            "Coach Today does not offer a reply in a thread that is closed.");
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/messaging/conversations/{ownerThread}/messages",
                new { body = "Owner writes on", idempotencyKey = Guid.NewGuid() }),
            HttpStatusCode.NotFound);

        // Starting again would only reach the same closed thread, so the owner is told why.
        await RefreshCsrfAsync(owner);
        var again = await owner.PostAsJsonAsync(
            "/api/messaging/conversations",
            new { clientProfileId = clientId, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(again, HttpStatusCode.Conflict);
        StringAssert.Contains(await again.Content.ReadAsStringAsync(), MessagingConflictCodes.NotTheClientsCoach);

        // No live delivery reaches the owner's old thread either.
        Assert.IsFalse(await CanReachLiveAsync(tenant, ownerUserId, ownerThread));
        Assert.IsTrue(await CanReachLiveAsync(tenant, await SignedInUserIdAsync(client), ownerThread));

        // The client keeps the history, read-only.
        var clientThreads = (await ChatListAsync(client)).Items;
        Assert.IsTrue(clientThreads.Single(item => item.Id == ownerThread).IsReadOnly);
        await AssertStatusAsync(
            await client.GetAsync($"/api/messaging/conversations/{ownerThread}/messages"),
            HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        var refused = await client.PostAsJsonAsync(
            $"/api/messaging/conversations/{ownerThread}/messages",
            new { body = "Still open?", idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), MessagingConflictCodes.ConversationReadOnly);

        // The new coach starts fresh, and reassigning back reopens the owner's thread and closes hers.
        var coachThread = await StartChatAsync(coach, clientId);
        Assert.AreNotEqual(ownerThread, coachThread);
        await ReassignAsync(owner, clientId, ownerUserId, null);
        await AssertStatusAsync(
            await owner.GetAsync($"/api/messaging/conversations/{ownerThread}/messages"),
            HttpStatusCode.OK);
        Assert.IsTrue(await CanReachLiveAsync(tenant, ownerUserId, ownerThread));
        var afterReturn = (await ChatListAsync(client)).Items;
        Assert.IsFalse(afterReturn.Single(item => item.Id == ownerThread).IsReadOnly);
        Assert.IsTrue(afterReturn.Single(item => item.Id == coachThread).IsReadOnly);
    }

    [TestMethod]
    public async Task A5TheOwnerStartsNoThreadWithAnotherCoachsClient()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "a5-start-owner@example.test", "Owner", "A5 Start Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "a5-start-coach@example.test", "Start Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "a5-start-client@example.test", true);
        await GrantFreeFeaturesAsync(coach, clientId, "Messaging");

        await RefreshCsrfAsync(owner);
        var refused = await owner.PostAsJsonAsync(
            "/api/messaging/conversations",
            new { clientProfileId = clientId, idempotencyKey = Guid.NewGuid() });

        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), MessagingConflictCodes.NotTheClientsCoach);
        Assert.IsEmpty((await ChatListAsync(owner)).Items, "A refused start leaves no thread behind.");
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM messaging."Conversations" WHERE "ClientProfileId" = @id""",
                clientId));

        // The client's own coach still starts one.
        Assert.AreNotEqual(Guid.Empty, await StartChatAsync(coach, clientId));
    }

    /// <summary>Asks the realtime authorizer the hub and the dispatcher ask before every frame.</summary>
    private async Task<bool> CanReachLiveAsync(Guid tenantId, Guid userId, Guid conversationId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var authorizer = scope.ServiceProvider.GetRequiredService<IMessagingRealtimeAuthorizer>();
        return await authorizer.CanAccessConversationAsync(tenantId, userId, conversationId, CancellationToken.None);
    }

    private static async Task<Guid> SignedInUserIdAsync(HttpClient caller) =>
        (await caller.GetFromJsonAsync<A5Me>("/api/auth/me")
         ?? throw new AssertFailedException("The signed-in user was empty.")).Id;

    private sealed record A5Me(Guid Id);
}
