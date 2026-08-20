using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;

namespace TB.Gym.Infrastructure.Application;

internal sealed class AccountEmailSender(
    GymDbContext dbContext,
    IWebHostEnvironment environment,
    IConfiguration configuration)
    : IAccountEmailSender
{
    public async Task<AccountEmailDispatchResult> SendAsync(
        AccountEmailDispatchRequest request,
        CancellationToken cancellationToken)
    {
        var status = environment.IsDevelopment()
            ? EmailDeliveryStatus.CapturedForDevelopment
            : EmailDeliveryStatus.Queued;
        dbContext.AccountEmailDeliveries.Add(AccountEmailDelivery.Create(
            request.UserId,
            request.Recipient,
            request.Purpose,
            status));
        await dbContext.SaveChangesAsync(cancellationToken);

        return new AccountEmailDispatchResult(
            status,
            environment.IsDevelopment() ? BuildActionUrl(request) : null);
    }

    private string BuildActionUrl(AccountEmailDispatchRequest request)
    {
        var baseUrl = configuration["Application:PublicBaseUrl"]?.TrimEnd('/')
            ?? "http://localhost:4200";
        var path = request.Purpose switch
        {
            AccountEmailPurpose.ConfirmEmail => "/auth/confirm-email",
            AccountEmailPurpose.ResetPassword => "/auth/reset-password",
            _ => throw new InvalidOperationException("Unsupported account email purpose."),
        };

        return QueryHelpers.AddQueryString(
            $"{baseUrl}{path}",
            new Dictionary<string, string?>
            {
                ["userId"] = request.UserId.ToString(),
                ["code"] = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(request.Token)),
            });
    }
}
