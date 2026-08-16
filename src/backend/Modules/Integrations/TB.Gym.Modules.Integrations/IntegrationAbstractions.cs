using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Integrations;

public interface IAiProvider
{
    Task<AiCompletion> CompleteAsync(AiRequest request, CancellationToken cancellationToken);
}

public interface IPaymentProvider
{
    Task<PaymentRegistrationResult> RegisterAsync(PaymentRegistration request, CancellationToken cancellationToken);
}

public sealed record AiRequest(string Purpose, string Prompt, string? SchemaName);

public sealed record AiCompletion(string Content, string Provider, string Model);

public sealed record PaymentRegistration(Guid TenantId, Guid SubscriptionId, decimal Amount, string Currency);

public sealed record PaymentRegistrationResult(string ExternalId, string Status);

public sealed class IntegrationsModule : IModuleMarker
{
    public const string Name = "Integrations";
}
