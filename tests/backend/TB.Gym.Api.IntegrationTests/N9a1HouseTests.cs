using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9a1, the house itself (CLI-022, CLI-023, CLI-025, CLI-026, ADR 0041), against PostgreSQL: the
/// command that marks one coaching space as the house, the guards the database keeps whoever writes, the platform
/// admin's settings with every change kept, the sweep of sign-ups never confirmed, what a self-directed trainee
/// raises on the staff's screens and in their inboxes (nothing), the age their intake keeps to, and the migration.
/// Every name and address here is invented, and every figure (the week's places, the ages) is the test's own.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9a1MarkSql = """UPDATE tenancy."Tenants" SET "IsHouse" = @mark WHERE "Id" = @id""";

    private const string N9a1InsertSettingSql =
        """
        INSERT INTO tenancy."HouseSettingChanges" ("Id", "TenantId", "Setting", "Sequence", "Value", "ChangedByUserId", "ChangedAtUtc")
        VALUES (gen_random_uuid(), @tenant, 'SignUpsPerWeek', 7, '5', @user, now())
        """;

    private const string N9a1InsertSignUpSql =
        """
        INSERT INTO tenancy."TraineeSignUps" ("Id", "TenantId", "UserId", "FirstName", "LastName", "BirthDate", "RequestedAtUtc")
        VALUES (gen_random_uuid(), @tenant, @user, 'Lina', 'Saad', DATE '1990-05-05', now())
        """;

    /// <summary>The two tables, the two columns, the six guards and the two unique indexes the migration makes.</summary>
    private const string N9a1SchemaSql =
        """
        SELECT
            (SELECT count(*) FROM information_schema.tables
             WHERE table_schema = 'tenancy' AND table_name IN ('HouseSettingChanges', 'TraineeSignUps'))
          + (SELECT count(*) FROM information_schema.columns
             WHERE (table_schema = 'tenancy' AND table_name = 'Tenants' AND column_name = 'IsHouse')
                OR (table_schema = 'clients' AND table_name = 'ClientProfiles' AND column_name = 'IsSelfDirected'))
          + (SELECT count(*) FROM pg_trigger
             WHERE NOT tgisinternal AND tgname IN (
                 'TR_Tenants_HouseMark', 'TR_HouseSettingChanges_House', 'TR_TraineeSignUps_House',
                 'TR_HouseSettingChanges_AppendOnly', 'TR_TraineeSignUps_Protect', 'TR_ClientProfiles_SelfDirectedInHouse'))
          + (SELECT count(*) FROM pg_indexes WHERE indexname IN ('UX_Tenants_House', 'UX_TraineeSignUps_Waiting'))
        """;

    /// <summary>Whether a client's coach history may start with a sign-up, as the database's own check reads.</summary>
    private const string N9a1SignUpReasonSql =
        """
        SELECT count(*) FROM pg_constraint
        WHERE conname = 'CK_ClientCoachAssignments_Chain' AND pg_get_constraintdef(oid) LIKE '%SignUp%'
        """;

    private static readonly string[] N9a1BothSettings = [N9a1PlacesSetting, N9a1AgeSetting];

    private static readonly string[] N9a1ValueField = ["value"];

    private static readonly string[] N9a1IntakeField = ["intake"];

    private static readonly string[] N9a1OnboardingField = ["onboarding"];

    private static readonly HttpStatusCode[] N9a1OneSavedOneRefused = [HttpStatusCode.OK, HttpStatusCode.Conflict];

    private static readonly CoachAttentionKind[] N9a1NoPlanAlone = [CoachAttentionKind.NoPlan];

    /// <summary>Invented words found nowhere else in a run, so a log line that held one would be the intake's.</summary>
    private static readonly N9a1Health N9a1HealthMarkers = new(
        "n9a1-marker-allergy-quince-7319",
        "n9a1-marker-medication-zolvane-4157",
        "n9a1-marker-injury-patella-9283");

    // ---------- 1. the command ----------

    [TestMethod]
    public async Task N9a1TheHouseCommandMarksOneSpaceByItsSlugOrItsIdAndRefusesASecond()
    {
        using var first = CreateClient();
        var firstId = await RegisterCoachAsync(first, "n9a1-cmd-first@example.test", "Nour Haddad", "N9a1 Cmd First");
        using var second = CreateClient();
        var secondId = await RegisterCoachAsync(second, "n9a1-cmd-second@example.test", "Omar Nasser", "N9a1 Cmd Second");
        var firstSlug = await N9a1SlugAsync(first, firstId);
        var secondSlug = await N9a1SlugAsync(second, secondId);

        // No migration and no registration marks a coaching space.
        Assert.AreEqual((0, "No coaching space is the house."), await N9a1HouseCommandAsync());
        Assert.IsEmpty(await N9a1MarkedAsync());

        // A slug and an id no coaching space has.
        foreach (var unknown in new[] { "n9a1-no-such-space", Guid.NewGuid().ToString() })
        {
            Assert.AreEqual((2, "No coaching space has that slug or id."), await N9a1HouseCommandAsync("set", unknown), unknown);
        }

        Assert.IsEmpty(await N9a1MarkedAsync());

        // By its slug: marked, and the command says that marking opens nothing.
        var marked = await N9a1HouseCommandAsync("set", firstSlug);
        Assert.AreEqual(0, marked.Code, marked.Said);
        Assert.Contains($"N9a1 Cmd First ({firstSlug}) is the house.", marked.Said);
        Assert.Contains("Sign-up stays closed", marked.Said);
        CollectionAssert.AreEqual(new[] { firstId }, await N9a1MarkedAsync());
        Assert.AreEqual((0, $"N9a1 Cmd First ({firstSlug}) is the house."), await N9a1HouseCommandAsync());
        using var visitor = CreateClient();
        Assert.AreEqual("Closed", (await N9a1StatusAsync(visitor)).Status);

        // Again, typed in capitals with spaces around it, and by its id: still 0, and still the one row.
        foreach (var again in new[] { firstSlug, $"  {firstSlug.ToUpperInvariant()} ", firstId.ToString(), firstId.ToString("N").ToUpperInvariant() })
        {
            var repeated = await N9a1HouseCommandAsync("set", again);
            Assert.AreEqual(0, repeated.Code, $"{again}: {repeated.Said}");
            CollectionAssert.AreEqual(new[] { firstId }, await N9a1MarkedAsync(), again);
        }

        // A second space, by its slug and by its id: refused, naming the one that is the house.
        foreach (var other in new[] { secondSlug, secondId.ToString() })
        {
            var refused = await N9a1HouseCommandAsync("set", other);
            Assert.AreEqual(2, refused.Code, refused.Said);
            Assert.Contains($"N9a1 Cmd First ({firstSlug}) is already the house.", refused.Said);
            Assert.Contains("house clear", refused.Said);
            CollectionAssert.AreEqual(new[] { firstId }, await N9a1MarkedAsync(), other);
        }

        // Once the first is cleared, the second is marked by its id.
        Assert.AreEqual((0, $"N9a1 Cmd First ({firstSlug}) is no longer the house."), await N9a1HouseCommandAsync("clear"));
        Assert.IsEmpty(await N9a1MarkedAsync());
        var byId = await N9a1HouseCommandAsync("set", secondId.ToString());
        Assert.AreEqual(0, byId.Code, byId.Said);
        CollectionAssert.AreEqual(new[] { secondId }, await N9a1MarkedAsync());
        Assert.AreEqual((0, $"N9a1 Cmd Second ({secondSlug}) is the house."), await N9a1HouseCommandAsync());

        // Too few words, too many, or a word the command does not know: the usage, and nothing moves.
        foreach (var words in new[]
        {
            new[] { "set" },
            ["set", firstSlug, "extra"],
            ["clear", "now"],
            ["mark", firstSlug],
            ["list"],
            ["set", string.Empty, firstSlug],
        })
        {
            var usage = await N9a1HouseCommandAsync(words);
            var typed = string.Join(' ', words);
            Assert.AreEqual(2, usage.Code, typed);
            Assert.Contains("Usage: platform-admin grant <email>", usage.Said, typed);
            Assert.Contains("platform-admin house set <slug or id> | platform-admin house clear", usage.Said, typed);
            CollectionAssert.AreEqual(new[] { secondId }, await N9a1MarkedAsync(), typed);
        }
    }

    [TestMethod]
    public async Task N9a1TheHouseCommandClearsAnEmptyHouseAndKeepsTheMarkOfOneThatHoldsASignUp()
    {
        // With no house there is nothing to clear, and saying so is not a failure.
        Assert.AreEqual((0, "No coaching space is the house."), await N9a1HouseCommandAsync("clear"));

        // A house whose settings were filled and that nobody signed up into is cleared.
        using var house = await N9a1OpenHouseAsync("clear");
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);
        using var visitor = CreateClient();
        Assert.AreEqual("Open", (await N9a1StatusAsync(visitor)).Status);
        Assert.AreEqual((0, $"{house.Name} ({slug}) is no longer the house."), await N9a1HouseCommandAsync("clear"));
        Assert.IsEmpty(await N9a1MarkedAsync());
        var cleared = await N9a1HouseReadAsync(house.Admin);
        Assert.IsNull(cleared.House);
        Assert.IsEmpty(cleared.Settings);
        Assert.IsNull(cleared.SignUp);
        Assert.AreEqual("Closed", (await N9a1StatusAsync(visitor)).Status);
        var closed = await N9a1SignUpAsync(visitor, "n9a1-clear-early@example.test");
        Assert.AreEqual("trainee_sign_up_closed", (await N9a1AnswerAsync(closed, HttpStatusCode.Conflict)).Code);

        // Marked a second time, the space has the settings it was given before (they are append-only): the command
        // says sign-up is open instead of promising it stays closed, and it is.
        var changes = await N9a1StoredChangesAsync(house.TenantId);
        Assert.HasCount(2, changes);
        var again = await N9a1HouseCommandAsync("set", slug);
        Assert.AreEqual(0, again.Code, again.Said);
        Assert.Contains($"{house.Name} ({slug}) is the house.", again.Said);
        Assert.Contains("sign-up is open", again.Said);
        Assert.DoesNotContain("Sign-up stays closed", again.Said);
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());
        Assert.AreEqual("Open", (await N9a1StatusAsync(visitor)).Status);
        var marked = await N9a1HouseReadAsync(house.Admin);
        Assert.AreEqual(house.TenantId, marked.House!.TenantId);
        Assert.AreEqual((N9a1Places, 1), (marked.Settings[0].Value, marked.Settings[0].Version));
        Assert.AreEqual((N9a1Age, 1), (marked.Settings[1].Value, marked.Settings[1].Version));
        CollectionAssert.AreEqual(changes, await N9a1StoredChangesAsync(house.TenantId), "Marking again wrote no setting.");

        // Open, a person signs up and waits for their email: the house keeps its mark.
        var waiting = await N9a1SignUpAsync(visitor, "n9a1-clear-waits@example.test");
        await AssertStatusAsync(waiting, HttpStatusCode.Accepted);
        var keeps = (2, $"{house.Name} ({slug}) holds sign-ups or self-directed trainees and keeps its mark.");
        Assert.AreEqual(keeps, await N9a1HouseCommandAsync("clear"));
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());

        // Confirmed, the trainee holds it as well; the house is still the house and still open.
        var link = (await RequiredJsonAsync<N9a1Answer>(waiting)).DevelopmentConfirmationUrl!;
        await AssertStatusAsync(await N9a1ConfirmAsync(visitor, link), HttpStatusCode.NoContent);
        Assert.AreEqual(keeps, await N9a1HouseCommandAsync("clear"));
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());
        Assert.AreEqual((0, $"{house.Name} ({slug}) is the house."), await N9a1HouseCommandAsync());
        Assert.AreEqual("Open", (await N9a1StatusAsync(visitor)).Status);
    }

    // ---------- 2. the database's own guards ----------

    [TestMethod]
    public async Task N9a1TheDatabaseKeepsOneHouseItsRowsAndItsMarkWhoeverWrites()
    {
        using var house = await N9a1OpenHouseAsync("guard");
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9a1-guard-other@example.test", "Zeina Aoun", "N9a1 Guard Zeina Gym");
        using var coached = CreateClient();
        var coachedId = await InviteAndAcceptAsync(otherOwner, coached, "n9a1-guard-coached@example.test", true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-guard-trainee@example.test");
        using var visitor = CreateClient();
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, "n9a1-guard-waits@example.test"), HttpStatusCode.Accepted);
        var waiting = await N9a1PersonAsync("n9a1-guard-waits@example.test");
        var waitingRow = waiting.SignUps.Single();
        var confirmedRow = (await N9a1PersonAsync("n9a1-guard-trainee@example.test")).SignUps.Single();
        Assert.IsNotNull(confirmedRow.ConfirmedAtUtc);
        var changesBefore = await N9a1StoredChangesAsync(house.TenantId);

        // A second coaching space marked beside the house.
        var second = await N9a1RefusedBySqlAsync(N9a1MarkSql, ("mark", true), ("id", otherSpace));
        Assert.AreEqual(("23505", "UX_Tenants_House"), (second.SqlState, second.ConstraintName));

        // The mark taken away while the house holds sign-ups and a self-directed trainee.
        var unmarked = await N9a1RefusedBySqlAsync(N9a1MarkSql, ("mark", false), ("id", house.TenantId));
        Assert.AreEqual(
            ("55000", "The house holds sign-ups or self-directed trainees and keeps its mark"),
            (unmarked.SqlState, unmarked.MessageText));

        // A setting's change and a sign-up written for a coaching space that is not the house.
        var setting = await N9a1RefusedBySqlAsync(N9a1InsertSettingSql, ("tenant", otherSpace), ("user", house.OwnerUserId));
        Assert.AreEqual(("23514", "HouseSettingChanges rows belong to the house alone"), (setting.SqlState, setting.MessageText));
        var signUp = await N9a1RefusedBySqlAsync(N9a1InsertSignUpSql, ("tenant", otherSpace), ("user", trainee.UserId));
        Assert.AreEqual(("23514", "TraineeSignUps rows belong to the house alone"), (signUp.SqlState, signUp.MessageText));

        // A coach's client marked self-directed.
        var selfDirected = await N9a1RefusedBySqlAsync(
            """UPDATE clients."ClientProfiles" SET "IsSelfDirected" = true WHERE "Id" = @id""",
            ("id", coachedId));
        Assert.AreEqual(("23514", "Only the house has self-directed trainees"), (selfDirected.SqlState, selfDirected.MessageText));

        // A setting's change edited, and deleted.
        foreach (var sql in new[]
        {
            """UPDATE tenancy."HouseSettingChanges" SET "Value" = '99' WHERE "TenantId" = @id""",
            """UPDATE tenancy."HouseSettingChanges" SET "ChangedAtUtc" = "ChangedAtUtc" - interval '1 day' WHERE "TenantId" = @id""",
            """DELETE FROM tenancy."HouseSettingChanges" WHERE "TenantId" = @id""",
        })
        {
            var appendOnly = await N9a1RefusedBySqlAsync(sql, ("id", house.TenantId));
            Assert.AreEqual(("55000", "HouseSettingChanges is append-only"), (appendOnly.SqlState, appendOnly.MessageText), sql);
        }

        // A confirmed sign-up deleted, and changed.
        var deleted = await N9a1RefusedBySqlAsync("""DELETE FROM tenancy."TraineeSignUps" WHERE "Id" = @id""", ("id", confirmedRow.Id));
        Assert.AreEqual(("55000", "A confirmed sign-up is never deleted"), (deleted.SqlState, deleted.MessageText));
        foreach (var sql in new[]
        {
            """UPDATE tenancy."TraineeSignUps" SET "RequestedAtUtc" = "RequestedAtUtc" - interval '1 day' WHERE "Id" = @id""",
            """UPDATE tenancy."TraineeSignUps" SET "ConfirmedAtUtc" = "ConfirmedAtUtc" + interval '1 day' WHERE "Id" = @id""",
        })
        {
            var changed = await N9a1RefusedBySqlAsync(sql, ("id", confirmedRow.Id));
            Assert.AreEqual(("55000", "A sign-up can only be confirmed, once"), (changed.SqlState, changed.MessageText), sql);
        }

        // A waiting sign-up may only be confirmed: its typed name is not edited, and it is not made to look newer,
        // which would keep it from the sweep.
        foreach (var sql in new[]
        {
            """UPDATE tenancy."TraineeSignUps" SET "FirstName" = 'Somebody' WHERE "Id" = @id""",
            """UPDATE tenancy."TraineeSignUps" SET "RequestedAtUtc" = "RequestedAtUtc" + interval '1 day' WHERE "Id" = @id""",
        })
        {
            var edited = await N9a1RefusedBySqlAsync(sql, ("id", waitingRow.Id));
            Assert.AreEqual(("55000", "A sign-up can only be confirmed, once"), (edited.SqlState, edited.MessageText), sql);
        }

        // A second waiting sign-up for the one account, in the house itself.
        var twice = await N9a1RefusedBySqlAsync(N9a1InsertSignUpSql, ("tenant", house.TenantId), ("user", waiting.UserId!.Value));
        Assert.AreEqual(("23505", "UX_TraineeSignUps_Waiting"), (twice.SqlState, twice.ConstraintName));

        // Every refusal left what was there: one house, its two changes, the trainee's row and the waiting one.
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());
        CollectionAssert.AreEqual(changesBefore, await N9a1StoredChangesAsync(house.TenantId));
        Assert.HasCount(2, changesBefore);
        Assert.AreEqual(2, await N9a1SignUpRowsAsync());
        Assert.AreEqual(confirmedRow, (await N9a1PersonAsync("n9a1-guard-trainee@example.test")).SignUps.Single());
        Assert.AreEqual(waitingRow, (await N9a1PersonAsync("n9a1-guard-waits@example.test")).SignUps.Single());
        Assert.AreEqual(1, await N9a1ProfilesInAsync(otherSpace), "The other space keeps its one client.");
        Assert.IsFalse((await N9a1PersonAsync("n9a1-guard-coached@example.test")).Profiles.Single().IsSelfDirected);

        // The waiting one may be deleted, which is how a sign-up never confirmed is removed.
        await Phase6ExecuteAsync("""DELETE FROM tenancy."TraineeSignUps" WHERE "Id" = @id""", ("id", waitingRow.Id));
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
        Assert.IsEmpty((await N9a1PersonAsync("n9a1-guard-waits@example.test")).SignUps);
    }

    [TestMethod]
    public async Task N9a1TheMarkIsKeptByAWaitingSignUpAloneAndByASelfDirectedProfileAlone()
    {
        using var house = await N9a1OpenHouseAsync("held");
        using var visitor = CreateClient();
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, "n9a1-held-waits@example.test"), HttpStatusCode.Accepted);
        var waitingRow = (await N9a1PersonAsync("n9a1-held-waits@example.test")).SignUps.Single();
        Assert.AreEqual(0, await N9a1ProfilesInAsync(house.TenantId));

        // One sign-up still waiting for its email, and no profile at all: the mark stays.
        var bySignUp = await N9a1RefusedBySqlAsync(N9a1MarkSql, ("mark", false), ("id", house.TenantId));
        Assert.AreEqual("55000", bySignUp.SqlState, bySignUp.MessageText);

        // With that sign-up gone the house holds nobody, and the same statement goes through.
        await Phase6ExecuteAsync("""DELETE FROM tenancy."TraineeSignUps" WHERE "Id" = @id""", ("id", waitingRow.Id));
        await Phase6ExecuteAsync(N9a1MarkSql, ("mark", false), ("id", house.TenantId));
        Assert.IsEmpty(await N9a1MarkedAsync());
        await Phase6ExecuteAsync(N9a1MarkSql, ("mark", true), ("id", house.TenantId));
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());

        // A self-directed profile with no sign-up row beside it (written here as no route can): the mark stays.
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Owner, rita, house.TenantId, "n9a1-held-rita@example.test", "Rita", "Daher");
        await Phase6ExecuteAsync("""UPDATE clients."ClientProfiles" SET "IsSelfDirected" = true WHERE "Id" = @id""", ("id", ritaId));
        Assert.IsTrue((await N9a1PersonAsync("n9a1-held-rita@example.test")).Profiles.Single().IsSelfDirected);
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());
        var byProfile = await N9a1RefusedBySqlAsync(N9a1MarkSql, ("mark", false), ("id", house.TenantId));
        Assert.AreEqual(
            ("55000", "The house holds sign-ups or self-directed trainees and keeps its mark"),
            (byProfile.SqlState, byProfile.MessageText));
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());
    }

    // ---------- 3. the settings ----------

    [TestMethod]
    public async Task N9a1TheHousesSettingsStartEmptyAndEveryChangeIsKeptWithWhoMadeItAndWhen()
    {
        // A whole minute, so the instants the database keeps read back exactly.
        var start = new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero);
        RequiredTestClock.Set(start);
        using var maya = await N9a1AdminAsync("n9a1-kept-maya@example.test", "Maya Farah");
        var mayaId = await N9a1UserIdAsync(maya);
        using var rami = await N9a1AdminAsync("n9a1-kept-rami@example.test", "Rami Saade");
        var ramiId = await N9a1UserIdAsync(rami);

        // No coaching space is the house: the read says so, and there is no setting to change.
        var none = await N9a1HouseReadAsync(maya);
        Assert.IsNull(none.House);
        Assert.IsEmpty(none.Settings);
        Assert.IsNull(none.SignUp);
        foreach (var name in N9a1BothSettings)
        {
            var refused = await N9a1PutSettingAsync(maya, name, "29", 0);
            Assert.AreEqual("house_not_set", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code, name);
        }

        // Marked, the house has both settings, empty, at version 0, changed by nobody.
        using var owner = CreateClient();
        var houseId = await RegisterCoachAsync(owner, "n9a1-kept-owner@example.test", "Nour Haddad", "N9a1 Kept House");
        await N9a1MarkHouseAsync(owner, houseId);
        var empty = await N9a1HouseReadAsync(maya);
        Assert.AreEqual(
            new N9a1HouseSpace(houseId, "N9a1 Kept House", await N9a1SlugAsync(owner, houseId), "Asia/Beirut", "Monday", new DateOnly(2026, 11, 11)),
            empty.House);
        CollectionAssert.AreEqual(
            new[]
            {
                new N9a1HouseSetting(N9a1PlacesSetting, null, 0, null, null, null),
                new N9a1HouseSetting(N9a1AgeSetting, null, 0, null, null, null),
            },
            empty.Settings);
        Assert.AreEqual("Closed", empty.SignUp!.Status);
        Assert.IsEmpty(await N9a1StoredChangesAsync(houseId));

        // Maya fills the week's places: change 1, hers, at that minute; the read shows it.
        var first = start.AddMinutes(10);
        RequiredTestClock.Set(first);
        var placesOne = new N9a1HouseSetting(N9a1PlacesSetting, "41", 1, first, mayaId, "Maya Farah");
        Assert.AreEqual(placesOne, await N9a1ChangedAsync(maya, N9a1PlacesSetting, "41", 0));
        Assert.AreEqual(placesOne, (await N9a1HouseReadAsync(rami)).Settings.Single(item => item.Setting == N9a1PlacesSetting));

        // Rami changes it twenty minutes later: change 2, his. Maya fills the age: its own change 1.
        var second = start.AddMinutes(30);
        RequiredTestClock.Set(second);
        var placesTwo = new N9a1HouseSetting(N9a1PlacesSetting, "43", 2, second, ramiId, "Rami Saade");
        Assert.AreEqual(placesTwo, await N9a1ChangedAsync(rami, N9a1PlacesSetting, "43", 1));
        var third = start.AddMinutes(45);
        RequiredTestClock.Set(third);
        var ageOne = new N9a1HouseSetting(N9a1AgeSetting, "21", 1, third, mayaId, "Maya Farah");
        Assert.AreEqual(ageOne, await N9a1ChangedAsync(maya, N9a1AgeSetting, "21", 0));
        using var visitor = CreateClient();
        var open = await N9a1StatusAsync(visitor);
        Assert.AreEqual(("Open", (int?)21), (open.Status, open.MinimumAge));

        // A page that read the setting before Rami's change, or that names a change still to come: refused, nothing kept.
        RequiredTestClock.Set(start.AddMinutes(50));
        foreach (var stale in new[] { 0, 1, 3 })
        {
            var refused = await N9a1PutSettingAsync(maya, N9a1PlacesSetting, "47", stale);
            Assert.AreEqual("house_setting_changed", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code, $"Version {stale}.");
        }

        Assert.HasCount(3, await N9a1StoredChangesAsync(houseId));

        // The value that already stands, however it is typed: answered as it stands, Rami's still, and nothing kept.
        foreach (var same in new[] { "43", "  43 ", "043" })
        {
            Assert.AreEqual(placesTwo, await N9a1ChangedAsync(maya, N9a1PlacesSetting, same, 2), same);
        }

        Assert.HasCount(3, await N9a1StoredChangesAsync(houseId));

        // A blank value empties the setting, as a change of its own, and sign-up closes.
        var fourth = start.AddMinutes(55);
        RequiredTestClock.Set(fourth);
        var placesThree = new N9a1HouseSetting(N9a1PlacesSetting, null, 3, fourth, mayaId, "Maya Farah");
        Assert.AreEqual(placesThree, await N9a1ChangedAsync(maya, N9a1PlacesSetting, "   ", 2));
        Assert.AreEqual("Closed", (await N9a1StatusAsync(visitor)).Status);
        Assert.AreEqual("Closed", (await N9a1HouseReadAsync(maya)).SignUp!.Status);
        // Empty again, as null and as nothing typed: it already is.
        foreach (var blank in new[] { null, string.Empty })
        {
            Assert.AreEqual(placesThree, await N9a1ChangedAsync(rami, N9a1PlacesSetting, blank, 3));
        }

        // Every change is there, in the order made, each with who made it and when; none was written over.
        CollectionAssert.AreEqual(
            new[]
            {
                new N9a1StoredChange(N9a1PlacesSetting, 1, "41", mayaId, first),
                new N9a1StoredChange(N9a1PlacesSetting, 2, "43", ramiId, second),
                new N9a1StoredChange(N9a1PlacesSetting, 3, null, mayaId, fourth),
                new N9a1StoredChange(N9a1AgeSetting, 1, "21", mayaId, third),
            },
            await N9a1StoredChangesAsync(houseId));
        CollectionAssert.AreEqual(new[] { placesThree, ageOne }, (await N9a1HouseReadAsync(rami)).Settings);
    }

    [TestMethod]
    public async Task N9a1AHouseSettingRefusesWhatItCannotHoldAndAWriteWithoutTheAntiforgeryToken()
    {
        using var house = await N9a1OpenHouseAsync("refuse");
        var kept = await N9a1StoredChangesAsync(house.TenantId);
        Assert.HasCount(2, kept);

        // The age: under 18, over 100, and anything that is not a whole number.
        foreach (var value in new[] { "17", "0", "101", "-19", "19.5", "nineteen", "1e2", "19 years" })
        {
            var refused = await N9a1PutSettingAsync(house.Admin, N9a1AgeSetting, value, 1);
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            var problem = await RequiredJsonAsync<N9a1Problem>(refused);
            CollectionAssert.AreEqual(N9a1ValueField, problem.Errors.Keys.ToArray(), value);
            Assert.AreEqual(HouseSettingRule.MinimumSignUpAgeRefusal, problem.Errors["value"].Single(), value);
        }

        // The week's places: over 10,000, under 0, and anything that is not a whole number.
        foreach (var value in new[] { "10001", "-1", "3.5", "many", "1,000", "0000000041" })
        {
            var refused = await N9a1PutSettingAsync(house.Admin, N9a1PlacesSetting, value, 1);
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            var problem = await RequiredJsonAsync<N9a1Problem>(refused);
            CollectionAssert.AreEqual(N9a1ValueField, problem.Errors.Keys.ToArray(), value);
            Assert.AreEqual(HouseSettingRule.SignUpsPerWeekRefusal, problem.Errors["value"].Single(), value);
        }

        // A setting the house does not have.
        await AssertStatusAsync(await N9a1PutSettingAsync(house.Admin, "99", "5", 0), HttpStatusCode.NotFound);

        // No antiforgery token (the session's cookie kept): refused before anything is read.
        house.Admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var noToken = await house.Admin.PutAsJsonAsync(
            $"{N9a1HouseUrl}/settings/{N9a1PlacesSetting}",
            new { value = "53", expectedVersion = 1 });
        Assert.AreEqual("antiforgery_token_invalid", (await N9a1AnswerAsync(noToken, HttpStatusCode.BadRequest)).Code);

        // None of it was kept: the house's settings and its sign-up stand as they were.
        CollectionAssert.AreEqual(kept, await N9a1StoredChangesAsync(house.TenantId));
        var read = await N9a1HouseReadAsync(house.Admin);
        Assert.AreEqual((N9a1Places, 1), (read.Settings[0].Value, read.Settings[0].Version));
        Assert.AreEqual((N9a1Age, 1), (read.Settings[1].Value, read.Settings[1].Version));

        // The ends of each range are taken, each as the next change.
        var version = 1;
        foreach (var value in new[] { "18", "100" })
        {
            var saved = await N9a1ChangedAsync(house.Admin, N9a1AgeSetting, value, version);
            version++;
            Assert.AreEqual((value, version), (saved.Value, saved.Version));
        }

        version = 1;
        foreach (var value in new[] { "10000", "0" })
        {
            var saved = await N9a1ChangedAsync(house.Admin, N9a1PlacesSetting, value, version);
            version++;
            Assert.AreEqual((value, version), (saved.Value, saved.Version));
        }

        Assert.HasCount(6, await N9a1StoredChangesAsync(house.TenantId));
        // A week of no places is a closed sign-up.
        using var visitor = CreateClient();
        Assert.AreEqual("Closed", (await N9a1StatusAsync(visitor)).Status);
    }

    [TestMethod]
    public async Task N9a1TwoAdminsSavingOneSettingAtOnceFromOneVersionLeaveOneChange()
    {
        using var house = await N9a1OpenHouseAsync("race");
        var adminId = await N9a1UserIdAsync(house.Admin);
        using var other = await N9a1AdminAsync("n9a1-race-second@example.test", "Rami Saade");
        var otherId = await N9a1UserIdAsync(other);
        var url = $"{N9a1HouseUrl}/settings/{N9a1PlacesSetting}";

        // Three rounds, each from the version both pages read.
        var version = 1;
        for (var round = 1; round <= 3; round++)
        {
            var (mine, theirs) = ($"{40 + round}", $"{50 + round}");
            await RefreshCsrfAsync(house.Admin);
            await RefreshCsrfAsync(other);
            var answers = await Task.WhenAll(
                house.Admin.PutAsJsonAsync(url, new { value = mine, expectedVersion = version }),
                other.PutAsJsonAsync(url, new { value = theirs, expectedVersion = version }));
            CollectionAssert.AreEquivalent(N9a1OneSavedOneRefused, answers.Select(item => item.StatusCode).ToArray(), $"Round {round}.");
            var refused = answers.Single(item => item.StatusCode == HttpStatusCode.Conflict);
            Assert.AreEqual("house_setting_changed", (await N9a1AnswerAsync(refused, HttpStatusCode.Conflict)).Code);

            // The one that was saved is the next change, its own value under its own name.
            version++;
            var saved = await RequiredJsonAsync<N9a1HouseSetting>(answers.Single(item => item.StatusCode == HttpStatusCode.OK));
            var winner = answers[0].StatusCode == HttpStatusCode.OK ? (mine, adminId) : (theirs, otherId);
            Assert.AreEqual((winner.Item1, version, (Guid?)winner.Item2), (saved.Value, saved.Version, saved.ChangedByUserId), $"Round {round}.");
            var stored = (await N9a1StoredChangesAsync(house.TenantId)).Where(item => item.Setting == N9a1PlacesSetting).ToArray();
            Assert.HasCount(version, stored, $"Round {round}: one change, not two.");
            Assert.AreEqual((version, saved.Value, winner.Item2), (stored[^1].Sequence, stored[^1].Value, stored[^1].ChangedByUserId));
            Assert.AreEqual(saved, (await N9a1HouseReadAsync(other)).Settings.Single(item => item.Setting == N9a1PlacesSetting));
        }
    }

    [TestMethod]
    public async Task N9a1TheAdminsReadSaysWhereTheWeeksSignUpStands()
    {
        // Wednesday 11 November 2026, 11:00 in Beirut: the house's week runs Monday the 9th to Monday the 16th.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
        using var house = await N9a1OpenHouseAsync("stands", signUpsPerWeek: null, minimumAge: null);
        var thisWeek = (new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 16));

        // Marked and nothing filled: closed, with the week it would count over and nobody in it.
        var read = await N9a1HouseReadAsync(house.Admin);
        Assert.AreEqual(new N9a1HouseWeek("Closed", thisWeek.Item1, thisWeek.Item2, 0, 0), read.SignUp);
        Assert.AreEqual((house.TenantId, house.Name, new DateOnly(2026, 11, 11)), (read.House!.TenantId, read.House.Name, read.House.CurrentDate));

        // Both filled, three places a week: open.
        await N9a1SettingAsync(house.Admin, N9a1AgeSetting, N9a1Age);
        await N9a1SettingAsync(house.Admin, N9a1PlacesSetting, "3");
        Assert.AreEqual(new N9a1HouseWeek("Open", thisWeek.Item1, thisWeek.Item2, 0, 0), (await N9a1HouseReadAsync(house.Admin)).SignUp);

        // One trainee confirmed and one sign-up waiting: one of the week's three places is taken, and one waits.
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-stands-first@example.test");
        using var visitor = CreateClient();
        var waits = await N9a1SignUpAsync(visitor, "n9a1-stands-waits-1@example.test");
        await AssertStatusAsync(waits, HttpStatusCode.Accepted);
        var waitsLink = (await RequiredJsonAsync<N9a1Answer>(waits)).DevelopmentConfirmationUrl!;
        Assert.AreEqual(new N9a1HouseWeek("Open", thisWeek.Item1, thisWeek.Item2, 1, 1), (await N9a1HouseReadAsync(house.Admin)).SignUp);

        // Three more wait: more waiting than the week has places, and still one place taken and the week open.
        foreach (var number in new[] { 2, 3, 4 })
        {
            await AssertStatusAsync(await N9a1SignUpAsync(visitor, $"n9a1-stands-waits-{number}@example.test"), HttpStatusCode.Accepted);
        }

        Assert.AreEqual(new N9a1HouseWeek("Open", thisWeek.Item1, thisWeek.Item2, 1, 4), (await N9a1HouseReadAsync(house.Admin)).SignUp);
        Assert.AreEqual("Open", (await N9a1StatusAsync(visitor)).Status);

        // Two more confirm and take the last places: full, with the four still waiting.
        using var second = await N9a1TraineeAsync(house.TenantId, "n9a1-stands-second@example.test");
        using var third = await N9a1TraineeAsync(house.TenantId, "n9a1-stands-third@example.test");
        Assert.AreEqual(new N9a1HouseWeek("Full", thisWeek.Item1, thisWeek.Item2, 3, 4), (await N9a1HouseReadAsync(house.Admin)).SignUp);
        Assert.AreEqual("Full", (await N9a1StatusAsync(visitor)).Status);

        // One of the four confirms their email into the full week: no place more is taken, and it still waits.
        await AssertStatusAsync(await N9a1ConfirmAsync(visitor, waitsLink), HttpStatusCode.NoContent);
        Assert.IsTrue((await N9a1PersonAsync("n9a1-stands-waits-1@example.test")).EmailConfirmed);
        Assert.AreEqual(new N9a1HouseWeek("Full", thisWeek.Item1, thisWeek.Item2, 3, 4), (await N9a1HouseReadAsync(house.Admin)).SignUp);

        // The admin raises the week's places: open again in the same week.
        await N9a1SettingAsync(house.Admin, N9a1PlacesSetting, "5");
        Assert.AreEqual(new N9a1HouseWeek("Open", thisWeek.Item1, thisWeek.Item2, 3, 4), (await N9a1HouseReadAsync(house.Admin)).SignUp);

        // A week later the count starts again; the four that took no place are still waiting, whichever week they asked in.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var next = await N9a1HouseReadAsync(house.Admin);
        Assert.AreEqual(new N9a1HouseWeek("Open", new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 23), 0, 4), next.SignUp);
        Assert.AreEqual(new DateOnly(2026, 11, 18), next.House!.CurrentDate);

        // A form sent and confirmed in the new week waits and then takes that week's first place; the four wait on.
        using var late = CreateClient();
        var lateResponse = await N9a1SignUpAsync(late, "n9a1-stands-late@example.test");
        await AssertStatusAsync(lateResponse, HttpStatusCode.Accepted);
        Assert.AreEqual(5, (await N9a1HouseReadAsync(house.Admin)).SignUp!.WaitingForConfirmation);
        await AssertStatusAsync(
            await N9a1ConfirmAsync(late, (await RequiredJsonAsync<N9a1Answer>(lateResponse)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        Assert.AreEqual(
            new N9a1HouseWeek("Open", new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 23), 1, 4),
            (await N9a1HouseReadAsync(house.Admin)).SignUp);
    }

    // ---------- 4. the sweep ----------

    [TestMethod]
    public async Task N9a1TheSweepRemovesASignUpNeverConfirmedEmptiesItsAccountAndTouchesNothingElse()
    {
        // A whole minute on a Monday morning in Beirut, so the instants the database keeps read back exactly.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 2, 7, 0, 0, TimeSpan.Zero));
        using var house = await N9a1OpenHouseAsync("sweep", withCoach: true);
        var terms = await A16aPublishAsync(house.Admin, "TermsOfService", "Platform", "n9a1-sweep-1", null);
        var consumer = await A16aPublishAsync(house.Admin, "ConsumerTerms", "Workspace", "n9a1-sweep-1", null);
        Guid[] asked = [terms.Id, consumer.Id];
        var days = RequiredFactory.Services.GetRequiredService<IOptions<TraineeSignUpOptions>>().Value.RemoveUnconfirmedAfterDays;
        Assert.AreEqual(new TraineeSignUpOptions().RemoveUnconfirmedAfterDays, days, "The test host sweeps on the default days.");

        // Three accounts made in the same minutes: a sign-up that will never be confirmed, a trainee who confirms,
        // and a coach whose own registration is never confirmed either.
        const string dueEmail = "n9a1-sweep-ottilie@example.test";
        using var due = CreateClient();
        var dueResponse = await N9a1SignUpAsync(due, dueEmail, "Ottilie", "Marchbanks", "1987-05-13", legalDocumentIds: asked);
        await AssertStatusAsync(dueResponse, HttpStatusCode.Accepted);
        var dueLink = (await RequiredJsonAsync<N9a1Answer>(dueResponse)).DevelopmentConfirmationUrl!;
        var dueBefore = await N9a1PersonAsync(dueEmail);
        var dueId = dueBefore.UserId!.Value;
        var dueAccountBefore = await N9a1AccountAsync(dueId);
        Assert.IsTrue(dueAccountBefore.HasPassword);
        var requestedAt = await N9a1RequestedAtAsync(dueBefore.SignUps.Single().Id);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-sweep-trainee@example.test", legalDocumentIds: asked);
        const string coachEmail = "n9a1-sweep-zeina@example.test";
        using var coach = CreateClient();
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync("/api/auth/register/coach", new
            {
                displayName = "Zeina Aoun",
                email = coachEmail,
                password = Password,
                workspaceName = "N9a1 Sweep Zeina Gym",
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
                legalDocumentIds = new[] { terms.Id },
            }),
            HttpStatusCode.Accepted);

        // A day later, a second sign-up that waits.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        const string recentEmail = "n9a1-sweep-caspian@example.test";
        using var recent = CreateClient();
        await AssertStatusAsync(
            await N9a1SignUpAsync(recent, recentEmail, "Caspian", "Thornbury", "1990-09-09", legalDocumentIds: asked),
            HttpStatusCode.Accepted);

        var traineeBefore = await N9a1PersonAsync("n9a1-sweep-trainee@example.test");
        var traineeAccount = await N9a1AccountAsync(trainee.UserId);
        var coachBefore = await N9a1PersonAsync(coachEmail);
        Assert.IsFalse(coachBefore.EmailConfirmed);
        var coachAccount = await N9a1AccountAsync(coachBefore.UserId!.Value);
        var recentBefore = await N9a1PersonAsync(recentEmail);
        var recentAccount = await N9a1AccountAsync(recentBefore.UserId!.Value);
        var houseKey = house.TenantId.ToString("N");
        var accepted = new[] { (terms.Id, "platform", (Guid?)null), (consumer.Id, houseKey, (Guid?)house.TenantId) };
        CollectionAssert.AreEquivalent(accepted, await A16aAcceptancesAsync(dueEmail));
        Assert.AreEqual(3, await N9a1SignUpRowsAsync());

        // To the second, the days are not over: nothing is due.
        RequiredTestClock.Set(requestedAt.AddDays(days));
        Assert.AreEqual(new TraineeSignUpSweepResult(0, 0), await N9a1SweepAsync());
        Assert.AreEqual(3, await N9a1SignUpRowsAsync());
        Assert.AreEqual(dueAccountBefore, await N9a1AccountAsync(dueId));

        // A second later the first sign-up has waited longer than the days: it alone is removed.
        RequiredTestClock.Advance(TimeSpan.FromSeconds(1));
        Assert.AreEqual(new TraineeSignUpSweepResult(1, 0), await N9a1SweepAsync());
        Assert.AreEqual(2, await N9a1SignUpRowsAsync());

        // Its account is emptied: an address nobody has, no name, no password, never confirmed, its stamp changed.
        var removedAddress = $"removed-{dueId:N}@signup.tbgym.invalid";
        var emptied = await N9a1AccountAsync(dueId);
        Assert.AreEqual(
            (removedAddress, removedAddress, removedAddress.ToUpperInvariant(), string.Empty, false, false),
            (emptied.Email, emptied.UserName, emptied.NormalizedEmail, emptied.DisplayName, emptied.HasPassword, emptied.EmailConfirmed));
        Assert.AreNotEqual(dueAccountBefore.SecurityStamp, emptied.SecurityStamp);
        Assert.IsNotNull(emptied.LockoutEnd, "The emptied account is locked out.");
        Assert.AreEqual(0, await N9a1AccountsAsync(dueEmail), "The email is nobody's again.");
        var left = await N9a1PersonAsync(removedAddress);
        Assert.AreEqual(dueId, left.UserId);
        Assert.IsEmpty(left.SignUps);
        Assert.IsEmpty(left.Memberships);
        Assert.IsEmpty(left.Profiles);
        // What it accepted is append-only and stays with the emptied account.
        CollectionAssert.AreEquivalent(accepted, await A16aAcceptancesAsync(removedAddress));

        // The link that was sent confirms nothing, and the old email and password sign nobody in.
        var spent = await N9a1ConfirmAsync(due, dueLink);
        Assert.AreEqual("invalid_or_expired_token", (await N9a1AnswerAsync(spent, HttpStatusCode.BadRequest)).Code);
        Assert.IsFalse((await N9a1AccountAsync(dueId)).EmailConfirmed);
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId), "Only the confirmed trainee has a profile in the house.");
        await RefreshCsrfAsync(due);
        await AssertStatusAsync(
            await due.PostAsJsonAsync("/api/auth/login", new { email = dueEmail, password = Password, rememberMe = false }),
            HttpStatusCode.Unauthorized);

        // The sign-up inside the days, the confirmed trainee and the coach's never-confirmed account are as they were.
        var recentAfter = await N9a1PersonAsync(recentEmail);
        Assert.AreEqual(recentBefore.SignUps.Single(), recentAfter.SignUps.Single());
        Assert.AreEqual(recentAccount, await N9a1AccountAsync(recentBefore.UserId.Value));
        var traineeAfter = await N9a1PersonAsync("n9a1-sweep-trainee@example.test");
        Assert.AreEqual(traineeBefore.SignUps.Single(), traineeAfter.SignUps.Single());
        Assert.AreEqual(traineeBefore.Profiles.Single(), traineeAfter.Profiles.Single());
        Assert.AreEqual(traineeBefore.Memberships.Single(), traineeAfter.Memberships.Single());
        Assert.AreEqual(traineeAccount, await N9a1AccountAsync(trainee.UserId));
        await AssertStatusAsync(await trainee.Client.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);
        var coachAfter = await N9a1PersonAsync(coachEmail);
        Assert.IsFalse(coachAfter.EmailConfirmed);
        CollectionAssert.AreEqual(coachBefore.Memberships, coachAfter.Memberships);
        Assert.AreEqual(coachAccount, await N9a1AccountAsync(coachBefore.UserId.Value));
        Assert.AreEqual(1, await N9a1AccountsAsync(coachEmail));

        // A second run finds nothing left.
        Assert.AreEqual(new TraineeSignUpSweepResult(0, 0), await N9a1SweepAsync());
        Assert.AreEqual(2, await N9a1SignUpRowsAsync());

        // The same email signs up afresh, as a new account, and this time confirms.
        using var afresh = CreateClient();
        var again = await N9a1SignUpAsync(afresh, dueEmail, "Ottilie", "Marchbanks", "1987-05-13", legalDocumentIds: asked);
        await AssertStatusAsync(again, HttpStatusCode.Accepted);
        var fresh = await N9a1PersonAsync(dueEmail);
        Assert.AreNotEqual(dueId, fresh.UserId);
        await AssertStatusAsync(
            await N9a1ConfirmAsync(afresh, (await RequiredJsonAsync<N9a1Answer>(again)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        var joined = await N9a1PersonAsync(dueEmail);
        Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single());
        Assert.IsTrue(joined.Profiles.Single().IsSelfDirected);
        Assert.AreEqual(emptied, await N9a1AccountAsync(dueId), "The emptied account is left as the sweep left it.");

        // A day later the second sign-up has waited its days too; the coach's account, older still, is never due.
        RequiredTestClock.Advance(TimeSpan.FromDays(1) + TimeSpan.FromHours(1));
        Assert.AreEqual(new TraineeSignUpSweepResult(1, 0), await N9a1SweepAsync());
        Assert.AreEqual(0, await N9a1AccountsAsync(recentEmail));
        Assert.IsFalse((await N9a1AccountAsync(recentBefore.UserId.Value)).HasPassword);
        Assert.AreEqual(coachAccount, await N9a1AccountAsync(coachBefore.UserId.Value));
        Assert.AreEqual(2, await N9a1SignUpRowsAsync(), "The two confirmed sign-ups are the week's facts and stay.");

        // The sweep said how many, twice, and nothing of who: no email, name or date of birth reached a log line.
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("Trainee sign-up sweep: 1 sign-ups never confirmed were removed.", log);
        Assert.DoesNotContain("sign-ups changed while being swept or failed", log);
        foreach (var secret in new[]
        {
            "n9a1-sweep-ottilie", "n9a1-sweep-caspian", "n9a1-sweep-zeina", "n9a1-sweep-trainee",
            "Ottilie", "Marchbanks", "Caspian", "Thornbury",
            "1987-05-13", "1990-09-09", "05/13/1987", "13/05/1987", "5/13/1987", "09/09/1990", "9/9/1990",
        })
        {
            Assert.DoesNotContain(secret, log, StringComparison.OrdinalIgnoreCase, $"The log holds '{secret}'.");
        }
    }

    [TestMethod]
    public async Task N9a1TheSweepRemovesASignUpConfirmedIntoAFullWeekThatNeverCameBackAndLeavesItsAccountAsItWas()
    {
        // A whole minute on a Monday morning in Beirut: the house's week runs from the 2nd to the 9th of November.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 2, 7, 0, 0, TimeSpan.Zero));
        const string joinedEmail = "n9a1-kept-account-first@example.test";
        const string email = "n9a1-kept-account-second@example.test";
        using var house = await N9a1OpenHouseAsync("kept-account", signUpsPerWeek: "1");
        var days = RequiredFactory.Services.GetRequiredService<IOptions<TraineeSignUpOptions>>().Value.RemoveUnconfirmedAfterDays;

        // Two forms while the week's one place is free. The first confirms and takes it; the second's link then
        // confirms their email into a full week, and their sign-up waits for a place.
        using var first = CreateClient();
        var firstResponse = await N9a1SignUpAsync(first, joinedEmail, "Hala", "Sfeir", "1992-10-09");
        await AssertStatusAsync(firstResponse, HttpStatusCode.Accepted);
        using var second = CreateClient();
        var secondResponse = await N9a1SignUpAsync(second, email, "Tarek", "Abboud", "1989-04-27");
        await AssertStatusAsync(secondResponse, HttpStatusCode.Accepted);
        await AssertStatusAsync(
            await N9a1ConfirmAsync(first, (await RequiredJsonAsync<N9a1Answer>(firstResponse)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);
        RequiredTestClock.Advance(TimeSpan.FromHours(5));
        await AssertStatusAsync(
            await N9a1ConfirmAsync(second, (await RequiredJsonAsync<N9a1Answer>(secondResponse)).DevelopmentConfirmationUrl!),
            HttpStatusCode.NoContent);

        var waiting = await N9a1PersonAsync(email);
        var userId = waiting.UserId!.Value;
        Assert.IsTrue(waiting.EmailConfirmed);
        Assert.IsEmpty(waiting.Memberships);
        Assert.IsEmpty(waiting.Profiles);
        var row = waiting.SignUps.Single();
        Assert.IsNull(row.ConfirmedAtUtc);
        var account = await N9a1AccountAsync(userId);
        Assert.AreEqual((email, email, true, true), (account.Email, account.UserName, account.HasPassword, account.EmailConfirmed));
        Assert.IsNull(account.LockoutEnd);
        var requestedAt = await N9a1RequestedAtAsync(row.Id);
        var joinedBefore = await N9a1PersonAsync(joinedEmail);
        var joinedAccount = await N9a1AccountAsync(joinedBefore.UserId!.Value);
        Assert.AreEqual(2, await N9a1SignUpRowsAsync());

        // The days are counted from the form, not from the confirmation. To the second they are not over.
        RequiredTestClock.Set(requestedAt.AddDays(days));
        Assert.AreEqual(new TraineeSignUpSweepResult(0, 0), await N9a1SweepAsync());
        Assert.AreEqual(row, (await N9a1PersonAsync(email)).SignUps.Single());

        // A second later the sign-up has waited longer than the days and nobody came back for it: the row goes.
        RequiredTestClock.Advance(TimeSpan.FromSeconds(1));
        Assert.AreEqual(new TraineeSignUpSweepResult(1, 0), await N9a1SweepAsync());
        Assert.AreEqual(1, await N9a1SignUpRowsAsync(), "Only the confirmed sign-up, the week's fact, is left.");

        // The account is somebody's, confirmed: it is exactly as it was, its address, name, password and stamp.
        Assert.AreEqual(account, await N9a1AccountAsync(userId));
        Assert.AreEqual(1, await N9a1AccountsAsync(email));
        var after = await N9a1PersonAsync(email);
        Assert.AreEqual(userId, after.UserId);
        Assert.IsTrue(after.EmailConfirmed);
        Assert.IsEmpty(after.SignUps);
        Assert.IsEmpty(after.Memberships);
        Assert.IsEmpty(after.Profiles);

        // The one who joined is untouched, and the house still has its one trainee.
        var joinedAfter = await N9a1PersonAsync(joinedEmail);
        Assert.AreEqual(joinedBefore.SignUps.Single(), joinedAfter.SignUps.Single());
        Assert.AreEqual(joinedBefore.Profiles.Single(), joinedAfter.Profiles.Single());
        Assert.AreEqual(joinedBefore.Memberships.Single(), joinedAfter.Memberships.Single());
        Assert.AreEqual(joinedAccount, await N9a1AccountAsync(joinedBefore.UserId.Value));
        Assert.AreEqual(1, await N9a1ProfilesInAsync(house.TenantId));

        // A second run finds nothing left to remove.
        Assert.AreEqual(new TraineeSignUpSweepResult(0, 0), await N9a1SweepAsync());

        // The person signs in with the email and password they chose, belongs to no coaching space, and no
        // sign-up of theirs waits any more.
        await N9a1SignInAsync(second, email);
        Assert.IsEmpty(await RequiredJsonAsync<N9a1Membership[]>(await second.GetAsync("/api/tenants")));
        var told = await N9a1StatusAsync(second);
        Assert.AreEqual(("Full", (string?)null), (told.Status, told.CallerSignUp));

        // And the account is theirs to sign up with: the next house week, signed in, they join on a row of its own.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 9, 7, 0, 0, TimeSpan.Zero));
        var response = await N9a1SignUpAsync(second, email, "Tarek", "Abboud", "1989-04-27", withPassword: false);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var joined = await N9a1PersonAsync(email);
        Assert.AreEqual((house.TenantId, "Client", "Active"), joined.Memberships.Single());
        Assert.IsTrue(joined.Profiles.Single().IsSelfDirected);
        Assert.AreNotEqual(row.Id, joined.SignUps.Single().Id);
        Assert.AreEqual(joined.Profiles.Single().Id, joined.SignUps.Single().ClientProfileId);

        // The sweep said how many, and nothing of who.
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("Trainee sign-up sweep: 1 sign-ups never confirmed were removed.", log);
        foreach (var secret in new[] { "n9a1-kept-account-first", "n9a1-kept-account-second", "Tarek", "Abboud", "Sfeir", "1989-04-27", "1992-10-09" })
        {
            Assert.DoesNotContain(secret, log, StringComparison.OrdinalIgnoreCase, $"The log holds '{secret}'.");
        }
    }

    [TestMethod]
    public async Task N9a1ASweepAndAConfirmationAtOnceLeaveATraineeOrAnEmptiedAccountNeverHalfOfEach()
    {
        using var house = await N9a1OpenHouseAsync("at-once");
        var days = RequiredFactory.Services.GetRequiredService<IOptions<TraineeSignUpOptions>>().Value.RemoveUnconfirmedAfterDays;
        var trainees = 0;
        var met = new List<string>();
        for (var round = 1; round <= 6; round++)
        {
            // A sign-up that has waited longer than the days, whose link is tapped as the sweep runs.
            var email = $"n9a1-at-once-{round}@example.test";
            using var person = CreateClient();
            var response = await N9a1SignUpAsync(person, email);
            await AssertStatusAsync(response, HttpStatusCode.Accepted);
            var link = (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!;
            var userId = (await N9a1PersonAsync(email)).UserId!.Value;
            RequiredTestClock.Advance(TimeSpan.FromDays(days) + TimeSpan.FromMinutes(1));
            await RefreshCsrfAsync(person);
            var body = new { userId = Guid.Parse(QueryValue(link, "userId")), code = QueryValue(link, "code") };
            // Whichever takes the sign-up's row first wins. The sweep starts and the link is tapped a little later
            // each round (0, 20, 40 ... milliseconds), so the rounds meet at different points; every one must hold.
            var sweeping = N9a1SweepAsync();
            await Task.Delay(TimeSpan.FromMilliseconds(20 * (round - 1)));
            var confirming = person.PostAsJsonAsync("/api/auth/confirm-email", body);
            await Task.WhenAll(confirming, sweeping);
            var (confirmed, swept) = (await confirming, await sweeping);
            met.Add($"{(int)confirmed.StatusCode} with {swept.Removed} removed and {swept.Skipped} skipped");

            var account = await N9a1AccountAsync(userId);
            var stored = await N9a1PersonAsync(account.Email!);
            Assert.AreEqual(userId, stored.UserId, $"Round {round}.");
            if (confirmed.StatusCode == HttpStatusCode.NoContent)
            {
                // The confirmation got there first: a trainee, whole, and the sweep removed nothing.
                trainees++;
                Assert.AreEqual(0, swept.Removed, $"Round {round}.");
                Assert.AreEqual((email, true, true), (account.Email, account.EmailConfirmed, account.HasPassword), $"Round {round}.");
                Assert.AreEqual((house.TenantId, "Client", "Active"), stored.Memberships.Single(), $"Round {round}.");
                Assert.IsTrue(stored.Profiles.Single().IsSelfDirected, $"Round {round}.");
                Assert.AreEqual(stored.Profiles.Single().Id, stored.SignUps.Single().ClientProfileId, $"Round {round}.");
            }
            else
            {
                // The sweep got there first: the link confirms nothing, and nothing of a trainee was made.
                Assert.AreEqual("invalid_or_expired_token", (await N9a1AnswerAsync(confirmed, HttpStatusCode.BadRequest)).Code, $"Round {round}.");
                Assert.AreEqual(new TraineeSignUpSweepResult(1, 0), swept, $"Round {round}.");
                Assert.AreEqual(
                    ($"removed-{userId:N}@signup.tbgym.invalid", false, false),
                    (account.Email, account.EmailConfirmed, account.HasPassword),
                    $"Round {round}.");
                Assert.IsEmpty(stored.SignUps, $"Round {round}.");
                Assert.IsEmpty(stored.Memberships, $"Round {round}.");
                Assert.IsEmpty(stored.Profiles, $"Round {round}.");
            }

            // Either way one fact stands, and the house lists exactly the trainees there are.
            Assert.AreEqual(trainees, await N9a1SignUpRowsAsync(), $"Round {round}.");
            Assert.AreEqual(trainees, await N9a1ProfilesInAsync(house.TenantId), $"Round {round}.");
        }

        TestContext.WriteLine($"N9a1 sweep against confirmation: the confirmation won {trainees} of 6 rounds ({string.Join("; ", met)}).");
    }

    [TestMethod]
    public async Task N9a1TheWorkersSweepRemovesADueSignUpAsItStartsAndNothingWhileSwitchedOff()
    {
        const string email = "n9a1-worker-waits@example.test";
        using var house = await N9a1OpenHouseAsync("worker");
        using var visitor = CreateClient();
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, email), HttpStatusCode.Accepted);
        var userId = (await N9a1PersonAsync(email)).UserId!.Value;
        var days = RequiredFactory.Services.GetRequiredService<IOptions<TraineeSignUpOptions>>().Value.RemoveUnconfirmedAfterDays;
        RequiredTestClock.Advance(TimeSpan.FromDays(days) + TimeSpan.FromMinutes(1));
        var scopes = RequiredFactory.Services.GetRequiredService<IServiceScopeFactory>();
        var logger = RequiredFactory.Services.GetRequiredService<ILogger<TB.Gym.Worker.TraineeSignUpSweepWorker>>();

        // Switched off by its setting, the Worker says so and removes nothing. Since N9b1 it runs on for Free's renewal
        // (SUB-019), which that switch never stops, so it is stopped here rather than awaited to an end: once it has
        // said so, since a stop that came first would cancel it before it ran at all (a BackgroundService runs the
        // whole of ExecuteAsync on the thread pool, under its stopping token, since .NET 10).
        const string disabled = "The trainee sign-up sweep is disabled by configuration.";
        using (var switchedOff = new TB.Gym.Worker.TraineeSignUpSweepWorker(
                   scopes,
                   Microsoft.Extensions.Options.Options.Create(new TraineeSignUpOptions { SweepEnabled = false }),
                   logger))
        {
            await switchedOff.StartAsync(CancellationToken.None);
            try
            {
                var waited = System.Diagnostics.Stopwatch.StartNew();
                while (!RequiredEveryLogLine.Text.Contains(disabled, StringComparison.Ordinal) && waited.Elapsed < TimeSpan.FromSeconds(30))
                {
                    await Task.Delay(50);
                }
            }
            finally
            {
                await switchedOff.StopAsync(CancellationToken.None);
            }
        }

        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
        Assert.AreEqual(1, await N9a1AccountsAsync(email));
        Assert.Contains(disabled, RequiredEveryLogLine.Text);

        // Switched on, it sweeps once as it starts, on the host's own clock and days.
        using var worker = new TB.Gym.Worker.TraineeSignUpSweepWorker(
            scopes,
            Microsoft.Extensions.Options.Options.Create(new TraineeSignUpOptions { SweepIntervalSeconds = 3_600 }),
            logger);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (await N9a1SignUpRowsAsync() > 0 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(100);
            }
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }

        Assert.AreEqual(0, await N9a1SignUpRowsAsync());
        Assert.AreEqual(0, await N9a1AccountsAsync(email));
        var emptied = await N9a1AccountAsync(userId);
        Assert.AreEqual(($"removed-{userId:N}@signup.tbgym.invalid", false, false), (emptied.Email, emptied.HasPassword, emptied.EmailConfirmed));
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("Trainee sign-up sweep: 1 sign-ups never confirmed were removed.", log);
        Assert.DoesNotContain("The trainee sign-up sweep failed", log);
    }

    /// <summary>
    /// The sweep run from the Worker's own composition against the database, not from the API host's: the Worker
    /// reads the machine's clock, so the sign-up is made, by the API, the sweep's days and one more ago.
    /// </summary>
    [TestMethod]
    public async Task N9a1TheSweepRunsFromTheWorkersOwnCompositionAgainstTheDatabase()
    {
        const string email = "n9a1-composed-waits@example.test";
        var days = new TraineeSignUpOptions().RemoveUnconfirmedAfterDays;
        RequiredTestClock.Set(DateTimeOffset.UtcNow.AddDays(-(days + 1)));
        using var house = await N9a1OpenHouseAsync("composed");
        using var visitor = CreateClient();
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, email), HttpStatusCode.Accepted);
        var userId = (await N9a1PersonAsync(email)).UserId!.Value;
        // Made in the last hours, by the machine's clock: inside the days.
        RequiredTestClock.Set(DateTimeOffset.UtcNow.AddHours(-3));
        using var recent = CreateClient();
        await AssertStatusAsync(await N9a1SignUpAsync(recent, "n9a1-composed-recent@example.test"), HttpStatusCode.Accepted);

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = RequiredDatabaseConnection,
                ["Application:PublicBaseUrl"] = "http://localhost:4200",
            })
            .Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.AddTbGymNotificationWorkerInfrastructure(configuration, isProduction: false, isDevelopment: true);
        await using var provider = services.BuildServiceProvider(validateScopes: true);
        await using (var scope = provider.CreateAsyncScope())
        {
            Assert.AreEqual(
                new TraineeSignUpSweepResult(1, 0),
                await scope.ServiceProvider.GetRequiredService<ITraineeSignUpSweep>().RunAsync(CancellationToken.None));
        }

        Assert.AreEqual(0, await N9a1AccountsAsync(email));
        var emptied = await N9a1AccountAsync(userId);
        Assert.AreEqual(
            ($"removed-{userId:N}@signup.tbgym.invalid", string.Empty, false, false),
            (emptied.Email, emptied.DisplayName, emptied.HasPassword, emptied.EmailConfirmed));
        Assert.HasCount(1, (await N9a1PersonAsync("n9a1-composed-recent@example.test")).SignUps);
        Assert.AreEqual(1, await N9a1SignUpRowsAsync());
    }

    // ---------- 5. self-directed on the staff's screens ----------

    [TestMethod]
    public async Task N9a1ASelfDirectedTraineeIsOnClientsAndRaisesNothingForTheHousesOwnerOrItsCoach()
    {
        var today = R61aStartAtMidday();
        using var house = await N9a1OpenHouseAsync("quiet", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-quiet-trainee@example.test");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9a1-quiet-rita@example.test", "Rita", "Daher");
        var staff = new[] { (Caller: house.Owner, Who: "the owner"), (Caller: house.Coach!, Who: "the Coach") };

        // Both joined today. The invited client has no plan and asks for one; the trainee asks for nothing, on Today,
        // on the list and on their own page, and is on Clients all the same. Since N9b1 the confirmation also starts
        // the house's Free (SUB-019), so the trainee's row and page read Free as the plan that runs, on track, where
        // before N9b1 they read no plan at all.
        foreach (var (caller, who) in staff)
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            Assert.AreEqual((CoachAttentionPolicy.Key, 9), (view.AttentionRuleKey, view.AttentionRuleVersion), who);
            Assert.AreEqual(2, view.ClientCount, $"{who} counts the trainee among their clients.");
            var asked = view.Attention.Single();
            Assert.AreEqual((CoachAttentionKind.NoPlan, ritaId), (asked.Kind, asked.Client.ClientProfileId), who);

            var list = await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl);
            Assert.AreEqual((CoachAttentionPolicy.Key, 9), (list.AttentionRuleKey, list.AttentionRuleVersion), who);
            Assert.HasCount(2, list.Clients, who);
            var traineeRow = list.Clients.Single(row => row.Client.ClientProfileId == trainee.ProfileId);
            Assert.IsTrue(traineeRow.SelfDirected, who);
            Assert.IsEmpty(traineeRow.Attention, who);
            Assert.IsEmpty(traineeRow.AttentionItems, who);
            Assert.AreEqual((ClientOverviewStatus.OnTrack, ClientPlanState.Running), (traineeRow.Status, traineeRow.PlanState), who);
            Assert.AreEqual(("Free", 0m), (traineeRow.Plan!.Name, traineeRow.Plan.PriceAmount), who);
            Assert.AreEqual(house.CoachUserId, traineeRow.Client.AssignedCoachUserId, who);
            var ritaRow = list.Clients.Single(row => row.Client.ClientProfileId == ritaId);
            Assert.IsFalse(ritaRow.SelfDirected, who);
            Assert.AreEqual(ClientOverviewStatus.NeedsAttention, ritaRow.Status, who);
            CollectionAssert.AreEqual(N9a1NoPlanAlone, ritaRow.Attention.ToArray(), who);

            var traineePage = await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(trainee.ProfileId));
            Assert.AreEqual((CoachAttentionPolicy.Key, 9), (traineePage.AttentionRuleKey, traineePage.AttentionRuleVersion), who);
            Assert.IsEmpty(traineePage.Attention, who);
            Assert.AreEqual((ClientOverviewStatus.OnTrack, "Free"), (traineePage.Status, traineePage.PlanName), who);
            var ritaPage = await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(ritaId));
            Assert.AreEqual((CoachAttentionKind.NoPlan, ClientOverviewStatus.NeedsAttention), (ritaPage.Attention.Single().Kind, ritaPage.Status), who);

            CollectionAssert.AreEquivalent(
                new[] { trainee.ProfileId, ritaId },
                (await N9a1ClientsAsync(caller)).Select(item => item.Id).ToArray(),
                who);
        }

        // Each has a paid plan of one week, so each plan ends within two weeks. Only the invited client is listed
        // under plans ending soon; the trainee's plan runs and asks nothing of anybody.
        var product = await B4aProductAsync(house.Owner, "N9a1 Week Pass", B4aOfferRequest(1, 45m, "USD", "Messaging"));
        foreach (var clientId in new[] { ritaId, trainee.ProfileId })
        {
            var plan = await A7EnrollAsync(house.Owner, clientId, product.Offers[0].Id, today);
            await A7PayAsync(house.Owner, plan.Id, 45m, today, Guid.NewGuid());
        }

        foreach (var (caller, who) in staff)
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            Assert.AreEqual(1, view.PlansEndingSoonCount, who);
            var ending = view.PlansEndingSoon.Single();
            Assert.AreEqual((ritaId, "N9a1 Week Pass", today.AddDays(6)), (ending.Client.ClientProfileId, ending.PlanName, ending.LastDay), who);
            Assert.IsFalse(view.Attention.Any(item => item.Client.ClientProfileId == trainee.ProfileId), $"{who}: the trainee raised something.");
            Assert.IsEmpty(view.PlansEndedNotRenewed, who);

            var list = await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl);
            var traineeRow = list.Clients.Single(row => row.Client.ClientProfileId == trainee.ProfileId);
            Assert.IsEmpty(traineeRow.Attention, who);
            Assert.IsEmpty(traineeRow.AttentionItems, who);
            Assert.AreEqual((ClientOverviewStatus.OnTrack, ClientPlanState.Running, true), (traineeRow.Status, traineeRow.PlanState, traineeRow.SelfDirected), who);
            var ritaRow = list.Clients.Single(row => row.Client.ClientProfileId == ritaId);
            CollectionAssert.Contains(ritaRow.Attention.ToArray(), CoachAttentionKind.PlanEndingSoon, who);
            Assert.AreEqual(ClientOverviewStatus.EndingSoon, ritaRow.Status, who);

            Assert.IsEmpty((await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(trainee.ProfileId))).Attention, who);
            var ritaPage = await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(ritaId));
            Assert.IsTrue(ritaPage.Attention.Any(item => item.Kind == CoachAttentionKind.PlanEndingSoon), who);
        }

        // Eight days on both plans have run out and neither was renewed: only the invited client's is listed.
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        foreach (var (caller, who) in staff)
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            var ended = view.PlansEndedNotRenewed.Single();
            Assert.AreEqual((ritaId, today.AddDays(6)), (ended.Client.ClientProfileId, ended.LastDay), who);
            Assert.IsEmpty(view.PlansEndingSoon, who);
            Assert.IsFalse(view.Attention.Any(item => item.Client.ClientProfileId == trainee.ProfileId), $"{who}: the trainee raised something.");
        }

        // Each sends a check-in. The invited client's waits for review and is in the feed; the trainee's is neither.
        foreach (var clientId in new[] { ritaId, trainee.ProfileId })
        {
            await Phase6EnrollAsync(house.Owner, clientId, "N9a1 check-ins", "CheckIns");
        }

        var form = await Phase6CreateFormAsync(house.Owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(house.Owner, form.Form.Id, form.Versions[0]);
        var due = Phase6WorkspaceToday().AddDays(2);
        var ritasCheckIn = await B4aAssignAsync(house.Owner, ritaId, version.Id, due);
        var traineesCheckIn = await B4aAssignAsync(house.Owner, trainee.ProfileId, version.Id, due);
        R31Tick();
        await B4aSendAsync(trainee.Client, traineesCheckIn, version);
        R31Tick();
        await B4aSendAsync(rita, ritasCheckIn, version);
        R31Tick();

        foreach (var (caller, who) in staff)
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            var activity = view.Activity.Single();
            Assert.AreEqual(
                (CoachActivityKind.CheckInSubmitted, ritaId, ritasCheckIn),
                (activity.Kind, activity.Client.ClientProfileId, activity.SubjectId),
                who);
            var toReview = view.Attention.Single(item => item.Kind == CoachAttentionKind.CheckInToReview);
            Assert.AreEqual((ritaId, (Guid?)ritasCheckIn), (toReview.Client.ClientProfileId, toReview.SubjectId), who);
            Assert.IsFalse(view.Attention.Any(item => item.Client.ClientProfileId == trainee.ProfileId), $"{who}: the trainee raised something.");
            Assert.AreEqual(2, view.ClientCount, who);

            var list = await ReadSliceAsync<ClientOverviewView>(caller, ClientOverviewUrl);
            var traineeRow = list.Clients.Single(row => row.Client.ClientProfileId == trainee.ProfileId);
            Assert.IsEmpty(traineeRow.Attention, who);
            Assert.IsEmpty(traineeRow.AttentionItems, who);
            Assert.IsTrue(traineeRow.SelfDirected, who);
            CollectionAssert.Contains(
                list.Clients.Single(row => row.Client.ClientProfileId == ritaId).Attention.ToArray(),
                CoachAttentionKind.CheckInToReview,
                who);
            Assert.IsEmpty((await ReadSliceAsync<ClientProfileOverviewView>(caller, R33bOverviewUrl(trainee.ProfileId))).Attention, who);
        }
    }

    // ---------- 6. the staff's inbox ----------

    [TestMethod]
    public async Task N9a1ATraineesLeavingTellsNoStaffInboxWhileAnInvitedClientsStillDoes()
    {
        using var house = await N9a1OpenHouseAsync("leave", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-leave-trainee@example.test", "Dalia", "Mansour");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9a1-leave-rita@example.test", "Rita", "Daher");

        // The trainee leaves the house.
        var traineeSelf = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        await RefreshCsrfAsync(trainee.Client);
        await AssertStatusAsync(
            await trainee.Client.PostAsJsonAsync("/api/client-profile/me/leave", new { reason = "Trying it alone", version = traineeSelf.Version }),
            HttpStatusCode.NoContent);

        // The history keeps the leaving, and the owner keeps the record among former clients.
        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await house.Owner.GetAsync($"/api/clients/{trainee.ProfileId}/coach-assignments"));
        Assert.AreEqual(("SignUp", "ClientLeft"), (history[0].Reason, history[^1].Reason));
        var former = await RequiredJsonAsync<DepartedClient[]>(await house.Owner.GetAsync("/api/clients/former"));
        Assert.AreEqual((trainee.ProfileId, "LeftByClient"), (former.Single().Id, former.Single().DepartureKind));
        // No notice was queued for anybody.
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientLeft", "AggregateId", trainee.ProfileId));

        // The invited client leaves: the owner and their coach are each told.
        var ritaSelf = await RequiredJsonAsync<N9a1Self>(await rita.GetAsync("/api/client-profile/me"));
        await RefreshCsrfAsync(rita);
        await AssertStatusAsync(
            await rita.PostAsJsonAsync("/api/client-profile/me/leave", new { reason = "Moving abroad", version = ritaSelf.Version }),
            HttpStatusCode.NoContent);
        Assert.AreEqual(2L, await N9a1QueuedAsync("ClientLeft", "AggregateId", ritaId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientLeft", "AggregateId", trainee.ProfileId));

        await SweepDepartureNotificationsAsync();
        foreach (var staff in new[] { house.Owner, house.Coach! })
        {
            var inbox = await RequiredJsonAsync<DepartureInbox>(await staff.GetAsync("/api/notifications"));
            Assert.AreEqual("Rita Daher left your coaching space", inbox.Items.Single(item => item.Kind == "ClientLeft").Title);
            foreach (var item in inbox.Items)
            {
                Assert.DoesNotContain("Dalia", item.Title + item.Body);
                Assert.DoesNotContain("Mansour", item.Title + item.Body);
            }
        }
    }

    [TestMethod]
    public async Task N9a1ATraineesWorkoutNoteReachesNoStaffInboxWhileTheHousesNoteStillReachesTheTrainee()
    {
        var today = R61aStartAtMidday();
        using var house = await N9a1OpenHouseAsync("note", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-note-trainee@example.test");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9a1-note-rita@example.test", "Rita", "Daher");

        // The house's staff give each a training plan and the same program, starting today.
        var training = await CreateTrainingResourcesAsync(house.Owner, trainee.ProfileId, 8, 1, today);
        await AssignAsync(house.Owner, trainee.ProfileId, training, today);
        var ritas = training with
        {
            Enrollment = await CreateTrainingEnrollmentAsync(house.Owner, ritaId, today, 8),
            Max = await RecordWorkingMaxAsync(house.Owner, ritaId, training.Exercise.Id, 100m),
        };
        await AssignAsync(house.Owner, ritaId, ritas, today);

        // Each starts today's workout and leaves a note on it.
        var traineesWorkout = await N9a1NoteOnTodaysWorkoutAsync(trainee.Client, "Felt strong today");
        var ritasWorkout = await N9a1NoteOnTodaysWorkoutAsync(rita, "Left knee hurt on the last set");
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", traineesWorkout));
        Assert.AreEqual(1L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", ritasWorkout));

        // The coach on both records is told of the invited client's note alone; the owner, who coaches neither, of none.
        await R51cSweepAsync();
        var coachsNotes = (await R51cInboxAsync(house.Coach!)).Items.Where(item => item.Kind == "ClientWorkoutNote").ToArray();
        Assert.AreEqual((ritasWorkout, ritaId), (coachsNotes.Single().WorkoutExecutionId, coachsNotes.Single().ClientProfileId));
        Assert.IsFalse((await R51cInboxAsync(house.Owner)).Items.Any(item => item.Kind == "ClientWorkoutNote"));
        foreach (var staff in new[] { house.Owner, house.Coach! })
        {
            Assert.IsFalse(
                (await R51cInboxAsync(staff)).Items.Any(item => item.WorkoutExecutionId == traineesWorkout || item.ClientProfileId == trainee.ProfileId),
                "A notice about the trainee reached the house's staff.");
        }

        // A note the house's staff write on the trainee's workout still reaches the trainee.
        await RefreshCsrfAsync(house.Coach!);
        await AssertStatusAsync(
            await house.Coach!.PostAsJsonAsync(
                $"/api/training/workouts/{traineesWorkout}/notes",
                new { exercisePerformanceId = (Guid?)null, text = "Good session" }),
            HttpStatusCode.OK);
        Assert.AreEqual(1L, await N9a1QueuedAsync("CoachWorkoutNote", "AggregateId", traineesWorkout));
        await R51cSweepAsync();
        var told = (await R51cInboxAsync(trainee.Client)).Items.Single(item => item.Kind == "CoachWorkoutNote");
        Assert.AreEqual(traineesWorkout, told.WorkoutExecutionId);
        // And the trainee's answer to it is still theirs alone.
        await RefreshCsrfAsync(trainee.Client);
        await AssertStatusAsync(
            await trainee.Client.PostAsJsonAsync(
                $"/api/training/workouts/{traineesWorkout}/notes",
                new { exercisePerformanceId = (Guid?)null, text = "Thanks" }),
            HttpStatusCode.OK);
        Assert.AreEqual(0L, await N9a1QueuedAsync("ClientWorkoutNote", "AggregateId", traineesWorkout));
    }

    [TestMethod]
    public async Task N9a1ATraineesFinishedWorkoutIsLeftOutOfTheStaffsActivityWhileAnInvitedClientsIsInIt()
    {
        var today = R61aStartAtMidday();
        using var house = await N9a1OpenHouseAsync("feed", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-feed-trainee@example.test");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9a1-feed-rita@example.test", "Rita", "Daher");

        // The house's staff give each a training plan and the same program, starting today.
        var training = await CreateTrainingResourcesAsync(house.Owner, trainee.ProfileId, 8, 1, today);
        await AssignAsync(house.Owner, trainee.ProfileId, training, today);
        var ritas = training with
        {
            Enrollment = await CreateTrainingEnrollmentAsync(house.Owner, ritaId, today, 8),
            Max = await RecordWorkingMaxAsync(house.Owner, ritaId, training.Exercise.Id, 100m),
        };
        await AssignAsync(house.Owner, ritaId, ritas, today);

        // Each starts today's workout, logs its one set and finishes it; the trainee's is the newer of the two.
        var ritasWorkout = await R25bFinishTodaysWorkoutAsync(rita, 80m);
        R31Tick();
        var traineesWorkout = await R25bFinishTodaysWorkoutAsync(trainee.Client, 82.5m);
        R31Tick();
        var finished = await ReadSliceAsync<TB.Gym.Modules.Training.ClientWorkoutHistoryPage>(trainee.Client, "/api/training/me/history");
        Assert.AreEqual(traineesWorkout, finished.Items.Single().WorkoutExecutionId, "The trainee's own history has the workout.");

        // The Owner, who sees every client, and the Coach, whose name is on both records, read one finished workout
        // on Today: the invited client's. Nothing of the trainee's is in the feed.
        foreach (var (caller, who) in new[] { (house.Owner, "the owner"), (house.Coach!, "the Coach") })
        {
            var view = await ReadSliceAsync<CoachTodayView>(caller, CoachTodayUrl);
            Assert.AreEqual(2, view.ClientCount, $"{who} counts the trainee among their clients.");
            var workout = view.Activity.Single(item => item.Kind == CoachActivityKind.WorkoutCompleted);
            Assert.AreEqual((ritasWorkout, ritaId), (workout.SubjectId, workout.Client.ClientProfileId), who);
            Assert.IsFalse(
                view.Activity.Any(item => item.Client.ClientProfileId == trainee.ProfileId || item.SubjectId == traineesWorkout),
                $"{who}: the trainee's workout is in the activity feed.");
            Assert.IsFalse(view.Attention.Any(item => item.Client.ClientProfileId == trainee.ProfileId), $"{who}: the trainee raised something.");
        }
    }

    [TestMethod]
    public async Task N9a1WhenTheHousesCoachIsRemovedATraineeMovesToTheOwnerAndIsToldNothing()
    {
        using var house = await N9a1OpenHouseAsync("gone", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-gone-trainee@example.test");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9a1-gone-rita@example.test", "Rita", "Daher");
        var ritaUserId = (await N9a1PersonAsync("n9a1-gone-rita@example.test")).UserId!.Value;
        var coachId = house.CoachUserId!.Value;
        foreach (var listed in await N9a1ClientsAsync(house.Owner))
        {
            Assert.AreEqual(coachId, listed.AssignedCoachUserId, "Both records name the house's Coach.");
        }

        await RemoveCoachForBillingAsync(house.Owner, coachId);

        // Both records move to the owner, each with its entry in the coach history; the trainee stays self-directed.
        foreach (var (clientId, firstReason) in new[] { (trainee.ProfileId, "SignUp"), (ritaId, "Invitation") })
        {
            var history = await RequiredJsonAsync<TeamAssignment[]>(
                await house.Owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
            Assert.HasCount(2, history, firstReason);
            Assert.AreEqual((1, coachId, firstReason), (history[0].Sequence, history[0].CoachUserId, history[0].Reason));
            Assert.AreEqual(
                (2, house.OwnerUserId, (Guid?)coachId, "CoachRemoved"),
                (history[1].Sequence, history[1].CoachUserId, history[1].PreviousCoachUserId, history[1].Reason),
                firstReason);
        }

        var moved = (await N9a1PersonAsync("n9a1-gone-trainee@example.test")).Profiles.Single();
        Assert.AreEqual((house.OwnerUserId, true), (moved.AssignedCoachUserId, moved.IsSelfDirected));
        foreach (var listed in await N9a1ClientsAsync(house.Owner))
        {
            Assert.AreEqual(house.OwnerUserId, listed.AssignedCoachUserId);
        }

        // The invited client is told, in-app and by one email; nothing was queued for the trainee.
        Assert.AreEqual(1L, await N9a1QueuedAsync("CoachDeparted", "RecipientUserId", ritaUserId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("CoachDeparted", "RecipientUserId", trainee.UserId));
        await SweepDepartureNotificationsAsync();
        var ritasInbox = await RequiredJsonAsync<DepartureInbox>(await rita.GetAsync("/api/notifications"));
        Assert.HasCount(1, ritasInbox.Items.Where(item => item.Kind == "CoachDeparted"));
        var traineesInbox = await RequiredJsonAsync<DepartureInbox>(await trainee.Client.GetAsync("/api/notifications"));
        Assert.IsFalse(traineesInbox.Items.Any(item => item.Kind == "CoachDeparted"), "A trainee has no coach to lose.");
        CapturedNoticeMail.Clear();
        Assert.AreEqual(1, (await SweepWorkspaceNoticesAsync()).Materialized);
        Assert.AreEqual(
            "n9a1-gone-rita@example.test",
            CapturedNoticeMail.Captured.Single(item => item.Scope == TB.Gym.Infrastructure.Application.ActionMailScopes.WorkspaceNotice).RecipientAddress);
        Assert.AreEqual(0, (await SweepWorkspaceNoticesAsync()).Total, "Told once, and the trainee never.");

        // The trainee still reads their own screens in the house.
        var self = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((trainee.ProfileId, true), (self.Id, self.SelfDirected));
    }

    // ---------- 7. the intake ----------

    [TestMethod]
    public async Task N9a1ATraineesIntakeKeepsToTheHousesAgeAndAnInvitedClientsDoesNot()
    {
        // The house's own age here is 23.
        using var house = await N9a1OpenHouseAsync("intake", minimumAge: "23");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9a1-intake-trainee@example.test", birthDate: "1991-08-23");
        var houseToday = N9a1HouseToday();
        var twentyThreeToday = houseToday.AddYears(-23);
        var born = new DateOnly(1991, 8, 23);

        // A day short of 23 on the house's day: refused in the house's own words, and nothing changes. Every save
        // here carries health details too, in words found nowhere else, for the log's check at the end.
        var self = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        var young = await N9a1SaveIntakeAsync(trainee.Client, "/api/client-profile/me/intake", twentyThreeToday.AddDays(1), self.Version, N9a1HealthMarkers);
        await AssertStatusAsync(young, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<N9a1Problem>(young);
        CollectionAssert.AreEqual(N9a1IntakeField, problem.Errors.Keys.ToArray());
        Assert.AreEqual("This coaching space is open to people aged 23 or older.", problem.Errors["intake"].Single());
        // The house's staff, saving the trainee's intake for them, are held to it as well.
        var byStaff = await N9a1SaveIntakeAsync(
            house.Owner, $"/api/clients/{trainee.ProfileId}/intake", twentyThreeToday.AddDays(1), self.Version, N9a1HealthMarkers);
        await AssertStatusAsync(byStaff, HttpStatusCode.BadRequest);
        CollectionAssert.AreEqual(N9a1IntakeField, (await RequiredJsonAsync<N9a1Problem>(byStaff)).Errors.Keys.ToArray());
        // Finishing the profile's set-up with that date is refused too.
        var setUp = await N9a1CompleteOnboardingAsync(trainee.Client, twentyThreeToday.AddDays(1), self.Version, houseToday, N9a1HealthMarkers);
        await AssertStatusAsync(setUp, HttpStatusCode.BadRequest);
        CollectionAssert.AreEqual(N9a1OnboardingField, (await RequiredJsonAsync<N9a1Problem>(setUp)).Errors.Keys.ToArray());
        var unchanged = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual(((DateOnly?)born, self.Version), (unchanged.BirthDate, unchanged.Version));
        var nothingKept = await RequiredJsonAsync<N9a1Health>(await trainee.Client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual(new N9a1Health(null, null, null), nothingKept, "A refused save keeps none of what it carried.");

        // 23 today, the birthday itself: accepted, with the health details it carried.
        await AssertStatusAsync(
            await N9a1SaveIntakeAsync(trainee.Client, "/api/client-profile/me/intake", twentyThreeToday, self.Version, N9a1HealthMarkers),
            HttpStatusCode.OK);
        var saved = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        Assert.AreEqual((DateOnly?)twentyThreeToday, saved.BirthDate);
        Assert.AreEqual(N9a1HealthMarkers, await RequiredJsonAsync<N9a1Health>(await trainee.Client.GetAsync("/api/client-profile/me")));

        // The admin raises the age to 27. The date the trainee already has is kept as it is when they save again;
        // a new date is weighed against the new age.
        await N9a1SettingAsync(house.Admin, N9a1AgeSetting, "27");
        await AssertStatusAsync(
            await N9a1SaveIntakeAsync(trainee.Client, "/api/client-profile/me/intake", twentyThreeToday, saved.Version),
            HttpStatusCode.OK);
        saved = await RequiredJsonAsync<N9a1Self>(await trainee.Client.GetAsync("/api/client-profile/me"));
        var between = await N9a1SaveIntakeAsync(trainee.Client, "/api/client-profile/me/intake", houseToday.AddYears(-25), saved.Version);
        await AssertStatusAsync(between, HttpStatusCode.BadRequest);
        Assert.AreEqual(
            "This coaching space is open to people aged 27 or older.",
            (await RequiredJsonAsync<N9a1Problem>(between)).Errors["intake"].Single());
        await AssertStatusAsync(
            await N9a1SaveIntakeAsync(trainee.Client, "/api/client-profile/me/intake", houseToday.AddYears(-27), saved.Version),
            HttpStatusCode.OK);

        // A client a coach invited, in another coaching space and in the house itself, is held to the platform's
        // own age alone: someone who turned 20 saves, whatever the house asks of those who sign up.
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9a1-intake-other@example.test", "Zeina Aoun", "N9a1 Intake Zeina Gym");
        using var elsewhere = CreateClient();
        await R31InviteAsync(otherOwner, elsewhere, otherSpace, "n9a1-intake-elsewhere@example.test", "Karim", "Nassar");
        using var invited = CreateClient();
        await R31InviteAsync(house.Owner, invited, house.TenantId, "n9a1-intake-invited@example.test", "Rita", "Daher");
        foreach (var (client, where) in new[] { (elsewhere, "another coaching space"), (invited, "the house") })
        {
            var own = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
            Assert.IsFalse(own.SelfDirected, where);
            await AssertStatusAsync(
                await N9a1SaveIntakeAsync(client, "/api/client-profile/me/intake", houseToday.AddYears(-20), own.Version),
                HttpStatusCode.OK);
            var now = await RequiredJsonAsync<N9a1Self>(await client.GetAsync("/api/client-profile/me"));
            Assert.AreEqual((DateOnly?)houseToday.AddYears(-20), now.BirthDate, where);
        }

        // The health details the trainee sent were kept on the profile and in no log line: neither the save that was
        // accepted nor the three refused for the age wrote an allergy, a medication or an injury where an operator reads.
        var logged = RequiredEveryLogLine.Text;
        foreach (var marker in new[] { N9a1HealthMarkers.Allergies!, N9a1HealthMarkers.Medications!, N9a1HealthMarkers.PreviousInjuries! })
        {
            Assert.DoesNotContain(marker, logged, StringComparison.OrdinalIgnoreCase, $"The log holds '{marker}'.");
        }

        // The capture was reading all along: the trainee's own sign-up is in it, by its id alone.
        var stored = (await N9a1PersonAsync("n9a1-intake-trainee@example.test")).SignUps.Single();
        Assert.Contains($"House sign-up {stored.Id} was stored.", logged);
    }

    // ---------- 8. the migration ----------

    [TestMethod]
    public async Task N9a1TheMigrationRevertsAndReappliesWhileNoSpaceIsTheHouse()
    {
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n9a1-migration-owner@example.test", "Nour Haddad", "N9a1 Migration Space");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "n9a1-migration-client@example.test", true);
        Assert.AreEqual((12L, 1L), (await A7ScalarAsync(N9a1SchemaSql), await A7ScalarAsync(N9a1SignUpReasonSql)));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9a1Migrations(context);

        // With no house, no setting, no sign-up and no consumer terms, going back drops it all. Nothing asks the API
        // anything until it is back.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual((0L, 0L), (await A7ScalarAsync(N9a1SchemaSql), await A7ScalarAsync(N9a1SignUpReasonSql)));
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM clients."ClientCoachAssignments" WHERE "ClientProfileId" = @id AND "Reason" = 'Invitation'""",
                clientId),
            "The coach history that was there is kept, under the check as it was before.");

        // Reapplied, the tables, the columns, the guards and the indexes are back, and nothing is marked or filled.
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual((12L, 1L), (await A7ScalarAsync(N9a1SchemaSql), await A7ScalarAsync(N9a1SignUpReasonSql)));
        Assert.IsEmpty(await N9a1MarkedAsync());
        Assert.AreEqual(0, await N9a1SignUpRowsAsync());
        var kept = (await N9a1PersonAsync("n9a1-migration-client@example.test")).Profiles.Single();
        Assert.AreEqual((clientId, spaceId, false), (kept.Id, kept.TenantId, kept.IsSelfDirected));
        Assert.AreEqual(clientId, (await N9a1ClientsAsync(owner)).Single().Id);

        // The API works over the schema made again: the space becomes the house, a person signs up and joins, and
        // the guards are the database's as before.
        await N9a1MarkHouseAsync(owner, spaceId);
        using var admin = await SignInPlatformAdminAsync("n9a1-migration-admin@example.test");
        await N9a1SettingAsync(admin, N9a1PlacesSetting, N9a1Places);
        await N9a1SettingAsync(admin, N9a1AgeSetting, N9a1Age);
        using var trainee = await N9a1TraineeAsync(spaceId, "n9a1-migration-trainee@example.test");
        var joined = await N9a1PersonAsync("n9a1-migration-trainee@example.test");
        Assert.IsTrue(joined.Profiles.Single().IsSelfDirected);
        Assert.AreEqual("SignUp", joined.Assignments.Single().Reason);
        var unmarked = await N9a1RefusedBySqlAsync(N9a1MarkSql, ("mark", false), ("id", spaceId));
        Assert.AreEqual("55000", unmarked.SqlState, unmarked.MessageText);
    }

    [TestMethod]
    public async Task N9a1TheMigrationRefusesToRevertWhileASpaceIsTheHouse()
    {
        using var owner = CreateClient();
        var houseId = await RegisterCoachAsync(owner, "n9a1-revert-owner@example.test", "Nour Haddad", "N9a1 Revert House");
        // Marked by hand, not by the command: since N9b1 the command also makes the house's Free plan, which stays after
        // the mark is cleared and whose own migration (reverted first) would refuse before this one is reached. With
        // no plan of a tier, this migration's own guard is the one that answers below, as its message shows.
        await Phase6ExecuteAsync(N9a1MarkSql, ("mark", true), ("id", houseId));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9a1Migrations(context);

        // A marked house, with nothing in it yet, is a fact the schema before cannot hold: the migration stops with a
        // plain message and stays applied (Npgsql retries 55000 first, each time rolled back).
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual("55000", refused.SqlState, refused.MessageText);
        Assert.Contains("roll forward", refused.MessageText);
        Assert.StartsWith("A coaching space is marked as the house", refused.MessageText);
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual((12L, 1L), (await A7ScalarAsync(N9a1SchemaSql), await A7ScalarAsync(N9a1SignUpReasonSql)));

        // The newest model goes back on before the API is asked; the house is still the house.
        await migrator.MigrateAsync();
        CollectionAssert.AreEqual(new[] { houseId }, await N9a1MarkedAsync());
        using var admin = await SignInPlatformAdminAsync("n9a1-revert-admin@example.test");
        Assert.AreEqual(houseId, (await N9a1HouseReadAsync(admin)).House!.TenantId);

        // Cleared, with a setting's change left behind: that row alone still refuses the way back.
        await N9a1SettingAsync(admin, N9a1PlacesSetting, N9a1Places);
        Assert.AreEqual(0, (await N9a1HouseCommandAsync("clear")).Code);
        Assert.IsEmpty(await N9a1MarkedAsync());
        thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual("55000", refused.SqlState, refused.MessageText);
        Assert.Contains("roll forward", refused.MessageText);
        Assert.StartsWith("A coaching space is marked as the house", refused.MessageText);
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.HasCount(1, await N9a1StoredChangesAsync(houseId));
    }

    // ---------- helpers ----------

    /// <summary><c>platform-admin house ...</c> as whoever runs the deployment types it: its exit code and what it said.</summary>
    private async Task<(int Code, string Said)> N9a1HouseCommandAsync(params string[] words)
    {
        var output = new StringWriter();
        var code = await RunPlatformAdminCommandAsync(output, ["house", .. words]);
        return (code, output.ToString().Trim());
    }

    private static async Task<string> N9a1SlugAsync(HttpClient member, Guid tenantId) =>
        (await RequiredJsonAsync<N9a1Membership[]>(await member.GetAsync("/api/tenants")))
            .Single(item => item.TenantId == tenantId).TenantSlug;

    /// <summary>Every coaching space the database has marked as the house: one at most.</summary>
    private async Task<Guid[]> N9a1MarkedAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.Tenants.AsNoTracking().Where(tenant => tenant.IsHouse).Select(tenant => tenant.Id).ToArrayAsync();
    }

    /// <summary>A registered, confirmed account with a name of its own that the command made a platform admin.</summary>
    private async Task<HttpClient> N9a1AdminAsync(string email, string displayName)
    {
        var admin = CreateClient();
        await RegisterCoachAsync(admin, email, displayName, $"Admin {Guid.NewGuid():N}");
        admin.DefaultRequestHeaders.Remove("X-Tenant-Id");
        Assert.AreEqual(0, await RunPlatformAdminCommandAsync(new StringWriter(), "grant", email));
        return admin;
    }

    private static async Task<N9a1HouseRead> N9a1HouseReadAsync(HttpClient admin)
    {
        var response = await admin.GetAsync(N9a1HouseUrl);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N9a1HouseRead>(response);
    }

    /// <summary>One write of one setting with the version the page read, whatever the answer.</summary>
    private static async Task<HttpResponseMessage> N9a1PutSettingAsync(HttpClient admin, string setting, string? value, int expectedVersion)
    {
        await RefreshCsrfAsync(admin);
        return await admin.PutAsJsonAsync($"{N9a1HouseUrl}/settings/{setting}", new { value, expectedVersion });
    }

    private static async Task<N9a1HouseSetting> N9a1ChangedAsync(HttpClient admin, string setting, string? value, int expectedVersion)
    {
        var response = await N9a1PutSettingAsync(admin, setting, value, expectedVersion);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N9a1HouseSetting>(response);
    }

    /// <summary>Every change of the house's settings as the table holds it, each setting's in the order made.</summary>
    private async Task<N9a1StoredChange[]> N9a1StoredChangesAsync(Guid houseId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var rows = await context.HouseSettingChanges.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == houseId)
            .ToListAsync();
        return [.. rows
            .OrderBy(item => item.Setting)
            .ThenBy(item => item.Sequence)
            .Select(item => new N9a1StoredChange(item.Setting.ToString(), item.Sequence, item.Value, item.ChangedByUserId, item.ChangedAtUtc))];
    }

    /// <summary>The statement PostgreSQL refuses, with the refusal itself.</summary>
    private async Task<PostgresException> N9a1RefusedBySqlAsync(string sql, params (string Name, object Value)[] parameters) =>
        await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, parameters));

    /// <summary>The sweep as the Worker runs it, from a scope of its own on the test host.</summary>
    private async Task<TraineeSignUpSweepResult> N9a1SweepAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ITraineeSignUpSweep>().RunAsync(CancellationToken.None);
    }

    /// <summary>What an account's own row holds of the person, read by its id whatever its address is now.</summary>
    private async Task<N9a1Account> N9a1AccountAsync(Guid userId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var user = await context.Users.AsNoTracking().SingleAsync(item => item.Id == userId);
        return new N9a1Account(
            user.Email,
            user.UserName,
            user.NormalizedEmail,
            user.DisplayName,
            user.PasswordHash is not null,
            user.EmailConfirmed,
            user.SecurityStamp,
            user.LockoutEnd);
    }

    private async Task<DateTimeOffset> N9a1RequestedAtAsync(Guid signUpId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.TraineeSignUps.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.Id == signUpId)
            .Select(item => item.RequestedAtUtc)
            .SingleAsync();
    }

    /// <summary>Notices of one kind in the outbox, by the column that names their subject or their reader.</summary>
    private Task<long> N9a1QueuedAsync(string kind, string column, Guid id) => Phase6CountAsync(
        RequiredDatabaseConnection,
        $"""SELECT count(*) FROM notifications."OutboxItems" WHERE "{column}" = @id AND "Kind" = '{kind}'""",
        id);

    /// <summary>Starts today's one workout and leaves a note on it; returns the workout.</summary>
    private static async Task<Guid> N9a1NoteOnTodaysWorkoutAsync(HttpClient client, string text)
    {
        var day = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Training day was empty.");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(start);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { exercisePerformanceId = (Guid?)null, text }),
            HttpStatusCode.OK);
        return execution.Id;
    }

    /// <summary>
    /// The intake with its names and a date of birth, as the person's own form or the staff's sends it, and the health
    /// details when the test gives any.
    /// </summary>
    private static async Task<HttpResponseMessage> N9a1SaveIntakeAsync(
        HttpClient caller,
        string url,
        DateOnly birthDate,
        uint version,
        N9a1Health? health = null)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PutAsJsonAsync(url, new
        {
            firstName = "Dalia",
            lastName = "Mansour",
            birthDate = N9a1Day(birthDate),
            allergies = health?.Allergies,
            medications = health?.Medications,
            previousInjuries = health?.PreviousInjuries,
            version,
        });
    }

    /// <summary>The whole set-up of a profile, as the client's own form sends it, with this date of birth.</summary>
    private static async Task<HttpResponseMessage> N9a1CompleteOnboardingAsync(
        HttpClient client,
        DateOnly birthDate,
        uint version,
        DateOnly today,
        N9a1Health? health = null)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync("/api/client-profile/me/complete-onboarding", new
        {
            intake = new
            {
                firstName = "Dalia",
                lastName = "Mansour",
                phoneNumber = "+96170000000",
                birthDate = N9a1Day(birthDate),
                heightValue = 168m,
                heightUnit = "Centimeter",
                workType = "Office",
                averageDailySteps = 8000,
                trainingBackground = "Two years",
                foodPreferences = "Mediterranean",
                foodAversions = (string?)null,
                goals = "Build strength",
                allergies = health?.Allergies,
                medications = health?.Medications,
                previousInjuries = health?.PreviousInjuries,
                version,
            },
            initialBodyweightValue = 64.2m,
            initialBodyweightUnit = "Kilogram",
            measurementDate = N9a1Day(today.AddDays(-1)),
        });
    }

    /// <summary>This migration, the one before it, and the migrator that moves between them.</summary>
    private static (string Migration, string Previous, IMigrator Migrator) N9a1Migrations(GymDbContext context)
    {
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_HouseAndTraineeSignUp", StringComparison.Ordinal));
        return (
            migration,
            migrations[Array.IndexOf(migrations, migration) - 1],
            context.Database.GetInfrastructure().GetRequiredService<IMigrator>());
    }

    private sealed record N9a1HouseRead(N9a1HouseSpace? House, N9a1HouseSetting[] Settings, N9a1HouseWeek? SignUp);

    private sealed record N9a1HouseSpace(
        Guid TenantId,
        string Name,
        string Slug,
        string TimeZoneId,
        string WeekStartsOn,
        DateOnly CurrentDate);

    private sealed record N9a1HouseSetting(
        string Setting,
        string? Value,
        int Version,
        DateTimeOffset? ChangedAtUtc,
        Guid? ChangedByUserId,
        string? ChangedByName);

    private sealed record N9a1HouseWeek(
        string Status,
        DateOnly WeekStartsOn,
        DateOnly WeekEndsOnExclusive,
        int SignUpsThisWeek,
        int WaitingForConfirmation);

    private sealed record N9a1StoredChange(string Setting, int Sequence, string? Value, Guid ChangedByUserId, DateTimeOffset ChangedAtUtc);

    /// <summary>The health details of an intake, as it is sent and as the person's own profile reads back.</summary>
    private sealed record N9a1Health(string? Allergies, string? Medications, string? PreviousInjuries);

    private sealed record N9a1Account(
        string? Email,
        string? UserName,
        string? NormalizedEmail,
        string DisplayName,
        bool HasPassword,
        bool EmailConfirmed,
        string? SecurityStamp,
        DateTimeOffset? LockoutEnd);
}
