using System.Net;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A9 (docs/FULL-AUDIT-2026-10.md, section 11): a conversation in the list carries the newest
/// message still present that the other participant wrote, whoever spoke last, so the client's Today shows their
/// coach's latest words rather than their own reply (CLIENT-13).
/// </summary>
public sealed partial class Phase6B2AMessagingTests
{
    [TestMethod]
    public async Task A9TheClientReadsTheirCoachsLatestMessageWhoeverSpokeLast()
    {
        var workspace = await CreateWorkspaceAsync("a9-latest");
        var conversation = (await StartConversationAsync(workspace.Coach, workspace.ClientProfileId)).Conversation;

        // Nothing written yet: nothing from the coach to show.
        var row = (await ListConversationsAsync(workspace.Client)).Items.Single();
        Assert.IsNull(row.LatestFromCounterpart);

        await SendMessageAsync(workspace.Coach, conversation.Id, "Lift heavy today.");
        await SendMessageAsync(workspace.Client, conversation.Id, "Will do!");

        // The client spoke last: the list's last message is their own, the coach's latest is still the coach's.
        row = (await ListConversationsAsync(workspace.Client)).Items.Single();
        Assert.AreEqual(("Will do!", true), (row.LastMessage?.Body, row.LastMessage?.IsFromCaller));
        Assert.AreEqual(("Lift heavy today.", false, workspace.CoachUserId),
            (row.LatestFromCounterpart?.Body, row.LatestFromCounterpart?.IsFromCaller, row.LatestFromCounterpart?.SenderUserId));

        // A newer coach message replaces it; once the coach removes that one, the one before is the latest again.
        var newer = await SendMessageAsync(workspace.Coach, conversation.Id, "And sleep well.");
        row = (await ListConversationsAsync(workspace.Client)).Items.Single();
        Assert.AreEqual((newer.Id, "And sleep well."), (row.LatestFromCounterpart?.MessageId, row.LatestFromCounterpart?.Body));
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await PostDeleteAsync(workspace.Coach, conversation.Id, newer.Id, newer.Version),
            HttpStatusCode.OK);
        row = (await ListConversationsAsync(workspace.Client)).Items.Single();
        Assert.AreEqual("Lift heavy today.", row.LatestFromCounterpart?.Body);
        Assert.IsFalse(row.LatestFromCounterpart!.IsDeleted);

        // The coach's own list reads the client's latest the same way.
        var coachRow = (await ListConversationsAsync(workspace.Coach)).Items.Single();
        Assert.AreEqual(("Will do!", workspace.ClientUserId),
            (coachRow.LatestFromCounterpart?.Body, coachRow.LatestFromCounterpart?.SenderUserId));

        // A conversation the client can no longer open shows no words at all.
        await BlockClientAsync(workspace.Coach, workspace.ClientProfileId);
        row = (await ListConversationsAsync(workspace.Client)).Items.Single();
        Assert.IsFalse(row.IsAvailable);
        Assert.IsNull(row.LastMessage);
        Assert.IsNull(row.LatestFromCounterpart);
    }
}
