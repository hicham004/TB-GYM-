using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Initialization;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b6, the house library's loader (LIB-007), against PostgreSQL: a folder of clips and a sheet
/// loaded into the house's exercise library alone, through the services the coach's screens use (so the upload's
/// checks, the scan and the house's storage allowance apply), as the house's Coach; run again with nothing doubled; a
/// changed line updated and a changed clip replaced, the staff's own tags, swaps and demos kept; a refused line said
/// with its reason while the rest load; any other workspace refused; a full allowance stopping the run; a dry run
/// writing nothing. Every clip is a few bytes the test writes itself, and every name is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b6Header = "name,type,equipment,movement,muscles,instructions,clip";

    private static readonly string[] N9b6Loaded =
    [
        "Band pull-apart | WarmUp | Band | HorizontalPull | Shoulders Primary, Back Secondary | no instructions | in use | band-pull-apart.mp4 Ready",
        "Dead bug | Mobility | None | Rotation | Abdominals Primary | Press your back into the floor, then reach. | in use | dead-bug.webm Ready",
        "Goblet squat | Strength | Kettlebell | Squat | Quadriceps Primary, Glutes Secondary | Hold the bell at your chest./Sit between your heels. | in use | goblet-squat.mp4 Ready",
    ];

    private static readonly string[] N9b6UpdatedFirst =
    [
        "Back Squat | Strength | Barbell | Squat | Quadriceps Primary, Glutes Secondary | Brace and sit. | in use | back-squat.mp4 Ready, back-squat-side.mp4 Ready",
        "Front Squat | Strength | Barbell | Squat | Quadriceps Primary | no instructions | in use | ",
        "Hollow Hold | Strength | Bodyweight | Isolation | Abdominals Primary | no instructions | in use | hollow-hold.mp4 Ready, hollow-hold.mp4 Ready",
        "Plank | Strength | Bodyweight | Isolation | Abdominals Primary | no instructions | in use | plank.mp4 Ready",
    ];

    private static readonly string[] N9b6KeptTags = ["knee-friendly"];

    private static readonly string[] N9b6UpdatedSecond =
    [
        "Back Squat | Power | Barbell | Squat | Quadriceps Primary, Glutes Secondary | Brace and sit. | in use | back-squat.mp4 Ready, back-squat-side.mp4 Ready",
        "Front Squat | Strength | Barbell | Squat | Quadriceps Primary | no instructions | in use | ",
        "Hollow Hold | Strength | Bodyweight | Isolation | Abdominals Primary | no instructions | in use | hollow-hold.mp4 Ready, hollow-hold.mp4 Ready",
        "Plank | Strength | Bodyweight | Isolation | Abdominals Primary | no instructions | in use | plank.mp4 Ready",
    ];

    private static readonly string[] N9b6LoadedNames = ["Back Squat", "Box Squat", "Cable row", "Dip", "Good Morning"];

    [TestMethod]
    public async Task N9b6TheLoaderFillsTheHousesPoolAndTheSameSheetAgainChangesNothing()
    {
        using var house = await N9a1OpenHouseAsync("n9b6-load", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b6-load-trainee@example.test");
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);
        var folder = N9b6Folder();
        N9b6Mp4(folder, "clips/goblet-squat.mp4", 1);
        N9b6Mp4(folder, "clips/band-pull-apart.mp4", 2);
        N9b6WebM(folder, "dead-bug.webm", 3);
        var sheet = N9b6Sheet(
            folder,
            "Goblet squat,Strength,Kettlebell,Squat,Quadriceps; Glutes,\"Hold the bell at your chest.\nSit between your heels.\",clips/goblet-squat.mp4",
            "Band pull-apart,Warm-up and activation,Band,Horizontal pull,Shoulders;Back,,clips/band-pull-apart.mp4",
            "Dead bug,Mobility and flexibility,No equipment,Rotation,Abdominals,\"Press your back into the floor, then reach.\",dead-bug.webm");

        // The dry run says what a run would do and writes nothing: no exercise, no upload, no reservation, no file.
        var dry = await N9b6RunAsync(slug, sheet, HouseLibraryCommand.DryRunFlag);
        Assert.AreEqual(0, dry.Code, dry.Said);
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                $"Dry run: checking exercises.csv against {house.Name} ({slug}). Nothing is written.",
                "The house stores 0 bytes of its 200.0 MB allowance.",
                "Line 2, Goblet squat: would be added.",
                "Line 4, Band pull-apart: would be added.",
                "Line 5, Dead bug: would be added.",
                "Lines: 3",
                "Would be added: 3",
                "Would be updated: 0",
                "Unchanged: 0",
                "Refused: 0",
                "Clips to upload: 3, 138 bytes"),
            dry.Said);
        Assert.IsEmpty(await N9b6LibraryAsync(house.TenantId));
        Assert.AreEqual(0, await N9b5UploadsAsync(house.TenantId));
        Assert.AreEqual(0, await N9b6IngestCountAsync(house.TenantId));
        Assert.AreEqual(0, N9b6StoredFiles());

        var run = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(0, run.Code, run.Said);
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                $"Loading exercises.csv into {house.Name} ({slug}).",
                "The house stores 0 bytes of its 200.0 MB allowance.",
                "Line 2, Goblet squat: added.",
                "Line 4, Band pull-apart: added.",
                "Line 5, Dead bug: added.",
                "Lines: 3",
                "Added: 3",
                "Updated: 0",
                "Unchanged: 0",
                "Refused: 0",
                "Clips uploaded: 3, 138 bytes"),
            run.Said);
        var library = await N9b6LibraryAsync(house.TenantId);
        CollectionAssert.AreEqual(
            N9b6Loaded,
            library);

        // Uploaded as the house's Coach, the one a trainee's record names, through the upload's own checks.
        CollectionAssert.AreEquivalent(
            new[] { house.CoachUserId!.Value, house.CoachUserId.Value, house.CoachUserId.Value },
            (await N9b6AssetsAsync(house.TenantId)).Select(asset => asset.OwnerUserId).ToArray());

        // A trainee of the house finds them in the pool, each with its clip, and opens a clip through the usual grant.
        var pool = await N9b1PPageAsync(trainee.Client, string.Empty);
        Assert.AreEqual("Band pull-apart | Dead bug | Goblet squat", N9b1PNames(pool));
        Assert.IsTrue(pool.Items.All(item => item.Demos.Length == 1 && item.Demos[0].Kind == "Video"));
        var grant = await N9b1PGrantAsync(trainee.Client, pool.Items[0].Demos[0].MediaAssetId);
        Assert.AreEqual(pool.Items[0].Demos[0].MediaAssetId, grant.AssetId);

        // The same sheet again changes nothing and uploads nothing.
        var again = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(0, again.Code, again.Said);
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                $"Loading exercises.csv into {house.Name} ({slug}).",
                "The house stores 138 bytes of its 200.0 MB allowance.",
                "Line 2, Goblet squat: unchanged.",
                "Line 4, Band pull-apart: unchanged.",
                "Line 5, Dead bug: unchanged.",
                "Lines: 3",
                "Added: 0",
                "Updated: 0",
                "Unchanged: 3",
                "Refused: 0",
                "Clips uploaded: 0, 0 bytes"),
            again.Said);
        CollectionAssert.AreEqual(library, await N9b6LibraryAsync(house.TenantId));
        Assert.AreEqual(3, await N9b5UploadsAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9b6AChangedLineIsUpdatedAChangedClipReplacedAndTheStaffsOwnDemosTagsAndSwapsKept()
    {
        using var house = await N9a1OpenHouseAsync("n9b6-update", signUpsPerWeek: null, minimumAge: null);
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);

        // The house's staff made Back Squat by hand, with a clip of their own, a tag and a swap with a note, and Hollow
        // Hold with a clip of their own under the very file name the library's sheet will name.
        var front = await N9b1PExerciseAsync(house.Owner, N9b1PBody(
            "Front Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, []));
        var ownClip = await N9b1PUploadClipAsync(house.Owner);
        var squat = await N9b1PExerciseAsync(house.Owner, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, ["knee-friendly"],
            mediaAssetIds: [ownClip.Id], alternatives: [(front.Id, "When the rack is taken")]));
        var ownHollowClip = await N9b6StaffClipAsync(house.Owner, "hollow-hold.mp4", 7);
        await N9b1PExerciseAsync(house.Owner, N9b1PBody(
            "Hollow Hold", "Strength", "Bodyweight", "Isolation", [("Abdominals", "Primary")], null, [],
            mediaAssetIds: [ownHollowClip]));

        var folder = N9b6Folder();
        N9b6Mp4(folder, "back-squat.mp4", 1);
        N9b6Mp4(folder, "plank.mp4", 2);
        N9b6Mp4(folder, "hollow-hold.mp4", 8);
        var sheet = N9b6Sheet(
            folder,
            "back squat,Strength,Barbell,Squat,Quadriceps;Glutes,Brace and sit.,back-squat.mp4",
            "Plank,Strength,Bodyweight,Isolation,Abdominals,,plank.mp4",
            "Hollow Hold,Strength,Bodyweight,Isolation,Abdominals,,hollow-hold.mp4");
        var first = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(0, first.Code, first.Said);
        StringAssert.Contains(first.Said, "Line 2, back squat: updated (muscles, instructions, clip added first).");
        StringAssert.Contains(first.Said, "Line 3, Plank: added.");
        StringAssert.Contains(first.Said, "Line 4, Hollow Hold: updated (clip added first).");

        // The house's name stands, the library's clip plays first and the staff's own clips, tag and swap stay, the
        // staff's clip under the same file name too.
        CollectionAssert.AreEqual(N9b6UpdatedFirst, await N9b6LibraryAsync(house.TenantId));
        var kept = await ReadSlicePayloadAsync<ExerciseView>(await house.Owner.GetAsync($"/api/exercises/{squat.Id}"));
        CollectionAssert.AreEqual(N9b6KeptTags, kept.Tags.ToArray());
        Assert.AreEqual((front.Id, "When the rack is taken"), (kept.Alternatives.Single().ExerciseId, kept.Alternatives.Single().Note));
        var loadedClips = (await N9b6AssetsAsync(house.TenantId))
            .Where(asset => asset.Title.EndsWith(" (library clip)", StringComparison.Ordinal))
            .Select(asset => asset.Title)
            .Order(StringComparer.Ordinal)
            .ToArray();
        Assert.AreEqual("Back Squat (library clip) | Hollow Hold (library clip) | Plank (library clip)", string.Join(" | ", loadedClips));

        // A new cut of two clips and a new type: the dry run says so and changes nothing.
        var oldClip = (await N9b6AssetsAsync(house.TenantId)).Single(asset => asset.OriginalFileName == "back-squat.mp4");
        N9b6Mp4(folder, "back-squat.mp4", 9);
        N9b6Mp4(folder, "hollow-hold.mp4", 10);
        N9b6Sheet(
            folder,
            "Back Squat,Power,Barbell,Squat,Quadriceps;Glutes,,back-squat.mp4",
            "Plank,Strength,Bodyweight,Isolation,Abdominals,,plank.mp4",
            "Hollow Hold,Strength,Bodyweight,Isolation,Abdominals,,hollow-hold.mp4");
        var libraryBefore = await N9b6LibraryAsync(house.TenantId);
        var assetsBefore = (await N9b6AssetsAsync(house.TenantId)).Select(asset => asset.ToString()).ToArray();
        var ingestBefore = await N9b6IngestCountAsync(house.TenantId);
        var dry = await N9b6RunAsync(slug, sheet, HouseLibraryCommand.DryRunFlag);
        Assert.AreEqual(0, dry.Code, dry.Said);
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                $"Dry run: checking exercises.csv against {house.Name} ({slug}). Nothing is written.",
                "The house stores 320 bytes of its 200.0 MB allowance.",
                "Line 2, Back Squat: would be updated (type, clip replaced).",
                "Line 3, Plank: unchanged.",
                "Line 4, Hollow Hold: would be updated (clip replaced).",
                "Lines: 3",
                "Would be added: 0",
                "Would be updated: 2",
                "Unchanged: 1",
                "Refused: 0",
                "Clips to upload: 2, 128 bytes"),
            dry.Said);
        CollectionAssert.AreEqual(libraryBefore, await N9b6LibraryAsync(house.TenantId));
        CollectionAssert.AreEqual(assetsBefore, (await N9b6AssetsAsync(house.TenantId)).Select(asset => asset.ToString()).ToArray());
        Assert.AreEqual(ingestBefore, await N9b6IngestCountAsync(house.TenantId));

        // The run replaces each library clip in its place and deletes the old one as the library deletes one; an empty
        // instructions cell leaves the instructions as they were; the staff's own clips are never the loader's.
        var second = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(0, second.Code, second.Said);
        StringAssert.Contains(second.Said, "Line 2, Back Squat: updated (type, clip replaced).");
        StringAssert.Contains(second.Said, "Line 3, Plank: unchanged.");
        StringAssert.Contains(second.Said, "Line 4, Hollow Hold: updated (clip replaced).");
        StringAssert.Contains(second.Said, "Clips uploaded: 2, 128 bytes");
        CollectionAssert.AreEqual(N9b6UpdatedSecond, await N9b6LibraryAsync(house.TenantId));
        var assets = await N9b6AssetsAsync(house.TenantId);
        Assert.AreEqual("Tombstoned", assets.Single(asset => asset.Id == oldClip.Id).Status);
        Assert.AreEqual(2, assets.Count(asset => asset.Status == "Tombstoned"), "The two replaced library clips alone.");
        Assert.AreEqual("Ready", assets.Single(asset => asset.Id == ownClip.Id).Status, "The staff's own clip is never the loader's to delete.");
        Assert.AreEqual("Ready", assets.Single(asset => asset.Id == ownHollowClip).Status, "Nor one of the same file name.");

        // The same bytes under a new file name are the same clip: nothing changes.
        File.Move(Path.Combine(folder, "back-squat.mp4"), Path.Combine(folder, "back-squat-v2.mp4"));
        N9b6Sheet(
            folder,
            "Back Squat,Power,Barbell,Squat,Quadriceps;Glutes,,back-squat-v2.mp4",
            "Plank,Strength,Bodyweight,Isolation,Abdominals,,plank.mp4",
            "Hollow Hold,Strength,Bodyweight,Isolation,Abdominals,,hollow-hold.mp4");
        var third = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(0, third.Code, third.Said);
        StringAssert.Contains(third.Said, "Unchanged: 3");
        Assert.AreEqual(7, await N9b5UploadsAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9b6ARefusedLineIsSaidWithItsReasonAndTheOtherLinesLoad()
    {
        using var house = await N9a1OpenHouseAsync("n9b6-refuse", signUpsPerWeek: null, minimumAge: null);
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);
        var archived = await N9b1PExerciseAsync(house.Owner, N9b1PBody(
            "Good Morning", "Strength", "Barbell", "Hinge", [("Hamstrings", "Primary")], null, []));
        await B9ArchiveAsync(house.Owner, archived);
        var box = await N9b1PExerciseAsync(house.Owner, N9b1PBody(
            "Box Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, []));
        await N9b1PExerciseAsync(house.Owner, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, [],
            alternatives: [(box.Id, "When the bar is taken")]));
        await B9ArchiveAsync(house.Owner, box);

        var folder = N9b6Folder();
        N9b6Mp4(folder, "row.mp4", 1);
        N9b6Mp4(folder, "back-squat.mp4", 6);
        N9b6Mp4(folder, "good-morning.mp4", 2);
        N9b6Mp4(folder, "long.mp4", 3);
        N9b6Mp4(folder, "dip.mp4", 4);
        File.WriteAllBytes(Path.Combine(folder, "not-a-clip.mp4"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        File.WriteAllBytes(Path.Combine(folder, "plank.gif"), "GIF89a"u8.ToArray());
        File.WriteAllBytes(Path.Combine(folder, "..", "outside.mp4"), [0, 0, 0, 0, (byte)'f', (byte)'t', (byte)'y', (byte)'p', 0, 0, 0, 0]);
        var longName = new string('a', 161);
        var sheet = N9b6Sheet(
            folder,
            "Cable row,Strength,Cable,Horizontal pull,Back,,row.mp4",
            "Rope climb,Strength,Rope,Vertical pull,Back,,rope.mp4",
            "Hip thrust,Strength,Barbell,Hinge,Glutes,,hip-thrust.mp4",
            "Plank,Strength,Bodyweight,Isolation,Abdominals,,plank.gif",
            "Burpee,Conditioning,Bodyweight,Locomotion,Full body,,not-a-clip.mp4",
            "Sneaky,Strength,Bodyweight,Isolation,Abdominals,,../outside.mp4",
            "good morning,Strength,Barbell,Hinge,Hamstrings,,good-morning.mp4",
            $"{longName},Strength,Bodyweight,Isolation,Abdominals,,long.mp4",
            "Back Squat,Strength,Barbell,Squat,Quadriceps,,back-squat.mp4",
            "Dip,Strength,Bodyweight,Vertical push,Triceps,,dip.mp4");
        var run = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(1, run.Code, run.Said);
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                $"Loading exercises.csv into {house.Name} ({slug}).",
                "The house stores 0 bytes of its 200.0 MB allowance.",
                "Line 2, Cable row: added.",
                "Line 3, Rope climb: refused. The equipment \"Rope\" is not one of: None, Barbell, Dumbbell, Kettlebell, Machine, Cable, Band, Bodyweight, Specialty bar, Other.",
                "Line 4, Hip thrust: refused. No clip named hip-thrust.mp4 in the sheet's folder.",
                "Line 5, Plank: refused. The clip plank.gif is not an MP4 or WebM file. A GIF is converted to an MP4 loop before it is loaded.",
                "Line 6, Burpee: refused. The clip not-a-clip.mp4: The file extension, content type, and signature are not an allowed media format.",
                "Line 7, Sneaky: refused. The clip ../outside.mp4 is outside the sheet's folder.",
                "Line 8, good morning: refused. The house's Good Morning is archived. Restore it in the house's library first, or take its line out of the sheet.",
                $"Line 9, {longName}: refused. The value cannot exceed 160 characters.",
                "Line 10, Back Squat: refused. The house's Back Squat has a swap that is archived, Box Squat, which the library will not save. Take the swap off or restore Box Squat in the house's library, then run the sheet again.",
                "Line 11, Dip: added.",
                "Lines: 10",
                "Added: 2",
                "Updated: 0",
                "Unchanged: 0",
                "Refused: 8",
                "Clips uploaded: 2, 128 bytes"),
            run.Said);
        Assert.AreEqual(2, await N9b5UploadsAsync(house.TenantId), "A refused line uploads nothing.");
        CollectionAssert.AreEqual(
            N9b6LoadedNames,
            (await N9b6LibraryAsync(house.TenantId)).Select(row => row.Split(" | ")[0]).ToArray());

        // The dry run refuses the same lines for the same reasons, and uploads nothing.
        var dry = await N9b6RunAsync(slug, sheet, HouseLibraryCommand.DryRunFlag);
        Assert.AreEqual(1, dry.Code, dry.Said);
        CollectionAssert.AreEqual(
            run.Said.Split(Environment.NewLine).Where(line => line.Contains(": refused. ", StringComparison.Ordinal)).ToArray(),
            dry.Said.Split(Environment.NewLine).Where(line => line.Contains(": refused. ", StringComparison.Ordinal)).ToArray());
        Assert.AreEqual(2, await N9b5UploadsAsync(house.TenantId));

        // A clip the scan refuses refuses its line, and nothing of it is linked to an exercise.
        N9b6Mp4(folder, "lunge.mp4", 5);
        N9b6Sheet(folder, "Lunge,Strength,Dumbbell,Squat,Quadriceps,,lunge.mp4");
        RequiredScannerSwitch.RejectScans = true;
        var scanned = await N9b6RunAsync(slug, sheet);
        RequiredScannerSwitch.RejectScans = false;
        Assert.AreEqual(1, scanned.Code, scanned.Said);
        StringAssert.Contains(
            scanned.Said,
            "Line 2, Lunge: refused. This file was rejected. Any accepted bytes have been deleted or scheduled for secure cleanup.");
        Assert.HasCount(5, await N9b6LibraryAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9b6TheLibraryLoadsIntoTheHouseAloneAndARunThatCannotStartWritesNothing()
    {
        using var coach = CreateClient();
        var coachSpace = await RegisterCoachAsync(coach, "n9b6-alone-coach@example.test", "Karim Saleh", "N9b6 Alone Coaching");
        var coachSlug = await N9a1SlugAsync(coach, coachSpace);
        var folder = N9b6Folder();
        N9b6Mp4(folder, "row.mp4", 1);
        var sheet = N9b6Sheet(folder, "Cable row,Strength,Cable,Horizontal pull,Back,,row.mp4");

        Assert.AreEqual(
            (2, "N9b6 Alone Coaching (" + coachSlug + ") is not the house, and no coaching space is. The library loads into the house alone."),
            await N9b6RunAsync(coachSlug, sheet));
        Assert.AreEqual((2, "No coaching space has that slug or id."), await N9b6RunAsync("no-such-space", sheet));

        using var house = await N9a1OpenHouseAsync("n9b6-alone", signUpsPerWeek: null, minimumAge: null);
        var houseSlug = await N9a1SlugAsync(house.Owner, house.TenantId);
        foreach (var named in new[] { coachSlug, coachSpace.ToString(), coachSlug.ToUpperInvariant() })
        {
            Assert.AreEqual(
                (2, $"N9b6 Alone Coaching ({coachSlug}) is not the house. The library loads into the house alone: {house.Name} ({houseSlug})."),
                await N9b6RunAsync(named, sheet, HouseLibraryCommand.DryRunFlag),
                named);
        }

        Assert.IsEmpty(await N9b6LibraryAsync(coachSpace));
        Assert.AreEqual(0, await N9b5UploadsAsync(coachSpace));

        // Every way a run cannot start: said, exit 2, nothing written.
        var foreign = Path.Combine(folder, "latin1.csv");
        File.WriteAllBytes(foreign, [.. Encoding.UTF8.GetBytes($"{N9b6Header}\nPress "), 0xE9, .. Encoding.UTF8.GetBytes(",Strength,Barbell,Vertical push,Shoulders,,row.mp4\n")]);
        var semicolons = Path.Combine(folder, "semicolons.csv");
        File.WriteAllText(semicolons, "name;type;equipment;movement;muscles;instructions;clip\n");
        foreach (var (words, said) in new (string[] Words, string Said)[]
                 {
                     ([], "Usage: house-library <the house's slug or id> <sheet.csv> [--dry-run]"),
                     ([houseSlug], "Usage: house-library <the house's slug or id> <sheet.csv> [--dry-run]"),
                     ([houseSlug, sheet, "extra"], "Usage: house-library <the house's slug or id> <sheet.csv> [--dry-run]"),
                     ([houseSlug, sheet, "--dry-run", "--dry-run"], "Usage: house-library <the house's slug or id> <sheet.csv> [--dry-run]"),
                     ([houseSlug, sheet, "--force"], "Usage: house-library <the house's slug or id> <sheet.csv> [--dry-run]"),
                     ([houseSlug, Path.Combine(folder, "missing.csv")], "No sheet at that path."),
                     ([houseSlug, foreign], "The sheet is not UTF-8. Save it as CSV UTF-8, then run this again."),
                     ([houseSlug, semicolons], "The sheet's cells are separated by semicolons. Save it as CSV with commas (CSV UTF-8)."),
                 })
        {
            Assert.AreEqual((2, said), await N9b6RunAsync(words), string.Join(" ", words));
        }

        Assert.IsTrue(HouseLibraryCommand.IsInvocation(["house-library", houseSlug]));
        Assert.IsFalse(HouseLibraryCommand.IsInvocation(["House-Library"]));
        Assert.IsFalse(HouseLibraryCommand.IsInvocation([]));

        // Without a scanner the run refuses before line one; the dry run still checks the sheet and says so.
        RequiredScannerSwitch.IsAvailable = false;
        var refused = await N9b6RunAsync(houseSlug, sheet);
        var dry = await N9b6RunAsync(houseSlug, sheet, HouseLibraryCommand.DryRunFlag);
        RequiredScannerSwitch.IsAvailable = true;
        Assert.AreEqual(
            (2, string.Join(
                Environment.NewLine,
                $"Loading exercises.csv into {house.Name} ({houseSlug}).",
                "Media uploads are not available on this deployment (storage or scanner), so nothing was loaded.")),
            refused);
        Assert.AreEqual(0, dry.Code, dry.Said);
        StringAssert.Contains(dry.Said, "Media uploads are not available on this deployment (storage or scanner): a run here would load nothing.");
        StringAssert.Contains(dry.Said, "Line 2, Cable row: would be added.");
        Assert.IsEmpty(await N9b6LibraryAsync(house.TenantId));
        Assert.AreEqual(0, await N9b5UploadsAsync(house.TenantId));

        // The house named by its id loads; the coach's space still holds nothing.
        var loaded = await N9b6RunAsync(house.TenantId.ToString(), sheet);
        Assert.AreEqual(0, loaded.Code, loaded.Said);
        Assert.HasCount(1, await N9b6LibraryAsync(house.TenantId));
        Assert.IsEmpty(await N9b6LibraryAsync(coachSpace));

        // A sheet's folder holds what lies under it, at a drive's or the file system's root too, and nothing beside it.
        var driveRoot = Path.GetPathRoot(Path.GetTempPath())!;
        Assert.IsTrue(HouseLibraryCommand.IsInsideFolder(driveRoot, Path.Combine(driveRoot, "push-up.mp4")));
        Assert.IsTrue(HouseLibraryCommand.IsInsideFolder(folder, Path.Combine(folder, "clips", "row.mp4")));
        Assert.IsFalse(HouseLibraryCommand.IsInsideFolder(folder, Path.GetFullPath(Path.Combine(folder, "..", "row.mp4"))));
        Assert.IsFalse(HouseLibraryCommand.IsInsideFolder(folder, folder + "-beside" + Path.DirectorySeparatorChar + "row.mp4"));
        Assert.IsFalse(HouseLibraryCommand.IsInsideFolder(folder, folder));

        // A house that is not active has its pool closed, and takes nothing.
        await Phase6ExecuteAsync("""UPDATE tenancy."Tenants" SET "IsActive" = false WHERE "Id" = @id""", ("id", house.TenantId));
        var closed = (2, $"{house.Name} ({houseSlug}) is the house but is not active, so its pool is closed. Nothing was loaded.");
        Assert.AreEqual(closed, await N9b6RunAsync(houseSlug, sheet));
        Assert.AreEqual(closed, await N9b6RunAsync(houseSlug, sheet, HouseLibraryCommand.DryRunFlag));
    }

    [TestMethod]
    public async Task N9b6AnExerciseHoldsTenDemosAtMostAndTheLoaderNeverDropsOne()
    {
        using var house = await N9a1OpenHouseAsync("n9b6-ten", signUpsPerWeek: null, minimumAge: null);
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);
        var folder = N9b6Folder();

        // Ten cuts under ten names: each a clip the exercise does not hold yet, put first.
        for (var cut = 1; cut <= 10; cut++)
        {
            N9b6Mp4(folder, $"row-{cut}.mp4", (byte)cut);
            var loaded = await N9b6RunAsync(slug, N9b6Sheet(folder, $"Cable row,Strength,Cable,Horizontal pull,Back,,row-{cut}.mp4"));
            Assert.AreEqual(0, loaded.Code, loaded.Said);
        }

        var ten = "Cable row | Strength | Cable | HorizontalPull | Back Primary | no instructions | in use | " +
                  string.Join(", ", Enumerable.Range(1, 10).Reverse().Select(cut => $"row-{cut}.mp4 Ready"));
        Assert.AreEqual(ten, (await N9b6LibraryAsync(house.TenantId)).Single());

        // An eleventh is refused before it is uploaded, in the dry run and the run alike, and no demo is dropped.
        N9b6Mp4(folder, "row-11.mp4", 11);
        var sheet = N9b6Sheet(folder, "Cable row,Strength,Cable,Horizontal pull,Back,,row-11.mp4");
        const string Refused = "Line 2, Cable row: refused. The house's Cable row has 10 demos already, the most an exercise holds. Take one away to add the library's clip.";
        var dry = await N9b6RunAsync(slug, sheet, HouseLibraryCommand.DryRunFlag);
        var run = await N9b6RunAsync(slug, sheet);
        foreach (var said in new[] { dry, run })
        {
            Assert.AreEqual(1, said.Code, said.Said);
            StringAssert.Contains(said.Said, Refused);
        }

        Assert.AreEqual(ten, (await N9b6LibraryAsync(house.TenantId)).Single());
        Assert.AreEqual(10, await N9b5UploadsAsync(house.TenantId));
    }

    [TestMethod]
    public async Task N9b6AFullAllowanceStopsTheRunAndTheDryRunSaysItWouldNotFit()
    {
        using var house = await N9a1OpenHouseAsync("n9b6-room", signUpsPerWeek: null, minimumAge: null);
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);
        var folder = N9b6Folder();
        N9b6Mp4(folder, "row.mp4", 1);
        N9b6Mp4(folder, "dip.mp4", 2);
        var sheet = N9b6Sheet(
            folder,
            "Cable row,Strength,Cable,Horizontal pull,Back,,row.mp4",
            "Dip,Strength,Bodyweight,Vertical push,Triceps,,dip.mp4");

        // One gigabyte for the house, more than which is already held by uploads under way.
        await N9a1SettingAsync(house.Admin, N9b5StorageSetting, "1");
        var reserved = RequiredTestClock.UtcNow.AddHours(-1);
        for (var index = 0; index < 3; index++)
        {
            await Phase6ExecuteAsync(
                """
                INSERT INTO media."IngestObjects"
                    ("Id", "TenantId", "StorageLocation", "StorageKey", "AccountedBytes", "Purpose", "Status",
                     "PurgeAfterUtc", "PurgeAttemptCount", "CreatedAtUtc", "UpdatedAtUtc")
                VALUES (@id, @tenant, 'local-v1', @key, 400000000, 'ExerciseMedia', 'Reserved', @purgeAfter, 0, @at, @at)
                """,
                ("id", Guid.CreateVersion7()),
                ("tenant", house.TenantId),
                ("key", $"{house.TenantId:N}/n9b6/held-{index}.bin"),
                ("purgeAfter", reserved.AddDays(30)),
                ("at", reserved));
        }

        var dry = await N9b6RunAsync(slug, sheet, HouseLibraryCommand.DryRunFlag);
        Assert.AreEqual(0, dry.Code, dry.Said);
        StringAssert.Contains(dry.Said, "The house stores 1.1 GB of its 1.0 GB allowance.");
        StringAssert.EndsWith(
            dry.Said,
            "Clips to upload: 2, 128 bytes" + Environment.NewLine +
            "That is more than the house's allowance: a run would stop at the first clip that does not fit.");

        var run = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(1, run.Code, run.Said);
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                $"Loading exercises.csv into {house.Name} ({slug}).",
                "The house stores 1.1 GB of its 1.0 GB allowance.",
                $"Line 2, Cable row: refused. The house's media storage is full ({MediaQuotaCodes.WorkspaceStorageExceeded}).",
                "Lines: 2",
                "Added: 0",
                "Updated: 0",
                "Unchanged: 0",
                "Refused: 1",
                "Not reached: 1",
                "Clips uploaded: 0, 0 bytes",
                "Stopped. The lines after it were not loaded; run the sheet again once the house's media storage has room."),
            run.Said);
        Assert.IsEmpty(await N9b6LibraryAsync(house.TenantId));
        Assert.AreEqual(0, await N9b5UploadsAsync(house.TenantId));

        // Room again: the same sheet loads whole.
        await N9a1SettingAsync(house.Admin, N9b5StorageSetting, "2");
        var loaded = await N9b6RunAsync(slug, sheet);
        Assert.AreEqual(0, loaded.Code, loaded.Said);
        Assert.HasCount(2, await N9b6LibraryAsync(house.TenantId));
    }

    private async Task<(int Code, string Said)> N9b6RunAsync(params string[] words)
    {
        var output = new StringWriter();
        var code = await HouseLibraryCommand.RunAsync(RequiredFactory.Services, [HouseLibraryCommand.Name, .. words], output);
        return (code, output.ToString().TrimEnd());
    }

    /// <summary>A folder for one test's library, inside the test's own temporary folder, which the clean-up deletes.</summary>
    private string N9b6Folder()
    {
        var folder = Path.Combine(Path.GetTempPath(), databaseName!, "library", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        return folder;
    }

    /// <summary>A clip the upload takes: an MP4's signature in 64 bytes, its last byte telling one cut from another.</summary>
    private static void N9b6Mp4(string folder, string name, byte cut)
    {
        var clip = new byte[64];
        "ftypisom"u8.CopyTo(clip.AsSpan(4));
        clip[63] = cut;
        N9b6Write(folder, name, clip);
    }

    private static void N9b6WebM(string folder, string name, byte cut) =>
        N9b6Write(folder, name, [0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3, 4, cut]);

    private static void N9b6Write(string folder, string name, byte[] bytes)
    {
        var path = Path.Combine(folder, name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, bytes);
    }

    /// <summary>Writes the folder's sheet, exercises.csv, its first line naming the columns.</summary>
    private static string N9b6Sheet(string folder, params string[] lines)
    {
        var path = Path.Combine(folder, "exercises.csv");
        File.WriteAllText(path, string.Join("\r\n", [N9b6Header, .. lines]) + "\r\n", new UTF8Encoding(false));
        return path;
    }

    /// <summary>
    /// A workspace's library, one line an exercise: name, type, equipment, movement, muscles, instructions, whether it
    /// is in use and its demos in order, each by its file name and status.
    /// </summary>
    private async Task<string[]> N9b6LibraryAsync(Guid tenantId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var exercises = await dbContext.Exercises.IgnoreQueryFilters().AsNoTracking()
            .Where(exercise => exercise.TenantId == tenantId)
            .Include(exercise => exercise.Muscles)
            .Include(exercise => exercise.Media)
            .ToListAsync();
        var assets = await N9b6AssetsAsync(tenantId);
        return
        [
            .. exercises.OrderBy(exercise => exercise.NormalizedName, StringComparer.Ordinal).Select(exercise => string.Join(
                " | ",
                exercise.Name,
                exercise.Classification,
                exercise.Equipment,
                exercise.MovementPattern,
                string.Join(", ", exercise.Muscles
                    .OrderBy(muscle => muscle.Role)
                    .ThenBy(muscle => muscle.Muscle)
                    .Select(muscle => $"{muscle.Muscle} {muscle.Role}")),
                exercise.Instructions?.Replace("\n", "/", StringComparison.Ordinal) ?? "no instructions",
                exercise.IsArchived ? "archived" : "in use",
                string.Join(", ", exercise.Media
                    .OrderBy(link => link.DisplayOrder)
                    .Select(link => assets.Single(asset => asset.Id == link.MediaAssetId))
                    .Select(asset => $"{asset.OriginalFileName} {asset.Status}")))),
        ];
    }

    /// <summary>A clip the house's staff upload from the coach's screens, under a file name and a title of their own.</summary>
    private static async Task<Guid> N9b6StaffClipAsync(HttpClient staff, string fileName, byte cut)
    {
        var clip = new byte[64];
        "ftypisom"u8.CopyTo(clip.AsSpan(4));
        clip[63] = cut;
        await RefreshCsrfAsync(staff);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Filmed in the house"), "title");
        var file = new ByteArrayContent(clip);
        file.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
        form.Add(file, "file", fileName);
        var response = await staff.PostAsync("/api/media/uploads", form);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<MediaAsset>(response)).Id;
    }

    private async Task<N9b6Asset[]> N9b6AssetsAsync(Guid tenantId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await dbContext.MediaAssets.IgnoreQueryFilters().AsNoTracking()
            .Where(asset => asset.TenantId == tenantId)
            .OrderBy(asset => asset.Id)
            .Select(asset => new N9b6Asset(asset.Id, asset.Title, asset.OriginalFileName, asset.Status.ToString(), asset.OwnerUserId))
            .ToArrayAsync();
    }

    private Task<long> N9b6IngestCountAsync(Guid tenantId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM media."IngestObjects" WHERE "TenantId" = @id""",
        tenantId);

    /// <summary>The files this test's media storage holds.</summary>
    private int N9b6StoredFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), databaseName!, "media");
        return Directory.Exists(root) ? Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).Count() : 0;
    }

    private sealed record N9b6Asset(Guid Id, string Title, string? OriginalFileName, string Status, Guid OwnerUserId);
}
