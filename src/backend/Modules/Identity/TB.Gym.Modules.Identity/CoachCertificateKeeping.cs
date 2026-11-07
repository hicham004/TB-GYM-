using System.Globalization;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// How long TB Gym keeps a taken-down certificate line's words (CLI-021, notes plan N4b): whole months after the
/// line's own take-down, from 1 to 120. The lawyer sets the number; until then it is the plan's example, 12. A line
/// taken down before the cut-off (now less the period) is due to be erased. A line still up, one the coach switched
/// off (which is not a take-down) and a waiting line are never due: only a take-down starts the period.
/// </summary>
public sealed record CoachCertificateKeepingPeriod
{
    /// <summary>The plan's example ("12 months after the last line expires"), read per line, until the lawyer sets it.</summary>
    public const int DefaultMonths = 12;

    public const int MinimumMonths = 1;

    public const int MaximumMonths = 120;

    public CoachCertificateKeepingPeriod(int months)
    {
        if (months is < MinimumMonths or > MaximumMonths)
        {
            throw new ArgumentOutOfRangeException(
                nameof(months),
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"A keeping period is {MinimumMonths} to {MaximumMonths} whole months."));
        }

        Months = months;
    }

    public int Months { get; }

    /// <summary>
    /// The instant <see cref="Months"/> calendar months before <paramref name="now"/>, in UTC, to the whole
    /// microsecond the database keeps, so a query and the line in hand draw the line at the same instant.
    /// </summary>
    public DateTimeOffset CutOff(DateTimeOffset now)
    {
        var cutOff = now.ToUniversalTime().AddMonths(-Months);
        return new DateTimeOffset(cutOff.Ticks - (cutOff.Ticks % TimeSpan.TicksPerMicrosecond), TimeSpan.Zero);
    }

    /// <summary>Whether the line was taken down, and not yet erased, before the cut-off for <paramref name="now"/>.</summary>
    public bool IsDue(CoachCertificateLine line, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(line);
        return line.State == CoachCertificateLineState.TakenDown && line.TakenDownAtUtc < CutOff(now);
    }
}

/// <summary>
/// The certificate record's settings, section <c>CoachCertificates</c> (CLI-021, notes plan N4b): the keeping period
/// and the Worker's daily sweep that erases what is past it. They are read when a host starts, and a host whose
/// settings are wrong refuses to start, naming the setting and never quoting its value.
/// </summary>
public sealed class CoachCertificateOptions
{
    public const string SectionName = "CoachCertificates";

    public const int MinimumSweepIntervalSeconds = 60;

    /// <summary>A day: the sweep may run more often, never less, so no line outlives its period by more than a day.</summary>
    public const int MaximumSweepIntervalSeconds = 86_400;

    /// <summary>Whole months a taken-down line's words are kept, then erased; the lawyer sets the number.</summary>
    public int KeepMonthsAfterTakenDown { get; set; } = CoachCertificateKeepingPeriod.DefaultMonths;

    /// <summary>Whether the Worker runs the keeping sweep at all.</summary>
    public bool SweepEnabled { get; set; } = true;

    /// <summary>Seconds between two sweeps: once a day.</summary>
    public int SweepIntervalSeconds { get; set; } = 86_400;

    /// <summary>The keeping period these settings name; call <see cref="Validate"/> first.</summary>
    public CoachCertificateKeepingPeriod KeepingPeriod => new(KeepMonthsAfterTakenDown);

    /// <summary>The first setting that is wrong, named and never quoted; null when every one is right.</summary>
    public string? Validate()
    {
        if (KeepMonthsAfterTakenDown is < CoachCertificateKeepingPeriod.MinimumMonths
            or > CoachCertificateKeepingPeriod.MaximumMonths)
        {
            return string.Create(
                CultureInfo.InvariantCulture,
                $"{SectionName}:KeepMonthsAfterTakenDown must be a whole number of months from {CoachCertificateKeepingPeriod.MinimumMonths} to {CoachCertificateKeepingPeriod.MaximumMonths}.");
        }

        return SweepIntervalSeconds is < MinimumSweepIntervalSeconds or > MaximumSweepIntervalSeconds
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"{SectionName}:SweepIntervalSeconds must be from {MinimumSweepIntervalSeconds} to {MaximumSweepIntervalSeconds} seconds.")
            : null;
    }
}
