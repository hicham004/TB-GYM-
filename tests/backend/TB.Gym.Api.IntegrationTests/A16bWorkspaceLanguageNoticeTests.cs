using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A16b's notices: a coaching space that chose Arabic hears every notice in English until
/// Arabic wording is written, where refusing the language dead-lettered them all (INV-8); and a plan sold in
/// days is never told it ends soon before it begins (INV-7).
/// </summary>
public sealed partial class Phase6B1NotificationDispatchTests
{
    [TestMethod]
    public async Task A16bAPlanOfAFewDaysIsNotToldItEndsBeforeItBegins()
    {
        var workspace = await CreateWorkspaceAsync("a16b-days");
        var start = TenantToday().AddDays(7);

        // Two days from next week: three days before its end is before its first day, so no reminder.
        var twoDays = await A16bDaysOfferAsync(workspace.Coach, 2);
        var shortPlan = await AssignAsync(workspace.Coach, workspace.ClientProfileId, twoDays, start);
        var kinds = (await IntentsAsync(shortPlan.Id)).Select(intent => intent.Kind).ToArray();
        CollectionAssert.DoesNotContain(kinds, nameof(CommercialNotificationKind.EnrollmentEndingSoon));
        CollectionAssert.Contains(kinds, nameof(CommercialNotificationKind.EnrollmentExpired));

        // Four days straight after: told on its second day, at 09:00 on the workspace's clock.
        var fourDays = await A16bDaysOfferAsync(workspace.Coach, 4);
        var longer = await AssignAsync(workspace.Coach, workspace.ClientProfileId, fourDays, start.AddDays(2));
        var ending = (await IntentsAsync(longer.Id)).Single(intent => intent.Kind == nameof(CommercialNotificationKind.EnrollmentEndingSoon));
        var beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        Assert.AreEqual(
            TimeZoneInfo.ConvertTimeToUtc(start.AddDays(3).ToDateTime(new TimeOnly(9, 0)), beirut),
            ending.ScheduledAtUtc.UtcDateTime);
    }

    /// <summary>A plan of its own with one option of <paramref name="days"/> days.</summary>
    private static async Task<Guid> A16bDaysOfferAsync(HttpClient coach, int days)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Coaching {days} days {Guid.NewGuid():N}",
            description = "A16b",
            initialOffer = new
            {
                label = $"{days} days",
                durationCount = days,
                durationUnit = "Day",
                priceAmount = 20m,
                priceCurrency = "USD",
                features = new[] { new { feature = "Training", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Product>(response)).Offers[0].Id;
    }

    [TestMethod]
    public async Task A16bAnArabicSpaceHearsItsNoticesInEnglishUntilArabicIsWritten()
    {
        var workspace = await CreateWorkspaceAsync("a16b-arabic");
        var current = await workspace.Coach.GetFromJsonAsync<WorkspaceDetails>("/api/workspace")
            ?? throw new AssertFailedException("The workspace response was empty.");
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await workspace.Coach.PutAsJsonAsync("/api/workspace", new
            {
                name = current.Name,
                timeZoneId = current.TimeZoneId,
                defaultCulture = "ar-LB",
                defaultCurrencyCode = current.DefaultCurrencyCode,
                weekStartsOn = current.WeekStartsOn,
                version = current.Version,
            }),
            HttpStatusCode.OK);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var paymentRequired = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        var outcome = await SweepAsync();

        // Said, not dead-lettered for a language with no wording of its own.
        Assert.AreEqual(1, outcome.Materialized);
        Assert.AreEqual("Materialized", (await OutboxAsync(paymentRequired)).Status);
        var attempt = (await AttemptsAsync(paymentRequired)).Single();
        Assert.AreEqual(("Succeeded", (string?)null), (attempt.Outcome, attempt.FailureCode));
        Assert.AreEqual(1L, await NotificationCountAsync(paymentRequired));

        // In English, and recorded as English: the notice never claims to be Arabic.
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.PaymentRequired, "en-LB", out var english));
        var page = await RequiredJsonAsync<NotificationPageResponse>(await workspace.Client.GetAsync("/api/notifications"));
        Assert.AreEqual((english.Title, english.Body), (page.Items.Single().Title, page.Items.Single().Body));
        Assert.AreEqual("en", await ScalarAsync<string>(
            """SELECT "Culture" FROM notifications."Notifications" WHERE "SourceOutboxItemId" = @id""",
            ("id", paymentRequired)));
    }
}
