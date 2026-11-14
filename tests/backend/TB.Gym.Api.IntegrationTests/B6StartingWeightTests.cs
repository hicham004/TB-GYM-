using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Progress;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B6 (PRG-014): a client's starting weight is a record of its own beside the daily weigh-ins.
/// "Where you start" writes it with the first weigh-in; profiles from before it start from their first
/// active weigh-in; a returning client's new profile has its own, and their coach reads the first start,
/// each comeback and "since start" (PRG-005: the latest weekly mean minus the start week's). Only staff
/// correct it, with a reason, and every correction keeps the old value. The client's own page shows none
/// of it (CLI-016).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B6OwnDashboardUrl = "/api/progress/me/dashboard";

    private static readonly decimal[] B6CorrectedTwice = [97.4m, 79.4m];

    private static readonly HttpStatusCode[] B6OneWinsOneConflicts = [HttpStatusCode.OK, HttpStatusCode.Conflict];

    private static string B6DashboardUrl(Guid clientId) => $"/api/progress/clients/{clientId}/dashboard";

    private static string B6StartUrl(Guid clientId) => $"/api/progress/clients/{clientId}/start";

    [TestMethod]
    public async Task B6WhereYouStartWritesTheStartBesideTheFirstWeighInAndOnlyTheCoachReadsIt()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-start-owner@example.test", "Hicham Haddad", "B6 Start");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b6-start-maya@example.test", "Maya", "Fakhoury");
        var startDay = today.AddDays(-35);
        await B6CompleteOnboardingAsync(maya, "Maya", 214.7m, "Pound", startDay);

        var start = await B6StartAsync(owner, mayaId);
        Assert.HasCount(1, start.Starts);
        Assert.AreEqual(
            (mayaId, DashboardStartKind.Started, startDay, 97.386m, 97.386m),
            (start.Starts[0].ClientProfileId, start.Starts[0].Kind, start.Starts[0].MeasurementDate, start.Starts[0].ValueKilograms, start.Starts[0].DisplayValue));
        Assert.IsNull(start.SinceStart, "Only the start shows while no later week has a weigh-in.");
        var current = start.Current ?? throw new AssertFailedException("Maya's own start was not read.");
        Assert.AreEqual(
            (214.7m, RecordedMassUnit.Pound, StartingWeightOrigin.Intake, startDay),
            (current.EnteredValue, current.EnteredUnit, current.Origin, current.MeasurementDate));
        Assert.IsEmpty(current.Corrections);

        // The first weigh-in is written as before, on the same day: the start is beside it, not instead of it.
        var firstDay = await ReadSliceAsync<ProgressView>(owner, B6ProgressUrl(mayaId, startDay));
        Assert.AreEqual(97.386m, firstDay.Days.Single().Observation!.ValueKilograms);

        // A weigh-in five weeks on is the latest weekly mean; the start's week holds only the start's weigh-in.
        await R31WeighInAsync(maya, today, 92.1m);
        var since = (await B6StartAsync(owner, mayaId)).SinceStart ?? throw new AssertFailedException("Since start was not worked out.");
        Assert.AreEqual(("BodyweightSinceStartWeeklyMean", "1.0"), (since.MethodKey, since.MethodVersion));
        Assert.AreEqual((97.386m, 1, 92.1m, 1), (since.StartWeekMeanKilograms, since.StartWeekObservedDayCount, since.LatestWeekMeanKilograms, since.LatestWeekObservedDayCount));
        Assert.AreEqual((-5.286m, -5.286m, -5.4m), (since.DeltaKilograms, since.DisplayDelta, since.Percent));
        Assert.IsTrue(since.StartWeekStart <= startDay && startDay < since.StartWeekStart.AddDays(7));
        Assert.IsTrue(since.LatestWeekStart <= today && today < since.LatestWeekStart.AddDays(7));

        // The start is the coach's view whatever the window: an 8-week read still names a 5-week-old start.
        var shortWindow = await ReadSliceAsync<ProgressDashboardView>(
            owner, $"{B6DashboardUrl(mayaId)}?from={Iso(today.AddDays(-6))}&to={Iso(today.AddDays(1))}");
        Assert.AreEqual(startDay, shortWindow.Bodyweight.Start!.Starts.Single().MeasurementDate);

        // The client's own dashboard carries none of it.
        var own = await ReadSliceAsync<ProgressDashboardView>(maya, B6OwnDashboardUrl);
        Assert.IsNull(own.Bodyweight.Start);
    }

    [TestMethod]
    public async Task B6AClientSetUpLaterStartsFromWhereYouStartNotFromAnEarlierWeighIn()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-later-owner@example.test", "Hicham Haddad", "B6 Later");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(owner, nour, tenant, "b6-later-nour@example.test", "Nour", "Khalil");

        // Weighed before setup was finished: no start until "Where you start" writes it.
        await R31WeighInAsync(nour, today.AddDays(-10), 80m);
        var none = await B6StartAsync(owner, nourId);
        Assert.IsEmpty(none.Starts);
        Assert.IsNull(none.SinceStart);
        Assert.IsNull(none.Current);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync(B6StartUrl(nourId), B6Correction(81m, today.AddDays(-10), "Typed wrong", 0)),
            HttpStatusCode.NotFound);

        // Setup takes that first weigh-in as its start (CompleteAsync asks for the same day and weight).
        await B6CompleteOnboardingAsync(nour, "Nour", 80m, "Kilogram", today.AddDays(-10));
        var start = await B6StartAsync(owner, nourId);
        Assert.AreEqual((today.AddDays(-10), 80m, StartingWeightOrigin.Intake), (start.Starts.Single().MeasurementDate, start.Current!.ValueKilograms, start.Current.Origin));
    }

    [TestMethod]
    public async Task B6AReturningClientCameBackWithAStartOfTheirOwnMeasuredFromTheirFirst()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-back-owner@example.test", "Hicham Haddad", "B6 Back");
        using var sara = CreateClient();
        var oldId = await R31InviteAsync(owner, sara, tenant, "b6-back-sara@example.test", "Sara", "Haddad");
        var firstDay = today.AddDays(-70);
        await B6CompleteOnboardingAsync(sara, "Sara", 97.4m, "Kilogram", firstDay);
        await ReleaseAsync(owner, oldId, "Took a break");

        // Invited back, she is a new relationship (CLI-016), set up again here by her coach.
        await RefreshCsrfAsync(owner);
        var invited = await owner.PostAsJsonAsync("/api/invitations",
            new { email = "b6-back-sara@example.test", firstName = "Sara", lastName = "Haddad" });
        await AssertStatusAsync(invited, HttpStatusCode.Created);
        var link = (await RequiredJsonAsync<Invitation>(invited)).DevelopmentActionUrl!;
        await RefreshCsrfAsync(sara);
        var accepted = await sara.PostAsJsonAsync("/api/invitations/accept",
            new { token = QueryValue(link, "token"), displayName = (string?)null, password = (string?)null });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var newId = (await RequiredJsonAsync<InvitationAcceptance>(accepted)).ClientProfileId;
        Assert.AreNotEqual(oldId, newId);
        var backDay = today.AddDays(-14);
        await B6CoachCompletesOnboardingAsync(owner, newId, "Sara", 99m, backDay);
        await R31WeighInAsync(sara, today, 95m);

        var start = await B6StartAsync(owner, newId);
        Assert.HasCount(2, start.Starts);
        Assert.AreEqual((oldId, DashboardStartKind.Started, firstDay, 97.4m), (start.Starts[0].ClientProfileId, start.Starts[0].Kind, start.Starts[0].MeasurementDate, start.Starts[0].ValueKilograms));
        Assert.AreEqual((newId, DashboardStartKind.CameBack, backDay, 99m), (start.Starts[1].ClientProfileId, start.Starts[1].Kind, start.Starts[1].MeasurementDate, start.Starts[1].ValueKilograms));
        Assert.AreEqual((newId, StartingWeightOrigin.Intake), (start.Current!.ClientProfileId, start.Current.Origin));

        // Since her first start: the first profile's start week against the new profile's latest week.
        var since = start.SinceStart!;
        Assert.AreEqual((97.4m, 95m, -2.4m, -2.5m), (since.StartWeekMeanKilograms, since.LatestWeekMeanKilograms, since.DeltaKilograms, since.Percent));

        // Her old profile, read by the owner under Former clients, shows only what came before it, and its
        // start is read-only like the rest of it (ADR 0027).
        var former = await B6StartAsync(owner, oldId);
        Assert.AreEqual((oldId, DashboardStartKind.Started), (former.Starts.Single().ClientProfileId, former.Starts.Single().Kind));
        await RefreshCsrfAsync(owner);
        var refused = await owner.PutAsJsonAsync(B6StartUrl(oldId), B6Correction(97m, firstDay, "Typed wrong", former.Current!.Version));
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        Assert.AreEqual("client_released", await B6CodeAsync(refused));

        // Sara herself never sees either start.
        Assert.IsNull((await ReadSliceAsync<ProgressDashboardView>(sara, B6OwnDashboardUrl)).Bodyweight.Start);
    }

    [TestMethod]
    public async Task B6TheCoachCorrectsTheStartWithAReasonAndTheOldValueStays()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-fix-owner@example.test", "Hicham Haddad", "B6 Fix");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b6-fix-maya@example.test", "Maya", "Fakhoury");
        var startDay = today.AddDays(-35);
        await B6CompleteOnboardingAsync(maya, "Maya", 79.4m, "Kilogram", startDay);
        var version = (await B6StartAsync(owner, mayaId)).Current!.Version;

        // Refused before anything changes: no reason, nothing changed, a day still to come, a weight out of range.
        foreach (var (request, field) in new (object Request, string Field)[]
                 {
                     (B6Correction(97.4m, startDay, " ", version), "startingWeight"),
                     (B6Correction(79.4m, startDay, "Typed wrong", version), "startingWeight"),
                     (B6Correction(97.4m, today.AddDays(1), "Typed wrong", version), "measurementDate"),
                     (B6Correction(12m, startDay, "Typed wrong", version), "startingWeight"),
                 })
        {
            await RefreshCsrfAsync(owner);
            var invalid = await owner.PutAsJsonAsync(B6StartUrl(mayaId), request);
            await AssertStatusAsync(invalid, HttpStatusCode.BadRequest);
            StringAssert.Contains(await invalid.Content.ReadAsStringAsync(), $"\"{field}\"");
        }

        await RefreshCsrfAsync(owner);
        var corrected = await owner.PutAsJsonAsync(
            B6StartUrl(mayaId),
            B6Correction(97.4m, startDay.AddDays(-1), "Typed the digits the wrong way round", version));
        await AssertStatusAsync(corrected, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<StartingWeightView>(corrected);
        Assert.AreEqual((97.4m, startDay.AddDays(-1), StartingWeightOrigin.Intake), (view.ValueKilograms, view.MeasurementDate, view.Origin));
        var kept = view.Corrections.Single();
        Assert.AreEqual(
            (79.4m, startDay, "Typed the digits the wrong way round", "Hicham Haddad"),
            (kept.ValueKilograms, kept.MeasurementDate, kept.Reason, kept.SupersededByName));
        Assert.AreNotEqual(version, view.Version);

        // A tab still holding the old version is told the start changed, and nothing more is recorded.
        await RefreshCsrfAsync(owner);
        var stale = await owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(97m, startDay, "Typed wrong", version));
        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        Assert.AreEqual("StartingWeightVersionConflict", await B6CodeAsync(stale));

        // The coach's view reads the corrected start; the weigh-in of that first day is untouched.
        var start = await B6StartAsync(owner, mayaId);
        Assert.AreEqual((97.4m, startDay.AddDays(-1)), (start.Starts.Single().ValueKilograms, start.Starts.Single().MeasurementDate));
        Assert.HasCount(1, start.Current!.Corrections);
        Assert.AreEqual(79.4m, (await ReadSliceAsync<ProgressView>(owner, B6ProgressUrl(mayaId, startDay))).Days.Single().Observation!.ValueKilograms);

        // Correcting back keeps both earlier values, newest first.
        await RefreshCsrfAsync(owner);
        var again = await owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(79.4m, startDay, "It was right the first time", view.Version));
        await AssertStatusAsync(again, HttpStatusCode.OK);
        var twice = await ReadSlicePayloadAsync<StartingWeightView>(again);
        CollectionAssert.AreEqual(B6CorrectedTwice, twice.Corrections.Select(item => item.ValueKilograms).ToArray());
    }

    [TestMethod]
    public async Task B6OnlyTheClientsOwnCoachReadsAndCorrectsTheStart()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-scope-owner@example.test", "Hicham Haddad", "B6 Scope");
        using var lina = CreateClient();
        await JoinAsCoachAsync(owner, lina, "b6-scope-lina@example.test", "Lina Saad");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b6-scope-maya@example.test", "Maya", "Fakhoury");
        await B6CompleteOnboardingAsync(maya, "Maya", 64.2m, "Kilogram", today.AddDays(-21));
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(lina, rami, tenant, "b6-scope-rami@example.test", "Rami", "Saliba");
        await B6CompleteOnboardingAsync(rami, "Rami", 88m, "Kilogram", today.AddDays(-21));
        var mayaVersion = (await B6StartAsync(owner, mayaId)).Current!.Version;

        // Another coach's client is not there for Lina (ADR 0026), nor, since a weigh-in is the private side, for the
        // owner, who reads and corrects the clients they coach (C8, notes plan N9d1a).
        await AssertStatusAsync(await lina.GetAsync(B6DashboardUrl(mayaId)), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(lina);
        await AssertStatusAsync(await lina.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(65m, today.AddDays(-21), "Typed wrong", mayaVersion)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await owner.GetAsync(B6DashboardUrl(ramiId)), HttpStatusCode.NotFound);
        Assert.AreEqual(88m, (await B6StartAsync(lina, ramiId)).Current!.ValueKilograms);

        // A client never corrects their own start, nor reaches the coach's read.
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(65m, today.AddDays(-21), "Typed wrong", mayaVersion)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await maya.GetAsync(B6DashboardUrl(mayaId)), HttpStatusCode.Forbidden);

        // Another workspace's owner: not a member here, and the client is unknown in their own space.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b6-scope-stranger@example.test", "Other Owner", "B6 Elsewhere");
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(await stranger.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(65m, today.AddDays(-21), "Typed wrong", mayaVersion)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await stranger.GetAsync(B6DashboardUrl(mayaId)), HttpStatusCode.NotFound);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(B6DashboardUrl(mayaId)), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(B6DashboardUrl(mayaId)), HttpStatusCode.Unauthorized);

        // A blocked relationship closes the start with the rest of the coach's progress (PRG-008).
        var profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/block",
            new { reason = "B6 block check", profile.Version }), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync(B6DashboardUrl(mayaId)), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(65m, today.AddDays(-21), "Typed wrong", mayaVersion)), HttpStatusCode.Forbidden);
        profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/unblock",
            new { reason = "B6 block check done", profile.Version }), HttpStatusCode.OK);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(65m, today.AddDays(-21), "Typed wrong", mayaVersion)), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task B6TwoCorrectionsFromTheSameVersionKeepOneAndRefuseTheOther()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-race-owner@example.test", "Hicham Haddad", "B6 Race");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b6-race-maya@example.test", "Maya", "Fakhoury");
        await B6CompleteOnboardingAsync(maya, "Maya", 70m, "Kilogram", today.AddDays(-14));
        var version = (await B6StartAsync(owner, mayaId)).Current!.Version;

        // One token for both, refreshed once before they race.
        await RefreshCsrfAsync(owner);
        var answers = await Task.WhenAll(
            owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(71m, today.AddDays(-14), "First tab", version)),
            owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(72m, today.AddDays(-14), "Second tab", version)));
        CollectionAssert.AreEquivalent(
            B6OneWinsOneConflicts,
            answers.Select(answer => answer.StatusCode).ToArray());
        var current = (await B6StartAsync(owner, mayaId)).Current!;
        Assert.HasCount(1, current.Corrections);
        Assert.AreEqual(70m, current.Corrections[0].ValueKilograms);
        Assert.IsTrue(current.ValueKilograms is 71m or 72m);
    }

    [TestMethod]
    public async Task B6TheDatabaseKeepsEveryStartAndItsCorrections()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-guard-owner@example.test", "Hicham Haddad", "B6 Guard");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b6-guard-maya@example.test", "Maya", "Fakhoury");
        await B6CompleteOnboardingAsync(maya, "Maya", 70m, "Kilogram", today.AddDays(-14));
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(owner, omar, tenant, "b6-guard-omar@example.test", "Omar", "Nasser");
        await B6CompleteOnboardingAsync(omar, "Omar", 90m, "Kilogram", today.AddDays(-14));
        var start = (await B6StartAsync(owner, mayaId)).Current!;
        await RefreshCsrfAsync(owner);
        var corrected = await ReadSlicePayloadAsync<StartingWeightView>(
            await owner.PutAsJsonAsync(B6StartUrl(mayaId), B6Correction(71m, today.AddDays(-14), "Typed wrong", start.Version)));
        var correctionId = corrected.Corrections.Single().Id;

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await A6AssertSqlRefusedAsync(connection, "DELETE FROM progress.\"StartingWeights\" WHERE \"Id\" = @id", start.Id, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, "UPDATE progress.\"StartingWeights\" SET \"Origin\" = 'FirstWeighIn' WHERE \"Id\" = @id", start.Id, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, $"UPDATE progress.\"StartingWeights\" SET \"ClientProfileId\" = '{omarId}' WHERE \"Id\" = @id", start.Id, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, "UPDATE progress.\"StartingWeightCorrections\" SET \"Reason\" = 'Rewritten' WHERE \"Id\" = @id", correctionId, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, "DELETE FROM progress.\"StartingWeightCorrections\" WHERE \"Id\" = @id", correctionId, PostgresErrorCodes.CheckViolation);
        // One start per profile, and a correction can only name its own start's profile.
        await A6AssertSqlRefusedAsync(connection, $"""
            INSERT INTO progress."StartingWeights" ("Id", "TenantId", "ClientProfileId", "MeasurementDate", "ValueKilograms",
                "EnteredValue", "EnteredUnit", "Origin")
            VALUES (gen_random_uuid(), '{tenant}', @id, CURRENT_DATE, 80, 80, 'Kilogram', 'Intake')
            """, mayaId, PostgresErrorCodes.UniqueViolation);
        await A6AssertSqlRefusedAsync(connection, $"""
            INSERT INTO progress."StartingWeightCorrections" ("Id", "TenantId", "StartingWeightId", "ClientProfileId", "MeasurementDate",
                "ValueKilograms", "EnteredValue", "EnteredUnit", "RecordedAtUtc", "Reason", "SupersededAtUtc", "SupersededByUserId")
            VALUES (gen_random_uuid(), '{tenant}', @id, '{omarId}', CURRENT_DATE, 80, 80, 'Kilogram', now(), 'Smuggled', now(), gen_random_uuid())
            """, start.Id, PostgresErrorCodes.ForeignKeyViolation);
        await A6AssertSqlRefusedAsync(connection, "UPDATE progress.\"StartingWeights\" SET \"Origin\" = 'Guess' WHERE \"Id\" = @id", start.Id, PostgresErrorCodes.CheckViolation);

        // The application refuses the same mistakes before they reach the database.
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var rows = await context.StartingWeights.IgnoreQueryFilters().Where(item => item.Id == start.Id).ToListAsync();
        context.StartingWeights.Remove(rows.Single());
        StringAssert.Contains(Assert.ThrowsExactly<InvalidOperationException>(() => context.SaveChanges()).Message, "never deleted");
        context.ChangeTracker.Clear();
        var correction = await context.StartingWeightCorrections.IgnoreQueryFilters().SingleAsync(item => item.Id == correctionId);
        context.StartingWeightCorrections.Remove(correction);
        StringAssert.Contains(Assert.ThrowsExactly<InvalidOperationException>(() => context.SaveChanges()).Message, "append-only");
    }

    [TestMethod]
    public async Task B6TheMigrationStartsEachExistingProfileFromItsFirstActiveWeighIn()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b6-migration-owner@example.test", "Hicham Haddad", "B6 Migration");

        // Maya weighed in before setup; her earliest entry was moved to a later day, so it is no longer current.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b6-migration-maya@example.test", "Maya", "Fakhoury");
        var misdated = await B6WeighInAsync(maya, today.AddDays(-30), 80.5m);
        await R31WeighInAsync(maya, today.AddDays(-20), 80m);
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsJsonAsync(
            $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
            new { measurementDate = today.AddDays(-15), reason = "Wrong day", version = misdated.Version }), HttpStatusCode.OK);
        // Sara finished setup, weighing in pounds; Nour never weighed in.
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b6-migration-sara@example.test", "Sara", "Haddad");
        await B6CompleteOnboardingAsync(sara, "Sara", 154.3m, "Pound", today.AddDays(-40));
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(owner, nour, tenant, "b6-migration-nour@example.test", "Nour", "Khalil");

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_StartingWeights", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A6ScalarAsync("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'progress' AND table_name = 'StartingWeights'"));
        await migrator.MigrateAsync(migration);

        var filled = await B6StoredStartsAsync(tenant);
        Assert.HasCount(2, filled, "Nour has no weigh-in, so no start.");
        Assert.AreEqual((today.AddDays(-20), 80m, 80m, "Kilogram", "FirstWeighIn"), filled[mayaId]);
        Assert.AreEqual((today.AddDays(-40), 69.989m, 154.3m, "Pound", "FirstWeighIn"), filled[saraId]);
        Assert.IsFalse(filled.ContainsKey(nourId));
        Assert.AreEqual(1L, await A6ScalarAsync("SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_StartingWeights_Protect' AND tgenabled = 'O'"));
        Assert.AreEqual(1L, await A6ScalarAsync("SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_StartingWeightCorrections_AppendOnly' AND tgenabled = 'O'"));

        // With every later migration back, the coach reads the filled-in start.
        await migrator.MigrateAsync();
        var start = await B6StartAsync(owner, mayaId);
        Assert.AreEqual((today.AddDays(-20), StartingWeightOrigin.FirstWeighIn), (start.Starts.Single().MeasurementDate, start.Current!.Origin));
    }

    private async Task<Dictionary<Guid, (DateOnly Day, decimal Kilograms, decimal Entered, string Unit, string Origin)>> B6StoredStartsAsync(Guid tenant)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "ClientProfileId", "MeasurementDate", "ValueKilograms", "EnteredValue", "EnteredUnit", "Origin"
            FROM progress."StartingWeights" WHERE "TenantId" = @tenant
            """;
        command.Parameters.AddWithValue("tenant", tenant);
        var rows = new Dictionary<Guid, (DateOnly, decimal, decimal, string, string)>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(
                reader.GetGuid(0),
                (reader.GetFieldValue<DateOnly>(1), reader.GetDecimal(2), reader.GetDecimal(3), reader.GetString(4), reader.GetString(5)));
        }

        return rows;
    }

    private static async Task<DashboardStart> B6StartAsync(HttpClient coach, Guid clientId) =>
        (await ReadSliceAsync<ProgressDashboardView>(coach, B6DashboardUrl(clientId))).Bodyweight.Start
        ?? throw new AssertFailedException("A coach's dashboard carried no start part.");

    private static string B6ProgressUrl(Guid clientId, DateOnly day) =>
        $"/api/progress/clients/{clientId}?displayUnit=Kilogram&from={Iso(day)}&to={Iso(day.AddDays(1))}";

    private static object B6Correction(decimal value, DateOnly day, string reason, uint version) =>
        new { value, unit = "Kilogram", measurementDate = Iso(day), reason, version };

    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<string?> B6CodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static async Task<BodyweightObservationView> B6WeighInAsync(HttpClient client, DateOnly day, decimal kilograms)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync(
            "/api/progress/me/bodyweight",
            new { value = kilograms, unit = "Kilogram", measurementDate = Iso(day) });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<BodyweightObservationView>(response);
    }

    /// <summary>The intake's last step, "Where you start", sent by the client.</summary>
    private static async Task B6CompleteOnboardingAsync(HttpClient client, string firstName, decimal weight, string unit, DateOnly day)
    {
        var profile = await client.GetFromJsonAsync<A8OwnProfile>("/api/client-profile/me")
            ?? throw new AssertFailedException("The client's profile was empty.");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/client-profile/me/complete-onboarding", B6Onboarding(firstName, profile.Version, weight, unit, day)),
            HttpStatusCode.OK);
    }

    /// <summary>The same step filled in by the coach for their client.</summary>
    private static async Task B6CoachCompletesOnboardingAsync(HttpClient coach, Guid clientId, string firstName, decimal weight, DateOnly day)
    {
        var profile = await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/clients/{clientId}/complete-onboarding", B6Onboarding(firstName, profile.Version, weight, "Kilogram", day)),
            HttpStatusCode.OK);
    }

    private static object B6Onboarding(string firstName, uint version, decimal weight, string unit, DateOnly day) =>
        new
        {
            intake = new
            {
                firstName,
                lastName = "Client",
                phoneNumber = "+96170000000",
                birthDate = "1995-04-02",
                heightValue = 168m,
                heightUnit = "Centimeter",
                workType = "Office",
                averageDailySteps = 8000,
                trainingBackground = "Two years",
                foodPreferences = "Mediterranean",
                foodAversions = (string?)null,
                goals = "Build strength",
                allergies = (string?)null,
                medications = (string?)null,
                previousInjuries = (string?)null,
                version,
            },
            initialBodyweightValue = weight,
            initialBodyweightUnit = unit,
            measurementDate = Iso(day),
        };
}
