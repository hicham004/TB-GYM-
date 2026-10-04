using TB.Gym.Modules.Messaging;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The coach's inbox filters and name search (MSG-022): every word typed must be in the other
/// person's name, ignoring case and accents, and a filter keeps only what it names.
/// </summary>
[TestClass]
public sealed class ConversationListQueryDomainTests
{
    [TestMethod]
    public void NothingTypedAndNoFilterIsThePlainList()
    {
        Assert.AreSame(ConversationListQuery.Everything, ConversationListQuery.TryCreate(null, null));
        Assert.AreSame(ConversationListQuery.Everything, ConversationListQuery.TryCreate("   ", ConversationListFilter.All));
        Assert.IsTrue(ConversationListQuery.Everything.IsEverything);
        Assert.IsFalse(Query("maya").IsEverything);
        Assert.IsFalse(Query(null, ConversationListFilter.Unread).IsEverything);
    }

    [TestMethod]
    [DataRow("maya", true)]
    [DataRow("MAYA rah", true)]
    [DataRow("  rahman   maya ", true)]
    [DataRow("maya k", false)]
    [DataRow("ahma", true)]
    public void EveryWordTypedMustBeInTheName(string search, bool expected) =>
        Assert.AreEqual(expected, Query(search).Matches("Maya Rahman", hasUnread: false, isAwaitingReply: false));

    [TestMethod]
    public void AccentsAndArabicVowelSignsNeverDecideAMatch()
    {
        Assert.IsTrue(Query("elie kh").Matches("Élie Khoury", false, false));
        Assert.IsTrue(Query("ÉLIE").Matches("Elie Khoury", false, false));
        Assert.IsTrue(Query("zoe").Matches("Zoë Haddad", false, false));
        // "محمد" written with and without its vowel signs is the same name.
        Assert.IsTrue(Query("محمد").Matches("مُحَمَّد نصر", false, false));
        Assert.AreEqual("eleve", ConversationListQuery.Fold("Élève"));
    }

    [TestMethod]
    public void AFilterKeepsOnlyWhatItNames()
    {
        var unread = Query(null, ConversationListFilter.Unread);
        Assert.IsTrue(unread.Matches("Maya Rahman", hasUnread: true, isAwaitingReply: false));
        Assert.IsFalse(unread.Matches("Maya Rahman", hasUnread: false, isAwaitingReply: true));

        var waiting = Query(null, ConversationListFilter.AwaitingReply);
        Assert.IsTrue(waiting.Matches("Maya Rahman", hasUnread: false, isAwaitingReply: true));
        Assert.IsFalse(waiting.Matches("Maya Rahman", hasUnread: true, isAwaitingReply: false));

        // A filter and a search together: both must hold.
        var both = Query("omar", ConversationListFilter.AwaitingReply);
        Assert.IsTrue(both.Matches("Omar Nasser", false, true));
        Assert.IsFalse(both.Matches("Maya Rahman", false, true));
        Assert.IsFalse(both.Matches("Omar Nasser", true, false));
    }

    [TestMethod]
    public void ATooLongSearchOrAnUnknownFilterIsRefused()
    {
        Assert.IsNotNull(ConversationListQuery.TryCreate(new string('a', ConversationListQuery.MaximumSearchLength), null));
        Assert.IsNull(ConversationListQuery.TryCreate(new string('a', ConversationListQuery.MaximumSearchLength + 1), null));
        Assert.IsNull(ConversationListQuery.TryCreate(null, (ConversationListFilter)7));
        Assert.IsNull(ConversationListQuery.TryCreate(null, (ConversationListFilter)0));
    }

    private static ConversationListQuery Query(string? search, ConversationListFilter? filter = null) =>
        ConversationListQuery.TryCreate(search, filter) ?? throw new AssertFailedException("The query was refused.");
}
