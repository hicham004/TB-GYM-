using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

public sealed class CoachingProduct : TenantEntity
{
    private CoachingProduct()
    {
    }

    private CoachingProduct(Guid tenantId, string name, string? description)
        : base(tenantId)
    {
        Name = CommercialText.Required(name, 160, nameof(name));
        Description = CommercialText.Optional(description, 2_000, nameof(description));
        IsActive = true;
    }

    public string Name { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    public bool IsActive { get; private set; }

    public static CoachingProduct Create(Guid tenantId, string name, string? description) =>
        new(tenantId, name, description);

    public void Update(string name, string? description, bool isActive)
    {
        Name = CommercialText.Required(name, 160, nameof(name));
        Description = CommercialText.Optional(description, 2_000, nameof(description));
        IsActive = isActive;
    }
}

public sealed class ProductOffer : TenantEntity
{
    private readonly List<OfferEntitlement> entitlements = [];

    private ProductOffer()
    {
    }

    private ProductOffer(
        Guid tenantId,
        Guid productId,
        string label,
        int durationCount,
        OfferDurationUnit durationUnit,
        decimal amount,
        string currencyCode,
        IEnumerable<OfferFeatureDefinition> features)
        : base(tenantId)
    {
        if (productId == Guid.Empty)
        {
            throw new ArgumentException("A product id is required.", nameof(productId));
        }

        if (durationCount is < 1 or > 3_650)
        {
            throw new ArgumentOutOfRangeException(
                nameof(durationCount),
                "Offer duration must be between 1 and 3,650 units.");
        }

        if (!Enum.IsDefined(durationUnit))
        {
            throw new ArgumentOutOfRangeException(nameof(durationUnit));
        }

        var normalizedFeatures = features
            .DistinctBy(item => item.Feature)
            .OrderBy(item => item.Feature)
            .ToArray();
        if (normalizedFeatures.Length == 0 || normalizedFeatures.Any(item => !Enum.IsDefined(item.Feature)))
        {
            throw new ArgumentException("At least one valid coaching feature is required.", nameof(features));
        }

        ProductId = productId;
        Label = CommercialText.Required(label, 120, nameof(label));
        BillingModel = OfferBillingModel.FixedDuration;
        DurationCount = durationCount;
        DurationUnit = durationUnit;
        PriceAmount = MoneyRules.NormalizeAmount(amount, allowZero: true);
        PriceCurrency = MoneyRules.NormalizeCurrency(currencyCode);
        IsActive = true;

        foreach (var feature in normalizedFeatures)
        {
            entitlements.Add(OfferEntitlement.Create(
                tenantId,
                Id,
                feature.Feature,
                feature.AllowsConcurrentCoverage));
        }
    }

    public Guid ProductId { get; private set; }

    public string Label { get; private set; } = string.Empty;

    public OfferBillingModel BillingModel { get; private set; }

    public int DurationCount { get; private set; }

    public OfferDurationUnit DurationUnit { get; private set; }

    public decimal PriceAmount { get; private set; }

    public string PriceCurrency { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }

    public IReadOnlyCollection<OfferEntitlement> Entitlements => entitlements;

    public static ProductOffer CreateFixedDuration(
        Guid tenantId,
        Guid productId,
        string label,
        int durationCount,
        OfferDurationUnit durationUnit,
        decimal amount,
        string currencyCode,
        IEnumerable<OfferFeatureDefinition> features) =>
        new(
            tenantId,
            productId,
            label,
            durationCount,
            durationUnit,
            amount,
            currencyCode,
            features);

    public SubscriptionPeriod GetPeriod(DateOnly startDate)
    {
        var days = DurationUnit switch
        {
            OfferDurationUnit.Day => DurationCount,
            OfferDurationUnit.Week => checked(DurationCount * 7),
            _ => throw new InvalidOperationException("The offer duration unit is not supported."),
        };

        return new SubscriptionPeriod(startDate, startDate.AddDays(days));
    }

    public void SetAvailability(bool isActive) => IsActive = isActive;
}

public sealed class OfferEntitlement : TenantEntity
{
    private OfferEntitlement()
    {
    }

    private OfferEntitlement(
        Guid tenantId,
        Guid offerId,
        CoachingFeature feature,
        bool allowsConcurrentCoverage)
        : base(tenantId)
    {
        OfferId = offerId;
        Feature = feature;
        AllowsConcurrentCoverage = allowsConcurrentCoverage;
    }

    public Guid OfferId { get; private set; }

    public CoachingFeature Feature { get; private set; }

    public bool AllowsConcurrentCoverage { get; private set; }

    internal static OfferEntitlement Create(
        Guid tenantId,
        Guid offerId,
        CoachingFeature feature,
        bool allowsConcurrentCoverage) =>
        new(tenantId, offerId, feature, allowsConcurrentCoverage);
}

public sealed class ClientEnrollment : TenantEntity
{
    private readonly List<EnrollmentEntitlement> entitlements = [];

    private ClientEnrollment()
    {
    }

    private ClientEnrollment(
        Guid tenantId,
        Guid clientProfileId,
        CoachingProduct product,
        ProductOffer offer,
        SubscriptionPeriod period,
        Guid commandId,
        Guid? renewedFromEnrollmentId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || commandId == Guid.Empty)
        {
            throw new ArgumentException("Client and command ids are required.");
        }

        if (product.TenantId != tenantId || offer.TenantId != tenantId || offer.ProductId != product.Id)
        {
            throw new InvalidOperationException("Product and offer must belong to the enrollment workspace.");
        }

        ClientProfileId = clientProfileId;
        ProductId = product.Id;
        OfferId = offer.Id;
        ProductNameSnapshot = product.Name;
        OfferLabelSnapshot = offer.Label;
        PriceAmount = offer.PriceAmount;
        PriceCurrency = offer.PriceCurrency;
        StartDate = period.Start;
        EndDateExclusive = period.EndExclusive;
        Status = PriceAmount == 0m ? EnrollmentStatus.Active : EnrollmentStatus.PendingPayment;
        ActivatedAtUtc = PriceAmount == 0m ? now : null;
        AssignmentCommandId = commandId;
        RenewedFromEnrollmentId = renewedFromEnrollmentId;

        foreach (var entitlement in offer.Entitlements)
        {
            entitlements.Add(EnrollmentEntitlement.Create(
                tenantId,
                Id,
                clientProfileId,
                period,
                entitlement.Feature,
                !entitlement.AllowsConcurrentCoverage));
        }
    }

    public Guid ClientProfileId { get; private set; }

    public Guid ProductId { get; private set; }

    public Guid OfferId { get; private set; }

    public string ProductNameSnapshot { get; private set; } = string.Empty;

    public string OfferLabelSnapshot { get; private set; } = string.Empty;

    public decimal PriceAmount { get; private set; }

    public string PriceCurrency { get; private set; } = string.Empty;

    public DateOnly StartDate { get; private set; }

    public DateOnly EndDateExclusive { get; private set; }

    public EnrollmentStatus Status { get; private set; }

    public DateTimeOffset? ActivatedAtUtc { get; private set; }

    public DateTimeOffset? PausedAtUtc { get; private set; }

    public DateTimeOffset? CancelledAtUtc { get; private set; }

    public DateTimeOffset? ExpiredAtUtc { get; private set; }

    public string? StatusReason { get; private set; }

    public Guid AssignmentCommandId { get; private set; }

    public Guid? RenewedFromEnrollmentId { get; private set; }

    public IReadOnlyCollection<EnrollmentEntitlement> Entitlements => entitlements;

    public SubscriptionPeriod Period => new(StartDate, EndDateExclusive);

    public static ClientEnrollment Assign(
        Guid tenantId,
        Guid clientProfileId,
        CoachingProduct product,
        ProductOffer offer,
        DateOnly startDate,
        Guid commandId,
        DateTimeOffset now,
        Guid? renewedFromEnrollmentId = null) =>
        new(
            tenantId,
            clientProfileId,
            product,
            offer,
            offer.GetPeriod(startDate),
            commandId,
            renewedFromEnrollmentId,
            now);

    public void Activate(DateTimeOffset now)
    {
        EnsureStatus(EnrollmentStatus.PendingPayment, "Only a pending enrollment can be activated.");
        Status = EnrollmentStatus.Active;
        ActivatedAtUtc = now;
        StatusReason = null;
    }

    public void Pause(DateTimeOffset now, string reason)
    {
        EnsureStatus(EnrollmentStatus.Active, "Only an active enrollment can be paused.");
        Status = EnrollmentStatus.Paused;
        PausedAtUtc = now;
        StatusReason = CommercialText.Required(reason, 500, nameof(reason));
    }

    public void Resume(DateTimeOffset now)
    {
        EnsureStatus(EnrollmentStatus.Paused, "Only a paused enrollment can be resumed.");
        Status = EnrollmentStatus.Active;
        ActivatedAtUtc ??= now;
        PausedAtUtc = null;
        StatusReason = null;
    }

    public void Cancel(DateTimeOffset now, string reason)
    {
        if (Status is EnrollmentStatus.Cancelled or EnrollmentStatus.Expired)
        {
            throw new InvalidOperationException("A cancelled or expired enrollment cannot be cancelled again.");
        }

        Status = EnrollmentStatus.Cancelled;
        CancelledAtUtc = now;
        StatusReason = CommercialText.Required(reason, 500, nameof(reason));
        foreach (var entitlement in entitlements)
        {
            entitlement.ReleaseOverlapLock();
        }
    }

    public void Expire(DateOnly tenantToday, DateTimeOffset now)
    {
        if (tenantToday < EndDateExclusive)
        {
            throw new InvalidOperationException("An enrollment cannot expire before its end date.");
        }

        if (Status == EnrollmentStatus.Cancelled)
        {
            throw new InvalidOperationException("A cancelled enrollment cannot transition to expired.");
        }

        Status = EnrollmentStatus.Expired;
        ExpiredAtUtc = now;
        StatusReason = null;
    }

    public EffectiveEnrollmentStatus GetEffectiveStatus(DateOnly tenantToday, bool relationshipBlocked)
    {
        if (relationshipBlocked)
        {
            return EffectiveEnrollmentStatus.Blocked;
        }

        if (Status == EnrollmentStatus.Cancelled)
        {
            return EffectiveEnrollmentStatus.Cancelled;
        }

        if (Status == EnrollmentStatus.Expired || tenantToday >= EndDateExclusive)
        {
            return EffectiveEnrollmentStatus.Expired;
        }

        if (Status == EnrollmentStatus.PendingPayment)
        {
            return EffectiveEnrollmentStatus.PendingPayment;
        }

        if (Status == EnrollmentStatus.Paused)
        {
            return EffectiveEnrollmentStatus.Paused;
        }

        return tenantToday < StartDate
            ? EffectiveEnrollmentStatus.Upcoming
            : EffectiveEnrollmentStatus.Active;
    }

    private void EnsureStatus(EnrollmentStatus expected, string message)
    {
        if (Status != expected)
        {
            throw new InvalidOperationException(message);
        }
    }
}

public sealed class EnrollmentEntitlement : TenantEntity
{
    private EnrollmentEntitlement()
    {
    }

    private EnrollmentEntitlement(
        Guid tenantId,
        Guid enrollmentId,
        Guid clientProfileId,
        SubscriptionPeriod period,
        CoachingFeature feature,
        bool blocksOverlap)
        : base(tenantId)
    {
        EnrollmentId = enrollmentId;
        ClientProfileId = clientProfileId;
        StartDate = period.Start;
        EndDateExclusive = period.EndExclusive;
        Feature = feature;
        BlocksOverlap = blocksOverlap;
    }

    public Guid EnrollmentId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public DateOnly StartDate { get; private set; }

    public DateOnly EndDateExclusive { get; private set; }

    public CoachingFeature Feature { get; private set; }

    public bool BlocksOverlap { get; private set; }

    internal static EnrollmentEntitlement Create(
        Guid tenantId,
        Guid enrollmentId,
        Guid clientProfileId,
        SubscriptionPeriod period,
        CoachingFeature feature,
        bool blocksOverlap) =>
        new(tenantId, enrollmentId, clientProfileId, period, feature, blocksOverlap);

    internal void ReleaseOverlapLock() => BlocksOverlap = false;
}

public sealed class PaymentRecord : TenantEntity
{
    private PaymentRecord()
    {
    }

    private PaymentRecord(
        Guid tenantId,
        Guid enrollmentId,
        decimal amount,
        string currencyCode,
        DateTimeOffset receivedAtUtc,
        ManualPaymentMethod method,
        string? reference,
        string? note,
        Guid recordedByUserId,
        Guid idempotencyKey,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (enrollmentId == Guid.Empty || recordedByUserId == Guid.Empty || idempotencyKey == Guid.Empty)
        {
            throw new ArgumentException("Enrollment, actor, and idempotency ids are required.");
        }

        if (!Enum.IsDefined(method))
        {
            throw new ArgumentOutOfRangeException(nameof(method));
        }

        if (receivedAtUtc > now.AddMinutes(5))
        {
            throw new ArgumentOutOfRangeException(
                nameof(receivedAtUtc),
                "A payment cannot be recorded in the future.");
        }

        EnrollmentId = enrollmentId;
        Amount = MoneyRules.NormalizeAmount(amount, allowZero: false);
        CurrencyCode = MoneyRules.NormalizeCurrency(currencyCode);
        ReceivedAtUtc = receivedAtUtc;
        Method = method;
        Reference = CommercialText.Optional(reference, 200, nameof(reference));
        Note = CommercialText.Optional(note, 2_000, nameof(note));
        RecordedByUserId = recordedByUserId;
        IdempotencyKey = idempotencyKey;
        Operation = PaymentOperation.Receipt;
        Source = PaymentSource.Manual;
    }

    public Guid EnrollmentId { get; private set; }

    public decimal Amount { get; private set; }

    public string CurrencyCode { get; private set; } = string.Empty;

    public DateTimeOffset ReceivedAtUtc { get; private set; }

    public ManualPaymentMethod Method { get; private set; }

    public string? Reference { get; private set; }

    public string? Note { get; private set; }

    public Guid RecordedByUserId { get; private set; }

    public Guid IdempotencyKey { get; private set; }

    public PaymentOperation Operation { get; private set; }

    public PaymentSource Source { get; private set; }

    public static PaymentRecord RecordManualReceipt(
        Guid tenantId,
        Guid enrollmentId,
        decimal amount,
        string currencyCode,
        DateTimeOffset receivedAtUtc,
        ManualPaymentMethod method,
        string? reference,
        string? note,
        Guid recordedByUserId,
        Guid idempotencyKey,
        DateTimeOffset now) =>
        new(
            tenantId,
            enrollmentId,
            amount,
            currencyCode,
            receivedAtUtc,
            method,
            reference,
            note,
            recordedByUserId,
            idempotencyKey,
            now);
}

public sealed record OfferFeatureDefinition(
    CoachingFeature Feature,
    bool AllowsConcurrentCoverage = false);

public enum OfferBillingModel
{
    FixedDuration = 1,
    Recurring = 2,
}

public enum OfferDurationUnit
{
    Day = 1,
    Week = 2,
}

public enum EnrollmentStatus
{
    PendingPayment = 1,
    Active = 2,
    Paused = 3,
    Cancelled = 4,
    Expired = 5,
}

public enum EffectiveEnrollmentStatus
{
    PendingPayment = 1,
    Upcoming = 2,
    Active = 3,
    Paused = 4,
    Expired = 5,
    Cancelled = 6,
    Blocked = 7,
}

public enum ManualPaymentMethod
{
    Cash = 1,
    BankTransfer = 2,
    Card = 3,
    MobileWallet = 4,
    Other = 5,
}

public enum PaymentOperation
{
    Receipt = 1,
    Refund = 2,
    Reversal = 3,
}

public enum PaymentSource
{
    Manual = 1,
    Provider = 2,
}

public static class MoneyRules
{
    public static decimal NormalizeAmount(decimal amount, bool allowZero)
    {
        var normalized = decimal.Round(amount, 2, MidpointRounding.AwayFromZero);
        if (normalized < 0m || (!allowZero && normalized == 0m) || normalized > 999_999_999.99m)
        {
            throw new ArgumentOutOfRangeException(nameof(amount), "The money amount is outside the supported range.");
        }

        return normalized;
    }

    public static string NormalizeCurrency(string currencyCode)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(currencyCode);
        var normalized = currencyCode.Trim().ToUpperInvariant();
        if (normalized.Length != 3 || normalized.Any(character => character is < 'A' or > 'Z'))
        {
            throw new ArgumentException("Currency must be a three-letter ISO code.", nameof(currencyCode));
        }

        return normalized;
    }
}

internal static class CommercialText
{
    public static string Required(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    public static string? Optional(string? value, int maxLength, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return Required(value, maxLength, parameterName);
    }
}
