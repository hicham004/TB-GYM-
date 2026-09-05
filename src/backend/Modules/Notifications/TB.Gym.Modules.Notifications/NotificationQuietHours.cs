namespace TB.Gym.Modules.Notifications;

/// <summary>
/// A half-open local quiet window, `[start, end)`, in the workspace's configured IANA time zone.
/// </summary>
/// <remarks>
/// Half-open for the same reason every other period in this repository is: the end instant belongs to
/// the next interval, so a window ending at 07:00 and one starting at 07:00 do not both contain 07:00
/// and there is no instant that is simultaneously quiet and not quiet.
/// <para>
/// A window whose end is before its start spans midnight, which is what a quiet window normally does.
/// A window whose start equals its end is <b>refused</b> rather than read as a whole day: it is at
/// least as likely to mean an unfinished choice, and guessing wrong either buries every email forever
/// or delivers all of them at 3am.
/// </para>
/// </remarks>
public sealed record NotificationQuietHours
{
    public NotificationQuietHours(TimeOnly startLocal, TimeOnly endLocal)
    {
        if (startLocal == endLocal)
        {
            throw new ArgumentException("Quiet hours must start and end at different local times.");
        }

        StartLocal = startLocal;
        EndLocal = endLocal;
    }

    public TimeOnly StartLocal { get; }

    public TimeOnly EndLocal { get; }

    /// <summary>Whether the window wraps past local midnight, which is the ordinary case.</summary>
    public bool SpansMidnight => EndLocal < StartLocal;

    public static bool TryCreate(
        TimeOnly startLocal,
        TimeOnly endLocal,
        out NotificationQuietHours window,
        out string? error)
    {
        if (startLocal == endLocal)
        {
            window = null!;
            error = "Quiet hours must start and end at different local times.";
            return false;
        }

        window = new NotificationQuietHours(startLocal, endLocal);
        error = null;
        return true;
    }

    /// <summary>
    /// Whether a local wall-clock time falls inside the window. The start boundary is inside and the
    /// end boundary is outside, in both the same-day and the overnight case.
    /// </summary>
    public bool Contains(TimeOnly localTime) => SpansMidnight
        ? localTime >= StartLocal || localTime < EndLocal
        : localTime >= StartLocal && localTime < EndLocal;
}

/// <summary>
/// The named quiet-hours policy, <c>notification-quiet-hours-v1</c>.
/// </summary>
/// <remarks>
/// Two questions, deliberately answered by different code paths.
/// <para>
/// <b>Is this instant quiet?</b> Converting a UTC instant to a local wall-clock time is always
/// unambiguous, in every zone, on every day of the year including both daylight-saving transitions.
/// So membership is decided that way and has no special cases at all: a quiet window that a
/// spring-forward gap removes entirely simply contains no instant that day, and a window an autumn
/// fold repeats simply contains both passes.
/// </para>
/// <para>
/// <b>When does it stop being quiet?</b> This one needs the reverse conversion, which is where the
/// two awkward cases live, so the policy fixes one rule for both and states it:
/// <list type="bullet">
/// <item><description>
/// A local end time that occurs <b>twice</b> — the autumn fold — resolves to its <b>latest</b> UTC
/// instant. Membership treats both passes through a repeated quiet hour as quiet, so releasing at
/// the first occurrence would contradict that rule during the second pass.
/// </description></item>
/// <item><description>
/// A local time that <b>never occurs</b> — the spring-forward gap — resolves to the first local time
/// after it that does occur, which is the instant the gap ends. Quiet hours that end inside a gap end
/// when the clocks finish moving.
/// </description></item>
/// </list>
/// Both rules move forward, never backward, and the result is then re-tested against the window, so a
/// resolved instant that somehow still fell inside quiet hours would be advanced again rather than
/// released. Every instant comes from <c>IClock</c>, so the behaviour is asserted at its boundaries
/// without a test waiting for one.
/// </para>
/// <para>
/// An unknown or structurally invalid time zone fails closed: quiet hours cannot be evaluated, so the
/// caller suppresses rather than guessing that now is a fine time to email somebody.
/// </para>
/// </remarks>
public static class NotificationQuietHoursPolicy
{
    public const string Name = "notification-quiet-hours-v1";

    /// <summary>
    /// A defensive bound on the forward search. Two iterations is the most any real zone needs; the
    /// cap turns an unforeseen zone rule into a bounded, testable answer rather than a hung sweep.
    /// </summary>
    private const int MaximumResolutionRounds = 8;

    /// <summary>The largest gap the policy will step over, in minutes. Real gaps are 30 to 120.</summary>
    private const int MaximumGapMinutes = 24 * 60;

    public static bool IsWithin(DateTimeOffset utcInstant, NotificationQuietHours window, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(zone);
        return window.Contains(LocalTimeAt(utcInstant, zone));
    }

    /// <summary>
    /// The first instant at or after <paramref name="utcInstant"/> that is not inside the window.
    /// Returns the argument unchanged when it is already allowed, so a caller can use one call for
    /// both "may I send now" and "when may I".
    /// </summary>
    public static DateTimeOffset NextAllowedInstantUtc(
        DateTimeOffset utcInstant,
        NotificationQuietHours window,
        TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(zone);

        var candidate = utcInstant;
        for (var round = 0; round < MaximumResolutionRounds; round++)
        {
            var local = TimeZoneInfo.ConvertTime(candidate, zone);
            var localTime = TimeOnly.FromDateTime(local.DateTime);
            if (!window.Contains(localTime))
            {
                return candidate;
            }

            // The next local occurrence of the window's exclusive end. Today when the end is still
            // ahead on the local clock, tomorrow when the window has already wrapped past midnight.
            var localDate = DateOnly.FromDateTime(local.DateTime);
            var endDate = localTime < window.EndLocal ? localDate : localDate.AddDays(1);
            var resolved = ResolveLocalToUtc(
                DateTime.SpecifyKind(endDate.ToDateTime(window.EndLocal), DateTimeKind.Unspecified),
                zone);

            if (resolved <= candidate)
            {
                throw new InvalidOperationException(
                    "The configured quiet-hours boundary did not resolve to a later instant.");
            }

            candidate = resolved;
        }

        throw new InvalidOperationException(
            "The configured quiet-hours window could not be resolved to an allowed instant.");
    }

    /// <summary>
    /// Resolves the configured zone, or reports that it cannot be used. Both an unknown identifier and
    /// a structurally invalid zone are failures rather than a reason to fall back to UTC: quiet hours
    /// evaluated in the wrong frame are worse than quiet hours that refuse to be evaluated.
    /// </summary>
    public static bool TryResolveZone(string? timeZoneId, out TimeZoneInfo zone)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            zone = null!;
            return false;
        }

        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return true;
        }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            zone = null!;
            return false;
        }
    }

    private static TimeOnly LocalTimeAt(DateTimeOffset utcInstant, TimeZoneInfo zone) =>
        TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcInstant, zone).DateTime);

    /// <summary>
    /// One local wall-clock time to one UTC instant, under the documented fold and gap rules.
    /// </summary>
    private static DateTimeOffset ResolveLocalToUtc(DateTime local, TimeZoneInfo zone)
    {
        if (zone.IsAmbiguousTime(local))
        {
            // Two instants share this local end time. The smaller UTC offset is the later instant,
            // which keeps both passes through a repeated quiet hour inside the window.
            var offsets = zone.GetAmbiguousTimeOffsets(local);
            return new DateTimeOffset(local, offsets.Min()).ToUniversalTime();
        }

        if (zone.IsInvalidTime(local))
        {
            // The clocks jumped over this local time, so it never happens. The first local time after
            // it that does happen is the instant the gap ends.
            for (var minutes = 1; minutes <= MaximumGapMinutes; minutes++)
            {
                var shifted = local.AddMinutes(minutes);
                if (!zone.IsInvalidTime(shifted))
                {
                    return ResolveLocalToUtc(shifted, zone);
                }
            }

            throw new InvalidOperationException(
                "The configured time zone reports a daylight-saving gap longer than a day.");
        }

        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }
}
