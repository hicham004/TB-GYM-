namespace TB.Gym.Modules.Training;

/// <summary>One of a client's blocks, reduced to what the Today coverage decision reads.</summary>
public sealed record TodayCoverageBlock(
    Guid Id,
    string Name,
    MesocycleKind Kind,
    MesocycleStatus Status,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    IReadOnlyCollection<int> PublishedWeekNumbers);

/// <summary>
/// Decides which block covers a calendar day for the client's Today: the same predicates as the
/// today read (not cancelled or completed, <c>StartDate ≤ today &lt; EndDateExclusive</c>), so Today
/// never calls a day a rest day when no block covers it or when its week is not published.
/// </summary>
public static class TodayCoveragePolicy
{
    public static TodayTrainingCoverageView Evaluate(IEnumerable<TodayCoverageBlock> blocks, DateOnly today)
    {
        var open = blocks
            .Where(block => block.Status is not (MesocycleStatus.Completed or MesocycleStatus.Cancelled))
            .ToArray();

        // Primary blocks cannot overlap. Supplemental blocks are reserved (TRN-011); if one ever
        // covers the day alongside a primary block, the primary block is the one Today describes.
        var active = open
            .Where(block => block.StartDate <= today && today < block.EndDateExclusive)
            .OrderBy(block => block.Kind == MesocycleKind.Primary ? 0 : 1)
            .ThenBy(block => block.StartDate)
            .ThenBy(block => block.Id)
            .FirstOrDefault();
        var nextStart = open
            .Where(block => block.StartDate > today)
            .Select(block => (DateOnly?)block.StartDate)
            .Min();

        if (active is null)
        {
            return new TodayTrainingCoverageView(null, nextStart);
        }

        // Weeks are seven days from the block's start (TRN-007), so the week number is arithmetic.
        var weekNumber = (today.DayNumber - active.StartDate.DayNumber) / 7 + 1;
        var weekCount = (active.EndDateExclusive.DayNumber - active.StartDate.DayNumber) / 7;
        return new TodayTrainingCoverageView(
            new ActiveTrainingBlockView(
                active.Id,
                active.Name,
                weekNumber,
                weekCount,
                active.PublishedWeekNumbers.Contains(weekNumber)),
            nextStart);
    }
}
