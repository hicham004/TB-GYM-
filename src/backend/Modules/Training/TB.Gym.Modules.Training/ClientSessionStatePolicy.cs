namespace TB.Gym.Modules.Training;

/// <summary>Where a client stands with one programmed session, as their Training page shows it.</summary>
public enum ClientSessionState
{
    Completed = 1,
    InProgress = 2,
    Missed = 3,
    Today = 4,
    Upcoming = 5,
}

/// <summary>
/// Session state v1 (TRN-020): the workout decides first, so a completed or started session keeps
/// that state on any day. Only a session never started is judged by its date against the
/// workspace's today: before it is missed, on it is today, after it is still to come.
/// </summary>
public static class ClientSessionStatePolicy
{
    public const string Key = "WorkoutThenScheduledDate";
    public const int Version = 1;

    public static ClientSessionState Evaluate(
        DateOnly scheduledDate,
        DateOnly today,
        WorkoutExecutionStatus? workout) =>
        workout switch
        {
            WorkoutExecutionStatus.Completed => ClientSessionState.Completed,
            WorkoutExecutionStatus.InProgress => ClientSessionState.InProgress,
            _ when scheduledDate < today => ClientSessionState.Missed,
            _ when scheduledDate == today => ClientSessionState.Today,
            _ => ClientSessionState.Upcoming,
        };
}
