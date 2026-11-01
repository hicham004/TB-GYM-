using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B18 (TRN-023): a coach shows a program before its first day. Now opens only while a paid plan
/// covers the program's dates, the client reads its shared weeks beside whatever else they read, and a
/// workout still waits for its day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B18ProgramUrl = "/api/training/me/program";

    [TestMethod]
    public async Task B18TheNextProgramShowsBesideTheRunningOneOnlyWhileAPaidPlanCoversItsDates()
    {
        var thursday = B18MiddayOnAThursday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b18-paid-coach@example.test", "Karim Haddad", "B18 Paid");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b18-paid-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 1, 1, thursday);
        var running = await AssignAsync(coach, clientId, resources, thursday);
        var twoWeeks = await CreateTemplateWithWeeksAsync(coach, resources.Exercise.Id, resources.Alternative.Id, 2);
        var priced = await B10aProductAsync(coach, "The next block", null, B10aOffer("4 weeks", 4, 100m, "Training"));
        var firstDay = thursday.AddDays(7);
        var plan = await A7EnrollAsync(coach, clientId, priced.Offers[0].Id, firstDay);
        var next = await B18AssignAsync(coach, clientId, resources, plan.Id, twoWeeks.Id, firstDay, true, "Summer strength");

        // The day before: the running program's last day, so next week's first day is in this week's strip.
        RequiredTestClock.Advance(TimeSpan.FromDays(6));
        var wednesday = firstDay.AddDays(-1);

        async Task AssertShowsNothingAsync(string because)
        {
            var read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
            Assert.IsTrue(read.IsAllowed, because);
            Assert.AreEqual(running.Id, read.Program?.Id, because);
            Assert.IsNull(read.NextProgram, because);
            Assert.DoesNotContain("Summer strength", await client.GetStringAsync(B18ProgramUrl), because);
            Assert.IsNull((await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming")).NextSession, because);
            var week = await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week");
            Assert.AreEqual(0, week.Days.Single(day => day.Date == firstDay).Scheduled, because);
            var block = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks
                .Single(item => item.Id == next.Id);
            Assert.AreEqual((true, false), (block.RevealAllWeeks, block.IsShownEarly), because);
            Assert.IsTrue(block.Weeks.All(item => item.IsShared && !item.IsVisible), because);
            var session = block.Weeks[0].Sessions.Single();
            await RefreshCsrfAsync(client);
            var start = await A9ConflictAsync(await client.PostAsync($"/api/training/me/sessions/{session.SessionId}/start", null));
            Assert.AreEqual("mesocycle_not_active", start.Code, because);
        }

        await AssertShowsNothingAsync("A plan waiting for payment shows nothing.");

        await A7PayAsync(coach, plan.Id, 40m, wednesday, Guid.NewGuid());
        await AssertShowsNothingAsync("A part payment grants no access.");

        await A7PayAsync(coach, plan.Id, 60m, wednesday, Guid.NewGuid());
        var program = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((true, "Granted", running.Id, (DateOnly?)firstDay),
            (program.IsAllowed, program.AccessReason, program.Program!.Id, program.NextProgramStartDate));
        var shown = program.NextProgram ?? throw new AssertFailedException("The paid next program is missing.");
        Assert.AreEqual((next.Id, "Summer strength", ClientProgramPhase.Upcoming, firstDay, 2, (int?)null),
            (shown.Id, shown.Name, shown.Phase, shown.StartDate, shown.WeekCount, shown.CurrentWeekNumber));
        Assert.AreEqual((2, 0, 0), (shown.SessionCount, shown.CompletedCount, shown.MissedCount));
        Assert.IsTrue(shown.Weeks.All(week => week.IsVisible && week.IsShared));
        var session = shown.Weeks[0].Sessions.Single();
        Assert.AreEqual(("Squat day 1", firstDay, ClientSessionState.Upcoming), (session.Name, session.ScheduledDate, session.State));

        Assert.AreEqual(firstDay, (await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming")).NextSession?.Date);
        Assert.AreEqual(1, (await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week")).Days
            .Single(day => day.Date == firstDay).Scheduled);
        var coachBlock = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks
            .Single(item => item.Id == next.Id);
        Assert.IsTrue(coachBlock.IsShownEarly);
        Assert.IsTrue(coachBlock.Weeks.All(week => week.IsVisible));
        Assert.IsTrue((await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{next.Id}")).Weeks.All(week => week.IsVisible == true));

        // Read, never started: it waits for its day, with a reason, and nothing was opened.
        await RefreshCsrfAsync(client);
        var early = await A9ConflictAsync(await client.PostAsync($"/api/training/me/sessions/{session.SessionId}/start", null));
        Assert.AreEqual("session_not_due", early.Code);
        Assert.IsEmpty((await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming")).UnfinishedWorkouts);
        Assert.IsNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).NextProgram!.Weeks[0].Sessions.Single().WorkoutExecutionId);

        // The coach keeps it for its first day again, and it closes at once.
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{next.Id}")).Version;
        version = await B18SetNowAsync(coach, next.Id, false, version);
        Assert.IsNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).NextProgram);
        version = await B18SetNowAsync(coach, next.Id, true, version);
        Assert.IsNotNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).NextProgram);

        // A later plan paused or cancelled stops covering the dates; its payment stays on record.
        await B10aChangeAsync(coach, plan.Id, "pause", new { reason = "Travelling", Version = await B10aVersionAsync(coach, clientId, plan.Id) });
        Assert.IsNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).NextProgram, "A paused plan covers nothing.");
        await B10aChangeAsync(coach, plan.Id, "resume", new { Version = await B10aVersionAsync(coach, clientId, plan.Id) });
        Assert.IsNotNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).NextProgram);
        await B10aChangeAsync(coach, plan.Id, "cancel", new { reason = "Changed their mind", Version = await B10aVersionAsync(coach, clientId, plan.Id) });
        Assert.IsNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).NextProgram, "A cancelled plan covers nothing.");

        // Anyone else reads nothing of it.
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(B18ProgramUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await coach.GetAsync(B18ProgramUrl), HttpStatusCode.Forbidden);
        using var foreignCoach = CreateClient();
        SetTenant(client, await RegisterCoachAsync(foreignCoach, "b18-foreign@example.test", "Foreign", "B18 Foreign"));
        await AssertStatusAsync(await client.GetAsync(B18ProgramUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await foreignCoach.GetAsync(R34aProgramUrl(clientId)), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(foreignCoach);
        await AssertStatusAsync(
            await foreignCoach.PutAsJsonAsync($"/api/training/mesocycles/{next.Id}/visibility", new { revealAllWeeks = true, version }),
            HttpStatusCode.NotFound);
    }

    [TestMethod]
    public async Task B18BeforeAPaidPlanBeginsTheClientReadsTheProgramShownEarlyAndNothingElse()
    {
        var today = R61aStartAtMidday();
        var firstDay = today.AddDays(7);
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b18-gap-coach@example.test", "Karim Haddad", "B18 Gap");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b18-gap-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 4, 2, firstDay);
        var block = await AssignAsync(coach, clientId, resources, firstDay);
        var session = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks.Single()
            .Weeks[0].Sessions.Single();

        // From its first day, the default: closed, as it has always been.
        var closed = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((false, "NotStarted", null, null), (closed.IsAllowed, closed.AccessReason, closed.Program, closed.NextProgram));
        Assert.IsNull(closed.NextProgramStartDate, "A closed read says nothing of a program it does not show.");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync($"/api/training/me/sessions/{session.SessionId}/start", null), HttpStatusCode.Forbidden);

        // Now: the program reads as the next one while the plan itself still has not begun.
        await B18SetNowAsync(coach, block.Id, true, block.Version);
        var read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((false, "NotStarted", (DateOnly?)firstDay), (read.IsAllowed, read.AccessReason, read.NextProgramStartDate));
        Assert.IsNull(read.NextProgram, "One program is told once.");
        var program = read.Program ?? throw new AssertFailedException("The program shown early is missing.");
        Assert.AreEqual((block.Id, ClientProgramPhase.Upcoming, 2), (program.Id, program.Phase, program.SessionCount));
        Assert.IsTrue(program.Weeks.All(week => week.IsVisible));

        // Everything else keeps following today.
        Assert.IsFalse((await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).IsAllowed);
        var upcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.AreEqual((false, (UpcomingTrainingSessionView?)null), (upcoming.IsAllowed, upcoming.NextSession));
        Assert.IsFalse((await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).IsAllowed);
        Assert.IsFalse((await ReadSliceAsync<ClientPersonalRecordsResult>(client, "/api/training/me/personal-records")).IsAllowed);

        await RefreshCsrfAsync(client);
        var early = await A9ConflictAsync(await client.PostAsync($"/api/training/me/sessions/{session.SessionId}/start", null));
        Assert.AreEqual("session_not_due", early.Code);

        // On its first day the plan and the program open together, and the workout can start.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var open = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((true, "Granted", ClientProgramPhase.Current), (open.IsAllowed, open.AccessReason, open.Program?.Phase));
        Assert.IsTrue(open.Program!.Weeks.All(week => week.IsVisible), "Now keeps every shared week open.");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync($"/api/training/me/sessions/{session.SessionId}/start", null), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task B18APausedBlockedOrFormerClientReadsNothingOfAProgramShownEarly()
    {
        var today = R61aStartAtMidday();
        var firstDay = today.AddDays(7);
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b18-closed-owner@example.test", "Karim Haddad", "B18 Closed");

        TrainingResources? shared = null;

        async Task<(HttpClient Client, Guid Id, Guid Session, Guid Plan)> ShownEarlyAsync(string name)
        {
            var client = CreateClient();
            var id = await InviteAndAcceptAsync(owner, client, $"b18-closed-{name}@example.test", true);
            SetTenant(client, tenant);
            var resources = shared is null
                ? await CreateTrainingResourcesAsync(owner, id, 1, 1, today)
                : shared with
                {
                    Enrollment = await CreateTrainingEnrollmentAsync(owner, id, today, 1),
                    Max = await RecordWorkingMaxAsync(owner, id, shared.Exercise.Id, 100m),
                };
            shared = resources;
            var plan = await CreateTrainingEnrollmentAsync(owner, id, firstDay, 4);
            var block = await B18AssignAsync(owner, id, resources, plan.Id, resources.Template.Id, firstDay, true, "Next block");
            Assert.AreEqual(block.Id, (await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).Program?.Id);
            var session = (await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(id))).Blocks.Single()
                .Weeks[0].Sessions.Single();
            return (client, id, session.SessionId, resources.Enrollment.Id);
        }

        // A plan paused today closes training: the next program stays closed too, as it does for the coach.
        var (paused, pausedId, pausedSession, pausedPlan) = await ShownEarlyAsync("paused");
        using (paused)
        {
            await B10aChangeAsync(owner, pausedPlan, "pause", new { reason = "Injury", Version = await B10aVersionAsync(owner, pausedId, pausedPlan) });
            var read = await ReadSliceAsync<ClientTrainingProgramView>(paused, B18ProgramUrl);
            Assert.AreEqual((false, "Paused", null, null), (read.IsAllowed, read.AccessReason, read.Program, read.NextProgram));
            Assert.IsNull(read.NextProgramStartDate);
            await RefreshCsrfAsync(paused);
            await AssertStatusAsync(await paused.PostAsync($"/api/training/me/sessions/{pausedSession}/start", null), HttpStatusCode.Forbidden);
        }

        var (blocked, blockedId, blockedSession, _) = await ShownEarlyAsync("blocked");
        using (blocked)
        {
            var profile = await ReadSliceAsync<SliceProfileVersion>(owner, $"/api/clients/{blockedId}");
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{blockedId}/relationship/block",
                new { reason = "B18 block check", profile.Version }), HttpStatusCode.OK);
            var read = await ReadSliceAsync<ClientTrainingProgramView>(blocked, B18ProgramUrl);
            Assert.AreEqual((false, "RelationshipBlocked", null, null), (read.IsAllowed, read.AccessReason, read.Program, read.NextProgram));
            Assert.IsNull(read.NextProgramStartDate);
            await RefreshCsrfAsync(blocked);
            await AssertStatusAsync(await blocked.PostAsync($"/api/training/me/sessions/{blockedSession}/start", null), HttpStatusCode.Forbidden);
        }

        var (former, formerId, _, _) = await ShownEarlyAsync("former");
        using (former)
        {
            var profile = await ReadSliceAsync<SliceProfileVersion>(owner, $"/api/clients/{formerId}");
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{formerId}/release",
                new { reason = "Moved away", profile.Version }), HttpStatusCode.OK);
            await AssertStatusAsync(await former.GetAsync(B18ProgramUrl), HttpStatusCode.Forbidden);
        }
    }

    [TestMethod]
    public async Task B18AssigningNowIsBoundToItsIdempotencyKeyAndLeftOutMeansItsFirstDay()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b18-key-coach@example.test", "Karim Haddad", "B18 Key");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b18-key-client@example.test", true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        var url = $"/api/training/clients/{clientId}/mesocycles";
        var key = Guid.NewGuid();

        var left = await AssignAsync(coach, clientId, resources, today);
        Assert.IsFalse(
            (await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{left.Id}")).RevealAllWeeks,
            "Without a choice a program opens from its first day.");

        object Request(bool now) => new
        {
            enrollmentId = resources.Enrollment.Id,
            templateVersionId = resources.Template.Id,
            startDate = today.AddDays(7),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = new[]
            {
                new { exerciseId = resources.Exercise.Id, strengthMaxRecordId = resources.Max.Id, value = 100m, unit = "Kilogram" },
            },
            idempotencyKey = key,
            revealAllWeeks = now,
        };

        await RefreshCsrfAsync(coach);
        var first = await coach.PostAsJsonAsync(url, Request(true));
        await AssertStatusAsync(first, HttpStatusCode.OK);
        var assigned = await RequiredJsonAsync<ScenarioMesocycle>(first);
        Assert.IsTrue((await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{assigned.Id}")).RevealAllWeeks);

        await RefreshCsrfAsync(coach);
        var retry = await coach.PostAsJsonAsync(url, Request(true));
        await AssertStatusAsync(retry, HttpStatusCode.OK);
        Assert.AreEqual(assigned.Id, (await RequiredJsonAsync<ScenarioMesocycle>(retry)).Id);

        await RefreshCsrfAsync(coach);
        var changed = await A9ConflictAsync(await coach.PostAsJsonAsync(url, Request(false)));
        Assert.AreEqual("idempotency_conflict", changed.Code);
        Assert.HasCount(2, (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks);
    }

    [TestMethod]
    public async Task B18ANoticeTellsOnlyOfWeeksTheClientCanOpen()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b18-notice-coach@example.test", "Karim Haddad", "B18 Notice");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b18-notice-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 1, 1, today);
        await AssignAsync(coach, clientId, resources, today);
        var twoWeeks = await CreateTemplateWithWeeksAsync(coach, resources.Exercise.Id, resources.Alternative.Id, 2);
        var priced = await B10aProductAsync(coach, "The next block", null, B10aOffer("4 weeks", 4, 100m, "Training"));
        var firstDay = today.AddDays(7);
        var plan = await A7EnrollAsync(coach, clientId, priced.Offers[0].Id, firstDay);
        var next = await B18AssignAsync(coach, clientId, resources, plan.Id, twoWeeks.Id, firstDay, false, "Summer strength");

        // Under a plan waiting for payment Now changes nothing the client can see, so it says nothing.
        var version = await B18SetNowAsync(coach, next.Id, true, next.Version);
        Assert.IsEmpty(await R51cPayloadsAsync(next.Id, nameof(CommercialNotificationKind.WeeksShared)));
        version = await B18SetNowAsync(coach, next.Id, false, version);

        await A7PayAsync(coach, plan.Id, 100m, today, Guid.NewGuid());
        await B18SetNowAsync(coach, next.Id, true, version);
        await R51cSweepAsync();
        var notice = (await RequiredJsonAsync<B18Inbox>(await client.GetAsync("/api/notifications"))).Items
            .Single(item => item.Kind == nameof(CommercialNotificationKind.WeeksShared));
        Assert.AreEqual(("Your coach shared weeks 1 and 2", 1, (Guid?)next.Id),
            (notice.Title, notice.WeekNumber, notice.MesocycleId));
    }

    /// <summary>Midday on the coming Thursday, so a week later still sits in the calendar week of the day before it.</summary>
    private DateOnly B18MiddayOnAThursday()
    {
        var today = TenantToday();
        var thursday = today.AddDays(((int)DayOfWeek.Thursday - (int)today.DayOfWeek + 7) % 7);
        var midday = thursday.ToDateTime(new TimeOnly(12, 0));
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        RequiredTestClock.Set(new DateTimeOffset(midday, zone.GetUtcOffset(midday)).ToUniversalTime());
        return thursday;
    }

    private static async Task<ScenarioMesocycle> B18AssignAsync(
        HttpClient coach,
        Guid clientId,
        TrainingResources resources,
        Guid enrollmentId,
        Guid templateVersionId,
        DateOnly startDate,
        bool now,
        string name)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/training/clients/{clientId}/mesocycles", new
        {
            enrollmentId,
            templateVersionId,
            startDate,
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = new[]
            {
                new { exerciseId = resources.Exercise.Id, strengthMaxRecordId = resources.Max.Id, value = 100m, unit = "Kilogram" },
            },
            idempotencyKey = Guid.NewGuid(),
            name,
            revealAllWeeks = now,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<ScenarioMesocycle>(response);
    }

    private sealed record B18Inbox(B18Notice[] Items);

    private sealed record B18Notice(string Kind, string Title, int? WeekNumber, Guid? MesocycleId);

    private static async Task<uint> B18SetNowAsync(HttpClient coach, Guid blockId, bool now, uint version)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{blockId}/visibility",
            new { revealAllWeeks = now, version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<TrainingMesocycleView>(response)).Version;
    }
}
