using System.Globalization;
using System.Text;

namespace TB.Gym.Modules.ExerciseLibrary;

/// <summary>
/// The sheet the house library's loader reads (LIB-007, notes plan N9b6): TB Gym's own form, kept here because no
/// library is bought yet; a bought library's file list is fitted to it the day its files are in hand.
/// </summary>
/// <remarks>
/// A CSV file in UTF-8 (a byte-order mark is allowed). Its first line names the seven columns, in any order and any
/// case: <c>name</c>, <c>type</c>, <c>equipment</c>, <c>movement</c>, <c>muscles</c>, <c>instructions</c> and
/// <c>clip</c>; a column with an empty heading is ignored. Every other line is one exercise. Cells are separated by
/// commas; a cell holding a comma, a quote or a line break is put in double quotes, with a quote inside written twice.
/// <list type="bullet">
/// <item><c>name</c>: the exercise's name, up to 160 characters. It matches the house's exercise of the same name, in
/// any case; two lines may not name the same exercise.</item>
/// <item><c>type</c>, <c>equipment</c>, <c>movement</c>: one word each, as the coach's screens say it or as the API
/// spells it, in any case, spaces and hyphens ignored ("Horizontal push", "HorizontalPush", "horizontal-push").</item>
/// <item><c>muscles</c>: one or more muscles separated by semicolons or commas; the first is the main muscle, the
/// rest are the ones it also works.</item>
/// <item><c>instructions</c>: how to do it, up to 8,000 characters, line breaks kept; empty leaves the house's
/// instructions as they are.</item>
/// <item><c>clip</c>: the clip's file, an MP4 or WebM, named from the sheet's own folder (a sub-folder may be
/// named, never a folder outside it).</item>
/// </list>
/// </remarks>
public static class ExerciseSheet
{
    public const string NameColumn = "name";
    public const string TypeColumn = "type";
    public const string EquipmentColumn = "equipment";
    public const string MovementColumn = "movement";
    public const string MusclesColumn = "muscles";
    public const string InstructionsColumn = "instructions";
    public const string ClipColumn = "clip";

    /// <summary>The seven columns, in the order the loader's words name them.</summary>
    public static IReadOnlyList<string> Columns { get; } =
        [NameColumn, TypeColumn, EquipmentColumn, MovementColumn, MusclesColumn, InstructionsColumn, ClipColumn];

    /// <summary>The columns as one sentence's list: "name, type, … and clip".</summary>
    public static string ColumnList => $"{string.Join(", ", Columns.Take(Columns.Count - 1))} and {Columns[^1]}";

    /// <summary>
    /// Reads a whole sheet: either a refusal of the whole sheet (its first line, or a quote never closed), or one
    /// entry per line that names anything, each an exercise or a refusal with its reason.
    /// </summary>
    public static ExerciseSheetReading Read(TextReader reader)
    {
        ArgumentNullException.ThrowIfNull(reader);
        var text = reader.ReadToEnd();
        if (text.Length > 0 && text[0] == '﻿')
        {
            text = text[1..];
        }

        var records = Records(text, out var unclosed);
        if (unclosed is { } openedOn)
        {
            return Refused($"Line {openedOn} opens a quoted cell that never closes, so the sheet cannot be read past it.");
        }

        var rows = records.Where(record => !record.IsBlank).ToList();
        if (rows.Count == 0)
        {
            return Refused($"The sheet is empty. Its first line names the columns: {ColumnList}.");
        }

        var header = rows[0];
        var (refusal, columns) = Header(header);
        if (refusal is not null || columns is null)
        {
            return Refused(refusal ?? $"The sheet's first line names the columns: {ColumnList}.");
        }

        var entries = new List<ExerciseSheetEntry>();
        var named = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var row in rows.Skip(1))
        {
            var entry = Entry(row, header.Cells.Count, columns);
            if (entry.Exercise is { } exercise)
            {
                var key = NameKey(exercise.Name);
                if (named.TryGetValue(key, out var firstLine))
                {
                    entry = entry with
                    {
                        Exercise = null,
                        Refusal = $"It names the same exercise as line {firstLine.ToString(CultureInfo.InvariantCulture)}.",
                    };
                }
                else
                {
                    named.Add(key, row.Line);
                }
            }

            entries.Add(entry);
        }

        return new ExerciseSheetReading(null, entries);
    }

    /// <summary>The key a name is matched by: the library's own (a trimmed name in capitals, LIB-007).</summary>
    public static string NameKey(string name) => name.Trim().ToUpperInvariant();

    private static ExerciseSheetReading Refused(string refusal) => new(refusal, []);

    private static (string? Refusal, IReadOnlyDictionary<string, int>? Columns) Header(SheetRecord header)
    {
        var columns = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var index = 0; index < header.Cells.Count; index++)
        {
            var heading = header.Cells[index].Trim().ToLowerInvariant();
            if (heading.Length == 0)
            {
                continue;
            }

            if (!Columns.Contains(heading))
            {
                return (header.Cells.Count == 1 && heading.Contains(';', StringComparison.Ordinal)
                    ? "The sheet's cells are separated by semicolons. Save it as CSV with commas (CSV UTF-8)."
                    : $"The sheet's first line names a column the loader does not know: \"{header.Cells[index].Trim()}\". Its columns are {ColumnList}.", null);
            }

            if (!columns.TryAdd(heading, index))
            {
                return ($"The sheet's first line names the column {heading} twice.", null);
            }
        }

        var missing = Columns.Where(column => !columns.ContainsKey(column)).ToList();
        return missing.Count == 0
            ? (null, columns)
            : ($"The sheet's first line does not name the column{(missing.Count == 1 ? string.Empty : "s")} {string.Join(", ", missing)}. Its columns are {ColumnList}.", null);
    }

    private static ExerciseSheetEntry Entry(SheetRecord row, int width, IReadOnlyDictionary<string, int> columns)
    {
        string Cell(string column) => row.Cells[columns[column]].Trim();

        var extra = row.Cells.Skip(width).Any(cell => cell.Trim().Length > 0);
        if (row.Cells.Count < width || extra)
        {
            var given = row.Cells.Count;
            return new ExerciseSheetEntry(
                row.Line,
                given > columns[NameColumn] ? NullIfEmpty(Cell(NameColumn)) : null,
                null,
                $"It has {given.ToString(CultureInfo.InvariantCulture)} cells where the first line names {width.ToString(CultureInfo.InvariantCulture)}.");
        }

        var name = NullIfEmpty(Cell(NameColumn));
        if (row.Cells.Any(cell => cell.Contains('\0', StringComparison.Ordinal)))
        {
            return new ExerciseSheetEntry(row.Line, name?.Replace("\0", string.Empty, StringComparison.Ordinal), null,
                "It holds a NUL character, which the app cannot store.");
        }

        var problems = new List<string>();
        if (name is null)
        {
            problems.Add("It has no name.");
        }

        var type = Word<ExerciseClassification>(Cell(TypeColumn), TypeColumn, ExerciseSheetWords.TryType, ExerciseSheetWords.TypeList, problems);
        var equipment = Word<ExerciseEquipment>(Cell(EquipmentColumn), EquipmentColumn, ExerciseSheetWords.TryEquipment, ExerciseSheetWords.EquipmentList, problems);
        var movement = Word<MovementPattern>(Cell(MovementColumn), MovementColumn, ExerciseSheetWords.TryMovement, ExerciseSheetWords.MovementList, problems);
        var muscles = Muscles(Cell(MusclesColumn), problems);
        var clip = NullIfEmpty(Cell(ClipColumn));
        if (clip is null)
        {
            problems.Add("It names no clip.");
        }

        if (problems.Count > 0)
        {
            return new ExerciseSheetEntry(row.Line, name, null, string.Join(" ", problems));
        }

        return new ExerciseSheetEntry(
            row.Line,
            name,
            new ExerciseSheetLine(
                name!,
                type,
                equipment,
                movement,
                muscles,
                NullIfEmpty(Cell(InstructionsColumn)),
                clip!),
            null);
    }

    private delegate bool TryWord<T>(string word, out T value);

    private static T Word<T>(string word, string column, TryWord<T> tryWord, string list, List<string> problems)
        where T : struct
    {
        if (word.Length == 0)
        {
            problems.Add($"It has no {column}.");
            return default;
        }

        if (tryWord(word, out var value))
        {
            return value;
        }

        problems.Add($"The {column} \"{word}\" is not one of: {list}.");
        return default;
    }

    private static List<ExerciseMuscleDefinition> Muscles(string cell, List<string> problems)
    {
        var words = cell
            .Split([';', ','], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0)
        {
            problems.Add("It names no muscle: the first one named is the main muscle.");
            return [];
        }

        var muscles = new List<MuscleGroup>();
        foreach (var word in words)
        {
            if (!ExerciseSheetWords.TryMuscle(word, out var muscle))
            {
                problems.Add($"The muscle \"{word}\" is not one of: {ExerciseSheetWords.MuscleList}.");
                continue;
            }

            if (!muscles.Contains(muscle))
            {
                muscles.Add(muscle);
            }
        }

        return
        [
            .. muscles.Select((muscle, index) =>
                new ExerciseMuscleDefinition(muscle, index == 0 ? MuscleRole.Primary : MuscleRole.Secondary)),
        ];
    }

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;

    /// <summary>
    /// Splits the text into records (RFC 4180, read leniently): a record starts on a physical line and may span several
    /// inside quotes; a line break inside a cell is kept as one line feed.
    /// </summary>
    private static List<SheetRecord> Records(string text, out int? unclosedOnLine)
    {
        var records = new List<SheetRecord>();
        var cells = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        var line = 1;
        var recordLine = 1;
        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            if (quoted)
            {
                if (character == '"')
                {
                    if (index + 1 < text.Length && text[index + 1] == '"')
                    {
                        cell.Append('"');
                        index++;
                    }
                    else
                    {
                        quoted = false;
                    }
                }
                else if (character is '\r' or '\n')
                {
                    if (character == '\r' && index + 1 < text.Length && text[index + 1] == '\n')
                    {
                        index++;
                    }

                    cell.Append('\n');
                    line++;
                }
                else
                {
                    cell.Append(character);
                }

                continue;
            }

            switch (character)
            {
                case '"' when string.IsNullOrWhiteSpace(cell.ToString()):
                    cell.Clear();
                    quoted = true;
                    break;
                case ',':
                    cells.Add(cell.ToString());
                    cell.Clear();
                    break;
                case '\r' or '\n':
                    if (character == '\r' && index + 1 < text.Length && text[index + 1] == '\n')
                    {
                        index++;
                    }

                    cells.Add(cell.ToString());
                    cell.Clear();
                    records.Add(new SheetRecord(recordLine, cells));
                    cells = [];
                    line++;
                    recordLine = line;
                    break;
                default:
                    cell.Append(character);
                    break;
            }
        }

        unclosedOnLine = quoted ? recordLine : null;
        if (cells.Count > 0 || cell.Length > 0)
        {
            cells.Add(cell.ToString());
            records.Add(new SheetRecord(recordLine, cells));
        }

        return records;
    }

    private sealed record SheetRecord(int Line, IReadOnlyList<string> Cells)
    {
        public bool IsBlank => Cells.All(cell => cell.Trim().Length == 0);
    }
}

/// <summary>A whole sheet read: <see cref="Refusal"/> when the sheet cannot be read at all, else its entries.</summary>
public sealed record ExerciseSheetReading(string? Refusal, IReadOnlyList<ExerciseSheetEntry> Entries);

/// <summary>
/// One line of the sheet: <see cref="Line"/> is the physical line it starts on (the first line is 1), and it is either
/// an exercise or a refusal saying why.
/// </summary>
public sealed record ExerciseSheetEntry(int Line, string? Name, ExerciseSheetLine? Exercise, string? Refusal);

/// <summary>An exercise as one line of the sheet gives it, every word read into the library's own terms.</summary>
public sealed record ExerciseSheetLine(
    string Name,
    ExerciseClassification Type,
    ExerciseEquipment Equipment,
    MovementPattern Movement,
    IReadOnlyList<ExerciseMuscleDefinition> Muscles,
    string? Instructions,
    string Clip);

/// <summary>
/// The words a sheet may use for a type, an equipment, a movement and a muscle: each value as the API spells it and
/// as the coach's screens say it, in any case, with spaces, hyphens and underscores ignored. A number or a list is
/// never a word (the trap of reading these with <c>Enum.TryParse</c>).
/// </summary>
public static class ExerciseSheetWords
{
    private static readonly (ExerciseClassification Value, string Label)[] Types =
    [
        (ExerciseClassification.Strength, "Strength"),
        (ExerciseClassification.Power, "Power"),
        (ExerciseClassification.Conditioning, "Conditioning"),
        (ExerciseClassification.Mobility, "Mobility and flexibility"),
        (ExerciseClassification.Balance, "Balance and coordination"),
        (ExerciseClassification.WarmUp, "Warm-up and activation"),
        (ExerciseClassification.Other, "Other"),
    ];

    private static readonly (ExerciseEquipment Value, string Label)[] EquipmentWords =
    [
        (ExerciseEquipment.None, "None"),
        (ExerciseEquipment.Barbell, "Barbell"),
        (ExerciseEquipment.Dumbbell, "Dumbbell"),
        (ExerciseEquipment.Kettlebell, "Kettlebell"),
        (ExerciseEquipment.Machine, "Machine"),
        (ExerciseEquipment.Cable, "Cable"),
        (ExerciseEquipment.Band, "Band"),
        (ExerciseEquipment.Bodyweight, "Bodyweight"),
        (ExerciseEquipment.SpecialtyBar, "Specialty bar"),
        (ExerciseEquipment.Other, "Other"),
    ];

    private static readonly (MovementPattern Value, string Label)[] Movements =
    [
        (MovementPattern.Squat, "Squat"),
        (MovementPattern.Hinge, "Hinge"),
        (MovementPattern.HorizontalPush, "Horizontal push"),
        (MovementPattern.VerticalPush, "Vertical push"),
        (MovementPattern.HorizontalPull, "Horizontal pull"),
        (MovementPattern.VerticalPull, "Vertical pull"),
        (MovementPattern.Carry, "Carry"),
        (MovementPattern.Rotation, "Rotation"),
        (MovementPattern.Locomotion, "Locomotion"),
        (MovementPattern.Isolation, "Isolation"),
        (MovementPattern.Mobility, "Mobility"),
        (MovementPattern.Other, "Other"),
    ];

    private static readonly (MuscleGroup Value, string Label)[] MuscleWords =
    [
        (MuscleGroup.Chest, "Chest"),
        (MuscleGroup.Back, "Back"),
        (MuscleGroup.Shoulders, "Shoulders"),
        (MuscleGroup.Biceps, "Biceps"),
        (MuscleGroup.Triceps, "Triceps"),
        (MuscleGroup.Forearms, "Forearms"),
        (MuscleGroup.Quadriceps, "Quadriceps"),
        (MuscleGroup.Hamstrings, "Hamstrings"),
        (MuscleGroup.Glutes, "Glutes"),
        (MuscleGroup.Calves, "Calves"),
        (MuscleGroup.Abdominals, "Abdominals"),
        (MuscleGroup.Adductors, "Adductors"),
        (MuscleGroup.Abductors, "Abductors"),
        (MuscleGroup.FullBody, "Full body"),
        (MuscleGroup.Other, "Other"),
    ];

    private static readonly Dictionary<string, ExerciseClassification> TypeTable = Table(Types);

    private static readonly Dictionary<string, ExerciseEquipment> EquipmentTable =
        Table(EquipmentWords, ("No equipment", ExerciseEquipment.None));

    private static readonly Dictionary<string, MovementPattern> MovementTable = Table(Movements);

    private static readonly Dictionary<string, MuscleGroup> MuscleTable = Table(MuscleWords);

    public static string TypeList { get; } = List(Types);

    public static string EquipmentList { get; } = List(EquipmentWords);

    public static string MovementList { get; } = List(Movements);

    public static string MuscleList { get; } = List(MuscleWords);

    public static bool TryType(string word, out ExerciseClassification type) => TypeTable.TryGetValue(Key(word), out type);

    public static bool TryEquipment(string word, out ExerciseEquipment equipment) =>
        EquipmentTable.TryGetValue(Key(word), out equipment);

    public static bool TryMovement(string word, out MovementPattern movement) =>
        MovementTable.TryGetValue(Key(word), out movement);

    public static bool TryMuscle(string word, out MuscleGroup muscle) => MuscleTable.TryGetValue(Key(word), out muscle);

    private static string Key(string word)
    {
        var key = new StringBuilder(word.Length);
        foreach (var character in word.Trim())
        {
            if (character is not (' ' or '-' or '_'))
            {
                key.Append(char.ToLowerInvariant(character));
            }
        }

        return key.ToString();
    }

    private static Dictionary<string, T> Table<T>((T Value, string Label)[] words, params (string Word, T Value)[] aliases)
        where T : struct, Enum
    {
        var table = new Dictionary<string, T>(StringComparer.Ordinal);
        foreach (var (value, label) in words)
        {
            table[Key(value.ToString())] = value;
            table[Key(label)] = value;
        }

        foreach (var (word, value) in aliases)
        {
            table[Key(word)] = value;
        }

        return table;
    }

    private static string List<T>((T Value, string Label)[] words) => string.Join(", ", words.Select(word => word.Label));
}
