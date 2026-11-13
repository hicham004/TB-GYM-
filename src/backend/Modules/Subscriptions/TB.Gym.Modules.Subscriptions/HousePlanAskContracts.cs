using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// A house trainee's asks for a paid plan and the house's staff booking them (SUB-020, notes plan N9c1). Every read
/// and write answers nothing outside the house: a coaching space has no asks.
/// </summary>
public interface IHousePlanAskService
{
    /// <summary>
    /// The signed-in trainee's plans page: the plans they may ask for while asks are open, the house's Whish number
    /// and every ask of theirs; null when they are not a current self-directed trainee of the house in scope.
    /// </summary>
    Task<HousePlansView?> GetOwnAsync(CancellationToken cancellationToken);

    /// <summary>Asks for a plan. The same plan asked for again while its ask is open answers the open ask.</summary>
    Task<HousePlanAskResult> AskAsync(AskForHousePlanRequest request, CancellationToken cancellationToken);

    /// <summary>Says the ask's money was sent by Whish, from the name and number given. Once an ask.</summary>
    Task<HousePlanAskResult> SayMoneySentAsync(
        Guid askId,
        HousePlanMoneySentRequest request,
        CancellationToken cancellationToken);

    /// <summary>A trainee's asks for the house's staff, newest first; null outside the house or for no such client.</summary>
    Task<IReadOnlyList<HousePlanAskView>?> ListForClientAsync(Guid clientProfileId, CancellationToken cancellationToken);

    /// <summary>Books the asked plan from the house's day and records its receipt, the exact price, in one step.</summary>
    Task<HousePlanAskResult> BookAsync(
        Guid clientProfileId,
        Guid askId,
        BookHousePlanAskRequest request,
        CancellationToken cancellationToken);

    /// <summary>Closes an ask with a reason the trainee reads; nothing is booked.</summary>
    Task<HousePlanAskResult> CloseAsync(
        Guid clientProfileId,
        Guid askId,
        CloseHousePlanAskRequest request,
        CancellationToken cancellationToken);
}

/// <param name="OfferId">The option of one of the house's plans on sale.</param>
public sealed record AskForHousePlanRequest(Guid OfferId);

/// <param name="WhishName">The name on the Whish account the money was sent from.</param>
/// <param name="WhishNumber">The Whish number it was sent from.</param>
public sealed record HousePlanMoneySentRequest(string? WhishName, string? WhishNumber);

/// <param name="Amount">The money received: the plan's exact price, never a part.</param>
/// <param name="CurrencyCode">Its currency: the plan's own.</param>
/// <param name="Reference">The staff's own reference for the transfer, if any (up to 200 characters).</param>
/// <param name="IdempotencyKey">The screen's key: a retry with the same request answers the first booking.</param>
public sealed record BookHousePlanAskRequest(
    decimal Amount,
    string? CurrencyCode,
    string? Reference,
    Guid IdempotencyKey);

/// <param name="Reason">Why the ask is closed; the trainee reads it.</param>
public sealed record CloseHousePlanAskRequest(string? Reason);

/// <param name="Today">The house's calendar day.</param>
/// <param name="AsksOpen">
/// Whether a plan may be asked for now: the house's Whish number is filled and the house has not blocked the trainee.
/// </param>
/// <param name="WhishNumber">The number to send the money to; null while asks are closed.</param>
/// <param name="Plans">The plans on sale that may be asked for; none while asks are closed.</param>
/// <param name="Asks">Every ask of the trainee's, newest first.</param>
public sealed record HousePlansView(
    DateOnly Today,
    bool AsksOpen,
    string? WhishNumber,
    IReadOnlyList<HousePlanOfferView> Plans,
    IReadOnlyList<HousePlanAskView> Asks);

/// <summary>One option of a plan on sale, with the words and figures the house's staff typed in Plans you sell.</summary>
public sealed record HousePlanOfferView(
    Guid OfferId,
    Guid ProductId,
    HouseTier Tier,
    string Name,
    string? Description,
    string OptionLabel,
    decimal PriceAmount,
    string PriceCurrency,
    int DurationCount,
    OfferDurationUnit DurationUnit,
    IReadOnlyList<CoachingFeature> Features);

/// <summary>An ask, with the plan and option it named, what was said since and how it ended.</summary>
public sealed record HousePlanAskView(
    Guid Id,
    Guid OfferId,
    HouseTier Tier,
    string PlanName,
    string OptionLabel,
    decimal PriceAmount,
    string PriceCurrency,
    int DurationCount,
    OfferDurationUnit DurationUnit,
    DateOnly AskedOn,
    HousePlanAskState State,
    HousePlanTransferView? MoneySent,
    HousePlanAskOutcomeView? Outcome);

/// <param name="WhishName">Null once the account was closed.</param>
/// <param name="WhishNumber">Null once the account was closed.</param>
public sealed record HousePlanTransferView(string? WhishName, string? WhishNumber, DateOnly SentOn);

/// <param name="PlanStartDate">The booked plan's first day; null for a closed ask.</param>
/// <param name="PlanLastDay">The booked plan's last day; null for a closed ask.</param>
/// <param name="DecidedByName">Who booked or closed it, for the house's staff; never read by the trainee.</param>
public sealed record HousePlanAskOutcomeView(
    HousePlanAskOutcomeKind Kind,
    DateOnly DecidedOn,
    string? Reason,
    Guid? EnrollmentId,
    DateOnly? PlanStartDate,
    DateOnly? PlanLastDay,
    string? DecidedByName);

public enum HousePlanAskStatus
{
    /// <summary>A new ask was stored.</summary>
    Created = 1,

    /// <summary>The request was already done: the stored ask, word or booking is answered again.</summary>
    Unchanged = 2,

    /// <summary>The ask changed: money said sent, booked or closed.</summary>
    Changed = 3,

    NotFound = 4,

    Invalid = 5,

    Conflict = 6,
}

public sealed record HousePlanAskResult(
    HousePlanAskStatus Status,
    HousePlanAskView? Ask = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

/// <summary>The codes a house ask answers 409 with.</summary>
public static class HousePlanAskCodes
{
    /// <summary>The house's Whish number is empty, so no plan may be asked for (switched off, 12 Nov 2026).</summary>
    public const string AsksClosed = "house_plan_asks_closed";

    /// <summary>Not one of the house's plans a trainee may ask for now.</summary>
    public const string NotOnSale = "house_plan_not_on_sale";

    /// <summary>Another plan's ask is still open.</summary>
    public const string AskOpen = "house_plan_ask_open";

    /// <summary>The ask was already booked or closed.</summary>
    public const string AskEnded = "house_plan_ask_ended";

    /// <summary>The money was already said sent for this ask, with other details.</summary>
    public const string MoneyAlreadySent = "house_plan_money_already_sent";

    /// <summary>The house has paused the trainee (a relationship block).</summary>
    public const string Blocked = "client_blocked";

    public const string IdempotencyKeyReused = "idempotency_key_reused";

    public const string Overlap = "entitlement_overlap";

    public const string Changed = "house_plan_ask_changed";
}
