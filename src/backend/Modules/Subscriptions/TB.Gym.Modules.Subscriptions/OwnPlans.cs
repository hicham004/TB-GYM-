using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// The client's own page on their plan (SUB-017, critique B10a): the plan's name and its price's name, what's
/// included, the dates, where it stands and the coach's description, and a pack's sessions (SES-007, critique B10c). No
/// price, no payment, and of what the coach typed only the reason a session was charged, which is written for the client.
/// </summary>
/// <param name="Today">The workspace's today (SYS-008), the day each plan's status was read on.</param>
/// <param name="CoachName">The client's coach today, whom a pack's sentence names; null when they have no name.</param>
/// <param name="Renewal">Their renewal state, as Today reads it, for the Ask to renew on the plan it is about (critique B14).</param>
/// <param name="Plans">Every plan of SUB-017's but the house's Free, which never ends and stands apart in <paramref name="Free"/>.</param>
/// <param name="Tier">
/// The house's tier the client is on today (SUB-019); null outside the house, while blocked, or when no plan of a
/// tier grants today.
/// </param>
/// <param name="Free">Free in the house, while it covers today; null elsewhere.</param>
public sealed record OwnPlansView(
    DateOnly Today,
    IReadOnlyList<OwnPlanView> Plans,
    string? CoachName = null,
    RenewalStatusView? Renewal = null,
    HouseTier? Tier = null,
    OwnFreePlanView? Free = null);

/// <summary>
/// Free as its trainee reads it (SUB-019): it never ends, so it says since when it runs and nothing of an end, whatever
/// row of it covers today.
/// </summary>
/// <param name="Since">The first day of the trainee's first Free row.</param>
public sealed record OwnFreePlanView(
    string Name,
    DateOnly Since,
    EffectiveEnrollmentStatus Status,
    IReadOnlyList<CoachingFeature> Features);

/// <param name="OptionLabel">The price option's name, as sold.</param>
/// <param name="Description">The plan's description as it stands today: an enrollment keeps no copy of it.</param>
/// <param name="LastDay">The plan's last covered day, not its exclusive end.</param>
/// <param name="CancelledOn">The workspace day the plan was cancelled (COACH-20); null unless it was.</param>
/// <param name="Sessions">What is left on a session pack and what became of the rest; null on a coaching plan.</param>
public sealed record OwnPlanView(
    Guid Id,
    string Name,
    string OptionLabel,
    string? Description,
    DateOnly StartDate,
    DateOnly LastDay,
    DateOnly? CancelledOn,
    EffectiveEnrollmentStatus Status,
    IReadOnlyList<CoachingFeature> Features,
    OwnSessionsView? Sessions = null);

/// <summary>A pack as its client reads it (SES-007): never who held or recorded a session, a coach's note or a row undone.</summary>
/// <param name="Count">The sessions the pack was sold with.</param>
/// <param name="Left">Issued − held − charged + voided; none until the pack is active.</param>
/// <param name="Used">The sessions held or charged that still stand.</param>
/// <param name="Lapsed">What was left when the pack ended or was cancelled; none while it runs (SES-006).</param>
/// <param name="LapsedOn">The day those lapsed; null when none did.</param>
/// <param name="Sessions">The sessions held or charged that still stand, newest day first.</param>
public sealed record OwnSessionsView(
    int Count,
    int Left,
    int Used,
    int Lapsed,
    DateOnly? LapsedOn,
    IReadOnlyList<OwnSessionView> Sessions);

/// <param name="Reason">Why it was charged, which the coach wrote for the client; null on a session held.</param>
public sealed record OwnSessionView(DateOnly Day, SessionOutcome Outcome, string? Reason);

public static class OwnPlans
{
    /// <summary>
    /// Every plan not over, in the order they start; once none is left, the one that ended last, a cancelled plan
    /// counting from the day it was cancelled rather than a last day that may never have come. The plan a client may
    /// ask to renew always shows, first when it is over: beside a pack that runs on, nothing else would list it, and its
    /// notice opens this page (critique B14).
    /// </summary>
    public static IReadOnlyList<ClientEnrollment> Shown(
        IReadOnlyCollection<ClientEnrollment> plans,
        DateOnly today,
        TimeZoneInfo workspaceZone,
        Guid? planToRenew = null)
    {
        var running = plans
            .Where(plan => !IsOver(plan, today))
            .OrderBy(plan => plan.StartDate)
            .ThenBy(plan => plan.CreatedAtUtc)
            .ToArray();
        var shown = running.Length > 0
            ? running
            : plans
                .OrderByDescending(plan => plan.CancelledOn(workspaceZone) ?? plan.EndDateExclusive.AddDays(-1))
                .ThenByDescending(plan => plan.CreatedAtUtc)
                .Take(1)
                .ToArray();
        var toRenew = plans.FirstOrDefault(plan => plan.Id == planToRenew);
        return toRenew is null || shown.Contains(toRenew) ? shown : [toRenew, .. shown];
    }

    /// <summary>
    /// What a client reads of a pack (SES-007): the coach's ledger less all that is the team's own, so a charge's reason
    /// reaches them and a coach's note, who held or recorded a session and anything undone do not.
    /// </summary>
    public static OwnSessionsView SessionsOf(SessionPackView pack) =>
        new(
            pack.Count,
            pack.Left,
            pack.Held + pack.Charged,
            pack.Lapsed,
            pack.LapsedOn,
            [.. pack.Entries
                .Where(entry => !entry.IsVoided && entry.Kind is SessionEntryKind.Held or SessionEntryKind.Charged)
                .Select(entry => new OwnSessionView(
                    entry.Day,
                    entry.Kind == SessionEntryKind.Held ? SessionOutcome.Held : SessionOutcome.Charged,
                    entry.Reason))]);

    /// <summary>
    /// Free as its trainee reads it (SUB-019): the row covering today, named once with the day the first row started;
    /// null while none covers today.
    /// </summary>
    public static OwnFreePlanView? FreeOf(
        IReadOnlyCollection<ClientEnrollment> freeRows,
        DateOnly today,
        bool relationshipBlocked)
    {
        var covering = freeRows
            .Where(row => row.IsHouseFree && row.StartDate <= today && today < row.EndDateExclusive && !IsOver(row, today))
            .OrderBy(row => row.StartDate)
            .FirstOrDefault();
        return covering is null
            ? null
            : new OwnFreePlanView(
                covering.ProductNameSnapshot,
                freeRows.Where(row => row.IsHouseFree).Min(row => row.StartDate),
                StatusOf(covering, today, relationshipBlocked),
                [.. covering.Entitlements.Select(item => item.Feature).Order()]);
    }

    /// <summary>Where a plan stands for its client. A block speaks only of what still runs: a plan that is over says so.</summary>
    public static EffectiveEnrollmentStatus StatusOf(ClientEnrollment plan, DateOnly today, bool relationshipBlocked) =>
        plan.GetEffectiveStatus(today, relationshipBlocked && !IsOver(plan, today));

    private static bool IsOver(ClientEnrollment plan, DateOnly today) =>
        plan.GetEffectiveStatus(today, relationshipBlocked: false)
            is EffectiveEnrollmentStatus.Expired or EffectiveEnrollmentStatus.Cancelled;
}
