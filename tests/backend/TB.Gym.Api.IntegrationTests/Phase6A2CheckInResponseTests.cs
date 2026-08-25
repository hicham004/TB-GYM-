using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6A2ClientDraftsSubmitsAndTheCoachReviewsAndComparesAcrossVersions()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a2-flow-coach@example.test",
            "Response Coach",
            "Response Workspace");
        using var clientA = CreateClient();
        var clientAId = await InviteAndAcceptAsync(coach, clientA, "p6a2-flow-a@example.test", true);
        SetTenant(clientA, workspaceId);
        await Phase6EnrollAsync(coach, clientAId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"),
            Phase6SingleChoice("Energy level", EnergyOptions),
            Phase6Scale("Sleep quality", 1m, 10m, 1m));
        var firstVersion = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var firstDue = Phase6WorkspaceToday().AddDays(2);
        var firstAssignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientAId, firstVersion.Id, firstDue));

        // Nothing exists until the client saves: there is no empty draft row waiting for them.
        var untouched = await Phase6GetOwnResponseAsync(clientA, firstAssignment.Assignment.Id);
        Assert.IsNull(untouched.Response);
        Assert.AreEqual(firstVersion.Id, untouched.Version.Id);

        // A partial draft: only the text question, and nothing else.
        var textQuestion = Phase6QuestionOfType(firstVersion, "ShortText");
        var partial = await Phase6SaveDraftAsync(
            clientA,
            firstAssignment.Assignment.Id,
            [Phase6TextAnswer(textQuestion.Id, "Shoulders are tight.")]);
        await AssertStatusAsync(partial, HttpStatusCode.OK);
        var draft = await RequiredJsonAsync<Phase6ResponseDetail>(partial);
        Assert.IsNotNull(draft.Response);
        Assert.AreEqual("Draft", draft.Response.Status);
        Assert.HasCount(1, draft.Response.Answers);
        Assert.IsNull(draft.Response.SubmittedAtUtc);

        // Resumed later with its answers intact, exactly as they were left.
        var resumed = await Phase6GetOwnResponseAsync(clientA, firstAssignment.Assignment.Id);
        Assert.IsNotNull(resumed.Response);
        Assert.AreEqual("Draft", resumed.Response.Status);
        Assert.AreEqual("Shoulders are tight.", resumed.Response.Answers.Single().TextValue);

        // Submitting a partial response is refused, and every missing required answer is named at once.
        var incomplete = await Phase6SubmitAsync(
            clientA,
            firstAssignment.Assignment.Id,
            resumed.Response.Version);
        await AssertStatusAsync(incomplete, HttpStatusCode.BadRequest);

        var completed = await Phase6SaveDraftAsync(
            clientA,
            firstAssignment.Assignment.Id,
            Phase6AnswerAll(firstVersion, "Shoulders are tight.", 8m),
            resumed.Response.Version);
        await AssertStatusAsync(completed, HttpStatusCode.OK);
        var ready = await RequiredJsonAsync<Phase6ResponseDetail>(completed);
        Assert.IsNotNull(ready.Response);
        Assert.HasCount(3, ready.Response.Answers);

        var submitted = await Phase6SubmitAsync(
            clientA,
            firstAssignment.Assignment.Id,
            ready.Response.Version);
        await AssertStatusAsync(submitted, HttpStatusCode.OK);
        var afterSubmit = await RequiredJsonAsync<Phase6ResponseDetail>(submitted);
        Assert.IsNotNull(afterSubmit.Response);
        Assert.AreEqual("Submitted", afterSubmit.Response.Status);
        Assert.IsNotNull(afterSubmit.Response.SubmittedAtUtc);
        Assert.AreEqual(Phase6WorkspaceToday(), afterSubmit.Response.SubmittedDate);
        Assert.IsFalse(afterSubmit.Response.IsLate);

        // A submitted check-in refuses further edits and a second submit.
        var reEdit = await Phase6SaveDraftAsync(
            clientA,
            firstAssignment.Assignment.Id,
            Phase6AnswerAll(firstVersion, "Rewritten.", 3m),
            afterSubmit.Response.Version);
        Assert.AreEqual(HttpStatusCode.Conflict, reEdit.StatusCode);
        Assert.AreEqual("CheckInResponseSubmitted", (await RequiredJsonAsync<Phase6Problem>(reEdit)).Code);

        var reSubmit = await Phase6SubmitAsync(
            clientA,
            firstAssignment.Assignment.Id,
            afterSubmit.Response.Version);
        Assert.AreEqual(HttpStatusCode.Conflict, reSubmit.StatusCode);

        // The coach reads it and reviews it. Review is one-way.
        var coachView = await Phase6GetClientResponseAsync(coach, clientAId, firstAssignment.Assignment.Id);
        Assert.IsNotNull(coachView.Response);
        Assert.AreEqual("Submitted", coachView.Response.Status);
        Assert.AreEqual("Shoulders are tight.", coachView.Response.Answers
            .Single(answer => answer.QuestionType == "ShortText").TextValue);

        var reviewed = await Phase6ReviewAsync(
            coach,
            clientAId,
            firstAssignment.Assignment.Id,
            coachView.Response.Version);
        await AssertStatusAsync(reviewed, HttpStatusCode.OK);
        var afterReview = await RequiredJsonAsync<Phase6ResponseDetail>(reviewed);
        Assert.IsNotNull(afterReview.Response);
        Assert.AreEqual("Reviewed", afterReview.Response.Status);
        Assert.IsNotNull(afterReview.Response.ReviewedAtUtc);
        Assert.IsNotNull(afterReview.Response.ReviewedByUserId);

        // Review never touched the answers.
        Assert.HasCount(3, afterReview.Response.Answers);
        Assert.AreEqual("Shoulders are tight.", afterReview.Response.Answers
            .Single(answer => answer.QuestionType == "ShortText").TextValue);

        var reReview = await Phase6ReviewAsync(
            coach,
            clientAId,
            firstAssignment.Assignment.Id,
            afterReview.Response.Version);
        Assert.AreEqual(HttpStatusCode.Conflict, reReview.StatusCode);

        // The coach publishes a revised version: one question re-worded, one added.
        var beforeDerive = await Phase6GetFormAsync(coach, form.Form.Id);
        var nextDraft = await Phase6DeriveDraftAsync(coach, beforeDerive, firstVersion.Id);
        await RefreshCsrfAsync(coach);
        var savedDraft = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{nextDraft.Id}",
            new
            {
                questions = new[]
                {
                    Phase6ShortText("How does your body feel today?", nextDraft.Questions[0].QuestionKey),
                    Phase6SingleChoice("Energy level", EnergyOptions, nextDraft.Questions[1].QuestionKey),
                    Phase6Scale("Sleep quality", 1m, 10m, 1m, nextDraft.Questions[2].QuestionKey),
                    Phase6LongText("Anything else?"),
                },
                nextDraft.Version,
            });
        await AssertStatusAsync(savedDraft, HttpStatusCode.OK);
        var beforeSecondPublish = await Phase6GetFormAsync(coach, form.Form.Id);
        var secondVersion = await Phase6PublishAsync(
            coach,
            form.Form.Id,
            beforeSecondPublish.Versions.Single(version => version.Status == "Draft"));

        // The first submission still renders v1's exact wording: immutability, not a copied snapshot.
        var reReadFirst = await Phase6GetClientResponseAsync(coach, clientAId, firstAssignment.Assignment.Id);
        Assert.AreEqual(firstVersion.Id, reReadFirst.Version.Id);
        Assert.AreEqual(1, reReadFirst.Assignment.FormVersionNumber);
        Assert.AreEqual("How is your body feeling?", reReadFirst.Version.Questions[0].Prompt);
        CollectionAssert.AreEqual(
            EnergyOptions,
            reReadFirst.Version.Questions[1].Options.Select(option => option.Label).ToArray());

        // The client answers the second assignment.
        var secondDue = Phase6WorkspaceToday().AddDays(9);
        var secondAssignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientAId, secondVersion.Id, secondDue));
        var secondSaved = await Phase6SaveDraftAsync(
            clientA,
            secondAssignment.Assignment.Id,
            Phase6AnswerAll(secondVersion, "Much better.", 9m));
        await AssertStatusAsync(secondSaved, HttpStatusCode.OK);
        var secondReady = await RequiredJsonAsync<Phase6ResponseDetail>(secondSaved);
        Assert.IsNotNull(secondReady.Response);
        await AssertStatusAsync(
            await Phase6SubmitAsync(clientA, secondAssignment.Assignment.Id, secondReady.Response.Version),
            HttpStatusCode.OK);

        // The coach compares the two across the lineage.
        var secondSubmitted = await Phase6GetClientResponseAsync(
            coach,
            clientAId,
            secondAssignment.Assignment.Id);
        Assert.IsNotNull(secondSubmitted.Response);
        var comparisonResponse = await Phase6CompareAsync(
            coach,
            clientAId,
            afterReview.Response.Id,
            secondSubmitted.Response.Id);
        await AssertStatusAsync(comparisonResponse, HttpStatusCode.OK);
        var comparison = await RequiredJsonAsync<Phase6Comparison>(comparisonResponse);

        Assert.AreEqual(form.Form.Id, comparison.FormId);
        Assert.AreEqual(1, comparison.First.FormVersionNumber);
        Assert.AreEqual(2, comparison.Second.FormVersionNumber);
        Assert.HasCount(4, comparison.Rows);
        CollectionAssert.AreEqual(
            ExpectedOneSidedPresence,
            comparison.Rows.Select(row => row.Presence).ToArray());

        // The shared questions align by key even though the first one was re-worded, and each side
        // carries its own version's wording rather than one standing in for both.
        var shared = comparison.Rows[0];
        Assert.AreEqual("InBoth", shared.Presence);
        Assert.IsNotNull(shared.First);
        Assert.IsNotNull(shared.Second);
        Assert.AreEqual("How is your body feeling?", shared.First.Prompt);
        Assert.AreEqual("How does your body feel today?", shared.Second.Prompt);
        Assert.AreEqual("Shoulders are tight.", shared.First.Answer?.TextValue);
        Assert.AreEqual("Much better.", shared.Second.Answer?.TextValue);

        // The question added in v2 is reported as one-sided, never dropped and never shown as an
        // unanswered question on the side that was never asked it.
        var oneSided = comparison.Rows[3];
        Assert.AreEqual("OnlyInSecond", oneSided.Presence);
        Assert.IsNull(oneSided.First);
        Assert.IsNotNull(oneSided.Second);
        Assert.AreEqual("Anything else?", oneSided.Second.Prompt);

        // A blocked coach loses every response route, and the reason travels with the refusal.
        var details = await coach.GetFromJsonAsync<Phase5ClientDetails>($"/api/clients/{clientAId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientAId}/relationship/block",
                new { reason = "Blocked for the response test.", details.Version }),
            HttpStatusCode.OK);

        var blockedRead = await coach.GetAsync(
            $"/api/checkins/clients/{clientAId}/assignments/{firstAssignment.Assignment.Id}/response");
        Assert.AreEqual(HttpStatusCode.Forbidden, blockedRead.StatusCode);
        Assert.AreEqual(
            "RelationshipBlocked",
            (await RequiredJsonAsync<Phase6Problem>(blockedRead)).AccessReason);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await Phase6ReviewAsync(coach, clientAId, secondAssignment.Assignment.Id, secondSubmitted.Response.Version)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await Phase6CompareAsync(coach, clientAId, afterReview.Response.Id, secondSubmitted.Response.Id)).StatusCode);

        // Tenant B can reach none of it.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(
            foreignCoach,
            "p6a2-flow-foreign@example.test",
            "Foreign Response Coach",
            "Foreign Response Workspace");
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.GetAsync(
                $"/api/checkins/clients/{clientAId}/assignments/{firstAssignment.Assignment.Id}/response")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await Phase6ReviewAsync(foreignCoach, clientAId, firstAssignment.Assignment.Id, 1u)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await Phase6CompareAsync(
                foreignCoach,
                clientAId,
                afterReview.Response.Id,
                secondSubmitted.Response.Id)).StatusCode);
    }

    [TestMethod]
    public async Task Phase6A2ADraftIsPrivateToTheClientUntilItIsSubmitted()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a2-private-coach@example.test",
            "Private Coach",
            "Private Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6a2-private-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(1)));

        await AssertStatusAsync(
            await Phase6SaveDraftAsync(
                client,
                assignment.Assignment.Id,
                [Phase6TextAnswer(version.Questions[0].Id, "Still writing this.")]),
            HttpStatusCode.OK);

        // The coach can see that a draft exists but never as a submission: it has no submitted date
        // and it cannot be reviewed.
        var coachView = await Phase6GetClientResponseAsync(coach, clientId, assignment.Assignment.Id);
        Assert.IsNotNull(coachView.Response);
        Assert.AreEqual("Draft", coachView.Response.Status);
        Assert.IsNull(coachView.Response.SubmittedAtUtc);
        Assert.IsNull(coachView.Response.SubmittedDate);

        var review = await Phase6ReviewAsync(
            coach,
            clientId,
            assignment.Assignment.Id,
            coachView.Response.Version);
        Assert.AreEqual(HttpStatusCode.Conflict, review.StatusCode);
        Assert.AreEqual(
            "CheckInResponseNotSubmitted",
            (await RequiredJsonAsync<Phase6Problem>(review)).Code);

        // A draft cannot be compared either, because it is not a record of anything yet.
        var submitted = await Phase6SaveDraftAsync(
            client,
            assignment.Assignment.Id,
            Phase6AnswerAll(version),
            coachView.Response.Version);
        var ready = await RequiredJsonAsync<Phase6ResponseDetail>(submitted);
        Assert.IsNotNull(ready.Response);

        var second = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(8)));
        await AssertStatusAsync(
            await Phase6SaveDraftAsync(client, second.Assignment.Id, Phase6AnswerAll(version)),
            HttpStatusCode.OK);
        var secondDraft = await Phase6GetOwnResponseAsync(client, second.Assignment.Id);
        Assert.IsNotNull(secondDraft.Response);

        var comparingDrafts = await Phase6CompareAsync(
            coach,
            clientId,
            ready.Response.Id,
            secondDraft.Response.Id);
        Assert.AreEqual(HttpStatusCode.Conflict, comparingDrafts.StatusCode);
        Assert.AreEqual(
            "CheckInResponseNotSubmitted",
            (await RequiredJsonAsync<Phase6Problem>(comparingDrafts)).Code);
    }

    [TestMethod]
    public async Task Phase6A2AnAnswerFromAnotherVersionIsRefusedByTheDatabase()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a2-foreign-coach@example.test",
            "Foreign Option Coach",
            "Foreign Option Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6a2-foreign-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6SingleChoice("Energy level", EnergyOptions));
        var firstVersion = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var afterPublish = await Phase6GetFormAsync(coach, form.Form.Id);
        var draft = await Phase6DeriveDraftAsync(coach, afterPublish, firstVersion.Id);
        var beforePublish = await Phase6GetFormAsync(coach, form.Form.Id);
        var secondVersion = await Phase6PublishAsync(
            coach,
            form.Form.Id,
            beforePublish.Versions.Single(version => version.Status == "Draft"));

        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, firstVersion.Id, Phase6WorkspaceToday().AddDays(1)));

        // v2's option carries the same label and the same question key, but it is a different row on a
        // different question. The API refuses it.
        var foreignOption = secondVersion.Questions[0].Options[0].Id;
        var refused = await Phase6SaveDraftAsync(
            client,
            assignment.Assignment.Id,
            [Phase6ChoiceAnswer(firstVersion.Questions[0].Id, foreignOption)]);
        await AssertStatusAsync(refused, HttpStatusCode.BadRequest);

        // And so does the database, which is what matters: the foreign key reaches
        // CheckInQuestionOptions (TenantId, QuestionId, Id), so v2's option is not addressable from an
        // answer to v1's question at all.
        await AssertStatusAsync(
            await Phase6SaveDraftAsync(
                client,
                assignment.Assignment.Id,
                [Phase6ChoiceAnswer(firstVersion.Questions[0].Id, firstVersion.Questions[0].Options[0].Id)]),
            HttpStatusCode.OK);
        var saved = await Phase6GetOwnResponseAsync(client, assignment.Assignment.Id);
        Assert.IsNotNull(saved.Response);
        var answerId = await Phase6ScalarAsync<Guid>(
            "SELECT \"Id\" FROM checkins.\"CheckInAnswers\" WHERE \"ResponseId\" = @id",
            saved.Response.Id);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE checkins.\"CheckInAnswerChoices\" SET \"QuestionOptionId\" = @option WHERE \"AnswerId\" = @id";
        command.Parameters.AddWithValue("option", foreignOption);
        command.Parameters.AddWithValue("id", answerId);
        var violation = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual(PostgresErrorCodes.ForeignKeyViolation, violation.SqlState);

        // Answering a question that belongs to v2 from a response to v1 is refused the same way.
        await using var crossVersion = connection.CreateCommand();
        crossVersion.CommandText =
            "UPDATE checkins.\"CheckInAnswers\" SET \"QuestionId\" = @question WHERE \"Id\" = @id";
        crossVersion.Parameters.AddWithValue("question", secondVersion.Questions[0].Id);
        crossVersion.Parameters.AddWithValue("id", answerId);
        var crossViolation = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await crossVersion.ExecuteNonQueryAsync());
        Assert.AreEqual(PostgresErrorCodes.ForeignKeyViolation, crossViolation.SqlState);
    }

    [TestMethod]
    public async Task Phase6A2ASubmittedResponseIsFrozenAtTheDatabase()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a2-frozen-coach@example.test",
            "Frozen Response Coach",
            "Frozen Response Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6a2-frozen-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"),
            Phase6SingleChoice("Energy level", EnergyOptions));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(1)));

        await AssertStatusAsync(
            await Phase6SaveDraftAsync(client, assignment.Assignment.Id, Phase6AnswerAll(version)),
            HttpStatusCode.OK);
        var ready = await Phase6GetOwnResponseAsync(client, assignment.Assignment.Id);
        Assert.IsNotNull(ready.Response);
        await AssertStatusAsync(
            await Phase6SubmitAsync(client, assignment.Assignment.Id, ready.Response.Version),
            HttpStatusCode.OK);

        var responseId = ready.Response.Id;
        var answerId = await Phase6ScalarAsync<Guid>(
            "SELECT \"Id\" FROM checkins.\"CheckInAnswers\" WHERE \"ResponseId\" = @id AND \"QuestionType\" = 'ShortText'",
            responseId);

        // The application refuses these too, but the trigger is what makes them impossible for a
        // migration, a repair script or anything else that does not go through the domain.
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInAnswers\" SET \"TextValue\" = 'Rewritten' WHERE \"Id\" = @id",
            answerId);
        await Phase6AssertRejectedAsync(
            "DELETE FROM checkins.\"CheckInAnswers\" WHERE \"Id\" = @id",
            answerId);
        await Phase6AssertRejectedAsync(
            "DELETE FROM checkins.\"CheckInResponses\" WHERE \"Id\" = @id",
            responseId);
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInResponses\" SET \"Status\" = 'Draft', \"SubmittedAtUtc\" = NULL, \"SubmittedDate\" = NULL WHERE \"Id\" = @id",
            responseId);
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInResponses\" SET \"SubmittedDate\" = \"SubmittedDate\" - 1 WHERE \"Id\" = @id",
            responseId);
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInResponses\" SET \"AssignmentId\" = gen_random_uuid() WHERE \"Id\" = @id",
            responseId);

        // The submission record is history and cannot be edited away.
        await Phase6AssertRejectedAsync(
            "UPDATE checkins.\"CheckInResponseEvents\" SET \"ActorUserId\" = gen_random_uuid() WHERE \"ResponseId\" = @id",
            responseId);
        await Phase6AssertRejectedAsync(
            "DELETE FROM checkins.\"CheckInResponseEvents\" WHERE \"ResponseId\" = @id",
            responseId);

        // Adding a late answer to a submitted check-in is refused as firmly as editing one.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var insert = connection.CreateCommand();
        insert.CommandText =
            """
            INSERT INTO checkins."CheckInAnswers"
                ("Id", "ResponseId", "FormVersionId", "QuestionId", "QuestionType", "TextValue",
                 "CreatedAtUtc", "UpdatedAtUtc", "TenantId")
            SELECT gen_random_uuid(), response."Id", response."FormVersionId", question."Id",
                   'LongText', 'Smuggled in', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, response."TenantId"
            FROM checkins."CheckInResponses" response
            JOIN checkins."CheckInQuestions" question ON question."FormVersionId" = response."FormVersionId"
            WHERE response."Id" = @id
            LIMIT 1
            """;
        insert.Parameters.AddWithValue("id", responseId);
        var late = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync());
        Assert.AreEqual("23514", late.SqlState);
    }

    [TestMethod]
    public async Task Phase6A2ConcurrentSubmitAndConcurrentReviewEachYieldExactlyOneConflict()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a2-race-coach@example.test",
            "Response Race Coach",
            "Response Race Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6a2-race-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(1)));

        await AssertStatusAsync(
            await Phase6SaveDraftAsync(client, assignment.Assignment.Id, Phase6AnswerAll(version)),
            HttpStatusCode.OK);
        var ready = await Phase6GetOwnResponseAsync(client, assignment.Assignment.Id);
        Assert.IsNotNull(ready.Response);

        await RefreshCsrfAsync(client);
        var submits = await Task.WhenAll(
            client.PostAsJsonAsync(
                $"/api/checkins/me/assignments/{assignment.Assignment.Id}/response/submit",
                new { ready.Response.Version }),
            client.PostAsJsonAsync(
                $"/api/checkins/me/assignments/{assignment.Assignment.Id}/response/submit",
                new { ready.Response.Version }));
        Assert.AreEqual(
            1,
            submits.Count(response => response.StatusCode == HttpStatusCode.OK),
            $"Exactly one submit may win; received {string.Join(", ", submits.Select(item => (int)item.StatusCode))}.");
        Assert.AreEqual(1, submits.Count(response => response.StatusCode == HttpStatusCode.Conflict));

        // Exactly one submission was recorded, so the history cannot claim it happened twice.
        Assert.AreEqual(
            1L,
            await Phase6ScalarAsync<long>(
                "SELECT count(*) FROM checkins.\"CheckInResponseEvents\" WHERE \"ResponseId\" = @id AND \"EventType\" = 'ResponseSubmitted'",
                ready.Response.Id));

        var submitted = await Phase6GetClientResponseAsync(coach, clientId, assignment.Assignment.Id);
        Assert.IsNotNull(submitted.Response);
        await RefreshCsrfAsync(coach);
        var reviews = await Task.WhenAll(
            coach.PostAsJsonAsync(
                $"/api/checkins/clients/{clientId}/assignments/{assignment.Assignment.Id}/response/review",
                new { submitted.Response.Version }),
            coach.PostAsJsonAsync(
                $"/api/checkins/clients/{clientId}/assignments/{assignment.Assignment.Id}/response/review",
                new { submitted.Response.Version }));
        Assert.AreEqual(
            1,
            reviews.Count(response => response.StatusCode == HttpStatusCode.OK),
            $"Exactly one review may win; received {string.Join(", ", reviews.Select(item => (int)item.StatusCode))}.");
        Assert.AreEqual(1, reviews.Count(response => response.StatusCode == HttpStatusCode.Conflict));
        Assert.AreEqual(
            1L,
            await Phase6ScalarAsync<long>(
                "SELECT count(*) FROM checkins.\"CheckInResponseEvents\" WHERE \"ResponseId\" = @id AND \"EventType\" = 'ResponseReviewed'",
                ready.Response.Id));
    }

    [TestMethod]
    public async Task Phase6A2ComparingAcrossTwoLineagesIsRefusedAndEntitlementGatesEveryResponseRoute()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6a2-gate-coach@example.test",
            "Gate Coach",
            "Gate Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6a2-gate-client@example.test", true);
        SetTenant(client, workspaceId);
        var enrollmentId = await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var weekly = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        var weeklyVersion = await Phase6PublishAsync(coach, weekly.Form.Id, weekly.Versions[0]);
        var monthly = await Phase6CreateFormAsync(
            coach,
            "Monthly review",
            Phase6ShortText("How was the month?"));
        var monthlyVersion = await Phase6PublishAsync(coach, monthly.Form.Id, monthly.Versions[0]);

        var weeklyAssignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, weeklyVersion.Id, Phase6WorkspaceToday().AddDays(1)));
        var monthlyAssignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, monthlyVersion.Id, Phase6WorkspaceToday().AddDays(2)));

        var weeklyResponseId = await Phase6SubmitWholeAsync(client, weeklyAssignment.Assignment.Id, weeklyVersion);
        var monthlyResponseId = await Phase6SubmitWholeAsync(client, monthlyAssignment.Assignment.Id, monthlyVersion);

        // Two different lineages have no shared question keys, so aligning them would be meaningless.
        var acrossLineages = await Phase6CompareAsync(coach, clientId, weeklyResponseId, monthlyResponseId);
        Assert.AreEqual(HttpStatusCode.Conflict, acrossLineages.StatusCode);
        Assert.AreEqual(
            "CheckInComparisonAcrossLineages",
            (await RequiredJsonAsync<Phase6Problem>(acrossLineages)).Code);

        // A check-in compared with itself is refused rather than answered with two identical columns.
        var withItself = await Phase6CompareAsync(coach, clientId, weeklyResponseId, weeklyResponseId);
        Assert.AreEqual(HttpStatusCode.Conflict, withItself.StatusCode);

        // Losing the entitlement closes every response route for that client, including reading back a
        // submission they already made. The entitlement belongs to the client's enrollment rather than
        // to whoever is asking, so the coach's view of that client closes with it — the same rule
        // 6A-1 already applies to assignments. Nothing is deleted.
        await RefreshCsrfAsync(coach);
        var overview = await coach.GetFromJsonAsync<Phase6CommercialOverview>(
            $"/api/commercial/clients/{clientId}")
            ?? throw new AssertFailedException("Commercial overview was empty.");
        var enrollment = overview.Enrollments.Single(item => item.Id == enrollmentId);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollment.Id}/pause",
                new { reason = "Entitlement enforcement test", enrollment.Version }),
            HttpStatusCode.OK);

        var lapsedRead = await client.GetAsync(
            $"/api/checkins/me/assignments/{weeklyAssignment.Assignment.Id}/response");
        Assert.AreEqual(HttpStatusCode.Forbidden, lapsedRead.StatusCode);
        Assert.AreEqual("Paused", (await RequiredJsonAsync<Phase6Problem>(lapsedRead)).AccessReason);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await Phase6SaveDraftAsync(
                client,
                weeklyAssignment.Assignment.Id,
                Phase6AnswerAll(weeklyVersion))).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await Phase6SubmitAsync(client, weeklyAssignment.Assignment.Id, 1u)).StatusCode);

        var coachRead = await coach.GetAsync(
            $"/api/checkins/clients/{clientId}/assignments/{weeklyAssignment.Assignment.Id}/response");
        Assert.AreEqual(HttpStatusCode.Forbidden, coachRead.StatusCode);
        Assert.AreEqual("Paused", (await RequiredJsonAsync<Phase6Problem>(coachRead)).AccessReason);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await Phase6CompareAsync(coach, clientId, weeklyResponseId, monthlyResponseId)).StatusCode);

        // Access closed; the record did not. The submission and its answers are still on disk, so
        // resuming the enrollment restores the view rather than recovering lost data.
        Assert.AreEqual(
            "Submitted",
            await Phase6ScalarAsync<string>(
                "SELECT \"Status\" FROM checkins.\"CheckInResponses\" WHERE \"Id\" = @id",
                weeklyResponseId));
        Assert.AreEqual(
            1L,
            await Phase6ScalarAsync<long>(
                "SELECT count(*) FROM checkins.\"CheckInAnswers\" WHERE \"ResponseId\" = @id",
                weeklyResponseId));
    }

    /// <summary>
    /// Answers every question and submits, returning the response id. Used where the point of the test
    /// is what happens after a submission rather than the submission itself.
    /// </summary>
    private static async Task<Guid> Phase6SubmitWholeAsync(
        HttpClient client,
        Guid assignmentId,
        Phase6Version version)
    {
        await AssertStatusAsync(
            await Phase6SaveDraftAsync(client, assignmentId, Phase6AnswerAll(version)),
            HttpStatusCode.OK);
        var ready = await Phase6GetOwnResponseAsync(client, assignmentId);
        Assert.IsNotNull(ready.Response);
        await AssertStatusAsync(
            await Phase6SubmitAsync(client, assignmentId, ready.Response.Version),
            HttpStatusCode.OK);
        return ready.Response.Id;
    }

    private async Task<TValue> Phase6ScalarAsync<TValue>(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var value = await command.ExecuteScalarAsync();
        return value is TValue typed
            ? typed
            : throw new AssertFailedException($"Query returned no {typeof(TValue).Name}: {sql}");
    }
}
