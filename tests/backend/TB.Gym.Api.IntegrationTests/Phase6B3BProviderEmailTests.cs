using System.Net;
using System.Text;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-3B against real PostgreSQL, a real HTTP provider double and real signed webhooks.
/// </summary>
/// <remarks>
/// Everything here depends on behaviour nothing in memory reproduces: composite foreign keys that
/// cross a workspace boundary, triggers comparing a row against its previous version, deferred
/// constraint triggers that fire at commit, unique indexes that turn a duplicate webhook into a no-op,
/// and an HTTP exchange whose status code decides whether work is retried or abandoned.
/// <para>
/// The tests are organised as the facts they prove rather than as the code they touch: what a
/// provider's acceptance does and does not establish, how each response is classified, what a signed
/// event may change, what a forged one may not, and what direct SQL cannot fabricate.
/// </para>
/// </remarks>
[TestClass]
public sealed partial class Phase6B3BProviderEmailTests
{
    // ---------- acceptance ----------

    /// <summary>
    /// A provider accepting the request records a real identifier and a real acceptance instant, and
    /// claims nothing beyond that. In particular the destination mail server has said nothing yet, so
    /// recipient-server acceptance stays null until an authenticated event says otherwise.
    /// </summary>
    [TestMethod]
    public async Task AProviderAcceptedResponseRecordsRealEvidenceWithoutClaimingDelivery()
    {
        var workspace = await CreateWorkspaceAsync("accept");
        Provider.Responder = _ => ProviderResponse.Accepted("prov_accept_1");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        var outcome = await SweepAsync();

        Assert.AreEqual(2, outcome.Claimed, "Both channels of one intent are claimed.");
        Assert.AreEqual(2, outcome.Materialized);

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Materialized", email.Status);
        Assert.AreEqual(NotificationEmailAdapters.ResendAdapterName, email.TransportAdapter);
        Assert.AreEqual("prov_accept_1", email.ProviderMessageId);
        Assert.IsNotNull(email.ProviderAcceptedAtUtc);

        var attempt = (await AttemptsAsync(intent, NotificationChannel.Email)).Single();
        Assert.AreEqual("Succeeded", attempt.Outcome);
        Assert.AreEqual("prov_accept_1", attempt.ProviderMessageId);

        var message = await ProviderMessageAsync("prov_accept_1");
        Assert.AreEqual(email.Id, message.ChannelDeliveryId);
        Assert.AreEqual(workspace.ClientUserId, message.RecipientUserId);
        Assert.AreEqual(NotificationEmailAdapters.ResendAdapterName, message.Adapter);
        Assert.AreEqual(Fingerprint(workspace.ClientEmail), message.RecipientAddressFingerprint);
        Assert.AreEqual(ActiveFingerprintKeyId, message.FingerprintKeyId);
        Assert.IsNull(
            message.RecipientServerAcceptedAtUtc,
            "Provider acceptance is not recipient-server acceptance and must never be written from it.");
        Assert.IsNull(message.BouncedAtUtc);
        Assert.IsNull(message.ComplainedAtUtc);
        Assert.AreEqual(0, message.EventCount);
        Assert.IsNull(message.LastEventReceivedAtUtc);

        // And the request itself carried the credential as a bearer header on that one message, the
        // idempotency key, and a user agent naming this application.
        var request = Provider.Requests.Single();
        Assert.AreEqual($"Bearer {ApiKey}", request.Authorization);
        Assert.StartsWith("TB.Gym-Notifications/", request.UserAgent);
        Assert.Contains(intent.ToString("N"), request.IdempotencyKey);
        Assert.Contains(workspace.ClientEmail, request.Body, "The provider is the one place the address goes.");
    }

    /// <summary>
    /// The in-app inbox row is written whatever the provider does. That independence is the whole
    /// point of the per-channel model: a provider outage must not cost somebody the notification they
    /// can already read when they sign in.
    /// </summary>
    [TestMethod]
    public async Task InAppMaterializationIsIndependentOfProviderFailure()
    {
        var workspace = await CreateWorkspaceAsync("independent");
        Provider.Responder = _ => ProviderResponse.Status(503);
        var enrollment = await AssignPaidLaterAsync(workspace, 90m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        var outcome = await SweepAsync();

        Assert.AreEqual(1, outcome.Materialized, "The inbox row was written.");
        Assert.AreEqual(1, outcome.Retried, "The email waits on its own.");

        var inApp = await DeliveryAsync(intent, NotificationChannel.InApp);
        Assert.AreEqual("Materialized", inApp.Status);
        Assert.IsNull(inApp.TransportAdapter, "In-app has no transport at all.");
        Assert.IsNull(inApp.ProviderMessageId);
        Assert.AreEqual(1L, await NotificationCountAsync(intent));

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Pending", email.Status);
        Assert.AreEqual(NotificationFailureCodes.EmailProviderUnavailable, email.FailureCode);
        Assert.IsNull(email.ProviderMessageId, "A refused request is not an acceptance.");
        Assert.IsEmpty(await ProviderEventsForTenantAsync(workspace.TenantId));
    }

    /// <summary>
    /// A retry presents the provider with the same idempotency key, which is the whole reason for
    /// having one: a request the provider already accepted must be recognised rather than sent twice.
    /// The key binds the intent, the channel and the mailbox, and nothing else.
    /// </summary>
    [TestMethod]
    public async Task DuplicateProviderRequestsPresentTheSameIdempotencyKey()
    {
        var workspace = await CreateWorkspaceAsync("idempotent");
        Provider.Responder = attempt => attempt < 3
            ? ProviderResponse.Status(500)
            : ProviderResponse.Accepted("prov_idem_1");
        var enrollment = await AssignPaidLaterAsync(workspace, 75m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        await SweepAsync();
        Clock.Advance(TimeSpan.FromMinutes(2));
        await SweepAsync();
        Clock.Advance(TimeSpan.FromMinutes(6));
        await SweepAsync();

        Assert.HasCount(3, Provider.Requests);
        var keys = Provider.Requests.Select(request => request.IdempotencyKey).Distinct(StringComparer.Ordinal);
        Assert.HasCount(1, keys, "Every attempt at the same message to the same mailbox uses one key.");

        var logical = NotificationDeliveryAttempt.BuildIdempotencyKey(intent, NotificationChannel.Email);
        var expected = NotificationDeliveryAttempt.BuildProviderIdempotencyKey(
            logical,
            Fingerprint(workspace.ClientEmail));
        Assert.AreEqual(expected, Provider.Requests[0].IdempotencyKey);
        Assert.DoesNotContain(
            workspace.ClientEmail,
            Provider.Requests[0].IdempotencyKey,
            "The mailbox participates as a fingerprint, never as an address.");

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Materialized", email.Status);
        Assert.AreEqual("prov_idem_1", email.ProviderMessageId);
        Assert.AreEqual(3, email.AttemptCount);
    }

    // ---------- response classification ----------

    /// <summary>
    /// What each provider response means for the delivery. The distinction that matters is whether
    /// waiting could help: a rate limit, a timeout and a server error could; a rejected request and a
    /// response with no usable identifier could not.
    /// </summary>
    /// <remarks>
    /// Credential and configuration refusals are classified transient on purpose. A revoked key is a
    /// deployment problem rather than a problem with the notification, and dead-lettering every due
    /// email the moment one appears would discard work that becomes deliverable again as soon as
    /// somebody fixes it. The bounded schedule still ends in a dead letter, so nothing retries forever.
    /// </remarks>
    [TestMethod]
    public async Task TransientAndPermanentProviderResponsesAreClassifiedCorrectly()
    {
        // One workspace and one client per case, because entitlement coverage for one feature may not
        // overlap for one client — and one coach registration, because registering several would trip
        // the public authentication rate limit for a reason unrelated to what is under test.
        var workspace = await CreateWorkspaceAsync("classify", enableEmail: false);
        var cases = new (int Status, string Body, string ExpectedStatus, string ExpectedCode)[]
        {
            (429, "{}", "Pending", NotificationFailureCodes.EmailProviderRateLimited),
            (503, "{}", "Pending", NotificationFailureCodes.EmailProviderUnavailable),
            (500, "{}", "Pending", NotificationFailureCodes.EmailProviderUnavailable),
            (408, "{}", "Pending", NotificationFailureCodes.EmailProviderTimeout),
            (401, "{}", "Pending", NotificationFailureCodes.EmailProviderUnauthorized),
            (403, "{}", "Pending", NotificationFailureCodes.EmailProviderUnauthorized),
            (422, "{}", "DeadLettered", NotificationFailureCodes.EmailProviderRejected),
            (400, "{}", "DeadLettered", NotificationFailureCodes.EmailProviderRejected),
            (409, "{\"name\":\"invalid_idempotent_request\"}", "DeadLettered", NotificationFailureCodes.EmailProviderIdempotencyConflict),
            (409, "{\"name\":\"concurrent_idempotent_requests\"}", "Pending", NotificationFailureCodes.EmailProviderConflictRetryable),
            (409, "{\"name\":\"resource_locked\"}", "Pending", NotificationFailureCodes.EmailProviderConflictRetryable),
            (409, "{}", "Pending", NotificationFailureCodes.EmailProviderConflictRetryable),
            (200, "{}", "DeadLettered", NotificationFailureCodes.EmailProviderResponseInvalid),
            (200, "{\"id\":\"has space\"}", "DeadLettered", NotificationFailureCodes.EmailProviderResponseInvalid),
            (200, "not json", "DeadLettered", NotificationFailureCodes.EmailProviderResponseInvalid),
        };

        for (var index = 0; index < cases.Length; index++)
        {
            var (status, body, expectedStatus, expectedCode) = cases[index];
            var member = await AddMemberAsync(workspace, $"c{index}");
            Provider.Responder = _ => new ProviderResponse(status, body);
            var enrollment = await AssignPaidLaterAsync(workspace, member.ClientProfileId, 60m);
            var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

            await SweepAsync();

            var email = await DeliveryAsync(intent, NotificationChannel.Email);
            Assert.AreEqual(expectedStatus, email.Status, $"HTTP {status} produced the wrong lifecycle.");
            Assert.AreEqual(expectedCode, email.FailureCode, $"HTTP {status} produced the wrong code.");
            Assert.IsNull(email.ProviderMessageId, $"HTTP {status} must record no provider evidence.");

            // Whatever the provider said, the inbox row was written.
            Assert.AreEqual("Materialized", (await DeliveryAsync(intent, NotificationChannel.InApp)).Status);
        }
    }

    /// <summary>
    /// A provider that does not answer inside the adapter's own timeout is a transient failure, and
    /// nothing about the request survives into the record of it.
    /// </summary>
    /// <remarks>
    /// Timeouts are where content leaks most easily: the natural implementation lets the exception
    /// propagate, and a cancellation or socket exception can carry the request URI and, through inner
    /// exceptions, details of what was being sent. The adapter classifies instead of throwing, and
    /// this asserts the result.
    /// </remarks>
    [TestMethod]
    public async Task AProviderTimeoutIsTransientAndLeaksNothing()
    {
        var workspace = await CreateWorkspaceAsync("timeout");
        Provider.Responder = _ => ProviderResponse.Slow(TimeSpan.FromSeconds(ProviderTimeoutSeconds + 4));
        var enrollment = await AssignPaidLaterAsync(workspace, 45m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        await SweepAsync();

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Pending", email.Status);
        Assert.AreEqual(NotificationFailureCodes.EmailProviderTimeout, email.FailureCode);
        await AssertNothingSensitiveIsPersistedOrLoggedAsync(workspace, Provider.SendEndpoint);
    }

    // ---------- suppression before submission ----------

    /// <summary>
    /// An opt-out that commits after the claim, and before materialization, stops the provider request
    /// from happening at all. A committed claim is a lease on work, never authorization to send.
    /// </summary>
    [TestMethod]
    public async Task APostClaimOptOutPreventsTheProviderRequest()
    {
        var workspace = await CreateWorkspaceAsync("postclaim");
        Provider.Responder = _ => ProviderResponse.Accepted("prov_never");
        var enrollment = await AssignPaidLaterAsync(workspace, 30m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        CheckpointBarrier.Arm(intent);
        var sweep = SweepAsync();
        await CheckpointBarrier.ArrivedAsync().WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            var held = await DeliveryAsync(intent, NotificationChannel.Email);
            Assert.AreEqual("Processing", held.Status, "The barrier must sit after the claim commit.");
            Assert.AreEqual(0, held.AttemptCount, "A claim reservation is not an attempt.");

            await DisableServiceEmailAsync(workspace.Client);
        }
        finally
        {
            CheckpointBarrier.Release();
        }

        await sweep.WaitAsync(TimeSpan.FromSeconds(60));
        CheckpointBarrier.Disarm();

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Suppressed", email.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EmailOptedOut, email.FailureCode);
        Assert.IsEmpty(Provider.Requests, "No HTTP request may happen after the recheck refuses.");
        Assert.AreEqual("Materialized", (await DeliveryAsync(intent, NotificationChannel.InApp)).Status);
        Assert.AreEqual(1L, await NotificationCountAsync(intent), "The inbox row is untouched by the opt-out.");
    }

    /// <summary>
    /// A verified permanent bounce stops later email to that mailbox, and stops nothing else. The
    /// in-app delivery of the very next notification is written exactly as before, because a mailbox
    /// refusing mail is not a member losing what they are entitled to be told.
    /// </summary>
    [TestMethod]
    public async Task APermanentBounceSuppressesLaterEmailAndNothingElse()
    {
        var workspace = await CreateWorkspaceAsync("bounce");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_bounce_1", 120m);

        var response = await PostEventAsync(
            "evt_bounce_1",
            "email.bounced",
            "prov_bounce_1",
            """{"type":"Permanent","subType":"Suppressed","message":"mailbox does not exist"}""");
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);

        Assert.AreEqual(1L, await SuppressionCountAsync(workspace.ClientUserId));
        Assert.AreEqual(
            NotificationEmailSuppressionReason.PermanentBounce.ToString(),
            await SuppressionReasonAsync(workspace.ClientUserId));

        // The next notification still reaches the inbox, and its email is suppressed with a code that
        // says why — without the provider being contacted again.
        Provider.Responder = _ => ProviderResponse.Accepted("prov_bounce_2");
        var secondIntent = await PayInFullAsync(workspace, accepted.Enrollment);
        var before = Provider.Requests.Count;

        await SweepAsync();

        Assert.AreEqual("Materialized", (await DeliveryAsync(secondIntent, NotificationChannel.InApp)).Status);
        Assert.AreEqual(1L, await NotificationCountAsync(secondIntent));
        var email = await DeliveryAsync(secondIntent, NotificationChannel.Email);
        Assert.AreEqual("Suppressed", email.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EmailAddressSuppressed, email.FailureCode);
        Assert.HasCount(before, Provider.Requests, "A suppressed mailbox is never contacted again.");

        // The member's own settings screen says so, rather than showing a switch beside a channel that
        // is silently doing nothing.
        var preferences = await ReadPreferencesAsync(workspace.Client);
        Assert.IsTrue(preferences.EmailSuppressed);
        Assert.AreEqual(
            NotificationEmailSuppressionReason.PermanentBounce.ToString(),
            preferences.EmailSuppressionReason);
        Assert.IsTrue(preferences.EmailServiceEnabled, "The member's own decision is not rewritten by a bounce.");

        Assert.AreEqual(accepted.Id, (await ProviderMessageAsync("prov_bounce_1")).Id);
    }

    /// <summary>
    /// A complaint always suppresses. Continuing to mail somebody who pressed "this is spam" harms
    /// every other message this domain sends, and is in any case simply rude.
    /// </summary>
    [TestMethod]
    public async Task AComplaintSuppressesLaterEmail()
    {
        var workspace = await CreateWorkspaceAsync("complaint");
        await AcceptOneEmailAsync(workspace, "prov_complaint_1", 120m);

        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await PostEventAsync("evt_complaint_1", "email.complained", "prov_complaint_1")).StatusCode);

        Assert.AreEqual(
            NotificationEmailSuppressionReason.Complaint.ToString(),
            await SuppressionReasonAsync(workspace.ClientUserId));
        var message = await ProviderMessageAsync("prov_complaint_1");
        Assert.IsNotNull(message.ComplainedAtUtc);
        Assert.IsNull(message.BouncedAtUtc);
    }

    /// <summary>
    /// The provider refusing because its own suppression list already holds the address is the third
    /// thing that stops mail, and it is recorded as its own reason rather than folded into a bounce.
    /// </summary>
    /// <remarks>
    /// Worth its own test because the reason, the fact column and the evidence assertion in the
    /// database all have to agree: a suppression whose reason its event does not justify is refused,
    /// so a mismatch between the three would fail here rather than in production.
    /// </remarks>
    [TestMethod]
    public async Task AProviderSideSuppressionEventSuppressesUnderItsOwnReason()
    {
        var workspace = await CreateWorkspaceAsync("providersupp");
        await AcceptOneEmailAsync(workspace, "prov_side_1", 120m);

        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await PostEventAsync("evt_side_1", "email.suppressed", "prov_side_1")).StatusCode);

        Assert.AreEqual(
            NotificationEmailSuppressionReason.ProviderSuppressed.ToString(),
            await SuppressionReasonAsync(workspace.ClientUserId));
        var message = await ProviderMessageAsync("prov_side_1");
        Assert.IsNotNull(message.ProviderSuppressedAtUtc);
        Assert.IsNull(message.BouncedAtUtc, "A provider-side refusal is not a bounce.");
        Assert.IsNull(message.ComplainedAtUtc);
    }

    /// <summary>
    /// A soft failure is not a permanent stop. A mailbox that was full this afternoon is not a mailbox
    /// that should stop receiving payment reminders forever, and turning a run of them into a
    /// suppression would need a threshold nobody has chosen.
    /// </summary>
    [TestMethod]
    public async Task TransientBouncesAndDelaysDoNotSuppress()
    {
        var workspace = await CreateWorkspaceAsync("soft");
        await AcceptOneEmailAsync(workspace, "prov_soft_1", 120m);

        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await PostEventAsync(
                "evt_soft_1",
                "email.bounced",
                "prov_soft_1",
                """{"type":"Transient","subType":"MailboxFull","message":"try later"}""")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await PostEventAsync("evt_soft_2", "email.delivery_delayed", "prov_soft_1")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await PostEventAsync("evt_soft_3", "email.failed", "prov_soft_1")).StatusCode);

        Assert.AreEqual(0L, await SuppressionCountAsync(workspace.ClientUserId));

        var message = await ProviderMessageAsync("prov_soft_1");
        Assert.AreEqual(NotificationProviderBounceClass.Transient.ToString(), message.BounceClass);
        Assert.IsNotNull(message.DelayedAtUtc);
        Assert.IsNotNull(message.FailedAtUtc);
        Assert.AreEqual(NotificationProviderEventCodes.ProviderFailed, message.FailureCode);
        Assert.AreEqual(3, message.EventCount);
    }

    /// <summary>
    /// A suppression is about a mailbox, not about a member. Somebody who mistyped their address,
    /// bounced, and then corrected it starts receiving mail again — because the address they use now
    /// fingerprints differently and matches no suppression.
    /// </summary>
    [TestMethod]
    public async Task AChangedAddressIsNotSuppressedByTheOldAddressBounce()
    {
        var workspace = await CreateWorkspaceAsync("changed");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_changed_1", 120m);
        await PostEventAsync(
            "evt_changed_1",
            "email.bounced",
            "prov_changed_1",
            """{"type":"Permanent"}""");
        Assert.AreEqual(1L, await SuppressionCountAsync(workspace.ClientUserId));

        // The account's confirmed address changes. Only the mailbox moved; the member, the workspace
        // and the suppression row are all exactly as they were.
        var corrected = $"corrected-{workspace.Suffix}@tbgym.test";
        await ExecuteAsync(
            """UPDATE identity."Users" SET "Email" = @email, "NormalizedEmail" = upper(@email) WHERE "Id" = @id""",
            ("email", corrected),
            ("id", workspace.ClientUserId));

        Provider.Responder = _ => ProviderResponse.Accepted("prov_changed_2");
        var secondIntent = await PayInFullAsync(workspace, accepted.Enrollment);
        await SweepAsync();

        var email = await DeliveryAsync(secondIntent, NotificationChannel.Email);
        Assert.AreEqual("Materialized", email.Status, "A corrected mailbox is not the one that bounced.");
        Assert.AreEqual("prov_changed_2", email.ProviderMessageId);
        Assert.AreEqual(
            Fingerprint(corrected),
            (await ProviderMessageAsync("prov_changed_2")).RecipientAddressFingerprint);

        // The old suppression is still there, unrewritten, still explaining what happened.
        Assert.AreEqual(1L, await SuppressionCountAsync(workspace.ClientUserId));
    }

    /// <summary>
    /// A rotation adds a key rather than replacing one, so a suppression written under a retired key
    /// keeps matching. Silently resuming mail to an address that hard-bounced would be the worst
    /// possible consequence of routine key hygiene.
    /// </summary>
    [TestMethod]
    public async Task ASuppressionWrittenUnderARetiredKeyStillMatches()
    {
        var workspace = await CreateWorkspaceAsync("rotate");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_rotate_1", 120m);
        await PostEventAsync("evt_rotate_1", "email.complained", "prov_rotate_1");

        // Rewrite the stored evidence as though it had been produced under the previous key, which is
        // what a rotation leaves behind. The suppression check must still recognise the mailbox.
        await WithoutSuppressionGuardsAsync(
            """
            UPDATE notifications."ProviderMessages"
            SET "RecipientAddressFingerprint" = @fingerprint, "FingerprintKeyId" = @keyId
            WHERE "Id" = @id;
            UPDATE notifications."EmailSuppressions"
            SET "AddressFingerprint" = @fingerprint, "FingerprintKeyId" = @keyId
            WHERE "SourceProviderMessageId" = @id;
            """,
            ("fingerprint", RetiredFingerprint(workspace.ClientEmail)),
            ("keyId", RetiredFingerprintKeyId),
            ("id", accepted.Id));

        Provider.Responder = _ => ProviderResponse.Accepted("prov_rotate_2");
        var secondIntent = await PayInFullAsync(workspace, accepted.Enrollment);
        var before = Provider.Requests.Count;

        await SweepAsync();

        var email = await DeliveryAsync(secondIntent, NotificationChannel.Email);
        Assert.AreEqual("Suppressed", email.Status);
        Assert.AreEqual(NotificationSuppressionCodes.EmailAddressSuppressed, email.FailureCode);
        Assert.HasCount(before, Provider.Requests);
    }

    // ---------- webhook authentication ----------

    /// <summary>
    /// A correctly signed event is accepted and applied, and its fact is distinct from the acceptance
    /// the send response already recorded.
    /// </summary>
    [TestMethod]
    public async Task AValidSignedWebhookIsAcceptedAndRecipientServerAcceptanceIsItsOwnFact()
    {
        var workspace = await CreateWorkspaceAsync("delivered");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_delivered_1", 120m);

        // A mail server answers some time after the provider took the request, which is the whole
        // reason the two are separate facts rather than one.
        Clock.Advance(TimeSpan.FromMinutes(3));
        var response = await PostEventAsync("evt_delivered_1", "email.delivered", "prov_delivered_1");

        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        var message = await ProviderMessageAsync("prov_delivered_1");
        Assert.IsNotNull(message.RecipientServerAcceptedAtUtc);
        Assert.AreNotEqual(
            message.ProviderAcceptedAtUtc,
            message.RecipientServerAcceptedAtUtc,
            "The two acceptances are separate facts recorded at separate times.");
        Assert.AreEqual(1, message.EventCount);
        Assert.IsNotNull(message.LastEventReceivedAtUtc);

        var events = await ProviderEventsAsync(accepted.Id);
        Assert.HasCount(1, events);
        Assert.AreEqual(NotificationProviderEventType.RecipientServerAccepted.ToString(), events[0].EventType);
        Assert.IsTrue(events[0].AppliedNewFact);

        // And the delivery it describes is still exactly what it was: terminal and untouched.
        var delivery = await DeliveryAsync(
            await IntentForDeliveryAsync(accepted.ChannelDeliveryId),
            NotificationChannel.Email);
        Assert.AreEqual("Materialized", delivery.Status);
        Assert.AreEqual("prov_delivered_1", delivery.ProviderMessageId);
        Assert.AreEqual(0L, await SuppressionCountAsync(workspace.ClientUserId));
    }

    /// <summary>
    /// Every way a request can fail to authenticate, refused with one uninformative answer and no row
    /// written. The body is never parsed, so an unsigned caller reaches no parser either.
    /// </summary>
    [TestMethod]
    public async Task InvalidExpiredMalformedAndForgedWebhooksAreRejected()
    {
        var workspace = await CreateWorkspaceAsync("forged");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_forged_1", 120m);
        var body = EventBody("email.bounced", "prov_forged_1", """{"type":"Permanent"}""");
        var otherKey = System.Security.Cryptography.RandomNumberGenerator.GetBytes(24);

        // No signature at all.
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await PostWebhookAsync("evt_f1", body, overrideSignature: string.Empty)).StatusCode);
        // A signature that is not a signature.
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await PostWebhookAsync("evt_f2", body, overrideSignature: "v1,not-base64!!")).StatusCode);
        // A well-formed signature under the wrong key.
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await PostWebhookAsync("evt_f3", body, key: otherKey)).StatusCode);
        // A correct signature over a different body: the bytes are what is signed.
        var mismatched = await PostWebhookAsync(
            "evt_f4",
            body,
            bodyOverride: Encoding.UTF8.GetBytes(EventBody("email.complained", "prov_forged_1")));
        Assert.AreEqual(HttpStatusCode.Unauthorized, mismatched.StatusCode);
        // A capture from outside the tolerance window, replayed now.
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await PostWebhookAsync("evt_f5", body, signedAt: Clock.UtcNow.AddHours(-2))).StatusCode);
        // And one from the future, which is the same attack with the sign flipped.
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await PostWebhookAsync("evt_f6", body, signedAt: Clock.UtcNow.AddHours(2))).StatusCode);

        Assert.IsEmpty(await ProviderEventsAsync(accepted.Id), "A refused request writes nothing.");
        Assert.AreEqual(0L, await SuppressionCountAsync(workspace.ClientUserId));
        Assert.IsNull((await ProviderMessageAsync("prov_forged_1")).BouncedAtUtc);
    }

    /// <summary>
    /// A body larger than the configured limit is refused without being read past the limit, and
    /// without reaching signature verification or a parser.
    /// </summary>
    [TestMethod]
    public async Task AnOversizedWebhookBodyIsRefused()
    {
        var workspace = await CreateWorkspaceAsync("oversized");
        await AcceptOneEmailAsync(workspace, "prov_big_1", 120m);
        var oversized = Encoding.UTF8.GetBytes("{\"padding\":\"" + new string('x', 200_000) + "\"}");

        var response = await PostWebhookAsync("evt_big_1", "{}", bodyOverride: oversized);

        Assert.AreEqual(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.AreEqual(0L, await ProviderEventCountAsync());
    }

    /// <summary>
    /// A signed body this build cannot read is a bad request rather than a forgery, and it still
    /// writes nothing. An event type this build deliberately does not record — an open, a click — is
    /// acknowledged and likewise stored nowhere.
    /// </summary>
    [TestMethod]
    public async Task AuthenticatedButUnreadableOrIgnoredEventsWriteNothing()
    {
        var workspace = await CreateWorkspaceAsync("ignored");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_ignored_1", 120m);

        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await PostWebhookAsync("evt_i1", "not json at all")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await PostWebhookAsync("evt_i2", """{"type":"email.bounced","created_at":"2026-09-05T06:00:00Z"}""")).StatusCode);

        foreach (var tracking in new[] { "email.opened", "email.clicked" })
        {
            Assert.AreEqual(
                HttpStatusCode.Accepted,
                (await PostEventAsync($"evt_{tracking}", tracking, "prov_ignored_1")).StatusCode,
                $"{tracking} must be acknowledged so the provider stops retrying it.");
        }

        // An event about a message this deployment never issued is acknowledged and resolved to
        // nothing, so a caller guessing identifiers learns nothing from the answer.
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await PostEventAsync("evt_i3", "email.delivered", "prov_never_issued")).StatusCode);

        Assert.IsEmpty(await ProviderEventsAsync(accepted.Id));
        Assert.AreEqual(0L, await ProviderEventCountAsync());
    }

    // ---------- webhook idempotency and ordering ----------

    /// <summary>
    /// The same event delivered repeatedly converges on one recorded fact. A provider that guarantees
    /// at-least-once delivery will re-send whenever it is unsure, and a bounce recorded twice would be
    /// a second suppression and a second history entry describing one thing that happened once.
    /// </summary>
    /// <remarks>
    /// Run three times, sequentially and concurrently, because this is the property most likely to
    /// hold by accident on a quiet machine.
    /// </remarks>
    [TestMethod]
    public async Task DuplicateWebhookEventsConverge()
    {
        for (var round = 1; round <= 3; round++)
        {
            var workspace = await CreateWorkspaceAsync($"dup{round}");
            var providerMessageId = $"prov_dup_{round}";
            var accepted = await AcceptOneEmailAsync(workspace, providerMessageId, 120m);
            var eventId = $"evt_dup_{round}";

            // Sequential repeats.
            for (var repeat = 0; repeat < 3; repeat++)
            {
                Assert.AreEqual(
                    HttpStatusCode.Accepted,
                    (await PostEventAsync(
                        eventId,
                        "email.bounced",
                        providerMessageId,
                        """{"type":"Permanent"}""")).StatusCode);
            }

            // And concurrent ones, which is how a provider's own retry actually arrives.
            var concurrent = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => PostEventAsync(
                eventId,
                "email.bounced",
                providerMessageId,
                """{"type":"Permanent"}""")));
            foreach (var response in concurrent)
            {
                Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode, $"Round {round}.");
            }

            var events = await ProviderEventsAsync(accepted.Id);
            Assert.HasCount(1, events, $"Round {round}: one event identifier is one record.");
            var message = await ProviderMessageAsync(providerMessageId);
            Assert.AreEqual(1, message.EventCount, $"Round {round}: the fact was applied once.");
            Assert.AreEqual(
                1L,
                await SuppressionCountAsync(workspace.ClientUserId),
                $"Round {round}: one bounce is one suppression.");
        }
    }

    /// <summary>
    /// Events arrive in no guaranteed order, and both orders end in the same truthful history: two
    /// facts, each recorded once, neither overwriting the other, and a history that says which was
    /// learned first.
    /// </summary>
    [TestMethod]
    public async Task OutOfOrderEventsPreserveTruthfulAppendOnlyHistory()
    {
        var workspace = await CreateWorkspaceAsync("ordering");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_order_1", 120m);
        var bouncedAt = Clock.UtcNow.AddMinutes(-10);
        var deliveredAt = Clock.UtcNow.AddMinutes(-20);

        // The bounce is learned first even though it happened later.
        await PostEventAsync("evt_order_bounce", "email.bounced", "prov_order_1", """{"type":"Permanent"}""", bouncedAt);
        Clock.Advance(TimeSpan.FromMinutes(1));
        await PostEventAsync("evt_order_delivered", "email.delivered", "prov_order_1", occurredAt: deliveredAt);

        var message = await ProviderMessageAsync("prov_order_1");
        Assert.AreEqual(
            bouncedAt.ToUnixTimeSeconds(),
            message.BouncedAtUtc!.Value.ToUnixTimeSeconds(),
            "The bounce keeps the instant the provider gave it.");
        Assert.AreEqual(deliveredAt.ToUnixTimeSeconds(), message.RecipientServerAcceptedAtUtc!.Value.ToUnixTimeSeconds());
        Assert.AreEqual(2, message.EventCount);

        var events = await ProviderEventsAsync(accepted.Id);
        Assert.HasCount(2, events);
        Assert.AreEqual(NotificationProviderEventType.Bounced.ToString(), events[0].EventType);
        Assert.AreEqual(NotificationProviderEventType.RecipientServerAccepted.ToString(), events[1].EventType);
        Assert.IsTrue(events.All(item => item.AppliedNewFact));
        Assert.IsLessThan(events[1].ReceivedAtUtc, events[0].ReceivedAtUtc, "History records what was learned when.");

        // The later acceptance does not undo the suppression the earlier bounce established.
        Assert.AreEqual(1L, await SuppressionCountAsync(workspace.ClientUserId));
    }

    /// <summary>
    /// A second event of a kind already recorded is history, not a rewrite. The first instant stands,
    /// the repeat is recorded as having established nothing, and no second suppression appears.
    /// </summary>
    [TestMethod]
    public async Task ALaterEventNeverRewritesAnEarlierFact()
    {
        var workspace = await CreateWorkspaceAsync("rewrite");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_rewrite_1", 120m);
        var first = Clock.UtcNow.AddMinutes(-30);
        var later = Clock.UtcNow.AddMinutes(-5);

        await PostEventAsync("evt_rw_1", "email.bounced", "prov_rewrite_1", """{"type":"Permanent"}""", first);
        await PostEventAsync("evt_rw_2", "email.bounced", "prov_rewrite_1", """{"type":"Transient"}""", later);

        var message = await ProviderMessageAsync("prov_rewrite_1");
        Assert.AreEqual(first.ToUnixTimeSeconds(), message.BouncedAtUtc!.Value.ToUnixTimeSeconds());
        Assert.AreEqual(
            NotificationProviderBounceClass.Permanent.ToString(),
            message.BounceClass,
            "A later classification cannot soften a recorded permanent bounce.");
        Assert.AreEqual(2, message.EventCount);

        var events = await ProviderEventsAsync(accepted.Id);
        Assert.HasCount(2, events);
        Assert.AreEqual(1, events.Count(item => item.AppliedNewFact), "Only the first established the fact.");
        Assert.AreEqual(1L, await SuppressionCountAsync(workspace.ClientUserId));
    }

    // ---------- tenancy and forgery at the database boundary ----------

    /// <summary>
    /// Provider evidence cannot be fabricated, moved between workspaces, or edited afterwards. Every
    /// statement here is one somebody with a database connection would reach for.
    /// </summary>
    [TestMethod]
    public async Task DirectSqlCannotFabricateOrRewriteProviderEvidence()
    {
        var first = await CreateWorkspaceAsync("sqlone");
        var accepted = await AcceptOneEmailAsync(first, "prov_sql_1", 120m);
        await PostEventAsync("evt_sql_1", "email.delivered", "prov_sql_1");
        var evidence = (await ProviderEventsAsync(accepted.Id)).Single();

        var second = await CreateWorkspaceAsync("sqltwo");
        Provider.Responder = _ => ProviderResponse.Accepted("prov_sql_2");
        var otherAccepted = await AcceptOneEmailAsync(second, "prov_sql_2", 80m);

        // A provider message for a delivery that never recorded that acceptance.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ProviderMessages"
                ("Id","TenantId","OutboxItemId","ChannelDeliveryId","Channel","RecipientUserId","Adapter",
                 "ProviderMessageId","ProviderAcceptedAtUtc","RecipientAddressFingerprint","FingerprintKeyId",
                 "EventCount","CreatedAtUtc","UpdatedAtUtc")
            SELECT uuidv7(), m."TenantId", m."OutboxItemId", m."ChannelDeliveryId", 'Email', m."RecipientUserId",
                   'resend', 'prov_invented', now(), m."RecipientAddressFingerprint", m."FingerprintKeyId",
                   0, now(), now()
            FROM notifications."ProviderMessages" m WHERE m."Id" = @id
            """,
            "an invented provider acceptance",
            ("id", accepted.Id));

        // The captured adapter can never own provider evidence.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ProviderMessages"
                ("Id","TenantId","OutboxItemId","ChannelDeliveryId","Channel","RecipientUserId","Adapter",
                 "ProviderMessageId","ProviderAcceptedAtUtc","RecipientAddressFingerprint","FingerprintKeyId",
                 "EventCount","CreatedAtUtc","UpdatedAtUtc")
            SELECT uuidv7(), m."TenantId", m."OutboxItemId", m."ChannelDeliveryId", 'Email', m."RecipientUserId",
                   'captured', 'prov_captured', now(), m."RecipientAddressFingerprint", m."FingerprintKeyId",
                   0, now(), now()
            FROM notifications."ProviderMessages" m WHERE m."Id" = @id
            """,
            "provider evidence from the captured adapter",
            ("id", accepted.Id));

        // A provider message attached to another workspace's delivery.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ProviderMessages"
                ("Id","TenantId","OutboxItemId","ChannelDeliveryId","Channel","RecipientUserId","Adapter",
                 "ProviderMessageId","ProviderAcceptedAtUtc","RecipientAddressFingerprint","FingerprintKeyId",
                 "EventCount","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenant, @outbox, @delivery, 'Email', @user, 'resend', 'prov_crosstenant',
                    now(), @fingerprint, @keyId, 0, now(), now())
            """,
            "a cross-tenant provider message",
            ("tenant", first.TenantId),
            ("outbox", await IntentForDeliveryAsync(otherAccepted.ChannelDeliveryId)),
            ("delivery", otherAccepted.ChannelDeliveryId),
            ("user", first.ClientUserId),
            ("fingerprint", Fingerprint(first.ClientEmail)),
            ("keyId", ActiveFingerprintKeyId));

        // A provider event pointing at another workspace's message.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ProviderEvents"
                ("Id","TenantId","ProviderMessageRecordId","Adapter","ProviderEventId","EventType",
                 "OccurredAtUtc","ReceivedAtUtc","AppliedNewFact","SignatureScheme","SignatureSchemeVersion",
                 "CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenant, @message, 'resend', 'evt_crosstenant', 'Complained',
                    now(), now(), false, 'standard-webhooks-hmac-sha256-v1', 1, now(), now())
            """,
            "a cross-tenant provider event",
            ("tenant", first.TenantId),
            ("message", otherAccepted.Id));

        // One provider event identifier is one recorded event, and the database is what says so.
        // The ingestion path also checks, and the recipient-policy lock serializes concurrent
        // arrivals — but a guarantee that lives only in application code is one refactor away from
        // being untrue, and this is the copy that survives that refactor.
        await AssertRefusedAsync(
            """
            UPDATE notifications."ProviderMessages" m
            SET "EventCount" = m."EventCount" + 1,
                "LastEventReceivedAtUtc" = e."ReceivedAtUtc"
            FROM notifications."ProviderEvents" e
            WHERE e."Id" = @id AND m."Id" = e."ProviderMessageRecordId";
            INSERT INTO notifications."ProviderEvents"
                ("Id","TenantId","ProviderMessageRecordId","Adapter","ProviderEventId","EventType",
                  "OccurredAtUtc","ReceivedAtUtc","AppliedNewFact","SignatureScheme",
                  "SignatureSchemeVersion","CreatedAtUtc","UpdatedAtUtc")
            SELECT uuidv7(), e."TenantId", e."ProviderMessageRecordId", e."Adapter", e."ProviderEventId",
                   e."EventType", e."OccurredAtUtc", e."ReceivedAtUtc", false, e."SignatureScheme",
                   e."SignatureSchemeVersion", now(), now()
            FROM notifications."ProviderEvents" e WHERE e."Id" = @id
            """,
            "a second record of one provider event identifier",
            ("id", await ProviderEventIdAsync(evidence.ProviderEventId)));

        // And the same identifier replayed against a different workspace must collide rather than
        // succeed twice, which is why that index is global instead of tenant-scoped.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ProviderEvents"
                ("Id","TenantId","ProviderMessageRecordId","Adapter","ProviderEventId","EventType",
                 "OccurredAtUtc","ReceivedAtUtc","AppliedNewFact","SignatureScheme",
                 "SignatureSchemeVersion","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenant, @message, 'resend', @eventId, 'Complained',
                    now(), now(), false, 'standard-webhooks-hmac-sha256-v1', 1, now(), now())
            """,
            "a provider event identifier replayed into another workspace",
            ("tenant", second.TenantId),
            ("message", otherAccepted.Id),
            ("eventId", evidence.ProviderEventId));

        // Provider event history is append-only.
        await AssertRefusedAsync(
            """UPDATE notifications."ProviderEvents" SET "EventType" = 'Complained' WHERE "Id" = @id""",
            "rewriting provider event history",
            ("id", await ProviderEventIdAsync(evidence.ProviderEventId)));
        await AssertRefusedAsync(
            """DELETE FROM notifications."ProviderEvents" WHERE "Id" = @id""",
            "deleting provider event history",
            ("id", await ProviderEventIdAsync(evidence.ProviderEventId)));

        // A recorded provider fact is written once.
        await AssertRefusedAsync(
            """
            UPDATE notifications."ProviderMessages"
            SET "RecipientServerAcceptedAtUtc" = now(), "EventCount" = "EventCount" + 1,
                "LastEventReceivedAtUtc" = now()
            WHERE "Id" = @id
            """,
            "rewriting a recorded provider fact",
            ("id", accepted.Id));
        await AssertRefusedAsync(
            """
            UPDATE notifications."ProviderMessages"
            SET "RecipientAddressFingerprint" = @fingerprint
            WHERE "Id" = @id
            """,
            "moving a provider message to a different mailbox",
            ("fingerprint", Fingerprint("someone-else@tbgym.test")),
            ("id", accepted.Id));
        await AssertRefusedAsync(
            """DELETE FROM notifications."ProviderMessages" WHERE "Id" = @id""",
            "deleting a provider message",
            ("id", accepted.Id));

        await AssertRefusedAsync(
            """
            UPDATE notifications."ProviderMessages"
            SET "EventCount" = "EventCount" + 1, "LastEventReceivedAtUtc" = now()
            WHERE "Id" = @id
            """,
            "event bookkeeping with no append-only event",
            ("id", otherAccepted.Id));

        await AssertRefusedAsync(
            """
            INSERT INTO notifications."ProviderEvents"
                ("Id","TenantId","ProviderMessageRecordId","Adapter","ProviderEventId","EventType",
                 "OccurredAtUtc","ReceivedAtUtc","AppliedNewFact","SignatureScheme",
                 "SignatureSchemeVersion","CreatedAtUtc","UpdatedAtUtc")
            SELECT uuidv7(), m."TenantId", m."Id", m."Adapter", 'evt_invented_same_tenant',
                   'Complained', now(), now(), false, 'standard-webhooks-hmac-sha256-v1', 1, now(), now()
            FROM notifications."ProviderMessages" m WHERE m."Id" = @id
            """,
            "an invented same-tenant provider event with no message bookkeeping or prior fact",
            ("id", otherAccepted.Id));

        var receivedAt = Clock.UtcNow.AddMinutes(1);
        await AssertRefusedAsync(
            """
            UPDATE notifications."ProviderMessages"
            SET "ComplainedAtUtc" = @fact, "EventCount" = "EventCount" + 1,
                "LastEventReceivedAtUtc" = @received
            WHERE "Id" = @message;
            INSERT INTO notifications."ProviderEvents"
                ("Id","TenantId","ProviderMessageRecordId","Adapter","ProviderEventId","EventType",
                 "OccurredAtUtc","ReceivedAtUtc","AppliedNewFact","SignatureScheme",
                 "SignatureSchemeVersion","CreatedAtUtc","UpdatedAtUtc")
            SELECT uuidv7(), m."TenantId", m."Id", m."Adapter", 'evt_wrong_fact_instant',
                   'Complained', @wrongFact, @received, true, 'standard-webhooks-hmac-sha256-v1',
                   1, @received, @received
            FROM notifications."ProviderMessages" m WHERE m."Id" = @message
            """,
            "provider evidence whose claimed fact does not match the message fact",
            ("fact", receivedAt.AddMinutes(-1)),
            ("wrongFact", receivedAt.AddMinutes(-2)),
            ("received", receivedAt),
            ("message", otherAccepted.Id));

        // And an attempt cannot claim an identifier its delivery does not own.
        await AssertRefusedAsync(
            """
            UPDATE notifications."DeliveryAttempts" SET "ProviderMessageId" = 'prov_borrowed'
            WHERE "ChannelDeliveryId" = @delivery
            """,
            "an attempt borrowing a provider identifier",
            ("delivery", accepted.ChannelDeliveryId));
    }

    /// <summary>
    /// A suppression cannot be invented, aimed at somebody else, or quietly removed. There is no
    /// override surface in this phase, and the database is what makes its absence more than a
    /// convention.
    /// </summary>
    [TestMethod]
    public async Task DirectSqlCannotFabricateOrBypassSuppression()
    {
        var workspace = await CreateWorkspaceAsync("suppresssql");
        var accepted = await AcceptOneEmailAsync(workspace, "prov_supp_1", 120m);
        await PostEventAsync("evt_supp_1", "email.complained", "prov_supp_1");
        var suppressionId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM notifications."EmailSuppressions" WHERE "UserId" = @id""",
            ("id", workspace.ClientUserId));
        var evidenceId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM notifications."ProviderEvents" WHERE "ProviderEventId" = 'evt_supp_1'""");

        await AssertRefusedAsync(
            """DELETE FROM notifications."EmailSuppressions" WHERE "Id" = @id""",
            "clearing a suppression",
            ("id", suppressionId));
        await AssertRefusedAsync(
            """UPDATE notifications."EmailSuppressions" SET "Reason" = 'PermanentBounce' WHERE "Id" = @id""",
            "rewriting a suppression reason",
            ("id", suppressionId));

        // A reason its evidence does not justify.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."EmailSuppressions"
                ("Id","TenantId","UserId","AddressFingerprint","FingerprintKeyId","Reason","SuppressedAtUtc",
                 "SourceProviderEventId","SourceProviderMessageId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenant, @user, @fingerprint, @keyId, 'PermanentBounce', now(),
                    @evidence, @message, now(), now())
            """,
            "a suppression whose reason its evidence does not support",
            ("tenant", workspace.TenantId),
            ("user", workspace.ClientUserId),
            ("fingerprint", Fingerprint("another@tbgym.test")),
            ("keyId", ActiveFingerprintKeyId),
            ("evidence", evidenceId),
            ("message", accepted.Id));

        // A suppression aimed at a mailbox the evidence was never sent to.
        await AssertRefusedAsync(
            """
            INSERT INTO notifications."EmailSuppressions"
                ("Id","TenantId","UserId","AddressFingerprint","FingerprintKeyId","Reason","SuppressedAtUtc",
                 "SourceProviderEventId","SourceProviderMessageId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenant, @user, @fingerprint, @keyId, 'Complaint', now(),
                    @evidence, @message, now(), now())
            """,
            "a suppression aimed at a different mailbox",
            ("tenant", workspace.TenantId),
            ("user", workspace.ClientUserId),
            ("fingerprint", Fingerprint("another@tbgym.test")),
            ("keyId", ActiveFingerprintKeyId),
            ("evidence", evidenceId),
            ("message", accepted.Id));
    }

    // ---------- privacy ----------

    /// <summary>
    /// After a complete exchange — an accepted send, a delivery event, a bounce and a suppression —
    /// no column of any notifications table and no line of the log holds a recipient address, a
    /// rendered subject or body, the API key, the signing secret, or any part of a raw provider
    /// payload.
    /// </summary>
    /// <remarks>
    /// The persistence half of this scans the live schema rather than a list of columns, so a column
    /// added later is covered automatically. A privacy rule asserted against a hand-kept list stops
    /// being true the first time somebody adds a field and forgets to update the list.
    /// </remarks>
    [TestMethod]
    public async Task NoAddressBodyKeyOrRawPayloadReachesPostgreSqlOrTheLog()
    {
        var workspace = await CreateWorkspaceAsync("privacy");
        await AcceptOneEmailAsync(workspace, "prov_privacy_1", 120m);
        await PostEventAsync("evt_privacy_1", "email.delivered", "prov_privacy_1");
        await PostEventAsync("evt_privacy_2", "email.bounced", "prov_privacy_1", """{"type":"Permanent"}""");

        // The exchange really did happen and really did carry the address, which is what makes the
        // negative assertion worth making.
        Assert.Contains(workspace.ClientEmail, Provider.Requests.Single().Body);
        Assert.AreEqual(1L, await SuppressionCountAsync(workspace.ClientUserId));

        await AssertNothingSensitiveIsPersistedOrLoggedAsync(
            workspace,
            "mailbox does not exist",
            "Bearer ",
            Convert.ToBase64String(ActiveFingerprintKey));
    }

    // ---------- helpers ----------

    /// <summary>
    /// Schedules one notification, sweeps it, and returns the provider message the send produced.
    /// </summary>
    private async Task<AcceptedEmail> AcceptOneEmailAsync(
        Workspace workspace,
        string providerMessageId,
        decimal price)
    {
        Provider.Responder = _ => ProviderResponse.Accepted(providerMessageId);
        var enrollment = await AssignPaidLaterAsync(workspace, price);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        await SweepAsync();

        var email = await DeliveryAsync(intent, NotificationChannel.Email);
        Assert.AreEqual("Materialized", email.Status, "The fixture expected the provider to accept.");
        return new AcceptedEmail(await ProviderMessageAsync(providerMessageId), enrollment, intent);
    }

    /// <summary>One accepted email, and the business facts it came from.</summary>
    private sealed record AcceptedEmail(
        ProviderMessageRow Message,
        Enrollment Enrollment,
        Guid IntentId)
    {
        public Guid Id => Message.Id;

        public Guid ChannelDeliveryId => Message.ChannelDeliveryId;
    }

    private Task<Guid> IntentForDeliveryAsync(Guid channelDeliveryId) => ScalarAsync<Guid>(
        """SELECT "OutboxItemId" FROM notifications."ChannelDeliveries" WHERE "Id" = @id""",
        ("id", channelDeliveryId));

    private Task<Guid> ProviderEventIdAsync(string providerEventId) => ScalarAsync<Guid>(
        """SELECT "Id" FROM notifications."ProviderEvents" WHERE "ProviderEventId" = @id""",
        ("id", providerEventId));

    private Task<long> ProviderEventCountAsync() =>
        ScalarAsync<long>("""SELECT count(*) FROM notifications."ProviderEvents" """);

    private async Task<IReadOnlyList<string>> ProviderEventsForTenantAsync(Guid tenantId)
    {
        await using var connection = new Npgsql.NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """SELECT "ProviderEventId" FROM notifications."ProviderEvents" WHERE "TenantId" = @id""";
        command.Parameters.AddWithValue("id", tenantId);
        var rows = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private static async Task<PreferenceView> ReadPreferencesAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/notifications/preferences");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<PreferenceView>(response);
    }

    /// <summary>
    /// Rewrites stored fingerprints to simulate a completed key rotation, with the immutability guards
    /// off for the duration of that one write and restored immediately afterwards.
    /// </summary>
    /// <remarks>
    /// Used only to reproduce a state that takes months of real time to reach. The guards themselves
    /// are asserted separately, by direct SQL, in
    /// <see cref="DirectSqlCannotFabricateOrRewriteProviderEvidence"/>.
    /// </remarks>
    private async Task WithoutSuppressionGuardsAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await ExecuteAsync(
            """ALTER TABLE notifications."ProviderMessages" DISABLE TRIGGER protect_provider_message""");
        try
        {
            await ExecuteAsync(
                """ALTER TABLE notifications."EmailSuppressions" DISABLE TRIGGER protect_email_suppression""");
            try
            {
                await ExecuteAsync(sql, parameters);
            }
            finally
            {
                await ExecuteAsync(
                    """ALTER TABLE notifications."EmailSuppressions" ENABLE TRIGGER protect_email_suppression""");
            }
        }
        finally
        {
            await ExecuteAsync(
                """ALTER TABLE notifications."ProviderMessages" ENABLE TRIGGER protect_provider_message""");
        }
    }
}
