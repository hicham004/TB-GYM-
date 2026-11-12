using System.Text.Json.Serialization;

namespace TB.Gym.Modules.PlatformBilling;

/// <summary>What the workspace owner sees on the Billing page, and what the coach app's banner reads.</summary>
public interface IWorkspaceBillingService
{
    /// <summary>The owner's view: status, this month so far, past invoices and how to pay.</summary>
    Task<WorkspaceBillingView> GetForOwnerAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Whether the workspace is read-only for staff. A coach learns only that; the owner also learns
    /// about an overdue invoice before it locks anything, and whether the space is founding.
    /// </summary>
    Task<WorkspaceBillingAccessView> GetAccessAsync(CancellationToken cancellationToken);

    /// <summary>The owner's own space's Founding coach badge, read under the terms in force.</summary>
    Task<FoundingBadgeView> GetFoundingAsync(CancellationToken cancellationToken);

    /// <summary>The owner's switch: hide the badge from their clients, or show it again.</summary>
    Task<BillingCommandResult<FoundingBadgeView>> SetFoundingBadgeHiddenAsync(
        SetFoundingBadgeVisibilityRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// The platform admin's founding-status operations (decision 15, 5 Nov 2026). Every method is authorized
/// by the platform-admin policy. Marking or ending never touches a discount, and a discount never
/// touches the status.
/// </summary>
public interface IFoundingAdminService
{
    Task<BillingCommandResult<AdminFoundingView>> MarkAsync(
        Guid tenantId,
        MarkFoundingRequest request,
        CancellationToken cancellationToken);

    Task<BillingCommandResult<AdminFoundingView>> EndAsync(
        Guid foundingId,
        EndFoundingRequest request,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<FoundingTermsView>> ListTermsAsync(CancellationToken cancellationToken);

    Task<BillingCommandResult<FoundingTermsView>> PublishTermsAsync(
        PublishFoundingTermsRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// Records the Founding coach badge for every open founding status whose space meets the terms in force
/// today (<see cref="FoundingBadgePolicy"/>). The Worker runs it on every billing sweep and the admin runs
/// it on demand; it writes each badge once, so a repeat finds its work done.
/// </summary>
public interface IFoundingBadgeCheck
{
    Task<FoundingCheckOutcome> RunAsync(CancellationToken cancellationToken);
}

/// <summary>Everything the platform admin does. Every method is authorized by the platform-admin policy.</summary>
public interface IPlatformBillingAdminService
{
    Task<IReadOnlyList<AdminWorkspaceSummary>> ListWorkspacesAsync(CancellationToken cancellationToken);

    Task<AdminWorkspaceDetail?> GetWorkspaceAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PricePlanView>> ListPricePlansAsync(CancellationToken cancellationToken);

    Task<BillingCommandResult<PricePlanView>> PublishPricePlanAsync(
        PublishPricePlanRequest request,
        CancellationToken cancellationToken);

    Task<BillingCommandResult<PlatformPaymentView>> RecordPaymentAsync(
        Guid invoiceId,
        RecordPlatformPaymentRequest request,
        CancellationToken cancellationToken);

    Task<BillingCommandResult<VoidInvoiceResponse>> VoidInvoiceAsync(
        Guid invoiceId,
        VoidInvoiceRequest request,
        CancellationToken cancellationToken);

    Task<BillingCommandResult<WorkspaceDiscountView>> GrantDiscountAsync(
        Guid tenantId,
        GrantDiscountRequest request,
        CancellationToken cancellationToken);

    Task<BillingCommandResult<WorkspaceDiscountView>> RevokeDiscountAsync(
        Guid discountId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Grants a founding space extra included clients for whole UTC calendar months (notes plan N11a,
    /// decision 17). The same clients, days and note sent again answer the grant that exists.
    /// </summary>
    Task<BillingCommandResult<IncludedClientGrantView>> GrantIncludedClientsAsync(
        Guid tenantId,
        GrantIncludedClientsRequest request,
        CancellationToken cancellationToken);

    /// <summary>Revokes a grant, once; invoices already issued keep it.</summary>
    Task<BillingCommandResult<IncludedClientGrantView>> RevokeIncludedClientGrantAsync(
        Guid grantId,
        CancellationToken cancellationToken);
}

/// <summary>
/// Issues the previous month's invoices and queues payment reminders. The Worker runs it on a timer;
/// the admin can run the invoice step by hand. Both steps are idempotent.
/// </summary>
public interface IPlatformInvoiceRun
{
    Task<InvoiceRunOutcome> IssueForMonthAsync(BillingMonth month, CancellationToken cancellationToken);

    Task<int> QueueRemindersAsync(CancellationToken cancellationToken);
}

/// <param name="SeatIncludedClients">The included clients the seats bring: seats times the plan's per-seat number.</param>
/// <param name="FoundingIncludedClients">
/// What a founding seat adds over the plan's seat, for the owner's seat alone (notes plan N11a); 0 when none.
/// </param>
/// <param name="GrantedIncludedClients">The clients of the extra included clients grants counted; 0 when none.</param>
/// <remarks>The three add up to <see cref="IncludedClients"/>, so a screen adds nothing up.</remarks>
public sealed record BillingAmountsView(
    int Seats,
    int BillableClients,
    int IncludedClients,
    int ExtraClients,
    decimal SeatAmount,
    decimal ExtraClientAmount,
    decimal GymFeeAmount,
    decimal Subtotal,
    decimal DiscountPercent,
    decimal DiscountAmount,
    decimal Total,
    string CurrencyCode,
    int SeatIncludedClients,
    int FoundingIncludedClients,
    int GrantedIncludedClients);

public sealed record PlatformPaymentView(
    Guid Id,
    Guid InvoiceId,
    decimal Amount,
    string CurrencyCode,
    string Reference,
    string? Note,
    DateOnly ReceivedOn,
    DateTimeOffset RecordedAtUtc);

/// <param name="FoundingSeatIncludedClients">
/// The founding terms' number of clients the owner's seat included, when a founding seat applied (notes plan
/// N11a); null with <see cref="FoundingTermsVersion"/> when none did.
/// </param>
/// <param name="FoundingTermsVersion">The founding terms version that number came from.</param>
/// <param name="GrantedIncludedClients">The clients of the extra included clients grants it counted; 0 when none.</param>
public sealed record PlatformInvoiceView(
    Guid Id,
    string ReferenceCode,
    DateOnly PeriodStart,
    DateOnly PeriodEndExclusive,
    DateTimeOffset UsageFromUtc,
    DateTimeOffset IssuedAtUtc,
    DateOnly DueOn,
    DateOnly ReadOnlyFrom,
    int PricePlanVersion,
    string CalculationName,
    decimal PlanSeatPrice,
    int PlanIncludedClientsPerSeat,
    decimal PlanExtraClientPrice,
    decimal PlanGymFee,
    int PlanGymFeeMinimumSeats,
    BillingAmountsView Amounts,
    PlatformInvoiceStatus Status,
    bool LocksWorkspace,
    PlatformPaymentView? Payment,
    DateTimeOffset? VoidedAtUtc,
    string? VoidReason,
    Guid? ReplacesInvoiceId,
    Guid? ReplacedByInvoiceId,
    int? FoundingSeatIncludedClients,
    int? FoundingTermsVersion,
    int GrantedIncludedClients);

/// <summary>
/// This month so far: usage up to now, priced with the latest plan, or for a founding space whose price is
/// held with the version the invoice would use (<see cref="FoundingPricePolicy"/>, notes plan N8). An estimate,
/// not an invoice.
/// </summary>
/// <param name="FoundingTermsVersion">
/// The founding terms version whose number the estimate's founding seat took (notes plan N11a); null when no
/// founding seat counts, and while the whole month so far is inside the trial.
/// </param>
public sealed record CurrentMonthEstimateView(
    DateOnly PeriodStart,
    DateOnly PeriodEndExclusive,
    DateTimeOffset UsageFromUtc,
    DateTimeOffset UsageToUtc,
    bool InTrial,
    int PricePlanVersion,
    BillingAmountsView Amounts,
    int? FoundingTermsVersion);

/// <summary>
/// How to pay: a Whish number from configuration, and each unpaid invoice's own reference code. While
/// no Whish number is set, TB Gym's support inbox and WhatsApp number, when configured, are how the
/// owner asks for the payment details (audit BILL-2). Each is null when not configured.
/// </summary>
public sealed record PaymentInstructionsView(string? WhishNumber, string? SupportEmail, string? WhatsAppNumber);

/// <summary>
/// A discount as the owner's Billing page names it (notes plan N7). The admin's note is its name. Days
/// are UTC: <see cref="LastDay"/> is the last one it covers and <see cref="EndsOnExclusive"/> the day
/// after, so the page can tell a discount that starts the day another ends without counting days.
/// <see cref="StartsLater"/> says it has not begun on the server's day.
/// </summary>
public sealed record WorkspaceBillingDiscountView(
    string Name,
    decimal Percent,
    DateOnly StartsOn,
    DateOnly LastDay,
    DateOnly EndsOnExclusive,
    bool StartsLater);

/// <summary>
/// Extra included clients as the owner's Billing page names them (notes plan N11a): never the admin's note.
/// Days are UTC, whole calendar months: <see cref="LastDay"/> is the last one it covers and
/// <see cref="EndsOnExclusive"/> the day after. <see cref="StartsLater"/> says it has not begun on the
/// server's day.
/// </summary>
public sealed record WorkspaceBillingIncludedClientGrantView(
    int Clients,
    DateOnly StartsOn,
    DateOnly LastDay,
    DateOnly EndsOnExclusive,
    bool StartsLater);

/// <param name="Discounts">
/// The unrevoked discounts that are running or still to come, oldest first (notes plan N7). One that
/// has ended shows only on the invoices it touched.
/// </param>
/// <param name="FoundingSeatIncludedClients">
/// What the owner's seat includes now as a founding space (notes plan N11a): the founding number, while the
/// space's founding status is open and the number raises the plan's seat, the trial included; null otherwise.
/// </param>
/// <param name="IncludedClientGrants">
/// The unrevoked extra included clients grants running or still to come, oldest first. One that has ended
/// shows only on the invoices it touched.
/// </param>
/// <param name="PricesHeldUntil">
/// The last day of the space's founding price guarantee (notes plan N8), a UTC day, while its founding status
/// is open and that day has not passed; null otherwise. Until then a newer price plan never raises its bill.
/// </param>
public sealed record WorkspaceBillingView(
    WorkspaceBillingStatus Status,
    DateTimeOffset TrialEndsAtUtc,
    CurrentMonthEstimateView CurrentMonth,
    IReadOnlyList<PlatformInvoiceView> Invoices,
    decimal UnpaidTotal,
    string CurrencyCode,
    DateOnly? ReadOnlyFrom,
    PaymentInstructionsView PaymentInstructions,
    IReadOnlyList<WorkspaceBillingDiscountView> Discounts,
    int? FoundingSeatIncludedClients,
    IReadOnlyList<WorkspaceBillingIncludedClientGrantView> IncludedClientGrants,
    DateOnly? PricesHeldUntil);

/// <param name="FoundingCoach">
/// For the owner of a founding space, <see cref="FoundingBadgeState.Waiting"/> or
/// <see cref="FoundingBadgeState.Earned"/> (hidden or not), so their Settings can offer the badge's page;
/// null otherwise, and always null for a coach.
/// </param>
public sealed record WorkspaceBillingAccessView(
    bool IsReadOnly,
    bool HasOverdueInvoice,
    DateOnly? ReadOnlyFrom,
    FoundingBadgeState? FoundingCoach);

/// <summary>
/// One workspace as the platform admin's list shows it. <see cref="OldestUnpaidDueOn"/> and
/// <see cref="ReadOnlyFrom"/> come from the workspace's unpaid invoices (the earliest of each), so the
/// list can say what falls due next and when the workspace becomes read-only; both are null when
/// nothing is owed. <see cref="IsFounding"/> says it has an open founding status, and
/// <see cref="BadgeEarnedOn"/> the day that status earned its badge.
/// </summary>
public sealed record AdminWorkspaceSummary(
    Guid TenantId,
    string Name,
    string OwnerName,
    string OwnerEmail,
    DateTimeOffset CreatedAtUtc,
    WorkspaceBillingStatus Status,
    DateTimeOffset TrialEndsAtUtc,
    int SeatsThisMonth,
    int BillableClientsThisMonth,
    decimal UnpaidTotal,
    string CurrencyCode,
    decimal CurrentDiscountPercent,
    DateOnly? OldestUnpaidDueOn,
    DateOnly? ReadOnlyFrom,
    bool IsFounding,
    DateOnly? BadgeEarnedOn);

public sealed record WorkspaceDiscountView(
    Guid Id,
    decimal Percent,
    DateOnly StartsOn,
    DateOnly EndsOnExclusive,
    string Note,
    DateTimeOffset GrantedAtUtc,
    DateTimeOffset? RevokedAtUtc);

/// <summary>One extra included clients grant as recorded, for the platform admin alone (notes plan N11a).</summary>
public sealed record IncludedClientGrantView(
    Guid Id,
    int Clients,
    DateOnly StartsOn,
    DateOnly EndsOnExclusive,
    string Note,
    DateTimeOffset GrantedAtUtc,
    DateTimeOffset? RevokedAtUtc);

/// <param name="Founding">The open founding status with its live reading, or null.</param>
/// <param name="FoundingHistory">The ended founding statuses, newest first.</param>
/// <param name="IncludedClientGrants">Every extra included clients grant, newest first, the revoked ones kept.</param>
/// <param name="PriceHold">The founding price guarantee running today (notes plan N8), or null.</param>
public sealed record AdminWorkspaceDetail(
    AdminWorkspaceSummary Summary,
    CurrentMonthEstimateView CurrentMonth,
    IReadOnlyList<PlatformInvoiceView> Invoices,
    IReadOnlyList<WorkspaceDiscountView> Discounts,
    AdminFoundingView? Founding,
    IReadOnlyList<FoundingStatusView> FoundingHistory,
    IReadOnlyList<IncludedClientGrantView> IncludedClientGrants,
    FoundingPriceHoldView? PriceHold);

/// <summary>
/// A founding space's price guarantee as it stands today (<see cref="FoundingPricePolicy"/>, notes plan N8):
/// the price plan version it is held at, the one in force on its founding day, and the guarantee's last day,
/// a UTC day. While it runs the space is billed at that version, or at the latest when that totals less.
/// </summary>
public sealed record FoundingPriceHoldView(int PricePlanVersion, DateOnly LastDay);

/// <summary>
/// A space's Founding coach badge on today's UTC day (<see cref="FoundingBadgePolicy"/>), with the terms
/// in force. Neither the admin's note nor an end's reason is in it: the owner reads this too.
/// </summary>
/// <param name="ClientsWithActivePlan">Clients with an active plan right now, counted while waiting.</param>
/// <param name="MonthsSinceStart">Whole months since the space started, counted while waiting.</param>
/// <param name="Hidden">The owner hid the badge from their clients; only while the status is open.</param>
public sealed record FoundingBadgeView(
    FoundingBadgeState State,
    DateOnly? FoundingSince,
    int? ClientsWithActivePlan,
    int ClientsNeeded,
    int? MonthsSinceStart,
    int MonthsNeeded,
    int TermsVersion,
    DateOnly? EarnedOn,
    DateOnly? EndedOn,
    bool Hidden);

/// <summary>One founding status as recorded, for the platform admin alone.</summary>
public sealed record FoundingStatusView(
    Guid Id,
    DateOnly FoundingSince,
    string Note,
    DateTimeOffset MarkedAtUtc,
    DateOnly? EarnedOn,
    int? EarnedUnderTermsVersion,
    int? EarnedClientCount,
    bool BadgeHidden,
    DateTimeOffset? EndedAtUtc,
    string? EndReason);

/// <param name="FoundingSeatIncludedClients">
/// The clients the owner's seat includes now while this status stays open (notes plan N11a): the highest
/// founding number it has had, null when no number applies or when it does not raise the plan's seat.
/// </param>
public sealed record AdminFoundingView(
    FoundingStatusView Status,
    FoundingBadgeView Badge,
    int? FoundingSeatIncludedClients);

/// <param name="FoundingSeatIncludedClients">
/// The clients a founding space's owner seat includes under this version (notes plan N11a), or null for none:
/// the plan's seat.
/// </param>
/// <param name="PriceGuaranteeMonths">
/// The months a founding space keeps its founding day's prices after its last discount ends under this
/// version (notes plan N8), or null for none: nothing is held.
/// </param>
public sealed record FoundingTermsView(
    Guid Id,
    int VersionNumber,
    int ClientsWithActivePlan,
    int MonthsSinceStart,
    string? Note,
    DateTimeOffset PublishedAtUtc,
    bool IsCurrent,
    int? FoundingSeatIncludedClients,
    int? PriceGuaranteeMonths);

/// <param name="FoundingSince">A UTC day, today or earlier.</param>
public sealed record MarkFoundingRequest(DateOnly? FoundingSince, string Note);

public sealed record EndFoundingRequest(string Reason);

/// <summary>
/// New founding terms. <see cref="ExpectedCurrentVersion"/> is the version the admin saw, so two admins
/// publishing at once conflict instead of one silently replacing the other. Every number is required:
/// a version is immutable, so a field left out is refused rather than read as 0.
/// </summary>
/// <param name="FoundingSeatIncludedClients">
/// The clients a founding space's owner seat includes (notes plan N11a), 0 to 1,000, or null on purpose
/// for none: the plan's seat. The key is required, so a request that leaves it out is refused by the JSON
/// reader (400) and publishes nothing, never read as none: a page or a call that predates the number cannot
/// drop every founding seat from the next invoice.
/// </param>
/// <param name="PriceGuaranteeMonths">
/// The months of the founding price guarantee (notes plan N8), 0 to 120, or null on purpose for none: nothing
/// is held. Required like the seat's number, for the same reason: a call that predates it cannot end every
/// founding space's held prices by leaving it out.
/// </param>
public sealed record PublishFoundingTermsRequest(
    int? ClientsWithActivePlan,
    int? MonthsSinceStart,
    string? Note,
    int? ExpectedCurrentVersion,
    [property: JsonRequired] int? FoundingSeatIncludedClients,
    [property: JsonRequired] int? PriceGuaranteeMonths);

/// <param name="Hidden">Required: true hides the badge from the owner's clients, false shows it.</param>
public sealed record SetFoundingBadgeVisibilityRequest(bool? Hidden);

/// <summary>How many open, unearned founding statuses one check read, and how many it found earned.</summary>
public sealed record FoundingCheckOutcome(int Checked, int Earned);

public sealed record PricePlanView(
    Guid Id,
    int VersionNumber,
    string CurrencyCode,
    decimal SeatPrice,
    int IncludedClientsPerSeat,
    decimal ExtraClientPrice,
    decimal GymFee,
    int GymFeeMinimumSeats,
    int TrialDays,
    int PaymentTermDays,
    int GraceDays,
    string? Note,
    DateTimeOffset PublishedAtUtc,
    bool IsCurrent);

/// <summary>
/// A new plan version. <see cref="ExpectedCurrentVersion"/> is the version the admin saw, so two admins
/// publishing at once conflict instead of one silently replacing the other.
/// </summary>
public sealed record PublishPricePlanRequest(
    decimal SeatPrice,
    int IncludedClientsPerSeat,
    decimal ExtraClientPrice,
    decimal GymFee,
    int GymFeeMinimumSeats,
    int TrialDays,
    int PaymentTermDays,
    int GraceDays,
    int ExpectedCurrentVersion,
    string? Note);

public sealed record RecordPlatformPaymentRequest(decimal Amount, string Reference, string? Note, DateOnly? ReceivedOn);

public sealed record VoidInvoiceRequest(string Reason, bool Reissue);

public sealed record VoidInvoiceResponse(PlatformInvoiceView Voided, PlatformInvoiceView? Reissued);

public sealed record GrantDiscountRequest(decimal Percent, DateOnly StartsOn, DateOnly EndsOnExclusive, string Note);

/// <summary>
/// Extra included clients for a founding space (notes plan N11a): whole UTC calendar months, so
/// <see cref="StartsOn"/> and <see cref="EndsOnExclusive"/> (the day after the last) are each the first day
/// of a month; the note says what it is for, such as which coach was brought, and only TB Gym's admin reads it.
/// </summary>
public sealed record GrantIncludedClientsRequest(int Clients, DateOnly StartsOn, DateOnly EndsOnExclusive, string Note);

public sealed record IssueInvoicesRequest(DateOnly? PeriodStart);

public sealed record InvoiceRunOutcome(DateOnly PeriodStart, int Issued, int AlreadyIssued, int InTrial);

public sealed record BillingCommandResult<T>(
    BillingCommandStatus Status,
    T? Value = default,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public static class BillingCommand
{
    public static BillingCommandResult<T> Success<T>(T value) => new(BillingCommandStatus.Success, value);

    public static BillingCommandResult<T> NotFound<T>() => new(BillingCommandStatus.NotFound);

    public static BillingCommandResult<T> Invalid<T>(string field, string message) =>
        new(BillingCommandStatus.Invalid, Errors: new Dictionary<string, string[]> { [field] = [message] });

    public static BillingCommandResult<T> Invalid<T>(IReadOnlyDictionary<string, string[]> errors) =>
        new(BillingCommandStatus.Invalid, Errors: errors);

    public static BillingCommandResult<T> Conflict<T>(string code, string message) =>
        new(BillingCommandStatus.Conflict, Code: code, Message: message);
}

public enum BillingCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
}
