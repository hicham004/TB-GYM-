using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The audit's batch A16a (INV-3): a legal document version holds its own reviewed text and acceptance
/// sentence, hashed as PostgreSQL hashes them, and the rule of who is asked to accept what (CLI-010).
/// The text here is placeholder text for the tests, not legal wording.
/// </summary>
[TestClass]
public sealed class A16aLegalDocumentDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);

    // The SHA-256 of "Section 1\n\nPlaceholder text written for a test." in UTF-8.
    private const string PlaceholderHash = "04b63ff45596250d105ac72aeff8ab5758b24d11645d99ab07dad8d88b9dab78";

    [TestMethod]
    public void A16aAPublishedVersionKeepsItsTextHashedAndReadOnItsOwnPage()
    {
        var document = LegalDocumentVersion.PublishReviewed(
            LegalDocumentKind.TermsOfService,
            " 2026-10 ",
            "en",
            LegalConsentContext.Platform,
            "\r\n  Section 1\r\n\r\nPlaceholder text written for a test.  \r\n",
            "  Placeholder sentence to tick.  ",
            Now);

        // Line endings become \n and only the whole text's ends are trimmed, so a paste hashes the same twice.
        Assert.AreEqual("Section 1\n\nPlaceholder text written for a test.", document.Content);
        Assert.AreEqual(PlaceholderHash, document.ContentSha256);
        Assert.AreEqual(PlaceholderHash, LegalDocumentVersion.HashOf(LegalDocumentVersion.NormalizeContent(
            "Section 1\r\rPlaceholder text written for a test.")));
        Assert.AreEqual("Placeholder sentence to tick.", document.AcceptanceStatement);
        Assert.AreEqual("2026-10", document.VersionLabel);
        Assert.AreEqual($"/legal/{document.Id:D}", document.ContentUri);
        Assert.AreEqual(LegalReviewStatus.Approved, document.ReviewStatus);
        Assert.AreEqual(Now, document.PublishedAtUtc);
        Assert.IsTrue(document.IsCurrent);

        // A draft is never current until approved and published, and a version retires once.
        var draft = LegalDocumentVersion.CreateDraft(
            LegalDocumentKind.PrivacyPolicy, "1", "EN", LegalConsentContext.Workspace, "Text — “naïve” نص", "Sentence");
        Assert.AreEqual("en", draft.Culture);
        Assert.AreEqual(LegalReviewStatus.RequiresProfessionalReview, draft.ReviewStatus);
        Assert.IsFalse(draft.IsCurrent);
        Assert.ThrowsExactly<InvalidOperationException>(() => draft.Retire(Now));
        document.Retire(Now.AddDays(30));
        Assert.IsFalse(document.IsCurrent);
        Assert.ThrowsExactly<InvalidOperationException>(() => document.Retire(Now.AddDays(31)));
        Assert.ThrowsExactly<InvalidOperationException>(() => document.ApproveAndPublish(Now.AddDays(31)));
    }

    [TestMethod]
    public void A16aAVersionRefusesWordsItCouldNotKeep()
    {
        static ArgumentException Refused(string version, string culture, string content, string statement) =>
            Assert.ThrowsExactly<ArgumentException>(() => LegalDocumentVersion.CreateDraft(
                LegalDocumentKind.TermsOfService, version, culture, LegalConsentContext.Platform, content, statement));

        Assert.AreEqual("Paste the document's text.", Refused("1", "en", " \r\n ", "Tick").PersonMessage());
        Assert.AreEqual(
            "The text can be at most 200,000 characters.",
            Refused("1", "en", new string('a', LegalDocumentVersion.MaximumContentLength + 1), "Tick").PersonMessage());
        Assert.AreEqual(
            "The text holds a character that cannot be stored.",
            Refused("1", "en", "Text \ud800 with half a pair", "Tick").PersonMessage());
        Assert.AreEqual("Enter the sentence people tick to accept.", Refused("1", "en", "Text", "  ").PersonMessage());
        Assert.AreEqual("Write it on one line.", Refused("1", "en", "Text", "First\nsecond").PersonMessage());
        Assert.AreEqual("Use 300 characters or fewer.", Refused("1", "en", "Text", new string('s', 301)).PersonMessage());
        Assert.AreEqual("Give the version a name.", Refused(" ", "en", "Text", "Tick").PersonMessage());
        Assert.AreEqual("Use 40 characters or fewer.", Refused(new string('v', 41), "en", "Text", "Tick").PersonMessage());
        // English only for now: a second language's versions would be published and replaced apart from it.
        foreach (var language in new[] { "ar", "fr", "en-LB", "not a language" })
        {
            Assert.AreEqual(
                "Only English can be published for now.",
                Refused("1", language, "Text", "Tick").PersonMessage(),
                language);
        }

        // The longest text and sentence are kept whole.
        var longest = LegalDocumentVersion.CreateDraft(
            LegalDocumentKind.TermsOfService,
            new string('v', 40),
            "en",
            LegalConsentContext.Platform,
            new string('a', LegalDocumentVersion.MaximumContentLength),
            new string('s', 300));
        Assert.AreEqual(LegalDocumentVersion.MaximumContentLength, longest.Content.Length);
        Assert.AreEqual(300, longest.AcceptanceStatement.Length);
    }

    [TestMethod]
    public void A16aTermsAndPrivacyAreAskedOfEveryoneAndTheHealthConsentOfClients()
    {
        foreach (var audience in Enum.GetValues<LegalAudience>())
        {
            Assert.IsTrue(LegalAcceptanceRule.AppliesTo(LegalDocumentKind.TermsOfService, audience));
            Assert.IsTrue(LegalAcceptanceRule.AppliesTo(LegalDocumentKind.PrivacyPolicy, audience));
        }

        Assert.IsTrue(LegalAcceptanceRule.AppliesTo(LegalDocumentKind.HealthIntakeConsent, LegalAudience.Client));
        Assert.IsFalse(LegalAcceptanceRule.AppliesTo(LegalDocumentKind.HealthIntakeConsent, LegalAudience.Coach));
        Assert.IsFalse(LegalAcceptanceRule.AppliesTo(LegalDocumentKind.HealthIntakeConsent, LegalAudience.Owner));
    }

    [TestMethod]
    public void A16aOneVersionOfEachDocumentIsShownInTheReadersLanguage()
    {
        var termsEnglish = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform, "en");
        var termsArabic = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform, "ar");
        var privacyArabic = Current(LegalDocumentKind.PrivacyPolicy, LegalConsentContext.Platform, "ar");
        var privacyHere = Current(LegalDocumentKind.PrivacyPolicy, LegalConsentContext.Workspace, "en");
        var health = Current(LegalDocumentKind.HealthIntakeConsent, LegalConsentContext.Workspace, "en");
        CurrentLegalDocument[] current = [health, privacyHere, privacyArabic, termsArabic, termsEnglish];
        var none = new HashSet<Guid>();

        // Per document and context: English when there is one, else the version there is.
        CollectionAssert.AreEqual(
            new[] { termsEnglish, privacyArabic, privacyHere },
            LegalAcceptanceRule.ToShow(current, LegalAudience.Owner, none).ToArray());
        CollectionAssert.AreEqual(
            new[] { termsEnglish, privacyArabic, privacyHere, health },
            LegalAcceptanceRule.ToShow(current, LegalAudience.Client, none).ToArray());
        CollectionAssert.AreEqual(
            new[] { termsArabic, privacyArabic, privacyHere },
            LegalAcceptanceRule.ToShow(current, LegalAudience.Coach, none, "ar").ToArray());

        // A document accepted in any of its languages is not shown again.
        CollectionAssert.AreEqual(
            new[] { privacyArabic, privacyHere },
            LegalAcceptanceRule.ToShow(current, LegalAudience.Coach, new HashSet<Guid> { termsArabic.Id }).ToArray());
        Assert.IsEmpty(LegalAcceptanceRule.ToShow([], LegalAudience.Client, none));
    }

    [TestMethod]
    public void A16aEveryDocumentInForceMustBeNamedAndOnlyThoseCanBe()
    {
        var terms = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform, "en");
        var termsArabic = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform, "ar");
        var privacy = Current(LegalDocumentKind.PrivacyPolicy, LegalConsentContext.Workspace, "en");
        var health = Current(LegalDocumentKind.HealthIntakeConsent, LegalConsentContext.Workspace, "en");
        CurrentLegalDocument[] current = [terms, termsArabic, privacy, health];
        var none = new HashSet<Guid>();

        // Nothing published: nothing is asked, and nothing can be named.
        Assert.IsEmpty(LegalAcceptanceRule.Check([], LegalAudience.Owner, none, null)!);
        Assert.IsNull(LegalAcceptanceRule.Check([], LegalAudience.Owner, none, [terms.Id]));

        // An owner names Terms and Privacy, once each however often they are sent.
        CollectionAssert.AreEquivalent(
            new[] { terms, privacy },
            LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [terms.Id, privacy.Id, terms.Id])!.ToArray());
        // Either language of a document counts for it.
        CollectionAssert.AreEquivalent(
            new[] { termsArabic, privacy },
            LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [termsArabic.Id, privacy.Id])!.ToArray());
        // A document left out, a document that does not apply, and one replaced or unknown are refused.
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [terms.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [terms.Id, privacy.Id, health.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [terms.Id, privacy.Id, Guid.NewGuid()]));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Client, none, [terms.Id, privacy.Id]));

        // What was accepted before counts and is not recorded twice.
        var before = new HashSet<Guid> { terms.Id };
        CollectionAssert.AreEquivalent(
            new[] { privacy, health },
            LegalAcceptanceRule.Check(current, LegalAudience.Client, before, [privacy.Id, health.Id])!.ToArray());
        CollectionAssert.AreEquivalent(
            new[] { privacy, health },
            LegalAcceptanceRule.Check(current, LegalAudience.Client, before, [terms.Id, privacy.Id, health.Id])!.ToArray());
        Assert.IsEmpty(LegalAcceptanceRule.Check(
            current,
            LegalAudience.Coach,
            new HashSet<Guid> { termsArabic.Id, privacy.Id },
            null)!);
    }

    private static CurrentLegalDocument Current(LegalDocumentKind kind, LegalConsentContext context, string culture) =>
        new(Guid.NewGuid(), kind, context, culture);
}
