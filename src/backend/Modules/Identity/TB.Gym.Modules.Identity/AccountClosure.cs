using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// The record that a TB Gym account was closed and its person anonymised (CLI-027): whose account, when, who closed it
/// (the person themselves, or the platform admin on their request and the day they asked) and what the closing did.
/// One per account, append-only: a database trigger refuses any change or deletion, so the record of an erasure is
/// kept while what it erased is gone. It holds ids, dates and counts only, never a name or an address.
/// </summary>
public sealed class AccountClosure : AuditableEntity
{
    private AccountClosure()
    {
    }

    private AccountClosure(
        Guid userId,
        AccountClosureSource source,
        Guid closedByUserId,
        DateOnly? requestedOn,
        DateTimeOffset closedAtUtc,
        int spacesLeft,
        int recordsAnonymised,
        int photosRemoved)
    {
        UserId = userId;
        Source = source;
        ClosedByUserId = closedByUserId;
        RequestedOn = requestedOn;
        ClosedAtUtc = closedAtUtc;
        SpacesLeft = spacesLeft;
        RecordsAnonymised = recordsAnonymised;
        PhotosRemoved = photosRemoved;
    }

    /// <summary>The closed account, which stays as an empty row because append-only records name it.</summary>
    public Guid UserId { get; private set; }

    public AccountClosureSource Source { get; private set; }

    /// <summary>The person themselves, or the platform admin who closed it on their request.</summary>
    public Guid ClosedByUserId { get; private set; }

    /// <summary>The day the person asked, for a closing on request; empty when they closed it themselves.</summary>
    public DateOnly? RequestedOn { get; private set; }

    public DateTimeOffset ClosedAtUtc { get; private set; }

    /// <summary>The coaching spaces the person was a current client of, and left by closing.</summary>
    public int SpacesLeft { get; private set; }

    /// <summary>The client records, current and earlier, that were anonymised.</summary>
    public int RecordsAnonymised { get; private set; }

    /// <summary>The progress photos removed and queued for the purge.</summary>
    public int PhotosRemoved { get; private set; }

    public static AccountClosure Record(
        Guid userId,
        AccountClosureSource source,
        Guid closedByUserId,
        DateOnly? requestedOn,
        DateTimeOffset closedAtUtc,
        int spacesLeft,
        int recordsAnonymised,
        int photosRemoved)
    {
        if (userId == Guid.Empty || closedByUserId == Guid.Empty || !Enum.IsDefined(source))
        {
            throw new ArgumentException("A closed account, who closed it and how are required.");
        }

        if ((source == AccountClosureSource.Self) != (closedByUserId == userId) ||
            (source == AccountClosureSource.OnRequest) != requestedOn.HasValue)
        {
            throw new ArgumentException("A person closes their own account; the platform admin closes one on a request, with its day.");
        }

        if (spacesLeft < 0 || recordsAnonymised < 0 || photosRemoved < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(spacesLeft), "A count is never negative.");
        }

        return new AccountClosure(
            userId,
            source,
            closedByUserId,
            requestedOn,
            closedAtUtc,
            spacesLeft,
            recordsAnonymised,
            photosRemoved);
    }

    /// <summary>The first day a request may name: earlier is a typing mistake.</summary>
    public static readonly DateOnly EarliestRequestedOn = new(2026, 1, 1);

    /// <summary>
    /// The day a person asked for their account to be closed: from <see cref="EarliestRequestedOn"/> to today
    /// wherever the admin is, so a day already begun east of UTC is not refused.
    /// </summary>
    public static bool IsValidRequestedOn(DateOnly requestedOn, DateTimeOffset now) =>
        requestedOn >= EarliestRequestedOn &&
        requestedOn <= DateOnly.FromDateTime(now.UtcDateTime.AddHours(14));
}

public enum AccountClosureSource
{
    /// <summary>The person closed their account from Me, with their password.</summary>
    Self = 1,

    /// <summary>The platform admin closed it on the person's request.</summary>
    OnRequest = 2,
}

/// <param name="Password">The account's password, asked again because closing cannot be undone.</param>
public sealed record CloseOwnAccountRequest(string? Password);

/// <param name="Email">The address of the account to close.</param>
/// <param name="RequestedOn">The day the person asked.</param>
public sealed record CloseAccountOnRequestRequest(string? Email, DateOnly? RequestedOn);

/// <summary>What closing an account did, as the platform admin reads it back. No name or address.</summary>
public sealed record AccountClosureView(
    DateTimeOffset ClosedAtUtc,
    DateOnly? RequestedOn,
    int SpacesLeft,
    int RecordsAnonymised,
    int PhotosRemoved);

public enum AccountClosureStatus
{
    Closed,

    /// <summary>The account was closed already, by an earlier request that got there first.</summary>
    AlreadyClosed,

    NotFound,

    /// <summary>The password typed is not the account's.</summary>
    WrongPassword,

    /// <summary>The account owns or coaches, or once did, in a coaching space: not closed here.</summary>
    Staff,

    /// <summary>The account holds the platform admin's role: not closed here.</summary>
    PlatformAdmin,

    /// <summary>Something of the person's changed while it closed; nothing was closed, and closing may be tried again.</summary>
    Changed,
}

public sealed record AccountClosureResult(AccountClosureStatus Status, AccountClosureView? View = null);

/// <summary>
/// Closing an account (CLI-027). Identity owns the routes and the record; the closing itself reaches every module
/// that holds the person (Clients, Tenancy, Invitations, Progress, Media, Nutrition, Subscriptions), so it is
/// composed in Infrastructure, as <see cref="IEmailConfirmationService"/> is.
/// </summary>
public interface IAccountClosureService
{
    /// <summary>The signed-in person closes their own account, after typing its password.</summary>
    Task<AccountClosureResult> CloseOwnAsync(Guid userId, string password, CancellationToken cancellationToken);

    /// <summary>The platform admin closes the account with this address, on the person's request of that day.</summary>
    Task<AccountClosureResult> CloseOnRequestAsync(
        string email,
        DateOnly requestedOn,
        Guid adminUserId,
        CancellationToken cancellationToken);
}
