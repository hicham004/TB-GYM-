using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// When a client reads a program before its first day (TRN-023, critique B18): the coach chose Now, and
/// the plan that will grant training on that day is already paid in full and lasts to the program's last
/// day, so a plan waiting for payment or part paid shows nothing. It never opens wider than the coach's
/// own read, so a paused, cancelled or blocked client stays closed whatever is booked for later. Reading
/// starts nothing: a workout still waits for its day (TRN-020).
/// </summary>
public static class ProgramShownEarlyPolicy
{
    public const string Key = "PaidPlanCoversProgram";
    public const int Version = 1;

    public static bool Opens(
        FeatureAccessDecision today,
        DateOnly tenantToday,
        FeatureAccessDecision onFirstDay,
        DateOnly programEndExclusive) =>
        CoachTrainingReadPolicy.Opens(today, tenantToday) &&
        onFirstDay.IsAllowed &&
        onFirstDay.AccessibleUntilExclusive >= programEndExclusive;
}
