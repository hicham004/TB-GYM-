using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using TB.Gym.Modules.Invitations;

namespace TB.Gym.Infrastructure.Application;

internal sealed class CapturedInvitationDelivery(
    IWebHostEnvironment environment,
    IConfiguration configuration)
    : IInvitationDelivery
{
    public Task<InvitationDeliveryResult> SendAsync(
        InvitationDeliveryRequest request,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var status = environment.IsDevelopment()
            ? InvitationDeliveryStatus.CapturedForDevelopment
            : InvitationDeliveryStatus.Queued;
        var developmentUrl = environment.IsDevelopment()
            ? QueryHelpers.AddQueryString(
                $"{configuration["Application:PublicBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200"}/invite",
                "token",
                request.Token)
            : null;

        return Task.FromResult(new InvitationDeliveryResult(status, DevelopmentActionUrl: developmentUrl));
    }
}
