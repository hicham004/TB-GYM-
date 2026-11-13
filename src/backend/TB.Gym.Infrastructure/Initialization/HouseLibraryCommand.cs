using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Loads a library of exercise clips into the house's exercise library, and into no other workspace (LIB-007, notes
/// plan N9b6; LIB-001: a bought library is kept under its licence). It is run by whoever operates the deployment,
/// against the deployment's own database and media storage, once the clips are bought and converted.
/// </summary>
/// <remarks>
/// <code>
/// dotnet TB.Gym.Api.dll house-library the-house-slug /library/exercises.csv --dry-run
/// dotnet TB.Gym.Api.dll house-library the-house-slug /library/exercises.csv
/// </code>
/// The first word names the house by its slug or id, so a run aimed at any other workspace is refused before anything
/// is read. The sheet's form is <see cref="ExerciseSheet"/>'s: a CSV in UTF-8 whose first line names the columns
/// name, type, equipment, movement, muscles, instructions and clip; each clip is an MP4 or WebM named from the sheet's
/// own folder (a GIF is converted to an MP4 loop before it is loaded; nothing here converts).
/// <para>
/// Each line goes through the services the coach's screens use, as the house's Coach (the one who joined first, else
/// the Owner, as a trainee's record names them, ADR 0041), so every rule of the library, the upload's checks, the scan
/// and the house's storage allowance apply. An exercise is matched by its name in the house: a new one is made with its
/// clip; one already there takes the sheet's type, equipment, movement, muscles and instructions (an empty
/// instructions cell leaves them as they are) and keeps its tags, swaps and other demos. A clip whose bytes one of its
/// demos already has is left as it is; else the clip this loader uploaded before under the same file name (its title
/// ends "(library clip)", which no screen gives an upload by itself) is replaced in its place and deleted as the library deletes
/// one; else the clip goes first, the demo the pool plays, and a demo the house's staff uploaded is never touched. An
/// archived exercise of that name, or one whose swap is archived, which the library would not save, is left as it is
/// and its line refused before anything is uploaded. Nothing is ever archived or deleted for being left out of the
/// sheet. So the same sheet run again changes nothing.
/// </para>
/// <para>
/// <c>--dry-run</c> reads everything, checks every line and every clip as far as it can without writing, and prints
/// what a run would do; it writes nothing and uploads nothing. A refused line is printed with its reason and the rest
/// are loaded; a full storage allowance or unavailable uploads stop the run where it stands. Exit codes: 0 every line
/// loaded or unchanged, 1 a line refused or the run stopped, 2 a usage, house, sheet or storage problem before line one.
/// A dry run still checks the lines where uploads are off, says so, and its exit code then counts the lines alone.
/// </para>
/// </remarks>
public static class HouseLibraryCommand
{
    public const string Name = "house-library";

    public const string DryRunFlag = "--dry-run";

    private const int MostDemos = 10;

    /// <summary>
    /// Whether <paramref name="path"/> (a full path) lies inside <paramref name="folder"/> (a full path), a drive's or the
    /// file system's root included.
    /// </summary>
    internal static bool IsInsideFolder(string folder, string path)
    {
        var root = Path.EndsInDirectorySeparator(folder) ? folder : folder + Path.DirectorySeparatorChar;
        return path.Length > root.Length && path.StartsWith(root, StringComparison.Ordinal);
    }

    /// <summary>
    /// The title the loader gives every clip it uploads, which marks it as the library's: an upload from the coach's
    /// screens is titled by the coach or by its file name, so the loader never replaces or deletes one of those.
    /// </summary>
    internal static string ClipTitle(string exerciseName) => $"{exerciseName} (library clip)";

    private const string Usage = $"Usage: {Name} <the house's slug or id> <sheet.csv> [{DryRunFlag}]";

    public static bool IsInvocation(IReadOnlyList<string> args) =>
        args.Count > 0 && string.Equals(args[0], Name, StringComparison.Ordinal);

    /// <returns>A process exit code: 0 done, 1 a line refused or the run stopped, 2 a problem before the first line.</returns>
    public static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyList<string> args,
        TextWriter output,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(output);

        var words = args.Skip(1).ToList();
        var dryRun = words.Count(word => word == DryRunFlag) switch
        {
            0 => false,
            1 => words.Remove(DryRunFlag),
            _ => (bool?)null,
        };
        if (dryRun is null || words.Count != 2 || words.Any(word => word.StartsWith('-')))
        {
            await output.WriteLineAsync(Usage);
            return 2;
        }

        var house = await FindHouseAsync(services, words[0].Trim(), output, cancellationToken);
        if (house is null)
        {
            return 2;
        }

        var sheet = await ReadSheetAsync(words[1], output);
        if (sheet is null)
        {
            return 2;
        }

        var run = new LibraryRun(services, house, sheet.Value.Folder, dryRun.Value, output, cancellationToken);
        return await run.RunAsync(sheet.Value.Reading, Path.GetFileName(sheet.Value.Path));
    }

    /// <summary>The house the operator named, active, with someone to load as; null (and why, said) otherwise.</summary>
    private static async Task<HouseTarget?> FindHouseAsync(
        IServiceProvider services,
        string slugOrId,
        TextWriter output,
        CancellationToken cancellationToken)
    {
        await using var scope = services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var slug = slugOrId.ToLowerInvariant();
        var target = Guid.TryParse(slugOrId, out var id)
            ? await dbContext.Tenants.AsNoTracking().SingleOrDefaultAsync(tenant => tenant.Id == id, cancellationToken)
            : await dbContext.Tenants.AsNoTracking().SingleOrDefaultAsync(tenant => tenant.Slug == slug, cancellationToken);
        if (target is null)
        {
            await output.WriteLineAsync("No coaching space has that slug or id.");
            return null;
        }

        if (!target.IsHouse)
        {
            var house = await dbContext.Tenants.AsNoTracking().SingleOrDefaultAsync(tenant => tenant.IsHouse, cancellationToken);
            await output.WriteLineAsync(house is null
                ? $"{target.Name} ({target.Slug}) is not the house, and no coaching space is. The library loads into the house alone."
                : $"{target.Name} ({target.Slug}) is not the house. The library loads into the house alone: {house.Name} ({house.Slug}).");
            return null;
        }

        if (!target.IsActive)
        {
            await output.WriteLineAsync(
                $"{target.Name} ({target.Slug}) is the house but is not active, so its pool is closed. Nothing was loaded.");
            return null;
        }

        // The house's Coach, as a trainee's record names them (ADR 0041): the active Coach who joined first, else the Owner.
        var loaderUserId = await dbContext.TenantMemberships
            .AsNoTracking()
            .Where(membership =>
                membership.TenantId == target.Id &&
                membership.Status == MembershipStatus.Active &&
                (membership.Role == TenantRole.Coach || membership.Role == TenantRole.Owner))
            .OrderBy(membership => membership.Role == TenantRole.Coach ? 0 : 1)
            .ThenBy(membership => membership.CreatedAtUtc)
            .ThenBy(membership => membership.Id)
            .Select(membership => (Guid?)membership.UserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (loaderUserId is null)
        {
            await output.WriteLineAsync(
                $"{target.Name} ({target.Slug}) has no active coach or owner to load the library as. Nothing was loaded.");
            return null;
        }

        return new HouseTarget(target.Id, target.Name, target.Slug, loaderUserId.Value);
    }

    private static async Task<(ExerciseSheetReading Reading, string Path, string Folder)?> ReadSheetAsync(
        string given,
        TextWriter output)
    {
        string path;
        try
        {
            path = Path.GetFullPath(given);
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            await output.WriteLineAsync("No sheet at that path.");
            return null;
        }

        if (!File.Exists(path))
        {
            await output.WriteLineAsync("No sheet at that path.");
            return null;
        }

        ExerciseSheetReading reading;
        try
        {
            // Strictly UTF-8: a sheet saved in another encoding is refused whole, never loaded as the wrong letters.
            using var reader = new StreamReader(
                path,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
                detectEncodingFromByteOrderMarks: false);
            reading = ExerciseSheet.Read(reader);
        }
        catch (DecoderFallbackException)
        {
            await output.WriteLineAsync("The sheet is not UTF-8. Save it as CSV UTF-8, then run this again.");
            return null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            await output.WriteLineAsync("The sheet could not be read. Check it is not open elsewhere, then run this again.");
            return null;
        }

        if (reading.Refusal is { } refusal)
        {
            await output.WriteLineAsync(refusal);
            return null;
        }

        return (reading, path, Path.GetDirectoryName(path)!);
    }

    private sealed record HouseTarget(Guid Id, string Name, string Slug, Guid LoaderUserId);

    /// <summary>A clip file as the sheet names it, checked and hashed, never read into memory whole.</summary>
    private sealed record ClipFile(string Path, string FileName, string ContentType, long Length, string Sha256);

    /// <summary>A linked demo of a house exercise, as far as the loader needs to know it.</summary>
    private sealed record LinkedDemo(
        Guid Id,
        MediaAssetStatus Status,
        MediaSource Source,
        MediaKind Kind,
        string Title,
        string? OriginalFileName,
        string? Sha256,
        uint Version);

    private enum ClipStep
    {
        None = 0,
        Replace = 1,
        AddFirst = 2,
    }

    /// <summary>What a line comes to: a new exercise, a change to one, nothing, or a refusal.</summary>
    private sealed record LinePlan(
        ExerciseView? Existing,
        IReadOnlyList<string> Changes,
        ClipStep Clip,
        LinkedDemo? Replaced,
        IReadOnlyList<Guid> ReadyDemos,
        string? Refusal)
    {
        public bool IsUnchanged => Existing is not null && Changes.Count == 0 && Clip == ClipStep.None;
    }

    /// <summary>Why a run stops before its last line (the storage or the uploads, not the line), and what to wait for.</summary>
    private sealed class RunStoppedException(string reason, string waitFor) : Exception(reason)
    {
        public string WaitFor { get; } = waitFor;
    }

    private sealed class LibraryRun(
        IServiceProvider services,
        HouseTarget house,
        string folder,
        bool dryRun,
        TextWriter output,
        CancellationToken cancellationToken)
    {
        private readonly DemoRequests requests = new(services);
        private readonly DemoActor loader = new(house.LoaderUserId, house.Id);
        private int added;
        private int updated;
        private int unchanged;
        private int refused;
        private int uploads;
        private long uploadBytes;

        public async Task<int> RunAsync(ExerciseSheetReading reading, string sheetName)
        {
            await output.WriteLineAsync(dryRun
                ? $"Dry run: checking {sheetName} against {house.Name} ({house.Slug}). Nothing is written."
                : $"Loading {sheetName} into {house.Name} ({house.Slug}).");

            var (available, room) = await StorageAsync();
            if (available is { } unavailable)
            {
                await output.WriteLineAsync(unavailable);
                if (!dryRun)
                {
                    return 2;
                }
            }

            await output.WriteLineAsync(
                $"The house stores {Size(room.Used)} of its {Size(room.Allowance)} allowance.");

            var stoppedAt = (int?)null;
            var waitFor = string.Empty;
            for (var index = 0; index < reading.Entries.Count; index++)
            {
                var entry = reading.Entries[index];
                try
                {
                    await LineAsync(entry);
                }
                catch (RunStoppedException stopped)
                {
                    refused++;
                    await output.WriteLineAsync($"{Label(entry)}: refused. {stopped.Message}");
                    stoppedAt = index;
                    waitFor = stopped.WaitFor;
                    break;
                }
            }

            await output.WriteLineAsync($"Lines: {Count(reading.Entries.Count)}");
            await output.WriteLineAsync($"{(dryRun ? "Would be added" : "Added")}: {Count(added)}");
            await output.WriteLineAsync($"{(dryRun ? "Would be updated" : "Updated")}: {Count(updated)}");
            await output.WriteLineAsync($"Unchanged: {Count(unchanged)}");
            await output.WriteLineAsync($"Refused: {Count(refused)}");
            if (stoppedAt is { } stopLine)
            {
                await output.WriteLineAsync($"Not reached: {Count(reading.Entries.Count - stopLine - 1)}");
            }

            await output.WriteLineAsync(
                $"{(dryRun ? "Clips to upload" : "Clips uploaded")}: {Count(uploads)}, {Size(uploadBytes)}");
            if (dryRun && room.Used + uploadBytes > room.Allowance)
            {
                await output.WriteLineAsync(
                    "That is more than the house's allowance: a run would stop at the first clip that does not fit.");
            }

            if (stoppedAt is not null)
            {
                await output.WriteLineAsync(
                    $"Stopped. The lines after it were not loaded; run the sheet again once {waitFor}.");
            }

            return refused == 0 ? 0 : 1;
        }

        private async Task LineAsync(ExerciseSheetEntry entry)
        {
            if (entry.Exercise is not { } line)
            {
                await RefuseAsync(entry, entry.Refusal ?? "It cannot be read.");
                return;
            }

            if (Clip(line.Clip, out var clipRefusal) is not { } clip)
            {
                await RefuseAsync(entry, clipRefusal!);
                return;
            }

            var plan = await PlanAsync(line, clip);
            if (plan.Refusal is { } refusal)
            {
                await RefuseAsync(entry, refusal);
                return;
            }

            if (plan.IsUnchanged)
            {
                unchanged++;
                await output.WriteLineAsync($"{Label(entry)}: unchanged.");
                return;
            }

            if (dryRun)
            {
                if (plan.Existing is null || plan.Clip != ClipStep.None)
                {
                    uploads++;
                    uploadBytes += clip.Length;
                }

                if (plan.Existing is null)
                {
                    added++;
                    await output.WriteLineAsync($"{Label(entry)}: would be added.");
                }
                else
                {
                    updated++;
                    await output.WriteLineAsync($"{Label(entry)}: would be updated ({string.Join(", ", plan.Changes)}).");
                }

                return;
            }

            if (plan.Existing is null)
            {
                await AddAsync(entry, line, clip);
            }
            else
            {
                await UpdateAsync(entry, line, clip, plan);
            }
        }

        private async Task AddAsync(ExerciseSheetEntry entry, ExerciseSheetLine line, ClipFile clip)
        {
            var asset = await UploadAsync(entry, line.Name, clip);
            if (asset is null)
            {
                return;
            }

            var result = await requests.AsAsync<IExerciseLibraryApplicationService, ExerciseCommandResult>(
                loader,
                library => library.CreateAsync(
                    new CreateExerciseRequest(
                        line.Name,
                        line.Instructions,
                        line.Equipment,
                        line.Movement,
                        line.Type,
                        [.. line.Muscles.Select(muscle => new ExerciseMuscleRequest(muscle.Muscle, muscle.Role))],
                        [],
                        [],
                        [asset.Id]),
                    cancellationToken));
            if (result.Status != ExerciseCommandStatus.Success)
            {
                await DeleteClipAsync(asset.Id, asset.Version);
                await RefuseAsync(entry, Reason(result));
                return;
            }

            added++;
            await output.WriteLineAsync($"{Label(entry)}: added.");
        }

        private async Task UpdateAsync(ExerciseSheetEntry entry, ExerciseSheetLine line, ClipFile clip, LinePlan plan)
        {
            var existing = plan.Existing!;
            MediaAssetView? asset = null;
            if (plan.Clip != ClipStep.None)
            {
                asset = await UploadAsync(entry, existing.Name, clip);
                if (asset is null)
                {
                    return;
                }
            }

            IReadOnlyList<Guid> demos = plan.Clip switch
            {
                ClipStep.Replace => [.. plan.ReadyDemos.Select(id => id == plan.Replaced!.Id ? asset!.Id : id)],
                ClipStep.AddFirst => [asset!.Id, .. plan.ReadyDemos],
                _ => plan.ReadyDemos,
            };
            var result = await requests.AsAsync<IExerciseLibraryApplicationService, ExerciseCommandResult>(
                loader,
                library => library.UpdateAsync(
                    existing.Id,
                    new UpdateExerciseRequest(
                        existing.Name,
                        line.Instructions ?? existing.Instructions,
                        line.Equipment,
                        line.Movement,
                        line.Type,
                        [.. line.Muscles.Select(muscle => new ExerciseMuscleRequest(muscle.Muscle, muscle.Role))],
                        existing.Tags,
                        [.. existing.Alternatives.Select(swap => new ExerciseAlternativeRequest(swap.ExerciseId, swap.Note))],
                        demos,
                        existing.Version,
                        line.Type == existing.Classification ? existing.TypeName : null),
                    cancellationToken));
            if (result.Status != ExerciseCommandStatus.Success)
            {
                if (asset is not null)
                {
                    await DeleteClipAsync(asset.Id, asset.Version);
                }

                await RefuseAsync(entry, Reason(result));
                return;
            }

            updated++;
            var said = $"{Label(entry)}: updated ({string.Join(", ", plan.Changes)}).";
            if (plan.Replaced is { } old && !await RetireClipAsync(old))
            {
                said += " Its old clip stays in the house's media: another exercise shows it.";
            }

            await output.WriteLineAsync(said);
        }

        /// <summary>
        /// What the line would do to the house: read in one scope as the house's Coach, the exercise of that name with
        /// its demos, then checked against every rule the library applies, so a refused line costs no upload.
        /// </summary>
        private Task<LinePlan> PlanAsync(ExerciseSheetLine line, ClipFile clip) =>
            requests.AsAsync<IServiceProvider, LinePlan>(loader, async provider =>
            {
                var dbContext = provider.GetRequiredService<GymDbContext>();
                var key = ExerciseSheet.NameKey(line.Name);
                var id = await dbContext.Exercises.AsNoTracking()
                    .Where(exercise => exercise.NormalizedName == key)
                    .Select(exercise => (Guid?)exercise.Id)
                    .SingleOrDefaultAsync(cancellationToken);
                var existing = id is { } exerciseId
                    ? await provider.GetRequiredService<IExerciseLibraryApplicationService>().GetAsync(exerciseId, cancellationToken)
                    : null;
                if (existing is { IsArchived: true })
                {
                    return Refusal(
                        $"The house's {existing.Name} is archived. Restore it in the house's library first, or take its line out of the sheet.");
                }

                if (Definition(line, existing) is { } invalid)
                {
                    return Refusal(invalid);
                }

                if (existing is null)
                {
                    return new LinePlan(null, [], ClipStep.AddFirst, null, [], null);
                }

                var linked = existing.MediaAssetIds.ToList();
                var known = await dbContext.MediaAssets.AsNoTracking()
                    .Where(asset => linked.Contains(asset.Id))
                    .Select(asset => new LinkedDemo(
                        asset.Id,
                        asset.Status,
                        asset.Source,
                        asset.Kind,
                        asset.Title,
                        asset.OriginalFileName,
                        asset.Sha256,
                        asset.Version))
                    .ToDictionaryAsync(asset => asset.Id, cancellationToken);

                // A demo deleted from the library shows nowhere and cannot be saved again, so only ready ones stay.
                var ready = linked
                    .Where(demo => known.TryGetValue(demo, out var asset) && asset.Status == MediaAssetStatus.Ready)
                    .Select(demo => known[demo])
                    .ToList();
                var changes = Changes(line, existing);
                var clipStep = ClipStep.None;
                LinkedDemo? replaced = null;
                if (!ready.Any(demo => demo.Source == MediaSource.Upload && demo.Sha256 == clip.Sha256))
                {
                    replaced = ready.FirstOrDefault(demo =>
                        demo.Source == MediaSource.Upload &&
                        demo.Kind == MediaKind.Video &&
                        string.Equals(demo.Title, ClipTitle(existing.Name), StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(demo.OriginalFileName, clip.FileName, StringComparison.OrdinalIgnoreCase));
                    if (replaced is not null)
                    {
                        clipStep = ClipStep.Replace;
                        changes.Add("clip replaced");
                    }
                    else if (ready.Count >= MostDemos)
                    {
                        return Refusal(
                            $"The house's {existing.Name} has {MostDemos} demos already, the most an exercise holds. Take one away to add the library's clip.");
                    }
                    else
                    {
                        clipStep = ClipStep.AddFirst;
                        changes.Add("clip added first");
                    }
                }

                var archivedSwaps = existing.Alternatives.Where(swap => swap.IsArchived).Select(swap => swap.ExerciseName).ToList();
                if (changes.Count > 0 && archivedSwaps.Count > 0)
                {
                    return Refusal(archivedSwaps.Count == 1
                        ? $"The house's {existing.Name} has a swap that is archived, {archivedSwaps[0]}, which the library will not save. Take the swap off or restore {archivedSwaps[0]} in the house's library, then run the sheet again."
                        : $"The house's {existing.Name} has swaps that are archived, {string.Join(", ", archivedSwaps)}, which the library will not save. Take them off or restore them in the house's library, then run the sheet again.");
                }

                return new LinePlan(existing, changes, clipStep, replaced, [.. ready.Select(demo => demo.Id)], null);
            });

        private static LinePlan Refusal(string reason) => new(null, [], ClipStep.None, null, [], reason);

        /// <summary>
        /// The library's own checks of the exercise the line would leave, run in memory (the name's length, the
        /// instructions', a main muscle), so a line the library refuses never uploads its clip.
        /// </summary>
        private string? Definition(ExerciseSheetLine line, ExerciseView? existing)
        {
            try
            {
                Exercise.Create(
                    house.Id,
                    new ExerciseDefinition(
                        existing?.Name ?? line.Name,
                        line.Instructions ?? existing?.Instructions,
                        line.Equipment,
                        line.Movement,
                        line.Type,
                        line.Muscles,
                        [],
                        [],
                        []));
                return null;
            }
            catch (ArgumentException exception)
            {
                return exception.PersonMessage();
            }
        }

        private static List<string> Changes(ExerciseSheetLine line, ExerciseView existing)
        {
            var changes = new List<string>();
            if (line.Type != existing.Classification)
            {
                changes.Add("type");
            }

            if (line.Equipment != existing.Equipment)
            {
                changes.Add("equipment");
            }

            if (line.Movement != existing.MovementPattern)
            {
                changes.Add("movement");
            }

            var muscles = line.Muscles.Select(muscle => (muscle.Muscle, muscle.Role)).ToHashSet();
            if (!muscles.SetEquals(existing.Muscles.Select(muscle => (muscle.Muscle, muscle.Role))))
            {
                changes.Add("muscles");
            }

            if (line.Instructions is { } instructions &&
                !string.Equals(Lines(instructions), Lines(existing.Instructions ?? string.Empty), StringComparison.Ordinal))
            {
                changes.Add("instructions");
            }

            return changes;
        }

        private static string Lines(string text) => text.Replace("\r\n", "\n", StringComparison.Ordinal).Trim();

        /// <summary>
        /// The clip a line names: a file inside the sheet's folder, an MP4 or WebM the upload would take (the same
        /// check, on its first bytes), with its SHA-256, which says whether it changed.
        /// </summary>
        private ClipFile? Clip(string named, out string? refusal)
        {
            refusal = null;
            var parts = named.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
            if (Path.IsPathRooted(named) || named.Contains(':', StringComparison.Ordinal) || parts.Length == 0)
            {
                refusal = $"The clip {named} must be named from the sheet's own folder.";
                return null;
            }

            var path = Path.GetFullPath(Path.Combine([folder, .. parts]));
            if (!IsInsideFolder(folder, path))
            {
                refusal = $"The clip {named} is outside the sheet's folder.";
                return null;
            }

            var fileName = Path.GetFileName(path);
            var contentType = Path.GetExtension(fileName).ToLowerInvariant() switch
            {
                ".mp4" => "video/mp4",
                ".webm" => "video/webm",
                _ => null,
            };
            if (contentType is null)
            {
                refusal = $"The clip {named} is not an MP4 or WebM file. A GIF is converted to an MP4 loop before it is loaded.";
                return null;
            }

            if (!File.Exists(path))
            {
                refusal = $"No clip named {named} in the sheet's folder.";
                return null;
            }

            try
            {
                using var stream = File.OpenRead(path);
                var signature = new byte[16];
                var read = stream.ReadAtLeast(signature, signature.Length, throwOnEndOfStream: false);
                MediaUploadPolicy.Validate(fileName, contentType, stream.Length, signature.AsSpan(0, read));
                stream.Position = 0;
                var sha256 = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
                return new ClipFile(path, fileName, contentType, stream.Length, sha256);
            }
            catch (ArgumentException exception)
            {
                refusal = $"The clip {named}: {exception.PersonMessage()}";
                return null;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                refusal = $"The clip {named} could not be read.";
                return null;
            }
        }

        /// <summary>
        /// Uploads a clip as the coach's screens do. A refusal of the file refuses the line; a full allowance or
        /// unavailable storage stops the run, since every later clip would meet it too.
        /// </summary>
        private async Task<MediaAssetView?> UploadAsync(ExerciseSheetEntry entry, string title, ClipFile clip)
        {
            var result = await requests.AsAsync<IMediaApplicationService, MediaCommandResult>(loader, async media =>
            {
                await using var stream = File.OpenRead(clip.Path);
                return await media.UploadAsync(ClipTitle(title), clip.FileName, clip.ContentType, stream, cancellationToken);
            });
            switch (result.Status)
            {
                case MediaCommandStatus.Success when result.Asset is { } asset:
                    uploads++;
                    uploadBytes += clip.Length;
                    return asset;
                case MediaCommandStatus.QuotaExceeded:
                    throw new RunStoppedException(
                        $"The house's media storage is full ({result.Code ?? MediaQuotaCodes.WorkspaceStorageExceeded}).",
                        "the house's media storage has room");
                case MediaCommandStatus.Unavailable:
                    throw new RunStoppedException(
                        result.Message ?? "Media storage is unavailable.",
                        "uploads work again (storage and scanner)");
                case MediaCommandStatus.NotFound:
                    throw new RunStoppedException(
                        "The upload found nobody to load the library as.",
                        "the house has an active coach or owner");
                case MediaCommandStatus.RateLimited:
                    throw new RunStoppedException(
                        "Another upload to the house was running in this process.",
                        "that upload has finished");
                default:
                    await RefuseAsync(
                        entry,
                        result.Errors?.Values.SelectMany(errors => errors).FirstOrDefault() ??
                        result.Message ??
                        "The upload refused the clip.");
                    return null;
            }
        }

        /// <summary>Deletes, as the library does, a clip the loader uploaded for a line the library then refused.</summary>
        private async Task DeleteClipAsync(Guid assetId, uint version) =>
            await requests.AsAsync<IMediaApplicationService, MediaCommandResult>(
                loader,
                media => media.DeleteAsync(assetId, new DeleteMediaRequest(version), cancellationToken));

        /// <summary>
        /// Deletes a replaced clip as the library deletes one (MED-007: a program that holds it keeps it), unless another
        /// exercise still shows it. True once it is gone from the house's demos.
        /// </summary>
        private async Task<bool> RetireClipAsync(LinkedDemo old)
        {
            var shownElsewhere = await requests.AsAsync<GymDbContext, bool>(
                loader,
                dbContext => dbContext.ExerciseMediaLinks.AsNoTracking()
                    .AnyAsync(link => link.MediaAssetId == old.Id, cancellationToken));
            if (shownElsewhere)
            {
                return false;
            }

            var deleted = await requests.AsAsync<IMediaApplicationService, MediaCommandResult>(
                loader,
                media => media.DeleteAsync(old.Id, new DeleteMediaRequest(old.Version), cancellationToken));
            return deleted.Status == MediaCommandStatus.Success;
        }

        private async Task RefuseAsync(ExerciseSheetEntry entry, string reason)
        {
            refused++;
            await output.WriteLineAsync($"{Label(entry)}: refused. {reason}");
        }

        /// <summary>Whether the house can take uploads at all, and its storage as its allowance counts it.</summary>
        private async Task<(string? Unavailable, (long Used, long Allowance) Room)> StorageAsync()
        {
            var unavailable = await requests.AsAsync<IServiceProvider, string?>(DemoActor.Anonymous, provider =>
                Task.FromResult(
                    provider.GetRequiredService<IObjectStorage>().IsAvailable &&
                    provider.GetRequiredService<IMediaScanner>().IsAvailable
                        ? null
                        : dryRun
                            ? "Media uploads are not available on this deployment (storage or scanner): a run here would load nothing."
                            : "Media uploads are not available on this deployment (storage or scanner), so nothing was loaded."));
            var room = await requests.AsAsync<IServiceProvider, (long, long)>(loader, async provider =>
            {
                var dbContext = provider.GetRequiredService<GymDbContext>();
                var allowance = await HouseReader.MediaStorageBytesAsync(dbContext, house.Id, cancellationToken) ??
                                provider.GetRequiredService<IOptions<MediaStorageOptions>>().Value.MaxWorkspaceStorageBytes;
                return (await MediaApplicationService.StoredBytesAsync(dbContext, cancellationToken), allowance);
            });
            return (unavailable, room);
        }

        private static string Reason(ExerciseCommandResult result) =>
            result.Errors?.Values.SelectMany(errors => errors).FirstOrDefault() ??
            result.Message ??
            "The library refused the exercise.";

        private static string Label(ExerciseSheetEntry entry) =>
            entry.Name is { } name
                ? $"Line {Count(entry.Line)}, {name}"
                : $"Line {Count(entry.Line)}";
    }

    private static string Count(int value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>A size in binary units, as the house's storage setting counts gigabytes (MED-019).</summary>
    private static string Size(long bytes) => bytes switch
    {
        < 1024 => $"{bytes.ToString(CultureInfo.InvariantCulture)} bytes",
        < 1024 * 1024 => $"{(bytes / 1024d).ToString("0.0", CultureInfo.InvariantCulture)} KB",
        < 1024L * 1024 * 1024 => $"{(bytes / (1024d * 1024)).ToString("0.0", CultureInfo.InvariantCulture)} MB",
        _ => $"{(bytes / (1024d * 1024 * 1024)).ToString("0.0", CultureInfo.InvariantCulture)} GB",
    };
}
