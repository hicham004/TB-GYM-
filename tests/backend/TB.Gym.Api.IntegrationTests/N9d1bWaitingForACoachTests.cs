using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Notes plan N9d1b, waiting for a coach (C8's decision of 14 Oct 2026, CLI-012, CLI-014), against PostgreSQL: a coach
/// who leaves the team, removed or of their own accord, leaves each of their clients and pending client invitations
/// waiting for a coach, never handed to the owner, with a waiting entry in the coach history and nothing deleted; an
/// invitation accepted after its coach left and a house sign-up with no Coach land waiting too. The owner manages a
/// waiting client (Clients, the list, the page, Today's waiting list, renewals and money) but nobody opens their private
/// side until the owner gives them a coach, themselves included, and the client is told in-app of every coach change
/// while it still holds, a self-directed trainee in words of their own. What happens while a client waits counts for nobody on This month, and the database refuses a
/// coach emptied without its entry, a chain through nobody and a released record with no keeper.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9d1bDepartedTitle = "Your coach has left";

    private const string N9d1bDepartedBody =
        "Your coaching space will give you a new coach and tell you when it does. Your plan and history stay as they are.";

    private const string N9d1bResignedTitle = "A coach left your team";

    private const string N9d1bResignedBody =
        "Their clients now wait for a coach, as will anyone who accepts one of their invitations. Give each one a coach from Clients, yourself included.";

    private const string N9d1bAssignedTitle = "You have a new coach";

    private const string N9d1bAssignedBody = "Open Today to see who coaches you now. Your plan and history stay as they are.";

    private const string N9d1bStaffChangedTitle = "Who can see your training changed";

    private const string N9d1bStaffChangedBody =
        "Another member of your coaching space's team can now see your training and progress. Your plan and history stay as they are.";

    private const string N9d1bHistoryRefusal = "A client coach change must be recorded in the assignment history";

    private const string N9d1bChainRefusal = "A coach assignment must follow the previous assignment of the same client";

    private const string N9d1bDepartureRefusal = "A coach leaving leaves their clients waiting for a coach";

    private const string N9d1bRevertRefusal = "Clients waited for a coach; roll forward instead of reverting this migration.";

    private const string N9d1bStateChanged = "notification-state-changed";

    /// <summary>
    /// What N9d1b's migration changes, as one line: the two coach columns' nullability, the chain check (still naming
    /// SignUp; reading a wait with IS DISTINCT FROM), the keeper check, the outbox vocabulary (one check, still naming
    /// HousePlanMoneySent; CoachAssigned and TraineeStaffChanged), and the two functions reading nobody and refusing a
    /// departure naming a coach.
    /// </summary>
    private const string N9d1bSchemaSql =
        """
        SELECT
            (SELECT string_agg(column_name || ' ' || is_nullable, ', ' ORDER BY column_name DESC)
             FROM information_schema.columns
             WHERE table_schema = 'clients'
               AND ((table_name = 'ClientProfiles' AND column_name = 'AssignedCoachUserId')
                 OR (table_name = 'ClientCoachAssignments' AND column_name = 'CoachUserId')))
            || ' | chain SignUp ' || (SELECT count(*) FROM pg_constraint
                WHERE conname = 'CK_ClientCoachAssignments_Chain' AND pg_get_constraintdef(oid) LIKE '%SignUp%')
            || ' distinct ' || (SELECT count(*) FROM pg_constraint
                WHERE conname = 'CK_ClientCoachAssignments_Chain' AND pg_get_constraintdef(oid) LIKE '%DISTINCT%')
            || ' | keeper ' || (SELECT count(*) FROM pg_constraint WHERE conname = 'CK_ClientProfiles_ReleasedHasKeeper')
            || ' | kinds ' || (SELECT count(*) FROM pg_constraint WHERE conname = 'CK_NotificationOutboxItems_Vocabulary')
            || ' HousePlanMoneySent ' || (SELECT count(*) FROM pg_constraint
                WHERE conname = 'CK_NotificationOutboxItems_Vocabulary' AND pg_get_constraintdef(oid) LIKE '%HousePlanMoneySent%')
            || ' CoachAssigned ' || (SELECT count(*) FROM pg_constraint
                WHERE conname = 'CK_NotificationOutboxItems_Vocabulary' AND pg_get_constraintdef(oid) LIKE '%CoachAssigned%')
            || ' TraineeStaffChanged ' || (SELECT count(*) FROM pg_constraint
                WHERE conname = 'CK_NotificationOutboxItems_Vocabulary' AND pg_get_constraintdef(oid) LIKE '%TraineeStaffChanged%')
            || ' | nobody ' || (SELECT count(*) FROM pg_proc
                WHERE proname IN ('assert_client_coach', 'assert_coach_assignment_chain')
                  AND pg_get_functiondef(oid) LIKE '%IS NOT DISTINCT FROM%')
            || ' departure ' || (SELECT count(*) FROM pg_proc
                WHERE proname = 'assert_coach_assignment_chain' AND pg_get_functiondef(oid) LIKE '%leaves their clients waiting%')
        """;

    private const string N9d1bSchemaWaiting =
        "CoachUserId YES, AssignedCoachUserId YES | chain SignUp 1 distinct 1 | keeper 1 | kinds 1 HousePlanMoneySent 1 CoachAssigned 1 TraineeStaffChanged 1 | nobody 2 departure 1";

    private const string N9d1bSchemaBefore =
        "CoachUserId NO, AssignedCoachUserId NO | chain SignUp 1 distinct 0 | keeper 0 | kinds 1 HousePlanMoneySent 1 CoachAssigned 0 TraineeStaffChanged 0 | nobody 0 departure 0";

    /// <summary>
    /// What stops N9d1b's way back, read as its Down reads it, across the whole database: records naming nobody, history
    /// entries naming nobody, and notices of a new coach and of a trainee's staff, each kind on its own.
    /// </summary>
    private const string N9d1bRevertCausesSql =
        """
        SELECT 'records ' || (SELECT count(*) FROM clients."ClientProfiles" WHERE "AssignedCoachUserId" IS NULL)
            || ' | entries ' || (SELECT count(*) FROM clients."ClientCoachAssignments" WHERE "CoachUserId" IS NULL)
            || ' | CoachAssigned ' || (SELECT count(*) FROM notifications."OutboxItems" WHERE "Kind" = 'CoachAssigned')
            || ' | TraineeStaffChanged ' || (SELECT count(*) FROM notifications."OutboxItems" WHERE "Kind" = 'TraineeStaffChanged')
        """;

    private const string N9d1bNoRevertCause = "records 0 | entries 0 | CoachAssigned 0 | TraineeStaffChanged 0";

    /// <summary>Every row a client's coaching writes, by table, which a coach leaving must leave as it is.</summary>
    private static readonly (string Name, string Sql)[] N9d1bClientRows =
    [
        ("programs", """SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id"""),
        ("workouts", """SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id"""),
        ("maxes", """SELECT count(*) FROM strength."MaxHistory" WHERE "ClientProfileId" = @id"""),
        ("weigh-ins", """SELECT count(*) FROM progress."BodyweightObservations" WHERE "ClientProfileId" = @id"""),
        ("photos", """SELECT count(*) FROM progress."ProgressPhotos" WHERE "ClientProfileId" = @id"""),
        ("check-ins", """SELECT count(*) FROM checkins."CheckInAssignments" WHERE "ClientProfileId" = @id"""),
        ("answers", """SELECT count(*) FROM checkins."CheckInResponses" WHERE "ClientProfileId" = @id"""),
        ("targets", """SELECT count(*) FROM nutrition."CalculationSnapshots" WHERE "ClientProfileId" = @id"""),
        ("plans", """SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "ClientProfileId" = @id"""),
        ("chats", """SELECT count(*) FROM messaging."Conversations" WHERE "ClientProfileId" = @id"""),
        ("messages",
            """
            SELECT count(*) FROM messaging."Messages" AS message
            JOIN messaging."Conversations" AS conversation ON conversation."Id" = message."ConversationId"
            WHERE conversation."ClientProfileId" = @id
            """),
        ("history", """SELECT count(*) FROM clients."ClientCoachAssignments" WHERE "ClientProfileId" = @id"""),
    ];

    // ---------- 1. a coach removed ----------

    // Pins C8's departure: removing a coach leaves their clients and pending client invitations waiting, with a waiting
    // entry and nothing deleted; the owner keeps the business side (the record, Clients, the list, the page, Today and
    // its waiting list) and nobody the private side; the client still trains and is told in the new words.
    [TestMethod]
    public async Task N9d1bRemovingACoachLeavesTheirClientsAndInvitationsWaitingWithNothingDeleted()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-remove-owner@example.test", "Karim Haddad", "N9d1b Remove");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-remove-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "n9d1b-remove-omar@example.test", "Omar Nassar");
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            lea, mayaClient, tenant, "n9d1b-remove-maya@example.test", "Maya", "Rahman", await N9d1aFormAsync(lea), null, today);
        await GrantFreeFeaturesAsync(lea, maya.Id, "Messaging");
        await SendChatAsync(lea, await StartChatAsync(lea, maya.Id), "See you on Monday");
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1b-remove-rami@example.test", "Rami", "Saliba");
        await InviteClientAsync(lea, "n9d1b-remove-pending@example.test");
        var mayaUserId = (await ReadSliceAsync<CoachClientDetails>(lea, $"/api/clients/{maya.Id}")).UserId!.Value;
        var before = await N9d1bRowsAsync(maya.Id);
        foreach (var table in new[] { "programs", "workouts", "weigh-ins", "check-ins", "answers", "plans", "chats", "messages" })
        {
            Assert.IsGreaterThan(0L, before[table], $"Maya has no {table}, so this test checks nothing of them.");
        }

        var removedAt = RequiredTestClock.UtcNow;
        Assert.AreEqual((1, 1), await N9d1bRemoveAsync(owner, leaId), "One client and one invitation left waiting.");

        // Nothing is deleted: every row of hers is still there, and the history has one entry more.
        var after = await N9d1bRowsAsync(maya.Id);
        foreach (var (table, count) in before)
        {
            Assert.AreEqual(table == "history" ? count + 1 : count, after[table], table);
        }

        // Her record names nobody, and the owner, who does not coach her, reads its business side alone.
        var details = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{maya.Id}");
        Assert.AreEqual(((Guid?)null, string.Empty, false), (details.AssignedCoachUserId, details.AssignedCoachName, details.MayCoach));
        N9d1aAssertPrivateSideWithheld(details);
        var history = await N9d1bHistoryAsync(owner, maya.Id);
        Assert.AreEqual("1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury", N9d1bSay(history));
        Assert.AreEqual(
            ((Guid?)null, (Guid?)leaId, (Guid?)ownerId, (string?)null, removedAt),
            (history[1].CoachUserId, history[1].PreviousCoachUserId, history[1].AssignedByUserId, history[1].Note,
                history[1].AssignedAtUtc));

        // Nobody opens her private side, the owner included; the business side stays the owner's.
        foreach (var url in N9d1aPrivateReads(maya))
        {
            await N9d1aAssertReadAsync(owner, "the owner, with Maya waiting", url, HttpStatusCode.NotFound);
            await N9d1aAssertReadAsync(omar, "another coach", url, HttpStatusCode.NotFound);
        }

        foreach (var url in new[]
                 {
                     $"/api/clients/{maya.Id}", R33bOverviewUrl(maya.Id), $"/api/commercial/clients/{maya.Id}",
                     $"/api/clients/{maya.Id}/coach-assignments",
                 })
        {
            await N9d1aAssertReadAsync(owner, "the owner", url, HttpStatusCode.OK);
        }

        // The Team page answers, with no row for the empty coach and nobody counted for it.
        var team = await TeamMembersAsync(owner);
        Assert.AreEqual("Karim Haddad Owner 1, Omar Nassar Coach 0", N9d1bSayTeam(team));
        Assert.IsFalse(team.Any(member => member.UserId == Guid.Empty));

        // Clients, the list, her page and Today keep her, with no coach.
        var listed = (await ReadSliceAsync<ClientSummary[]>(owner, "/api/clients")).ToDictionary(item => item.Id);
        Assert.AreEqual(((Guid?)null, (string?)null), (listed[maya.Id].AssignedCoachUserId, listed[maya.Id].AssignedCoachName));
        Assert.AreEqual(((Guid?)ownerId, (string?)"Karim Haddad"), (listed[ramiId].AssignedCoachUserId, listed[ramiId].AssignedCoachName));
        var row = (await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl)).Clients
            .Single(item => item.Client.ClientProfileId == maya.Id);
        Assert.AreEqual(((Guid?)null, (string?)null, false), (row.Client.AssignedCoachUserId, row.Client.AssignedCoachName, row.Client.MayCoach));
        Assert.IsNull(row.Goals, "Her goals are the private side.");
        var page = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(maya.Id));
        Assert.AreEqual(((Guid?)null, false), (page.Client.AssignedCoachUserId, page.Client.MayCoach));
        Assert.IsNull(page.LastWorkout);
        var ownersToday = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual(2, ownersToday.ClientCount, "Maya and Rami are both current clients.");
        var waiting = (ownersToday.WaitingForCoach ?? throw new AssertFailedException("The owner reads who waits.")).Single();
        Assert.AreEqual(
            (maya.Id, "Maya", "Rahman", (Guid?)null, (string?)null, false),
            (waiting.Client.ClientProfileId, waiting.Client.FirstName, waiting.Client.LastName, waiting.Client.AssignedCoachUserId,
                waiting.Client.AssignedCoachName, waiting.Client.MayCoach));
        Assert.AreEqual((removedAt, (string?)"Lea Khoury", details.Version), (waiting.WaitingSinceUtc, waiting.PreviousCoachName, waiting.ClientVersion));
        Assert.IsNull((await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl)).WaitingForCoach, "A coach reads nobody's wait.");

        // To review and the client targets open the private side: a waiting client is on neither list, for anyone.
        foreach (var staff in new[] { owner, omar })
        {
            var toReview = await ReadSliceAsync<CheckInToReviewList>(staff, N9d1aToReviewUrl);
            Assert.AreEqual(0, toReview.Total);
            Assert.IsEmpty(toReview.Items);
            Assert.IsEmpty((await ReadSliceAsync<ClientTargetsList>(staff, N9d1aTargetsUrl)).Items);
        }

        // Her pending invitation still works and names nobody; the owner still lists it.
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """
            SELECT count(*) FROM invitations."ClientInvitations"
            WHERE "TenantId" = @id AND "Email" = 'n9d1b-remove-pending@example.test'
              AND "Kind" = 'Client' AND "Status" = 'Pending' AND "AssignedCoachUserId" IS NULL
            """,
            tenant));
        Assert.IsTrue((await owner.GetFromJsonAsync<TeamInvitation[]>("/api/invitations") ?? [])
            .Any(item => item.Email == "n9d1b-remove-pending@example.test"));

        // Maya keeps training: she reads her program and today, weighs in the next day, and has no coach to read.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        foreach (var url in new[] { "/api/client-profile/me", "/api/training/me/program", "/api/training/me/today" })
        {
            await N9d1aAssertReadAsync(mayaClient, "Maya, waiting", url, HttpStatusCode.OK);
        }

        await R31WeighInAsync(mayaClient, today.AddDays(1), 69.5m);
        Assert.AreEqual(before["weigh-ins"] + 1, (await N9d1bRowsAsync(maya.Id))["weigh-ins"]);
        await N9d1aAssertReadAsync(mayaClient, "Maya, waiting", N4bCoachUrl, HttpStatusCode.NotFound);

        // Told in-app in the new words, keyed by the waiting entry...
        var departed = (await N9d1bQueuedAsync("CoachDeparted", mayaUserId)).Single();
        Assert.AreEqual((history[1].Id, $"coach-departed:{history[1].Id:N}:v1"), (departed.AggregateId, departed.DeduplicationKey));
        await SweepDepartureNotificationsAsync();
        var told = (await N9d1bInboxAsync(mayaClient)).Single(item => item.Kind == "CoachDeparted");
        Assert.AreEqual((N9d1bDepartedTitle, N9d1bDepartedBody, (Guid?)null), (told.Title, told.Body, told.ClientProfileId));
        Assert.AreEqual("workspace.coach-departed v3", string.Join(" | ", await N9d1bTemplatesAsync("CoachDeparted", mayaUserId)));
        Assert.IsFalse((await N9d1bInboxAsync(ramiClient)).Any(item => item.Kind == "CoachDeparted"), "Rami kept his coach.");

        // ...and by the one email it always sent, unchanged and naming nobody.
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        var mail = CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice);
        Assert.AreEqual(("n9d1b-remove-maya@example.test", "Your coach on TB Gym has changed"), (mail.RecipientAddress, mail.Subject));
        StringAssert.Contains(mail.TextBody, "will assign you a new coach");
        Assert.DoesNotContain("Lea", mail.TextBody);
        Assert.DoesNotContain("N9d1b Remove", mail.TextBody);
    }

    // ---------- 2. a coach resigning ----------

    // Pins a resignation: the coach's clients wait (an entry naming nobody, written by the coach), the owner's own client
    // keeps the owner, and the owner hears it once, in its new words, naming nobody.
    [TestMethod]
    public async Task N9d1bACoachResigningLeavesTheirClientsWaitingAndTellsTheOwnerInItsNewWords()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-resign-owner@example.test", "Karim Haddad", "N9d1b Resign");
        var ownerId = await N9a1UserIdAsync(owner);
        using var rhea = CreateClient();
        var rheaId = await JoinAsCoachAsync(owner, rhea, "n9d1b-resign-rhea@example.test", "Rhea Saade");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(rhea, mayaClient, tenant, "n9d1b-resign-maya@example.test", "Maya", "Rahman");
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1b-resign-rami@example.test", "Rami", "Saliba");
        await InviteClientAsync(rhea, "n9d1b-resign-pending@example.test");

        await RefreshCsrfAsync(rhea);
        var resigned = await rhea.PostAsync("/api/team/me/resign", null);
        await AssertStatusAsync(resigned, HttpStatusCode.OK);
        Assert.AreEqual(new TeamRemoval(1, 1), await RequiredJsonAsync<TeamRemoval>(resigned));

        // Maya waits, by the coach's own hand; Rami, the owner's own client, keeps the owner and his history.
        var history = await N9d1bHistoryAsync(owner, mayaId);
        Assert.AreEqual("1 Invitation Rhea Saade after nobody, 2 CoachResigned nobody after Rhea Saade", N9d1bSay(history));
        Assert.AreEqual(
            ((Guid?)null, (Guid?)rheaId, (Guid?)rheaId),
            (history[1].CoachUserId, history[1].PreviousCoachUserId, history[1].AssignedByUserId));
        Assert.IsNull((await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{mayaId}")).AssignedCoachUserId);
        var rami = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{ramiId}");
        Assert.AreEqual(((Guid?)ownerId, true), (rami.AssignedCoachUserId, rami.MayCoach));
        Assert.AreEqual("1 Invitation Karim Haddad after nobody", N9d1bSay(await N9d1bHistoryAsync(owner, ramiId)));
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """
            SELECT count(*) FROM invitations."ClientInvitations"
            WHERE "TenantId" = @id AND "Email" = 'n9d1b-resign-pending@example.test' AND "AssignedCoachUserId" IS NULL
            """,
            tenant));
        var waiting = (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!.Single();
        Assert.AreEqual((mayaId, (string?)"Rhea Saade"), (waiting.Client.ClientProfileId, waiting.PreviousCoachName));

        // The owner is told once, in the new words, with no name; nobody else hears of the resignation.
        Assert.AreEqual(1L, await N9a1QueuedAsync("CoachResigned", "RecipientUserId", ownerId));
        Assert.AreEqual(1L, await N9a1QueuedAsync("CoachResigned", "TenantId", tenant));
        await SweepDepartureNotificationsAsync();
        var notice = (await N9d1bInboxAsync(owner)).Single(item => item.Kind == "CoachResigned");
        Assert.AreEqual((N9d1bResignedTitle, N9d1bResignedBody), (notice.Title, notice.Body));
        Assert.DoesNotContain("Rhea", notice.Body);
        Assert.AreEqual("workspace.coach-resigned v3", string.Join(" | ", await N9d1bTemplatesAsync("CoachResigned", ownerId)));

        // Maya is told in the new words; Rami is told nothing.
        var told = (await N9d1bInboxAsync(mayaClient)).Single(item => item.Kind == "CoachDeparted");
        Assert.AreEqual((N9d1bDepartedTitle, N9d1bDepartedBody), (told.Title, told.Body));
        Assert.IsFalse((await N9d1bInboxAsync(mayaClient)).Any(item => item.Kind == "CoachResigned"));
        Assert.IsFalse((await N9d1bInboxAsync(ramiClient)).Any(item => item.Kind is "CoachDeparted" or "CoachAssigned"));
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        Assert.AreEqual(
            "n9d1b-resign-maya@example.test",
            CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice).RecipientAddress);
    }

    // ---------- 3. an invitation accepted after its coach left ----------

    // Pins that a client who accepts a departed coach's invitation lands waiting (entry 1 names nobody), is on the owner's
    // waiting list with nobody before them, has no coach to read, and is told nothing until the owner gives them one.
    [TestMethod]
    public async Task N9d1bAnInvitationAcceptedAfterItsCoachLeftLandsWaiting()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-late-owner@example.test", "Karim Haddad", "N9d1b Late");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-late-lea@example.test", "Lea Khoury");
        var link = await InviteClientAsync(lea, "n9d1b-late-client@example.test");
        Assert.AreEqual((0, 1), await N9d1bRemoveAsync(owner, leaId));

        RequiredTestClock.Advance(TimeSpan.FromMinutes(10));
        var acceptedAt = RequiredTestClock.UtcNow;
        using var late = CreateClient();
        var lateId = await AcceptClientLinkAsync(late, link);
        SetTenant(late, tenant);

        var details = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{lateId}");
        Assert.AreEqual(((Guid?)null, string.Empty, false), (details.AssignedCoachUserId, details.AssignedCoachName, details.MayCoach));
        var history = await N9d1bHistoryAsync(owner, lateId);
        Assert.AreEqual("1 Invitation nobody after nobody", N9d1bSay(history));
        Assert.AreEqual(((Guid?)null, (Guid?)null, acceptedAt), (history[0].CoachUserId, history[0].PreviousCoachUserId, history[0].AssignedAtUtc));
        var waiting = (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!.Single();
        Assert.AreEqual((lateId, acceptedAt, (string?)null), (waiting.Client.ClientProfileId, waiting.WaitingSinceUtc, waiting.PreviousCoachName));

        // They are in, with no coach to read, and nobody told them a coach left that they never had.
        await N9d1aAssertReadAsync(late, "the late client", "/api/client-profile/me", HttpStatusCode.OK);
        await N9d1aAssertReadAsync(late, "the late client", N4bCoachUrl, HttpStatusCode.NotFound);
        var lateUserId = details.UserId!.Value;
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM notifications."OutboxItems" WHERE "RecipientUserId" = @id AND "Kind" IN ('CoachDeparted', 'CoachAssigned')""",
            lateUserId));

        // The owner takes them: the wait ends, the client is told, and their coach is the owner.
        await ReassignAsync(owner, lateId, ownerId, null);
        Assert.AreEqual("1 Invitation nobody after nobody, 2 Reassigned Karim Haddad after nobody", N9d1bSay(await N9d1bHistoryAsync(owner, lateId)));
        Assert.HasCount(1, await N9d1bQueuedAsync("CoachAssigned", lateUserId));
        Assert.AreEqual("Karim Haddad", (await RequiredJsonAsync<N9d1bOwnCoach>(await late.GetAsync(N4bCoachUrl))).Name);
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!);
    }

    // ---------- 4. the owner gives a waiting client a coach ----------

    // Pins the owner taking a waiting client: the entry ends the wait (previous nobody), the client is told in-app once
    // per entry, by its words, with no link and no email; the private side opens to the new coach alone and follows a
    // later change; a retry, a stale screen and a second tab change and queue nothing.
    [TestMethod]
    public async Task N9d1bTheOwnerTakesAWaitingClientAndTheClientIsToldInApp()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-takes-owner@example.test", "Karim Haddad", "N9d1b Takes");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-takes-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-takes-omar@example.test", "Omar Nassar");
        using var mayaClient = CreateClient();
        var maya = await N9d1aCoachedClientAsync(
            lea, mayaClient, tenant, "n9d1b-takes-maya@example.test", "Maya", "Rahman", await N9d1aFormAsync(lea), null, today);
        using var jadClient = CreateClient();
        var jadId = await R31InviteAsync(lea, jadClient, tenant, "n9d1b-takes-jad@example.test", "Jad", "Aoun");
        Assert.AreEqual((2, 0), await N9d1bRemoveAsync(owner, leaId));
        await SweepDepartureNotificationsAsync();
        CapturedNoticeMail.Clear();
        Assert.AreEqual(2, (await SweepWorkspaceNoticesAsync()).Materialized, "The two departure emails, out of the way.");

        // Both wait, at the same instant: by last name, Jad Aoun first.
        Assert.AreEqual(
            "Jad Aoun, Maya Rahman",
            string.Join(", ", (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!
                .Select(item => $"{item.Client.FirstName} {item.Client.LastName}")));

        // The owner takes Maya.
        var beforeTaking = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{maya.Id}");
        var mayaUserId = beforeTaking.UserId!.Value;
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        var takenAt = RequiredTestClock.UtcNow;
        var taken = await ReassignAsync(owner, maya.Id, ownerId, "I'll take Maya");
        var history = await N9d1bHistoryAsync(owner, maya.Id);
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury, 3 Reassigned Karim Haddad after nobody",
            N9d1bSay(history));
        var entry = history[2];
        Assert.AreEqual(
            ((Guid?)ownerId, (Guid?)null, (Guid?)ownerId, (string?)"I'll take Maya", takenAt),
            (entry.CoachUserId, entry.PreviousCoachUserId, entry.AssignedByUserId, entry.Note, entry.AssignedAtUtc));

        // One notice, its aggregate that entry, keyed by it, carrying nothing but her profile's id, and in-app alone.
        var queued = (await N9d1bQueuedAsync("CoachAssigned", mayaUserId)).Single();
        Assert.AreEqual((entry.Id, $"coach-assigned:{entry.Id:N}:v1"), (queued.AggregateId, queued.DeduplicationKey));
        using (var payload = JsonDocument.Parse(queued.PayloadJson))
        {
            Assert.AreEqual(
                "clientProfileId,schemaVersion",
                string.Join(',', payload.RootElement.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal)));
            Assert.AreEqual(maya.Id, payload.RootElement.GetProperty("clientProfileId").GetGuid());
        }

        Assert.AreEqual("InApp Pending -", string.Join(" | ", await N9d1bDeliveriesAsync(queued.Id)));
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM tenancy."NoticeMailRequests" WHERE "SubjectId" = @id""",
            entry.Id));

        // Swept: her inbox says she has a new coach, in its words, linking nowhere; no email goes.
        await SweepDepartureNotificationsAsync();
        Assert.AreEqual("InApp Materialized -", string.Join(" | ", await N9d1bDeliveriesAsync(queued.Id)));
        var inbox = await N9d1bInboxAsync(mayaClient);
        var told = inbox.Single(item => item.Kind == "CoachAssigned");
        Assert.AreEqual((N9d1bAssignedTitle, N9d1bAssignedBody), (told.Title, told.Body));
        Assert.IsTrue(inbox.All(item => item.ClientProfileId is null), "A client's notices link to no client.");
        Assert.AreEqual("workspace.coach-assigned v1", string.Join(" | ", await N9d1bTemplatesAsync("CoachAssigned", mayaUserId)));
        CapturedNoticeMail.Clear();
        Assert.AreEqual(0, (await SweepWorkspaceNoticesAsync()).Total, "A new coach is told in-app alone.");

        // Her private side opens to the owner, now her coach, and to nobody else; she is off the waiting list.
        foreach (var url in N9d1aPrivateReads(maya))
        {
            await N9d1aAssertReadAsync(owner, "the owner, now her coach", url, HttpStatusCode.OK);
            await N9d1aAssertReadAsync(omar, "another coach", url, HttpStatusCode.NotFound);
        }

        var theirs = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{maya.Id}");
        Assert.IsTrue(theirs.MayCoach);
        N9d1aAssertPrivateSideShown(theirs);
        Assert.AreEqual(taken.Version, theirs.Version);
        Assert.AreEqual(jadId, (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!.Single().Client.ClientProfileId);

        // An identical retry answers as before and changes nothing; the screen from before the change conflicts, whoever
        // it asks for.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/clients/{maya.Id}/coach", new { coachUserId = ownerId, note = "I'll take Maya", version = theirs.Version }),
            HttpStatusCode.OK);
        foreach (var coach in new[] { ownerId, omarId })
        {
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(
                await owner.PostAsJsonAsync(
                    $"/api/clients/{maya.Id}/coach", new { coachUserId = coach, note = (string?)null, version = beforeTaking.Version }),
                HttpStatusCode.Conflict);
        }

        Assert.HasCount(3, await N9d1bHistoryAsync(owner, maya.Id));
        Assert.HasCount(1, await N9d1bQueuedAsync("CoachAssigned", mayaUserId));

        // Handed on to Omar: told again, and her private side goes with her coach.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        await ReassignAsync(owner, maya.Id, omarId, null);
        var handed = (await N9d1bHistoryAsync(owner, maya.Id))[^1];
        Assert.AreEqual(
            (4, ClientCoachAssignmentReason.Reassigned, (Guid?)omarId, (Guid?)ownerId),
            (handed.Sequence, handed.Reason, handed.CoachUserId, handed.PreviousCoachUserId));
        Assert.HasCount(2, await N9d1bQueuedAsync("CoachAssigned", mayaUserId));
        await SweepDepartureNotificationsAsync();
        Assert.HasCount(2, (await N9d1bInboxAsync(mayaClient)).Where(item => item.Kind == "CoachAssigned"));
        foreach (var url in N9d1aPrivateReads(maya))
        {
            await N9d1aAssertReadAsync(owner, "the owner, no longer her coach", url, HttpStatusCode.NotFound);
            await N9d1aAssertReadAsync(omar, "Omar, her coach now", url, HttpStatusCode.OK);
        }

        // Two of the owner's tabs give Jad a coach at once: one wins with one entry and one notice, the other conflicts.
        using var secondTab = CreateClient();
        await N9a1SignInAsync(secondTab, "n9d1b-takes-owner@example.test");
        SetTenant(secondTab, tenant);
        var jad = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{jadId}");
        await RefreshCsrfAsync(owner);
        await RefreshCsrfAsync(secondTab);
        var answers = await Task.WhenAll(
            owner.PostAsJsonAsync($"/api/clients/{jadId}/coach", new { coachUserId = omarId, note = (string?)null, version = jad.Version }),
            secondTab.PostAsJsonAsync($"/api/clients/{jadId}/coach", new { coachUserId = omarId, note = (string?)null, version = jad.Version }));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            answers.Select(answer => answer.StatusCode).ToArray(),
            string.Join(" | ", await Task.WhenAll(answers.Select(answer => answer.Content.ReadAsStringAsync()))));
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury, 3 Reassigned Omar Nassar after nobody",
            N9d1bSay(await N9d1bHistoryAsync(owner, jadId)));
        Assert.HasCount(1, await N9d1bQueuedAsync("CoachAssigned", jad.UserId!.Value));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!);
    }

    // Pins that every coach change the owner makes tells the client, coach to coach included, and only while it still
    // holds: of two changes before the notices go, the first is suppressed; a coach who leaves before then is told as a
    // departure, and their arrival never is.
    [TestMethod]
    public async Task N9d1bEveryCoachChangeTellsTheClientWhileItStillHolds()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-every-owner@example.test", "Karim Haddad", "N9d1b Every");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-every-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-every-omar@example.test", "Omar Nassar");
        using var zeina = CreateClient();
        var zeinaId = await JoinAsCoachAsync(owner, zeina, "n9d1b-every-zeina@example.test", "Zeina Aoun");
        using var nourClient = CreateClient();
        var nourId = await R31InviteAsync(lea, nourClient, tenant, "n9d1b-every-nour@example.test", "Nour", "Fares");
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1b-every-rami@example.test", "Rami", "Saliba");
        using var saraClient = CreateClient();
        var saraId = await R31InviteAsync(owner, saraClient, tenant, "n9d1b-every-sara@example.test", "Sara", "Khalil");

        // Nour, coach to coach; Rami twice before anything is sent; Sara to Zeina, who then leaves.
        await ReassignAsync(owner, nourId, omarId, "Omar trains mornings");
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await ReassignAsync(owner, ramiId, leaId, null);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await ReassignAsync(owner, ramiId, omarId, null);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await ReassignAsync(owner, saraId, zeinaId, null);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        Assert.AreEqual((1, 0), await N9d1bRemoveAsync(owner, zeinaId));
        await SweepDepartureNotificationsAsync();

        // Nour hears of Omar.
        var nourUserId = (await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{nourId}")).UserId!.Value;
        var nours = (await N9d1bQueuedAsync("CoachAssigned", nourUserId)).Single();
        Assert.AreEqual("InApp Materialized -", string.Join(" | ", await N9d1bDeliveriesAsync(nours.Id)));
        Assert.AreEqual(
            (N9d1bAssignedTitle, N9d1bAssignedBody),
            (await N9d1bInboxAsync(nourClient)).Where(item => item.Kind == "CoachAssigned").Select(item => (item.Title, item.Body)).Single());

        // Rami hears of Omar alone: the notice of Lea was no longer true when it was due.
        var ramiHistory = await N9d1bHistoryAsync(owner, ramiId);
        Assert.AreEqual(
            "1 Invitation Karim Haddad after nobody, 2 Reassigned Lea Khoury after Karim Haddad, 3 Reassigned Omar Nassar after Lea Khoury",
            N9d1bSay(ramiHistory));
        var ramiUserId = (await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{ramiId}")).UserId!.Value;
        var ramis = await N9d1bQueuedAsync("CoachAssigned", ramiUserId);
        Assert.HasCount(2, ramis);
        Assert.AreEqual(
            $"InApp Suppressed {N9d1bStateChanged}",
            string.Join(" | ", await N9d1bDeliveriesAsync(ramis.Single(item => item.AggregateId == ramiHistory[1].Id).Id)));
        Assert.AreEqual(
            "InApp Materialized -",
            string.Join(" | ", await N9d1bDeliveriesAsync(ramis.Single(item => item.AggregateId == ramiHistory[2].Id).Id)));
        Assert.HasCount(1, (await N9d1bInboxAsync(ramiClient)).Where(item => item.Kind == "CoachAssigned"));

        // Sara hears that her coach left, never that she had one.
        var saraHistory = await N9d1bHistoryAsync(owner, saraId);
        Assert.AreEqual(
            "1 Invitation Karim Haddad after nobody, 2 Reassigned Zeina Aoun after Karim Haddad, 3 CoachRemoved nobody after Zeina Aoun",
            N9d1bSay(saraHistory));
        var saraUserId = (await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{saraId}")).UserId!.Value;
        Assert.AreEqual(
            $"InApp Suppressed {N9d1bStateChanged}",
            string.Join(" | ", await N9d1bDeliveriesAsync((await N9d1bQueuedAsync("CoachAssigned", saraUserId)).Single().Id)));
        Assert.AreEqual(
            "InApp Materialized -",
            string.Join(" | ", await N9d1bDeliveriesAsync((await N9d1bQueuedAsync("CoachDeparted", saraUserId)).Single().Id)));
        Assert.AreEqual(
            "CoachDeparted",
            string.Join(" | ", (await N9d1bInboxAsync(saraClient)).Select(item => item.Kind).Where(kind => kind is "CoachDeparted" or "CoachAssigned")));
    }

    // ---------- 5. the history through a wait ----------

    // Pins the coach history through a waiting stretch: appended only, the wait naming nobody (null, never an empty name)
    // after the coach who left, and the entry after it naming nobody before it.
    [TestMethod]
    public async Task N9d1bTheCoachHistoryReadsThroughAWaitingStretch()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-history-owner@example.test", "Karim Haddad", "N9d1b History");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-history-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-history-omar@example.test", "Omar Nassar");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lea, mayaClient, tenant, "n9d1b-history-maya@example.test", "Maya", "Rahman");
        var first = await N9d1bHistoryAsync(owner, mayaId);

        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await N9d1bRemoveAsync(owner, leaId);
        var waited = await N9d1bHistoryAsync(owner, mayaId);
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await ReassignAsync(owner, mayaId, omarId, "Omar has room");
        var history = await N9d1bHistoryAsync(owner, mayaId);

        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury, 3 Reassigned Omar Nassar after nobody",
            N9d1bSay(history));
        Assert.AreEqual(((Guid?)leaId, (Guid?)null), (history[0].CoachUserId, history[0].PreviousCoachUserId));
        Assert.AreEqual(
            ((Guid?)null, (string?)null, (Guid?)leaId, (string?)"Lea Khoury", (Guid?)ownerId),
            (history[1].CoachUserId, history[1].CoachName, history[1].PreviousCoachUserId, history[1].PreviousCoachName,
                history[1].AssignedByUserId));
        Assert.AreEqual(
            ((Guid?)omarId, (string?)"Omar Nassar", (Guid?)null, (string?)null, (string?)"Omar has room"),
            (history[2].CoachUserId, history[2].CoachName, history[2].PreviousCoachUserId, history[2].PreviousCoachName, history[2].Note));

        // Appended only: what was read before reads the same, in order, each entry later than the one before.
        CollectionAssert.AreEqual(first, history.Take(1).ToArray());
        CollectionAssert.AreEqual(waited, history.Take(2).ToArray());
        Assert.IsTrue(history.Zip(history.Skip(1)).All(pair => pair.First.AssignedAtUtc < pair.Second.AssignedAtUtc));
        Assert.HasCount(3, history.Select(entry => entry.Id).Distinct());

        // Nobody is a JSON null, not an empty name.
        using var document = JsonDocument.Parse(await owner.GetStringAsync($"/api/clients/{mayaId}/coach-assignments"));
        Assert.AreEqual(JsonValueKind.Null, document.RootElement[1].GetProperty("coachUserId").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, document.RootElement[1].GetProperty("coachName").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, document.RootElement[2].GetProperty("previousCoachUserId").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, document.RootElement[2].GetProperty("previousCoachName").ValueKind);
    }

    // ---------- 6. the database ----------

    // Pins the guards past the service: a coach emptied or given back without its entry, a chain that skips a wait or
    // names the wrong coach, two waits in a row, nobody where a change must name somebody, a departure naming a coach and
    // a released record with no keeper are all refused; a wait and its entry together commit, the departing-staff guard
    // reads a waiting client as nobody's, and a waiting entry is append-only like any other.
    [TestMethod]
    public async Task N9d1bTheDatabaseRefusesAWaitingClientWithoutItsEntryAndAChainThroughNobody()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-guard-owner@example.test", "Karim Haddad", "N9d1b Guard");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-guard-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-guard-omar@example.test", "Omar Nassar");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lea, mayaClient, tenant, "n9d1b-guard-maya@example.test", "Maya", "Rahman");
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(omar, ramiClient, tenant, "n9d1b-guard-rami@example.test", "Rami", "Saliba");
        await N9d1bRemoveAsync(owner, leaId);

        // A coach emptied, or given to a waiting client, with no entry to say so (an empty coach was 23502 before).
        await N9d1bAssertRefusedAsync(
            "23514",
            N9d1bHistoryRefusal,
            """UPDATE clients."ClientProfiles" SET "AssignedCoachUserId" = NULL WHERE "Id" = @client""",
            ("client", ramiId));
        await N9d1bAssertRefusedAsync(
            "23514",
            N9d1bHistoryRefusal,
            """UPDATE clients."ClientProfiles" SET "AssignedCoachUserId" = @owner WHERE "Id" = @client""",
            ("owner", ownerId),
            ("client", mayaId));

        // A chain through nobody: after Maya's wait the next entry names nobody before it, and a wait names the coach it
        // followed.
        await N9d1bAssertRefusedAsync(
            "23514",
            N9d1bChainRefusal,
            N9d1bEntrySql(3, "@owner", "@lea", "Reassigned"),
            ("owner", ownerId),
            ("lea", leaId),
            ("client", mayaId));
        await N9d1bAssertRefusedAsync(
            "23514",
            N9d1bChainRefusal,
            N9d1bEntrySql(2, "NULL", "@lea", "CoachRemoved"),
            ("lea", leaId),
            ("client", ramiId));

        // The chain check: two waits in a row, nobody where a reassignment, a release, a leave or a first entry needs
        // somebody, a first reason later on, and a change to the same coach.
        (string Sql, Guid Client, (string Name, object Value)[] Parameters)[] unchained =
        [
            (N9d1bEntrySql(3, "NULL", "NULL", "CoachRemoved"), mayaId, []),
            (N9d1bEntrySql(3, "NULL", "NULL", "CoachResigned"), mayaId, []),
            (N9d1bEntrySql(3, "NULL", "NULL", "Reassigned"), mayaId, []),
            (N9d1bEntrySql(2, "NULL", "@omar", "Reassigned"), ramiId, [("omar", omarId)]),
            (N9d1bEntrySql(2, "NULL", "@omar", "Released"), ramiId, [("omar", omarId)]),
            (N9d1bEntrySql(2, "NULL", "@omar", "ClientLeft"), ramiId, [("omar", omarId)]),
            (N9d1bEntrySql(2, "NULL", "@omar", "Invitation"), ramiId, [("omar", omarId)]),
            (N9d1bEntrySql(2, "NULL", "@omar", "SignUp"), ramiId, [("omar", omarId)]),
            (N9d1bEntrySql(2, "@omar", "@omar", "Reassigned"), ramiId, [("omar", omarId)]),
            (N9d1bEntrySql(1, "NULL", "NULL", "Migration"), ramiId, []),
        ];
        foreach (var (sql, client, parameters) in unchained)
        {
            var refused = await N9d1bRefusedAsync(sql, [.. parameters, ("client", client)]);
            Assert.AreEqual(("23514", "CK_ClientCoachAssignments_Chain"), (refused.SqlState, refused.ConstraintName), $"{refused.MessageText}: {sql}");
        }

        // A coach leaving from now on leaves the client waiting: a departure that names a coach is refused.
        foreach (var reason in new[] { "CoachRemoved", "CoachResigned" })
        {
            await N9d1bAssertRefusedAsync(
                "23514",
                N9d1bDepartureRefusal,
                N9d1bEntrySql(2, "@owner", "@omar", reason),
                ("owner", ownerId),
                ("omar", omarId),
                ("client", ramiId));
        }

        // A released record always keeps a keeper.
        var keeperless = await N9d1bRefusedAsync(
            """UPDATE clients."ClientProfiles" SET "ReleasedAtUtc" = now() WHERE "Id" = @client""",
            ("client", mayaId));
        Assert.AreEqual(("23514", "CK_ClientProfiles_ReleasedHasKeeper"), (keeperless.SqlState, keeperless.ConstraintName), keeperless.MessageText);

        // A wait and its entry, together, commit.
        await N9eCommitAsync(
            [
                N9d1bEntrySql(2, "NULL", "@omar", "CoachRemoved"),
                """UPDATE clients."ClientProfiles" SET "AssignedCoachUserId" = NULL WHERE "Id" = @client""",
            ],
            ("omar", omarId),
            ("client", ramiId));
        Assert.IsNull((await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{ramiId}")).AssignedCoachUserId);
        Assert.AreEqual(
            "1 Invitation Omar Nassar after nobody, 2 CoachRemoved nobody after Omar Nassar",
            N9d1bSay(await N9d1bHistoryAsync(owner, ramiId)));

        // Omar's only client now waits, so he is nobody's coach and may stop being staff.
        await Phase6ExecuteAsync(
            """UPDATE tenancy."Memberships" SET "Status" = 'Removed' WHERE "TenantId" = @tenant AND "UserId" = @omar""",
            ("tenant", tenant),
            ("omar", omarId));
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM tenancy."Memberships" WHERE "UserId" = @id AND "Status" = 'Removed'""",
            omarId));

        // A waiting entry is append-only like every other.
        await N9d1bAssertRefusedAsync(
            "55000",
            null,
            """UPDATE clients."ClientCoachAssignments" SET "Note" = 'rewritten' WHERE "ClientProfileId" = @client AND "CoachUserId" IS NULL""",
            ("client", mayaId));
        await N9d1bAssertRefusedAsync(
            "55000",
            null,
            """DELETE FROM clients."ClientCoachAssignments" WHERE "ClientProfileId" = @client AND "CoachUserId" IS NULL""",
            ("client", mayaId));
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury",
            N9d1bSay(await N9d1bHistoryAsync(owner, mayaId)));
    }

    // ---------- 7. This month ----------

    // Pins SUB-018 v3 at fixed days: money received and a plan sold while the client waited count for nobody, on the owner's
    // line of its own, never for the coach who left; a session held during the wait counts for whoever held it; the rows
    // and that line add up to the totals, a coach's own page and Today's month say the same, and no other workspace reads
    // any of it.
    [TestMethod]
    public async Task N9d1bMoneyInAWaitingStretchCountsForNobodyAndTheOwnersRowsAddUp()
    {
        var start = new DateOnly(2026, 10, 5);
        var noon = new TimeOnly(12, 0);
        B4aSetWorkspaceClock(start, noon);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9d1b-money-stranger@example.test", "Other Owner", "N9d1b Money Elsewhere");
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-money-owner@example.test", "Hicham Haddad", "N9d1b Money");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-money-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-money-omar@example.test", "Omar Nasser");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "n9d1b-money-maya@example.test", "Maya", "Rahman");
        var pack = (await B10bPackProductAsync(owner, "N9d1b Personal training", B10bPackOffer(10, 90, 300m))).Offers.Single().Id;
        var chat = (await B4aProductAsync(owner, "N9d1b Chat", B4bOffer(4, "Week", 100m, "USD", "Messaging"))).Offers.Single().Id;

        // 5 Oct, Lea's: a pack, paid in full.
        await B4bPayAsync(owner, await A7EnrollAsync(owner, mayaId, pack, start), 300m, start);

        // 6 Oct: Lea leaves the team and Maya waits for a coach.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 6), noon);
        await RemoveCoachForBillingAsync(owner, leaId);

        // 7 Oct, nobody's: a chat plan is booked and 60 of its 100 paid.
        var waitingDay = new DateOnly(2026, 10, 7);
        B4aSetWorkspaceClock(waitingDay, noon);
        var chatPlan = await A7EnrollAsync(owner, mayaId, chat, waitingDay);
        await B4bPayAsync(owner, chatPlan, 60m, waitingDay);

        // 8 Oct: the owner holds a session for her while she waits; it counts for the owner, who held it.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 8), noon);
        await B10bRecordAsync(owner, mayaId, new DateOnly(2026, 10, 8));

        // 9 Oct: Omar takes her. 10 Oct, Omar's: the last 40, and a session he holds.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 9), noon);
        await ReassignAsync(owner, mayaId, omarId, null);
        var day = new DateOnly(2026, 10, 10);
        B4aSetWorkspaceClock(day, noon);
        await B4bPayAsync(owner, chatPlan, 40m, day);
        await B10bRecordAsync(omar, mayaId, day);

        var page = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual(("MonthNumbers", 3, "MoneyReceived", 1), (page.MonthRuleKey, page.MonthRuleVersion, page.MoneyRuleKey, page.MoneyRuleVersion));
        Assert.AreEqual("USD 400.00 3 | held 2 | plans 1 | packs 1 | started 1 | ended 0", B10dSay(page.ThisMonth));
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(page.LastMonth));
        var rows = page.Coaches ?? throw new AssertFailedException("The owner reads each coach.");
        Assert.AreEqual(
            $"{ownerId} Hicham Haddad True False, {omarId} Omar Nasser False False, {leaId} Lea Khoury False True",
            string.Join(", ", rows.Select(item => $"{item.CoachUserId} {item.Name} {item.IsYou} {item.HasLeftTheTeam}")));
        Assert.AreEqual("none | held 1 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(rows[0].ThisMonth), "The owner held one.");
        Assert.AreEqual("USD 40.00 1 | held 1 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(rows[1].ThisMonth));
        Assert.AreEqual(
            "USD 300.00 1 | held 0 | plans 0 | packs 1 | started 1 | ended 0",
            B10dSay(rows[2].ThisMonth),
            "Lea keeps what was hers, and nothing of the wait.");
        var nobody = page.NoCoach ?? throw new AssertFailedException("What counted for nobody is on the owner's page.");
        Assert.AreEqual("USD 60.00 1 | held 0 | plans 1 | packs 0 | started 0 | ended 0", B10dSay(nobody.ThisMonth));
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(nobody.LastMonth));
        N9d1bAssertRowsAddUp(page);

        // Omar's own page is his row and carries no line for nobody; Lea, gone, reads no page.
        var omars = await ReadSliceAsync<CoachMonthReportView>(omar, CoachMonthUrl);
        Assert.AreEqual(B10dSay(rows[1].ThisMonth), B10dSay(omars.ThisMonth));
        Assert.AreEqual(3, omars.MonthRuleVersion);
        Assert.IsNull(omars.Coaches);
        Assert.IsNull(omars.NoCoach);
        Assert.Contains("\"noCoach\":null", await omar.GetStringAsync(CoachMonthUrl));
        await AssertStatusAsync(await lea.GetAsync(CoachMonthUrl), HttpStatusCode.Forbidden);

        // Today's month says the same.
        var ownersMonth = (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month;
        Assert.AreEqual(("USD 400.00 3", (int?)2), (B4bSay(ownersMonth.MoneyReceived), ownersMonth.SessionsHeld));
        var omarsMonth = (await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl)).Month;
        Assert.AreEqual(("USD 40.00 1", (int?)1), (B4bSay(omarsMonth.MoneyReceived), omarsMonth.SessionsHeld));

        // Another workspace reads none of it.
        var elsewhere = await ReadSliceAsync<CoachMonthReportView>(stranger, CoachMonthUrl);
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(elsewhere.ThisMonth));
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(elsewhere.LastMonth));
        Assert.IsNull(elsewhere.NoCoach);
        Assert.AreEqual("Other Owner", elsewhere.Coaches!.Single().Name);
    }

    // ---------- 8. another workspace ----------

    // Pins tenancy on a waiting client: another workspace's owner neither reads nor takes them (404 in their own space, 403
    // naming this one), and the real owner cannot hand them to that stranger (400).
    [TestMethod]
    public async Task N9d1bAnotherWorkspacesOwnerCannotTakeOrReadAWaitingClient()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-stranger-owner@example.test", "Karim Haddad", "N9d1b Here");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-stranger-lea@example.test", "Lea Khoury");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lea, mayaClient, tenant, "n9d1b-stranger-maya@example.test", "Maya", "Rahman");
        await N9d1bRemoveAsync(owner, leaId);
        var version = (await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{mayaId}")).Version;

        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9d1b-stranger-other@example.test", "Nadim Aoun", "N9d1b Elsewhere");
        var strangerId = await N9a1UserIdAsync(stranger);
        string[] reads =
        [
            $"/api/clients/{mayaId}",
            $"/api/clients/{mayaId}/coach-assignments",
            R33bOverviewUrl(mayaId),
            $"/api/commercial/clients/{mayaId}",
            $"/api/training/clients/{mayaId}/mesocycles",
        ];

        // In their own workspace she does not exist.
        foreach (var url in reads)
        {
            await N9d1aAssertReadAsync(stranger, "another workspace's owner", url, HttpStatusCode.NotFound);
        }

        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(
            await stranger.PostAsJsonAsync($"/api/clients/{mayaId}/coach", new { coachUserId = strangerId, note = (string?)null, version }),
            HttpStatusCode.NotFound);

        // Naming this workspace, they are refused at the door.
        SetTenant(stranger, tenant);
        foreach (var url in reads.Append(CoachTodayUrl))
        {
            await N9d1aAssertReadAsync(stranger, "another workspace's owner in this one", url, HttpStatusCode.Forbidden);
        }

        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(
            await stranger.PostAsJsonAsync($"/api/clients/{mayaId}/coach", new { coachUserId = strangerId, note = (string?)null, version }),
            HttpStatusCode.Forbidden);

        // The owner cannot hand her to someone outside the team.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{mayaId}/coach", new { coachUserId = strangerId, note = (string?)null, version }),
            HttpStatusCode.BadRequest);

        // She still waits, with nothing written.
        Assert.IsNull((await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{mayaId}")).AssignedCoachUserId);
        Assert.HasCount(2, await N9d1bHistoryAsync(owner, mayaId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("CoachAssigned", "TenantId", tenant));
    }

    // ---------- 9. the Team page ----------

    // Pins the team's counts with clients waiting: the page answers, each member counts their own current clients, the
    // waiting ones count for nobody, and Today's team says the same while Today counts every client.
    [TestMethod]
    public async Task N9d1bTheTeamPageCountsSkipTheEmptyCoach()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-team-owner@example.test", "Karim Haddad", "N9d1b Team");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-team-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "n9d1b-team-omar@example.test", "Omar Nassar");
        using var rami = CreateClient();
        await R31InviteAsync(owner, rami, tenant, "n9d1b-team-rami@example.test", "Rami", "Saliba");
        using var maya = CreateClient();
        await R31InviteAsync(lea, maya, tenant, "n9d1b-team-maya@example.test", "Maya", "Rahman");
        using var nour = CreateClient();
        await R31InviteAsync(lea, nour, tenant, "n9d1b-team-nour@example.test", "Nour", "Fares");
        using var sara = CreateClient();
        await R31InviteAsync(omar, sara, tenant, "n9d1b-team-sara@example.test", "Sara", "Khalil");
        Assert.AreEqual("Karim Haddad Owner 1, Lea Khoury Coach 2, Omar Nassar Coach 1", N9d1bSayTeam(await TeamMembersAsync(owner)));

        Assert.AreEqual((2, 0), await N9d1bRemoveAsync(owner, leaId));

        var team = await TeamMembersAsync(owner);
        Assert.AreEqual("Karim Haddad Owner 1, Omar Nassar Coach 1", N9d1bSayTeam(team));
        Assert.IsFalse(team.Any(member => member.UserId == Guid.Empty), "No row for nobody.");
        var today = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual(4, today.ClientCount);
        Assert.AreEqual(
            "Karim Haddad 1, Omar Nassar 1",
            string.Join(", ", today.Month.Coaches!.Select(member => $"{member.Name} {member.ClientCount}")));
        Assert.AreEqual(
            "Nour Fares, Maya Rahman",
            string.Join(", ", today.WaitingForCoach!.Select(item => $"{item.Client.FirstName} {item.Client.LastName}")));
    }

    // ---------- 10. a house with no Coach ----------

    // Pins CLI-024 with no house Coach: a trainee waits from their first entry, is left off Today's waiting list (they
    // train as their own coach), the owner reads their business side and asks and none of their private side; once the
    // owner takes them, it opens, and the trainee is told in-app, once per change and in words of their own, that who can
    // see their training changed, never that they have a new coach; a change no longer true when due is not said.
    [TestMethod]
    public async Task N9d1bAHouseTraineeWithNoHouseCoachWaitsAndTheOwnerTakesThemToCoach()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("n9d1b-wait");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9d1b-wait-talia@example.test", "Talia", "Wexford");

        var details = await ReadSliceAsync<CoachClientDetails>(house.Owner, $"/api/clients/{talia.ProfileId}");
        Assert.AreEqual(((Guid?)null, string.Empty, false), (details.AssignedCoachUserId, details.AssignedCoachName, details.MayCoach));
        Assert.AreEqual("1 SignUp nobody after nobody", N9d1bSay(await N9d1bHistoryAsync(house.Owner, talia.ProfileId)));

        string[] privateReads =
        [
            $"/api/training/clients/{talia.ProfileId}/mesocycles",
            $"/api/strength/clients/{talia.ProfileId}/maxes",
            $"/api/progress/clients/{talia.ProfileId}",
            $"/api/progress/clients/{talia.ProfileId}/dashboard",
            $"/api/progress/clients/{talia.ProfileId}/measurements",
        ];
        string[] businessReads =
        [
            $"/api/clients/{talia.ProfileId}",
            R33bOverviewUrl(talia.ProfileId),
            $"/api/commercial/clients/{talia.ProfileId}",
            N9c1StaffUrl(talia.ProfileId),
            $"/api/clients/{talia.ProfileId}/coach-assignments",
        ];
        foreach (var url in privateReads)
        {
            await N9d1aAssertReadAsync(house.Owner, "the house's owner, with Talia waiting", url, HttpStatusCode.NotFound);
        }

        foreach (var url in businessReads)
        {
            await N9d1aAssertReadAsync(house.Owner, "the house's owner", url, HttpStatusCode.OK);
        }

        var row = (await ReadSliceAsync<ClientOverviewView>(house.Owner, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((talia.ProfileId, (Guid?)null, false), (row.Client.ClientProfileId, row.Client.AssignedCoachUserId, row.Client.MayCoach));
        var today = await ReadSliceAsync<CoachTodayView>(house.Owner, CoachTodayUrl);
        Assert.AreEqual(1, today.ClientCount);
        Assert.IsEmpty(today.WaitingForCoach!, "A self-directed trainee raises nothing on Today, a wait included.");

        // Her ask tells the owner alone: there is no coach to tell.
        await N9c1AskedAsync(talia.Client, space.OfferId);
        CollectionAssert.AreEqual(new[] { house.OwnerUserId }, await N9c1RecipientsAsync("HousePlanAsked", talia.ProfileId));

        // The owner takes her: her private side opens to them.
        await ReassignAsync(house.Owner, talia.ProfileId, house.OwnerUserId, null);
        var history = await N9d1bHistoryAsync(house.Owner, talia.ProfileId);
        Assert.AreEqual("1 SignUp nobody after nobody, 2 Reassigned Nour Haddad after nobody", N9d1bSay(history));
        var entry = history[1];
        foreach (var url in privateReads)
        {
            await N9d1aAssertReadAsync(house.Owner, "the house's owner, now her coach", url, HttpStatusCode.OK);
        }

        Assert.IsTrue((await ReadSliceAsync<CoachClientDetails>(house.Owner, $"/api/clients/{talia.ProfileId}")).MayCoach);

        // She is told who can see her training changed, once, keyed by that entry, carrying nothing but her profile's
        // id, in-app alone; she trains as her own coach, so she is never told she has a new one.
        var queued = (await N9d1bQueuedAsync("TraineeStaffChanged", talia.UserId)).Single();
        Assert.AreEqual((entry.Id, $"trainee-staff-changed:{entry.Id:N}:v1"), (queued.AggregateId, queued.DeduplicationKey));
        using (var payload = JsonDocument.Parse(queued.PayloadJson))
        {
            Assert.AreEqual(
                "clientProfileId,schemaVersion",
                string.Join(',', payload.RootElement.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal)));
            Assert.AreEqual(talia.ProfileId, payload.RootElement.GetProperty("clientProfileId").GetGuid());
        }

        Assert.AreEqual(1L, await N9a1QueuedAsync("TraineeStaffChanged", "TenantId", house.TenantId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("CoachAssigned", "TenantId", house.TenantId));
        Assert.AreEqual("InApp Pending -", string.Join(" | ", await N9d1bDeliveriesAsync(queued.Id)));
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM tenancy."NoticeMailRequests" WHERE "SubjectId" = @id""",
            entry.Id));

        // Swept: her inbox says it in its words, linking nowhere; no email goes to her.
        await SweepDepartureNotificationsAsync();
        Assert.AreEqual("InApp Materialized -", string.Join(" | ", await N9d1bDeliveriesAsync(queued.Id)));
        var inbox = await N9d1bInboxAsync(talia.Client);
        var told = inbox.Single(item => item.Kind == "TraineeStaffChanged");
        Assert.AreEqual((N9d1bStaffChangedTitle, N9d1bStaffChangedBody, (Guid?)null), (told.Title, told.Body, told.ClientProfileId));
        Assert.IsFalse(inbox.Any(item => item.Kind == "CoachAssigned"));
        Assert.AreEqual(
            "workspace.trainee-staff-changed v1",
            string.Join(" | ", await N9d1bTemplatesAsync("TraineeStaffChanged", talia.UserId)));
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM tenancy."NoticeMailRequests" WHERE "RecipientUserId" = @id""",
            talia.UserId));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(house.Owner, CoachTodayUrl)).WaitingForCoach!);

        // Handed to a Coach who joins, and taken back before the notices go: the first change is no longer true when due
        // and is not said, the second is; each is told by its own entry, and never as a new coach.
        using var rania = CreateClient();
        var raniaId = await JoinAsCoachAsync(house.Owner, rania, "n9d1b-wait-rania@example.test", "Rania Saab");
        await ReassignAsync(house.Owner, talia.ProfileId, raniaId, null);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await ReassignAsync(house.Owner, talia.ProfileId, house.OwnerUserId, null);
        var later = await N9d1bHistoryAsync(house.Owner, talia.ProfileId);
        Assert.AreEqual(
            "1 SignUp nobody after nobody, 2 Reassigned Nour Haddad after nobody, 3 Reassigned Rania Saab after Nour Haddad, "
            + "4 Reassigned Nour Haddad after Rania Saab",
            N9d1bSay(later));
        await SweepDepartureNotificationsAsync();
        var notices = await N9d1bQueuedAsync("TraineeStaffChanged", talia.UserId);
        Assert.HasCount(3, notices);
        Assert.AreEqual(
            $"InApp Suppressed {N9d1bStateChanged}",
            string.Join(" | ", await N9d1bDeliveriesAsync(notices.Single(item => item.AggregateId == later[2].Id).Id)));
        Assert.AreEqual(
            "InApp Materialized -",
            string.Join(" | ", await N9d1bDeliveriesAsync(notices.Single(item => item.AggregateId == later[3].Id).Id)));
        Assert.HasCount(2, (await N9d1bInboxAsync(talia.Client)).Where(item => item.Kind == "TraineeStaffChanged"));
        Assert.AreEqual(0L, await N9a1QueuedAsync("CoachAssigned", "TenantId", house.TenantId));
    }

    // ---------- 11. Ask to renew ----------

    // Pins ADR 0029 for a waiting client: the ask is stored for the owner and tells the owner by name, never the coach who
    // left; if the owner gives the client a coach before it is sent, the owner's notice is no longer true and is suppressed.
    [TestMethod]
    public async Task N9d1bAWaitingClientsAskToRenewTellsTheOwnerWhileTheyStillWait()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-renew-owner@example.test", "Hicham Haddad", "N9d1b Renew");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-renew-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-renew-omar@example.test", "Omar Nasser");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "n9d1b-renew-maya@example.test", "Maya", "Rahman");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(lea, nour, tenant, "n9d1b-renew-nour@example.test", "Nour", "Fares");
        await Step3EnrollAsync(owner, mayaId, today, 1, "Training");
        await Step3EnrollAsync(owner, nourId, today, 1, "Training");
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        await RemoveCoachForBillingAsync(owner, leaId);
        await SweepDepartureNotificationsAsync();

        // Maya's plan ran out while she waits: there is no coach to name, and the ask is the owner's.
        var status = await ReadSliceAsync<RenewalStatus>(maya, RenewalUrl);
        Assert.AreEqual((true, true, (string?)null), (status.PlanEnded, status.CanAsk, status.CoachName));
        await RefreshCsrfAsync(maya);
        var asked = await maya.PostAsync(RenewalRequestsUrl, null);
        await AssertStatusAsync(asked, HttpStatusCode.Created);
        Assert.IsNull((await RequiredJsonAsync<RenewalStatus>(asked)).CoachName);
        Assert.AreEqual(ownerId, await N9d1bGuidAsync(
            """SELECT "CoachUserId" FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id""",
            mayaId));
        CollectionAssert.AreEqual(new[] { ownerId }, await N9c1RecipientsAsync("RenewalRequested", mayaId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("RenewalRequested", "RecipientUserId", leaId));

        await SweepDepartureNotificationsAsync();
        var notice = (await N9d1bInboxAsync(owner)).Single(item => item.Kind == "RenewalRequested");
        Assert.AreEqual(("Maya Rahman asked to renew", (Guid?)mayaId), (notice.Title, notice.ClientProfileId));

        // Nour asks too, and the owner gives her to Omar before it is sent: the owner is no longer the one to tell.
        await RefreshCsrfAsync(nour);
        await AssertStatusAsync(await nour.PostAsync(RenewalRequestsUrl, null), HttpStatusCode.Created);
        Assert.AreEqual(ownerId, await N9d1bGuidAsync(
            """SELECT "CoachUserId" FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id""",
            nourId));
        await ReassignAsync(owner, nourId, omarId, null);
        await SweepDepartureNotificationsAsync();
        var nours = await N9d1bOutboxIdsAsync("RenewalRequested", nourId);
        Assert.AreEqual($"InApp Suppressed {N9d1bStateChanged}", string.Join(" | ", await N9d1bDeliveriesAsync(nours.Single())));
        Assert.AreEqual(
            "Maya Rahman asked to renew",
            (await N9d1bInboxAsync(owner)).Where(item => item.Kind == "RenewalRequested").Select(item => item.Title).Single());
        Assert.IsFalse((await N9d1bInboxAsync(omar)).Any(item => item.Kind == "RenewalRequested"));
    }

    // ---------- 12. leaving and released from a wait ----------

    // Pins ADR 0027 from a wait: a waiting client who leaves moves to the owner as keeper from nobody, and the owner alone
    // is told; one the owner releases does the same, told nobody in-app, and the keeper never opens their private side.
    [TestMethod]
    public async Task N9d1bAWaitingClientLeavesOrIsReleasedAndOnlyTheOwnerIsTold()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-end-owner@example.test", "Karim Haddad", "N9d1b End");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-end-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "n9d1b-end-maya@example.test", "Maya", "Rahman");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(lea, nour, tenant, "n9d1b-end-nour@example.test", "Nour", "Fares");
        var training = await CreateTrainingResourcesAsync(lea, nourId, 8, 1, today);
        await AssignAsync(lea, nourId, training, today);
        await N9d1bRemoveAsync(owner, leaId);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));

        // Maya leaves from her wait: the owner keeps the record, and alone hears of it.
        await N9a1LeaveAsync(maya, "Moving abroad");
        var left = await N9d1bHistoryAsync(owner, mayaId);
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury, 3 ClientLeft Karim Haddad after nobody",
            N9d1bSay(left));
        Assert.AreEqual(((Guid?)ownerId, (Guid?)null), (left[2].CoachUserId, left[2].PreviousCoachUserId));
        Assert.AreEqual(1L, await N9a1QueuedAsync("ClientLeft", "AggregateId", mayaId));
        CollectionAssert.AreEqual(new[] { ownerId }, await N9c1RecipientsAsync("ClientLeft", mayaId));
        await SweepDepartureNotificationsAsync();
        Assert.AreEqual(
            "Maya Rahman left your coaching space",
            (await N9d1bInboxAsync(owner)).Single(item => item.Kind == "ClientLeft").Title);

        // The owner releases Nour from hers: the record names the owner as keeper, with her private side closed to them.
        await ReleaseAsync(owner, nourId, "Stopped training");
        var released = await N9d1bHistoryAsync(owner, nourId);
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury, 3 Released Karim Haddad after nobody",
            N9d1bSay(released));
        Assert.AreEqual(((Guid?)ownerId, (Guid?)null), (released[2].CoachUserId, released[2].PreviousCoachUserId));
        var record = await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{nourId}");
        Assert.AreEqual(
            ((Guid?)ownerId, false, (ClientDepartureKind?)ClientDepartureKind.ReleasedByOwner),
            (record.AssignedCoachUserId, record.MayCoach, record.Release?.DepartureKind));
        await N9d1aAssertReadAsync(owner, "the owner, her keeper", $"/api/training/clients/{nourId}/mesocycles", HttpStatusCode.NotFound);
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientLeft", "AggregateId", nourId));
        CollectionAssert.AreEquivalent(
            new[] { mayaId, nourId },
            (await ReadSliceAsync<FormerClientSummary[]>(owner, "/api/clients/former")).Select(item => item.Id).ToArray());
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).WaitingForCoach!, "A former client waits for nobody.");
    }

    // ---------- 13. the migration ----------

    // Pins N9d1b's migration: with nothing that waited it reverts to the schema before (both coach columns NOT NULL, the
    // old chain check still naming SignUp, the vocabulary without CoachAssigned and TraineeStaffChanged and still with
    // HousePlanMoneySent, the old functions) and reapplies. Then a record naming nobody stops the way back by itself, with
    // 55000 and the plain message while the migration stays applied; no state the triggers allow holds one without its
    // waiting entry, so it is written with them off. Each other cause stops it alone in a database of its own, below.
    [TestMethod]
    public async Task N9d1bTheMigrationRevertsWhileNobodyWaitedAndARecordNamingNobodyAloneStopsIt()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-migration-owner@example.test", "Karim Haddad", "N9d1b Migration");
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ramiClient, tenant, "n9d1b-migration-rami@example.test", "Rami", "Saliba");
        Assert.AreEqual(N9d1bSchemaWaiting, await N9d1bTextAsync(N9d1bSchemaSql));
        Assert.AreEqual(N9d1bNoRevertCause, await N9d1bTextAsync(N9d1bRevertCausesSql));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9d1bMigrations(context);

        // Back, with nothing that waited: the schema before, Rami's record and history as they were. Nothing asks the API
        // anything until it is forward again.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(N9d1bSchemaBefore, await N9d1bTextAsync(N9d1bSchemaSql));
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM clients."ClientCoachAssignments" WHERE "ClientProfileId" = @id AND "CoachUserId" IS NOT NULL""",
            ramiId));

        // Forward again: all of it is back.
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9d1bSchemaWaiting, await N9d1bTextAsync(N9d1bSchemaSql));

        // Rami's record names nobody, with no entry to say so and nothing else that stops the way back: refused all the same.
        await N9d1bWithTriggersOffAsync($"""UPDATE clients."ClientProfiles" SET "AssignedCoachUserId" = NULL WHERE "Id" = '{ramiId}'""");
        await N9d1bAssertRevertRefusedWithAsync("records 1 | entries 0 | CoachAssigned 0 | TraineeStaffChanged 0");
    }

    // Pins the way back refused while a client waits, from a coach removal: their record and its waiting entry name nobody
    // (no state holds one without the other), and no reassignment was made anywhere, so no notice of a new coach or of a
    // trainee's staff exists.
    [TestMethod]
    public async Task N9d1bTheMigrationRefusesToRevertWhileAClientWaits()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-revert-wait-owner@example.test", "Karim Haddad", "N9d1b Revert Wait");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-revert-wait-lea@example.test", "Lea Khoury");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lea, mayaClient, tenant, "n9d1b-revert-wait-maya@example.test", "Maya", "Rahman");
        Assert.AreEqual((1, 0), await N9d1bRemoveAsync(owner, leaId));
        Assert.AreEqual(1L, await N9d1bWaitsAsync());

        await N9d1bAssertRevertRefusedWithAsync("records 1 | entries 1 | CoachAssigned 0 | TraineeStaffChanged 0");
        Assert.IsNull((await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{mayaId}")).AssignedCoachUserId);
    }

    // Pins the way back refused by a history entry naming nobody alone: the owner released a waiting client, so nobody
    // waits, the record names the owner as its keeper, and no notice of a new coach or of a trainee's staff was queued.
    [TestMethod]
    public async Task N9d1bTheMigrationRefusesToRevertOverAnEntryNamingNobodyOnceNobodyWaits()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-revert-entry-owner@example.test", "Karim Haddad", "N9d1b Revert Entry");
        var ownerId = await N9a1UserIdAsync(owner);
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-revert-entry-lea@example.test", "Lea Khoury");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lea, mayaClient, tenant, "n9d1b-revert-entry-maya@example.test", "Maya", "Rahman");
        Assert.AreEqual((1, 0), await N9d1bRemoveAsync(owner, leaId));
        await ReleaseAsync(owner, mayaId, "Stopped training");
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 CoachRemoved nobody after Lea Khoury, 3 Released Karim Haddad after nobody",
            N9d1bSay(await N9d1bHistoryAsync(owner, mayaId)));
        Assert.AreEqual((Guid?)ownerId, (await ReadSliceAsync<CoachClientDetails>(owner, $"/api/clients/{mayaId}")).AssignedCoachUserId);

        await N9d1bAssertRevertRefusedWithAsync("records 0 | entries 1 | CoachAssigned 0 | TraineeStaffChanged 0");
    }

    // Pins the way back refused by a notice of a new coach alone: a coached client handed from one coach to another, with
    // nobody named as nobody anywhere.
    [TestMethod]
    public async Task N9d1bTheMigrationRefusesToRevertOverANoticeOfANewCoachAlone()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-revert-coach-owner@example.test", "Karim Haddad", "N9d1b Revert Coach");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "n9d1b-revert-coach-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-revert-coach-omar@example.test", "Omar Nassar");
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lea, mayaClient, tenant, "n9d1b-revert-coach-maya@example.test", "Maya", "Rahman");
        await ReassignAsync(owner, mayaId, omarId, null);
        Assert.AreEqual(
            "1 Invitation Lea Khoury after nobody, 2 Reassigned Omar Nassar after Lea Khoury",
            N9d1bSay(await N9d1bHistoryAsync(owner, mayaId)));

        await N9d1bAssertRevertRefusedWithAsync("records 0 | entries 0 | CoachAssigned 1 | TraineeStaffChanged 0");
    }

    // Pins the way back refused by a trainee's notice of staff changed alone: a house trainee with the house's Coach, taken
    // by the owner, with nobody named as nobody anywhere and no notice of a new coach.
    [TestMethod]
    public async Task N9d1bTheMigrationRefusesToRevertOverATraineesStaffChangedNoticeAlone()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9d1b-revert-trainee", withCoach: true);
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9d1b-revert-talia@example.test", "Talia", "Wexford");
        await ReassignAsync(house.Owner, talia.ProfileId, house.OwnerUserId, null);
        Assert.AreEqual(
            "1 SignUp Lea Khoury after nobody, 2 Reassigned Nour Haddad after Lea Khoury",
            N9d1bSay(await N9d1bHistoryAsync(house.Owner, talia.ProfileId)));
        Assert.HasCount(1, await N9d1bQueuedAsync("TraineeStaffChanged", talia.UserId));

        await N9d1bAssertRevertRefusedWithAsync("records 0 | entries 0 | CoachAssigned 0 | TraineeStaffChanged 1");
    }

    // ---------- 14. Today's read of who waits ----------

    // Pins the cost of Today's waiting list: no query while nobody waits, one for however many wait, the Owner's alone,
    // longest waiting first and then by name, each with the coach before the wait.
    [TestMethod]
    public async Task N9d1bTodayReadsWhoWaitsInOneQueryAndOnlyForTheOwner()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "n9d1b-query-owner@example.test", "Karim Haddad", "N9d1b Query");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "n9d1b-query-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "n9d1b-query-omar@example.test", "Omar Nassar");
        using var zeina = CreateClient();
        await JoinAsCoachAsync(owner, zeina, "n9d1b-query-zeina@example.test", "Zeina Aoun");
        using var rami = CreateClient();
        await R31InviteAsync(owner, rami, tenant, "n9d1b-query-rami@example.test", "Rami", "Saliba");
        using var maya = CreateClient();
        await R31InviteAsync(lea, maya, tenant, "n9d1b-query-maya@example.test", "Maya", "Rahman");
        using var jad = CreateClient();
        await R31InviteAsync(lea, jad, tenant, "n9d1b-query-jad@example.test", "Jad", "Aoun");
        using var hala = CreateClient();
        await R31InviteAsync(lea, hala, tenant, "n9d1b-query-hala@example.test", "Hala", "Aoun");
        using var rana = CreateClient();
        await R31InviteAsync(omar, rana, tenant, "n9d1b-query-rana@example.test", "Rana", "Abboud");

        var (_, before) = await B4aMeasureAsync<CoachTodayView>(owner, CoachTodayUrl, "N9d1b Today, nobody waiting");
        Assert.IsEmpty(before.WaitingForCoach!);
        Assert.AreEqual(0, RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.WaitingForCoachTag).Commands);

        await N9d1bRemoveAsync(owner, leaId);
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await N9d1bRemoveAsync(owner, omarId);

        var (_, view) = await B4aMeasureAsync<CoachTodayView>(owner, CoachTodayUrl, "N9d1b Today, four waiting");
        Assert.AreEqual(
            "Hala Aoun after Lea Khoury, Jad Aoun after Lea Khoury, Maya Rahman after Lea Khoury, Rana Abboud after Omar Nassar",
            string.Join(", ", view.WaitingForCoach!.Select(item => $"{item.Client.FirstName} {item.Client.LastName} after {item.PreviousCoachName}")));
        Assert.AreEqual((1, 5), RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.WaitingForCoachTag), "One read, four rows.");

        // A coach's Today never reads it.
        var (_, coachView) = await B4aMeasureAsync<CoachTodayView>(zeina, CoachTodayUrl, "N9d1b Today, a coach");
        Assert.IsNull(coachView.WaitingForCoach);
        Assert.AreEqual(0, RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.WaitingForCoachTag).Commands);
    }

    // ---------- N9d1b helpers ----------

    /// <summary>The owner removes a coach and returns the clients and pending client invitations it left waiting.</summary>
    private static async Task<(int Clients, int Invitations)> N9d1bRemoveAsync(HttpClient owner, Guid coachUserId)
    {
        var member = (await TeamMembersAsync(owner)).Single(item => item.UserId == coachUserId);
        await RefreshCsrfAsync(owner);
        var removed = await owner.PostAsJsonAsync($"/api/team/members/{coachUserId}/remove", new { version = member.Version });
        await AssertStatusAsync(removed, HttpStatusCode.OK);
        var outcome = await RequiredJsonAsync<TeamRemoval>(removed);
        return (outcome.ReassignedClientCount, outcome.ReassignedInvitationCount);
    }

    private static async Task<ClientCoachAssignmentView[]> N9d1bHistoryAsync(HttpClient owner, Guid clientId) =>
        await ReadSliceAsync<ClientCoachAssignmentView[]>(owner, $"/api/clients/{clientId}/coach-assignments");

    /// <summary>A coach history as one line: each entry's number, reason, coach and the coach before it, nobody named so.</summary>
    private static string N9d1bSay(IEnumerable<ClientCoachAssignmentView> history) =>
        string.Join(", ", history.Select(entry =>
            $"{entry.Sequence} {entry.Reason} {entry.CoachName ?? "nobody"} after {entry.PreviousCoachName ?? "nobody"}"));

    /// <summary>The Team page as one line, the owner first, then by name: who, their role and how many clients they have.</summary>
    private static string N9d1bSayTeam(IEnumerable<TeamMember> team) =>
        string.Join(", ", team
            .OrderBy(member => member.Role == "Owner" ? 0 : 1)
            .ThenBy(member => member.DisplayName, StringComparer.Ordinal)
            .Select(member => $"{member.DisplayName} {member.Role} {member.AssignedClientCount}"));

    private static async Task<RenewalNotice[]> N9d1bInboxAsync(HttpClient reader) =>
        (await RequiredJsonAsync<RenewalInbox>(await reader.GetAsync("/api/notifications"))).Items;

    /// <summary>The rows of a client's coaching, by table.</summary>
    private async Task<Dictionary<string, long>> N9d1bRowsAsync(Guid clientId)
    {
        var rows = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var (name, sql) in N9d1bClientRows)
        {
            rows[name] = await Phase6CountAsync(RequiredDatabaseConnection, sql, clientId);
        }

        return rows;
    }

    /// <summary>The queued notices of one kind to one reader, past every filter.</summary>
    private async Task<N9d1bQueued[]> N9d1bQueuedAsync(string kind, Guid recipientUserId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT "Id", "AggregateId", "DeduplicationKey", "PayloadJson"::text FROM notifications."OutboxItems"
            WHERE "RecipientUserId" = @id AND "Kind" = @kind
            """;
        command.Parameters.AddWithValue("id", recipientUserId);
        command.Parameters.AddWithValue("kind", kind);
        var queued = new List<N9d1bQueued>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            queued.Add(new N9d1bQueued(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3)));
        }

        return [.. queued];
    }

    /// <summary>The ids of the queued notices of one kind about one aggregate.</summary>
    private async Task<Guid[]> N9d1bOutboxIdsAsync(string kind, Guid aggregateId) =>
        [.. (await N9d1bTextsAsync(
                $"""SELECT "Id"::text FROM notifications."OutboxItems" WHERE "AggregateId" = @id AND "Kind" = '{kind}'""",
                aggregateId))
            .Select(Guid.Parse)];

    /// <summary>Each channel delivery of one queued notice: its channel, its status and why, if anything stopped it.</summary>
    private Task<string[]> N9d1bDeliveriesAsync(Guid outboxItemId) =>
        N9d1bTextsAsync(
            """
            SELECT "Channel" || ' ' || "Status" || ' ' || coalesce("FailureCode", '-') FROM notifications."ChannelDeliveries"
            WHERE "OutboxItemId" = @id ORDER BY "Channel"
            """,
            outboxItemId);

    /// <summary>The template and version of every delivered notice of one kind to one reader.</summary>
    private Task<string[]> N9d1bTemplatesAsync(string kind, Guid recipientUserId) =>
        N9d1bTextsAsync(
            $"""
            SELECT "TemplateKey" || ' v' || "TemplateVersion" FROM notifications."Notifications"
            WHERE "RecipientUserId" = @id AND "Kind" = '{kind}'
            """,
            recipientUserId);

    /// <summary>How many current clients wait for a coach, in every workspace.</summary>
    private Task<long> N9d1bWaitsAsync() => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM clients."ClientProfiles" WHERE @id = @id AND "AssignedCoachUserId" IS NULL AND "ReleasedAtUtc" IS NULL""",
        Guid.Empty);

    private async Task<string[]> N9d1bTextsAsync(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var texts = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            texts.Add(reader.GetString(0));
        }

        return [.. texts];
    }

    private async Task<string> N9d1bTextAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToString(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture)
            ?? throw new AssertFailedException($"Nothing answered {sql}");
    }

    private async Task<Guid> N9d1bGuidAsync(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        return await command.ExecuteScalarAsync() is Guid value ? value : throw new AssertFailedException($"No row answered {sql}");
    }

    /// <summary>A coach history entry for the client named by <c>@client</c>, its coaches given as parameters or NULL.</summary>
    private static string N9d1bEntrySql(int sequence, string coach, string previous, string reason) =>
        $"""
        INSERT INTO clients."ClientCoachAssignments"
            ("Id", "TenantId", "ClientProfileId", "Sequence", "CoachUserId", "PreviousCoachUserId", "Reason", "Note", "AssignedAtUtc")
        SELECT gen_random_uuid(), "TenantId", "Id", {sequence}, {coach}, {previous}, '{reason}', NULL, now()
        FROM clients."ClientProfiles" WHERE "Id" = @client
        """;

    private async Task<PostgresException> N9d1bRefusedAsync(string sql, params (string Name, object Value)[] parameters) =>
        await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, parameters));

    /// <summary>The statement is refused with this SQLSTATE and, when given, exactly this message.</summary>
    private async Task N9d1bAssertRefusedAsync(
        string sqlState,
        string? message,
        string sql,
        params (string Name, object Value)[] parameters)
    {
        var refused = await N9d1bRefusedAsync(sql, parameters);
        Assert.AreEqual(sqlState, refused.SqlState, $"{refused.MessageText}: {sql}");
        if (message is not null)
        {
            Assert.AreEqual(message, refused.MessageText, sql);
        }
    }

    /// <summary>
    /// Going back below N9d1b stops with its plain message and the migration stays applied, its schema whole (Npgsql
    /// retries 55000 first, each time rolled back).
    /// </summary>
    private async Task N9d1bAssertRevertRefusedAsync(IMigrator migrator, string previous, GymDbContext context, string migration)
    {
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refusal = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual(("55000", N9d1bRevertRefusal), (refusal.SqlState, refusal.MessageText));
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9d1bSchemaWaiting, await N9d1bTextAsync(N9d1bSchemaSql));
    }

    /// <summary>N9d1b's migration, the one before it, and the migrator of <paramref name="context"/>.</summary>
    private static (string Migration, string Previous, IMigrator Migrator) N9d1bMigrations(GymDbContext context)
    {
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_WaitingForACoach", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        Assert.EndsWith("_HousePrograms", previous);
        return (migration, previous, context.Database.GetInfrastructure().GetRequiredService<IMigrator>());
    }

    /// <summary>
    /// With exactly <paramref name="causes"/> in the database (<see cref="N9d1bRevertCausesSql"/>), going back below
    /// N9d1b is refused with its plain message and the migration stays applied; forward again finds every cause as it was.
    /// </summary>
    private async Task N9d1bAssertRevertRefusedWithAsync(string causes)
    {
        Assert.AreEqual(causes, await N9d1bTextAsync(N9d1bRevertCausesSql), "What could stop the way back, before it is tried.");
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9d1bMigrations(context);
        await N9d1bAssertRevertRefusedAsync(migrator, previous, context, migration);
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(causes, await N9d1bTextAsync(N9d1bRevertCausesSql), "The refusal rewrote nothing.");
    }

    /// <summary>
    /// Commits one statement with the ordinary triggers off (session_replication_role, a superuser's setting), to hold a
    /// state the triggers refuse; the checks still apply.
    /// </summary>
    private async Task N9d1bWithTriggersOffAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var off = new NpgsqlCommand("SET LOCAL session_replication_role = replica", connection, transaction))
        {
            await off.ExecuteNonQueryAsync();
        }

        await using (var write = new NpgsqlCommand(sql, connection, transaction))
        {
            Assert.AreEqual(1, await write.ExecuteNonQueryAsync(), sql);
        }

        await transaction.CommitAsync();
    }

    /// <summary>The owner's rows and the line for nobody add up to the totals, this month and last, every number.</summary>
    private static void N9d1bAssertRowsAddUp(CoachMonthReportView page)
    {
        var rows = page.Coaches ?? throw new AssertFailedException("The owner reads each coach.");
        foreach (var (total, month, nobody) in new (CoachMonthNumbersView Total, Func<CoachMonthRowView, CoachMonthNumbersView> Month, CoachMonthNumbersView? Nobody)[]
                 {
                     (page.ThisMonth, row => row.ThisMonth, page.NoCoach?.ThisMonth),
                     (page.LastMonth, row => row.LastMonth, page.NoCoach?.LastMonth),
                 })
        {
            var parts = rows.Select(month).Concat(nobody is null ? [] : [nobody]).ToArray();
            var added = parts
                .SelectMany(part => part.MoneyReceived)
                .GroupBy(line => line.Currency)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => new CoachMoneyReceivedView(group.Key, group.Sum(line => line.Amount), group.Sum(line => line.PaymentCount)));
            var sum = new CoachMonthNumbersView(
                [.. added],
                parts.Sum(part => part.SessionsHeld),
                parts.Sum(part => part.PlansSold),
                parts.Sum(part => part.PacksSold),
                parts.Sum(part => part.ClientsStarted),
                parts.Sum(part => part.ClientsEnded));
            Assert.AreEqual(B10dSay(total), B10dSay(sum));
        }
    }

    private sealed record N9d1bQueued(Guid Id, Guid AggregateId, string DeduplicationKey, string PayloadJson);

    private sealed record N9d1bOwnCoach(string Name);
}
