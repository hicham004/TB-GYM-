namespace TB.Gym.Infrastructure.Persistence;

/// <summary>
/// A search box's words as an <c>ILIKE</c> pattern that matches them literally (audit SEC-10): typed
/// as they were, "%" and "_" are wildcards, so "%" matched every exercise, food and recipe.
/// </summary>
internal static class LikePattern
{
    /// <summary>Passed to <c>EF.Functions.ILike</c> with every pattern built here.</summary>
    public const string EscapeCharacter = "\\";

    /// <summary>The words of a search box read; any after them are left out.</summary>
    public const int MaximumWords = 8;

    /// <summary>Rows whose text contains <paramref name="words"/> anywhere, wildcards taken literally.</summary>
    public static string Containing(string words) =>
        $"%{Escape(words.Trim())}%";

    /// <summary>
    /// Each word of a search box as a pattern of its own, so a row that holds every word in any order matches:
    /// "chicken rice" finds "Chicken &amp; rice bowl", as the builders' search did in the browser (WEA-14).
    /// </summary>
    public static IReadOnlyList<string> EachWord(string? text) =>
        string.IsNullOrWhiteSpace(text)
            ? []
            : [.. text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Take(MaximumWords).Select(Containing)];

    internal static string Escape(string words) =>
        words
            .Replace(EscapeCharacter, EscapeCharacter + EscapeCharacter, StringComparison.Ordinal)
            .Replace("%", EscapeCharacter + "%", StringComparison.Ordinal)
            .Replace("_", EscapeCharacter + "_", StringComparison.Ordinal);
}
