using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A coach's working copies of programs (TRN-024): read and written by their owner only, kept as the
/// builder sends them, and checked in full only when published.
/// </summary>
/// <remarks>
/// Every read and write is narrowed to the signed-in caller inside the active workspace, so another
/// person's draft, in this workspace or another, is simply not found. Program text stays out of logs
/// and exception messages.
/// </remarks>
internal sealed partial class TrainingApplicationService
{
    private const long ProgramDraftLockNamespace = 0x7d2a_f3c1;

    public async Task<IReadOnlyList<ProgramDraftSummary>> ListProgramDraftsAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return [];
        }

        // The content can run to hundreds of kilobytes, so the list reads only what it shows.
        return await dbContext.ProgramDrafts.AsNoTracking()
            .Where(draft => draft.OwnerUserId == userId)
            .OrderByDescending(draft => draft.UpdatedAtUtc)
            .ThenBy(draft => draft.Id)
            .Select(draft => new ProgramDraftSummary(
                draft.Id,
                draft.TemplateId,
                draft.Name,
                draft.WeekCount,
                draft.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public async Task<ProgramDraftView?> GetProgramDraftAsync(Guid draftId, CancellationToken cancellationToken)
    {
        if (await FindOwnDraftAsync(draftId, tracked: false, cancellationToken) is not { } draft)
        {
            return null;
        }

        var content = ProgramDraftShape.Read(draft.ContentJson);
        var exerciseIds = content.Weeks
            .SelectMany(week => week.Sessions)
            .SelectMany(session => session.Exercises)
            .SelectMany(exercise => exercise.ApprovedAlternativeExerciseIds.Prepend(exercise.ExerciseId))
            .Distinct()
            .ToArray();
        // Names come from this workspace's library; an id from anywhere else names nothing.
        var exercises = await dbContext.Exercises.AsNoTracking()
            .Where(exercise => exerciseIds.Contains(exercise.Id))
            .Select(exercise => new ProgramDraftExerciseView(exercise.Id, exercise.Name, exercise.IsArchived))
            .ToListAsync(cancellationToken);
        return new ProgramDraftView(
            draft.Id,
            draft.TemplateId,
            draft.SourceVersionId,
            draft.StartedAtVersionNumber,
            draft.UpdatedAtUtc,
            draft.Version,
            content,
            exercises);
    }

    public async Task<TrainingCommandResult> CreateProgramDraftAsync(
        CreateProgramDraftRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return NotFound();
        }

        if (!ProgramDraftShape.TryCreate(request?.Content, out var shape, out var field, out var problem))
        {
            return Invalid(field, problem);
        }

        return request!.TemplateId is { } templateId
            ? await CreateDraftOfProgramAsync(userId, templateId, request, shape, cancellationToken)
            : request.SourceVersionId is not null || request.TemplateVersionNumber is not null
                ? Invalid("templateId", "A new program has no versions to start from.")
                : await CreateDraftOfNewProgramAsync(userId, shape, cancellationToken);
    }

    public async Task<TrainingCommandResult> SaveProgramDraftAsync(
        Guid draftId,
        SaveProgramDraftRequest request,
        CancellationToken cancellationToken)
    {
        // Found before the content is read, so a stranger's identifier answers the same whatever it
        // is sent with.
        if (await FindOwnDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        if (!ProgramDraftShape.TryCreate(request?.Content, out var shape, out var field, out var problem))
        {
            return Invalid(field, problem);
        }

        dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request!.Version;
        draft.Replace(shape);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleDraft();
        }

        return DraftSaved(draft);
    }

    public async Task<TrainingCommandResult> DiscardProgramDraftAsync(
        Guid draftId,
        DiscardProgramDraftRequest request,
        CancellationToken cancellationToken)
    {
        if (await FindOwnDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        // Unpublished changes, not a record: removing them leaves nothing behind. The version still
        // guards against discarding changes another tab has just made.
        dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request?.Version ?? 0;
        dbContext.ProgramDrafts.Remove(draft);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleDraft();
        }

        return new TrainingCommandResult(TrainingCommandStatus.Success);
    }

    public async Task<TrainingCommandResult> PublishProgramDraftAsync(
        Guid draftId,
        PublishProgramDraftRequest request,
        CancellationToken cancellationToken)
    {
        if (await FindOwnDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        if (request is null || draft.Version != request.Version)
        {
            return StaleDraft();
        }

        ProgramTemplate? existing = null;
        if (draft.TemplateId is { } templateId)
        {
            existing = await dbContext.ProgramTemplates.SingleOrDefaultAsync(item => item.Id == templateId, cancellationToken);
            if (existing is null)
            {
                return NotFound();
            }

            if (existing.IsArchived)
            {
                return Invalid("program", "This program is archived, so it cannot be published again.");
            }

            if (draft.IsBehind(existing.CurrentVersionNumber) && !request.ReplaceNewer)
            {
                return NewerVersionPublished(existing.CurrentVersionNumber);
            }
        }

        var content = ProgramDraftShape.Read(draft.ContentJson);
        try
        {
            // The same checks as any save: every rule of the program, and every exercise active here.
            var blueprint = await BuildProgramBlueprintAsync(
                new SaveProgramTemplateRequest(content.Name, content.Description, true, null, content.Weeks),
                cancellationToken);
            var template = existing ?? ProgramTemplate.Create(tenantContext.TenantId, content.Name);
            if (existing is null)
            {
                dbContext.ProgramTemplates.Add(template);
            }

            var number = template.CreateNextVersion(content.Name);
            var version = ProgramTemplateVersion.Create(
                tenantContext.TenantId,
                template.Id,
                number,
                blueprint,
                publish: true,
                clock.UtcNow);
            dbContext.ProgramTemplateVersions.Add(version);
            dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request.Version;
            dbContext.ProgramDrafts.Remove(draft);
            // One save, one transaction: the version lands and the draft goes, or neither.
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessTemplate(ToView(version));
        }
        catch (ArgumentException exception)
        {
            return Invalid("program", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException exception)
        {
            // The draft changed in another tab, or someone published this program in the same moment.
            return exception.Entries.Any(entry => entry.Entity is ProgramDraft)
                ? StaleDraft()
                : NewerVersionPublished(null);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return NewerVersionPublished(null);
        }
    }

    private async Task<TrainingCommandResult> CreateDraftOfProgramAsync(
        Guid userId,
        Guid templateId,
        CreateProgramDraftRequest request,
        ProgramDraftShape shape,
        CancellationToken cancellationToken)
    {
        var template = await dbContext.ProgramTemplates.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == templateId, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        if (template.IsArchived)
        {
            return Invalid("templateId", "This program is archived, so it cannot be changed.");
        }

        if (request.SourceVersionId is not { } sourceVersionId ||
            !await dbContext.ProgramTemplateVersions.AsNoTracking().AnyAsync(
                version => version.Id == sourceVersionId && version.TemplateId == templateId,
                cancellationToken))
        {
            return Invalid("sourceVersionId", "Open one of this program's versions first.");
        }

        if (request.TemplateVersionNumber is not { } seen || seen < 1 || seen > template.CurrentVersionNumber)
        {
            return Invalid("templateVersionNumber", "The program's newest version number, as read, is required.");
        }

        var draft = ProgramDraft.ForProgram(tenantContext.TenantId, userId, templateId, sourceVersionId, seen, shape);
        dbContext.ProgramDrafts.Add(draft);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsOneDraftPerProgramViolation(exception))
        {
            return Conflict(
                ProgramDraftConflictCodes.AlreadyExists,
                "Changes to this program are already open in another tab or device. Reload to continue them.");
        }

        return DraftSaved(draft);
    }

    private Task<TrainingCommandResult> CreateDraftOfNewProgramAsync(
        Guid userId,
        ProgramDraftShape shape,
        CancellationToken cancellationToken) =>
        dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // One start at a time per person, so two quick starts cannot both slip under the limit.
            await dbContext.Database.ExecuteSqlAsync(
                $"SELECT pg_advisory_xact_lock({ProgramDraftLockKey(tenantContext.TenantId, userId)}) /* program-drafts */",
                cancellationToken);
            var kept = await dbContext.ProgramDrafts.CountAsync(
                draft => draft.OwnerUserId == userId && draft.TemplateId == null,
                cancellationToken);
            if (kept >= ProgramDraft.MaximumNewProgramsPerOwner)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Conflict(
                    ProgramDraftConflictCodes.LimitReached,
                    $"You can keep up to {ProgramDraft.MaximumNewProgramsPerOwner} new programs that are not published. Publish or discard one to start another.");
            }

            var draft = ProgramDraft.ForNewProgram(tenantContext.TenantId, userId, shape);
            dbContext.ProgramDrafts.Add(draft);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return DraftSaved(draft);
        });

    private async Task<ProgramDraft?> FindOwnDraftAsync(Guid draftId, bool tracked, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return null;
        }

        var drafts = tracked ? dbContext.ProgramDrafts : dbContext.ProgramDrafts.AsNoTracking();
        return await drafts.SingleOrDefaultAsync(
            draft => draft.Id == draftId && draft.OwnerUserId == userId,
            cancellationToken);
    }

    /// <summary>The caller's own drafts of these programs, by program, for the program summaries.</summary>
    private async Task<Dictionary<Guid, ProgramDraftSummary>> OwnDraftsByProgramAsync(
        Guid[] templateIds,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant || templateIds.Length == 0)
        {
            return [];
        }

        var drafts = await dbContext.ProgramDrafts.AsNoTracking()
            .Where(draft => draft.OwnerUserId == userId &&
                            draft.TemplateId != null &&
                            templateIds.Contains(draft.TemplateId.Value))
            .Select(draft => new ProgramDraftSummary(
                draft.Id,
                draft.TemplateId,
                draft.Name,
                draft.WeekCount,
                draft.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
        return drafts.ToDictionary(draft => draft.TemplateId!.Value);
    }

    private static TrainingCommandResult DraftSaved(ProgramDraft draft) =>
        new(TrainingCommandStatus.Success, Draft: new ProgramDraftSaveView(draft.Id, draft.UpdatedAtUtc, draft.Version));

    private static TrainingCommandResult StaleDraft() =>
        Conflict(
            ProgramDraftConflictCodes.Stale,
            "These changes were changed or published in another tab or device. Reload to continue with the latest.");

    private static TrainingCommandResult NewerVersionPublished(int? newest) =>
        Conflict(
            ProgramDraftConflictCodes.NewerVersionPublished,
            newest is { } number
                ? $"Version {number} of this program was published after you started these changes."
                : "A newer version of this program was published after you started these changes.");

    private static bool IsOneDraftPerProgramViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: DatabaseConstraintNames.OneProgramDraftPerPersonAndProgram,
        };

    private static long ProgramDraftLockKey(Guid tenantId, Guid userId) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 8)
        ^ ProgramDraftLockNamespace;
}
