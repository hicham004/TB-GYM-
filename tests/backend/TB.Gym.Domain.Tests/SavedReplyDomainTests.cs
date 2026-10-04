using TB.Gym.Modules.Messaging;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// A saved reply's text (MSG-023): a one-line title of at most sixty characters and a body kept
/// exactly as a message body is (MSG-004).
/// </summary>
[TestClass]
public sealed class SavedReplyDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000351");
    private static readonly Guid OwnerId = Guid.Parse("20000000-0000-0000-0000-000000000351");

    [TestMethod]
    public void ATitleIsOneLineAndABodyIsKeptAsAMessageBodyIs()
    {
        Assert.IsTrue(SavedReplyText.TryCreate("  Check-in \t\n reminder ", "  Due today.\r\nFive minutes.\r ", out var text, out _, out _));
        Assert.AreEqual(("Check-in reminder", "Due today.\nFive minutes."), (text.Title, text.Body));

        var reply = SavedReply.Create(TenantId, OwnerId, text);
        Assert.AreEqual((TenantId, OwnerId, "Check-in reminder"), (reply.TenantId, reply.OwnerUserId, reply.Title));

        Assert.IsTrue(SavedReplyText.TryCreate("Deload", "Lighter this week.", out var changed, out _, out _));
        reply.Change(changed);
        Assert.AreEqual(("Deload", "Lighter this week."), (reply.Title, reply.Body));
    }

    [TestMethod]
    [DataRow(null, "Hello", "title")]
    [DataRow("   ", "Hello", "title")]
    [DataRow("Bell\u0007", "Hello", "title")]
    [DataRow("Fine", null, "body")]
    [DataRow("Fine", " \r\n ", "body")]
    [DataRow("Fine", "Ring\u0007", "body")]
    public void TextTheRulesRefuseNamesItsField(string? title, string? body, string field)
    {
        Assert.IsFalse(SavedReplyText.TryCreate(title, body, out _, out var refused, out var problem));
        Assert.AreEqual(field, refused);
        Assert.IsFalse(string.IsNullOrWhiteSpace(problem));
    }

    [TestMethod]
    public void TheLimitsAreSixtyForATitleAndTheMessageLimitForABody()
    {
        Assert.IsTrue(SavedReplyText.TryCreate(new string('t', SavedReplyText.MaximumTitleLength), "b", out _, out _, out _));
        Assert.IsFalse(SavedReplyText.TryCreate(new string('t', SavedReplyText.MaximumTitleLength + 1), "b", out _, out var title, out _));
        Assert.AreEqual("title", title);
        Assert.IsTrue(SavedReplyText.TryCreate("t", new string('b', MessageContentPolicy.MaximumLength), out _, out _, out _));
        Assert.IsFalse(SavedReplyText.TryCreate("t", new string('b', MessageContentPolicy.MaximumLength + 1), out _, out var body, out _));
        Assert.AreEqual("body", body);
    }

    [TestMethod]
    public void AReplyNeedsItsOwner() =>
        Assert.ThrowsExactly<ArgumentException>(() =>
        {
            Assert.IsTrue(SavedReplyText.TryCreate("t", "b", out var text, out _, out _));
            SavedReply.Create(TenantId, Guid.Empty, text);
        });
}
