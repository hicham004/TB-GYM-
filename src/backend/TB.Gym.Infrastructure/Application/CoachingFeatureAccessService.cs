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
        var decisions = await EvaluateCoreAsync(tenantId, clientProfileId, cancellationToken);
        return decisions.Single(item => item.Feature == feature);
    }

    public Task<IReadOnlyList<FeatureAccessDecision>> EvaluateAllAsync(
        Guid tenantId,
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        EvaluateCoreAsync(tenantId, clientProfileId, cancellationToken);

    private async Task<IReadOnlyList<FeatureAccessDecision>> EvaluateCoreAsync(
        Guid tenantId,
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant || tenantContext.TenantId != tenantId)
        {
            return ForEveryFeature(FeatureAccessReason.MembershipInactive);
        }

        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(item => item.Id == clientProfileId)
            .Select(item => new { item.UserId, item.IsCoachBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        if (client?.UserId is not { } userId)
        {
            return ForEveryFeature(FeatureAccessReason.MembershipInactive);
        }

        var membershipIsActive = await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
            where membership.TenantId == tenantId &&
                  membership.UserId == userId &&
                  membership.Role == TenantRole.Client &&
                  membership.Status == MembershipStatus.Active &&
                  tenant.IsActive
            select membership.Id)
            .AnyAsync(cancellationToken);
        if (!membershipIsActive)
        {
            return ForEveryFeature(FeatureAccessReason.MembershipInactive);
        }

        var platformBlocked = await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => user.IsPlatformBlocked)
            .SingleAsync(cancellationToken);
        if (platformBlocked)
        {
            return ForEveryFeature(FeatureAccessReason.PlatformBlocked);
        }

        if (client.IsCoachBlocked)
        {
            return ForEveryFeature(FeatureAccessReason.RelationshipBlocked);
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

        var candidates = await (
            from entitlement in dbContext.EnrollmentEntitlements.AsNoTracking()
            join enrollment in dbContext.ClientEnrollments.AsNoTracking()
                on new { entitlement.TenantId, Id = entitlement.EnrollmentId }
                equals new { enrollment.TenantId, enrollment.Id }
            where entitlement.ClientProfileId == clientProfileId
            select new AccessCandidate(
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
                    .Sum(payment => (decimal?)payment.Amount) ?? 0m))
            .ToListAsync(cancellationToken);

        return Enum.GetValues<CoachingFeature>()
            .Select(feature => EvaluateFeature(feature, candidates, tenantToday))
            .ToArray();
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
