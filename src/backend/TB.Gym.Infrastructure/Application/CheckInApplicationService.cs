using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Authoring and assignment for check-in forms. Authoring is workspace content and is gated on the
/// coach role and tenant isolation alone; every operation that names a client resolves
/// <see cref="ICoachingFeatureAccessService"/> for <see cref="CoachingFeature.CheckIns"/> first, which
/// is where membership, platform block, relationship block, entitlement and payment are decided.
/// </summary>
internal sealed class CheckInApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    CheckInAccessResolver accessResolver)
    : ICheckInApplicationService
{
    public async Task<CheckInFormPage> ListFormsAsync(
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var query = dbContext.CheckInForms.AsNoTracking().OrderBy(form => form.Title).ThenBy(form => form.Id);
        var total = await query.LongCountAsync(cancellationToken);
        var forms = await query.Skip(skip).Take(take).ToArrayAsync(cancellationToken);
        var formIds = forms.Select(form => form.Id).ToArray();
        var versions = await dbContext.CheckInFormVersions
            .AsNoTracking()
            .Where(version => formIds.Contains(version.FormId))
            .Select(version => new VersionShape(
                version.Id,
                version.FormId,
                version.VersionNumber,
                version.Status))
            .ToArrayAsync(cancellationToken);
        return new CheckInFormPage(
            total,
            [.. forms.Select(form => ToSummary(form, versions))]);
    }

    public async Task<CheckInFormDetails?> GetFormAsync(Guid formId, CancellationToken cancellationToken)
    {
        var form = await dbContext.CheckInForms
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == formId, cancellationToken);
        return form is null ? null : await BuildDetailsAsync(form, cancellationToken);
    }

    public async Task<CheckInFormVersionView?> GetVersionAsync(
        Guid formId,
        Guid versionId,
        CancellationToken cancellationToken)
    {
        var version = await LoadVersionAsync(versionId, tracking: false, cancellationToken);
        if (version is null || version.FormId != formId)
        {
            return null;
        }

        var form = await dbContext.CheckInForms
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == formId, cancellationToken);
        return form is null ? null : ToVersionView(version, form);
    }

    public async Task<CheckInFormCommandResult> CreateFormAsync(
        CreateCheckInFormRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // `"questions": null` deserializes to a null list. Guarded explicitly, because reaching the
        // domain with it produces a null reference and a 500 for what is a malformed request.
        if (request.Questions is null)
        {
            return InvalidForm("questions", "A check-in form requires a list of questions.");
        }

        if (request.Questions.Any(question => question is null))
        {
            return InvalidForm("questions", "A question cannot be null.");
        }

        if (request.Questions.Any(question => question.QuestionKey is not null))
        {
            return InvalidForm(
                "questions",
                "A new form's questions receive their keys from the server and cannot supply them.");
        }

        try
        {
            var form = CheckInForm.Create(tenantContext.TenantId, request.Title, request.Description);
            var version = CheckInFormVersion.CreateDraft(
                form.TenantId,
                form.Id,
                form.StartNextVersion(),
                null,
                ToInputs(request.Questions));
            dbContext.CheckInForms.Add(form);
            dbContext.CheckInFormVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new CheckInFormCommandResult(
                CheckInCommandStatus.Success,
                await BuildDetailsAsync(form, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return InvalidForm("form", exception.Message);
        }
    }

    public async Task<CheckInFormCommandResult> RenameFormAsync(
        Guid formId,
        RenameCheckInFormRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var form = await dbContext.CheckInForms.SingleOrDefaultAsync(
            item => item.Id == formId,
            cancellationToken);
        if (form is null)
        {
            return new CheckInFormCommandResult(CheckInCommandStatus.NotFound);
        }

        try
        {
            dbContext.Entry(form).Property(item => item.Version).OriginalValue = request.Version;
            form.Rename(request.Title, request.Description);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new CheckInFormCommandResult(
                CheckInCommandStatus.Success,
                await BuildDetailsAsync(form, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return InvalidForm("title", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return ConflictForm("CheckInFormArchived", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return FormConcurrencyConflict();
        }
    }

    public Task<CheckInFormCommandResult> ArchiveFormAsync(
        Guid formId,
        CheckInConcurrencyRequest request,
        CancellationToken cancellationToken) =>
        SetArchivedAsync(formId, request, archived: true, cancellationToken);

    public Task<CheckInFormCommandResult> RestoreFormAsync(
        Guid formId,
        CheckInConcurrencyRequest request,
        CancellationToken cancellationToken) =>
        SetArchivedAsync(formId, request, archived: false, cancellationToken);

    public async Task<CheckInVersionCommandResult> SaveDraftAsync(
        Guid formId,
        Guid versionId,
        SaveCheckInDraftRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Questions is null || request.Questions.Any(question => question is null))
        {
            return InvalidVersion("questions", "A check-in draft requires a list of questions.");
        }

        var version = await LoadVersionAsync(versionId, tracking: true, cancellationToken);
        if (version is null || version.FormId != formId)
        {
            return new CheckInVersionCommandResult(CheckInCommandStatus.NotFound);
        }

        var form = await dbContext.CheckInForms.SingleOrDefaultAsync(
            item => item.Id == formId,
            cancellationToken);
        if (form is null)
        {
            return new CheckInVersionCommandResult(CheckInCommandStatus.NotFound);
        }

        // An archived lineage is closed to editing. The domain refuses renaming, deriving and
        // publishing on an archived form, but a draft's questions live on the version rather than
        // the form, so nothing on this path would have stopped a save. Refused here, server-side,
        // because Angular hiding the button is presentation and not the rule.
        if (form.IsArchived)
        {
            return ConflictVersion(
                "CheckInFormArchived",
                "An archived check-in form cannot be edited. Restore it first.");
        }

        if (version.Status != CheckInFormVersionStatus.Draft)
        {
            return ConflictVersion(
                "CheckInVersionPublished",
                "A published check-in form version is immutable. Derive a new draft version instead.");
        }

        // A supplied key has to already belong to this lineage. Otherwise a caller could invent keys
        // and silently break the alignment that comparison across versions depends on.
        var supplied = request.Questions
            .Select(question => question.QuestionKey)
            .Where(key => key is not null)
            .Select(key => key!.Trim().ToLowerInvariant())
            .ToArray();
        if (supplied.Length > 0)
        {
            var known = await dbContext.CheckInQuestions
                .AsNoTracking()
                .Where(question => dbContext.CheckInFormVersions
                    .Any(item => item.Id == question.FormVersionId && item.FormId == formId))
                .Select(question => question.QuestionKey)
                .Distinct()
                .ToArrayAsync(cancellationToken);
            if (supplied.Except(known, StringComparer.Ordinal).Any())
            {
                return InvalidVersion(
                    "questions",
                    "A question key must already belong to this form. Omit the key to add a new question.");
            }
        }

        try
        {
            // The version row is updated even though only its children changed, so two coaches editing
            // the same draft race on one xmin token and exactly one of them is told to reload. Only the
            // audit stamp is flagged: marking the whole entry modified would mark its key modified too,
            // and EF would then propagate that key onto every question and option as an update.
            dbContext.Entry(version).Property(item => item.Version).OriginalValue = request.Version;
            dbContext.Entry(version).Property(item => item.UpdatedAtUtc).IsModified = true;
            version.ReplaceQuestions(ToInputs(request.Questions));

            // The replacements carry application-generated keys, and change detection reads a set key
            // on a new child of an already-tracked parent as an existing row to update. Adding them
            // explicitly states what they are: inserts. The rows they replace are still orphaned by the
            // collection change and deleted with it.
            dbContext.CheckInQuestions.AddRange(version.Questions);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessVersion(await RequireVersionViewAsync(version.Id, form.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return InvalidVersion("questions", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return ConflictVersion("CheckInVersionPublished", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return VersionConcurrencyConflict();
        }
    }

    public async Task<CheckInVersionCommandResult> DeriveDraftAsync(
        Guid formId,
        DeriveCheckInDraftRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var form = await dbContext.CheckInForms.SingleOrDefaultAsync(
            item => item.Id == formId,
            cancellationToken);
        var source = await LoadVersionAsync(request.SourceVersionId, tracking: false, cancellationToken);
        if (form is null || source is null || source.FormId != formId)
        {
            return new CheckInVersionCommandResult(CheckInCommandStatus.NotFound);
        }

        if (source.Status != CheckInFormVersionStatus.Published)
        {
            return ConflictVersion(
                "CheckInVersionNotPublished",
                "Only a published version can be derived from. Edit the open draft instead.");
        }

        try
        {
            dbContext.Entry(form).Property(item => item.Version).OriginalValue = request.FormVersion;

            // Every question key is copied across unchanged, so a re-worded question stays the same
            // question for anything that later compares versions of this lineage.
            var draft = CheckInFormVersion.CreateDraft(
                form.TenantId,
                form.Id,
                form.StartNextVersion(),
                source.Id,
                source.ToCarryForwardInputs());
            dbContext.CheckInFormVersions.Add(draft);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessVersion(await RequireVersionViewAsync(draft.Id, form.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return InvalidVersion("version", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return ConflictVersion("CheckInFormArchived", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return VersionConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return ConflictVersion(
                "CheckInDraftAlreadyOpen",
                "This form already has an open draft version. Publish or edit that one.");
        }
    }

    public async Task<CheckInVersionCommandResult> PublishVersionAsync(
        Guid formId,
        Guid versionId,
        CheckInConcurrencyRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var version = await LoadVersionAsync(versionId, tracking: true, cancellationToken);
        if (version is null || version.FormId != formId)
        {
            return new CheckInVersionCommandResult(CheckInCommandStatus.NotFound);
        }

        var form = await dbContext.CheckInForms.SingleOrDefaultAsync(
            item => item.Id == formId,
            cancellationToken);
        if (form is null)
        {
            return new CheckInVersionCommandResult(CheckInCommandStatus.NotFound);
        }

        if (currentUser.UserId is not { } actorId)
        {
            return new CheckInVersionCommandResult(CheckInCommandStatus.Forbidden);
        }

        // Checked before anything is mutated, and with its own code. The domain refuses this too,
        // but only once `form.MarkPublished` runs — after `version.Publish` has already frozen the
        // version in memory — and it surfaced as "CheckInVersionPublished", which names the wrong
        // reason for a caller deciding what to do about it.
        if (form.IsArchived)
        {
            return ConflictVersion(
                "CheckInFormArchived",
                "An archived check-in form cannot be published. Restore it first.");
        }

        try
        {
            dbContext.Entry(version).Property(item => item.Version).OriginalValue = request.Version;
            var published = version.Publish(clock.UtcNow, actorId);
            form.MarkPublished();
            dbContext.CheckInLifecycleEvents.Add(published);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessVersion(await RequireVersionViewAsync(version.Id, form.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return InvalidVersion("version", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return ConflictVersion("CheckInVersionPublished", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return VersionConcurrencyConflict();
        }
    }

    public async Task<CheckInAssignmentCommandResult> AssignAsync(
        Guid clientProfileId,
        AssignCheckInRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var access = await ResolveClientAccessAsync(clientProfileId, cancellationToken);
        if (access.Status != CheckInCommandStatus.Success)
        {
            return new CheckInAssignmentCommandResult(access.Status, AccessReason: access.Reason);
        }

        var version = await LoadVersionAsync(request.FormVersionId, tracking: false, cancellationToken);
        if (version is null)
        {
            return new CheckInAssignmentCommandResult(CheckInCommandStatus.NotFound);
        }

        var form = await dbContext.CheckInForms
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == version.FormId, cancellationToken);
        if (form is null)
        {
            return new CheckInAssignmentCommandResult(CheckInCommandStatus.NotFound);
        }

        if (form.IsArchived)
        {
            return new CheckInAssignmentCommandResult(
                CheckInCommandStatus.Conflict,
                Code: "CheckInFormArchived",
                Message: "An archived check-in form cannot be assigned.");
        }

        if (currentUser.UserId is not { } actorId)
        {
            return new CheckInAssignmentCommandResult(CheckInCommandStatus.Forbidden);
        }

        var calendar = await WorkspaceCalendarReader.ReadAsync(
            dbContext,
            clock,
            tenantContext.TenantId,
            cancellationToken);
        try
        {
            var (assignment, created) = CheckInAssignment.Create(
                version,
                clientProfileId,
                request.DueDate,
                calendar.Today,
                clock.UtcNow,
                actorId);
            dbContext.CheckInAssignments.Add(assignment);
            dbContext.CheckInLifecycleEvents.Add(created);
            await dbContext.SaveChangesAsync(cancellationToken);
            var detail = await RequireAssignmentDetailAsync(assignment.Id, cancellationToken);
            return new CheckInAssignmentCommandResult(CheckInCommandStatus.Success, detail);
        }
        catch (ArgumentOutOfRangeException exception)
        {
            return new CheckInAssignmentCommandResult(
                CheckInCommandStatus.Invalid,
                Errors: new Dictionary<string, string[]> { ["dueDate"] = [exception.Message] });
        }
        catch (ArgumentException exception)
        {
            return new CheckInAssignmentCommandResult(
                CheckInCommandStatus.Invalid,
                Errors: new Dictionary<string, string[]> { ["assignment"] = [exception.Message] });
        }
        catch (InvalidOperationException exception)
        {
            return new CheckInAssignmentCommandResult(
                CheckInCommandStatus.Conflict,
                Code: "CheckInVersionNotPublished",
                Message: exception.Message);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return new CheckInAssignmentCommandResult(
                CheckInCommandStatus.Conflict,
                Code: "CheckInAlreadyAssigned",
                Message: "This client already has that check-in due on that date.");
        }
    }

    public async Task<CheckInAssignmentListResult> ListClientAssignmentsAsync(
        Guid clientProfileId,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var access = await ResolveClientAccessAsync(clientProfileId, cancellationToken);
        return access.Status != CheckInCommandStatus.Success
            ? new CheckInAssignmentListResult(access.Status, AccessReason: access.Reason)
            : new CheckInAssignmentListResult(
                CheckInCommandStatus.Success,
                await BuildListAsync(clientProfileId, skip, take, cancellationToken));
    }

    public async Task<CheckInAssignmentDetailResult> GetClientAssignmentAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var access = await ResolveClientAccessAsync(clientProfileId, cancellationToken);
        return access.Status != CheckInCommandStatus.Success
            ? new CheckInAssignmentDetailResult(access.Status, AccessReason: access.Reason)
            : await BuildDetailResultAsync(clientProfileId, assignmentId, cancellationToken);
    }

    public async Task<CheckInAssignmentListResult> ListOwnAssignmentsAsync(
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var access = await ResolveOwnAccessAsync(cancellationToken);
        return access.Status != CheckInCommandStatus.Success
            ? new CheckInAssignmentListResult(access.Status, AccessReason: access.Reason)
            : new CheckInAssignmentListResult(
                CheckInCommandStatus.Success,
                await BuildListAsync(access.ClientProfileId, skip, take, cancellationToken));
    }

    public async Task<CheckInAssignmentDetailResult> GetOwnAssignmentAsync(
        Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var access = await ResolveOwnAccessAsync(cancellationToken);
        return access.Status != CheckInCommandStatus.Success
            ? new CheckInAssignmentDetailResult(access.Status, AccessReason: access.Reason)
            : await BuildDetailResultAsync(access.ClientProfileId, assignmentId, cancellationToken);
    }

    private async Task<CheckInFormCommandResult> SetArchivedAsync(
        Guid formId,
        CheckInConcurrencyRequest request,
        bool archived,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var form = await dbContext.CheckInForms.SingleOrDefaultAsync(
            item => item.Id == formId,
            cancellationToken);
        if (form is null)
        {
            return new CheckInFormCommandResult(CheckInCommandStatus.NotFound);
        }

        try
        {
            dbContext.Entry(form).Property(item => item.Version).OriginalValue = request.Version;
            if (archived)
            {
                form.Archive();
            }
            else
            {
                form.Restore();
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return new CheckInFormCommandResult(
                CheckInCommandStatus.Success,
                await BuildDetailsAsync(form, cancellationToken));
        }
        catch (InvalidOperationException exception)
        {
            return ConflictForm("CheckInFormArchiveState", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return FormConcurrencyConflict();
        }
    }

    private Task<CheckInClientAccess> ResolveClientAccessAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        accessResolver.ForClientAsync(clientProfileId, cancellationToken);

    private Task<CheckInClientAccess> ResolveOwnAccessAsync(CancellationToken cancellationToken) =>
        accessResolver.ForCurrentClientAsync(cancellationToken);

    private async Task<CheckInAssignmentDetailResult> BuildDetailResultAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var assignment = await dbContext.CheckInAssignments
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == assignmentId && item.ClientProfileId == clientProfileId,
                cancellationToken);
        return assignment is null
            ? new CheckInAssignmentDetailResult(CheckInCommandStatus.NotFound)
            : new CheckInAssignmentDetailResult(
                CheckInCommandStatus.Success,
                await RequireAssignmentDetailAsync(assignment.Id, cancellationToken));
    }

    /// <summary>
    /// A bounded page of assignments, each already carrying the state of its response.
    /// </summary>
    /// <remarks>
    /// The response status is resolved here, in the same statement, because the alternative is what
    /// the coach screen used to do: list the assignments and then fetch every response in full just
    /// to decide which badge to draw. That is one request per assignment, it grows without limit
    /// with the client's history, and it made the coach read draft content they had no business
    /// seeing. The summary carries status and dates only; opening one response is still a separate
    /// request.
    /// </remarks>
    private async Task<CheckInAssignmentListView> BuildListAsync(
        Guid clientProfileId,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var owned = dbContext.CheckInAssignments
            .AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId);
        var total = await owned.LongCountAsync(cancellationToken);
        var rows = await owned
            .OrderByDescending(item => item.DueDate)
            .ThenByDescending(item => item.Id)
            .Skip(skip)
            .Take(take)
            .Join(
                dbContext.CheckInFormVersions.AsNoTracking(),
                item => item.FormVersionId,
                version => version.Id,
                (item, version) => new { Assignment = item, version.VersionNumber })
            .Join(
                dbContext.CheckInForms.AsNoTracking(),
                pair => pair.Assignment.FormId,
                form => form.Id,
                (pair, form) => new { pair.Assignment, pair.VersionNumber, form.Title })
            .Select(row => new AssignmentRow(
                new CheckInAssignmentView(
                    row.Assignment.Id,
                    row.Assignment.FormId,
                    row.Title,
                    row.Assignment.FormVersionId,
                    row.VersionNumber,
                    row.Assignment.ClientProfileId,
                    row.Assignment.DueDate,
                    row.Assignment.CreatedAtUtc,
                    row.Assignment.CreatedByUserId),
                dbContext.CheckInResponses
                    .Where(response => response.AssignmentId == row.Assignment.Id)
                    .Select(response => new ResponseStatusRow(
                        response.Id,
                        response.Status,
                        response.SubmittedDate,
                        response.SubmittedAtUtc,
                        response.ReviewedAtUtc))
                    .FirstOrDefault()))
            .ToArrayAsync(cancellationToken);

        return new CheckInAssignmentListView(
            clientProfileId,
            total,
            [.. rows.Select(row => new CheckInAssignmentListItem(
                row.Assignment,
                row.Response is null
                    ? null
                    : new CheckInAssignmentResponseSummary(
                        row.Response.Id,
                        row.Response.Status,
                        row.Response.SubmittedDate,
                        row.Response.SubmittedAtUtc,
                        row.Response.ReviewedAtUtc,
                        // Lateness is derived from the stored workspace-local submission date
                        // against the due date, never persisted, exactly as the detail view does.
                        row.Response.SubmittedDate is { } submitted &&
                        submitted > row.Assignment.DueDate)))]);
    }

    /// <summary>
    /// Resolves the exact version the assignment names, never the form's latest publication, so a
    /// later version cannot retroactively change what a client was asked.
    /// </summary>
    private async Task<CheckInAssignmentDetail> RequireAssignmentDetailAsync(
        Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var assignment = await dbContext.CheckInAssignments
            .AsNoTracking()
            .SingleAsync(item => item.Id == assignmentId, cancellationToken);
        var version = await LoadVersionAsync(assignment.FormVersionId, tracking: false, cancellationToken)
            ?? throw new InvalidOperationException("The assigned check-in version is missing.");
        var form = await dbContext.CheckInForms
            .AsNoTracking()
            .SingleAsync(item => item.Id == assignment.FormId, cancellationToken);
        return new CheckInAssignmentDetail(
            new CheckInAssignmentView(
                assignment.Id,
                assignment.FormId,
                form.Title,
                assignment.FormVersionId,
                version.VersionNumber,
                assignment.ClientProfileId,
                assignment.DueDate,
                assignment.CreatedAtUtc,
                assignment.CreatedByUserId),
            ToVersionView(version, form));
    }

    private async Task<CheckInFormVersion?> LoadVersionAsync(
        Guid versionId,
        bool tracking,
        CancellationToken cancellationToken)
    {
        var query = dbContext.CheckInFormVersions
            .Include(version => version.Questions)
            .ThenInclude(question => question.Options)
            .AsQueryable();
        if (!tracking)
        {
            query = query.AsNoTracking();
        }

        return await query.SingleOrDefaultAsync(version => version.Id == versionId, cancellationToken);
    }

    private async Task<CheckInFormVersionView> RequireVersionViewAsync(
        Guid versionId,
        Guid formId,
        CancellationToken cancellationToken)
    {
        var version = await LoadVersionAsync(versionId, tracking: false, cancellationToken)
            ?? throw new InvalidOperationException("The check-in form version is missing.");
        var form = await dbContext.CheckInForms
            .AsNoTracking()
            .SingleAsync(item => item.Id == formId, cancellationToken);
        return ToVersionView(version, form);
    }

    private async Task<CheckInFormDetails> BuildDetailsAsync(
        CheckInForm form,
        CancellationToken cancellationToken)
    {
        var versions = await dbContext.CheckInFormVersions
            .AsNoTracking()
            .Where(version => version.FormId == form.Id)
            .OrderBy(version => version.VersionNumber)
            .Select(version => new CheckInFormVersionSummary(
                version.Id,
                version.VersionNumber,
                version.Status,
                version.DerivedFromVersionId,
                version.PublishedAtUtc,
                version.PublishedByUserId,
                version.Questions.Count,
                version.Version))
            .ToArrayAsync(cancellationToken);
        var shapes = versions
            .Select(version => new VersionShape(version.Id, form.Id, version.VersionNumber, version.Status))
            .ToArray();
        return new CheckInFormDetails(ToSummary(form, shapes), versions);
    }

    private static CheckInFormSummary ToSummary(CheckInForm form, IReadOnlyList<VersionShape> versions)
    {
        var owned = versions.Where(version => version.FormId == form.Id).ToArray();
        var latestPublished = owned
            .Where(version => version.Status == CheckInFormVersionStatus.Published)
            .OrderByDescending(version => version.VersionNumber)
            .FirstOrDefault();
        var draft = owned.SingleOrDefault(version => version.Status == CheckInFormVersionStatus.Draft);
        return new CheckInFormSummary(
            form.Id,
            form.Title,
            form.Description,
            form.Status,
            form.IsArchived,
            form.CurrentVersionNumber,
            draft?.Id,
            latestPublished?.Id,
            latestPublished?.VersionNumber,
            form.Version);
    }

    private static CheckInFormVersionView ToVersionView(CheckInFormVersion version, CheckInForm form) =>
        new(
            version.Id,
            version.FormId,
            form.Title,
            form.Description,
            version.VersionNumber,
            version.Status,
            version.DerivedFromVersionId,
            version.PublishedAtUtc,
            version.PublishedByUserId,
            [.. version.Questions.OrderBy(question => question.Order).Select(question => new CheckInQuestionView(
                question.Id,
                question.QuestionKey,
                question.Order,
                question.QuestionType,
                question.Prompt,
                question.HelpText,
                question.IsRequired,
                question.ScaleMinimum,
                question.ScaleMaximum,
                question.ScaleStep,
                [.. question.Options.OrderBy(option => option.Order).Select(option =>
                    new CheckInQuestionOptionView(option.Id, option.Order, option.Label))]))],
            version.Version);

    private static IReadOnlyList<CheckInQuestionInput> ToInputs(
        IReadOnlyList<CheckInQuestionRequest> questions)
    {
        ArgumentNullException.ThrowIfNull(questions);
        return [.. questions.Select(question => new CheckInQuestionInput(
            question.QuestionKey,
            question.QuestionType,
            question.Prompt,
            question.HelpText,
            question.IsRequired,
            question.ScaleMinimum,
            question.ScaleMaximum,
            question.ScaleStep,
            question.Options ?? []))];
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static CheckInVersionCommandResult SuccessVersion(CheckInFormVersionView view) =>
        new(CheckInCommandStatus.Success, view);

    private static CheckInFormCommandResult InvalidForm(string field, string message) =>
        new(
            CheckInCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static CheckInVersionCommandResult InvalidVersion(string field, string message) =>
        new(
            CheckInCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static CheckInFormCommandResult ConflictForm(string code, string message) =>
        new(CheckInCommandStatus.Conflict, Code: code, Message: message);

    private static CheckInVersionCommandResult ConflictVersion(string code, string message) =>
        new(CheckInCommandStatus.Conflict, Code: code, Message: message);

    private static CheckInFormCommandResult FormConcurrencyConflict() =>
        ConflictForm("concurrency_conflict", "The check-in form was changed by another request.");

    private static CheckInVersionCommandResult VersionConcurrencyConflict() =>
        ConflictVersion("concurrency_conflict", "The check-in draft was changed by another request.");

    private sealed record VersionShape(
        Guid Id,
        Guid FormId,
        int VersionNumber,
        CheckInFormVersionStatus Status);

    private sealed record ResponseStatusRow(
        Guid Id,
        CheckInResponseStatus Status,
        DateOnly? SubmittedDate,
        DateTimeOffset? SubmittedAtUtc,
        DateTimeOffset? ReviewedAtUtc);

    private sealed record AssignmentRow(
        CheckInAssignmentView Assignment,
        ResponseStatusRow? Response);
}
