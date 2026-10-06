using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R4.2a: the program builder keeps a coach's changes on the server as they work (TRN-024). A draft
/// belongs to that coach in that workspace and to nobody else, the owner included; it keeps any value
/// mid-edit within a version's shape; two tabs never start two or overwrite each other; and only
/// Publish turns it into a version, checked like any save, asking first when someone published after
/// it began.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R42aDraftsUrl = "/api/training/program-drafts";

    private static string R42aDraftUrl(Guid draftId) => $"{R42aDraftsUrl}/{draftId}";

    private static string R42aPublishUrl(Guid draftId) => $"{R42aDraftsUrl}/{draftId}/publish";

    private static string R42aDiscardUrl(Guid draftId) => $"{R42aDraftsUrl}/{draftId}/discard";

    [TestMethod]
    public async Task R42aACoachKeepsChangesOnTheServerAndPublishesThemAsTheNextVersion()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r42a-owner@example.test", "Hicham Haddad", "R42a Drafts");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var first = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);
        Assert.IsNull((await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId))).Draft);

        // Mid-edit: a session with no name yet and reps of 0 are kept as they are.
        var started = await R42aCreateAsync(
            owner,
            new(first.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id, sessionName: string.Empty, reps: 0)));
        var withDraft = await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId));
        Assert.AreEqual(started.Id, withDraft.Draft?.Id);
        var listed = (await ReadSliceAsync<ProgramDraftSummary[]>(owner, R42aDraftsUrl)).Single();
        Assert.AreEqual(
            (started.Id, (Guid?)first.TemplateId, "Powerlifting Base", 1),
            (listed.Id, listed.TemplateId, listed.Name, listed.WeekCount));

        var read = await ReadSliceAsync<ProgramDraftView>(owner, R42aDraftUrl(started.Id));
        Assert.AreEqual(
            ((Guid?)first.TemplateId, (Guid?)first.Id, 1, started.Version),
            (read.TemplateId, read.SourceVersionId, read.StartedAtVersionNumber, read.Version));
        var session = read.Content.Weeks.Single().Sessions.Single();
        Assert.AreEqual((string.Empty, 0), (session.Name, session.Exercises.Single().Sets.Single().RepetitionsMinimum));
        CollectionAssert.AreEquivalent(
            R42aExerciseNames,
            read.Exercises.Select(exercise => exercise.Name).ToArray(),
            "The names of every exercise it uses, swaps included, from this workspace's library.");

        // Publish checks every rule, as any save does, and a refusal leaves the draft as it was.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R42aPublishUrl(started.Id), new PublishProgramDraftRequest(started.Version, false)),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(await owner.GetAsync(R42aDraftUrl(started.Id)), HttpStatusCode.OK);

        // Each save carries the version it read; one from an older read is refused.
        var fixedUp = await R42aSaveAsync(owner, started.Id, started.Version, R42aContent(squat.Id, alternative.Id, targetRpe: 9m));
        Assert.AreNotEqual(started.Version, fixedUp.Version);
        await R42aAssertConflictAsync(
            await R42aPutAsync(owner, started.Id, started.Version, R42aContent(squat.Id, alternative.Id)),
            ProgramDraftConflictCodes.Stale);

        // Published: the program's next version, ready to assign, and the draft is gone.
        var published = await R42aPublishAsync(owner, started.Id, fixedUp.Version, replaceNewer: false);
        Assert.AreEqual((first.TemplateId, 2, true), (published.TemplateId, published.VersionNumber, published.IsPublished));
        Assert.AreEqual(9m, published.Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single().TargetRpe);
        await AssertStatusAsync(await owner.GetAsync(R42aDraftUrl(started.Id)), HttpStatusCode.NotFound);
        var after = await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId));
        Assert.AreEqual(2, after.CurrentVersionNumber);
        Assert.IsNull(after.Draft);
        Assert.IsEmpty(await ReadSliceAsync<ProgramDraftSummary[]>(owner, R42aDraftsUrl));
    }

    [TestMethod]
    public async Task R42aANewProgramIsItsCoachsOwnUntilItsFirstPublish()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r42a-new-owner@example.test", "Hicham Haddad", "R42a New");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r42a-new-coach@example.test", "Lina Saad");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);

        // Started before it has a name: the coach's own, and not yet a program anyone can assign.
        var started = await R42aCreateAsync(coach, new(null, null, null, R42aContent(squat.Id, alternative.Id, name: string.Empty)));
        var mine = (await ReadSliceAsync<ProgramDraftSummary[]>(coach, R42aDraftsUrl)).Single();
        Assert.AreEqual((started.Id, (Guid?)null, string.Empty), (mine.Id, mine.TemplateId, mine.Name));
        Assert.AreEqual(0, (await ReadSliceAsync<ProgramTemplatePage>(coach, "/api/training/templates")).Total);

        // Nobody else reads or touches it, the workspace owner included.
        Assert.IsEmpty(await ReadSliceAsync<ProgramDraftSummary[]>(owner, R42aDraftsUrl));
        await AssertStatusAsync(await owner.GetAsync(R42aDraftUrl(started.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await R42aPutAsync(owner, started.Id, started.Version, R42aContent(squat.Id, alternative.Id)),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R42aPublishUrl(started.Id), new PublishProgramDraftRequest(started.Version, false)),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R42aDiscardUrl(started.Id), new DiscardProgramDraftRequest(started.Version)),
            HttpStatusCode.NotFound);

        // Named and published: the workspace's program at version 1, which the team now sees.
        var named = await R42aSaveAsync(coach, started.Id, started.Version, R42aContent(squat.Id, alternative.Id, name: "Hypertrophy Base"));
        var published = await R42aPublishAsync(coach, started.Id, named.Version, replaceNewer: false);
        Assert.AreEqual((1, true, "Hypertrophy Base"), (published.VersionNumber, published.IsPublished, published.Name));
        var team = await ReadSliceAsync<ProgramTemplatePage>(owner, "/api/training/templates");
        Assert.AreEqual(published.TemplateId, team.Items.Single().Id);
        Assert.IsNull(team.Items.Single().Draft);
        Assert.IsEmpty(await ReadSliceAsync<ProgramDraftSummary[]>(coach, R42aDraftsUrl));
    }

    [TestMethod]
    public async Task R42aPublishingOverANewerVersionAsksFirstAndKeepsTheOtherVersion()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r42a-race-owner@example.test", "Hicham Haddad", "R42a Race");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r42a-race-coach@example.test", "Lina Saad");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var first = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);

        // Each starts from version 1, and the owner publishes first.
        var coachDraft = await R42aCreateAsync(coach, new(first.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id, targetRpe: 9m)));
        var ownerDraft = await R42aCreateAsync(owner, new(first.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id, targetRpe: 7m)));
        var second = await R42aPublishAsync(owner, ownerDraft.Id, ownerDraft.Version, replaceNewer: false);
        Assert.AreEqual(2, second.VersionNumber);

        // The coach is told before anything is replaced, and their changes stay.
        await RefreshCsrfAsync(coach);
        await R42aAssertConflictAsync(
            await coach.PostAsJsonAsync(R42aPublishUrl(coachDraft.Id), new PublishProgramDraftRequest(coachDraft.Version, false)),
            ProgramDraftConflictCodes.NewerVersionPublished);
        await AssertStatusAsync(await coach.GetAsync(R42aDraftUrl(coachDraft.Id)), HttpStatusCode.OK);

        // Publishing anyway makes theirs the newest; the owner's stays among the program's versions.
        var third = await R42aPublishAsync(coach, coachDraft.Id, coachDraft.Version, replaceNewer: true);
        Assert.AreEqual(3, third.VersionNumber);
        var summary = await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId));
        CollectionAssert.AreEqual(
            new[] { third.Id, second.Id, first.Id },
            summary.Versions.Select(version => version.Id).ToArray());
    }

    [TestMethod]
    public async Task R42aDraftsAreReachedOnlyByTheirOwnerInTheirWorkspace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r42a-scope-owner@example.test", "Hicham Haddad", "R42a Scope");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var first = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);
        var draft = await R42aCreateAsync(owner, new(first.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id)));
        using var client = CreateClient();
        await R31InviteAsync(owner, client, tenant, "r42a-scope-maya@example.test", "Maya", "Rahman");

        // A client keeps no drafts, and nobody signed out reaches one.
        await AssertStatusAsync(await client.GetAsync(R42aDraftsUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync(R42aDraftUrl(draft.Id)), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(R42aDraftsUrl, new CreateProgramDraftRequest(null, null, null, R42aContent(squat.Id, alternative.Id)), SliceReadJson),
            HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R42aDraftUrl(draft.Id)), HttpStatusCode.Unauthorized);

        // Another workspace is refused this one and finds nothing of it in its own.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r42a-scope-stranger@example.test", "Other Owner", "R42a Elsewhere");
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R42aDraftUrl(draft.Id)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
        var elsewhere = await stranger.GetAsync(R42aDraftUrl(draft.Id));
        await AssertStatusAsync(elsewhere, HttpStatusCode.NotFound);
        Assert.IsFalse((await elsewhere.Content.ReadAsStringAsync()).Contains("Powerlifting", StringComparison.Ordinal));
        await AssertStatusAsync(
            await R42aPutAsync(stranger, draft.Id, draft.Version, R42aContent(squat.Id, alternative.Id)),
            HttpStatusCode.NotFound);

        // Nor does it start changes to this workspace's program, or learn the names of its exercises.
        await AssertStatusAsync(
            await stranger.PostAsJsonAsync(
                R42aDraftsUrl,
                new CreateProgramDraftRequest(first.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id)),
                SliceReadJson),
            HttpStatusCode.NotFound);
        var borrowed = await R42aCreateAsync(stranger, new(null, null, null, R42aContent(squat.Id, alternative.Id)));
        Assert.IsEmpty((await ReadSliceAsync<ProgramDraftView>(stranger, R42aDraftUrl(borrowed.Id))).Exercises);
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(
            await stranger.PostAsJsonAsync(R42aPublishUrl(borrowed.Id), new PublishProgramDraftRequest(borrowed.Version, false)),
            HttpStatusCode.BadRequest);

        // A draft of one program starts from one of its own versions, at a number it really had.
        var other = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                R42aDraftsUrl,
                new CreateProgramDraftRequest(other.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id)),
                SliceReadJson),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                R42aDraftsUrl,
                new CreateProgramDraftRequest(other.TemplateId, other.Id, 2, R42aContent(squat.Id, alternative.Id)),
                SliceReadJson),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task R42aTwoTabsNeitherStartTwoDraftsNorOverwriteEachOther()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r42a-tabs-owner@example.test", "Hicham Haddad", "R42a Tabs");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var first = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);

        // Two tabs start changes to one program at once: one draft, and the other is told to reload.
        await RefreshCsrfAsync(owner);
        var start = new CreateProgramDraftRequest(first.TemplateId, first.Id, 1, R42aContent(squat.Id, alternative.Id));
        var starts = await Task.WhenAll(
            owner.PostAsJsonAsync(R42aDraftsUrl, start, SliceReadJson),
            owner.PostAsJsonAsync(R42aDraftsUrl, start, SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, starts.Select(response => response.StatusCode).ToArray());
        await R42aAssertConflictAsync(
            starts.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            ProgramDraftConflictCodes.AlreadyExists);
        var draft = await ReadSlicePayloadAsync<ProgramDraftSaveView>(
            starts.Single(response => response.StatusCode == HttpStatusCode.OK));

        // Two saves from the same read: one lands, and the other is refused rather than overwriting it.
        // The token is refreshed once, before both: refreshing it inside each request rewrites the shared
        // client's header while the other request is on its way, so either save could be sent without a
        // valid token and neither would land.
        await RefreshCsrfAsync(owner);
        var saves = await Task.WhenAll(
            owner.PutAsJsonAsync(
                R42aDraftUrl(draft.Id),
                new SaveProgramDraftRequest(R42aContent(squat.Id, alternative.Id, targetRpe: 7m), draft.Version),
                SliceReadJson),
            owner.PutAsJsonAsync(
                R42aDraftUrl(draft.Id),
                new SaveProgramDraftRequest(R42aContent(squat.Id, alternative.Id, targetRpe: 9m), draft.Version),
                SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, saves.Select(response => response.StatusCode).ToArray());
        await R42aAssertConflictAsync(
            saves.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            ProgramDraftConflictCodes.Stale);
        var kept = await ReadSlicePayloadAsync<ProgramDraftSaveView>(
            saves.Single(response => response.StatusCode == HttpStatusCode.OK));

        // Discarding from the older read is refused too; from the newest it leaves the program as it was.
        await R42aAssertConflictAsync(
            await owner.PostAsJsonAsync(R42aDiscardUrl(draft.Id), new DiscardProgramDraftRequest(draft.Version)),
            ProgramDraftConflictCodes.Stale);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R42aDiscardUrl(draft.Id), new DiscardProgramDraftRequest(kept.Version)),
            HttpStatusCode.NoContent);
        await AssertStatusAsync(await owner.GetAsync(R42aDraftUrl(draft.Id)), HttpStatusCode.NotFound);
        var program = await ReadSliceAsync<ProgramTemplateSummary>(owner, R41ProgramUrl(first.TemplateId));
        Assert.AreEqual(1, program.CurrentVersionNumber);
        Assert.IsNull(program.Draft);
    }

    [TestMethod]
    public async Task R42aADraftIsBoundedInShapeAndNumberButNotInItsValues()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r42a-limits-owner@example.test", "Hicham Haddad", "R42a Limits");
        var alternative = await CreateExerciseAsync(owner, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(owner, "Back squat", [alternative.Id], []);
        var content = R42aContent(squat.Id, alternative.Id);
        var week = content.Weeks.Single();
        var session = week.Sessions.Single();

        // What a version could never hold is refused, by field.
        await R42aAssertInvalidAsync(owner, content with { Weeks = [.. Enumerable.Repeat(week, 53)] }, "weeks");
        await R42aAssertInvalidAsync(owner, content with { Weeks = [week with { Sessions = [session with { DayOffset = 7 }] }] }, "sessions");
        await R42aAssertInvalidAsync(owner, content with { Name = "Bad\0name" }, "name");
        var note = new string('x', 1_000);
        var exercise = session.Exercises.Single();
        var heavy = session with
        {
            Exercises = [exercise with { Sets = [.. Enumerable.Repeat(exercise.Sets.Single() with { CoachNotes = note }, 20)] }],
        };
        await R42aAssertInvalidAsync(
            owner,
            content with { Weeks = [.. Enumerable.Repeat(week with { Sessions = [.. Enumerable.Repeat(heavy, 10)] }, 11)] },
            "content");

        // At most twenty new programs per coach, even when two starts race for the last place.
        for (var count = 0; count < ProgramDraft.MaximumNewProgramsPerOwner - 1; count++)
        {
            await R42aCreateAsync(owner, new(null, null, null, content));
        }

        await RefreshCsrfAsync(owner);
        var fresh = new CreateProgramDraftRequest(null, null, null, content);
        var racing = await Task.WhenAll(
            owner.PostAsJsonAsync(R42aDraftsUrl, fresh, SliceReadJson),
            owner.PostAsJsonAsync(R42aDraftsUrl, fresh, SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, racing.Select(response => response.StatusCode).ToArray());
        await R42aAssertConflictAsync(
            racing.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            ProgramDraftConflictCodes.LimitReached);
        Assert.HasCount(ProgramDraft.MaximumNewProgramsPerOwner, await ReadSliceAsync<ProgramDraftSummary[]>(owner, R42aDraftsUrl));

        // Changes to a saved program do not count against it.
        var program = await CreateTemplateAsync(owner, squat.Id, alternative.Id, 8m);
        await R42aCreateAsync(owner, new(program.TemplateId, program.Id, 1, content));
    }

    private static readonly string[] R42aExerciseNames = ["Back squat", "Safety-bar squat"];

    /// <summary>
    /// One week, one session, one exercise with one set: the content the builder sends, as the module's
    /// own contract so enum values travel as names.
    /// </summary>
    private static ProgramDraftContent R42aContent(
        Guid exerciseId,
        Guid alternativeId,
        string name = "Powerlifting Base",
        string sessionName = "Squat day",
        int reps = 5,
        decimal targetRpe = 8m) =>
        new(
            name,
            "Fast strength template",
            [
                new TrainingWeekRequest(
                    "Week 1",
                    true,
                    [
                        new TrainingSessionRequest(
                            sessionName,
                            0,
                            "Brace before every rep.",
                            [
                                new ExercisePrescriptionRequest(
                                    exerciseId,
                                    1,
                                    false,
                                    PrescriptionModificationPolicy.CoachApprovedSwap,
                                    "Stop if technique degrades.",
                                    [alternativeId],
                                    [
                                        new SetPrescriptionRequest(
                                            1,
                                            TrainingSetType.Top,
                                            reps,
                                            reps,
                                            TrainingLoadStrategy.RpeBasedEpley,
                                            null,
                                            TrainingLoadUnit.Kilogram,
                                            null,
                                            targetRpe,
                                            null,
                                            ExertionDisplayPreference.Rpe,
                                            180,
                                            "3-1-1",
                                            "Crisp reps"),
                                    ]),
                            ]),
                    ]),
            ]);

    private static async Task<ProgramDraftSaveView> R42aCreateAsync(HttpClient coach, CreateProgramDraftRequest request)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R42aDraftsUrl, request, SliceReadJson);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ProgramDraftSaveView>(response);
    }

    private static async Task<HttpResponseMessage> R42aPutAsync(
        HttpClient coach,
        Guid draftId,
        uint version,
        ProgramDraftContent content)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PutAsJsonAsync(R42aDraftUrl(draftId), new SaveProgramDraftRequest(content, version), SliceReadJson);
    }

    private static async Task<ProgramDraftSaveView> R42aSaveAsync(
        HttpClient coach,
        Guid draftId,
        uint version,
        ProgramDraftContent content)
    {
        var response = await R42aPutAsync(coach, draftId, version, content);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ProgramDraftSaveView>(response);
    }

    private static async Task<ProgramTemplateVersionView> R42aPublishAsync(
        HttpClient coach,
        Guid draftId,
        uint version,
        bool replaceNewer)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R42aPublishUrl(draftId), new PublishProgramDraftRequest(version, replaceNewer));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ProgramTemplateVersionView>(response);
    }

    private static async Task R42aAssertInvalidAsync(HttpClient coach, ProgramDraftContent content, string field)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R42aDraftsUrl, new CreateProgramDraftRequest(null, null, null, content), SliceReadJson);
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<R42aValidationProblem>(response);
        Assert.IsTrue(problem.Errors.ContainsKey(field), $"Expected an error on '{field}': {string.Join(", ", problem.Errors.Keys)}");
    }

    private static async Task R42aAssertConflictAsync(HttpResponseMessage response, string code)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        Assert.AreEqual(code, (await RequiredJsonAsync<R42aConflict>(response)).Code);
    }

    private sealed record R42aConflict(string Code, string Message);

    private sealed record R42aValidationProblem(Dictionary<string, string[]> Errors);
}
