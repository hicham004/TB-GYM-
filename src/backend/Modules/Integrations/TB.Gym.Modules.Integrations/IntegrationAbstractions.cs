using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Integrations;

public interface IAiProvider
{
    Task<AiCompletion> CompleteAsync(AiRequest request, CancellationToken cancellationToken);
}

public interface IPaymentProvider
{
    string ProviderKey { get; }

    Task<ProviderCheckoutResult> CreateCheckoutAsync(
        ProviderCheckoutRequest request,
        CancellationToken cancellationToken);

    Task<ProviderPaymentEvent> ParseCallbackAsync(
        ProviderCallback request,
        CancellationToken cancellationToken);
}

public sealed record AiRequest(string Purpose, string Prompt, string? SchemaName);

public sealed record AiCompletion(string Content, string Provider, string Model);

public sealed record ProviderCheckoutRequest(
    Guid TenantId,
    Guid EnrollmentId,
    decimal Amount,
    string CurrencyCode,
    string ReturnUrl,
    string IdempotencyKey);

public sealed record ProviderCheckoutResult(
    string ProviderPaymentId,
    Uri RedirectUri,
    ProviderPaymentStatus Status);

public sealed record ProviderCallback(
    IReadOnlyDictionary<string, string> Headers,
    ReadOnlyMemory<byte> Body);

public sealed record ProviderPaymentEvent(
    string ProviderPaymentId,
    Guid EnrollmentId,
    decimal Amount,
    string CurrencyCode,
    DateTimeOffset OccurredAtUtc,
    ProviderPaymentStatus Status,
    string EventId);

public enum ProviderPaymentStatus
{
    Pending = 1,
    Succeeded = 2,
    Failed = 3,
    Refunded = 4,
    Reversed = 5,
}

public sealed class IntegrationsModule : IModuleMarker
{
    public const string Name = "Integrations";
}
