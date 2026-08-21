using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService : ITrainingApplicationService
{
    private readonly GymDbContext dbContext;
    private readonly IClock clock;
    private readonly ICurrentUser currentUser;
    private readonly ITenantContext tenantContext;
    private readonly ICoachingFeatureAccessService featureAccessService;
    private readonly StrengthLoadRecommendationStrategy loadRecommendation = new();
    private readonly RpeStepProgressionTransform rpeProgression = new();

    public TrainingApplicationService(
        GymDbContext dbContext,
        IClock clock,
        ICurrentUser currentUser,
        ITenantContext tenantContext,
        ICoachingFeatureAccessService featureAccessService)
    {
        this.dbContext = dbContext;
        this.clock = clock;
        this.currentUser = currentUser;
        this.tenantContext = tenantContext;
        this.featureAccessService = featureAccessService;
    }

    public async Task<ProgramTemplatePage> ListTemplatesAsync(
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var query = dbContext.ProgramTemplates.AsNoTracking();
        var total = await query.CountAsync(cancellationToken);
        var templates = await query
            .OrderBy(item => item.Name)
            .ThenBy(item => item.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);
        var templateIds = templates.Select(item => item.Id).ToArray();
        var versions = await dbContext.ProgramTemplateVersions.AsNoTracking()
            .Where(item => templateIds.Contains(item.TemplateId))
            .Include(item => item.Weeks)
            .OrderByDescending(item => item.VersionNumber)
            .ToListAsync(cancellationToken);
        var byTemplate = versions.ToLookup(item => item.TemplateId);
        var items = templates.Select(item => new ProgramTemplateSummary(
            item.Id,
            item.Name,
            item.CurrentVersionNumber,
            item.IsArchived,
            item.Version,
            byTemplate[item.Id].Select(version => new ProgramTemplateVersionSummary(
                version.Id,
                version.VersionNumber,
                version.NameSnapshot,
                version.IsPublished,
                version.Weeks.Count,
                version.CreatedAtUtc)).ToArray())).ToArray();
        return new ProgramTemplatePage(total, skip, take, items);
    }

    public async Task<ProgramTemplateVersionView?> GetTemplateVersionAsync(
        Guid templateVersionId,
        CancellationToken cancellationToken)
    {
        var version = await LoadTemplateVersionAsync(templateVersionId, cancellationToken);
        return version is null ? null : ToView(version);
    }

    public async Task<TrainingCommandResult> CreateTemplateAsync(
        SaveProgramTemplateRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var blueprint = await BuildProgramBlueprintAsync(request, cancellationToken);
            var template = ProgramTemplate.Create(tenantContext.TenantId, request.Name);
            var number = template.CreateNextVersion(request.Name);
            var version = ProgramTemplateVersion.Create(
                tenantContext.TenantId,
                template.Id,
                number,
                blueprint,
                request.Publish,
                clock.UtcNow);
            dbContext.ProgramTemplates.Add(template);
            dbContext.ProgramTemplateVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessTemplate(ToView(version));
        }
        catch (ArgumentException exception)
        {
            return Invalid("program", exception.Message);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("template_conflict", "A conflicting program template was saved.");
        }
    }

    public async Task<TrainingCommandResult> AddTemplateVersionAsync(
        Guid templateId,
        SaveProgramTemplateRequest request,
        CancellationToken cancellationToken)
    {
        var template = await dbContext.ProgramTemplates.SingleOrDefaultAsync(
            item => item.Id == templateId,
            cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        try
        {
            if (request.TemplateVersion is not { } expectedVersion)
            {
                return Invalid("templateVersion", "The current template version is required.");
            }

            var blueprint = await BuildProgramBlueprintAsync(request, cancellationToken);
            dbContext.Entry(template).Property(item => item.Version).OriginalValue = expectedVersion;
            var number = template.CreateNextVersion(request.Name);
            var version = ProgramTemplateVersion.Create(
                tenantContext.TenantId,
                template.Id,
                number,
                blueprint,
                request.Publish,
                clock.UtcNow);
            dbContext.ProgramTemplateVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessTemplate(ToView(version));
        }
        catch (ArgumentException exception)
        {
            return Invalid("program", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("program", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("template_conflict", "A conflicting program version was saved.");
        }
    }

    public async Task<IReadOnlyList<SavedSessionView>> ListSavedSessionsAsync(
        CancellationToken cancellationToken)
    {
        var saved = await dbContext.SavedSessionTemplates.AsNoTracking()
            .Where(item => !item.IsArchived)
            .OrderBy(item => item.Name)
            .ToListAsync(cancellationToken);
        var sessionIds = saved.Select(item => item.SourceTemplateSessionId).ToArray();
        var sessions = await LoadTemplateSessionsAsync(sessionIds, cancellationToken);
        return saved.Where(item => sessions.ContainsKey(item.SourceTemplateSessionId))
            .Select(item => new SavedSessionView(
                item.Id,
                item.Name,
                item.SourceTemplateVersionId,
                item.SourceTemplateSessionId,
                ToView(sessions[item.SourceTemplateSessionId])))
            .ToArray();
    }

    public async Task<TrainingCommandResult> SaveSessionAsync(
        SaveSessionTemplateRequest request,
        CancellationToken cancellationToken)
    {
        var session = await dbContext.ProgramTemplateSessions.AsNoTracking()
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Exercises).ThenInclude(item => item.Alternatives)
            .AsSplitQuery()
            .SingleOrDefaultAsync(item => item.Id == request.SourceTemplateSessionId, cancellationToken);
        if (session is null)
        {
            return NotFound();
        }

        var belongsToVersion = await dbContext.ProgramTemplateWeeks.AsNoTracking().AnyAsync(
            item => item.Id == session.TemplateWeekId && item.TemplateVersionId == request.SourceTemplateVersionId,
            cancellationToken);
        if (!belongsToVersion)
        {
            return Invalid("sourceTemplateVersionId", "The session does not belong to the selected immutable version.");
        }

        try
        {
            var saved = SavedSessionTemplate.Create(
                tenantContext.TenantId,
                request.Name,
                request.SourceTemplateVersionId,
                request.SourceTemplateSessionId);
            dbContext.SavedSessionTemplates.Add(saved);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new TrainingCommandResult(
                TrainingCommandStatus.Success,
                SavedSession: new SavedSessionView(
                    saved.Id,
                    saved.Name,
                    saved.SourceTemplateVersionId,
                    saved.SourceTemplateSessionId,
                    ToView(session)));
        }
        catch (ArgumentException exception)
        {
            return Invalid("savedSession", exception.Message);
        }
    }

    public async Task<IReadOnlyList<MesocycleSummary>?> ListClientMesocyclesAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking()
                .AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return null;
        }

        var items = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId)
            .OrderByDescending(item => item.StartDate)
            .ThenByDescending(item => item.Id)
            .ToListAsync(cancellationToken);
        return items.Select(item => new MesocycleSummary(
                item.Id,
                item.EnrollmentId,
                item.Name,
                item.StartDate,
                item.EndDateExclusive,
                item.Kind,
                item.GetEffectiveStatus(clock.UtcNow),
                item.RevealAllWeeks,
                item.Version))
            .ToArray();
    }

    public async Task<TrainingMesocycleView?> GetMesocycleAsync(
        Guid mesocycleId,
        CancellationToken cancellationToken)
    {
        var item = await LoadMesocycleAsync(mesocycleId, tracking: false, cancellationToken);
        return item is null ? null : await ToViewAsync(item, cancellationToken);
    }

    public async Task<TrainingCommandResult> AssignMesocycleAsync(
        Guid clientProfileId,
        AssignMesocycleRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            ArgumentNullException.ThrowIfNull(request.WorkingMaxes);
            if (request.IdempotencyKey == Guid.Empty)
            {
                return Invalid("idempotencyKey", "A non-empty idempotency key is required.");
            }

            var existing = await LoadMesocycleByCommandAsync(request.IdempotencyKey, cancellationToken);
            if (existing is not null)
            {
                return await IsSameAssignmentAsync(existing, clientProfileId, request, cancellationToken)
                    ? SuccessMesocycle(await ToViewAsync(existing, cancellationToken))
                    : Conflict("idempotency_conflict", "This idempotency key was already used for another assignment.");
            }

            if (!await dbContext.ClientProfiles.AsNoTracking()
                    .AnyAsync(item => item.Id == clientProfileId, cancellationToken))
            {
                return NotFound();
            }

            var templateVersion = await LoadTemplateVersionAsync(request.TemplateVersionId, cancellationToken);
            if (templateVersion is null || !templateVersion.IsPublished)
            {
                return Invalid("templateVersionId", "A published template version is required.");
            }

            var endDate = request.StartDate.AddDays(checked(templateVersion.Weeks.Count * 7));
            var coverage = await EvaluateCoverageAsync(
                clientProfileId,
                request.EnrollmentId,
                request.StartDate,
                endDate,
                cancellationToken);
            if (!coverage.Exists)
            {
                return NotFound();
            }

            if (!coverage.Decision.IsAuthorized)
            {
                return Invalid(
                    "enrollmentId",
                    coverage.Decision.Reason ?? "The enrollment does not authorize this mesocycle.");
            }

            if (request.Kind != MesocycleKind.Primary)
            {
                return Invalid("kind", "Phase 3 supports primary mesocycles only.");
            }

            if (await HasPrimaryOverlapAsync(clientProfileId, request.StartDate, endDate, null, cancellationToken))
            {
                return Conflict("mesocycle_overlap", "The client already has an overlapping primary mesocycle.");
            }

            var timeZoneId = await dbContext.Tenants.AsNoTracking()
                .Where(item => item.Id == tenantContext.TenantId)
                .Select(item => item.TimeZoneId)
                .SingleAsync(cancellationToken);
            var mesocycleId = Guid.CreateVersion7();
            var workingMaxes = await CreateWorkingMaxSnapshotsAsync(
                mesocycleId,
                clientProfileId,
                request,
                templateVersion,
                cancellationToken);
            var snapshot = await BuildAssignmentBlueprintAsync(
                templateVersion,
                request,
                workingMaxes,
                cancellationToken);
            var mesocycle = TrainingMesocycle.CreateSnapshot(
                tenantContext.TenantId,
                clientProfileId,
                request.EnrollmentId,
                templateVersion.TemplateId,
                templateVersion.Id,
                templateVersion.NameSnapshot,
                request.StartDate,
                timeZoneId,
                request.Kind,
                request.LoadUnit,
                request.LoadIncrement,
                request.LoadRoundingMode,
                request.IdempotencyKey,
                snapshot,
                mesocycleId);

            dbContext.MesocycleWorkingMaxSnapshots.AddRange(workingMaxes.Values);
            dbContext.TrainingMesocycles.Add(mesocycle);
            dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                MesocycleLifecycleEventType.Assigned,
                null,
                mesocycle.GetEffectiveStatus(clock.UtcNow),
                "Assigned from a published program template.",
                clock.UtcNow));
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("assignment", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("assignment", exception.Message);
        }
        catch (DbUpdateException exception) when (IsExclusionViolation(exception))
        {
            return Conflict("mesocycle_overlap", "The client already has an overlapping primary mesocycle.");
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("assignment_conflict", "The assignment conflicts with an existing request.");
        }
    }

    public Task<TrainingCommandResult> UpdateMesocycleVisibilityAsync(
        Guid mesocycleId,
        UpdateMesocycleVisibilityRequest request,
        CancellationToken cancellationToken) =>
        MutateMesocycleAsync(
            mesocycleId,
            request.Version,
            item => item.SetRevealAllWeeks(request.RevealAllWeeks),
            cancellationToken);

    public Task<TrainingCommandResult> SetWeekPublishedAsync(
        Guid mesocycleId,
        Guid weekId,
        SetWeekPublishedRequest request,
        CancellationToken cancellationToken) =>
        MutateMesocycleAsync(
            mesocycleId,
            request.Version,
            item => item.SetWeekPublished(weekId, request.IsPublished),
            cancellationToken);

    public async Task<TrainingCommandResult> RescheduleMesocycleAsync(
        Guid mesocycleId,
        RescheduleMesocycleRequest request,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            var newEnd = request.StartDate.AddDays(mesocycle.Weeks.Count * 7);
            var coverage = await EvaluateCoverageAsync(
                mesocycle.ClientProfileId,
                mesocycle.EnrollmentId,
                request.StartDate,
                newEnd,
                cancellationToken);
            if (!coverage.Exists || !coverage.Decision.IsAuthorized)
            {
                return Invalid(
                    "startDate",
                    coverage.Decision.Reason ?? "The rescheduled mesocycle is outside training coverage.");
            }

            if (await HasPrimaryOverlapAsync(
                    mesocycle.ClientProfileId,
                    request.StartDate,
                    newEnd,
                    mesocycle.Id,
                    cancellationToken))
            {
                return Conflict("mesocycle_overlap", "The new dates overlap another primary mesocycle.");
            }

            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.Version;
            mesocycle.Reschedule(request.StartDate);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsExclusionViolation(exception))
        {
            return Conflict("mesocycle_overlap", "The new dates overlap another primary mesocycle.");
        }
    }

    public async Task<TrainingCommandResult> CancelMesocycleAsync(
        Guid mesocycleId,
        CancelMesocycleRequest request,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.Version;
            var previous = mesocycle.Cancel(clock.UtcNow);
            dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                MesocycleLifecycleEventType.Cancelled,
                previous,
                MesocycleStatus.Cancelled,
                request.Reason,
                clock.UtcNow));
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("reason", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("lifecycle_conflict", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    public async Task<TrainingCommandResult> CompleteMesocycleAsync(
        Guid mesocycleId,
        CompleteMesocycleRequest request,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.Version;
            var previous = mesocycle.Complete(clock.UtcNow);
            dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                MesocycleLifecycleEventType.Completed,
                previous,
                MesocycleStatus.Completed,
                "All programmed sessions were completed.",
                clock.UtcNow));
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("lifecycle_conflict", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    public async Task<TrainingCommandResult> ReplaceSessionAsync(
        Guid mesocycleId,
        Guid sessionId,
        ReplaceTrainingSessionRequest request,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            var session = mesocycle.Weeks.SelectMany(item => item.Sessions)
                .SingleOrDefault(item => item.Id == sessionId);
            if (session is null)
            {
                return NotFound();
            }

            if (session.ScheduledDate < await GetTenantTodayAsync(cancellationToken))
            {
                return Invalid("session", "Historical sessions cannot be reprogrammed.");
            }

            var baseBlueprint = await BuildSessionBlueprintAsync(request.Session, cancellationToken);
            var workingMaxes = await LoadWorkingMaxDictionaryAsync(mesocycle.Id, cancellationToken);
            var calculated = CalculateSessionBlueprint(baseBlueprint, mesocycle, workingMaxes);
            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.Version;
            mesocycle.ReplaceFutureSession(sessionId, calculated);
            dbContext.ExercisePrescriptions.AddRange(session.Exercises);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("session", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("session", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    private async Task<TrainingCommandResult> MutateMesocycleAsync(
        Guid mesocycleId,
        uint version,
        Action<TrainingMesocycle> mutation,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = version;
            mutation(mesocycle);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("mesocycle", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("mesocycle", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static bool IsExclusionViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.ExclusionViolation };

    private async Task<CoverageLookup> EvaluateCoverageAsync(
        Guid clientProfileId,
        Guid enrollmentId,
        DateOnly startDate,
        DateOnly endDateExclusive,
        CancellationToken cancellationToken)
    {
        var enrollment = await dbContext.ClientEnrollments.AsNoTracking()
            .Where(item => item.Id == enrollmentId && item.ClientProfileId == clientProfileId)
            .Select(item => new
            {
                item.Id,
                item.ClientProfileId,
                item.StartDate,
                item.EndDateExclusive,
                item.Status,
                IncludesTraining = item.Entitlements.Any(
                    entitlement => entitlement.Feature == CoachingFeature.Training),
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (enrollment is null)
        {
            return new CoverageLookup(false, new TrainingCoverageDecision(false, "The enrollment was not found."));
        }

        var authorization = new TrainingCoverageAuthorization(
            enrollment.Id,
            enrollment.ClientProfileId,
            enrollment.StartDate,
            enrollment.EndDateExclusive,
            enrollment.IncludesTraining,
            enrollment.Status is EnrollmentStatus.Cancelled or EnrollmentStatus.Expired);
        return new CoverageLookup(
            true,
            TrainingCoveragePolicy.Evaluate(clientProfileId, startDate, endDateExclusive, authorization));
    }

    private static TrainingCommandResult SuccessTemplate(ProgramTemplateVersionView view) =>
        new(TrainingCommandStatus.Success, TemplateVersion: view);

    private static TrainingCommandResult SuccessMesocycle(TrainingMesocycleView view) =>
        new(TrainingCommandStatus.Success, Mesocycle: view);

    private static TrainingCommandResult NotFound() => new(TrainingCommandStatus.NotFound);

    private static TrainingCommandResult Invalid(string field, string message) =>
        new(
            TrainingCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static TrainingCommandResult Conflict(string code, string message) =>
        new(TrainingCommandStatus.Conflict, Code: code, Message: message);

    private static TrainingCommandResult ConcurrencyConflict() =>
        Conflict("concurrency_conflict", "Training data was changed by another request.");

    private sealed record CoverageLookup(bool Exists, TrainingCoverageDecision Decision);
}
