using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A5, NCM-12: within a second of delivery the other side's application acknowledges a
/// message (MSG-015), and that acknowledgement used to rewrite the message row whose version the
/// sender edits against, so every Edit, Remove and "Remove as coach" after it answered 409
/// <c>messaging_stale_message_version</c>. The acknowledgement now leaves the message alone and the
/// delivery state is read from the acknowledgement rows.
/// </summary>
public sealed partial class Phase6B2BRealtimeMessagingTests
{
    [TestMethod]
    public async Task A5AnEditARemovalAndACoachRemovalAfterTheOtherSidesAcknowledgementAreNotStale()
    {
        var thread = await OpenThreadAsync("a5-ack-then-edit");
        var coachMessage = await SendMessageAsync(thread.Coach, thread.ConversationId, "Squats on Monday");
        var clientMessage = await SendMessageAsync(thread.Client, thread.ConversationId, "How heavy?");
        var events = await EventsAsync(thread.ConversationId);

        // Each side's application acknowledges the other's message, as it does within a second.
        await AcknowledgeAsync(
            thread.Client,
            thread.ConversationId,
            events.Single(item => item.MessageId == coachMessage.Id).EventSequence);
        await AcknowledgeAsync(
            thread.Coach,
            thread.ConversationId,
            events.Single(item => item.MessageId == clientMessage.Id).EventSequence);

        // The rows did not move, so the versions both screens hold are still the versions.
        var coachView = (await GetMessagesAsync(thread.Coach, thread.ConversationId)).Items;
        var acknowledged = coachView.Single(item => item.Id == coachMessage.Id);
        Assert.AreEqual(coachMessage.Version, acknowledged.Version, "An acknowledgement is not an edit.");
        Assert.AreEqual("RealtimeAcknowledged", acknowledged.DeliveryState);
        Assert.AreEqual(clientMessage.Version, coachView.Single(item => item.Id == clientMessage.Id).Version);

        // The sender edits with the version from its own send, which is what the screen holds.
        var edited = await EditMessageAsync(
            thread.Coach,
            thread.ConversationId,
            coachMessage.Id,
            "Squats on Tuesday",
            coachMessage.Version);
        Assert.AreEqual(2, edited.RevisionNumber);
        Assert.AreEqual("RealtimeAcknowledged", edited.DeliveryState, "Delivery is about the message, not the revision.");

        // The other side's application acknowledges the edit too, and the sender can still take it back.
        var editEvent = (await EventsAsync(thread.ConversationId))
            .Last(item => item.MessageId == coachMessage.Id);
        await AcknowledgeAsync(thread.Client, thread.ConversationId, editEvent.EventSequence);
        var removed = await DeleteMessageAsync(
            thread.Coach,
            thread.ConversationId,
            coachMessage.Id,
            edited.Version);
        Assert.IsTrue(removed.IsDeleted);
        Assert.AreEqual("SenderRemoved", removed.DeletionKind);

        // And the coach removes the client's acknowledged message with the version the thread read.
        var moderated = await ModerateMessageAsync(
            thread.Coach,
            thread.ConversationId,
            clientMessage.Id,
            "Asked in the wrong thread.",
            clientMessage.Version);
        Assert.IsTrue(moderated.IsDeleted);
        Assert.AreEqual("CoachModerated", moderated.DeletionKind);
    }

    /// <summary>
    /// A version that is really stale still conflicts: the fix narrows what changes a version, not
    /// whether a changed message is protected.
    /// </summary>
    [TestMethod]
    public async Task A5AMessageThatReallyChangedIsStillStale()
    {
        var thread = await OpenThreadAsync("a5-really-stale");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "First draft");
        await EditMessageAsync(thread.Coach, thread.ConversationId, sent.Id, "Second draft", sent.Version);

        await RefreshCsrfAsync(thread.Coach);
        var stale = await thread.Coach.PostAsJsonAsync(
            $"/api/messaging/conversations/{thread.ConversationId}/messages/{sent.Id}/edit",
            new { body = "Third draft", expectedVersion = sent.Version, idempotencyKey = Guid.NewGuid() });

        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        StringAssert.Contains(await stale.Content.ReadAsStringAsync(), "messaging_stale_message_version");
    }
}
