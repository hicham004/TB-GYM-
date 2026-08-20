namespace TB.Gym.SharedKernel;

public enum CoachingFeature
{
    Training = 1,
    Nutrition = 2,
    CheckIns = 3,
    Messaging = 4,
    ResourceLibrary = 5,
}

public enum FeatureAccessReason
{
    Granted = 1,
    MembershipInactive = 2,
    RelationshipBlocked = 3,
    NoEntitlement = 4,
    PaymentRequired = 5,
    NotStarted = 6,
    Expired = 7,
    Paused = 8,
    Cancelled = 9,
    PlatformBlocked = 10,
}

public sealed record FeatureAccessDecision(
    CoachingFeature Feature,
    bool IsAllowed,
    FeatureAccessReason Reason,
    Guid? EnrollmentId = null,
    DateOnly? AccessibleFrom = null,
    DateOnly? AccessibleUntilExclusive = null);

public interface ICoachingFeatureAccessService
{
    Task<FeatureAccessDecision> EvaluateAsync(
        Guid tenantId,
        Guid clientProfileId,
        CoachingFeature feature,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<FeatureAccessDecision>> EvaluateAllAsync(
        Guid tenantId,
        Guid clientProfileId,
        CancellationToken cancellationToken);
}
