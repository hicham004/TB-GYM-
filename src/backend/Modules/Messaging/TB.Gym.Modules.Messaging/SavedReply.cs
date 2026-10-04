using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// A coach's own short reply, kept to drop into the composer (MSG-023, R3.5c).
/// </summary>
/// <remarks>
/// It belongs to one Owner or Coach in one workspace and nobody else reads it, the workspace owner
/// included: it is a coach's own wording. It never sends anything. Choosing one puts its text in the
/// composer, where the coach may change it, and what is sent is an ordinary message under MSG-004 to
/// MSG-006. So the body follows the message rules exactly and has no placeholder that fills itself
/// in: a template the server completed would be text the coach never saw.
/// </remarks>
public sealed class SavedReply : TenantEntity
{
    private SavedReply()
    {
    }

    private SavedReply(Guid tenantId, Guid ownerUserId, SavedReplyText text)
        : base(tenantId)
    {
        if (ownerUserId == Guid.Empty)
        {
            throw new ArgumentException("A saved reply needs its owner.", nameof(ownerUserId));
        }

        OwnerUserId = ownerUserId;
        Title = text.Title;
        Body = text.Body;
    }

    public Guid OwnerUserId { get; private set; }

    public string Title { get; private set; } = string.Empty;

    public string Body { get; private set; } = string.Empty;

    public static SavedReply Create(Guid tenantId, Guid ownerUserId, SavedReplyText text) =>
        new(tenantId, ownerUserId, text);

    public void Change(SavedReplyText text)
    {
        Title = text.Title;
        Body = text.Body;
    }
}

/// <summary>A saved reply's title and body, already normalized and checked.</summary>
public sealed class SavedReplyText
{
    /// <summary>A title names the reply in a list; a phrase, not a paragraph.</summary>
    public const int MaximumTitleLength = 60;

    /// <summary>How many replies one person keeps in one workspace.</summary>
    public const int MaximumPerOwner = 100;

    private SavedReplyText(string title, string body)
    {
        Title = title;
        Body = body;
    }

    public string Title { get; }

    public string Body { get; }

    /// <summary>
    /// The title trimmed with its inner whitespace collapsed to single spaces, at most
    /// <see cref="MaximumTitleLength"/> characters, with no control character; the body exactly as a
    /// message body is normalized (MSG-004). Returns the field and the reason when either is refused.
    /// </summary>
    public static bool TryCreate(
        string? title,
        string? body,
        out SavedReplyText text,
        out string field,
        out string problem)
    {
        text = new SavedReplyText(string.Empty, string.Empty);
        field = string.Empty;
        problem = string.Empty;

        var normalizedTitle = string.Join(
            ' ',
            (title ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (normalizedTitle.Length == 0)
        {
            (field, problem) = ("title", "Give the reply a short title.");
            return false;
        }

        if (normalizedTitle.Any(char.IsControl))
        {
            (field, problem) = ("title", "A title cannot contain control characters.");
            return false;
        }

        if (normalizedTitle.Length > MaximumTitleLength)
        {
            (field, problem) = ("title", $"A title can be at most {MaximumTitleLength} characters.");
            return false;
        }

        if (!MessageContentPolicy.TryNormalize(body, out var normalizedBody, out var failure))
        {
            (field, problem) = ("body", failure switch
            {
                MessageContentFailure.TooLong =>
                    $"A reply can be at most {MessageContentPolicy.MaximumLength} characters.",
                MessageContentFailure.InvalidCharacter => "A reply cannot contain control characters.",
                _ => "Write the reply's text.",
            });
            return false;
        }

        text = new SavedReplyText(normalizedTitle, normalizedBody);
        return true;
    }
}
