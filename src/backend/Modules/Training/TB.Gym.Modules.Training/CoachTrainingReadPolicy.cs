using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// When a coach may read a client's training (TRN-023): the program, a workout and the records. Today's
/// access decides, as for the client, with one difference: before a booked plan begins (a new client,
/// or the gap before a renewal) the coach reads it to prepare, because they may already assign and
/// change programs on its dates (TRN-014). A lapsed, paused or cancelled plan with nothing booked, a
/// blocked relationship or a former client still closes it.
/// </summary>
public static class CoachTrainingReadPolicy
{
    public const string Key = "TodayOrBeforeBookedPlan";
    public const int Version = 1;

    public static bool Opens(FeatureAccessDecision decision, DateOnly today) =>
        decision.IsAllowed ||
        (decision.Reason is FeatureAccessReason.NotStarted or FeatureAccessReason.PaymentRequired &&
         decision.AccessibleFrom > today);
}
