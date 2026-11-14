using System.Globalization;
using System.Text;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// A published program the house's staff offer to its self-directed trainees (TRN-034, notes plan N9c3; decisions 29
/// and 30): a line on whom it suits, its place in a run of blocks, and how its weights are rounded when a trainee
/// starts it. The house's alone (a trigger); changing it never touches a program a trainee already started, which is
/// their own snapshot (TRN-001).
/// </summary>
public sealed class HouseProgramListing : TenantEntity
{
    private HouseProgramListing()
    {
    }

    private HouseProgramListing(Guid tenantId, Guid templateId)
        : base(tenantId)
    {
        if (templateId == Guid.Empty)
        {
            throw new ArgumentException("A program is required.", nameof(templateId));
        }

        TemplateId = templateId;
    }

    public Guid TemplateId { get; private set; }

    public string Suits { get; private set; } = string.Empty;

    public string? RunName { get; private set; }

    /// <summary>The run's name as runs are matched: trimmed, single-spaced and lower-case.</summary>
    public string? RunKey { get; private set; }

    public int? RunPosition { get; private set; }

    public decimal LoadIncrement { get; private set; }

    public TrainingLoadRoundingMode LoadRoundingMode { get; private set; }

    public bool IsOffered { get; private set; }

    public static HouseProgramListing Offer(Guid tenantId, Guid templateId, HouseProgramTerms terms)
    {
        var listing = new HouseProgramListing(tenantId, templateId);
        listing.Change(terms);
        return listing;
    }

    /// <summary>New terms, and the program offered again if it had been withdrawn.</summary>
    public void Change(HouseProgramTerms terms)
    {
        ArgumentNullException.ThrowIfNull(terms);
        Suits = terms.Suits;
        RunName = terms.RunName;
        RunKey = terms.RunKey;
        RunPosition = terms.RunPosition;
        LoadIncrement = terms.LoadIncrement;
        LoadRoundingMode = terms.LoadRoundingMode;
        IsOffered = true;
    }

    public void Withdraw() => IsOffered = false;
}

/// <summary>Checked terms of a listing; build them with <see cref="HouseProgramRules.Terms"/>.</summary>
public sealed record HouseProgramTerms(
    string Suits,
    string? RunName,
    string? RunKey,
    int? RunPosition,
    decimal LoadIncrement,
    TrainingLoadRoundingMode LoadRoundingMode);

/// <summary>
/// That a trainee started a program from the house's list (TRN-034): the run and place it had then, the plan it was
/// started under and its program. Append-only; a later block of the run opens from these rows.
/// </summary>
public sealed class HouseProgramStart : TenantEntity
{
    private HouseProgramStart()
    {
    }

    private HouseProgramStart(
        Guid tenantId,
        Guid clientProfileId,
        Guid mesocycleId,
        Guid listingId,
        Guid templateId,
        Guid templateVersionId,
        Guid enrollmentId,
        string? runName,
        string? runKey,
        int? runPosition,
        DateOnly startDate)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || mesocycleId == Guid.Empty || listingId == Guid.Empty ||
            templateId == Guid.Empty || templateVersionId == Guid.Empty || enrollmentId == Guid.Empty)
        {
            throw new ArgumentException("A started program names its trainee, program, listing and plan.");
        }

        ClientProfileId = clientProfileId;
        MesocycleId = mesocycleId;
        ListingId = listingId;
        TemplateId = templateId;
        TemplateVersionId = templateVersionId;
        EnrollmentId = enrollmentId;
        RunName = runName;
        RunKey = runKey;
        RunPosition = runPosition;
        StartDate = startDate;
    }

    public Guid ClientProfileId { get; private set; }

    public Guid MesocycleId { get; private set; }

    public Guid ListingId { get; private set; }

    public Guid TemplateId { get; private set; }

    public Guid TemplateVersionId { get; private set; }

    public Guid EnrollmentId { get; private set; }

    public string? RunName { get; private set; }

    public string? RunKey { get; private set; }

    public int? RunPosition { get; private set; }

    public DateOnly StartDate { get; private set; }

    public static HouseProgramStart Record(
        HouseProgramListing listing,
        TrainingMesocycle mesocycle,
        Guid templateVersionId)
    {
        ArgumentNullException.ThrowIfNull(listing);
        ArgumentNullException.ThrowIfNull(mesocycle);
        return new HouseProgramStart(
            mesocycle.TenantId,
            mesocycle.ClientProfileId,
            mesocycle.Id,
            listing.Id,
            listing.TemplateId,
            templateVersionId,
            mesocycle.EnrollmentId,
            listing.RunName,
            listing.RunKey,
            listing.RunPosition,
            mesocycle.StartDate);
    }
}

/// <summary>One earlier start of a run's block, as <see cref="HouseProgramRules.Opening"/> reads it.</summary>
public sealed record HouseProgramRunBlock(int Position, DateOnly EndDateExclusive, bool IsCancelled);

/// <summary>Whether a block may be started today, and from which day it may if not.</summary>
public sealed record HouseProgramBlockOpening(bool IsOpen, bool BlockBeforeStarted, DateOnly? OpensOn);

/// <summary>A max a lift could start from: one the trainee or their coach recorded, or their last program's.</summary>
public sealed record HouseProgramMaxCandidate(
    Guid Id,
    decimal Value,
    DateOnly On,
    bool IsTrainingMax,
    DateTimeOffset RecordedAtUtc);

public enum HouseProgramMaxSource
{
    Typed = 1,
    LastProgram = 2,
}

public sealed record HouseProgramMaxPick(HouseProgramMaxSource Source, Guid Id, decimal Value, DateOnly On);

/// <summary>The loaded sets' unit of a program: one unit, or none when its sets mix kilograms and pounds.</summary>
public sealed record HouseProgramUnit(bool IsMixed, TrainingLoadUnit Unit);

/// <summary>
/// The rules of the house's programs (TRN-034, HouseProgramStart v1). A trainee starts a block today, under a Pro+
/// pass, only when the block ends inside the pass; a run's later block only once the one before has ended; one
/// program at a time (TRN-011's overlap constraint).
/// </summary>
public static class HouseProgramRules
{
    public const string Key = "HouseProgramStart";
    public const string Version = "1.0";
    public const int SuitsMaximumLength = 200;
    public const int RunNameMaximumLength = 80;
    public const int MaximumRunPosition = 52;
    public const decimal DefaultLoadIncrement = 2.5m;
    public const decimal MaximumLoadIncrement = 50m;
    public const TrainingLoadRoundingMode DefaultLoadRoundingMode = TrainingLoadRoundingMode.Nearest;

    /// <summary>
    /// Checks a listing's terms. Answers the terms, or the problems by field ("suits", "runName", "runPosition",
    /// "loadIncrement", "loadRoundingMode") in plain words.
    /// </summary>
    public static (HouseProgramTerms? Terms, IReadOnlyDictionary<string, string> Problems) Terms(
        string? suits,
        string? runName,
        int? runPosition,
        decimal? loadIncrement,
        TrainingLoadRoundingMode? loadRoundingMode)
    {
        var problems = new Dictionary<string, string>(StringComparer.Ordinal);
        var suitsText = suits?.Trim();
        if (string.IsNullOrEmpty(suitsText))
        {
            problems["suits"] = "Say in one line whom this program suits.";
        }
        else if (HasControlCharacter(suitsText))
        {
            problems["suits"] = "Keep whom it suits to one line.";
        }
        else if (suitsText.Length > SuitsMaximumLength)
        {
            problems["suits"] = $"Keep whom it suits to {SuitsMaximumLength} characters or fewer.";
        }

        var run = SingleSpaced(runName);
        if (run is null)
        {
            if (runPosition is not null)
            {
                problems["runName"] = "Name the run this block belongs to, or leave its place empty.";
            }
        }
        else
        {
            if (HasControlCharacter(run))
            {
                problems["runName"] = "Keep the run's name to one line.";
            }
            else if (run.Length > RunNameMaximumLength)
            {
                problems["runName"] = $"Keep the run's name to {RunNameMaximumLength} characters or fewer.";
            }

            if (runPosition is null)
            {
                problems["runPosition"] = "Say which block of the run this is: 1 for the first.";
            }
            else if (runPosition < 1 || runPosition > MaximumRunPosition)
            {
                problems["runPosition"] = $"A block's place in its run is from 1 to {MaximumRunPosition}.";
            }
        }

        var increment = loadIncrement ?? DefaultLoadIncrement;
        if (increment <= 0m || increment > MaximumLoadIncrement || decimal.Round(increment, 2) != increment)
        {
            problems["loadIncrement"] = "Round weights to a step above 0 and at most 50, with two decimals at most.";
        }

        var rounding = loadRoundingMode ?? DefaultLoadRoundingMode;
        if (!Enum.IsDefined(rounding))
        {
            problems["loadRoundingMode"] = "Round to the nearest step, down or up.";
        }

        return problems.Count > 0
            ? (null, problems)
            : (new HouseProgramTerms(suitsText!, run, RunKeyOf(run), run is null ? null : runPosition, increment, rounding),
                problems);
    }

    /// <summary>How runs are matched: the name trimmed, single-spaced and lower-case; null for no run.</summary>
    public static string? RunKeyOf(string? runName) =>
        SingleSpaced(runName)?.ToLowerInvariant();

    /// <summary>
    /// The unit of a program's loaded sets (every set that is not "no prescribed load"). A program with none is in
    /// kilograms; one mixing kilograms and pounds cannot be started, since nothing converts the two (TRN-016).
    /// </summary>
    public static HouseProgramUnit UnitOf(IEnumerable<(TrainingLoadStrategy Strategy, TrainingLoadUnit? Unit)> sets)
    {
        ArgumentNullException.ThrowIfNull(sets);
        var units = sets
            .Where(set => set.Strategy != TrainingLoadStrategy.None && set.Unit is not null)
            .Select(set => set.Unit!.Value)
            .Distinct()
            .ToArray();
        return units.Length switch
        {
            0 => new HouseProgramUnit(false, TrainingLoadUnit.Kilogram),
            1 => new HouseProgramUnit(false, units[0]),
            _ => new HouseProgramUnit(true, TrainingLoadUnit.Kilogram),
        };
    }

    /// <summary>Whether a set works its weight out from a training max (STR-002): a share, the Epley curve or the chart.</summary>
    public static bool NeedsMax(TrainingLoadStrategy strategy) =>
        strategy is TrainingLoadStrategy.PercentageWorkingMax or TrainingLoadStrategy.RpeBasedEpley
            or TrainingLoadStrategy.RpeChart;

    /// <summary>A block's half-open dates when started on <paramref name="start"/> (TRN-007: whole weeks).</summary>
    public static DateOnly EndExclusive(DateOnly start, int weeks) =>
        start.AddDays(checked(Math.Max(weeks, 1) * 7));

    /// <summary>The last day a block of <paramref name="weeks"/> can start and still end inside a pass.</summary>
    public static DateOnly LastStartDay(DateOnly passEndExclusive, int weeks) =>
        passEndExclusive.AddDays(-checked(Math.Max(weeks, 1) * 7));

    /// <summary>Whether a block started on <paramref name="start"/> runs wholly inside the pass (TRN-011).</summary>
    public static bool Fits(DateOnly start, int weeks, DateOnly passStart, DateOnly passEndExclusive) =>
        start >= passStart && EndExclusive(start, weeks) <= passEndExclusive;

    /// <summary>
    /// Whether a run's block may start today. A block with no run, or the first, always may. A later block opens once
    /// the trainee started the block before it and that program's dates have ended (the day after its last day),
    /// whether every session was done or not; a cancelled one does not count. A later block is never started first.
    /// </summary>
    public static HouseProgramBlockOpening Opening(
        int? position,
        IEnumerable<HouseProgramRunBlock> startedInRun,
        DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(startedInRun);
        if (position is null or <= 1)
        {
            return new HouseProgramBlockOpening(true, false, null);
        }

        var before = startedInRun
            .Where(block => block.Position == position - 1 && !block.IsCancelled)
            .Select(block => block.EndDateExclusive)
            .ToArray();
        if (before.Length == 0)
        {
            return new HouseProgramBlockOpening(false, false, null);
        }

        var opensOn = before.Min();
        return new HouseProgramBlockOpening(today >= opensOn, true, opensOn);
    }

    /// <summary>
    /// Whether <paramref name="sessionDate"/> falls in the program week <paramref name="today"/> is in: the seven days
    /// from a week's first day, counted from the program's start (TRN-007). A self-directed trainee starts any session
    /// of that week before its day (TRN-020).
    /// </summary>
    public static bool InCurrentWeek(DateOnly programStart, DateOnly sessionDate, DateOnly today) =>
        today >= programStart && sessionDate >= programStart &&
        (today.DayNumber - programStart.DayNumber) / 7 == (sessionDate.DayNumber - programStart.DayNumber) / 7;

    /// <summary>
    /// The max a lift starts from (STR-014 as Assign program offers it): of the maxes recorded in the program's unit,
    /// the newest training max, else the newest of any kind; the last program's max in use instead when nothing is
    /// recorded or what is recorded is not newer than it (a later day, or the same day and recorded after it). Null
    /// when there is neither.
    /// </summary>
    public static HouseProgramMaxPick? PickMax(
        IEnumerable<HouseProgramMaxCandidate> recorded,
        HouseProgramMaxCandidate? lastProgram)
    {
        ArgumentNullException.ThrowIfNull(recorded);
        var ordered = recorded
            .OrderByDescending(item => item.On)
            .ThenByDescending(item => item.RecordedAtUtc)
            .ThenByDescending(item => item.Id)
            .ToArray();
        var newest = ordered.FirstOrDefault(item => item.IsTrainingMax) ?? ordered.FirstOrDefault();
        if (newest is not null && (lastProgram is null || newest.On > lastProgram.On ||
                                   (newest.On == lastProgram.On && newest.RecordedAtUtc > lastProgram.RecordedAtUtc)))
        {
            return new HouseProgramMaxPick(HouseProgramMaxSource.Typed, newest.Id, newest.Value, newest.On);
        }

        return lastProgram is null
            ? null
            : new HouseProgramMaxPick(HouseProgramMaxSource.LastProgram, lastProgram.Id, lastProgram.Value, lastProgram.On);
    }

    /// <summary>"Squat, Bench Press and Deadlift": the lifts a sentence names.</summary>
    public static string Names(IReadOnlyList<string> names)
    {
        ArgumentNullException.ThrowIfNull(names);
        return names.Count switch
        {
            0 => string.Empty,
            1 => names[0],
            _ => string.Join(", ", names.Take(names.Count - 1)) + " and " + names[^1],
        };
    }

    public static string Day(DateOnly day) =>
        day.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

    private static string? SingleSpaced(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var builder = new StringBuilder(value.Length);
        var space = false;
        foreach (var character in value.Trim())
        {
            if (character == ' ')
            {
                space = true;
                continue;
            }

            if (space)
            {
                builder.Append(' ');
                space = false;
            }

            builder.Append(character);
        }

        return builder.ToString();
    }

    private static bool HasControlCharacter(string value) =>
        value.Any(character => char.IsControl(character) ||
            CharUnicodeInfo.GetUnicodeCategory(character) is UnicodeCategory.LineSeparator
                or UnicodeCategory.ParagraphSeparator);
}

/// <summary>The codes a trainee's Start and the house's programs read answer with (TRN-034).</summary>
public static class HouseProgramCodes
{
    public const string NotOffered = "house_program_not_offered";
    public const string NeedsPass = "house_program_needs_pass";
    public const string Changed = "house_program_changed";
    public const string MixedUnits = "house_program_unit";
    public const string BlockNotOpen = "house_program_block_not_open";
    public const string Overlap = "mesocycle_overlap";
    public const string DoesNotFit = "house_program_does_not_fit";
    public const string NeedsMaxes = "house_program_needs_maxes";
    public const string PositionTaken = "house_program_run_position_taken";
    public const string PlanClosed = "program_plan_closed";
}
