using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

public interface IInvitationDelivery
{
    Task SendAsync(InvitationDeliveryRequest request, CancellationToken cancellationToken);
}

public sealed record InvitationDeliveryRequest(
    Guid TenantId,
    string Recipient,
    string Channel,
    string TemplateKey,
    IReadOnlyDictionary<string, string> Parameters);

public sealed class InvitationsModule : IModuleMarker
{
    public const string Name = "Invitations";
}
