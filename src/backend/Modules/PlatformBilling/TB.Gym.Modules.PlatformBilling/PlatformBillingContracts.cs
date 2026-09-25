namespace TB.Gym.Modules.PlatformBilling;

/// <summary>What the workspace owner sees on the Billing page, and what the coach app's banner reads.</summary>
public interface IWorkspaceBillingService
{
    /// <summary>The owner's view: status, this month so far, past invoices and how to pay.</summary>
    Task<WorkspaceBillingView> GetForOwnerAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Whether the workspace is read-only for staff. A coach learns only that; the owner also learns
    /// about an overdue invoice before it locks anything.
    /// </summary>
    Task<WorkspaceBillingAccessView> GetAccessAsync(CancellationToken cancellationToken);
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
    string CurrencyCode);

public sealed record PlatformPaymentView(
    Guid Id,
    Guid InvoiceId,
    decimal Amount,
    string CurrencyCode,
    string Reference,
    string? Note,
    DateOnly ReceivedOn,
    DateTimeOffset RecordedAtUtc);

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
    Guid? ReplacedByInvoiceId);

/// <summary>This month so far: usage up to now, priced with the latest plan. An estimate, not an invoice.</summary>
public sealed record CurrentMonthEstimateView(
    DateOnly PeriodStart,
    DateOnly PeriodEndExclusive,
    DateTimeOffset UsageFromUtc,
    DateTimeOffset UsageToUtc,
    bool InTrial,
    int PricePlanVersion,
    BillingAmountsView Amounts);

/// <summary>How to pay: a Whish number from configuration, and each unpaid invoice's own reference code.</summary>
public sealed record PaymentInstructionsView(string? WhishNumber);

public sealed record WorkspaceBillingView(
    WorkspaceBillingStatus Status,
    DateTimeOffset TrialEndsAtUtc,
    CurrentMonthEstimateView CurrentMonth,
    IReadOnlyList<PlatformInvoiceView> Invoices,
    decimal UnpaidTotal,
    string CurrencyCode,
    DateOnly? ReadOnlyFrom,
    PaymentInstructionsView PaymentInstructions);

public sealed record WorkspaceBillingAccessView(bool IsReadOnly, bool HasOverdueInvoice, DateOnly? ReadOnlyFrom);

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
    decimal CurrentDiscountPercent);

public sealed record WorkspaceDiscountView(
    Guid Id,
    decimal Percent,
    DateOnly StartsOn,
    DateOnly EndsOnExclusive,
    string Note,
    DateTimeOffset GrantedAtUtc,
    DateTimeOffset? RevokedAtUtc);

public sealed record AdminWorkspaceDetail(
    AdminWorkspaceSummary Summary,
    CurrentMonthEstimateView CurrentMonth,
    IReadOnlyList<PlatformInvoiceView> Invoices,
    IReadOnlyList<WorkspaceDiscountView> Discounts);

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
