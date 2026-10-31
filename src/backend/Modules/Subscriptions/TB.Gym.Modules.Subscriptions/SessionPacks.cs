using System.Linq.Expressions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

public enum SessionEntryKind
{
    Issued = 1,
    Held = 2,
    Charged = 3,
    Voided = 4,
}

/// <summary>What happened to a session: it took place, or the coach charged a no-show or a late cancel.</summary>
public enum SessionOutcome
{
    Held = 1,
    Charged = 2,
}

/// <summary>Why a session cannot go on any of the client's packs (SES-005).</summary>
public enum SessionRefusal
{
    Future = 1,
    NoPack = 2,
    OutsidePack = 3,
    NoSessionsLeft = 4,
    WaitingForPayment = 5,
    Paused = 6,
}

/// <summary>
/// One line of a pack's append-only session ledger (SES-003, ADR 0038), the shape of <see cref="PaymentRecord"/>:
/// triggers refuse every update and delete, and a correction is a new Voided row pointing at the row it undoes.
/// What is left at a pack's end is no row: the calendar says it on every read (SES-006).
/// </summary>
public sealed class SessionLedgerEntry : TenantEntity
{
    public const int TextLimit = 500;

    private SessionLedgerEntry()
    {
    }

    private SessionLedgerEntry(
        ClientEnrollment pack,
        SessionEntryKind kind,
        int count,
        DateOnly day,
        Guid? coachUserId,
        string? note,
        string? reason,
        Guid? voidsEntryId,
        Guid idempotencyKey)
        : base(pack.TenantId)
    {
        if (!pack.IsSessionPack)
        {
            throw new InvalidOperationException("Only a session pack keeps a session ledger.");
        }

        if (idempotencyKey == Guid.Empty)
        {
            throw new ArgumentException("A non-empty idempotency key is required.", nameof(idempotencyKey));
        }

        EnrollmentId = pack.Id;
        ClientProfileId = pack.ClientProfileId;
        Kind = kind;
        Count = count;
        Day = day;
        CoachUserId = coachUserId;
        Note = note;
        Reason = reason;
        VoidsEntryId = voidsEntryId;
        IdempotencyKey = idempotencyKey;
    }

    public Guid EnrollmentId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public SessionEntryKind Kind { get; private set; }

    public int Count { get; private set; }

    /// <summary>The workspace day it happened: the session's own day, or the day a pack opened or a row was undone.</summary>
    public DateOnly Day { get; private set; }

    /// <summary>The coach who held or charged the session; null on the other kinds.</summary>
    public Guid? CoachUserId { get; private set; }

    /// <summary>The coach's own note on a session held. Only the team reads it.</summary>
    public string? Note { get; private set; }

    /// <summary>Why a session was charged. The client reads it.</summary>
    public string? Reason { get; private set; }

    public Guid? VoidsEntryId { get; private set; }

    public Guid IdempotencyKey { get; private set; }

    /// <summary>The pack's sessions, once it is active. The sale's own key: a pack opens once, whatever opened it.</summary>
    public static SessionLedgerEntry Issue(ClientEnrollment pack, DateOnly day) =>
        new(
            pack,
            SessionEntryKind.Issued,
            pack.SessionCountSnapshot ?? 0,
            day,
            null,
            null,
            null,
            null,
            pack.AssignmentCommandId);

    public static SessionLedgerEntry Hold(
        ClientEnrollment pack,
        DateOnly day,
        Guid coachUserId,
        string? note,
        Guid idempotencyKey) =>
        new(
            pack,
            SessionEntryKind.Held,
            1,
            day,
            coachUserId,
            CommercialText.Optional(note, TextLimit, nameof(note)),
            null,
            null,
            idempotencyKey);

    public static SessionLedgerEntry Charge(
        ClientEnrollment pack,
        DateOnly day,
        Guid coachUserId,
        string reason,
        Guid idempotencyKey) =>
        new(
            pack,
            SessionEntryKind.Charged,
            1,
            day,
            coachUserId,
            null,
            CommercialText.Required(reason, TextLimit, nameof(reason)),
            null,
            idempotencyKey);

    /// <summary>A correction: the row it undoes stays, and the session goes back on the pack.</summary>
    public static SessionLedgerEntry Void(
        ClientEnrollment pack,
        SessionLedgerEntry entry,
        DateOnly day,
        Guid idempotencyKey)
    {
        if (entry.EnrollmentId != pack.Id || entry.Kind is not (SessionEntryKind.Held or SessionEntryKind.Charged))
        {
            throw new InvalidOperationException("Only a session held or charged on this pack can be undone.");
        }

        return new(pack, SessionEntryKind.Voided, 1, day, null, null, null, entry.Id, idempotencyKey);
    }
}

public static class SessionLedger
{
    /// <summary>What a row does to the balance, for a read that sums a pack's ledger in the database.</summary>
    public static readonly Expression<Func<SessionLedgerEntry, int>> SignedCount = entry =>
        entry.Kind == SessionEntryKind.Issued || entry.Kind == SessionEntryKind.Voided ? entry.Count : -entry.Count;

    private static readonly Func<SessionLedgerEntry, int> Signed = SignedCount.Compile();

    /// <summary>Balance = issued − held − charged + voided (SES-003). A pack waiting for payment has none yet.</summary>
    public static int Balance(IEnumerable<SessionLedgerEntry> entries) => entries.Sum(Signed);

    /// <summary>
    /// A pack as the coach reads it. Held and Charged count what still stands. Once the pack is over, by its dates or
    /// by being cancelled, whatever is left has lapsed (SES-006); an Undo after that lapses with the rest.
    /// </summary>
    public static SessionPackView ViewOf(
        ClientEnrollment pack,
        IReadOnlyCollection<SessionLedgerEntry> entries,
        IReadOnlyDictionary<Guid, string> coachNames,
        DateOnly today,
        TimeZoneInfo workspaceZone)
    {
        var voided = entries.Where(entry => entry.VoidsEntryId is not null).Select(entry => entry.VoidsEntryId!.Value).ToHashSet();
        var standing = entries.Where(entry => !voided.Contains(entry.Id)).ToArray();
        var left = Balance(entries);
        var over = pack.GetEffectiveStatus(today, relationshipBlocked: false)
            is EffectiveEnrollmentStatus.Expired or EffectiveEnrollmentStatus.Cancelled;
        return new SessionPackView(
            pack.SessionCountSnapshot ?? 0,
            left,
            standing.Count(entry => entry.Kind == SessionEntryKind.Held),
            standing.Count(entry => entry.Kind == SessionEntryKind.Charged),
            over ? left : 0,
            over && left > 0 ? pack.CancelledOn(workspaceZone) ?? pack.Period.LastActiveDate : null,
            standing.Where(entry => entry.Kind == SessionEntryKind.Held).Select(entry => (DateOnly?)entry.Day).Max(),
            entries
                .OrderByDescending(entry => entry.Day)
                .ThenByDescending(entry => entry.CreatedAtUtc)
                .ThenByDescending(entry => entry.Id)
                .Select(entry => new SessionEntryView(
                    entry.Id,
                    entry.Kind,
                    entry.Count,
                    entry.Day,
                    entry.CoachUserId is { } coach ? coachNames.GetValueOrDefault(coach) : null,
                    entry.Note,
                    entry.Reason,
                    entry.VoidsEntryId,
                    voided.Contains(entry.Id)))
                .ToArray());
    }
}

/// <summary>A pack and what is left on it.</summary>
public sealed record SessionPackStanding(ClientEnrollment Pack, int Left);

/// <summary>The pack a session goes on, or why none can take it, with the pack the refusal is about.</summary>
public sealed record SessionChoice(ClientEnrollment? Pack, SessionRefusal? Refusal);

public static class SessionPackRules
{
    public const int MinimumSessions = 1;

    public const int MaximumSessions = 100;

    /// <summary>
    /// A coaching plan's option counts no sessions and does not include them; a pack's counts them and always does,
    /// side by side with any other pack (SUB-004), so its Sessions coverage never blocks a date.
    /// </summary>
    public static void EnsureOffer(int? sessionCount, IReadOnlyCollection<OfferFeatureDefinition> features)
    {
        var sessions = features.FirstOrDefault(item => item.Feature == CoachingFeature.Sessions);
        if (sessionCount is null)
        {
            if (sessions is not null)
            {
                throw new ArgumentException("1-on-1 sessions are sold as a session pack.", nameof(features));
            }

            return;
        }

        if (sessionCount is < MinimumSessions or > MaximumSessions)
        {
            throw new ArgumentOutOfRangeException(nameof(sessionCount), $"A pack holds {MinimumSessions} to {MaximumSessions} sessions.");
        }

        if (sessions is not { AllowsConcurrentCoverage: true })
        {
            throw new ArgumentException("A session pack always includes 1-on-1 sessions.", nameof(features));
        }
    }

    /// <summary>What a pack's option includes: what the coach ticked, and always its sessions.</summary>
    public static IEnumerable<OfferFeatureDefinition> PackFeatures(IEnumerable<OfferFeatureDefinition> ticked) =>
        ticked
            .Where(item => item.Feature != CoachingFeature.Sessions)
            .Append(new OfferFeatureDefinition(CoachingFeature.Sessions, AllowsConcurrentCoverage: true));

    /// <summary>
    /// The pack a session on <paramref name="day"/> uses (SES-004): among those paid, covering the day and with a
    /// session left, the one ending first. A session counts when it happens, so a day still to come is refused. With
    /// none, the refusal names what the coach can act on first. A paused pack stops access, so it takes no session,
    /// and a cancelled one is gone.
    /// </summary>
    public static SessionChoice Choose(
        IReadOnlyCollection<SessionPackStanding> packs,
        DateOnly day,
        DateOnly today)
    {
        if (day > today)
        {
            return new SessionChoice(null, SessionRefusal.Future);
        }

        var live = packs
            .Where(item => item.Pack.Status != EnrollmentStatus.Cancelled)
            .OrderBy(item => item.Pack.EndDateExclusive)
            .ThenBy(item => item.Pack.StartDate)
            .ThenBy(item => item.Pack.CreatedAtUtc)
            .ThenBy(item => item.Pack.Id)
            .ToArray();
        if (live.Length == 0)
        {
            return new SessionChoice(null, SessionRefusal.NoPack);
        }

        var covering = live.Where(item => Covers(item.Pack, day)).ToArray();
        var usable = covering.FirstOrDefault(item => IsPaid(item.Pack) && item.Left > 0);
        if (usable is not null)
        {
            return new SessionChoice(usable.Pack, null);
        }

        if (covering.FirstOrDefault(item => item.Pack.Status == EnrollmentStatus.PendingPayment) is { } waiting)
        {
            return new SessionChoice(waiting.Pack, SessionRefusal.WaitingForPayment);
        }

        if (covering.FirstOrDefault(item => item.Pack.Status == EnrollmentStatus.Paused) is { } paused)
        {
            return new SessionChoice(paused.Pack, SessionRefusal.Paused);
        }

        return covering.Length > 0
            ? new SessionChoice(covering[0].Pack, SessionRefusal.NoSessionsLeft)
            : new SessionChoice(live.Length == 1 ? live[0].Pack : null, SessionRefusal.OutsidePack);
    }

    /// <summary>The pack waiting for payment that a receipt taken with a session pays: on that day, ending first.</summary>
    public static ClientEnrollment? WaitingOn(IReadOnlyCollection<SessionPackStanding> packs, DateOnly day) =>
        packs
            .Where(item => item.Pack.Status == EnrollmentStatus.PendingPayment && Covers(item.Pack, day))
            .OrderBy(item => item.Pack.EndDateExclusive)
            .ThenBy(item => item.Pack.StartDate)
            .ThenBy(item => item.Pack.Id)
            .FirstOrDefault()?.Pack;

    private static bool Covers(ClientEnrollment pack, DateOnly day) =>
        pack.StartDate <= day && day < pack.EndDateExclusive;

    private static bool IsPaid(ClientEnrollment pack) =>
        pack.Status is EnrollmentStatus.Active or EnrollmentStatus.Expired;
}

/// <param name="Count">The sessions the pack was sold with.</param>
/// <param name="Left">Issued − held − charged + voided; none until the pack is active.</param>
/// <param name="Held">The sessions held that still stand.</param>
/// <param name="Charged">The sessions charged that still stand.</param>
/// <param name="Lapsed">What was left when the pack ended or was cancelled; none while it runs (SES-006).</param>
/// <param name="LapsedOn">The day those lapsed; null when none did.</param>
/// <param name="LastHeldOn">The latest session held that still stands.</param>
/// <param name="Entries">The ledger, newest day first.</param>
public sealed record SessionPackView(
    int Count,
    int Left,
    int Held,
    int Charged,
    int Lapsed,
    DateOnly? LapsedOn,
    DateOnly? LastHeldOn,
    IReadOnlyList<SessionEntryView> Entries);

/// <param name="CoachName">Who held or charged it.</param>
/// <param name="Note">The coach's own note, for the team.</param>
/// <param name="Reason">Why it was charged, which the client reads.</param>
/// <param name="VoidsEntryId">The row a Voided entry undoes.</param>
/// <param name="IsVoided">Whether a later row undid this one.</param>
public sealed record SessionEntryView(
    Guid Id,
    SessionEntryKind Kind,
    int Count,
    DateOnly Day,
    string? CoachName,
    string? Note,
    string? Reason,
    Guid? VoidsEntryId,
    bool IsVoided);

/// <param name="Day">The workspace day of the session, today or earlier, inside the pack's dates.</param>
/// <param name="Note">Kept on a session held; only the team reads it.</param>
/// <param name="Reason">Required when charged; the client reads it.</param>
/// <param name="Receipt">The money taken that day for a pack waiting for payment, which pays it in full (SES-005).</param>
public sealed record RecordSessionRequest(
    SessionOutcome Outcome,
    DateOnly Day,
    string? Note,
    string? Reason,
    SessionReceiptRequest? Receipt,
    Guid IdempotencyKey);

/// <summary>A receipt recorded with a session, dated that session's day.</summary>
public sealed record SessionReceiptRequest(decimal Amount, string CurrencyCode, ManualPaymentMethod Method);

public sealed record VoidSessionRequest(Guid IdempotencyKey);
