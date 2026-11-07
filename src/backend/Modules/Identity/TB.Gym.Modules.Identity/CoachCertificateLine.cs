using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// One certificate line (CLI-021, ADR 0039): what a coach showed TB Gym as proof (a certificate, a gym they own,
/// years of coaching, a degree), about that coach in one coaching space, as the platform admin typed it, with the
/// day it was shown, who confirmed it with the coach and who recorded it. Text only: never a copy, a photo or a
/// screenshot of a document. A line is waiting until it is confirmed, the only state a reader may ever see, and is
/// then taken down or erased; a waiting line may be dropped outright, since a "not confirmed" result is not kept.
/// Once confirmed its words, its day and who confirmed it never change (a database trigger) and the row is never
/// deleted: erasing blanks the words and the confirmer's name and keeps the dates and who acted, so the row itself
/// is the history of the erasure without the data. A line is a sentence and nothing more: access, money and
/// sign-up never read it.
/// </summary>
public sealed partial class CoachCertificateLine : TenantEntity
{
    public const int MaximumWhatLength = 120;

    public const int MaximumConfirmedByNameLength = 80;

    /// <summary>The earliest day a line may name, so a missing date is never stored as 0001.</summary>
    public static readonly DateOnly EarliestDay = new(2000, 1, 1);

    private CoachCertificateLine()
    {
    }

    /// <summary>The coach the line is about, staff of <see cref="TenantEntity.TenantId"/> when it was added.</summary>
    public Guid CoachUserId { get; private set; }

    /// <summary>The proof in the coach's words, one line; empty once erased.</summary>
    public string What { get; private set; } = string.Empty;

    /// <summary>The day the coach showed it, in the space's calendar; null once erased.</summary>
    public DateOnly? ShownOn { get; private set; }

    /// <summary>The platform admin who typed the line.</summary>
    public Guid RecordedByUserId { get; private set; }

    public DateTimeOffset? ConfirmedAtUtc { get; private set; }

    /// <summary>Who confirmed it with the coach, as typed; empty once erased, null while waiting.</summary>
    public string? ConfirmedByName { get; private set; }

    /// <summary>
    /// The coach's own switch (notes plan N4b): true from the start, since the coach sent the proof to be shown.
    /// </summary>
    public bool CoachShows { get; private set; }

    public DateTimeOffset? TakenDownAtUtc { get; private set; }

    public Guid? TakenDownByUserId { get; private set; }

    public DateTimeOffset? ErasedAtUtc { get; private set; }

    /// <summary>The platform admin who erased it on a request; null when the keeping period erased it.</summary>
    public Guid? ErasedByUserId { get; private set; }

    public CoachCertificateErasureReason? ErasureReason { get; private set; }

    /// <summary>The day the coach's request to erase arrived; only with <see cref="CoachCertificateErasureReason.Request"/>.</summary>
    public DateOnly? RequestedOn { get; private set; }

    public CoachCertificateLineState State => ErasedAtUtc is not null
        ? CoachCertificateLineState.Erased
        : TakenDownAtUtc is not null
            ? CoachCertificateLineState.TakenDown
            : ConfirmedAtUtc is not null
                ? CoachCertificateLineState.Confirmed
                : CoachCertificateLineState.Waiting;

    /// <summary>
    /// A waiting line about <paramref name="coachUserId"/> in <paramref name="tenantId"/>, shown on
    /// <paramref name="shownOn"/>, a day no later than <paramref name="today"/> in the space's calendar.
    /// Whether the coach is active staff of the space is the caller's to check.
    /// </summary>
    public static CoachCertificateLine Add(
        Guid tenantId,
        Guid coachUserId,
        string? what,
        DateOnly? shownOn,
        DateOnly today,
        Guid recordedByUserId)
    {
        if (tenantId == Guid.Empty || coachUserId == Guid.Empty || recordedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A certificate line needs its coaching space, its coach and who recorded it.");
        }

        var words = NormalizeWhat(what);
        var day = NormalizeShownOn(shownOn, today);
        return new CoachCertificateLine
        {
            TenantId = tenantId,
            CoachUserId = coachUserId,
            What = words,
            ShownOn = day,
            RecordedByUserId = recordedByUserId,
            CoachShows = true,
        };
    }

    /// <summary>
    /// The words as they are stored: trimmed, every run of spaces made one, on one line, 1 to 120 characters, and
    /// none of the words TB Gym keeps out of a coach's line. The refusal names the field, never the words.
    /// </summary>
    public static string NormalizeWhat(string? what)
    {
        var words = NormalizeLine(what, MaximumWhatLength, CoachCertificateText.WhatRequired, nameof(what));
        return RefusedWords().IsMatch(words)
            ? throw new ArgumentException(CoachCertificateText.WhatRefused, nameof(what))
            : words;
    }

    /// <summary>Who confirmed a line with the coach, as it is stored: trimmed, on one line, 1 to 80 characters.</summary>
    public static string NormalizeConfirmedByName(string? confirmedByName) =>
        NormalizeLine(
            confirmedByName,
            MaximumConfirmedByNameLength,
            CoachCertificateText.ConfirmedByNameRequired,
            nameof(confirmedByName));

    /// <summary>The day a coach showed their proof: from 1 January 2000 to today in the space's calendar.</summary>
    public static DateOnly NormalizeShownOn(DateOnly? shownOn, DateOnly today) =>
        PastOrToday(shownOn, today, CoachCertificateText.ShownOnRequired, nameof(shownOn));

    /// <summary>The day a coach asked for their lines to be erased: from 1 January 2000 to today.</summary>
    public static DateOnly NormalizeRequestedOn(DateOnly? requestedOn, DateOnly today) =>
        PastOrToday(requestedOn, today, CoachCertificateText.RequestedOnRequired, nameof(requestedOn));

    /// <summary>Marks a waiting line confirmed now, by the person who confirmed it with the coach.</summary>
    public void Confirm(string? confirmedByName, DateTimeOffset now)
    {
        var name = NormalizeConfirmedByName(confirmedByName);
        if (State != CoachCertificateLineState.Waiting)
        {
            throw new InvalidOperationException(CoachCertificateText.ConfirmNotWaiting);
        }

        ConfirmedAtUtc = now;
        ConfirmedByName = name;
    }

    /// <summary>Only a waiting line may be dropped; nothing about it is kept.</summary>
    public void EnsureCanDrop()
    {
        if (State != CoachCertificateLineState.Waiting)
        {
            throw new InvalidOperationException(CoachCertificateText.DropNotWaiting);
        }
    }

    /// <summary>A confirmed line stops showing for good; its words are kept for the keeping period (N4b).</summary>
    public void TakeDown(Guid byUserId, DateTimeOffset now)
    {
        if (byUserId == Guid.Empty)
        {
            throw new ArgumentException("A take-down needs who took the line down.", nameof(byUserId));
        }

        if (State != CoachCertificateLineState.Confirmed)
        {
            throw new InvalidOperationException(CoachCertificateText.TakeDownNotConfirmed);
        }

        TakenDownAtUtc = now;
        TakenDownByUserId = byUserId;
    }

    /// <summary>
    /// Erases a confirmed or taken-down line on the coach's request of <paramref name="requestedOn"/>: the words
    /// and the confirmer's name are blanked, the day shown goes, and the dates and who acted stay. Nothing changes
    /// afterwards. A waiting line is dropped instead (<see cref="EnsureCanDrop"/>).
    /// </summary>
    public void EraseOnRequest(Guid byUserId, DateOnly requestedOn, DateTimeOffset now)
    {
        if (byUserId == Guid.Empty)
        {
            throw new ArgumentException("An erasure on request needs who erased it.", nameof(byUserId));
        }

        if (State is not (CoachCertificateLineState.Confirmed or CoachCertificateLineState.TakenDown))
        {
            throw new InvalidOperationException(CoachCertificateText.EraseNotConfirmed);
        }

        What = string.Empty;
        ShownOn = null;
        ConfirmedByName = string.Empty;
        ErasedAtUtc = now;
        ErasedByUserId = byUserId;
        ErasureReason = CoachCertificateErasureReason.Request;
        RequestedOn = requestedOn;
    }

    private static DateOnly PastOrToday(DateOnly? day, DateOnly today, string missing, string parameterName)
    {
        if (day is not { } value)
        {
            throw new ArgumentException(missing, parameterName);
        }

        return value > today
            ? throw new ArgumentException(CoachCertificateText.DayAfterToday, parameterName)
            : value < EarliestDay
                ? throw new ArgumentException(CoachCertificateText.DayTooEarly, parameterName)
                : value;
    }

    private static string NormalizeLine(string? value, int maxLength, string missing, string parameterName)
    {
        var raw = value ?? string.Empty;
        if (raw.Any(character => char.IsControl(character) && character is not '\t'))
        {
            throw new ArgumentException(CoachCertificateText.OneLine, parameterName);
        }

        var builder = new StringBuilder(raw.Length);
        var lastWasSpace = false;
        foreach (var character in raw.Trim())
        {
            var isSpace = char.IsWhiteSpace(character);
            if (isSpace && lastWasSpace)
            {
                continue;
            }

            builder.Append(isSpace ? ' ' : character);
            lastWasSpace = isSpace;
        }

        var normalized = builder.ToString();
        if (normalized.Length == 0)
        {
            throw new ArgumentException(missing, parameterName);
        }

        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException(
                string.Create(CultureInfo.InvariantCulture, $"Use {maxLength} characters or fewer."),
                parameterName);
    }

    /// <summary>
    /// The words a coach's line never holds, as whole words in any case: the four TB Gym keeps for its own promises
    /// ("verified", "licensed", "qualified", "approved"), never a coach's proof, and the protected health titles
    /// ("physiotherapist", "physical therapist", "physio", with their plurals, the two words of "physical therapist"
    /// apart by spaces or a dash), which the notes plan's Point 2 allows only with a check against the Order that
    /// decision 7 does not make. "Physiotherapy", a degree's name, passes.
    /// </summary>
    [GeneratedRegex(
        @"\b(?:verified|licensed|qualified|approved|physiotherapists?|physical[\s\p{Pd}]+therapists?|physios?)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex RefusedWords();
}

public enum CoachCertificateLineState
{
    Waiting = 1,
    Confirmed = 2,
    TakenDown = 3,
    Erased = 4,
}

public enum CoachCertificateErasureReason
{
    /// <summary>The coach asked; the platform admin erased every line of theirs in the space.</summary>
    Request = 1,

    /// <summary>The keeping period after a take-down ran out (notes plan N4b's sweep).</summary>
    KeepingPeriod = 2,
}

/// <summary>
/// The sentence a reader sees for a confirmed line, version 1: a placeholder until the lawyer's words replace it,
/// in this one place (CLI-021). The date is written in the coaching space's own language, never the reader's.
/// </summary>
public static class CoachCertificateLineWording
{
    public const int Version = 1;

    /// <summary>"&lt;what&gt;, shown to TB Gym on &lt;date&gt;".</summary>
    public const string Sentence = "{0}, shown to TB Gym on {1}";

    /// <summary>The date as "3 Nov 2026" in English; Arabic gives its own month name with the same digits.</summary>
    public const string DateFormat = "d MMM yyyy";

    private static readonly CompositeFormat SentenceFormat = CompositeFormat.Parse(Sentence);

    /// <summary>
    /// The sentence for <paramref name="what"/> shown on <paramref name="shownOn"/>, the day written in
    /// <paramref name="culture"/>, the coaching space's language (English when it cannot be read).
    /// </summary>
    public static string Compose(string what, DateOnly shownOn, string? culture)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(what);
        CultureInfo language;
        try
        {
            // Predefined only: ICU would otherwise make up a culture for any well-formed name and write the
            // machine's own month names.
            language = CultureInfo.GetCultureInfo(
                string.IsNullOrWhiteSpace(culture) ? "en-LB" : culture.Trim(),
                predefinedOnly: true);
        }
        catch (CultureNotFoundException)
        {
            language = CultureInfo.GetCultureInfo("en-LB");
        }

        return string.Format(
            CultureInfo.InvariantCulture,
            SentenceFormat,
            what,
            shownOn.ToString(DateFormat, language));
    }
}

/// <summary>
/// Every sentence and code the certificate record answers with, in one place so a test can read them all: none
/// holds a word the record refuses, nor "certified", and none repeats what a line says.
/// </summary>
public static class CoachCertificateText
{
    public const string WhatRequired = "Write what the coach showed: the certificate, the gym, the years.";

    public const string WhatRefused =
        "This line holds a word TB Gym keeps out of a coach's line. Write what the proof is: the certificate, the gym, the years.";

    public const string OneLine = "Write it on one line.";

    public const string ShownOnRequired = "Choose the day the coach showed it.";

    public const string RequestedOnRequired = "Choose the day the coach asked.";

    public const string DayAfterToday = "Choose today or an earlier day.";

    public const string DayTooEarly = "Choose a day from 1 January 2000 to today.";

    public const string ConfirmedByNameRequired = "Write who confirmed it with the coach.";

    public const string VersionRequired = "Read the lines again, then try once more.";

    public const string ChangedCode = "certificate_line_changed";

    public const string Changed = "This line changed since the page read it. Read the lines again, then try once more.";

    public const string StateCode = "certificate_line_state";

    public const string ConfirmNotWaiting = "This line is no longer waiting for confirmation. Read the lines again.";

    public const string DropNotWaiting = "Only a line still waiting for confirmation can be dropped. Take a confirmed line down instead.";

    public const string TakeDownNotConfirmed = "Only a confirmed line that is still up can be taken down.";

    public const string EraseNotConfirmed = "Only a confirmed or taken-down line is erased; a waiting one is dropped.";
}
