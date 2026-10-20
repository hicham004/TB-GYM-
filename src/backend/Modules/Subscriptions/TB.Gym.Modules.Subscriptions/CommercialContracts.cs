using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

public interface ICommercialApplicationService
{
    Task<ProductCatalog> ListProductsAsync(CancellationToken cancellationToken);

    Task<CommercialCommandResult> CreateProductAsync(
        CreateCoachingProductRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> UpdateProductAsync(
        Guid productId,
        UpdateCoachingProductRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> AddOfferAsync(
        Guid productId,
        CreateProductOfferRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> SetOfferAvailabilityAsync(
        Guid offerId,
        SetOfferAvailabilityRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> ChangeOfferPriceAsync(
        Guid offerId,
        ChangeProductOfferPriceRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommercialOverview?> GetClientOverviewAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> AssignAsync(
        Guid clientProfileId,
        AssignProductRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> RecordManualPaymentAsync(
        Guid enrollmentId,
        RecordManualPaymentRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> RenewAsync(
        Guid enrollmentId,
        RenewEnrollmentRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> PauseAsync(
        Guid enrollmentId,
        ChangeEnrollmentStatusRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> ResumeAsync(
        Guid enrollmentId,
        ResumeEnrollmentRequest request,
        CancellationToken cancellationToken);

    Task<CommercialCommandResult> CancelAsync(
        Guid enrollmentId,
        ChangeEnrollmentStatusRequest request,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<FeatureAccessDecision>?> GetSelfAccessAsync(
        CancellationToken cancellationToken);
}

public sealed record ProductCatalog(
    string WorkspaceCurrencyCode,
    IReadOnlyList<CoachingProductView> Products);

/// <param name="Clients">Who is on the product, each client once across its price options (SUB-015).</param>
public sealed record CoachingProductView(
    Guid Id,
    string Name,
    string? Description,
    bool IsActive,
    IReadOnlyList<ProductOfferView> Offers,
    uint Version,
    PlanClientCount Clients);

/// <param name="Clients">
/// Who is on this option (SUB-015). A replacement from Change price also counts the clients of the options it
/// replaced, who keep their old price (ADR 0034); a retired option counts only its own.
/// </param>
/// <param name="ReplacedByOfferId">The option Change price put in this one's place; null when it was not replaced.</param>
public sealed record ProductOfferView(
    Guid Id,
    string Label,
    OfferBillingModel BillingModel,
    int DurationCount,
    OfferDurationUnit DurationUnit,
    decimal PriceAmount,
    string PriceCurrency,
    bool IsActive,
    IReadOnlyList<OfferFeatureView> Features,
    DateTimeOffset CreatedAtUtc,
    uint Version,
    PlanClientCount Clients,
    Guid? ReplacedByOfferId);

/// <summary>
/// The caller's clients on a plan (SUB-015, ADR 0026: a Coach counts their own, the Owner every client still
/// coached here): on it today, and booked to start later.
/// </summary>
public sealed record PlanClientCount(int Now, int Starting);

public sealed record OfferFeatureView(
    CoachingFeature Feature,
    bool AllowsConcurrentCoverage);

public sealed record ClientCommercialOverview(
    Guid ClientProfileId,
    bool IsRelationshipBlocked,
    IReadOnlyList<FeatureAccessDecision> FeatureAccess,
    IReadOnlyList<ClientEnrollmentView> Enrollments);

/// <param name="CancelledOn">The workspace day the plan was cancelled (COACH-20); null unless it was.</param>
public sealed record ClientEnrollmentView(
    Guid Id,
    Guid ProductId,
    Guid OfferId,
    Guid? RenewedFromEnrollmentId,
    string ProductName,
    string OfferLabel,
    decimal PriceAmount,
    string PriceCurrency,
    decimal PaidAmount,
    decimal BalanceAmount,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    DateOnly LastActiveDate,
    EnrollmentStatus StoredStatus,
    EffectiveEnrollmentStatus EffectiveStatus,
    string? StatusReason,
    DateOnly? CancelledOn,
    IReadOnlyList<CoachingFeature> Features,
    IReadOnlyList<PaymentRecordView> Payments,
    DateTimeOffset CreatedAtUtc,
    uint Version);

/// <param name="ReceivedOn">The workspace day the money arrived (WEA-6), the same for every reader.</param>
public sealed record PaymentRecordView(
    Guid Id,
    decimal Amount,
    string CurrencyCode,
    DateTimeOffset ReceivedAtUtc,
    DateOnly ReceivedOn,
    ManualPaymentMethod Method,
    string? Reference,
    string? Note,
    Guid RecordedByUserId,
    PaymentOperation Operation,
    PaymentSource Source,
    DateTimeOffset CreatedAtUtc);

public sealed record CreateCoachingProductRequest(
    string Name,
    string? Description,
    CreateProductOfferRequest InitialOffer);

public sealed record UpdateCoachingProductRequest(
    string Name,
    string? Description,
    bool IsActive,
    uint Version);

public sealed record CreateProductOfferRequest(
    string Label,
    int DurationCount,
    OfferDurationUnit DurationUnit,
    decimal PriceAmount,
    string? PriceCurrency,
    IReadOnlyList<OfferFeatureRequest> Features);

public sealed record OfferFeatureRequest(
    CoachingFeature Feature,
    bool AllowsConcurrentCoverage = false);

public sealed record SetOfferAvailabilityRequest(bool IsActive, uint Version);

public sealed record ChangeProductOfferPriceRequest(decimal PriceAmount, uint Version, Guid IdempotencyKey);

public sealed record AssignProductRequest(
    Guid OfferId,
    DateOnly StartDate,
    Guid IdempotencyKey);

/// <param name="ReceivedOn">
/// The workspace day the money arrived, today or earlier (WEA-6). The server stamps the instant from it in the
/// workspace's time zone; a browser's clock and zone never date a receipt.
/// </param>
public sealed record RecordManualPaymentRequest(
    decimal Amount,
    string CurrencyCode,
    DateOnly ReceivedOn,
    ManualPaymentMethod Method,
    string? Reference,
    string? Note,
    Guid IdempotencyKey);

public sealed record RenewEnrollmentRequest(
    Guid OfferId,
    DateOnly StartDate,
    Guid IdempotencyKey);

public sealed record ChangeEnrollmentStatusRequest(string Reason, uint Version);

public sealed record ResumeEnrollmentRequest(uint Version);

public sealed record CommercialCommandResult(
    CommercialCommandStatus Status,
    CoachingProductView? Product = null,
    ClientEnrollmentView? Enrollment = null,
    ClientCommercialOverview? Overview = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum CommercialCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
}
