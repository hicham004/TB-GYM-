using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A14b (AUTH-8): Check-in forms became a card list, and a client's Check-ins assign from a
/// sheet. Each card, and each form the sheet offers, says how many questions a client is sent and when
/// the form was last published, from the list's one read.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A14bTheFormListCountsTheQuestionsAClientIsSentAndWhenTheyWerePublished()
    {
        // Whole seconds, so a time read back from PostgreSQL (microseconds) equals the one the clock gave.
        var now = DateTimeOffset.UtcNow;
        RequiredTestClock.Set(now.AddTicks(-(now.Ticks % TimeSpan.TicksPerSecond)));
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a14b-forms-coach@example.test", "Coach", "Forms");
        var created = await Phase6CreateFormAsync(
            coach,
            "Weekly check-in",
            Phase6ShortText("How did training feel?"),
            Phase6Scale("Energy", 1m, 10m, 1m),
            Phase6LongText("Anything else?"));

        // A draft nobody has been sent: its own questions, and nothing published yet.
        var card = await A14bCardAsync(coach, created.Form.Id);
        Assert.AreEqual(("Draft", 3, (DateTimeOffset?)null), (card.Status, card.QuestionCount, card.LatestPublishedAtUtc));

        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        var first = await Phase6PublishAsync(coach, created.Form.Id, created.Versions.Single());
        card = await A14bCardAsync(coach, created.Form.Id);
        Assert.AreEqual(
            ("Published", 3, first.PublishedAtUtc, (Guid?)null),
            (card.Status, card.QuestionCount, card.LatestPublishedAtUtc, card.DraftVersionId));

        // A new draft with a fourth question: a client is still sent the published three until it is published.
        var draft = await Phase6DeriveDraftAsync(coach, await Phase6GetFormAsync(coach, created.Form.Id), first.Id);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/checkins/forms/{created.Form.Id}/versions/{draft.Id}",
                new
                {
                    questions = new[]
                    {
                        Phase6ShortText("How did training feel?", draft.Questions[0].QuestionKey),
                        Phase6Scale("Energy", 1m, 10m, 1m, draft.Questions[1].QuestionKey),
                        Phase6LongText("Anything else?", draft.Questions[2].QuestionKey),
                        Phase6ShortText("How did you sleep?"),
                    },
                    version = draft.Version,
                }),
            HttpStatusCode.OK);
        card = await A14bCardAsync(coach, created.Form.Id);
        Assert.AreEqual(
            (3, first.PublishedAtUtc, (Guid?)draft.Id),
            (card.QuestionCount, card.LatestPublishedAtUtc, card.DraftVersionId));

        // Published again an hour later: four questions, and the later time.
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        var pending = (await Phase6GetFormAsync(coach, created.Form.Id)).Versions.Single(item => item.Status == "Draft");
        var second = await Phase6PublishAsync(coach, created.Form.Id, pending);
        Assert.IsTrue(second.PublishedAtUtc > first.PublishedAtUtc);
        card = await A14bCardAsync(coach, created.Form.Id);
        Assert.AreEqual((4, second.PublishedAtUtc), (card.QuestionCount, card.LatestPublishedAtUtc));

        // The form's own read carries the same card.
        var details = await RequiredJsonAsync<A14bFormDetails>(
            await coach.GetAsync($"/api/checkins/forms/{created.Form.Id}"));
        Assert.AreEqual((4, second.PublishedAtUtc), (details.Form.QuestionCount, details.Form.LatestPublishedAtUtc));

        // Another workspace's coach reads none of it: refused in this workspace, an empty library in their own.
        using var other = CreateClient();
        var otherTenant = await RegisterCoachAsync(other, "a14b-forms-other@example.test", "Other", "Coach");
        SetTenant(other, tenant);
        await AssertStatusAsync(await other.GetAsync("/api/checkins/forms"), HttpStatusCode.Forbidden);
        SetTenant(other, otherTenant);
        var theirs = await RequiredJsonAsync<A14bFormPage>(await other.GetAsync("/api/checkins/forms"));
        Assert.AreEqual(0L, theirs.Total);

        // Only the workspace's staff read its forms: never one of its clients, nor someone signed out.
        using var client = CreateClient();
        await R31InviteAsync(coach, client, tenant, "a14b-forms-maya@example.test", "Maya", "Rahman");
        SetTenant(client, tenant);
        await AssertStatusAsync(await client.GetAsync("/api/checkins/forms"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await client.GetAsync($"/api/checkins/forms/{created.Form.Id}"),
            HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync("/api/checkins/forms"), HttpStatusCode.Unauthorized);
    }

    private static async Task<A14bFormCard> A14bCardAsync(HttpClient coach, Guid formId)
    {
        var response = await coach.GetAsync("/api/checkins/forms");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<A14bFormPage>(response)).Items.Single(item => item.Id == formId);
    }

    private sealed record A14bFormCard(
        Guid Id,
        string Title,
        string Status,
        bool IsArchived,
        Guid? DraftVersionId,
        Guid? LatestPublishedVersionId,
        int QuestionCount,
        DateTimeOffset? LatestPublishedAtUtc,
        uint Version);

    private sealed record A14bFormPage(long Total, A14bFormCard[] Items);

    private sealed record A14bFormDetails(A14bFormCard Form);
}
