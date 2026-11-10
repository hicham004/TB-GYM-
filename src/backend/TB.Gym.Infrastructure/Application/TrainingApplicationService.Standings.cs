using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    /// <summary>
    /// Where each lift with a "Last time + step" set stands for the client (<c>LastTimeStep</c> v1, STR-019, notes
    /// plan N6b): one answer per writing of the lift in its coming session, the earliest session not started and not
    /// before today (in its program's calendar) of a block neither completed nor cancelled that writes the lift with
    /// a step. Two reads at most: the coming step sets, then the client's workouts of those lifts, from any program
    /// (<see cref="LiftStandingsReader.ReadAsync"/>, which Coach Today's count shares, notes plan N6d). Callers decide
    /// first that the coach's read is open (TRN-023); nothing is written.
    /// </summary>
    private async Task<IReadOnlyList<LiftStandingView>> ReadLiftStandingsAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        [.. (await LiftStandingsReader.ReadAsync(dbContext, clock.UtcNow, [clientProfileId], cancellationToken))
            [clientProfileId]];
}
