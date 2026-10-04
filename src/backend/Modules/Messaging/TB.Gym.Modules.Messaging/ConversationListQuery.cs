using System.Globalization;
using System.Text;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// What a conversation list is narrowed to (MSG-022): a filter, and a search on the other
/// participant's display name.
/// </summary>
/// <remarks>
/// The search reads the one thing a list row already shows about the other person, their name, and
/// never a message: searching bodies would be a second way into conversations, with its own index and
/// its own rules, and is not part of this slice. Each word typed must appear in the name, ignoring
/// case and accents, so "elie kh" finds "Élie Khoury".
/// </remarks>
public sealed class ConversationListQuery
{
    public const int MaximumSearchLength = 100;

    public static readonly ConversationListQuery Everything = new(ConversationListFilter.All, []);

    private ConversationListQuery(ConversationListFilter filter, string[] terms)
    {
        Filter = filter;
        Terms = terms;
    }

    public ConversationListFilter Filter { get; }

    /// <summary>The words of the search, folded; empty when nothing was typed.</summary>
    public IReadOnlyList<string> Terms { get; }

    /// <summary>Whether this is the plain list, which pages straight from the index.</summary>
    public bool IsEverything => Filter == ConversationListFilter.All && Terms.Count == 0;

    /// <summary>The query, or null when the search is too long or the filter is not one of ours.</summary>
    public static ConversationListQuery? TryCreate(string? search, ConversationListFilter? filter)
    {
        var chosen = filter ?? ConversationListFilter.All;
        if (!Enum.IsDefined(chosen) || search is { Length: > MaximumSearchLength })
        {
            return null;
        }

        var terms = Fold(search ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return chosen == ConversationListFilter.All && terms.Length == 0
            ? Everything
            : new ConversationListQuery(chosen, terms);
    }

    /// <summary>Whether a conversation in this state, with this counterpart, belongs in the list.</summary>
    public bool Matches(string counterpartName, bool hasUnread, bool isAwaitingReply)
    {
        var inFilter = Filter switch
        {
            ConversationListFilter.Unread => hasUnread,
            ConversationListFilter.AwaitingReply => isAwaitingReply,
            _ => true,
        };
        if (!inFilter || Terms.Count == 0)
        {
            return inFilter;
        }

        var name = Fold(counterpartName);
        return Terms.All(term => name.Contains(term, StringComparison.Ordinal));
    }

    /// <summary>
    /// Lower case with the marks taken off, so accents and Arabic vowel signs never decide a match.
    /// </summary>
    public static string Fold(string text)
    {
        var decomposed = text.Normalize(NormalizationForm.FormD);
        var folded = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category is not (UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark
                or UnicodeCategory.EnclosingMark))
            {
                folded.Append(character);
            }
        }

        return folded.ToString().Normalize(NormalizationForm.FormC).ToLowerInvariant();
    }
}
