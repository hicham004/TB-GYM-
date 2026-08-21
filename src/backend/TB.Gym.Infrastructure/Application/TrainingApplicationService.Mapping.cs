using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;
using StrengthLoadRoundingMode = TB.Gym.Modules.Strength.LoadRoundingMode;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    private async Task<ProgramBlueprint> BuildProgramBlueprintAsync(
        SaveProgramTemplateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Weeks);
        var sessions = request.Weeks.SelectMany(item => item.Sessions ?? []).ToArray();
        var exerciseRequests = sessions.SelectMany(item => item.Exercises ?? []).ToArray();
        var exerciseIds = exerciseRequests
            .SelectMany(item => item.ApprovedAlternativeExerciseIds.Prepend(item.ExerciseId))
            .Distinct()
            .ToArray();
        var names = await dbContext.Exercises.AsNoTracking()
            .Where(item => exerciseIds.Contains(item.Id) && !item.IsArchived)
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        if (names.Count != exerciseIds.Length)
        {
            throw new ArgumentException("Every prescribed exercise and alternative must be active in this workspace.");
        }

        return new ProgramBlueprint(
            request.Name,
            request.Description,
            request.Weeks.Select(week => new TrainingWeekBlueprint(
                week.Label,
                week.IsPublished,
                (week.Sessions ?? []).Select(session => ToBlueprint(session, names)).ToArray())).ToArray());
    }

    private async Task<TrainingSessionBlueprint> BuildSessionBlueprintAsync(
        TrainingSessionRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Exercises);
        var ids = request.Exercises
            .SelectMany(item => item.ApprovedAlternativeExerciseIds.Prepend(item.ExerciseId))
            .Distinct()
            .ToArray();
        var names = await dbContext.Exercises.AsNoTracking()
            .Where(item => ids.Contains(item.Id) && !item.IsArchived)
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        if (names.Count != ids.Length)
        {
            throw new ArgumentException("Every prescribed exercise and alternative must be active in this workspace.");
        }

        return await AttachCurrentMediaAsync(ToBlueprint(request, names), cancellationToken);
    }

    private static TrainingSessionBlueprint ToBlueprint(
        TrainingSessionRequest request,
        Dictionary<Guid, string> names) =>
        new(
            request.Name,
            request.DayOffset,
            request.CoachNotes,
            request.Exercises.Select(item => new ExercisePrescriptionBlueprint(
                item.ExerciseId,
                names[item.ExerciseId],
                item.Position,
                item.IsMainLift,
                item.ModificationPolicy,
                item.CoachNotes,
                item.ApprovedAlternativeExerciseIds,
                [],
                item.Sets.Select(ToBlueprint).ToArray())).ToArray());

    private static SetPrescriptionBlueprint ToBlueprint(SetPrescriptionRequest request)
    {
        if (request.TargetRpe is not null && request.TargetRir is not null)
        {
            throw new ArgumentException("Specify RPE or RIR, not both, for a set.");
        }

        var targetRpe = request.TargetRpe ?? (request.TargetRir is { } rir
            ? TrainingExertion.RpeFromRir(rir)
            : null);
        if (targetRpe is { } rpe)
        {
            TrainingExertion.ValidateRpe(rpe);
        }

        if (request.ManualLoadOverride is { } manual)
        {
            if (manual is <= 0m or > 2_000m || request.LoadUnit is null)
            {
                throw new ArgumentException("A manual load override requires a positive load and unit.");
            }

            return new SetPrescriptionBlueprint(
                request.Position,
                request.SetType,
                request.RepetitionsMinimum,
                request.RepetitionsMaximum,
                TrainingLoadStrategy.Direct,
                manual,
                request.LoadUnit,
                null,
                targetRpe,
                request.ExertionDisplayPreference,
                request.RestSeconds,
                request.Tempo,
                request.CoachNotes,
                IsManualLoadOverride: true);
        }

        return new SetPrescriptionBlueprint(
            request.Position,
            request.SetType,
            request.RepetitionsMinimum,
            request.RepetitionsMaximum,
            request.LoadStrategy,
            request.DirectLoad,
            request.LoadUnit,
            request.PercentageWorkingMax,
            targetRpe,
            request.ExertionDisplayPreference,
            request.RestSeconds,
            request.Tempo,
            request.CoachNotes);
    }

    private static ProgramBlueprint ToBlueprint(ProgramTemplateVersion version) =>
        new(
            version.NameSnapshot,
            version.DescriptionSnapshot,
            version.Weeks.OrderBy(item => item.WeekNumber).Select(week => new TrainingWeekBlueprint(
                week.Label,
                week.IsPublishedByDefault,
                week.Sessions.OrderBy(item => item.Position).Select(ToBlueprint).ToArray())).ToArray());

    private static TrainingSessionBlueprint ToBlueprint(ProgramTemplateSession session) =>
        new(
            session.Name,
            session.DayOffset,
            session.CoachNotes,
            session.Exercises.OrderBy(item => item.Position).Select(exercise => new ExercisePrescriptionBlueprint(
                exercise.ExerciseId,
                exercise.ExerciseNameSnapshot,
                exercise.Position,
                exercise.IsMainLift,
                exercise.ModificationPolicy,
                exercise.CoachNotes,
                exercise.Alternatives.Select(item => item.ExerciseId).ToArray(),
                [],
                exercise.Sets.OrderBy(item => item.Position).Select(ToBlueprint).ToArray())).ToArray());

    private static SetPrescriptionBlueprint ToBlueprint(ProgramTemplateSet set) =>
        new(
            set.Position,
            set.SetType,
            set.RepetitionsMinimum,
            set.RepetitionsMaximum,
            set.LoadStrategy,
            set.DirectLoad,
            set.LoadUnit,
            set.PercentageWorkingMax,
            set.TargetRpe,
            set.ExertionDisplayPreference,
            set.RestSeconds,
            set.Tempo,
            set.CoachNotes,
            IsManualLoadOverride: set.IsManualLoadOverride);

    private async Task<ProgramBlueprint> BuildAssignmentBlueprintAsync(
        ProgramTemplateVersion version,
        AssignMesocycleRequest request,
        IReadOnlyDictionary<Guid, MesocycleWorkingMaxSnapshot> workingMaxes,
        CancellationToken cancellationToken)
    {
        var source = ToBlueprint(version);
        var policy = CreateRoundingPolicy(request.LoadUnit, request.LoadIncrement, request.LoadRoundingMode);
        var calculated = source with
        {
            Weeks = source.Weeks.Select(week => week with
            {
                Sessions = week.Sessions.Select(session => CalculateSessionBlueprint(
                    session,
                    request.LoadUnit,
                    policy,
                    workingMaxes)).ToArray(),
            }).ToArray(),
        };
        return await AttachCurrentMediaAsync(calculated, cancellationToken);
    }

    private async Task<ProgramBlueprint> AttachCurrentMediaAsync(
        ProgramBlueprint blueprint,
        CancellationToken cancellationToken)
    {
        var exerciseIds = blueprint.Weeks.SelectMany(item => item.Sessions)
            .SelectMany(item => item.Exercises)
            .Select(item => item.ExerciseId)
            .Distinct()
            .ToArray();
        var rows = await (
            from link in dbContext.ExerciseMediaLinks.AsNoTracking()
            join asset in dbContext.MediaAssets.AsNoTracking()
                on new { link.TenantId, Id = link.MediaAssetId }
                equals new { asset.TenantId, asset.Id }
            where exerciseIds.Contains(link.ExerciseId) && asset.Status == MediaAssetStatus.Ready
            orderby link.DisplayOrder
            select new { link.ExerciseId, link.MediaAssetId })
            .ToListAsync(cancellationToken);
        var byExercise = rows.ToLookup(item => item.ExerciseId, item => item.MediaAssetId);
        return blueprint with
        {
            Weeks = blueprint.Weeks.Select(week => week with
            {
                Sessions = week.Sessions.Select(session => session with
                {
                    Exercises = session.Exercises.Select(exercise => exercise with
                    {
                        MediaAssetIds = byExercise[exercise.ExerciseId].ToArray(),
                    }).ToArray(),
                }).ToArray(),
            }).ToArray(),
        };
    }

    private async Task<TrainingSessionBlueprint> AttachCurrentMediaAsync(
        TrainingSessionBlueprint session,
        CancellationToken cancellationToken)
    {
        var wrapper = new ProgramBlueprint(
            "Session media snapshot",
            null,
            [new TrainingWeekBlueprint(null, true, [session])]);
        return (await AttachCurrentMediaAsync(wrapper, cancellationToken)).Weeks[0].Sessions[0];
    }

    private TrainingSessionBlueprint CalculateSessionBlueprint(
        TrainingSessionBlueprint session,
        TrainingMesocycle mesocycle,
        IReadOnlyDictionary<Guid, MesocycleWorkingMaxSnapshot> workingMaxes) =>
        CalculateSessionBlueprint(
            session,
            mesocycle.LoadUnit,
            CreateRoundingPolicy(
                mesocycle.LoadUnit,
                mesocycle.LoadIncrement,
                mesocycle.LoadRoundingMode),
            workingMaxes);

    private TrainingSessionBlueprint CalculateSessionBlueprint(
        TrainingSessionBlueprint session,
        TrainingLoadUnit loadUnit,
        LoadRoundingPolicy roundingPolicy,
        IReadOnlyDictionary<Guid, MesocycleWorkingMaxSnapshot> workingMaxes) =>
        session with
        {
            Exercises = session.Exercises.Select(exercise => exercise with
            {
                Sets = exercise.Sets.Select(set => CalculateSetBlueprint(
                    exercise.ExerciseId,
                    set,
                    loadUnit,
                    roundingPolicy,
                    workingMaxes)).ToArray(),
            }).ToArray(),
        };

    private SetPrescriptionBlueprint CalculateSetBlueprint(
        Guid exerciseId,
        SetPrescriptionBlueprint set,
        TrainingLoadUnit loadUnit,
        LoadRoundingPolicy roundingPolicy,
        IReadOnlyDictionary<Guid, MesocycleWorkingMaxSnapshot> workingMaxes)
    {
        if (set.LoadStrategy == TrainingLoadStrategy.None)
        {
            return set with
            {
                WorkingMaxSnapshotId = null,
                UnroundedRecommendedLoad = null,
                PrescribedLoad = null,
                CalculationStrategyKey = null,
                CalculationStrategyVersion = null,
                CalculationExplanation = null,
            };
        }

        if (set.LoadUnit != loadUnit)
        {
            throw new ArgumentException("Set load units must match the mesocycle load unit in Training Engine v1.");
        }

        if (set.LoadStrategy == TrainingLoadStrategy.Direct)
        {
            var value = set.DirectLoad ?? throw new ArgumentException("A direct set requires a load.");
            return set with
            {
                WorkingMaxSnapshotId = null,
                UnroundedRecommendedLoad = value,
                PrescribedLoad = value,
                CalculationStrategyKey = set.IsManualLoadOverride ? "ManualCoachOverride" : "CoachDirect",
                CalculationStrategyVersion = "1.0",
                CalculationExplanation = set.IsManualLoadOverride
                    ? "Manual coach override; no automatic rounding was applied."
                    : "Direct coach-prescribed load; no automatic rounding was applied.",
            };
        }

        if (!workingMaxes.TryGetValue(exerciseId, out var workingMax))
        {
            throw new ArgumentException($"Exercise {exerciseId} requires a selected working max.");
        }

        if (ToTrainingUnit(workingMax.Unit) != loadUnit)
        {
            throw new ArgumentException("Working-max and mesocycle load units must match.");
        }

        var strategy = set.LoadStrategy switch
        {
            TrainingLoadStrategy.PercentageWorkingMax => PrescriptionLoadStrategy.PercentageWorkingMax,
            TrainingLoadStrategy.RpeBasedEpley => PrescriptionLoadStrategy.RpeBasedEpley,
            _ => throw new ArgumentOutOfRangeException(nameof(set)),
        };
        var recommendation = loadRecommendation.Recommend(new LoadRecommendationInput(
            strategy,
            null,
            set.PercentageWorkingMax,
            workingMax.Value,
            set.RepetitionsMaximum,
            set.TargetRpe,
            ToStrengthUnit(loadUnit)));
        return set with
        {
            WorkingMaxSnapshotId = workingMax.Id,
            UnroundedRecommendedLoad = recommendation.Value,
            PrescribedLoad = roundingPolicy.Round(recommendation.Value),
            CalculationStrategyKey = recommendation.StrategyKey,
            CalculationStrategyVersion = recommendation.StrategyVersion,
            CalculationExplanation = recommendation.Explanation,
        };
    }

    private async Task<Dictionary<Guid, MesocycleWorkingMaxSnapshot>> CreateWorkingMaxSnapshotsAsync(
        Guid mesocycleId,
        Guid clientProfileId,
        AssignMesocycleRequest request,
        ProgramTemplateVersion templateVersion,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request.WorkingMaxes);
        var relevantExerciseIds = templateVersion.Weeks
            .SelectMany(item => item.Sessions)
            .SelectMany(item => item.Exercises)
            .Where(item => item.Sets.Any(set =>
                set.LoadStrategy is TrainingLoadStrategy.PercentageWorkingMax or TrainingLoadStrategy.RpeBasedEpley))
            .Select(item => item.ExerciseId)
            .Distinct()
            .ToHashSet();
        var selections = request.WorkingMaxes.ToArray();
        if (selections.Select(item => item.ExerciseId).Distinct().Count() != selections.Length ||
            selections.Any(item => !relevantExerciseIds.Contains(item.ExerciseId)) ||
            relevantExerciseIds.Any(id => selections.All(item => item.ExerciseId != id)))
        {
            throw new ArgumentException("Provide exactly one working max for every exercise that uses calculated loading.");
        }

        var sourceIds = selections.Where(item => item.StrengthMaxRecordId is not null)
            .Select(item => item.StrengthMaxRecordId!.Value)
            .ToArray();
        var sourceRecords = await dbContext.StrengthMaxRecords.AsNoTracking()
            .Where(item => sourceIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        if (sourceRecords.Count != sourceIds.Distinct().Count())
        {
            throw new ArgumentException("A selected strength-max source was not found in this workspace.");
        }

        var result = new Dictionary<Guid, MesocycleWorkingMaxSnapshot>();
        foreach (var selection in selections)
        {
            if (selection.Unit != request.LoadUnit)
            {
                throw new ArgumentException("Working-max units must match the mesocycle load unit.");
            }

            if (selection.StrengthMaxRecordId is { } sourceId)
            {
                var source = sourceRecords[sourceId];
                if (source.ClientProfileId != clientProfileId || source.ExerciseId != selection.ExerciseId ||
                    source.Unit != ToStrengthUnit(selection.Unit))
                {
                    throw new ArgumentException("A working-max source must belong to the same client, exercise, and unit.");
                }
            }

            result.Add(selection.ExerciseId, MesocycleWorkingMaxSnapshot.Capture(
                tenantContext.TenantId,
                mesocycleId,
                clientProfileId,
                selection.ExerciseId,
                selection.StrengthMaxRecordId,
                selection.Value,
                ToStrengthUnit(selection.Unit),
                1,
                null,
                "Assignment working-max snapshot selected by coach."));
        }

        return result;
    }

    private async Task<Dictionary<Guid, MesocycleWorkingMaxSnapshot>> LoadWorkingMaxDictionaryAsync(
        Guid mesocycleId,
        CancellationToken cancellationToken) =>
        await dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycleId && item.EffectiveFromWeek == 1)
            .ToDictionaryAsync(item => item.ExerciseId, cancellationToken);

    private async Task<ProgramTemplateVersion?> LoadTemplateVersionAsync(
        Guid id,
        CancellationToken cancellationToken) =>
        await dbContext.ProgramTemplateVersions
            .AsNoTracking()
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Alternatives)
            .AsSplitQuery()
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);

    private async Task<Dictionary<Guid, ProgramTemplateSession>> LoadTemplateSessionsAsync(
        IReadOnlyList<Guid> ids,
        CancellationToken cancellationToken) =>
        await dbContext.ProgramTemplateSessions.AsNoTracking()
            .Where(item => ids.Contains(item.Id))
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Exercises).ThenInclude(item => item.Alternatives)
            .AsSplitQuery()
            .ToDictionaryAsync(item => item.Id, cancellationToken);

    private async Task<TrainingMesocycle?> LoadMesocycleAsync(
        Guid id,
        bool tracking,
        CancellationToken cancellationToken)
    {
        var query = dbContext.TrainingMesocycles
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Alternatives)
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Media)
            .AsSplitQuery();
        return tracking
            ? await query.SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            : await query.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
    }

    private async Task<TrainingMesocycle?> LoadMesocycleByCommandAsync(
        Guid commandId,
        CancellationToken cancellationToken)
    {
        var id = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.AssignmentCommandId == commandId)
            .Select(item => (Guid?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        return id is null ? null : await LoadMesocycleAsync(id.Value, tracking: false, cancellationToken);
    }

    private async Task<bool> HasPrimaryOverlapAsync(
        Guid clientProfileId,
        DateOnly start,
        DateOnly endExclusive,
        Guid? excludedId,
        CancellationToken cancellationToken) =>
        await dbContext.TrainingMesocycles.AsNoTracking().AnyAsync(
            item =>
                item.ClientProfileId == clientProfileId &&
                item.Kind == MesocycleKind.Primary &&
                item.BlocksPrimaryOverlap &&
                item.Id != excludedId &&
                item.StartDate < endExclusive &&
                item.EndDateExclusive > start,
            cancellationToken);

    private async Task<bool> IsSameAssignmentAsync(
        TrainingMesocycle existing,
        Guid clientProfileId,
        AssignMesocycleRequest request,
        CancellationToken cancellationToken)
    {
        if (existing.ClientProfileId != clientProfileId ||
            existing.EnrollmentId != request.EnrollmentId ||
            existing.SourceTemplateVersionId != request.TemplateVersionId ||
            existing.StartDate != request.StartDate ||
            existing.Kind != request.Kind ||
            existing.LoadUnit != request.LoadUnit ||
            existing.LoadIncrement != decimal.Round(request.LoadIncrement, 3, MidpointRounding.AwayFromZero) ||
            existing.LoadRoundingMode != request.LoadRoundingMode)
        {
            return false;
        }

        var snapshots = await dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.MesocycleId == existing.Id && item.EffectiveFromWeek == 1)
            .ToListAsync(cancellationToken);
        return snapshots.Count == request.WorkingMaxes.Count && request.WorkingMaxes.All(selection =>
            snapshots.Any(snapshot =>
                snapshot.ExerciseId == selection.ExerciseId &&
                snapshot.SourceMaxRecordId == selection.StrengthMaxRecordId &&
                snapshot.Value == decimal.Round(selection.Value, 3, MidpointRounding.AwayFromZero) &&
                snapshot.Unit == ToStrengthUnit(selection.Unit)));
    }

    private async Task<DateOnly> GetTenantTodayAsync(CancellationToken cancellationToken)
    {
        var timeZone = await dbContext.Tenants.AsNoTracking()
            .Where(item => item.Id == tenantContext.TenantId)
            .Select(item => item.TimeZoneId)
            .SingleAsync(cancellationToken);
        var local = TimeZoneInfo.ConvertTime(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(timeZone));
        return DateOnly.FromDateTime(local.DateTime);
    }

    private static LoadRoundingPolicy CreateRoundingPolicy(
        TrainingLoadUnit unit,
        decimal increment,
        TrainingLoadRoundingMode mode) =>
        new(
            ToStrengthUnit(unit),
            increment,
            mode switch
            {
                TrainingLoadRoundingMode.Nearest => StrengthLoadRoundingMode.Nearest,
                TrainingLoadRoundingMode.Down => StrengthLoadRoundingMode.Down,
                TrainingLoadRoundingMode.Up => StrengthLoadRoundingMode.Up,
                _ => throw new ArgumentOutOfRangeException(nameof(mode)),
            });

    private static StrengthLoadUnit ToStrengthUnit(TrainingLoadUnit unit) => unit switch
    {
        TrainingLoadUnit.Kilogram => StrengthLoadUnit.Kilogram,
        TrainingLoadUnit.Pound => StrengthLoadUnit.Pound,
        _ => throw new ArgumentOutOfRangeException(nameof(unit)),
    };

    private static TrainingLoadUnit ToTrainingUnit(StrengthLoadUnit unit) => unit switch
    {
        StrengthLoadUnit.Kilogram => TrainingLoadUnit.Kilogram,
        StrengthLoadUnit.Pound => TrainingLoadUnit.Pound,
        _ => throw new ArgumentOutOfRangeException(nameof(unit)),
    };

    private static ProgramTemplateVersionView ToView(ProgramTemplateVersion version) =>
        new(
            version.Id,
            version.TemplateId,
            version.VersionNumber,
            version.NameSnapshot,
            version.DescriptionSnapshot,
            version.IsPublished,
            version.Weeks.OrderBy(item => item.WeekNumber).Select(week => new TrainingWeekView(
                week.Id,
                week.WeekNumber,
                week.Label,
                null,
                week.IsPublishedByDefault,
                null,
                null,
                week.Sessions.OrderBy(item => item.Position).Select(ToView).ToArray())).ToArray());

    private static TrainingSessionView ToView(ProgramTemplateSession session) =>
        new(
            session.Id,
            session.Position,
            session.DayOffset,
            null,
            session.Name,
            session.CoachNotes,
            false,
            false,
            null,
            session.Exercises.OrderBy(item => item.Position).Select(exercise => new ExercisePrescriptionView(
                exercise.Id,
                exercise.ExerciseId,
                exercise.ExerciseNameSnapshot,
                exercise.Position,
                exercise.IsMainLift,
                exercise.ModificationPolicy,
                exercise.CoachNotes,
                exercise.Alternatives.Select(item => item.ExerciseId).ToArray(),
                exercise.Sets.OrderBy(item => item.Position).Select(ToView).ToArray())).ToArray());

    private static SetPrescriptionView ToView(ProgramTemplateSet set) =>
        new(
            set.Id,
            set.Position,
            set.SetType,
            set.RepetitionsMinimum,
            set.RepetitionsMaximum,
            set.LoadStrategy,
            set.DirectLoad,
            set.LoadUnit,
            set.PercentageWorkingMax,
            set.TargetRpe,
            set.TargetRpe is null ? null : TrainingExertion.RirFromRpe(set.TargetRpe.Value),
            set.ExertionDisplayPreference,
            set.RestSeconds,
            set.Tempo,
            set.CoachNotes,
            null,
            null,
            null,
            null,
            null,
            null,
            set.IsManualLoadOverride);

    private async Task<TrainingMesocycleView> ToViewAsync(
        TrainingMesocycle mesocycle,
        CancellationToken cancellationToken)
    {
        var executionIds = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycle.Id)
            .ToDictionaryAsync(item => item.TrainingSessionId, item => item.Id, cancellationToken);
        var maxRows = await (
            from snapshot in dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            join exercise in dbContext.Exercises.AsNoTracking()
                on new { snapshot.TenantId, Id = snapshot.ExerciseId }
                equals new { exercise.TenantId, exercise.Id }
            where snapshot.MesocycleId == mesocycle.Id
            orderby snapshot.EffectiveFromWeek, exercise.Name
            select new { Snapshot = snapshot, exercise.Name })
            .ToListAsync(cancellationToken);
        var lifecycle = await dbContext.MesocycleLifecycleEvents.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycle.Id)
            .OrderBy(item => item.OccurredAtUtc)
            .ThenBy(item => item.Id)
            .ToListAsync(cancellationToken);

        return new TrainingMesocycleView(
            mesocycle.Id,
            mesocycle.ClientProfileId,
            mesocycle.EnrollmentId,
            mesocycle.SourceTemplateId,
            mesocycle.SourceTemplateVersionId,
            mesocycle.Name,
            mesocycle.StartDate,
            mesocycle.EndDateExclusive,
            mesocycle.TimeZoneId,
            mesocycle.Kind,
            mesocycle.GetEffectiveStatus(clock.UtcNow),
            mesocycle.RevealAllWeeks,
            mesocycle.LoadUnit,
            mesocycle.LoadIncrement,
            mesocycle.LoadRoundingMode,
            maxRows.Select(item => new WorkingMaxSnapshotView(
                item.Snapshot.Id,
                item.Snapshot.ExerciseId,
                item.Name,
                item.Snapshot.SourceMaxRecordId,
                item.Snapshot.Value,
                ToTrainingUnit(item.Snapshot.Unit),
                item.Snapshot.EffectiveFromWeek,
                item.Snapshot.SupersedesSnapshotId,
                item.Snapshot.Reason)).ToArray(),
            mesocycle.Weeks.OrderBy(item => item.WeekNumber)
                .Select(week => ToView(mesocycle, week, executionIds, clock.UtcNow)).ToArray(),
            lifecycle.Select(item => new MesocycleLifecycleEventView(
                item.Id,
                item.EventType,
                item.FromStatus,
                item.ToStatus,
                item.Reason,
                item.OccurredAtUtc,
                item.CreatedByUserId)).ToArray(),
            mesocycle.Version);
    }

    private static TrainingWeekView ToView(
        TrainingMesocycle mesocycle,
        MesocycleWeek week,
        IReadOnlyDictionary<Guid, Guid> executionIds,
        DateTimeOffset now)
    {
        var availability = TrainingCalendarPolicy.GetWeekAvailability(
            mesocycle.StartDate,
            week.WeekNumber,
            mesocycle.TimeZoneId,
            now,
            mesocycle.RevealAllWeeks,
            week.IsPublished);
        return new TrainingWeekView(
            week.Id,
            week.WeekNumber,
            week.Label,
            week.StartsOn,
            week.IsPublished,
            availability.IsVisible,
            availability.UnlockDate,
            week.Sessions.OrderBy(item => item.Position).Select(session => new TrainingSessionView(
                session.Id,
                session.Position,
                session.DayOffset,
                session.ScheduledDate,
                session.Name,
                session.CoachNotes,
                session.HasStarted,
                session.IsCompleted,
                executionIds.GetValueOrDefault(session.Id) is { } executionId && executionId != Guid.Empty
                    ? executionId
                    : null,
                session.Exercises.OrderBy(item => item.Position).Select(ToView).ToArray())).ToArray());
    }

    private static ExercisePrescriptionView ToView(ExercisePrescription exercise) =>
        new(
            exercise.Id,
            exercise.ExerciseId,
            exercise.ExerciseNameSnapshot,
            exercise.Position,
            exercise.IsMainLift,
            exercise.ModificationPolicy,
            exercise.CoachNotes,
            exercise.Alternatives.Select(item => item.ExerciseId).ToArray(),
            exercise.Sets.OrderBy(item => item.Position).Select(ToView).ToArray());

    private static SetPrescriptionView ToView(SetPrescription set) =>
        new(
            set.Id,
            set.Position,
            set.SetType,
            set.RepetitionsMinimum,
            set.RepetitionsMaximum,
            set.LoadStrategy,
            set.DirectLoad,
            set.LoadUnit,
            set.PercentageWorkingMax,
            set.TargetRpe,
            set.TargetRpe is null ? null : TrainingExertion.RirFromRpe(set.TargetRpe.Value),
            set.ExertionDisplayPreference,
            set.RestSeconds,
            set.Tempo,
            set.CoachNotes,
            set.WorkingMaxSnapshotId,
            set.UnroundedRecommendedLoad,
            set.PrescribedLoad,
            set.CalculationStrategyKey,
            set.CalculationStrategyVersion,
            set.CalculationExplanation,
            set.IsManualLoadOverride);
}
