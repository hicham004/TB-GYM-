namespace TB.Gym.Modules.Training;

/// <summary>
/// Training signals v1 (TRN-021, R3.1): what a coach is shown about a client's training. Missed
/// sessions read session state v1 (TRN-020), so a session the client could not see is never missed.
/// </summary>
public static class TrainingAttentionPolicy
{
    public const string Key = "MissedSinceLastWorkoutAndUnsharedWeek";
    public const int Version = 1;

    /// <summary>How many days back missed sessions are counted.</summary>
    public const int MissedLookbackDays = 14;

    /// <summary>An unshared week is flagged while it runs, or once it starts within this many days.</summary>
    public const int UnsharedWeekLeadDays = 2;

    /// <summary>
    /// Sessions missed since the client last started a workout, looking back at most
    /// <see cref="MissedLookbackDays"/>. A client who trained after missing sessions is back on track,
    /// so only the misses after their latest workout count.
    /// </summary>
    /// <param name="sessions">Sessions of weeks the client can see, from blocks that were not cancelled.</param>
    /// <param name="lastWorkoutStartedOn">The workspace date the client last started any workout.</param>
    public static int MissedSinceLastWorkout(
        IEnumerable<AttentionSession> sessions,
        DateOnly? lastWorkoutStartedOn,
        DateOnly today)
    {
        var from = today.AddDays(-MissedLookbackDays);
        if (lastWorkoutStartedOn is { } last && last >= from)
        {
            from = last.AddDays(1);
        }

        return sessions.Count(session =>
            session.ScheduledDate >= from &&
            ClientSessionStatePolicy.Evaluate(session.ScheduledDate, today, session.Workout) ==
                ClientSessionState.Missed);
    }

    /// <summary>
    /// The earliest week of an open block that is running, or starts within
    /// <see cref="UnsharedWeekLeadDays"/>, and is not shared with the client; otherwise null.
    /// </summary>
    /// <param name="weeks">Weeks of blocks neither cancelled nor completed, ending after today.</param>
    public static AttentionWeek? WeekToShare(IEnumerable<AttentionWeek> weeks, DateOnly today) =>
        weeks
            .Where(week => !week.IsPublished &&
                           week.StartsOn <= today.AddDays(UnsharedWeekLeadDays) &&
                           week.StartsOn.AddDays(7) > today)
            .OrderBy(week => week.StartsOn)
            .ThenBy(week => week.WeekNumber)
            .FirstOrDefault();
}

/// <summary>One programmed session as the attention rule reads it: its date and its workout, if any.</summary>
public sealed record AttentionSession(DateOnly ScheduledDate, WorkoutExecutionStatus? Workout);

/// <summary>One week of an open block as the attention rule reads it.</summary>
public sealed record AttentionWeek(Guid MesocycleId, int WeekNumber, DateOnly StartsOn, bool IsPublished);
