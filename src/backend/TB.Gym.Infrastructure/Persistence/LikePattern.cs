namespace TB.Gym.Infrastructure.Persistence;

/// <summary>
/// A search box's words as an <c>ILIKE</c> pattern that matches them literally (audit SEC-10): typed
/// as they were, "%" and "_" are wildcards, so "%" matched every exercise, food and recipe.
/// </summary>
internal static class LikePattern
{
    /// <summary>Passed to <c>EF.Functions.ILike</c> with every pattern built here.</summary>
    public const string EscapeCharacter = "\\";

    /// <summary>Rows whose text contains <paramref name="words"/> anywhere, wildcards taken literally.</summary>
    public static string Containing(string words) =>
        $"%{Escape(words.Trim())}%";

    internal static string Escape(string words) =>
        words
            .Replace(EscapeCharacter, EscapeCharacter + EscapeCharacter, StringComparison.Ordinal)
            .Replace("%", EscapeCharacter + "%", StringComparison.Ordinal)
            .Replace("_", EscapeCharacter + "_", StringComparison.Ordinal);
}
