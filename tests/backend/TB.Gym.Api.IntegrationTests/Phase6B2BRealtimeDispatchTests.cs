using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The dispatcher: claiming, leases, the attempt budget, the authorization recheck, and what a
/// suppressed publication never loads.
/// </summary>
public sealed partial class Phase6B2BRealtimeMessagingTests
{
    private static readonly int[] ExpectedTwoAttempts = [1, 2];

    // ---------- publication ----------

    [TestMethod]
    public async Task ASweepPublishesOneFullEventAndOneInvalidationToEachAuthorizedParticipant()
    {
        var thread = await OpenThreadAsync("publish");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "hello there");
        Hub.Reset();

        var outcome = await SweepAsync();

        // Two events outstanding (the creation and the send) for two participants each, and the
        // creation may already have been swept by an earlier call in this test — so assert on the
        // send, which is the one the assertions below are about.
        Assert.IsGreaterThanOrEqualTo(2, outcome.Published);
        Assert.AreEqual(0, outcome.DeadLettered);
        Assert.AreEqual(0, outcome.Suppressed);

        var clientFrames = Hub.FullEventsFor(
            thread.Workspace.TenantId,
            thread.ConversationId,
            thread.Workspace.ClientUserId);
        var sendFrame = clientFrames.Single(frame => frame.Event!.Kind == MessagingRealtimeEventKind.MessageSent);
        Assert.AreEqual(sent.Id, sendFrame.Event!.Message!.Id);
        Assert.AreEqual("hello there", sendFrame.Event.Message.Body);
        Assert.AreEqual(
            thread.ConversationId,
            sendFrame.Event.ConversationId);
        Assert.IsFalse(
            sendFrame.Event.Message.IsFromCaller,
            "The projection is built for the recipient, so the coach's message is not theirs.");

        // The sender's own tabs get the same event, projected for them.
        var coachFrames = Hub.FullEventsFor(
            thread.Workspace.TenantId,
            thread.ConversationId,
            thread.Workspace.CoachUserId);
        var coachSendFrame = coachFrames.Single(frame => frame.Event!.Kind == MessagingRealtimeEventKind.MessageSent);
        Assert.IsTrue(
            coachSendFrame.Event!.Message!.IsFromCaller,
            "One event, two caller-specific projections; a shared payload could not say this.");

        // And the compact signal, which carries no content at all.
        var invalidations = Hub.InvalidationsFor(thread.Workspace.TenantId, thread.Workspace.ClientUserId);
        Assert.IsNotEmpty(invalidations);
        Assert.AreEqual(thread.ConversationId, invalidations[^1].Invalidation!.ConversationId);

        var recipients = await RecipientsAsync(thread.ConversationId);
        Assert.IsTrue(recipients.All(recipient => recipient.Status == "Published"));
        Assert.IsTrue(recipients.All(recipient => recipient.AttemptCount == 1));
        Assert.IsTrue(recipients.All(recipient => recipient.FailureCode is null));
        Assert.IsTrue(recipients.All(recipient => recipient.PublishedAtUtc is not null));
    }

    [TestMethod]
    public async Task ARemovedMessagePublishesItsTombstoneAndNeverItsBodyOrModerationReason()
    {
        var thread = await OpenThreadAsync("tombstone");
        var clientMessage = await SendMessageAsync(thread.Client, thread.ConversationId, "the removed sentence");
        await SweepAsync();
        Hub.Reset();
        await ModerateMessageAsync(
            thread.Coach,
            thread.ConversationId,
            clientMessage.Id,
            "a reason nobody else may read",
            clientMessage.Version);

        await SweepAsync();

        var frames = Hub.Frames
            .Where(frame => frame.Kind == FrameKind.FullEvent)
            .Select(frame => frame.Event!)
            .Where(item => item.Kind == MessagingRealtimeEventKind.MessageCoachModerated)
            .ToArray();
        Assert.IsNotEmpty(frames);
        foreach (var frame in frames)
        {
            Assert.IsNotNull(frame.Message);
            Assert.IsTrue(frame.Message.IsDeleted);
            Assert.IsNull(frame.Message.Body, "A removed message keeps its place and loses its body.");
            Assert.AreEqual(MessageDeletionKind.CoachModerated, frame.Message.DeletionKind);
        }

        // Not on the wire, not in the event row, not in the log.
        var serialized = System.Text.Json.JsonSerializer.Serialize(Hub.Frames);
        Assert.DoesNotContain("a reason nobody else may read", serialized);
        Assert.DoesNotContain("the removed sentence", serialized);
        AssertLogIsSafe(thread.Workspace, "a reason nobody else may read", "the removed sentence");
    }

    // ---------- claiming and leases ----------

    /// <summary>
    /// Two dispatchers sweeping at once divide the backlog instead of publishing it twice.
    /// </summary>
    [TestMethod]
    public async Task TwoDispatchersRacingOnOneBacklogClaimEachRowAtMostOnce()
    {
        var thread = await OpenThreadAsync("race");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "contended");
        Hub.Reset();

        // Both sweeps are held at the claim statement, so they genuinely contend for the same rows
        // rather than happening to run one after the other.
        Barrier.Arm("FOR UPDATE SKIP LOCKED", 2);
        var first = SweepAsync();
        var second = SweepAsync();
        await Barrier.ArrivedAsync(2);
        var outcomes = await Task.WhenAll(first, second);
        Barrier.Disarm();

        Assert.AreEqual(2, Barrier.Arrived, "Both sweeps must have reached the claim statement.");

        var recipients = await RecipientsAsync(thread.ConversationId);
        Assert.HasCount(4, recipients, "Two events, two participants.");
        foreach (var recipient in recipients)
        {
            Assert.AreEqual("Published", recipient.Status);
            Assert.AreEqual(
                1,
                recipient.AttemptCount,
                "A row claimed twice would have published the same frame twice for no reason.");
            var attempts = await AttemptsAsync(recipient.Id);
            Assert.HasCount(1, attempts);
            Assert.AreEqual("Published", attempts[0].Outcome);
        }

        Assert.AreEqual(4, outcomes.Sum(outcome => outcome.Published));
        Assert.AreEqual(4, Hub.Frames.Count(frame => frame.Kind == FrameKind.FullEvent));
    }

    /// <summary>
    /// A crashed claim becomes visible again, and the worker it replaced can finalize nothing.
    /// </summary>
    [TestMethod]
    public async Task AnExpiredClaimIsReclaimedAndItsStaleClaimantFinalizesNothing()
    {
        var thread = await OpenThreadAsync("reclaim");
        await SweepAsync();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "reclaim me");
        var target = (await RecipientsAsync(thread.ConversationId))
            .First(recipient =>
                recipient.Status == "Pending" &&
                recipient.RecipientUserId == thread.Workspace.ClientUserId);
        Hub.Reset();

        // Hold the first worker after its claim has committed and before it publishes.
        Checkpoint.ArmAfterClaim(target.Id);
        var stalled = SweepAsync();
        await Checkpoint.ArrivedAfterClaimAsync();

        // Its lease runs out, and a second worker takes the row over and finishes it.
        await ExpireClaimAsync(target.Id);
        var replacement = await SweepAsync();
        Assert.AreEqual(1, replacement.Reclaimed);
        Assert.AreEqual(1, replacement.Published);

        // Now let the original continue. It publishes into the hub — that write already happened
        // from its point of view — but it must record nothing.
        Checkpoint.ReleaseClaim();
        await stalled;
        Checkpoint.Disarm();

        var recipient = (await RecipientsAsync(thread.ConversationId)).Single(item => item.Id == target.Id);
        Assert.AreEqual("Published", recipient.Status);
        Assert.AreEqual(2, recipient.AttemptCount, "The abandoned attempt still counted.");

        var attempts = await AttemptsAsync(target.Id);
        Assert.HasCount(2, attempts);
        Assert.AreEqual("Abandoned", attempts[0].Outcome, "The interrupted try is recorded, not erased.");
        Assert.AreEqual(
            MessagingRealtimeFailureCodes.ClaimExpired,
            attempts[0].FailureCode);
        Assert.AreEqual("Published", attempts[1].Outcome);
        Assert.AreNotEqual(
            attempts[0].ClaimToken,
            attempts[1].ClaimToken,
            "The replacement holds its own claim, which is what stops the stale worker finalizing.");
    }

    /// <summary>
    /// The duplicate this design accepts, and why it is harmless.
    /// </summary>
    [TestMethod]
    public async Task ACrashAfterPublicationButBeforeFinalizingDuplicatesTheFrameWithTheSameIdentity()
    {
        var thread = await OpenThreadAsync("duplicate");
        await SweepAsync();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "sent once, delivered twice");
        var target = (await RecipientsAsync(thread.ConversationId))
            .First(recipient =>
                recipient.Status == "Pending" &&
                recipient.RecipientUserId == thread.Workspace.ClientUserId);
        Hub.Reset();

        // Hold the worker after the hub has accepted the frame and before the row is finalized.
        Checkpoint.ArmAfterPublish(target.Id);
        var stalled = SweepAsync();
        await Checkpoint.ArrivedAfterPublishAsync();
        Assert.HasCount(
            1,
            Hub.FullEventsFor(thread.Workspace.TenantId, thread.ConversationId, thread.Workspace.ClientUserId),
            "The frame really was published before the crash window.");

        await ExpireClaimAsync(target.Id);
        await SweepAsync();
        Checkpoint.ReleasePublish();
        await stalled;
        Checkpoint.Disarm();

        var frames = Hub.FullEventsFor(
            thread.Workspace.TenantId,
            thread.ConversationId,
            thread.Workspace.ClientUserId);
        Assert.HasCount(2, frames, "At least once, by design: the crash produced a duplicate.");
        Assert.AreEqual(
            frames[0].Event!.EventId,
            frames[1].Event!.EventId,
            "Both frames carry the same event identity, so a client discards the second.");
        Assert.AreEqual(frames[0].Event!.EventSequence, frames[1].Event!.EventSequence);
    }

    // ---------- the attempt budget ----------

    [TestMethod]
    public async Task EveryStartedAttemptCountsAndTheBudgetIsExhaustedExactly()
    {
        // MaximumAttempts is 2 for this test name.
        var thread = await OpenThreadAsync("Exhaust");
        Hub.Reset();
        Hub.FailNext(1000);

        for (var sweep = 0; sweep < 6; sweep++)
        {
            await SweepAsync();
            Clock.Advance(TimeSpan.FromMinutes(30));
        }

        var recipients = await RecipientsAsync(thread.ConversationId);
        Assert.IsNotEmpty(recipients);
        foreach (var recipient in recipients)
        {
            Assert.AreEqual("DeadLettered", recipient.Status);
            Assert.AreEqual(2, recipient.AttemptCount, "The budget is a bound, reached exactly.");
            Assert.AreEqual(MessagingRealtimeFailureCodes.AttemptsExhausted, recipient.FailureCode);
            var attempts = await AttemptsAsync(recipient.Id);
            Assert.HasCount(2, attempts);
            CollectionAssert.AreEqual(
                ExpectedTwoAttempts,
                attempts.Select(attempt => attempt.AttemptNumber).ToArray(),
                "The attempt chain is contiguous; nothing was skipped and nothing was invented.");
        }
    }

    /// <summary>
    /// A configured maximum beyond the four-entry backoff table, which is where an off-by-one turns
    /// into attempt maximum + 1.
    /// </summary>
    [TestMethod]
    public async Task AMaximumBeyondTheScheduleStillNeverExceedsTheBudget()
    {
        // MaximumAttempts is 7 for this test name.
        var thread = await OpenThreadAsync("BeyondTheSchedule");
        Hub.Reset();
        Hub.FailNext(1000);

        for (var sweep = 0; sweep < 12; sweep++)
        {
            await SweepAsync();
            Clock.Advance(TimeSpan.FromHours(1));
        }

        var recipients = await RecipientsAsync(thread.ConversationId);
        foreach (var recipient in recipients)
        {
            Assert.AreEqual("DeadLettered", recipient.Status);
            Assert.AreEqual(7, recipient.AttemptCount);
            Assert.HasCount(7, await AttemptsAsync(recipient.Id));
        }
    }

    [TestMethod]
    public async Task ATerminalPublicationIsNeverDispatchedAgain()
    {
        var thread = await OpenThreadAsync("no-restart");
        await SweepAsync();
        var before = await RecipientsAsync(thread.ConversationId);
        Hub.Reset();

        Clock.Advance(TimeSpan.FromDays(1));
        var outcome = await SweepAsync();

        Assert.AreEqual(0, outcome.Claimed);
        Assert.IsEmpty(Hub.Frames, "A published row is finished; sweeping again must send nothing.");
        var after = await RecipientsAsync(thread.ConversationId);
        CollectionAssert.AreEqual(
            before.Select(recipient => recipient.AttemptCount).ToArray(),
            after.Select(recipient => recipient.AttemptCount).ToArray());
    }

    /// <summary>
    /// A backplane failure changes nothing about the command that already succeeded, and does not end
    /// the sweep.
    /// </summary>
    [TestMethod]
    public async Task AHubFailureLeavesTheRestResultAloneAndTheSweepAlive()
    {
        var thread = await OpenThreadAsync("hub-failure");
        await SweepAsync();
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "committed regardless");
        Hub.Reset();
        Hub.FailNext(2);

        var failed = await SweepAsync();
        Assert.AreEqual(2, failed.Retried, "Both recipients failed transiently and are scheduled again.");

        // The REST result is untouched: the message, its revision and its sequence are all still
        // there, and reading the thread returns exactly what the command returned.
        var page = await GetMessagesAsync(thread.Client, thread.ConversationId);
        var stored = page.Items.Single(item => item.Id == sent.Id);
        Assert.AreEqual("committed regardless", stored.Body);
        Assert.AreEqual(sent.Sequence, stored.Sequence);
        Assert.AreEqual("Persisted", stored.DeliveryState);

        // And the durable event is still there to be caught up on, which is what makes the failure
        // survivable rather than a lost message.
        var events = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId);
        Assert.IsTrue(events.Items.Any(item => item.Message?.Id == sent.Id));

        // The next sweep, with the hub healthy again, publishes it.
        Clock.Advance(TimeSpan.FromMinutes(1));
        var recovered = await SweepAsync();
        Assert.AreEqual(2, recovered.Published);
        AssertLogIsSafe(thread.Workspace, "committed regardless");
    }

    // ---------- authorization rechecked after the claim ----------

    [TestMethod]
    public async Task MembershipRemovedAfterTheClaimSuppressesPublicationBeforeAnyBodyIsLoaded()
    {
        var thread = await OpenThreadAsync("revoked");
        await SweepAsync();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "a body that must not be loaded");
        var target = (await RecipientsAsync(thread.ConversationId))
            .First(recipient =>
                recipient.Status == "Pending" &&
                recipient.RecipientUserId == thread.Workspace.ClientUserId);
        Hub.Reset();

        Checkpoint.ArmAfterClaim(target.Id);
        var sweep = SweepAsync();
        await Checkpoint.ArrivedAfterClaimAsync();

        // The claim has committed. Authoritative state changes underneath it.
        await RevokeMembershipAsync(thread.Workspace.TenantId, thread.Workspace.ClientUserId);
        Recorder.Clear();
        Checkpoint.ReleaseClaim();
        await sweep;
        Checkpoint.Disarm();

        var recipient = (await RecipientsAsync(thread.ConversationId)).Single(item => item.Id == target.Id);
        Assert.AreEqual("Suppressed", recipient.Status);
        Assert.AreEqual(MessagingRealtimeSuppressionCodes.MembershipInactive, recipient.FailureCode);
        Assert.AreEqual(
            1,
            recipient.AttemptCount,
            "The attempt was durably started before the recheck, so it stays counted.");

        Assert.IsEmpty(
            Hub.FullEventsFor(
                thread.Workspace.TenantId,
                thread.ConversationId,
                thread.Workspace.ClientUserId),
            "A denied recipient receives no frame at all.");
        Assert.IsFalse(
            Recorder.Touched("MessageRevisions"),
            "The body was never read. Reading it and then discarding it is not the same thing.");

        var attempts = await AttemptsAsync(target.Id);
        Assert.AreEqual("Suppressed", attempts[^1].Outcome);
        AssertLogIsSafe(thread.Workspace, "a body that must not be loaded");
    }

    [TestMethod]
    public async Task ARelationshipBlockAfterTheClaimSuppressesPublication()
    {
        var thread = await OpenThreadAsync("blocked");
        await SweepAsync();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "blocked before delivery");
        var target = (await RecipientsAsync(thread.ConversationId))
            .First(recipient =>
                recipient.Status == "Pending" &&
                recipient.RecipientUserId == thread.Workspace.ClientUserId);
        Hub.Reset();

        Checkpoint.ArmAfterClaim(target.Id);
        var sweep = SweepAsync();
        await Checkpoint.ArrivedAfterClaimAsync();
        await BlockClientAsync(thread.Coach, thread.Workspace.ClientProfileId);
        Checkpoint.ReleaseClaim();
        await sweep;
        Checkpoint.Disarm();

        var recipient = (await RecipientsAsync(thread.ConversationId)).Single(item => item.Id == target.Id);
        Assert.AreEqual("Suppressed", recipient.Status);
        Assert.AreEqual(MessagingRealtimeSuppressionCodes.RelationshipBlocked, recipient.FailureCode);
        Assert.IsEmpty(Hub.FullEventsFor(
            thread.Workspace.TenantId,
            thread.ConversationId,
            thread.Workspace.ClientUserId));
    }

    [TestMethod]
    public async Task LosingMessagingAccessAfterTheClaimSuppressesPublication()
    {
        var thread = await OpenThreadAsync("entitlement");
        await SweepAsync();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "cancelled before delivery");
        var target = (await RecipientsAsync(thread.ConversationId))
            .First(recipient =>
                recipient.Status == "Pending" &&
                recipient.RecipientUserId == thread.Workspace.ClientUserId);
        Hub.Reset();

        Checkpoint.ArmAfterClaim(target.Id);
        var sweep = SweepAsync();
        await Checkpoint.ArrivedAfterClaimAsync();
        await ChangeEnrollmentAsync(
            thread.Workspace,
            thread.Workspace.Enrollment!.Id,
            "cancel",
            "Phase 6B-2B entitlement test.");
        Checkpoint.ReleaseClaim();
        await sweep;
        Checkpoint.Disarm();

        var recipient = (await RecipientsAsync(thread.ConversationId)).Single(item => item.Id == target.Id);
        Assert.AreEqual("Suppressed", recipient.Status);
        Assert.AreEqual(MessagingRealtimeSuppressionCodes.FeatureDenied, recipient.FailureCode);
        Assert.IsEmpty(Hub.FullEventsFor(
            thread.Workspace.TenantId,
            thread.ConversationId,
            thread.Workspace.ClientUserId));

        // The durable event survives. Restoring access restores the thread, because nothing was
        // deleted to produce the refusal.
        await GrantMessagingAsync(thread.Workspace);
        var events = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId);
        Assert.IsTrue(
            events.Items.Any(item => item.Kind == "MessageSent"),
            "A suppressed publication is not a deleted event; catch-up can still return it.");
    }

    [TestMethod]
    public async Task APlatformBlockAfterTheClaimSuppressesPublication()
    {
        var thread = await OpenThreadAsync("platform-block");
        await SweepAsync();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "platform blocked");
        var target = (await RecipientsAsync(thread.ConversationId))
            .First(recipient =>
                recipient.Status == "Pending" &&
                recipient.RecipientUserId == thread.Workspace.ClientUserId);
        Hub.Reset();

        Checkpoint.ArmAfterClaim(target.Id);
        var sweep = SweepAsync();
        await Checkpoint.ArrivedAfterClaimAsync();
        await ExecuteAsync(
            """UPDATE identity."Users" SET "IsPlatformBlocked" = true WHERE "Id" = @id""",
            ("id", thread.Workspace.ClientUserId));
        Checkpoint.ReleaseClaim();
        await sweep;
        Checkpoint.Disarm();

        var recipient = (await RecipientsAsync(thread.ConversationId)).Single(item => item.Id == target.Id);
        Assert.AreEqual("Suppressed", recipient.Status);
        Assert.AreEqual(MessagingRealtimeSuppressionCodes.RecipientBlocked, recipient.FailureCode);
    }

    // ---------- catch-up ----------

    [TestMethod]
    public async Task CatchUpReturnsAscendingContiguousPositionsAndPagesPastAHundred()
    {
        var thread = await OpenThreadAsync("paging");

        // Split between the two participants deliberately. The sensitive-write rate limit is per
        // signed-in user, so sending a hundred messages from one account is a test that would
        // sometimes get a 429 and sometimes not, depending on how fast the machine happened to be.
        for (var index = 0; index < 50; index++)
        {
            await SendMessageAsync(
                thread.Coach,
                thread.ConversationId,
                $"from the coach {index.ToString(CultureInfo.InvariantCulture)}");
            await SendMessageAsync(
                thread.Client,
                thread.ConversationId,
                $"from the client {index.ToString(CultureInfo.InvariantCulture)}");
        }

        var collected = new List<long>();
        long cursor = 0;
        var pages = 0;
        while (pages++ < 10)
        {
            var page = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId, cursor, 100);
            Assert.IsLessThanOrEqualTo(100, page.Items.Length, "The server caps a page at 100.");
            collected.AddRange(page.Items.Select(item => item.EventSequence));
            if (!page.HasMore)
            {
                break;
            }

            Assert.IsNotNull(page.NextAfterEventSequence);
            cursor = page.NextAfterEventSequence.Value;
        }

        // One creation plus a hundred sends: more than one page, so the loop has to run twice.
        Assert.HasCount(101, collected);
        Assert.IsGreaterThanOrEqualTo(2, pages, "A hundred and one events cannot fit in one page.");
        CollectionAssert.AreEqual(
            Enumerable.Range(1, 101).Select(value => (long)value).ToArray(),
            collected,
            "Ascending, contiguous and complete: looping bounded pages never silently truncates.");
    }

    [TestMethod]
    public async Task CatchUpReconcilesAfterALostLiveFrame()
    {
        var thread = await OpenThreadAsync("lost-frame");
        await SweepAsync();
        var missed = await SendMessageAsync(thread.Coach, thread.ConversationId, "the frame nobody received");
        Hub.Reset();
        // The hub refuses, so the frame is never delivered — exactly what an outage looks like to a
        // client that stayed connected.
        Hub.FailNext(1000);
        await SweepAsync();
        Assert.IsEmpty(Hub.Frames);

        var events = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId, 1);

        Assert.IsTrue(
            events.Items.Any(item => item.Message?.Id == missed.Id),
            "PostgreSQL is what makes a lost frame recoverable; Redis could not have replayed it.");
        Assert.AreEqual("the frame nobody received", events.Items.Single(item => item.Message?.Id == missed.Id).Message!.Body);
    }

    [TestMethod]
    public async Task CatchUpExposesAWatermarkAndTheThreadReadEstablishesTheSameOne()
    {
        var thread = await OpenThreadAsync("watermark");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "one");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "two");

        var page = await GetMessagesAsync(thread.Client, thread.ConversationId);
        var events = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId);

        Assert.AreEqual(
            3L,
            page.LatestEventSequence,
            "The full read establishes the watermark a client subscribes and then catches up from.");
        Assert.AreEqual(page.LatestEventSequence, events.LatestEventSequence);
        Assert.AreEqual(
            page.LatestEventSequence,
            events.Items[^1].EventSequence,
            "Reading everything leaves the caller exactly at the watermark.");
    }

    [TestMethod]
    public async Task CatchUpRefusesAStrangerAWrongWorkspaceAndANonParticipantIdentically()
    {
        var thread = await OpenThreadAsync("catch-up-denied");
        var other = await OpenThreadAsync("catch-up-other");
        var stranger = await AddSecondCoachAsync(thread.Workspace, "stranger");

        // Unknown conversation.
        await AssertStatusAsync(
            await GetRealtimeEventsResponseAsync(thread.Client, Guid.NewGuid()),
            HttpStatusCode.NotFound);
        // Another workspace's conversation.
        await AssertStatusAsync(
            await GetRealtimeEventsResponseAsync(thread.Client, other.ConversationId),
            HttpStatusCode.NotFound);
        // A member of this workspace who is not a participant.
        await AssertStatusAsync(
            await GetRealtimeEventsResponseAsync(stranger.Client, thread.ConversationId),
            HttpStatusCode.NotFound);
        // Unauthenticated.
        var anonymous = CreateClient();
        SetTenant(anonymous, thread.Workspace.TenantId);
        await AssertStatusAsync(
            await GetRealtimeEventsResponseAsync(anonymous, thread.ConversationId),
            HttpStatusCode.Unauthorized);
    }

    [TestMethod]
    public async Task CatchUpRefusesADeniedParticipantWithTheStableReasonAndNoContent()
    {
        var thread = await OpenThreadAsync("catch-up-denied-reason");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "not for a lapsed plan");
        await ChangeEnrollmentAsync(
            thread.Workspace,
            thread.Workspace.Enrollment!.Id,
            "cancel",
            "Phase 6B-2B catch-up test.");

        var response = await GetRealtimeEventsResponseAsync(thread.Client, thread.ConversationId);

        Assert.AreEqual("Cancelled", await AccessReasonAsync(response));
        Assert.DoesNotContain("not for a lapsed plan", await response.Content.ReadAsStringAsync());
    }

    [TestMethod]
    public async Task CatchUpRefusesANegativeCursorAndCapsAnOversizedPage()
    {
        var thread = await OpenThreadAsync("catch-up-bounds");

        await AssertStatusAsync(
            await GetRealtimeEventsResponseAsync(thread.Client, thread.ConversationId, -1),
            HttpStatusCode.BadRequest);

        // An oversized page is clamped rather than refused: the caller asked for more than the server
        // will serve, and the honest answer is a full page plus a cursor.
        var page = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId, 0, 5000);
        Assert.IsLessThanOrEqualTo(100, page.Items.Length);
    }

    // ---------- acknowledgement ----------

    [TestMethod]
    public async Task ARecipientAcknowledgementSetsCounterpartDeliveryOnceAndNeverMovesIt()
    {
        var thread = await OpenThreadAsync("ack");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "acknowledge this");
        var sendEvent = (await EventsAsync(thread.ConversationId)).Single(item => item.MessageId == sent.Id);

        var first = await AcknowledgeAsync(thread.Client, thread.ConversationId, sendEvent.EventSequence);
        Assert.AreEqual(1, first.Accepted);
        Assert.AreEqual(0, first.AlreadyAcknowledged);
        var stamped = await RealtimeAcknowledgedAtAsync(sent.Id);
        Assert.IsNotNull(stamped);

        // The sender now sees the second delivery state, and it says what it means.
        var coachView = (await GetMessagesAsync(thread.Coach, thread.ConversationId))
            .Items.Single(item => item.Id == sent.Id);
        Assert.AreEqual("RealtimeAcknowledged", coachView.DeliveryState);

        // A repeat, which is normal under at-least-once delivery, is a success that changes nothing.
        Clock.Advance(TimeSpan.FromHours(2));
        var repeat = await AcknowledgeAsync(thread.Client, thread.ConversationId, sendEvent.EventSequence);
        Assert.AreEqual(0, repeat.Accepted);
        Assert.AreEqual(1, repeat.AlreadyAcknowledged);
        Assert.AreEqual(stamped, await RealtimeAcknowledgedAtAsync(sent.Id), "The instant never moves.");
        Assert.AreEqual(1L, await AcknowledgementCountAsync(thread.ConversationId));
    }

    /// <summary>
    /// The rule that keeps the counterpart timestamp honest, over HTTP.
    /// </summary>
    [TestMethod]
    public async Task ASenderAcknowledgingTheirOwnEventNeverSetsCounterpartDelivery()
    {
        var thread = await OpenThreadAsync("self-ack");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "my own message");
        var sendEvent = (await EventsAsync(thread.ConversationId)).Single(item => item.MessageId == sent.Id);

        var result = await AcknowledgeAsync(thread.Coach, thread.ConversationId, sendEvent.EventSequence);

        Assert.AreEqual(1, result.Accepted, "The sender's own tab really did accept the event.");
        Assert.IsNull(
            await RealtimeAcknowledgedAtAsync(sent.Id),
            "But that is evidence about nobody else, so the counterpart timestamp stays null.");
        var coachView = (await GetMessagesAsync(thread.Coach, thread.ConversationId))
            .Items.Single(item => item.Id == sent.Id);
        Assert.AreEqual("Persisted", coachView.DeliveryState);
    }

    [TestMethod]
    public async Task ConcurrentDuplicateAcknowledgementsWriteOneAppendOnlyFact()
    {
        var thread = await OpenThreadAsync("concurrent-ack");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "acknowledged twice at once");
        var sendEvent = (await EventsAsync(thread.ConversationId)).Single(item => item.MessageId == sent.Id);
        var second = await SecondSessionAsync(thread.Workspace.ClientEmail, thread.Workspace.TenantId);

        await RefreshCsrfAsync(thread.Client);
        var responses = await Task.WhenAll(
            PostAcknowledgementAsync(thread.Client, thread.ConversationId, sendEvent.EventSequence),
            PostAcknowledgementAsync(second, thread.ConversationId, sendEvent.EventSequence));

        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        Assert.AreEqual(
            1L,
            await AcknowledgementCountAsync(thread.ConversationId),
            "A unique key makes a concurrent duplicate one durable fact rather than a race.");
        Assert.IsNotNull(await RealtimeAcknowledgedAtAsync(sent.Id));
    }

    [TestMethod]
    public async Task AcknowledgementChangesNeitherReadCursorNorUnreadCount()
    {
        var thread = await OpenThreadAsync("ack-not-read");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "unread and acknowledged");
        var sendEvent = (await EventsAsync(thread.ConversationId)).Single(item => item.MessageId == sent.Id);
        var before = await GetMessagesAsync(thread.Client, thread.ConversationId);

        await AcknowledgeAsync(thread.Client, thread.ConversationId, sendEvent.EventSequence);

        var after = await GetMessagesAsync(thread.Client, thread.ConversationId);
        Assert.AreEqual(
            before.ReadState.LastReadSequence,
            after.ReadState.LastReadSequence,
            "Delivery is not reading. NOT-001 has warned about this confusion since Phase 1.");
        Assert.AreEqual(before.ReadState.UnreadCount, after.ReadState.UnreadCount);
        Assert.AreEqual(
            0L,
            await ReadCursorAsync(thread.ConversationId, thread.Workspace.ClientUserId),
            "The stored cursor is untouched.");
        Assert.IsTrue(after.Items.Single(item => item.Id == sent.Id).IsUnreadByCaller);
    }

    [TestMethod]
    public async Task AcknowledgementIgnoresAPositionThisParticipantWasNeverSent()
    {
        var thread = await OpenThreadAsync("ack-unaddressed");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "one event only");

        // Positions beyond the tip name no event at all, so they are ignored rather than invented.
        var result = await AcknowledgeAsync(thread.Client, thread.ConversationId, 900, 901);

        Assert.AreEqual(0, result.Accepted);
        Assert.AreEqual(0, result.AlreadyAcknowledged);
        Assert.AreEqual(0L, await AcknowledgementCountAsync(thread.ConversationId));
    }

    [TestMethod]
    public async Task AcknowledgementInputIsBoundedAndDeterministic()
    {
        var thread = await OpenThreadAsync("ack-bounds");
        await RefreshCsrfAsync(thread.Client);

        var oversized = await PostAcknowledgementAsync(
            thread.Client,
            thread.ConversationId,
            [.. Enumerable.Range(1, 101).Select(value => (long)value)]);
        await AssertStatusAsync(oversized, HttpStatusCode.BadRequest);

        await RefreshCsrfAsync(thread.Client);
        var negative = await PostAcknowledgementAsync(thread.Client, thread.ConversationId, 0, -3);
        await AssertStatusAsync(negative, HttpStatusCode.BadRequest);

        // Duplicates inside one request collapse rather than conflicting.
        var duplicated = await AcknowledgeAsync(thread.Client, thread.ConversationId, 1, 1, 1);
        Assert.AreEqual(1, duplicated.Accepted);
        Assert.AreEqual(1L, await AcknowledgementCountAsync(thread.ConversationId));
    }

    [TestMethod]
    public async Task AcknowledgementRefusesAStrangerAndADeniedParticipantWithoutDisclosure()
    {
        var thread = await OpenThreadAsync("ack-denied");
        var other = await OpenThreadAsync("ack-other");
        var stranger = await AddSecondCoachAsync(thread.Workspace, "ack-stranger");

        await RefreshCsrfAsync(stranger.Client);
        await AssertStatusAsync(
            await PostAcknowledgementAsync(stranger.Client, thread.ConversationId, 1),
            HttpStatusCode.NotFound);
        await RefreshCsrfAsync(thread.Client);
        await AssertStatusAsync(
            await PostAcknowledgementAsync(thread.Client, other.ConversationId, 1),
            HttpStatusCode.NotFound);

        await ChangeEnrollmentAsync(
            thread.Workspace,
            thread.Workspace.Enrollment!.Id,
            "cancel",
            "Phase 6B-2B acknowledgement test.");
        await RefreshCsrfAsync(thread.Client);
        Assert.AreEqual(
            "Cancelled",
            await AccessReasonAsync(
                await PostAcknowledgementAsync(thread.Client, thread.ConversationId, 1)));
        Assert.AreEqual(0L, await AcknowledgementCountAsync(thread.ConversationId));
    }

    // ---------- privacy ----------

    [TestMethod]
    public async Task NoEventAttemptAcknowledgementOrLogCarriesContent()
    {
        const string body = "a sentence that must not leak";
        const string reason = "a moderation reason that must not leak";
        var thread = await OpenThreadAsync("privacy");
        var clientMessage = await SendMessageAsync(thread.Client, thread.ConversationId, body);
        await SweepAsync();
        await ModerateMessageAsync(
            thread.Coach,
            thread.ConversationId,
            clientMessage.Id,
            reason,
            clientMessage.Version);
        await SweepAsync();
        await AcknowledgeAsync(thread.Client, thread.ConversationId, 1);

        // Every column of every realtime table, concatenated. If any of it could hold content, this
        // is where it would be.
        foreach (var table in new[]
                 {
                     "RealtimeEvents",
                     "RealtimeRecipients",
                     "RealtimeAttempts",
                     "RealtimeAcknowledgements",
                 })
        {
            var dump = await ScalarAsync<string>(
                $"""SELECT coalesce(string_agg(t::text, ' '), '') FROM messaging."{table}" t""");
            Assert.DoesNotContain(body, dump, $"{table} carries a message body.");
            Assert.DoesNotContain(reason, dump, $"{table} carries a moderation reason.");
            Assert.DoesNotContain("Messaged", dump, $"{table} carries a participant name.");
            Assert.DoesNotContain("@tbgym.test", dump, $"{table} carries an email address.");
        }

        AssertLogIsSafe(thread.Workspace, body, reason);
    }
}
