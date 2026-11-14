using System.Security.Cryptography;
using System.Text;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// The house's tiers (notes plan N9, the owner's reading of 11 Nov 2026): Free, TB Gym's exercise pool and workouts
/// of one's own, with no end; Pro+, the trainer partner's programs; Max, TB Gym coaching the trainee. A tier is named
/// on one of the house's products and copied onto each of its enrollments (SUB-019). Pro, the app's maths for
/// someone training alone, comes later (decision 32) and is not a value yet.
/// </summary>
public enum HouseTier
{
    Free = 1,
    ProPlus = 2,
    Max = 3,
}

/// <summary>
/// Free in the house (SUB-019, notes plan N9b1): an ordinary coaching plan with one zero-price option covering
/// Training beside any other plan, which the server starts the day a trainee's sign-up is confirmed and renews by
/// itself before its last day, each time as a new row linked to the last and following it with no gap. A trainee
/// never reads its end date, so its length is plumbing, not an owner's figure.
/// </summary>
public static class HouseFreePlanRule
{
    /// <summary>The plan's name and its option's, as the house's staff see them in Plans you sell.</summary>
    public const string Name = "Free";

    /// <summary>One row's length: a year of days, so a renewal is a rare event in anybody's history.</summary>
    public const int LengthInDays = 365;

    /// <summary>
    /// How many days before a row's exclusive end the Worker adds the next one: a month of slack, so a Worker that is
    /// down for days still renews in time, and Training is never left without cover.
    /// </summary>
    public const int RenewWithinDays = 30;

    /// <summary>What Free covers: Training, beside whatever other plan covers it (SUB-004's stated exception).</summary>
    public static IReadOnlyList<OfferFeatureDefinition> Features { get; } =
        [new OfferFeatureDefinition(CoachingFeature.Training, AllowsConcurrentCoverage: true)];

    /// <summary>A renewal starts on the day the row it follows ends: half-open periods leave no gap and no overlap.</summary>
    public static DateOnly RenewalStart(DateOnly previousEndExclusive) => previousEndExclusive;

    /// <summary>
    /// The latest exclusive end a row may have and be due its renewal on <paramref name="today"/>: every row ending on
    /// or before it, one already ended included, is renewed. The Worker's sweep reads its rows by it.
    /// </summary>
    public static DateOnly DueBy(DateOnly today) => today.AddDays(RenewWithinDays);

    /// <summary>Whether a row ending on <paramref name="endExclusive"/> is due its renewal on <paramref name="today"/>.</summary>
    public static bool IsDueForRenewal(DateOnly endExclusive, DateOnly today) => endExclusive <= DueBy(today);

    /// <summary>
    /// The assignment command id of a profile's first Free row: one per profile, so a confirmation that runs twice, or
    /// two that race, start Free once (the unique index on the command id settles it).
    /// </summary>
    public static Guid StartCommandId(Guid clientProfileId) =>
        NameBased($"tbgym/house-free/start/{clientProfileId:N}");

    /// <summary>The assignment command id of the row renewing <paramref name="previousEnrollmentId"/>: one renewal a row.</summary>
    public static Guid RenewalCommandId(Guid previousEnrollmentId) =>
        NameBased($"tbgym/house-free/renewal/{previousEnrollmentId:N}");

    /// <summary>
    /// A name-based id (RFC 9562 version 8): the first 16 bytes of the name's SHA-256, never equal to the version 4
    /// ids the screens send as command ids.
    /// </summary>
    private static Guid NameBased(string name)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(name), hash);
        hash[6] = (byte)((hash[6] & 0x0F) | 0x80);
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
        return new Guid(hash[..16], bigEndian: true);
    }
}

/// <summary>One of a trainee's plans as the tier read sees it: its tier, its dates, its state and its money.</summary>
public sealed record HouseTierCandidate(
    HouseTier Tier,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    EnrollmentStatus Status,
    decimal PriceAmount,
    decimal PaidAmount);

/// <summary>
/// Which tier a trainee is on (SUB-019): the highest tier among the house's plans that grant today, read as feature
/// access grants (SUB-009): a plan covering the day, active and paid in full, Free being paid at its price of nothing.
/// A paid plan still waiting for its money, paused, cancelled, ended or yet to start grants no tier, so the trainee
/// reads Free under it; a relationship block grants none at all.
/// </summary>
public static class HouseTierRule
{
    public static HouseTier? TierOn(
        IEnumerable<HouseTierCandidate> candidates,
        DateOnly today,
        bool relationshipBlocked)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        if (relationshipBlocked)
        {
            return null;
        }

        HouseTier? highest = null;
        foreach (var candidate in candidates)
        {
            if (Grants(candidate, today) && (highest is null || candidate.Tier > highest))
            {
                highest = candidate.Tier;
            }
        }

        return highest;
    }

    /// <summary>
    /// Whether the house coaches a self-directed trainee on a day (CLI-026 as notes plan N9c5 amends it): while Max
    /// grants, the four things a coach's client gets, and their own coach again the day it stops. Free and Pro+ leave
    /// them their own coach, and so does no tier at all.
    /// </summary>
    public static bool CoachesTheTrainee(HouseTier? tierToday) => tierToday == HouseTier.Max;

    private static bool Grants(HouseTierCandidate candidate, DateOnly today) =>
        candidate.StartDate <= today &&
        today < candidate.EndDateExclusive &&
        candidate.Status == EnrollmentStatus.Active &&
        candidate.PaidAmount >= candidate.PriceAmount;
}

/// <summary>
/// How far back a trainee's own Progress reaches (PRG-015, "FreeProgressReach" 1.0): on Free, the house's window of
/// days ending today, <c>[today - days + 1, today + 1)</c>, as the dashboard's own windows end on today; on any paid
/// tier, outside the house, on no tier, or while the window is empty, no limit. What is older is kept and shows again
/// the day a paid plan grants.
/// </summary>
public static class FreeProgressReachRule
{
    public const string MethodKey = "FreeProgressReach";

    public const string MethodVersion = "1.0";

    /// <summary>The earliest day a trainee's own Progress shows today; null when nothing limits it.</summary>
    public static DateOnly? EarliestShown(HouseTier? tier, int? windowDays, DateOnly today) =>
        tier == HouseTier.Free && windowDays is > 0
            ? DateOnly.FromDayNumber(Math.Max(DateOnly.MinValue.DayNumber, today.DayNumber - windowDays.Value + 1))
            : null;
}

/// <summary>
/// The Worker's sweep of Free (SUB-019): each current trainee's last Free row renewed before it ends, and Free started
/// for a self-directed trainee of the house who has none (one who joined before Free existed, or whose confirmation
/// could not start it).
/// </summary>
public interface IHouseFreePlanRenewal
{
    Task<HouseFreePlanRenewalResult> RunAsync(CancellationToken cancellationToken);
}

/// <param name="Started">Trainees whose Free was started by the sweep.</param>
/// <param name="Renewed">Free rows renewed.</param>
/// <param name="Skipped">Trainees left for the next sweep: another run got there first, or a write failed.</param>
public sealed record HouseFreePlanRenewalResult(int Started, int Renewed, int Skipped);

/// <summary>Free is the server's: nobody books, renews, pauses, cancels, edits or reprices it by hand (SUB-019).</summary>
public sealed class HouseFreePlanException()
    : InvalidOperationException(
        "Free is TB Gym's own plan for people training on their own: it starts and renews by itself, and nobody changes it by hand.")
{
    public const string Code = "house_free_plan";
}
