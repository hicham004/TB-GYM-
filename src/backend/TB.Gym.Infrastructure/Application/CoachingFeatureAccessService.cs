using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class CoachingFeatureAccessService(
    GymDbContext dbContext,
    IClock clock,
    ITenantContext tenantContext)
    : ICoachingFeatureAccessService
{
    public async Task<FeatureAccessDecision> EvaluateAsync(
        Guid tenantId,
        Guid clientProfileId,
        CoachingFeature feature,
        CancellationToken cancellationToken)
    {
        var decisions = await EvaluateAllAsync(tenantId, clientProfileId, cancellationToken);
        return decisions.Single(item => item.Feature == feature);
    }

    public async Task<IReadOnlyList<FeatureAccessDecision>> EvaluateAllAsync(
        Guid tenantId,
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        (await EvaluateManyAsync(tenantId, [clientProfileId], cancellationToken))[clientProfileId];

    /// <remarks>
    /// One client is a batch of one, so every feature is decided by this one path. The checks run in
    /// the same order for each client, and each is a single query however many clients are asked
    /// about, so a coach's list of clients costs what one client does.
    /// </remarks>
    public async Task<IReadOnlyDictionary<Guid, IReadOnlyList<FeatureAccessDecision>>> EvaluateManyAsync(
        Guid tenantId,
        IReadOnlyCollection<Guid> clientProfileIds,
        CancellationToken cancellationToken)
    {
        var ids = clientProfileIds.Distinct().ToArray();
        var decisions = new Dictionary<Guid, IReadOnlyList<FeatureAccessDecision>>(ids.Length);
        foreach (var id in ids)
        {
            decisions[id] = ForEveryFeature(FeatureAccessReason.MembershipInactive);
        }

        if (ids.Length == 0 || !tenantContext.HasTenant || tenantContext.TenantId != tenantId)
        {
            return decisions;
        }

        // An ended relationship grants nothing, even when the same person has since been invited back:
        // their membership is active again, but for their new profile, not this one (ADR 0027).
        var clients = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(item => ids.Contains(item.Id) && item.UserId != null && item.ReleasedAtUtc == null)
            .Select(item => new { item.Id, UserId = item.UserId!.Value, item.IsCoachBlocked })
            .ToListAsync(cancellationToken);
        if (clients.Count == 0)
        {
            return decisions;
        }

        var userIds = clients.Select(item => item.UserId).Distinct().ToArray();
        var activeUserIds = await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
            where membership.TenantId == tenantId &&
                  userIds.Contains(membership.UserId) &&
                  membership.Role == TenantRole.Client &&
                  membership.Status == MembershipStatus.Active &&
                  tenant.IsActive
            select membership.UserId)
            .ToHashSetAsync(cancellationToken);
        var members = clients.Where(item => activeUserIds.Contains(item.UserId)).ToArray();
        if (members.Length == 0)
        {
            return decisions;
        }

        var memberUserIds = members.Select(item => item.UserId).Distinct().ToArray();
        var platformBlocked = await dbContext.Users
            .AsNoTracking()
            .Where(user => memberUserIds.Contains(user.Id) && user.IsPlatformBlocked)
            .Select(user => user.Id)
            .ToHashSetAsync(cancellationToken);
        var entitled = new List<Guid>(members.Length);
        foreach (var client in members)
        {
            if (platformBlocked.Contains(client.UserId))
            {
                decisions[client.Id] = ForEveryFeature(FeatureAccessReason.PlatformBlocked);
            }
            else if (client.IsCoachBlocked)
            {
                decisions[client.Id] = ForEveryFeature(FeatureAccessReason.RelationshipBlocked);
            }
            else
            {
                entitled.Add(client.Id);
            }
        }

        if (entitled.Count == 0)
        {
            return decisions;
        }

        var tenantSettings = await dbContext.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => new { tenant.TimeZoneId })
            .SingleAsync(cancellationToken);
        var localNow = TimeZoneInfo.ConvertTime(
            clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(tenantSettings.TimeZoneId));
        var tenantToday = DateOnly.FromDateTime(localNow.DateTime);

        var entitledIds = entitled.ToArray();
        var candidates = (await (
            from entitlement in dbContext.EnrollmentEntitlements.AsNoTracking()
            join enrollment in dbContext.ClientEnrollments.AsNoTracking()
                on new { entitlement.TenantId, Id = entitlement.EnrollmentId }
                equals new { enrollment.TenantId, enrollment.Id }
            where entitledIds.Contains(entitlement.ClientProfileId)
            select new
            {
                entitlement.ClientProfileId,
                Candidate = new AccessCandidate(
                    entitlement.Feature,
                    enrollment.Id,
                    enrollment.StartDate,
                    enrollment.EndDateExclusive,
                    enrollment.Status,
                    enrollment.PriceAmount,
                    dbContext.PaymentRecords
                        .Where(payment =>
                            payment.EnrollmentId == enrollment.Id &&
                            payment.Operation == PaymentOperation.Receipt)
                        .Sum(payment => (decimal?)payment.Amount) ?? 0m),
            })
            .ToListAsync(cancellationToken))
            .ToLookup(item => item.ClientProfileId, item => item.Candidate);

        foreach (var clientProfileId in entitledIds)
        {
            var clientCandidates = candidates[clientProfileId].ToArray();
            decisions[clientProfileId] = Enum.GetValues<CoachingFeature>()
                .Select(feature => EvaluateFeature(feature, clientCandidates, tenantToday))
                .ToArray();
        }

        return decisions;
    }

    private static FeatureAccessDecision EvaluateFeature(
        CoachingFeature feature,
        IReadOnlyList<AccessCandidate> allCandidates,
        DateOnly tenantToday)
    {
        var candidates = allCandidates
            .Where(item => item.Feature == feature)
            .OrderByDescending(item => item.StartDate)
            .ToArray();

        var current = candidates
            .Where(item => item.StartDate <= tenantToday && tenantToday < item.EndDateExclusive)
            .ToArray();

        var granted = current.FirstOrDefault(item =>
            item.Status == EnrollmentStatus.Active && item.PaidAmount >= item.PriceAmount);
        if (granted is not null)
        {
            return Decision(feature, true, FeatureAccessReason.Granted, granted);
        }

        var paused = current.FirstOrDefault(item => item.Status == EnrollmentStatus.Paused);
        if (paused is not null)
        {
            return Decision(feature, false, FeatureAccessReason.Paused, paused);
        }

        var unpaid = current.FirstOrDefault(item =>
            item.Status == EnrollmentStatus.PendingPayment || item.PaidAmount < item.PriceAmount);
        if (unpaid is not null)
        {
            return Decision(feature, false, FeatureAccessReason.PaymentRequired, unpaid);
        }

        var cancelledCurrent = current.FirstOrDefault(item => item.Status == EnrollmentStatus.Cancelled);
        if (cancelledCurrent is not null)
        {
            return Decision(feature, false, FeatureAccessReason.Cancelled, cancelledCurrent);
        }

        var future = candidates
            .Where(item =>
                item.StartDate > tenantToday &&
                item.Status is EnrollmentStatus.Active or EnrollmentStatus.PendingPayment or EnrollmentStatus.Paused)
            .OrderBy(item => item.StartDate)
            .FirstOrDefault();
        if (future is not null)
        {
            var reason = future.Status == EnrollmentStatus.PendingPayment
                ? FeatureAccessReason.PaymentRequired
                : FeatureAccessReason.NotStarted;
            return Decision(feature, false, reason, future);
        }

        var expired = candidates.FirstOrDefault(item =>
            item.Status != EnrollmentStatus.Cancelled &&
            (item.Status == EnrollmentStatus.Expired || item.EndDateExclusive <= tenantToday));
        if (expired is not null)
        {
            return Decision(feature, false, FeatureAccessReason.Expired, expired);
        }

        var cancelled = candidates.FirstOrDefault(item => item.Status == EnrollmentStatus.Cancelled);
        return cancelled is null
            ? new FeatureAccessDecision(feature, false, FeatureAccessReason.NoEntitlement)
            : Decision(feature, false, FeatureAccessReason.Cancelled, cancelled);
    }

    private static FeatureAccessDecision Decision(
        CoachingFeature feature,
        bool allowed,
        FeatureAccessReason reason,
        AccessCandidate candidate) =>
        new(
            feature,
            allowed,
            reason,
            candidate.EnrollmentId,
            candidate.StartDate,
            candidate.EndDateExclusive);

    private static FeatureAccessDecision[] ForEveryFeature(FeatureAccessReason reason) =>
        Enum.GetValues<CoachingFeature>()
            .Select(feature => new FeatureAccessDecision(feature, false, reason))
            .ToArray();

    private sealed record AccessCandidate(
        CoachingFeature Feature,
        Guid EnrollmentId,
        DateOnly StartDate,
        DateOnly EndDateExclusive,
        EnrollmentStatus Status,
        decimal PriceAmount,
        decimal PaidAmount);
}
