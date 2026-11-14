using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Which of a client's plans grant Training on a day, read as feature access grants (SUB-009): active, covering the
/// day, paid in full and holding Training. The house's programs need the plan itself, not Training from any plan,
/// since Free grants Training beside every other (SUB-019, TRN-034).
/// </summary>
internal static class HouseProgramPlans
{
    /// <summary>A trainee's Pro+ plan that grants Training today: the pass a program is started under.</summary>
    internal sealed record Pass(Guid EnrollmentId, string Name, DateOnly StartDate, DateOnly EndDateExclusive);

    public static Task<Pass?> GrantingPassAsync(
        GymDbContext dbContext,
        Guid clientProfileId,
        DateOnly today,
        CancellationToken cancellationToken) =>
        Granting(dbContext, today)
            .Where(item => item.ClientProfileId == clientProfileId && item.HouseTier == HouseTier.ProPlus)
            .OrderByDescending(item => item.StartDate)
            .ThenByDescending(item => item.Id)
            .Select(item => new Pass(item.Id, item.ProductNameSnapshot, item.StartDate, item.EndDateExclusive))
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>Those of <paramref name="enrollmentIds"/> that grant Training today.</summary>
    public static async Task<IReadOnlySet<Guid>> GrantingAsync(
        GymDbContext dbContext,
        IReadOnlyCollection<Guid> enrollmentIds,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        if (enrollmentIds.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var ids = enrollmentIds.Distinct().ToArray();
        return (await Granting(dbContext, today)
                .Where(item => ids.Contains(item.Id))
                .Select(item => item.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();
    }

    private static IQueryable<ClientEnrollment> Granting(GymDbContext dbContext, DateOnly today) =>
        dbContext.ClientEnrollments.AsNoTracking()
            .Where(item =>
                item.Status == EnrollmentStatus.Active &&
                item.StartDate <= today &&
                today < item.EndDateExclusive &&
                item.Entitlements.Any(entitlement => entitlement.Feature == CoachingFeature.Training) &&
                (dbContext.PaymentRecords
                    .Where(payment => payment.EnrollmentId == item.Id && payment.Operation == PaymentOperation.Receipt)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0m) >= item.PriceAmount);
}
