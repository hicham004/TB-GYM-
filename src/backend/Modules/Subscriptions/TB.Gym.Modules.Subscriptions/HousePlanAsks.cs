using System.Globalization;
using System.Text;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// A house trainee's ask for one of the house's paid plans (SUB-020, notes plan N9c1). It books nothing: Free keeps
/// running and no paid day passes before the money is recorded. Append-only, as its "I've sent the money" and its
/// outcome are: what was asked, said and decided is never rewritten.
/// </summary>
public sealed class HousePlanAsk : TenantEntity
{
    private HousePlanAsk()
    {
    }

    private HousePlanAsk(
        Guid tenantId,
        Guid clientProfileId,
        CoachingProduct product,
        ProductOffer offer,
        Guid askedByUserId,
        DateOnly askedOn,
        DateTimeOffset askedAtUtc,
        bool maxOpen = false)
        : base(tenantId)
    {
        ArgumentNullException.ThrowIfNull(product);
        ArgumentNullException.ThrowIfNull(offer);
        if (clientProfileId == Guid.Empty || askedByUserId == Guid.Empty)
        {
            throw new ArgumentException("An ask names its trainee and who asked.");
        }

        if (offer.ProductId != product.Id || product.TenantId != tenantId || offer.TenantId != tenantId)
        {
            throw new ArgumentException("An ask names one of the house's own plans and one of its options.");
        }

        if (!HousePlanAskRule.IsAskable(product, offer, maxOpen))
        {
            throw new ArgumentException(HousePlanAskRule.NotOnSaleMessage);
        }

        ClientProfileId = clientProfileId;
        ProductId = product.Id;
        OfferId = offer.Id;
        Tier = product.HouseTier!.Value;
        AskedByUserId = askedByUserId;
        AskedOn = askedOn;
        AskedAtUtc = askedAtUtc;
    }

    public Guid ClientProfileId { get; private set; }

    public Guid ProductId { get; private set; }

    /// <summary>The option asked for: an offer never changes, so its price, currency and length are the ask's.</summary>
    public Guid OfferId { get; private set; }

    public HouseTier Tier { get; private set; }

    public Guid AskedByUserId { get; private set; }

    /// <summary>The house's calendar day when the trainee asked.</summary>
    public DateOnly AskedOn { get; private set; }

    public DateTimeOffset AskedAtUtc { get; private set; }

    public static HousePlanAsk Create(
        Guid tenantId,
        Guid clientProfileId,
        CoachingProduct product,
        ProductOffer offer,
        Guid askedByUserId,
        DateOnly askedOn,
        DateTimeOffset askedAtUtc,
        bool maxOpen = false) =>
        new(tenantId, clientProfileId, product, offer, askedByUserId, askedOn, askedAtUtc, maxOpen);
}

/// <summary>
/// The trainee's word that they sent an ask's money by Whish, with the Whish name and number they sent it from, so
/// the house's staff can find it (SUB-020). Said once an ask. The name and number are the person's own: closing the
/// account erases them once (CLI-027), the only change the row ever takes.
/// </summary>
public sealed class HousePlanTransfer : TenantEntity
{
    private HousePlanTransfer()
    {
    }

    private HousePlanTransfer(
        Guid tenantId,
        HousePlanAsk ask,
        string whishName,
        string whishNumber,
        DateOnly sentOn,
        DateTimeOffset sentAtUtc)
        : base(tenantId)
    {
        ArgumentNullException.ThrowIfNull(ask);
        if (ask.TenantId != tenantId)
        {
            throw new ArgumentException("The word on an ask is said in the ask's coaching space.");
        }

        var name = HousePlanAskRule.NormalizeWhishName(whishName);
        if (!name.IsValid)
        {
            throw new ArgumentException(name.Error, nameof(whishName));
        }

        var number = HousePlanAskRule.NormalizeWhishNumber(whishNumber);
        if (!number.IsValid)
        {
            throw new ArgumentException(number.Error, nameof(whishNumber));
        }

        AskId = ask.Id;
        ClientProfileId = ask.ClientProfileId;
        WhishName = name.Value;
        WhishNumber = number.Value;
        SentOn = sentOn;
        SentAtUtc = sentAtUtc;
    }

    public Guid AskId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    /// <summary>The name on the Whish account the money came from; null once the account was closed.</summary>
    public string? WhishName { get; private set; }

    /// <summary>The Whish number the money came from; null once the account was closed.</summary>
    public string? WhishNumber { get; private set; }

    /// <summary>The house's calendar day when the trainee said it.</summary>
    public DateOnly SentOn { get; private set; }

    public DateTimeOffset SentAtUtc { get; private set; }

    /// <summary>When closing the account erased the name and number (CLI-027); null until then.</summary>
    public DateTimeOffset? AnonymisedAtUtc { get; private set; }

    public static HousePlanTransfer Record(
        Guid tenantId,
        HousePlanAsk ask,
        string whishName,
        string whishNumber,
        DateOnly sentOn,
        DateTimeOffset sentAtUtc) =>
        new(tenantId, ask, whishName, whishNumber, sentOn, sentAtUtc);

    /// <summary>Whether this word was said with these details, as the rule writes them.</summary>
    public bool Matches(string? whishName, string? whishNumber)
    {
        var name = HousePlanAskRule.NormalizeWhishName(whishName);
        var number = HousePlanAskRule.NormalizeWhishNumber(whishNumber);
        return AnonymisedAtUtc is null &&
            name.IsValid && number.IsValid &&
            string.Equals(WhishName, name.Value, StringComparison.Ordinal) &&
            string.Equals(WhishNumber, number.Value, StringComparison.Ordinal);
    }

    /// <summary>Erases the name and number for a closed account (CLI-027); false when already done.</summary>
    public bool Anonymise(DateTimeOffset now)
    {
        if (AnonymisedAtUtc is not null)
        {
            return false;
        }

        WhishName = null;
        WhishNumber = null;
        AnonymisedAtUtc = now;
        return true;
    }
}

/// <summary>How an ask ended: the plan booked with its receipt, or the ask closed by the house's staff.</summary>
public enum HousePlanAskOutcomeKind
{
    Booked = 1,
    Closed = 2,
}

/// <summary>
/// The end of an ask, one at most (SUB-020): the plan booked from a day and its receipt recorded in the same
/// transaction, under the staff's idempotency key; or the ask closed with the staff's reason, which is kept.
/// </summary>
public sealed class HousePlanAskOutcome : TenantEntity
{
    private HousePlanAskOutcome()
    {
    }

    private HousePlanAskOutcome(
        Guid tenantId,
        HousePlanAsk ask,
        HousePlanAskOutcomeKind kind,
        Guid? enrollmentId,
        Guid? paymentRecordId,
        Guid? commandId,
        string? reason,
        Guid decidedByUserId,
        DateOnly decidedOn,
        DateTimeOffset decidedAtUtc)
        : base(tenantId)
    {
        ArgumentNullException.ThrowIfNull(ask);
        if (ask.TenantId != tenantId || decidedByUserId == Guid.Empty)
        {
            throw new ArgumentException("An ask is ended in its own coaching space, by somebody.");
        }

        AskId = ask.Id;
        ClientProfileId = ask.ClientProfileId;
        Kind = kind;
        EnrollmentId = enrollmentId;
        PaymentRecordId = paymentRecordId;
        CommandId = commandId;
        Reason = reason;
        DecidedByUserId = decidedByUserId;
        DecidedOn = decidedOn;
        DecidedAtUtc = decidedAtUtc;
    }

    public Guid AskId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public HousePlanAskOutcomeKind Kind { get; private set; }

    /// <summary>The plan booked; set when <see cref="Kind"/> is Booked alone.</summary>
    public Guid? EnrollmentId { get; private set; }

    /// <summary>Its receipt; set when <see cref="Kind"/> is Booked alone.</summary>
    public Guid? PaymentRecordId { get; private set; }

    /// <summary>The staff's idempotency key for the booking, which the plan and its receipt carry too.</summary>
    public Guid? CommandId { get; private set; }

    /// <summary>Why the ask was closed; set when <see cref="Kind"/> is Closed alone.</summary>
    public string? Reason { get; private set; }

    public Guid DecidedByUserId { get; private set; }

    public DateOnly DecidedOn { get; private set; }

    public DateTimeOffset DecidedAtUtc { get; private set; }

    public static HousePlanAskOutcome Booked(
        Guid tenantId,
        HousePlanAsk ask,
        ClientEnrollment enrollment,
        PaymentRecord receipt,
        Guid decidedByUserId,
        DateOnly decidedOn,
        DateTimeOffset decidedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(ask);
        ArgumentNullException.ThrowIfNull(enrollment);
        ArgumentNullException.ThrowIfNull(receipt);
        if (enrollment.ClientProfileId != ask.ClientProfileId || enrollment.OfferId != ask.OfferId ||
            receipt.EnrollmentId != enrollment.Id || receipt.IdempotencyKey != enrollment.AssignmentCommandId)
        {
            throw new ArgumentException("A booked ask names the plan it asked for and that plan's receipt.");
        }

        return new HousePlanAskOutcome(
            tenantId,
            ask,
            HousePlanAskOutcomeKind.Booked,
            enrollment.Id,
            receipt.Id,
            enrollment.AssignmentCommandId,
            reason: null,
            decidedByUserId,
            decidedOn,
            decidedAtUtc);
    }

    public static HousePlanAskOutcome Closed(
        Guid tenantId,
        HousePlanAsk ask,
        string reason,
        Guid decidedByUserId,
        DateOnly decidedOn,
        DateTimeOffset decidedAtUtc)
    {
        var normalized = HousePlanAskRule.NormalizeReason(reason);
        if (!normalized.IsValid)
        {
            throw new ArgumentException(normalized.Error, nameof(reason));
        }

        return new HousePlanAskOutcome(
            tenantId,
            ask,
            HousePlanAskOutcomeKind.Closed,
            enrollmentId: null,
            paymentRecordId: null,
            commandId: null,
            normalized.Value,
            decidedByUserId,
            decidedOn,
            decidedAtUtc);
    }
}

/// <summary>Where an ask stands, as the trainee and the house's staff read it.</summary>
public enum HousePlanAskState
{
    /// <summary>Asked, and nothing said or decided since.</summary>
    Asked = 1,

    /// <summary>The trainee said they sent the money; the staff have not booked or closed it yet.</summary>
    MoneySent = 2,

    Booked = 3,

    Closed = 4,
}

/// <summary>A typed value as the ask's rule keeps it, or why it is refused.</summary>
public sealed record HousePlanAskText(bool IsValid, string? Value, string? Error)
{
    public static HousePlanAskText Of(string value) => new(true, value, null);

    public static HousePlanAskText Refused(string error) => new(false, null, error);
}

/// <summary>
/// The rule of the house's asks (SUB-020): which plans a trainee may ask for, how the Whish details and a closing
/// reason are kept, which day a booking starts on, and where an ask stands.
/// </summary>
public static class HousePlanAskRule
{
    public const int WhishNameMaximumLength = 100;

    /// <summary>The longest Whish number kept, as the platform's own Whish number allows (PBL-008).</summary>
    public const int WhishNumberMaximumLength = 40;

    public const int WhishNumberMinimumDigits = 6;

    public const int WhishNumberMaximumDigits = 20;

    public const int ReasonMaximumLength = 500;

    public const string NotOnSaleMessage =
        "That plan is not on sale. Reload the page to see the plans TB Gym sells now.";

    public const string WhishNameRefusal =
        "Enter the name on the Whish account you sent the money from, up to 100 characters.";

    public const string WhishNumberRefusal =
        "Enter the Whish number you sent the money from: 6 to 20 digits, with a + in front if you like and spaces between groups.";

    public const string ReasonRefusal = "Say why the ask is closed, up to 500 characters. The trainee reads it.";

    /// <summary>A receipt's reference, as every receipt keeps it (SUB-007).</summary>
    public const int ReferenceMaximumLength = 200;

    public const string ReferenceRefusal = "Keep the reference to 200 characters or fewer.";

    /// <summary>
    /// Whether a trainee may ask for this option of this plan while Max is closed: Pro+ alone (see the overload).
    /// </summary>
    public static bool IsAskable(CoachingProduct product, ProductOffer offer) => IsAskable(product, offer, maxOpen: false);

    /// <summary>
    /// Whether a trainee may ask for this option of this plan: one of the house's paid tiers on sale, priced above
    /// nothing. Max only while <paramref name="maxOpen"/>, that is while the house's Max places are filled and above
    /// zero (SUB-021); an ask for Max is stored even when every place is taken, since a place is held from a booking.
    /// </summary>
    public static bool IsAskable(CoachingProduct product, ProductOffer offer, bool maxOpen)
    {
        ArgumentNullException.ThrowIfNull(product);
        ArgumentNullException.ThrowIfNull(offer);
        return product.Kind == ProductKind.CoachingPlan &&
            (product.HouseTier == HouseTier.ProPlus || (maxOpen && product.HouseTier == HouseTier.Max)) &&
            product.IsActive &&
            offer.IsActive &&
            offer.ProductId == product.Id &&
            offer.SessionCount is null &&
            offer.PriceAmount > 0m;
    }

    /// <summary>
    /// The day a booked plan starts (SUB-020): the house's day the money is recorded, or the day the last plan it cannot
    /// run beside ends on, when that is later, so it follows with no gap and no overlap. <paramref name="paidPlanEndsExclusive"/>
    /// are the exclusive ends of those plans still to end: the trainee's other Pro+ or Max, and any plan holding one of
    /// its features alone.
    /// </summary>
    public static DateOnly BookingStart(DateOnly today, IEnumerable<DateOnly> paidPlanEndsExclusive)
    {
        ArgumentNullException.ThrowIfNull(paidPlanEndsExclusive);
        var start = today;
        foreach (var end in paidPlanEndsExclusive)
        {
            if (end > start)
            {
                start = end;
            }
        }

        return start;
    }

    public static HousePlanAskState State(bool moneySent, HousePlanAskOutcomeKind? outcome) =>
        outcome switch
        {
            HousePlanAskOutcomeKind.Booked => HousePlanAskState.Booked,
            HousePlanAskOutcomeKind.Closed => HousePlanAskState.Closed,
            _ => moneySent ? HousePlanAskState.MoneySent : HousePlanAskState.Asked,
        };

    /// <summary>The name trimmed, inner spaces kept single; 1 to 100 characters, no control characters.</summary>
    public static HousePlanAskText NormalizeWhishName(string? value)
    {
        var text = CollapseSpaces(value);
        return text.Length is > 0 and <= WhishNameMaximumLength && !text.Any(char.IsControl)
            ? HousePlanAskText.Of(text)
            : HousePlanAskText.Refused(WhishNameRefusal);
    }

    /// <summary>
    /// The number as the house writes one: digits in the groups typed, single spaces between them, an optional + in
    /// front; 6 to 20 digits, 40 characters at most. The same form the house's own Whish number is kept in (CLI-023).
    /// </summary>
    public static HousePlanAskText NormalizeWhishNumber(string? value)
    {
        var text = CollapseSpaces(value);
        if (text.Length is 0 or > WhishNumberMaximumLength)
        {
            return HousePlanAskText.Refused(WhishNumberRefusal);
        }

        var body = text.StartsWith('+') ? text[1..].TrimStart() : text;
        var digits = 0;
        foreach (var character in body)
        {
            if (character is >= '0' and <= '9')
            {
                digits++;
            }
            else if (character != ' ')
            {
                return HousePlanAskText.Refused(WhishNumberRefusal);
            }
        }

        if (digits is < WhishNumberMinimumDigits or > WhishNumberMaximumDigits || body.Length == 0)
        {
            return HousePlanAskText.Refused(WhishNumberRefusal);
        }

        return HousePlanAskText.Of(text.StartsWith('+') ? "+" + body : body);
    }

    /// <summary>The reason trimmed; 1 to 500 characters, no control characters but line breaks.</summary>
    public static HousePlanAskText NormalizeReason(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length is > 0 and <= ReasonMaximumLength &&
            !text.Any(character => char.IsControl(character) && character is not ('\n' or '\r'))
            ? HousePlanAskText.Of(text)
            : HousePlanAskText.Refused(ReasonRefusal);
    }

    /// <summary>The staff's own reference for a booking's receipt: trimmed, empty as none, 200 characters at most.</summary>
    public static HousePlanAskText NormalizeReference(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= ReferenceMaximumLength && !text.Any(char.IsControl)
            ? new HousePlanAskText(true, text.Length == 0 ? null : text, null)
            : HousePlanAskText.Refused(ReferenceRefusal);
    }

    /// <summary>"USD 45.00": the money a plan costs, as the refusals name it.</summary>
    public static string Money(decimal amount, string currency) =>
        string.Create(CultureInfo.InvariantCulture, $"{currency} {amount:0.00}");

    private static string CollapseSpaces(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(value.Length);
        var space = false;
        foreach (var character in value.Trim())
        {
            if (char.IsWhiteSpace(character))
            {
                space = true;
                continue;
            }

            if (space)
            {
                builder.Append(' ');
                space = false;
            }

            builder.Append(character);
        }

        return builder.ToString();
    }
}
