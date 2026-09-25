using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// A client asked their coach to renew a plan that has run out (ADR 0029). Append-only: a request is
/// never edited or withdrawn. At most one per client in any 7 days, which PostgreSQL enforces with an
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

    /// <summary>The plan that ran out, as the client's access decision named it when they asked.</summary>
    public Guid EndedEnrollmentId { get; private set; }

    /// <summary>The coach who was told: the client's assigned coach at the time.</summary>
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
public sealed record EndedPlan(Guid EnrollmentId, DateOnly LastDay);

/// <summary>
/// Whether a client's whole plan has run out, read from their access decisions (ADR 0029). Only then
/// may they ask to renew: every feature they had has passed its end date and nothing else is waiting.
/// A plan the coach cancelled or paused, one feature still running, a renewal awaiting payment or a
/// plan starting later all keep the button away, as does any block on the relationship.
/// </summary>
public static class RenewalEligibility
{
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
}

public interface IClientRenewalService
{
    /// <summary>The signed-in client's renewal state, or null when they have no current profile here.</summary>
    Task<RenewalStatusView?> GetOwnStatusAsync(CancellationToken cancellationToken);

    /// <summary>Asks the client's coach to renew. Asking again inside the window returns the first request.</summary>
    Task<RenewalRequestResult> RequestAsync(CancellationToken cancellationToken);
}

public sealed record RenewalStatusView(
    bool PlanEnded,
    DateOnly? EndedOn,
    string? CoachName,
    RenewalRequestView? LastRequest,
    bool CanAsk);

public sealed record RenewalRequestView(Guid Id, DateOnly RequestedOn, DateOnly AskAgainFrom);

public enum RenewalRequestStatus
{
    Created = 1,
    AlreadyRequested = 2,
    PlanNotEnded = 3,
    NotFound = 4,
}

public sealed record RenewalRequestResult(RenewalRequestStatus Status, RenewalStatusView? View = null);
