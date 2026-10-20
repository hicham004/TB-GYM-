using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A10a, error words and refusals (docs/FULL-AUDIT-2026-10.md, section 11, Batch 10): a request the
/// API cannot read is a 400 that names the field (SEC-1), text PostgreSQL cannot store is refused (SEC-2), a set-up
/// profile keeps its required intake (SEC-3), the calculators ask for the token (SEC-4), refusals drop the
/// framework's "(Parameter …)" and Identity speaks the app's words (CLIENT-5, NCM-10, AUTH-5, AUTH-6), somebody
/// else's row answers as a missing one (SEC-7), search wildcards are literal (SEC-10), each invitation conflict says
/// what it is (COACH-8, SEC-12), Mark all as read never fails on a concurrent read (BEB-6), and the contact form
/// refuses a large body (BEB-3).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private sealed record A10Answer(string? Code, string? Field, string? Message);

    private sealed record A10Details(Guid Id, uint Version);

    private sealed record A10Invitation(Guid Id, string Email, string Status, uint Version, string? DevelopmentActionUrl);

    /// <summary>The code, field and sentence of an answer, decoded (the raw body escapes an apostrophe).</summary>
    private static async Task<A10Answer> A10AnswerAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        await AssertStatusAsync(response, status);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        string? Text(string name) =>
            body.RootElement.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
        return new A10Answer(Text("code"), Text("field"), Text("message"));
    }

    private static async Task<HttpResponseMessage> A10SendAsync(HttpClient caller, HttpMethod method, string url, string? json)
    {
        await RefreshCsrfAsync(caller);
        using var request = new HttpRequestMessage(method, url);
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return await caller.SendAsync(request);
    }

    [TestMethod]
    public async Task A10AnUnreadableRequestIsA400ThatNamesItsFieldNeverA500()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-body-coach@example.test", "A10 Coach", "A10 Bodies");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "a10-body-maya@example.test", newAccount: true);
        var notes = $"/api/clients/{mayaId}/coach-notes";

        // A value of the wrong type, and JSON that ends inside a field, name the field.
        var wrongType = await A10AnswerAsync(
            await A10SendAsync(coach, HttpMethod.Put, notes, """{"notes": 12, "version": 1}"""),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("request_invalid", "notes"), (wrongType.Code, wrongType.Field));
        Assert.AreEqual("The value of notes could not be read. Check it and send the request again.", wrongType.Message);
        var broken = await A10AnswerAsync(
            await A10SendAsync(coach, HttpMethod.Put, notes, """{"notes": "x", "version": """),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("request_invalid", "version"), (broken.Code, broken.Field));

        // An empty body and a JSON null are a missing body, not a field.
        foreach (var missing in new[] { string.Empty, "null" })
        {
            var answer = await A10AnswerAsync(await A10SendAsync(coach, HttpMethod.Put, notes, missing), HttpStatusCode.BadRequest);
            Assert.AreEqual(("request_invalid", (string?)null, "This request needs its fields as a JSON body."),
                (answer.Code, answer.Field, answer.Message), $"Body '{missing}'.");
        }

        // A misspelt choice, nesting past the reader's depth and a query value that does not parse.
        var spelling = await A10AnswerAsync(
            await A10SendAsync(coach, HttpMethod.Post, "/api/exercises/", """
                {"name": "Squat", "instructions": "Slow.", "equipment": "Barbel", "movementPattern": "Squat",
                 "classification": "Strength", "muscles": [], "tags": [], "alternatives": [], "mediaAssetIds": []}
                """),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("request_invalid", "equipment"), (spelling.Code, spelling.Field));
        var deep = await A10AnswerAsync(
            await A10SendAsync(coach, HttpMethod.Put, notes, "{\"notes\": " + new string('[', 100) + new string(']', 100) + "}"),
            HttpStatusCode.BadRequest);
        Assert.AreEqual("request_invalid", deep.Code);
        StringAssert.StartsWith(deep.Field, "notes");
        var query = await A10AnswerAsync(await coach.GetAsync("/api/exercises?take=abc"), HttpStatusCode.BadRequest);
        Assert.AreEqual(("request_invalid", "take"), (query.Code, query.Field));

        // Nothing was written.
        var details = await RequiredJsonAsync<A10Details>(await coach.GetAsync($"/api/clients/{mayaId}"));
        Assert.AreEqual(mayaId, details.Id);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(notes, new { notes = "Readable at last", version = details.Version }),
            HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task A10TextPostgreSqlCannotStoreIsRefusedNamingTheField()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-nul-coach@example.test", "A10 Coach", "A10 Text");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "a10-nul-maya@example.test", newAccount: true);
        var details = await RequiredJsonAsync<A10Details>(await coach.GetAsync($"/api/clients/{mayaId}"));

        // A coach note and an intake answer with a NUL in them answered 500 (audit SEC-2).
        var note = await A10AnswerAsync(
            await A10SendAsync(coach, HttpMethod.Put, $"/api/clients/{mayaId}/coach-notes",
                $$"""{"notes": "Knee \u0000 pain", "version": {{details.Version}}}"""),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("text_invalid_character", "notes"), (note.Code, note.Field));
        Assert.AreEqual("The text in notes contains a character that can't be saved. Remove it and try again.", note.Message);
        var own = await RequiredJsonAsync<A10Details>(await maya.GetAsync("/api/client-profile/me"));
        var intake = await A10AnswerAsync(
            await A10SendAsync(maya, HttpMethod.Put, "/api/client-profile/me/intake", $$"""
                {"firstName": "Maya", "lastName": "Haddad", "goals": "Strong\u0000er", "version": {{own.Version}}}
                """),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("text_invalid_character", "goals"), (intake.Code, intake.Field));

        // Deep in a body, the path says where; an escaped backslash before "u0000" is not a NUL.
        var nested = await A10AnswerAsync(
            await A10SendAsync(coach, HttpMethod.Post, "/api/exercises/", """
                {"name": "Squat", "tags": ["ok", "b\u0000d"], "instructions": "Slow."}
                """),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("text_invalid_character", "tags[1]"), (nested.Code, nested.Field));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/clients/{mayaId}/coach-notes", new { notes = "Path C:\\u0000 is text", version = details.Version }),
            HttpStatusCode.OK);

        // A search for a NUL reached PostgreSQL as a parameter.
        var search = await A10AnswerAsync(await coach.GetAsync("/api/exercises?query=%00"), HttpStatusCode.BadRequest);
        Assert.AreEqual(("text_invalid_character", "query"), (search.Code, search.Field));
        await AssertStatusAsync(await coach.GetAsync("/api/nutrition/foods?query=a%00"), HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task A10ASetUpProfileKeepsWhatCompletingAskedForInEveryUpdate()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a10-intake-coach@example.test", "A10 Coach", "A10 Intake");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(coach, rita, tenant, "a10-intake-rita@example.test", "Rita", "Daher");

        // Before she is set up, names alone save.
        var own = await RequiredJsonAsync<A10Details>(await rita.GetAsync("/api/client-profile/me"));
        await RefreshCsrfAsync(rita);
        await AssertStatusAsync(
            await rita.PutAsJsonAsync("/api/client-profile/me/intake", new { firstName = "Rita", lastName = "Daher", version = own.Version }),
            HttpStatusCode.OK);

        // Once she is, an update that leaves out her birth date, height or goal is refused in words, not by the
        // database's check as a 500 (audit SEC-3), whether she or her coach sends it.
        await A8CompleteOnboardingAsync(rita, "Rita", "Daher");
        own = await RequiredJsonAsync<A10Details>(await rita.GetAsync("/api/client-profile/me"));
        await RefreshCsrfAsync(rita);
        var refused = await A3RefusalAsync(
            await rita.PutAsJsonAsync("/api/client-profile/me/intake", new { firstName = "Rita", lastName = "Daher", version = own.Version }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(refused, "Birth date, height and at least one goal stay required once the profile is set up.");
        var details = await RequiredJsonAsync<A10Details>(await coach.GetAsync($"/api/clients/{ritaId}"));
        await RefreshCsrfAsync(coach);
        refused = await A3RefusalAsync(
            await coach.PutAsJsonAsync($"/api/clients/{ritaId}/intake", new
            {
                firstName = "Rita", lastName = "Daher", birthDate = "1995-04-02", heightValue = 168m, heightUnit = "Centimeter",
                goals = "   ", version = details.Version,
            }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(refused, "stay required once the profile is set up");
    }

    [TestMethod]
    public async Task A10TheCalculatorsAskForTheTokenAndRefuseAnEmptyBodyInWords()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-calc-coach@example.test", "A10 Coach", "A10 Calculators");

        // An empty body answered 500 NullReferenceException (audit SEC-4).
        await RefreshCsrfAsync(coach);
        var empty = await A3RefusalAsync(
            await coach.PostAsJsonAsync("/api/strength/estimate-one-rep-max", new { }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(empty, "Supported estimate methods are Epley and Brzycki.");
        Assert.DoesNotContain("(Parameter", empty);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync("/api/strength/estimate-one-rep-max", new { load = 100m, repetitions = 5, unit = "Kilogram", methodKey = "Epley" }),
            HttpStatusCode.OK);

        // They are POSTs like every other: without the token both are refused.
        coach.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        foreach (var (url, body) in new (string, object)[]
        {
            ("/api/strength/estimate-one-rep-max", new { load = 100m, repetitions = 5, unit = "Kilogram", methodKey = "Epley" }),
            ("/api/strength/estimate-max-from-rpe", new { load = 100m, repetitions = 5, rpe = 8m, unit = "Kilogram" }),
        })
        {
            var refused = await A10AnswerAsync(await coach.PostAsJsonAsync(url, body), HttpStatusCode.BadRequest);
            Assert.AreEqual("antiforgery_token_invalid", refused.Code, url);
        }
    }

    [TestMethod]
    public async Task A10RefusalsSayTheirOwnSentenceWithoutTheFrameworksParameterName()
    {
        // Registration with a zone that is not one: the sentence, without "(Parameter 'timeZoneId')" (audit AUTH-5).
        using var visitor = CreateClient();
        await RefreshCsrfAsync(visitor);
        var zone = await A3RefusalAsync(
            await visitor.PostAsJsonAsync("/api/auth/register/coach", new
            {
                displayName = "A10 Zone", email = "a10-zone@example.test", password = Password, workspaceName = "A10 Zone",
                timeZoneId = "Beirut", defaultCulture = "en-LB", defaultCurrencyCode = "USD", weekStartsOn = "Monday",
            }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(zone, "Enter a time zone such as Asia/Beirut.");
        Assert.DoesNotContain("(Parameter", zone);

        // A max the rules refuse (CLIENT-5, NCM-10: the same suffix on every rule's sentence).
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-suffix-coach@example.test", "A10 Coach", "A10 Suffix");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "a10-suffix-maya@example.test", newAccount: true);
        var squat = await CreateExerciseAsync(coach, "A10 Squat", [], []);
        await RefreshCsrfAsync(coach);
        var max = await A3RefusalAsync(
            await coach.PostAsJsonAsync($"/api/strength/clients/{mayaId}/maxes", new
            {
                exerciseId = squat.Id, kind = "CoachWorkingMax", value = 2500m, unit = "Kilogram", effectiveDate = TenantToday(),
                source = "Manual", methodKey = (string?)null, methodVersion = (string?)null, sourceWorkoutExecutionId = (Guid?)null,
                note = (string?)null,
            }),
            HttpStatusCode.BadRequest);
        Assert.DoesNotContain("(Parameter", max);
        Assert.DoesNotContain("Actual value was", max);
    }

    [TestMethod]
    public async Task A10IdentitysRefusalsAreTheAppsOwnWords()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-identity@example.test", "A10 Coach", "A10 Identity");

        // A wrong current password was "Incorrect password." (audit AUTH-6); a new one that misses a rule says what to add.
        await RefreshCsrfAsync(coach);
        var wrong = await A3RefusalAsync(
            await coach.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Not-it-2026!", newPassword = "Another-Pass-2026!" }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(wrong, "Your current password isn't right.");
        await RefreshCsrfAsync(coach);
        var weak = await A3RefusalAsync(
            await coach.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = Password, newPassword = "nosymbolsatall2026" }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(weak, "Add a symbol, such as ! or #.");
        StringAssert.Contains(weak, "Add a capital letter.");

        // A reset link that is spent or forged says so, not "Invalid token.", and an empty password is the password's.
        var me = await RequiredJsonAsync<A10Details>(await coach.GetAsync("/api/auth/me"));
        using var stranger = CreateClient();
        await RefreshCsrfAsync(stranger);
        var spent = await A10AnswerAsync(
            await stranger.PostAsJsonAsync("/api/auth/reset-password", new { userId = me.Id, code = "QUFBQQ", newPassword = "Another-Pass-2026!" }),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(("invalid_or_expired_token", "This reset link has expired or was already used. Ask for a new one."),
            (spent.Code, spent.Message));
        await RefreshCsrfAsync(stranger);
        var empty = await A3RefusalAsync(
            await stranger.PostAsJsonAsync("/api/auth/reset-password", new { userId = me.Id, code = "QUFBQQ", newPassword = "" }),
            HttpStatusCode.BadRequest);
        StringAssert.Contains(empty, "Enter a new password.");
        await RefreshCsrfAsync(stranger);
        var confirm = await A10AnswerAsync(
            await stranger.PostAsJsonAsync("/api/auth/confirm-email", new { userId = Guid.NewGuid(), code = "QUFBQQ" }),
            HttpStatusCode.BadRequest);
        Assert.AreEqual("This confirmation link has expired or was already used.", confirm.Message);
    }

    [TestMethod]
    public async Task A10AnotherClientsWorkoutAndPhotoAnswerAsMissing()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-scope-coach@example.test", "A10 Coach", "A10 Scope");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "a10-scope-maya@example.test", newAccount: true);
        using var jad = CreateClient();
        await InviteAndAcceptAsync(coach, jad, "a10-scope-jad@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 1, TenantToday());
        await AssignAsync(coach, mayaId, resources, TenantToday());
        var (workout, day) = await A3StartTodayAsync(maya);
        var setId = day.Exercises.Single().Sets[0].PerformanceId!.Value;

        // Maya's workout, written to by Jad of the same workspace, answered 403: it exists (audit SEC-7, ADR 0026).
        await RefreshCsrfAsync(jad);
        await AssertStatusAsync(
            await jad.PutAsJsonAsync($"/api/training/me/workouts/{workout.Id}/sets/{setId}", new
            {
                repetitions = 5, load = 100m, loadUnit = "Kilogram", rpe = (decimal?)null, isCompleted = true,
                clientNote = (string?)null, version = workout.Version,
            }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await jad.PostAsJsonAsync($"/api/training/me/workouts/{workout.Id}/complete", new { version = workout.Version }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await jad.PostAsJsonAsync($"/api/training/workouts/{workout.Id}/notes", new { text = "Not mine" }),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await jad.PutAsJsonAsync($"/api/training/me/workouts/{Guid.NewGuid()}/sets/{setId}", new
            {
                repetitions = 5, load = 100m, loadUnit = "Kilogram", rpe = (decimal?)null, isCompleted = true,
                clientNote = (string?)null, version = workout.Version,
            }),
            HttpStatusCode.NotFound);

        // Her photo too, asked for by Jad: the same answer as an asset that does not exist.
        var photo = await Phase6PostPhotoAsync(maya, $"/api/progress/me/photos?pose=Front&photoDate={TenantToday().AddDays(-1):yyyy-MM-dd}");
        await AssertStatusAsync(photo, HttpStatusCode.OK);
        using var uploaded = JsonDocument.Parse(await photo.Content.ReadAsStringAsync());
        var assetId = uploaded.RootElement.GetProperty("mediaAssetId").GetGuid();
        await RefreshCsrfAsync(jad);
        await AssertStatusAsync(await jad.PostAsync($"/api/media/{assetId}/access", null), HttpStatusCode.NotFound);
        await AssertStatusAsync(await jad.PostAsync($"/api/media/{Guid.NewGuid()}/access", null), HttpStatusCode.NotFound);

        // Maya still logs her own set, and her coach still reads her photo.
        await A3LogAsync(maya, workout.Id, setId, 5, 100m, null, workout.Version);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsync($"/api/media/{assetId}/access", null), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task A10SearchWildcardsMatchOnlyThemselves()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a10-search-coach@example.test", "A10 Coach", "A10 Search");
        await CreateExerciseAsync(coach, "Row_Machine", [], []);
        await CreateExerciseAsync(coach, "Rowing 100% effort", [], []);
        await CreateExerciseAsync(coach, "Rowing", [], []);
        await R44aRecipeAsync(coach, "Oat_Bowl", 10m);
        await R44aRecipeAsync(coach, "Oatmeal 50% milk", 10m);
        await R44aRecipeAsync(coach, "Oatmeal", 10m);

        // The names a search finds, in order, as one line.
        static async Task<string> Names(HttpClient caller, string url)
        {
            using var page = JsonDocument.Parse(await caller.GetStringAsync(url));
            return string.Join(" | ", page.RootElement.GetProperty("items").EnumerateArray()
                .Select(item => item.GetProperty("name").GetString()!).Order(StringComparer.Ordinal));
        }

        // "%" and "_" matched every row (audit SEC-10); typed, they are the characters themselves.
        Assert.AreEqual("Rowing 100% effort", await Names(coach, "/api/exercises?query=%25"));
        Assert.AreEqual("Row_Machine", await Names(coach, "/api/exercises?query=_"));
        Assert.AreEqual("Oatmeal 50% milk", await Names(coach, "/api/nutrition/recipes?query=%25"));
        Assert.AreEqual("Oat_Bowl", await Names(coach, "/api/nutrition/recipes?query=_"));
        Assert.AreEqual("Oatmeal 50% milk base", await Names(coach, "/api/nutrition/foods?query=%25"));
        Assert.AreEqual("Oat_Bowl base", await Names(coach, "/api/nutrition/foods?query=_"));
        // Words still find what contains them, in any case.
        Assert.AreEqual("Row_Machine | Rowing | Rowing 100% effort", await Names(coach, "/api/exercises?query=row"));
    }

    [TestMethod]
    public async Task A10AnInvitationRefusedForWhoTheEmailIsSaysWhoToTheOwnerAndNothingMoreToACoach()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "a10-team-owner@example.test", "Karim Haddad", "A10 Team");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "a10-team-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        await R31InviteAsync(lea, maya, tenant, "a10-team-maya@example.test", "Maya", "Fakhoury");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "a10-team-rami@example.test", "Rami", "Tabet");

        async Task<A10Answer> Refused(HttpClient sender, string url, string email)
        {
            await RefreshCsrfAsync(sender);
            return await A10AnswerAsync(
                await sender.PostAsJsonAsync(url, new { email, firstName = "Someone", lastName = "Else" }),
                HttpStatusCode.Conflict);
        }

        // One sentence answered six situations (audit COACH-8). The owner sees every client and the team, so is told who.
        Assert.AreEqual(new A10Answer("invitation_already_client", null, "Maya Fakhoury is already a client here."),
            await Refused(owner, "/api/invitations", "a10-team-maya@example.test"));
        Assert.AreEqual(new A10Answer("invitation_already_team", null, "Lea Khoury is on your team, so they can't also be a client here."),
            await Refused(owner, "/api/invitations", "a10-team-lea@example.test"));
        Assert.AreEqual(new A10Answer("invitation_already_team", null, "Lea Khoury is already on your team."),
            await Refused(owner, "/api/team/invitations", "a10-team-lea@example.test"));
        Assert.AreEqual(new A10Answer("invitation_already_client", null, "Maya Fakhoury is a client here, so they can't join the team."),
            await Refused(owner, "/api/team/invitations", "a10-team-maya@example.test"));

        // A coach is told about their own client, and of anybody else only that the email is taken: not whose
        // client, not that it is the owner (ADR 0026).
        Assert.AreEqual(new A10Answer("invitation_already_client", null, "Maya Fakhoury is already your client."),
            await Refused(lea, "/api/invitations", "a10-team-maya@example.test"));
        const string taken = "This email already belongs to someone in A10 Team, so it can't be invited. Ask the owner about it.";
        Assert.AreEqual(new A10Answer("invitation_email_in_use", null, taken),
            await Refused(lea, "/api/invitations", "a10-team-rami@example.test"));
        Assert.AreEqual(new A10Answer("invitation_email_in_use", null, taken),
            await Refused(lea, "/api/invitations", "a10-team-owner@example.test"));

        // A former client is invited back as a client, never as a coach (CLI-016), and the owner reads why.
        await ReleaseAsync(owner, ramiId, "Moved away");
        Assert.AreEqual(
            new A10Answer("invitation_former_client", null,
                "This email belongs to a former client. A former client can be invited back as a client, never as a coach."),
            await Refused(owner, "/api/team/invitations", "a10-team-rami@example.test"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync("/api/invitations", new { email = "a10-team-rami@example.test", firstName = "Rami", lastName = "Tabet" }),
            HttpStatusCode.Created);
    }

    [TestMethod]
    public async Task A10AWaitingChangedOrClosedInvitationSaysWhichItIs()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "a10-wait-owner@example.test", "Karim Haddad", "A10 Waiting");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "a10-wait-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "a10-wait-maya@example.test", "Maya", "Fakhoury");

        async Task<HttpResponseMessage> Invite(HttpClient sender, string url, string email, Guid? idempotencyKey = null)
        {
            await RefreshCsrfAsync(sender);
            return await sender.PostAsJsonAsync(url, new { email, firstName = "Nadia", lastName = "Saab", idempotencyKey });
        }

        async Task<A10Invitation> Find(HttpClient reader, string email) =>
            (await RequiredJsonAsync<A10Invitation[]>(await reader.GetAsync("/api/invitations"))).Single(item => item.Email == email);

        // Still waiting: the owner is told where to find it; a coach whose invitation it is not, only that it is taken.
        await AssertStatusAsync(await Invite(owner, "/api/invitations", "a10-wait-nadia@example.test"), HttpStatusCode.Created);
        Assert.AreEqual(
            new A10Answer("invitation_pending", null, "An invitation to this email is still waiting. Send it again from Invitations instead."),
            await A10AnswerAsync(await Invite(owner, "/api/invitations", "a10-wait-nadia@example.test"), HttpStatusCode.Conflict));
        Assert.AreEqual(
            new A10Answer("invitation_pending", null, "This email has an invitation waiting to join as a client. Cancel it on Invitations first."),
            await A10AnswerAsync(await Invite(owner, "/api/team/invitations", "a10-wait-nadia@example.test"), HttpStatusCode.Conflict));
        Assert.AreEqual("invitation_email_in_use",
            (await A10AnswerAsync(await Invite(lea, "/api/invitations", "a10-wait-nadia@example.test"), HttpStatusCode.Conflict)).Code);
        await AssertStatusAsync(await Invite(lea, "/api/invitations", "a10-wait-omar@example.test"), HttpStatusCode.Created);
        Assert.AreEqual(
            new A10Answer("invitation_pending", null,
                "You already invited this email, and that invitation is still waiting. Send it again from Invitations instead."),
            await A10AnswerAsync(await Invite(lea, "/api/invitations", "a10-wait-omar@example.test"), HttpStatusCode.Conflict));

        // A key spent on another request is said to be.
        var key = Guid.NewGuid();
        await AssertStatusAsync(await Invite(owner, "/api/invitations", "a10-wait-key1@example.test", key), HttpStatusCode.Created);
        Assert.AreEqual("idempotency_key_reused",
            (await A10AnswerAsync(await Invite(owner, "/api/invitations", "a10-wait-key2@example.test", key), HttpStatusCode.Conflict)).Code);

        // A stale version, sent again or cancelled: someone changed it.
        var nadia = await Find(owner, "a10-wait-nadia@example.test");
        const string changed = "Someone changed this invitation after you opened it. The list now shows it as it is.";
        await RefreshCsrfAsync(owner);
        Assert.AreEqual(new A10Answer("invitation_changed", null, changed), await A10AnswerAsync(
            await owner.PostAsJsonAsync($"/api/invitations/{nadia.Id}/revoke", new { version = nadia.Version + 1 }),
            HttpStatusCode.Conflict));
        Assert.AreEqual(new A10Answer("invitation_changed", null, changed), await A10AnswerAsync(
            await owner.PostAsJsonAsync($"/api/invitations/{nadia.Id}/resend", new { idempotencyKey = Guid.NewGuid(), version = nadia.Version + 1 }),
            HttpStatusCode.Conflict));
        Assert.AreEqual(new A10Answer("invitation_changed", null, changed), await A10AnswerAsync(
            await owner.PostAsJsonAsync($"/api/invitations/{nadia.Id}/revoke", new { }),
            HttpStatusCode.Conflict));

        // Closed ones: an accepted invitation cannot be cancelled, a cancelled one cannot be sent again.
        var accepted = await Find(owner, "a10-wait-maya@example.test");
        Assert.AreEqual(
            new A10Answer("invitation_already_accepted", null, "This invitation was already accepted, so it can't be cancelled."),
            await A10AnswerAsync(
                await owner.PostAsJsonAsync($"/api/invitations/{accepted.Id}/revoke", new { version = accepted.Version }),
                HttpStatusCode.Conflict));
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/invitations/{nadia.Id}/revoke", new { version = nadia.Version }),
            HttpStatusCode.OK);
        var cancelled = await Find(owner, "a10-wait-nadia@example.test");
        Assert.AreEqual(
            new A10Answer("invitation_already_cancelled", null, "This invitation was cancelled. Invite them again instead."),
            await A10AnswerAsync(
                await owner.PostAsJsonAsync($"/api/invitations/{cancelled.Id}/resend", new { idempotencyKey = Guid.NewGuid(), version = cancelled.Version }),
                HttpStatusCode.Conflict));

        // Its link answers like a link that never existed (audit SEC-12): 410 invalid_or_expired, never "revoked".
        using var invitee = CreateClient();
        await RefreshCsrfAsync(invitee);
        var revoked = await A10AnswerAsync(
            await invitee.PostAsJsonAsync("/api/invitations/accept", new
            {
                token = QueryValue(nadia.DevelopmentActionUrl!, "token"), displayName = "Nadia Saab", password = Password,
            }),
            HttpStatusCode.Gone);
        await RefreshCsrfAsync(invitee);
        var unknown = await A10AnswerAsync(
            await invitee.PostAsJsonAsync("/api/invitations/accept", new { token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", displayName = "Nadia", password = Password }),
            HttpStatusCode.Gone);
        Assert.AreEqual(unknown, revoked);
        Assert.AreEqual("invitation_invalid_or_expired", revoked.Code);
    }

    [TestMethod]
    public async Task A10MarkAllAsReadSettlesConcurrentReadsWithoutAnError()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "a10-readall", 3);
        SetTenant(client, scenario.WorkspaceId);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{scenario.Block.Id}/visibility",
                new { revealAllWeeks = true, version = scenario.Block.Version }),
            HttpStatusCode.OK);
        await R51cSweepAsync();
        var inbox = await R51cInboxAsync(client);
        Assert.IsGreaterThanOrEqualTo(2, inbox.Items.Length);

        // Each notice read on its own while Mark all as read runs, three times over: the loop it replaces answered
        // 500 after its third conflict (audit BEB-6). One token for every racing request (refreshed once).
        await RefreshCsrfAsync(client);
        var racing = inbox.Items.Select(item => client.PostAsync($"/api/notifications/{item.Id}/read", null))
            .Concat(Enumerable.Range(0, 3).Select(_ => client.PostAsync("/api/notifications/read-all", null)))
            .ToArray();
        var answers = await Task.WhenAll(racing);
        foreach (var answer in answers)
        {
            await AssertStatusAsync(answer, HttpStatusCode.OK);
        }

        var after = await R51cInboxAsync(client);
        Assert.AreEqual(0L, after.UnreadTotal);
        Assert.IsTrue(after.Items.All(item => item.IsRead));
    }

    [TestMethod]
    public void A10TheContactFormReadsNoMoreThanItsLimit()
    {
        // Kestrel's 30 MB default let an anonymous caller hand over anything before the 1,000-character rule ran
        // (audit BEB-3). The route carries its own limit, which Kestrel enforces while the body is read; the test host
        // has no socket to enforce it on, so the limit itself is what is pinned here, and the 413 it causes is the
        // unreadable-request handler's (A10RequestHygieneTests).
        var contact = RequiredFactory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .Single(endpoint => endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName == "SubmitContactRequest");
        Assert.AreEqual(16L * 1024, contact.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize);
    }
}
