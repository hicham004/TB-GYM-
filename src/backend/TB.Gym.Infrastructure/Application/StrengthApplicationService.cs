using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Strength;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class StrengthApplicationService(
    GymDbContext dbContext,
    ITenantContext tenantContext,
    IClock clock)
    : IStrengthApplicationService
{
    private const string ManualMethodVersion = "1.0";
    private const string ProgramMaxMethodKey = "ProgramMax";

    public async Task<StrengthMaxPage?> ListAsync(
        Guid clientProfileId,
        Guid? exerciseId,
        bool includeProgramMaxes,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking()
                .AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return null;
        }

        var query = dbContext.StrengthMaxRecords.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId);
        if (exerciseId is { } id)
        {
            query = query.Where(item => item.ExerciseId == id);
        }

        var joined = query
            .Join(
                dbContext.Exercises.AsNoTracking(),
                record => new { record.TenantId, Id = record.ExerciseId },
                exercise => new { exercise.TenantId, exercise.Id },
                (record, exercise) => new { Record = record, exercise.Name });
        if (includeProgramMaxes)
        {
            // STR-015: one history per lift, each fact stored once. One client's recorded and program maxes
            // are few, so they are merged and paged here rather than copied into one table.
            var recorded = await joined.ToListAsync(cancellationToken);
            var merged = recorded
                .Select(item => ToView(item.Record, item.Name))
                .Concat(await ListProgramMaxesAsync(clientProfileId, exerciseId, cancellationToken))
                .OrderByDescending(item => item.EffectiveDate)
                .ThenByDescending(item => item.CreatedAtUtc)
                .ThenByDescending(item => item.Id)
                .ToArray();
            return new StrengthMaxPage(merged.Length, skip, take, merged.Skip(skip).Take(take).ToArray());
        }

        var total = await joined.CountAsync(cancellationToken);
        var rows = await joined
            .OrderByDescending(item => item.Record.EffectiveDate)
            .ThenByDescending(item => item.Record.CreatedAtUtc)
            .ThenByDescending(item => item.Record.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

        return new StrengthMaxPage(
            total,
            skip,
            take,
            rows.Select(item => ToView(item.Record, item.Name)).ToArray());
    }

    public async Task<StrengthCommandResult> RecordAsync(
        Guid clientProfileId,
        RecordStrengthMaxRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            if (!await dbContext.ClientProfiles.AsNoTracking()
                    .AnyAsync(item => item.Id == clientProfileId, cancellationToken) ||
                !await dbContext.Exercises.AsNoTracking()
                    .AnyAsync(item => item.Id == request.ExerciseId && !item.IsArchived, cancellationToken))
            {
                return new StrengthCommandResult(StrengthCommandStatus.NotFound);
            }

            if (request.SourceWorkoutExecutionId is { } executionId &&
                !await dbContext.WorkoutExecutions.AsNoTracking().AnyAsync(
                    item => item.Id == executionId && item.ClientProfileId == clientProfileId,
                    cancellationToken))
            {
                return Invalid("sourceWorkoutExecutionId", "The source workout does not belong to this client.");
            }

            var (methodKey, methodVersion) = ResolveMethod(request);
            var record = StrengthMaxRecord.Create(
                tenantContext.TenantId,
                clientProfileId,
                request.ExerciseId,
                request.Kind,
                request.Value,
                request.Unit,
                request.EffectiveDate,
                request.Source,
                methodKey,
                methodVersion,
                request.SourceWorkoutExecutionId,
                request.Note);
            dbContext.StrengthMaxRecords.Add(record);
            await dbContext.SaveChangesAsync(cancellationToken);

            var exerciseName = await dbContext.Exercises.AsNoTracking()
                .Where(item => item.Id == request.ExerciseId)
                .Select(item => item.Name)
                .SingleAsync(cancellationToken);
            return new StrengthCommandResult(StrengthCommandStatus.Success, ToView(record, exerciseName));
        }
        catch (ArgumentException exception)
        {
            return Invalid("max", exception.PersonMessage());
        }
    }

    public async Task<MaxFromSetCommandResult> RecordFromSetAsync(
        Guid clientProfileId,
        RecordMaxFromSetRequest request,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking()
                .AnyAsync(item => item.Id == clientProfileId, cancellationToken) ||
            !await dbContext.Exercises.AsNoTracking()
                .AnyAsync(item => item.Id == request.ExerciseId && !item.IsArchived, cancellationToken))
        {
            return new MaxFromSetCommandResult(StrengthCommandStatus.NotFound);
        }

        // The day they did the set, in the workspace's calendar (SYS-008): a set not done yet implies nothing.
        if (request.EffectiveDate > await GetTenantTodayAsync(cancellationToken))
        {
            return InvalidFromSet("effectiveDate", "A max from a set is for today or a day that has passed.");
        }

        if (!Enum.IsDefined(request.Unit))
        {
            return InvalidFromSet("unit", "Choose kilograms or pounds.");
        }

        StrengthMaxRecord estimate;
        try
        {
            estimate = StrengthMaxRecord.EstimateFromSet(
                tenantContext.TenantId,
                clientProfileId,
                request.ExerciseId,
                request.Load,
                request.Repetitions,
                request.Unit,
                request.EffectiveDate,
                request.Note);
        }
        catch (ArgumentException exception)
        {
            return InvalidFromSet(
                exception.ParamName switch
                {
                    "repetitions" or "load" or "note" => exception.ParamName,
                    _ => "max",
                },
                exception.PersonMessage());
        }

        // Both or neither: one save, so a training max never stands without the estimate it names.
        var trainingMax = request.AlsoSetTrainingMax ? StrengthMaxRecord.TrainingMaxFromEstimate(estimate) : null;
        dbContext.StrengthMaxRecords.Add(estimate);
        if (trainingMax is not null)
        {
            dbContext.StrengthMaxRecords.Add(trainingMax);
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        var exerciseName = await dbContext.Exercises.AsNoTracking()
            .Where(item => item.Id == request.ExerciseId)
            .Select(item => item.Name)
            .SingleAsync(cancellationToken);
        return new MaxFromSetCommandResult(
            StrengthCommandStatus.Success,
            new MaxFromSetView(
                ToView(estimate, exerciseName),
                trainingMax is null ? null : ToView(trainingMax, exerciseName)));
    }

    public OneRepMaxEstimateView Estimate(EstimateOneRepMaxRequest request)
    {
        // An empty body leaves the method out; it is refused like an unknown one (audit SEC-4).
        IOneRepMaxEstimator estimator = request.MethodKey?.Trim().ToUpperInvariant() switch
        {
            "EPLEY" => new EpleyOneRepMaxEstimator(),
            "BRZYCKI" => new BrzyckiOneRepMaxEstimator(),
            _ => throw new ArgumentException("Supported estimate methods are Epley and Brzycki.", nameof(request)),
        };

        var estimate = estimator.Estimate(request.Load, request.Repetitions);
        return new OneRepMaxEstimateView(
            estimate,
            request.Unit,
            estimator.MethodKey,
            estimator.Version,
            "Population-level estimate only; individual response varies and the value is not physiologically exact.",
            estimator.Explain(request.Load, request.Repetitions, request.Unit),
            // What "Also set their training max at 90 %" would record, so the screen shows the server's number.
            estimate <= 2_000m
                ? new TrainingMaxShareView(
                    TrainingMaxShare.Apply(estimate),
                    TrainingMaxShare.Percent,
                    TrainingMaxShare.Key,
                    TrainingMaxShare.CurrentVersion,
                    TrainingMaxShare.Explain(estimate, request.Unit))
                : null);
    }

    public RpeChartMaxEstimateView EstimateFromRpeChart(EstimateRpeChartMaxRequest request)
    {
        var estimate = RpeChartMaxEstimator.Estimate(request.Load, request.Repetitions, request.Rpe, request.Unit);
        return new RpeChartMaxEstimateView(
            estimate.Value,
            estimate.Unit,
            estimate.Percent,
            estimate.StrategyKey,
            estimate.Version,
            estimate.Explanation);
    }

    private static (string MethodKey, string Version) ResolveMethod(RecordStrengthMaxRequest request) =>
        request.Kind switch
        {
            StrengthMaxKind.TestedOneRepMax => ("TestedLift", ManualMethodVersion),
            StrengthMaxKind.CoachWorkingMax => ("CoachSelection", ManualMethodVersion),
            // An estimate is never typed: StrengthMaxRecord.Create refuses it in its own words (STR-001, STR-017).
            _ => (request.Kind.ToString(), ManualMethodVersion),
        };

    private static StrengthMaxView ToView(StrengthMaxRecord item, string exerciseName) =>
        new(
            item.Id,
            item.ClientProfileId,
            item.ExerciseId,
            exerciseName,
            item.Kind,
            item.Value,
            item.Unit,
            item.EffectiveDate,
            item.Source,
            item.MethodKey,
            item.MethodVersion,
            item.SourceWorkoutExecutionId,
            item.Note,
            item.CreatedAtUtc,
            Basis: item is { BasisLoad: { } load, BasisRepetitions: { } repetitions }
                ? new StrengthMaxSetView(load, repetitions)
                : null,
            FromEstimate: item is { SourceEstimateId: { } estimateId, EstimateValue: { } estimate, SharePercent: { } share }
                ? new StrengthMaxFromEstimateView(estimateId, estimate, share)
                : null);

    /// <summary>
    /// Every training max of the client's programs, each dated the day the coach set it in that program's
    /// time zone, as the program's own maxes read says (STR-011).
    /// </summary>
    private async Task<IEnumerable<StrengthMaxView>> ListProgramMaxesAsync(
        Guid clientProfileId,
        Guid? exerciseId,
        CancellationToken cancellationToken)
    {
        var query = dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId);
        if (exerciseId is { } id)
        {
            query = query.Where(item => item.ExerciseId == id);
        }

        var rows = await query
            .Join(
                dbContext.TrainingMesocycles.AsNoTracking(),
                max => new { max.TenantId, Id = max.MesocycleId },
                program => new { program.TenantId, program.Id },
                (max, program) => new { Max = max, ProgramName = program.Name, program.TimeZoneId })
            .Join(
                dbContext.Exercises.AsNoTracking(),
                row => new { row.Max.TenantId, Id = row.Max.ExerciseId },
                exercise => new { exercise.TenantId, exercise.Id },
                (row, exercise) => new { row.Max, row.ProgramName, row.TimeZoneId, ExerciseName = exercise.Name })
            .ToListAsync(cancellationToken);
        var timeZones = rows
            .Select(row => row.TimeZoneId)
            .Distinct()
            .ToDictionary(zone => zone, TimeZoneInfo.FindSystemTimeZoneById);
        return rows.Select(row => ToView(row.Max, row.ExerciseName, row.ProgramName, timeZones[row.TimeZoneId]));
    }

    private static StrengthMaxView ToView(
        MesocycleWorkingMaxSnapshot max,
        string exerciseName,
        string programName,
        TimeZoneInfo timeZone) =>
        new(
            max.Id,
            max.ClientProfileId,
            max.ExerciseId,
            exerciseName,
            StrengthMaxKind.CoachWorkingMax,
            max.Value,
            max.Unit,
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(max.CreatedAtUtc, timeZone).DateTime),
            max.Source switch
            {
                WorkingMaxSource.WeekOneWeight => StrengthMaxSource.Calculation,
                WorkingMaxSource.LoggedSet => StrengthMaxSource.WorkoutSet,
                _ => StrengthMaxSource.Manual,
            },
            max.EstimateMethodKey ?? ProgramMaxMethodKey,
            max.EstimateMethodVersion ?? ManualMethodVersion,
            null,
            max.Reason,
            max.CreatedAtUtc,
            new StrengthMaxProgramView(max.MesocycleId, programName, max.EffectiveFromWeek, max.Source));

    private static StrengthCommandResult Invalid(string field, string message) =>
        new(
            StrengthCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static MaxFromSetCommandResult InvalidFromSet(string field, string message) =>
        new(
            StrengthCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>The workspace's today (SYS-008), never the server's clock.</summary>
    private async Task<DateOnly> GetTenantTodayAsync(CancellationToken cancellationToken)
    {
        var timeZoneId = await dbContext.Tenants.AsNoTracking()
            .Where(tenant => tenant.Id == tenantContext.TenantId)
            .Select(tenant => tenant.TimeZoneId)
            .SingleAsync(cancellationToken);
        var localNow = TimeZoneInfo.ConvertTime(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId));
        return DateOnly.FromDateTime(localNow.DateTime);
    }
}
