using System.Net.Mail;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Sends one plain test message through the configured provider, so an operator can prove email works
/// before the first coach signs up.
/// </summary>
/// <remarks>
/// <code>
/// dotnet TB.Gym.Api.dll send-test-email you@example.com
/// </code>
/// It goes straight to the provider: nothing is queued, stored or suppressed, and no account or
/// workspace is involved. The same startup validation the API runs decides whether it may try, and a
/// refusal is explained in words rather than as a status code.
/// </remarks>
public static class SendTestEmailCommand
{
    public const string Name = "send-test-email";

    public static bool IsInvocation(IReadOnlyList<string> args) =>
        args.Count > 0 && string.Equals(args[0], Name, StringComparison.Ordinal);

    /// <returns>0 when the provider accepted the message, 1 when it refused, 2 for a usage or setup problem.</returns>
    public static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyList<string> args,
        TextWriter output,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);
        if (args.Count != 2 || !TryReadAddress(args[1], out var recipient))
        {
            await output.WriteLineAsync($"Usage: {Name} <email address>");
            return 2;
        }

        NotificationEmailOptions email;
        try
        {
            email = services.GetRequiredService<IOptions<NotificationEmailOptions>>().Value;
        }
        catch (OptionsValidationException exception)
        {
            await output.WriteLineAsync("The email settings are not valid: " + string.Join(" ", exception.Failures));
            return 2;
        }

        if (!email.UsesProviderAdapter)
        {
            await output.WriteLineAsync(
                $"Email is not set up: {NotificationEmailOptions.SectionName}:Adapter is '{email.Adapter}'. " +
                "Set TB_GYM_EMAIL_ADAPTER=Resend and the other TB_GYM_EMAIL_ values, then restart.");
            return 2;
        }

        var publicOrigin = services.GetRequiredService<IConfiguration>()["Application:PublicBaseUrl"];
        var body =
            "This is a test email from TB Gym.\n\n" +
            $"If you can read it, this deployment ({publicOrigin}) can send email.\n" +
            (string.IsNullOrWhiteSpace(email.Provider.ReplyToAddress)
                ? "No support address is set, so replies go to the sending address.\n"
                : $"Replying to it should reach {email.Provider.ReplyToAddress.Trim()}.\n");
        var result = await ResendEmailExchange.SendAsync(
            services.GetRequiredService<IHttpClientFactory>(),
            email.Provider,
            new ResendEmailRequest($"test-email-{Guid.NewGuid():N}", recipient, "TB Gym test email", body),
            cancellationToken);

        if (result.IsAccepted)
        {
            await output.WriteLineAsync(
                $"Sent. Resend accepted the message (id {result.ProviderMessageId}). Check the inbox of " +
                $"{recipient}, and the spam folder.");
            if (!email.Enabled)
            {
                await output.WriteLineAsync(
                    $"Note: {NotificationEmailOptions.SectionName}:Enabled is false, so notification email " +
                    "stays off until TB_GYM_EMAIL_ENABLED=true.");
            }

            return 0;
        }

        await output.WriteLineAsync(result.Failure switch
        {
            ResendFailureKind.Unauthorized =>
                "Resend refused the API key or the sender. Check TB_GYM_EMAIL_API_KEY, and that the " +
                "domain in TB_GYM_EMAIL_FROM is verified in Resend.",
            ResendFailureKind.RateLimited => "Resend is rate limiting this account. Wait a minute and try again.",
            ResendFailureKind.Timeout or ResendFailureKind.Unavailable =>
                "Could not reach Resend. Check the server's internet access and try again.",
            ResendFailureKind.Rejected =>
                $"Resend rejected the message (status {result.StatusCode}). Check the recipient and the " +
                "format of TB_GYM_EMAIL_FROM, for example: TB Gym <notifications@mail.example.com>.",
            _ => $"Resend did not accept the message ({result.Failure}, status {result.StatusCode}).",
        });
        return 1;
    }

    private static bool TryReadAddress(string value, out string address)
    {
        address = value.Trim();
        try
        {
            var parsed = new MailAddress(address);
            return string.Equals(parsed.Address, address, StringComparison.OrdinalIgnoreCase);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
