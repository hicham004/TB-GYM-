namespace TB.Gym.Modules.CheckIns;

/// <summary>
/// Overdue check-ins v1 (CHK-015, critique B4a): when a check-in the client has not sent asks for the coach. It
/// reads the missing submission alone: the assignment's due day, whether a sent response exists and whether the
/// client's plan includes check-ins today. An absence is not an answer, so nothing is read into it (CHK-012), and a
/// draft stays the client's own until it is sent (CHK-013): it counts as not sent, and what it holds is never read.
/// </summary>
public static class CheckInAttentionPolicy
{
    public const string Key = "OverdueUnsentCheckIn";
    public const int Version = 1;

    /// <summary>An unsent check-in is overdue once its due day is this many days ago.</summary>
    public const int OverdueAfterDays = 2;

    /// <summary>It stops asking this many days after its due day: by then the next one has usually taken its place.</summary>
    public const int OverdueForDays = 14;

    /// <summary>
    /// The due days an unsent check-in is overdue on: from 13 days before <paramref name="today"/> to 2 days
    /// before it, both included. A reader narrows its query with them; <see cref="IsOverdue"/> decides.
    /// </summary>
    public static (DateOnly FirstDueDay, DateOnly LastDueDay) OverdueDueDays(DateOnly today) =>
        (today.AddDays(1 - OverdueForDays), today.AddDays(-OverdueAfterDays));

    /// <summary>Sent means submitted, reviewed or not; a draft, or no response at all, is not sent (CHK-005).</summary>
    public static bool IsSent(CheckInResponseStatus? response) =>
        response is CheckInResponseStatus.Submitted or CheckInResponseStatus.Reviewed;

    /// <param name="dueDate">The assignment's workspace-local due day (CHK-004).</param>
    /// <param name="response">Its one response's status, or null when the client has not started one.</param>
    /// <param name="checkInsInPlan">Whether the client's plan includes check-ins today, by the shared access decision.</param>
    /// <param name="today">The workspace's today.</param>
    public static bool IsOverdue(
        DateOnly dueDate,
        CheckInResponseStatus? response,
        bool checkInsInPlan,
        DateOnly today)
    {
        var (first, last) = OverdueDueDays(today);
        return checkInsInPlan && !IsSent(response) && dueDate >= first && dueDate <= last;
    }
}
