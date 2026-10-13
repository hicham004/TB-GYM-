using System.Net.Mail;
using System.Text.RegularExpressions;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The public website's deployment settings (UI plan R6.2g): where a Talk-to-us request is emailed,
/// the WhatsApp number the homepage shows beside the form, and the analytics script it loads.
/// </summary>
/// <remarks>
/// Every value is optional and off when empty, because each one waits for something the owner does
/// outside the code: giving a number, opening a Plausible account, choosing the inbox. A missing
/// recipient does not refuse requests: they are stored and the sweep leaves them pending, so the day
/// the address is set they go out. A malformed value refuses startup, because "we never got a single
/// request" is the failure nobody notices.
/// </remarks>
public sealed partial class WebsiteOptions
{
    public const string SectionName = "Website";

    /// <summary>The inbox a Talk-to-us request is emailed to. Empty: requests are kept and nothing is sent.</summary>
    public string ContactRecipient { get; set; } = string.Empty;

    /// <summary>The WhatsApp number in international form (+961…). Empty: the homepage shows no WhatsApp link.</summary>
    public string WhatsAppNumber { get; set; } = string.Empty;

    public WebsiteAnalyticsOptions Analytics { get; set; } = new();

    public bool HasContactRecipient => !string.IsNullOrWhiteSpace(ContactRecipient);

    public string? Validate()
    {
        if (HasContactRecipient)
        {
            var recipient = ContactRecipient.Trim();
            try
            {
                if (!string.Equals(new MailAddress(recipient).Address, recipient, StringComparison.OrdinalIgnoreCase))
                {
                    return $"{SectionName}:ContactRecipient must be a plain email address.";
                }
            }
            catch (FormatException)
            {
                return $"{SectionName}:ContactRecipient must be a plain email address.";
            }
        }

        if (!string.IsNullOrWhiteSpace(WhatsAppNumber) && !InternationalNumber().IsMatch(WhatsAppNumber.Trim()))
        {
            return $"{SectionName}:WhatsAppNumber must be an international number such as +96170123456.";
        }

        if (!string.IsNullOrWhiteSpace(Analytics.Script) && !PlausibleScript().IsMatch(Analytics.Script.Trim()))
        {
            return $"{SectionName}:Analytics:Script must be the file name of Plausible's site script, pa-….js.";
        }

        return null;
    }

    /// <summary>E.164: a plus, then 7 to 15 digits, the first not zero.</summary>
    [GeneratedRegex(@"^\+[1-9][0-9]{6,14}$", RegexOptions.CultureInvariant)]
    private static partial Regex InternationalNumber();

    /// <summary>Plausible names each site's script <c>pa-&lt;id&gt;.js</c>; nginx proxies exactly that shape.</summary>
    [GeneratedRegex(@"^pa-[A-Za-z0-9_-]{1,64}\.js$", RegexOptions.CultureInvariant)]
    private static partial Regex PlausibleScript();
}

public sealed class WebsiteAnalyticsOptions
{
    /// <summary>The file name of Plausible's site script (pa-….js). Empty: no analytics loads.</summary>
    public string Script { get; set; } = string.Empty;
}
