namespace TB.Gym.Modules.Nutrition;

public sealed record NutritionCoverageAuthorization(
    Guid EnrollmentId,
    Guid ClientProfileId,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    bool IncludesNutrition,
    bool IsTerminated);

public sealed record NutritionCoverageDecision(bool IsAuthorized, string? Reason = null);

public static class NutritionCoveragePolicy
{
    public static NutritionCoverageDecision Evaluate(
        Guid clientProfileId,
        DateOnly planStart,
        DateOnly planEndExclusive,
        NutritionCoverageAuthorization authorization)
    {
        if (clientProfileId == Guid.Empty || authorization.EnrollmentId == Guid.Empty)
        {
            throw new ArgumentException("Client and enrollment ids are required.");
        }

        if (planEndExclusive <= planStart)
        {
            throw new ArgumentException("A nutrition plan must have a positive date range.");
        }

        if (authorization.ClientProfileId != clientProfileId)
        {
            return new NutritionCoverageDecision(false, "The enrollment does not belong to this client.");
        }

        if (authorization.IsTerminated || !authorization.IncludesNutrition)
        {
            return new NutritionCoverageDecision(false, "The enrollment does not provide usable nutrition entitlement.");
        }

        if (planStart < authorization.StartDate || planEndExclusive > authorization.EndDateExclusive)
        {
            return new NutritionCoverageDecision(false, "The entire nutrition plan must remain inside its nutrition entitlement period.");
        }

        return new NutritionCoverageDecision(true);
    }
}
