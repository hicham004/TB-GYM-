using System.Security.Cryptography;
using System.Text;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The Phase 6B-3B rules that are pure functions, proven without a database or a network.
/// </summary>
/// <remarks>
/// Signature verification, address fingerprinting, webhook payload mapping, provider-fact
/// accumulation and configuration validation are all decidable from their inputs, so they are decided
/// here — where a case can be enumerated exhaustively and a failure names the rule rather than a
/// failed HTTP round trip.
/// </remarks>
[TestClass]
public sealed class Phase6B3BProviderEmailDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 5, 12, 0, 0, TimeSpan.Zero);

    private static readonly byte[] SigningKey = Convert.FromBase64String("c2VjcmV0LWZvci10ZXN0cy1vbmx5LTMyLWJ5dGVz");

    private static readonly byte[] FingerprintKey = RandomNumberGenerator.GetBytes(32);

    private static readonly byte[] OtherFingerprintKey = RandomNumberGenerator.GetBytes(32);

    // ---------- webhook signature ----------

    /// <summary>
    /// A request signed with the right key over the right bytes at the right time is accepted, and the
    /// signature is produced by the same construction a provider uses rather than copied from a
    /// document — so a change to either side of it fails here rather than in production.
    /// </summary>
    [TestMethod]
    public void AValidSignatureOverTheExactBodyIsAccepted()
    {
        var body = Body("""{"type":"email.delivered"}""");
        var timestamp = Unix(Now);

        var verdict = NotificationWebhookSignature.Verify(
            SigningKey,
            "msg_1",
            timestamp,
            NotificationWebhookSignature.Sign(SigningKey, "msg_1", timestamp, body),
            body,
            Now,
            TimeSpan.FromMinutes(5));

        Assert.AreEqual(NotificationWebhookSignatureVerdict.Valid, verdict);
    }

    /// <summary>
    /// One byte of difference is a different message. This is why the raw body is verified rather than
    /// a parsed and re-serialized model: a round trip through a serializer changes whitespace and
    /// member order, and would authenticate something the provider never signed.
    /// </summary>
    [TestMethod]
    public void ASignatureDoesNotSurviveASingleAlteredByte()
    {
        var signed = Body("""{"type":"email.delivered","data":{"email_id":"m_1"}}""");
        var timestamp = Unix(Now);
        var signature = NotificationWebhookSignature.Sign(SigningKey, "msg_1", timestamp, signed);
        var tampered = Body("""{"type":"email.bounced","data":{"email_id":"m_1"}}""");

        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.SignatureMismatch,
            NotificationWebhookSignature.Verify(
                SigningKey,
                "msg_1",
                timestamp,
                signature,
                tampered,
                Now,
                TimeSpan.FromMinutes(5)));
    }

    /// <summary>
    /// Every way a request can fail to authenticate, and the verdict each produces. They collapse to
    /// one 401 at the HTTP boundary; the distinctions exist so a test can prove each rule separately.
    /// </summary>
    [TestMethod]
    public void EveryMalformedExpiredOrForgedSignatureIsRefused()
    {
        var body = Body("""{"type":"email.delivered"}""");
        var timestamp = Unix(Now);
        var valid = NotificationWebhookSignature.Sign(SigningKey, "msg_1", timestamp, body);
        var tolerance = TimeSpan.FromMinutes(5);

        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MissingHeaders,
            Verify(null, timestamp, valid, body, Now),
            "A request with no event identifier signed nothing identifiable.");
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MissingHeaders,
            Verify("msg_1", timestamp, null, body, Now));
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MissingHeaders,
            Verify("msg_1", null, valid, body, Now));
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MissingHeaders,
            Verify(new string('a', 200), timestamp, valid, body, Now),
            "An unbounded event identifier is refused before it is stored.");
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MalformedTimestamp,
            Verify("msg_1", "not-a-number", valid, body, Now));
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MalformedSignature,
            Verify("msg_1", timestamp, "garbage", body, Now));
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.MalformedSignature,
            Verify("msg_1", timestamp, "v1,notbase64!!", body, Now));
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.SignatureMismatch,
            Verify(
                "msg_1",
                timestamp,
                NotificationWebhookSignature.Sign(OtherFingerprintKey, "msg_1", timestamp, body),
                body,
                Now),
            "A signature under a different key is a forgery, however well-formed.");
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.SignatureMismatch,
            Verify("msg_2", timestamp, valid, body, Now),
            "The event identifier is signed, so it cannot be swapped.");
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.NotConfigured,
            NotificationWebhookSignature.Verify([], "msg_1", timestamp, valid, body, Now, tolerance),
            "A deployment with no signing key verifies nothing and accepts nothing.");
    }

    /// <summary>
    /// A captured request stops being valid, in both directions.
    /// </summary>
    /// <remarks>
    /// Without a bounded tolerance, anybody who once observed a bounce event could replay it whenever
    /// they liked and suppress somebody's mail. A future timestamp is refused for the same reason: an
    /// attacker who could pre-date a capture forward would mint one that stays valid for days.
    /// </remarks>
    [TestMethod]
    public void AnExpiredOrFutureDatedSignatureIsRefused()
    {
        var body = Body("""{"type":"email.bounced"}""");
        var tolerance = TimeSpan.FromMinutes(5);

        foreach (var skew in new[] { TimeSpan.FromMinutes(6), TimeSpan.FromMinutes(-6) })
        {
            var signedAt = Now + skew;
            var timestamp = Unix(signedAt);
            Assert.AreEqual(
                NotificationWebhookSignatureVerdict.Expired,
                NotificationWebhookSignature.Verify(
                    SigningKey,
                    "msg_1",
                    timestamp,
                    NotificationWebhookSignature.Sign(SigningKey, "msg_1", timestamp, body),
                    body,
                    Now,
                    tolerance),
                $"A signature {skew} from now must be refused.");
        }

        // And a capture just inside the window is still honoured, so the bound is a window rather than
        // an accident of clock precision.
        var insideAt = Now - TimeSpan.FromMinutes(4);
        var inside = Unix(insideAt);
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.Valid,
            NotificationWebhookSignature.Verify(
                SigningKey,
                "msg_1",
                inside,
                NotificationWebhookSignature.Sign(SigningKey, "msg_1", inside, body),
                body,
                Now,
                tolerance));
    }

    /// <summary>
    /// The header carries a list, which is what makes a secret rotation possible without an outage:
    /// during the overlap the provider signs with both, and either one being right is enough.
    /// </summary>
    [TestMethod]
    public void AnyOneOfSeveralOfferedSignaturesMayMatch()
    {
        var body = Body("""{"type":"email.complained"}""");
        var timestamp = Unix(Now);
        var wrong = NotificationWebhookSignature.Sign(OtherFingerprintKey, "msg_1", timestamp, body);
        var right = NotificationWebhookSignature.Sign(SigningKey, "msg_1", timestamp, body);

        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.Valid,
            Verify("msg_1", timestamp, $"{wrong} {right}", body, Now));
        Assert.AreEqual(
            NotificationWebhookSignatureVerdict.Valid,
            Verify("msg_1", timestamp, $"v2,ignored {right}", body, Now),
            "A version this build does not implement is skipped, not treated as malformed.");
    }

    [TestMethod]
    public void OnlyAWellFormedSigningSecretIsAccepted()
    {
        Assert.IsFalse(NotificationWebhookSignature.TryParseSecret(null, out _, out _));
        Assert.IsFalse(NotificationWebhookSignature.TryParseSecret("   ", out _, out _));
        Assert.IsFalse(
            NotificationWebhookSignature.TryParseSecret(Convert.ToBase64String(SigningKey), out _, out _),
            "A secret without the provider's prefix is a configuration mistake worth catching.");
        Assert.IsFalse(
            NotificationWebhookSignature.TryParseSecret("whsec_短", out _, out _));
        Assert.IsFalse(
            NotificationWebhookSignature.TryParseSecret(
                "whsec_" + Convert.ToBase64String(new byte[8]),
                out _,
                out _),
            "A secret shorter than the minimum is refused rather than used.");

        Assert.IsTrue(
            NotificationWebhookSignature.TryParseSecret(
                "whsec_" + Convert.ToBase64String(SigningKey),
                out var parsed,
                out var error));
        Assert.IsNull(error);
        CollectionAssert.AreEqual(SigningKey, parsed);
    }

    // ---------- address fingerprints ----------

    /// <summary>
    /// The fingerprint is a keyed MAC, so two deployments holding the same address produce different
    /// values and neither can be reversed by anybody who does not hold the key.
    /// </summary>
    [TestMethod]
    public void AFingerprintIsKeyedAndStableForOneMailbox()
    {
        const string address = "client@example.test";

        var first = NotificationAddressFingerprint.Compute(FingerprintKey, address);
        Assert.AreEqual(first, NotificationAddressFingerprint.Compute(FingerprintKey, address));
        Assert.AreNotEqual(first, NotificationAddressFingerprint.Compute(OtherFingerprintKey, address));
        Assert.AreNotEqual(first, NotificationAddressFingerprint.Compute(FingerprintKey, "other@example.test"));
        Assert.IsTrue(NotificationAddressFingerprint.IsValidFingerprint(first));
        Assert.HasCount(NotificationAddressFingerprint.FingerprintLength, first);

        // Nothing about the address survives into the value.
        Assert.DoesNotContain("client", first, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("example", first, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Case and surrounding whitespace do not make a different mailbox, because no mail provider
    /// treats them as one — and a bounce that a stray capital letter could sidestep is not a bounce
    /// that protects a sending reputation.
    /// </summary>
    [TestMethod]
    public void FingerprintingNormalizesCaseAndWhitespaceAndNothingElse()
    {
        var canonical = NotificationAddressFingerprint.Compute(FingerprintKey, "client@example.test");

        Assert.AreEqual(canonical, NotificationAddressFingerprint.Compute(FingerprintKey, "  Client@Example.TEST "));

        // Plus-tags and dots are meaningful at some providers, so they are left alone: stripping them
        // would suppress a mailbox that never bounced.
        Assert.AreNotEqual(
            canonical,
            NotificationAddressFingerprint.Compute(FingerprintKey, "client+gym@example.test"));
        Assert.AreNotEqual(
            canonical,
            NotificationAddressFingerprint.Compute(FingerprintKey, "cl.ient@example.test"));
    }

    /// <summary>
    /// A rotation adds a key rather than replacing one, so every suppression written under a retired
    /// key keeps matching. Silently resuming mail to an address that hard-bounced would be the worst
    /// possible consequence of routine key hygiene.
    /// </summary>
    [TestMethod]
    public void EveryConfiguredKeyProducesAComparableFingerprintWithTheActiveOneFirst()
    {
        var provider = new NotificationEmailProviderOptions
        {
            FingerprintKeyId = "2026-09",
            FingerprintKeys =
            {
                ["2026-08"] = Convert.ToBase64String(OtherFingerprintKey),
                ["2026-09"] = Convert.ToBase64String(FingerprintKey),
            },
        };

        var keys = provider.ResolveFingerprintKeys();
        Assert.HasCount(2, keys);
        Assert.AreEqual("2026-09", keys[0].KeyId, "The active key leads, so new evidence uses it.");

        var fingerprints = NotificationAddressFingerprint.ComputeAll(keys, "client@example.test");
        Assert.HasCount(2, fingerprints);
        Assert.AreEqual(NotificationAddressFingerprint.Compute(FingerprintKey, "client@example.test"), fingerprints[0]);
        Assert.Contains(
            NotificationAddressFingerprint.Compute(OtherFingerprintKey, "client@example.test"),
            fingerprints,
            "A suppression written under the retired key must still be comparable.");
    }

    [TestMethod]
    public void OnlyABoundedSafeProviderIdentifierIsAccepted()
    {
        Assert.IsTrue(NotificationProviderMessageId.IsValid("49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"));
        Assert.IsTrue(NotificationProviderMessageId.IsValid("msg_01H.:-"));
        Assert.IsFalse(NotificationProviderMessageId.IsValid(null));
        Assert.IsFalse(NotificationProviderMessageId.IsValid(string.Empty));
        Assert.IsFalse(NotificationProviderMessageId.IsValid("has space"));
        Assert.IsFalse(NotificationProviderMessageId.IsValid("new\nline"));
        Assert.IsFalse(NotificationProviderMessageId.IsValid("<script>"));
        Assert.IsFalse(NotificationProviderMessageId.IsValid(new string('a', 201)));
    }

    // ---------- webhook payload mapping ----------

    /// <summary>
    /// The provider's own event names are mapped into owned vocabulary, and a bounce keeps its
    /// classification because only a permanent one may suppress.
    /// </summary>
    [TestMethod]
    public void ProviderEventNamesMapToOwnedVocabulary()
    {
        foreach (var (providerType, expected) in new[]
                 {
                     ("email.sent", NotificationProviderEventType.ProviderAccepted),
                     ("email.delivered", NotificationProviderEventType.RecipientServerAccepted),
                     ("email.delivery_delayed", NotificationProviderEventType.DeliveryDelayed),
                     ("email.bounced", NotificationProviderEventType.Bounced),
                     ("email.complained", NotificationProviderEventType.Complained),
                     ("email.failed", NotificationProviderEventType.Failed),
                     ("email.suppressed", NotificationProviderEventType.ProviderSuppressed),
                 })
        {
            var result = NotificationProviderEventPayload.Read(
                Event(providerType, """{"type":"Permanent"}"""),
                Now);

            Assert.AreEqual(NotificationProviderEventPayloadStatus.Read, result.Status, providerType);
            Assert.AreEqual(expected, result.Facts!.EventType, providerType);
            Assert.AreEqual("m_1", result.Facts.ProviderMessageId);
        }
    }

    /// <summary>
    /// Tracking events are ignored entirely — not stored as an "ignored" row, which would still be a
    /// record that somebody opened their mail — and so is anything this build does not model.
    /// </summary>
    [TestMethod]
    public void OpenAndClickEventsAreIgnoredRatherThanRecorded()
    {
        foreach (var providerType in new[] { "email.opened", "email.clicked", "contact.created", "domain.updated" })
        {
            var result = NotificationProviderEventPayload.Read(Event(providerType), Now);

            Assert.AreEqual(NotificationProviderEventPayloadStatus.Ignored, result.Status, providerType);
            Assert.IsNull(result.Facts);
        }
    }

    /// <summary>
    /// Anything that is not explicitly permanent does not suppress. The cost of failing to suppress is
    /// a second bounce; the cost of suppressing wrongly is a client who silently stops hearing about
    /// their payments.
    /// </summary>
    [TestMethod]
    public void OnlyAnExplicitlyPermanentBounceIsClassifiedPermanent()
    {
        foreach (var (bounce, expected) in new[]
                 {
                     ("""{"type":"Permanent"}""", NotificationProviderBounceClass.Permanent),
                     ("""{"type":"permanent"}""", NotificationProviderBounceClass.Permanent),
                     ("""{"type":"Transient"}""", NotificationProviderBounceClass.Transient),
                     ("""{"type":"Temporary"}""", NotificationProviderBounceClass.Transient),
                     ("""{"type":"SomethingNew"}""", NotificationProviderBounceClass.Undetermined),
                     ("""{}""", NotificationProviderBounceClass.Undetermined),
                 })
        {
            var result = NotificationProviderEventPayload.Read(Event("email.bounced", bounce), Now);

            Assert.AreEqual(NotificationProviderEventPayloadStatus.Read, result.Status, bounce);
            Assert.AreEqual(expected, result.Facts!.BounceClass, bounce);
        }

        // And a bounce with no bounce object at all is still readable and still not permanent.
        var missing = NotificationProviderEventPayload.Read(
            Body("""{"type":"email.bounced","created_at":"2026-09-05T11:59:00.000Z","data":{"email_id":"m_1"}}"""),
            Now);
        Assert.AreEqual(NotificationProviderBounceClass.Undetermined, missing.Facts!.BounceClass);
    }

    [TestMethod]
    public void AnUnreadablePayloadIsMalformedRatherThanGuessedAt()
    {
        foreach (var payload in new[]
                 {
                     "",
                     "not json",
                     """{"type":"email.bounced"}""",
                     """{"type":"email.bounced","created_at":"2026-09-05T11:59:00.000Z"}""",
                     """{"type":"email.bounced","created_at":"2026-09-05T11:59:00.000Z","data":{}}""",
                     """{"type":"email.bounced","created_at":"nope","data":{"email_id":"m_1"}}""",
                     """{"type":"email.bounced","created_at":"1999-01-01T00:00:00Z","data":{"email_id":"m_1"}}""",
                     """{"type":"email.bounced","created_at":"2030-01-01T00:00:00Z","data":{"email_id":"m_1"}}""",
                     """{"type":"email.bounced","created_at":"2026-09-05T11:59:00.000Z","data":{"email_id":"has space"}}""",
                     """{"type":"email.bounced","created_at":"2026-09-05T11:59:00.000Z","data":{"email_id":"m_1"}} trailing""",
                 })
        {
            Assert.AreEqual(
                NotificationProviderEventPayloadStatus.Malformed,
                NotificationProviderEventPayload.Read(Body(payload), Now).Status,
                $"'{payload}' should not have been readable.");
        }
    }

    /// <summary>
    /// A nesting bomb is refused by the depth limit rather than parsed. The body arrives on a public
    /// route, so the parser has to be bounded even though a signature has already been verified.
    /// </summary>
    [TestMethod]
    public void ADeeplyNestedPayloadIsRefusedByTheDepthLimit()
    {
        var deep = new StringBuilder("""{"type":"email.bounced","created_at":"2026-09-05T11:59:00.000Z","data":""");
        for (var level = 0; level < 40; level++)
        {
            deep.Append("""{"a":""");
        }

        deep.Append('1');
        deep.Append('}', 40);
        deep.Append('}');

        Assert.AreEqual(
            NotificationProviderEventPayloadStatus.Malformed,
            NotificationProviderEventPayload.Read(Body(deep.ToString()), Now).Status);
    }

    // ---------- provider facts accumulate write-once ----------

    /// <summary>
    /// Out-of-order events both land, and neither overwrites the other. A bounce that arrives before
    /// the acceptance it contradicts is not corrected by the acceptance, and the acceptance is not
    /// discarded by the bounce: both are true statements about what the provider said.
    /// </summary>
    [TestMethod]
    public void OutOfOrderFactsAccumulateWithoutRewritingEachOther()
    {
        var message = SampleMessage();

        Assert.IsTrue(message.Apply(
            NotificationProviderEventType.Bounced,
            NotificationProviderBounceClass.Permanent,
            NotificationProviderEventCodes.BouncePermanent,
            Now.AddMinutes(2),
            Now.AddMinutes(5)));
        Assert.IsTrue(message.Apply(
            NotificationProviderEventType.RecipientServerAccepted,
            null,
            null,
            Now.AddMinutes(1),
            Now.AddMinutes(6)));

        Assert.AreEqual(Now.AddMinutes(2), message.BouncedAtUtc);
        Assert.AreEqual(NotificationProviderBounceClass.Permanent, message.BounceClass);
        Assert.AreEqual(Now.AddMinutes(1), message.RecipientServerAcceptedAtUtc);
        Assert.AreEqual(2, message.EventCount);
        Assert.AreEqual(Now.AddMinutes(6), message.LastEventReceivedAtUtc);
    }

    /// <summary>
    /// A repeat of a fact already held converges: it is counted, and it changes nothing. That is the
    /// only correct behaviour for a provider that guarantees at-least-once delivery.
    /// </summary>
    [TestMethod]
    public void ARepeatedFactConvergesInsteadOfRewriting()
    {
        var message = SampleMessage();
        Assert.IsTrue(message.Apply(
            NotificationProviderEventType.Complained,
            null,
            null,
            Now.AddMinutes(1),
            Now.AddMinutes(1)));

        Assert.IsFalse(
            message.Apply(
                NotificationProviderEventType.Complained,
                null,
                null,
                Now.AddMinutes(9),
                Now.AddMinutes(9)),
            "A second complaint establishes nothing new.");
        Assert.AreEqual(Now.AddMinutes(1), message.ComplainedAtUtc, "The first instant is the one that stands.");
        Assert.AreEqual(2, message.EventCount);
    }

    /// <summary>
    /// The provider restating its own acceptance carries nothing the send response did not already
    /// establish, so it is verified, counted, and applied to nothing.
    /// </summary>
    [TestMethod]
    public void AProviderAcceptanceEventEstablishesNoNewFact()
    {
        var message = SampleMessage();

        Assert.IsFalse(message.Apply(
            NotificationProviderEventType.ProviderAccepted,
            null,
            null,
            Now,
            Now));
        Assert.AreEqual(1, message.EventCount);
    }

    /// <summary>
    /// Which facts suppress, and which deliberately do not. A soft bounce and a delay are things that
    /// may work later; turning them into a permanent stop needs a threshold nobody has chosen.
    /// </summary>
    [TestMethod]
    public void OnlyAPermanentBounceComplaintOrProviderSuppressionSuppresses()
    {
        foreach (var (eventType, bounceClass, expected) in new (NotificationProviderEventType, NotificationProviderBounceClass?, NotificationEmailSuppressionReason?)[]
                 {
                     (NotificationProviderEventType.Bounced, NotificationProviderBounceClass.Permanent,
                         NotificationEmailSuppressionReason.PermanentBounce),
                     (NotificationProviderEventType.Bounced, NotificationProviderBounceClass.Transient, null),
                     (NotificationProviderEventType.Bounced, NotificationProviderBounceClass.Undetermined, null),
                     (NotificationProviderEventType.Complained, null, NotificationEmailSuppressionReason.Complaint),
                     (NotificationProviderEventType.ProviderSuppressed, null,
                         NotificationEmailSuppressionReason.ProviderSuppressed),
                     (NotificationProviderEventType.DeliveryDelayed, null, null),
                     (NotificationProviderEventType.Failed, null, null),
                     (NotificationProviderEventType.RecipientServerAccepted, null, null),
                     (NotificationProviderEventType.ProviderAccepted, null, null),
                 })
        {
            var message = SampleMessage();
            message.Apply(
                eventType,
                bounceClass,
                eventType == NotificationProviderEventType.Failed
                    ? NotificationProviderEventCodes.ProviderFailed
                    : null,
                Now,
                Now);

            Assert.AreEqual(
                expected,
                message.SuppressionReasonFor(eventType),
                $"{eventType}/{bounceClass} suppression decision is wrong.");
        }
    }

    /// <summary>
    /// A provider message may only ever describe an email that a real provider adapter accepted, and
    /// its identifier and fingerprint are validated before they can reach a column.
    /// </summary>
    [TestMethod]
    public void AProviderMessageRefusesEvidenceItCannotOwn()
    {
        Assert.ThrowsExactly<ArgumentException>(
            () => Record(adapter: NotificationEmailAdapters.CapturedAdapterName),
            "A capture contacted no provider and can own no provider message.");
        Assert.ThrowsExactly<ArgumentException>(() => Record(providerMessageId: "has space"));
        Assert.ThrowsExactly<ArgumentException>(() => Record(fingerprint: "not-a-fingerprint"));
        Assert.ThrowsExactly<ArgumentException>(() => Record(keyId: "  "));
        Assert.ThrowsExactly<ArgumentException>(() => Record(deliveryId: Guid.Empty));
    }

    /// <summary>
    /// The same rule one layer up: a delivery records provider evidence only for an email materialized
    /// by an adapter that contacted a provider. A capture claiming an identifier is refused in the
    /// domain, before the check constraint and the trigger refuse it again.
    /// </summary>
    [TestMethod]
    public void ADeliveryRefusesProviderEvidenceFromAnAdapterThatContactedNobody()
    {
        var captured = ClaimedEmailDelivery(out var capturedToken);
        Assert.ThrowsExactly<InvalidOperationException>(() => captured.MarkMaterialized(
            capturedToken,
            Now,
            NotificationEmailAdapters.CapturedAdapterName,
            "m_1"));

        var inApp = NotificationChannelDelivery.Select(
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            NotificationChannel.InApp,
            NotificationPurpose.ServiceTransactional,
            NotificationChannelPlanner.InAppAlways,
            NotificationChannelPlanner.PolicyVersion,
            Now);
        var inAppToken = inApp.Claim(Now, TimeSpan.FromMinutes(2));
        inApp.StartAttempt(inAppToken);
        Assert.ThrowsExactly<InvalidOperationException>(() => inApp.MarkMaterialized(
            inAppToken,
            Now,
            NotificationEmailAdapters.ResendAdapterName,
            "m_1"));

        var accepted = ClaimedEmailDelivery(out var acceptedToken);
        accepted.MarkMaterialized(acceptedToken, Now, NotificationEmailAdapters.ResendAdapterName, "m_1");
        Assert.AreEqual("m_1", accepted.ProviderMessageId);
        Assert.AreEqual(Now, accepted.ProviderAcceptedAtUtc);

        // And a capture records the adapter without any provider evidence at all.
        var plainCapture = ClaimedEmailDelivery(out var plainToken);
        plainCapture.MarkMaterialized(plainToken, Now, NotificationEmailAdapters.CapturedAdapterName);
        Assert.AreEqual(NotificationEmailAdapters.CapturedAdapterName, plainCapture.TransportAdapter);
        Assert.IsNull(plainCapture.ProviderMessageId);
        Assert.IsNull(plainCapture.ProviderAcceptedAtUtc);
    }

    /// <summary>
    /// An in-app attempt has no provider, so it cannot record an identifier only a provider could
    /// return; an email attempt can, once, and only with a valid one.
    /// </summary>
    [TestMethod]
    public void OnlyAnEmailAttemptRecordsAProviderIdentifier()
    {
        var inApp = NotificationDeliveryAttempt.Start(
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            NotificationChannel.InApp,
            1,
            Guid.CreateVersion7(),
            Now);
        Assert.ThrowsExactly<InvalidOperationException>(() => inApp.Succeed(Now, "m_1"));

        var email = EmailAttempt();
        Assert.ThrowsExactly<ArgumentException>(() => email.Succeed(Now, "has space"));

        var accepted = EmailAttempt();
        accepted.Succeed(Now, "m_1");
        Assert.AreEqual("m_1", accepted.ProviderMessageId);
    }

    // ---------- idempotency keys ----------

    /// <summary>
    /// The provider key is stable for one message to one mailbox, and different for a different
    /// mailbox — which is what keeps a member who corrects a mistyped address from presenting the
    /// provider with a used key and a changed payload.
    /// </summary>
    [TestMethod]
    public void TheProviderIdempotencyKeyBindsTheMessageAndTheMailbox()
    {
        var outboxItemId = Guid.CreateVersion7();
        var logical = NotificationDeliveryAttempt.BuildIdempotencyKey(outboxItemId, NotificationChannel.Email);
        var first = NotificationAddressFingerprint.Compute(FingerprintKey, "client@example.test");
        var second = NotificationAddressFingerprint.Compute(FingerprintKey, "corrected@example.test");

        var key = NotificationDeliveryAttempt.BuildProviderIdempotencyKey(logical, first);
        Assert.AreEqual(key, NotificationDeliveryAttempt.BuildProviderIdempotencyKey(logical, first));
        Assert.AreNotEqual(key, NotificationDeliveryAttempt.BuildProviderIdempotencyKey(logical, second));
        Assert.StartsWith(logical, key);
        Assert.IsLessThanOrEqualTo(256, key.Length, "The provider bounds an idempotency key at 256 characters.");

        // Two channels of one intent remain two different messages.
        Assert.AreNotEqual(
            logical,
            NotificationDeliveryAttempt.BuildIdempotencyKey(outboxItemId, NotificationChannel.InApp));
        Assert.ThrowsExactly<ArgumentException>(
            () => NotificationDeliveryAttempt.BuildProviderIdempotencyKey(logical, "short"));
    }

    /// <summary>
    /// The retry schedule has to fit inside the provider's idempotency retention window, or a late
    /// retry presents a key the provider has forgotten and the deduplicated retry becomes a second
    /// real message in somebody's inbox.
    /// </summary>
    [TestMethod]
    public void TheRetryScheduleMustFitInsideTheProviderRetentionWindow()
    {
        // 1m + 5m + 15m + 1h + 6h for the default six attempts.
        Assert.AreEqual(
            TimeSpan.FromMinutes(1) + TimeSpan.FromMinutes(5) + TimeSpan.FromMinutes(15) +
                TimeSpan.FromHours(1) + TimeSpan.FromHours(6),
            NotificationRetryPolicy.MaximumRetrySpan(NotificationDispatchOptions.DefaultMaximumAttempts));
        Assert.AreEqual(TimeSpan.Zero, NotificationRetryPolicy.MaximumRetrySpan(1));

        var options = ProviderOptions();
        Assert.IsNull(options.ValidateRetentionAgainst(NotificationDispatchOptions.DefaultMaximumAttempts));
        Assert.IsNull(options.ValidateRetentionAgainst(8), "Eight attempts still fit inside 24 hours.");
        Assert.IsNotNull(options.ValidateRetentionAgainst(9), "Nine attempts cross the 24-hour window.");
        Assert.IsNull(
            new NotificationEmailOptions().ValidateRetentionAgainst(20),
            "With no provider there is no retention window to cross.");
    }

    // ---------- configuration fails closed ----------

    /// <summary>
    /// A provider adapter with a missing secret refuses to start, in every environment and whether or
    /// not the channel is switched on. A half-configured provider that one flag flip would activate is
    /// exactly the failure this exists to prevent.
    /// </summary>
    [TestMethod]
    public void AProviderAdapterMissingAnySecretRefusesToStart()
    {
        Assert.IsNull(ProviderOptions().Validate(isProduction: true), "The complete configuration must start.");

        Assert.IsNotNull(ProviderOptions(options => options.Provider.ApiKey = string.Empty).Validate(true));
        Assert.IsNotNull(ProviderOptions(options => options.Provider.FromAddress = " ").Validate(true));
        Assert.IsNotNull(ProviderOptions(options => options.Provider.WebhookSigningSecret = string.Empty).Validate(true));
        Assert.IsNotNull(ProviderOptions(options => options.Provider.FingerprintKeyId = string.Empty).Validate(true));
        Assert.IsNotNull(
            ProviderOptions(options => options.Provider.FingerprintKeys.Clear()).Validate(true),
            "An active key id that names no configured key is a broken rotation.");
        Assert.IsNotNull(
            ProviderOptions(options => options.Provider.FingerprintKeys["active"] = Convert.ToBase64String(new byte[8]))
                .Validate(true),
            "A key too short to be a MAC key is refused.");

        // And a disabled channel does not excuse any of it.
        Assert.IsNotNull(
            ProviderOptions(options =>
            {
                options.Enabled = false;
                options.Provider.ApiKey = string.Empty;
            }).Validate(isProduction: false));
    }

    /// <summary>
    /// An endpoint is where an API key and a recipient address are sent, so a deployment that can
    /// point it anywhere by configuration has a credential-exfiltration switch. Production allows only
    /// the provider's own HTTPS host; outside Production the rule relaxes as far as loopback, which is
    /// what lets the adapter be proven against a controlled double with no network at all.
    /// </summary>
    [TestMethod]
    public void OnlyAnApprovedHttpsEndpointIsAcceptedInProduction()
    {
        Assert.IsNull(NotificationEmailProviderEndpoints.Validate(
            NotificationEmailProviderEndpoints.ResendSend,
            isProduction: true));

        foreach (var rejected in new[]
                 {
                     "http://api.resend.com/emails",
                     "https://api.resend.com.evil.test/emails",
                     "https://attacker.test/emails",
                     "http://127.0.0.1:9/emails",
                     "https://user:pass@api.resend.com/emails",
                     "https://api.resend.com/emails?x=1",
                     "not a url",
                     "",
                 })
        {
            Assert.IsNotNull(
                NotificationEmailProviderEndpoints.Validate(rejected, isProduction: true),
                $"Production accepted '{rejected}'.");
        }

        // Outside Production: any HTTPS host, plus plain HTTP on loopback for a controlled double.
        Assert.IsNull(NotificationEmailProviderEndpoints.Validate("http://127.0.0.1:5099/emails", false));
        Assert.IsNull(NotificationEmailProviderEndpoints.Validate("http://localhost:5099/emails", false));
        Assert.IsNull(NotificationEmailProviderEndpoints.Validate("https://sandbox.test/emails", false));
        Assert.IsNotNull(
            NotificationEmailProviderEndpoints.Validate("http://provider.test/emails", false),
            "Plain HTTP off loopback is refused even outside Production.");
    }

    /// <summary>
    /// Configuration that contradicts itself refuses to start rather than leaving somebody to guess
    /// which half is in force.
    /// </summary>
    [TestMethod]
    public void ContradictoryConfigurationIsRefused()
    {
        var capturedWithSecrets = new NotificationEmailOptions
        {
            Enabled = true,
            Adapter = NotificationEmailAdapters.Captured,
            Provider = { ApiKey = "re_test" },
        };
        Assert.IsNotNull(
            capturedWithSecrets.Validate(isProduction: false),
            "Provider secrets beside an adapter that contacts nothing is a mistake, not a preference.");

        var webhookWithoutProvider = new NotificationEmailOptions
        {
            Provider = { WebhookSigningSecret = "whsec_" + Convert.ToBase64String(SigningKey) },
        };
        Assert.IsNotNull(webhookWithoutProvider.Validate(isProduction: true));

        Assert.IsNotNull(
            new NotificationEmailOptions { Adapter = "Sendmail" }.Validate(isProduction: false),
            "An adapter this build does not implement fails startup rather than reading as 'none'.");
        Assert.IsNotNull(
            new NotificationEmailOptions { Enabled = true, Adapter = NotificationEmailAdapters.None }
                .Validate(isProduction: false));

        // Production still refuses the captured adapter outright, enabled or not.
        Assert.IsNotNull(
            new NotificationEmailOptions { Adapter = NotificationEmailAdapters.Captured }.Validate(true));
        Assert.IsNull(
            new NotificationEmailOptions().Validate(isProduction: true),
            "Disabled email with no adapter remains the production default and must start.");
    }

    /// <summary>Which configurations may actually materialize email, and what each records.</summary>
    [TestMethod]
    public void AvailabilityAndTheRecordedAdapterNameFollowTheConfiguration()
    {
        Assert.IsFalse(new NotificationEmailOptions().IsAvailable);
        Assert.IsFalse(ProviderOptions(options => options.Enabled = false).IsAvailable);
        Assert.IsTrue(ProviderOptions().IsAvailable);
        Assert.AreEqual(NotificationEmailAdapters.ResendAdapterName, ProviderOptions().MaterializingAdapterName);
        Assert.AreEqual(
            NotificationEmailAdapters.CapturedAdapterName,
            new NotificationEmailOptions { Adapter = NotificationEmailAdapters.Captured }.MaterializingAdapterName);
        Assert.IsNull(new NotificationEmailOptions().MaterializingAdapterName);

        Assert.IsTrue(NotificationEmailAdapters.IsProviderAdapterName(NotificationEmailAdapters.ResendAdapterName));
        Assert.IsFalse(NotificationEmailAdapters.IsProviderAdapterName(NotificationEmailAdapters.CapturedAdapterName));
        Assert.IsFalse(NotificationEmailAdapters.IsProviderAdapterName(null));
    }

    // ---------- helpers ----------

    private static NotificationWebhookSignatureVerdict Verify(
        string? eventId,
        string? timestamp,
        string? signature,
        byte[] body,
        DateTimeOffset now) =>
        NotificationWebhookSignature.Verify(
            SigningKey,
            eventId,
            timestamp,
            signature,
            body,
            now,
            TimeSpan.FromMinutes(5));

    private static byte[] Body(string json) => Encoding.UTF8.GetBytes(json);

    /// <summary>
    /// One provider event body, assembled by concatenation rather than interpolation. JSON is mostly
    /// braces, and an interpolated raw string turns every one of them into an escaping question the
    /// test does not need to answer.
    /// </summary>
    private static byte[] Event(string providerType, string? bounce = null)
    {
        var data = bounce is null
            ? "{\"email_id\":\"m_1\"}"
            : "{\"email_id\":\"m_1\",\"bounce\":" + bounce + "}";
        return Body(
            "{\"type\":\"" + providerType +
            "\",\"created_at\":\"2026-09-05T11:59:00.000Z\",\"data\":" + data + "}");
    }

    private static string Unix(DateTimeOffset instant) =>
        instant.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);

    private static NotificationProviderMessage SampleMessage() => Record();

    private static NotificationProviderMessage Record(
        string adapter = NotificationEmailAdapters.ResendAdapterName,
        string providerMessageId = "m_1",
        string? fingerprint = null,
        string keyId = "active",
        Guid? deliveryId = null) =>
        NotificationProviderMessage.Record(
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            deliveryId ?? Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            adapter,
            providerMessageId,
            fingerprint ?? NotificationAddressFingerprint.Compute(FingerprintKey, "client@example.test"),
            keyId,
            Now);

    private static NotificationChannelDelivery ClaimedEmailDelivery(out Guid claimToken)
    {
        var delivery = NotificationChannelDelivery.Select(
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            NotificationChannel.Email,
            NotificationPurpose.ServiceTransactional,
            NotificationChannelPlanner.EmailServiceOptIn,
            NotificationChannelPlanner.PolicyVersion,
            Now);
        claimToken = delivery.Claim(Now, TimeSpan.FromMinutes(2));
        delivery.StartAttempt(claimToken);
        return delivery;
    }

    private static NotificationDeliveryAttempt EmailAttempt() => NotificationDeliveryAttempt.Start(
        Guid.CreateVersion7(),
        Guid.CreateVersion7(),
        Guid.CreateVersion7(),
        NotificationChannel.Email,
        1,
        Guid.CreateVersion7(),
        Now);

    private static NotificationEmailOptions ProviderOptions(Action<NotificationEmailOptions>? configure = null)
    {
        var options = new NotificationEmailOptions
        {
            Enabled = true,
            Adapter = NotificationEmailAdapters.Resend,
            Provider =
            {
                ApiKey = "re_test_key",
                FromAddress = "TB Gym <notifications@mail.example.test>",
                WebhookSigningSecret = "whsec_" + Convert.ToBase64String(SigningKey),
                FingerprintKeyId = "active",
                FingerprintKeys = { ["active"] = Convert.ToBase64String(FingerprintKey) },
            },
        };
        configure?.Invoke(options);
        return options;
    }
}
