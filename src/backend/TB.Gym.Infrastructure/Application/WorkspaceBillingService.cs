using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>The owner's Billing page and the coach app's read-only banner (ADR 0028).</summary>
internal sealed class WorkspaceBillingService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IOptions<PlatformBillingOptions> options,
    IOptions<NotificationEmailOptions> email,
    IOptions<WebsiteOptions> website)
    : IWorkspaceBillingService
{
    public async Task<WorkspaceBillingView> GetForOwnerAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantContext.TenantId, cancellationToken)).Single();
        var state = await PlatformBillingReader.StateAsync(dbContext, workspace, plans, now, cancellationToken);
        var today = PaymentSchedule.Today(now);
        var latestPlan = plans.MaxBy(plan => plan.VersionNumber)!;
        return new WorkspaceBillingView(
            state.Status,
            state.TrialEndsAtUtc,
            state.CurrentMonth,
            state.Invoices.Select(item => PlatformBillingReader.ToView(item, today, forAdmin: false)).ToList(),
            state.UnpaidTotal,
            state.CurrentMonth.Amounts.CurrencyCode,
            state.ReadOnlyFrom,
            new PaymentInstructionsView(
                Configured(options.Value.WhishNumber),
                // The support inbox replies reach; it is set only beside a real provider.
                email.Value.UsesProviderAdapter ? Configured(email.Value.Provider.ReplyToAddress) : null,
                Configured(website.Value.WhatsAppNumber)),
            WorkspaceDiscount.RunningOrToCome(state.Discounts, today).Select(discount => ToOwnerView(discount, today)).ToList(),
            // What the owner's seat includes now, during the trial too, against the plan new bills use.
            FoundingSeatPolicy.Raised(state.FoundingSeatNow, latestPlan.IncludedClientsPerSeat),
            IncludedClientGrant.RunningOrToCome(state.Grants, today).Select(grant => ToOwnerView(grant, today)).ToList());
    }

    private static string? Configured(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    // The owner reads a discount's name, rate and days, never who granted or revoked it (notes plan N7).
    private static WorkspaceBillingDiscountView ToOwnerView(WorkspaceDiscount discount, DateOnly today) =>
        new(
            discount.Note,
            discount.Percent,
            discount.StartsOn,
            discount.EndsOnExclusive.AddDays(-1),
            discount.EndsOnExclusive,
            discount.StartsOn > today);

    // The owner reads a grant's clients and months, never its note or who granted it (notes plan N11a).
    private static WorkspaceBillingIncludedClientGrantView ToOwnerView(IncludedClientGrant grant, DateOnly today) =>
        new(
            grant.Clients,
            grant.StartsOn,
            grant.EndsOnExclusive.AddDays(-1),
            grant.EndsOnExclusive,
            grant.StartsOn > today);

    public async Task<WorkspaceBillingAccessView> GetAccessAsync(CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var today = PaymentSchedule.Today(clock.UtcNow);
        var unpaid = await WorkspaceBillingLock.UnpaidInvoices(dbContext, tenantId)
            .Select(invoice => new { invoice.DueOn, invoice.ReadOnlyFrom })
            .ToListAsync(cancellationToken);
        var isReadOnly = unpaid.Any(invoice => invoice.ReadOnlyFrom <= today);
        var isOwner = await dbContext.TenantMemberships.AnyAsync(
            membership =>
                membership.TenantId == tenantId &&
                membership.UserId == currentUser.UserId &&
                membership.Role == TenantRole.Owner &&
                membership.Status == MembershipStatus.Active,
            cancellationToken);

        // A coach learns only that the workspace is read-only; the bill and the founding status are the owner's.
        if (!isOwner)
        {
            return new WorkspaceBillingAccessView(isReadOnly, false, null, null);
        }

        var open = await dbContext.FoundingStatuses
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(status => status.TenantId == tenantId && status.EndedAtUtc == null)
            .SingleOrDefaultAsync(cancellationToken);
        var founding = FoundingBadgePolicy.StateOf(open, today);
        return new WorkspaceBillingAccessView(
            isReadOnly,
            unpaid.Any(invoice => today > invoice.DueOn),
            unpaid.Count == 0 ? null : unpaid.Min(invoice => invoice.ReadOnlyFrom),
            founding is FoundingBadgeState.Waiting or FoundingBadgeState.Earned ? founding : null);
    }

    public async Task<FoundingBadgeView> GetFoundingAsync(CancellationToken cancellationToken) =>
        FoundingReader.ToView(await ReadFoundingAsync(cancellationToken));

    public async Task<BillingCommandResult<FoundingBadgeView>> SetFoundingBadgeHiddenAsync(
        SetFoundingBadgeVisibilityRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Hidden is not { } hidden)
        {
            return BillingCommand.Invalid<FoundingBadgeView>(nameof(request.Hidden), FoundingText.HiddenRequired);
        }

        for (var attempt = 1; ; attempt++)
        {
            dbContext.ChangeTracker.Clear();
            var open = await dbContext.FoundingStatuses
                .Where(status => status.TenantId == tenantContext.TenantId && status.EndedAtUtc == null)
                .SingleOrDefaultAsync(cancellationToken);
            if (open is null)
            {
                return BillingCommand.NotFound<FoundingBadgeView>();
            }

            if (open.BadgeHidden == hidden)
            {
                break;
            }

            open.SetBadgeHidden(hidden);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (DbUpdateConcurrencyException) when (attempt < 3)
            {
                // The check recorded the badge or the admin ended the status meanwhile: read it again.
            }
        }

        return BillingCommand.Success(FoundingReader.ToView(await ReadFoundingAsync(cancellationToken)));
    }

    private async Task<FoundingBadgeReading> ReadFoundingAsync(CancellationToken cancellationToken)
    {
        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantContext.TenantId, cancellationToken)).Single();
        var statuses = await FoundingReader.StatusesAsync(dbContext, workspace.TenantId, cancellationToken);
        var terms = await FoundingReader.CurrentTermsAsync(dbContext, cancellationToken);
        return await FoundingReader.ReadAsync(
            dbContext,
            workspace,
            FoundingReader.Latest(statuses),
            terms,
            clock.UtcNow,
            cancellationToken);
    }
}

/// <summary>
/// Whether an unpaid invoice has made a workspace read-only for its staff. The tenant authorization
/// handler asks this for every state-changing request an owner or coach makes (ADR 0028).
/// </summary>
internal sealed class WorkspaceBillingLock(GymDbContext dbContext, IClock clock)
{
    public Task<bool> IsReadOnlyAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var today = PaymentSchedule.Today(clock.UtcNow);
        return UnpaidInvoices(dbContext, tenantId).AnyAsync(invoice => invoice.ReadOnlyFrom <= today, cancellationToken);
    }

    /// <summary>
    /// Issued, owing money, and neither voided nor paid: the same rule as
    /// <see cref="PlatformInvoiceStatusPolicy.LocksWorkspace"/>, written as one query.
    /// </summary>
    public static IQueryable<PlatformInvoice> UnpaidInvoices(GymDbContext dbContext, Guid tenantId) =>
        dbContext.PlatformInvoices
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invoice =>
                invoice.TenantId == tenantId &&
                invoice.Total > 0m &&
                !dbContext.PlatformInvoiceVoids.IgnoreQueryFilters().Any(item =>
                    item.TenantId == tenantId && item.InvoiceId == invoice.Id) &&
                !dbContext.PlatformPayments.IgnoreQueryFilters().Any(item =>
                    item.TenantId == tenantId && item.InvoiceId == invoice.Id));
}
