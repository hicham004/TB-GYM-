namespace TB.Gym.Modules.Identity;

/// <summary>
/// The only way a caller asks for a global account action email.
/// </summary>
/// <remarks>
/// It takes identifiers and a stable source code and returns a request id. It deliberately takes no
/// address, no token and no return URL: the address is resolved and the token is minted at
/// materialization, and the link is built from validated configuration. A caller that could supply any
/// of the three would be a caller that could redirect somebody else's credential.
/// </remarks>
public interface IAccountActionMailScheduler
{
    Task<AccountActionMailEnqueueResult> RequestAsync(
        AccountActionMailCommand command,
        CancellationToken cancellationToken);
}

/// <summary>
/// One request for one action email.
/// </summary>
/// <param name="SubjectUserId">
/// The account, or null when the address the caller was given resolved to none. A null subject is not
/// an error: it is how the unknown-address path performs the same bounded durable work as the known
/// one, so the two cannot be told apart from outside.
/// </param>
/// <param name="ActionKind">Which action the mail is for.</param>
/// <param name="RequestSource">A stable code naming the flow that asked. Never free text from a caller.</param>
/// <param name="RequestedByUserId">The signed-in actor, or null for an anonymous public request.</param>
public sealed record AccountActionMailCommand(
    Guid? SubjectUserId,
    AccountActionKind ActionKind,
    string RequestSource,
    Guid? RequestedByUserId = null);

/// <summary>
/// What the caller learns: that a request exists, and — outside a deployment that can send — where the
/// captured link went.
/// </summary>
/// <remarks>
/// <see cref="DevelopmentActionUrl"/> is populated only outside Production, only when the development
/// capture adapter is configured, and only for actions whose requester already knows the address they
/// asked about. It is deliberately never populated for a password reset: a development response that
/// carried a link for a known address and no link for an unknown one would be exactly the enumeration
/// oracle the rest of this design removes, and a property that behaves differently in two environments
/// is a property nobody tests in the one that matters.
/// </remarks>
public sealed record AccountActionMailEnqueueResult(Guid RequestId, string? DevelopmentActionUrl = null);

/// <summary>
/// Drains due global action-mail requests.
/// </summary>
/// <remarks>
/// Composed in both roots. The Worker drives it on a timer; the API composes it so integration tests
/// can run one sweep deterministically, and so a development request can be materialized inline for
/// the capture adapter. The API hosts no timer for it.
/// </remarks>
public interface IAccountActionMailDispatchService
{
    Task<AccountActionMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Materializes one specific request, now, if it is still claimable.
    /// </summary>
    /// <remarks>
    /// Exists for the development capture path and for tests. It runs exactly the same claim,
    /// recheck, mint, render and transport sequence as a sweep; it is not a second implementation.
    /// </remarks>
    Task<AccountActionMailDispatchOutcome> DispatchRequestAsync(
        Guid requestId,
        CancellationToken cancellationToken);
}

/// <summary>Counters for one sweep. Named for what happened, never for what was hoped.</summary>
public sealed record AccountActionMailDispatchOutcome(
    int Claimed = 0,
    int Materialized = 0,
    int Suppressed = 0,
    int Retried = 0,
    int DeadLettered = 0,
    int Reclaimed = 0)
{
    public int Total => Materialized + Suppressed + Retried + DeadLettered + Reclaimed;

    public AccountActionMailDispatchOutcome Add(AccountActionMailDispatchOutcome other) =>
        new(
            Claimed + other.Claimed,
            Materialized + other.Materialized,
            Suppressed + other.Suppressed,
            Retried + other.Retried,
            DeadLettered + other.DeadLettered,
            Reclaimed + other.Reclaimed);
}

/// <summary>The stable source codes a request may record.</summary>
public static class AccountActionMailSources
{
    /// <summary>A coach registered and their address needs confirming.</summary>
    public const string CoachRegistration = "coach-registration";

    /// <summary>Somebody used the public password-recovery form.</summary>
    public const string PublicPasswordRecovery = "public-password-recovery";
}
