using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// A client asked their coach to renew a plan that has run out, or is in its last days (ADR 0029, critique B14).
/// Append-only: a request is never edited or withdrawn. At most one per client in any 7 days, which PostgreSQL enforces with an
/// exclusion constraint over <c>[RequestedOn, AskAgainFrom)</c>, so a double tap or two requests at
/// once cannot both be stored.
/// </summary>
public sealed class RenewalRequest : TenantEntity
{
    /// <summary>Calendar days, in the workspace's time zone, before the client may ask again.</summary>
    public const int WindowDays = 7;

    private RenewalRequest()
    {
    }

    private RenewalRequest(
        Guid tenantId,
        Guid clientProfileId,
        Guid endedEnrollmentId,
        Guid coachUserId,
        DateOnly requestedOn,
        DateTimeOffset requestedAtUtc)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || endedEnrollmentId == Guid.Empty || coachUserId == Guid.Empty)
        {
            throw new ArgumentException("Client, ended enrollment and coach are required.");
        }

        ClientProfileId = clientProfileId;
        EndedEnrollmentId = endedEnrollmentId;
        CoachUserId = coachUserId;
        RequestedOn = requestedOn;
        AskAgainFrom = requestedOn.AddDays(WindowDays);
        RequestedAtUtc = requestedAtUtc;
    }

    public Guid ClientProfileId { get; private set; }

    /// <summary>The plan they asked about, as their renewal status named it: one that ran out or is about to.</summary>
    public Guid EndedEnrollmentId { get; private set; }

    /// <summary>
    /// The member of staff who was told: the client's assigned coach at the time, or the owner while the client
    /// waited for a coach (CLI-012, notes plan N9d1b).
    /// </summary>
    public Guid CoachUserId { get; private set; }

    /// <summary>The workspace's calendar date when the client asked.</summary>
    public DateOnly RequestedOn { get; private set; }

    /// <summary>Exclusive end of the window: the first date the client may ask again.</summary>
    public DateOnly AskAgainFrom { get; private set; }

    public DateTimeOffset RequestedAtUtc { get; private set; }

    public static RenewalRequest Create(
        Guid tenantId,
        Guid clientProfileId,
        Guid endedEnrollmentId,
        Guid coachUserId,
        DateOnly requestedOn,
        DateTimeOffset requestedAtUtc) =>
        new(tenantId, clientProfileId, endedEnrollmentId, coachUserId, requestedOn, requestedAtUtc);
}

/// <summary>The plan that ran out: which enrollment, and its last covered day.</summary>
public sealed record EndedPlan(Guid EnrollmentId, DateOnly LastDay)
{
    /// <summary>The first day a request could be about this plan: one from before it was about an earlier plan.</summary>
    public DateOnly AskOpenedOn => RenewalEligibility.EndingSoonDay(LastDay.AddDays(1));
}

/// <summary>A plan still running that its client may already ask to renew: which enrollment, and its last covered day.</summary>
public sealed record EndingPlan(Guid EnrollmentId, DateOnly LastDay);

/// <summary>A plan neither over nor cancelled, as <see cref="RenewalEligibility.EndingPlan"/> weighs it.</summary>
public sealed record PlanNotOver(Guid EnrollmentId, bool IsSessionPack, DateOnly StartDate, DateOnly EndDateExclusive);

/// <summary>
/// Whether a client may ask to renew (ADR 0029): once their whole plan has run out, read from their access decisions, or
/// from the day it is ending soon (critique B14). Every feature they had has passed its end date, or passes it within
/// those days, and nothing else is waiting. A plan the coach cancelled or paused, one feature running on, a renewal
/// paid or awaiting payment or a plan starting later all keep the button away, as does any block on the relationship.
/// A pack beside a coaching plan that ran out keeps nothing away: callers pass <see cref="CoachingPlanRunOut.PlanDecisions"/>.
/// </summary>
public static class RenewalEligibility
{
    /// <summary>A plan is ending soon this many days before its exclusive end.</summary>
    public const int EndingSoonDays = 3;

    /// <summary>
    /// The day a plan's ending-soon notice goes out (SUB-012) and its client may first ask to renew (SUB-014), one rule
    /// for both, so the notice's "ask your coach" always finds the button.
    /// </summary>
    public static DateOnly EndingSoonDay(DateOnly endDateExclusive) => endDateExclusive.AddDays(-EndingSoonDays);

    public static EndedPlan? EndedPlan(IReadOnlyCollection<FeatureAccessDecision> decisions)
    {
        if (decisions.Any(decision => decision.Reason is not (FeatureAccessReason.Expired or FeatureAccessReason.NoEntitlement)))
        {
            return null;
        }

        var latest = decisions
            .Where(decision => decision.Reason == FeatureAccessReason.Expired &&
                decision.EnrollmentId is not null && decision.AccessibleUntilExclusive is not null)
            .OrderByDescending(decision => decision.AccessibleUntilExclusive)
            .FirstOrDefault();
        return latest is null
            ? null
            : new EndedPlan(latest.EnrollmentId!.Value, latest.AccessibleUntilExclusive!.Value.AddDays(-1));
    }

    /// <summary>
    /// The plan a client may ask to renew before it ends, or null. Beside a coaching plan a pack never stands for the
    /// client's plan (SES-002), so it keeps nothing away and is not what they ask about; with none left, the pack is the
    /// plan. The decisions say what runs today, and a plan booked after it, which they cannot see, keeps the button away.
    /// </summary>
    public static EndingPlan? EndingPlan(
        IReadOnlyList<FeatureAccessDecision> decisions,
        IReadOnlyCollection<PlanNotOver> plans,
        DateOnly today)
    {
        var coachingPlans = plans.Where(plan => !plan.IsSessionPack).ToArray();
        var named = coachingPlans.Length > 0 ? coachingPlans : plans;
        IReadOnlyList<FeatureAccessDecision> read = coachingPlans.Length > 0
            ? [.. decisions.Where(decision => decision.Feature != CoachingFeature.Sessions)]
            : decisions;
        var running = read.Where(decision => decision.Reason == FeatureAccessReason.Granted).ToArray();
        var last = named.MaxBy(plan => plan.EndDateExclusive);
        var endingSoon = last is not null &&
            running.Length > 0 &&
            today >= EndingSoonDay(last.EndDateExclusive) &&
            named.All(plan => plan.StartDate <= today) &&
            read.All(decision => decision.Reason is
                FeatureAccessReason.Granted or FeatureAccessReason.Expired or FeatureAccessReason.NoEntitlement) &&
            running.All(decision => decision.AccessibleUntilExclusive is { } until && today >= EndingSoonDay(until));
        return endingSoon ? new EndingPlan(last!.EnrollmentId, last.EndDateExclusive.AddDays(-1)) : null;
    }
}

public interface IClientRenewalService
{
    /// <summary>The signed-in client's renewal state, or null when they have no current profile here.</summary>
    Task<RenewalStatusView?> GetOwnStatusAsync(CancellationToken cancellationToken);

    /// <summary>Asks the client's coach to renew. Asking again inside the window returns the first request.</summary>
    Task<RenewalRequestResult> RequestAsync(CancellationToken cancellationToken);
}

/// <param name="PlanEnded">The whole plan has run out.</param>
/// <param name="EndedOn">Its last covered day; null unless it ran out.</param>
/// <param name="CoachName">Whom the client asks; null with nothing to ask about.</param>
/// <param name="LastRequest">Their latest request, whatever it was about.</param>
/// <param name="CanAsk">There is a plan to ask about and no request stands in the way.</param>
/// <param name="EndsOn">The last covered day of a plan still running that they may already ask about (critique B14).</param>
/// <param name="PlanId">The plan the ask is about, which My plan shows it on; null with nothing to ask about.</param>
public sealed record RenewalStatusView(
    bool PlanEnded,
    DateOnly? EndedOn,
    string? CoachName,
    RenewalRequestView? LastRequest,
    bool CanAsk,
    DateOnly? EndsOn = null,
    Guid? PlanId = null);

public sealed record RenewalRequestView(Guid Id, DateOnly RequestedOn, DateOnly AskAgainFrom);

public enum RenewalRequestStatus
{
    Created = 1,
    AlreadyRequested = 2,
    PlanNotEnded = 3,
    NotFound = 4,
}

public sealed record RenewalRequestResult(RenewalRequestStatus Status, RenewalStatusView? View = null);
