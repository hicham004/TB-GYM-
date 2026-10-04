using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R3.5b: the coach's inbox finds who is waiting by filter and by name over every conversation, not
/// just the first page, and counts each filter (MSG-022); and the client read beside the chat names
/// the plan and the last workout. Neither reaches another coach's chat, another workspace, or a
/// conversation whose plan no longer includes messaging.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R35bInboxUrl = "/api/messaging/conversations";

    [TestMethod]
    public async Task R35bACoachFindsWhoIsWaitingByFilterAndByName()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35b-inbox-owner@example.test", "Hicham Haddad", "R35b Inbox");

        // Maya asks and waits. Omar's message was read but not answered. Élie wrote and was answered
        // without the thread being opened, so it is unread but not waiting. Sara heard from the coach
        // last. Rami asked, then took back a second message: his question still waits. Karl wrote, then
        // the relationship was blocked, so his thread is closed.
        using var maya = await R35bChatAsync(owner, tenant, "maya", "Maya", "Rahman");
        await SendChatAsync(maya.Client, maya.ChatId, "Can we move Friday?");
        R31Tick();
        using var omar = await R35bChatAsync(owner, tenant, "omar", "Omar", "Nasser");
        var omarLast = await R35bSendAsync(omar.Client, omar.ChatId, "Done with week one!");
        await R35bReadAsync(owner, omar.ChatId, omarLast.Sequence);
        R31Tick();
        using var elie = await R35bChatAsync(owner, tenant, "elie", "Élie", "Khoury");
        await SendChatAsync(elie.Client, elie.ChatId, "Is rice fine after training?");
        await SendChatAsync(owner, elie.ChatId, "Yes, a cup.");
        R31Tick();
        using var sara = await R35bChatAsync(owner, tenant, "sara", "Sara", "Haddad");
        await SendChatAsync(owner, sara.ChatId, "Welcome aboard!");
        R31Tick();
        using var rami = await R35bChatAsync(owner, tenant, "rami", "Rami", "Saliba");
        await SendChatAsync(rami.Client, rami.ChatId, "Should I deload?");
        var oops = await R35bSendAsync(rami.Client, rami.ChatId, "Wrong chat, sorry");
        await R35bRemoveAsync(rami.Client, rami.ChatId, oops);
        R31Tick();
        using var karl = await R35bChatAsync(owner, tenant, "karl", "Karl", "Aoun");
        await SendChatAsync(karl.Client, karl.ChatId, "Here is my private question");
        var karlProfile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{karl.ClientId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{karl.ClientId}/relationship/block",
            new { reason = "R3.5b closed thread", karlProfile.Version }), HttpStatusCode.OK);

        // A team coach's chat with their own client is private to them (ADR 0026), and another
        // workspace's client with the same name is somebody else's.
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r35b-inbox-coach@example.test", "Lina Saad");
        using var nour = await R35bChatAsync(coach, tenant, "nour", "Maya", "Fares");
        await SendChatAsync(nour.Client, nour.ChatId, "Hi Lina");
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r35b-inbox-stranger@example.test", "Other Owner", "R35b Elsewhere");
        using var other = await R35bChatAsync(stranger, strangerTenant, "other-maya", "Maya", "Rahman");
        await SendChatAsync(other.Client, other.ChatId, "Elsewhere");

        // The plain list: every thread, newest first, the waiting ones marked and every filter counted.
        var plain = await ReadSliceAsync<ConversationPage>(owner, R35bInboxUrl);
        CollectionAssert.AreEqual(
            new[] { karl.ChatId, rami.ChatId, sara.ChatId, elie.ChatId, omar.ChatId, maya.ChatId },
            plain.Items.Select(item => item.Id).ToArray());
        Assert.AreEqual(new ConversationListCounts(6, 3, 3), plain.Counts);
        Assert.AreEqual(
            "Karl False 0 False, Rami True 1 True, Sara True 0 False, Élie True 1 False, Omar True 0 True, Maya True 1 True",
            string.Join(", ", plain.Items.Select(item =>
                $"{item.Counterpart.DisplayName.Split(' ')[0]} {item.IsAvailable} {item.UnreadCount} {item.IsAwaitingReply}")));
        Assert.IsNull(plain.Items[0].LastMessage, "A closed thread shows nothing of what was said.");

        // Each filter keeps what it names, over the whole list.
        Assert.AreEqual("Rami, Élie, Maya", await R35bNamesAsync(owner, "?filter=Unread"));
        Assert.AreEqual("Rami, Omar, Maya", await R35bNamesAsync(owner, "?filter=AwaitingReply"));
        Assert.AreEqual("Karl, Rami, Sara, Élie, Omar, Maya", await R35bNamesAsync(owner, "?filter=All"));

        // The search reads names only, ignoring case and accents; a closed thread can still be found.
        Assert.AreEqual("Élie", await R35bNamesAsync(owner, "?search=ELIE%20kh"));
        Assert.AreEqual("Karl", await R35bNamesAsync(owner, "?search=aoun"));
        Assert.AreEqual(string.Empty, await R35bNamesAsync(owner, "?search=deload"), "Message text is never searched.");
        Assert.AreEqual("Maya", await R35bNamesAsync(owner, "?search=rahman&filter=AwaitingReply"));
        var searched = await ReadSliceAsync<ConversationPage>(owner, $"{R35bInboxUrl}?search=zzz");
        Assert.AreEqual(new ConversationListCounts(6, 3, 3), searched.Counts, "Counts never depend on the search.");

        // A filtered list pages by the same cursor; the counts come with the first page only.
        var first = await ReadSliceAsync<ConversationPage>(owner, $"{R35bInboxUrl}?filter=AwaitingReply&take=2");
        Assert.AreEqual((2, true), (first.Items.Count, first.HasMore));
        var next = await ReadSliceAsync<ConversationPage>(owner,
            $"{R35bInboxUrl}?filter=AwaitingReply&take=2" +
            $"&beforeActivityAtUtc={Uri.EscapeDataString(first.NextBeforeActivityAtUtc!.Value.ToString("O"))}" +
            $"&beforeConversationId={first.NextBeforeConversationId}");
        Assert.AreEqual((1, false, (ConversationListCounts?)null), (next.Items.Count, next.HasMore, next.Counts));
        CollectionAssert.AreEqual(
            new[] { rami.ChatId, omar.ChatId, maya.ChatId },
            first.Items.Concat(next.Items).Select(item => item.Id).ToArray());

        // Answering takes Maya out of Waiting; reading her takes her out of Unread.
        var mayaLast = (await ReadSliceAsync<ConversationPage>(owner, $"{R35bInboxUrl}?search=maya")).Items.Single();
        await SendChatAsync(owner, maya.ChatId, "Friday at 7 then.");
        await R35bReadAsync(owner, maya.ChatId, mayaLast.LastSequence);
        Assert.AreEqual(new ConversationListCounts(6, 2, 2), (await ReadSliceAsync<ConversationPage>(owner, R35bInboxUrl)).Counts);

        // The client's side: Maya now waits for nobody but has the coach's reply to answer.
        var mayaView = await ReadSliceAsync<ConversationPage>(maya.Client, $"{R35bInboxUrl}?filter=AwaitingReply");
        Assert.AreEqual((maya.ChatId, true), (mayaView.Items.Single().Id, mayaView.Items.Single().IsAwaitingReply));
        Assert.AreEqual(new ConversationListCounts(1, 1, 1), mayaView.Counts);

        // The team coach sees their own chat only, and the owner never sees it counted.
        var linaView = await ReadSliceAsync<ConversationPage>(coach, $"{R35bInboxUrl}?search=maya");
        Assert.AreEqual(nour.ChatId, linaView.Items.Single().Id);
        Assert.AreEqual(new ConversationListCounts(1, 1, 1), linaView.Counts);
        Assert.AreEqual("Maya", await R35bNamesAsync(owner, "?search=maya"));

        // Another workspace's owner finds nothing of this one, and is refused it outright.
        var strangerView = await ReadSliceAsync<ConversationPage>(stranger, $"{R35bInboxUrl}?search=maya");
        Assert.AreEqual(other.ChatId, strangerView.Items.Single().Id);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync($"{R35bInboxUrl}?search=maya"), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync($"{R35bInboxUrl}?filter=Unread"), HttpStatusCode.Unauthorized);

        // A search too long, or a filter that is not one of ours, is refused before anything is read.
        await AssertStatusAsync(
            await owner.GetAsync($"{R35bInboxUrl}?search={new string('a', ConversationListQuery.MaximumSearchLength + 1)}"),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(await owner.GetAsync($"{R35bInboxUrl}?filter=7"), HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task R35bAClientsPageNamesThePlanAndTheLastWorkout()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r35b-page-coach@example.test", "Hicham Haddad", "R35b Page");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r35b-page-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 3, today);
        await AssignAsync(coach, mayaId, resources, today);
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(coach, omar, tenant, "r35b-page-omar@example.test", "Omar", "Nasser");
        await GrantFreeFeaturesAsync(coach, omarId, "Messaging");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "r35b-page-nour@example.test", "Nour", "Fares");

        // Nothing finished yet: the plan has its name and there is no last workout.
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(mayaId));
        Assert.AreEqual(("8-week training", (CoachActivityItemView?)null), (page.PlanName, page.LastWorkout));

        // 80 kg for five, then 85 kg a week later: the newest workout, with its record.
        await R25bFinishTodaysWorkoutAsync(maya, 80m);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var newest = await R25bFinishTodaysWorkoutAsync(maya, 85m);
        RequiredTodayQueryCounter.Reset();
        page = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(mayaId));
        var queries = RequiredTodayQueryCounter.Count;
        Console.WriteLine($"R3.5b client page: {queries} SQL commands with a last workout.");
        Assert.IsLessThanOrEqualTo(24, queries, "One client's page must stay a fixed number of queries.");
        var last = page.LastWorkout ?? throw new AssertFailedException("Maya finished a workout.");
        Assert.AreEqual((CoachActivityKind.WorkoutCompleted, newest, mayaId),
            (last.Kind, last.SubjectId, last.Client.ClientProfileId));
        Assert.IsFalse(string.IsNullOrWhiteSpace(last.Title));
        Assert.AreEqual(page.LastActivityAtUtc, last.OccurredAtUtc);
        var record = last.PersonalRecords.Single();
        Assert.AreEqual(("Scenario squat", 5, 85m, CoachActivityLoadUnit.Kilogram),
            (record.ExerciseName, record.Repetitions, record.Load, record.Unit));

        // A plan without training has no last workout; a client with no plan has no plan name.
        var omarPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(omarId));
        Assert.IsTrue(omarPage.PlanName is { } omarPlan && omarPlan.StartsWith("Team plan", StringComparison.Ordinal));
        Assert.IsNull(omarPage.LastWorkout);
        var nourPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(nourId));
        Assert.AreEqual((ClientPlanState.None, (string?)null, (CoachActivityItemView?)null),
            (nourPage.PlanState, nourPage.PlanName, nourPage.LastWorkout));

        // Once the plan has run out it keeps its name, and its training is no longer read.
        RequiredTestClock.Advance(TimeSpan.FromDays(50));
        page = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(mayaId));
        Assert.AreEqual((ClientPlanState.Ended, "8-week training", (CoachActivityItemView?)null),
            (page.PlanState, page.PlanName, page.LastWorkout));
    }

    private async Task<R35bChat> R35bChatAsync(
        HttpClient coach,
        Guid tenantId,
        string label,
        string firstName,
        string lastName)
    {
        var client = CreateClient();
        var clientId = await R31InviteAsync(coach, client, tenantId, $"r35b-{label}-{Guid.NewGuid():N}@example.test", firstName, lastName);
        await GrantFreeFeaturesAsync(coach, clientId, "Messaging");
        return new R35bChat(client, clientId, await StartChatAsync(coach, clientId));
    }

    private static async Task<string> R35bNamesAsync(HttpClient caller, string query) =>
        string.Join(", ", (await ReadSliceAsync<ConversationPage>(caller, R35bInboxUrl + query)).Items
            .Select(item => item.Counterpart.DisplayName.Split(' ')[0]));

    private static async Task<MessageView> R35bSendAsync(HttpClient sender, Guid conversationId, string body)
    {
        await RefreshCsrfAsync(sender);
        var response = await sender.PostAsJsonAsync(
            $"{R35bInboxUrl}/{conversationId}/messages",
            new { body, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<MessageView>(response);
    }

    private static async Task R35bRemoveAsync(HttpClient sender, Guid conversationId, MessageView message)
    {
        await RefreshCsrfAsync(sender);
        await AssertStatusAsync(
            await sender.PostAsJsonAsync(
                $"{R35bInboxUrl}/{conversationId}/messages/{message.Id}/delete",
                new { expectedVersion = message.Version, idempotencyKey = Guid.NewGuid() }),
            HttpStatusCode.OK);
    }

    private static async Task R35bReadAsync(HttpClient reader, Guid conversationId, long throughSequence)
    {
        await RefreshCsrfAsync(reader);
        await AssertStatusAsync(
            await reader.PostAsJsonAsync($"{R35bInboxUrl}/{conversationId}/read", new { throughSequence }),
            HttpStatusCode.OK);
    }

    private sealed record R35bChat(HttpClient Client, Guid ClientId, Guid ChatId) : IDisposable
    {
        public void Dispose() => Client.Dispose();
    }
}
