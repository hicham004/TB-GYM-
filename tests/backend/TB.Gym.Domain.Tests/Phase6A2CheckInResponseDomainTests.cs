using TB.Gym.Modules.CheckIns;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase6A2CheckInResponseDomainTests
{
    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid ActorUserId = Guid.CreateVersion7();
    private static readonly Guid CoachUserId = Guid.CreateVersion7();
    private static readonly Guid ClientProfileId = Guid.CreateVersion7();
    private static readonly DateTimeOffset PublishedAtUtc = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset SubmittedAtUtc = new(2026, 8, 24, 18, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ReviewedAtUtc = new(2026, 8, 25, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly WorkspaceToday = new(2026, 8, 24);
    private static readonly DateOnly DueDate = new(2026, 8, 25);
    private static readonly string[] EnergyOptions = ["Low", "Steady", "High"];

    [TestMethod]
    public void SubmitIsOneWayAndASecondSubmitIsRefused()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);
        AnswerEverything(response, version);

        var result = response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);

        Assert.IsTrue(result.IsAccepted);
        Assert.IsEmpty(result.Failures);
        Assert.AreEqual(CheckInResponseStatus.Submitted, response.Status);
        Assert.AreEqual(SubmittedAtUtc, response.SubmittedAtUtc);
        Assert.AreEqual(WorkspaceToday, response.SubmittedDate);
        Assert.IsNotNull(result.Event);
        Assert.AreEqual(CheckInResponseEventType.ResponseSubmitted, result.Event.EventType);
        Assert.AreEqual(ActorUserId, result.Event.ActorUserId);
        Assert.AreEqual(SubmittedAtUtc, result.Event.OccurredAtUtc);
        Assert.AreEqual(response.Id, result.Event.ResponseId);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId));
    }

    [TestMethod]
    public void AMissingRequiredAnswerRefusesSubmission()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);

        // Everything but the required short-text question, which a lenient draft happily accepts.
        response.ReplaceAnswers(
            [
                Numeric(version, "Sleep quality", 7m),
                Choice(version, "Energy level", 0),
            ],
            version.Questions);

        var result = response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);

        Assert.IsFalse(result.IsAccepted);
        Assert.IsNull(result.Event);
        Assert.AreEqual(CheckInResponseStatus.Draft, response.Status);
        var failure = result.Failures.Single();
        Assert.AreEqual(CheckInSubmissionFailureCode.RequiredAnswerMissing, failure.Code);
        Assert.AreEqual(Question(version, "How is your body feeling?").QuestionKey, failure.QuestionKey);
    }

    [TestMethod]
    public void AnOutOfRangeAndAnOffStepNumericEachRefuseSubmission()
    {
        var (version, assignment) = PublishAndAssign();

        var outOfRange = CheckInResponse.StartDraft(assignment);
        AnswerEverything(outOfRange, version, sleep: 42m);
        var high = outOfRange.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);
        Assert.IsFalse(high.IsAccepted);
        Assert.AreEqual(
            CheckInSubmissionFailureCode.NumericOutOfRange,
            high.Failures.Single().Code);

        // 7.5 is inside 1..10 but the scale steps by 1, so it is a position the coach never offered.
        var offStep = CheckInResponse.StartDraft(assignment);
        AnswerEverything(offStep, version, sleep: 7.5m);
        var between = offStep.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);
        Assert.IsFalse(between.IsAccepted);
        Assert.AreEqual(
            CheckInSubmissionFailureCode.NumericOffStep,
            between.Failures.Single().Code);
    }

    [TestMethod]
    public void ASingleChoiceHoldingTwoSelectionsRefusesSubmission()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);
        response.ReplaceAnswers(
            [
                Text(version, "How is your body feeling?", "Good."),
                Numeric(version, "Sleep quality", 7m),
                Choice(version, "Energy level", 0, 1),
            ],
            version.Questions);

        var result = response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);

        Assert.IsFalse(result.IsAccepted);
        Assert.AreEqual(
            CheckInSubmissionFailureCode.SingleChoiceRequiresExactlyOne,
            result.Failures.Single().Code);
    }

    [TestMethod]
    public void EverySubmissionFailureIsReportedInOnePass()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);

        // The required text is missing, the scale is off-step and the single choice holds two.
        response.ReplaceAnswers(
            [
                Numeric(version, "Sleep quality", 7.5m),
                Choice(version, "Energy level", 0, 2),
            ],
            version.Questions);

        var result = response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);

        Assert.IsFalse(result.IsAccepted);
        Assert.HasCount(3, result.Failures);
        CollectionAssert.AreEquivalent(
            new[]
            {
                CheckInSubmissionFailureCode.RequiredAnswerMissing,
                CheckInSubmissionFailureCode.NumericOffStep,
                CheckInSubmissionFailureCode.SingleChoiceRequiresExactlyOne,
            },
            result.Failures.Select(failure => failure.Code).ToArray());
    }

    [TestMethod]
    public void ReviewIsOneWayAndAnUnsubmittedCheckInCannotBeReviewed()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);
        AnswerEverything(response, version);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            response.Review(ReviewedAtUtc, CoachUserId));

        response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);
        var reviewed = response.Review(ReviewedAtUtc, CoachUserId);

        Assert.AreEqual(CheckInResponseStatus.Reviewed, response.Status);
        Assert.AreEqual(ReviewedAtUtc, response.ReviewedAtUtc);
        Assert.AreEqual(CoachUserId, response.ReviewedByUserId);
        Assert.AreEqual(CheckInResponseEventType.ResponseReviewed, reviewed.EventType);
        Assert.AreEqual(CoachUserId, reviewed.ActorUserId);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            response.Review(ReviewedAtUtc, CoachUserId));
    }

    [TestMethod]
    public void ASubmittedResponseRefusesAnswerMutation()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);
        AnswerEverything(response, version);
        response.Submit(version.Questions, SubmittedAtUtc, WorkspaceToday, ActorUserId);
        var recorded = response.Answers.Single(answer =>
            answer.QuestionType == CheckInQuestionType.ShortText).TextValue;

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            response.ReplaceAnswers(
                [Text(version, "How is your body feeling?", "Rewritten after submitting.")],
                version.Questions));

        // The refusal leaves the frozen answers exactly as they were submitted.
        Assert.AreEqual(recorded, response.Answers.Single(answer =>
            answer.QuestionType == CheckInQuestionType.ShortText).TextValue);
        Assert.HasCount(3, response.Answers);
    }

    [TestMethod]
    public void ADraftIsLenientButStillStructurallySound()
    {
        var (version, assignment) = PublishAndAssign();
        var response = CheckInResponse.StartDraft(assignment);

        // Partial, and holding a number the scale does not allow. Both are fine in a draft.
        response.ReplaceAnswers([Numeric(version, "Sleep quality", 99m)], version.Questions);
        Assert.HasCount(1, response.Answers);
        Assert.AreEqual(99m, response.Answers.Single().NumericValue);

        // Structure is not negotiable even in a draft: an option from another question is refused.
        var otherVersion = PublishAndAssign().Version;
        var foreignOption = Question(otherVersion, "Energy level").Options[0].Id;
        Assert.ThrowsExactly<ArgumentException>(() =>
            response.ReplaceAnswers(
                [
                    new CheckInAnswerInput(
                        Question(version, "Energy level").Id,
                        null,
                        null,
                        [foreignOption]),
                ],
                version.Questions));

        // And a question that belongs to no version of this form is refused outright.
        Assert.ThrowsExactly<ArgumentException>(() =>
            response.ReplaceAnswers(
                [new CheckInAnswerInput(Guid.CreateVersion7(), "Stray.", null, [])],
                version.Questions));
    }

    [TestMethod]
    public void LatenessIsTheSubmittedDateAgainstTheDueDateAndNothingMore()
    {
        var (version, assignment) = PublishAndAssign();

        var onTime = CheckInResponse.StartDraft(assignment);
        AnswerEverything(onTime, version);
        onTime.Submit(version.Questions, SubmittedAtUtc, DueDate, ActorUserId);
        Assert.IsFalse(onTime.IsLate(assignment.DueDate));

        var late = CheckInResponse.StartDraft(assignment);
        AnswerEverything(late, version);
        late.Submit(version.Questions, SubmittedAtUtc, DueDate.AddDays(1), ActorUserId);
        Assert.IsTrue(late.IsLate(assignment.DueDate));
    }

    private static (CheckInFormVersion Version, CheckInAssignment Assignment) PublishAndAssign()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        var version = CheckInFormVersion.CreateDraft(
            TenantId,
            form.Id,
            form.StartNextVersion(),
            null,
            [
                new CheckInQuestionInput(
                    null,
                    CheckInQuestionType.ShortText,
                    "How is your body feeling?",
                    null,
                    true,
                    null,
                    null,
                    null,
                    []),
                new CheckInQuestionInput(
                    null,
                    CheckInQuestionType.NumericScale,
                    "Sleep quality",
                    null,
                    true,
                    1m,
                    10m,
                    1m,
                    []),
                new CheckInQuestionInput(
                    null,
                    CheckInQuestionType.SingleChoice,
                    "Energy level",
                    null,
                    true,
                    null,
                    null,
                    null,
                    EnergyOptions),
            ]);
        version.Publish(PublishedAtUtc, ActorUserId);
        var (assignment, _) = CheckInAssignment.Create(
            version,
            ClientProfileId,
            DueDate,
            WorkspaceToday,
            PublishedAtUtc,
            ActorUserId);
        return (version, assignment);
    }

    private static void AnswerEverything(
        CheckInResponse response,
        CheckInFormVersion version,
        decimal sleep = 7m) =>
        response.ReplaceAnswers(
            [
                Text(version, "How is your body feeling?", "Good."),
                Numeric(version, "Sleep quality", sleep),
                Choice(version, "Energy level", 1),
            ],
            version.Questions);

    private static CheckInQuestion Question(CheckInFormVersion version, string prompt) =>
        version.Questions.Single(question => question.Prompt == prompt);

    private static CheckInAnswerInput Text(CheckInFormVersion version, string prompt, string value) =>
        new(Question(version, prompt).Id, value, null, []);

    private static CheckInAnswerInput Numeric(CheckInFormVersion version, string prompt, decimal value) =>
        new(Question(version, prompt).Id, null, value, []);

    private static CheckInAnswerInput Choice(
        CheckInFormVersion version,
        string prompt,
        params int[] optionIndexes)
    {
        var question = Question(version, prompt);
        return new CheckInAnswerInput(
            question.Id,
            null,
            null,
            [.. optionIndexes.Select(index => question.Options[index].Id)]);
    }
}
