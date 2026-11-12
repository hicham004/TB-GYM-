using System.Net;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N6d (decision 21, 5 Nov 2026: the weekly apply is the coach's homework; CLI-018 v8): Coach Today's
/// Needs you, the client list and a client's page name each client whose lifts have a weight to apply in their coming
/// workout, counted on the server from the answers the client's Training tab lists (LastTimeStep v1, STR-019, STR-020),
/// for the coach's own clients and the owner's, never a released client, another workspace's or one whose plan leaves
/// training out; gone once applied or held at each set's own weight. Coach Today reads each lift's last weeks, and its
/// whole history only where those cannot settle the typo guard, in three commands at most whatever the client count.
/// Each test that steps whole days starts at midday in the workspace's zone.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task N6dLiftsReadyToStepUpAskTheCoachOnTodayTheListAndTheClientsPageUntilTheyAreApplied()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6d-step", 3);

        // Never done, each set keeps its own 20 kg: nothing to apply, nothing said.
        Assert.IsNull(await N6dItemAsync(coach, scenario.ClientId));

        // Every set reached its 10 at 20 kg: next week's workout steps each set to 22 kg, waiting for the coach.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var item = await N6dItemAsync(coach, scenario.ClientId)
            ?? throw new AssertFailedException("Today names the lift ready to step up.");
        Assert.AreEqual(
            (1, (int?)1, (DateOnly?)today.AddDays(7), (Guid?)null, (int?)null, (DateTimeOffset?)null),
            (item.Count, item.StepUps, item.Date, item.SubjectId, item.WeekNumber, item.Since));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        Assert.HasCount(2, LastTimeStepRule.SetsToApply(standing.Standing), "It is what the Training tab offers to apply.");

        // The list and the client's page read the same item, and the client is still on track: weekly homework for a
        // client doing the work is no sign of one slipping.
        var row = await B4aRowAsync(coach, scenario.ClientId);
        Assert.AreEqual((ClientOverviewStatus.OnTrack, ClientPlanStatus.OnTrack), (row.Status, row.PlanStatus));
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.WeightsToApply }, row.Attention.ToArray());
        Assert.AreEqual(item, row.AttentionItems.Single());
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(scenario.ClientId));
        Assert.AreEqual(ClientOverviewStatus.OnTrack, page.Status);
        Assert.AreEqual(item, page.Attention.Single());
        // Version 9 since the notes plan's N9a1 (a self-directed trainee of the house raises nothing, CLI-026); the
        // weights to apply are weighed as version 8 weighed them.
        Assert.AreEqual((CoachAttentionPolicy.Key, 9), (page.AttentionRuleKey, page.AttentionRuleVersion));
        var todayView = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual((CoachAttentionPolicy.Key, 9), (todayView.AttentionRuleKey, todayView.AttentionRuleVersion));

        // Applied, nothing is left to apply, and the line goes from all three; nothing on Today applies anything.
        await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(standing));
        Assert.IsNull(await N6dItemAsync(coach, scenario.ClientId));
        Assert.IsEmpty((await B4aRowAsync(coach, scenario.ClientId)).Attention);
        Assert.IsEmpty((await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(scenario.ClientId))).Attention);
    }

    [TestMethod]
    public async Task N6dAWeightKeptFromLastTimeCountsAndAWorkoutLeftRunningTakesTheLineAway()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // One week of the lift from 20 kg, then a program from next week that starts it again from 20 kg.
        var scenario = await P2CustomStartAsync(coach, client, "n6d-kept", N6cWeeks(1));
        var nextProgram = await PublishProgramAsync(coach, N6aProgram("n6d kept next", N6cWeeks(3)(scenario.Exercise.Id)));
        var first = await P2AssignAsync(coach, scenario, []);
        var next = await N6bAssignAsync(coach, scenario, nextProgram, today.AddDays(7));

        // 25 kg for 10, then 8 of 10: the lift holds, and the next program's sets keep 25 kg over their own 20 kg (line d).
        // It counts as a weight to apply that does not step up.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 25m), new N6bLog(8, 25m));
        var kept = await N6dItemAsync(coach, scenario.ClientId)
            ?? throw new AssertFailedException("Today names the weight kept from last time.");
        Assert.AreEqual((1, (int?)0, (DateOnly?)today.AddDays(7)), (kept.Count, kept.StepUps, kept.Date));
        var held = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id], workout), scenario.Exercise.Id);
        Assert.AreEqual(LiftStandingOutcome.Hold, held.Standing.Outcome);

        // Applied, the next program's sets hold 25 kg and the line goes.
        await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(held));
        Assert.IsNull(await N6dItemAsync(coach, scenario.ClientId));

        // A week on, every set reached its 10 at the 25 kg applied: week 2's sets, at their own 20 kg, step up to 27 kg.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await N6bTrainTodayAsync(client, true, new N6bLog(10, 25m), new N6bLog(10, 25m));
        var stepUp = await N6dItemAsync(coach, scenario.ClientId)
            ?? throw new AssertFailedException("Today names the lift ready to step up.");
        Assert.AreEqual((1, (int?)1, (DateOnly?)today.AddDays(14)), (stepUp.Count, stepUp.StepUps, stepUp.Date));

        // On week 2's day the client starts it and never finishes (line g): a workout still running is no last time, so
        // week 3 has nothing to apply, and the line goes.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await N6bTrainTodayAsync(client, false, new N6bLog(10, 27m), new N6bLog(10, 27m));
        var running = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [next.Id]), scenario.Exercise.Id);
        Assert.AreEqual(LiftStandingReason.WorkoutInProgress, running.Standing.Reason.Kind);
        Assert.IsNull(await N6dItemAsync(coach, scenario.ClientId));
    }

    [TestMethod]
    public async Task N6dAFirstLogThatWasATypoHoldsTheLiftOnTodayAsOnTheTrainingTabFromWorkoutsBeforeTheWindow()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "n6d-typo@example.test", "Typo Coach", "N6d Typo");
        using var client = CreateClient();
        var clientId = await R31InviteAsync(coach, client, tenant, "n6d-typo-rana@example.test", "Rana", "Typo");
        await N6dStepProgramAsync(coach, clientId, "n6d typo", null);

        // The lift's first log ever is a typo, 200 kg where the client meant 20 kg; with no weight given to the set it
        // stands, having nothing before it (line e).
        await N6bTrainTodayAsync(client, true, new N6bLog(10, 200m), new N6bLog(10, 200m));

        // Three weeks on, past the window of the last 15 days, they log 20 kg for every rep. Against the 200 kg that
        // stood it looks like a typo, so the lift holds at each set's own weight and nothing is to apply: Today says
        // nothing, as the Training tab offers nothing. Read alone, the last weeks would step up from 20 kg.
        RequiredTestClock.Advance(TimeSpan.FromDays(21));
        await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId));
        var standing = program.LiftStandings!.Single();
        Assert.AreEqual(LiftStandingReason.LooksLikeTypo, standing.Standing.Reason.Kind);
        Assert.IsEmpty(LastTimeStepRule.SetsToApply(standing.Standing));
        var (_, view) = await B4aMeasureAsync<CoachTodayView>(coach, CoachTodayUrl, "N6d Coach Today, a typo before");
        Assert.IsNull(N6dItemIn(view, clientId));
        // The workouts before the window were read, for this lift alone: the typo's two sets.
        Assert.AreEqual((1, 1, 1, 0), N6dCommands());
        Assert.AreEqual(2 + 1, RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.EarlierTag).Reads);
    }

    [TestMethod]
    public async Task N6dTwoClientsOnOneLiftEachReadOnlyTheirOwnWorkoutsAndCountsAddUpPerClient()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "n6d-pairs@example.test", "Pairs Coach", "N6d Pairs");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "n6d-pairs-maya@example.test", "Maya", "Pairs");
        using var lina = CreateClient();
        var linaId = await R31InviteAsync(coach, lina, tenant, "n6d-pairs-lina@example.test", "Lina", "Pairs");
        // One program for both: a curl with two step sets and no starting weight on the first day, and a press from
        // 20 kg two days later.
        var curl = await CreateExerciseAsync(coach, "n6d pairs curl", [], []);
        var press = await CreateExerciseAsync(coach, "n6d pairs press", [], []);
        var template = await PublishProgramAsync(coach, N6aProgram("n6d pairs program",
        [
            .. Enumerable.Range(1, 4).Select(week => N6bWeekOfDays(
                $"Week {week}",
                N6bDay("Lower", 0, N6bLift(curl.Id, 1, N6aStepSet(1, 2m), N6aStepSet(2, 2m))),
                N6bDay("Upper", 2, N6bLift(press.Id, 1, N6aStepSet(1, 2m, 20m), N6aStepSet(2, 2m, 20m))))),
        ]));
        foreach (var clientId in new[] { mayaId, linaId })
        {
            var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, today, 8);
            await N6bAssignAsync(coach, clientId, enrollment.Id, template, today);
        }

        // The first day: Lina falls short on the curl at 20 kg; half an hour later Maya reaches every rep at 20 kg, so
        // a history that mixed the two would read Maya's as Lina's last time.
        await N6bTrainTodayAsync(lina, true, new N6bLog(10, 20m), new N6bLog(8, 20m));
        RequiredTestClock.Advance(TimeSpan.FromMinutes(30));
        await N6bTrainTodayAsync(maya, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        // Two days on: Maya presses 25 kg and falls short, so next week's 20 kg keeps her 25 kg; Lina does not train.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        await N6bTrainTodayAsync(maya, true, new N6bLog(10, 25m), new N6bLog(8, 25m));

        var view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        // Maya: the curl steps up, the press keeps 25 kg; next Monday's curl is the soonest.
        var mayasItem = N6dItemIn(view, mayaId) ?? throw new AssertFailedException("Maya has weights to apply.");
        Assert.AreEqual((2, (int?)1, (DateOnly?)today.AddDays(7)), (mayasItem.Count, mayasItem.StepUps, mayasItem.Date));
        // Lina: her own short set holds the curl at last time's 20 kg, which her set with no weight takes on; Maya's
        // workouts of the same lift are never hers.
        var linasItem = N6dItemIn(view, linaId) ?? throw new AssertFailedException("Lina keeps her curl's 20 kg.");
        Assert.AreEqual((1, (int?)0, (DateOnly?)today.AddDays(7)), (linasItem.Count, linasItem.StepUps, linasItem.Date));
        var linas = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(linaId))).LiftStandings!.Single(view => view.ExerciseId == curl.Id);
        Assert.AreEqual(
            (LiftStandingOutcome.Hold, LiftStandingReason.RepsShort),
            (linas.Standing.Outcome, linas.Standing.Reason.Kind));
        // The list's row for each client says the same.
        Assert.AreEqual(mayasItem, (await B4aRowAsync(coach, mayaId)).AttentionItems.Single(item => item.Kind == CoachAttentionKind.WeightsToApply));
        Assert.AreEqual(linasItem, (await B4aRowAsync(coach, linaId)).AttentionItems.Single(item => item.Kind == CoachAttentionKind.WeightsToApply));
    }

    [TestMethod]
    public async Task N6dWeightsToApplyFollowTheCoachsOwnClientsAndNeverReachAFormerClientAnotherSpaceOrAClosedPlan()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n6d-who-owner@example.test", "Hicham Haddad", "N6d Who");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "n6d-who-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "n6d-who-omar@example.test", "Omar Saad");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "n6d-who-maya@example.test", "Maya", "Rahman");
        await N6dStepProgramAsync(owner, mayaId, "n6d who", 20m);
        await N6bTrainTodayAsync(maya, true, new N6bLog(10, 20m), new N6bLog(10, 20m));

        // Lea, Maya's coach, reads it, and so does the owner, who coaches every client (CLI-013), with Lea named.
        Assert.AreEqual((1, (int?)1), N6dCounts(await N6dItemAsync(lea, mayaId)));
        var ownersItem = await N6dItemAsync(owner, mayaId)
            ?? throw new AssertFailedException("The owner reads every client's weights to apply.");
        Assert.AreEqual("Lea Khoury", ownersItem.Client.AssignedCoachName);

        // Omar, who does not coach Maya, reads nothing of her anywhere; Maya never reads a coach's Today.
        Assert.IsNull(await N6dItemAsync(omar, mayaId));
        await N6dAssertNowhereAsync(omar, mayaId);
        await AssertStatusAsync(await maya.GetAsync(CoachTodayUrl), HttpStatusCode.Forbidden);

        // Lea also coaches in another workspace: there she reads nothing of Maya, and its owner nothing of her either,
        // in their own workspace or, refused, in this one.
        using var other = CreateClient();
        var elsewhere = await RegisterCoachAsync(other, "n6d-who-other@example.test", "Other Owner", "N6d Elsewhere");
        await B4bJoinSignedInAsCoachAsync(other, lea, elsewhere, "n6d-who-lea@example.test", "Lea");
        await N6dAssertNowhereAsync(lea, mayaId);
        await N6dAssertNowhereAsync(other, mayaId);
        SetTenant(other, tenant);
        await AssertStatusAsync(await other.GetAsync(CoachTodayUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await other.GetAsync(ClientOverviewUrl), HttpStatusCode.Forbidden);
        SetTenant(lea, tenant);
        Assert.IsNotNull(await N6dItemAsync(lea, mayaId), "Back here, Lea reads it again.");

        // A blocked relationship takes training out of what the coach is asked about (CLI-018); unblocked, it is back.
        await N6bRelationshipAsync(owner, mayaId, "block");
        Assert.IsNull(await N6dItemAsync(lea, mayaId));
        Assert.IsNull(await N6dItemAsync(owner, mayaId));
        await N6bRelationshipAsync(owner, mayaId, "unblock");
        Assert.IsNotNull(await N6dItemAsync(lea, mayaId));

        // Released (ADR 0027), Maya is on none of the coach's screens.
        await ReleaseAsync(owner, mayaId, "Moved away");
        await N6dAssertNowhereAsync(owner, mayaId);
        await N6dAssertNowhereAsync(lea, mayaId);
    }

    [TestMethod]
    public async Task N6dTodayReadsWhereLiftsStandInThreeCommandsAtMostAndOnlyTheLastWeeksOnceTheyAreSettled()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var steady = CreateClient();
        // Four weeks of the lift, each logged at the 20 kg the workout asked (never applied, so the step waits): every
        // log stands whatever came before it, so the last weeks settle where the lift stands.
        var (scenario, _) = await N6cStartAsync(coach, steady, "n6d-rows", 6);
        for (var week = 1; week <= 4; week++)
        {
            if (week > 1)
            {
                RequiredTestClock.Advance(TimeSpan.FromDays(7));
            }

            await N6bTrainTodayAsync(steady, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        }

        var (queries, view) = await B4aMeasureAsync<CoachTodayView>(coach, CoachTodayUrl, "N6d Coach Today, settled");
        Assert.AreEqual((1, (int?)1), N6dCounts(N6dItemIn(view, scenario.ClientId)));
        // The coming step sets, week 5's two alone (week 6's can never come first while week 5's is open), then the last
        // 15 days of the lift: three workouts of two sets, not the four the client logged; nothing before them.
        Assert.AreEqual((1, 1, 0, 0), N6dCommands());
        Assert.AreEqual(2 + 1, RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.ComingTag).Reads);
        Assert.AreEqual(3 * 2 + 1, RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.RecentTag).Reads);
        // The client's Training tab reads all four, as it always did.
        await B4aMeasureAsync<CoachClientProgramView>(coach, R34aProgramUrl(scenario.ClientId), "N6d Training tab");
        Assert.AreEqual((1, 0, 0, 1), N6dCommands());
        Assert.AreEqual(4 * 2 + 1, RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.HistoryTag).Reads);

        // A second client's lift has no starting weight and nothing asked, so its logs settle nothing: the workouts
        // before the window are read too, in one more command and for that lift alone (none: it started today), never
        // the first client's, whose last weeks settle theirs.
        using var picker = CreateClient();
        var pickerId = await R31InviteAsync(coach, picker, scenario.WorkspaceId, "n6d-rows-picker@example.test", "Rana", "Picker");
        await N6dStepProgramAsync(coach, pickerId, "n6d rows picker", null);
        await N6bTrainTodayAsync(picker, true, new N6bLog(10, 12m), new N6bLog(10, 12m));
        var (both, withPicker) = await B4aMeasureAsync<CoachTodayView>(coach, CoachTodayUrl, "N6d Coach Today, unsettled");
        Assert.AreEqual((1, (int?)1), N6dCounts(N6dItemIn(withPicker, pickerId)));
        Assert.AreEqual((1, 1, 1, 0), N6dCommands());
        Assert.AreEqual(0 + 1, RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.EarlierTag).Reads);
        Assert.AreEqual(queries + 1, both);

        // The client's page reads the same three for that client alone, within its limit with a step lift coming.
        var (pageQueries, page) = await B4aMeasureAsync<ClientProfileOverviewView>(
            coach, R33bOverviewUrl(pickerId), "N6d client page, unsettled");
        Assert.AreEqual((1, 1, 1, 0), N6dCommands());
        Assert.IsLessThanOrEqualTo(26, pageQueries, "A client's page with a step lift coming.");
        Assert.AreEqual(CoachAttentionKind.WeightsToApply, page.Attention.Single().Kind);

        // Two more clients like them cost Today no query.
        using var third = CreateClient();
        var thirdId = await R31InviteAsync(coach, third, scenario.WorkspaceId, "n6d-rows-third@example.test", "Tala", "Third");
        await N6dStepProgramAsync(coach, thirdId, "n6d rows third", null);
        await N6bTrainTodayAsync(third, true, new N6bLog(10, 14m), new N6bLog(10, 14m));
        using var fourth = CreateClient();
        var fourthId = await R31InviteAsync(coach, fourth, scenario.WorkspaceId, "n6d-rows-fourth@example.test", "Lara", "Fourth");
        await N6dStepProgramAsync(coach, fourthId, "n6d rows fourth", 30m);
        await N6bTrainTodayAsync(fourth, true, new N6bLog(10, 30m), new N6bLog(10, 30m));
        var (more, withFour) = await B4aMeasureAsync<CoachTodayView>(coach, CoachTodayUrl, "N6d Coach Today, four");
        Assert.AreEqual(both, more, "Two more clients with step lifts cost Today no query.");
        Assert.AreEqual(4, withFour.Attention.Count(item => item.Kind == CoachAttentionKind.WeightsToApply));
    }

    // ----- helpers -----

    /// <summary>The caller's Coach Today item of weights to apply for the client, or null.</summary>
    private static async Task<CoachAttentionItemView?> N6dItemAsync(HttpClient caller, Guid clientId) =>
        N6dItemIn(await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl), clientId);

    private static CoachAttentionItemView? N6dItemIn(CoachTodayView view, Guid clientId) =>
        view.Attention.SingleOrDefault(item =>
            item.Kind == CoachAttentionKind.WeightsToApply && item.Client.ClientProfileId == clientId);

    private static (int? Count, int? StepUps) N6dCounts(CoachAttentionItemView? item) =>
        item is null ? throw new AssertFailedException("No weights to apply.") : (item.Count, item.StepUps);

    /// <summary>
    /// How many commands the last measured read sent for the coming step sets, the last weeks, the workouts before them
    /// and a whole history (the Training tab's).
    /// </summary>
    private (int Coming, int Recent, int Earlier, int Whole) N6dCommands() =>
        (RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.ComingTag).Commands,
            RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.RecentTag).Commands,
            RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.EarlierTag).Commands,
            RequiredTodayQueryCounter.ReadsTagged(LiftStandingsReader.HistoryTag).Commands);

    /// <summary>Asserts that the caller's Today and client list never name the client, and that the client's page is not theirs.</summary>
    private static async Task N6dAssertNowhereAsync(HttpClient caller, Guid clientId)
    {
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl })
        {
            var raw = await caller.GetStringAsync(url);
            Assert.IsFalse(raw.Contains(clientId.ToString(), StringComparison.OrdinalIgnoreCase), $"{url} names the client.");
        }

        await AssertStatusAsync(await caller.GetAsync(R33bOverviewUrl(clientId)), HttpStatusCode.NotFound);
    }

    /// <summary>
    /// Gives the client an eight-week training plan and a program, both from the workspace's today: six weeks of one
    /// session of a new lift with two "Last time + step" sets of 10, stepping 2 kg from the starting weight (none: the
    /// client picks).
    /// </summary>
    private async Task N6dStepProgramAsync(HttpClient coach, Guid clientId, string tag, decimal? start)
    {
        var today = Phase6WorkspaceToday();
        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, today, 8);
        var exercise = await CreateExerciseAsync(coach, $"{tag} curl", [], []);
        var template = await PublishProgramAsync(coach, N6aProgram($"{tag} program",
        [
            .. Enumerable.Range(1, 6).Select(week =>
                P2Week($"Week {week}", exercise.Id, N6aStepSet(1, 2m, start), N6aStepSet(2, 2m, start))),
        ]));
        await N6bAssignAsync(coach, clientId, enrollment.Id, template, today);
    }
}
