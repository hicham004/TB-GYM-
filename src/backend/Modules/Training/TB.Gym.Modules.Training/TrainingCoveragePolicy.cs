namespace TB.Gym.Modules.Training;

public sealed record TrainingCoverageAuthorization(
    Guid EnrollmentId,
    Guid ClientProfileId,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    bool IncludesTraining,
    bool IsTerminated);

public sealed record TrainingCoverageDecision(bool IsAuthorized, string? Reason = null);

public static class TrainingCoveragePolicy
{
    public static TrainingCoverageDecision Evaluate(
        Guid clientProfileId,
        DateOnly mesocycleStart,
        DateOnly mesocycleEndExclusive,
        TrainingCoverageAuthorization authorization)
    {
        if (clientProfileId == Guid.Empty || authorization.EnrollmentId == Guid.Empty)
        {
            throw new ArgumentException("Client and enrollment ids are required.");
        }

        if (mesocycleEndExclusive <= mesocycleStart)
        {
            throw new ArgumentException("A mesocycle must have a positive date range.");
        }

        if (authorization.ClientProfileId != clientProfileId)
        {
            return Denied("The enrollment does not belong to this client.");
        }

        if (authorization.IsTerminated || !authorization.IncludesTraining)
        {
            return Denied("The enrollment does not provide usable training entitlement.");
        }

        if (mesocycleStart < authorization.StartDate ||
            mesocycleEndExclusive > authorization.EndDateExclusive)
        {
            return Denied("The entire mesocycle must remain inside its training entitlement period.");
        }

        return new TrainingCoverageDecision(true);
    }

    private static TrainingCoverageDecision Denied(string reason) => new(false, reason);
}
