using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}

public interface IWhatsAppSender
{
    Task SendAsync(WhatsAppMessage message, CancellationToken cancellationToken);
}

public interface IBackgroundJobScheduler
{
    Task EnqueueAsync(string jobName, string payload, DateTimeOffset? runAtUtc, CancellationToken cancellationToken);
}

public sealed record EmailMessage(string Recipient, string Subject, string TextBody, string? HtmlBody);

public sealed record WhatsAppMessage(string Recipient, string TemplateKey, IReadOnlyDictionary<string, string> Parameters);

public sealed class NotificationsModule : IModuleMarker
{
    public const string Name = "Notifications";
}
