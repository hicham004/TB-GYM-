using System.Globalization;
using System.Text;

namespace TB.Gym.Modules.Media;

/// <summary>
/// Reads a YouTube or Vimeo video's own title from its provider (critique B9, MED-015). It is asked once, when a
/// link is added, never while a page reads the library, and its answer is the provider's text: untrusted until
/// <see cref="ExternalVideoTitle.Clean"/> has read it.
/// </summary>
public interface IExternalVideoTitles
{
    /// <returns>The title as the provider gives it, or null when the provider cannot say just now.</returns>
    Task<string?> FindAsync(
        ExternalMediaProvider provider,
        string externalMediaId,
        CancellationToken cancellationToken);
}

/// <summary>A provider's title made fit to show: one line, no control characters, at most 200 characters.</summary>
public static class ExternalVideoTitle
{
    public const int MaximumLength = 200;

    /// <summary>
    /// The title as the library shows it, or null when nothing is left. Control characters go, and so do the
    /// marks that override or isolate a line's direction, which could make a title read as something else;
    /// runs of spaces and line breaks become one space. A longer title is cut between characters and ends "…".
    /// </summary>
    public static string? Clean(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var cleaned = new StringBuilder(text.Length);
        var space = false;
        foreach (var character in text)
        {
            if (char.IsWhiteSpace(character))
            {
                space = cleaned.Length > 0;
                continue;
            }

            if (char.IsControl(character) || IsDirectionOverride(character))
            {
                continue;
            }

            if (space)
            {
                cleaned.Append(' ');
                space = false;
            }

            cleaned.Append(character);
        }

        var title = cleaned.ToString();
        if (title.Length == 0)
        {
            return null;
        }

        if (title.Length <= MaximumLength)
        {
            return title;
        }

        // Whole characters only, so an emoji or an accented letter is never cut in two.
        var kept = new StringBuilder(MaximumLength);
        var elements = StringInfo.GetTextElementEnumerator(title);
        while (elements.MoveNext())
        {
            var element = elements.GetTextElement();
            if (kept.Length + element.Length > MaximumLength - 1)
            {
                break;
            }

            kept.Append(element);
        }

        return kept.ToString().TrimEnd() + "…";
    }

    private static bool IsDirectionOverride(char character) =>
        character is >= '‪' and <= '‮' or >= '⁦' and <= '⁩';
}
