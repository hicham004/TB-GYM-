using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Website;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The Talk-to-us request's rules (UI plan R6.2g, WEB-001 and WEB-002): what a request must hold,
/// how one field reads an email address or a WhatsApp number, the honeypot, and the owner's email.
/// </summary>
[TestClass]
public sealed class R62gContactRequestDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 13, 9, 30, 0, TimeSpan.Zero);

    [TestMethod]
    public void AValidRequestIsTrimmedFoldedAndClassified()
    {
        var validation = ContactRequestRules.Validate(new ContactRequestSubmission(
            Name: "  Rami   Tabet ",
            GymName: "Oakline\tStrength ",
            Contact: " Rami@Example.com ",
            Message: "  Six coaches,\r\nabout 90 clients.  ",
            Website: null,
            FormStamp: "stamp"));

        Assert.IsTrue(validation.IsValid);
        var facts = validation.Facts!;
        Assert.AreEqual("Rami Tabet", facts.Name);
        Assert.AreEqual("Oakline Strength", facts.GymName);
        Assert.AreEqual("Rami@Example.com", facts.Contact);
        Assert.AreEqual(ContactKind.Email, facts.ContactKind);
        Assert.AreEqual("Six coaches,\nabout 90 clients.", facts.Message);
    }

    [TestMethod]
    public void TheOneContactFieldReadsAWhatsAppNumberInAnyCommonSpelling()
    {
        foreach (var (typed, expected) in new[]
        {
            ("+961 70 123 456", "+96170123456"),
            ("(03) 123-456", "03123456"),
            ("70.123.456", "70123456"),
            ("00961 70 123 456", "0096170123456"),
        })
        {
            var contact = ContactRequestRules.ReadContact(typed);
            Assert.IsNotNull(contact, typed);
            Assert.AreEqual(expected, contact.Value.Contact, typed);
            Assert.AreEqual(ContactKind.WhatsApp, contact.Value.Kind, typed);
        }
    }

    [TestMethod]
    public void AContactThatIsNeitherAnAddressNorANumberIsRefused()
    {
        foreach (var typed in new[] { "", "   ", "rami", "rami@", "@example.com", "123", "+", "+961 70 123 456 ext 9", "1234567890123456", "a@b.c, c@d.e" })
        {
            Assert.IsNull(ContactRequestRules.ReadContact(typed), $"'{typed}' was read as a contact.");
        }
    }

    [TestMethod]
    public void EveryMissingOrOversizedFieldIsNamedAndNothingIsBuilt()
    {
        var validation = ContactRequestRules.Validate(new ContactRequestSubmission(
            Name: " ",
            GymName: new string('g', ContactRequestRules.GymNameMaxLength + 1),
            Contact: "not a contact",
            Message: new string('m', ContactRequestRules.MessageMaxLength + 1),
            Website: null,
            FormStamp: null));

        Assert.IsFalse(validation.IsValid);
        Assert.IsNull(validation.Facts);
        Assert.AreEqual(
            "contact, gymName, message, name",
            string.Join(", ", validation.Errors.Keys.Order(StringComparer.Ordinal)));
    }

    [TestMethod]
    public void TheMessageIsOptionalAndControlCharactersNeverReachIt()
    {
        var blank = ContactRequestRules.Validate(Submission(message: "   \r\n  "));
        Assert.IsTrue(blank.IsValid);
        Assert.IsNull(blank.Facts!.Message);

        var cleaned = ContactRequestRules.Validate(Submission(message: "Line one\u0007\u001b[31m\r\nLine\ttwo\u0000"));
        Assert.IsTrue(cleaned.IsValid);
        Assert.AreEqual("Line one[31m\nLine\ttwo", cleaned.Facts!.Message);
    }

    [TestMethod]
    public void AFilledHoneypotMarksADecoyWhateverTheOtherFieldsSay()
    {
        Assert.IsTrue(ContactRequestRules.IsDecoy(Submission(website: "https://spam.example")));
        Assert.IsFalse(ContactRequestRules.IsDecoy(Submission(website: "  ")));
        Assert.IsFalse(ContactRequestRules.IsDecoy(Submission()));
    }

    [TestMethod]
    public void TheMinimumFormTimeIsThreeSecondsAndAStampLastsADay()
    {
        Assert.AreEqual(TimeSpan.FromSeconds(3), ContactRequestRules.MinimumFormTime);
        Assert.AreEqual(TimeSpan.FromHours(24), ContactRequestRules.MaximumStampAge);
    }

    [TestMethod]
    public void TheOwnersEmailCarriesTheFactsInPlainTextAndNamesTheRequest()
    {
        var request = ContactRequest.Receive(
            ContactRequestRules.Validate(Submission(message: "Two floors, eight coaches.")).Facts!,
            Now);

        var content = ContactRequestEmailTemplate.Render(request);

        Assert.AreEqual("Talk to us: Oakline Strength (Rami Tabet)", content.Subject);
        StringAssert.Contains(content.Body, "Name: Rami Tabet\n");
        StringAssert.Contains(content.Body, "Gym: Oakline Strength\n");
        StringAssert.Contains(content.Body, "WhatsApp: +96170123456\n");
        StringAssert.Contains(content.Body, "Received: 2026-10-13 09:30 UTC\n");
        StringAssert.Contains(content.Body, "Two floors, eight coaches.\n");
        StringAssert.Contains(content.Body, request.Id.ToString());
        Assert.AreEqual(ContactRequestEmailTemplate.Key, content.TemplateKey);
        Assert.AreEqual(ContactRequestEmailTemplate.CurrentVersion, content.TemplateVersion);
    }

    [TestMethod]
    public void AnEmailContactIsLabelledEmailAndAnEmptyMessageSaysSo()
    {
        var request = ContactRequest.Receive(
            ContactRequestRules.Validate(Submission(contact: "rami@example.com")).Facts!,
            Now);

        var content = ContactRequestEmailTemplate.Render(request);

        StringAssert.Contains(content.Body, "Email: rami@example.com\n");
        StringAssert.Contains(content.Body, "(nothing written)\n");
    }

    [TestMethod]
    public void TheEmailQueueFollowsTheActionMailLifecycle()
    {
        var request = ContactRequest.Receive(ContactRequestRules.Validate(Submission()).Facts!, Now);
        Assert.AreEqual(ContactRequestMailStatus.Pending, request.Status);
        Assert.AreEqual(Now, request.NextAttemptAtUtc);
        Assert.IsTrue(request.IsClaimable(Now));
        Assert.IsFalse(request.IsClaimable(Now.AddSeconds(-1)));

        var claim = request.Claim(Now, TimeSpan.FromMinutes(2), maximumAttempts: 4);
        Assert.AreEqual(ContactRequestMailStatus.Processing, request.Status);
        Assert.AreEqual(Now.AddMinutes(2), request.ClaimExpiresAtUtc);
        Assert.Throws<InvalidOperationException>(() => request.Claim(Now, TimeSpan.FromMinutes(2), 4));

        Assert.AreEqual(1, request.StartAttempt(claim, 4));
        Assert.AreEqual(ContactRequest.BuildProviderIdempotencyKey(request.Id, 1), request.ProviderIdempotencyKey);
        Assert.Throws<InvalidOperationException>(() => request.MarkMaterialized(Guid.NewGuid(), Now, "captured"));

        var retryAt = ContactRequestMailRetryPolicy.NextAttemptAtUtc(1, 4, Now);
        Assert.AreEqual(Now.AddMinutes(1), retryAt);
        request.MarkRetrying(claim, retryAt!.Value, ContactRequestMailCodes.TransportTransient);
        Assert.AreEqual(ContactRequestMailStatus.Pending, request.Status);
        Assert.IsNull(request.ClaimToken);
        Assert.AreEqual(ContactRequestMailCodes.TransportTransient, request.FailureCode);

        var second = request.Claim(retryAt.Value, TimeSpan.FromMinutes(2), 4);
        Assert.AreEqual(2, request.StartAttempt(second, 4));
        request.MarkMaterialized(second, retryAt.Value, "resend", "msg_1");
        Assert.AreEqual(ContactRequestMailStatus.Materialized, request.Status);
        Assert.IsTrue(request.IsTerminal);
        Assert.IsNull(request.FailureCode);
        Assert.AreEqual("msg_1", request.ProviderMessageId);
        Assert.AreEqual(retryAt.Value, request.ProviderAcceptedAtUtc);
        Assert.IsNull(request.ClaimToken);
    }

    [TestMethod]
    public void AnExpiredClaimIsAbandonedAndTheScheduleEndsInADeadLetter()
    {
        var request = ContactRequest.Receive(ContactRequestRules.Validate(Submission()).Facts!, Now);
        request.Claim(Now, TimeSpan.FromMinutes(2), 4);
        Assert.Throws<InvalidOperationException>(() => request.Abandon(Now.AddMinutes(1)));

        var later = Now.AddMinutes(3);
        Assert.IsTrue(request.IsClaimExpired(later));
        request.Abandon(later);
        Assert.AreEqual(ContactRequestMailStatus.Pending, request.Status);
        Assert.AreEqual(ContactRequestMailCodes.ClaimExpired, request.FailureCode);

        Assert.IsNull(ContactRequestMailRetryPolicy.NextAttemptAtUtc(4, 4, Now));
        var claim = request.Claim(later, TimeSpan.FromMinutes(2), 4);
        request.StartAttempt(claim, 4);
        request.MarkDeadLettered(claim, later, ContactRequestMailCodes.TransportPermanent);
        Assert.AreEqual(ContactRequestMailStatus.DeadLettered, request.Status);
        Assert.AreEqual(later, request.DeadLetteredAtUtc);
        Assert.AreEqual(later, request.CompletedAtUtc);
        Assert.IsTrue(request.IsTerminal);
    }

    /// <summary>
    /// Each module declares its own schedule and budget rather than referencing another's; this is
    /// what keeps the four queues agreeing.
    /// </summary>
    [TestMethod]
    public void TheRetryScheduleAndAttemptBudgetMatchTheOtherActionMailQueues()
    {
        CollectionAssert.AreEqual(
            AccountActionMailRetryPolicy.Schedule.ToArray(),
            ContactRequestMailRetryPolicy.Schedule.ToArray());
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            Assert.AreEqual(
                AccountActionMailRetryPolicy.NextAttemptAtUtc(attempt, 4, Now),
                ContactRequestMailRetryPolicy.NextAttemptAtUtc(attempt, 4, Now),
                $"attempt {attempt}");
        }

        ContactRequestMailLimits.ValidateMaximumAttempts(ContactRequestMailLimits.DefaultMaximumAttempts);
        AccountActionMailLimits.ValidateMaximumAttempts(ContactRequestMailLimits.DefaultMaximumAttempts);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            ContactRequestMailLimits.ValidateMaximumAttempts(ContactRequestMailLimits.MinimumMaximumAttempts - 1));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            ContactRequestMailLimits.ValidateMaximumAttempts(ContactRequestMailLimits.MaximumMaximumAttempts + 1));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            AccountActionMailLimits.ValidateMaximumAttempts(ContactRequestMailLimits.MaximumMaximumAttempts + 1));
    }

    private static ContactRequestSubmission Submission(
        string? contact = "+961 70 123 456",
        string? message = null,
        string? website = null) =>
        new("Rami Tabet", "Oakline Strength", contact, message, website, "stamp");
}
