using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.PlatformBilling;

/// <summary>
/// The two numbers the Founding coach badge is earned by (decision 15, 5 Nov 2026): clients with an
/// active plan right now, and whole months since the coaching space started. Neither is a constant in
/// code: they are the terms of a published <see cref="FoundingTerms"/> version the platform admin changes.
/// </summary>
public sealed record FoundingBadgeTerms(int ClientsWithActivePlan, int MonthsSinceStart)
{
    public const int MaximumClients = 1_000;

    public const int MaximumMonths = 24;

    /// <summary>The field-level problems with these terms, empty when they are publishable.</summary>
    public IReadOnlyDictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        if (ClientsWithActivePlan is < 1 or > MaximumClients)
        {
            errors[nameof(ClientsWithActivePlan)] = [$"Enter a whole number from 1 to {MaximumClients}."];
        }

        if (MonthsSinceStart is < 0 or > MaximumMonths)
        {
            errors[nameof(MonthsSinceStart)] = [$"Enter a whole number from 0 to {MaximumMonths}."];
        }

        return errors;
    }
}

/// <summary>
/// One published, immutable version of the Founding coach badge's terms. The latest version is in force;
/// a badge records the version it was earned under, so publishing a new one never changes a badge already
/// earned. Version 1 (10 clients, 2 months) is seeded by the migration. A database trigger refuses
/// updating or deleting a version.
/// </summary>
public sealed class FoundingTerms
{
    private FoundingTerms()
    {
    }

    public Guid Id { get; private set; } = Guid.CreateVersion7();

    public int VersionNumber { get; private set; }

    public int ClientsWithActivePlan { get; private set; }

    public int MonthsSinceStart { get; private set; }

    public string? Note { get; private set; }

    public DateTimeOffset PublishedAtUtc { get; private set; }

    public Guid? PublishedByUserId { get; private set; }

    public FoundingBadgeTerms Terms => new(ClientsWithActivePlan, MonthsSinceStart);

    public static FoundingTerms Publish(
        int versionNumber,
        FoundingBadgeTerms terms,
        string? note,
        Guid? publishedByUserId,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (versionNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(versionNumber), "Terms versions start at 1.");
        }

        if (terms.Validate().Count > 0)
        {
            throw new ArgumentException("The founding badge terms are not publishable.", nameof(terms));
        }

        return new FoundingTerms
        {
            VersionNumber = versionNumber,
            ClientsWithActivePlan = terms.ClientsWithActivePlan,
            MonthsSinceStart = terms.MonthsSinceStart,
            Note = BillingText.Optional(note, FoundingText.TermsNoteMaxLength, nameof(note)),
            PublishedAtUtc = now,
            PublishedByUserId = publishedByUserId,
        };
    }
}

/// <summary>Where a coaching space stands with the Founding coach badge on one UTC day.</summary>
public enum FoundingBadgeState
{
    NotFounding = 1,
    Waiting = 2,
    Earned = 3,
    Ended = 4,
}

/// <summary>
/// A coaching space marked as one of TB Gym's founding spaces, by the platform admin's hand only
/// (decision 15 and the notes plan's Point 8, 5 Nov 2026). The badge it leads to belongs to the space's
/// active owner, is earned once under <see cref="FoundingBadgePolicy"/>, is kept after any discount ends,
/// and is taken away only by ending the status for cause, with the reason kept.
/// </summary>
/// <remarks>
/// A row is never edited or deleted: the earned day, the terms version and the client count are written
/// once and survive an end; ending is recorded on the row, once; the owner's hide switch changes while
/// the status is open. A space may be marked again after an ended status, so the rows are its history.
/// The status changes no access and no bill: it is separate from <see cref="WorkspaceDiscount"/>.
/// Database triggers are the guarantee.
/// </remarks>
public sealed class FoundingStatus : TenantEntity
{
    private FoundingStatus()
    {
    }

    /// <summary>The UTC day the space is founding from: today or an earlier day when it was marked.</summary>
    public DateOnly FoundingSince { get; private set; }

    /// <summary>What the status is for, in the admin's words. Only TB Gym's admin reads it.</summary>
    public string Note { get; private set; } = string.Empty;

    public DateTimeOffset MarkedAtUtc { get; private set; }

    public Guid MarkedByUserId { get; private set; }

    /// <summary>The UTC day the badge was earned, written once by the check.</summary>
    public DateOnly? EarnedOn { get; private set; }

    /// <summary>The <see cref="FoundingTerms"/> version in force when the badge was earned.</summary>
    public int? EarnedUnderTermsVersion { get; private set; }

    /// <summary>The clients with an active plan the check counted on the earned day.</summary>
    public int? EarnedClientCount { get; private set; }

    /// <summary>The named rule that recorded the badge, <see cref="FoundingBadgePolicy.Name"/>.</summary>
    public string? EarnedUnderRule { get; private set; }

    /// <summary>The owner's own switch: hidden, their clients do not see the badge.</summary>
    public bool BadgeHidden { get; private set; }

    public DateTimeOffset? EndedAtUtc { get; private set; }

    public Guid? EndedByUserId { get; private set; }

    /// <summary>Why the status ended. Only TB Gym's admin reads it.</summary>
    public string? EndReason { get; private set; }

    public bool IsEnded => EndedAtUtc is not null;

    public bool IsEarned => EarnedOn is not null;

    public static FoundingStatus Mark(
        Guid tenantId,
        DateOnly foundingSince,
        string note,
        Guid markedByUserId,
        DateTimeOffset now)
    {
        if (tenantId == Guid.Empty || markedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A coaching space and the marking admin are required.");
        }

        if (foundingSince > PaymentSchedule.Today(now))
        {
            throw new ArgumentOutOfRangeException(nameof(foundingSince), FoundingText.FoundingSinceInvalid);
        }

        if (foundingSince < FoundingText.EarliestFoundingSince)
        {
            throw new ArgumentOutOfRangeException(nameof(foundingSince), FoundingText.FoundingSinceTooEarly);
        }

        return new FoundingStatus
        {
            TenantId = tenantId,
            FoundingSince = foundingSince,
            Note = BillingText.Required(note, FoundingText.NoteMaxLength, nameof(note)),
            MarkedAtUtc = now,
            MarkedByUserId = markedByUserId,
        };
    }

    /// <summary>
    /// Records the badge as earned on a day, under the terms in force then, with what was counted. Once
    /// only, and only with both terms met.
    /// </summary>
    public void RecordEarned(DateOnly earnedOn, FoundingTerms terms, int clientCount, int monthsSinceStart)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (IsEnded)
        {
            throw new InvalidOperationException("An ended founding status earns nothing.");
        }

        if (IsEarned)
        {
            throw new InvalidOperationException("The badge was already earned; its day is kept.");
        }

        if (earnedOn < FoundingSince)
        {
            throw new ArgumentOutOfRangeException(nameof(earnedOn), "A badge is earned no earlier than the founding day.");
        }

        if (!FoundingBadgePolicy.MeetsTerms(terms.Terms, clientCount, monthsSinceStart))
        {
            throw new ArgumentOutOfRangeException(nameof(clientCount), "A badge is earned only once both of its terms are met.");
        }

        EarnedOn = earnedOn;
        EarnedUnderTermsVersion = terms.VersionNumber;
        EarnedClientCount = clientCount;
        EarnedUnderRule = FoundingBadgePolicy.Name;
    }

    public void SetBadgeHidden(bool hidden)
    {
        if (IsEnded)
        {
            throw new InvalidOperationException("An ended founding status is never changed.");
        }

        BadgeHidden = hidden;
    }

    /// <summary>Ends the status for cause, with the reason kept. Once only; the earned day stays.</summary>
    public void End(string reason, Guid endedByUserId, DateTimeOffset now)
    {
        if (IsEnded)
        {
            throw new InvalidOperationException("This founding status already ended.");
        }

        if (endedByUserId == Guid.Empty)
        {
            throw new ArgumentException("The ending admin is required.", nameof(endedByUserId));
        }

        EndReason = BillingText.Required(reason, FoundingText.EndReasonMaxLength, nameof(reason));
        EndedAtUtc = now;
        EndedByUserId = endedByUserId;
    }
}

/// <summary>The badge's standing on one UTC day, as <see cref="FoundingBadgePolicy"/> reads it.</summary>
/// <param name="ClientsWithActivePlan">Clients with an active plan right now; counted only while waiting.</param>
/// <param name="MonthsSinceStart">Whole months since the space started; counted only while waiting.</param>
/// <param name="IsDue">Waiting with both terms met: the next check records the badge.</param>
public sealed record FoundingBadgeReading(
    FoundingBadgeState State,
    DateOnly? FoundingSince,
    int? ClientsWithActivePlan,
    int ClientsNeeded,
    int? MonthsSinceStart,
    int MonthsNeeded,
    int TermsVersion,
    DateOnly? EarnedOn,
    DateOnly? EndedOn,
    bool Hidden,
    bool IsDue);

/// <summary>
/// The named, versioned rule for the Founding coach badge (decision 15, 5 Nov 2026). A new rule is a new
/// name; a badge records the name it was earned under.
/// </summary>
/// <remarks>
/// <c>founding-badge-v1</c>: on a UTC day a space's badge is NotFounding while it has no founding status
/// or its founding day is still ahead, Ended once its latest status ended, Earned from the day the check
/// recorded it, and Waiting otherwise. A waiting space is due its badge once both terms of the version
/// in force hold that day: at least its clients with an active plan right now, and at least its whole
/// calendar months since the UTC day the space was created, as the trial counts from creation (31 January
/// plus one month is the last day of February). Once recorded the badge stays earned, whatever the counts
/// do later; only an end for cause takes it away.
/// </remarks>
public static class FoundingBadgePolicy
{
    public const string Name = "founding-badge-v1";

    /// <summary>
    /// Whole calendar months from <paramref name="start"/> to <paramref name="today"/>: the most months
    /// that, added to the start day, do not pass today.
    /// </summary>
    public static int WholeMonthsSince(DateOnly start, DateOnly today)
    {
        if (today <= start)
        {
            return 0;
        }

        var months = ((today.Year - start.Year) * 12) + today.Month - start.Month;
        if (start.AddMonths(months) > today)
        {
            months--;
        }

        return months;
    }

    public static bool MeetsTerms(FoundingBadgeTerms terms, int clientsWithActivePlan, int monthsSinceStart)
    {
        ArgumentNullException.ThrowIfNull(terms);
        return clientsWithActivePlan >= terms.ClientsWithActivePlan && monthsSinceStart >= terms.MonthsSinceStart;
    }

    /// <summary>The state alone, without counting: what the coach app's access read needs.</summary>
    public static FoundingBadgeState StateOf(FoundingStatus? latest, DateOnly today) =>
        latest is null ? FoundingBadgeState.NotFounding
        : latest.IsEnded ? FoundingBadgeState.Ended
        : latest.FoundingSince > today ? FoundingBadgeState.NotFounding
        : latest.IsEarned ? FoundingBadgeState.Earned
        : FoundingBadgeState.Waiting;

    /// <summary>
    /// Reads a space's badge on a day from its latest founding status (the open one, else the last ended
    /// one), the terms in force, the space's creation instant and, for a waiting space, its clients with
    /// an active plan right now.
    /// </summary>
    public static FoundingBadgeReading Read(
        FoundingStatus? latest,
        FoundingTerms terms,
        DateTimeOffset spaceCreatedAtUtc,
        int? clientsWithActivePlan,
        DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var state = StateOf(latest, today);
        int? months = null;
        int? clients = null;
        var isDue = false;
        if (state == FoundingBadgeState.Waiting)
        {
            months = WholeMonthsSince(DateOnly.FromDateTime(spaceCreatedAtUtc.UtcDateTime), today);
            clients = clientsWithActivePlan
                      ?? throw new ArgumentNullException(nameof(clientsWithActivePlan), "A waiting space is read with its clients counted.");
            isDue = MeetsTerms(terms.Terms, clients.Value, months.Value);
        }

        var shown = state is FoundingBadgeState.Waiting or FoundingBadgeState.Earned or FoundingBadgeState.Ended;
        var open = state is FoundingBadgeState.Waiting or FoundingBadgeState.Earned;
        return new FoundingBadgeReading(
            state,
            shown ? latest!.FoundingSince : null,
            clients,
            terms.ClientsWithActivePlan,
            months,
            terms.MonthsSinceStart,
            terms.VersionNumber,
            shown ? latest!.EarnedOn : null,
            state == FoundingBadgeState.Ended ? PaymentSchedule.Today(latest!.EndedAtUtc!.Value) : null,
            open && latest!.BadgeHidden,
            isDue);
    }
}

/// <summary>
/// The founding status's limits and every sentence it can answer with, in one place so a test can read
/// them all: none uses a word the notes plan forbids for a coach (its section 1). The badge itself is
/// called "Founding coach".
/// </summary>
public static class FoundingText
{
    public const int NoteMaxLength = 200;

    public const int EndReasonMaxLength = 500;

    public const int TermsNoteMaxLength = 500;

    /// <summary>The earliest founding day the admin may choose, so a missing date is never stored as 0001.</summary>
    public static readonly DateOnly EarliestFoundingSince = new(2000, 1, 1);

    public const string FoundingSinceRequired = "Choose the day the coaching space became founding.";

    public const string FoundingSinceInvalid = "Choose today or an earlier day.";

    public const string FoundingSinceTooEarly = "Choose a day from 1 January 2000 to today.";

    public const string TermsClientsRequired = "Enter how many clients with an active plan earn the badge.";

    public const string TermsMonthsRequired = "Enter how many whole months since the space started earn the badge.";

    public const string ExpectedVersionRequired = "Say which version of the terms this change follows. Refresh and try again.";

    public const string NoteInvalid = "Say what the founding status is for, in up to 200 characters.";

    public const string EndReasonInvalid = "Say why the founding status ends, in up to 500 characters.";

    public const string TermsNoteInvalid = "Keep the note to 500 characters.";

    public const string HiddenRequired = "Say whether to hide the badge from your clients or show it.";

    public const string ExistsCode = "founding_exists";

    public const string Exists = "This coaching space is already founding. End that status first to mark it again.";

    public const string EndedCode = "founding_ended";

    public const string Ended = "This founding status already ended.";

    public const string TermsChangedCode = "founding_terms_changed";

    public const string TermsChanged = "Newer founding badge terms were published since this page loaded. Refresh and try again.";
}
