namespace TB.Gym.Modules.Messaging;

/// <summary>Why a proposed message body was refused.</summary>
public enum MessageContentFailure
{
    Empty = 1,
    TooLong = 2,
    InvalidCharacter = 3,
}

/// <summary>
/// The one definition of what a message body is.
/// </summary>
/// <remarks>
/// A message is plain text and nothing else. There is no HTML, no Markdown, no linkification, no
/// attachment, no embed and no template a caller can influence, so there is no rendering step in
/// which a body could become markup. Angular interpolates it as text for the same reason.
/// <para>
/// Normalization happens once, here, and the normalized form is what is stored, what an idempotency
/// key is bound to, and what a length limit is measured against. Normalizing in two places is how a
/// retry that should have been recognised as identical ends up written twice.
/// </para>
/// </remarks>
public static class MessageContentPolicy
{
    /// <summary>
    /// Measured in .NET characters after normalization. A UTF-16 length of 2 000 is at most 2 000
    /// Unicode code points, which is what PostgreSQL's <c>varchar(2000)</c> counts, so a body that
    /// passes here always fits the column.
    /// </summary>
    public const int MaximumLength = 2_000;

    /// <summary>A moderation reason is retained for audit, so it is bounded and required.</summary>
    public const int MaximumModerationReasonLength = 500;

    /// <summary>How much of a body a conversation-list preview may carry.</summary>
    public const int PreviewLength = 160;

    /// <summary>
    /// Normalizes and validates a body: CRLF and CR become LF, outer whitespace is trimmed, and a
    /// blank or control-bearing body is refused. LF and TAB are the only control characters a person
    /// can reasonably have meant to type.
    /// </summary>
    public static bool TryNormalize(
        string? value,
        out string normalized,
        out MessageContentFailure failure)
    {
        normalized = string.Empty;
        failure = MessageContentFailure.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var candidate = value.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Trim();
        if (candidate.Length == 0)
        {
            failure = MessageContentFailure.Empty;
            return false;
        }

        if (!IsWellFormedText(candidate))
        {
            failure = MessageContentFailure.InvalidCharacter;
            return false;
        }

        if (candidate.Length > MaximumLength)
        {
            failure = MessageContentFailure.TooLong;
            return false;
        }

        normalized = candidate;
        return true;
    }

    /// <summary>
    /// Normalizes a moderation reason. It is required, because a removal somebody cannot explain is
    /// indistinguishable from one nobody can justify, and it is bounded because it is retained.
    /// </summary>
    public static bool TryNormalizeModerationReason(
        string? value,
        out string normalized,
        out MessageContentFailure failure)
    {
        normalized = string.Empty;
        failure = MessageContentFailure.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var candidate = value.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Trim();
        if (candidate.Length == 0)
        {
            failure = MessageContentFailure.Empty;
            return false;
        }

        if (!IsWellFormedText(candidate))
        {
            failure = MessageContentFailure.InvalidCharacter;
            return false;
        }

        if (candidate.Length > MaximumModerationReasonLength)
        {
            failure = MessageContentFailure.TooLong;
            return false;
        }

        normalized = candidate;
        return true;
    }

    /// <summary>
    /// A bounded preview of an already normalized body, cut on a character boundary rather than in
    /// the middle of a surrogate pair, which would produce a string PostgreSQL and the browser both
    /// refuse to render.
    /// </summary>
    public static string Preview(string body)
    {
        if (body.Length <= PreviewLength)
        {
            return body;
        }

        var cut = PreviewLength;
        if (char.IsHighSurrogate(body[cut - 1]))
        {
            cut -= 1;
        }

        return body[..cut];
    }

    /// <summary>
    /// Rejects control characters other than LF and TAB, and any unpaired surrogate. An unpaired
    /// surrogate is not encodable as UTF-8, so it would fail at the database rather than at the
    /// boundary where the caller can be told which field was wrong.
    /// </summary>
    private static bool IsWellFormedText(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character is '\n' or '\t')
            {
                continue;
            }

            if (char.IsControl(character))
            {
                return false;
            }

            if (char.IsHighSurrogate(character))
            {
                if (index + 1 >= value.Length || !char.IsLowSurrogate(value[index + 1]))
                {
                    return false;
                }

                index++;
                continue;
            }

            if (char.IsLowSurrogate(character))
            {
                return false;
            }
        }

        return true;
    }
}
