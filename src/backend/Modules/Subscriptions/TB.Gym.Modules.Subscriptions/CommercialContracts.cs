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

public sealed record CoachingProductView(
    Guid Id,
    string Name,
    string? Description,
    bool IsActive,
    IReadOnlyList<ProductOfferView> Offers,
    uint Version);

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
    uint Version);

public sealed record OfferFeatureView(
    CoachingFeature Feature,
    bool AllowsConcurrentCoverage);

public sealed record ClientCommercialOverview(
    Guid ClientProfileId,
    bool IsRelationshipBlocked,
    IReadOnlyList<FeatureAccessDecision> FeatureAccess,
    IReadOnlyList<ClientEnrollmentView> Enrollments);

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
    IReadOnlyList<CoachingFeature> Features,
    IReadOnlyList<PaymentRecordView> Payments,
    DateTimeOffset CreatedAtUtc,
    uint Version);

public sealed record PaymentRecordView(
    Guid Id,
    decimal Amount,
    string CurrencyCode,
    DateTimeOffset ReceivedAtUtc,
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

public sealed record AssignProductRequest(
    Guid OfferId,
    DateOnly StartDate,
    Guid IdempotencyKey);

public sealed record RecordManualPaymentRequest(
    decimal Amount,
    string CurrencyCode,
    DateTimeOffset ReceivedAtUtc,
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
