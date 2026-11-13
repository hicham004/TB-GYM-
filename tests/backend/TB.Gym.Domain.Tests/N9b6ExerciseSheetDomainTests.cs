using TB.Gym.Modules.ExerciseLibrary;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9b6: the sheet the house library's loader reads (LIB-007), TB Gym's own form until a library is
/// bought. Every name in these sheets is the tests' own.
/// </summary>
[TestClass]
public sealed class N9b6ExerciseSheetDomainTests
{
    private const string Header = "name,type,equipment,movement,muscles,instructions,clip";

    [TestMethod]
    public void N9b6TheSheetReadsItsColumnsInAnyOrderAndKeepsQuotedLineBreaks()
    {
        var reading = Read(
            "﻿Clip, MUSCLES ,Name,type,Equipment,movement,instructions,\r\n" +
            "clips/goblet.mp4,Quadriceps; Glutes,Goblet squat,Strength,Kettlebell,Squat,\"Hold the bell high.\r\nSit, then \"\"drive\"\" up.\",\r\n" +
            "\r\n" +
            "clips/dead-bug.webm,Abdominals,  Dead bug  ,Mobility and flexibility,No equipment,Rotation,,\r\n");

        Assert.IsNull(reading.Refusal);
        Assert.HasCount(2, reading.Entries);
        var goblet = reading.Entries[0];
        Assert.AreEqual(2, goblet.Line);
        Assert.IsNull(goblet.Refusal);
        Assert.AreEqual(
            new ExerciseSheetLine(
                "Goblet squat",
                ExerciseClassification.Strength,
                ExerciseEquipment.Kettlebell,
                MovementPattern.Squat,
                goblet.Exercise!.Muscles,
                "Hold the bell high.\nSit, then \"drive\" up.",
                "clips/goblet.mp4"),
            goblet.Exercise);
        CollectionAssert.AreEqual(
            new[]
            {
                new ExerciseMuscleDefinition(MuscleGroup.Quadriceps, MuscleRole.Primary),
                new ExerciseMuscleDefinition(MuscleGroup.Glutes, MuscleRole.Secondary),
            },
            goblet.Exercise.Muscles.ToArray());

        // A quoted line break counts as a line of the file, so the next exercise is named by the line it starts on.
        var deadBug = reading.Entries[1];
        Assert.AreEqual(5, deadBug.Line);
        Assert.AreEqual("Dead bug", deadBug.Exercise!.Name);
        Assert.AreEqual(ExerciseClassification.Mobility, deadBug.Exercise.Type);
        Assert.AreEqual(ExerciseEquipment.None, deadBug.Exercise.Equipment);
        Assert.IsNull(deadBug.Exercise.Instructions, "An empty instructions cell is none.");
    }

    [TestMethod]
    public void N9b6EveryWordIsReadAsTheApiSpellsItOrAsTheScreensSayIt()
    {
        foreach (var (word, type) in new[]
                 {
                     ("Strength", ExerciseClassification.Strength),
                     ("power", ExerciseClassification.Power),
                     ("Mobility", ExerciseClassification.Mobility),
                     ("Mobility and flexibility", ExerciseClassification.Mobility),
                     ("Balance and coordination", ExerciseClassification.Balance),
                     ("WarmUp", ExerciseClassification.WarmUp),
                     ("warm-up", ExerciseClassification.WarmUp),
                     ("Warm up", ExerciseClassification.WarmUp),
                     ("Warm-up and activation", ExerciseClassification.WarmUp),
                     ("OTHER", ExerciseClassification.Other),
                 })
        {
            Assert.IsTrue(ExerciseSheetWords.TryType(word, out var read), word);
            Assert.AreEqual(type, read, word);
        }

        foreach (var (word, equipment) in new[]
                 {
                     ("None", ExerciseEquipment.None),
                     ("No equipment", ExerciseEquipment.None),
                     ("Specialty bar", ExerciseEquipment.SpecialtyBar),
                     ("SPECIALTY_BAR", ExerciseEquipment.SpecialtyBar),
                     ("SpecialtyBar", ExerciseEquipment.SpecialtyBar),
                     ("bodyweight", ExerciseEquipment.Bodyweight),
                 })
        {
            Assert.IsTrue(ExerciseSheetWords.TryEquipment(word, out var read), word);
            Assert.AreEqual(equipment, read, word);
        }

        foreach (var (word, movement) in new[]
                 {
                     ("Horizontal push", MovementPattern.HorizontalPush),
                     ("horizontal-push", MovementPattern.HorizontalPush),
                     ("VerticalPull", MovementPattern.VerticalPull),
                     ("Mobility", MovementPattern.Mobility),
                 })
        {
            Assert.IsTrue(ExerciseSheetWords.TryMovement(word, out var read), word);
            Assert.AreEqual(movement, read, word);
        }

        Assert.IsTrue(ExerciseSheetWords.TryMuscle("Full body", out var fullBody));
        Assert.AreEqual(MuscleGroup.FullBody, fullBody);
        Assert.IsTrue(ExerciseSheetWords.TryMuscle("fullbody", out fullBody));
        Assert.AreEqual(MuscleGroup.FullBody, fullBody);
    }

    [TestMethod]
    public void N9b6ANumberOrAListIsNeverAWord()
    {
        // Enum.TryParse would read "3" as a value and "Squat, Hinge" as Squat | Hinge, which is HorizontalPush.
        foreach (var word in new[] { "3", "0", "99", "Squat, Hinge", "Squat|Hinge", "1, 2", string.Empty, " " })
        {
            Assert.IsFalse(ExerciseSheetWords.TryMovement(word, out _), word);
            Assert.IsFalse(ExerciseSheetWords.TryType(word, out _), word);
            Assert.IsFalse(ExerciseSheetWords.TryEquipment(word, out _), word);
            Assert.IsFalse(ExerciseSheetWords.TryMuscle(word, out _), word);
        }

        var reading = Read($"{Header}\nPush-up,Strength,Bodyweight,3,Chest,,push-up.mp4\n");
        Assert.AreEqual(
            "The movement \"3\" is not one of: Squat, Hinge, Horizontal push, Vertical push, Horizontal pull, Vertical pull, Carry, Rotation, Locomotion, Isolation, Mobility, Other.",
            reading.Entries.Single().Refusal);
    }

    [TestMethod]
    public void N9b6TheFirstMuscleIsTheMainOneAndARepeatIsDropped()
    {
        var reading = Read($"{Header}\nRow,Strength,Cable,Horizontal pull,\"Back, Biceps; back ;; forearms , Biceps\",,row.mp4\n");

        CollectionAssert.AreEqual(
            new[]
            {
                new ExerciseMuscleDefinition(MuscleGroup.Back, MuscleRole.Primary),
                new ExerciseMuscleDefinition(MuscleGroup.Biceps, MuscleRole.Secondary),
                new ExerciseMuscleDefinition(MuscleGroup.Forearms, MuscleRole.Secondary),
            },
            reading.Entries.Single().Exercise!.Muscles.ToArray());
    }

    [TestMethod]
    public void N9b6ARefusedLineSaysWhyAndTheOtherLinesAreStillRead()
    {
        var reading = Read(
            $"{Header}\n" +
            "Back squat,Strength,Barbell,Squat,Quadriceps,,back-squat.mp4\n" +
            ",Strength,Barbell,Squat,Quadriceps,,no-name.mp4\n" +
            "Rope climb,Strenght,Rope,Climb,Lats,,rope.mp4\n" +
            "Hollow hold,Strength,None,Isolation,,,\n" +
            "Short line,Strength,None\n" +
            "Too long,Strength,None,Isolation,Abdominals,,too-long.mp4,surprise\n" +
            "Trailing,Strength,None,Isolation,Abdominals,,trailing.mp4,, \n" +
            "Nul\0name,Strength,None,Isolation,Abdominals,,nul.mp4\n" +
            "  BACK SQUAT ,Power,Barbell,Squat,Quadriceps,,again.mp4\n" +
            "Front squat,Strength,Barbell,Squat,Quadriceps,,front-squat.mp4");

        Assert.IsNull(reading.Refusal);
        var said = reading.Entries.Select(entry => $"{entry.Line} {entry.Name} | {entry.Refusal}").ToArray();
        CollectionAssert.AreEqual(
            new[]
            {
                "2 Back squat | ",
                "3  | It has no name.",
                "4 Rope climb | The type \"Strenght\" is not one of: Strength, Power, Conditioning, Mobility and flexibility, Balance and coordination, Warm-up and activation, Other. " +
                    "The equipment \"Rope\" is not one of: None, Barbell, Dumbbell, Kettlebell, Machine, Cable, Band, Bodyweight, Specialty bar, Other. " +
                    "The movement \"Climb\" is not one of: Squat, Hinge, Horizontal push, Vertical push, Horizontal pull, Vertical pull, Carry, Rotation, Locomotion, Isolation, Mobility, Other. " +
                    "The muscle \"Lats\" is not one of: Chest, Back, Shoulders, Biceps, Triceps, Forearms, Quadriceps, Hamstrings, Glutes, Calves, Abdominals, Adductors, Abductors, Full body, Other.",
                "5 Hollow hold | It names no muscle: the first one named is the main muscle. It names no clip.",
                "6 Short line | It has 3 cells where the first line names 7.",
                "7 Too long | It has 8 cells where the first line names 7.",
                "8 Trailing | ",
                "9 Nulname | It holds a NUL character, which the app cannot store.",
                "10 BACK SQUAT | It names the same exercise as line 2.",
                "11 Front squat | ",
            },
            said);
        Assert.IsNull(reading.Entries[8].Exercise, "A second line for the same exercise is never read as one.");
        Assert.AreEqual("front-squat.mp4", reading.Entries[9].Exercise!.Clip, "The last line needs no line break.");
    }

    [TestMethod]
    public void N9b6TheWholeSheetIsRefusedWhenItsFirstLineCannotBeRead()
    {
        foreach (var (text, refusal) in new[]
                 {
                     (string.Empty, "The sheet is empty. Its first line names the columns: name, type, equipment, movement, muscles, instructions and clip."),
                     ("\r\n \r\n", "The sheet is empty. Its first line names the columns: name, type, equipment, movement, muscles, instructions and clip."),
                     ("name,type,equipment,movement,muscles,clip\n", "The sheet's first line does not name the column instructions. Its columns are name, type, equipment, movement, muscles, instructions and clip."),
                     ("name,type\n", "The sheet's first line does not name the columns equipment, movement, muscles, instructions, clip. Its columns are name, type, equipment, movement, muscles, instructions and clip."),
                     ($"{Header},tags\n", "The sheet's first line names a column the loader does not know: \"tags\". Its columns are name, type, equipment, movement, muscles, instructions and clip."),
                     ($"{Header},Name\n", "The sheet's first line names the column name twice."),
                     ("name;type;equipment;movement;muscles;instructions;clip\n", "The sheet's cells are separated by semicolons. Save it as CSV with commas (CSV UTF-8)."),
                     ($"{Header}\nPlank,Strength,None,Isolation,Abdominals,\"Hold it.\nKeep going,plank.mp4\n", "Line 2 opens a quoted cell that never closes, so the sheet cannot be read past it."),
                 })
        {
            var reading = Read(text);
            Assert.AreEqual(refusal, reading.Refusal, text);
            Assert.IsEmpty(reading.Entries, text);
        }
    }

    [TestMethod]
    public void N9b6ANameIsMatchedAsTheLibraryKeepsItTrimmedInCapitals()
    {
        Assert.AreEqual("BACK SQUAT", ExerciseSheet.NameKey("  back Squat "));
        Assert.AreEqual(ExerciseSheet.NameKey("Back squat"), ExerciseSheet.NameKey("BACK SQUAT"));
        Assert.AreNotEqual(ExerciseSheet.NameKey("Back squat"), ExerciseSheet.NameKey("Back  squat"));
    }

    private static ExerciseSheetReading Read(string text)
    {
        using var reader = new StringReader(text);
        return ExerciseSheet.Read(reader);
    }
}
