using TB.Gym.Modules.CheckIns;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase6A1CheckInFormDomainTests
{
    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid ActorUserId = Guid.CreateVersion7();
    private static readonly Guid ClientProfileId = Guid.CreateVersion7();
    private static readonly DateTimeOffset PublishedAtUtc = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly WorkspaceToday = new(2026, 8, 22);
    private static readonly string[] TwoOptions = ["A", "B"];
    private static readonly int[] FirstThreePositions = [1, 2, 3];
    private static readonly int[] FirstTwoPositions = [1, 2];

    [TestMethod]
    public void PublishingIsOneWayAndASecondPublishIsRejected()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        var version = CreateDraft(form);

        var published = version.Publish(PublishedAtUtc, ActorUserId);

        Assert.AreEqual(CheckInFormVersionStatus.Published, version.Status);
        Assert.IsFalse(version.IsDraft);
        Assert.AreEqual(PublishedAtUtc, version.PublishedAtUtc);
        Assert.AreEqual(ActorUserId, version.PublishedByUserId);
        Assert.AreEqual(CheckInLifecycleEventType.VersionPublished, published.EventType);
        Assert.AreEqual(version.Id, published.FormVersionId);
        Assert.AreEqual(ActorUserId, published.ActorUserId);
        Assert.AreEqual(PublishedAtUtc, published.OccurredAtUtc);
        Assert.IsNull(published.AssignmentId);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            version.Publish(PublishedAtUtc, ActorUserId));
    }

    [TestMethod]
    public void APublishedVersionRejectsQuestionMutation()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        var version = CreateDraft(form);
        var original = version.Questions.Single().Prompt;
        version.Publish(PublishedAtUtc, ActorUserId);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            version.ReplaceQuestions([ShortText("How did the week feel?")]));

        // The refusal leaves the frozen content exactly as it was published.
        Assert.AreEqual(original, version.Questions.Single().Prompt);
        Assert.HasCount(1, version.Questions);
    }

    [TestMethod]
    public void ANumericScaleWithAnInvalidRangeOrStepIsRejected()
    {
        Assert.ThrowsExactly<ArgumentException>(() => CheckInNumericScale.Validate(5m, 5m, 1m));
        Assert.ThrowsExactly<ArgumentException>(() => CheckInNumericScale.Validate(10m, 1m, 1m));

        // 1 to 10 is a range of 9, which a step of 2 cannot land on: it would stop at 9, never 10.
        Assert.ThrowsExactly<ArgumentException>(() => CheckInNumericScale.Validate(1m, 10m, 2m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => CheckInNumericScale.Validate(1m, 10m, 0m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => CheckInNumericScale.Validate(1m, 10m, -1m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => CheckInNumericScale.Validate(0m, 10m, 0.01m));

        var (minimum, maximum, step) = CheckInNumericScale.Validate(1m, 10m, 0.5m);
        Assert.AreEqual(1m, minimum);
        Assert.AreEqual(10m, maximum);
        Assert.AreEqual(0.5m, step);

        // The same rule reaches the aggregate, so an invalid scale cannot enter a draft either.
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        Assert.ThrowsExactly<ArgumentException>(() => CheckInFormVersion.CreateDraft(
            TenantId,
            form.Id,
            form.StartNextVersion(),
            null,
            [Scale("Sleep quality", 5m, 5m, 1m)]));
    }

    [TestMethod]
    public void DerivingADraftFromAPublishedVersionCarriesQuestionKeysForwardUnchanged()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        var first = CheckInFormVersion.CreateDraft(
            TenantId,
            form.Id,
            form.StartNextVersion(),
            null,
            [ShortText("Weekly notes"), Choice("Energy", ["Low", "High"]), Scale("Sleep", 1m, 10m, 1m)]);
        first.Publish(PublishedAtUtc, ActorUserId);
        var originalKeys = first.Questions.OrderBy(question => question.Order)
            .Select(question => question.QuestionKey)
            .ToArray();

        var second = CheckInFormVersion.CreateDraft(
            TenantId,
            form.Id,
            form.StartNextVersion(),
            first.Id,
            first.ToCarryForwardInputs());

        Assert.AreEqual(2, second.VersionNumber);
        Assert.AreEqual(first.Id, second.DerivedFromVersionId);
        CollectionAssert.AreEqual(
            originalKeys,
            second.Questions.OrderBy(question => question.Order).Select(question => question.QuestionKey).ToArray());

        // The keys survive re-wording: identity is the key, not the prompt or the row.
        var reworded = second.ToCarryForwardInputs()
            .Select(input => input with { Prompt = input.Prompt + " (revised)" })
            .ToArray();
        second.ReplaceQuestions(reworded);
        CollectionAssert.AreEqual(
            originalKeys,
            second.Questions.OrderBy(question => question.Order).Select(question => question.QuestionKey).ToArray());
        Assert.AreEqual("Weekly notes (revised)", second.Questions[0].Prompt);

        // Options and scale bounds travel with them, so v2 starts from exactly what v1 said.
        Assert.HasCount(2, second.Questions[1].Options);
        Assert.AreEqual("Low", second.Questions[1].Options[0].Label);
        Assert.AreEqual(10m, second.Questions[2].ScaleMaximum);

        // A key may not appear twice inside one version, which is what makes alignment unambiguous.
        var duplicated = second.ToCarryForwardInputs();
        Assert.ThrowsExactly<ArgumentException>(() =>
            second.ReplaceQuestions([duplicated[0], duplicated[0]]));
    }

    [TestMethod]
    public void QuestionContentIsValidatedPerTypeAndOrderIsAssignedByPosition()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        var version = CheckInFormVersion.CreateDraft(
            TenantId,
            form.Id,
            form.StartNextVersion(),
            null,
            [ShortText("First"), Choice("Second", ["A", "B"]), Scale("Third", 0m, 10m, 2m)]);

        CollectionAssert.AreEqual(
            FirstThreePositions,
            version.Questions.Select(question => question.Order).ToArray());
        CollectionAssert.AreEqual(
            FirstTwoPositions,
            version.Questions[1].Options.Select(option => option.Order).ToArray());
        Assert.IsTrue(version.Questions.All(question => CheckInQuestion.IsQuestionKey(question.QuestionKey)));

        // A text question carries neither options nor a scale, and a choice question carries no scale.
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions(
            [ShortText("Text") with { Options = TwoOptions }]));
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions(
            [Choice("Choice", TwoOptions) with { ScaleMinimum = 1m, ScaleMaximum = 5m, ScaleStep = 1m }]));
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions(
            [Scale("Scale", 1m, 5m, 1m) with { Options = TwoOptions }]));

        // A choice needs at least two distinct options; case alone does not make them distinct.
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions([Choice("Choice", ["Only"])]));
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions([Choice("Choice", ["Yes", "yes"])]));
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions([ShortText("   ")]));
        Assert.ThrowsExactly<ArgumentException>(() => version.ReplaceQuestions([]));
    }

    [TestMethod]
    public void AssignmentRefusesAnUnpublishedVersionAndAPastDueDate()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        var version = CreateDraft(form);

        Assert.ThrowsExactly<InvalidOperationException>(() => CheckInAssignment.Create(
            version,
            ClientProfileId,
            WorkspaceToday,
            WorkspaceToday,
            PublishedAtUtc,
            ActorUserId));

        version.Publish(PublishedAtUtc, ActorUserId);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => CheckInAssignment.Create(
            version,
            ClientProfileId,
            WorkspaceToday.AddDays(-1),
            WorkspaceToday,
            PublishedAtUtc,
            ActorUserId));

        // Today is allowed: the workspace's own calendar decides, not the server's.
        var (assignment, created) = CheckInAssignment.Create(
            version,
            ClientProfileId,
            WorkspaceToday,
            WorkspaceToday,
            PublishedAtUtc,
            ActorUserId);
        Assert.AreEqual(version.Id, assignment.FormVersionId);
        Assert.AreEqual(form.Id, assignment.FormId);
        Assert.AreEqual(WorkspaceToday, assignment.DueDate);
        Assert.AreEqual(CheckInLifecycleEventType.AssignmentCreated, created.EventType);
        Assert.AreEqual(assignment.Id, created.AssignmentId);
        Assert.AreEqual(ClientProfileId, created.ClientProfileId);
        Assert.AreEqual(ActorUserId, created.ActorUserId);
    }

    [TestMethod]
    public void ArchivingBlocksEditingAndPublishingUntilTheFormIsRestored()
    {
        var form = CheckInForm.Create(TenantId, "Weekly check-in", null);
        Assert.AreEqual(CheckInFormStatus.Draft, form.Status);
        form.MarkPublished();
        Assert.AreEqual(CheckInFormStatus.Published, form.Status);

        form.Archive();
        Assert.IsTrue(form.IsArchived);
        Assert.ThrowsExactly<InvalidOperationException>(() => form.Rename("Renamed", null));
        Assert.ThrowsExactly<InvalidOperationException>(() => form.StartNextVersion());
        Assert.ThrowsExactly<InvalidOperationException>(form.Archive);

        form.Restore();

        // Restoring returns the lineage to Published rather than guessing it was a draft again.
        Assert.IsFalse(form.IsArchived);
        Assert.AreEqual(CheckInFormStatus.Published, form.Status);
        Assert.ThrowsExactly<InvalidOperationException>(form.Restore);
        form.Rename("Weekly review", "Every Monday");
        Assert.AreEqual("Weekly review", form.Title);
        Assert.AreEqual("Every Monday", form.Description);
    }

    private static CheckInFormVersion CreateDraft(CheckInForm form) =>
        CheckInFormVersion.CreateDraft(
            TenantId,
            form.Id,
            form.StartNextVersion(),
            null,
            [ShortText("How was your week?")]);

    private static CheckInQuestionInput ShortText(string prompt) =>
        new(null, CheckInQuestionType.ShortText, prompt, null, true, null, null, null, []);

    private static CheckInQuestionInput Choice(string prompt, IReadOnlyList<string> options) =>
        new(null, CheckInQuestionType.SingleChoice, prompt, null, true, null, null, null, options);

    private static CheckInQuestionInput Scale(
        string prompt,
        decimal minimum,
        decimal maximum,
        decimal step) =>
        new(null, CheckInQuestionType.NumericScale, prompt, null, true, minimum, maximum, step, []);
}
