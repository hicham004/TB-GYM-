using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// The client's own page on their plan (SUB-017, critique B10a): the plan's name and its price's name, what's
/// included, the dates, where it stands and the coach's description. No price, no payment, no reason the coach typed.
/// </summary>
/// <param name="Today">The workspace's today (SYS-008), the day each plan's status was read on.</param>
public sealed record OwnPlansView(DateOnly Today, IReadOnlyList<OwnPlanView> Plans);

/// <param name="OptionLabel">The price option's name, as sold.</param>
/// <param name="Description">The plan's description as it stands today: an enrollment keeps no copy of it.</param>
/// <param name="LastDay">The plan's last covered day, not its exclusive end.</param>
/// <param name="CancelledOn">The workspace day the plan was cancelled (COACH-20); null unless it was.</param>
public sealed record OwnPlanView(
    Guid Id,
    string Name,
    string OptionLabel,
    string? Description,
    DateOnly StartDate,
    DateOnly LastDay,
    DateOnly? CancelledOn,
    EffectiveEnrollmentStatus Status,
    IReadOnlyList<CoachingFeature> Features);

public static class OwnPlans
{
    /// <summary>
    /// Every plan not over, in the order they start; once none is left, the one that ended last, a cancelled plan
    /// counting from the day it was cancelled rather than a last day that may never have come.
    /// </summary>
    public static IReadOnlyList<ClientEnrollment> Shown(
        IReadOnlyCollection<ClientEnrollment> plans,
        DateOnly today,
        TimeZoneInfo workspaceZone)
    {
        var running = plans
            .Where(plan => !IsOver(plan, today))
            .OrderBy(plan => plan.StartDate)
            .ThenBy(plan => plan.CreatedAtUtc)
            .ToArray();
        return running.Length > 0
            ? running
            : plans
                .OrderByDescending(plan => plan.CancelledOn(workspaceZone) ?? plan.EndDateExclusive.AddDays(-1))
                .ThenByDescending(plan => plan.CreatedAtUtc)
                .Take(1)
                .ToArray();
    }

    /// <summary>Where a plan stands for its client. A block speaks only of what still runs: a plan that is over says so.</summary>
    public static EffectiveEnrollmentStatus StatusOf(ClientEnrollment plan, DateOnly today, bool relationshipBlocked) =>
        plan.GetEffectiveStatus(today, relationshipBlocked && !IsOver(plan, today));

    private static bool IsOver(ClientEnrollment plan, DateOnly today) =>
        plan.GetEffectiveStatus(today, relationshipBlocked: false)
            is EffectiveEnrollmentStatus.Expired or EffectiveEnrollmentStatus.Cancelled;
}
