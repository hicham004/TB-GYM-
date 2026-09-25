using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.PlatformBilling;

/// <summary>
/// Every number platform billing charges by. None of them is a constant in code: they are the terms of
/// a published <see cref="PlatformPricePlan"/> version.
/// </summary>
public sealed record PricePlanTerms(
    string CurrencyCode,
    decimal SeatPrice,
    int IncludedClientsPerSeat,
    decimal ExtraClientPrice,
    decimal GymFee,
    int GymFeeMinimumSeats,
    int TrialDays,
    int PaymentTermDays,
    int GraceDays)
{
    /// <summary>
    /// Workspaces are billed in US dollars (ADR 0028). Another currency would need an exchange-rate and
    /// ledger decision first, so a plan in one is refused rather than silently mixed into totals.
    /// </summary>
    public const string BillingCurrency = "USD";

    public const decimal MaximumPrice = 100_000m;

    /// <summary>The field-level problems with these terms, empty when they are publishable.</summary>
    public IReadOnlyDictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        if (!string.Equals(CurrencyCode, BillingCurrency, StringComparison.Ordinal))
        {
            errors[nameof(CurrencyCode)] = ["Workspaces are billed in USD."];
        }

        CheckPrice(errors, nameof(SeatPrice), SeatPrice);
        CheckPrice(errors, nameof(ExtraClientPrice), ExtraClientPrice);
        CheckPrice(errors, nameof(GymFee), GymFee);
        CheckRange(errors, nameof(IncludedClientsPerSeat), IncludedClientsPerSeat, 0, 1_000);
        CheckRange(errors, nameof(GymFeeMinimumSeats), GymFeeMinimumSeats, 1, 1_000);
        CheckRange(errors, nameof(TrialDays), TrialDays, 0, 365);
        CheckRange(errors, nameof(PaymentTermDays), PaymentTermDays, 0, 90);
        CheckRange(errors, nameof(GraceDays), GraceDays, 0, 90);
        return errors;
    }

    private static void CheckPrice(Dictionary<string, string[]> errors, string field, decimal value)
    {
        if (value < 0m || value > MaximumPrice)
        {
            errors[field] = [$"Enter an amount from 0 to {MaximumPrice:0}."];
        }
        else if (decimal.Round(value, 2) != value)
        {
            errors[field] = ["Use at most two decimal places."];
        }
    }

    private static void CheckRange(Dictionary<string, string[]> errors, string field, int value, int minimum, int maximum)
    {
        if (value < minimum || value > maximum)
        {
            errors[field] = [$"Enter a whole number from {minimum} to {maximum}."];
        }
    }
}

/// <summary>
/// One published, immutable version of the platform's prices (ADR 0028). New invoices use the latest
/// version; an invoice copies the terms it used, so publishing a new version never changes it. A
/// database trigger refuses updating or deleting a version.
/// </summary>
public sealed class PlatformPricePlan
{
    private PlatformPricePlan()
    {
    }

    public Guid Id { get; private set; } = Guid.CreateVersion7();

    public int VersionNumber { get; private set; }

    public string CurrencyCode { get; private set; } = string.Empty;

    public decimal SeatPrice { get; private set; }

    public int IncludedClientsPerSeat { get; private set; }

    public decimal ExtraClientPrice { get; private set; }

    public decimal GymFee { get; private set; }

    public int GymFeeMinimumSeats { get; private set; }

    public int TrialDays { get; private set; }

    public int PaymentTermDays { get; private set; }

    public int GraceDays { get; private set; }

    public string? Note { get; private set; }

    public DateTimeOffset PublishedAtUtc { get; private set; }

    public Guid? PublishedByUserId { get; private set; }

    public PricePlanTerms Terms => new(
        CurrencyCode,
        SeatPrice,
        IncludedClientsPerSeat,
        ExtraClientPrice,
        GymFee,
        GymFeeMinimumSeats,
        TrialDays,
        PaymentTermDays,
        GraceDays);

    public static PlatformPricePlan Publish(
        int versionNumber,
        PricePlanTerms terms,
        string? note,
        Guid? publishedByUserId,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (versionNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(versionNumber), "Plan versions start at 1.");
        }

        if (terms.Validate().Count > 0)
        {
            throw new ArgumentException("The price plan terms are not publishable.", nameof(terms));
        }

        return new PlatformPricePlan
        {
            VersionNumber = versionNumber,
            CurrencyCode = terms.CurrencyCode,
            SeatPrice = terms.SeatPrice,
            IncludedClientsPerSeat = terms.IncludedClientsPerSeat,
            ExtraClientPrice = terms.ExtraClientPrice,
            GymFee = terms.GymFee,
            GymFeeMinimumSeats = terms.GymFeeMinimumSeats,
            TrialDays = terms.TrialDays,
            PaymentTermDays = terms.PaymentTermDays,
            GraceDays = terms.GraceDays,
            Note = BillingText.Optional(note, 500, nameof(note)),
            PublishedAtUtc = now,
            PublishedByUserId = publishedByUserId,
        };
    }
}

internal static class BillingText
{
    public static string Required(string? value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, parameterName);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    public static string? Optional(string? value, int maxLength, string parameterName) =>
        string.IsNullOrWhiteSpace(value) ? null : Required(value, maxLength, parameterName);
}

public sealed class PlatformBillingModule : IModuleMarker
{
    public const string Name = "PlatformBilling";
}
