using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Answering, submitting, reviewing and comparing check-ins. Every route here names a client, so every
/// one of them resolves <see cref="CoachingFeature.CheckIns"/> through the shared access service before
/// it reads or writes anything; the coach routes inherit relationship blocking from the same decision.
/// </summary>
internal sealed class CheckInResponseApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    CheckInAccessResolver accessResolver)
    : ICheckInResponseApplicationService
{
    public async Task<CheckInResponseCommandResult> GetOwnResponseAsync(
        Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var access = await accessResolver.ForCurrentClientAsync(cancellationToken);
        return access.Status != CheckInCommandStatus.Success
            ? Denied(access)
            : await ReadAsync(
                access.ClientProfileId,
                assignmentId,
                CheckInAudience.OwningClient,
                cancellationToken);
    }

    /// <summary>
    /// The coach's read of one client's response. An unsubmitted draft comes back as a draft with no
    /// answers: until the client submits, what they have typed is theirs.
    /// </summary>
    public async Task<CheckInResponseCommandResult> GetClientResponseAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CancellationToken cancellationToken)
    {
        var access = await accessResolver.ForClientAsync(clientProfileId, cancellationToken);
        return access.Status != CheckInCommandStatus.Success
            ? Denied(access)
            : await ReadAsync(
                access.ClientProfileId,
                assignmentId,
                CheckInAudience.Coach,
                cancellationToken);
    }

    public async Task<CheckInResponseCommandResult> SaveOwnDraftAsync(
        Guid assignmentId,
        SaveCheckInResponseRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var access = await accessResolver.ForCurrentClientAsync(cancellationToken);
        if (access.Status != CheckInCommandStatus.Success)
        {
            return Denied(access);
        }

        var context = await LoadAsync(access.ClientProfileId, assignmentId, tracking: true, cancellationToken);
        if (context is null)
        {
            return new CheckInResponseCommandResult(CheckInCommandStatus.NotFound);
        }

        var response = context.Response;
        if (response is not null && response.Status != CheckInResponseStatus.Draft)
        {
            return Conflict(
                "CheckInResponseSubmitted",
                "This check-in has been submitted and can no longer be edited.");
        }

        try
        {
            if (response is null)
            {
                response = CheckInResponse.StartDraft(context.Assignment);
                dbContext.CheckInResponses.Add(response);
            }
            else
            {
                if (request.Version is not { } token)
                {
                    return Conflict(
                        "concurrency_conflict",
                        "This check-in already has a draft. Reload it before saving.");
                }

                dbContext.Entry(response).Property(item => item.Version).OriginalValue = token;
                dbContext.Entry(response).Property(item => item.UpdatedAtUtc).IsModified = true;
            }

            response.ReplaceAnswers(ToInputs(request.Answers), context.Version.Questions);

            // The replacements carry application-generated keys, and change detection reads a new child
            // of an already-tracked parent with a set key as an existing row to update. Adding them
            // explicitly states that they are inserts; the rows they replace are orphaned by the
            // collection change and deleted with it.
            dbContext.CheckInAnswers.AddRange(response.Answers);
            dbContext.CheckInAnswerChoices.AddRange(response.Answers.SelectMany(answer => answer.Choices));
            await dbContext.SaveChangesAsync(cancellationToken);
            return await SuccessAsync(
                access.ClientProfileId,
                assignmentId,
                CheckInAudience.OwningClient,
                cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return Invalid("answers", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("CheckInResponseSubmitted", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The check-in draft was changed by another request.");
        }
        catch (DbUpdateException exception) when (IsConstraintViolation(
            exception,
            DatabaseConstraintNames.OneCheckInResponsePerAssignment))
        {
            // Two first saves at once. Both read no response and both tried to start one; the unique
            // index on (TenantId, AssignmentId) settles it, so exactly one draft exists and the
            // loser is told to reload rather than being handed a 500. Only that violation is caught:
            // any other DbUpdateException is a real fault and stays one.
            return Conflict(
                "CheckInResponseAlreadyStarted",
                "This check-in already has a draft. Reload it before saving.");
        }
    }

    public async Task<CheckInResponseCommandResult> SubmitOwnResponseAsync(
        Guid assignmentId,
        CheckInResponseConcurrencyRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var access = await accessResolver.ForCurrentClientAsync(cancellationToken);
        if (access.Status != CheckInCommandStatus.Success)
        {
            return Denied(access);
        }

        var context = await LoadAsync(access.ClientProfileId, assignmentId, tracking: true, cancellationToken);
        if (context is null)
        {
            return new CheckInResponseCommandResult(CheckInCommandStatus.NotFound);
        }

        if (context.Response is not { } response)
        {
            return Conflict(
                "CheckInResponseNotStarted",
                "There is nothing to submit yet. Save your answers first.");
        }

        if (currentUser.UserId is not { } actorId)
        {
            return new CheckInResponseCommandResult(CheckInCommandStatus.Forbidden);
        }

        var calendar = await WorkspaceCalendarReader.ReadAsync(
            dbContext,
            clock,
            tenantContext.TenantId,
            cancellationToken);
        try
        {
            dbContext.Entry(response).Property(item => item.Version).OriginalValue = request.Version;
            var result = response.Submit(
                context.Version.Questions,
                clock.UtcNow,
                calendar.Today,
                actorId);
            if (!result.IsAccepted)
            {
                // Nothing was written: the draft stays exactly as it was and every reason is reported
                // together, so the client fixes the whole form in one pass.
                return new CheckInResponseCommandResult(
                    CheckInCommandStatus.Invalid,
                    Failures: result.Failures);
            }

            dbContext.CheckInResponseEvents.Add(result.Event!);
            await dbContext.SaveChangesAsync(cancellationToken);
            return await SuccessAsync(
                access.ClientProfileId,
                assignmentId,
                CheckInAudience.OwningClient,
                cancellationToken);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("CheckInAlreadySubmitted", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The check-in was changed by another request.");
        }
        catch (DbUpdateException exception) when (IsConstraintViolation(
            exception,
            DatabaseConstraintNames.OneCheckInResponseEventPerType))
        {
            return Conflict("CheckInAlreadySubmitted", "This check-in has already been submitted.");
        }
    }

    public async Task<CheckInResponseCommandResult> ReviewAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CheckInResponseConcurrencyRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var access = await accessResolver.ForClientAsync(clientProfileId, cancellationToken);
        if (access.Status != CheckInCommandStatus.Success)
        {
            return Denied(access);
        }

        var context = await LoadAsync(access.ClientProfileId, assignmentId, tracking: true, cancellationToken);
        if (context is null)
        {
            return new CheckInResponseCommandResult(CheckInCommandStatus.NotFound);
        }

        if (context.Response is not { } response || response.Status == CheckInResponseStatus.Draft)
        {
            return Conflict(
                "CheckInResponseNotSubmitted",
                "This check-in has not been submitted yet.");
        }

        if (currentUser.UserId is not { } actorId)
        {
            return new CheckInResponseCommandResult(CheckInCommandStatus.Forbidden);
        }

        try
        {
            dbContext.Entry(response).Property(item => item.Version).OriginalValue = request.Version;

            // Review changes the response's state and records who did it. It never touches an answer.
            dbContext.CheckInResponseEvents.Add(response.Review(clock.UtcNow, actorId));
            await dbContext.SaveChangesAsync(cancellationToken);
            return await SuccessAsync(
                access.ClientProfileId,
                assignmentId,
                CheckInAudience.Coach,
                cancellationToken);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("CheckInAlreadyReviewed", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The check-in was changed by another request.");
        }
        catch (DbUpdateException exception) when (IsConstraintViolation(
            exception,
            DatabaseConstraintNames.OneCheckInResponseEventPerType))
        {
            return Conflict("CheckInAlreadyReviewed", "This check-in has already been reviewed.");
        }
    }

    /// <summary>
    /// A read-side projection over two responses. Nothing is stored and nothing is derived from the
    /// answers: the two sets are aligned by question key and placed side by side, each side carrying
    /// its own version's wording.
    /// </summary>
    public async Task<CheckInComparisonResult> CompareAsync(
        Guid clientProfileId,
        Guid firstResponseId,
        Guid secondResponseId,
        CancellationToken cancellationToken)
    {
        var access = await accessResolver.ForClientAsync(clientProfileId, cancellationToken);
        if (access.Status != CheckInCommandStatus.Success)
        {
            return new CheckInComparisonResult(access.Status, AccessReason: access.Reason);
        }

        if (firstResponseId == secondResponseId)
        {
            return new CheckInComparisonResult(
                CheckInCommandStatus.Conflict,
                Code: "CheckInComparisonSameResponse",
                Message: "A check-in cannot be compared with itself.");
        }

        var first = await LoadForComparisonAsync(access.ClientProfileId, firstResponseId, cancellationToken);
        var second = await LoadForComparisonAsync(access.ClientProfileId, secondResponseId, cancellationToken);
        if (first is null || second is null)
        {
            return new CheckInComparisonResult(CheckInCommandStatus.NotFound);
        }

        if (first.Response!.Status == CheckInResponseStatus.Draft ||
            second.Response!.Status == CheckInResponseStatus.Draft)
        {
            return new CheckInComparisonResult(
                CheckInCommandStatus.Conflict,
                Code: "CheckInResponseNotSubmitted",
                Message: "Only submitted check-ins can be compared.");
        }

        if (first.Assignment.FormId != second.Assignment.FormId)
        {
            return new CheckInComparisonResult(
                CheckInCommandStatus.Conflict,
                Code: "CheckInComparisonAcrossLineages",
                Message: "Two check-ins can only be compared within the same form.");
        }

        return new CheckInComparisonResult(
            CheckInCommandStatus.Success,
            new CheckInComparisonView(
                access.ClientProfileId,
                first.Assignment.FormId,
                first.Form.Title,
                Side(first),
                Side(second),
                BuildRows(first, second)));
    }

    /// <summary>
    /// Aligns the two versions by question key. A question the other version does not have keeps its
    /// side's content and is reported as one-sided, never dropped and never shown as an empty answer on
    /// a side that was never asked it.
    /// </summary>
    private static List<CheckInComparisonRow> BuildRows(
        ResponseContext first,
        ResponseContext second)
    {
        var firstQuestions = first.Version.Questions.OrderBy(question => question.Order).ToArray();
        var secondQuestions = second.Version.Questions.OrderBy(question => question.Order).ToArray();
        var secondByKey = secondQuestions.ToDictionary(
            question => question.QuestionKey,
            StringComparer.Ordinal);
        var firstByKey = firstQuestions.ToDictionary(
            question => question.QuestionKey,
            StringComparer.Ordinal);

        var rows = new List<CheckInComparisonRow>(firstQuestions.Length + secondQuestions.Length);
        foreach (var question in firstQuestions)
        {
            var counterpart = secondByKey.GetValueOrDefault(question.QuestionKey);
            rows.Add(new CheckInComparisonRow(
                question.QuestionKey,
                counterpart is null
                    ? CheckInComparisonPresence.OnlyInFirst
                    : CheckInComparisonPresence.InBoth,
                Cell(question, first),
                counterpart is null ? null : Cell(counterpart, second)));
        }

        // Questions added in the later version follow, in that version's own order.
        foreach (var question in secondQuestions.Where(item => !firstByKey.ContainsKey(item.QuestionKey)))
        {
            rows.Add(new CheckInComparisonRow(
                question.QuestionKey,
                CheckInComparisonPresence.OnlyInSecond,
                null,
                Cell(question, second)));
        }

        return rows;
    }

    private static CheckInComparisonCell Cell(CheckInQuestion question, ResponseContext context)
    {
        var answer = context.Response!.Answers.SingleOrDefault(item => item.QuestionId == question.Id);
        return new CheckInComparisonCell(
            question.Id,
            question.Order,
            question.QuestionType,
            question.Prompt,
            question.IsRequired,
            answer is null ? null : CheckInViewFactory.Answer(answer, question));
    }

    private static CheckInComparisonSideView Side(ResponseContext context) =>
        new(
            context.Response!.Id,
            context.Assignment.Id,
            context.Assignment.FormVersionId,
            context.Version.VersionNumber,
            context.Response.Status,
            context.Assignment.DueDate,
            context.Response.SubmittedDate,
            context.Response.SubmittedAtUtc,
            context.Response.IsLate(context.Assignment.DueDate));

    private async Task<ResponseContext?> LoadForComparisonAsync(
        Guid clientProfileId,
        Guid responseId,
        CancellationToken cancellationToken)
    {
        var assignmentId = await dbContext.CheckInResponses
            .AsNoTracking()
            .Where(response => response.Id == responseId && response.ClientProfileId == clientProfileId)
            .Select(response => (Guid?)response.AssignmentId)
            .SingleOrDefaultAsync(cancellationToken);
        if (assignmentId is not { } resolved)
        {
            return null;
        }

        var context = await LoadAsync(clientProfileId, resolved, tracking: false, cancellationToken);
        return context?.Response is null ? null : context;
    }

    private async Task<CheckInResponseCommandResult> ReadAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CheckInAudience audience,
        CancellationToken cancellationToken)
    {
        var context = await LoadAsync(clientProfileId, assignmentId, tracking: false, cancellationToken);
        return context is null
            ? new CheckInResponseCommandResult(CheckInCommandStatus.NotFound)
            : new CheckInResponseCommandResult(CheckInCommandStatus.Success, ToDetail(context, audience));
    }

    private async Task<CheckInResponseCommandResult> SuccessAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CheckInAudience audience,
        CancellationToken cancellationToken)
    {
        // Re-read without tracking so the returned view reflects committed state, including the
        // database-generated concurrency token the caller needs for its next write.
        dbContext.ChangeTracker.Clear();
        return await ReadAsync(clientProfileId, assignmentId, audience, cancellationToken);
    }

    /// <summary>
    /// Loads the assignment, the exact version it named and the response so far. The version is always
    /// resolved from the assignment, never from the form's latest publication, which is what makes a
    /// submission render its original wording after a later version is published.
    /// </summary>
    private async Task<ResponseContext?> LoadAsync(
        Guid clientProfileId,
        Guid assignmentId,
        bool tracking,
        CancellationToken cancellationToken)
    {
        var assignment = await Track(dbContext.CheckInAssignments, tracking)
            .SingleOrDefaultAsync(
                item => item.Id == assignmentId && item.ClientProfileId == clientProfileId,
                cancellationToken);
        if (assignment is null)
        {
            return null;
        }

        var version = await Track(dbContext.CheckInFormVersions, tracking)
            .Include(item => item.Questions)
            .ThenInclude(question => question.Options)
            .SingleOrDefaultAsync(item => item.Id == assignment.FormVersionId, cancellationToken);
        var form = await dbContext.CheckInForms
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == assignment.FormId, cancellationToken);
        if (version is null || form is null)
        {
            return null;
        }

        var response = await Track(dbContext.CheckInResponses, tracking)
            .Include(item => item.Answers)
            .ThenInclude(answer => answer.Choices)
            .SingleOrDefaultAsync(item => item.AssignmentId == assignmentId, cancellationToken);
        return new ResponseContext(assignment, version, form, response);
    }

    private static IQueryable<TEntity> Track<TEntity>(DbSet<TEntity> set, bool tracking)
        where TEntity : class =>
        tracking ? set : set.AsNoTracking();

    /// <summary>
    /// Builds the response view for one audience. The redaction lives here, in the mapping the API
    /// contract is built from, rather than in the caller or in Angular: every route that returns a
    /// response detail passes through this method, so a draft cannot leak by someone adding a route
    /// and forgetting a rule.
    /// </summary>
    private static CheckInResponseDetail ToDetail(ResponseContext context, CheckInAudience audience)
    {
        var questions = context.Version.Questions.ToDictionary(question => question.Id);
        var withholdAnswers =
            audience == CheckInAudience.Coach &&
            context.Response?.Status == CheckInResponseStatus.Draft;
        return new CheckInResponseDetail(
            CheckInViewFactory.Assignment(context.Assignment, context.Form, context.Version.VersionNumber),
            CheckInViewFactory.Version(context.Version, context.Form),
            context.Response is null
                ? null
                : CheckInViewFactory.Response(
                    context.Response,
                    context.Assignment.DueDate,
                    questions,
                    withholdAnswers));
    }

    /// <summary>
    /// Who a response is being rendered for. A draft's answers are the client's until they submit,
    /// so the two audiences see different things and the difference is decided in one place.
    /// </summary>
    private enum CheckInAudience
    {
        OwningClient = 1,
        Coach = 2,
    }

    private static IReadOnlyList<CheckInAnswerInput> ToInputs(IReadOnlyList<CheckInAnswerRequest> answers)
    {
        ArgumentNullException.ThrowIfNull(answers);
        return [.. answers.Select(answer => new CheckInAnswerInput(
            answer.QuestionId,
            answer.TextValue,
            answer.NumericValue,
            answer.SelectedOptionIds ?? []))];
    }

    /// <summary>
    /// The unique index on (response, event type) is what actually settles a concurrent submit or
    /// review: both racers pass the in-memory state check, and exactly one of them commits.
    /// </summary>
    internal static bool IsConstraintViolation(DbUpdateException exception, string constraintName) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: var actualConstraint,
        } && string.Equals(actualConstraint, constraintName, StringComparison.Ordinal);

    private static CheckInResponseCommandResult Denied(CheckInClientAccess access) =>
        new(access.Status, AccessReason: access.Reason);

    private static CheckInResponseCommandResult Conflict(string code, string message) =>
        new(CheckInCommandStatus.Conflict, Code: code, Message: message);

    private static CheckInResponseCommandResult Invalid(string field, string message) =>
        new(
            CheckInCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private sealed record ResponseContext(
        CheckInAssignment Assignment,
        CheckInFormVersion Version,
        CheckInForm Form,
        CheckInResponse? Response);
}
