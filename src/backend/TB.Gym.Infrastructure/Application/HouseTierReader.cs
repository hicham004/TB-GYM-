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
    internal const string TiersTag = "House tiers: the house's plans that grant today";

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
        if (Excluded(decisions))
        {
            return null;
        }

        var today = PaymentDay.Of(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(house.TimeZoneId));
        var tiers = await GrantingTiersAsync([clientProfileId], today, cancellationToken);
        return tiers[clientProfileId];
    }

    /// <summary>
    /// The tiers of several clients of the house at once (SUB-019), for a read that already holds the house's day and
    /// each client's feature access decisions (<see cref="ICoachingFeatureAccessService.EvaluateManyAsync"/>): one
    /// tagged command however many clients, none for an empty set. A client whose membership is not active, or who is
    /// blocked on the platform or by the house, is on no tier, as <see cref="TierAsync(Guid, CancellationToken)"/> says.
    /// The caller has checked that the workspace in scope is the house.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, HouseTier?>> TiersAsync(
        IReadOnlyCollection<Guid> clientProfileIds,
        IReadOnlyDictionary<Guid, IReadOnlyList<FeatureAccessDecision>> decisions,
        DateOnly houseToday,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(clientProfileIds);
        ArgumentNullException.ThrowIfNull(decisions);
        var eligible = clientProfileIds
            .Distinct()
            .Where(id => !decisions.TryGetValue(id, out var own) || !Excluded(own))
            .ToArray();
        var tiers = eligible.Length == 0
            ? new Dictionary<Guid, HouseTier?>()
            : await GrantingTiersAsync(eligible, houseToday, cancellationToken);
        return clientProfileIds.Distinct().ToDictionary(id => id, id => tiers.GetValueOrDefault(id));
    }

    /// <summary>
    /// Whether the house coaches this client today (<see cref="HouseTierRule.CoachesTheTrainee"/>): a self-directed
    /// trainee on Max. False, with nothing read, for anyone who is not self-directed.
    /// </summary>
    public async Task<bool> CoachedOnMaxAsync(
        Guid clientProfileId,
        bool isSelfDirected,
        CancellationToken cancellationToken) =>
        isSelfDirected &&
        HouseTierRule.CoachesTheTrainee(await TierAsync(clientProfileId, cancellationToken));

    private static bool Excluded(IReadOnlyList<FeatureAccessDecision> decisions) =>
        decisions.Any(decision => decision.Reason is
            FeatureAccessReason.MembershipInactive or
            FeatureAccessReason.PlatformBlocked or
            FeatureAccessReason.RelationshipBlocked);

    private async Task<Dictionary<Guid, HouseTier?>> GrantingTiersAsync(
        IReadOnlyCollection<Guid> clientProfileIds,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var candidates = await dbContext.ClientEnrollments.AsNoTracking()
            .TagWith(TiersTag)
            .Where(enrollment =>
                clientProfileIds.Contains(enrollment.ClientProfileId) &&
                enrollment.HouseTier != null &&
                enrollment.StartDate <= today &&
                today < enrollment.EndDateExclusive)
            .Select(enrollment => new
            {
                enrollment.ClientProfileId,
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
        var byClient = candidates.ToLookup(item => item.ClientProfileId);
        return clientProfileIds.Distinct().ToDictionary(
            id => id,
            id => HouseTierRule.TierOn(
                byClient[id].Select(item => new HouseTierCandidate(
                    item.Tier,
                    item.StartDate,
                    item.EndDateExclusive,
                    item.Status,
                    item.PriceAmount,
                    item.Paid)),
                today,
                relationshipBlocked: false));
    }
}
