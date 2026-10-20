using System.Net;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R4.1: the program builder reopens one program by its id, as the list shows it: every version,
/// newest first, and the token the next save must carry. It is the workspace's program, so every
/// coach there reads it; another workspace, a client and nobody signed out never do.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string R41ProgramUrl(Guid templateId) => $"/api/training/templates/{templateId}";

    [TestMethod]
    public async Task R41ACoachReopensOneProgramWithItsVersionsAndSavesFromItsToken()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r41-read-owner@example.test", "Hicham Haddad", "R41 Programs");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var first = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);

        var opened = await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId));
        Assert.AreEqual((first.TemplateId, "Powerlifting Base", 1), (opened.Id, opened.Name, opened.CurrentVersionNumber));
        var only = opened.Versions.Single();
        Assert.AreEqual((first.Id, 1, true, 1), (only.Id, only.VersionNumber, only.IsPublished, only.WeekCount));

        // Changes started from this read publish as the next version, and the read then lists both.
        var second = await PublishProgramAsync(
            owner, TemplateContent(squat.Id, alternative.Id, 8.5m), first, opened.CurrentVersionNumber);
        var reopened = await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId));
        Assert.AreEqual(2, reopened.CurrentVersionNumber);
        CollectionAssert.AreEqual(
            new[] { second.Id, first.Id },
            reopened.Versions.Select(version => version.Id).ToArray(),
            "Newest first, as the list shows them.");
        Assert.AreNotEqual(opened.Version, reopened.Version);

        // Changes started from the older read are not published over the newer version without asking.
        var stale = await PublishProgramContentAsync(
            owner, TemplateContent(squat.Id, alternative.Id, 9m), first, opened.CurrentVersionNumber);
        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        Assert.AreEqual(ProgramDraftConflictCodes.NewerVersionPublished, (await RequiredJsonAsync<R42aConflict>(stale)).Code);

        // The program belongs to the workspace, so a coach on the team reopens it too.
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r41-read-coach@example.test", "Lina Saad");
        var teamRead = await ReadSliceAsync<ProgramTemplateSummary>(coach, R41ProgramUrl(first.TemplateId));
        Assert.AreEqual((reopened.Id, reopened.Version), (teamRead.Id, teamRead.Version));
    }

    [TestMethod]
    public async Task R41OneProgramIsReadOnlyByTheStaffOfItsWorkspace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r41-scope-owner@example.test", "Hicham Haddad", "R41 Scope");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var program = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);
        using var client = CreateClient();
        await R31InviteAsync(owner, client, tenant, "r41-scope-maya@example.test", "Maya", "Rahman");

        // An unknown id is simply not there.
        await AssertStatusAsync(await owner.GetAsync(R41ProgramUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // A client never reads the coach's programs, and nobody signed out reaches one.
        await AssertStatusAsync(await client.GetAsync(R41ProgramUrl(program.TemplateId)), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R41ProgramUrl(program.TemplateId)), HttpStatusCode.Unauthorized);

        // Another workspace finds nothing of it in its own, and is refused this one.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r41-scope-stranger@example.test", "Other Owner", "R41 Elsewhere");
        var elsewhere = await stranger.GetAsync(R41ProgramUrl(program.TemplateId));
        await AssertStatusAsync(elsewhere, HttpStatusCode.NotFound);
        Assert.IsFalse((await elsewhere.Content.ReadAsStringAsync()).Contains("Powerlifting Base", StringComparison.Ordinal));
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R41ProgramUrl(program.TemplateId)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
    }
}
