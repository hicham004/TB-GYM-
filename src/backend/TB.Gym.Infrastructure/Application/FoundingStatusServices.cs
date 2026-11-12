using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The founding status's reads (notes plan N3a, decision 15, 5 Nov 2026), shared by the admin's screens,
/// the owner's read, the client's coach card and the check, so all of them read one badge the same way.
/// </summary>
/// <remarks>
/// Like <see cref="PlatformBillingReader"/>, every query names its workspace explicitly and ignores the
/// tenant query filter; each caller is itself authorized for that workspace.
/// </remarks>
internal static class FoundingReader
{
    /// <summary>The terms in force: the latest published version. The migration seeds version 1.</summary>
    public static async Task<FoundingTerms> CurrentTermsAsync(GymDbContext dbContext, CancellationToken cancellationToken) =>
        await dbContext.FoundingTermsVersions
            .AsNoTracking()
            .OrderByDescending(terms => terms.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken)
        ?? throw new InvalidOperationException("No founding badge terms have been published.");

    /// <summary>A space's founding statuses, newest first.</summary>
    public static Task<List<FoundingStatus>> StatusesAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.FoundingStatuses
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(status => status.TenantId == tenantId)
            .OrderByDescending(status => status.MarkedAtUtc)
            .ThenByDescending(status => status.Id)
            .ToListAsync(cancellationToken);

    /// <summary>The open status, or else the one that ended last.</summary>
    public static FoundingStatus? Latest(IReadOnlyCollection<FoundingStatus> statuses) =>
        statuses.FirstOrDefault(status => !status.IsEnded)
        ?? statuses.Where(status => status.IsEnded).MaxBy(status => status.EndedAtUtc);

    /// <summary>
    /// Clients with an active plan at this instant: counted as billing counts its clients (coverage paid or
    /// free, a pack's too, not paused), over a window of now alone rather than the month so far, so a plan
    /// that ended earlier this month does not count.
    /// </summary>
    /// <remarks>
    /// The window is one microsecond, not one tick: <see cref="PlatformBillingReader.CountAsync"/> compares
    /// its end in SQL, and PostgreSQL keeps microseconds, so a one-tick end would fall back onto now and
    /// miss a plan activated, or a pause recorded, in the same microsecond.
    /// </remarks>
    public static async Task<int> ClientsWithActivePlanAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        DateTimeOffset now,
        CancellationToken cancellationToken) =>
        (await PlatformBillingReader.CountAsync(
                dbContext,
                workspace,
                new UsageWindow(now, now.AddTicks(TimeSpan.TicksPerMicrosecond)),
                cancellationToken))
            .BillableClients;

    /// <summary>The badge's reading today; the clients are counted only for a waiting space.</summary>
    public static async Task<FoundingBadgeReading> ReadAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        FoundingStatus? latest,
        FoundingTerms terms,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var today = PaymentSchedule.Today(now);
        int? clients = FoundingBadgePolicy.StateOf(latest, today) == FoundingBadgeState.Waiting
            ? await ClientsWithActivePlanAsync(dbContext, workspace, now, cancellationToken)
            : null;
        return FoundingBadgePolicy.Read(latest, terms, workspace.CreatedAtUtc, clients, today);
    }

    /// <summary>The admin's view of a space: its open status with the live reading, and the ended ones.</summary>
    public static async Task<(AdminFoundingView? Open, IReadOnlyList<FoundingStatusView> History)> ForAdminAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        WorkspaceBillingState state,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var statuses = await StatusesAsync(dbContext, workspace.TenantId, cancellationToken);
        var history = statuses
            .Where(status => status.IsEnded)
            .OrderByDescending(status => status.EndedAtUtc)
            .Select(ToView)
            .ToList();
        var open = statuses.FirstOrDefault(status => !status.IsEnded);
        if (open is null)
        {
            return (null, history);
        }

        var terms = await CurrentTermsAsync(dbContext, cancellationToken);
        var reading = await ReadAsync(dbContext, workspace, open, terms, now, cancellationToken);
        return (
            new AdminFoundingView(ToView(open), ToView(reading), PlatformBillingReader.FoundingSeatIncludedClients(state)),
            history);
    }

    /// <summary>
    /// What a status's owner seat includes now (notes plan N11a): the highest founding number an open status
    /// has had, when that raises the seat of the plan this month is priced at (the held one for a held price,
    /// notes plan N8); null otherwise, and for an ended status.
    /// </summary>
    public static async Task<int?> SeatIncludedClientsAsync(
        GymDbContext dbContext,
        BillingWorkspace workspace,
        FoundingStatus status,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (status.IsEnded)
        {
            return null;
        }

        var plans = await PlatformBillingReader.PlansAsync(dbContext, cancellationToken);
        var state = await PlatformBillingReader.StateAsync(dbContext, workspace, plans, now, cancellationToken);
        return PlatformBillingReader.FoundingSeatIncludedClients(state);
    }

    /// <summary>
    /// Whether a client's assigned coach shows them the badge: the space's active owner, whose open
    /// status has earned it and is not hidden.
    /// </summary>
    public static async Task<bool> ShowsBadgeToClientsAsync(
        GymDbContext dbContext,
        Guid tenantId,
        Guid coachUserId,
        CancellationToken cancellationToken) =>
        await dbContext.TenantMemberships.AsNoTracking().AnyAsync(
            membership =>
                membership.TenantId == tenantId &&
                membership.UserId == coachUserId &&
                membership.Role == TenantRole.Owner &&
                membership.Status == MembershipStatus.Active,
            cancellationToken) &&
        await dbContext.FoundingStatuses.IgnoreQueryFilters().AsNoTracking().AnyAsync(
            status =>
                status.TenantId == tenantId &&
                status.EndedAtUtc == null &&
                status.EarnedOn != null &&
                !status.BadgeHidden,
            cancellationToken);

    public static FoundingBadgeView ToView(FoundingBadgeReading reading) => new(
        reading.State,
        reading.FoundingSince,
        reading.ClientsWithActivePlan,
        reading.ClientsNeeded,
        reading.MonthsSinceStart,
        reading.MonthsNeeded,
        reading.TermsVersion,
        reading.EarnedOn,
        reading.EndedOn,
        reading.Hidden);

    public static FoundingStatusView ToView(FoundingStatus status) => new(
        status.Id,
        status.FoundingSince,
        status.Note,
        status.MarkedAtUtc,
        status.EarnedOn,
        status.EarnedUnderTermsVersion,
        status.EarnedClientCount,
        status.BadgeHidden,
        status.EndedAtUtc,
        status.EndReason);

    public static FoundingTermsView ToView(FoundingTerms terms, bool isCurrent) => new(
        terms.Id,
        terms.VersionNumber,
        terms.ClientsWithActivePlan,
        terms.MonthsSinceStart,
        terms.Note,
        terms.PublishedAtUtc,
        isCurrent,
        terms.FoundingSeatIncludedClients,
        terms.PriceGuaranteeMonths);

    public static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}

/// <summary>
/// The platform admin's founding-status operations. Every endpoint reaching this is behind the
/// platform-admin policy; an operation on one space sets it as the request's tenant context first, so
/// its writes pass the ordinary tenant write guard, as the discount's do.
/// </summary>
internal sealed class FoundingAdminService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext)
    : IFoundingAdminService
{
    private const int EndAttempts = 3;

    public async Task<BillingCommandResult<AdminFoundingView>> MarkAsync(
        Guid tenantId,
        MarkFoundingRequest request,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var errors = new Dictionary<string, string[]>();
        if (request.FoundingSince is not { } foundingSince)
        {
            errors[nameof(request.FoundingSince)] = [FoundingText.FoundingSinceRequired];
        }
        else if (foundingSince > PaymentSchedule.Today(now))
        {
            errors[nameof(request.FoundingSince)] = [FoundingText.FoundingSinceInvalid];
        }
        else if (foundingSince < FoundingText.EarliestFoundingSince)
        {
            errors[nameof(request.FoundingSince)] = [FoundingText.FoundingSinceTooEarly];
        }

        var note = request.Note?.Trim() ?? string.Empty;
        if (note.Length is 0 or > FoundingText.NoteMaxLength)
        {
            errors[nameof(request.Note)] = [FoundingText.NoteInvalid];
        }

        if (errors.Count > 0)
        {
            return BillingCommand.Invalid<AdminFoundingView>(errors);
        }

        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantId, cancellationToken)).SingleOrDefault();
        if (workspace is null)
        {
            return BillingCommand.NotFound<AdminFoundingView>();
        }

        tenantContext.SetTenant(tenantId);
        if (await dbContext.FoundingStatuses.AnyAsync(status => status.EndedAtUtc == null, cancellationToken))
        {
            return Exists();
        }

        var marked = FoundingStatus.Mark(tenantId, request.FoundingSince!.Value, note, RequiredAdmin(), now);
        dbContext.FoundingStatuses.Add(marked);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (FoundingReader.IsUniqueViolation(exception))
        {
            // Another admin marked the space a moment earlier: one open status per space.
            return Exists();
        }

        return BillingCommand.Success(await ViewAsync(workspace, marked, now, cancellationToken));
    }

    public async Task<BillingCommandResult<AdminFoundingView>> EndAsync(
        Guid foundingId,
        EndFoundingRequest request,
        CancellationToken cancellationToken)
    {
        var reason = request.Reason?.Trim() ?? string.Empty;
        if (reason.Length is 0 or > FoundingText.EndReasonMaxLength)
        {
            return BillingCommand.Invalid<AdminFoundingView>(nameof(request.Reason), FoundingText.EndReasonInvalid);
        }

        var tenantId = await dbContext.FoundingStatuses
            .IgnoreQueryFilters()
            .Where(status => status.Id == foundingId)
            .Select(status => (Guid?)status.TenantId)
            .SingleOrDefaultAsync(cancellationToken);
        if (tenantId is null)
        {
            return BillingCommand.NotFound<AdminFoundingView>();
        }

        tenantContext.SetTenant(tenantId.Value);
        for (var attempt = 1; ; attempt++)
        {
            dbContext.ChangeTracker.Clear();
            var status = await dbContext.FoundingStatuses.SingleAsync(item => item.Id == foundingId, cancellationToken);
            if (status.IsEnded)
            {
                return BillingCommand.Conflict<AdminFoundingView>(FoundingText.EndedCode, FoundingText.Ended);
            }

            var now = clock.UtcNow;
            status.End(reason, RequiredAdmin(), now);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException) when (attempt < EndAttempts)
            {
                // The check recorded the badge, the owner changed their switch or another admin ended it
                // meanwhile: read the row again, so an end keeps whatever was written first.
                continue;
            }

            var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantId.Value, cancellationToken)).Single();
            return BillingCommand.Success(await ViewAsync(workspace, status, now, cancellationToken));
        }
    }

    public async Task<IReadOnlyList<FoundingTermsView>> ListTermsAsync(CancellationToken cancellationToken)
    {
        var versions = await dbContext.FoundingTermsVersions
            .AsNoTracking()
            .OrderByDescending(terms => terms.VersionNumber)
            .ToListAsync(cancellationToken);
        var current = versions.Count == 0 ? 0 : versions.Max(terms => terms.VersionNumber);
        return versions.Select(terms => FoundingReader.ToView(terms, terms.VersionNumber == current)).ToList();
    }

    public async Task<BillingCommandResult<FoundingTermsView>> PublishTermsAsync(
        PublishFoundingTermsRequest request,
        CancellationToken cancellationToken)
    {
        // A version can never be changed, so a number left out is refused, never read as 0. Any number
        // stands in for a missing one in the range check; its error is replaced below.
        var terms = new FoundingBadgeTerms(request.ClientsWithActivePlan ?? 1, request.MonthsSinceStart ?? 0);
        var errors = terms.Validate().ToDictionary();
        if (request.ClientsWithActivePlan is null)
        {
            errors[nameof(request.ClientsWithActivePlan)] = [FoundingText.TermsClientsRequired];
        }

        if (request.MonthsSinceStart is null)
        {
            errors[nameof(request.MonthsSinceStart)] = [FoundingText.TermsMonthsRequired];
        }

        if (request.ExpectedCurrentVersion is null)
        {
            errors[nameof(request.ExpectedCurrentVersion)] = [FoundingText.ExpectedVersionRequired];
        }

        // The founding seat's number (notes plan N11a). Its key is required, so a request that left it out
        // never reached here; null is the admin's "none": the plan's seat.
        if (!FoundingSeatPolicy.IsValidIncludedClients(request.FoundingSeatIncludedClients))
        {
            errors[nameof(request.FoundingSeatIncludedClients)] = [FoundingText.TermsSeatIncludedClientsInvalid];
        }

        // The price guarantee's months (notes plan N8), required the same way; null is "none": nothing held.
        if (!FoundingPricePolicy.IsValidMonths(request.PriceGuaranteeMonths))
        {
            errors[nameof(request.PriceGuaranteeMonths)] = [FoundingText.TermsPriceGuaranteeMonthsInvalid];
        }

        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note is { Length: > FoundingText.TermsNoteMaxLength })
        {
            errors[nameof(request.Note)] = [FoundingText.TermsNoteInvalid];
        }

        if (errors.Count > 0)
        {
            return BillingCommand.Invalid<FoundingTermsView>(errors);
        }

        var current = await dbContext.FoundingTermsVersions.MaxAsync(item => (int?)item.VersionNumber, cancellationToken) ?? 0;
        if (current != request.ExpectedCurrentVersion)
        {
            return TermsChanged();
        }

        var published = FoundingTerms.Publish(
            current + 1,
            terms,
            request.FoundingSeatIncludedClients,
            request.PriceGuaranteeMonths,
            note,
            RequiredAdmin(),
            clock.UtcNow);
        dbContext.FoundingTermsVersions.Add(published);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (FoundingReader.IsUniqueViolation(exception))
        {
            return TermsChanged();
        }

        return BillingCommand.Success(FoundingReader.ToView(published, isCurrent: true));
    }

    private async Task<AdminFoundingView> ViewAsync(
        BillingWorkspace workspace,
        FoundingStatus status,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var terms = await FoundingReader.CurrentTermsAsync(dbContext, cancellationToken);
        var reading = await FoundingReader.ReadAsync(dbContext, workspace, status, terms, now, cancellationToken);
        return new AdminFoundingView(
            FoundingReader.ToView(status),
            FoundingReader.ToView(reading),
            await FoundingReader.SeatIncludedClientsAsync(dbContext, workspace, status, now, cancellationToken));
    }

    private Guid RequiredAdmin() =>
        currentUser.UserId ?? throw new InvalidOperationException("A platform admin operation needs a signed-in admin.");

    private static BillingCommandResult<AdminFoundingView> Exists() =>
        BillingCommand.Conflict<AdminFoundingView>(FoundingText.ExistsCode, FoundingText.Exists);

    private static BillingCommandResult<FoundingTermsView> TermsChanged() =>
        BillingCommand.Conflict<FoundingTermsView>(FoundingText.TermsChangedCode, FoundingText.TermsChanged);
}

/// <summary>
/// Records the Founding coach badge, once, for every open founding status whose space meets the terms in
/// force today (<see cref="FoundingBadgePolicy"/>). The Worker's billing sweep runs it every tick and the
/// admin runs it on demand; there is no daily schedule, and a repeat finds its work done.
/// </summary>
/// <remarks>
/// Each space is read and written in its own scope with that space as the tenant context, so every write
/// passes the ordinary tenant write guard. Two checks at once write a badge once: the row's version makes
/// the slower save fail, and the database refuses a second earned day.
/// </remarks>
internal sealed class FoundingBadgeCheck(IServiceScopeFactory scopeFactory, IClock clock) : IFoundingBadgeCheck
{
    public async Task<FoundingCheckOutcome> RunAsync(CancellationToken cancellationToken)
    {
        List<(Guid Id, Guid TenantId)> waiting;
        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            // Across spaces: the platform itself reads which of its founding statuses still wait.
            waiting = (await dbContext.FoundingStatuses
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(status => status.EndedAtUtc == null && status.EarnedOn == null)
                    .OrderBy(status => status.TenantId)
                    .Select(status => new { status.Id, status.TenantId })
                    .ToListAsync(cancellationToken))
                .Select(status => (status.Id, status.TenantId))
                .ToList();
        }

        var earned = 0;
        foreach (var (id, tenantId) in waiting)
        {
            if (await CheckOneAsync(id, tenantId, cancellationToken))
            {
                earned++;
            }
        }

        return new FoundingCheckOutcome(waiting.Count, earned);
    }

    private async Task<bool> CheckOneAsync(Guid statusId, Guid tenantId, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var status = await dbContext.FoundingStatuses.SingleOrDefaultAsync(item => item.Id == statusId, cancellationToken);
        if (status is null || status.IsEnded || status.IsEarned)
        {
            return false;
        }

        var now = clock.UtcNow;
        var workspace = (await PlatformBillingReader.WorkspacesAsync(dbContext, tenantId, cancellationToken)).Single();
        var terms = await FoundingReader.CurrentTermsAsync(dbContext, cancellationToken);
        var reading = await FoundingReader.ReadAsync(dbContext, workspace, status, terms, now, cancellationToken);
        if (!reading.IsDue)
        {
            return false;
        }

        status.RecordEarned(
            PaymentSchedule.Today(now),
            terms,
            reading.ClientsWithActivePlan!.Value,
            reading.MonthsSinceStart!.Value);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Ended, hidden or earned by another check meanwhile: the next sweep reads it again.
            return false;
        }
    }
}
