using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The exercise library (critique B9): seven types where General was, Other's optional name of the coach's own
/// (LIB-005), and a video link's own title as its provider gave it, made fit to show (MED-015).
/// </summary>
[TestClass]
public sealed class B9ExerciseLibraryDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("b9b9b9b9-0000-0000-0000-000000000001");
    private static readonly Guid OwnerId = Guid.Parse("b9b9b9b9-0000-0000-0000-000000000002");

    private static ExerciseDefinition Definition(ExerciseClassification classification, string? typeName = null) =>
        new(
            "Terminal knee extension",
            null,
            ExerciseEquipment.Band,
            MovementPattern.Isolation,
            classification,
            [new ExerciseMuscleDefinition(MuscleGroup.Quadriceps, MuscleRole.Primary)],
            [],
            [],
            [],
            typeName);

    [TestMethod]
    public void B9TheTypesAreSevenAndGeneralKeptItsNumberAsOther()
    {
        Assert.AreEqual(
            "Strength, Other, Mobility, Conditioning, Power, Balance, WarmUp",
            string.Join(", ", Enum.GetNames<ExerciseClassification>()));
        Assert.AreEqual("Other", Enum.GetName((ExerciseClassification)2), "Other is General's number, so stored numbers never moved.");
        Assert.IsFalse(Enum.TryParse<ExerciseClassification>("General", out _));
    }

    [TestMethod]
    public void B9OtherKeepsANameOfTheCoachsOwnTrimmed()
    {
        var exercise = Exercise.Create(TenantId, Definition(ExerciseClassification.Other, "  Rehab  "));
        Assert.AreEqual((ExerciseClassification.Other, "Rehab"), (exercise.Classification, exercise.TypeName));

        exercise.Update(Definition(ExerciseClassification.Other, new string('r', ExerciseTypes.MaximumOwnNameLength)));
        Assert.AreEqual(40, exercise.TypeName!.Length);

        // None, blank, or "Other" itself says nothing more than the type.
        foreach (var none in new[] { null, "", "   ", "Other", "OTHER" })
        {
            exercise.Update(Definition(ExerciseClassification.Other, none));
            Assert.IsNull(exercise.TypeName, none);
        }

        // A change of type drops the name with it.
        exercise.Update(Definition(ExerciseClassification.Other, "Rehab"));
        exercise.Update(Definition(ExerciseClassification.Strength));
        Assert.AreEqual((ExerciseClassification.Strength, (string?)null), (exercise.Classification, exercise.TypeName));
    }

    [TestMethod]
    public void B9ANameIsRefusedOnAnotherTypePastFortyCharactersOrAsAnotherType()
    {
        Assert.AreEqual(
            "Only an exercise of type Other takes a name of your own.",
            Refusal(ExerciseClassification.Strength, "Rehab"));
        Assert.AreEqual(
            "Keep the type's name to 40 characters.",
            Refusal(ExerciseClassification.Other, new string('r', 41)));
        foreach (var taken in new[] { "Strength", "power", "Mobility and flexibility", "Balance", "warm-up", "Warm-up and activation", "WarmUp" })
        {
            Assert.AreEqual(
                $"{taken} is one of the types already. Choose it as the type, or give this one another name.",
                Refusal(ExerciseClassification.Other, taken));
        }

        // General is no longer a type, so it is a name like any other.
        Assert.AreEqual("General", Exercise.Create(TenantId, Definition(ExerciseClassification.Other, "General")).TypeName);
    }

    [TestMethod]
    public void B9AProvidersTitleIsOneLineWithoutControlOrDirectionMarks()
    {
        Assert.AreEqual("Back Squat: how to squat", ExternalVideoTitle.Clean("  Back Squat:\r\n\thow to\u0007 squat  "));
        Assert.AreEqual("abc", ExternalVideoTitle.Clean("a‮b⁦c⁩"), "Overrides and isolates could make a title read as another.");
        Assert.AreEqual("تمرين القرفصاء 🏋️‍♀️", ExternalVideoTitle.Clean("تمرين القرفصاء 🏋️‍♀️"), "Joiners and marks a script needs stay.");
        foreach (var nothing in new[] { null, "", "   ", "\u0000‮" })
        {
            Assert.IsNull(ExternalVideoTitle.Clean(nothing));
        }
    }

    [TestMethod]
    public void B9ALongTitleIsCutBetweenCharactersToTwoHundred()
    {
        var exact = new string('a', 200);
        Assert.AreEqual(exact, ExternalVideoTitle.Clean(exact));

        var cut = ExternalVideoTitle.Clean(new string('a', 198) + "🏋️ squat");
        Assert.AreEqual(new string('a', 198) + "…", cut, "The emoji does not fit whole, so it goes whole.");
        Assert.IsLessThanOrEqualTo(ExternalVideoTitle.MaximumLength, ExternalVideoTitle.Clean(new string('é', 500))!.Length);
    }

    [TestMethod]
    public void B9ALinkTakesItsProvidersTitleOnceAndAnUploadNever()
    {
        var link = MediaAsset.RegisterExternalEmbed(TenantId, OwnerId, "Back squat", ExternalMediaProvider.YouTube, "dQw4w9WgXcQ");
        Assert.IsNull(link.ExternalTitle);
        Assert.IsFalse(link.TakeExternalTitle("   "), "Nothing left once cleaned is no title.");
        Assert.IsTrue(link.TakeExternalTitle("How to Back Squat"));
        Assert.IsFalse(link.TakeExternalTitle("Another title"), "The first title stands.");
        Assert.AreEqual(("Back squat", "How to Back Squat"), (link.Title, link.ExternalTitle));
    }

    private static string Refusal(ExerciseClassification classification, string typeName) =>
        Assert.ThrowsExactly<ArgumentException>(() => Exercise.Create(TenantId, Definition(classification, typeName)))
            .Message.Split(" (Parameter", 2)[0];
}
