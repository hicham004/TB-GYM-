using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A client asks their coach to renew a plan that has run out, or from the day it is ending soon (ADR 0029, critique
/// B14). The request and the coach's in-app notice commit together; PostgreSQL keeps requests at least 7 days apart per client, so a
/// double tap or two requests at once store one request and one notice, and both callers get it back.
/// </summary>
internal sealed class ClientRenewalService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService)
    : IClientRenewalService
{
    public async Task<RenewalStatusView?> GetOwnStatusAsync(CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        if (client is null)
        {
            return null;
        }

        var today = TodayIn(await TimeZoneAsync(cancellationToken));
        return await BuildStatusAsync(client, today, cancellationToken);
    }

    public async Task<RenewalRequestResult> RequestAsync(CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        if (client is null)
        {
            return new RenewalRequestResult(RenewalRequestStatus.NotFound);
        }

        var tenantId = tenantContext.TenantId;
        var timeZoneId = await TimeZoneAsync(cancellationToken);
        var today = TodayIn(timeZoneId);
        var plan = await PlanToRenewAsync(client.Id, today, cancellationToken);
        if (plan is null)
        {
            return new RenewalRequestResult(RenewalRequestStatus.PlanNotEnded);
        }

        if (await OpenRequestAsync(client.Id, today, cancellationToken) is not null)
        {
            return new RenewalRequestResult(
                RenewalRequestStatus.AlreadyRequested,
                await BuildStatusAsync(client, today, cancellationToken));
        }

        var now = clock.UtcNow;
        var request = RenewalRequest.Create(tenantId, client.Id, plan.EnrollmentId, client.AssignedCoachUserId, today, now);
        dbContext.RenewalRequests.Add(request);
        WorkspaceRelationshipNotices.RenewalRequested(
            dbContext, tenantId, timeZoneId, client.AssignedCoachUserId, client.Id, request.Id, now);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.ExclusionViolation,
            ConstraintName: DatabaseConstraintNames.OneRenewalRequestPerWindow,
        })
        {
            // A second tap or a parallel request committed first. Its request and notice stand, and
            // this caller is told about them rather than about a conflict it could do nothing with.
            dbContext.ChangeTracker.Clear();
            return new RenewalRequestResult(
                RenewalRequestStatus.AlreadyRequested,
                await BuildStatusAsync(client, today, cancellationToken));
        }

        return new RenewalRequestResult(
            RenewalRequestStatus.Created,
            await BuildStatusAsync(client, today, cancellationToken));
    }

    private async Task<RenewalStatusView> BuildStatusAsync(
        ClientProfile client,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var plan = await PlanToRenewAsync(client.Id, today, cancellationToken);
        var last = await dbContext.RenewalRequests.AsNoTracking()
            .Where(item => item.ClientProfileId == client.Id)
            .OrderByDescending(item => item.RequestedOn)
            .Select(item => new RenewalRequestView(item.Id, item.RequestedOn, item.AskAgainFrom))
            .FirstOrDefaultAsync(cancellationToken);
        var coachName = plan is null
            ? null
            : await dbContext.Users.AsNoTracking()
                .Where(user => user.Id == client.AssignedCoachUserId)
                .Select(user => user.DisplayName)
                .SingleOrDefaultAsync(cancellationToken);
        return new RenewalStatusView(
            plan is { Ended: true },
            plan is { Ended: true } ? plan.LastDay : null,
            coachName,
            last,
            plan is not null && (last is null || today >= last.AskAgainFrom),
            plan is { Ended: false } ? plan.LastDay : null,
            plan?.EnrollmentId);
    }

    /// <summary>
    /// The plan the client may ask about: the one that ran out, as Today and Clients read it, a pack beside it asking for
    /// nothing (SES-010), else one in its last days (critique B14).
    /// </summary>
    private async Task<PlanToRenew?> PlanToRenewAsync(Guid clientProfileId, DateOnly today, CancellationToken cancellationToken)
    {
        var decisions = await featureAccessService.EvaluateAllAsync(tenantContext.TenantId, clientProfileId, cancellationToken);
        var coachingPlanRanOut = CoachingPlanRunOut.HasPack(decisions) && await CoachingPlanRunOut
            .Among(dbContext.ClientEnrollments.AsNoTracking(), today)
            .AnyAsync(item => item.ClientProfileId == clientProfileId, cancellationToken);
        if (RenewalEligibility.EndedPlan(CoachingPlanRunOut.PlanDecisions(decisions, coachingPlanRanOut)) is { } ended)
        {
            // A Free row that lapsed (its renewal never came, the Worker being down) is not a plan anyone asks to renew:
            // the server renews it, and the house's own ask is for its paid plans (SUB-019).
            return await dbContext.ClientEnrollments.AsNoTracking()
                .AnyAsync(item => item.Id == ended.EnrollmentId && item.HouseTier == HouseTier.Free, cancellationToken)
                ? null
                : new PlanToRenew(ended.EnrollmentId, ended.LastDay, Ended: true);
        }

        var plans = await dbContext.ClientEnrollments.AsNoTracking()
            // The house's Free is never the plan to renew: it renews by itself (SUB-019).
            .Where(item => item.ClientProfileId == clientProfileId &&
                item.HouseTier != HouseTier.Free &&
                item.Status != EnrollmentStatus.Cancelled &&
                item.Status != EnrollmentStatus.Expired &&
                item.EndDateExclusive > today)
            .Select(item => new PlanNotOver(item.Id, item.SessionCountSnapshot != null, item.StartDate, item.EndDateExclusive))
            .ToListAsync(cancellationToken);
        return RenewalEligibility.EndingPlan(decisions, plans, today) is { } ending
            ? new PlanToRenew(ending.EnrollmentId, ending.LastDay, Ended: false)
            : null;
    }

    private Task<RenewalRequest?> OpenRequestAsync(Guid clientProfileId, DateOnly today, CancellationToken cancellationToken) =>
        dbContext.RenewalRequests.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId && item.RequestedOn <= today && today < item.AskAgainFrom)
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<ClientProfile?> FindSelfAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? null
            : await dbContext.ClientProfiles.AsNoTracking().CurrentFor(userId).SingleOrDefaultAsync(cancellationToken);

    private Task<string> TimeZoneAsync(CancellationToken cancellationToken) =>
        dbContext.Tenants.AsNoTracking()
            .Where(tenant => tenant.Id == tenantContext.TenantId)
            .Select(tenant => tenant.TimeZoneId)
            .SingleAsync(cancellationToken);

    /// <summary>The workspace's calendar date: the window is counted in its days, not UTC's.</summary>
    private DateOnly TodayIn(string timeZoneId) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)).DateTime);

    private sealed record PlanToRenew(Guid EnrollmentId, DateOnly LastDay, bool Ended);
}
