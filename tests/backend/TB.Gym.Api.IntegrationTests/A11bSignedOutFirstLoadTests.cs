using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A11b, the signed-out first load (docs/FULL-AUDIT-2026-10.md, section 11, Batch 11): "nothing here"
/// is an answer, not an error (AUTH-12). The session check tells a visitor that nobody is signed in with a 200 and
/// JSON null, where a 401 was a console error on every signed-out page; a client's nutrition day with no meal plan
/// says so the same way, where a 404 was one for every day they opened. Every other route still refuses nobody.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A11bTheSessionCheckAnswersNobodyWithA200AndNamesTheAccountOnceSignedIn()
    {
        // A visitor: nobody, as a 200 with JSON null.
        using var visitor = CreateClient();
        await A11bAssertNothingHereAsync(await visitor.GetAsync("/api/auth/me"));
        // A cookie the API cannot read is nobody too, not a refusal.
        using var stale = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        stale.Headers.Add("Cookie", "tb-gym.auth=not-a-session; __Host-tb-gym.auth=not-a-session");
        await A11bAssertNothingHereAsync(await visitor.SendAsync(stale));
        // Every other route still refuses nobody, and the session check offers nothing to write.
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await visitor.GetAsync("/api/tenants")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await visitor.PutAsJsonAsync("/api/auth/me/theme", new { mode = "dark" })).StatusCode);

        // Signed in, the same address names the account; signed out again, nobody.
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a11b-me@example.test", "Hicham Haddad", "A11b Me");
        var me = await RequiredJsonAsync<A11bAccount>(await coach.GetAsync("/api/auth/me"));
        Assert.AreEqual("a11b-me@example.test", me.Email);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsync("/api/auth/logout", content: null), HttpStatusCode.NoContent);
        await A11bAssertNothingHereAsync(await coach.GetAsync("/api/auth/me"));
    }

    [TestMethod]
    public async Task A11bAClientsNutritionDayWithNoMealPlanIsNothingHereNotA404()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a11b-day-coach@example.test", "Hicham Haddad", "A11b Day");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a11b-day-maya@example.test", "Maya", "Rahman");
        var today = TenantToday();

        // Nutrition is in her plan and no meal plan is assigned yet: nothing for the day, for any date asked.
        var (mealPlan, enrollment) = await A6MealPlanAsync(coach, mayaId, "A11b cut");
        await A11bAssertNothingHereAsync(await maya.GetAsync(A6DayUrl(today)));
        await A11bAssertNothingHereAsync(await maya.GetAsync("/api/nutrition/me/day"));

        // Once a meal plan starts today the day is there; a date past the plan still has nothing.
        var calculation = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 130m);
        await A6AssignAsync(coach, mayaId, mealPlan.VersionId, enrollment.Id, calculation.Id, today);
        Assert.AreEqual(today, (await ReadSliceAsync<ClientNutritionDayView>(maya, A6DayUrl(today))).Date);
        await A11bAssertNothingHereAsync(await maya.GetAsync(A6DayUrl(today.AddDays(400))));

        // The route stays a client's own: nobody is refused, and so is a coach.
        using var anonymous = CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(A6DayUrl(today))).StatusCode);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await coach.GetAsync(A6DayUrl(today))).StatusCode);
    }

    [TestMethod]
    public async Task A11bADayTheClientsPlanDoesNotCoverIsNothingHereAndTheAccessAnswerSaysWhy()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a11b-closed-coach@example.test", "Hicham Haddad", "A11b Closed");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(coach, rami, tenant, "a11b-closed-rami@example.test", "Rami", "Tabet");
        await CreateFreeTrainingEnrollmentAsync(coach, ramiId, TenantToday());

        // No day to show reveals nothing about a plan; the access answer is where the reason is read.
        await A11bAssertNothingHereAsync(await rami.GetAsync(A6DayUrl(TenantToday())));
        var nutrition = (await ReadSliceAsync<A11bAccess[]>(rami, "/api/client-access/me"))
            .Single(item => item.Feature == "Nutrition");
        Assert.AreEqual((false, "NoEntitlement"), (nutrition.IsAllowed, nutrition.Reason));
        // Check-ins the plan does not cover are still refused with their reason: the screens do not ask.
        var checkIns = await rami.GetAsync("/api/checkins/me/assignments");
        Assert.AreEqual(HttpStatusCode.Forbidden, checkIns.StatusCode);
    }

    /// <summary>"Nothing here" as the API says it (audit AUTH-12): 200, JSON, and the body null.</summary>
    private static async Task A11bAssertNothingHereAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, body);
        Assert.AreEqual("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.AreEqual("null", body);
    }

    private sealed record A11bAccount(Guid Id, string Email);

    private sealed record A11bAccess(string Feature, bool IsAllowed, string Reason);
}
