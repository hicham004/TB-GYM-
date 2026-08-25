using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed record CheckInClientAccess(
    CheckInCommandStatus Status,
    Guid ClientProfileId,
    FeatureAccessReason? Reason);

/// <summary>
/// The single place a check-in route decides whether a client subject may be reached. Both the
/// authoring service and the response service resolve access through here, so there is one
/// implementation of the rule rather than two that can drift apart.
/// </summary>
internal sealed class CheckInAccessResolver(
    GymDbContext dbContext,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService)
{
    /// <summary>
    /// A coach-facing client subject. An unknown or foreign-workspace client is indistinguishable from
    /// any other missing row, and everything else — inactive membership, platform block, relationship
    /// block, missing entitlement, unpaid enrollment — is one decision from the shared access service.
    /// </summary>
    public async Task<CheckInClientAccess> ForClientAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var exists = await dbContext.ClientProfiles
            .AsNoTracking()
            .AnyAsync(client => client.Id == clientProfileId, cancellationToken);
        return exists
            ? await DecideAsync(clientProfileId, cancellationToken)
            : new CheckInClientAccess(CheckInCommandStatus.NotFound, Guid.Empty, null);
    }

    /// <summary>
    /// The caller's own client profile in this workspace. A client whose entitlement has lapsed is
    /// refused here as well, which is what closes their own past submissions to them: the questions
    /// were already unreachable, and answers without their questions are not a readable record.
    /// </summary>
    public async Task<CheckInClientAccess> ForCurrentClientAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return new CheckInClientAccess(CheckInCommandStatus.NotFound, Guid.Empty, null);
        }

        var clientProfileId = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.UserId == userId)
            .Select(client => (Guid?)client.Id)
            .SingleOrDefaultAsync(cancellationToken);
        return clientProfileId is { } resolved
            ? await DecideAsync(resolved, cancellationToken)
            : new CheckInClientAccess(CheckInCommandStatus.NotFound, Guid.Empty, null);
    }

    private async Task<CheckInClientAccess> DecideAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var decision = await featureAccessService.EvaluateAsync(
            tenantContext.TenantId,
            clientProfileId,
            CoachingFeature.CheckIns,
            cancellationToken);
        return decision.IsAllowed
            ? new CheckInClientAccess(CheckInCommandStatus.Success, clientProfileId, null)
            : new CheckInClientAccess(CheckInCommandStatus.Forbidden, clientProfileId, decision.Reason);
    }
}

/// <summary>
/// Projection of frozen check-in content into the shapes the API returns. A submission renders its
/// original wording by reading the published version's own rows, so these mappers are the only place
/// question and option text is read, and nothing copies that text into an answer.
/// </summary>
internal static class CheckInViewFactory
{
    public static CheckInFormVersionView Version(CheckInFormVersion version, CheckInForm form) =>
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
            [.. version.Questions.OrderBy(question => question.Order).Select(Question)],
            version.Version);

    public static CheckInQuestionView Question(CheckInQuestion question) =>
        new(
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
                new CheckInQuestionOptionView(option.Id, option.Order, option.Label))]);

    public static CheckInAssignmentView Assignment(
        CheckInAssignment assignment,
        CheckInForm form,
        int versionNumber) =>
        new(
            assignment.Id,
            assignment.FormId,
            form.Title,
            assignment.FormVersionId,
            versionNumber,
            assignment.ClientProfileId,
            assignment.DueDate,
            assignment.CreatedAtUtc,
            assignment.CreatedByUserId);

    public static CheckInResponseView Response(
        CheckInResponse response,
        DateOnly dueDate,
        IReadOnlyDictionary<Guid, CheckInQuestion> questions) =>
        new(
            response.Id,
            response.AssignmentId,
            response.ClientProfileId,
            response.Status,
            response.SubmittedAtUtc,
            response.SubmittedDate,
            response.IsLate(dueDate),
            response.ReviewedAtUtc,
            response.ReviewedByUserId,
            [.. response.Answers
                .Where(answer => questions.ContainsKey(answer.QuestionId))
                .Select(answer => Answer(answer, questions[answer.QuestionId]))
                .OrderBy(answer => answer.QuestionId)],
            response.Version);

    public static CheckInAnswerView Answer(CheckInAnswer answer, CheckInQuestion question)
    {
        var optionsById = question.Options.ToDictionary(option => option.Id);
        return new CheckInAnswerView(
            answer.QuestionId,
            question.QuestionKey,
            answer.QuestionType,
            answer.TextValue,
            answer.NumericValue,
            [.. answer.Choices
                .Where(choice => optionsById.ContainsKey(choice.QuestionOptionId))
                .Select(choice => optionsById[choice.QuestionOptionId])
                .OrderBy(option => option.Order)
                .Select(option => new CheckInAnswerChoiceView(option.Id, option.Order, option.Label))]);
    }
}
