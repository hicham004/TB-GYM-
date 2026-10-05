using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// A program draft (TRN-024): the builder's program mid-edit, bounded in shape like a version and
/// checked for its values only when published.
/// </summary>
[TestClass]
public sealed class ProgramDraftDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000420");
    private static readonly Guid OwnerId = Guid.Parse("20000000-0000-0000-0000-000000000420");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-000000000420");
    private static readonly int[] FirstTwoPositions = [1, 2];

    [TestMethod]
    public void ADraftKeepsValuesPublishWouldRefuseAndReadsBackAsSent()
    {
        // Unnamed, an empty session, reps of 0 and an RPE of 11: all mid-edit, all kept.
        var content = Content(
            name: "  ",
            Week(Session(string.Empty, 0, Exercise(Set(repetitions: 0, rpe: 11m)))));

        Assert.IsTrue(ProgramDraftShape.TryCreate(content, out var shape, out _, out _));
        Assert.AreEqual((string.Empty, 1), (shape.Name, shape.WeekCount));
        var read = ProgramDraftShape.Read(shape.Json);
        var set = read.Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single();
        Assert.AreEqual((0, 11m), (set.RepetitionsMinimum, set.TargetRpe));
        Assert.AreEqual(TrainingSetType.Normal, set.SetType);
    }

    [TestMethod]
    public void TheShapeIsKeptInOneFormWithPositionsInListOrderAndEveryListPresent()
    {
        var exercise = Exercise(Set(repetitions: 5, rpe: null), Set(repetitions: 3, rpe: null)) with
        {
            Position = 9,
            ApprovedAlternativeExerciseIds = null!,
        };
        var content = Content("Strength", Week(Session("Squat day", 2, exercise, Exercise() with { Sets = null! })));

        Assert.IsTrue(ProgramDraftShape.TryCreate(content, out var shape, out _, out _));
        var session = ProgramDraftShape.Read(shape.Json).Weeks.Single().Sessions.Single();
        CollectionAssert.AreEqual(FirstTwoPositions, session.Exercises.Select(item => item.Position).ToArray());
        CollectionAssert.AreEqual(FirstTwoPositions, session.Exercises[0].Sets.Select(item => item.Position).ToArray());
        Assert.IsEmpty(session.Exercises[0].ApprovedAlternativeExerciseIds);
        Assert.IsEmpty(session.Exercises[1].Sets);
        Assert.AreEqual("Strength", shape.Name);
    }

    [TestMethod]
    public void TheLimitsAreAVersionsLimits()
    {
        Assert.IsTrue(ProgramDraftShape.TryCreate(Content("Year", [.. Enumerable.Repeat(Week(), 52)]), out _, out _, out _));
        AssertRefused(Content("Too long", [.. Enumerable.Repeat(Week(), 53)]), "weeks");
        AssertRefused(Content("None") with { Weeks = [] }, "weeks");
        AssertRefused(Content("Busy", Week([.. Enumerable.Repeat(Session("Day", 0), 15)])), "weeks");
        AssertRefused(Content("Day 8", Week(Session("Day", 7))), "sessions");
        AssertRefused(Content("Many", Week(Session("Day", 0, [.. Enumerable.Repeat(Exercise(), 41)]))), "sessions");
        AssertRefused(Content("Sets", Week(Session("Day", 0, Exercise([.. Enumerable.Repeat(Set(5, null), 21)])))), "sets");
        AssertRefused(Content(new string('n', 161), Week()), "name");
        AssertRefused(Content("Tempo", Week(Session("Day", 0, Exercise(Set(5, null) with { Tempo = new string('1', 33) })))), "sets");
        AssertRefused(Content("Nobody", Week(Session("Day", 0, Exercise() with { ExerciseId = Guid.Empty }))), "exercises");
    }

    [TestMethod]
    public void ANulCharacterIsRefusedBecauseTheDatabaseCannotStoreIt()
    {
        AssertRefused(Content("Bad\0name", Week()), "name");
        Assert.IsTrue(ProgramDraftShape.TryCreate(Content("Tabs\tand\nlines", Week()), out _, out _, out _));
    }

    [TestMethod]
    public void AProgramTooLongToKeepIsRefusedAsAWhole()
    {
        var note = new string('x', 1_000);
        var heavy = Session("Volume", 0, Exercise([.. Enumerable.Repeat(Set(5, null) with { CoachNotes = note }, 20)]));
        var content = Content("Huge", [.. Enumerable.Repeat(Week([.. Enumerable.Repeat(heavy, 10)]), 11)]);

        AssertRefused(content, "content");
    }

    [TestMethod]
    public void ADraftOfAProgramNamesTheVersionItStartedFromAndKnowsWhenItIsBehind()
    {
        Assert.IsTrue(ProgramDraftShape.TryCreate(Content("Strength", Week()), out var shape, out _, out _));
        var templateId = Guid.NewGuid();
        var draft = ProgramDraft.ForProgram(TenantId, OwnerId, templateId, Guid.NewGuid(), 3, shape);

        Assert.AreEqual((templateId, 3, "Strength", 1), (draft.TemplateId, draft.StartedAtVersionNumber, draft.Name, draft.WeekCount));
        Assert.IsFalse(draft.IsBehind(3));
        Assert.IsTrue(draft.IsBehind(4), "Someone published after it began.");

        var fresh = ProgramDraft.ForNewProgram(TenantId, OwnerId, shape);
        Assert.AreEqual((null, null, 0), (fresh.TemplateId, fresh.SourceVersionId, fresh.StartedAtVersionNumber));
        Assert.IsFalse(fresh.IsBehind(7), "A program not published yet has nobody to fall behind.");
    }

    [TestMethod]
    public void ADraftNeedsItsOwnerAndAWholeOrigin()
    {
        Assert.IsTrue(ProgramDraftShape.TryCreate(Content("Strength", Week()), out var shape, out _, out _));
        Assert.ThrowsExactly<ArgumentException>(() => ProgramDraft.ForNewProgram(TenantId, Guid.Empty, shape));
        Assert.ThrowsExactly<ArgumentException>(() => ProgramDraft.ForProgram(TenantId, OwnerId, Guid.NewGuid(), Guid.Empty, 1, shape));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ProgramDraft.ForProgram(TenantId, OwnerId, Guid.NewGuid(), Guid.NewGuid(), 0, shape));
    }

    private static void AssertRefused(ProgramDraftContent content, string field)
    {
        Assert.IsFalse(ProgramDraftShape.TryCreate(content, out _, out var refused, out var problem));
        Assert.AreEqual(field, refused);
        Assert.IsFalse(string.IsNullOrWhiteSpace(problem));
    }

    private static ProgramDraftContent Content(string name, params TrainingWeekRequest[] weeks) =>
        new(name, null, weeks);

    private static TrainingWeekRequest Week(params TrainingSessionRequest[] sessions) =>
        new("Week", true, sessions);

    private static TrainingSessionRequest Session(string name, int day, params ExercisePrescriptionRequest[] exercises) =>
        new(name, day, null, exercises);

    private static ExercisePrescriptionRequest Exercise(params SetPrescriptionRequest[] sets) =>
        new(SquatId, 1, false, PrescriptionModificationPolicy.CoachApprovedSwap, null, [], sets);

    private static SetPrescriptionRequest Set(int repetitions, decimal? rpe) =>
        new(
            1,
            TrainingSetType.Normal,
            repetitions,
            repetitions,
            TrainingLoadStrategy.None,
            null,
            null,
            null,
            rpe,
            null,
            ExertionDisplayPreference.Rpe,
            null,
            null,
            null);
}
