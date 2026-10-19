using System.Globalization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Website;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Receives a Talk-to-us request (UI plan R6.2g): the honeypot, the form stamp, the field rules, then
/// one row. The owner's email is the sweep's job, so the visitor waits for nothing but the insert.
/// </summary>
/// <remarks>
/// A log line names the request id and a code, never the person's name, contact or words; those
/// exist in the row and in the owner's email, and nowhere else.
/// </remarks>
internal sealed class ContactRequestApplicationService(
    GymDbContext context,
    IContactFormStamps stamps,
    IClock clock,
    ILogger<ContactRequestApplicationService> logger)
    : IContactRequestApplicationService
{
    private static readonly Action<ILogger, Guid, Exception?> LogReceived =
        LoggerMessage.Define<Guid>(
            LogLevel.Information,
            new EventId(6181, "ContactRequestReceived"),
            "Contact request {RequestId} received from the website.");

    private static readonly Action<ILogger, string, Exception?> LogRefused =
        LoggerMessage.Define<string>(
            LogLevel.Information,
            new EventId(6182, "ContactRequestRefused"),
            "A contact request was refused: {Reason}.");

    public async Task<ContactRequestSubmissionResult> SubmitAsync(
        ContactRequestSubmission submission,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(submission);

        if (ContactRequestRules.IsDecoy(submission))
        {
            LogRefused(logger, "honeypot", null);
            return new ContactRequestSubmissionResult(ContactRequestSubmissionStatus.Dropped);
        }

        var validation = ContactRequestRules.Validate(submission);
        if (!validation.IsValid)
        {
            LogRefused(logger, "validation", null);
            return new ContactRequestSubmissionResult(ContactRequestSubmissionStatus.Invalid, Errors: validation.Errors);
        }

        var now = clock.UtcNow;
        switch (stamps.Check(submission.FormStamp, now))
        {
            case ContactFormStampCheck.TooFast:
                LogRefused(logger, "too-fast", null);
                return new ContactRequestSubmissionResult(ContactRequestSubmissionStatus.TooFast);
            case ContactFormStampCheck.Invalid:
                LogRefused(logger, "stamp-invalid", null);
                return new ContactRequestSubmissionResult(ContactRequestSubmissionStatus.StampInvalid);
        }

        var request = ContactRequest.Receive(validation.Facts!, now);
        context.ContactRequests.Add(request);
        await context.SaveChangesAsync(cancellationToken);
        LogReceived(logger, request.Id, null);
        return new ContactRequestSubmissionResult(ContactRequestSubmissionStatus.Accepted, request.Id);
    }
}

/// <summary>
/// The platform admin's list of requests whose email has not gone out (audit BEB-1): newest first,
/// waiting ones and dead-lettered ones alike, so nothing a gym wrote is only in a table nobody reads.
/// </summary>
internal sealed class ContactRequestAdminReader(GymDbContext context) : IContactRequestAdminReader
{
    public async Task<IReadOnlyList<ContactRequestAdminView>> ListUnsentAsync(CancellationToken cancellationToken) =>
        await context.ContactRequests
            .AsNoTracking()
            .Where(item => item.Status != ContactRequestMailStatus.Materialized)
            .OrderByDescending(item => item.ReceivedAtUtc)
            .ThenByDescending(item => item.Id)
            .Take(ContactRequestAdminLimits.ListSize)
            .Select(item => new ContactRequestAdminView(
                item.Id,
                item.Name,
                item.GymName,
                item.Contact,
                item.ContactKind,
                item.Message,
                item.ReceivedAtUtc,
                item.Status == ContactRequestMailStatus.DeadLettered,
                item.Status == ContactRequestMailStatus.Processing,
                item.AttemptCount))
            .ToListAsync(cancellationToken);
}

/// <summary>
/// The form stamp: the instant the form came into view, protected so only this deployment can read
/// it back. A stamp is a time and nothing else, so it identifies nobody.
/// </summary>
internal sealed class ContactFormStampService(IDataProtectionProvider dataProtection, IClock clock)
    : IContactFormStamps
{
    private const string Purpose = "TB.Gym.Website.ContactForm.v1";

    private readonly IDataProtector protector = dataProtection.CreateProtector(Purpose);

    public string Issue(DateTimeOffset now) =>
        protector.Protect(now.UtcTicks.ToString(CultureInfo.InvariantCulture));

    public ContactFormStampCheck Check(string? stamp, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(stamp) || stamp.Length > 512)
        {
            return ContactFormStampCheck.Invalid;
        }

        long ticks;
        try
        {
            if (!long.TryParse(protector.Unprotect(stamp), NumberStyles.None, CultureInfo.InvariantCulture, out ticks))
            {
                return ContactFormStampCheck.Invalid;
            }
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return ContactFormStampCheck.Invalid;
        }

        var issued = new DateTimeOffset(ticks, TimeSpan.Zero);
        var age = now - issued;
        // A stamp from the future is a forged or replayed one; a day-old stamp is a captured one.
        if (age < -TimeSpan.FromMinutes(1) || age > ContactRequestRules.MaximumStampAge)
        {
            return ContactFormStampCheck.Invalid;
        }

        return age < ContactRequestRules.MinimumFormTime
            ? ContactFormStampCheck.TooFast
            : ContactFormStampCheck.Valid;
    }

    /// <summary>For the development stamp in tests: the clock the service measures against.</summary>
    internal DateTimeOffset Now => clock.UtcNow;
}

/// <summary>What the homepage may know of the deployment's settings, and nothing more.</summary>
internal sealed class WebsiteSettingsReader(IOptions<WebsiteOptions> options) : IWebsiteSettingsReader
{
    public WebsiteSettingsView Read()
    {
        var website = options.Value;
        return new WebsiteSettingsView(
            string.IsNullOrWhiteSpace(website.WhatsAppNumber) ? null : website.WhatsAppNumber.Trim(),
            new WebsiteAnalyticsView(
                string.IsNullOrWhiteSpace(website.Analytics.Script) ? null : website.Analytics.Script.Trim()));
    }
}
