using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

public readonly record struct SubscriptionPeriod
{
    public SubscriptionPeriod(DateOnly start, DateOnly endExclusive)
    {
        if (endExclusive <= start)
        {
            throw new ArgumentOutOfRangeException(nameof(endExclusive), "End must be after start.");
        }

        Start = start;
        EndExclusive = endExclusive;
    }

    public DateOnly Start { get; }

    public DateOnly EndExclusive { get; }

    public DateOnly LastActiveDate => EndExclusive.AddDays(-1);

    public static SubscriptionPeriod ForWeeks(DateOnly start, int weeks)
    {
        if (weeks <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(weeks), "Duration must be positive.");
        }

        return new SubscriptionPeriod(start, start.AddDays(checked(weeks * 7)));
    }

    public bool Overlaps(SubscriptionPeriod other) =>
        Start < other.EndExclusive && other.Start < EndExclusive;
}

public enum PaymentStanding
{
    Pending = 1,
    Paid = 2,
    Overdue = 3,
    Refunded = 4,
    Waived = 5,
}

public enum AccountAccessLevel
{
    Denied = 1,
    ProfileOnly = 2,
    Full = 3,
}

public sealed record AccountAccessState(
    bool IsPlatformBlocked,
    bool IsCoachBlocked,
    bool HasActiveMembership,
    bool HasCurrentSubscription,
    PaymentStanding PaymentStanding);

public static class AccountAccessPolicy
{
    public static AccountAccessLevel Evaluate(AccountAccessState state)
    {
        ArgumentNullException.ThrowIfNull(state);

        if (state.IsPlatformBlocked || state.IsCoachBlocked || !state.HasActiveMembership)
        {
            return AccountAccessLevel.Denied;
        }

        if (!state.HasCurrentSubscription ||
            state.PaymentStanding is PaymentStanding.Pending or PaymentStanding.Overdue)
        {
            return AccountAccessLevel.ProfileOnly;
        }

        return AccountAccessLevel.Full;
    }
}

public sealed class SubscriptionsModule : IModuleMarker
{
    public const string Name = "Subscriptions";
}
