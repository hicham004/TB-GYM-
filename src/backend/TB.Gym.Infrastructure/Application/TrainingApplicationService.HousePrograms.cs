using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The house's programs for its trainees (TRN-034, notes plan N9c3; decisions 29 and 30): its staff offer published
/// programs, a self-directed trainee reads them and starts one under a Pro+ pass. Start makes the same snapshot as
/// Assign program, from today, every week shown, with no notice, since the trainee started it themselves (NOT-035).
/// </summary>
internal sealed partial class TrainingApplicationService
{
    private const string TraineeStartReason = "Started by the trainee from the house's programs.";

    private (Guid TenantId, long Minute, WorkspaceCalendar Calendar)? calendarCache;

    /// <summary>
    /// The request's workspace calendar (its zone, today and whether it is the house), read once a request: the house's
    /// gates and Today's date ask it many times. Keyed by the tenant and the clock's minute.
    /// </summary>
    private async Task<WorkspaceCalendar> CalendarAsync(CancellationToken cancellationToken)
    {
        var minute = clock.UtcNow.ToUnixTimeSeconds() / 60;
        if (calendarCache is { } cached && cached.TenantId == tenantContext.TenantId && cached.Minute == minute)
        {
            return cached.Calendar;
        }

        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantContext.TenantId, cancellationToken);
        calendarCache = (tenantContext.TenantId, minute, calendar);
        return calendar;
    }
    private const string TraineeMaxReason = "Training max recorded for the trainee, the newest when they started the program.";

    public async Task<IReadOnlyList<HouseProgramListingView>?> ListHouseProgramsAsync(CancellationToken cancellationToken)
    {
        if (!await HousePool.IsOpenHereAsync(dbContext, tenantContext.TenantId, cancellationToken))
        {
            return null;
        }

        var listings = await dbContext.HouseProgramListings.AsNoTracking().ToListAsync(cancellationToken);
        return await ListingViewsAsync(listings, cancellationToken);
    }

    public async Task<TrainingCommandResult> OfferHouseProgramAsync(
        Guid templateId,
        OfferHouseProgramRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await HousePool.IsOpenHereAsync(dbContext, tenantContext.TenantId, cancellationToken))
        {
            return NotFound();
        }

        var template = await dbContext.ProgramTemplates.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == templateId, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        var (terms, problems) = HouseProgramRules.Terms(
            request.Suits,
            request.RunName,
            request.RunPosition,
            request.LoadIncrement,
            request.LoadRoundingMode);
        if (terms is null)
        {
            return new TrainingCommandResult(
                TrainingCommandStatus.Invalid,
                Errors: problems.ToDictionary(item => item.Key, item => new[] { item.Value }, StringComparer.Ordinal));
        }

        if (template.IsArchived)
        {
            return Invalid("templateId", "This program is archived, so trainees can't start it.");
        }

        var versions = await LatestPublishedVersionsAsync([templateId], cancellationToken);
        if (!versions.TryGetValue(templateId, out var version))
        {
            return Invalid("templateId", "Publish this program before offering it to trainees.");
        }

        if (UnitOf(version).IsMixed)
        {
            return Invalid(
                "templateId",
                "This program's weights mix kg and lb. Use one unit before offering it to trainees.");
        }

        var listing = await dbContext.HouseProgramListings
            .SingleOrDefaultAsync(item => item.TemplateId == templateId, cancellationToken);
        if (listing is null)
        {
            if (request.Version is > 0)
            {
                return ConcurrencyConflict();
            }

            listing = HouseProgramListing.Offer(tenantContext.TenantId, templateId, terms);
            dbContext.HouseProgramListings.Add(listing);
        }
        else
        {
            // A change names the listing as it was read, so two staff editing at once cannot both win.
            if (request.Version is not { } version0 || version0 != listing.Version)
            {
                return ConcurrencyConflict();
            }

            dbContext.Entry(listing).Property(item => item.Version).OriginalValue = version0;
            listing.Change(terms);
        }

        if (terms.RunKey is not null &&
            await OfferedAtRunPlaceAsync(terms.RunKey, terms.RunPosition!.Value, templateId, cancellationToken) is { } other)
        {
            return RunPlaceTaken(other, terms);
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            return terms.RunKey is not null &&
                   await OfferedAtRunPlaceAsync(terms.RunKey, terms.RunPosition!.Value, templateId, cancellationToken) is { } racing
                ? RunPlaceTaken(racing, terms)
                : ConcurrencyConflict();
        }

        return new TrainingCommandResult(
            TrainingCommandStatus.Success,
            HouseListing: (await ListingViewsAsync([listing], cancellationToken))[0]);
    }

    public async Task<TrainingCommandResult> WithdrawHouseProgramAsync(
        Guid templateId,
        WithdrawHouseProgramRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!await HousePool.IsOpenHereAsync(dbContext, tenantContext.TenantId, cancellationToken))
        {
            return NotFound();
        }

        var listing = await dbContext.HouseProgramListings
            .SingleOrDefaultAsync(item => item.TemplateId == templateId, cancellationToken);
        if (listing is null)
        {
            return NotFound();
        }

        if (request.Version != listing.Version)
        {
            return ConcurrencyConflict();
        }

        dbContext.Entry(listing).Property(item => item.Version).OriginalValue = request.Version;
        listing.Withdraw();
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }

        return new TrainingCommandResult(
            TrainingCommandStatus.Success,
            HouseListing: (await ListingViewsAsync([listing], cancellationToken))[0]);
    }

    public async Task<HouseProgramsView?> GetHouseProgramsAsync(CancellationToken cancellationToken)
    {
        var trainee = await HouseTraineeHereAsync(cancellationToken);
        if (trainee is null)
        {
            return null;
        }

        var (client, today) = trainee.Value;
        var access = await GetTrainingAccessAsync(client.Id, cancellationToken);
        var pass = access.IsAllowed
            ? await HouseProgramPlans.GrantingPassAsync(dbContext, client.Id, today, cancellationToken)
            : null;
        var listings = await dbContext.HouseProgramListings.AsNoTracking()
            .Where(item => item.IsOffered)
            .ToListAsync(cancellationToken);
        var templateIds = listings.Select(item => item.TemplateId).Distinct().ToArray();
        var archived = await dbContext.ProgramTemplates.AsNoTracking()
            .Where(item => templateIds.Contains(item.Id) && item.IsArchived)
            .Select(item => item.Id)
            .ToListAsync(cancellationToken);
        var versions = await LatestPublishedVersionsAsync(templateIds, cancellationToken);
        var shown = listings
            .Where(item => !archived.Contains(item.TemplateId) && versions.ContainsKey(item.TemplateId))
            .ToArray();
        var facts = await TraineeFactsAsync(
            client.Id,
            today,
            shown.SelectMany(item => LiftsNeedingMax(versions[item.TemplateId])).Distinct().ToArray(),
            cancellationToken);

        var programs = shown
            .Select(listing =>
            {
                var version = versions[listing.TemplateId];
                var verdict = Evaluate(listing, version, null, access.IsAllowed, pass, facts, today);
                return new HouseProgramView(
                    listing.Id,
                    listing.TemplateId,
                    version.Id,
                    version.NameSnapshot,
                    version.DescriptionSnapshot,
                    listing.Suits,
                    listing.RunName,
                    listing.RunPosition,
                    version.Weeks.Count,
                    verdict.Unit,
                    SampleWeek(version),
                    verdict.Maxes,
                    verdict.Code is null,
                    verdict.Code,
                    verdict.OpensOn,
                    verdict.LastStartDay,
                    facts.Starts.Count(start => start.ListingId == listing.Id));
            })
            .OrderBy(item => item.RunName is null ? 1 : 0)
            .ThenBy(item => item.RunName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.RunPosition)
            .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.ListingId)
            .ToArray();
        var running = facts.Holding.Length > 0 ? facts.Holding[0] : null;
        return new HouseProgramsView(
            today,
            pass is null ? null : new HouseProgramPassView(pass.EnrollmentId, pass.Name, pass.StartDate, pass.EndDateExclusive),
            running is null ? null : new HouseProgramRunningView(running.Id, running.Name, running.StartDate, running.EndDateExclusive),
            programs);
    }

    public async Task<TrainingCommandResult> StartHouseProgramAsync(
        Guid listingId,
        StartHouseProgramRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var trainee = await HouseTraineeHereAsync(cancellationToken);
        if (trainee is null)
        {
            return NotFound();
        }

        if (request.IdempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "A non-empty idempotency key is required.");
        }

        var tenantId = tenantContext.TenantId;
        var clientId = trainee.Value.Client.Id;
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // One start at a time for a trainee: the run, the overlap and the key are all read under this lock.
            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""SELECT 1 FROM clients."ClientProfiles" WHERE "TenantId" = {tenantId} AND "Id" = {clientId} FOR UPDATE /* house-program-start */""",
                cancellationToken);
            try
            {
                var (result, started) = await StartUnderLockAsync(listingId, request, cancellationToken);
                if (started)
                {
                    await transaction.CommitAsync(cancellationToken);
                }

                return result;
            }
            catch (ArgumentException exception)
            {
                return Invalid("program", exception.PersonMessage());
            }
            catch (InvalidOperationException exception)
            {
                return Invalid("program", exception.PersonMessage());
            }
            catch (DbUpdateException exception) when (IsExclusionViolation(exception))
            {
                // Another start of theirs took the dates while this one was written (the lock makes it rare).
                return Conflict(
                    HouseProgramCodes.Overlap,
                    "Another program of yours holds these days. One program at a time: read your programs again.");
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                return Conflict("idempotency_conflict", "This idempotency key was already used for another start.");
            }
        });
    }

    /// <summary>Start's checks and writes, under the trainee's row lock; true once something was written.</summary>
    private async Task<(TrainingCommandResult Result, bool Started)> StartUnderLockAsync(
        Guid listingId,
        StartHouseProgramRequest request,
        CancellationToken cancellationToken)
    {
        // Read again under the lock: a leaving committed while this waited is what stands now.
        var trainee = await HouseTraineeHereAsync(cancellationToken);
        if (trainee is null)
        {
            return (NotFound(), false);
        }

        var (client, today) = trainee.Value;
        var listing = await dbContext.HouseProgramListings.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == listingId, cancellationToken);
        if (listing is null)
        {
            return (NotFound(), false);
        }

        var earlier = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.AssignmentCommandId == request.IdempotencyKey)
            .Select(item => new { item.Id, item.ClientProfileId, item.Name, item.StartDate, item.EndDateExclusive })
            .SingleOrDefaultAsync(cancellationToken);
        if (earlier is not null)
        {
            // The same trainee, list entry and version replay the first program; anything else reused the key.
            var start = await dbContext.HouseProgramStarts.AsNoTracking()
                .SingleOrDefaultAsync(item => item.MesocycleId == earlier.Id, cancellationToken);
            return start is not null && earlier.ClientProfileId == client.Id && start.ListingId == listingId &&
                   start.TemplateVersionId == request.TemplateVersionId
                ? (Started(earlier.Id, listingId, earlier.Name, earlier.StartDate, earlier.EndDateExclusive), false)
                : (Conflict("idempotency_conflict", "This idempotency key was already used for another start."), false);
        }

        var access = await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (!access.IsAllowed)
        {
            return (new TrainingCommandResult(TrainingCommandStatus.Forbidden), false);
        }

        // A block whose Pro+ pass was cancelled is shut for good, its sessions following its plan, yet would still hold
        // its days: starting anew closes it, kept as cancelled with its reason, once no workout of it is open (TRN-034).
        // Saved inside this transaction, so a refusal below leaves it as it was.
        if (await CloseStrandedProgramsAsync(client.Id, today, cancellationToken) is { } stranded)
        {
            return (stranded, false);
        }

        var archived = await dbContext.ProgramTemplates.AsNoTracking()
            .AnyAsync(item => item.Id == listing.TemplateId && item.IsArchived, cancellationToken);
        var latest = archived
            ? null
            : (await LatestPublishedVersionsAsync([listing.TemplateId], cancellationToken))
                .GetValueOrDefault(listing.TemplateId);
        var version = latest is null ? null : await LoadTemplateVersionAsync(latest.Id, cancellationToken);
        var pass = await HouseProgramPlans.GrantingPassAsync(dbContext, client.Id, today, cancellationToken);
        var facts = await TraineeFactsAsync(
            client.Id,
            today,
            version is null ? [] : LiftsNeedingMax(version).ToArray(),
            cancellationToken);
        var verdict = Evaluate(listing, version, request.TemplateVersionId, true, pass, facts, today);
        if (verdict.Code is not null)
        {
            return (Conflict(verdict.Code, verdict.Message!), false);
        }

        var assignment = new AssignMesocycleRequest(
            pass!.EnrollmentId,
            version!.Id,
            today,
            MesocycleKind.Primary,
            verdict.Unit,
            listing.LoadIncrement,
            listing.LoadRoundingMode,
            verdict.Picks
                .Select(item => new WorkingMaxSelectionRequest(
                    item.ExerciseId,
                    item.Pick.Source == HouseProgramMaxSource.Typed ? item.Pick.Id : null,
                    item.Pick.Value,
                    verdict.Unit,
                    CarriedFromMaxId: item.Pick.Source == HouseProgramMaxSource.LastProgram ? item.Pick.Id : null))
                .ToArray(),
            request.IdempotencyKey,
            Name: null,
            RevealAllWeeks: true);
        var endExclusive = HouseProgramRules.EndExclusive(today, version.Weeks.Count);
        var coverage = await EvaluateCoverageAsync(client.Id, pass.EnrollmentId, today, endExclusive, cancellationToken);
        if (!coverage.Exists || !coverage.Decision.IsAuthorized)
        {
            return (Conflict(
                HouseProgramCodes.DoesNotFit,
                coverage.Decision.Reason ?? "This program does not fit inside your pass."), false);
        }

        var (mesocycle, _) = await AddMesocycleSnapshotAsync(
            client.Id,
            assignment,
            version,
            null,
            new MesocycleSnapshotTerms(
                PublishEveryWeek: true,
                LifecycleReason: TraineeStartReason,
                WorkingMaxReason: TraineeMaxReason),
            cancellationToken);
        dbContext.HouseProgramStarts.Add(HouseProgramStart.Record(listing, mesocycle, version.Id));
        await dbContext.SaveChangesAsync(cancellationToken);
        return (Started(mesocycle.Id, listing.Id, mesocycle.Name, mesocycle.StartDate, mesocycle.EndDateExclusive), true);
    }

    /// <summary>
    /// Why a program cannot start today, in Start's order (TRN-034), with what the read says beside it. A null code
    /// starts it, from the picks.
    /// </summary>
    private static HouseProgramVerdict Evaluate(
        HouseProgramListing listing,
        ProgramTemplateVersion? version,
        Guid? askedVersionId,
        bool trainingOpen,
        HouseProgramPlans.Pass? pass,
        TraineeFacts facts,
        DateOnly today)
    {
        var unit = version is null ? new HouseProgramUnit(false, TrainingLoadUnit.Kilogram) : UnitOf(version);
        var weeks = version?.Weeks.Count ?? 0;
        var (maxes, picks, missing) = version is null || unit.IsMixed
            ? ([], [], [])
            : MaxesFor(version, unit.Unit, facts);
        // The last day to start inside the pass; none when the block is longer than the pass.
        DateOnly? lastStartDay = pass is null || version is null ||
                                 HouseProgramRules.LastStartDay(pass.EndDateExclusive, weeks) < pass.StartDate
            ? null
            : HouseProgramRules.LastStartDay(pass.EndDateExclusive, weeks);
        HouseProgramVerdict Refuse(string code, string message, DateOnly? opensOn = null) =>
            new(code, message, unit.Unit, maxes, picks, opensOn, lastStartDay);

        if (!trainingOpen)
        {
            return Refuse("training_closed", "Training is closed for you right now.");
        }

        if (!listing.IsOffered || version is null)
        {
            return Refuse(
                HouseProgramCodes.NotOffered,
                "TB Gym no longer offers this program. Pick another from the list.");
        }

        if (pass is null)
        {
            return Refuse(
                HouseProgramCodes.NeedsPass,
                "Starting a program needs Pro+. Free keeps running, with everything you logged.");
        }

        if (askedVersionId is { } asked && asked != version.Id)
        {
            return Refuse(
                HouseProgramCodes.Changed,
                "TB Gym changed this program since you read it. Read it again, then start it.");
        }

        if (unit.IsMixed)
        {
            return Refuse(
                HouseProgramCodes.MixedUnits,
                "This program mixes kg and lb, so it can't be started until TB Gym puts it in one unit.");
        }

        var before = listing.RunPosition is > 1
            ? facts.Offered.FirstOrDefault(item =>
                item.RunKey == listing.RunKey && item.RunPosition == listing.RunPosition - 1)
            : null;
        var opening = HouseProgramRules.Opening(
            listing.RunPosition,
            facts.Starts
                .Where(start => (before is not null && start.ListingId == before.Id) ||
                    (start.RunKey is not null && start.RunKey == listing.RunKey && start.RunPosition is not null))
                .Select(start => new HouseProgramRunBlock(
                    before is not null && start.ListingId == before.Id ? listing.RunPosition!.Value - 1 : start.RunPosition!.Value,
                    start.EndDateExclusive,
                    start.IsCancelled)),
            today);
        if (!opening.IsOpen)
        {
            var position = listing.RunPosition!.Value;
            return opening.BlockBeforeStarted
                ? Refuse(
                    HouseProgramCodes.BlockNotOpen,
                    $"Block {position} of {listing.RunName} opens on {HouseProgramRules.Day(opening.OpensOn!.Value)}, once block {position - 1} has ended.",
                    opening.OpensOn)
                : Refuse(
                    HouseProgramCodes.BlockNotOpen,
                    before is null
                        ? $"This is block {position} of {listing.RunName}, and block {position - 1} isn't offered now, so it can't start yet."
                        : $"This is block {position} of {listing.RunName}. Start block {position - 1} first.");
        }

        var endExclusive = HouseProgramRules.EndExclusive(today, weeks);
        var holding = facts.Holding
            .Where(item => item.StartDate < endExclusive && item.EndDateExclusive > today)
            .ToArray();
        if (holding.Length > 0)
        {
            var freeOn = holding.Max(item => item.EndDateExclusive);
            var open = holding.FirstOrDefault(item => item.HasOpenWorkoutUnderEndedPass);
            return Refuse(
                HouseProgramCodes.Overlap,
                open is not null
                    ? $"Finish the workout you started in \"{open.Name}\" first: its plan has ended, so it closes once that workout is done."
                    : $"\"{holding[0].Name}\" runs until {HouseProgramRules.Day(freeOn.AddDays(-1))}. One program at a time" +
                      (lastStartDay is { } last && freeOn <= last
                          ? $": this one can start from {HouseProgramRules.Day(freeOn)}."
                          : "."),
                open is not null ? null : freeOn);
        }

        if (!HouseProgramRules.Fits(today, weeks, pass.StartDate, pass.EndDateExclusive))
        {
            var passDays = pass.EndDateExclusive.DayNumber - pass.StartDate.DayNumber;
            return Refuse(
                HouseProgramCodes.DoesNotFit,
                weeks * 7 > passDays
                    ? $"This block runs {weeks} weeks, longer than your pass, so it can't start under it."
                    : $"This block runs {weeks} weeks and your pass ends on {HouseProgramRules.Day(pass.EndDateExclusive.AddDays(-1))}, so the last day to start it was {HouseProgramRules.Day(lastStartDay!.Value)}. Start it under your next pass.");
        }

        if (missing.Count > 0)
        {
            return Refuse(
                HouseProgramCodes.NeedsMaxes,
                $"Type your max for {HouseProgramRules.Names(missing)} first, in {UnitWord(unit.Unit)}: this program works its weights out from it.");
        }

        return new HouseProgramVerdict(null, null, unit.Unit, maxes, picks, null, lastStartDay);
    }

    private static (IReadOnlyList<HouseProgramMaxView> Maxes, IReadOnlyList<(Guid ExerciseId, HouseProgramMaxPick Pick)> Picks,
        IReadOnlyList<string> Missing) MaxesFor(ProgramTemplateVersion version, TrainingLoadUnit unit, TraineeFacts facts)
    {
        var views = new List<HouseProgramMaxView>();
        var picks = new List<(Guid, HouseProgramMaxPick)>();
        var missing = new List<string>();
        var strengthUnit = ToStrengthUnit(unit);
        foreach (var (exerciseId, name) in LiftsNeedingMaxWithNames(version))
        {
            var recorded = facts.Recorded
                .Where(item => item.ExerciseId == exerciseId && item.Unit == strengthUnit)
                .Select(item => new HouseProgramMaxCandidate(
                    item.Id,
                    item.Value,
                    item.EffectiveDate,
                    item.Kind == StrengthMaxKind.CoachWorkingMax,
                    item.CreatedAtUtc))
                .ToArray();
            HouseProgramMaxCandidate? carried = null;
            if (facts.Previous is { } previous && previous.LoadUnit == unit &&
                previous.Maxes.TryGetValue(exerciseId, out var snapshot))
            {
                carried = new HouseProgramMaxCandidate(
                    snapshot.Id,
                    snapshot.Value,
                    previous.LocalDate(snapshot.CreatedAtUtc),
                    true,
                    snapshot.CreatedAtUtc);
            }

            var pick = HouseProgramRules.PickMax(recorded, carried);
            views.Add(new HouseProgramMaxView(exerciseId, name, unit, pick?.Value, pick?.Source, pick?.On));
            if (pick is null)
            {
                missing.Add(name);
            }
            else
            {
                picks.Add((exerciseId, pick));
            }
        }

        return (views, picks, missing);
    }

    /// <summary>What a trainee's programs and maxes are, read once for the list or a Start.</summary>
    private async Task<TraineeFacts> TraineeFactsAsync(
        Guid clientProfileId,
        DateOnly today,
        IReadOnlyCollection<Guid> liftsNeedingMax,
        CancellationToken cancellationToken)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(await dbContext.Tenants.AsNoTracking()
            .Where(item => item.Id == tenantContext.TenantId)
            .Select(item => item.TimeZoneId)
            .SingleAsync(cancellationToken));
        var startRows = await (
            from start in dbContext.HouseProgramStarts.AsNoTracking()
            join block in dbContext.TrainingMesocycles.AsNoTracking()
                on new { start.TenantId, Id = start.MesocycleId } equals new { block.TenantId, block.Id }
            join pass in dbContext.ClientEnrollments.AsNoTracking()
                on new { start.TenantId, Id = start.EnrollmentId } equals new { pass.TenantId, pass.Id }
            where start.ClientProfileId == clientProfileId
            select new
            {
                start.ListingId,
                start.RunKey,
                start.RunPosition,
                block.EndDateExclusive,
                ProgramCancelled = block.Status == MesocycleStatus.Cancelled,
                PassCancelledAtUtc = pass.Status == EnrollmentStatus.Cancelled ? pass.CancelledAtUtc : null,
            })
            .ToListAsync(cancellationToken);
        // A block whose pass was cancelled has ended on that day, for the run, even once Start closed it (the row's
        // "or its pass has ended"); a block the staff cancelled while its pass ran does not count.
        var starts = startRows
            .Select(row => row.PassCancelledAtUtc is { } cancelledAt
                ? new TraineeStart(
                    row.ListingId,
                    row.RunKey,
                    row.RunPosition,
                    Earlier(row.EndDateExclusive, DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(cancelledAt, zone).DateTime)),
                    false)
                : new TraineeStart(row.ListingId, row.RunKey, row.RunPosition, row.EndDateExclusive, row.ProgramCancelled))
            .ToArray();
        var stranded = await StrandedProgramsAsync(clientProfileId, today, cancellationToken);
        // The programs that hold their dates (TRN-011, TRN-013): a cancelled one alone frees them, and Start closes a
        // block whose pass was cancelled unless a workout of it is still open.
        var holding = (await dbContext.TrainingMesocycles.AsNoTracking()
                .Where(item => item.ClientProfileId == clientProfileId && item.Kind == MesocycleKind.Primary &&
                    item.BlocksPrimaryOverlap && item.EndDateExclusive > today)
                .OrderBy(item => item.StartDate).ThenBy(item => item.Id)
                .Select(item => new { item.Id, item.Name, item.StartDate, item.EndDateExclusive })
                .ToListAsync(cancellationToken))
            .Where(item => !stranded.TryGetValue(item.Id, out var hasOpenWorkout) || hasOpenWorkout)
            .Select(item => new HoldingProgram(
                item.Id, item.Name, item.StartDate, item.EndDateExclusive, stranded.ContainsKey(item.Id)))
            .ToArray();
        var offered = await dbContext.HouseProgramListings.AsNoTracking()
            .Where(item => item.IsOffered)
            .Select(item => new OfferedEntry(item.Id, item.RunKey, item.RunPosition))
            .ToListAsync(cancellationToken);
        var lifts = liftsNeedingMax.ToArray();
        var recorded = lifts.Length == 0
            ? []
            : await dbContext.StrengthMaxRecords.AsNoTracking()
                .Where(item => item.ClientProfileId == clientProfileId && lifts.Contains(item.ExerciseId))
                .Select(item => new RecordedMax(
                    item.Id, item.ExerciseId, item.Kind, item.Value, item.Unit, item.EffectiveDate, item.CreatedAtUtc))
                .ToListAsync(cancellationToken);
        var previous = lifts.Length == 0 ? null : await LoadPreviousProgramAsync(clientProfileId, cancellationToken);
        return new TraineeFacts(starts, holding, recorded, previous, offered);
    }

    private static DateOnly Earlier(DateOnly first, DateOnly second) => first <= second ? first : second;

    /// <summary>
    /// A trainee's started blocks whose Pro+ pass was cancelled while they still hold days (not cancelled, not finished,
    /// not ended), each with whether a workout of it is still open.
    /// </summary>
    private async Task<Dictionary<Guid, bool>> StrandedProgramsAsync(
        Guid clientProfileId,
        DateOnly today,
        CancellationToken cancellationToken) =>
        await (
            from start in dbContext.HouseProgramStarts.AsNoTracking()
            join block in dbContext.TrainingMesocycles.AsNoTracking()
                on new { start.TenantId, Id = start.MesocycleId } equals new { block.TenantId, block.Id }
            join pass in dbContext.ClientEnrollments.AsNoTracking()
                on new { start.TenantId, Id = start.EnrollmentId } equals new { pass.TenantId, pass.Id }
            where start.ClientProfileId == clientProfileId && pass.Status == EnrollmentStatus.Cancelled &&
                  block.Status == MesocycleStatus.Planned && block.BlocksPrimaryOverlap && block.EndDateExclusive > today
            select new
            {
                block.Id,
                Open = dbContext.WorkoutExecutions.Any(execution =>
                    execution.MesocycleId == block.Id && execution.Status == WorkoutExecutionStatus.InProgress),
            })
            .ToDictionaryAsync(item => item.Id, item => item.Open, cancellationToken);

    /// <summary>
    /// Closes, under Start's lock, each started block whose Pro+ pass was cancelled, so its days are free for the next
    /// program; null when nothing stands in the way, or the refusal when a workout of such a block is still open.
    /// </summary>
    private async Task<TrainingCommandResult?> CloseStrandedProgramsAsync(
        Guid clientProfileId,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var stranded = await StrandedProgramsAsync(clientProfileId, today, cancellationToken);
        if (stranded.Count == 0)
        {
            return null;
        }

        foreach (var (mesocycleId, hasOpenWorkout) in stranded)
        {
            if (hasOpenWorkout)
            {
                // Evaluate names it: the trainee finishes that workout first (the finish route stays open).
                continue;
            }

            var block = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
            if (block is null)
            {
                continue;
            }

            var previous = block.Cancel(clock.UtcNow);
            dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                tenantContext.TenantId,
                block.Id,
                MesocycleLifecycleEventType.Cancelled,
                previous,
                MesocycleStatus.Cancelled,
                "Its Pro+ pass was cancelled; closed when the trainee started another program.",
                clock.UtcNow));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        dbContext.ChangeTracker.Clear();
        return null;
    }

    /// <summary>The house's current self-directed trainee signed in, with the house's day; null for anyone else.</summary>
    private async Task<(ClientProfile Client, DateOnly Today)?> HouseTraineeHereAsync(CancellationToken cancellationToken)
    {
        var calendar = await CalendarAsync(cancellationToken);
        if (!calendar.IsHouse)
        {
            return null;
        }

        var client = await FindSelfClientAsync(cancellationToken);
        return client is { IsSelfDirected: true } ? (client, calendar.Today) : null;
    }

    /// <summary>
    /// In the house, whether a program's sessions are shut today: the plan it sits under no longer grants Training,
    /// whatever else does, since Free grants it beside every plan (TRN-034). Never outside the house.
    /// </summary>
    private async Task<bool> HouseProgramPlanClosedAsync(Guid enrollmentId, CancellationToken cancellationToken)
    {
        var calendar = await CalendarAsync(cancellationToken);
        return calendar.IsHouse &&
               !(await HouseProgramPlans.GrantingAsync(dbContext, [enrollmentId], calendar.Today, cancellationToken))
                   .Contains(enrollmentId);
    }

    /// <summary>
    /// Of these programs, the house's that have begun and whose plan no longer grants Training today (none outside the
    /// house). A program still to begin waits for its plan's first day, as TRN-023 shows it early.
    /// </summary>
    private async Task<IReadOnlySet<Guid>> HouseProgramsClosedAsync(
        Guid[] mesocycleIds,
        CancellationToken cancellationToken)
    {
        if (mesocycleIds.Length == 0)
        {
            return new HashSet<Guid>();
        }

        var calendar = await CalendarAsync(cancellationToken);
        if (!calendar.IsHouse)
        {
            return new HashSet<Guid>();
        }

        var ids = mesocycleIds.Distinct().ToArray();
        var plans = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => ids.Contains(item.Id) && item.StartDate <= calendar.Today)
            .Select(item => new { item.Id, item.EnrollmentId })
            .ToListAsync(cancellationToken);
        var granting = await HouseProgramPlans.GrantingAsync(
            dbContext,
            plans.Select(item => item.EnrollmentId).ToArray(),
            calendar.Today,
            cancellationToken);
        return plans.Where(item => !granting.Contains(item.EnrollmentId)).Select(item => item.Id).ToHashSet();
    }

    private static TrainingCommandResult ProgramPlanClosed() =>
        Conflict(
            HouseProgramCodes.PlanClosed,
            "This program came with a plan that isn't running now, so its sessions are closed. What you logged stays yours.");

    private async Task<IReadOnlyList<HouseProgramListingView>> ListingViewsAsync(
        IReadOnlyCollection<HouseProgramListing> listings,
        CancellationToken cancellationToken)
    {
        var templateIds = listings.Select(item => item.TemplateId).Distinct().ToArray();
        var templates = await dbContext.ProgramTemplates.AsNoTracking()
            .Where(item => templateIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var versions = await LatestPublishedVersionsAsync(templateIds, cancellationToken);
        var listingIds = listings.Select(item => item.Id).ToArray();
        var started = await dbContext.HouseProgramStarts.AsNoTracking()
            .Where(item => listingIds.Contains(item.ListingId))
            .GroupBy(item => item.ListingId)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        return listings
            .Select(listing =>
            {
                versions.TryGetValue(listing.TemplateId, out var version);
                var unit = version is null ? null : UnitOf(version);
                return new HouseProgramListingView(
                    listing.Id,
                    listing.TemplateId,
                    templates.TryGetValue(listing.TemplateId, out var template) ? template.Name : string.Empty,
                    version?.Id,
                    version?.Weeks.Count,
                    unit is { IsMixed: false } ? unit.Unit : null,
                    unit?.IsMixed ?? false,
                    listing.Suits,
                    listing.RunName,
                    listing.RunPosition,
                    listing.LoadIncrement,
                    listing.LoadRoundingMode,
                    listing.IsOffered,
                    started.GetValueOrDefault(listing.Id),
                    listing.Version);
            })
            .OrderByDescending(item => item.IsOffered)
            .ThenBy(item => item.RunName is null ? 1 : 0)
            .ThenBy(item => item.RunName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.RunPosition)
            .ThenBy(item => item.TemplateName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.ListingId)
            .ToArray();
    }

    /// <summary>Each program's latest published version, its weeks down to its sets; programs never published are absent.</summary>
    private async Task<Dictionary<Guid, ProgramTemplateVersion>> LatestPublishedVersionsAsync(
        Guid[] templateIds,
        CancellationToken cancellationToken)
    {
        if (templateIds.Length == 0)
        {
            return [];
        }

        var ids = templateIds;
        var published = await dbContext.ProgramTemplateVersions.AsNoTracking()
            .Where(item => ids.Contains(item.TemplateId) && item.IsPublished)
            .Select(item => new { item.Id, item.TemplateId, item.VersionNumber })
            .ToListAsync(cancellationToken);
        var latestIds = published
            .GroupBy(item => item.TemplateId)
            .Select(group => group.OrderByDescending(item => item.VersionNumber).First().Id)
            .ToArray();
        if (latestIds.Length == 0)
        {
            return [];
        }

        var versions = await dbContext.ProgramTemplateVersions.AsNoTracking()
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Sets)
            .Where(item => latestIds.Contains(item.Id))
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        return versions.ToDictionary(item => item.TemplateId);
    }

    private async Task<(string Name, string RunName)?> OfferedAtRunPlaceAsync(
        string runKey,
        int runPosition,
        Guid templateId,
        CancellationToken cancellationToken) =>
        await (
            from other in dbContext.HouseProgramListings.AsNoTracking()
            join template in dbContext.ProgramTemplates.AsNoTracking()
                on new { other.TenantId, Id = other.TemplateId } equals new { template.TenantId, template.Id }
            where other.IsOffered && other.RunKey == runKey && other.RunPosition == runPosition &&
                  other.TemplateId != templateId
            select new { template.Name, other.RunName })
            .FirstOrDefaultAsync(cancellationToken) is { } other0
            ? (other0.Name, other0.RunName!)
            : null;

    private static TrainingCommandResult RunPlaceTaken((string Name, string RunName) other, HouseProgramTerms terms) =>
        Conflict(
            HouseProgramCodes.PositionTaken,
            $"\"{other.Name}\" is already block {terms.RunPosition} of {other.RunName}. Give this one another place, or withdraw that one first.");

    private static HouseProgramUnit UnitOf(ProgramTemplateVersion version) =>
        HouseProgramRules.UnitOf(version.Weeks
            .SelectMany(week => week.Sessions)
            .SelectMany(session => session.Exercises)
            .SelectMany(exercise => exercise.Sets)
            .Select(set => (set.LoadStrategy, set.LoadUnit)));

    private static IEnumerable<Guid> LiftsNeedingMax(ProgramTemplateVersion version) =>
        LiftsNeedingMaxWithNames(version).Select(item => item.ExerciseId);

    /// <summary>The lifts whose sets work their weight out from a max (STR-002), in the order the program first meets them.</summary>
    private static IEnumerable<(Guid ExerciseId, string Name)> LiftsNeedingMaxWithNames(ProgramTemplateVersion version) =>
        version.Weeks.OrderBy(week => week.WeekNumber)
            .SelectMany(week => week.Sessions.OrderBy(session => session.Position))
            .SelectMany(session => session.Exercises.OrderBy(exercise => exercise.Position))
            .Where(exercise => exercise.Sets.Any(set => HouseProgramRules.NeedsMax(set.LoadStrategy)))
            .GroupBy(exercise => exercise.ExerciseId)
            .Select(group => (group.Key, group.First().ExerciseNameSnapshot));

    /// <summary>Week 1 as a trainee reads it before starting: each session's lifts, how many sets and the reps asked.</summary>
    private static HouseProgramSampleSessionView[] SampleWeek(ProgramTemplateVersion version)
    {
        var first = version.Weeks.OrderBy(week => week.WeekNumber).FirstOrDefault();
        return first is null
            ? []
            : first.Sessions.OrderBy(session => session.Position)
                .Select(session => new HouseProgramSampleSessionView(
                    session.Name,
                    session.DayOffset,
                    session.Exercises.OrderBy(exercise => exercise.Position)
                        .Select(exercise =>
                        {
                            var working = exercise.Sets.Where(set => set.SetType != TrainingSetType.WarmUp).ToArray();
                            var counted = working.Length > 0 ? working : exercise.Sets.ToArray();
                            return new HouseProgramSampleExerciseView(
                                exercise.ExerciseId,
                                exercise.ExerciseNameSnapshot,
                                exercise.IsMainLift,
                                exercise.Sets.Count,
                                counted.Min(set => set.RepetitionsMinimum),
                                counted.Max(set => set.RepetitionsMaximum ?? set.RepetitionsMinimum));
                        })
                        .ToArray()))
                .ToArray();
    }

    private static string UnitWord(TrainingLoadUnit unit) => unit == TrainingLoadUnit.Pound ? "lb" : "kg";

    private static TrainingCommandResult Started(
        Guid programId,
        Guid listingId,
        string name,
        DateOnly startDate,
        DateOnly endDateExclusive) =>
        new(
            TrainingCommandStatus.Success,
            HouseProgramStarted: new HouseProgramStartedView(programId, listingId, name, startDate, endDateExclusive));

    private sealed record HouseProgramVerdict(
        string? Code,
        string? Message,
        TrainingLoadUnit Unit,
        IReadOnlyList<HouseProgramMaxView> Maxes,
        IReadOnlyList<(Guid ExerciseId, HouseProgramMaxPick Pick)> Picks,
        DateOnly? OpensOn,
        DateOnly? LastStartDay);

    private sealed record TraineeStart(
        Guid ListingId,
        string? RunKey,
        int? RunPosition,
        DateOnly EndDateExclusive,
        bool IsCancelled);

    private sealed record HoldingProgram(
        Guid Id,
        string Name,
        DateOnly StartDate,
        DateOnly EndDateExclusive,
        bool HasOpenWorkoutUnderEndedPass);

    private sealed record OfferedEntry(Guid Id, string? RunKey, int? RunPosition);

    private sealed record RecordedMax(
        Guid Id,
        Guid ExerciseId,
        StrengthMaxKind Kind,
        decimal Value,
        StrengthLoadUnit Unit,
        DateOnly EffectiveDate,
        DateTimeOffset CreatedAtUtc);

    private sealed record TraineeFacts(
        IReadOnlyList<TraineeStart> Starts,
        HoldingProgram[] Holding,
        IReadOnlyList<RecordedMax> Recorded,
        PreviousProgram? Previous,
        IReadOnlyList<OfferedEntry> Offered);
}
