using System.Net.Mail;
using System.Text;

namespace TB.Gym.Modules.Website;

/// <summary>The checked, normalized content of one Talk-to-us request.</summary>
public sealed record ContactRequestFacts(
    string Name,
    string GymName,
    string Contact,
    ContactKind ContactKind,
    string? Message);

/// <summary>What became of a submission once the rules read it.</summary>
public sealed record ContactRequestValidation(
    ContactRequestFacts? Facts,
    IReadOnlyDictionary<string, string[]> Errors)
{
    public bool IsValid => Facts is not null && Errors.Count == 0;
}

/// <summary>
/// The rules a Talk-to-us request has to meet (WEB-001, WEB-002), in one place so the API, the
/// domain tests and the email agree on what a request is.
/// </summary>
/// <remarks>
/// The person is asked for four things: their name, their gym, one way to reach them (an email
/// address or a WhatsApp number, in one field, because asking which is one question too many) and a
/// line about the gym, which may stay empty. Everything is trimmed, runs of whitespace are folded
/// and control characters are dropped, so what the owner reads is what was meant and a line of text
/// cannot carry a stray character into a mail body.
/// <para>
/// Two cheap bot filters sit beside the field rules. The honeypot is a field a person never sees
/// and never fills; a submission that fills it is accepted on the wire and kept nowhere. The
/// minimum time is the least a person could plausibly take between opening the form and sending it,
/// measured by a server-signed stamp the page asks for; a submission faster than that is refused
/// with a code the page can act on by waiting and trying again.
/// </para>
/// </remarks>
public static class ContactRequestRules
{
    public const int NameMaxLength = 120;

    public const int GymNameMaxLength = 160;

    public const int ContactMaxLength = 200;

    public const int MessageMaxLength = 1000;

    /// <summary>The largest body the form's route reads (audit BEB-3): far above any form a person can send.</summary>
    public const long MaximumRequestBytes = 16 * 1024;

    /// <summary>The least time between the form's stamp and its submission that counts as a person.</summary>
    public static readonly TimeSpan MinimumFormTime = TimeSpan.FromSeconds(3);

    /// <summary>A stamp older than this is refused, so a captured stamp is not a key that works forever.</summary>
    public static readonly TimeSpan MaximumStampAge = TimeSpan.FromHours(24);

    /// <summary>A submission whose honeypot holds anything is not from a person.</summary>
    public static bool IsDecoy(ContactRequestSubmission submission)
    {
        ArgumentNullException.ThrowIfNull(submission);
        return !string.IsNullOrWhiteSpace(submission.Website);
    }

    public static ContactRequestValidation Validate(ContactRequestSubmission submission)
    {
        ArgumentNullException.ThrowIfNull(submission);
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);

        var name = FoldWhitespace(submission.Name);
        if (name.Length == 0)
        {
            errors["name"] = ["Enter your name."];
        }
        else if (name.Length > NameMaxLength)
        {
            errors["name"] = [$"Use {NameMaxLength} characters or fewer for your name."];
        }

        var gymName = FoldWhitespace(submission.GymName);
        if (gymName.Length == 0)
        {
            errors["gymName"] = ["Enter the name of your gym."];
        }
        else if (gymName.Length > GymNameMaxLength)
        {
            errors["gymName"] = [$"Use {GymNameMaxLength} characters or fewer for the gym's name."];
        }

        var contact = ReadContact(submission.Contact);
        if (contact is null)
        {
            errors["contact"] = ["Enter an email address or a WhatsApp number we can reach you on."];
        }

        var message = ReadMessage(submission.Message);
        if (message is { Length: > MessageMaxLength })
        {
            errors["message"] = [$"Use {MessageMaxLength} characters or fewer."];
        }

        if (errors.Count > 0)
        {
            return new ContactRequestValidation(null, errors);
        }

        return new ContactRequestValidation(
            new ContactRequestFacts(name, gymName, contact!.Value.Contact, contact.Value.Kind, message),
            errors);
    }

    /// <summary>
    /// An email address or a phone number, from one field. Anything with an @ is read as an address;
    /// otherwise the digits, with an optional leading +, are read as a WhatsApp number.
    /// </summary>
    public static (string Contact, ContactKind Kind)? ReadContact(string? value)
    {
        var trimmed = FoldWhitespace(value);
        if (trimmed.Length == 0 || trimmed.Length > ContactMaxLength)
        {
            return null;
        }

        if (trimmed.Contains('@'))
        {
            try
            {
                var parsed = new MailAddress(trimmed);
                return string.Equals(parsed.Address, trimmed, StringComparison.OrdinalIgnoreCase)
                    ? (parsed.Address, ContactKind.Email)
                    : null;
            }
            catch (FormatException)
            {
                return null;
            }
        }

        var digits = new StringBuilder();
        foreach (var character in trimmed)
        {
            if (char.IsAsciiDigit(character))
            {
                digits.Append(character);
            }
            else if (character == '+' && digits.Length == 0 && !trimmed.StartsWith("00", StringComparison.Ordinal))
            {
                digits.Append('+');
            }
            else if (character is not (' ' or '-' or '.' or '(' or ')'))
            {
                return null;
            }
        }

        var number = digits.ToString();
        var count = number.StartsWith('+') ? number.Length - 1 : number.Length;
        if (count is < 7 or > 15 || (number.StartsWith('+') && number.Length == 1))
        {
            return null;
        }

        return (number, ContactKind.WhatsApp);
    }

    /// <summary>Line breaks kept, other control characters dropped, blank when nothing was written.</summary>
    public static string? ReadMessage(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var text = new StringBuilder(value.Length);
        foreach (var character in value.Replace("\r\n", "\n", StringComparison.Ordinal))
        {
            if (character == '\n' || character == '\t' || !char.IsControl(character))
            {
                text.Append(character);
            }
        }

        var trimmed = text.ToString().Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static string FoldWhitespace(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var text = new StringBuilder(value.Length);
        var pendingSpace = false;
        foreach (var character in value)
        {
            if (char.IsWhiteSpace(character) || char.IsControl(character))
            {
                pendingSpace = text.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                text.Append(' ');
                pendingSpace = false;
            }

            text.Append(character);
        }

        return text.ToString();
    }
}
