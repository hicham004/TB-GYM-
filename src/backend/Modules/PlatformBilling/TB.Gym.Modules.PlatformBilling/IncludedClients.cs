using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.PlatformBilling;

/// <summary>
/// Extra included clients the platform admin grants a founding space (notes plan N11a, decision 17: a
/// thank-you for each coach a founding coach brings, PBL-011). The admin types the clients and the months;
/// none is a constant in code. Days are UTC calendar days, half-open <c>[StartsOn, EndsOnExclusive)</c>, each
/// the first day of a month, so a grant counts in exactly the invoices of the months it names, and grants
/// that touch one month add up. It is never edited or deleted: the admin can revoke it once, and the
/// revocation is kept. Database triggers are the guarantee.
/// </summary>
public sealed class IncludedClientGrant : TenantEntity
{
    public const int MinimumClients = 1;

    public const int MaximumClients = 1_000;

    private IncludedClientGrant()
    {
    }

    public int Clients { get; private set; }

    public DateOnly StartsOn { get; private set; }

    public DateOnly EndsOnExclusive { get; private set; }

    /// <summary>What it is for, such as which coach was brought. Only TB Gym's admin reads it.</summary>
    public string Note { get; private set; } = string.Empty;

    public DateTimeOffset GrantedAtUtc { get; private set; }

    public Guid GrantedByUserId { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    public Guid? RevokedByUserId { get; private set; }

    public bool IsRevoked => RevokedAtUtc is not null;

    public DateTimeOffset StartsAtUtc => new(StartsOn.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    public DateTimeOffset EndsAtUtc => new(EndsOnExclusive.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    /// <summary>
    /// The field-level problems with a grant, empty when it can be granted: whole clients from 1 to 1,000,
    /// whole calendar months (its first day and the day after its last each the first of a month, from
    /// 2000 on), and a note of up to 200 characters.
    /// </summary>
    public static IReadOnlyDictionary<string, string[]> Validate(
        int clients,
        DateOnly startsOn,
        DateOnly endsOnExclusive,
        string? note)
    {
        var errors = new Dictionary<string, string[]>();
        if (clients is < MinimumClients or > MaximumClients)
        {
            errors[nameof(Clients)] = [FoundingText.GrantClientsInvalid];
        }

        if (startsOn.Day != 1)
        {
            errors[nameof(StartsOn)] = [FoundingText.GrantStartsOnInvalid];
        }
        else if (startsOn < FoundingText.EarliestFoundingSince)
        {
            errors[nameof(StartsOn)] = [FoundingText.GrantStartsOnTooEarly];
        }

        if (endsOnExclusive.Day != 1)
        {
            errors[nameof(EndsOnExclusive)] = [FoundingText.GrantEndsOnInvalid];
        }
        else if (endsOnExclusive <= startsOn)
        {
            errors[nameof(EndsOnExclusive)] = [FoundingText.GrantEndsBeforeStart];
        }

        var trimmed = note?.Trim() ?? string.Empty;
        if (trimmed.Length is 0 or > FoundingText.GrantNoteMaxLength)
        {
            errors[nameof(Note)] = [FoundingText.GrantNoteInvalid];
        }

        return errors;
    }

    public static IncludedClientGrant Grant(
        Guid tenantId,
        int clients,
        DateOnly startsOn,
        DateOnly endsOnExclusive,
        string note,
        Guid grantedByUserId,
        DateTimeOffset now)
    {
        if (tenantId == Guid.Empty || grantedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A coaching space and the granting admin are required.");
        }

        var errors = Validate(clients, startsOn, endsOnExclusive, note);
        if (errors.TryGetValue(nameof(Clients), out var clientsError))
        {
            throw new ArgumentOutOfRangeException(nameof(clients), clientsError[0]);
        }

        if (errors.TryGetValue(nameof(StartsOn), out var startError))
        {
            throw new ArgumentOutOfRangeException(nameof(startsOn), startError[0]);
        }

        if (errors.TryGetValue(nameof(EndsOnExclusive), out var endError))
        {
            throw new ArgumentOutOfRangeException(nameof(endsOnExclusive), endError[0]);
        }

        return new IncludedClientGrant
        {
            TenantId = tenantId,
            Clients = clients,
            StartsOn = startsOn,
            EndsOnExclusive = endsOnExclusive,
            Note = BillingText.Required(note, FoundingText.GrantNoteMaxLength, nameof(note)),
            GrantedAtUtc = now,
            GrantedByUserId = grantedByUserId,
        };
    }

    public void Revoke(Guid revokedByUserId, DateTimeOffset now)
    {
        if (IsRevoked)
        {
            throw new InvalidOperationException(FoundingText.GrantRevoked);
        }

        if (revokedByUserId == Guid.Empty)
        {
            throw new ArgumentException("The revoking admin is required.", nameof(revokedByUserId));
        }

        RevokedAtUtc = now;
        RevokedByUserId = revokedByUserId;
    }

    /// <summary>
    /// Whether this unrevoked grant names the same clients, days and note: the same request sent twice
    /// answers the grant that exists, so a double press grants once.
    /// </summary>
    public bool IsSameGrantAs(int clients, DateOnly startsOn, DateOnly endsOnExclusive, string note) =>
        !IsRevoked &&
        Clients == clients &&
        StartsOn == startsOn &&
        EndsOnExclusive == endsOnExclusive &&
        string.Equals(Note, note.Trim(), StringComparison.Ordinal);

    /// <summary>
    /// Every unrevoked grant that touches a billed window, oldest first. Each adds its clients: two that
    /// touch one month add up (notes plan N11a, Open 4). A revoked grant counts nowhere, whatever its days.
    /// </summary>
    public static IReadOnlyList<IncludedClientGrant> Touching(IEnumerable<IncludedClientGrant> grants, UsageWindow window) =>
        window.IsEmpty
            ? []
            : grants
                .Where(grant => !grant.IsRevoked && window.Overlaps(grant.StartsAtUtc, grant.EndsAtUtc))
                .OrderBy(grant => grant.StartsOn)
                .ThenBy(grant => grant.GrantedAtUtc)
                .ThenBy(grant => grant.Id)
                .ToList();

    /// <summary>
    /// The grants the owner's read names: every unrevoked one still running or to come on
    /// <paramref name="today"/>, a UTC day, oldest first. One whose last day was before today has ended; it
    /// stays only on the invoices it touched.
    /// </summary>
    public static IReadOnlyList<IncludedClientGrant> RunningOrToCome(IEnumerable<IncludedClientGrant> grants, DateOnly today) =>
        grants
            .Where(grant => !grant.IsRevoked && grant.EndsOnExclusive > today)
            .OrderBy(grant => grant.StartsOn)
            .ThenBy(grant => grant.GrantedAtUtc)
            .ThenBy(grant => grant.Id)
            .ToList();
}

/// <summary>
/// The founding seat an invoice or estimate counted (notes plan N11a): the founding status that made the
/// space founding, the founding terms version whose number applied, and that number, the clients the
/// owner's seat includes. A number at or below the plan's seat adds nothing (the larger applies).
/// </summary>
public sealed record FoundingSeat(Guid FoundingStatusId, int TermsVersion, int IncludedClients);

/// <summary>
/// Where a billed window's included clients come from beyond the plan's seats (<c>platform-invoice-v2</c>):
/// the founding seat, if any, and every unrevoked grant touching the window.
/// </summary>
public sealed record IncludedClientSources(FoundingSeat? FoundingSeat, IReadOnlyList<IncludedClientGrant> Grants)
{
    /// <summary>A space that is neither founding nor granted: its bill is the one v1 would give it.</summary>
    public static IncludedClientSources None { get; } = new(null, []);

    /// <summary>The clients of every grant counted, added up.</summary>
    public int GrantedIncludedClients => Grants.Aggregate(0, (sum, grant) => checked(sum + grant.Clients));

    /// <summary>
    /// Reads a billed window's sources from the space's founding statuses, the published founding terms
    /// versions and its grants, as of <paramref name="asOf"/>: the moment the invoice is issued, or now for an
    /// estimate.
    /// </summary>
    public static IncludedClientSources For(
        IEnumerable<FoundingStatus> statuses,
        IReadOnlyCollection<FoundingTerms> versions,
        IEnumerable<IncludedClientGrant> grants,
        UsageWindow window,
        DateTimeOffset asOf)
    {
        ArgumentNullException.ThrowIfNull(grants);
        return new IncludedClientSources(
            FoundingSeatPolicy.For(statuses, versions, window, asOf),
            IncludedClientGrant.Touching(grants, window));
    }
}

/// <summary>
/// The founding seat (notes plan N11a, decision 11, PBL-011): a founding space's owner seat includes the
/// clients the founding terms name, for life, on top of the founding discount. No number is a constant in
/// code: it comes only from a published <see cref="FoundingTerms"/> version.
/// </summary>
/// <remarks>
/// A billed window has a founding seat when one of the space's founding statuses touches it, as a discount
/// touches a month. A status runs from UTC midnight of its founding day to its end, or on while it is open,
/// so a status founded mid-month gives that month its seat, one ended mid-month keeps it for that month,
/// and from the month after it counts no more (Open 3). The seat takes the highest number among the terms
/// versions in force at some moment of the status's run, up to the reading (Open 5): a version that raises
/// the number applies from the next invoice, and one that lowers it, or names none, never takes clients from
/// a space while its status stays open. A version without a number gives none; with no number at all, the
/// owner's seat includes what the plan's seat includes.
/// </remarks>
public static class FoundingSeatPolicy
{
    public const int MinimumIncludedClients = 0;

    /// <summary>The plan's own range for the clients a seat includes (<see cref="PricePlanTerms"/>).</summary>
    public const int MaximumIncludedClients = 1_000;

    public static bool IsValidIncludedClients(int? clients) =>
        clients is null or (>= MinimumIncludedClients and <= MaximumIncludedClients);

    /// <summary>The founding seat a billed window counts, as of <paramref name="asOf"/>, or none.</summary>
    public static FoundingSeat? For(
        IEnumerable<FoundingStatus> statuses,
        IReadOnlyCollection<FoundingTerms> versions,
        UsageWindow window,
        DateTimeOffset asOf)
    {
        ArgumentNullException.ThrowIfNull(statuses);
        ArgumentNullException.ThrowIfNull(versions);
        if (window.IsEmpty)
        {
            return null;
        }

        var ordered = versions.OrderBy(version => version.VersionNumber).ToArray();
        FoundingSeat? best = null;
        var bestMarkedAt = DateTimeOffset.MinValue;
        foreach (var status in statuses)
        {
            var runsFrom = RunsFromUtc(status);
            var runsTo = status.EndedAtUtc ?? DateTimeOffset.MaxValue;
            if (runsFrom >= runsTo || !window.Overlaps(runsFrom, runsTo))
            {
                continue;
            }

            var seat = HighestNumber(status, ordered, runsFrom, asOf);
            if (seat is null)
            {
                continue;
            }

            // A space ended and marked again inside one window: the larger seat, else the later status.
            if (best is null ||
                seat.IncludedClients > best.IncludedClients ||
                (seat.IncludedClients == best.IncludedClients && status.MarkedAtUtc > bestMarkedAt))
            {
                best = seat;
                bestMarkedAt = status.MarkedAtUtc;
            }
        }

        return best;
    }

    /// <summary>
    /// The open status's seat at <paramref name="now"/>: what the owner's seat includes right now as a
    /// founding space, before the plan's seat is compared.
    /// </summary>
    public static FoundingSeat? Now(
        IEnumerable<FoundingStatus> statuses,
        IReadOnlyCollection<FoundingTerms> versions,
        DateTimeOffset now) =>
        For(
            statuses.Where(status => !status.IsEnded),
            versions,
            new UsageWindow(now, now.AddTicks(TimeSpan.TicksPerMicrosecond)),
            now);

    /// <summary>
    /// The seat's number when it raises the plan's seat, else null: a founding number at or below the plan's
    /// includes nothing more (Open 2).
    /// </summary>
    public static int? Raised(FoundingSeat? seat, int planIncludedClientsPerSeat) =>
        seat is { } founding && founding.IncludedClients > planIncludedClientsPerSeat ? founding.IncludedClients : null;

    /// <summary>What a founding seat adds over the plan's seat, for the owner's seat alone (Open 1, Open 2).</summary>
    public static int AddedOver(int? foundingSeatIncludedClients, int planIncludedClientsPerSeat) =>
        foundingSeatIncludedClients is { } founding ? Math.Max(0, founding - planIncludedClientsPerSeat) : 0;

    /// <summary>A status runs from UTC midnight of its founding day.</summary>
    public static DateTimeOffset RunsFromUtc(FoundingStatus status)
    {
        ArgumentNullException.ThrowIfNull(status);
        return new DateTimeOffset(status.FoundingSince.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
    }

    private static FoundingSeat? HighestNumber(
        FoundingStatus status,
        FoundingTerms[] ordered,
        DateTimeOffset runsFrom,
        DateTimeOffset asOf)
    {
        FoundingSeat? best = null;
        for (var index = 0; index < ordered.Length; index++)
        {
            var version = ordered[index];
            if (version.FoundingSeatIncludedClients is not { } clients)
            {
                continue;
            }

            // In force from its publishing until the next version's. The status had it when it was published
            // by the reading and before the status ended, and still in force once the status began.
            var inForceFrom = version.PublishedAtUtc;
            var inForceTo = index + 1 < ordered.Length ? ordered[index + 1].PublishedAtUtc : DateTimeOffset.MaxValue;
            var had = inForceFrom <= asOf &&
                      (status.EndedAtUtc is not { } ended || inForceFrom < ended) &&
                      inForceTo > runsFrom;
            if (had && (best is null || clients >= best.IncludedClients))
            {
                best = new FoundingSeat(status.Id, version.VersionNumber, clients);
            }
        }

        return best;
    }
}
