namespace TB.Gym.Modules.Website;

/// <summary>
/// What the Talk-to-us form posts. <see cref="Website"/> is the honeypot: a field no person sees.
/// <see cref="FormStamp"/> is the server-signed stamp the page fetched when the form came into view.
/// </summary>
public sealed record ContactRequestSubmission(
    string? Name,
    string? GymName,
    string? Contact,
    string? Message,
    string? Website,
    string? FormStamp);

/// <summary>The stamp the form carries back, issued when the form came into view.</summary>
public sealed record ContactFormStampView(string Stamp);

/// <summary>
/// The public website's settings: a WhatsApp number to write to (none until the owner gives one) and
/// the analytics script to load from this origin (none until the owner has an account).
/// </summary>
public sealed record WebsiteSettingsView(string? WhatsAppNumber, WebsiteAnalyticsView Analytics);

/// <summary>The name of Plausible's site script, <c>pa-….js</c>, served through this origin; null when analytics is off.</summary>
public sealed record WebsiteAnalyticsView(string? Script);

public enum ContactRequestSubmissionStatus
{
    /// <summary>Stored, and the owner's email is queued.</summary>
    Accepted = 1,

    /// <summary>The honeypot was filled: answered as accepted, kept nowhere.</summary>
    Dropped = 2,

    /// <summary>A field is missing or malformed; <see cref="ContactRequestSubmissionResult.Errors"/> says which.</summary>
    Invalid = 3,

    /// <summary>Sent sooner after the form appeared than a person could; the page may wait and try again.</summary>
    TooFast = 4,

    /// <summary>The form stamp is missing, forged or older than a day; the page fetches a new one.</summary>
    StampInvalid = 5,
}

public sealed record ContactRequestSubmissionResult(
    ContactRequestSubmissionStatus Status,
    Guid? RequestId = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public interface IContactRequestApplicationService
{
    Task<ContactRequestSubmissionResult> SubmitAsync(
        ContactRequestSubmission submission,
        CancellationToken cancellationToken);
}

/// <summary>Issues and checks the form stamp behind the minimum-time rule (WEB-002).</summary>
public interface IContactFormStamps
{
    string Issue(DateTimeOffset now);

    ContactFormStampCheck Check(string? stamp, DateTimeOffset now);
}

public enum ContactFormStampCheck
{
    Valid = 1,
    TooFast = 2,
    Invalid = 3,
}

public interface IWebsiteSettingsReader
{
    WebsiteSettingsView Read();
}

/// <summary>Drains the contact-request queue: the Worker sweeps it; tests call it directly.</summary>
public interface IContactRequestMailDispatchService
{
    Task<ContactRequestMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken);
}

public sealed record ContactRequestMailDispatchOutcome(
    int Claimed = 0,
    int Materialized = 0,
    int Retried = 0,
    int DeadLettered = 0,
    int Reclaimed = 0)
{
    public int Total => Materialized + Retried + DeadLettered + Reclaimed;

    public ContactRequestMailDispatchOutcome Add(ContactRequestMailDispatchOutcome other) =>
        new(
            Claimed + other.Claimed,
            Materialized + other.Materialized,
            Retried + other.Retried,
            DeadLettered + other.DeadLettered,
            Reclaimed + other.Reclaimed);
}

/// <summary>One rendered email to the owner. In memory only, for the duration of one transport call.</summary>
public sealed record ContactRequestEmailContent(string TemplateKey, int TemplateVersion, string Subject, string Body);

/// <summary>
/// The owner's email about a request: the facts, in plain text, and nothing else. It is the only
/// place the person's name, contact and words travel; no log line or notification row carries them.
/// </summary>
public static class ContactRequestEmailTemplate
{
    public const int CurrentVersion = 1;

    public const string Key = "website.contact-request";

    public static ContactRequestEmailContent Render(ContactRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var reach = request.ContactKind == ContactKind.WhatsApp ? "WhatsApp" : "Email";
        var body = string.Concat(
            "A gym wrote to TB Gym from the homepage.\n\n",
            $"Name: {request.Name}\n",
            $"Gym: {request.GymName}\n",
            $"{reach}: {request.Contact}\n",
            $"Received: {request.ReceivedAtUtc:yyyy-MM-dd HH:mm} UTC\n\n",
            "About the gym:\n",
            request.Message is null ? "(nothing written)\n" : request.Message + "\n",
            "\n",
            $"Reply to them directly. TB Gym keeps this request under {request.Id}.\n");
        return new ContactRequestEmailContent(
            Key,
            CurrentVersion,
            $"Talk to us: {request.GymName} ({request.Name})",
            body);
    }
}
