using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>One of the house's Max plans as the places read sees it: whose it is, where it stands and when it ends.</summary>
public sealed record MaxPlacePlan(Guid ClientProfileId, EnrollmentStatus Status, DateOnly EndDateExclusive);

/// <summary>
/// An ask for Max with no outcome yet, as the line reads it: the ask, whose it is, and whether its trainee has said its
/// money was sent, which they may only while its place is open, so the place stays theirs until the ask is booked or
/// closed.
/// </summary>
public sealed record MaxPlaceAsk(Guid AskId, Guid ClientProfileId, bool MoneySent = false);

/// <summary>Where one open ask for Max stands on the house's day.</summary>
/// <param name="PlaceInLine">
/// Its 1-based place among the open asks of trainees who hold no place, in the order asked; null when its trainee
/// already holds a place, since a renewal never queues.
/// </param>
/// <param name="PlaceOpen">
/// Whether it has a place now, while Max is open: its trainee holds one, or it is near enough the front of the line for
/// the places still free.
/// </param>
public sealed record MaxAskPlace(Guid AskId, Guid ClientProfileId, int? PlaceInLine, bool PlaceOpen);

/// <summary>Max's places on one of the house's days, as <see cref="MaxPlacesRule"/> counts them (SUB-021).</summary>
public sealed class MaxPlaces
{
    private readonly Dictionary<Guid, MaxAskPlace> byAsk;

    internal MaxPlaces(int? places, IReadOnlySet<Guid> holders, IReadOnlyList<MaxAskPlace> asks)
    {
        Places = places;
        Holders = holders;
        Asks = asks;
        byAsk = asks.ToDictionary(ask => ask.AskId);
    }

    /// <summary>The house's setting: how many trainees Max coaches at a time; empty or zero keeps Max closed.</summary>
    public int? Places { get; }

    /// <summary>Whether Max is open: its places are filled and above zero.</summary>
    public bool IsOpen => MaxPlacesRule.IsOpen(Places);

    /// <summary>
    /// The trainees holding a place, each once: by a Max plan still to end, or by an open ask whose money they said was
    /// sent.
    /// </summary>
    public IReadOnlySet<Guid> Holders { get; }

    /// <summary>The places nobody holds: never below zero, and none while Max is closed.</summary>
    public int Free => MaxPlacesRule.FreePlaces(Places, Holders.Count);

    /// <summary>Every open ask for Max, in the order asked: the line, and the asks of trainees who hold a place.</summary>
    public IReadOnlyList<MaxAskPlace> Asks { get; }

    /// <summary>How many asks wait in the line: open asks of trainees who hold no place.</summary>
    public int Waiting => Asks.Count(ask => ask.PlaceInLine is not null);

    /// <summary>
    /// Whether the trainee holds a place: a Max plan of theirs, booked and still to end, or an open ask of theirs whose
    /// money they said was sent.
    /// </summary>
    public bool Holds(Guid clientProfileId) => Holders.Contains(clientProfileId);

    /// <summary>Where an open ask for Max stands; null for an ask that is not open or not for Max.</summary>
    public MaxAskPlace? PlaceOf(Guid askId) => byAsk.GetValueOrDefault(askId);

    /// <summary>
    /// Whether an ask from this trainee would have a place now: Max is open, and they hold one, or more places are free
    /// than the line holds asks of other trainees.
    /// </summary>
    public bool WouldHaveAPlace(Guid clientProfileId) =>
        IsOpen &&
        (Holds(clientProfileId) ||
            Free > Asks.Count(ask => ask.PlaceInLine is not null && ask.ClientProfileId != clientProfileId));

    /// <summary>
    /// Whether a Max plan may be booked for this trainee now: Max is open, and they hold a place (their next pass keeps
    /// it, as does an ask whose money they said was sent) or one is free. The line's order is told, not enforced: an
    /// earlier ask whose money was not said sent holds no place.
    /// </summary>
    public bool MayBook(Guid clientProfileId) => IsOpen && (Holds(clientProfileId) || Free > 0);
}

/// <summary>
/// Max's places (SUB-021, "MaxPlaces" 1.0): Max coaches as many trainees at a time as the house's setting says, the
/// trainer partner's hours, and is closed while the setting is empty or zero. A place is held from the booking: by each
/// trainee with a Max plan not cancelled and still to end on the house's day (paused, running, or booked to start later),
/// and a trainee who holds one keeps it for their next pass. An ask books nothing and holds no place until its trainee
/// says its money was sent, which they may only while its place is open: from then the place is theirs until the ask is
/// booked or closed, so nobody told to pay loses the place to a later booking or to the end of a pass. The other open
/// asks wait in a line in the order asked, which says who may pay first. This rule holds no figure of its own.
/// </summary>
public static class MaxPlacesRule
{
    public const string MethodKey = "MaxPlaces";

    public const string MethodVersion = "1.0";

    /// <summary>The trainee's "I've paid" while their ask's place is not open yet.</summary>
    public const string PlaceNotOpenMessage =
        "A Max place isn't open for you yet. Your ask is kept in line; don't send money until a place opens.";

    /// <summary>The trainee's "I've paid" while Max is closed.</summary>
    public const string ClosedForTraineeMessage =
        "Max isn't taking anyone right now. Your ask is kept; don't send money until it opens again.";

    /// <summary>The staff's booking while Max is closed.</summary>
    public const string ClosedForStaffMessage =
        "Max is closed: TB Gym's settings give it no places. Book this ask once Max opens again, or close it.";

    /// <summary>The staff's booking of a trainee who holds no place while every place is taken.</summary>
    public const string FullMessage =
        "Every place on Max is taken. Book this ask once a place opens, or close it.";

    /// <summary>Whether Max is open: the house's places are filled and above zero.</summary>
    public static bool IsOpen(int? places) => places is > 0;

    /// <summary>
    /// Whether a Max plan holds its trainee's place on <paramref name="houseToday"/>: from its booking until it ends,
    /// whatever it stands at, unless it was cancelled.
    /// </summary>
    public static bool HoldsAPlace(MaxPlacePlan plan, DateOnly houseToday)
    {
        ArgumentNullException.ThrowIfNull(plan);
        return plan.Status != EnrollmentStatus.Cancelled && plan.EndDateExclusive > houseToday;
    }

    /// <summary>The places nobody holds: the setting less the trainees holding one, never below zero; none while closed.</summary>
    public static int FreePlaces(int? places, int held) =>
        IsOpen(places) ? Math.Max(0, places!.Value - Math.Max(0, held)) : 0;

    /// <summary>
    /// Max's places on <paramref name="houseToday"/>: who holds one, how many are free, and where each open ask stands.
    /// <paramref name="openAsksInOrder"/> are the open asks for Max of the house's current trainees, already in the
    /// order asked (time asked, then id, as the database orders them); one open ask a trainee at a time (SUB-020). An ask
    /// whose money was said sent holds its trainee's place, as a booked plan does.
    /// </summary>
    public static MaxPlaces On(
        int? places,
        IEnumerable<MaxPlacePlan> plans,
        IEnumerable<MaxPlaceAsk> openAsksInOrder,
        DateOnly houseToday)
    {
        ArgumentNullException.ThrowIfNull(plans);
        ArgumentNullException.ThrowIfNull(openAsksInOrder);
        var holders = plans
            .Where(plan => HoldsAPlace(plan, houseToday))
            .Select(plan => plan.ClientProfileId)
            .ToHashSet();
        var asksInOrder = openAsksInOrder.ToList();
        foreach (var ask in asksInOrder)
        {
            ArgumentNullException.ThrowIfNull(ask);
            if (ask.MoneySent)
            {
                holders.Add(ask.ClientProfileId);
            }
        }

        var open = IsOpen(places);
        var free = FreePlaces(places, holders.Count);
        var position = 0;
        var asks = new List<MaxAskPlace>();
        foreach (var ask in asksInOrder)
        {
            if (holders.Contains(ask.ClientProfileId))
            {
                asks.Add(new MaxAskPlace(ask.AskId, ask.ClientProfileId, PlaceInLine: null, PlaceOpen: open));
                continue;
            }

            position++;
            asks.Add(new MaxAskPlace(ask.AskId, ask.ClientProfileId, position, open && position <= free));
        }

        return new MaxPlaces(places, holders, asks);
    }
}

/// <summary>
/// What a Max plan is (notes plan N9c5): TB Gym coaching the trainee, so each of its options covers the four things a
/// coach's client gets, all four and nothing else; and it is booked only from the trainee's ask, where its places are
/// counted, never by the coaches' ordinary routes.
/// </summary>
public static class MaxPlanRule
{
    public const string FeaturesRefusal = "A Max plan covers Training, Nutrition, Check-ins and Messaging, all four.";

    public const string ByAskRefusal = "Max is booked from the trainee's ask, so its places are kept.";

    /// <summary>The four things a Max option covers, in the features' own order.</summary>
    public static IReadOnlyList<CoachingFeature> Features { get; } =
        [CoachingFeature.Training, CoachingFeature.Nutrition, CoachingFeature.CheckIns, CoachingFeature.Messaging];

    /// <summary>Whether an option's features are exactly Max's four, each once.</summary>
    public static bool CoversItsFour(IEnumerable<CoachingFeature> features)
    {
        ArgumentNullException.ThrowIfNull(features);
        var given = features.ToArray();
        return given.Length == Features.Count && given.Order().SequenceEqual(Features);
    }
}
