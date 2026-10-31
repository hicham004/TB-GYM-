using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Progress;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B16 (PRG-005): the change beside the weight on Progress compares weekly means, as "since
/// start" does, so the two agree when the chart begins at the start. It is worked out on the server, named
/// and versioned, for a coach and for the client alike, over the weeks the chart's range holds.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B16TheChangeComparesWeeklyMeansAndAgreesWithSinceStartWhenTheChartBeginsAtTheStart()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b16-owner@example.test", "Hicham Haddad", "B16 Weekly");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b16-maya@example.test", "Maya", "Fakhoury");
        var weekStartsOn = (await ReadSliceAsync<ProgressDashboardView>(owner, B6DashboardUrl(mayaId))).WeekStartsOn;

        // A start on the first day of a week, five weeks ago, and a second weigh-in in that week.
        var startDay = BodyweightWeekPolicy.GetWeekStart(today.AddDays(-35), weekStartsOn);
        await B6CompleteOnboardingAsync(maya, "Maya", 80m, "Kilogram", startDay);
        await R31WeighInAsync(maya, startDay.AddDays(2), 79m);

        // Two weigh-ins of one week are no weekly comparison, so the label has nothing to say.
        var oneWeek = await ReadSliceAsync<ProgressDashboardView>(owner, B6DashboardUrl(mayaId));
        Assert.AreEqual(2, oneWeek.Bodyweight.ObservedDayCount);
        Assert.IsNull(oneWeek.Bodyweight.WeeklyChange);

        // A week between them counts for neither; the latest week holds today alone.
        await R31WeighInAsync(maya, startDay.AddDays(14), 78m);
        await R31WeighInAsync(maya, today, 76m);
        var view = await ReadSliceAsync<ProgressDashboardView>(owner, B6DashboardUrl(mayaId));
        var change = view.Bodyweight.WeeklyChange ?? throw new AssertFailedException("The change was not worked out.");
        Assert.AreEqual(("BodyweightChangeWeeklyMean", "1.0"), (change.MethodKey, change.MethodVersion));
        Assert.AreEqual(startDay, change.FromDate);
        Assert.AreEqual(
            (startDay, 79.5m, 2),
            (change.FirstWeekStart, change.FirstWeekMeanKilograms, change.FirstWeekObservedDayCount));
        Assert.AreEqual(
            (BodyweightWeekPolicy.GetWeekStart(today, weekStartsOn), 76m, 1),
            (change.LatestWeekStart, change.LatestWeekMeanKilograms, change.LatestWeekObservedDayCount));
        Assert.AreEqual((-3.5m, -3.5m), (change.DeltaKilograms, change.DisplayDelta));

        // The label and "Since start" read one figure from the same two weeks.
        var since = view.Bodyweight.Start!.SinceStart!;
        Assert.AreEqual((since.DeltaKilograms, since.DisplayDelta), (change.DeltaKilograms, change.DisplayDelta));
        Assert.AreEqual(
            (since.StartWeekStart, since.StartWeekMeanKilograms, since.LatestWeekStart, since.LatestWeekMeanKilograms),
            (change.FirstWeekStart, change.FirstWeekMeanKilograms, change.LatestWeekStart, change.LatestWeekMeanKilograms));

        // The client reads the same change on their own page, in their own unit, and no start beside it.
        var own = await ReadSliceAsync<ProgressDashboardView>(maya, $"{B6OwnDashboardUrl}?displayUnit=Pound");
        Assert.IsNull(own.Bodyweight.Start);
        Assert.AreEqual(-3.5m, own.Bodyweight.WeeklyChange!.DeltaKilograms);
        Assert.AreEqual(startDay, own.Bodyweight.WeeklyChange.FromDate);
        Assert.AreEqual(-7.716m, own.Bodyweight.WeeklyChange.DisplayDelta);
    }

    [TestMethod]
    public async Task B16TheChartsRangeNamesTheWeeksAndAWeekItOpensInIsComparedWhole()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b16-range-owner@example.test", "Hicham Haddad", "B16 Range");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b16-range-maya@example.test", "Maya", "Fakhoury");
        var weekStartsOn = (await ReadSliceAsync<ProgressDashboardView>(owner, B6DashboardUrl(mayaId))).WeekStartsOn;
        var startDay = BodyweightWeekPolicy.GetWeekStart(today.AddDays(-35), weekStartsOn);
        await B6CompleteOnboardingAsync(maya, "Maya", 80m, "Kilogram", startDay);
        await R31WeighInAsync(maya, startDay.AddDays(2), 79m);
        await R31WeighInAsync(maya, startDay.AddDays(14), 78m);
        var latest = await B6WeighInAsync(maya, today, 76m);
        async Task<DashboardWeeklyChange> FromAsync(DateOnly from) =>
            (await ReadSliceAsync<ProgressDashboardView>(
                owner,
                $"{B6DashboardUrl(mayaId)}?from={Iso(from)}&to={Iso(today.AddDays(1))}")).Bodyweight.WeeklyChange
            ?? throw new AssertFailedException("The change was not worked out.");

        // Opening a day into the start's week, the range holds only one of its weigh-ins and the label
        // names that one, while the mean is the whole week's: the figure stays Since start's.
        var inTheWeek = await FromAsync(startDay.AddDays(1));
        Assert.AreEqual(startDay.AddDays(2), inTheWeek.FromDate);
        Assert.AreEqual((79.5m, 2, -3.5m), (inTheWeek.FirstWeekMeanKilograms, inTheWeek.FirstWeekObservedDayCount, inTheWeek.DeltaKilograms));

        // A later range compares from its own first weigh-in, and no longer reads as since the start.
        var later = await FromAsync(startDay.AddDays(10));
        Assert.AreEqual(startDay.AddDays(14), later.FromDate);
        Assert.AreEqual((78m, -2m), (later.FirstWeekMeanKilograms, later.DeltaKilograms));

        // A weigh-in moved to another day leaves its week, voided: the latest week is now the one it joined.
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(
            await maya.PostAsJsonAsync(
                $"/api/progress/me/bodyweight/{latest.Id}/replace-date",
                new { measurementDate = Iso(startDay.AddDays(15)), reason = "Wrong day", version = latest.Version }),
            HttpStatusCode.OK);
        var moved = await FromAsync(startDay);
        Assert.AreEqual(BodyweightWeekPolicy.GetWeekStart(startDay.AddDays(14), weekStartsOn), moved.LatestWeekStart);
        Assert.AreEqual((77m, 2, -2.5m), (moved.LatestWeekMeanKilograms, moved.LatestWeekObservedDayCount, moved.DeltaKilograms));
    }
}
