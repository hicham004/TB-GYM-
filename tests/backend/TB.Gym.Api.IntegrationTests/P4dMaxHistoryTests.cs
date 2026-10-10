using System.Net;
using TB.Gym.Modules.Training;
using StrengthMaxKind = TB.Gym.Modules.Strength.StrengthMaxKind;
using StrengthMaxPage = TB.Gym.Modules.Strength.StrengthMaxPage;
using StrengthMaxSource = TB.Gym.Modules.Strength.StrengthMaxSource;
using WorkingMaxSource = TB.Gym.Modules.Strength.WorkingMaxSource;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P4d, one max history per lift (STR-015): asked for, the client's max history lists every training max of
/// their programs beside the recorded maxes, each stored once and named with its program. Without asking,
/// the list stays the recorded maxes alone, which is what Assign program offers as a saved max.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string P4dHistoryUrl(Guid clientId, string query = "") =>
        $"/api/strength/clients/{clientId}/maxes{query}";

    [TestMethod]
    public async Task P4dTheMaxHistoryListsEachProgramMaxBesideTheRecordedOnesOnlyWhenAsked()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p4d-history", P4cOneWeek);
        var squat = scenario.Exercise.Id;
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)], name: "Strength block");
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var changes = new[] { P2Change(squat, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);
        var raised = await P2ApplyOkAsync(
            coach, block.Id, block.Version, changes, "New test result", preview.PreviewHash, Guid.NewGuid());
        var raisedMax = raised.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null);
        var firstMax = raised.WorkingMaxes.Single(item => item.SupersedesSnapshotId is null);

        // Unasked, the list is the recorded maxes alone: Assign program sends these ids back as saved maxes.
        var recorded = await ReadSliceAsync<StrengthMaxPage>(coach, P4dHistoryUrl(scenario.ClientId));
        Assert.AreEqual((1, scenario.Max.Id), (recorded.Total, recorded.Items.Single().Id));
        Assert.IsNull(recorded.Items.Single().Program);

        // Asked, the raise and the program's first max sit above the recorded max, newest first.
        var history = await ReadSliceAsync<StrengthMaxPage>(
            coach, P4dHistoryUrl(scenario.ClientId, "?includeProgramMaxes=true"));
        Assert.AreEqual(3, history.Total);
        CollectionAssert.AreEqual(
            new[] { raisedMax.Id, firstMax.Id, scenario.Max.Id },
            history.Items.Select(item => item.Id).ToArray());
        var raise = history.Items[0];
        Assert.AreEqual(
            (squat, "Competition squat", StrengthMaxKind.CoachWorkingMax, 120m, StrengthMaxSource.Manual, "New test result", P4bWorkspaceToday()),
            (raise.ExerciseId, raise.ExerciseName, raise.Kind, raise.Value, raise.Source, raise.Note, raise.EffectiveDate));
        Assert.AreEqual(
            new TB.Gym.Modules.Strength.StrengthMaxProgramView(block.Id, "Strength block", 1, WorkingMaxSource.Typed),
            raise.Program);
        Assert.AreEqual((100m, WorkingMaxSource.SavedMax), (history.Items[1].Value, history.Items[1].Program?.Origin));

        // Pages and the lift filter reach the program maxes too.
        var second = await ReadSliceAsync<StrengthMaxPage>(
            coach, P4dHistoryUrl(scenario.ClientId, "?includeProgramMaxes=true&skip=1&take=1"));
        Assert.AreEqual((3, firstMax.Id), (second.Total, second.Items.Single().Id));
        var other = await ReadSliceAsync<StrengthMaxPage>(
            coach, P4dHistoryUrl(scenario.ClientId, $"?includeProgramMaxes=true&exerciseId={Guid.NewGuid()}"));
        Assert.AreEqual(0, other.Total);
    }

    [TestMethod]
    public async Task P4dAnotherCoachOrAnotherWorkspaceCannotReadTheProgramMaxes()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "p4d-scope-owner@example.test", "P4d Owner", "P4d Scope Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "p4d-scope-coach@example.test", "Pat Coach");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "p4d-scope-other@example.test", "Sam Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4d-scope-client@example.test", newAccount: true);
        var exercise = await CreateExerciseAsync(coach, "Competition squat", [], []);
        await RecordWorkingMaxAsync(coach, clientId, exercise.Id, 100m);
        var url = P4dHistoryUrl(clientId, "?includeProgramMaxes=true");
        Assert.AreEqual(1, (await ReadSliceAsync<StrengthMaxPage>(coach, url)).Total);

        // Another coach of the team (ADR 0026), and a coach of another workspace, get nothing.
        await AssertStatusAsync(await otherCoach.GetAsync(url), HttpStatusCode.NotFound);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "p4d-scope-stranger@example.test", "P4d Stranger", "P4d Stranger Gym");
        await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.NotFound);
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.Forbidden);
    }
}
