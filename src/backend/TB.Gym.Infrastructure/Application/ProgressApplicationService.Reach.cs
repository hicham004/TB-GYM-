using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// How far back a client's own Progress reaches (PRG-015): on Free, the house's window of days; anywhere else, no
/// limit. Only the client's own reads ask it, so a coach's read of the same client is never cut.
/// </summary>
internal sealed partial class ProgressApplicationService
{
    /// <summary>
    /// The reach of a client's own Progress today, or null when nothing limits it. Outside the house it costs no query,
    /// since the calendar already says the workspace is not the house; in the house it reads the window first and the
    /// tier only once the window is filled. <paramref name="decisions"/> are the client's feature access decisions when
    /// the caller has already read them.
    /// </summary>
    private async Task<ProgressReach?> OwnReachAsync(
        Guid clientProfileId,
        WorkspaceCalendar calendar,
        IReadOnlyList<FeatureAccessDecision>? decisions,
        CancellationToken cancellationToken)
    {
        if (!calendar.IsHouse)
        {
            return null;
        }

        var windowDays = (await HouseReader.SettingsAsync(dbContext, tenantContext.TenantId, cancellationToken))
            .FreeProgressDays;
        if (windowDays is null)
        {
            return null;
        }

        var tier = await houseTierReader.TierAsync(clientProfileId, decisions, cancellationToken);
        if (FreeProgressReachRule.EarliestShown(tier, windowDays, calendar.Today) is not { } earliestShown)
        {
            return null;
        }

        // Any paid plan lifts the reach while it grants, a plan the house's staff made without a tier and a pack
        // too: on the tier read such a plan leaves the trainee on Free, though they have paid for it.
        return await UntieredPaidPlanGrantsAsync(clientProfileId, calendar.Today, cancellationToken)
            ? null
            : new ProgressReach(
                FreeProgressReachRule.MethodKey,
                FreeProgressReachRule.MethodVersion,
                windowDays.Value,
                earliestShown);
    }

    /// <summary>
    /// Whether a plan of the house with no tier, priced above nothing, active and paid in full, covers
    /// <paramref name="today"/>: read as the tier read reads a plan (SUB-019), receipts against the price.
    /// </summary>
    private Task<bool> UntieredPaidPlanGrantsAsync(
        Guid clientProfileId,
        DateOnly today,
        CancellationToken cancellationToken) =>
        dbContext.ClientEnrollments.AsNoTracking()
            .Where(enrollment =>
                enrollment.ClientProfileId == clientProfileId &&
                enrollment.HouseTier == null &&
                enrollment.Status == EnrollmentStatus.Active &&
                enrollment.PriceAmount > 0m &&
                enrollment.StartDate <= today &&
                today < enrollment.EndDateExclusive)
            .AnyAsync(
                enrollment =>
                    (dbContext.PaymentRecords
                        .Where(payment =>
                            payment.EnrollmentId == enrollment.Id &&
                            payment.Operation == PaymentOperation.Receipt)
                        .Sum(payment => (decimal?)payment.Amount) ?? 0m) >= enrollment.PriceAmount,
                cancellationToken);

    /// <summary>A read's first day, moved up to the reach's earliest day when it starts before it.</summary>
    private static DateOnly AtOrAfter(DateOnly date, ProgressReach? reach) =>
        reach is { EarliestShown: var earliest } && date < earliest ? earliest : date;
}
