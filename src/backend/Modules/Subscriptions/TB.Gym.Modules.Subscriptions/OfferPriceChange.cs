using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

public sealed class OfferPriceChange : TenantEntity
{
    private OfferPriceChange()
    {
    }

    private OfferPriceChange(ProductOffer source, ProductOffer replacement, uint sourceVersion, Guid idempotencyKey)
        : base(source.TenantId)
    {
        if (idempotencyKey == Guid.Empty)
        {
            throw new ArgumentException("A non-empty idempotency key is required.", nameof(idempotencyKey));
        }

        if (replacement.TenantId != source.TenantId || replacement.ProductId != source.ProductId)
        {
            throw new ArgumentException("The replacement must belong to the same product and workspace.");
        }

        SourceOfferId = source.Id;
        ReplacementOfferId = replacement.Id;
        SourceVersion = sourceVersion;
        PriceAmount = replacement.PriceAmount;
        IdempotencyKey = idempotencyKey;
    }

    public Guid SourceOfferId { get; private set; }

    public Guid ReplacementOfferId { get; private set; }

    public uint SourceVersion { get; private set; }

    public decimal PriceAmount { get; private set; }

    public Guid IdempotencyKey { get; private set; }

    public static OfferPriceChange Record(
        ProductOffer source, ProductOffer replacement, uint sourceVersion, Guid idempotencyKey) =>
        new(source, replacement, sourceVersion, idempotencyKey);

    public bool Matches(Guid sourceOfferId, decimal priceAmount, uint sourceVersion) =>
        SourceOfferId == sourceOfferId && SourceVersion == sourceVersion &&
        PriceAmount == MoneyRules.NormalizeAmount(priceAmount, allowZero: true);
}
