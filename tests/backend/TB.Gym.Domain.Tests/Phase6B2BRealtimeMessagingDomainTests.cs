using TB.Gym.Modules.Messaging;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The Phase 6B-2B realtime model, tested where it can be tested without a database.
/// </summary>
/// <remarks>
/// The claim lifecycle, the attempt budget, the retry schedule, the sender-acknowledgement rule and
/// the configuration validation are all pure decisions, so they are asserted here. Everything that is
/// a property of concurrent PostgreSQL — the sequence allocation, the <c>SKIP LOCKED</c> claim, the
/// deferred triggers, the two-replica race — is asserted against a real database in the integration
/// suite, because a test that proved those against an in-memory provider would be proving something
/// about the provider.
/// </remarks>
[TestClass]
public sealed class Phase6B2BRealtimeMessagingDomainTests
{
    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid ConversationId = Guid.CreateVersion7();
    private static readonly Guid CoachUserId = Guid.CreateVersion7();
    private static readonly Guid ClientUserId = Guid.CreateVersion7();
    private static readonly Guid ClientProfileId = Guid.CreateVersion7();
    private static readonly Guid CommandRecordId = Guid.CreateVersion7();
    private static readonly DateTimeOffset Now = new(2026, 9, 4, 8, 0, 0, TimeSpan.Zero);

    // ---------- the two sequences ----------

    [TestMethod]
    public void EventPositionsAreSeparateFromMessagePositionsAndBothStartEmpty()
    {
        var conversation = NewConversation();

        Assert.AreEqual(0L, conversation.LastSequence);
        Assert.AreEqual(0L, conversation.LastEventSequence, "A new conversation has no events yet.");

        Assert.AreEqual(1L, conversation.AllocateNextSequence());
        Assert.AreEqual(1L, conversation.AllocateNextEventSequence());
        Assert.AreEqual(2L, conversation.AllocateNextEventSequence());

        Assert.AreEqual(
            1L,
            conversation.LastSequence,
            "Allocating an event position must not move the message allocator.");
        Assert.AreEqual(2L, conversation.LastEventSequence);
    }

    /// <summary>
    /// The reason the two counters exist: an edit of an old message is a new event about an old
    /// position, and a client resuming from the message sequence would never ask for it.
    /// </summary>
    [TestMethod]
    public void AnEditOfAnOldMessageTakesANewEventPositionAndKeepsItsMessagePosition()
    {
        var conversation = NewConversation();
        var firstSequence = conversation.AllocateNextSequence();
        var first = Message.Send(TenantId, ConversationId, CoachUserId, firstSequence, "first", Now, out _);
        var firstEvent = NewEvent(conversation, MessagingRealtimeEventKind.MessageSent, first);

        var secondSequence = conversation.AllocateNextSequence();
        var second = Message.Send(TenantId, ConversationId, CoachUserId, secondSequence, "second", Now, out _);
        NewEvent(conversation, MessagingRealtimeEventKind.MessageSent, second);

        first.Edit(CoachUserId, "first, corrected", Now);
        var editEvent = NewEvent(conversation, MessagingRealtimeEventKind.MessageEdited, first);

        Assert.AreEqual(1L, firstEvent.EventSequence);
        Assert.AreEqual(
            3L,
            editEvent.EventSequence,
            "The edit is the newest thing that happened, so it takes the newest event position.");
        Assert.AreEqual(
            1L,
            editEvent.MessageSequence,
            "The message keeps the position it has always had; only the event is new.");
        Assert.AreEqual(2, editEvent.MessageRevisionNumber);
    }

    [TestMethod]
    public void AConversationCreationEventNamesNoMessageAndEveryOtherKindMustNameOne()
    {
        var conversation = NewConversation();
        var created = MessagingRealtimeEvent.Record(
            TenantId,
            ConversationId,
            conversation.AllocateNextEventSequence(),
            MessagingRealtimeEventKind.ConversationCreated,
            messageId: null,
            messageSequence: null,
            messageRevisionNumber: null,
            CommandRecordId,
            Now);

        Assert.IsNull(created.MessageId);
        Assert.IsNull(created.MessageSequence);
        Assert.IsNull(created.MessageRevisionNumber);

        // Half a reference is a row nothing can be projected from, so it is refused rather than
        // stored and discovered later by whatever tried to render it.
        Assert.ThrowsExactly<ArgumentException>(() => MessagingRealtimeEvent.Record(
            TenantId,
            ConversationId,
            2,
            MessagingRealtimeEventKind.MessageSent,
            messageId: null,
            messageSequence: null,
            messageRevisionNumber: null,
            CommandRecordId,
            Now));
        Assert.ThrowsExactly<ArgumentException>(() => MessagingRealtimeEvent.Record(
            TenantId,
            ConversationId,
            2,
            MessagingRealtimeEventKind.MessageSent,
            Guid.CreateVersion7(),
            messageSequence: null,
            messageRevisionNumber: 1,
            CommandRecordId,
            Now));
    }

    /// <summary>
    /// The event row is routing and audit only. Nothing on it can carry what somebody wrote.
    /// </summary>
    [TestMethod]
    public void ARealtimeEventCarriesNoContentAtAll()
    {
        var textProperties = typeof(MessagingRealtimeEvent)
            .GetProperties()
            .Where(property => property.PropertyType == typeof(string))
            .Select(property => property.Name)
            .ToArray();

        Assert.IsEmpty(
            textProperties,
            $"A realtime event carries text: {string.Join(", ", textProperties)}. "
            + "A body, a revision, a moderation reason or a name has no place in a routing record.");
    }

    // ---------- recipients ----------

    [TestMethod]
    public void AnEventAddressesEveryExplicitParticipantIncludingTheActor()
    {
        var conversation = NewConversation();
        var message = Message.Send(
            TenantId,
            ConversationId,
            CoachUserId,
            conversation.AllocateNextSequence(),
            "hello",
            Now,
            out _);
        var realtimeEvent = NewEvent(conversation, MessagingRealtimeEventKind.MessageSent, message);

        var recipients = realtimeEvent.CreateRecipients([CoachUserId, ClientUserId], Now);

        CollectionAssert.AreEquivalent(
            new[] { CoachUserId, ClientUserId },
            recipients.Select(recipient => recipient.RecipientUserId).ToArray(),
            "Both sides get publication state; the sender's own other tabs still have to be told.");
        Assert.IsTrue(recipients.All(recipient => recipient.Status == MessagingRealtimeStatus.Pending));
        Assert.IsTrue(recipients.All(recipient => recipient.AttemptCount == 0));
        Assert.IsTrue(recipients.All(recipient => recipient.ClaimToken is null));
    }

    [TestMethod]
    public void ARepeatedParticipantProducesOneRecipientRow()
    {
        var conversation = NewConversation();
        var realtimeEvent = NewEvent(conversation, MessagingRealtimeEventKind.ConversationCreated, null);

        var recipients = realtimeEvent.CreateRecipients([CoachUserId, CoachUserId, ClientUserId], Now);

        Assert.HasCount(2, recipients);
    }

    // ---------- claim, lease and the attempt budget ----------

    [TestMethod]
    public void AClaimTakesTheLeaseStartsAnAttemptAndIssuesItsOwnToken()
    {
        var recipient = NewRecipient();

        var token = recipient.Claim(Now, TimeSpan.FromSeconds(60), maximumAttempts: 5);

        Assert.AreEqual(MessagingRealtimeStatus.Processing, recipient.Status);
        Assert.AreEqual(1, recipient.AttemptCount, "The attempt is spent before anything is published.");
        Assert.AreEqual(token, recipient.ClaimToken);
        Assert.AreEqual(Now.AddSeconds(60), recipient.ClaimExpiresAtUtc);
        Assert.AreNotEqual(Guid.Empty, token);
    }

    [TestMethod]
    public void TwoClaimsOfTheSameRowIssueDifferentTokens()
    {
        var first = NewRecipient();
        var second = NewRecipient();

        var firstToken = first.Claim(Now, TimeSpan.FromSeconds(60), 5);
        var secondToken = second.Claim(Now, TimeSpan.FromSeconds(60), 5);

        Assert.AreNotEqual(
            firstToken,
            secondToken,
            "A claim token is what proves a finalization belongs to the worker that started it.");
    }

    [TestMethod]
    public void AStaleClaimantCannotFinalizeSuppressOrDeadLetterAReplacement()
    {
        var recipient = NewRecipient();
        var expiredToken = recipient.Claim(Now, TimeSpan.FromSeconds(30), 5);

        // The lease runs out and another replica takes it over.
        var later = Now.AddMinutes(1);
        Assert.IsTrue(recipient.IsClaimExpired(later));
        var replacementToken = recipient.Claim(later, TimeSpan.FromSeconds(30), 5);
        Assert.AreNotEqual(expiredToken, replacementToken);
        Assert.AreEqual(2, recipient.AttemptCount);

        Assert.ThrowsExactly<InvalidOperationException>(
            () => recipient.MarkPublished(expiredToken, later),
            "A superseded claimant must not be able to record a publication.");
        Assert.ThrowsExactly<InvalidOperationException>(
            () => recipient.Suppress(expiredToken, later, MessagingRealtimeSuppressionCodes.FeatureDenied));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => recipient.MarkDeadLettered(expiredToken, later, MessagingRealtimeFailureCodes.PublishTransient));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => recipient.MarkRetrying(expiredToken, later.AddMinutes(1), MessagingRealtimeFailureCodes.PublishTransient));

        // The replacement can, and it is the only one that can.
        recipient.MarkPublished(replacementToken, later);
        Assert.AreEqual(MessagingRealtimeStatus.Published, recipient.Status);
    }

    [TestMethod]
    public void ATerminalPublicationCannotBeDispatchedAgain()
    {
        var published = NewRecipient();
        var token = published.Claim(Now, TimeSpan.FromSeconds(60), 5);
        published.MarkPublished(token, Now);

        Assert.IsTrue(published.IsTerminal);
        Assert.IsFalse(published.IsClaimable(Now.AddDays(1)));
        Assert.IsNull(published.ClaimToken, "A terminal row never carries a live claim.");
        Assert.ThrowsExactly<InvalidOperationException>(
            () => published.Claim(Now.AddDays(1), TimeSpan.FromSeconds(60), 5));
        Assert.ThrowsExactly<InvalidOperationException>(() => published.MarkAttemptsExhausted(Now.AddDays(1)));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => published.SuppressBeforeClaim(Now.AddDays(1), MessagingRealtimeSuppressionCodes.FeatureDenied));
    }

    /// <summary>
    /// Every started attempt counts, and the maximum is a bound rather than a count of successes.
    /// </summary>
    [TestMethod]
    [DataRow(1)]
    [DataRow(2)]
    [DataRow(5)]
    // Deliberately beyond the four-entry backoff table: a configured maximum larger than the schedule
    // is exactly where an off-by-one produces attempt maximum + 1.
    [DataRow(9)]
    [DataRow(20)]
    public void AttemptsNeverExceedTheConfiguredMaximum(int maximumAttempts)
    {
        var recipient = NewRecipient();
        var now = Now;

        for (var attempt = 1; attempt <= maximumAttempts; attempt++)
        {
            var token = recipient.Claim(now, TimeSpan.FromSeconds(30), maximumAttempts);
            Assert.AreEqual(attempt, recipient.AttemptCount);
            var next = MessagingRealtimeRetryPolicy.NextAttemptAtUtc(attempt, maximumAttempts, now);
            if (next is { } nextAttemptAtUtc)
            {
                recipient.MarkRetrying(token, nextAttemptAtUtc, MessagingRealtimeFailureCodes.PublishTransient);
                now = nextAttemptAtUtc;
                continue;
            }

            recipient.MarkDeadLettered(token, now, MessagingRealtimeFailureCodes.AttemptsExhausted);
        }

        Assert.AreEqual(MessagingRealtimeStatus.DeadLettered, recipient.Status);
        Assert.AreEqual(
            maximumAttempts,
            recipient.AttemptCount,
            "The budget is a bound on started attempts, so it is reached exactly and never passed.");
        Assert.ThrowsExactly<InvalidOperationException>(
            () => recipient.Claim(now.AddDays(1), TimeSpan.FromSeconds(30), maximumAttempts));
    }

    /// <summary>
    /// An abandoned lease still consumed its attempt, so reclaiming at the maximum closes the row
    /// using the real last attempt rather than inventing attempt maximum + 1.
    /// </summary>
    [TestMethod]
    public void ReclaimingAtTheMaximumDeadLettersWithoutInventingAnExtraAttempt()
    {
        const int maximumAttempts = 2;
        var recipient = NewRecipient();

        recipient.Claim(Now, TimeSpan.FromSeconds(30), maximumAttempts);
        var expired = Now.AddMinutes(5);
        recipient.Claim(expired, TimeSpan.FromSeconds(30), maximumAttempts);
        Assert.AreEqual(2, recipient.AttemptCount);

        var stillExpired = expired.AddMinutes(5);
        Assert.IsTrue(recipient.IsClaimExpired(stillExpired));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => recipient.Claim(stillExpired, TimeSpan.FromSeconds(30), maximumAttempts),
            "A third claim would be attempt three of a budget of two.");

        recipient.MarkAttemptsExhausted(stillExpired);
        Assert.AreEqual(MessagingRealtimeStatus.DeadLettered, recipient.Status);
        Assert.AreEqual(2, recipient.AttemptCount);
        Assert.AreEqual(MessagingRealtimeFailureCodes.AttemptsExhausted, recipient.FailureCode);
        Assert.IsNull(recipient.ClaimToken);
    }

    [TestMethod]
    public void SuppressionBeforeAClaimCostsNoAttemptAndSuppressionAfterOneKeepsIt()
    {
        var beforeClaim = NewRecipient();
        beforeClaim.SuppressBeforeClaim(Now, MessagingRealtimeSuppressionCodes.MembershipInactive);
        Assert.AreEqual(0, beforeClaim.AttemptCount, "Nothing was tried, so nothing was spent.");
        Assert.AreEqual(MessagingRealtimeStatus.Suppressed, beforeClaim.Status);

        var afterClaim = NewRecipient();
        var token = afterClaim.Claim(Now, TimeSpan.FromSeconds(60), 5);
        afterClaim.Suppress(token, Now, MessagingRealtimeSuppressionCodes.RelationshipBlocked);
        Assert.AreEqual(
            1,
            afterClaim.AttemptCount,
            "The attempt was durably started before authorization was rechecked, so it stays counted.");
        Assert.AreEqual(MessagingRealtimeStatus.Suppressed, afterClaim.Status);
        Assert.AreEqual(MessagingRealtimeSuppressionCodes.RelationshipBlocked, afterClaim.FailureCode);
    }

    [TestMethod]
    public void APublishedRowCarriesNoFailureCodeAndATerminalRowCarriesNoClaim()
    {
        var recipient = NewRecipient();
        var firstToken = recipient.Claim(Now, TimeSpan.FromSeconds(60), 5);
        recipient.MarkRetrying(firstToken, Now.AddSeconds(5), MessagingRealtimeFailureCodes.PublishTransient);
        Assert.AreEqual(MessagingRealtimeFailureCodes.PublishTransient, recipient.FailureCode);

        var secondToken = recipient.Claim(Now.AddSeconds(5), TimeSpan.FromSeconds(60), 5);
        recipient.MarkPublished(secondToken, Now.AddSeconds(6));

        Assert.IsNull(
            recipient.FailureCode,
            "A publication that succeeded on a retry has nothing left to explain.");
        Assert.IsNull(recipient.ClaimToken);
        Assert.IsNull(recipient.ClaimExpiresAtUtc);
        Assert.AreEqual(Now.AddSeconds(6), recipient.PublishedAtUtc);
        Assert.AreEqual(Now.AddSeconds(6), recipient.CompletedAtUtc);
    }

    // ---------- attempts ----------

    [TestMethod]
    public void ACompletedAttemptIsImmutable()
    {
        var attempt = MessagingRealtimeAttempt.Start(TenantId, Guid.CreateVersion7(), 1, Guid.CreateVersion7(), Now);
        Assert.IsFalse(attempt.IsCompleted);

        attempt.Publish(Now.AddSeconds(1));

        Assert.IsTrue(attempt.IsCompleted);
        Assert.AreEqual(MessagingRealtimeOutcome.Published, attempt.Outcome);
        Assert.IsNull(attempt.FailureCode, "A published attempt has nothing to explain.");
        Assert.ThrowsExactly<InvalidOperationException>(() => attempt.Publish(Now.AddSeconds(2)));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => attempt.FailTransiently(Now.AddSeconds(2), MessagingRealtimeFailureCodes.PublishTransient));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => attempt.Abandon(Now.AddSeconds(2), MessagingRealtimeFailureCodes.ClaimExpired));
    }

    [TestMethod]
    public void AnAttemptNumberIsPositiveAndBoundedByTheHardCeiling()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => MessagingRealtimeAttempt.Start(TenantId, Guid.CreateVersion7(), 0, Guid.CreateVersion7(), Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => MessagingRealtimeAttempt.Start(
                TenantId,
                Guid.CreateVersion7(),
                MessagingRealtimeOptions.MaximumMaximumAttempts + 1,
                Guid.CreateVersion7(),
                Now));
    }

    // ---------- acknowledgement ----------

    /// <summary>
    /// The rule that keeps the counterpart-delivery timestamp honest.
    /// </summary>
    [TestMethod]
    public void ASenderAcknowledgingTheirOwnMessageDoesNotSetCounterpartDelivery()
    {
        var message = NewMessage();

        var wrote = message.AcknowledgeRealtimeDelivery(CoachUserId, Now.AddMinutes(1));

        Assert.IsFalse(wrote, "The sender's own tab receiving its own message is evidence about nobody.");
        Assert.IsNull(message.RealtimeAcknowledgedAtUtc);
        Assert.AreEqual(MessageDeliveryState.Persisted, message.DeliveryState);
    }

    [TestMethod]
    public void ARecipientAcknowledgementSetsTheTimestampOnceAndNeverMovesIt()
    {
        var message = NewMessage();
        var first = Now.AddMinutes(1);

        Assert.IsTrue(message.AcknowledgeRealtimeDelivery(ClientUserId, first));
        Assert.AreEqual(first, message.RealtimeAcknowledgedAtUtc);
        Assert.AreEqual(MessageDeliveryState.RealtimeAcknowledged, message.DeliveryState);

        // Delivery is at least once, so a duplicate after a reclaimed publication, a reconnect or a
        // second device is normal. The interesting instant is the first one.
        Assert.IsFalse(message.AcknowledgeRealtimeDelivery(ClientUserId, Now.AddHours(3)));
        Assert.AreEqual(first, message.RealtimeAcknowledgedAtUtc);
    }

    [TestMethod]
    public void AnAcknowledgementNeverPrecedesAvailabilityAndProviderAcknowledgementStaysNull()
    {
        var message = NewMessage();

        // A clock adjustment must not be able to say the other side had a message before it existed.
        Assert.IsTrue(message.AcknowledgeRealtimeDelivery(ClientUserId, Now.AddHours(-5)));
        Assert.AreEqual(message.AvailableAtUtc, message.RealtimeAcknowledgedAtUtc);
        Assert.IsNull(
            message.ProviderAcknowledgedAtUtc,
            "No provider channel exists, so nothing can have acknowledged one.");
    }

    [TestMethod]
    public void AnEmptyActorNeverSetsDelivery()
    {
        var message = NewMessage();

        Assert.IsFalse(message.AcknowledgeRealtimeDelivery(Guid.Empty, Now.AddMinutes(1)));
        Assert.IsNull(message.RealtimeAcknowledgedAtUtc);
    }

    [TestMethod]
    public void AnAcknowledgementIsAppendOnlyAndServerStamped()
    {
        var acknowledgement = MessagingRealtimeAcknowledgement.Record(
            TenantId,
            ConversationId,
            Guid.CreateVersion7(),
            ClientUserId,
            Now);

        Assert.AreEqual(Now, acknowledgement.AcknowledgedAtUtc);

        var writable = typeof(MessagingRealtimeAcknowledgement)
            .GetProperties()
            .Where(property => property.SetMethod is { IsPublic: true })
            .Select(property => property.Name)
            .ToArray();
        Assert.IsEmpty(
            writable,
            $"MessagingRealtimeAcknowledgement exposes public setters: {string.Join(", ", writable)}");
    }

    // ---------- retry schedule ----------

    [TestMethod]
    public void TheRetryScheduleIsTheNamedTableAndTheLastAttemptDeadLetters()
    {
        TimeSpan[] expected =
        [
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(30),
            TimeSpan.FromMinutes(2),
            TimeSpan.FromMinutes(10),
        ];
        // The table is asserted exactly, because a retry schedule that drifts is one nobody can
        // reason about afterwards. The schedule's name is a compile-time constant, so the compiler
        // already guarantees it; what needs a test is the shape of the curve and where it stops.
        CollectionAssert.AreEqual(expected, MessagingRealtimeRetryPolicy.Schedule.ToArray());

        const int maximumAttempts = 5;
        for (var attempt = 1; attempt < maximumAttempts; attempt++)
        {
            var next = MessagingRealtimeRetryPolicy.NextAttemptAtUtc(attempt, maximumAttempts, Now);
            Assert.IsNotNull(next);
            Assert.AreEqual(Now.Add(expected[Math.Min(attempt - 1, expected.Length - 1)]), next);
        }

        Assert.IsNull(
            MessagingRealtimeRetryPolicy.NextAttemptAtUtc(maximumAttempts, maximumAttempts, Now),
            "A failure on the last permitted attempt dead-letters instead of waiting again.");
    }

    [TestMethod]
    public void AConfiguredMaximumBeyondTheTableRepeatsTheCeiling()
    {
        const int maximumAttempts = 12;

        var eighth = MessagingRealtimeRetryPolicy.NextAttemptAtUtc(8, maximumAttempts, Now);
        var eleventh = MessagingRealtimeRetryPolicy.NextAttemptAtUtc(11, maximumAttempts, Now);

        Assert.AreEqual(Now.AddMinutes(10), eighth);
        Assert.AreEqual(Now.AddMinutes(10), eleventh);
        Assert.IsNull(MessagingRealtimeRetryPolicy.NextAttemptAtUtc(12, maximumAttempts, Now));
    }

    [TestMethod]
    public void TheRetryPolicyRefusesAnOutOfRangeMaximum()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => MessagingRealtimeRetryPolicy.NextAttemptAtUtc(1, 0, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => MessagingRealtimeRetryPolicy.NextAttemptAtUtc(1, 21, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => MessagingRealtimeRetryPolicy.NextAttemptAtUtc(0, 5, Now));
    }

    // ---------- configuration ----------

    [TestMethod]
    public void OneReplicaWithoutABackplaneIsValid()
    {
        var options = new MessagingRealtimeOptions { ApiReplicaCount = 1 };
        options.AllowedOrigins.Add("https://app.example.com");

        Assert.IsNull(options.Validate(requireAllowedOrigins: true));
    }

    /// <summary>
    /// The failure this validation exists for: several replicas without a backplane look like working
    /// software until somebody's client never sees a reply.
    /// </summary>
    [TestMethod]
    public void SeveralReplicasWithoutABackplaneIsRefused()
    {
        var options = new MessagingRealtimeOptions { ApiReplicaCount = 3 };
        options.AllowedOrigins.Add("https://app.example.com");

        var problem = options.Validate(requireAllowedOrigins: true);

        Assert.IsNotNull(problem);
        Assert.Contains("ScaleOut must be Redis", problem);
    }

    [TestMethod]
    public void RedisModeWithoutAnEndpointIsRefused()
    {
        var options = new MessagingRealtimeOptions
        {
            ApiReplicaCount = 2,
            ScaleOut = MessagingScaleOutMode.Redis,
        };
        options.AllowedOrigins.Add("https://app.example.com");

        var problem = options.Validate(requireAllowedOrigins: true);

        Assert.IsNotNull(problem);
        Assert.Contains("RedisConnectionString is required", problem);
    }

    [TestMethod]
    public void AnUnknownScaleOutModeIsRefused()
    {
        var options = new MessagingRealtimeOptions { ScaleOut = (MessagingScaleOutMode)99 };
        options.AllowedOrigins.Add("https://app.example.com");

        var problem = options.Validate(requireAllowedOrigins: true);

        Assert.IsNotNull(problem);
        Assert.Contains("SingleProcess or Redis", problem);
    }

    [TestMethod]
    public void ProductionWithoutAnAllowedOriginFailsClosedAndDevelopmentDoesNot()
    {
        var options = new MessagingRealtimeOptions();

        Assert.IsNotNull(
            options.Validate(requireAllowedOrigins: true),
            "A cookie-authenticated WebSocket handshake is not protected by CORS.");
        Assert.IsNull(
            options.Validate(requireAllowedOrigins: false),
            "Development proxies the hub through the Angular dev server.");
    }

    [TestMethod]
    public void EngineeringParametersAreBounded()
    {
        Assert.Contains(
            "PollIntervalSeconds",
            Problem(new MessagingRealtimeOptions { PollIntervalSeconds = 0 }));
        Assert.Contains(
            "PollIntervalSeconds",
            Problem(new MessagingRealtimeOptions { PollIntervalSeconds = 301 }));
        Assert.Contains("BatchSize", Problem(new MessagingRealtimeOptions { BatchSize = 0 }));
        Assert.Contains("BatchSize", Problem(new MessagingRealtimeOptions { BatchSize = 501 }));
        Assert.Contains(
            "ClaimLeaseSeconds",
            Problem(new MessagingRealtimeOptions { ClaimLeaseSeconds = 14 }));
        Assert.Contains(
            "ClaimLeaseSeconds",
            Problem(new MessagingRealtimeOptions { ClaimLeaseSeconds = 901 }));
        Assert.Contains("MaximumAttempts", Problem(new MessagingRealtimeOptions { MaximumAttempts = 0 }));
        Assert.Contains("MaximumAttempts", Problem(new MessagingRealtimeOptions { MaximumAttempts = 21 }));
        Assert.Contains("ApiReplicaCount", Problem(new MessagingRealtimeOptions { ApiReplicaCount = 0 }));
        Assert.Contains("ApiReplicaCount", Problem(new MessagingRealtimeOptions { ApiReplicaCount = 101 }));
        Assert.Contains(
            "RedisChannelPrefix",
            Problem(new MessagingRealtimeOptions { RedisChannelPrefix = " " }));

        static string Problem(MessagingRealtimeOptions options) =>
            options.Validate(requireAllowedOrigins: false)
            ?? throw new AssertFailedException("The configuration was accepted.");
    }

    // ---------- hub origins ----------

    /// <summary>
    /// Origin comparison, where the failures are all in the normalization.
    /// </summary>
    [TestMethod]
    public void OriginComparisonNormalizesBothSidesAndRejectsWildcards()
    {
        string[] allowed = ["https://app.example.com", "http://localhost:4200"];

        Assert.IsTrue(MessagingHubOrigin.IsAllowed("https://app.example.com", allowed));
        Assert.IsTrue(
            MessagingHubOrigin.IsAllowed("https://APP.EXAMPLE.COM", allowed),
            "A host is case-insensitive; comparing raw strings would make this a different origin.");
        Assert.IsTrue(
            MessagingHubOrigin.IsAllowed("https://app.example.com/", allowed),
            "A trailing slash is the same origin.");
        Assert.IsTrue(MessagingHubOrigin.IsAllowed("http://localhost:4200", allowed));

        Assert.IsFalse(MessagingHubOrigin.IsAllowed("http://app.example.com", allowed), "Scheme matters.");
        Assert.IsFalse(MessagingHubOrigin.IsAllowed("https://app.example.com:8443", allowed), "Port matters.");
        Assert.IsFalse(MessagingHubOrigin.IsAllowed("https://evil.example.com", allowed));
        Assert.IsFalse(MessagingHubOrigin.IsAllowed("https://app.example.com.evil.test", allowed));
        Assert.IsFalse(MessagingHubOrigin.IsAllowed(null, allowed), "A missing origin is not an allowed one.");
        Assert.IsFalse(MessagingHubOrigin.IsAllowed(string.Empty, allowed));
        Assert.IsFalse(MessagingHubOrigin.IsAllowed("null", allowed), "A sandboxed frame sends the literal 'null'.");
    }

    [TestMethod]
    public void AWildcardOriginIsNotAValidConfigurationEntry()
    {
        Assert.IsFalse(MessagingHubOrigin.IsValid("*"));
        Assert.IsFalse(MessagingHubOrigin.IsValid("https://*.example.com"));
        Assert.IsFalse(MessagingHubOrigin.IsValid("https://app.example.com/hubs"), "An origin has no path.");
        Assert.IsFalse(MessagingHubOrigin.IsValid("ftp://app.example.com"));
        Assert.IsFalse(MessagingHubOrigin.IsValid("https://user:pass@app.example.com"));
        Assert.IsTrue(MessagingHubOrigin.IsValid("https://app.example.com"));

        var options = new MessagingRealtimeOptions();
        options.AllowedOrigins.Add("*");
        var problem = options.Validate(requireAllowedOrigins: true);
        Assert.IsNotNull(problem);
        Assert.Contains("AllowedOrigins", problem);
    }

    // ---------- codes ----------

    /// <summary>
    /// Every stable code that reaches a durable row or a log must be safe for somebody outside the
    /// conversation to read.
    /// </summary>
    [TestMethod]
    public void FailureAndSuppressionCodesAreBoundedAndCarryNothingSensitive()
    {
        var codes = typeof(MessagingRealtimeFailureCodes).GetFields()
            .Concat(typeof(MessagingRealtimeSuppressionCodes).GetFields())
            .Where(field => field is { IsLiteral: true, FieldType: { } type } && type == typeof(string))
            .Select(field => (string)field.GetRawConstantValue()!)
            .ToArray();

        Assert.IsNotEmpty(codes);
        foreach (var code in codes)
        {
            Assert.StartsWith("messaging-realtime-", code, StringComparison.Ordinal);
            Assert.IsLessThanOrEqualTo(100, code.Length, $"'{code}' is longer than the stored column allows.");
            Assert.IsTrue(
                code.All(character => char.IsAsciiLetterLower(character) || character == '-'),
                $"'{code}' is not a stable lowercase slug; a code is not a sentence.");
        }

        Assert.AreEqual(
            codes.Length,
            codes.Distinct(StringComparer.Ordinal).Count(),
            "Two conditions share one code, so an operator cannot tell them apart.");
    }

    // ---------- fixtures ----------

    private static Conversation NewConversation() =>
        Conversation.StartDirect(TenantId, ClientProfileId, CoachUserId, ClientUserId, Now);

    private static Message NewMessage() =>
        Message.Send(TenantId, ConversationId, CoachUserId, 1, "the original", Now, out _);

    private static MessagingRealtimeEvent NewEvent(
        Conversation conversation,
        MessagingRealtimeEventKind kind,
        Message? message) =>
        MessagingRealtimeEvent.Record(
            TenantId,
            ConversationId,
            conversation.AllocateNextEventSequence(),
            kind,
            message?.Id,
            message?.Sequence,
            message?.CurrentRevisionNumber,
            CommandRecordId,
            Now);

    private static MessagingRealtimeRecipient NewRecipient() =>
        MessagingRealtimeRecipient.Queue(
            TenantId,
            ConversationId,
            Guid.CreateVersion7(),
            ClientUserId,
            Now);
}
