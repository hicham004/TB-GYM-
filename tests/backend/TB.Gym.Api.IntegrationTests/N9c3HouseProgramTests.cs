using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using TB.Gym.Modules.Training;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;
using StrengthMaxKind = TB.Gym.Modules.Strength.StrengthMaxKind;
using StrengthMaxPage = TB.Gym.Modules.Strength.StrengthMaxPage;
using StrengthMaxSource = TB.Gym.Modules.Strength.StrengthMaxSource;
using StrengthMaxView = TB.Gym.Modules.Strength.StrengthMaxView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9c3, the house's programs and Start (TRN-034) and a trainee's own max (STR-021), against
/// PostgreSQL: the house's staff offer a published program in one unit with whom it suits and its place in a run, by
/// version, and withdraw it; nothing of it reaches another space, a client or a client the house invited; a trainee on
/// Free reads each program's week 1 and the maxes it needs and cannot start it; under a Pro+ pass they type their max
/// within sensible bounds and start a program from today, every week shown, its weights from their max, with no
/// notice, once under one key and one at a time, never a version gone, a withdrawn program or a block that outlasts
/// the pass; a run's next block opens once the block before has ended and starts from its max. Every name is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9c3AStaffUrl = "/api/training/house-programs";

    private const string N9c3AReadUrl = "/api/training/me/house-programs";

    private const string N9c3AMaxUrl = "/api/strength/me/maxes";

    private const string N9c3ASquat = "N9c3 Back Squat";

    private const string N9c3ARow = "N9c3 Barbell Row";

    private const string N9c3AKilogramBounds = "Enter a max above 0 and at most 500 kg, with two decimals at most.";

    private const string N9c3APoundBounds = "Enter a max above 0 and at most 1,100 lb, with two decimals at most.";

    private const string N9c3ATraineeStartReason = "Started by the trainee from the house's programs.";

    private const string N9c3ANeedsPass = "Starting a program needs Pro+. Free keeps running, with everything you logged.";

    private const string N9c3AMaxNeedsPass = "Typing your max is for a program, which needs Pro+.";

    // ---------- 1. the house's staff offer, change and withdraw a program ----------

    [TestMethod]
    public async Task N9c3ATheHousesStaffOfferAPublishedProgramInOneUnitAndChangeOrWithdrawItByVersion()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("offer", withCoach: true);
        var owner = house.Owner;
        var coach = house.House.Coach!;
        var baseOne = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId));
        var starter = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var third = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Third", 1, house.RowId));
        Assert.IsEmpty(await N9c3AListingsAsync(owner));

        // The Owner offers one in a run with its own rounding, trimmed and single-spaced; the Coach offers another with
        // the defaults.
        var offered = await N9c3AOfferedAsync(owner, baseOne.TemplateId, "  Lifters with a year of squatting  ", "  Base   Strength ", 1, 5m, "Down");
        Assert.AreEqual(
            (baseOne.TemplateId, "N9c3 Base One", (Guid?)baseOne.Id, (int?)2, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram, false, "Lifters with a year of squatting"),
            (offered.TemplateId, offered.TemplateName, offered.TemplateVersionId, offered.Weeks, offered.LoadUnit, offered.MixesUnits, offered.Suits));
        Assert.AreEqual(
            ((string?)"Base Strength", (int?)1, 5m, TrainingLoadRoundingMode.Down, true, 0),
            (offered.RunName, offered.RunPosition, offered.LoadIncrement, offered.LoadRoundingMode, offered.IsOffered, offered.TimesStarted));
        var plain = await N9c3AOfferedAsync(coach, starter.TemplateId, "Anyone starting out");
        Assert.AreEqual(
            ((string?)null, (int?)null, 2.5m, TrainingLoadRoundingMode.Nearest, true, (int?)1, (Guid?)starter.Id),
            (plain.RunName, plain.RunPosition, plain.LoadIncrement, plain.LoadRoundingMode, plain.IsOffered, plain.Weeks, plain.TemplateVersionId));

        // Both staff read every listing, a run first.
        foreach (var staff in new[] { owner, coach })
        {
            CollectionAssert.AreEqual(new[] { offered, plain }, await N9c3AListingsAsync(staff));
        }

        // Terms the rule refuses, each under its own field, and nothing kept.
        foreach (var (suits, runName, runPosition, increment, field, message) in new (string?, string?, int?, decimal?, string, string)[]
        {
            (null, null, null, null, "suits", "Say in one line whom this program suits."),
            ("   ", null, null, null, "suits", "Say in one line whom this program suits."),
            ("Two\nlines", null, null, null, "suits", "Keep whom it suits to one line."),
            (new string('s', 201), null, null, null, "suits", "Keep whom it suits to 200 characters or fewer."),
            ("Fine", "Base", null, null, "runPosition", "Say which block of the run this is: 1 for the first."),
            ("Fine", null, 2, null, "runName", "Name the run this block belongs to, or leave its place empty."),
            ("Fine", "Base", 0, null, "runPosition", "A block's place in its run is from 1 to 52."),
            ("Fine", "Base", 53, null, "runPosition", "A block's place in its run is from 1 to 52."),
            ("Fine", new string('r', 81), 1, null, "runName", "Keep the run's name to 80 characters or fewer."),
            ("Fine", null, null, 0m, "loadIncrement", "Round weights to a step above 0 and at most 50, with two decimals at most."),
            ("Fine", null, null, 50.01m, "loadIncrement", "Round weights to a step above 0 and at most 50, with two decimals at most."),
            ("Fine", null, null, 1.255m, "loadIncrement", "Round weights to a step above 0 and at most 50, with two decimals at most."),
        })
        {
            Assert.AreEqual(
                message,
                await A7FieldErrorAsync(await N9c3AOfferAsync(owner, third.TemplateId, suits, runName, runPosition, increment), field),
                $"{field}: '{suits}' '{runName}' {runPosition} {increment}");
        }

        // A program never published, one archived and one whose weights mix kg and lb cannot be offered; an unknown one
        // is not found.
        var neverPublished = Guid.NewGuid();
        await Phase6ExecuteAsync(
            """
            INSERT INTO training."ProgramTemplates" ("Id", "TenantId", "Name", "CurrentVersionNumber", "IsArchived")
            VALUES (@id, @tenant, 'N9c3 Never Published', 0, false)
            """,
            ("id", neverPublished),
            ("tenant", house.TenantId));
        Assert.AreEqual(
            "Publish this program before offering it to trainees.",
            await A7FieldErrorAsync(await N9c3AOfferAsync(owner, neverPublished, "Anyone"), "templateId"));
        var archived = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Archived", 1, house.RowId));
        await Phase6ExecuteAsync("""UPDATE training."ProgramTemplates" SET "IsArchived" = true WHERE "Id" = @id""", ("id", archived.TemplateId));
        Assert.AreEqual(
            "This program is archived, so trainees can't start it.",
            await A7FieldErrorAsync(await N9c3AOfferAsync(owner, archived.TemplateId, "Anyone"), "templateId"));
        var mixed = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Mixed Units", 1, house.SquatId, house.RowId, rowUnit: "Pound"));
        Assert.AreEqual(
            "This program's weights mix kg and lb. Use one unit before offering it to trainees.",
            await A7FieldErrorAsync(await N9c3AOfferAsync(coach, mixed.TemplateId, "Anyone"), "templateId"));
        await AssertStatusAsync(await N9c3AOfferAsync(owner, Guid.NewGuid(), "Anyone"), HttpStatusCode.NotFound);

        // Another program at the run's taken place, the run named in other words: refused, naming the one there and its run.
        Assert.AreEqual(
            ("house_program_run_position_taken", "\"N9c3 Base One\" is already block 1 of Base Strength. Give this one another place, or withdraw that one first."),
            await A7ConflictAsync(await N9c3AOfferAsync(coach, third.TemplateId, "Also lifters", "base strength", 1)));

        // A new listing that claims a version, and a change that names none or an old one: refused as stale.
        Assert.AreEqual("concurrency_conflict", (await A7ConflictAsync(await N9c3AOfferAsync(owner, third.TemplateId, "Anyone", version: 7))).Code);
        Assert.AreEqual("concurrency_conflict", (await A7ConflictAsync(await N9c3AOfferAsync(owner, baseOne.TemplateId, "No version"))).Code);
        var changed = await N9c3AOfferedAsync(coach, baseOne.TemplateId, "Lifters past the basics", "Base Strength", 1, 5m, "Down", offered.Version);
        Assert.AreEqual((offered.ListingId, "Lifters past the basics"), (changed.ListingId, changed.Suits));
        Assert.AreNotEqual(offered.Version, changed.Version);
        Assert.AreEqual(
            "concurrency_conflict",
            (await A7ConflictAsync(await N9c3AOfferAsync(owner, baseOne.TemplateId, "Owner's words", "Base Strength", 1, version: offered.Version))).Code);
        Assert.AreEqual("concurrency_conflict", (await A7ConflictAsync(await N9c3AWithdrawAsync(owner, baseOne.TemplateId, offered.Version))).Code);
        CollectionAssert.AreEqual(new[] { changed, plain }, await N9c3AListingsAsync(owner), "Only the Coach's change was kept.");

        // Without the antiforgery token: refused and nothing kept.
        owner.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Assert.AreEqual(
            "antiforgery_token_invalid",
            await N9c3ACodeAsync(
                await owner.PutAsJsonAsync(N9c3AListingUrl(baseOne.TemplateId), new { suits = "No token", version = changed.Version }),
                HttpStatusCode.BadRequest));
        Assert.AreEqual(
            "antiforgery_token_invalid",
            await N9c3ACodeAsync(
                await owner.PostAsJsonAsync($"{N9c3AListingUrl(baseOne.TemplateId)}/withdraw", new { version = changed.Version }),
                HttpStatusCode.BadRequest));
        CollectionAssert.AreEqual(new[] { changed, plain }, await N9c3AListingsAsync(owner));

        // A trainee reads both offered programs; withdrawn, one leaves their list and stays on the staff's, last.
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-offer-talia@example.test", "Talia", "Wexford");
        CollectionAssert.AreEqual(
            new[] { changed.ListingId, plain.ListingId },
            (await N9c3AReadAsync(trainee.Client)).Programs.Select(item => item.ListingId).ToArray());
        await AssertStatusAsync(await N9c3AWithdrawAsync(owner, third.TemplateId, 0), HttpStatusCode.NotFound);
        var withdrawn = await N9c3AWithdrawnAsync(owner, baseOne.TemplateId, changed.Version);
        Assert.AreEqual(changed with { IsOffered = false, Version = withdrawn.Version }, withdrawn);
        CollectionAssert.AreEqual(new[] { plain.ListingId }, (await N9c3AReadAsync(trainee.Client)).Programs.Select(item => item.ListingId).ToArray());
        CollectionAssert.AreEqual(new[] { plain, withdrawn }, await N9c3AListingsAsync(coach));

        // Its place is free while it is withdrawn; offered again there, it finds the place taken.
        var placed = await N9c3AOfferedAsync(coach, third.TemplateId, "Also lifters", "Base Strength", 1);
        Assert.AreEqual(((string?)"Base Strength", (int?)1, true), (placed.RunName, placed.RunPosition, placed.IsOffered));
        Assert.AreEqual(
            "house_program_run_position_taken",
            (await A7ConflictAsync(await N9c3AOfferAsync(owner, baseOne.TemplateId, "Lifters", "Base Strength", 1, version: withdrawn.Version))).Code);
        var again = await N9c3AOfferedAsync(owner, baseOne.TemplateId, "Lifters", "Base Strength", 2, version: withdrawn.Version);
        Assert.AreEqual((withdrawn.ListingId, true, (int?)2), (again.ListingId, again.IsOffered, again.RunPosition));
        Assert.AreEqual(3L, await A7ScalarAsync("""SELECT count(*) FROM training."HouseProgramListings" """));
    }

    // ---------- 2. the house's alone, and its staff's alone ----------

    [TestMethod]
    public async Task N9c3AHouseProgramsLiveInTheHouseAloneAndOnlyItsStaffMarkThem()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("where");
        var program = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, program.TemplateId, "Anyone starting out");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-where-talia@example.test", "Talia", "Wexford");
        using var coach = CreateClient();
        var outside = await RegisterCoachAsync(coach, "n9c3a-where-zeina@example.test", "Zeina Aoun", "N9c3A Where Gym");
        var outsideRow = await CreateExerciseAsync(coach, "N9c3 Outside Row", [], []);
        var theirs = await PublishProgramAsync(coach, N9c3ADirectProgram("N9c3 Outside Program", 1, outsideRow.Id));

        // An ordinary coaching space has no programs for trainees: every staff route answers as missing, for its own
        // program and the house's.
        await AssertStatusAsync(await coach.GetAsync(N9c3AStaffUrl), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3AOfferAsync(coach, theirs.TemplateId, "Anyone"), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3AOfferAsync(coach, program.TemplateId, "Anyone"), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3AWithdrawAsync(coach, theirs.TemplateId, 0), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3AWithdrawAsync(coach, program.TemplateId, listing.Version), HttpStatusCode.NotFound);

        // The house's Owner naming the coaching space's program: not one of the house's.
        await AssertStatusAsync(await N9c3AOfferAsync(house.Owner, theirs.TemplateId, "Anyone"), HttpStatusCode.NotFound);

        // The coach in the house, where they are nobody: refused.
        SetTenant(coach, house.TenantId);
        await AssertStatusAsync(await coach.GetAsync(N9c3AStaffUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3AOfferAsync(coach, program.TemplateId, "Anyone"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3AWithdrawAsync(coach, program.TemplateId, listing.Version), HttpStatusCode.Forbidden);
        SetTenant(coach, outside);

        // The house's trainee and a client it invited: the staff's routes are not theirs.
        using var rita = CreateClient();
        await InviteAndAcceptAsync(house.Owner, rita, "n9c3a-where-rita@example.test", true);
        foreach (var (client, who) in new[] { (trainee.Client, "the trainee"), (rita, "a client the house invited") })
        {
            await AssertStatusAsync(await client.GetAsync(N9c3AStaffUrl), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await N9c3AOfferAsync(client, program.TemplateId, $"Changed by {who}"), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await N9c3AWithdrawAsync(client, program.TemplateId, listing.Version), HttpStatusCode.Forbidden);
        }

        // Nothing changed, and the database keeps listings the house's whoever writes.
        Assert.AreEqual(listing, (await N9c3AListingsAsync(house.Owner)).Single());
        Assert.AreEqual(1L, await A7ScalarAsync("""SELECT count(*) FROM training."HouseProgramListings" """));
        var refused = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(
            """
            INSERT INTO training."HouseProgramListings"
                ("Id", "TenantId", "TemplateId", "Suits", "LoadIncrement", "LoadRoundingMode", "IsOffered")
            VALUES (uuidv7(), @tenant, @template, 'Anyone', 2.5, 'Nearest', true)
            """,
            ("tenant", outside),
            ("template", theirs.TemplateId)));
        Assert.AreEqual("23514", refused.SqlState, refused.MessageText);
        Assert.AreEqual(1L, await A7ScalarAsync("""SELECT count(*) FROM training."HouseProgramListings" """));
    }

    // ---------- 3. a trainee on Free reads the programs ----------

    [TestMethod]
    public async Task N9c3AATraineeOnFreeReadsEachProgramsWeekOneAndTheMaxesItNeedsButCannotStartIt()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("free");
        var owner = house.Owner;
        var baseOne = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId));
        var starter = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var plainListing = await N9c3AOfferedAsync(owner, starter.TemplateId, "Anyone starting out");
        var baseListing = await N9c3AOfferedAsync(owner, baseOne.TemplateId, "Lifters with a year of squatting", "Base", 1);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-free-talia@example.test", "Talia", "Wexford");

        var read = await N9c3AReadAsync(trainee.Client);
        Assert.AreEqual(today, read.Today);
        Assert.IsNull(read.Pass, "Free is no pass.");
        Assert.IsNull(read.Running);
        CollectionAssert.AreEqual(new[] { baseListing.ListingId, plainListing.ListingId }, read.Programs.Select(item => item.ListingId).ToArray(), "A run first.");

        var program = read.Programs[0];
        Assert.AreEqual(
            (baseOne.TemplateId, baseOne.Id, "N9c3 Base One", (string?)"N9c3 Base One: squat by your max, rows by weight", "Lifters with a year of squatting", (string?)"Base", (int?)1),
            (program.TemplateId, program.TemplateVersionId, program.Name, program.Description, program.Suits, program.RunName, program.RunPosition));
        Assert.AreEqual(
            (2, TrainingLoadUnit.Kilogram, false, (string?)"house_program_needs_pass", (DateOnly?)null, (DateOnly?)null, 0),
            (program.Weeks, program.LoadUnit, program.CanStart, program.Refusal, program.OpensOn, program.LastStartDay, program.TimesStarted));

        // Week 1: each session on its day and each lift with its sets and reps; a warm-up counts as a set, never toward
        // the reps.
        Assert.HasCount(2, program.SampleWeek);
        Assert.AreEqual(("Lower", 0), (program.SampleWeek[0].Name, program.SampleWeek[0].DayOffset));
        Assert.AreEqual(new HouseProgramSampleExerciseView(house.SquatId, N9c3ASquat, true, 3, 5, 5), program.SampleWeek[0].Exercises.Single());
        Assert.AreEqual(("Pull", 2), (program.SampleWeek[1].Name, program.SampleWeek[1].DayOffset));
        Assert.AreEqual(new HouseProgramSampleExerciseView(house.RowId, N9c3ARow, false, 2, 8, 12), program.SampleWeek[1].Exercises.Single());

        // The max the squat by share needs, not given yet; the rows by weight need none.
        Assert.AreEqual(
            new HouseProgramMaxView(house.SquatId, N9c3ASquat, TrainingLoadUnit.Kilogram, null, null, null),
            program.Maxes.Single());
        var plain = read.Programs[1];
        Assert.IsEmpty(plain.Maxes);
        Assert.AreEqual(
            ((string?)null, (string?)null, 1, false, (string?)"house_program_needs_pass"),
            (plain.RunName, plain.Description, plain.Weeks, plain.CanStart, plain.Refusal));

        // Started anyway on Free, or under a Pro+ plan still waiting for its money: refused, and nothing kept.
        foreach (var what in new[] { "on Free", "under a plan waiting for its money" })
        {
            if (what != "on Free")
            {
                await AssertStatusAsync(
                    await N9c1EnrollAsync(owner, trainee.ProfileId, house.Space.OfferId, today, Guid.NewGuid()),
                    HttpStatusCode.OK);
                var waiting = await N9c3AReadAsync(trainee.Client);
                Assert.IsNull(waiting.Pass, what);
                Assert.IsTrue(waiting.Programs.All(item => item.Refusal == "house_program_needs_pass"), what);
            }

            foreach (var (listingId, versionId) in new[] { (baseListing.ListingId, baseOne.Id), (plainListing.ListingId, starter.Id) })
            {
                Assert.AreEqual(
                    ("house_program_needs_pass", N9c3ANeedsPass),
                    await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listingId, versionId, Guid.NewGuid())),
                    what);
            }
        }

        Assert.AreEqual(0L, await N9c3AProgramsOfAsync(trainee.ProfileId));
        Assert.AreEqual(0L, await N9c3AStartsOfAsync(trainee.ProfileId));
    }

    // ---------- 4. the house's own trainee alone ----------

    [TestMethod]
    public async Task N9c3AOnlyTheHousesOwnTraineeReadsTheProgramsStartsOneOrTypesAMax()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("who");
        var program = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, program.TemplateId, "Anyone starting out");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-who-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);
        using var rita = CreateClient();
        var ritaId = await InviteAndAcceptAsync(house.Owner, rita, "n9c3a-who-rita@example.test", true);
        using var coach = CreateClient();
        var outside = await RegisterCoachAsync(coach, "n9c3a-who-zeina@example.test", "Zeina Aoun", "N9c3A Who Gym");
        using var karim = CreateClient();
        var karimId = await InviteAndAcceptAsync(coach, karim, "n9c3a-who-karim@example.test", true);
        var outsideRow = await CreateExerciseAsync(coach, "N9c3 Outside Row", [], []);

        // A client the house invited and a coach's client in their own space: as if nothing were there.
        foreach (var (client, exerciseId, who) in new[] { (rita, house.RowId, "a client the house invited"), (karim, outsideRow.Id, "a coach's client") })
        {
            await AssertStatusAsync(await client.GetAsync(N9c3AReadUrl), HttpStatusCode.NotFound);
            await AssertStatusAsync(await N9c3AStartAsync(client, listing.ListingId, program.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
            await AssertStatusAsync(await N9c3ATypeMaxAsync(client, exerciseId, 100m), HttpStatusCode.NotFound);
        }

        // The house's staff on the trainee's routes: refused.
        await AssertStatusAsync(await house.Owner.GetAsync(N9c3AReadUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3AStartAsync(house.Owner, listing.ListingId, program.Id, Guid.NewGuid()), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(house.Owner, house.RowId, 100m), HttpStatusCode.Forbidden);

        // The trainee naming the coaching space, and the coach's client naming the house: refused where they are nobody.
        SetTenant(trainee.Client, outside);
        await AssertStatusAsync(await trainee.Client.GetAsync(N9c3AReadUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, program.Id, Guid.NewGuid()), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, outsideRow.Id, 100m), HttpStatusCode.Forbidden);
        SetTenant(trainee.Client, house.TenantId);
        SetTenant(karim, house.TenantId);
        await AssertStatusAsync(await karim.GetAsync(N9c3AReadUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3AStartAsync(karim, listing.ListingId, program.Id, Guid.NewGuid()), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(karim, house.RowId, 100m), HttpStatusCode.Forbidden);

        // The trainee themselves: an unknown program and a lift of another space are not found.
        await AssertStatusAsync(await N9c3AStartAsync(trainee.Client, Guid.NewGuid(), program.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, outsideRow.Id, 100m), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, Guid.NewGuid(), 100m), HttpStatusCode.NotFound);

        // Nothing was written for anyone.
        foreach (var profileId in new[] { trainee.ProfileId, ritaId, karimId })
        {
            Assert.AreEqual(0L, await N9c3AProgramsOfAsync(profileId));
            Assert.AreEqual(0L, await N9c3AMaxesOfAsync(profileId));
        }

        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM training."HouseProgramStarts" """));
    }

    // ---------- 5. a trainee's own max ----------

    [TestMethod]
    public async Task N9c3AATraineeTypesTheirOwnMaxOnlyUnderAPassWithinItsBoundsAndTheReadThenStartsFromIt()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("max");
        var baseOne = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, baseOne.TemplateId, "Lifters with a year of squatting");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-max-talia@example.test", "Talia", "Wexford");

        // On Free: refused, whatever the number, and nothing kept.
        foreach (var value in new[] { 110m, 0m })
        {
            Assert.AreEqual(
                ("house_program_needs_pass", N9c3AMaxNeedsPass),
                await A7ConflictAsync(await N9c3ATypeMaxAsync(trainee.Client, house.SquatId, value)));
        }

        Assert.AreEqual(0L, await N9c3AMaxesOfAsync(trainee.ProfileId));

        // Under a Pro+ pass: the read names the pass and the last day the block can start, and waits for the max.
        var passId = (await N9c1AskAndBookAsync(house.Space, trainee)).Outcome!.EnrollmentId!.Value;
        var read = await N9c3AReadAsync(trainee.Client);
        Assert.AreEqual(new HouseProgramPassView(passId, N9c1PlanName, today, today.AddDays(28)), read.Pass);
        var program = read.Programs.Single();
        Assert.AreEqual(
            (false, (string?)"house_program_needs_maxes", (DateOnly?)today.AddDays(14)),
            (program.CanStart, program.Refusal, program.LastStartDay));
        Assert.AreEqual(
            ("house_program_needs_maxes", $"Type your max for {N9c3ASquat} first, in kg: this program works its weights out from it."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, baseOne.Id, Guid.NewGuid())));

        // Numbers no trainee lifts, or typed past the cent: refused and nothing kept.
        foreach (var (value, unit, message) in new[]
        {
            (0m, "Kilogram", N9c3AKilogramBounds),
            (-5m, "Kilogram", N9c3AKilogramBounds),
            (500.01m, "Kilogram", N9c3AKilogramBounds),
            (100.125m, "Kilogram", N9c3AKilogramBounds),
            (1100.01m, "Pound", N9c3APoundBounds),
            (225.555m, "Pound", N9c3APoundBounds),
        })
        {
            Assert.AreEqual(
                message,
                await A7FieldErrorAsync(await N9c3ATypeMaxAsync(trainee.Client, house.SquatId, value, unit), "value"),
                $"{value} {unit}");
        }

        Assert.AreEqual(0L, await N9c3AMaxesOfAsync(trainee.ProfileId));

        // A max in pounds is kept but never converted for a program in kilograms.
        var pounds = await N9c3ATypedAsync(trainee.Client, house.SquatId, 242.5m, "Pound");
        Assert.AreEqual((242.5m, StrengthLoadUnit.Pound), (pounds.Value, pounds.Unit));
        Assert.AreEqual(
            new HouseProgramMaxView(house.SquatId, N9c3ASquat, TrainingLoadUnit.Kilogram, null, null, null),
            (await N9c3AReadAsync(trainee.Client)).Programs.Single().Maxes.Single());

        // In kilograms: a training max of their own, from the house's day, as the history keeps every max.
        var typed = await N9c3ATypedAsync(trainee.Client, house.SquatId, 110m);
        Assert.AreEqual(
            (trainee.ProfileId, house.SquatId, N9c3ASquat, StrengthMaxKind.CoachWorkingMax, 110m, StrengthLoadUnit.Kilogram, today),
            (typed.ClientProfileId, typed.ExerciseId, typed.ExerciseName, typed.Kind, typed.Value, typed.Unit, typed.EffectiveDate));
        Assert.AreEqual(
            (StrengthMaxSource.Manual, "TraineeTyped", "1.0", (Guid?)null, (string?)null),
            (typed.Source, typed.MethodKey, typed.MethodVersion, typed.SourceWorkoutExecutionId, typed.Note));

        // The bounds themselves are sensible, for any lift of the house.
        Assert.AreEqual(500m, (await N9c3ATypedAsync(trainee.Client, house.RowId, 500m)).Value);
        Assert.AreEqual(1100m, (await N9c3ATypedAsync(trainee.Client, house.RowId, 1100m, "Pound")).Value);

        // The house's staff read them among the trainee's maxes.
        var squats = await ReadSliceAsync<StrengthMaxPage>(house.Owner, $"/api/strength/clients/{trainee.ProfileId}/maxes?exerciseId={house.SquatId}");
        CollectionAssert.AreEquivalent(new[] { typed.Id, pounds.Id }, squats.Items.Select(item => item.Id).ToArray());
        var kept = squats.Items.Single(item => item.Id == typed.Id);
        Assert.AreEqual(
            (StrengthMaxKind.CoachWorkingMax, 110m, StrengthLoadUnit.Kilogram, today, StrengthMaxSource.Manual, "TraineeTyped"),
            (kept.Kind, kept.Value, kept.Unit, kept.EffectiveDate, kept.Source, kept.MethodKey));
        Assert.AreEqual(4, (await ReadSliceAsync<StrengthMaxPage>(house.Owner, $"/api/strength/clients/{trainee.ProfileId}/maxes")).Total);
        Assert.AreEqual(4L, await N9c3AMaxesOfAsync(trainee.ProfileId));

        // Whoever writes, a max is never changed.
        var refused = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(
            """UPDATE strength."MaxHistory" SET "Value" = 120 WHERE "Id" = @id""",
            ("id", typed.Id)));
        Assert.AreEqual("55000", refused.SqlState);

        // The read now starts the program from it.
        program = (await N9c3AReadAsync(trainee.Client)).Programs.Single();
        Assert.AreEqual(
            new HouseProgramMaxView(house.SquatId, N9c3ASquat, TrainingLoadUnit.Kilogram, 110m, HouseProgramMaxSource.Typed, today),
            program.Maxes.Single());
        Assert.AreEqual((true, (string?)null), (program.CanStart, program.Refusal));
    }

    // ---------- 6. Start ----------

    [TestMethod]
    public async Task N9c3AStartMakesTheTraineesOwnProgramFromTodayEveryWeekShownWeightsFromTheirMaxAndNoNotice()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("start");
        var owner = house.Owner;
        // Two weeks, the second left unshared in the program as the house wrote it.
        var baseOne = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId, hiddenWeek: 2));
        var listing = await N9c3AOfferedAsync(owner, baseOne.TemplateId, "Lifters with a year of squatting", loadIncrement: 5m);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-start-talia@example.test", "Talia", "Wexford");

        // On Free: refused before anything else.
        Assert.AreEqual(
            "house_program_needs_pass",
            (await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, baseOne.Id, Guid.NewGuid()))).Code);

        // Under the pass: the max is still needed, the lift named.
        var passId = (await N9c1AskAndBookAsync(house.Space, trainee)).Outcome!.EnrollmentId!.Value;
        var needs = await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, baseOne.Id, Guid.NewGuid()));
        Assert.AreEqual("house_program_needs_maxes", needs.Code);
        Assert.Contains(N9c3ASquat, needs.Message);
        Assert.AreEqual(0L, await N9c3AProgramsOfAsync(trainee.ProfileId));

        // Typed, then started: from today, for its two weeks.
        var typed = await N9c3ATypedAsync(trainee.Client, house.SquatId, 110m);
        var started = await N9c3AStartedAsync(trainee.Client, listing.ListingId, baseOne.Id, Guid.NewGuid());
        Assert.AreEqual(
            (listing.ListingId, "N9c3 Base One", today, today.AddDays(14)),
            (started.ListingId, started.Name, started.StartDate, started.EndDateExclusive));

        // The trainee's Training shows every week now, the one the house left unshared too.
        var mine = (await ReadSliceAsync<ClientTrainingProgramView>(trainee.Client, "/api/training/me/program")).Program!;
        Assert.AreEqual(
            (started.ProgramId, ClientProgramPhase.Current, 2, (int?)1, 4),
            (mine.Id, mine.Phase, mine.WeekCount, mine.CurrentWeekNumber, mine.SessionCount));
        CollectionAssert.AreEqual(new[] { today, today.AddDays(7) }, mine.Weeks.Select(week => week.StartDate).ToArray());
        Assert.IsTrue(
            mine.Weeks.All(week => week.IsVisible && week.IsShared && week.Sessions.Count == 2),
            string.Join("; ", mine.Weeks.Select(week => $"week {week.WeekNumber}: {week.IsVisible}/{week.IsShared}/{week.Sessions.Count}")));

        // As the house's staff read it: the trainee's copy of the version under the pass, in kg, with the listing's
        // rounding and their max. 70 % of 110 kg is 77 kg, rounded to the listing's 5 kg step: 75 kg.
        var block = await N9c3ABlockAsync(owner, started.ProgramId);
        Assert.AreEqual(
            (trainee.ProfileId, passId, baseOne.TemplateId, baseOne.Id, today, today.AddDays(14), MesocycleKind.Primary),
            (block.ClientProfileId, block.EnrollmentId, block.SourceTemplateId, block.SourceTemplateVersionId, block.StartDate, block.EndDateExclusive, block.Kind));
        Assert.AreEqual(
            (true, TrainingLoadUnit.Kilogram, 5m, TrainingLoadRoundingMode.Nearest, "N9c3 Base One"),
            (block.RevealAllWeeks, block.LoadUnit, block.LoadIncrement, block.LoadRoundingMode, block.Name));
        Assert.IsTrue(block.Weeks.All(week => week.IsPublished), "Every week is published in the trainee's copy.");
        var max = block.WorkingMaxes.Single();
        Assert.AreEqual(
            (house.SquatId, (Guid?)typed.Id, 110m, TrainingLoadUnit.Kilogram, TrainingMaxSource.SavedMax),
            (max.ExerciseId, max.SourceMaxRecordId, max.Value, max.Unit, max.Source));
        CollectionAssert.AreEqual(
            Enumerable.Repeat(((decimal?)70m, (decimal?)77m, (decimal?)75m), 4).ToArray(),
            N9c3AShares(block, house.SquatId));
        var assigned = block.Lifecycle.Single();
        Assert.AreEqual(
            (MesocycleLifecycleEventType.Assigned, N9c3ATraineeStartReason),
            (assigned.EventType, assigned.Reason));

        // One start recorded, of that version under the pass, from today, with no run.
        Assert.AreEqual(
            1L,
            await A7ScalarAsync(
                $"""
                SELECT count(*) FROM training."HouseProgramStarts"
                WHERE "MesocycleId" = '{started.ProgramId}' AND "ClientProfileId" = '{trainee.ProfileId}'
                  AND "EnrollmentId" = '{passId}' AND "ListingId" = '{listing.ListingId}' AND "TemplateId" = '{baseOne.TemplateId}'
                  AND "TemplateVersionId" = '{baseOne.Id}' AND "StartDate" = '{N9c3ADay(today)}'
                  AND "RunName" IS NULL AND "RunKey" IS NULL AND "RunPosition" IS NULL
                """));
        Assert.AreEqual(1L, await N9c3AStartsOfAsync(trainee.ProfileId));
        Assert.AreEqual(1L, await N9c3AProgramsOfAsync(trainee.ProfileId));

        // No notice: the trainee started it themselves.
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM notifications."OutboxItems" WHERE "Kind" = 'ProgramAssigned'"""));
        Assert.AreEqual(
            0L,
            await N9c3ACountAsync("""SELECT count(*) FROM notifications."OutboxItems" WHERE "AggregateId" = @id""", started.ProgramId));

        // The read: the program running, this one refused until it ends, started once; the staff count it too.
        var read = await N9c3AReadAsync(trainee.Client);
        Assert.AreEqual(new HouseProgramRunningView(started.ProgramId, "N9c3 Base One", today, today.AddDays(14)), read.Running);
        var entry = read.Programs.Single();
        Assert.AreEqual(
            (false, (string?)"mesocycle_overlap", (DateOnly?)today.AddDays(14), (DateOnly?)today.AddDays(14), 1),
            (entry.CanStart, entry.Refusal, entry.OpensOn, entry.LastStartDay, entry.TimesStarted));
        Assert.AreEqual(1, (await N9c3AListingsAsync(owner)).Single().TimesStarted);
    }

    [TestMethod]
    public async Task N9c3AOneKeyReplaysItsStartAndASecondStartIsRefusedWhileTheFirstRuns()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("key");
        var starter = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var other = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Second Starter", 1, house.RowId));
        var longer = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Long Starter", 4, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, starter.TemplateId, "Anyone starting out");
        var otherListing = await N9c3AOfferedAsync(house.Owner, other.TemplateId, "Anyone starting again");
        var longListing = await N9c3AOfferedAsync(house.Owner, longer.TemplateId, "Anyone with a month");
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3a-key-talia@example.test", "Talia", "Wexford", address: "198.51.100.61");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c3a-key-corin@example.test", "Corin", "Ashgrove", address: "198.51.100.62");
        await N9c1AskAndBookAsync(house.Space, talia);
        await N9c1AskAndBookAsync(house.Space, corin);

        // A key is required.
        Assert.AreEqual(
            "A non-empty idempotency key is required.",
            await A7FieldErrorAsync(await N9c3AStartAsync(talia.Client, listing.ListingId, starter.Id, Guid.Empty), "idempotencyKey"));

        // The same request again answers the same program.
        var key = Guid.NewGuid();
        var first = await N9c3AStartedAsync(talia.Client, listing.ListingId, starter.Id, key);
        var again = await N9c3AStartAsync(talia.Client, listing.ListingId, starter.Id, key);
        await AssertStatusAsync(again, HttpStatusCode.OK);
        Assert.AreEqual(first, await ReadSlicePayloadAsync<HouseProgramStartedView>(again));

        // The key with another version, another program or another trainee: refused.
        foreach (var (client, listingId, versionId, what) in new[]
        {
            (talia.Client, listing.ListingId, Guid.NewGuid(), "another version"),
            (talia.Client, otherListing.ListingId, other.Id, "another program"),
            (corin.Client, listing.ListingId, starter.Id, "another trainee"),
        })
        {
            Assert.AreEqual(
                ("idempotency_conflict", "This idempotency key was already used for another start."),
                await A7ConflictAsync(await N9c3AStartAsync(client, listingId, versionId, key)),
                what);
        }

        // The key with a program that does not exist: not found before the key is weighed.
        await AssertStatusAsync(await N9c3AStartAsync(talia.Client, Guid.NewGuid(), starter.Id, key), HttpStatusCode.NotFound);

        // A second program under a new key: one at a time, naming the day it could start while that day is inside the
        // last day to start it; a four-week block, whose last day to start is today, is told one at a time alone.
        Assert.AreEqual(
            ("mesocycle_overlap",
                $"\"N9c3 Starter\" runs until {HouseProgramRules.Day(today.AddDays(6))}. One program at a time: this one can start from {HouseProgramRules.Day(today.AddDays(7))}."),
            await A7ConflictAsync(await N9c3AStartAsync(talia.Client, otherListing.ListingId, other.Id, Guid.NewGuid())));
        Assert.AreEqual(
            ("mesocycle_overlap", $"\"N9c3 Starter\" runs until {HouseProgramRules.Day(today.AddDays(6))}. One program at a time."),
            await A7ConflictAsync(await N9c3AStartAsync(talia.Client, longListing.ListingId, longer.Id, Guid.NewGuid())));
        var waiting = (await N9c3AReadAsync(talia.Client)).Programs.ToDictionary(item => item.ListingId);
        Assert.AreEqual(
            ((string?)"mesocycle_overlap", (DateOnly?)today.AddDays(7), (DateOnly?)today.AddDays(21)),
            (waiting[otherListing.ListingId].Refusal, waiting[otherListing.ListingId].OpensOn, waiting[otherListing.ListingId].LastStartDay));
        Assert.AreEqual(
            ((string?)"mesocycle_overlap", (DateOnly?)today.AddDays(7), (DateOnly?)today),
            (waiting[longListing.ListingId].Refusal, waiting[longListing.ListingId].OpensOn, waiting[longListing.ListingId].LastStartDay));

        // One program and one start for Talia, none for Corin.
        Assert.AreEqual((1L, 1L), (await N9c3AProgramsOfAsync(talia.ProfileId), await N9c3AStartsOfAsync(talia.ProfileId)));
        Assert.AreEqual((0L, 0L), (await N9c3AProgramsOfAsync(corin.ProfileId), await N9c3AStartsOfAsync(corin.ProfileId)));
        Assert.AreEqual(first.ProgramId, (await N9c3AReadAsync(talia.Client)).Running!.ProgramId);
    }

    [TestMethod]
    public async Task N9c3ATwoStartsAtOnceMakeOneProgram()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("race");
        var starter = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var other = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Second Starter", 1, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, starter.TemplateId, "Anyone starting out");
        var otherListing = await N9c3AOfferedAsync(house.Owner, other.TemplateId, "Anyone starting again");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-race-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);

        // The first start is held at its insert, holding the trainee's record; the second, under its own key, waits on
        // that lock and then finds the first program holding the days.
        await RefreshCsrfAsync(trainee.Client);
        RequiredInsertBarrier.Arm("training.\"HouseProgramStarts\"", 2);
        HttpResponseMessage byFirst;
        HttpResponseMessage bySecond;
        try
        {
            var a = trainee.Client.PostAsJsonAsync(
                N9c3AStartUrl(listing.ListingId),
                new { templateVersionId = starter.Id, idempotencyKey = Guid.NewGuid() });
            if (await Task.WhenAny(a, RequiredInsertBarrier.ArrivedAsync(1)) == a)
            {
                Assert.Fail($"The first start ended before its insert: {(await a).StatusCode} {await (await a).Content.ReadAsStringAsync()}");
            }

            var b = trainee.Client.PostAsJsonAsync(
                N9c3AStartUrl(otherListing.ListingId),
                new { templateVersionId = other.Id, idempotencyKey = Guid.NewGuid() });
            await N9b1FAwaitLockWaitAsync("house-program-start", b);
            RequiredInsertBarrier.Disarm();
            byFirst = await a;
            bySecond = await b;
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "Only the first start's insert was held.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        await AssertStatusAsync(byFirst, HttpStatusCode.OK);
        Assert.AreEqual("mesocycle_overlap", (await A7ConflictAsync(bySecond)).Code);
        var started = await ReadSlicePayloadAsync<HouseProgramStartedView>(byFirst);
        Assert.AreEqual(listing.ListingId, started.ListingId);
        Assert.AreEqual((1L, 1L), (await N9c3AProgramsOfAsync(trainee.ProfileId), await N9c3AStartsOfAsync(trainee.ProfileId)));
        Assert.AreEqual(started.ProgramId, (await N9c3AReadAsync(trainee.Client)).Running!.ProgramId);
    }

    [TestMethod]
    public async Task N9c3AANewVersionOrAWithdrawalStopsAStartAndNeverChangesAStartedProgram()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("change");
        var owner = house.Owner;
        var first = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId));
        var listing = await N9c3AOfferedAsync(owner, first.TemplateId, "Lifters with a year of squatting", loadIncrement: 5m);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-change-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);
        await N9c3ATypedAsync(trainee.Client, house.SquatId, 110m);
        var key = Guid.NewGuid();
        var started = await N9c3AStartedAsync(trainee.Client, listing.ListingId, first.Id, key);
        var shares = Enumerable.Repeat(((decimal?)70m, (decimal?)77m, (decimal?)75m), 4).ToArray();
        CollectionAssert.AreEqual(shares, N9c3AShares(await N9c3ABlockAsync(owner, started.ProgramId), house.SquatId));

        // The house publishes a heavier version: the list offers it, and the program the trainee started stays theirs.
        var second = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId, share: 80m), first, 1);
        Assert.AreEqual(second.Id, (await N9c3AReadAsync(trainee.Client)).Programs.Single().TemplateVersionId);
        Assert.AreEqual((Guid?)second.Id, (await N9c3AListingsAsync(owner)).Single().TemplateVersionId);
        var block = await N9c3ABlockAsync(owner, started.ProgramId);
        Assert.AreEqual(first.Id, block.SourceTemplateVersionId);
        CollectionAssert.AreEqual(shares, N9c3AShares(block, house.SquatId));

        // The version the trainee read is gone: refused under a new key; the first key still answers its program.
        Assert.AreEqual(
            ("house_program_changed", "TB Gym changed this program since you read it. Read it again, then start it."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, first.Id, Guid.NewGuid())));
        Assert.AreEqual(started, await N9c3AStartedAsync(trainee.Client, listing.ListingId, first.Id, key));

        // The new version under a new key: their program still holds the days.
        Assert.AreEqual(
            "mesocycle_overlap",
            (await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, second.Id, Guid.NewGuid()))).Code);

        // A version mixing kg and lb: the staff read says so, the read and a start refuse it.
        var mixed = await PublishProgramAsync(owner, N9c3AProgram("N9c3 Base One", 2, house.SquatId, house.RowId, rowUnit: "Pound"), second, 2);
        var staffRead = (await N9c3AListingsAsync(owner)).Single();
        Assert.AreEqual(
            ((Guid?)mixed.Id, true, (TrainingLoadUnit?)null, true),
            (staffRead.TemplateVersionId, staffRead.MixesUnits, staffRead.LoadUnit, staffRead.IsOffered));
        Assert.AreEqual("house_program_unit", (await N9c3AReadAsync(trainee.Client)).Programs.Single().Refusal);
        Assert.AreEqual(
            ("house_program_unit", "This program mixes kg and lb, so it can't be started until TB Gym puts it in one unit."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, mixed.Id, Guid.NewGuid())));

        // Withdrawn: the trainee's list leaves it out, a start is refused, and the first key still answers its program.
        var withdrawn = await N9c3AWithdrawnAsync(owner, first.TemplateId, staffRead.Version);
        Assert.IsEmpty((await N9c3AReadAsync(trainee.Client)).Programs);
        Assert.AreEqual(
            ("house_program_not_offered", "TB Gym no longer offers this program. Pick another from the list."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, listing.ListingId, mixed.Id, Guid.NewGuid())));
        Assert.AreEqual(started, await N9c3AStartedAsync(trainee.Client, listing.ListingId, first.Id, key));

        // Offering it again is refused while it mixes units.
        Assert.AreEqual(
            "This program's weights mix kg and lb. Use one unit before offering it to trainees.",
            await A7FieldErrorAsync(await N9c3AOfferAsync(owner, first.TemplateId, "Lifters", version: withdrawn.Version), "templateId"));

        // Their program is as it was started, and it is still their only one.
        block = await N9c3ABlockAsync(owner, started.ProgramId);
        Assert.AreEqual((first.Id, 1), (block.SourceTemplateVersionId, block.Lifecycle.Count));
        CollectionAssert.AreEqual(shares, N9c3AShares(block, house.SquatId));
        Assert.AreEqual((1L, 1L), (await N9c3AProgramsOfAsync(trainee.ProfileId), await N9c3AStartsOfAsync(trainee.ProfileId)));
    }

    [TestMethod]
    public async Task N9c3AABlockStartsOnlyWhenItEndsInsideThePass()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("fit");
        var four = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Four Weeks", 4, house.RowId));
        var five = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Five Weeks", 5, house.RowId));
        var fourListing = await N9c3AOfferedAsync(house.Owner, four.TemplateId, "Four weeks of rows");
        var fiveListing = await N9c3AOfferedAsync(house.Owner, five.TemplateId, "Five weeks of rows");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-fit-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);

        // On the pass's first day the four-week block fits it to its last day; the five-week one never does, so it has no
        // last day to start.
        var read = await N9c3AReadAsync(trainee.Client);
        var fourRead = read.Programs.Single(item => item.ListingId == fourListing.ListingId);
        var fiveRead = read.Programs.Single(item => item.ListingId == fiveListing.ListingId);
        Assert.AreEqual((true, (string?)null, (DateOnly?)today), (fourRead.CanStart, fourRead.Refusal, fourRead.LastStartDay));
        Assert.AreEqual(
            (false, (string?)"house_program_does_not_fit", (DateOnly?)null),
            (fiveRead.CanStart, fiveRead.Refusal, fiveRead.LastStartDay));
        Assert.AreEqual(
            ("house_program_does_not_fit", "This block runs 5 weeks, longer than your pass, so it can't start under it."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, fiveListing.ListingId, five.Id, Guid.NewGuid())));

        // A day later the four-week block would outlast the pass: refused, naming the last day it could start.
        N9b1FSetHouseDay(today.AddDays(1));
        fourRead = (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == fourListing.ListingId);
        Assert.AreEqual(
            (false, (string?)"house_program_does_not_fit", (DateOnly?)today),
            (fourRead.CanStart, fourRead.Refusal, fourRead.LastStartDay));
        Assert.AreEqual(
            ("house_program_does_not_fit",
                $"This block runs 4 weeks and your pass ends on {HouseProgramRules.Day(today.AddDays(27))}, so the last day to start it was {HouseProgramRules.Day(today)}. Start it under your next pass."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, fourListing.ListingId, four.Id, Guid.NewGuid())));
        Assert.AreEqual((0L, 0L), (await N9c3AProgramsOfAsync(trainee.ProfileId), await N9c3AStartsOfAsync(trainee.ProfileId)));
    }

    // ---------- 7. the next block of a run ----------

    [TestMethod]
    public async Task N9c3ATheNextBlockOfARunOpensOnceTheBlockBeforeHasEndedAndStartsFromItsMax()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("run");
        var one = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Base Block 1", 1, house.SquatId, house.RowId));
        var two = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Base Block 2", 1, house.SquatId, house.RowId, share: 75m));
        var blockOne = await N9c3AOfferedAsync(house.Owner, one.TemplateId, "Lifters", "Base", 1);
        // The same run, its name typed in other words.
        var blockTwo = await N9c3AOfferedAsync(house.Owner, two.TemplateId, "Lifters", "  BASE ", 2);
        Assert.AreEqual(((string?)"BASE", (int?)2), (blockTwo.RunName, blockTwo.RunPosition));
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-run-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);
        await N9c3ATypedAsync(trainee.Client, house.SquatId, 110m);

        // Block 2 before block 1 was started: refused, with no day it opens.
        var next = (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == blockTwo.ListingId);
        Assert.AreEqual(
            (false, (string?)"house_program_block_not_open", (DateOnly?)null),
            (next.CanStart, next.Refusal, next.OpensOn));
        Assert.AreEqual(
            ("house_program_block_not_open", "This is block 2 of BASE. Start block 1 first."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, blockTwo.ListingId, two.Id, Guid.NewGuid())));

        // Block 1 started: while it runs, block 2 opens the day after its last day.
        var firstBlock = await N9c3AStartedAsync(trainee.Client, blockOne.ListingId, one.Id, Guid.NewGuid());
        Assert.AreEqual((today, today.AddDays(7)), (firstBlock.StartDate, firstBlock.EndDateExclusive));
        next = (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == blockTwo.ListingId);
        Assert.AreEqual(
            (false, (string?)"house_program_block_not_open", (DateOnly?)today.AddDays(7)),
            (next.CanStart, next.Refusal, next.OpensOn));
        Assert.AreEqual(
            ("house_program_block_not_open", $"Block 2 of BASE opens on {HouseProgramRules.Day(today.AddDays(7))}, once block 1 has ended."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, blockTwo.ListingId, two.Id, Guid.NewGuid())));

        // The day after block 1's last day: nothing runs, and block 2 starts from block 1's max with nothing typed again.
        N9b1FSetHouseDay(today.AddDays(7));
        var read = await N9c3AReadAsync(trainee.Client);
        Assert.IsNull(read.Running);
        next = read.Programs.Single(item => item.ListingId == blockTwo.ListingId);
        Assert.AreEqual(
            new HouseProgramMaxView(house.SquatId, N9c3ASquat, TrainingLoadUnit.Kilogram, 110m, HouseProgramMaxSource.LastProgram, today),
            next.Maxes.Single());
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), (next.CanStart, next.Refusal, next.OpensOn));
        var secondBlock = await N9c3AStartedAsync(trainee.Client, blockTwo.ListingId, two.Id, Guid.NewGuid());
        Assert.AreEqual((today.AddDays(7), today.AddDays(14)), (secondBlock.StartDate, secondBlock.EndDateExclusive));

        var carriedFrom = (await N9c3ABlockAsync(house.Owner, firstBlock.ProgramId)).WorkingMaxes.Single();
        var carried = (await N9c3ABlockAsync(house.Owner, secondBlock.ProgramId)).WorkingMaxes.Single();
        Assert.AreEqual(
            (house.SquatId, 110m, TrainingLoadUnit.Kilogram, TrainingMaxSource.PreviousProgram),
            (carried.ExerciseId, carried.Value, carried.Unit, carried.Source));
        Assert.AreNotEqual(carriedFrom.Id, carried.Id, "The new program has a max of its own, carried over.");
        Assert.AreEqual(1L, await N9c3AMaxesOfAsync(trainee.ProfileId), "Nothing was typed again.");

        // Both starts are kept with their run and place.
        Assert.AreEqual(
            2L,
            await N9c3ACountAsync(
                """
                SELECT count(*) FROM training."HouseProgramStarts"
                WHERE "ClientProfileId" = @id AND "RunKey" = 'base' AND "RunPosition" IN (1, 2)
                """,
                trainee.ProfileId));
        Assert.IsTrue((await N9c3AListingsAsync(house.Owner)).All(item => item.TimesStarted == 1), "Each block was started once.");
    }

    [TestMethod]
    public async Task N9c3AARunRenamedAfterItsFirstBlockStillOpensItsNextBlockAndABlockWithNoBlockBeforeOfferedSaysSo()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("rename");
        var owner = house.Owner;
        var one = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Base Block 1", 1, house.RowId));
        var two = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Base Block 2", 1, house.RowId));
        var peakOne = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Peak Block 1", 1, house.RowId));
        var peakTwo = await PublishProgramAsync(owner, N9c3ADirectProgram("N9c3 Peak Block 2", 1, house.RowId));
        var blockOne = await N9c3AOfferedAsync(owner, one.TemplateId, "Lifters", "Base", 1);
        var blockTwo = await N9c3AOfferedAsync(owner, two.TemplateId, "Lifters", "Base", 2);
        var peakFirst = await N9c3AOfferedAsync(owner, peakOne.TemplateId, "Lifters", "Peak", 1);
        var peakSecond = await N9c3AOfferedAsync(owner, peakTwo.TemplateId, "Lifters", "Peak", 2);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-rename-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);

        // Peak's block 1 withdrawn before the trainee started it: block 2 has no block before it on offer, and says so,
        // with no day it opens.
        await N9c3AWithdrawnAsync(owner, peakOne.TemplateId, peakFirst.Version);
        var peak = (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == peakSecond.ListingId);
        Assert.AreEqual(
            (false, (string?)"house_program_block_not_open", (DateOnly?)null),
            (peak.CanStart, peak.Refusal, peak.OpensOn));
        Assert.AreEqual(
            ("house_program_block_not_open", "This is block 2 of Peak, and block 1 isn't offered now, so it can't start yet."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, peakSecond.ListingId, peakTwo.Id, Guid.NewGuid())));

        // Base's block 1 started, then the staff rename the run, each block kept in its place.
        var first = await N9c3AStartedAsync(trainee.Client, blockOne.ListingId, one.Id, Guid.NewGuid());
        var renamedOne = await N9c3AOfferedAsync(owner, one.TemplateId, "Lifters", "Strength  Base", 1, version: blockOne.Version);
        var renamedTwo = await N9c3AOfferedAsync(owner, two.TemplateId, "Lifters", "Strength Base", 2, version: blockTwo.Version);
        Assert.AreEqual(
            ((string?)"Strength Base", (int?)1, (string?)"Strength Base", (int?)2),
            (renamedOne.RunName, renamedOne.RunPosition, renamedTwo.RunName, renamedTwo.RunPosition));

        // While block 1 runs, the renamed run's block 2 opens the day after block 1's last day.
        var next = (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == blockTwo.ListingId);
        Assert.AreEqual(
            ((string?)"Strength Base", false, (string?)"house_program_block_not_open", (DateOnly?)today.AddDays(7)),
            (next.RunName, next.CanStart, next.Refusal, next.OpensOn));
        Assert.AreEqual(
            ("house_program_block_not_open", $"Block 2 of Strength Base opens on {HouseProgramRules.Day(today.AddDays(7))}, once block 1 has ended."),
            await A7ConflictAsync(await N9c3AStartAsync(trainee.Client, blockTwo.ListingId, two.Id, Guid.NewGuid())));

        // Once block 1's dates end, block 2 opens under the run's new name and starts.
        N9b1FSetHouseDay(today.AddDays(7));
        next = (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == blockTwo.ListingId);
        Assert.AreEqual((true, (string?)null, (DateOnly?)null), (next.CanStart, next.Refusal, next.OpensOn));
        var second = await N9c3AStartedAsync(trainee.Client, blockTwo.ListingId, two.Id, Guid.NewGuid());
        Assert.AreEqual((today.AddDays(7), today.AddDays(14)), (second.StartDate, second.EndDateExclusive));

        // Each start keeps the run's name and place as they were when it was started.
        foreach (var (programId, runName, runKey, position) in new[]
        {
            (first.ProgramId, "Base", "base", 1),
            (second.ProgramId, "Strength Base", "strength base", 2),
        })
        {
            Assert.AreEqual(
                1L,
                await N9c3ACountAsync(
                    $"""
                    SELECT count(*) FROM training."HouseProgramStarts"
                    WHERE "MesocycleId" = @id AND "RunName" = '{runName}' AND "RunKey" = '{runKey}' AND "RunPosition" = {position}
                    """,
                    programId),
                runName);
        }

        // Peak's block 2 still waits on a block 1 nobody can start.
        Assert.AreEqual(
            "house_program_block_not_open",
            (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == peakSecond.ListingId).Refusal);
    }

    // ---------- 8. a paused trainee, and trainees apart ----------

    [TestMethod]
    public async Task N9c3AABlockedTraineeReadsTrainingClosedAndCannotStartAProgramOrTypeAMax()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("blocked");
        var starter = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var other = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Second Starter", 1, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, starter.TemplateId, "Anyone starting out");
        var otherListing = await N9c3AOfferedAsync(house.Owner, other.TemplateId, "Anyone starting again");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-blocked-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);
        var key = Guid.NewGuid();
        var started = await N9c3AStartedAsync(trainee.Client, listing.ListingId, starter.Id, key);

        // The house pauses the trainee.
        await N9c1RelationshipAsync(house.Owner, trainee.ProfileId, "block");

        // The read: Training is closed for every program, and no pass is named.
        var read = await N9c3AReadAsync(trainee.Client);
        Assert.IsNull(read.Pass);
        Assert.HasCount(2, read.Programs);
        Assert.IsTrue(
            read.Programs.All(item => !item.CanStart && item.Refusal == "training_closed"),
            string.Join(", ", read.Programs.Select(item => $"{item.Name}: {item.CanStart}/{item.Refusal}")));

        // Starting a program and typing a max: forbidden, under a pass that still runs.
        await AssertStatusAsync(
            await N9c3AStartAsync(trainee.Client, otherListing.ListingId, other.Id, Guid.NewGuid()),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, house.SquatId, 110m), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, house.RowId, 60m), HttpStatusCode.Forbidden);

        // An unknown program or lift is not found before the pause is weighed, and the first start's key still answers
        // its program.
        await AssertStatusAsync(await N9c3AStartAsync(trainee.Client, Guid.NewGuid(), other.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, Guid.NewGuid(), 110m), HttpStatusCode.NotFound);
        Assert.AreEqual(started, await N9c3AStartedAsync(trainee.Client, listing.ListingId, starter.Id, key));

        // Nothing new was written.
        Assert.AreEqual(
            (1L, 1L, 0L),
            (await N9c3AProgramsOfAsync(trainee.ProfileId), await N9c3AStartsOfAsync(trainee.ProfileId), await N9c3AMaxesOfAsync(trainee.ProfileId)));

        // Unpaused, the read weighs the program again and the max is taken.
        await N9c1RelationshipAsync(house.Owner, trainee.ProfileId, "unblock");
        Assert.AreEqual(
            "mesocycle_overlap",
            (await N9c3AReadAsync(trainee.Client)).Programs.Single(item => item.ListingId == otherListing.ListingId).Refusal);
        Assert.AreEqual(110m, (await N9c3ATypedAsync(trainee.Client, house.SquatId, 110m)).Value);
    }

    [TestMethod]
    public async Task N9c3AOneTraineesStartsProgramAndMaxesNeverReachAnotherTrainee()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("apart");
        var one = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Base Block 1", 1, house.SquatId, house.RowId));
        var two = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Base Block 2", 1, house.SquatId, house.RowId, share: 75m));
        var blockOne = await N9c3AOfferedAsync(house.Owner, one.TemplateId, "Lifters", "Base", 1);
        var blockTwo = await N9c3AOfferedAsync(house.Owner, two.TemplateId, "Lifters", "Base", 2);
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3a-apart-talia@example.test", "Talia", "Wexford", address: "198.51.100.63");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c3a-apart-corin@example.test", "Corin", "Ashgrove", address: "198.51.100.64");
        await N9c1AskAndBookAsync(house.Space, talia);
        await N9c1AskAndBookAsync(house.Space, corin);

        // Talia types her max and starts block 1: her read shows it running and block 2 opening after it.
        var taliaMax = await N9c3ATypedAsync(talia.Client, house.SquatId, 110m);
        var taliaBlock = await N9c3AStartedAsync(talia.Client, blockOne.ListingId, one.Id, Guid.NewGuid());
        var hers = await N9c3AReadAsync(talia.Client);
        Assert.AreEqual(taliaBlock.ProgramId, hers.Running?.ProgramId);
        Assert.AreEqual(1, hers.Programs.Single(item => item.ListingId == blockOne.ListingId).TimesStarted);
        Assert.AreEqual((DateOnly?)today.AddDays(7), hers.Programs.Single(item => item.ListingId == blockTwo.ListingId).OpensOn);

        // Corin reads none of it: nothing running, no max, never started, and block 2 waits on his own block 1.
        var his = await N9c3AReadAsync(corin.Client);
        Assert.IsNull(his.Running);
        var hisOne = his.Programs.Single(item => item.ListingId == blockOne.ListingId);
        Assert.AreEqual(
            new HouseProgramMaxView(house.SquatId, N9c3ASquat, TrainingLoadUnit.Kilogram, null, null, null),
            hisOne.Maxes.Single());
        Assert.AreEqual(
            (false, (string?)"house_program_needs_maxes", (DateOnly?)null, 0),
            (hisOne.CanStart, hisOne.Refusal, hisOne.OpensOn, hisOne.TimesStarted));
        var hisTwo = his.Programs.Single(item => item.ListingId == blockTwo.ListingId);
        Assert.AreEqual(
            (false, (string?)"house_program_block_not_open", (DateOnly?)null, 0),
            (hisTwo.CanStart, hisTwo.Refusal, hisTwo.OpensOn, hisTwo.TimesStarted));
        Assert.AreEqual(
            ("house_program_block_not_open", "This is block 2 of Base. Start block 1 first."),
            await A7ConflictAsync(await N9c3AStartAsync(corin.Client, blockTwo.ListingId, two.Id, Guid.NewGuid())));

        // His start of block 1 is refused for his own missing max, never for her program.
        Assert.AreEqual(
            "house_program_needs_maxes",
            (await A7ConflictAsync(await N9c3AStartAsync(corin.Client, blockOne.ListingId, one.Id, Guid.NewGuid()))).Code);
        Assert.AreEqual(0L, await N9c3AMaxesOfAsync(corin.ProfileId));

        // His own max, then his own program from today beside hers, worked out from his max alone.
        var corinMax = await N9c3ATypedAsync(corin.Client, house.SquatId, 120m);
        Assert.AreEqual(
            new HouseProgramMaxView(house.SquatId, N9c3ASquat, TrainingLoadUnit.Kilogram, 120m, HouseProgramMaxSource.Typed, today),
            (await N9c3AReadAsync(corin.Client)).Programs.Single(item => item.ListingId == blockOne.ListingId).Maxes.Single());
        var corinBlock = await N9c3AStartedAsync(corin.Client, blockOne.ListingId, one.Id, Guid.NewGuid());
        Assert.AreEqual((today, today.AddDays(7)), (corinBlock.StartDate, corinBlock.EndDateExclusive));
        Assert.AreNotEqual(taliaBlock.ProgramId, corinBlock.ProgramId);
        var corinWorking = (await N9c3ABlockAsync(house.Owner, corinBlock.ProgramId)).WorkingMaxes.Single();
        Assert.AreEqual(((Guid?)corinMax.Id, 120m), (corinWorking.SourceMaxRecordId, corinWorking.Value));
        var taliaWorking = (await N9c3ABlockAsync(house.Owner, taliaBlock.ProgramId)).WorkingMaxes.Single();
        Assert.AreEqual(((Guid?)taliaMax.Id, 110m), (taliaWorking.SourceMaxRecordId, taliaWorking.Value));

        // Each reads their own program and their own start; the staff count both.
        his = await N9c3AReadAsync(corin.Client);
        Assert.AreEqual(corinBlock.ProgramId, his.Running?.ProgramId);
        Assert.AreEqual(1, his.Programs.Single(item => item.ListingId == blockOne.ListingId).TimesStarted);
        hers = await N9c3AReadAsync(talia.Client);
        Assert.AreEqual(taliaBlock.ProgramId, hers.Running?.ProgramId);
        Assert.AreEqual(1, hers.Programs.Single(item => item.ListingId == blockOne.ListingId).TimesStarted);
        Assert.AreEqual(2, (await N9c3AListingsAsync(house.Owner)).Single(item => item.ListingId == blockOne.ListingId).TimesStarted);
        foreach (var profileId in new[] { talia.ProfileId, corin.ProfileId })
        {
            Assert.AreEqual(
                (1L, 1L, 1L),
                (await N9c3AProgramsOfAsync(profileId), await N9c3AStartsOfAsync(profileId), await N9c3AMaxesOfAsync(profileId)));
        }
    }

    [TestMethod]
    public async Task N9c3AOneKeySentTwiceAtOnceMakesOneProgramAndAnswersItBothTimes()
    {
        N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("twice");
        var starter = await PublishProgramAsync(house.Owner, N9c3ADirectProgram("N9c3 Starter", 1, house.RowId));
        var listing = await N9c3AOfferedAsync(house.Owner, starter.TemplateId, "Anyone starting out");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-twice-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);

        await RefreshCsrfAsync(trainee.Client);
        var body = new { templateVersionId = starter.Id, idempotencyKey = Guid.NewGuid() };
        var answers = await Task.WhenAll(
            trainee.Client.PostAsJsonAsync(N9c3AStartUrl(listing.ListingId), body),
            trainee.Client.PostAsJsonAsync(N9c3AStartUrl(listing.ListingId), body));
        foreach (var answer in answers)
        {
            await AssertStatusAsync(answer, HttpStatusCode.OK);
        }

        var first = await ReadSlicePayloadAsync<HouseProgramStartedView>(answers[0]);
        Assert.AreEqual(first, await ReadSlicePayloadAsync<HouseProgramStartedView>(answers[1]));
        Assert.AreEqual((1L, 1L), (await N9c3AProgramsOfAsync(trainee.ProfileId), await N9c3AStartsOfAsync(trainee.ProfileId)));
        Assert.AreEqual(
            1L,
            await N9c3ACountAsync("""SELECT count(*) FROM training."HouseProgramStarts" WHERE "MesocycleId" = @id""", first.ProgramId));
        Assert.AreEqual(
            1L,
            await N9c3ACountAsync("""SELECT count(*) FROM training."MesocycleLifecycleEvents" WHERE "MesocycleId" = @id""", first.ProgramId));
        var read = await N9c3AReadAsync(trainee.Client);
        Assert.AreEqual(first.ProgramId, read.Running?.ProgramId);
        Assert.AreEqual(1, read.Programs.Single().TimesStarted);
    }

    // ---------- 9. the listing's rounding, and a max for an archived lift ----------

    [TestMethod]
    public async Task N9c3AAListingsRoundingReachesTheWeightsOfTheProgramStartedFromIt()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("round");
        // 72.5 % of 110 kg is 79.75 kg: 80 kg to the nearest 2.5 kg, 77.5 kg rounded down. 71 % is 78.1 kg: 77.5 kg to
        // the nearest, 80 kg rounded up. Each listing's way differs from the nearest step.
        var down = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Rounded Down", 1, house.SquatId, house.RowId, share: 72.5m));
        var up = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Rounded Up", 1, house.SquatId, house.RowId, share: 71m));
        var downListing = await N9c3AOfferedAsync(house.Owner, down.TemplateId, "Lifters", loadRoundingMode: "Down");
        var upListing = await N9c3AOfferedAsync(house.Owner, up.TemplateId, "Lifters", loadRoundingMode: "Up");
        Assert.AreEqual(
            (2.5m, TrainingLoadRoundingMode.Down, 2.5m, TrainingLoadRoundingMode.Up),
            (downListing.LoadIncrement, downListing.LoadRoundingMode, upListing.LoadIncrement, upListing.LoadRoundingMode));
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c3a-round-talia@example.test", "Talia", "Wexford", address: "198.51.100.65");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c3a-round-corin@example.test", "Corin", "Ashgrove", address: "198.51.100.66");
        foreach (var trainee in new[] { talia, corin })
        {
            await N9c1AskAndBookAsync(house.Space, trainee);
            await N9c3ATypedAsync(trainee.Client, house.SquatId, 110m);
        }

        var rounded = new[]
        {
            (Started: await N9c3AStartedAsync(talia.Client, downListing.ListingId, down.Id, Guid.NewGuid()),
                Mode: TrainingLoadRoundingMode.Down, Share: 72.5m, Unrounded: 79.75m, Prescribed: 77.5m),
            (Started: await N9c3AStartedAsync(corin.Client, upListing.ListingId, up.Id, Guid.NewGuid()),
                Mode: TrainingLoadRoundingMode.Up, Share: 71m, Unrounded: 78.1m, Prescribed: 80m),
        };
        foreach (var (started, mode, share, unrounded, prescribed) in rounded)
        {
            Assert.AreEqual(today, started.StartDate, mode.ToString());
            var block = await N9c3ABlockAsync(house.Owner, started.ProgramId);
            Assert.AreEqual(
                (TrainingLoadUnit.Kilogram, 2.5m, mode),
                (block.LoadUnit, block.LoadIncrement, block.LoadRoundingMode),
                mode.ToString());
            CollectionAssert.AreEqual(
                Enumerable.Repeat(((decimal?)share, (decimal?)unrounded, (decimal?)prescribed), 2).ToArray(),
                N9c3AShares(block, house.SquatId),
                mode.ToString());
        }
    }

    [TestMethod]
    public async Task N9c3ATheMaxRouteTakesAnArchivedLiftOfTheHouseAndNeverAnotherSpacesLift()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9c3AOpenAsync("archived");
        var front = await CreateExerciseAsync(house.Owner, "N9c3 Front Squat", [], []);
        var program = await PublishProgramAsync(house.Owner, N9c3AProgram("N9c3 Front Block", 1, front.Id, house.RowId));
        await N9c3AOfferedAsync(house.Owner, program.TemplateId, "Lifters who front squat");
        // The house archives the lift once the program on offer works its weights out from it.
        await N9c3AArchiveAsync(house.Owner, front);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c3a-archived-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(house.Space, trainee);
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n9c3a-archived-zeina@example.test", "Zeina Aoun", "N9c3A Archived Gym");
        var outside = await CreateExerciseAsync(coach, "N9c3 Outside Squat", [], []);
        var outsideArchived = await CreateExerciseAsync(coach, "N9c3 Outside Old Squat", [], []);
        await N9c3AArchiveAsync(coach, outsideArchived);

        // The read still asks for the archived lift's max.
        var entry = (await N9c3AReadAsync(trainee.Client)).Programs.Single();
        Assert.AreEqual(
            new HouseProgramMaxView(front.Id, "N9c3 Front Squat", TrainingLoadUnit.Kilogram, null, null, null),
            entry.Maxes.Single());
        Assert.AreEqual((false, (string?)"house_program_needs_maxes"), (entry.CanStart, entry.Refusal));

        // Another space's lift, archived or not: not found, and nothing kept.
        foreach (var exerciseId in new[] { outside.Id, outsideArchived.Id })
        {
            await AssertStatusAsync(await N9c3ATypeMaxAsync(trainee.Client, exerciseId, 100m), HttpStatusCode.NotFound);
        }

        Assert.AreEqual(0L, await N9c3AMaxesOfAsync(trainee.ProfileId));

        // The house's archived lift: kept under its name, from the house's day.
        var typed = await N9c3ATypedAsync(trainee.Client, front.Id, 100m);
        Assert.AreEqual(
            (trainee.ProfileId, front.Id, "N9c3 Front Squat", 100m, StrengthLoadUnit.Kilogram, today),
            (typed.ClientProfileId, typed.ExerciseId, typed.ExerciseName, typed.Value, typed.Unit, typed.EffectiveDate));

        // The program now starts from it: 70 % of 100 kg is 70 kg.
        entry = (await N9c3AReadAsync(trainee.Client)).Programs.Single();
        Assert.AreEqual(
            new HouseProgramMaxView(front.Id, "N9c3 Front Squat", TrainingLoadUnit.Kilogram, 100m, HouseProgramMaxSource.Typed, today),
            entry.Maxes.Single());
        Assert.AreEqual((true, (string?)null), (entry.CanStart, entry.Refusal));
        var started = await N9c3AStartedAsync(trainee.Client, entry.ListingId, program.Id, Guid.NewGuid());
        var block = await N9c3ABlockAsync(house.Owner, started.ProgramId);
        var max = block.WorkingMaxes.Single();
        Assert.AreEqual((front.Id, (Guid?)typed.Id, 100m), (max.ExerciseId, max.SourceMaxRecordId, max.Value));
        CollectionAssert.AreEqual(
            Enumerable.Repeat(((decimal?)70m, (decimal?)70m, (decimal?)70m), 2).ToArray(),
            N9c3AShares(block, front.Id));
        Assert.AreEqual(1L, await N9c3AMaxesOfAsync(trainee.ProfileId));
    }

    // ---------- helpers ----------

    /// <summary>The house with its four-week Pro+ plan on sale (N9c1), and a squat and a row in its library.</summary>
    private async Task<N9c3AHouse> N9c3AOpenAsync(string tag, bool withCoach = false)
    {
        var space = await N9c1OpenAsync($"n9c3a-{tag}", withCoach);
        var squat = await CreateExerciseAsync(space.House.Owner, N9c3ASquat, [], []);
        var row = await CreateExerciseAsync(space.House.Owner, N9c3ARow, [], []);
        return new N9c3AHouse(space, squat.Id, row.Id);
    }

    private static string N9c3AListingUrl(Guid templateId) => $"/api/training/templates/{templateId}/house-listing";

    private static string N9c3AStartUrl(Guid listingId) => $"{N9c3AReadUrl}/{listingId}/start";

    private static string N9c3ADay(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task<HttpResponseMessage> N9c3AOfferAsync(
        HttpClient staff,
        Guid templateId,
        string? suits,
        string? runName = null,
        int? runPosition = null,
        decimal? loadIncrement = null,
        string? loadRoundingMode = null,
        uint? version = null)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PutAsJsonAsync(
            N9c3AListingUrl(templateId),
            new { suits, runName, runPosition, loadIncrement, loadRoundingMode, version });
    }

    private static async Task<HouseProgramListingView> N9c3AOfferedAsync(
        HttpClient staff,
        Guid templateId,
        string? suits,
        string? runName = null,
        int? runPosition = null,
        decimal? loadIncrement = null,
        string? loadRoundingMode = null,
        uint? version = null)
    {
        var response = await N9c3AOfferAsync(staff, templateId, suits, runName, runPosition, loadIncrement, loadRoundingMode, version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HouseProgramListingView>(response);
    }

    private static async Task<HttpResponseMessage> N9c3AWithdrawAsync(HttpClient staff, Guid templateId, uint version)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync($"{N9c3AListingUrl(templateId)}/withdraw", new { version });
    }

    private static async Task<HouseProgramListingView> N9c3AWithdrawnAsync(HttpClient staff, Guid templateId, uint version)
    {
        var response = await N9c3AWithdrawAsync(staff, templateId, version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HouseProgramListingView>(response);
    }

    private static Task<HouseProgramListingView[]> N9c3AListingsAsync(HttpClient staff) =>
        ReadSliceAsync<HouseProgramListingView[]>(staff, N9c3AStaffUrl);

    private static Task<HouseProgramsView> N9c3AReadAsync(HttpClient trainee) =>
        ReadSliceAsync<HouseProgramsView>(trainee, N9c3AReadUrl);

    private static async Task<HttpResponseMessage> N9c3AStartAsync(HttpClient trainee, Guid listingId, Guid templateVersionId, Guid key)
    {
        await RefreshCsrfAsync(trainee);
        return await trainee.PostAsJsonAsync(N9c3AStartUrl(listingId), new { templateVersionId, idempotencyKey = key });
    }

    private static async Task<HouseProgramStartedView> N9c3AStartedAsync(HttpClient trainee, Guid listingId, Guid templateVersionId, Guid key)
    {
        var response = await N9c3AStartAsync(trainee, listingId, templateVersionId, key);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HouseProgramStartedView>(response);
    }

    private static async Task<HttpResponseMessage> N9c3ATypeMaxAsync(HttpClient trainee, Guid exerciseId, decimal value, string unit = "Kilogram")
    {
        await RefreshCsrfAsync(trainee);
        return await trainee.PostAsJsonAsync(N9c3AMaxUrl, new { exerciseId, value, unit });
    }

    private static async Task<StrengthMaxView> N9c3ATypedAsync(HttpClient trainee, Guid exerciseId, decimal value, string unit = "Kilogram")
    {
        var response = await N9c3ATypeMaxAsync(trainee, exerciseId, value, unit);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<StrengthMaxView>(response);
    }

    private static async Task N9c3AArchiveAsync(HttpClient staff, Exercise exercise)
    {
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PutAsJsonAsync($"/api/exercises/{exercise.Id}/archive", new { isArchived = true, version = exercise.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>A trainee's program as the house's staff read it.</summary>
    private static Task<TrainingMesocycleView> N9c3ABlockAsync(HttpClient staff, Guid programId) =>
        ReadSliceAsync<TrainingMesocycleView>(staff, $"/api/training/mesocycles/{programId}");

    /// <summary>Each set of a lift worked out from a share of its max, in order: the share, the weight and the weight rounded.</summary>
    private static (decimal? Share, decimal? Unrounded, decimal? Prescribed)[] N9c3AShares(TrainingMesocycleView block, Guid exerciseId) =>
        [.. block.Weeks.OrderBy(week => week.WeekNumber)
            .SelectMany(week => week.Sessions.OrderBy(session => session.Position))
            .SelectMany(session => session.Exercises)
            .Where(exercise => exercise.ExerciseId == exerciseId)
            .SelectMany(exercise => exercise.Sets.OrderBy(set => set.Position))
            .Where(set => set.LoadStrategy == TrainingLoadStrategy.PercentageWorkingMax)
            .Select(set => (set.PercentageWorkingMax, set.UnroundedRecommendedLoad, set.PrescribedLoad))];

    private static async Task<string?> N9c3ACodeAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        await AssertStatusAsync(response, status);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private Task<long> N9c3ACountAsync(string sql, Guid id) => Phase6CountAsync(RequiredDatabaseConnection, sql, id);

    private Task<long> N9c3AProgramsOfAsync(Guid clientProfileId) => N9c3ACountAsync(
        """SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    private Task<long> N9c3AStartsOfAsync(Guid clientProfileId) => N9c3ACountAsync(
        """SELECT count(*) FROM training."HouseProgramStarts" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    private Task<long> N9c3AMaxesOfAsync(Guid clientProfileId) => N9c3ACountAsync(
        """SELECT count(*) FROM strength."MaxHistory" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    /// <summary>
    /// A program of <paramref name="weeks"/> weeks: a Lower day squatting a warm-up of 40 kg × 8 then two sets of 5 at
    /// <paramref name="share"/> % of the max, and a Pull day two days on rowing 30 kg for 8 to 12 and 10 to 12 (the
    /// first in <paramref name="rowUnit"/>). <paramref name="hiddenWeek"/> is left unshared.
    /// </summary>
    private static object N9c3AProgram(
        string name,
        int weeks,
        Guid squatId,
        Guid rowId,
        decimal share = 70m,
        int? hiddenWeek = null,
        string rowUnit = "Kilogram") => new
        {
            name,
            description = $"{name}: squat by your max, rows by weight",
            weeks = Enumerable.Range(1, weeks).Select(number => new
            {
                label = $"Week {number}",
                isPublished = number != hiddenWeek,
                sessions = new[]
                {
                    new
                    {
                        name = "Lower",
                        dayOffset = 0,
                        coachNotes = (string?)null,
                        exercises = new[]
                        {
                            N9c3ALift(
                                squatId,
                                true,
                                N9c3ASet(1, "Direct", 8, 8, direct: 40m, setType: "WarmUp"),
                                N9c3ASet(2, "PercentageWorkingMax", 5, 5, percentage: share),
                                N9c3ASet(3, "PercentageWorkingMax", 5, 5, percentage: share)),
                        },
                    },
                    new
                    {
                        name = "Pull",
                        dayOffset = 2,
                        coachNotes = (string?)null,
                        exercises = new[]
                        {
                            N9c3ALift(
                                rowId,
                                false,
                                N9c3ASet(1, "Direct", 8, 12, direct: 30m, unit: rowUnit),
                                N9c3ASet(2, "Direct", 10, 12, direct: 30m)),
                        },
                    },
                },
            }).ToArray(),
        };

    /// <summary>A program of rows at a typed 30 kg each week, which needs no max.</summary>
    private static object N9c3ADirectProgram(string name, int weeks, Guid rowId) => new
    {
        name,
        description = (string?)null,
        weeks = Enumerable.Range(1, weeks).Select(number => new
        {
            label = $"Week {number}",
            isPublished = true,
            sessions = new[]
            {
                new
                {
                    name = "Pull",
                    dayOffset = 0,
                    coachNotes = (string?)null,
                    exercises = new[] { N9c3ALift(rowId, false, N9c3ASet(1, "Direct", 8, 12, direct: 30m)) },
                },
            },
        }).ToArray(),
    };

    private static object N9c3ALift(Guid exerciseId, bool isMainLift, params object[] sets) => new
    {
        exerciseId,
        position = 1,
        isMainLift,
        modificationPolicy = "CoachApprovedSwap",
        coachNotes = (string?)null,
        approvedAlternativeExerciseIds = Array.Empty<Guid>(),
        sets,
    };

    private static object N9c3ASet(
        int position,
        string strategy,
        int repetitionsMinimum,
        int repetitionsMaximum,
        decimal? direct = null,
        decimal? percentage = null,
        string unit = "Kilogram",
        string setType = "Normal") => new
        {
            position,
            setType,
            repetitionsMinimum,
            repetitionsMaximum,
            loadStrategy = strategy,
            directLoad = direct,
            loadUnit = unit,
            percentageWorkingMax = percentage,
            targetRpe = (decimal?)null,
            targetRir = (decimal?)null,
            exertionDisplayPreference = "Rpe",
            restSeconds = (int?)null,
            tempo = (string?)null,
            coachNotes = (string?)null,
            manualLoadOverride = (decimal?)null,
        };

    private sealed record N9c3AHouse(N9c1Space Space, Guid SquatId, Guid RowId) : IDisposable
    {
        public N9a1House House => Space.House;

        public HttpClient Owner => Space.House.Owner;

        public Guid TenantId => Space.House.TenantId;

        public void Dispose() => Space.Dispose();
    }
}
