using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9a1, the sign-up itself (CLI-024, ADR 0041): a person signs up into the house with no
/// invitation. Sign-up is closed until one coaching space is the house and both of its settings are filled; a new
/// account waits, with no membership and no client profile, until its email is confirmed, and that is when it takes
/// a place of the house's week (a confirmation into a full week waits on for one); an account that exists signs in
/// first and then joins at once, once in a house week, unless the house ended their coaching, blocked them or had
/// them on its team; and the sign-up lands in the house whatever the request carries.
/// Every name and address here is invented, and every figure (the week's places, the ages) is the test's own.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9a1SignUpUrl = "/api/auth/register/trainee";

    private const string N9a1HouseUrl = "/api/platform-admin/house";

    private const string N9a1PlacesSetting = "SignUpsPerWeek";

    private const string N9a1AgeSetting = "MinimumSignUpAge";

    /// <summary>The test's own figures: 37 places a week, and an age of 19.</summary>
    private const string N9a1Places = "37";

    private const string N9a1Age = "19";

    /// <summary>An adult's date of birth, for every sign-up whose age is not the subject.</summary>
    private const string N9a1BirthDate = "1994-03-17";

    private static readonly string[] N9a1StaffPolicies =
    [
        AuthorizationPolicies.TenantCoach,
        AuthorizationPolicies.TenantOwner,
        AuthorizationPolicies.PlatformAdmin,
    ];

    private static readonly string[] N9a1AnswerFields = ["developmentConfirmationUrl", "email", "emailAvailable", "joined"];

    private static readonly string[] N9a1EveryFormField = ["birthDate", "email", "firstName", "lastName", "password"];

    private static readonly string[] N9a1IdentityField = ["identity"];

    private static readonly string[] N9a1BirthDateField = ["birthDate"];

    private static readonly string[] N9a1TwoRoles = ["Client", "Owner"];

    private static readonly string[] N9a1ClientTwice = ["Client", "Client"];

    private static readonly HttpStatusCode[] N9a1OneAcceptedOneRefused = [HttpStatusCode.Accepted, HttpStatusCode.Conflict];

    private static readonly HttpStatusCode[] N9a1BothConfirmed = [HttpStatusCode.NoContent, HttpStatusCode.NoContent];

    private static readonly string[] N9a1OneAccountCodes = ["existing_account_sign_in_required", "registration_conflict"];

    // ---------- 1. closed, and opened ----------

    [TestMethod]
    public async Task N9a1SignUpIsClosedUntilOneSpaceIsTheHouseAndBothOfItsSettingsAreFilled()
    {
        const string email = "n9a1-closed-visitor@example.test";
        using var visitor = CreateClient();

        // No coaching space is the house, and a coaching space that exists is not one by itself.
        await N9a1AssertClosedAsync(visitor, email, "no coaching space exists");
        using var owner = CreateClient();
        var houseId = await RegisterCoachAsync(owner, "n9a1-closed-owner@example.test", "Nour Haddad", "N9a1 Closed House");
        await N9a1AssertClosedAsync(visitor, email, "no coaching space is the house");

        // The house with nothing filled, with one setting alone, and with a week's number of 0.
        await N9a1MarkHouseAsync(owner, houseId);
        await N9a1AssertClosedAsync(visitor, email, "the house's settings are empty");
        using var admin = await SignInPlatformAdminAsync("n9a1-closed-admin@example.test");
        await N9a1SettingAsync(admin, N9a1PlacesSetting, N9a1Places);
        await N9a1AssertClosedAsync(visitor, email, "only the week's number is filled");
        await N9a1SettingAsync(admin, N9a1PlacesSetting, null);
        await N9a1SettingAsync(admin, N9a1AgeSetting, N9a1Age);
        await N9a1AssertClosedAsync(visitor, email, "only the age is filled");
        await N9a1SettingAsync(admin, N9a1PlacesSetting, "0");
        await N9a1AssertClosedAsync(visitor, email, "the week's number is 0");

        // Both filled: open, and the page is told what its form needs, never cached.
        await N9a1SettingAsync(admin, N9a1PlacesSetting, N9a1Places);
        var response = await visitor.GetAsync(N9a1SignUpUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        Assert.IsTrue(response.Headers.CacheControl is { NoStore: true }, "The week fills up: the read is never cached.");
        var open = await RequiredJsonAsync<N9a1Status>(response);
        Assert.AreEqual("Open", open.Status);
        Assert.AreEqual("N9a1 Closed House", open.WorkspaceName);
        Assert.AreEqual("Asia/Beirut", open.TimeZoneId);
        Assert.AreEqual(19, open.MinimumAge);
        Assert.IsNull(open.OpensAgainOn);
        Assert.IsNull(open.CallerSignUp, "Nobody is signed in.");
        Assert.IsFalse(string.IsNullOrWhiteSpace(open.FormStamp), "An open sign-up hands the form its stamp.");

        // And the same form that was refused all along is now taken.
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, email), HttpStatusCode.Accepted);
        Assert.AreEqual(1, await N9a1AccountsAsync(email));
    }

    // ---------- 2. a new person ----------

    [TestMethod]
    public async Task N9a1ANewPersonWaitsWithNoMembershipUntilTheEmailIsConfirmedAndThenJoinsTheHouseSelfDirected()
    {
        const string email = "n9a1-new-person@example.test";
        using var house = await N9a1OpenHouseAsync("new", withCoach: true);
        // A second Coach joins the house's team a minute after the first.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        using var laterCoach = CreateClient();
        var laterCoachUserId = await JoinAsCoachAsync(house.Owner, laterCoach, "n9a1-new-later-coach@example.test", "Omar Nasser");
        using var person = CreateClient();

        // Typed with capitals and spaces: the answer and the row keep the tidy form.
        var response = await N9a1SignUpAsync(person, "  N9a1-New-Person@Example.Test ", "  Dalia ", " Mansour  ", "1991-08-23");
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var answer = await RequiredJsonAsync<N9a1Answer>(response);
        Assert.AreEqual(email, answer.Email);
        Assert.IsFalse(answer.Joined);
        Assert.IsNotNull(answer.EmailAvailable);
        Assert.IsNotNull(answer.DevelopmentConfirmationUrl);

        // Until the email is confirmed: an unconfirmed account and one waiting sign-up, and nothing else.
        var waiting = await N9a1PersonAsync(email);
        Assert.IsNotNull(waiting.UserId);
        Assert.IsFalse(waiting.EmailConfirmed);
        var row = waiting.SignUps.Single();
        Assert.AreEqual(house.TenantId, row.TenantId);
        Assert.AreEqual(("Dalia", "Mansour", (DateOnly?)new DateOnly(1991, 8, 23)), (row.FirstName, row.LastName, row.BirthDate));
        Assert.IsNull(row.ConfirmedAtUtc);
        Assert.IsNull(row.ClientProfileId);
        Assert.IsEmpty(waiting.Memberships, "A sign-up that waits has no membership.");
        Assert.IsEmpty(waiting.Profiles, "A sign-up that waits has no client profile.");
        Assert.AreEqual(0, await N9a1ProfilesInAsync(house.TenantId));
        foreach (var staff in new[] { house.Owner, house.Coach! })
        {
            Assert.IsEmpty(await N9a1ClientsAsync(staff), "The house's staff see nobody until the email is confirmed.");
        }

        // The password is right and the account still cannot sign in.
        await RefreshCsrfAsync(person);
        var early = await person.PostAsJsonAsync("/api/auth/login", new { email, password = Password, rememberMe = false });
        Assert.AreEqual("email_not_confirmed", (await N9a1AnswerAsync(early, HttpStatusCode.Forbidden)).Code);

        // A code that is not the link's confirms nothing and joins nobody.
        await RefreshCsrfAsync(person);
        var wrongCode = await person.PostAsJsonAsync("/api/auth/confirm-email", new { userId = waiting.UserId, code = "bm90LXRoZS1jb2Rl" });
        Assert.AreEqual("invalid_or_expired_token", (await N9a1AnswerAsync(wrongCode, HttpStatusCode.BadRequest)).Code);
        var stillWaiting = await N9a1PersonAsync(email);
        Assert.IsFalse(stillWaiting.EmailConfirmed);
        Assert.IsEmpty(stillWaiting.Memberships);
        Assert.IsEmpty(stillWaiting.Profiles);
        Assert.IsNull(stillWaiting.SignUps.Single().ConfirmedAtUtc);

        // The confirmation makes the membership, the profile and its history together.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(7));
        await AssertStatusAsync(await N9a1ConfirmAsync(person, answer.DevelopmentConfirmationUrl), HttpStatusCode.NoContent);
        var joined = await N9a1PersonAsync(email);
        Assert.IsTrue(joined.EmailConfirmed);
        Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single());
        var profile = joined.Profiles.Single();
        Assert.AreEqual(house.TenantId, profile.TenantId);
        Assert.IsTrue(profile.IsSelfDirected);
        Assert.IsNull(profile.ReleasedAtUtc);
        Assert.AreEqual(house.CoachUserId, profile.AssignedCoachUserId, "The record names the house's Coach who joined first.");
        Assert.AreNotEqual(laterCoachUserId, profile.AssignedCoachUserId);
        Assert.AreEqual(("Dalia", "Mansour", email), (profile.FirstName, profile.LastName, profile.Email));
        Assert.AreEqual(new DateOnly(1991, 8, 23), profile.BirthDate);
        Assert.AreEqual((profile.Id, 1, house.CoachUserId!.Value, (Guid?)null, "SignUp"), joined.Assignments.Single());
        Assert.AreEqual((profile.Id, "SignUp"), joined.Changes.Single());
        var confirmed = joined.SignUps.Single();
        Assert.AreEqual(row.Id, confirmed.Id);
        Assert.IsNotNull(confirmed.ConfirmedAtUtc);
        Assert.AreEqual(profile.Id, confirmed.ClientProfileId);
        Assert.AreEqual(((string?)null, (string?)null, (DateOnly?)null), (confirmed.FirstName, confirmed.LastName, confirmed.BirthDate));

        // The person signs in, finds the house and reads a self-directed profile with what they typed.
        await N9a1SignInAsync(person, email);
        var account = await RequiredJsonAsync<JsonElement>(await person.GetAsync("/api/auth/me"));
        Assert.AreEqual("Dalia Mansour", account.GetProperty("displayName").GetString());
        Assert.IsTrue(account.GetProperty("emailConfirmed").GetBoolean());
        var spaces = await RequiredJsonAsync<N9a1Membership[]>(await person.GetAsync("/api/tenants"));
        Assert.AreEqual((house.TenantId, house.Name, "Client"), (spaces.Single().TenantId, spaces.Single().TenantName, spaces.Single().Role));
        SetTenant(person, house.TenantId);
        var self = await RequiredJsonAsync<N9a1Self>(await person.GetAsync("/api/client-profile/me"));
        Assert.AreEqual(profile.Id, self.Id);
        Assert.IsTrue(self.SelfDirected);
        Assert.AreEqual(("Dalia", "Mansour", email), (self.FirstName, self.LastName, self.Email));
        Assert.AreEqual(new DateOnly(1991, 8, 23), self.BirthDate);

        // The house's staff now have them on Clients, with the first entry of the coach history saying how.
        foreach (var staff in new[] { house.Owner, house.Coach! })
        {
            var listed = (await N9a1ClientsAsync(staff)).Single();
            Assert.AreEqual((profile.Id, house.CoachUserId.Value), (listed.Id, listed.AssignedCoachUserId));
        }

        // A Coach acts only on the clients their name is on (ADR 0026), a self-directed trainee like any other.
        Assert.IsEmpty(await N9a1ClientsAsync(laterCoach));
        await AssertStatusAsync(await laterCoach.GetAsync($"/api/clients/{profile.Id}"), HttpStatusCode.NotFound);

        var history = await RequiredJsonAsync<N9a1Assignment[]>(
            await house.Owner.GetAsync($"/api/clients/{profile.Id}/coach-assignments"));
        Assert.AreEqual((1, house.CoachUserId.Value, (Guid?)null, "SignUp"), (history.Single().Sequence, history.Single().CoachUserId, history.Single().PreviousCoachUserId, history.Single().Reason));

        // The link tapped again answers alike and makes nothing more.
        using var again = CreateClient();
        await AssertStatusAsync(await N9a1ConfirmAsync(again, answer.DevelopmentConfirmationUrl), HttpStatusCode.NoContent);
        var after = await N9a1PersonAsync(email);
        Assert.AreEqual(
            (1, 1, 1, 1, 1),
            (after.Memberships.Length, after.Profiles.Length, after.Assignments.Length, after.Changes.Length, after.SignUps.Length));
        Assert.AreEqual(confirmed.ConfirmedAtUtc, after.SignUps.Single().ConfirmedAtUtc);
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9a1WithNoCoachTheOwnerKeepsTheRecordAndTwoConfirmationsAtOnceLeaveOneProfile()
    {
        const string email = "n9a1-twice-person@example.test";
        using var house = await N9a1OpenHouseAsync("twice");
        using var person = CreateClient();
        var response = await N9a1SignUpAsync(person, email);
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var link = (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!;

        // The link opened in two tabs at once: both are answered, and one confirmation happened.
        using var otherTab = CreateClient();
        await RefreshCsrfAsync(person);
        await RefreshCsrfAsync(otherTab);
        var body = new { userId = Guid.Parse(QueryValue(link, "userId")), code = QueryValue(link, "code") };
        var answers = await Task.WhenAll(
            person.PostAsJsonAsync("/api/auth/confirm-email", body),
            otherTab.PostAsJsonAsync("/api/auth/confirm-email", body));
        CollectionAssert.AreEqual(N9a1BothConfirmed, answers.Select(item => item.StatusCode).ToArray());

        var joined = await N9a1PersonAsync(email);
        Assert.IsTrue(joined.EmailConfirmed);
        Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single());
        var profile = joined.Profiles.Single();
        Assert.IsTrue(profile.IsSelfDirected);
        // A house with no Coach: the Owner is the member of staff the record names (ADR 0026's fallback).
        Assert.AreEqual(house.OwnerUserId, profile.AssignedCoachUserId);
        Assert.AreEqual((profile.Id, 1, house.OwnerUserId, (Guid?)null, "SignUp"), joined.Assignments.Single());
        Assert.AreEqual((profile.Id, "SignUp"), joined.Changes.Single());
        Assert.AreEqual(profile.Id, joined.SignUps.Single().ClientProfileId);
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
    }

    // ---------- 3. the guards ----------

    [TestMethod]
    public async Task N9a1ASignUpWithoutTheAntiforgeryTokenIsRefusedAndStoresNothing()
    {
        const string email = "n9a1-token-visitor@example.test";
        using var house = await N9a1OpenHouseAsync("token");
        using var visitor = CreateClient();
        var stamp = (await N9a1StatusAsync(visitor)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));

        // No token at all, then a token that is not this browser's.
        var noToken = await visitor.PostAsJsonAsync(N9a1SignUpUrl, N9a1Body(email, stamp));
        Assert.AreEqual("antiforgery_token_invalid", (await N9a1AnswerAsync(noToken, HttpStatusCode.BadRequest)).Code);
        visitor.DefaultRequestHeaders.Add("X-XSRF-TOKEN", "not-a-token");
        var wrongToken = await visitor.PostAsJsonAsync(N9a1SignUpUrl, N9a1Body(email, stamp));
        Assert.AreEqual("antiforgery_token_invalid", (await N9a1AnswerAsync(wrongToken, HttpStatusCode.BadRequest)).Code);
        Assert.AreEqual(0, await N9a1AccountsAsync(email));
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());

        // The same form and the same stamp, with the token: taken.
        await AssertStatusAsync(await N9a1PostAsync(visitor, N9a1Body(email, stamp)), HttpStatusCode.Accepted);
    }

    [TestMethod]
    public async Task N9a1AFilledHoneypotIsAnsweredLikeASignUpAndKeptNowhere()
    {
        const string decoy = "https://n9a1-decoy-offer.example/buy";
        using var bot = CreateClient();

        // Before anything is open a bot learns nothing either: the honeypot is weighed first.
        var whileClosed = await N9a1PostAsync(bot, N9a1Body("n9a1-bot-closed@example.test", null, website: decoy));
        await AssertStatusAsync(whileClosed, HttpStatusCode.Accepted);

        using var house = await N9a1OpenHouseAsync("bot");
        var stamp = (await N9a1StatusAsync(bot)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));
        var dropped = await N9a1PostAsync(bot, N9a1Body("n9a1-bot-open@example.test", stamp, website: decoy));
        await AssertStatusAsync(dropped, HttpStatusCode.Accepted);
        var droppedBody = await RequiredJsonAsync<JsonElement>(dropped);

        // A person's sign-up, for the shape of the answer a bot must not tell apart.
        using var person = CreateClient();
        var taken = await N9a1SignUpAsync(person, "n9a1-bot-person@example.test");
        await AssertStatusAsync(taken, HttpStatusCode.Accepted);
        var takenBody = await RequiredJsonAsync<JsonElement>(taken);
        CollectionAssert.AreEqual(N9a1AnswerFields, takenBody.EnumerateObject().Select(item => item.Name).Order(StringComparer.Ordinal).ToArray());
        CollectionAssert.AreEqual(N9a1AnswerFields, droppedBody.EnumerateObject().Select(item => item.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.AreEqual("n9a1-bot-open@example.test", droppedBody.GetProperty("email").GetString());
        Assert.IsFalse(droppedBody.GetProperty("joined").GetBoolean());

        // Kept nowhere: no account, no sign-up, and the value in no log line.
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-bot-closed@example.test", "n9a1-bot-open@example.test"));
        Assert.AreEqual(1, await N9a1SignUpRowsAsync(), "Only the person's sign-up is stored.");
        var log = RequiredEveryLogLine.Text;
        Assert.DoesNotContain("n9a1-decoy-offer", log, StringComparison.OrdinalIgnoreCase, "The honeypot's value reached a log line.");
        Assert.Contains("A house sign-up was refused: honeypot.", log);
    }

    [TestMethod]
    public async Task N9a1AMissingForgedOrDayOldStampIsRefusedAndAQuickFormWaitsItsThreeSeconds()
    {
        const string email = "n9a1-stamp-visitor@example.test";
        using var house = await N9a1OpenHouseAsync("stamp");
        using var visitor = CreateClient();

        // No stamp, and one this deployment never handed out.
        foreach (var bad in new[] { null, "forged", new string('s', 600) })
        {
            var refused = await N9a1PostAsync(visitor, N9a1Body(email, bad));
            Assert.AreEqual("sign_up_form_stamp_invalid", (await N9a1AnswerAsync(refused, HttpStatusCode.BadRequest)).Code, bad ?? "null");
        }

        // Sent a second after the form appeared: too fast. The same stamp two seconds later: a person.
        var stamp = (await N9a1StatusAsync(visitor)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(1));
        var tooFast = await N9a1PostAsync(visitor, N9a1Body(email, stamp));
        Assert.AreEqual("sign_up_form_too_fast", (await N9a1AnswerAsync(tooFast, HttpStatusCode.BadRequest)).Code);
        Assert.AreEqual(0, await N9a1AccountsAsync(email));
        RequiredTestClock.Advance(TimeSpan.FromSeconds(2));
        await AssertStatusAsync(await N9a1PostAsync(visitor, N9a1Body(email, stamp)), HttpStatusCode.Accepted);

        // A day later the stamp is a captured one.
        RequiredTestClock.Advance(TimeSpan.FromHours(25));
        var stale = await N9a1PostAsync(visitor, N9a1Body("n9a1-stamp-late@example.test", stamp));
        Assert.AreEqual("sign_up_form_stamp_invalid", (await N9a1AnswerAsync(stale, HttpStatusCode.BadRequest)).Code);
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-stamp-late@example.test"));
        Assert.AreEqual(1, await N9a1SignUpRowsAsync(), "Only the sign-up sent in time is stored.");
    }

    [TestMethod]
    public async Task N9a1AStampHandedOutForOneFormIsRefusedByTheOther()
    {
        const string email = "n9a1-cross-visitor@example.test";
        using var house = await N9a1OpenHouseAsync("cross");
        using var visitor = CreateClient();
        var contactForm = await RequiredJsonAsync<JsonElement>(await visitor.GetAsync("/api/website/contact-form"));
        var contactStamp = contactForm.GetProperty("stamp").GetString();
        var signUpStamp = (await N9a1StatusAsync(visitor)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));

        // Talk to us's stamp on the sign-up form.
        var crossed = await N9a1PostAsync(visitor, N9a1Body(email, contactStamp));
        Assert.AreEqual("sign_up_form_stamp_invalid", (await N9a1AnswerAsync(crossed, HttpStatusCode.BadRequest)).Code);
        Assert.AreEqual(0, await N9a1AccountsAsync(email));

        // The sign-up form's stamp on Talk to us.
        await RefreshCsrfAsync(visitor);
        var contact = await visitor.PostAsJsonAsync("/api/website/contact-requests", N9a1ContactBody(signUpStamp));
        Assert.AreEqual("contact_form_stamp_invalid", (await N9a1AnswerAsync(contact, HttpStatusCode.BadRequest)).Code);

        // Each form takes its own, so the two stamps were good ones.
        await AssertStatusAsync(await N9a1PostAsync(visitor, N9a1Body(email, signUpStamp)), HttpStatusCode.Accepted);
        await RefreshCsrfAsync(visitor);
        await AssertStatusAsync(
            await visitor.PostAsJsonAsync("/api/website/contact-requests", N9a1ContactBody(contactStamp)),
            HttpStatusCode.Accepted);
    }

    [TestMethod]
    public async Task N9a1TheTwentyFirstSignUpOfAnHourFromOneAddressIsRefusedWhileAnotherAddressGetsThrough()
    {
        using var house = await N9a1OpenHouseAsync("limit");
        using var script = CreateClient();
        script.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.40");

        // Twenty attempts from one address, however they end.
        for (var attempt = 1; attempt <= 20; attempt++)
        {
            var refused = await N9a1PostAsync(script, N9a1Body($"n9a1-limit-{attempt}@example.test", "forged"));
            Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode, $"Attempt {attempt}.");
        }

        var stamp = (await N9a1StatusAsync(script)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));
        var tooMany = await N9a1PostAsync(script, N9a1Body("n9a1-limit-21@example.test", stamp));
        Assert.AreEqual("too_many_requests", (await N9a1AnswerAsync(tooMany, HttpStatusCode.TooManyRequests)).Code);
        // The allowance is an hour's: a refusal that said to come back within the minute would be another limit's.
        Assert.IsGreaterThan(TimeSpan.FromMinutes(30), tooMany.Headers.RetryAfter?.Delta ?? TimeSpan.Zero);
        Assert.IsLessThanOrEqualTo(TimeSpan.FromHours(1), tooMany.Headers.RetryAfter?.Delta ?? TimeSpan.MaxValue);
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-limit-21@example.test"));
        // The read is not behind that allowance.
        Assert.AreEqual("Open", (await N9a1StatusAsync(script)).Status);

        // Another address is another allowance.
        using var person = CreateClient();
        person.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.41");
        await AssertStatusAsync(await N9a1PostAsync(person, N9a1Body("n9a1-limit-person@example.test", stamp)), HttpStatusCode.Accepted);
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
    }

    /// <summary>
    /// The route reads sixteen kilobytes and no more. Kestrel refuses a larger body while it is read; the test host
    /// has no socket to enforce it on, so the limit itself is what is pinned, as for Talk to us (audit BEB-3).
    /// </summary>
    [TestMethod]
    public void N9a1TheSignUpFormReadsNoMoreThanSixteenKilobytesAndKeepsALimitOfItsOwn()
    {
        var signUp = A10bApiRoutes().Single(route => A10bName(route) == "RegisterTrainee");
        Assert.AreEqual(16L * 1024, signUp.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize);
        Assert.AreEqual(RateLimitPolicies.TraineeSignUp, A10bPolicy(signUp));
        Assert.IsNotNull(signUp.Metadata.GetMetadata<IAllowAnonymous>());

        // The read counts against no allowance and asks for no account either.
        var read = A10bApiRoutes().Single(route => A10bName(route) == "GetTraineeSignUp");
        Assert.IsNull(A10bPolicy(read));
        Assert.IsNotNull(read.Metadata.GetMetadata<IAllowAnonymous>());
    }

    // ---------- 4. the fields and the age ----------

    [TestMethod]
    public async Task N9a1EachMissingFieldIsRefusedByItsKeyAndAWeakPasswordUnderIdentity()
    {
        const string email = "n9a1-fields-visitor@example.test";
        using var house = await N9a1OpenHouseAsync("fields");
        using var visitor = CreateClient();
        var stamp = (await N9a1StatusAsync(visitor)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));

        foreach (var (body, key) in new (object, string)[]
        {
            (N9a1Body(email, stamp, firstName: " "), "firstName"),
            (N9a1Body(email, stamp, firstName: new string('a', 101)), "firstName"),
            (N9a1Body(email, stamp, lastName: string.Empty), "lastName"),
            (N9a1Body("not-an-email", stamp), "email"),
            (N9a1Body(" ", stamp), "email"),
            (N9a1Body(email, stamp, birthDate: null), "birthDate"),
            (N9a1Body(email, stamp, withPassword: false), "password"),
        })
        {
            var refused = await N9a1PostAsync(visitor, body);
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            Assert.AreEqual(key, string.Join(", ", (await RequiredJsonAsync<N9a1Problem>(refused)).Errors.Keys));
        }

        // Every field wrong at once: each is named.
        var all = await N9a1PostAsync(
            visitor,
            N9a1Body(string.Empty, stamp, firstName: string.Empty, lastName: " ", birthDate: null, withPassword: false));
        await AssertStatusAsync(all, HttpStatusCode.BadRequest);
        CollectionAssert.AreEqual(
            N9a1EveryFormField,
            (await RequiredJsonAsync<N9a1Problem>(all)).Errors.Keys.Order(StringComparer.Ordinal).ToArray());

        // A password the account rules refuse comes back under their own key.
        var weak = await N9a1PostAsync(visitor, N9a1Body(email, stamp, password: "weak"));
        await AssertStatusAsync(weak, HttpStatusCode.BadRequest);
        CollectionAssert.AreEqual(N9a1IdentityField, (await RequiredJsonAsync<N9a1Problem>(weak)).Errors.Keys.ToArray());

        // No date of birth at all is asked for in words of its own.
        var missing = await N9a1PostAsync(visitor, N9a1Body(email, stamp, birthDate: null));
        await AssertStatusAsync(missing, HttpStatusCode.BadRequest);
        Assert.AreEqual("Enter your date of birth.", (await RequiredJsonAsync<N9a1Problem>(missing)).Errors["birthDate"].Single());

        // A date of birth still to come, or further back than anyone's: the year is what to check.
        var today = N9a1HouseToday();
        foreach (var day in new[] { today.AddDays(1), today.AddYears(7), today.AddYears(-120).AddDays(-1), new DateOnly(1826, 6, 14) })
        {
            var refused = await N9a1PostAsync(visitor, N9a1Body(email, stamp, birthDate: N9a1Day(day)));
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            var problem = await RequiredJsonAsync<N9a1Problem>(refused);
            CollectionAssert.AreEqual(N9a1BirthDateField, problem.Errors.Keys.ToArray(), N9a1Day(day));
            Assert.AreEqual("Check the year of your date of birth.", problem.Errors["birthDate"].Single(), N9a1Day(day));
        }

        Assert.AreEqual(0, await N9a1AccountsAsync(email, "not-an-email"));
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());

        // The same form, whole: taken.
        await AssertStatusAsync(await N9a1PostAsync(visitor, N9a1Body(email, stamp)), HttpStatusCode.Accepted);
    }

    [TestMethod]
    public async Task N9a1SomeoneADayShortOfTheHousesAgeOnTheHousesDayIsRefusedAndTheBirthdayItselfIsAccepted()
    {
        // 11 November 2026, half past midnight in Beirut (UTC+2), while UTC still reads the 10th: the house's day counts.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 10, 22, 30, 0, TimeSpan.Zero));
        using var house = await N9a1OpenHouseAsync("age");
        using var visitor = CreateClient();

        // Nineteen tomorrow, by the house's calendar.
        var young = await N9a1SignUpAsync(visitor, "n9a1-age-young@example.test", birthDate: "2007-11-12");
        var refusal = await N9a1AnswerAsync(young, HttpStatusCode.Conflict);
        Assert.AreEqual("trainee_sign_up_age_not_met", refusal.Code);
        Assert.AreEqual(19, refusal.MinimumAge);
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-age-young@example.test"));
        Assert.AreEqual(0, await N9a1SignUpRowsAsync(), "Nothing of an under-age request is kept.");

        // Nineteen today: the birthday itself counts.
        await AssertStatusAsync(
            await N9a1SignUpAsync(visitor, "n9a1-age-birthday@example.test", birthDate: "2007-11-11"),
            HttpStatusCode.Accepted);

        // The admin raises the age: someone between the two ages is now refused, with the new number.
        await N9a1SettingAsync(house.Admin, N9a1AgeSetting, "23");
        Assert.AreEqual(23, (await N9a1StatusAsync(visitor)).MinimumAge);
        var between = await N9a1SignUpAsync(visitor, "n9a1-age-between@example.test", birthDate: "2005-06-15");
        refusal = await N9a1AnswerAsync(between, HttpStatusCode.Conflict);
        Assert.AreEqual("trainee_sign_up_age_not_met", refusal.Code);
        Assert.AreEqual(23, refusal.MinimumAge);
        var justShort = await N9a1SignUpAsync(visitor, "n9a1-age-between@example.test", birthDate: "2003-11-12");
        Assert.AreEqual("trainee_sign_up_age_not_met", (await N9a1AnswerAsync(justShort, HttpStatusCode.Conflict)).Code);
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-age-between@example.test"));
        await AssertStatusAsync(
            await N9a1SignUpAsync(visitor, "n9a1-age-old-enough@example.test", birthDate: "2003-11-11"),
            HttpStatusCode.Accepted);
        Assert.AreEqual(2, await N9a1SignUpRowsAsync());
    }

    // ---------- 5. the week ----------

    [TestMethod]
    public async Task N9a1AWeeksPlacesAreTakenByConfirmedSignUpsOverTheHousesOwnWeekAndWaitingOnesHoldNone()
    {
        // Friday 13 November 2026, 23:30 in Beirut (UTC+2). The house's week starts on Saturday here, so it ends in
        // half an hour, while a week counted in UTC or from Monday would run on.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 13, 21, 30, 0, TimeSpan.Zero));
        using var house = await N9a1OpenHouseAsync("week", signUpsPerWeek: "3");
        var workspace = await RequiredJsonAsync<N9a1Workspace>(await house.Owner.GetAsync("/api/workspace"));
        await RefreshCsrfAsync(house.Owner);
        await AssertStatusAsync(
            await house.Owner.PutAsJsonAsync("/api/workspace", new
            {
                name = workspace.Name,
                timeZoneId = workspace.TimeZoneId,
                defaultCulture = workspace.DefaultCulture,
                defaultCurrencyCode = workspace.DefaultCurrencyCode,
                weekStartsOn = "Saturday",
                version = workspace.Version,
            }),
            HttpStatusCode.OK);

        // Three places, and five forms whose emails are never confirmed: each is taken, and none holds a place.
        using var visitor = CreateClient();
        for (var number = 1; number <= 5; number++)
        {
            await AssertStatusAsync(await N9a1SignUpAsync(visitor, $"n9a1-week-waits-{number}@example.test"), HttpStatusCode.Accepted);
        }

        Assert.AreEqual(5, await N9a1SignUpRowsAsync());
        var untouched = await N9a1StatusAsync(visitor);
        Assert.AreEqual("Open", untouched.Status, "More made-up addresses than the week's places leave every place free.");
        Assert.IsNull(untouched.OpensAgainOn);
        Assert.IsNotNull(untouched.FormStamp);

        // Confirmed sign-ups are what fill it: two leave one place, and the third takes the last.
        using var first = await N9a1TraineeAsync(house.TenantId, "n9a1-week-first@example.test");
        using var second = await N9a1TraineeAsync(house.TenantId, "n9a1-week-second@example.test");
        var open = await N9a1StatusAsync(visitor);
        Assert.AreEqual("Open", open.Status);
        var heldStamp = open.FormStamp;
        using var third = await N9a1TraineeAsync(house.TenantId, "n9a1-week-third@example.test");

        var full = await N9a1StatusAsync(visitor);
        Assert.AreEqual("Full", full.Status);
        Assert.AreEqual((house.Name, "Asia/Beirut", (int?)19), (full.WorkspaceName, full.TimeZoneId, full.MinimumAge));
        Assert.AreEqual(new DateOnly(2026, 11, 14), full.OpensAgainOn, "The first day of the house's next week.");
        Assert.IsNull(full.FormStamp, "A full week hands out no form.");
        Assert.IsNull(full.CallerSignUp, "Nobody is signed in.");

        // A form that was on screen before the week filled up is told when to come back.
        var late = await N9a1SignUpAsync(visitor, "n9a1-week-late@example.test", formStamp: heldStamp);
        var refusal = await N9a1AnswerAsync(late, HttpStatusCode.Conflict);
        Assert.AreEqual("trainee_sign_up_full", refusal.Code);
        Assert.AreEqual(new DateOnly(2026, 11, 14), refusal.OpensAgainOn);
        Assert.AreEqual("Sign-up is full for this week. It opens again on Saturday.", refusal.Message);
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-week-late@example.test"));
        Assert.AreEqual(8, await N9a1SignUpRowsAsync());

        // The week's last second in Beirut, 23:59:59 on Friday: still full.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 13, 21, 59, 59, TimeSpan.Zero));
        Assert.AreEqual("Full", (await N9a1StatusAsync(visitor)).Status);

        // Half past midnight on Saturday in Beirut, still Friday in UTC: the house's next week, open again.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 13, 22, 30, 0, TimeSpan.Zero));
        var reopened = await N9a1StatusAsync(visitor);
        Assert.AreEqual("Open", reopened.Status);
        Assert.IsNull(reopened.OpensAgainOn);
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, "n9a1-week-late@example.test"), HttpStatusCode.Accepted);
        Assert.AreEqual(9, await N9a1SignUpRowsAsync());
    }

    [TestMethod]
    public async Task N9a1AnEmailConfirmedAfterTheWeekFilledWaitsForAPlaceAndJoinsWithTheSignedInFormTheNextWeek()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut: the house's week runs Monday the 9th to Monday the 16th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        const string firstEmail = "n9a1-after-first@example.test";
        const string secondEmail = "n9a1-after-second@example.test";
        var nextWeek = new DateOnly(2026, 11, 16);
        using var house = await N9a1OpenHouseAsync("after", signUpsPerWeek: "1");
        using var first = CreateClient();
        using var second = CreateClient();

        // Two people send the form while the week's one place is free: both are taken, and the week stays open.
        var firstResponse = await N9a1SignUpAsync(first, firstEmail, "Hala", "Sfeir", "1992-10-09");
        await AssertStatusAsync(firstResponse, HttpStatusCode.Accepted);
        var secondResponse = await N9a1SignUpAsync(second, secondEmail, "Tarek", "Abboud", "1989-04-27");
        await AssertStatusAsync(secondResponse, HttpStatusCode.Accepted);
        var whileOpen = await N9a1StatusAsync(second);
        Assert.AreEqual("Open", whileOpen.Status);
        var heldStamp = whileOpen.FormStamp;

        // The first confirms, joins and takes the place.
        await AssertStatusAsync(
            await N9a1ConfirmAsync(first, (await RequiredJsonAsync<N9a1Answer>(firstResponse)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        var firstPerson = await N9a1PersonAsync(firstEmail);
        Assert.AreEqual((house.TenantId, "Client", "Active"), firstPerson.Memberships.Single());
        Assert.AreEqual("Full", (await N9a1StatusAsync(second)).Status);

        // The second's link still confirms their email, and makes them nobody's client: the sign-up waits.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(10));
        await AssertStatusAsync(
            await N9a1ConfirmAsync(second, (await RequiredJsonAsync<N9a1Answer>(secondResponse)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        var waiting = await N9a1PersonAsync(secondEmail);
        Assert.IsTrue(waiting.EmailConfirmed);
        Assert.IsEmpty(waiting.Memberships, "A confirmation into a full week makes no membership.");
        Assert.IsEmpty(waiting.Profiles, "A confirmation into a full week makes no client profile.");
        var row = waiting.SignUps.Single();
        Assert.IsNull(row.ConfirmedAtUtc);
        Assert.IsNull(row.ClientProfileId);
        Assert.AreEqual(("Tarek", "Abboud", (DateOnly?)new DateOnly(1989, 4, 27)), (row.FirstName, row.LastName, row.BirthDate));
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));
        Assert.AreEqual(firstPerson.Profiles.Single().Id, (await N9a1ClientsAsync(house.Owner)).Single().Id, "The house's staff see the one who joined.");

        // The account works: they sign in, belong to no coaching space, and the page is told their sign-up waits.
        await N9a1SignInAsync(second, secondEmail);
        Assert.IsEmpty(await RequiredJsonAsync<N9a1Membership[]>(await second.GetAsync("/api/tenants")));
        var told = await N9a1StatusAsync(second);
        Assert.AreEqual(("Full", "Waiting", (DateOnly?)nextWeek), (told.Status, told.CallerSignUp, told.OpensAgainOn));
        Assert.IsNull(told.FormStamp);
        // The one who joined is told so, and somebody signed out is told neither.
        await N9a1SignInAsync(first, firstEmail);
        var toldTheFirst = await N9a1StatusAsync(first);
        Assert.AreEqual(("Full", "Joined"), (toldTheFirst.Status, toldTheFirst.CallerSignUp));
        using var visitor = CreateClient();
        Assert.IsNull((await N9a1StatusAsync(visitor)).CallerSignUp);

        // Signed in, in the week that is full, the form is refused like anybody's and the sign-up goes on waiting.
        var sameWeek = await N9a1SignUpAsync(second, secondEmail, "Tarek", "Abboud", "1989-04-27", withPassword: false, formStamp: heldStamp);
        var refusal = await N9a1AnswerAsync(sameWeek, HttpStatusCode.Conflict);
        Assert.AreEqual(("trainee_sign_up_full", (DateOnly?)nextWeek), (refusal.Code, refusal.OpensAgainOn));
        Assert.AreEqual(row, (await N9a1PersonAsync(secondEmail)).SignUps.Single());
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));

        // Monday 16 November, half past midnight in Beirut: the house's next week. Signed in, with no password,
        // they send the form and join at once.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 15, 22, 30, 0, TimeSpan.Zero));
        var reopened = await N9a1StatusAsync(second);
        Assert.AreEqual(("Open", "Waiting"), (reopened.Status, reopened.CallerSignUp));
        var response = await N9a1SignUpAsync(second, secondEmail, "Tarek", "Abboud", "1989-04-27", withPassword: false);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var answer = await RequiredJsonAsync<N9a1Answer>(response);
        Assert.AreEqual((secondEmail, (bool?)true), (answer.Email, answer.Joined));

        // The sign-up that waited is the one that took the place: the account has one row, now confirmed.
        var joined = await N9a1PersonAsync(secondEmail);
        Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single());
        var profile = joined.Profiles.Single();
        Assert.IsTrue(profile.IsSelfDirected);
        Assert.AreEqual(house.TenantId, profile.TenantId);
        Assert.AreEqual(("Tarek", "Abboud", secondEmail), (profile.FirstName, profile.LastName, profile.Email));
        Assert.AreEqual(new DateOnly(1989, 4, 27), profile.BirthDate);
        Assert.AreEqual((profile.Id, 1, house.OwnerUserId, (Guid?)null, "SignUp"), joined.Assignments.Single());
        Assert.AreEqual((profile.Id, "SignUp"), joined.Changes.Single());
        var confirmed = joined.SignUps.Single();
        Assert.AreEqual((row.Id, (Guid?)profile.Id), (confirmed.Id, confirmed.ClientProfileId));
        Assert.AreEqual(RequiredTestClock.UtcNow, confirmed.ConfirmedAtUtc, "The place is taken in the week they joined.");
        Assert.AreEqual(((string?)null, (string?)null, (DateOnly?)null), (confirmed.FirstName, confirmed.LastName, confirmed.BirthDate));
        Assert.AreEqual(2, await N9a1SignUpRowsAsync());
        Assert.AreEqual(2, await N9a1ProfilesInAsync(house.TenantId));

        // The page now says they joined, the week's one place is theirs, and the house is in their list.
        var after = await N9a1StatusAsync(second);
        Assert.AreEqual(("Full", "Joined"), (after.Status, after.CallerSignUp));
        var spaces = await RequiredJsonAsync<N9a1Membership[]>(await second.GetAsync("/api/tenants"));
        Assert.AreEqual((house.TenantId, "Client"), (spaces.Single().TenantId, spaces.Single().Role));
        SetTenant(second, house.TenantId);
        var self = await RequiredJsonAsync<N9a1Self>(await second.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((profile.Id, true), (self.Id, self.SelfDirected));
    }

    [TestMethod]
    public async Task N9a1AnAccountThePlatformBlockedConfirmsItsEmailAndJoinsNobody()
    {
        using var house = await N9a1OpenHouseAsync("blocked-account");
        const string email = "n9a1-platform-blocked@example.test";
        using var person = CreateClient();
        var response = await N9a1SignUpAsync(person, email, "Hala", "Sarkis", "1991-07-23");
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var link = (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!;
        var waiting = await N9a1PersonAsync(email);

        // The platform blocks the account while its sign-up waits. No route sets the block yet; the flag is the fact.
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            var userId = waiting.UserId!.Value;
            Assert.AreEqual(1, await context.Database.ExecuteSqlAsync(
                $"""UPDATE identity."Users" SET "IsPlatformBlocked" = true WHERE "Id" = {userId}"""));
        }

        // The link still confirms the email, as it does for any account; a blocked one joins nothing, as the
        // signed-in form refuses it too.
        await AssertStatusAsync(await N9a1ConfirmAsync(person, link), HttpStatusCode.NoContent);
        var after = await N9a1PersonAsync(email);
        Assert.IsTrue(after.EmailConfirmed);
        Assert.IsEmpty(after.Memberships);
        Assert.IsEmpty(after.Profiles);
        Assert.IsNull(after.SignUps.Single().ConfirmedAtUtc, "Its sign-up waits, and the sweep removes it.");
        Assert.AreEqual(0, await N9a1ProfilesInAsync(house.TenantId));
        Assert.IsEmpty(await N9a1ClientsAsync(house.Owner));
    }

    [TestMethod]
    public async Task N9a1AConfirmationAfterTheAdminEmptiedASettingConfirmsTheEmailAndJoinsNobody()
    {
        using var house = await N9a1OpenHouseAsync("emptied");

        // Each way the admin closes sign-up between the form and the link: no number, a number of 0, no age.
        var people = new List<(string Email, HttpClient Client, Guid RowId)>();
        try
        {
            foreach (var (tag, setting, closedBy, restoredTo) in new[]
            {
                ("places", N9a1PlacesSetting, (string?)null, N9a1Places),
                ("zero", N9a1PlacesSetting, "0", N9a1Places),
                ("age", N9a1AgeSetting, (string?)null, N9a1Age),
            })
            {
                var email = $"n9a1-emptied-{tag}@example.test";
                var person = CreateClient();
                var response = await N9a1SignUpAsync(person, email, "Rana", "Karam", "1990-02-11");
                await AssertStatusAsync(response, HttpStatusCode.Accepted);
                var link = (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!;
                var before = (await N9a1PersonAsync(email)).SignUps.Single();
                people.Add((email, person, before.Id));

                await N9a1SettingAsync(house.Admin, setting, closedBy);
                Assert.AreEqual("Closed", (await N9a1StatusAsync(person)).Status, tag);

                // The link still confirms the email; nobody joins a sign-up that is closed.
                await AssertStatusAsync(await N9a1ConfirmAsync(person, link), HttpStatusCode.NoContent);
                var after = await N9a1PersonAsync(email);
                Assert.IsTrue(after.EmailConfirmed, tag);
                Assert.IsEmpty(after.Memberships, tag);
                Assert.IsEmpty(after.Profiles, tag);
                Assert.AreEqual(before, after.SignUps.Single(), $"{tag}: the sign-up waits as it was, with what was typed.");
                Assert.IsNull(after.SignUps.Single().ConfirmedAtUtc, tag);
                Assert.AreEqual(0, await N9a1ProfilesInAsync(house.TenantId), tag);
                Assert.IsEmpty(await N9a1ClientsAsync(house.Owner), tag);

                // The account signs in and belongs to no coaching space; the closed read tells it nothing more,
                // and its form is refused like anybody's.
                await N9a1SignInAsync(person, email);
                Assert.IsEmpty(await RequiredJsonAsync<N9a1Membership[]>(await person.GetAsync("/api/tenants")), tag);
                var read = await RequiredJsonAsync<JsonElement>(await person.GetAsync(N9a1SignUpUrl));
                Assert.AreEqual("Closed", read.GetProperty("status").GetString(), tag);
                foreach (var property in read.EnumerateObject().Where(item => item.Name != "status"))
                {
                    Assert.AreEqual(JsonValueKind.Null, property.Value.ValueKind, $"{tag}: the closed read tells {property.Name}.");
                }

                var refused = await N9a1SignUpAsync(person, email, "Rana", "Karam", "1990-02-11", withPassword: false);
                Assert.AreEqual("trainee_sign_up_closed", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code, tag);
                Assert.AreEqual(before, (await N9a1PersonAsync(email)).SignUps.Single(), tag);

                await N9a1SettingAsync(house.Admin, setting, restoredTo);
            }

            // Open again, each is told their sign-up waits, sends the form signed in and joins on the row they had.
            foreach (var (email, person, rowId) in people)
            {
                var told = await N9a1StatusAsync(person);
                Assert.AreEqual(("Open", "Waiting"), (told.Status, told.CallerSignUp), email);
                var response = await N9a1SignUpAsync(person, email, "Rana", "Karam", "1990-02-11", withPassword: false);
                await AssertStatusAsync(response, HttpStatusCode.OK);
                Assert.IsTrue((await RequiredJsonAsync<N9a1Answer>(response)).Joined, email);
                var joined = await N9a1PersonAsync(email);
                Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single(), email);
                Assert.IsTrue(joined.Profiles.Single().IsSelfDirected, email);
                Assert.AreEqual((rowId, (Guid?)joined.Profiles.Single().Id), (joined.SignUps.Single().Id, joined.SignUps.Single().ClientProfileId), email);
                Assert.AreEqual("Joined", (await N9a1StatusAsync(person)).CallerSignUp, email);
            }
        }
        finally
        {
            foreach (var (_, person, _) in people)
            {
                person.Dispose();
            }
        }

        Assert.AreEqual(3, await N9a1SignUpRowsAsync());
        Assert.AreEqual(3, await N9a1ProfilesInAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9a1TheLastPlaceOfTheWeekAskedForTwiceAtOnceIsGivenOnce()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut. Each round starts a week after the one before, on a
        // Wednesday too, and Beirut's clocks do not change before the spring: no round straddles two weeks.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        using var house = await N9a1OpenHouseAsync("last", signUpsPerWeek: "1");
        using var one = CreateClient();
        one.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.61");
        using var other = CreateClient();
        other.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.62");

        // One place a week. Two people sent the form while it was free, and tap their links at the same moment;
        // three weeks running.
        for (var week = 1; week <= 3; week++)
        {
            var emails = new[] { $"n9a1-last-{week}-a@example.test", $"n9a1-last-{week}-b@example.test" };
            var links = new List<string>();
            foreach (var (client, email) in new[] { (one, emails[0]), (other, emails[1]) })
            {
                var taken = await N9a1SignUpAsync(client, email);
                await AssertStatusAsync(taken, HttpStatusCode.Accepted);
                links.Add((await RequiredJsonAsync<N9a1Answer>(taken)).DevelopmentConfirmationUrl!);
            }

            Assert.AreEqual("Open", (await N9a1StatusAsync(one)).Status, $"Week {week}: two sign-ups wait and its place is free.");
            await RefreshCsrfAsync(one);
            await RefreshCsrfAsync(other);
            var answers = await Task.WhenAll(
                one.PostAsJsonAsync("/api/auth/confirm-email", N9a1ConfirmationBody(links[0])),
                other.PostAsJsonAsync("/api/auth/confirm-email", N9a1ConfirmationBody(links[1])));
            CollectionAssert.AreEqual(N9a1BothConfirmed, answers.Select(item => item.StatusCode).ToArray(), $"Week {week}.");

            // Both emails are confirmed; one of the two has the place, a membership and a profile, and the other's
            // sign-up waits with nothing made of it.
            var people = new[] { await N9a1PersonAsync(emails[0]), await N9a1PersonAsync(emails[1]) };
            Assert.IsTrue(people.All(person => person.EmailConfirmed), $"Week {week}.");
            var joined = people.Single(person => person.Profiles.Length == 1);
            var waits = people.Single(person => person.Profiles.Length == 0);
            Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single(), $"Week {week}.");
            Assert.IsTrue(joined.Profiles.Single().IsSelfDirected, $"Week {week}.");
            Assert.AreEqual(joined.Profiles.Single().Id, joined.SignUps.Single().ClientProfileId, $"Week {week}.");
            Assert.IsNotNull(joined.SignUps.Single().ConfirmedAtUtc, $"Week {week}.");
            Assert.IsEmpty(waits.Memberships, $"Week {week}.");
            Assert.IsNull(waits.SignUps.Single().ConfirmedAtUtc, $"Week {week}.");
            Assert.IsNull(waits.SignUps.Single().ClientProfileId, $"Week {week}.");
            Assert.AreEqual(week, await N9a1ProfilesInAsync(house.TenantId), $"Week {week}: one profile for the one place.");
            Assert.AreEqual(2 * week, await N9a1SignUpRowsAsync(), $"Week {week}.");
            Assert.AreEqual("Full", (await N9a1StatusAsync(one)).Status, $"Week {week}.");
            RequiredTestClock.Advance(TimeSpan.FromDays(7));
        }
    }

    // ---------- 6. accounts that exist ----------

    [TestMethod]
    public async Task N9a1AnEmailThatHasAnAccountSignsInFirstAndThenJoinsAtOnceBesideItsOwnSpace()
    {
        using var house = await N9a1OpenHouseAsync("known", withCoach: true);
        using var rami = CreateClient();
        var ramisSpace = await RegisterCoachAsync(rami, "n9a1-known-rami@example.test", "Rami Tabet", "N9a1 Known Rami Gym");

        // Nobody signed in: the form says to sign in, and keeps nothing.
        using var visitor = CreateClient();
        var asked = await N9a1SignUpAsync(visitor, "n9a1-known-rami@example.test");
        var signInFirst = await N9a1AnswerAsync(asked, HttpStatusCode.Conflict);
        Assert.AreEqual("existing_account_sign_in_required", signInFirst.Code);
        // One sentence for an account of one's own and for a sign-up here whose link has stopped working.
        Assert.StartsWith("An account already uses this email. Sign in with it, then sign up from there.", signInFirst.Message!);
        Assert.Contains("sign up again in a few days", signInFirst.Message!);
        var before = await N9a1PersonAsync("n9a1-known-rami@example.test");
        Assert.IsEmpty(before.SignUps);
        Assert.AreEqual((ramisSpace, "Owner", "Active"), before.Memberships.Single());

        // Signed in, with another email in the form: refused, whoever's email it is.
        foreach (var typed in new[] { "n9a1-known-somebody@example.test", "n9a1-known-owner@example.test" })
        {
            var wrong = await N9a1SignUpAsync(rami, typed, withPassword: false);
            Assert.AreEqual("wrong_signed_in_account", (await N9a1AnswerAsync(wrong, HttpStatusCode.Forbidden)).Code, typed);
        }

        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-known-somebody@example.test"));
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());

        // Signed in, with their own email and no password: they join at once. The browser still names their own
        // coaching space in its header, and the sign-up lands in the house all the same.
        var response = await N9a1SignUpAsync(rami, "N9a1-Known-Rami@example.test", "Rami", "Tabet", "1988-02-29", withPassword: false);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var answer = await RequiredJsonAsync<N9a1Answer>(response);
        Assert.AreEqual(("n9a1-known-rami@example.test", (bool?)true), (answer.Email, answer.Joined));
        Assert.IsNull(answer.DevelopmentConfirmationUrl, "A confirmed account has nothing to confirm.");

        var joined = await N9a1PersonAsync("n9a1-known-rami@example.test");
        CollectionAssert.AreEquivalent(
            new[] { (ramisSpace, "Owner", "Active"), (house.TenantId, "Client", "Active") },
            joined.Memberships);
        var profile = joined.Profiles.Single();
        Assert.AreEqual(house.TenantId, profile.TenantId);
        Assert.IsTrue(profile.IsSelfDirected);
        Assert.AreEqual(("Rami", "Tabet", "n9a1-known-rami@example.test"), (profile.FirstName, profile.LastName, profile.Email));
        Assert.AreEqual(new DateOnly(1988, 2, 29), profile.BirthDate);
        Assert.AreEqual(house.CoachUserId, profile.AssignedCoachUserId);
        Assert.AreEqual((profile.Id, 1, house.CoachUserId!.Value, (Guid?)null, "SignUp"), joined.Assignments.Single());
        Assert.AreEqual((profile.Id, "SignUp"), joined.Changes.Single());
        var row = joined.SignUps.Single();
        Assert.AreEqual((house.TenantId, (Guid?)profile.Id), (row.TenantId, row.ClientProfileId));
        Assert.IsNotNull(row.ConfirmedAtUtc);
        Assert.AreEqual(((string?)null, (string?)null, (DateOnly?)null), (row.FirstName, row.LastName, row.BirthDate));

        // Both spaces are theirs now, and their own is untouched.
        var spaces = await RequiredJsonAsync<N9a1Membership[]>(await rami.GetAsync("/api/tenants"));
        CollectionAssert.AreEqual(N9a1TwoRoles, spaces.Select(item => item.Role).Order(StringComparer.Ordinal).ToArray());
        Assert.AreEqual("Owner", spaces.Single(item => item.TenantId == ramisSpace).Role);
        Assert.AreEqual("Client", spaces.Single(item => item.TenantId == house.TenantId).Role);
        Assert.IsEmpty(await N9a1ClientsAsync(rami), "Their own coaching space gained no client.");
        Assert.AreEqual(0, await N9a1ProfilesInAsync(ramisSpace));
        SetTenant(rami, house.TenantId);
        var self = await RequiredJsonAsync<N9a1Self>(await rami.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((profile.Id, true), (self.Id, self.SelfDirected));
        Assert.AreEqual(profile.Id, (await N9a1ClientsAsync(house.Owner)).Single().Id);

        // Part of the house already: a trainee, its Owner and its Coach are each told so.
        foreach (var (member, email) in new[]
        {
            (rami, "n9a1-known-rami@example.test"),
            (house.Owner, "n9a1-known-owner@example.test"),
            (house.Coach!, "n9a1-known-coach@example.test"),
        })
        {
            var again = await N9a1SignUpAsync(member, email, withPassword: false);
            Assert.AreEqual("trainee_already_joined", (await N9a1AnswerAsync(again, HttpStatusCode.Conflict)).Code, email);
        }

        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9a1ACurrentClientOfAnotherCoachJoinsTheHouseAndNeitherSpaceListsTheOther()
    {
        const string email = "n9a1-both-client@example.test";
        using var house = await N9a1OpenHouseAsync("both");
        using var coach = CreateClient();
        var coachesSpace = await RegisterCoachAsync(coach, "n9a1-both-coach@example.test", "Zeina Aoun", "N9a1 Both Zeina Gym");
        using var client = CreateClient();
        var coachedProfileId = await InviteAndAcceptAsync(coach, client, email, true);

        // Sign-up asks nothing about other coaching spaces: being somebody's client elsewhere changes nothing.
        var response = await N9a1SignUpAsync(client, email, "Karim", "Nassar", "1990-12-05", withPassword: false);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<N9a1Answer>(response)).Joined);

        var person = await N9a1PersonAsync(email);
        CollectionAssert.AreEquivalent(
            new[] { (coachesSpace, "Client", "Active"), (house.TenantId, "Client", "Active") },
            person.Memberships);
        Assert.HasCount(2, person.Profiles);
        var coached = person.Profiles.Single(item => item.TenantId == coachesSpace);
        var own = person.Profiles.Single(item => item.TenantId == house.TenantId);
        Assert.AreEqual((coachedProfileId, false), (coached.Id, coached.IsSelfDirected));
        Assert.IsTrue(own.IsSelfDirected);
        Assert.AreEqual(house.OwnerUserId, own.AssignedCoachUserId);

        var spaces = await RequiredJsonAsync<N9a1Membership[]>(await client.GetAsync("/api/tenants"));
        CollectionAssert.AreEqual(N9a1ClientTwice, spaces.Select(item => item.Role).ToArray());
        CollectionAssert.AreEquivalent(new[] { coachesSpace, house.TenantId }, spaces.Select(item => item.TenantId).ToArray());

        // Each space reads its own record of the person, and nothing of the other's.
        Assert.AreEqual(coached.Id, (await N9a1ClientsAsync(coach)).Single().Id);
        Assert.AreEqual(own.Id, (await N9a1ClientsAsync(house.Owner)).Single().Id);
        await AssertStatusAsync(await coach.GetAsync($"/api/clients/{own.Id}"), HttpStatusCode.NotFound);
        await AssertStatusAsync(await house.Owner.GetAsync($"/api/clients/{coached.Id}"), HttpStatusCode.NotFound);
        SetTenant(client, coachesSpace);
        var there = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((coached.Id, false), (there.Id, there.SelfDirected));
        SetTenant(client, house.TenantId);
        var here = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((own.Id, true, "Karim"), (here.Id, here.SelfDirected, here.FirstName));
    }

    [TestMethod]
    public async Task N9a1TwoSignUpsWithOneNewEmailAtOnceLeaveOneAccountAndOneWaitingSignUp()
    {
        const string email = "n9a1-pair-person@example.test";
        using var house = await N9a1OpenHouseAsync("pair");
        using var one = CreateClient();
        using var other = CreateClient();
        var stamp = (await N9a1StatusAsync(one)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));
        await RefreshCsrfAsync(one);
        await RefreshCsrfAsync(other);

        var answers = await Task.WhenAll(
            one.PostAsJsonAsync(N9a1SignUpUrl, N9a1Body(email, stamp)),
            other.PostAsJsonAsync(N9a1SignUpUrl, N9a1Body(email, stamp, firstName: "Somebody", lastName: "Else")));
        CollectionAssert.AreEquivalent(N9a1OneAcceptedOneRefused, answers.Select(item => item.StatusCode).ToArray());
        var refused = await N9a1AnswerAsync(answers.Single(item => item.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict);
        CollectionAssert.Contains(N9a1OneAccountCodes, refused.Code);

        Assert.AreEqual(1, await N9a1AccountsAsync(email));
        var person = await N9a1PersonAsync(email);
        Assert.HasCount(1, person.SignUps);
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
        Assert.IsEmpty(person.Memberships);

        // The one link that was sent still confirms the one account.
        var taken = await RequiredJsonAsync<N9a1Answer>(answers.Single(item => item.StatusCode == HttpStatusCode.Accepted));
        await AssertStatusAsync(await N9a1ConfirmAsync(one, taken.DevelopmentConfirmationUrl!), HttpStatusCode.NoContent);
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9a1ATraineeWhoLeftSignsUpAgainFromTheNextHouseWeekAndGetsANewProfileBesideTheEndedOne()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut: the house's week runs Monday the 9th to Monday the 16th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        const string email = "n9a1-back-trainee@example.test";
        using var house = await N9a1OpenHouseAsync("back");
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Lina", "Saad");

        // While they are a trainee, signing up again is refused.
        var again = await N9a1SignUpAsync(trainee.Client, email, withPassword: false);
        Assert.AreEqual("trainee_already_joined", (await N9a1AnswerAsync(again, HttpStatusCode.Conflict)).Code);

        // They leave the house.
        await N9a1LeaveAsync(trainee.Client, "Trying it alone");
        Assert.IsEmpty(await RequiredJsonAsync<N9a1Membership[]>(await trainee.Client.GetAsync("/api/tenants")));
        var gone = await N9a1PersonAsync(email);
        Assert.AreEqual((house.TenantId, "Client", "Removed"), gone.Memberships.Single());

        // Still signed in to their account, three hours and then three days later in the same house week: the one
        // sign-up of the week is spent, and they are told the day the next one starts. Nothing is made.
        foreach (var later in new[] { TimeSpan.FromHours(3), TimeSpan.FromDays(3) })
        {
            RequiredTestClock.Advance(later);
            var sameWeek = await N9a1SignUpAsync(trainee.Client, email, "Lina", "Saad-Khoury", "1996-01-30", withPassword: false);
            var refusal = await N9a1AnswerAsync(sameWeek, HttpStatusCode.Conflict);
            Assert.AreEqual("trainee_sign_up_once_a_week", refusal.Code);
            Assert.AreEqual(new DateOnly(2026, 11, 16), refusal.OpensAgainOn, "The first day of the house's next week.");
            Assert.AreEqual("You already signed up this week. You can sign up again on Monday.", refusal.Message);
            var still = await N9a1PersonAsync(email);
            Assert.AreEqual((house.TenantId, "Client", "Removed"), still.Memberships.Single());
            Assert.AreEqual(trainee.ProfileId, still.Profiles.Single().Id);
            Assert.AreEqual(gone.SignUps.Single(), still.SignUps.Single());
        }

        Assert.Contains("A house sign-up was refused: once-a-week.", RequiredEveryLogLine.Text);
        // The week itself has room, and they are neither a client today nor waiting for a place.
        var told = await N9a1StatusAsync(trainee.Client);
        Assert.AreEqual(("Open", (string?)null), (told.Status, told.CallerSignUp));

        // Monday 16 November, half past midnight in Beirut, the house's next week: a new relationship beside the
        // ended one.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 15, 22, 30, 0, TimeSpan.Zero));
        var response = await N9a1SignUpAsync(trainee.Client, email, "Lina", "Saad-Khoury", "1996-01-30", withPassword: false);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<N9a1Answer>(response)).Joined);

        var back = await N9a1PersonAsync(email);
        Assert.AreEqual((house.TenantId, "Client", "Active"), back.Memberships.Single(), "They rejoin on the membership row they had.");
        Assert.HasCount(2, back.Profiles);
        var ended = back.Profiles.Single(item => item.ReleasedAtUtc is not null);
        var current = back.Profiles.Single(item => item.ReleasedAtUtc is null);
        Assert.AreEqual(trainee.ProfileId, ended.Id);
        Assert.AreEqual("Saad", ended.LastName, "The ended record keeps what it held.");
        Assert.AreNotEqual(ended.Id, current.Id);
        Assert.IsTrue(current.IsSelfDirected);
        Assert.AreEqual(("Lina", "Saad-Khoury", (DateOnly?)new DateOnly(1996, 1, 30)), (current.FirstName, current.LastName, current.BirthDate));
        Assert.AreEqual((current.Id, 1, house.OwnerUserId, (Guid?)null, "SignUp"), back.Assignments.Single(item => item.ClientProfileId == current.Id));
        Assert.HasCount(2, back.SignUps);
        CollectionAssert.AreEquivalent(
            new Guid?[] { ended.Id, current.Id },
            back.SignUps.Select(item => item.ClientProfileId).ToArray());
        Assert.IsTrue(back.SignUps.All(item => item.ConfirmedAtUtc is not null));

        // Their own screens and the house's list both read the new one.
        var now = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((current.Id, true, "Saad-Khoury"), (now.Id, now.SelfDirected, now.LastName));
        Assert.AreEqual(current.Id, (await N9a1ClientsAsync(house.Owner)).Single().Id);
        Assert.AreEqual("Joined", (await N9a1StatusAsync(trainee.Client)).CallerSignUp);
    }

    [TestMethod]
    public async Task N9a1ATraineeWhoLeftWhileTheHouseHadBlockedThemCannotSignUpAgainByThemselves()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut: the house's week runs Monday the 9th to Monday the 16th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        const string email = "n9a1-blocked-trainee@example.test";
        using var house = await N9a1OpenHouseAsync("blocked");
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Jad", "Rizk");

        // The house's staff block the trainee's access, and the trainee leaves while it is blocked.
        var details = await RequiredJsonAsync<TeamClientDetails>(await house.Owner.GetAsync($"/api/clients/{trainee.ProfileId}"));
        await RefreshCsrfAsync(house.Owner);
        await AssertStatusAsync(
            await house.Owner.PostAsJsonAsync(
                $"/api/clients/{trainee.ProfileId}/relationship/block",
                new { reason = "N9a1 conduct in the gym", version = details.Version }),
            HttpStatusCode.OK);
        await N9a1LeaveAsync(trainee.Client, "Leaving");

        await N9a1AssertCannotComeBackAsync(house, trainee, email);
    }

    [TestMethod]
    public async Task N9a1ATraineeTheHousesOwnerReleasedCannotSignUpAgainByThemselves()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut: the house's week runs Monday the 9th to Monday the 16th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        const string email = "n9a1-released-trainee@example.test";
        using var house = await N9a1OpenHouseAsync("released");
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Maher", "Awad");

        // The owner ends the trainee's coaching (ADR 0027).
        var details = await RequiredJsonAsync<TeamClientDetails>(await house.Owner.GetAsync($"/api/clients/{trainee.ProfileId}"));
        await RefreshCsrfAsync(house.Owner);
        await AssertStatusAsync(
            await house.Owner.PostAsJsonAsync(
                $"/api/clients/{trainee.ProfileId}/release",
                new { reason = "N9a1 the house's rules", version = details.Version }),
            HttpStatusCode.OK);

        await N9a1AssertCannotComeBackAsync(house, trainee, email);
    }

    [TestMethod]
    public async Task N9a1ACoachRemovedFromTheHousesTeamCannotSignUpToTrainInIt()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut: the house's week runs Monday the 9th to Monday the 16th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        const string email = "n9a1-staff-coach@example.test";
        using var house = await N9a1OpenHouseAsync("staff", withCoach: true);
        var coach = house.Coach!;

        // On the team, the Coach is part of the house; removed from it, their one membership row is a team member's.
        var onTheTeam = await N9a1SignUpAsync(coach, email, "Lea", "Khoury", withPassword: false);
        Assert.AreEqual("trainee_already_joined", (await N9a1AnswerAsync(onTheTeam, HttpStatusCode.Conflict)).Code);
        await RemoveCoachForBillingAsync(house.Owner, house.CoachUserId!.Value);
        Assert.AreEqual((house.TenantId, "Coach", "Removed"), (await N9a1PersonAsync(email)).Memberships.Single());
        Assert.IsEmpty(await RequiredJsonAsync<N9a1Membership[]>(await coach.GetAsync("/api/tenants")));

        // That week and the next, signed in to the account they still have, the form is refused and nothing is made.
        foreach (var at in new[] { RequiredTestClock.UtcNow.AddHours(2), new DateTimeOffset(2026, 11, 15, 22, 30, 0, TimeSpan.Zero) })
        {
            RequiredTestClock.Set(at);
            var told = await N9a1StatusAsync(coach);
            Assert.AreEqual(("Open", (string?)null), (told.Status, told.CallerSignUp));
            var again = await N9a1SignUpAsync(coach, email, "Lea", "Khoury", withPassword: false);
            var refusal = await N9a1AnswerAsync(again, HttpStatusCode.Conflict);
            Assert.AreEqual("trainee_former_staff", refusal.Code);
            Assert.AreEqual(
                "You were on this coaching space's team, so you can't sign up to train in it. Talk to its owner.",
                refusal.Message);
            var still = await N9a1PersonAsync(email);
            Assert.AreEqual((house.TenantId, "Coach", "Removed"), still.Memberships.Single());
            Assert.IsEmpty(still.Profiles);
            Assert.IsEmpty(still.SignUps);
        }

        Assert.AreEqual(0, await N9a1ProfilesInAsync(house.TenantId));
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());
        Assert.IsEmpty(await N9a1ClientsAsync(house.Owner));
        Assert.Contains("A house sign-up was refused: former-staff.", RequiredEveryLogLine.Text);
    }

    // ---------- 7. tenancy and authorization ----------

    [TestMethod]
    public async Task N9a1ASignUpCarryingAnotherWorkspacesHeaderStillLandsInTheHouse()
    {
        using var house = await N9a1OpenHouseAsync("lands");
        using var coach = CreateClient();
        var coachesSpace = await RegisterCoachAsync(coach, "n9a1-lands-coach@example.test", "Omar Nasser", "N9a1 Lands Omar Gym");

        // A coach's coaching space named in the header, then a workspace that does not exist.
        foreach (var (email, header) in new[]
        {
            ("n9a1-lands-one@example.test", coachesSpace),
            ("n9a1-lands-two@example.test", Guid.NewGuid()),
        })
        {
            using var visitor = CreateClient();
            SetTenant(visitor, header);
            var response = await N9a1SignUpAsync(visitor, email);
            await AssertStatusAsync(response, HttpStatusCode.Accepted);
            Assert.AreEqual(house.TenantId, (await N9a1PersonAsync(email)).SignUps.Single().TenantId, email);
            var link = (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!;
            await AssertStatusAsync(await N9a1ConfirmAsync(visitor, link), HttpStatusCode.NoContent);

            var person = await N9a1PersonAsync(email);
            Assert.AreEqual((house.TenantId, "Client", "Active"), person.Memberships.Single(), email);
            Assert.AreEqual(house.TenantId, person.Profiles.Single().TenantId, email);

            // Signed in, the header they carried opens nothing: they are nobody there.
            await N9a1SignInAsync(visitor, email);
            await AssertStatusAsync(await visitor.GetAsync("/api/client-profile/me"), HttpStatusCode.Forbidden);
            Assert.AreEqual(house.TenantId, (await RequiredJsonAsync<N9a1Membership[]>(await visitor.GetAsync("/api/tenants"))).Single().TenantId);
        }

        Assert.IsEmpty(await N9a1ClientsAsync(coach), "The coach's coaching space gained nobody.");
        Assert.AreEqual(0, await N9a1ProfilesInAsync(coachesSpace));
        Assert.AreEqual(2, await N9a1ProfilesInAsync(house.TenantId));
        Assert.HasCount(2, await N9a1ClientsAsync(house.Owner));
    }

    /// <summary>
    /// Every route behind the TenantCoach, TenantOwner or PlatformAdmin policy, asked by a trainee of the house with
    /// the house's own header and a well-formed request. The write limits are counted per person before the policy
    /// is read, so the walk changes trainee before one runs out.
    /// </summary>
    [TestMethod]
    public async Task N9a1AHouseTraineeIsRefusedByEveryStaffAndPlatformAdminRoute()
    {
        using var house = await N9a1OpenHouseAsync("walk", withCoach: true);
        var routes = A10bApiRoutes()
            .Where(route => route.Metadata.GetOrderedMetadata<IAuthorizeData>().Any(data => data.Policy is { } policy && N9a1StaffPolicies.Contains(policy)))
            .OrderBy(route => route.RoutePattern.RawText, StringComparer.Ordinal)
            .ThenBy(A10bName, StringComparer.Ordinal)
            .ToArray();
        Assert.IsGreaterThanOrEqualTo(150, routes.Length, "The walk found too few staff routes to be checking the API.");
        foreach (var name in new[] { "GetHouse", "ChangeHouseSetting", "ListClients", "UpdateCurrentWorkspace" })
        {
            Assert.IsTrue(routes.Any(route => A10bName(route) == name), $"{name} is not behind a staff policy.");
        }

        // Each write limit, with room to spare: 60 sensitive and 300 routine writes a minute, 10 uploads an hour.
        var allowances = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            [RateLimitPolicies.SensitiveWrite] = 50,
            [RateLimitPolicies.RoutineWrite] = 250,
            [RateLimitPolicies.MediaUpload] = 8,
        };
        var spent = new Dictionary<string, int>(StringComparer.Ordinal);
        var trainees = new List<N9a1Trainee>();
        try
        {
            async Task<HttpClient> NextTraineeAsync()
            {
                var number = trainees.Count + 1;
                trainees.Add(await N9a1TraineeAsync(
                    house.TenantId,
                    $"n9a1-walk-{number}@example.test",
                    address: $"198.51.100.{100 + number}"));
                spent.Clear();
                return trainees[^1].Client;
            }

            var trainee = await NextTraineeAsync();
            var answers = new List<(string Route, HttpStatusCode Status)>();
            foreach (var route in routes)
            {
                foreach (var method in route.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [])
                {
                    if (A10bPolicy(route) is { } policy && allowances.TryGetValue(policy, out var allowance))
                    {
                        if (spent.GetValueOrDefault(policy) >= allowance)
                        {
                            trainee = await NextTraineeAsync();
                        }

                        spent[policy] = spent.GetValueOrDefault(policy) + 1;
                    }

                    await RefreshCsrfAsync(trainee);
                    using var request = new HttpRequestMessage(new HttpMethod(method), N9a1UrlFor(route));
                    if (method is not ("GET" or "DELETE" or "HEAD"))
                    {
                        // An upload route is matched by its content type before any policy is read.
                        var accepts = route.Metadata.GetMetadata<IAcceptsMetadata>()?.ContentTypes ?? [];
                        request.Content = accepts.Any(type => type.StartsWith("multipart/", StringComparison.OrdinalIgnoreCase))
                            ? N9a1Upload()
                            : JsonContent.Create(new { });
                    }

                    using var response = await trainee.SendAsync(request);
                    answers.Add(($"{method} {route.RoutePattern.RawText} ({A10bName(route)})", response.StatusCode));
                }
            }

            TestContext.WriteLine($"{routes.Length} staff routes asked in {answers.Count} requests by {trainees.Count} trainees.");
            Assert.IsGreaterThanOrEqualTo(routes.Length, answers.Count);
            var let = answers
                .Where(answer => answer.Status is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound))
                .Select(answer => $"{answer.Route}: {(int)answer.Status}")
                .ToArray();
            Assert.IsEmpty(let, $"A house trainee was not refused by: {string.Join("; ", let)}");

            // A trainee is a member of the house, so the policy itself answers: 403, never a route that was not found.
            var notForbidden = answers
                .Where(answer => answer.Status != HttpStatusCode.Forbidden)
                .Select(answer => $"{answer.Route}: {(int)answer.Status}")
                .ToArray();
            Assert.IsEmpty(notForbidden, $"Answered otherwise than 403: {string.Join("; ", notForbidden)}");
        }
        finally
        {
            foreach (var one in trainees)
            {
                one.Dispose();
            }
        }

        // And nothing they asked for happened: the house and its settings stand as they were.
        var status = await N9a1StatusAsync(house.Owner);
        Assert.AreEqual(("Open", house.Name, (int?)19), (status.Status, status.WorkspaceName, status.MinimumAge));
        Assert.IsEmpty(await RequiredJsonAsync<JsonElement[]>(await house.Owner.GetAsync("/api/clients/former")));
    }

    [TestMethod]
    public async Task N9a1ATraineeIsKeptInsideTheHouseAndOnlyThePlatformAdminReachesItsSettings()
    {
        using var house = await N9a1OpenHouseAsync("kept", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-kept-trainee@example.test");
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9a1-kept-other@example.test", "Omar Nasser", "N9a1 Kept Omar Gym");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(otherOwner, otherCoach, "n9a1-kept-other-coach@example.test", "Lea Khoury");

        // Under another coaching space's header a trainee is nobody: their own screens and the staff's alike.
        SetTenant(trainee.Client, otherSpace);
        foreach (var url in new[] { "/api/client-profile/me", "/api/workspace", "/api/clients", "/api/training/me/today", $"/api/clients/{trainee.ProfileId}" })
        {
            await AssertStatusAsync(await trainee.Client.GetAsync(url), HttpStatusCode.Forbidden);
        }

        await RefreshCsrfAsync(trainee.Client);
        await AssertStatusAsync(
            await trainee.Client.PostAsJsonAsync("/api/client-profile/me/leave", new { reason = "x", version = 1 }),
            HttpStatusCode.Forbidden);
        SetTenant(trainee.Client, house.TenantId);
        await AssertStatusAsync(await trainee.Client.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);

        // Another coaching space's staff find no such client, by its id or on any list.
        foreach (var staff in new[] { otherOwner, otherCoach })
        {
            await AssertStatusAsync(await staff.GetAsync($"/api/clients/{trainee.ProfileId}"), HttpStatusCode.NotFound);
            await AssertStatusAsync(await staff.GetAsync($"/api/clients/{trainee.ProfileId}/overview"), HttpStatusCode.NotFound);
            Assert.IsEmpty(await N9a1ClientsAsync(staff));
        }

        await AssertStatusAsync(await otherOwner.GetAsync($"/api/clients/{trainee.ProfileId}/coach-assignments"), HttpStatusCode.NotFound);
        Assert.IsEmpty(await RequiredJsonAsync<JsonElement[]>(await otherOwner.GetAsync("/api/clients/former")));

        // The house's settings: nobody signed in is 401, and no member of any coaching space reaches them.
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(N9a1HouseUrl), HttpStatusCode.Unauthorized);
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(
            await anonymous.PutAsJsonAsync($"{N9a1HouseUrl}/settings/{N9a1PlacesSetting}", new { value = "5", expectedVersion = 1 }),
            HttpStatusCode.Unauthorized);
        foreach (var caller in new[] { house.Owner, house.Coach!, trainee.Client, otherOwner })
        {
            await AssertStatusAsync(await caller.GetAsync(N9a1HouseUrl), HttpStatusCode.Forbidden);
            await RefreshCsrfAsync(caller);
            foreach (var setting in new[] { N9a1PlacesSetting, N9a1AgeSetting })
            {
                await AssertStatusAsync(
                    await caller.PutAsJsonAsync($"{N9a1HouseUrl}/settings/{setting}", new { value = "55", expectedVersion = 1 }),
                    HttpStatusCode.Forbidden);
            }
        }

        // Nothing moved: the admin reads both settings at their first change.
        var read = await RequiredJsonAsync<N9a1AdminView>(await house.Admin.GetAsync(N9a1HouseUrl));
        Assert.AreEqual(house.TenantId, read.House!.TenantId);
        Assert.AreEqual((N9a1Places, 1), (read.Settings.Single(item => item.Setting == N9a1PlacesSetting).Value, read.Settings.Single(item => item.Setting == N9a1PlacesSetting).Version));
        Assert.AreEqual((N9a1Age, 1), (read.Settings.Single(item => item.Setting == N9a1AgeSetting).Value, read.Settings.Single(item => item.Setting == N9a1AgeSetting).Version));
    }

    // ---------- 8. legal documents ----------

    [TestMethod]
    public async Task N9a1TheConsumerTermsAreAskedOnlyAtAHouseSignUpAndKeptWithTheAccount()
    {
        using var house = await N9a1OpenHouseAsync("legal");
        var terms = await A16aPublishAsync(house.Admin, "TermsOfService", "Platform", "n9a1-1", null);
        var privacy = await A16aPublishAsync(house.Admin, "PrivacyPolicy", "Workspace", "n9a1-1", null);
        var consumer = await A16aPublishAsync(house.Admin, "ConsumerTerms", "Workspace", "n9a1-1", null);
        var health = await A16aPublishAsync(house.Admin, "HealthIntakeConsent", "Workspace", "n9a1-1", null);

        // A house trainee is asked the Terms, the Privacy Policy and the consumer terms, never the health consent;
        // nobody else is ever asked the consumer terms.
        using var visitor = CreateClient();
        CollectionAssert.AreEqual(
            new[] { terms.Id, privacy.Id, consumer.Id },
            (await A16aToAcceptAsync(visitor, "Trainee")).Select(item => item.Id).ToArray());
        CollectionAssert.AreEqual(new[] { terms.Id, privacy.Id }, (await A16aToAcceptAsync(visitor, "Owner")).Select(item => item.Id).ToArray());
        CollectionAssert.AreEqual(new[] { terms.Id, privacy.Id }, (await A16aToAcceptAsync(visitor, "Coach")).Select(item => item.Id).ToArray());
        CollectionAssert.AreEqual(
            new[] { terms.Id, privacy.Id, health.Id },
            (await A16aToAcceptAsync(visitor, "Client")).Select(item => item.Id).ToArray());

        // Naming none, leaving the consumer terms out, or adding the health consent is refused, and no account is made.
        const string email = "n9a1-legal-trainee@example.test";
        foreach (var ids in new Guid[]?[] { null, [], [terms.Id, privacy.Id], [terms.Id, privacy.Id, consumer.Id, health.Id] })
        {
            var refused = await N9a1SignUpAsync(visitor, email, legalDocumentIds: ids);
            Assert.AreEqual("legal_acceptance_required", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code);
        }

        Assert.AreEqual(0, await N9a1AccountsAsync(email));
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());

        // Named, they are kept with the account as it signs up: the Terms for the platform, the house's two for the house.
        var response = await N9a1SignUpAsync(visitor, email, legalDocumentIds: [terms.Id, privacy.Id, consumer.Id]);
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var houseKey = house.TenantId.ToString("N");
        var kept = new[]
        {
            (terms.Id, "platform", (Guid?)null),
            (privacy.Id, houseKey, (Guid?)house.TenantId),
            (consumer.Id, houseKey, (Guid?)house.TenantId),
        };
        CollectionAssert.AreEquivalent(kept, await A16aAcceptancesAsync(email));
        await AssertStatusAsync(
            await N9a1ConfirmAsync(visitor, (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        CollectionAssert.AreEquivalent(kept, await A16aAcceptancesAsync(email), "The confirmation records nothing twice.");

        // The trainee reads the consumer terms among the house's documents, accepted.
        await N9a1SignInAsync(visitor, email);
        var theirs = await RequiredJsonAsync<N9a1LegalDocument[]>(
            await visitor.GetAsync($"/api/legal/documents/current?workspaceId={house.TenantId}"));
        Assert.IsTrue(theirs.Single(item => item.Kind == "ConsumerTerms").IsAccepted);

        // A coach's registration naming the consumer terms is refused; without them it goes through.
        using var coach = CreateClient();
        var named = await A16aRegisterAsync(coach, "n9a1-legal-coach@example.test", [terms.Id, privacy.Id, consumer.Id]);
        Assert.AreEqual("legal_acceptance_required", (await A16aAnswerAsync(named, HttpStatusCode.Conflict)).Code);
        Assert.AreEqual(0, await N9a1AccountsAsync("n9a1-legal-coach@example.test"));
        var coachesSpace = await RegisterCoachAsync(coach, "n9a1-legal-coach@example.test", "Zeina Aoun", "N9a1 Legal Zeina Gym", [terms.Id, privacy.Id]);

        // A coach is never shown the consumer terms, in their own space or naming the house, and cannot accept them.
        foreach (var workspaceId in new Guid?[] { null, coachesSpace, house.TenantId })
        {
            var shown = await RequiredJsonAsync<N9a1LegalDocument[]>(await coach.GetAsync(
                workspaceId is null ? "/api/legal/documents/current" : $"/api/legal/documents/current?workspaceId={workspaceId}"));
            Assert.IsNotEmpty(shown);
            Assert.IsFalse(shown.Any(item => item.Kind == "ConsumerTerms"), $"Shown with workspace {workspaceId}.");
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(
                await coach.PostAsJsonAsync("/api/legal/consents", new { documentVersionId = consumer.Id, tenantId = workspaceId }),
                HttpStatusCode.NotFound);
        }

        // That account already accepted the Terms for the platform: signing up into the house, it is asked only the
        // house's own two documents.
        CollectionAssert.AreEqual(
            new[] { privacy.Id, consumer.Id },
            (await A16aToAcceptAsync(coach, "Trainee")).Select(item => item.Id).ToArray());
        foreach (var ids in new Guid[][] { [], [privacy.Id] })
        {
            var refused = await N9a1SignUpAsync(coach, "n9a1-legal-coach@example.test", withPassword: false, legalDocumentIds: ids);
            Assert.AreEqual("legal_acceptance_required", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code);
        }

        Assert.IsEmpty((await N9a1PersonAsync("n9a1-legal-coach@example.test")).SignUps);
        await AssertStatusAsync(
            await N9a1SignUpAsync(coach, "n9a1-legal-coach@example.test", withPassword: false, legalDocumentIds: [privacy.Id, consumer.Id]),
            HttpStatusCode.OK);
        var coachesKey = coachesSpace.ToString("N");
        CollectionAssert.AreEquivalent(
            new[]
            {
                (terms.Id, "platform", (Guid?)null),
                (privacy.Id, coachesKey, (Guid?)coachesSpace),
                (privacy.Id, houseKey, (Guid?)house.TenantId),
                (consumer.Id, houseKey, (Guid?)house.TenantId),
            },
            await A16aAcceptancesAsync("n9a1-legal-coach@example.test"));
    }

    // ---------- 9. the log ----------

    [TestMethod]
    public async Task N9a1NoEmailNameDateOfBirthOrHoneypotValueOfASignUpReachesALogLine()
    {
        // A Wednesday morning in Beirut: the week's two places below are both of one week.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        using var house = await N9a1OpenHouseAsync("log", signUpsPerWeek: "2");
        using var known = CreateClient();
        await RegisterCoachAsync(known, "n9a1-log-known@example.test", "Hadi Farah", "N9a1 Log Hadi Gym");
        using var visitor = CreateClient();

        // A sign-up that is taken, confirmed and signed in.
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-log-zephyr@example.test", "Zephyrine", "Quillfeather", "1993-07-21");

        // Refusals of every kind, each with words of its own.
        var stamp = (await N9a1StatusAsync(visitor)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));
        await AssertStatusAsync(
            await N9a1PostAsync(visitor, N9a1Body("n9a1-log-decoy@example.test", stamp, "Marzipan", "Thistlewood", "1989-09-19", website: "https://n9a1-log-lure.example/win")),
            HttpStatusCode.Accepted);
        await AssertStatusAsync(
            await N9a1PostAsync(visitor, N9a1Body("n9a1-log-young@example.test", stamp, "Peregrine", "Ashdown", "2012-04-06")),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await N9a1PostAsync(visitor, N9a1Body("n9a1-log-nostamp@example.test", "forged", "Ottoline", "Brackenridge", "1987-05-13")),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await N9a1PostAsync(visitor, N9a1Body("n9a1-log-weak@example.test", stamp, "Isambard", "Fotheringay", "1985-10-27", password: "weak")),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await N9a1PostAsync(visitor, N9a1Body("n9a1-log-known@example.test", stamp, "Clementine", "Wetherby", "1984-12-02")),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await N9a1PostAsync(known, N9a1Body("n9a1-log-other@example.test", stamp, "Barnaby", "Ravenscroft", "1983-03-08", withPassword: false)),
            HttpStatusCode.Forbidden);
        // A sign-up that waits holds no place; a second person who joins signed in takes the week's last, and the
        // next is told it is full.
        await AssertStatusAsync(await N9a1PostAsync(visitor, N9a1Body("n9a1-log-waits@example.test", stamp, "Seraphina", "Holloway", "1992-06-18")), HttpStatusCode.Accepted);
        await AssertStatusAsync(await N9a1PostAsync(known, N9a1Body("n9a1-log-known@example.test", stamp, "Hadi", "Fairweather", "1986-08-11", withPassword: false)), HttpStatusCode.OK);
        var full = await N9a1PostAsync(visitor, N9a1Body("n9a1-log-full@example.test", stamp, "Leopold", "Winterbourne", "1981-01-24"));
        Assert.AreEqual("trainee_sign_up_full", (await N9a1AnswerAsync(full, HttpStatusCode.Conflict)).Code);
        // And the one who joined, sending the form once more, is told they are part of the house.
        var twice = await N9a1PostAsync(known, N9a1Body("n9a1-log-known@example.test", stamp, "Hadi", "Fairweather", "1986-08-11", withPassword: false));
        Assert.AreEqual("trainee_already_joined", (await N9a1AnswerAsync(twice, HttpStatusCode.Conflict)).Code);

        var log = RequiredEveryLogLine.Text;
        foreach (var secret in new[]
        {
            "n9a1-log-zephyr", "n9a1-log-decoy", "n9a1-log-young", "n9a1-log-nostamp", "n9a1-log-weak", "n9a1-log-known", "n9a1-log-other", "n9a1-log-waits",
            "n9a1-log-full",
            "Zephyrine", "Quillfeather", "Marzipan", "Thistlewood", "Peregrine", "Ashdown", "Ottoline", "Brackenridge", "Isambard", "Fotheringay",
            "Clementine", "Wetherby", "Barnaby", "Ravenscroft", "Seraphina", "Holloway", "Fairweather", "Leopold", "Winterbourne",
            "1993-07-21", "1989-09-19", "2012-04-06", "1987-05-13", "1985-10-27", "1984-12-02", "1983-03-08", "1992-06-18", "1986-08-11", "1981-01-24",
            "07/21/1993", "21/07/1993", "7/21/1993", "04/06/2012", "06/04/2012", "4/6/2012",
            "n9a1-log-lure",
        })
        {
            Assert.DoesNotContain(secret, log, StringComparison.OrdinalIgnoreCase, $"The log holds '{secret}'.");
        }

        // What the log does say: a reason code, or an id.
        foreach (var reason in new[] { "honeypot", "age", "stamp-invalid", "validation", "existing-account", "wrong-account", "full", "already-joined" })
        {
            Assert.Contains($"A house sign-up was refused: {reason}.", log);
        }

        var stored = (await N9a1PersonAsync("n9a1-log-zephyr@example.test")).SignUps.Single();
        Assert.Contains($"House sign-up {stored.Id} was stored.", log);
    }

    // ---------- helpers the next rows reuse ----------

    /// <summary>
    /// A house that takes sign-ups: its owner registers, a Coach joins its team when asked, the space is marked as the
    /// house by the platform-admin command, and a platform admin fills both settings. A null setting is left empty.
    /// </summary>
    private async Task<N9a1House> N9a1OpenHouseAsync(
        string tag,
        bool withCoach = false,
        string? signUpsPerWeek = N9a1Places,
        string? minimumAge = N9a1Age)
    {
        var name = $"N9a1 {tag} House";
        var owner = CreateClient();
        var tenantId = await RegisterCoachAsync(owner, $"n9a1-{tag}-owner@example.test", "Nour Haddad", name);
        HttpClient? coach = null;
        Guid? coachUserId = null;
        if (withCoach)
        {
            coach = CreateClient();
            coachUserId = await JoinAsCoachAsync(owner, coach, $"n9a1-{tag}-coach@example.test", "Lea Khoury");
        }

        await N9a1MarkHouseAsync(owner, tenantId);
        var admin = await SignInPlatformAdminAsync($"n9a1-{tag}-admin@example.test");
        if (signUpsPerWeek is not null)
        {
            await N9a1SettingAsync(admin, N9a1PlacesSetting, signUpsPerWeek);
        }

        if (minimumAge is not null)
        {
            await N9a1SettingAsync(admin, N9a1AgeSetting, minimumAge);
        }

        return new N9a1House(owner, coach, admin, tenantId, name, await N9a1UserIdAsync(owner), coachUserId);
    }

    /// <summary>Marks a member's coaching space as the house, by its slug, as whoever runs the deployment does.</summary>
    private async Task N9a1MarkHouseAsync(HttpClient member, Guid tenantId)
    {
        var spaces = await RequiredJsonAsync<N9a1Membership[]>(await member.GetAsync("/api/tenants"));
        var output = new StringWriter();
        Assert.AreEqual(
            0,
            await RunPlatformAdminCommandAsync(output, "house", "set", spaces.Single(item => item.TenantId == tenantId).TenantSlug),
            output.ToString());
    }

    /// <summary>One change of one house setting by the platform admin; null empties it.</summary>
    private static async Task<N9a1Setting> N9a1SettingAsync(HttpClient admin, string setting, string? value)
    {
        var read = await RequiredJsonAsync<N9a1AdminView>(await admin.GetAsync(N9a1HouseUrl));
        await RefreshCsrfAsync(admin);
        var response = await admin.PutAsJsonAsync(
            $"{N9a1HouseUrl}/settings/{setting}",
            new { value, expectedVersion = read.Settings.Single(item => item.Setting == setting).Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N9a1Setting>(response);
    }

    /// <summary>What the public page reads before it shows a form.</summary>
    private static async Task<N9a1Status> N9a1StatusAsync(HttpClient client)
    {
        var response = await client.GetAsync(N9a1SignUpUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        Assert.IsTrue(response.Headers.CacheControl is { NoStore: true }, "The sign-up status must never be cached.");
        return await RequiredJsonAsync<N9a1Status>(response);
    }

    /// <summary>
    /// Sends the sign-up form as a person does: the stamp the page was handed (or <paramref name="formStamp"/>), five
    /// seconds on the clock, then the post. Someone signed in sends no password.
    /// </summary>
    private async Task<HttpResponseMessage> N9a1SignUpAsync(
        HttpClient client,
        string email,
        string firstName = "Dalia",
        string lastName = "Mansour",
        string? birthDate = N9a1BirthDate,
        bool withPassword = true,
        Guid[]? legalDocumentIds = null,
        string? formStamp = null)
    {
        var stamp = formStamp ?? (await N9a1StatusAsync(client)).FormStamp;
        RequiredTestClock.Advance(TimeSpan.FromSeconds(5));
        return await N9a1PostAsync(
            client,
            N9a1Body(email, stamp, firstName, lastName, birthDate, withPassword: withPassword, legalDocumentIds: legalDocumentIds));
    }

    /// <summary>The form's post with the antiforgery token, whatever the body.</summary>
    private static async Task<HttpResponseMessage> N9a1PostAsync(HttpClient client, object body)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(N9a1SignUpUrl, body);
    }

    private static object N9a1Body(
        string email,
        string? formStamp,
        string firstName = "Dalia",
        string lastName = "Mansour",
        string? birthDate = N9a1BirthDate,
        string? password = null,
        bool withPassword = true,
        Guid[]? legalDocumentIds = null,
        string? website = null) => new
        {
            firstName,
            lastName,
            email,
            birthDate,
            password = password ?? (withPassword ? Password : null),
            formStamp,
            website,
            legalDocumentIds,
        };

    /// <summary>Taps the development confirmation link: its account and code, posted as the page does.</summary>
    private static async Task<HttpResponseMessage> N9a1ConfirmAsync(HttpClient client, string confirmationUrl)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync("/api/auth/confirm-email", N9a1ConfirmationBody(confirmationUrl));
    }

    /// <summary>What the confirmation page posts: the account and the code its link carries.</summary>
    private static object N9a1ConfirmationBody(string confirmationUrl) => new
    {
        userId = Guid.Parse(QueryValue(confirmationUrl, "userId")),
        code = QueryValue(confirmationUrl, "code"),
    };

    private static async Task N9a1SignInAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password, rememberMe = false }),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// A trainee of the house: signed up, confirmed and signed in, with the house's header set. A distinct
    /// <paramref name="address"/> keeps a test that makes many of them inside the per-address limits.
    /// </summary>
    private async Task<N9a1Trainee> N9a1TraineeAsync(
        Guid houseId,
        string email,
        string firstName = "Dalia",
        string lastName = "Mansour",
        string birthDate = N9a1BirthDate,
        Guid[]? legalDocumentIds = null,
        string? address = null)
    {
        var client = CreateClient();
        if (address is not null)
        {
            client.DefaultRequestHeaders.Add("X-Test-Remote-Ip", address);
        }

        var response = await N9a1SignUpAsync(client, email, firstName, lastName, birthDate, legalDocumentIds: legalDocumentIds);
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var answer = await RequiredJsonAsync<N9a1Answer>(response);
        await AssertStatusAsync(await N9a1ConfirmAsync(client, answer.DevelopmentConfirmationUrl!), HttpStatusCode.NoContent);
        await N9a1SignInAsync(client, email);
        SetTenant(client, houseId);
        var self = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
        Assert.IsTrue(self.SelfDirected);
        return new N9a1Trainee(client, self.Id, await N9a1UserIdAsync(client));
    }

    private static async Task<Guid> N9a1UserIdAsync(HttpClient client) =>
        (await RequiredJsonAsync<JsonElement>(await client.GetAsync("/api/auth/me"))).GetProperty("id").GetGuid();

    private static async Task<N9a1Client[]> N9a1ClientsAsync(HttpClient staff) =>
        await RequiredJsonAsync<N9a1Client[]>(await staff.GetAsync("/api/clients"));

    private static async Task<N9a1Answer> N9a1AnswerAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        await AssertStatusAsync(response, status);
        return await RequiredJsonAsync<N9a1Answer>(response);
    }

    /// <summary>The closed read tells nothing but that it is closed, and a whole form is refused and kept nowhere.</summary>
    private async Task N9a1AssertClosedAsync(HttpClient visitor, string email, string because)
    {
        var response = await visitor.GetAsync(N9a1SignUpUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        Assert.IsTrue(response.Headers.CacheControl is { NoStore: true }, because);
        var read = await RequiredJsonAsync<JsonElement>(response);
        Assert.AreEqual("Closed", read.GetProperty("status").GetString(), because);
        foreach (var property in read.EnumerateObject().Where(item => item.Name != "status"))
        {
            Assert.AreEqual(JsonValueKind.Null, property.Value.ValueKind, $"While {because}, the read tells {property.Name}.");
        }

        var refused = await N9a1SignUpAsync(visitor, email);
        Assert.AreEqual("trainee_sign_up_closed", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code, because);
        Assert.AreEqual(0, await N9a1AccountsAsync(email), because);
        Assert.AreEqual(0, await N9a1SignUpRowsAsync(), because);
    }

    /// <summary>The signed-in client leaves the coaching space their header names (ADR 0027).</summary>
    private static async Task N9a1LeaveAsync(HttpClient client, string reason)
    {
        var self = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/client-profile/me/leave", new { reason, version = self.Version }),
            HttpStatusCode.NoContent);
    }

    /// <summary>
    /// A former trainee whose coaching the house ended, or who left while the house had blocked their access (CLI-016):
    /// still signed in to their account, the form is refused in the endpoint's own sentence and nothing is made of
    /// it. Asked two hours on, in the house week they signed up in, where the refusal must come before the
    /// once-a-week one; then in the next week and in the one after that.
    /// </summary>
    private async Task N9a1AssertCannotComeBackAsync(N9a1House house, N9a1Trainee trainee, string email)
    {
        var gone = await N9a1PersonAsync(email);
        Assert.AreEqual((house.TenantId, "Client", "Removed"), gone.Memberships.Single());
        Assert.AreEqual(trainee.ProfileId, gone.Profiles.Single().Id);
        Assert.IsNotNull(gone.Profiles.Single().ReleasedAtUtc);
        Assert.IsEmpty(await RequiredJsonAsync<N9a1Membership[]>(await trainee.Client.GetAsync("/api/tenants")));

        foreach (var at in new[]
        {
            RequiredTestClock.UtcNow.AddHours(2),
            new DateTimeOffset(2026, 11, 15, 22, 30, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 11, 25, 9, 0, 0, TimeSpan.Zero),
        })
        {
            RequiredTestClock.Set(at);
            var told = await N9a1StatusAsync(trainee.Client);
            Assert.AreEqual(("Open", (string?)null), (told.Status, told.CallerSignUp), $"{at:u}");
            var again = await N9a1SignUpAsync(trainee.Client, email, withPassword: false);
            var refusal = await N9a1AnswerAsync(again, HttpStatusCode.Conflict);
            Assert.AreEqual("trainee_sign_up_not_available", refusal.Code, $"{at:u}");
            Assert.AreEqual(
                "This coaching space ended your coaching or blocked your access, so you can't sign up again by yourself. Ask it to invite you back.",
                refusal.Message);
            Assert.IsNull(refusal.OpensAgainOn, "No day is named: no week brings them back.");
            var still = await N9a1PersonAsync(email);
            Assert.AreEqual((house.TenantId, "Client", "Removed"), still.Memberships.Single(), $"{at:u}: the membership stays ended.");
            Assert.AreEqual(gone.Profiles.Single(), still.Profiles.Single(), $"{at:u}: no new profile, and the ended one as it was.");
            Assert.AreEqual(gone.SignUps.Single(), still.SignUps.Single(), $"{at:u}: no new sign-up row.");
        }

        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
        Assert.IsEmpty(await N9a1ClientsAsync(house.Owner));
        Assert.Contains("A house sign-up was refused: ended-by-the-house.", RequiredEveryLogLine.Text);
    }

    private static object N9a1ContactBody(string? formStamp) => new
    {
        name = "Rami Tabet",
        gymName = "Oakline Strength",
        contact = "rami@example.test",
        message = "Six coaches.",
        website = string.Empty,
        formStamp,
    };

    /// <summary>The house's calendar day at the test clock's instant: Beirut, as every test workspace is.</summary>
    private DateOnly N9a1HouseToday() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            RequiredTestClock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")).DateTime);

    private static string N9a1Day(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The route with every parameter given a value its constraint takes.</summary>
    private static string N9a1UrlFor(RouteEndpoint route)
    {
        var url = new StringBuilder();
        foreach (var segment in route.RoutePattern.PathSegments)
        {
            url.Append('/');
            foreach (var part in segment.Parts)
            {
                url.Append(part switch
                {
                    RoutePatternLiteralPart literal => literal.Content,
                    RoutePatternSeparatorPart separator => separator.Content,
                    RoutePatternParameterPart parameter => N9a1ValueFor(parameter),
                    _ => throw new AssertFailedException($"{route.RoutePattern.RawText} has a part the walk cannot fill."),
                });
            }
        }

        return url.ToString();
    }

    /// <summary>A well-formed upload: one small JPEG under the field the upload routes read.</summary>
    private static MultipartFormDataContent N9a1Upload()
    {
        var file = new ByteArrayContent(JpegBytes);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        return new MultipartFormDataContent { { new StringContent("Walk"), "title" }, { file, "file", "walk.jpg" } };
    }

    private static string N9a1ValueFor(RoutePatternParameterPart parameter)
    {
        var constraints = parameter.ParameterPolicies.Select(policy => policy.Content ?? string.Empty).ToArray();
        if (constraints.Any(constraint =>
                constraint is "int" or "long" ||
                constraint.StartsWith("min(", StringComparison.Ordinal) ||
                constraint.StartsWith("range(", StringComparison.Ordinal)))
        {
            return "1";
        }

        if (constraints.Contains("bool"))
        {
            return "true";
        }

        if (constraints.Contains("datetime"))
        {
            return "2026-11-11";
        }

        // A guid, which an unconstrained parameter takes too: the policy answers before anything is bound.
        return Guid.NewGuid().ToString();
    }

    // ---------- what is stored ----------

    private async Task<int> N9a1AccountsAsync(params string[] emails)
    {
        var normalized = emails.Select(email => email.Trim().ToUpperInvariant()).ToArray();
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.Users.AsNoTracking().CountAsync(user => normalized.Contains(user.NormalizedEmail));
    }

    private async Task<int> N9a1SignUpRowsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.TraineeSignUps.IgnoreQueryFilters().AsNoTracking().CountAsync();
    }

    private async Task<int> N9a1ProfilesInAsync(Guid tenantId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ClientProfiles.IgnoreQueryFilters().AsNoTracking().CountAsync(profile => profile.TenantId == tenantId);
    }

    /// <summary>Everything the database holds of one person's sign-up, read past every tenant filter.</summary>
    private async Task<N9a1Person> N9a1PersonAsync(string email)
    {
        var normalized = email.Trim().ToUpperInvariant();
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var user = await context.Users.AsNoTracking().SingleOrDefaultAsync(item => item.NormalizedEmail == normalized);
        if (user is null)
        {
            return new N9a1Person(null, false, [], [], [], [], []);
        }

        var userId = user.Id;
        var signUps = await context.TraineeSignUps.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.UserId == userId)
            .OrderBy(item => item.RequestedAtUtc)
            .ToListAsync();
        var memberships = await context.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.UserId == userId)
            .ToListAsync();
        var profiles = await context.ClientProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.UserId == userId)
            .ToListAsync();
        var profileIds = profiles.Select(item => item.Id).ToArray();
        var assignments = await context.ClientCoachAssignments.IgnoreQueryFilters().AsNoTracking()
            .Where(item => profileIds.Contains(item.ClientProfileId))
            .OrderBy(item => item.Sequence)
            .ToListAsync();
        var changes = await context.ClientProfileChanges.IgnoreQueryFilters().AsNoTracking()
            .Where(item => profileIds.Contains(item.ClientProfileId))
            .ToListAsync();
        return new N9a1Person(
            userId,
            user.EmailConfirmed,
            [.. signUps.Select(item => new N9a1SignUpRow(
                item.Id,
                item.TenantId,
                item.FirstName,
                item.LastName,
                item.BirthDate,
                item.ConfirmedAtUtc,
                item.ClientProfileId))],
            [.. memberships.Select(item => (item.TenantId, item.Role.ToString(), item.Status.ToString()))],
            [.. profiles.Select(item => new N9a1ProfileRow(
                item.Id,
                item.TenantId,
                item.AssignedCoachUserId,
                item.FirstName,
                item.LastName,
                item.Email,
                item.BirthDate,
                item.IsSelfDirected,
                item.ReleasedAtUtc))],
            [.. assignments.Select(item => (item.ClientProfileId, item.Sequence, item.CoachUserId, item.PreviousCoachUserId, item.Reason.ToString()))],
            [.. changes.Select(item => (item.ClientProfileId, item.Source.ToString()))]);
    }

    private sealed record N9a1House(
        HttpClient Owner,
        HttpClient? Coach,
        HttpClient Admin,
        Guid TenantId,
        string Name,
        Guid OwnerUserId,
        Guid? CoachUserId) : IDisposable
    {
        public void Dispose()
        {
            Owner.Dispose();
            Coach?.Dispose();
            Admin.Dispose();
        }
    }

    private sealed record N9a1Trainee(HttpClient Client, Guid ProfileId, Guid UserId) : IDisposable
    {
        public void Dispose() => Client.Dispose();
    }

    /// <param name="CallerSignUp">For someone signed in: "Joined", "Waiting", or nothing to say.</param>
    private sealed record N9a1Status(
        string Status,
        string? WorkspaceName,
        string? TimeZoneId,
        int? MinimumAge,
        DateOnly? OpensAgainOn,
        string? FormStamp,
        string? CallerSignUp);

    /// <summary>Any answer of the sign-up route: the accepted body, or a refusal's code with what it carries.</summary>
    private sealed record N9a1Answer(
        string? Code,
        string? Message,
        string? Email,
        string? DevelopmentConfirmationUrl,
        bool? EmailAvailable,
        bool? Joined,
        int? MinimumAge,
        DateOnly? OpensAgainOn);

    private sealed record N9a1Problem(Dictionary<string, string[]> Errors);

    private sealed record N9a1Membership(Guid TenantId, string TenantName, string TenantSlug, string Role);

    private sealed record N9a1Workspace(string Name, string TimeZoneId, string DefaultCulture, string DefaultCurrencyCode, uint Version);

    private sealed record N9a1Self(
        Guid Id,
        string FirstName,
        string LastName,
        string Email,
        DateOnly? BirthDate,
        uint Version,
        bool SelfDirected);

    private sealed record N9a1Client(Guid Id, string FirstName, string LastName, string Email, Guid AssignedCoachUserId);

    private sealed record N9a1Assignment(int Sequence, Guid CoachUserId, Guid? PreviousCoachUserId, string Reason);

    private sealed record N9a1LegalDocument(Guid Id, string Kind, string Context, bool IsAccepted);

    private sealed record N9a1AdminView(N9a1AdminHouse? House, N9a1Setting[] Settings);

    private sealed record N9a1AdminHouse(Guid TenantId, string Name, string Slug);

    private sealed record N9a1Setting(string Setting, string? Value, int Version);

    private sealed record N9a1Person(
        Guid? UserId,
        bool EmailConfirmed,
        N9a1SignUpRow[] SignUps,
        (Guid TenantId, string Role, string Status)[] Memberships,
        N9a1ProfileRow[] Profiles,
        (Guid ClientProfileId, int Sequence, Guid CoachUserId, Guid? PreviousCoachUserId, string Reason)[] Assignments,
        (Guid ClientProfileId, string Source)[] Changes);

    private sealed record N9a1SignUpRow(
        Guid Id,
        Guid TenantId,
        string? FirstName,
        string? LastName,
        DateOnly? BirthDate,
        DateTimeOffset? ConfirmedAtUtc,
        Guid? ClientProfileId);

    private sealed record N9a1ProfileRow(
        Guid Id,
        Guid TenantId,
        Guid AssignedCoachUserId,
        string FirstName,
        string LastName,
        string Email,
        DateOnly? BirthDate,
        bool IsSelfDirected,
        DateTimeOffset? ReleasedAtUtc);
}
