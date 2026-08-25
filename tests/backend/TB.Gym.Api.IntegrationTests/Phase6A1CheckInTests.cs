using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6A1CoachAuthorsPublishesAndAssignsWhileTheClientReadsTheAssignedVersion()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a1-flow-coach@example.test",
            "Check-in Coach",
            "Check-in Workspace");
        using var clientA = CreateClient();
        var clientAId = await InviteAndAcceptAsync(coach, clientA, "p6a1-flow-a@example.test", true);
        SetTenant(clientA, workspaceId);
        await Phase6EnrollAsync(coach, clientAId, "Check-in coaching", "CheckIns");

        // One question of each supported type, authored into the lineage's first draft.
        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"),
            Phase6LongText("Anything else this week?"),
            Phase6SingleChoice("Energy level", EnergyOptions),
            Phase6MultipleChoice("Equipment used", EquipmentOptions),
            Phase6Scale("Sleep quality", 1m, 10m, 1m));

        Assert.AreEqual("Draft", form.Form.Status);
        Assert.AreEqual(1, form.Form.CurrentVersionNumber);
        Assert.IsNull(form.Form.LatestPublishedVersionId);
        Assert.HasCount(1, form.Versions);
        Assert.AreEqual(form.Versions[0].Id, form.Form.DraftVersionId);
        Assert.AreEqual(5, form.Versions[0].QuestionCount);

        var firstVersion = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        Assert.AreEqual("Published", firstVersion.Status);
        Assert.IsNotNull(firstVersion.PublishedAtUtc);
        Assert.IsNotNull(firstVersion.PublishedByUserId);
        Assert.HasCount(5, firstVersion.Questions);
        var originalKeys = firstVersion.Questions.Select(question => question.QuestionKey).ToArray();
        CollectionAssert.AreEqual(
            ExpectedQuestionTypes,
            firstVersion.Questions.Select(question => question.QuestionType).ToArray());
        Assert.AreEqual(1m, firstVersion.Questions[4].ScaleMinimum);
        Assert.AreEqual(10m, firstVersion.Questions[4].ScaleMaximum);

        var afterPublish = await Phase6GetFormAsync(coach, form.Form.Id);
        Assert.AreEqual("Published", afterPublish.Form.Status);
        Assert.AreEqual(firstVersion.Id, afterPublish.Form.LatestPublishedVersionId);
        Assert.IsNull(afterPublish.Form.DraftVersionId);

        // Assigned with a workspace-local due date, resolved through the workspace time zone.
        var firstDueDate = Phase6WorkspaceToday().AddDays(3);
        var assignResponse = await Phase6AssignAsync(coach, clientAId, firstVersion.Id, firstDueDate);
        await AssertStatusAsync(assignResponse, HttpStatusCode.OK);
        var firstAssignment = await RequiredJsonAsync<Phase6AssignmentDetail>(assignResponse);
        Assert.AreEqual(firstVersion.Id, firstAssignment.Assignment.FormVersionId);
        Assert.AreEqual(1, firstAssignment.Assignment.FormVersionNumber);
        Assert.AreEqual(firstDueDate, firstAssignment.Assignment.DueDate);

        // The client reads what they were asked. This surface is read-only in this chunk.
        var clientList = await clientA.GetFromJsonAsync<Phase6AssignmentList>("/api/checkins/me/assignments")
            ?? throw new AssertFailedException("Client assignment list was empty.");
        Assert.HasCount(1, clientList.Assignments);
        Assert.AreEqual(firstAssignment.Assignment.Id, clientList.Assignments[0].Id);
        Assert.AreEqual("Weekly check-in", clientList.Assignments[0].FormTitle);

        var clientDetail = await clientA.GetFromJsonAsync<Phase6AssignmentDetail>(
            $"/api/checkins/me/assignments/{firstAssignment.Assignment.Id}")
            ?? throw new AssertFailedException("Client assignment detail was empty.");
        Assert.AreEqual("How is your body feeling?", clientDetail.Version.Questions[0].Prompt);
        CollectionAssert.AreEqual(
            EnergyOptions,
            clientDetail.Version.Questions[2].Options.Select(option => option.Label).ToArray());
        CollectionAssert.AreEqual(
            EquipmentOptions,
            clientDetail.Version.Questions[3].Options.Select(option => option.Label).ToArray());

        // v2 re-words the first question, adds an option, and keeps every question key.
        var draft = await Phase6DeriveDraftAsync(coach, afterPublish, firstVersion.Id);
        Assert.AreEqual(2, draft.VersionNumber);
        Assert.AreEqual("Draft", draft.Status);
        Assert.AreEqual(firstVersion.Id, draft.DerivedFromVersionId);
        CollectionAssert.AreEqual(
            originalKeys,
            draft.Questions.Select(question => question.QuestionKey).ToArray());

        await RefreshCsrfAsync(coach);
        var saveResponse = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draft.Id}",
            new
            {
                questions = new[]
                {
                    Phase6ShortText("How does your body feel today?", draft.Questions[0].QuestionKey),
                    Phase6LongText("Anything else this week?", draft.Questions[1].QuestionKey),
                    Phase6SingleChoice(
                        "Energy level",
                        ExtendedEnergyOptions,
                        draft.Questions[2].QuestionKey),
                    Phase6MultipleChoice("Equipment used", EquipmentOptions, draft.Questions[3].QuestionKey),
                    Phase6Scale("Sleep quality", 1m, 10m, 1m, draft.Questions[4].QuestionKey),
                },
                draft.Version,
            });
        await AssertStatusAsync(saveResponse, HttpStatusCode.OK);
        var editedDraft = await RequiredJsonAsync<Phase6Version>(saveResponse);
        Assert.AreEqual("How does your body feel today?", editedDraft.Questions[0].Prompt);
        Assert.HasCount(4, editedDraft.Questions[2].Options);
        CollectionAssert.AreEqual(
            originalKeys,
            editedDraft.Questions.Select(question => question.QuestionKey).ToArray());

        var beforeSecondPublish = await Phase6GetFormAsync(coach, form.Form.Id);
        var secondVersion = await Phase6PublishAsync(
            coach,
            form.Form.Id,
            beforeSecondPublish.Versions.Single(version => version.Status == "Draft"));
        Assert.AreEqual(2, secondVersion.VersionNumber);

        // The existing assignment still resolves v1's exact wording and options.
        var reReadFirst = await clientA.GetFromJsonAsync<Phase6AssignmentDetail>(
            $"/api/checkins/me/assignments/{firstAssignment.Assignment.Id}")
            ?? throw new AssertFailedException("Client assignment detail was empty.");
        Assert.AreEqual(firstVersion.Id, reReadFirst.Assignment.FormVersionId);
        Assert.AreEqual(1, reReadFirst.Assignment.FormVersionNumber);
        Assert.AreEqual("How is your body feeling?", reReadFirst.Version.Questions[0].Prompt);
        CollectionAssert.AreEqual(
            EnergyOptions,
            reReadFirst.Version.Questions[2].Options.Select(option => option.Label).ToArray());

        // A second assignment resolves v2.
        var secondDueDate = Phase6WorkspaceToday().AddDays(10);
        var secondResponse = await Phase6AssignAsync(coach, clientAId, secondVersion.Id, secondDueDate);
        await AssertStatusAsync(secondResponse, HttpStatusCode.OK);
        var secondAssignment = await RequiredJsonAsync<Phase6AssignmentDetail>(secondResponse);
        Assert.AreEqual(secondVersion.Id, secondAssignment.Assignment.FormVersionId);
        Assert.AreEqual("How does your body feel today?", secondAssignment.Version.Questions[0].Prompt);
        Assert.HasCount(4, secondAssignment.Version.Questions[2].Options);

        var bothAssignments = await clientA.GetFromJsonAsync<Phase6AssignmentList>("/api/checkins/me/assignments")
            ?? throw new AssertFailedException("Client assignment list was empty.");
        Assert.HasCount(2, bothAssignments.Assignments);
        CollectionAssert.AreEqual(
            ExpectedAssignedVersions,
            bothAssignments.Assignments.Select(assignment => assignment.FormVersionNumber).ToArray());

        // The same form on the same due date is a duplicate, not a second check-in.
        var duplicate = await Phase6AssignAsync(coach, clientAId, secondVersion.Id, secondDueDate);
        Assert.AreEqual(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.AreEqual("CheckInAlreadyAssigned", (await RequiredJsonAsync<Phase6Problem>(duplicate)).Code);

        // A blocked coach loses assignment, and the reason travels with the refusal.
        var details = await coach.GetFromJsonAsync<Phase5ClientDetails>($"/api/clients/{clientAId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientAId}/relationship/block",
                new { reason = "Blocked for the check-in test.", details.Version }),
            HttpStatusCode.OK);
        var blocked = await Phase6AssignAsync(
            coach,
            clientAId,
            secondVersion.Id,
            Phase6WorkspaceToday().AddDays(17));
        Assert.AreEqual(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.AreEqual("RelationshipBlocked", (await RequiredJsonAsync<Phase6Problem>(blocked)).AccessReason);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await coach.GetAsync($"/api/checkins/clients/{clientAId}/assignments")).StatusCode);

        // Tenant B can reach none of it: not the form, not the version, not the client.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(
            foreignCoach,
            "p6a1-flow-foreign@example.test",
            "Foreign Coach",
            "Foreign Check-in Workspace");
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.GetAsync($"/api/checkins/forms/{form.Form.Id}")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.GetAsync(
                $"/api/checkins/forms/{form.Form.Id}/versions/{firstVersion.Id}")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.GetAsync($"/api/checkins/clients/{clientAId}/assignments")).StatusCode);
        var foreignAssign = await Phase6AssignAsync(
            foreignCoach,
            clientAId,
            firstVersion.Id,
            Phase6WorkspaceToday().AddDays(4));
        Assert.AreEqual(HttpStatusCode.NotFound, foreignAssign.StatusCode);

        var foreignList = await foreignCoach.GetFromJsonAsync<Phase6FormPage>("/api/checkins/forms")
            ?? throw new AssertFailedException("Form page was empty.");
        Assert.AreEqual(0L, foreignList.Total);
    }

    [TestMethod]
    public async Task Phase6A1EntitlementDecidesWhoCanReachCheckIns()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a1-entitle-coach@example.test",
            "Entitlement Coach",
            "Entitlement Workspace");
        using var entitled = CreateClient();
        var entitledId = await InviteAndAcceptAsync(coach, entitled, "p6a1-entitle-yes@example.test", true);
        SetTenant(entitled, workspaceId);
        using var unentitled = CreateClient();
        var unentitledId = await InviteAndAcceptAsync(coach, unentitled, "p6a1-entitle-no@example.test", true);
        SetTenant(unentitled, workspaceId);

        await Phase6EnrollAsync(coach, entitledId, "Check-in coaching", "CheckIns");

        // A training-only enrollment proves the gate is the CheckIns feature and not "has a product".
        await Phase6EnrollAsync(coach, unentitledId, "Training only", "Training");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var dueDate = Phase6WorkspaceToday().AddDays(2);
        await AssertStatusAsync(
            await Phase6AssignAsync(coach, entitledId, version.Id, dueDate),
            HttpStatusCode.OK);

        // The entitled client reads their own list; the unentitled one is refused with the reason.
        var list = await entitled.GetFromJsonAsync<Phase6AssignmentList>("/api/checkins/me/assignments")
            ?? throw new AssertFailedException("Assignment list was empty.");
        Assert.HasCount(1, list.Assignments);

        var denied = await unentitled.GetAsync("/api/checkins/me/assignments");
        Assert.AreEqual(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.AreEqual("NoEntitlement", (await RequiredJsonAsync<Phase6Problem>(denied)).AccessReason);

        // Assigning to the unentitled client is refused for the same reason on the coach route.
        var refused = await Phase6AssignAsync(coach, unentitledId, version.Id, dueDate);
        Assert.AreEqual(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.AreEqual("NoEntitlement", (await RequiredJsonAsync<Phase6Problem>(refused)).AccessReason);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await coach.GetAsync($"/api/checkins/clients/{unentitledId}/assignments")).StatusCode);

        // Losing the entitlement closes the client's own list immediately.
        var enrollments = await coach.GetFromJsonAsync<Phase6CommercialOverview>(
            $"/api/commercial/clients/{entitledId}")
            ?? throw new AssertFailedException("Commercial overview was empty.");
        var enrollment = enrollments.Enrollments.Single();
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollment.Id}/pause",
                new { reason = "Entitlement enforcement test", enrollment.Version }),
            HttpStatusCode.OK);
        var paused = await entitled.GetAsync("/api/checkins/me/assignments");
        Assert.AreEqual(HttpStatusCode.Forbidden, paused.StatusCode);
        Assert.AreEqual("Paused", (await RequiredJsonAsync<Phase6Problem>(paused)).AccessReason);
    }

    [TestMethod]
    public async Task Phase6A1AssignmentRefusesAnUnpublishedVersionAndAPastDueDate()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a1-refuse-coach@example.test",
            "Refusal Coach",
            "Refusal Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6a1-refuse-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));

        // The draft's wording can still change, so it cannot be assigned.
        var unpublished = await Phase6AssignAsync(
            coach,
            clientId,
            form.Versions[0].Id,
            Phase6WorkspaceToday().AddDays(1));
        Assert.AreEqual(HttpStatusCode.Conflict, unpublished.StatusCode);
        Assert.AreEqual(
            "CheckInVersionNotPublished",
            (await RequiredJsonAsync<Phase6Problem>(unpublished)).Code);

        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);

        // Yesterday in the workspace time zone asks for something that can no longer be delivered.
        var past = await Phase6AssignAsync(
            coach,
            clientId,
            version.Id,
            Phase6WorkspaceToday().AddDays(-1));
        await AssertStatusAsync(past, HttpStatusCode.BadRequest);

        // Today is accepted, so the boundary is the workspace's own date and not "strictly future".
        await AssertStatusAsync(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday()),
            HttpStatusCode.OK);

        // A published version cannot be edited or re-published through the API either.
        await RefreshCsrfAsync(coach);
        var editPublished = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{version.Id}",
            new { questions = new[] { Phase6ShortText("Rewritten after publication.") }, version.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, editPublished.StatusCode);
        Assert.AreEqual(
            "CheckInVersionPublished",
            (await RequiredJsonAsync<Phase6Problem>(editPublished)).Code);

        await RefreshCsrfAsync(coach);
        var republish = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{version.Id}/publish",
            new { version.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, republish.StatusCode);

        // An invented question key is refused: alignment across versions depends on real ones.
        var afterPublish = await Phase6GetFormAsync(coach, form.Form.Id);
        var draft = await Phase6DeriveDraftAsync(coach, afterPublish, version.Id);
        await RefreshCsrfAsync(coach);
        var invented = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draft.Id}",
            new
            {
                questions = new[] { Phase6ShortText("Invented key.", new string('a', 32)) },
                draft.Version,
            });
        await AssertStatusAsync(invented, HttpStatusCode.BadRequest);

        // A numeric scale whose step cannot land on its maximum is refused by the API too.
        await RefreshCsrfAsync(coach);
        var badScale = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draft.Id}",
            new { questions = new[] { Phase6Scale("Sleep", 1m, 10m, 2m) }, draft.Version });
        await AssertStatusAsync(badScale, HttpStatusCode.BadRequest);

        // Only one open draft per lineage, so "the draft" is never ambiguous.
        var withDraft = await Phase6GetFormAsync(coach, form.Form.Id);
        await RefreshCsrfAsync(coach);
        var secondDraft = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions",
            new { sourceVersionId = version.Id, formVersion = withDraft.Form.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, secondDraft.StatusCode);
        Assert.AreEqual(
            "CheckInDraftAlreadyOpen",
            (await RequiredJsonAsync<Phase6Problem>(secondDraft)).Code);
    }

    [TestMethod]
    public async Task Phase6A1ConcurrentDraftEditsReturnExactlyOneConflict()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6a1-race-coach@example.test",
            "Race Coach",
            "Race Workspace");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        var draftId = form.Versions[0].Id;
        var token = form.Versions[0].Version;

        await RefreshCsrfAsync(coach);
        var responses = await Task.WhenAll(
            coach.PutAsJsonAsync(
                $"/api/checkins/forms/{form.Form.Id}/versions/{draftId}",
                new { questions = new[] { Phase6ShortText("Edit A.") }, version = token }),
            coach.PutAsJsonAsync(
                $"/api/checkins/forms/{form.Form.Id}/versions/{draftId}",
                new { questions = new[] { Phase6ShortText("Edit B.") }, version = token }));

        var succeeded = responses.Count(response => response.StatusCode == HttpStatusCode.OK);
        var conflicted = responses.Count(response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.AreEqual(
            1,
            succeeded,
            $"Exactly one draft edit may win; received {string.Join(", ", responses.Select(item => (int)item.StatusCode))}.");
        Assert.AreEqual(1, conflicted);

        // The loser changed nothing: the draft holds one question, from whichever edit won.
        var reread = await coach.GetFromJsonAsync<Phase6Version>(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draftId}")
            ?? throw new AssertFailedException("Draft was empty.");
        Assert.HasCount(1, reread.Questions);
        CollectionAssert.Contains(RacingEdits, reread.Questions[0].Prompt);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT count(*) FROM checkins.\"CheckInQuestions\" WHERE \"FormVersionId\" = @version";
        command.Parameters.AddWithValue("version", draftId);
        Assert.AreEqual(1L, (long)(await command.ExecuteScalarAsync() ?? -1L));
    }

    [TestMethod]
    public async Task Phase6A1PublishedVersionsAreImmutableAtTheDatabase()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6a1-frozen-coach@example.test",
            "Frozen Coach",
            "Frozen Workspace");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6SingleChoice("Energy level", EnergyOptions));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var questionId = version.Questions[0].Id;
        var optionId = version.Questions[0].Options[0].Id;

        // The application refuses these too, but the trigger is what makes them impossible for a
        // migration, a repair script, or anything else that does not go through the domain.
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInFormVersions\" SET \"Status\" = 'Draft', \"IsDraft\" = TRUE WHERE \"Id\" = @id",
            version.Id);
        await Phase6AssertRejectedAsync(
            "DELETE FROM checkins.\"CheckInFormVersions\" WHERE \"Id\" = @id",
            version.Id);
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInQuestions\" SET \"Prompt\" = 'Rewritten' WHERE \"Id\" = @id",
            questionId);
        await Phase6AssertRejectedAsync(
            "DELETE FROM checkins.\"CheckInQuestions\" WHERE \"Id\" = @id",
            questionId);
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInQuestionOptions\" SET \"Label\" = 'Rewritten' WHERE \"Id\" = @id",
            optionId);
        await Phase6AssertRejectedAsync(
            "DELETE FROM checkins.\"CheckInQuestionOptions\" WHERE \"Id\" = @id",
            optionId);

        // The publish record is history and cannot be edited away.
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInLifecycleEvents\" SET \"ActorUserId\" = gen_random_uuid() WHERE \"FormVersionId\" = @id",
            version.Id);

        // A draft's questions stay editable, which is what makes the frozen state meaningful.
        var afterPublish = await Phase6GetFormAsync(coach, form.Form.Id);
        var draft = await Phase6DeriveDraftAsync(coach, afterPublish, version.Id);
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var draftUpdate = connection.CreateCommand();
        draftUpdate.CommandText =
            "UPDATE checkins.\"CheckInQuestions\" SET \"Prompt\" = 'Draft edit' WHERE \"Id\" = @id";
        draftUpdate.Parameters.AddWithValue("id", draft.Questions[0].Id);
        Assert.AreEqual(1, await draftUpdate.ExecuteNonQueryAsync());

        // And the ordering rule is a deferred constraint, so a gap is refused at commit.
        await using var gap = connection.CreateCommand();
        gap.CommandText =
            "UPDATE checkins.\"CheckInQuestions\" SET \"Order\" = 5 WHERE \"Id\" = @id";
        gap.Parameters.AddWithValue("id", draft.Questions[0].Id);
        var ordering = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await gap.ExecuteNonQueryAsync());
        Assert.AreEqual("23514", ordering.SqlState);
    }

    private async Task Phase6AssertRejectedAsync(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var exception = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual("23514", exception.SqlState, sql);
    }

    private sealed record Phase6EnrollmentSummary(Guid Id, uint Version);

    private sealed record Phase6CommercialOverview(Phase6EnrollmentSummary[] Enrollments);
}
