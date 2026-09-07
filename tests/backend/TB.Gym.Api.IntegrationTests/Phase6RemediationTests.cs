using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Regression coverage for the Phase 5/6 audit remediation. Every test here reproduces a defect
/// that shipped, so each one fails against the behaviour it replaced.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string Phase6DashboardWindow = "from=2026-06-01&to=2026-08-23";

    /// <summary>
    /// A coach may know that a draft exists. They may not read a word of it until the client
    /// submits, and the redaction is in the API contract rather than in the screen that renders it.
    /// </summary>
    [TestMethod]
    public async Task Phase6ACoachNeverReceivesTheContentOfAnUnsubmittedDraft()
    {
        const string secret = "PRIVATE-DRAFT-TEXT-4F2A9C";
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-draft-coach@example.test",
            "Draft Privacy Coach",
            "Draft Privacy Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6r-draft-client@example.test", true);
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
                [Phase6TextAnswer(version.Questions[0].Id, secret)]),
            HttpStatusCode.OK);

        // The coach's read, taken as raw text so nothing can hide in a field this test forgot to
        // deserialize. The draft's own words must not be anywhere in the response.
        var coachRaw = await coach.GetAsync(
            $"/api/checkins/clients/{clientId}/assignments/{assignment.Assignment.Id}/response");
        await AssertStatusAsync(coachRaw, HttpStatusCode.OK);
        var body = await coachRaw.Content.ReadAsStringAsync();
        Assert.IsFalse(
            body.Contains(secret, StringComparison.Ordinal),
            "The coach's response carried the client's unsubmitted draft text.");

        var coachView = await Phase6GetClientResponseAsync(coach, clientId, assignment.Assignment.Id);
        Assert.IsNotNull(coachView.Response);
        // The minimum that is permitted: that a draft exists, and that it is a draft.
        Assert.AreEqual("Draft", coachView.Response.Status);
        Assert.IsEmpty(coachView.Response.Answers);
        // Stated rather than implied. An empty list on its own would read as "they wrote nothing".
        Assert.IsTrue(coachView.Response.AnswersWithheld);
        Assert.IsNull(coachView.Response.SubmittedAtUtc);

        var draftPage = await coach.GetAsync($"/api/checkins/clients/{clientId}/assignments");
        await AssertStatusAsync(draftPage, HttpStatusCode.OK);
        var draftPageBody = await draftPage.Content.ReadAsStringAsync();
        Assert.IsFalse(
            draftPageBody.Contains(secret, StringComparison.Ordinal),
            "The paged assignment summary carried the client's draft text.");
        Assert.IsTrue(draftPageBody.Contains("Draft", StringComparison.Ordinal));

        // The client still reads their own draft in full: it is theirs, not hidden from everyone.
        var ownView = await Phase6GetOwnResponseAsync(client, assignment.Assignment.Id);
        Assert.IsNotNull(ownView.Response);
        Assert.IsFalse(ownView.Response.AnswersWithheld);
        Assert.AreEqual(secret, ownView.Response.Answers.Single().TextValue);

        // And once it is submitted the coach reads exactly what was written.
        await AssertStatusAsync(
            await Phase6SubmitAsync(client, assignment.Assignment.Id, ownView.Response.Version),
            HttpStatusCode.OK);
        var afterSubmit = await Phase6GetClientResponseAsync(coach, clientId, assignment.Assignment.Id);
        Assert.IsNotNull(afterSubmit.Response);
        Assert.IsFalse(afterSubmit.Response.AnswersWithheld);
        Assert.AreEqual(secret, afterSubmit.Response.Answers.Single().TextValue);

        // The list a coach builds their screen from carries the status and no content either.
        var list = await coach.GetFromJsonAsync<Phase6AssignmentList>(
            $"/api/checkins/clients/{clientId}/assignments")
            ?? throw new AssertFailedException("Assignment list was empty.");
        Assert.HasCount(1, list.Items);
        Assert.AreEqual("Submitted", list.Items[0].Response?.Status);
    }

    [TestMethod]
    public async Task Phase6AssignmentListsPageNewestFirstWithoutOmissionsOrDuplicates()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-page-coach@example.test",
            "Paging Coach",
            "Paging Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6r-page-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Paging check-ins", "CheckIns");

        var form = await Phase6CreateFormAsync(coach, "Daily check-in", Phase6ShortText("How are you?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var today = Phase6WorkspaceToday();
        for (var day = 0; day < 51; day++)
        {
            await AssertStatusAsync(
                await Phase6AssignAsync(coach, clientId, version.Id, today.AddDays(day)),
                HttpStatusCode.OK);
        }

        var coachFirst = await coach.GetFromJsonAsync<Phase6AssignmentList>(
            $"/api/checkins/clients/{clientId}/assignments?skip=0&take=50")
            ?? throw new AssertFailedException("Coach assignment page was empty.");
        var coachSecond = await coach.GetFromJsonAsync<Phase6AssignmentList>(
            $"/api/checkins/clients/{clientId}/assignments?skip=50&take=50")
            ?? throw new AssertFailedException("Coach assignment tail was empty.");
        var clientFirst = await client.GetFromJsonAsync<Phase6AssignmentList>(
            "/api/checkins/me/assignments?skip=0&take=50")
            ?? throw new AssertFailedException("Client assignment page was empty.");
        var clientSecond = await client.GetFromJsonAsync<Phase6AssignmentList>(
            "/api/checkins/me/assignments?skip=50&take=50")
            ?? throw new AssertFailedException("Client assignment tail was empty.");

        foreach (var page in new[] { coachFirst, clientFirst })
        {
            Assert.AreEqual(51L, page.Total);
            Assert.HasCount(50, page.Items);
            Assert.AreEqual(today.AddDays(50), page.Items[0].Assignment.DueDate);
            Assert.AreEqual(today.AddDays(1), page.Items[^1].Assignment.DueDate);
        }

        foreach (var page in new[] { coachSecond, clientSecond })
        {
            Assert.AreEqual(51L, page.Total);
            Assert.HasCount(1, page.Items);
            Assert.AreEqual(today, page.Items[0].Assignment.DueDate);
        }

        Assert.HasCount(
            51,
            coachFirst.Items.Concat(coachSecond.Items).Select(item => item.Assignment.Id).Distinct());
        CollectionAssert.AreEqual(
            coachFirst.Items.Select(item => item.Assignment.Id)
                .Concat(coachSecond.Items.Select(item => item.Assignment.Id))
                .ToArray(),
            clientFirst.Items.Select(item => item.Assignment.Id)
                .Concat(clientSecond.Items.Select(item => item.Assignment.Id))
                .ToArray());
    }

    /// <summary>
    /// Both a draft-privacy and a non-disclosure check: a blocked coach and a foreign workspace are
    /// refused before any redaction question arises.
    /// </summary>
    [TestMethod]
    public async Task Phase6ADraftStaysPrivateAcrossBlockingAndTenantBoundaries()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-isolation-coach@example.test",
            "Isolation Coach",
            "Isolation Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6r-isolation-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(coach, "Weekly", Phase6ShortText("How are you?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(1)));
        await AssertStatusAsync(
            await Phase6SaveDraftAsync(
                client,
                assignment.Assignment.Id,
                [Phase6TextAnswer(version.Questions[0].Id, "Private.")]),
            HttpStatusCode.OK);

        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(
            foreignCoach,
            "p6r-isolation-foreign@example.test",
            "Foreign Isolation Coach",
            "Foreign Isolation Workspace");
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.GetAsync(
                $"/api/checkins/clients/{clientId}/assignments/{assignment.Assignment.Id}/response")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.GetAsync($"/api/checkins/clients/{clientId}/assignments")).StatusCode);

        var details = await coach.GetFromJsonAsync<Phase5ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Blocked for the draft privacy test.", details.Version }),
            HttpStatusCode.OK);

        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await coach.GetAsync(
                $"/api/checkins/clients/{clientId}/assignments/{assignment.Assignment.Id}/response")).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await coach.GetAsync($"/api/checkins/clients/{clientId}/assignments")).StatusCode);
    }

    /// <summary>
    /// An archived lineage is closed to writing, and the server is what closes it.
    /// </summary>
    [TestMethod]
    public async Task Phase6AnArchivedFormRefusesEveryEditingOperation()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6r-archive-coach@example.test",
            "Archive Coach",
            "Archive Workspace");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        var draftVersion = form.Versions[0];

        await RefreshCsrfAsync(coach);
        var archived = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/archive",
            new { form.Form.Version });
        await AssertStatusAsync(archived, HttpStatusCode.OK);
        var afterArchive = await RequiredJsonAsync<Phase6FormDetails>(archived);
        Assert.IsTrue(afterArchive.Form.IsArchived);

        // Saving the draft's questions was the hole: the archived flag lives on the form and the
        // questions live on the version, so nothing on this path used to look at it.
        await RefreshCsrfAsync(coach);
        var save = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draftVersion.Id}",
            new
            {
                questions = new[] { Phase6ShortText("Rewritten while archived") },
                draftVersion.Version,
            });
        Assert.AreEqual(HttpStatusCode.Conflict, save.StatusCode);
        Assert.AreEqual("CheckInFormArchived", (await RequiredJsonAsync<Phase6Problem>(save)).Code);

        await RefreshCsrfAsync(coach);
        var publish = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draftVersion.Id}/publish",
            new { draftVersion.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, publish.StatusCode);
        // The reason names the archive, not a publication that never happened.
        Assert.AreEqual("CheckInFormArchived", (await RequiredJsonAsync<Phase6Problem>(publish)).Code);

        await RefreshCsrfAsync(coach);
        var rename = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}",
            new { title = "Renamed while archived", description = (string?)null, afterArchive.Form.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, rename.StatusCode);

        // Nothing was written: the version still holds the question it was created with.
        var untouched = await coach.GetFromJsonAsync<Phase6Version>(
            $"/api/checkins/forms/{form.Form.Id}/versions/{draftVersion.Id}")
            ?? throw new AssertFailedException("Version was empty.");
        Assert.AreEqual("How is your body feeling?", untouched.Questions[0].Prompt);

        // Restoring reopens it, and the same save now succeeds.
        await RefreshCsrfAsync(coach);
        var restored = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/restore",
            new { afterArchive.Form.Version });
        await AssertStatusAsync(restored, HttpStatusCode.OK);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/checkins/forms/{form.Form.Id}/versions/{draftVersion.Id}",
                new
                {
                    questions = new[] { Phase6ShortText("Rewritten after restore") },
                    draftVersion.Version,
                }),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// The form's title and description persist through the rename operation and survive a reload.
    /// </summary>
    [TestMethod]
    public async Task Phase6FormMetadataPersistsAndConflictsCleanly()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6r-rename-coach@example.test",
            "Rename Coach",
            "Rename Workspace");

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));

        await RefreshCsrfAsync(coach);
        var renamed = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}",
            new
            {
                title = "Fortnightly check-in",
                description = "Every other Monday.",
                form.Form.Version,
            });
        await AssertStatusAsync(renamed, HttpStatusCode.OK);

        // Reloaded from the database rather than trusting the command's own echo.
        var reloaded = await Phase6GetFormAsync(coach, form.Form.Id);
        Assert.AreEqual("Fortnightly check-in", reloaded.Form.Title);
        Assert.AreEqual("Every other Monday.", reloaded.Form.Description);

        // A stale token is refused and writes nothing, so a conflict cannot half-apply.
        await RefreshCsrfAsync(coach);
        var stale = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}",
            new { title = "Third name", description = (string?)null, form.Form.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, stale.StatusCode);
        var unchanged = await Phase6GetFormAsync(coach, form.Form.Id);
        Assert.AreEqual("Fortnightly check-in", unchanged.Form.Title);
        Assert.AreEqual("Every other Monday.", unchanged.Form.Description);
    }

    /// <summary>
    /// Malformed authoring payloads are bad requests, not server faults.
    /// </summary>
    [TestMethod]
    public async Task Phase6MalformedCheckInQuestionsAreRefusedAsBadRequests()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-malformed-coach@example.test",
            "Malformed Coach",
            "Malformed Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6r-malformed-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        await RefreshCsrfAsync(coach);
        var nullQuestions = await coach.PostAsJsonAsync(
            "/api/checkins/forms",
            new { title = "Weekly check-in", description = (string?)null, questions = (object?)null });
        Assert.AreEqual(HttpStatusCode.BadRequest, nullQuestions.StatusCode);

        var form = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How is your body feeling?"));
        await RefreshCsrfAsync(coach);
        var nullDraftQuestions = await coach.PutAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions/{form.Versions[0].Id}",
            new { questions = (object?)null, form.Versions[0].Version });
        Assert.AreEqual(HttpStatusCode.BadRequest, nullDraftQuestions.StatusCode);

        // The answers half of the same shape, driven by the client the route belongs to so the
        // payload is actually reached rather than being refused by the role policy first.
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(1)));
        await RefreshCsrfAsync(client);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync(
                $"/api/checkins/me/assignments/{assignment.Assignment.Id}/response",
                new { answers = (object?)null, version = (uint?)null })).StatusCode);
    }

    /// <summary>
    /// Two first saves at once. Both read no response, both try to start one, and the unique index
    /// on the assignment settles it.
    /// </summary>
    [TestMethod]
    public async Task Phase6ConcurrentFirstDraftSavesYieldOneDraftAndOneConflict()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-firstsave-coach@example.test",
            "First Save Coach",
            "First Save Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6r-firstsave-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");

        var form = await Phase6CreateFormAsync(coach, "Weekly", Phase6ShortText("How are you?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(1)));

        await RefreshCsrfAsync(client);
        var payload = new
        {
            answers = new[] { Phase6TextAnswer(version.Questions[0].Id, "Racing.") },
            version = (uint?)null,
        };

        // Both requests are held at the insert, which is after both have read "no response yet".
        // Without the barrier this is a scheduling coin toss that proves nothing.
        RequiredInsertBarrier.Arm("checkins.\"CheckInResponses\"", 2);
        try
        {
            var saves = await Task.WhenAll(
                client.PutAsJsonAsync($"/api/checkins/me/assignments/{assignment.Assignment.Id}/response", payload),
                client.PutAsJsonAsync($"/api/checkins/me/assignments/{assignment.Assignment.Id}/response", payload));

            Assert.AreEqual(
                1,
                saves.Count(response => response.StatusCode == HttpStatusCode.OK),
                $"Exactly one first save may win; received {string.Join(", ", saves.Select(item => (int)item.StatusCode))}.");
            var loser = saves.Single(response => response.StatusCode != HttpStatusCode.OK);
            Assert.AreEqual(HttpStatusCode.Conflict, loser.StatusCode);
            Assert.AreEqual(
                "CheckInResponseAlreadyStarted",
                (await RequiredJsonAsync<Phase6Problem>(loser)).Code);
            // Both really were held at the insert. Without this the test could pass having never
            // raced at all, because the barrier matched no statement.
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived);
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // Exactly one response row exists, so the draft was never duplicated.
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM checkins.\"CheckInResponses\" WHERE \"AssignmentId\" = @id",
                assignment.Assignment.Id));
    }

    /// <summary>
    /// Two uploads for the same client, date and pose. One wins; the loser is a stable conflict and
    /// leaves no usable orphan behind.
    /// </summary>
    [TestMethod]
    public async Task Phase6ConcurrentDuplicateProgressPhotosLeaveOnePhotoAndNoReadyOrphan()
    {
        using var client = CreateClient();
        await RegisterCoachAsync(
            client,
            "p6r-photorace@example.test",
            "Photo Race Coach",
            "Photo Race Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(client, subject, "p6r-photorace-client@example.test", true);
        SetTenant(subject, (await subject.GetFromJsonAsync<TenantMembership[]>("/api/tenants"))!.Single().TenantId);

        const string url = "/api/progress/me/photos?pose=Front&photoDate=2026-08-22";

        // The workspace upload gate admits one ingest at a time, so the second request is started
        // only once the first has finished uploading and is parked on its insert. Both have passed
        // the date-and-pose pre-check by then, which is the state the race needs.
        RequiredInsertBarrier.Arm("progress.\"ProgressPhotos\"", 2);
        HttpResponseMessage[] results;
        try
        {
            var first = Phase6PostPhotoAsync(subject, url);
            await RequiredInsertBarrier.ArrivedAsync(1).WaitAsync(TimeSpan.FromSeconds(60));
            var second = Phase6PostPhotoAsync(subject, url);
            results = await Task.WhenAll(first, second);
            // Both passed their date-and-pose pre-check and were held at the insert together.
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived);
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        Assert.AreEqual(
            1,
            results.Count(response => response.StatusCode == HttpStatusCode.OK),
            $"Exactly one upload may win; received {string.Join(", ", results.Select(item => (int)item.StatusCode))}.");
        var loser = results.Single(response => response.StatusCode != HttpStatusCode.OK);
        // A stable 409, never a 500 from the cleanup replaying the failed insert.
        Assert.AreEqual(HttpStatusCode.Conflict, loser.StatusCode);
        Assert.AreEqual("ProgressPhotoAlreadyExists", (await RequiredJsonAsync<Phase6Problem>(loser)).Code);

        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM progress.\"ProgressPhotos\" WHERE \"ClientProfileId\" = @id",
                clientId));

        // The loser's bytes are tombstoned for the retention sweep rather than left Ready and
        // unreferenced, which is what "orphan" means here.
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM media."Assets" asset
                WHERE asset."Purpose" = 'ProgressPhoto'
                  AND asset."Status" = 'Ready'
                  AND NOT EXISTS (
                      SELECT 1 FROM progress."ProgressPhotos" photo
                      WHERE photo."MediaAssetId" = asset."Id" AND photo."ClientProfileId" = @id)
                """,
                clientId));
    }

    /// <summary>
    /// A deployment that cannot scan cannot publish media, and it must not record a photo against
    /// bytes it refused — which would occupy the date and pose for ever.
    /// </summary>
    [TestMethod]
    public async Task Phase6AnUnscannableUploadRecordsNoProgressPhotoAndFreesTheSlotForARetry()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6r-scanner-coach@example.test",
            "Scanner Coach",
            "Scanner Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, subject, "p6r-scanner-client@example.test", true);
        SetTenant(subject, (await subject.GetFromJsonAsync<TenantMembership[]>("/api/tenants"))!.Single().TenantId);

        const string url = "/api/progress/me/photos?pose=Front&photoDate=2026-08-22";

        RequiredScannerSwitch.IsAvailable = false;
        var refused = await Phase6PostPhotoAsync(subject, url);
        // The command fails, and it says the installation cannot accept uploads rather than
        // blaming a file that was never inspected.
        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        var problem = await refused.Content.ReadAsStringAsync();
        // No scanner key, version or failure code reaches the caller.
        Assert.IsFalse(
            problem.Contains("SwitchableTestScanner", StringComparison.Ordinal),
            "The refusal named the scanner.");
        Assert.IsFalse(
            problem.Contains("scanner_not_configured", StringComparison.Ordinal),
            "The refusal carried the scanner's own failure code.");
        Assert.AreEqual(0, RequiredStorageFaults.PutCount, "An unavailable scanner accepted bytes.");
        Assert.AreEqual(0, RequiredScannerSwitch.ScanCallCount);

        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM progress.\"ProgressPhotos\" WHERE \"ClientProfileId\" = @id",
                clientId));
        // Nothing was committed for it either, so no row accounts for bytes that were deleted.
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM media.\"Assets\" WHERE \"Purpose\" = 'ProgressPhoto' AND @id IS NOT NULL",
                clientId));

        // The same date and pose are still free, so the retry that should work does work.
        RequiredScannerSwitch.IsAvailable = true;
        await AssertStatusAsync(await Phase6PostPhotoAsync(subject, url), HttpStatusCode.OK);
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM progress.\"ProgressPhotos\" WHERE \"ClientProfileId\" = @id AND \"Status\" = 'Active'",
                clientId));
    }

    [TestMethod]
    public async Task Phase6AScannerRejectionDeletesEveryAcceptedObjectAndLeavesThePhotoSlotFree()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-reject-coach@example.test",
            "Reject Coach",
            "Reject Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, subject, "p6r-reject-client@example.test", true);
        SetTenant(subject, workspaceId);

        const string url = "/api/progress/me/photos?pose=Front&photoDate=2026-08-22";
        RequiredScannerSwitch.RejectScans = true;
        var refused = await Phase6PostPhotoAsync(subject, url);

        Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode);
        StringAssert.Contains(
            await refused.Content.ReadAsStringAsync(),
            "deleted or scheduled for secure cleanup");
        Assert.AreEqual(3, RequiredStorageFaults.PutCount);
        Assert.AreEqual(1, RequiredScannerSwitch.ScanCallCount);
        Assert.IsEmpty(RequiredStorageFaults.StoredKeys, "Rejected bytes remain in fake storage.");
        await Phase6AssertNoPhotoOrPendingIngestAsync(clientId);

        RequiredScannerSwitch.RejectScans = false;
        await AssertStatusAsync(await Phase6PostPhotoAsync(subject, url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase6AScannerFailureReturnsUnavailableAndDeletesEveryAcceptedObject()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-throw-coach@example.test",
            "Scanner Failure Coach",
            "Scanner Failure Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, subject, "p6r-throw-client@example.test", true);
        SetTenant(subject, workspaceId);

        RequiredScannerSwitch.ThrowOnScan = true;
        var refused = await Phase6PostPhotoAsync(
            subject,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        Assert.AreEqual(3, RequiredStorageFaults.PutCount);
        Assert.AreEqual(1, RequiredScannerSwitch.ScanCallCount);
        Assert.IsEmpty(RequiredStorageFaults.StoredKeys, "Scanner-failed bytes remain in fake storage.");
        await Phase6AssertNoPhotoOrPendingIngestAsync(clientId);
    }

    [TestMethod]
    [DataRow(1, (int)HttpStatusCode.ServiceUnavailable, DisplayName = "raw object deletion fails")]
    [DataRow(2, (int)HttpStatusCode.BadRequest, DisplayName = "sanitized original deletion fails")]
    [DataRow(3, (int)HttpStatusCode.BadRequest, DisplayName = "thumbnail deletion fails")]
    public async Task Phase6ADeleteFailureIsDurableAndReconciliationReleasesQuota(
        int failedDeleteCall,
        int expectedStatusCode)
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            $"p6r-delete-{failedDeleteCall}-coach@example.test",
            "Delete Failure Coach",
            "Delete Failure Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            subject,
            $"p6r-delete-{failedDeleteCall}-client@example.test",
            true);
        SetTenant(subject, workspaceId);

        const string url = "/api/progress/me/photos?pose=Front&photoDate=2026-08-22";
        RequiredStorageFaults.FailDeleteCall(failedDeleteCall);
        RequiredScannerSwitch.RejectScans = true;
        var refused = await Phase6PostPhotoAsync(subject, url);

        Assert.AreEqual((HttpStatusCode)expectedStatusCode, refused.StatusCode);
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM progress.\"ProgressPhotos\" WHERE \"ClientProfileId\" = @id",
                clientId));
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM media."IngestObjects"
                WHERE "ClientProfileId" = @id AND "Status" = 'CleanupPending'
                """,
                clientId));
        var failedKeys = RequiredStorageFaults.StoredKeys.ToArray();
        Assert.HasCount(1, failedKeys, "Exactly the failed deletion should remain in storage.");

        // Failure never occupies the unique date/pose slot. The pending bytes still count while a
        // later valid upload is admitted, and the reconciliation sweep removes only the orphan.
        RequiredStorageFaults.AllowDeletes();
        RequiredScannerSwitch.RejectScans = false;
        await AssertStatusAsync(await Phase6PostPhotoAsync(subject, url), HttpStatusCode.OK);
        var sweep = await Phase6SweepAsync(10);
        Assert.AreEqual(1, sweep.Claimed);
        Assert.AreEqual(1, sweep.Purged);
        Assert.IsFalse(
            failedKeys.Intersect(RequiredStorageFaults.StoredKeys).Any(),
            "The reconciliation sweep left the failed-attempt key in storage.");
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM media."IngestObjects"
                WHERE "ClientProfileId" = @id AND "Status" <> 'Purged'
                """,
                clientId));
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM media."IngestObjects"
                WHERE "ClientProfileId" = @id
                  AND "Status" = 'Purged'
                  AND "StorageKey" IS NULL
                  AND "PurgeAttemptCount" >= 2
                """,
                clientId),
            "The failed deletion did not finish as a retained Purged row with its key cleared.");
    }

    [TestMethod]
    public async Task Phase6ACancellationDuringScanRunsIndependentCleanup()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-cancel-coach@example.test",
            "Cancellation Coach",
            "Cancellation Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, subject, "p6r-cancel-client@example.test", true);
        SetTenant(subject, workspaceId);

        RequiredScannerSwitch.WaitForCancellation = true;
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var upload = Phase6PostPhotoAsync(
            subject,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22",
            cancellationToken: cancellation.Token);
        await RequiredScannerSwitch.ScanStarted.WaitAsync(TimeSpan.FromSeconds(10));
        await cancellation.CancelAsync();

        await Assert.ThrowsExactlyAsync<TaskCanceledException>(async () => await upload);
        Assert.IsEmpty(RequiredStorageFaults.StoredKeys, "Cancellation stranded accepted bytes.");
        await Phase6AssertNoPhotoOrPendingIngestAsync(clientId);
    }

    private async Task Phase6AssertNoPhotoOrPendingIngestAsync(Guid clientId)
    {
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                "SELECT count(*) FROM progress.\"ProgressPhotos\" WHERE \"ClientProfileId\" = @id",
                clientId));
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM media."IngestObjects"
                WHERE "ClientProfileId" = @id AND "Status" <> 'Purged'
                """,
                clientId));
    }

    [TestMethod]
    public async Task Phase6AuthenticatedWriteLimitCannotBeResetByRotatingUnverifiedTenantHeaders()
    {
        using var firstActor = CreateClient();
        await RegisterCoachAsync(
            firstActor,
            "p6r-limit-first@example.test",
            "First Limited Actor",
            "First Limited Workspace");
        using var secondActor = CreateClient();
        await RegisterCoachAsync(
            secondActor,
            "p6r-limit-second@example.test",
            "Second Limited Actor",
            "Second Limited Workspace");
        await RefreshCsrfAsync(firstActor);
        await RefreshCsrfAsync(secondActor);

        for (var requestNumber = 0; requestNumber < 60; requestNumber++)
        {
            SetTenant(firstActor, Guid.NewGuid());
            var response = await firstActor.PostAsJsonAsync("/api/checkins/forms", new { });
            Assert.AreEqual(
                HttpStatusCode.Forbidden,
                response.StatusCode,
                $"Request {requestNumber + 1} did not reach tenant authorization.");
        }

        SetTenant(firstActor, Guid.NewGuid());
        Assert.AreEqual(
            HttpStatusCode.TooManyRequests,
            (await firstActor.PostAsJsonAsync("/api/checkins/forms", new { })).StatusCode,
            "Changing an unverified tenant header reset the authenticated actor bucket.");

        SetTenant(secondActor, Guid.NewGuid());
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await secondActor.PostAsJsonAsync("/api/checkins/forms", new { })).StatusCode,
            "Two signed-in users unintentionally shared one actor bucket.");
    }

    [TestMethod]
    public async Task Phase6PublicAuthenticationLimitUsesTheConnectionSourceAddress()
    {
        using var firstSource = CreateClient();
        firstSource.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.10");
        await RefreshCsrfAsync(firstSource);

        for (var requestNumber = 0; requestNumber < 30; requestNumber++)
        {
            SetTenant(firstSource, Guid.NewGuid());
            var response = await firstSource.PostAsJsonAsync(
                "/api/auth/login",
                new
                {
                    email = $"missing-{requestNumber}@example.test",
                    password = Password,
                    rememberMe = false,
                });
            Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        SetTenant(firstSource, Guid.NewGuid());
        Assert.AreEqual(
            HttpStatusCode.TooManyRequests,
            (await firstSource.PostAsJsonAsync(
                "/api/auth/login",
                new { email = "still-missing@example.test", password = Password, rememberMe = false })).StatusCode);

        using var secondSource = CreateClient();
        secondSource.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.11");
        await RefreshCsrfAsync(secondSource);
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await secondSource.PostAsJsonAsync(
                "/api/auth/login",
                new { email = "missing-on-other-source@example.test", password = Password, rememberMe = false }))
            .StatusCode,
            "Distinct source addresses unintentionally shared the public-auth bucket.");
    }

    /// <summary>
    /// An image whose header declares more pixels than the policy allows is refused before a bitmap
    /// is allocated for it. The compressed file is small; the decoded one would not be.
    /// </summary>
    [TestMethod]
    public async Task Phase6AnOverSizedImageIsRefusedAndAnOrdinaryPhotoStillSucceeds()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6r-bomb-coach@example.test",
            "Decode Limit Coach",
            "Decode Limit Workspace");
        using var subject = CreateClient();
        await InviteAndAcceptAsync(coach, subject, "p6r-bomb-client@example.test", true);
        SetTenant(subject, (await subject.GetFromJsonAsync<TenantMembership[]>("/api/tenants"))!.Single().TenantId);

        // 9000 px wide is past the documented edge limit, and this flat image compresses to a few
        // kilobytes — well inside the 15 MB byte cap that used to be the only bound.
        var oversized = ProgressPhotoImageFactory.PlainJpeg(9_000, 200);
        Assert.IsLessThan(
            MediaUploadPolicy.MaximumImageBytes,
            (long)oversized.Length,
            "The oversized fixture must stay inside the compressed byte cap, or the rejection below "
            + "would prove the byte limit rather than the decoded-dimension limit.");

        var refused = await Phase6PostPhotoAsync(
            subject,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22",
            oversized);
        Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode);

        // An ordinary photo of the same shape is unaffected.
        await AssertStatusAsync(
            await Phase6PostPhotoAsync(
                subject,
                "/api/progress/me/photos?pose=Side&photoDate=2026-08-22",
                ProgressPhotoImageFactory.PlainJpeg(1_200, 1_600)),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// A grant is not a licence for the rest of its lifetime. Membership is rechecked on every
    /// original and every thumbnail request, so removal takes effect at once.
    /// </summary>
    [TestMethod]
    public async Task Phase6RemovingAMembershipRevokesMediaAccessImmediately()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-membership-coach@example.test",
            "Membership Coach",
            "Membership Workspace");
        using var subject = CreateClient();
        await InviteAndAcceptAsync(coach, subject, "p6r-membership-client@example.test", true);
        SetTenant(subject, workspaceId);

        var photo = await UploadProgressPhotoAsync(
            subject,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        var grant = await Phase6GrantAsync(subject, photo.MediaAssetId);
        Assert.IsNotNull(grant.ThumbnailUrl);

        // The grant works while the membership is active.
        await AssertStatusAsync(await subject.GetAsync(grant.Url), HttpStatusCode.OK);
        await AssertStatusAsync(await subject.GetAsync(grant.ThumbnailUrl), HttpStatusCode.OK);
        var readsBeforeRevocation = RequiredStorageFaults.ReadCount;

        // The membership is deactivated while that same, unexpired grant is still in the cookie jar.
        await Phase6ExecuteAsync(
            "UPDATE tenancy.\"Memberships\" SET \"Status\" = 'Removed' WHERE \"TenantId\" = @tenant AND \"Role\" = 'Client'",
            ("tenant", workspaceId));

        // Both the original and its rendition are closed now, not when the grant expires.
        var original = await subject.GetAsync(grant.Url);
        Assert.IsTrue(
            original.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"Expected the original to be refused but received {(int)original.StatusCode}.");
        var thumbnail = await subject.GetAsync(grant.ThumbnailUrl);
        Assert.IsTrue(
            thumbnail.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"Expected the thumbnail to be refused but received {(int)thumbnail.StatusCode}.");

        using var rangedRequest = new HttpRequestMessage(HttpMethod.Get, grant.Url);
        rangedRequest.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
        var ranged = await subject.SendAsync(rangedRequest);
        Assert.IsTrue(
            ranged.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"Expected the ranged original to be refused but received {(int)ranged.StatusCode}.");
        Assert.AreEqual(
            readsBeforeRevocation,
            RequiredStorageFaults.ReadCount,
            "Membership revocation was checked only after storage had already been opened.");

        // And a fresh grant cannot be minted either, so this is not a stale-cookie artefact.
        await RefreshCsrfAsync(subject);
        var regrant = await subject.PostAsync($"/api/media/{photo.MediaAssetId}/access", null);
        Assert.IsTrue(
            regrant.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound or HttpStatusCode.Unauthorized,
            $"Expected a new grant to be refused but received {(int)regrant.StatusCode}.");
    }

    /// <summary>
    /// The dashboard's thumbnails have to load on a first visit, in a session that has never
    /// granted those assets. The assertion is a real HTTP GET of the bytes, not a string check on
    /// a path.
    /// </summary>
    [TestMethod]
    public async Task Phase6DashboardThumbnailsLoadInAFreshSessionAndStayClosedToOthers()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-thumbs-coach@example.test",
            "Thumbnail Coach",
            "Thumbnail Workspace");
        using var subject = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, subject, "p6r-thumbs-client@example.test", true);
        SetTenant(subject, workspaceId);

        await Phase6PostPhotoAsync(subject, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        await Phase6PostPhotoAsync(subject, "/api/progress/me/photos?pose=Side&photoDate=2026-08-22");

        // A brand new client: its own cookie jar, no media grant of any kind in it.
        using var fresh = CreateClient();
        await RefreshCsrfAsync(fresh);
        await AssertStatusAsync(
            await fresh.PostAsJsonAsync(
                "/api/auth/login",
                new { email = "p6r-thumbs-coach@example.test", password = Password, rememberMe = false }),
            HttpStatusCode.OK);
        SetTenant(fresh, workspaceId);

        var dashboard = await fresh.GetFromJsonAsync<Phase6Dashboard>(
            $"/api/progress/clients/{clientId}/dashboard?{Phase6DashboardWindow}")
            ?? throw new AssertFailedException("Dashboard was empty.");
        var previews = dashboard.Photos.Poses
            .SelectMany(pose => pose.Photos)
            .Where(photo => photo.ThumbnailUrl is not null)
            .ToArray();
        Assert.HasCount(2, previews);
        Assert.AreEqual(2, dashboard.Photos.PreviewPhotoCount);

        // Without a grant the bytes are refused, which is exactly what the screen used to do.
        var ungranted = await fresh.GetAsync(previews[0].ThumbnailUrl!);
        Assert.AreEqual(HttpStatusCode.Forbidden, ungranted.StatusCode);

        // One bounded batch covers every tile the dashboard displays.
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        var batch = await Phase6GrantBatchAsync(
            fresh,
            previews.Select(photo => photo.MediaAssetId).ToArray());
        await AssertStatusAsync(batch, HttpStatusCode.OK);
        Assert.HasCount(2, (await RequiredJsonAsync<Phase6GrantBatch>(batch)).Items);

        foreach (var preview in previews)
        {
            await AssertStatusAsync(await fresh.GetAsync(preview.ThumbnailUrl!), HttpStatusCode.OK);
        }

        // A foreign workspace is granted nothing, and its own request for the bytes is refused.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(
            foreignCoach,
            "p6r-thumbs-foreign@example.test",
            "Foreign Thumbnail Coach",
            "Foreign Thumbnail Workspace");
        var foreignBatch = await Phase6GrantBatchAsync(
            foreignCoach,
            previews.Select(photo => photo.MediaAssetId).ToArray());
        await AssertStatusAsync(foreignBatch, HttpStatusCode.OK);
        Assert.IsEmpty((await RequiredJsonAsync<Phase6GrantBatch>(foreignBatch)).Items);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await foreignCoach.GetAsync(previews[0].ThumbnailUrl!)).StatusCode);

        // A blocked coach loses the preview too, even though they hold a grant issued a moment ago.
        var details = await coach.GetFromJsonAsync<Phase5ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Blocked for the thumbnail test.", details.Version }),
            HttpStatusCode.OK);
        var blocked = await fresh.GetAsync(previews[0].ThumbnailUrl!);
        Assert.IsTrue(
            blocked.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"Expected a blocked coach to be refused but received {(int)blocked.StatusCode}.");
    }

    /// <summary>
    /// The batch grant is bounded and authorizes asset by asset.
    /// </summary>
    [TestMethod]
    public async Task Phase6TheBatchGrantIsBoundedAndRefusesAnEmptyOrOversizedRequest()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6r-batch-coach@example.test",
            "Batch Coach",
            "Batch Workspace");

        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await Phase6GrantBatchAsync(coach)).StatusCode);

        var tooMany = Enumerable
            .Range(0, MediaAccessBatchPolicy.MaximumAssets + 1)
            .Select(_ => Guid.CreateVersion7())
            .ToArray();
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await Phase6GrantBatchAsync(coach, tooMany)).StatusCode);

        // Unknown ids are simply absent from the result, which discloses nothing about them.
        var unknown = await Phase6GrantBatchAsync(coach, Guid.CreateVersion7());
        await AssertStatusAsync(unknown, HttpStatusCode.OK);
        Assert.IsEmpty((await RequiredJsonAsync<Phase6GrantBatch>(unknown)).Items);
    }

    /// <summary>
    /// Every dashboard figure comes from inside the requested range, even where the read widens to
    /// whole workspace weeks so the grid can be grouped in one query.
    /// </summary>
    [TestMethod]
    public async Task Phase6DashboardWeeklyFiguresUseOnlyObservationsInsideTheRequestedRange()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-range-coach@example.test",
            "Range Coach",
            "Range Workspace");
        using var subject = CreateClient();
        await InviteAndAcceptAsync(coach, subject, "p6r-range-client@example.test", true);
        SetTenant(subject, workspaceId);

        // The window is Wednesday 2026-08-12 to Wednesday 2026-08-19 exclusive, so both the first
        // and the last workspace week (Monday-start) are partial.
        const string window = "from=2026-08-12&to=2026-08-19";
        await Phase6RecordBodyweightAsync(subject, 80m, "2026-08-11"); // the day before `from`
        await Phase6RecordBodyweightAsync(subject, 90m, "2026-08-12"); // exactly `from`
        await Phase6RecordBodyweightAsync(subject, 92m, "2026-08-18"); // the day before `toExclusive`
        await Phase6RecordBodyweightAsync(subject, 200m, "2026-08-19"); // exactly `toExclusive`

        var dashboard = await subject.GetFromJsonAsync<Phase6Dashboard>(
            $"/api/progress/me/dashboard?{window}")
            ?? throw new AssertFailedException("Dashboard was empty.");

        // Two observations are inside [from, toExclusive): the boundaries are half-open both ways.
        Assert.AreEqual(2, dashboard.Bodyweight.ObservedDayCount);

        var weeks = dashboard.Bodyweight.Weeks;
        var firstWeek = weeks.Single(week => week.WeekStart == new DateOnly(2026, 8, 10));
        // 2026-08-11 falls in this week but outside the window, so it contributes nothing: the mean
        // is 90 rather than 85, and the count is 1 rather than 2.
        Assert.AreEqual(1, firstWeek.ObservedDayCount);
        Assert.AreEqual(90m, firstWeek.DisplayMean);

        var lastWeek = weeks.Single(week => week.WeekStart == new DateOnly(2026, 8, 17));
        // 2026-08-19 is in this week and at `toExclusive`, so it is excluded; only the 18th counts.
        Assert.AreEqual(1, lastWeek.ObservedDayCount);
        Assert.AreEqual(92m, lastWeek.DisplayMean);

        // Nothing outside the range reached any displayed total.
        Assert.AreEqual(2, weeks.Sum(week => week.ObservedDayCount));
    }

    /// <summary>
    /// The workspace's own current date travels with its settings, so a browser never has to derive
    /// it from a clock that is in a different calendar.
    /// </summary>
    [TestMethod]
    public async Task Phase6TheWorkspaceReportsItsOwnLocalDate()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6r-calendar-coach@example.test",
            "Calendar Coach",
            "Calendar Workspace");

        // 21:30 UTC is already the next day in Asia/Beirut, which is the workspace's zone.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 22, 21, 30, 0, TimeSpan.Zero));
        var workspace = await coach.GetFromJsonAsync<Phase6Workspace>("/api/workspace")
            ?? throw new AssertFailedException("Workspace was empty.");

        Assert.AreEqual("Asia/Beirut", workspace.TimeZoneId);
        Assert.AreEqual(new DateOnly(2026, 8, 23), workspace.CurrentDate);
        // And it is the same date the assignment rule uses, so the two cannot disagree.
        Assert.AreEqual(Phase6WorkspaceToday(), workspace.CurrentDate);
    }

    /// <summary>
    /// Cancelling a mesocycle withdraws only sessions that were never started. Historical
    /// executions stay in both the denominator and numerator so completed work is preserved.
    /// </summary>
    /// <remarks>
    /// A cancelled block previously either erased completed history or produced "1 completed of 0
    /// scheduled". Both sides now use the same execution-aware session population.
    /// </remarks>
    [TestMethod]
    public async Task Phase6CancellingAMesocyclePreservesCompletedHistoryAndWithdrawsFutureSessions()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-cancel-coach@example.test",
            "Cancellation Coach",
            "Cancellation Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p6r-cancel-client@example.test", true);
        SetTenant(client, workspaceId);

        // Assigned to start today, so week one's session is the one the client can start now and
        // it falls inside the dashboard window.
        var start = Phase6WorkspaceToday();
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, start);
        var mesocycle = await AssignAsync(coach, clientId, resources, start);

        // The client trains today's session through to completion, so the numerator this test is
        // about has something real in it. A workout still in progress cannot be cancelled at all,
        // which is why the scenario needs a finished one.
        var today = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("The training day was empty.");
        Assert.IsTrue(today.IsAllowed);
        Assert.IsGreaterThan(0, today.Workouts.Length);
        await RefreshCsrfAsync(client);
        var started = await client.PostAsync(
            $"/api/training/me/sessions/{today.Workouts[0].SessionId}/start",
            null);
        await AssertStatusAsync(started, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(started);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/training/me/workouts/{execution.Id}/complete",
                new { version = execution.Version }),
            HttpStatusCode.OK);

        var active = await client.GetFromJsonAsync<Phase6Dashboard>(
            $"/api/progress/me/dashboard?{Phase6DashboardWindow}")
            ?? throw new AssertFailedException("Dashboard was empty.");
        Assert.AreEqual("Available", active.Training.Availability);
        Assert.IsGreaterThan(0, active.Training.Context!.WindowScheduledSessionCount);
        Assert.AreEqual(1, active.Training.Context.WindowCompletedWorkoutCount);

        // Re-read for the current concurrency token: completing a workout advanced the aggregate.
        var current = await coach.GetFromJsonAsync<ScenarioMesocycle>(
            $"/api/training/mesocycles/{mesocycle.Id}")
            ?? throw new AssertFailedException("Mesocycle was empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/training/mesocycles/{mesocycle.Id}/cancel",
                new { reason = "Cancelled for the dashboard denominator test.", current.Version }),
            HttpStatusCode.OK);

        var afterCancellation = await client.GetFromJsonAsync<Phase6Dashboard>(
            $"/api/progress/me/dashboard?{Phase6DashboardWindow}")
            ?? throw new AssertFailedException("Dashboard was empty.");
        var training = afterCancellation.Training.Context
            ?? throw new AssertFailedException("The training section carried no context.");

        // The completed session remains as historical fact and as the denominator that explains
        // it. Every never-started future session in the cancelled block has been withdrawn.
        Assert.AreEqual(1, training.WindowScheduledSessionCount);
        Assert.AreEqual(1, training.WindowCompletedWorkoutCount);
        Assert.AreEqual(0, training.WindowInProgressWorkoutCount);
    }

    /// <summary>
    /// One sweep claims no more than its configured cap in total, however many workspaces have work
    /// due, and successive sweeps drain the rest.
    /// </summary>
    [TestMethod]
    public async Task Phase6APurgeSweepNeverExceedsItsGlobalCapAndStillMakesProgress()
    {
        // Three workspaces, two photos each: six candidates against a cap of three, so a sweep that
        // allowed each workspace its own cap would claim all six in one pass.
        var assetIds = new List<Guid>();
        for (var workspace = 0; workspace < 3; workspace++)
        {
            using var coach = CreateClient();
            var workspaceId = await RegisterCoachAsync(
                coach,
                $"p6r-purge-coach-{workspace}@example.test",
                $"Purge Cap Coach {workspace}",
                $"Purge Cap Workspace {workspace}");
            using var subject = CreateClient();
            await InviteAndAcceptAsync(coach, subject, $"p6r-purge-client-{workspace}@example.test", true);
            SetTenant(subject, workspaceId);

            foreach (var pose in new[] { "Front", "Side" })
            {
                var photo = await UploadProgressPhotoAsync(
                    subject,
                    $"/api/progress/me/photos?pose={pose}&photoDate=2026-08-22");
                await Phase5B5RemoveAsync(subject, photo);
                assetIds.Add(photo.MediaAssetId);
            }
        }

        // Past the 30-day retention, so every one of the six is due at once.
        RequiredTestClock.Advance(TimeSpan.FromDays(31));

        var first = await Phase6SweepAsync(3);
        Assert.AreEqual(3, first.Claimed, "One sweep claimed more than its global cap.");
        Assert.AreEqual(3, first.Purged);

        var second = await Phase6SweepAsync(3);
        Assert.AreEqual(3, second.Claimed);
        Assert.AreEqual(3, second.Purged);

        // Six candidates, six purged, and nothing was claimed twice.
        Assert.AreEqual(0, (await Phase6SweepAsync(3)).Claimed);
        foreach (var assetId in assetIds)
        {
            Assert.AreEqual(MediaAssetStatus.Purged, (await Phase5B5ReadAssetAsync(assetId)).Status);
        }
    }

    /// <summary>
    /// Two sweeps at once claim disjoint sets: <c>FOR UPDATE SKIP LOCKED</c> is what makes several
    /// API replicas safe, and the cap must not have weakened it.
    /// </summary>
    [TestMethod]
    public async Task Phase6AConcurrentSweepsDoNotDoubleProcessTheSameAsset()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6r-parallel-purge-coach@example.test",
            "Parallel Purge Coach",
            "Parallel Purge Workspace");
        using var subject = CreateClient();
        await InviteAndAcceptAsync(coach, subject, "p6r-parallel-purge-client@example.test", true);
        SetTenant(subject, workspaceId);

        var assetIds = new List<Guid>();
        foreach (var pose in new[] { "Front", "Side", "Back" })
        {
            var photo = await UploadProgressPhotoAsync(
                subject,
                $"/api/progress/me/photos?pose={pose}&photoDate=2026-08-22");
            await Phase5B5RemoveAsync(subject, photo);
            assetIds.Add(photo.MediaAssetId);
        }

        RequiredTestClock.Advance(TimeSpan.FromDays(31));

        var sweeps = await Task.WhenAll(Phase6SweepAsync(10), Phase6SweepAsync(10));

        // Three assets exist and three were claimed in total, so neither sweep saw the other's rows.
        Assert.AreEqual(3, sweeps.Sum(outcome => outcome.Claimed));
        Assert.AreEqual(3, sweeps.Sum(outcome => outcome.Purged));
        Assert.AreEqual(0, sweeps.Sum(outcome => outcome.Failed));
        foreach (var assetId in assetIds)
        {
            Assert.AreEqual(MediaAssetStatus.Purged, (await Phase5B5ReadAssetAsync(assetId)).Status);
        }
    }

    private async Task<MediaPurgeOutcome> Phase6SweepAsync(int batchSize)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<IMediaPurgeService>();
        return await service.PurgeDueAsync(batchSize, TestContext.CancellationTokenSource.Token);
    }

    private static async Task Phase6RecordBodyweightAsync(HttpClient caller, decimal value, string date)
    {
        await RefreshCsrfAsync(caller);
        await AssertStatusAsync(
            await caller.PostAsJsonAsync(
                "/api/progress/me/bodyweight",
                new { value, unit = "Kilogram", measurementDate = date }),
            HttpStatusCode.OK);
    }
}
