using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Which of the house's tiers a client is on today (SUB-019): read on the server from the house's plans that grant
/// today, never worked out in a browser. Who the client is decides first, as feature access does (SUB-009): someone
/// who left, whose membership is not active, or who is blocked on the platform or by the house is on no tier.
/// </summary>
internal sealed class HouseTierReader(
    GymDbContext dbContext,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccess,
    IClock clock)
{
    /// <summary>The tier of a client of the workspace in scope; null outside the house.</summary>
    public Task<HouseTier?> TierAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        TierAsync(clientProfileId, decisions: null, cancellationToken);

    /// <summary>
    /// The same tier, from the feature access decisions the caller already read for this client in the workspace in
    /// scope (<see cref="ICoachingFeatureAccessService.EvaluateAllAsync"/>), so a read that needs both asks once.
    /// </summary>
    public async Task<HouseTier?> TierAsync(
        Guid clientProfileId,
        IReadOnlyList<FeatureAccessDecision>? decisions,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return null;
        }

        var tenantId = tenantContext.TenantId;
        var house = await dbContext.Tenants.AsNoTracking()
            .Where(tenant => tenant.Id == tenantId && tenant.IsHouse && tenant.IsActive)
            .Select(tenant => new { tenant.TimeZoneId })
            .SingleOrDefaultAsync(cancellationToken);
        if (house is null)
        {
            return null;
        }

        decisions ??= await featureAccess.EvaluateAllAsync(tenantId, clientProfileId, cancellationToken);
        if (decisions.Any(decision => decision.Reason is
                FeatureAccessReason.MembershipInactive or
                FeatureAccessReason.PlatformBlocked or
                FeatureAccessReason.RelationshipBlocked))
        {
            return null;
        }

        var today = PaymentDay.Of(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(house.TimeZoneId));
        var candidates = await dbContext.ClientEnrollments.AsNoTracking()
            .Where(enrollment =>
                enrollment.ClientProfileId == clientProfileId &&
                enrollment.HouseTier != null &&
                enrollment.StartDate <= today &&
                today < enrollment.EndDateExclusive)
            .Select(enrollment => new
            {
                Tier = enrollment.HouseTier!.Value,
                enrollment.StartDate,
                enrollment.EndDateExclusive,
                enrollment.Status,
                enrollment.PriceAmount,
                Paid = dbContext.PaymentRecords
                    .Where(payment =>
                        payment.EnrollmentId == enrollment.Id &&
                        payment.Operation == PaymentOperation.Receipt)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0m,
            })
            .ToListAsync(cancellationToken);
        return HouseTierRule.TierOn(
            candidates.Select(item => new HouseTierCandidate(
                item.Tier,
                item.StartDate,
                item.EndDateExclusive,
                item.Status,
                item.PriceAmount,
                item.Paid)),
            today,
            relationshipBlocked: false);
    }
}
