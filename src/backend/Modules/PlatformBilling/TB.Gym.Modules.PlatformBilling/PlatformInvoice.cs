using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.PlatformBilling;

/// <summary>
/// One month's bill for one workspace (ADR 0028). Issued once and never changed: it copies the plan
/// terms and the quantities it was calculated from, and a correction voids it and issues a replacement.
/// Whether it is paid or void lives in separate append-only rows, so the invoice row itself is frozen
/// by a database trigger.
/// </summary>
public sealed class PlatformInvoice : TenantEntity
{
    private PlatformInvoice()
    {
    }

    public Guid PricePlanId { get; private set; }

    public int PricePlanVersion { get; private set; }

    public string CalculationName { get; private set; } = string.Empty;

    public string CurrencyCode { get; private set; } = string.Empty;

    public decimal PlanSeatPrice { get; private set; }

    public int PlanIncludedClientsPerSeat { get; private set; }

    public decimal PlanExtraClientPrice { get; private set; }

    public decimal PlanGymFee { get; private set; }

    public int PlanGymFeeMinimumSeats { get; private set; }

    public DateOnly PeriodStart { get; private set; }

    public DateOnly PeriodEndExclusive { get; private set; }

    /// <summary>Usage counts from here: the month's start, or the end of the trial if later.</summary>
    public DateTimeOffset UsageFromUtc { get; private set; }

    public int Seats { get; private set; }

    public int BillableClients { get; private set; }

    public int IncludedClients { get; private set; }

    public int ExtraClients { get; private set; }

    public decimal SeatAmount { get; private set; }

    public decimal ExtraClientAmount { get; private set; }

    public decimal GymFeeAmount { get; private set; }

    public decimal Subtotal { get; private set; }

    public Guid? DiscountId { get; private set; }

    public decimal DiscountPercent { get; private set; }

    public decimal DiscountAmount { get; private set; }

    public decimal Total { get; private set; }

    public string ReferenceCode { get; private set; } = string.Empty;

    public DateTimeOffset IssuedAtUtc { get; private set; }

    public DateOnly DueOn { get; private set; }

    public DateOnly ReadOnlyFrom { get; private set; }

    /// <summary>The voided invoice this one corrects, when it is a reissue.</summary>
    public Guid? ReplacesInvoiceId { get; private set; }

    public BillingMonth Period => BillingMonth.StartingOn(PeriodStart);

    public static PlatformInvoice Issue(
        Guid tenantId,
        BillingMonth period,
        DateTimeOffset usageFromUtc,
        PlatformPricePlan plan,
        InvoiceAmounts amounts,
        Guid? discountId,
        string referenceCode,
        DateTimeOffset issuedAtUtc,
        Guid? replacesInvoiceId = null)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(amounts);
        if (usageFromUtc < period.StartUtc || usageFromUtc >= period.EndUtc)
        {
            throw new ArgumentOutOfRangeException(nameof(usageFromUtc), "Usage must start inside the billed month.");
        }

        if (issuedAtUtc < period.EndUtc)
        {
            throw new InvalidOperationException("A month is invoiced only once it has ended.");
        }

        var dueOn = PaymentSchedule.DueOn(issuedAtUtc, plan.PaymentTermDays);
        return new PlatformInvoice
        {
            TenantId = tenantId == Guid.Empty ? throw new ArgumentException("A workspace is required.", nameof(tenantId)) : tenantId,
            PricePlanId = plan.Id,
            PricePlanVersion = plan.VersionNumber,
            CalculationName = PlatformInvoiceCalculation.Name,
            CurrencyCode = plan.CurrencyCode,
            PlanSeatPrice = plan.SeatPrice,
            PlanIncludedClientsPerSeat = plan.IncludedClientsPerSeat,
            PlanExtraClientPrice = plan.ExtraClientPrice,
            PlanGymFee = plan.GymFee,
            PlanGymFeeMinimumSeats = plan.GymFeeMinimumSeats,
            PeriodStart = period.Start,
            PeriodEndExclusive = period.EndExclusive,
            UsageFromUtc = usageFromUtc,
            Seats = amounts.Seats,
            BillableClients = amounts.BillableClients,
            IncludedClients = amounts.IncludedClients,
            ExtraClients = amounts.ExtraClients,
            SeatAmount = amounts.SeatAmount,
            ExtraClientAmount = amounts.ExtraClientAmount,
            GymFeeAmount = amounts.GymFeeAmount,
            Subtotal = amounts.Subtotal,
            DiscountId = amounts.DiscountPercent > 0m ? discountId : null,
            DiscountPercent = amounts.DiscountPercent,
            DiscountAmount = amounts.DiscountAmount,
            Total = amounts.Total,
            ReferenceCode = BillingText.Required(referenceCode, 40, nameof(referenceCode)),
            IssuedAtUtc = issuedAtUtc,
            DueOn = dueOn,
            ReadOnlyFrom = PaymentSchedule.ReadOnlyFrom(dueOn, plan.GraceDays),
            ReplacesInvoiceId = replacesInvoiceId,
        };
    }
}

/// <summary>The fact that an invoice was withdrawn, and why. Append-only; at most one per invoice.</summary>
public sealed class PlatformInvoiceVoid : TenantEntity
{
    private PlatformInvoiceVoid()
    {
    }

    public Guid InvoiceId { get; private set; }

    public string Reason { get; private set; } = string.Empty;

    public DateTimeOffset VoidedAtUtc { get; private set; }

    public Guid VoidedByUserId { get; private set; }

    public static PlatformInvoiceVoid Record(PlatformInvoice invoice, string reason, Guid voidedByUserId, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (voidedByUserId == Guid.Empty)
        {
            throw new ArgumentException("The platform admin who voids is required.", nameof(voidedByUserId));
        }

        return new PlatformInvoiceVoid
        {
            TenantId = invoice.TenantId,
            InvoiceId = invoice.Id,
            Reason = BillingText.Required(reason, 500, nameof(reason)),
            VoidedAtUtc = now,
            VoidedByUserId = voidedByUserId,
        };
    }
}

/// <summary>
/// Money received for one invoice, recorded by the platform admin. Append-only, one per invoice, and
/// exactly the invoice total: partial payments, refunds and credit are not supported yet.
/// </summary>
public sealed class PlatformPayment : TenantEntity
{
    private PlatformPayment()
    {
    }

    public Guid InvoiceId { get; private set; }

    public decimal Amount { get; private set; }

    public string CurrencyCode { get; private set; } = string.Empty;

    /// <summary>The Whish or bank transfer reference the admin matched the money with.</summary>
    public string Reference { get; private set; } = string.Empty;

    public string? Note { get; private set; }

    public DateOnly ReceivedOn { get; private set; }

    public DateTimeOffset RecordedAtUtc { get; private set; }

    public Guid RecordedByUserId { get; private set; }

    public static PlatformPayment Record(
        PlatformInvoice invoice,
        decimal amount,
        string reference,
        string? note,
        DateOnly receivedOn,
        Guid recordedByUserId,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (amount != invoice.Total || invoice.Total <= 0m)
        {
            throw new ArgumentException("A payment must be exactly the invoice total.", nameof(amount));
        }

        if (recordedByUserId == Guid.Empty)
        {
            throw new ArgumentException("The platform admin who records is required.", nameof(recordedByUserId));
        }

        return new PlatformPayment
        {
            TenantId = invoice.TenantId,
            InvoiceId = invoice.Id,
            Amount = amount,
            CurrencyCode = invoice.CurrencyCode,
            Reference = BillingText.Required(reference, 100, nameof(reference)),
            Note = BillingText.Optional(note, 500, nameof(note)),
            ReceivedOn = receivedOn,
            RecordedAtUtc = now,
            RecordedByUserId = recordedByUserId,
        };
    }
}

/// <summary>
/// A percentage off a workspace's invoices for a date range, such as a founding-coach offer. Dates are
/// UTC calendar days, half-open <c>[StartsOn, EndsOnExclusive)</c>. It applies to every billed month it
/// touches. It is never edited or deleted; the admin can revoke it once, and the revocation is kept.
/// </summary>
public sealed class WorkspaceDiscount : TenantEntity
{
    private WorkspaceDiscount()
    {
    }

    public decimal Percent { get; private set; }

    public DateOnly StartsOn { get; private set; }

    public DateOnly EndsOnExclusive { get; private set; }

    public string Note { get; private set; } = string.Empty;

    public DateTimeOffset GrantedAtUtc { get; private set; }

    public Guid GrantedByUserId { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    public Guid? RevokedByUserId { get; private set; }

    public bool IsRevoked => RevokedAtUtc is not null;

    public DateTimeOffset StartsAtUtc => new(StartsOn.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    public DateTimeOffset EndsAtUtc => new(EndsOnExclusive.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    public static void ValidatePercent(decimal percent)
    {
        if (percent < 0m || percent > 100m || decimal.Round(percent, 2) != percent)
        {
            throw new ArgumentOutOfRangeException(nameof(percent), "A discount is 0 to 100 percent, to two decimals.");
        }
    }

    public static WorkspaceDiscount Grant(
        Guid tenantId,
        decimal percent,
        DateOnly startsOn,
        DateOnly endsOnExclusive,
        string note,
        Guid grantedByUserId,
        DateTimeOffset now)
    {
        ValidatePercent(percent);
        if (percent == 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(percent), "A discount must take something off.");
        }

        if (endsOnExclusive <= startsOn)
        {
            throw new ArgumentOutOfRangeException(nameof(endsOnExclusive), "A discount must end after it starts.");
        }

        if (tenantId == Guid.Empty || grantedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A workspace and the granting admin are required.");
        }

        return new WorkspaceDiscount
        {
            TenantId = tenantId,
            Percent = percent,
            StartsOn = startsOn,
            EndsOnExclusive = endsOnExclusive,
            Note = BillingText.Required(note, 200, nameof(note)),
            GrantedAtUtc = now,
            GrantedByUserId = grantedByUserId,
        };
    }

    public void Revoke(Guid revokedByUserId, DateTimeOffset now)
    {
        if (IsRevoked)
        {
            throw new InvalidOperationException("This discount was already revoked.");
        }

        RevokedAtUtc = now;
        RevokedByUserId = revokedByUserId;
    }

    /// <summary>
    /// The discount for a billed stretch: the largest unrevoked one that touches it, or none.
    /// </summary>
    public static WorkspaceDiscount? ApplicableTo(IEnumerable<WorkspaceDiscount> discounts, UsageWindow window) =>
        window.IsEmpty
            ? null
            : discounts
                .Where(discount => !discount.IsRevoked && window.Overlaps(discount.StartsAtUtc, discount.EndsAtUtc))
                .OrderByDescending(discount => discount.Percent)
                .ThenBy(discount => discount.GrantedAtUtc)
                .FirstOrDefault();
}
