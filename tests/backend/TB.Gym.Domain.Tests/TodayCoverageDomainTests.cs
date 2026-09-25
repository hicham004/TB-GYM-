using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Which block covers the client's Today (Step 3B). Fixed dates follow the approved Today frame: a
/// block from Mon 24 Aug to Sun 18 Oct 2026, read on Sun 20 Sep, which is day 7 of week 4.
/// </summary>
[TestClass]
public sealed class TodayCoverageDomainTests
{
    private static readonly DateOnly Today = new(2026, 9, 20);
    private static readonly DateOnly BlockStart = new(2026, 8, 24);
    private static readonly DateOnly BlockEnd = new(2026, 10, 19);

    [TestMethod]
    public void TheBlockCoveringTodayGivesItsWeekAndWhetherThatWeekIsPublished()
    {
        var block = Block(BlockStart, BlockEnd, publishedWeeks: [1, 2, 3, 4]);

        var coverage = TodayCoveragePolicy.Evaluate([block], Today);

        Assert.IsNotNull(coverage.ActiveBlock);
        Assert.AreEqual(block.Id, coverage.ActiveBlock.Id);
        Assert.AreEqual(4, coverage.ActiveBlock.WeekNumber);
        Assert.AreEqual(8, coverage.ActiveBlock.WeekCount);
        Assert.IsTrue(coverage.ActiveBlock.IsCurrentWeekPublished);
        Assert.IsNull(coverage.NextBlockStartDate);
    }

    [TestMethod]
    public void AnUnpublishedCurrentWeekIsReportedEvenWhenLaterWeeksArePublished()
    {
        var coverage = TodayCoveragePolicy.Evaluate([Block(BlockStart, BlockEnd, publishedWeeks: [1, 2, 3, 5])], Today);

        Assert.IsNotNull(coverage.ActiveBlock);
        Assert.AreEqual(4, coverage.ActiveBlock.WeekNumber);
        Assert.IsFalse(coverage.ActiveBlock.IsCurrentWeekPublished);
    }

    [TestMethod]
    public void BetweenBlocksNothingCoversTodayAndTheNextStartIsTheEarliestLaterBlock()
    {
        var finished = Block(new DateOnly(2026, 8, 3), Today, publishedWeeks: [1, 2, 3, 4, 5, 6, 7]);
        var later = Block(new DateOnly(2026, 11, 2), new DateOnly(2026, 11, 30), publishedWeeks: [1]);
        var next = Block(new DateOnly(2026, 10, 5), new DateOnly(2026, 11, 2), publishedWeeks: [1, 2]);

        var coverage = TodayCoveragePolicy.Evaluate([finished, later, next], Today);

        // A block whose exclusive end is today no longer covers it.
        Assert.IsNull(coverage.ActiveBlock);
        Assert.AreEqual(new DateOnly(2026, 10, 5), coverage.NextBlockStartDate);
    }

    [TestMethod]
    public void ASupplementalBlockAloneCoversTheDay()
    {
        // Supplemental blocks are reserved (TRN-011) and PostgreSQL refuses them today
        // (CK_Mesocycles_Phase3Kind), so this case can only be proven here.
        var supplemental = Block(BlockStart, BlockEnd, publishedWeeks: [4], kind: MesocycleKind.Supplemental);

        var coverage = TodayCoveragePolicy.Evaluate([supplemental], Today);

        Assert.AreEqual(supplemental.Id, coverage.ActiveBlock?.Id);
        Assert.IsTrue(coverage.ActiveBlock!.IsCurrentWeekPublished);
    }

    [TestMethod]
    public void APrimaryBlockIsPreferredOverASupplementalOneCoveringTheSameDay()
    {
        var supplemental = Block(new DateOnly(2026, 8, 17), BlockEnd, publishedWeeks: [], kind: MesocycleKind.Supplemental);
        var primary = Block(BlockStart, BlockEnd, publishedWeeks: [4]);

        var coverage = TodayCoveragePolicy.Evaluate([supplemental, primary], Today);

        Assert.AreEqual(primary.Id, coverage.ActiveBlock?.Id);
    }

    [TestMethod]
    public void CompletedAndCancelledBlocksNeverCoverTodayOrCountAsNext()
    {
        var completed = Block(BlockStart, BlockEnd, publishedWeeks: [4], status: MesocycleStatus.Completed);
        var cancelled = Block(new DateOnly(2026, 10, 5), new DateOnly(2026, 11, 2), publishedWeeks: [1],
            status: MesocycleStatus.Cancelled);

        var coverage = TodayCoveragePolicy.Evaluate([completed, cancelled], Today);

        Assert.IsNull(coverage.ActiveBlock);
        Assert.IsNull(coverage.NextBlockStartDate);
    }

    [TestMethod]
    public void ABlockStartingTodayIsWeekOneAndNotTheNextBlock()
    {
        var coverage = TodayCoveragePolicy.Evaluate([Block(Today, Today.AddDays(28), publishedWeeks: [1])], Today);

        Assert.AreEqual(1, coverage.ActiveBlock?.WeekNumber);
        Assert.AreEqual(4, coverage.ActiveBlock?.WeekCount);
        Assert.IsNull(coverage.NextBlockStartDate);
    }

    private static TodayCoverageBlock Block(
        DateOnly start,
        DateOnly endExclusive,
        int[] publishedWeeks,
        MesocycleKind kind = MesocycleKind.Primary,
        MesocycleStatus status = MesocycleStatus.Planned) =>
        new(Guid.NewGuid(), "Upper-Body Strength v3", kind, status, start, endExclusive, publishedWeeks);
}
