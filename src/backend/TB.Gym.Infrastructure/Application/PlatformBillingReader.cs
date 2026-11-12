using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Application;

/// <summary>A workspace as billing sees it.</summary>
internal sealed record BillingWorkspace(
    Guid TenantId,
    string Name,
    string TimeZoneId,
    bool IsActive,
    DateTimeOffset CreatedAtUtc,
    Guid? OwnerUserId,
    string OwnerName,
    string OwnerEmail);

/// <summary>One issued invoice with the append-only facts about it.</summary>
internal sealed record InvoiceFacts(
    PlatformInvoice Invoice,
    PlatformInvoiceVoid? Void,
    PlatformPayment? Payment,
    Guid? ReplacedByInvoiceId);

/// <summary>Everything billing knows about one workspace at one instant.</summary>
/// <param name="Grants">Every extra included clients grant of the space, revoked ones included, oldest first.</param>
/// <param name="FoundingSeatNow">The open founding status's seat at this instant, before the plan's seat is compared.</param>
/// <param name="PriceHoldNow">The founding price guarantee running on this instant's UTC day, or null (notes plan N8).</param>
/// <param name="PlanInUse">The price plan version this month's estimate is priced at: the latest, or the one a held price keeps.</param>
internal sealed record WorkspaceBillingState(
    BillingWorkspace Workspace,
    DateTimeOffset TrialEndsAtUtc,
    IReadOnlyList<InvoiceFacts> Invoices,
    IReadOnlyList<WorkspaceDiscount> Discounts,
    CurrentMonthEstimateView CurrentMonth,
    WorkspaceBillingStatus Status,
    decimal UnpaidTotal,
    DateOnly? ReadOnlyFrom,
    DateOnly? OldestUnpaidDueOn,
    IReadOnlyList<IncludedClientGrant> Grants,
    FoundingSeat? FoundingSeatNow,
    FoundingPriceHold? PriceHoldNow,
    PlatformPricePlan PlanInUse);

/// <summary>
/// The reads and the one calculation path platform billing shares between the owner's page, the admin
/// screen and the monthly run (ADR 0028).
/// </summary>
/// <remarks>
/// Every query names its workspace explicitly and ignores the tenant query filter, because the admin
/// screen and the Worker read across workspaces. Each caller is itself authorized for that workspace:
/// the owner by the tenant policy, the admin by the platform-admin policy, the Worker by being the
/// platform.
/// </remarks>
internal static class PlatformBillingReader
{
    public static Task<List<PlatformPricePlan>> PlansAsync(GymDbContext dbContext, CancellationToken cancellationToken) =>
        dbContext.PlatformPricePlans.AsNoTracking().OrderBy(plan => plan.VersionNumber).ToListAsync(cancellationToken);

    public static async Task<List<BillingWorkspace>> WorkspacesAsync(
        GymDbContext dbContext,
        Guid? tenantId,
        CancellationToken cancellationToken)
    {
        var tenants = await dbContext.Tenants
            .AsNoTracking()
            .Where(tenant => tenantId == null || tenant.Id == tenantId)
            .OrderBy(tenant => tenant.Name)
            .Select(tenant => new { tenant.Id, tenant.Name, tenant.TimeZoneId, tenant.IsActive, tenant.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        var ids = tenants.Select(tenant => tenant.Id).ToList();
        var owners = await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
            where ids.Contains(membership.TenantId) &&
                  membership.Role == TenantRole.Owner &&
                  membership.Status == MembershipStatus.Active
            select new { membership.TenantId, user.Id, user.DisplayName, user.Email })
            .ToListAsync(cancellationToken);
        return tenants
            .Select(tenant =>
            {
                var owner = owners.FirstOrDefault(item => item.TenantId == tenant.Id);
                return new BillingWorkspace(
                    tenant.Id,
                    tenant.Name,
                    tenant.TimeZoneId,
                    tenant.IsActive,
                    tenant.CreatedAtUtc,
                    owner?.Id,
                    owner?.DisplayName ?? string.Empty,
                    owner?.Email ?? string.Empty);
            })
            .ToList();
    }

    public static DateTimeOffset TrialEndsAt(BillingWorkspace workspace, IReadOnlyCollection<PlatformPricePlan> plans) =>
        TrialPolicy.EndsAt(workspace.CreatedAtUtc, TrialPolicy.PlanAt(plans, workspace.CreatedAtUtc).TrialDays);

    /// <summary>Seats and billable clients over a window, from membership history, plan coverage and pauses.</summary>
    public static async Task<InvoiceQuantities> CountAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        UsageWindow window,
        CancellationToken cancellationToken)
    {
        var tenantId = workspace.TenantId;
        var changes = await dbContext.MembershipStatusChanges
            .AsNoTracking()
            .Where(change =>
                change.TenantId == tenantId &&
                (change.Role == TenantRole.Owner || change.Role == TenantRole.Coach) &&
                change.ChangedAtUtc < window.End)
            .Select(change => new StaffStatusChange(
                change.MembershipId,
                change.UserId,
                change.Status == MembershipStatus.Active,
                change.ChangedAtUtc))
            .ToListAsync(cancellationToken);

        // A day either side, so a plan whose workspace-local dates touch the window's UTC edges is read;
        // the exact instant comparison happens in the domain rule.
        var fromDate = DateOnly.FromDateTime(window.Start.UtcDateTime).AddDays(-2);
        var toDate = DateOnly.FromDateTime(window.End.UtcDateTime).AddDays(2);
        var enrollments = await (
            from enrollment in dbContext.ClientEnrollments.IgnoreQueryFilters().AsNoTracking()
            join profile in dbContext.ClientProfiles.IgnoreQueryFilters().AsNoTracking()
                on new { enrollment.TenantId, Id = enrollment.ClientProfileId } equals new { profile.TenantId, profile.Id }
            where enrollment.TenantId == tenantId &&
                  enrollment.ActivatedAtUtc != null &&
                  enrollment.ActivatedAtUtc < window.End &&
                  (enrollment.CancelledAtUtc == null || enrollment.CancelledAtUtc > window.Start) &&
                  enrollment.StartDate < toDate &&
                  enrollment.EndDateExclusive > fromDate &&
                  dbContext.EnrollmentEntitlements.IgnoreQueryFilters().Any(entitlement =>
                      entitlement.TenantId == tenantId && entitlement.EnrollmentId == enrollment.Id)
            select new
            {
                enrollment.Id,
                ClientKey = profile.UserId ?? profile.Id,
                enrollment.StartDate,
                enrollment.EndDateExclusive,
                enrollment.ActivatedAtUtc,
                enrollment.CancelledAtUtc,
            })
            .ToListAsync(cancellationToken);
        var enrollmentIds = enrollments.Select(enrollment => enrollment.Id).ToList();
        var pauses = PausePeriod.FromHistory(await dbContext.EnrollmentStatusChanges
            .AsNoTracking()
            .Where(change =>
                change.TenantId == tenantId &&
                enrollmentIds.Contains(change.EnrollmentId) &&
                change.ChangedAtUtc < window.End)
            .Select(change => new EnrollmentStatusStep(
                change.EnrollmentId,
                change.Status == EnrollmentStatus.Paused,
                change.ChangedAtUtc))
            .ToListAsync(cancellationToken));
        var spans = enrollments
            .Select(enrollment => new CoverageSpan(
                enrollment.ClientKey,
                enrollment.StartDate,
                enrollment.EndDateExclusive,
                enrollment.ActivatedAtUtc,
                enrollment.CancelledAtUtc,
                pauses.GetValueOrDefault(enrollment.Id)))
            .ToList();

        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(workspace.TimeZoneId);
        return new InvoiceQuantities(
            Math.Max(1, SeatCounter.Count(changes, window)),
            BillableClientCounter.Count(spans, window, timeZone));
    }

    public static Task<List<WorkspaceDiscount>> DiscountsAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.WorkspaceDiscounts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(discount => discount.TenantId == tenantId)
            .OrderBy(discount => discount.StartsOn)
            .ToListAsync(cancellationToken);

    /// <summary>A space's extra included clients grants, revoked ones included, oldest first (notes plan N11a).</summary>
    public static Task<List<IncludedClientGrant>> GrantsAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.IncludedClientGrants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(grant => grant.TenantId == tenantId)
            .OrderBy(grant => grant.StartsOn)
            .ThenBy(grant => grant.GrantedAtUtc)
            .ToListAsync(cancellationToken);

    /// <summary>Every published founding terms version, oldest first: a founding seat keeps the highest number it has had.</summary>
    public static Task<List<FoundingTerms>> FoundingTermsVersionsAsync(GymDbContext dbContext, CancellationToken cancellationToken) =>
        dbContext.FoundingTermsVersions.AsNoTracking().OrderBy(terms => terms.VersionNumber).ToListAsync(cancellationToken);

    /// <summary>
    /// Counts usage and prices it: the one path an invoice or a reissue is built through. The founding seat
    /// and the grants are read over the billed window, as the discount is, as they stand now: the seat takes
    /// the highest number its status had while it ran, up to now (PBL-011).
    /// </summary>
    /// <param name="plans">Every published price plan version.</param>
    /// <param name="keptPlan">
    /// Null for a month's first invoice: it is priced at the latest version, or for a founding space whose
    /// price is held at the version <see cref="FoundingPricePolicy"/> bills (PBL-012). A reissue passes its
    /// voided invoice's plan and keeps it.
    /// </param>
    public static async Task<PlatformInvoice> BuildInvoiceAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        BillingMonth month,
        UsageWindow window,
        IReadOnlyList<PlatformPricePlan> plans,
        PlatformPricePlan? keptPlan,
        string referencePrefix,
        DateTimeOffset now,
        Guid? replacesInvoiceId,
        CancellationToken cancellationToken)
    {
        var quantities = await CountAsync(dbContext, workspace, window, cancellationToken);
        var discounts = await DiscountsAsync(dbContext, workspace.TenantId, cancellationToken);
        var discount = WorkspaceDiscount.ApplicableTo(discounts, window);
        var statuses = await FoundingReader.StatusesAsync(dbContext, workspace.TenantId, cancellationToken);
        var versions = await FoundingTermsVersionsAsync(dbContext, cancellationToken);
        var grants = await GrantsAsync(dbContext, workspace.TenantId, cancellationToken);
        var includedClients = IncludedClientSources.For(statuses, versions, grants, window, now);
        var percent = discount?.Percent ?? 0m;
        var priced = keptPlan is null
            ? FoundingPricePolicy.Price(
                plans,
                FoundingPricePolicy.For(statuses, versions, discounts, plans, window),
                quantities,
                includedClients,
                percent)
            : new PricedUsage(keptPlan, PlatformInvoiceCalculation.Calculate(keptPlan.Terms, quantities, includedClients, percent));
        return PlatformInvoice.Issue(
            workspace.TenantId,
            month,
            window.Start,
            priced.Plan,
            priced.Amounts,
            discount?.Id,
            includedClients,
            InvoiceReference.Create(referencePrefix, month),
            now,
            replacesInvoiceId);
    }

    public static async Task<List<InvoiceFacts>> InvoicesAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var invoices = await dbContext.PlatformInvoices
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invoice => invoice.TenantId == tenantId)
            .OrderByDescending(invoice => invoice.PeriodStart)
            .ThenByDescending(invoice => invoice.IssuedAtUtc)
            .ToListAsync(cancellationToken);
        var voids = await dbContext.PlatformInvoiceVoids
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId)
            .ToDictionaryAsync(item => item.InvoiceId, cancellationToken);
        var payments = await dbContext.PlatformPayments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.TenantId == tenantId)
            .ToDictionaryAsync(item => item.InvoiceId, cancellationToken);
        var replacements = invoices
            .Where(invoice => invoice.ReplacesInvoiceId is not null)
            .ToDictionary(invoice => invoice.ReplacesInvoiceId!.Value, invoice => invoice.Id);
        return invoices
            .Select(invoice => new InvoiceFacts(
                invoice,
                voids.GetValueOrDefault(invoice.Id),
                payments.GetValueOrDefault(invoice.Id),
                replacements.TryGetValue(invoice.Id, out var replacement) ? replacement : null))
            .ToList();
    }

    public static async Task<WorkspaceBillingState> StateAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        IReadOnlyList<PlatformPricePlan> plans,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var trialEndsAt = TrialEndsAt(workspace, plans);
        var invoices = await InvoicesAsync(dbContext, workspace.TenantId, cancellationToken);
        var discounts = await DiscountsAsync(dbContext, workspace.TenantId, cancellationToken);
        var statuses = await FoundingReader.StatusesAsync(dbContext, workspace.TenantId, cancellationToken);
        var versions = await FoundingTermsVersionsAsync(dbContext, cancellationToken);
        var grants = await GrantsAsync(dbContext, workspace.TenantId, cancellationToken);
        var (estimate, planInUse) = await EstimateAsync(
            dbContext,
            workspace,
            plans,
            discounts,
            (statuses, versions, grants),
            trialEndsAt,
            now,
            cancellationToken);
        var today = PaymentSchedule.Today(now);
        var unpaid = invoices.Where(item => IsUnpaid(item)).ToList();
        var status = PlatformInvoiceStatusPolicy.Workspace(
            unpaid.Any(item => PlatformInvoiceStatusPolicy.LocksWorkspace(item.Invoice.Total, item.Invoice.ReadOnlyFrom, false, false, today)),
            unpaid.Any(item => today > item.Invoice.DueOn),
            now < trialEndsAt);
        return new WorkspaceBillingState(
            workspace,
            trialEndsAt,
            invoices,
            discounts,
            estimate,
            status,
            unpaid.Sum(item => item.Invoice.Total),
            unpaid.Count == 0 ? null : unpaid.Min(item => item.Invoice.ReadOnlyFrom),
            unpaid.Count == 0 ? null : unpaid.Min(item => item.Invoice.DueOn),
            grants,
            FoundingSeatPolicy.Now(statuses, versions, now),
            FoundingPricePolicy.On(statuses, versions, discounts, plans, today),
            planInUse);
    }

    /// <summary>
    /// What the owner's seat includes now as a founding space: the founding number while it raises the seat of
    /// the plan this month is priced at, the trial included; null otherwise (PBL-011).
    /// </summary>
    public static int? FoundingSeatIncludedClients(WorkspaceBillingState state) =>
        FoundingSeatPolicy.Raised(state.FoundingSeatNow, state.PlanInUse.IncludedClientsPerSeat);

    /// <summary>The founding price guarantee running today as the admin reads it, or null (PBL-012).</summary>
    public static FoundingPriceHoldView? PriceHoldView(WorkspaceBillingState state) =>
        state.PriceHoldNow is { } hold ? new FoundingPriceHoldView(hold.Plan.VersionNumber, hold.LastDay) : null;

    public static bool IsUnpaid(InvoiceFacts facts) =>
        facts.Void is null && facts.Payment is null && facts.Invoice.Total > 0m;

    /// <summary>
    /// This month so far, priced as its invoice will be: with the latest plan, or for a founding space whose
    /// price is held with the version <see cref="FoundingPricePolicy"/> bills (PBL-012). While the whole of it
    /// is inside the trial, the counts are shown and nothing is charged. The discount, the founding seat, the
    /// grants and the held price are read over the rest of the month, as the invoice will read them over the
    /// whole of it. Returns the estimate and the plan version it used.
    /// </summary>
    private static async Task<(CurrentMonthEstimateView Estimate, PlatformPricePlan Plan)> EstimateAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        IReadOnlyList<PlatformPricePlan> plans,
        IReadOnlyList<WorkspaceDiscount> discounts,
        (IReadOnlyList<FoundingStatus> Statuses, IReadOnlyList<FoundingTerms> Versions, IReadOnlyList<IncludedClientGrant> Grants) founding,
        DateTimeOffset trialEndsAt,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var month = BillingMonth.Containing(now);
        var window = TrialPolicy.BillableWindow(month, trialEndsAt, now);
        if (window.IsEmpty)
        {
            // Nothing is priced yet. The version named is the one the month's invoice would start from: the
            // held one while a hold touches what is left of the month after the trial, or the whole month.
            var afterTrial = new UsageWindow(trialEndsAt > month.StartUtc ? trialEndsAt : month.StartUtc, month.EndUtc);
            var plan = FoundingPricePolicy.Unbilled(
                plans,
                FoundingPricePolicy.For(
                    founding.Statuses,
                    founding.Versions,
                    discounts,
                    plans,
                    afterTrial.IsEmpty ? new UsageWindow(month.StartUtc, month.EndUtc) : afterTrial));
            var soFar = new UsageWindow(month.StartUtc, now > month.StartUtc ? now : month.StartUtc.AddTicks(1));
            var counted = await CountAsync(dbContext, workspace, soFar, cancellationToken);
            var inTrial = new CurrentMonthEstimateView(
                month.Start,
                month.EndExclusive,
                soFar.Start,
                soFar.End,
                true,
                plan.VersionNumber,
                new BillingAmountsView(
                    Seats: counted.Seats,
                    BillableClients: counted.BillableClients,
                    IncludedClients: 0,
                    ExtraClients: 0,
                    SeatAmount: 0m,
                    ExtraClientAmount: 0m,
                    GymFeeAmount: 0m,
                    Subtotal: 0m,
                    DiscountPercent: 0m,
                    DiscountAmount: 0m,
                    Total: 0m,
                    CurrencyCode: plan.CurrencyCode,
                    SeatIncludedClients: 0,
                    FoundingIncludedClients: 0,
                    GrantedIncludedClients: 0),
                FoundingTermsVersion: null);
            return (inTrial, plan);
        }

        var quantities = await CountAsync(dbContext, workspace, window, cancellationToken);
        var restOfMonth = new UsageWindow(window.Start, month.EndUtc);
        var discount = WorkspaceDiscount.ApplicableTo(discounts, restOfMonth);
        var includedClients = IncludedClientSources.For(founding.Statuses, founding.Versions, founding.Grants, restOfMonth, now);
        var priced = FoundingPricePolicy.Price(
            plans,
            FoundingPricePolicy.For(founding.Statuses, founding.Versions, discounts, plans, restOfMonth),
            quantities,
            includedClients,
            discount?.Percent ?? 0m);
        var estimate = new CurrentMonthEstimateView(
            month.Start,
            month.EndExclusive,
            window.Start,
            window.End,
            false,
            priced.Plan.VersionNumber,
            ToView(priced.Amounts, priced.Plan.CurrencyCode),
            includedClients.FoundingSeat?.TermsVersion);
        return (estimate, priced.Plan);
    }

    public static BillingAmountsView ToView(InvoiceAmounts amounts, string currencyCode) => new(
        amounts.Seats,
        amounts.BillableClients,
        amounts.IncludedClients,
        amounts.ExtraClients,
        amounts.SeatAmount,
        amounts.ExtraClientAmount,
        amounts.GymFeeAmount,
        amounts.Subtotal,
        amounts.DiscountPercent,
        amounts.DiscountAmount,
        amounts.Total,
        currencyCode,
        amounts.SeatIncludedClients,
        amounts.FoundingIncludedClients,
        amounts.GrantedIncludedClients);

    public static PlatformInvoiceView ToView(InvoiceFacts facts, DateOnly today, bool forAdmin)
    {
        var invoice = facts.Invoice;
        var isVoid = facts.Void is not null;
        var isPaid = facts.Payment is not null;
        return new PlatformInvoiceView(
            invoice.Id,
            invoice.ReferenceCode,
            invoice.PeriodStart,
            invoice.PeriodEndExclusive,
            invoice.UsageFromUtc,
            invoice.IssuedAtUtc,
            invoice.DueOn,
            invoice.ReadOnlyFrom,
            invoice.PricePlanVersion,
            invoice.CalculationName,
            invoice.PlanSeatPrice,
            invoice.PlanIncludedClientsPerSeat,
            invoice.PlanExtraClientPrice,
            invoice.PlanGymFee,
            invoice.PlanGymFeeMinimumSeats,
            new BillingAmountsView(
                invoice.Seats,
                invoice.BillableClients,
                invoice.IncludedClients,
                invoice.ExtraClients,
                invoice.SeatAmount,
                invoice.ExtraClientAmount,
                invoice.GymFeeAmount,
                invoice.Subtotal,
                invoice.DiscountPercent,
                invoice.DiscountAmount,
                invoice.Total,
                invoice.CurrencyCode,
                // The sources as the invoice recorded them; a v1 invoice holds no founding seat and no grant.
                checked(invoice.Seats * invoice.PlanIncludedClientsPerSeat),
                FoundingSeatPolicy.AddedOver(invoice.FoundingSeatIncludedClients, invoice.PlanIncludedClientsPerSeat),
                invoice.GrantedIncludedClients),
            PlatformInvoiceStatusPolicy.Evaluate(invoice.Total, invoice.DueOn, isVoid, isPaid, today),
            PlatformInvoiceStatusPolicy.LocksWorkspace(invoice.Total, invoice.ReadOnlyFrom, isVoid, isPaid, today),
            facts.Payment is { } payment ? ToView(payment, forAdmin) : null,
            facts.Void?.VoidedAtUtc,
            facts.Void?.Reason,
            invoice.ReplacesInvoiceId,
            facts.ReplacedByInvoiceId,
            invoice.FoundingSeatIncludedClients,
            invoice.FoundingTermsVersion,
            invoice.GrantedIncludedClients);
    }

    /// <summary>The admin's own note stays on the admin screen; the owner sees the payment itself.</summary>
    public static PlatformPaymentView ToView(PlatformPayment payment, bool forAdmin) => new(
        payment.Id,
        payment.InvoiceId,
        payment.Amount,
        payment.CurrencyCode,
        payment.Reference,
        forAdmin ? payment.Note : null,
        payment.ReceivedOn,
        payment.RecordedAtUtc);

    public static WorkspaceDiscountView ToView(WorkspaceDiscount discount) => new(
        discount.Id,
        discount.Percent,
        discount.StartsOn,
        discount.EndsOnExclusive,
        discount.Note,
        discount.GrantedAtUtc,
        discount.RevokedAtUtc);

    /// <summary>The admin's view of a grant, with its note: never the owner's.</summary>
    public static IncludedClientGrantView ToView(IncludedClientGrant grant) => new(
        grant.Id,
        grant.Clients,
        grant.StartsOn,
        grant.EndsOnExclusive,
        grant.Note,
        grant.GrantedAtUtc,
        grant.RevokedAtUtc);

    public static Task LockInvoiceAsync(GymDbContext dbContext, Guid invoiceId, CancellationToken cancellationToken) =>
        dbContext.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM billing."Invoices" WHERE "Id" = {invoiceId} FOR UPDATE /* platform-billing */""",
            cancellationToken);

    /// <summary>
    /// Locks a space's open founding status, when it has one, until the transaction ends: a grant then waits
    /// for another grant and for an end of the status, so a double press finds the first grant, and a grant
    /// never lands on a status that ended meanwhile.
    /// </summary>
    public static Task LockOpenFoundingStatusAsync(GymDbContext dbContext, Guid tenantId, CancellationToken cancellationToken) =>
        dbContext.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM billing."FoundingStatuses" WHERE "TenantId" = {tenantId} AND "EndedAtUtc" IS NULL FOR UPDATE /* platform-billing */""",
            cancellationToken);
}
