using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Issues a month's invoices and queues payment reminders (ADR 0028). Both steps are safe to repeat
/// and to run from several processes at once: a unique index allows one original invoice per workspace
/// and month, and one notice per workspace, kind and invoice, so a second run finds its work done.
/// </summary>
/// <remarks>
/// Each workspace is billed in its own scope and transaction, with that workspace as the tenant
/// context, so one workspace's failure never stops the others and every write passes the ordinary
/// tenant write guard.
/// </remarks>
internal sealed class PlatformInvoiceRun(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<PlatformBillingOptions> options)
    : IPlatformInvoiceRun
{
    private readonly PlatformBillingOptions settings = options.Value;

    public async Task<InvoiceRunOutcome> IssueForMonthAsync(BillingMonth month, CancellationToken cancellationToken)
    {
        if (clock.UtcNow < month.EndUtc)
        {
            throw new InvalidOperationException("A month is invoiced only once it has ended.");
        }

        List<Guid> tenantIds;
        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            tenantIds = await dbContext.Tenants
                .AsNoTracking()
                .Where(tenant => tenant.IsActive && tenant.CreatedAtUtc < month.EndUtc)
                .OrderBy(tenant => tenant.Id)
                .Select(tenant => tenant.Id)
                .ToListAsync(cancellationToken);
        }

        int issued = 0, alreadyIssued = 0, inTrial = 0;
        foreach (var tenantId in tenantIds)
        {
            switch (await IssueOneAsync(tenantId, month, cancellationToken))
            {
                case IssueResult.Issued:
                    issued++;
                    break;
                case IssueResult.AlreadyIssued:
                    alreadyIssued++;
                    break;
                default:
                    inTrial++;
                    break;
            }
        }

        return new InvoiceRunOutcome(month.Start, issued, alreadyIssued, inTrial);
    }

    public async Task<int> QueueRemindersAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var today = PaymentSchedule.Today(now);
        var dueSoonFrom = today.AddDays(settings.DueSoonReminderDays);
        List<(Guid Id, Guid TenantId, DateOnly DueOn)> candidates;
        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            // Across workspaces: the platform itself reads which of its invoices are unpaid.
            candidates = (await dbContext.PlatformInvoices
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(invoice =>
                        invoice.Total > 0m &&
                        invoice.DueOn <= dueSoonFrom &&
                        !dbContext.PlatformInvoiceVoids.IgnoreQueryFilters().Any(item =>
                            item.TenantId == invoice.TenantId && item.InvoiceId == invoice.Id) &&
                        !dbContext.PlatformPayments.IgnoreQueryFilters().Any(item =>
                            item.TenantId == invoice.TenantId && item.InvoiceId == invoice.Id))
                    .Select(invoice => new { invoice.Id, invoice.TenantId, invoice.DueOn })
                    .ToListAsync(cancellationToken))
                .Select(item => (item.Id, item.TenantId, item.DueOn))
                .ToList();
        }

        var queued = 0;
        foreach (var candidate in candidates)
        {
            // A late run never sends "due soon" for an invoice already overdue.
            var kind = today > candidate.DueOn ? WorkspaceNoticeKind.InvoiceOverdue : WorkspaceNoticeKind.InvoiceDueSoon;
            if (await QueueNoticeAsync(candidate.TenantId, kind, candidate.Id, now, cancellationToken))
            {
                queued++;
            }
        }

        return queued;
    }

    private async Task<IssueResult> IssueOneAsync(Guid tenantId, BillingMonth month, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        if (await dbContext.PlatformInvoices.AnyAsync(
                invoice => invoice.PeriodStart == month.Start && invoice.ReplacesInvoiceId == null,
                cancellationToken))
        {
            return IssueResult.AlreadyIssued;
        }

        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantId, cancellationToken)).Single();
        var window = TrialPolicy.BillableWindow(month, PlatformBillingReader.TrialEndsAt(workspace, plans));
        if (window.IsEmpty)
        {
            return IssueResult.InTrial;
        }

        var now = clock.UtcNow;
        var invoice = await PlatformBillingReader.BuildInvoiceAsync(
            dbContext,
            workspace,
            month,
            window,
            plans.MaxBy(plan => plan.VersionNumber)!,
            settings.ReferencePrefix,
            now,
            null,
            cancellationToken);
        dbContext.PlatformInvoices.Add(invoice);
        QueueIssuedNotice(dbContext, workspace, invoice, now);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return IssueResult.Issued;
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // Another run issued it first.
            return IssueResult.AlreadyIssued;
        }
    }

    /// <summary>Tells the owner a new invoice is ready, unless there is nothing to pay.</summary>
    internal static void QueueIssuedNotice(GymDbContext dbContext, BillingWorkspace workspace, PlatformInvoice invoice, DateTimeOffset now)
    {
        if (invoice.Total > 0m && workspace.OwnerUserId is { } ownerUserId)
        {
            dbContext.WorkspaceNoticeMailRequests.Add(WorkspaceNoticeMailRequest.Billing(
                workspace.TenantId,
                WorkspaceNoticeKind.InvoiceIssued,
                ownerUserId,
                invoice.Id,
                now));
        }
    }

    private async Task<bool> QueueNoticeAsync(
        Guid tenantId,
        WorkspaceNoticeKind kind,
        Guid invoiceId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        if (await dbContext.WorkspaceNoticeMailRequests.AnyAsync(
                request => request.Kind == kind && request.SubjectId == invoiceId,
                cancellationToken))
        {
            return false;
        }

        var ownerUserId = await dbContext.TenantMemberships
            .Where(membership =>
                membership.TenantId == tenantId &&
                membership.Role == TenantRole.Owner &&
                membership.Status == MembershipStatus.Active)
            .Select(membership => (Guid?)membership.UserId)
            .SingleOrDefaultAsync(cancellationToken);
        if (ownerUserId is null)
        {
            return false;
        }

        dbContext.WorkspaceNoticeMailRequests.Add(
            WorkspaceNoticeMailRequest.Billing(tenantId, kind, ownerUserId.Value, invoiceId, now));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return false;
        }
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private enum IssueResult
    {
        Issued = 1,
        AlreadyIssued = 2,
        InTrial = 3,
    }
}
