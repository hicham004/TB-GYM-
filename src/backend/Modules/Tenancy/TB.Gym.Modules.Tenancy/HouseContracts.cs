namespace TB.Gym.Modules.Tenancy;

/// <summary>Sign-up into the house with no invitation (CLI-024, ADR 0041).</summary>
public interface ITraineeSignUpService
{
    /// <summary>What the public sign-up page may know: open, full for the week or closed.</summary>
    Task<TraineeSignUpStatusView> GetStatusAsync(CancellationToken cancellationToken);

    Task<TraineeRegistrationResult> RegisterAsync(
        RegisterTraineeRequest request,
        CancellationToken cancellationToken);
}

/// <summary>The platform admin's read of the house and the one write of its settings (CLI-023).</summary>
public interface IHouseAdminService
{
    Task<HouseAdminView> GetAsync(CancellationToken cancellationToken);

    Task<HouseSettingResult> ChangeSettingAsync(
        HouseSetting setting,
        ChangeHouseSettingRequest request,
        CancellationToken cancellationToken);
}

/// <summary>Removes the house's sign-ups whose email was never confirmed (CLI-025). The Worker runs it.</summary>
public interface ITraineeSignUpSweep
{
    Task<TraineeSignUpSweepResult> RunAsync(CancellationToken cancellationToken);
}

/// <param name="Removed">Sign-ups removed, each with its never-confirmed account emptied.</param>
/// <param name="Skipped">Sign-ups that changed while being swept, or failed, and wait for the next sweep.</param>
public sealed record TraineeSignUpSweepResult(int Removed, int Skipped);

/// <summary>
/// What the public page reads before it shows a form. A closed sign-up says nothing else: not whether a house
/// exists, nor its name.
/// </summary>
/// <param name="WorkspaceName">The house's name, while sign-up is open or full.</param>
/// <param name="TimeZoneId">The house's clock, which its training days follow; while open or full.</param>
/// <param name="MinimumAge">The age a person must have reached; while open or full.</param>
/// <param name="OpensAgainOn">While full: the first day of the house's next week, in the house's time.</param>
/// <param name="FormStamp">While open: the stamp the form sends back, proving it was on screen for a moment (WEB-002).</param>
/// <param name="CallerSignUp">
/// For someone signed in, while open or full: whether they are a client of the house already, or have a sign-up
/// whose email was confirmed while the week was full and which waits for a place. Null for anyone else.
/// </param>
public sealed record TraineeSignUpStatusView(
    TraineeSignUpStatus Status,
    string? WorkspaceName = null,
    string? TimeZoneId = null,
    int? MinimumAge = null,
    DateOnly? OpensAgainOn = null,
    string? FormStamp = null,
    TraineeCallerSignUp? CallerSignUp = null);

public enum TraineeCallerSignUp
{
    /// <summary>A sign-up of theirs waits: for its email to be confirmed, or for a place of a week that was full.</summary>
    Waiting = 1,

    /// <summary>They are a client of the house today.</summary>
    Joined = 2,
}

/// <summary>
/// The sign-up form. Someone already signed in sends no password and joins at once with the account they have; a
/// new person gets an account that waits for its email to be confirmed.
/// </summary>
/// <param name="Website">The honeypot: a field no person sees. Filled, the request is answered as accepted and kept nowhere.</param>
/// <param name="FormStamp">The stamp the status read handed out.</param>
/// <param name="LegalDocumentIds">The documents in force for a house trainee the person ticked (CLI-010); none while none is published.</param>
public sealed record RegisterTraineeRequest(
    string FirstName,
    string LastName,
    string Email,
    DateOnly? BirthDate,
    string? Password = null,
    string? FormStamp = null,
    string? Website = null,
    IReadOnlyList<Guid>? LegalDocumentIds = null);

/// <param name="Joined">
/// True when the person was signed in and joined at once; false when a new account now waits for its confirmation.
/// </param>
/// <param name="EmailAvailable">False when this deployment sends no email, so no confirmation link is coming.</param>
public sealed record TraineeRegistrationResponse(
    string Email,
    string? DevelopmentConfirmationUrl,
    bool EmailAvailable,
    bool Joined);

public sealed record TraineeRegistrationResult(
    TraineeRegistrationStatus Status,
    string Email = "",
    string? DevelopmentConfirmationUrl = null,
    bool EmailAvailable = true,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    int? MinimumAge = null,
    DateOnly? OpensAgainOn = null);

public enum TraineeRegistrationStatus
{
    /// <summary>A new account was stored and its confirmation email queued.</summary>
    Created = 1,

    /// <summary>A signed-in account joined the house at once.</summary>
    Joined = 2,

    /// <summary>The honeypot was filled: answered as created, kept nowhere.</summary>
    Dropped = 3,

    Closed = 4,

    Full = 5,

    Invalid = 6,

    /// <summary>Sent sooner after the form appeared than a person could.</summary>
    TooFast = 7,

    /// <summary>The form stamp is missing, forged or older than a day.</summary>
    StampInvalid = 8,

    /// <summary>The date of birth has not reached the house's age.</summary>
    AgeNotMet = 9,

    /// <summary>The email already has an account, and nobody is signed in with it.</summary>
    ExistingAccountSignInRequired = 10,

    /// <summary>The form names a different email from the account that is signed in.</summary>
    WrongSignedInAccount = 11,

    /// <summary>The signed-in account is part of the house today, as a client or on its team.</summary>
    AlreadyJoined = 12,

    /// <summary>A legal document in force was not named, or one named has since been replaced.</summary>
    LegalAcceptanceRequired = 13,

    Conflict = 14,

    /// <summary>The signed-in account used to be on the house's team: its one membership row is a team member's.</summary>
    FormerStaff = 15,

    /// <summary>
    /// The house ended this person's coaching, or they left while it had blocked their access: coming back is the
    /// house's choice (an invitation), never their own.
    /// </summary>
    EndedByTheHouse = 16,

    /// <summary>The signed-in account already took a place of this house week; it signs up again from the next.</summary>
    AlreadySignedUpThisWeek = 17,
}

/// <param name="House">The workspace marked as the house; null while none is.</param>
/// <param name="Settings">Every house setting, each with its value in force and who last changed it; empty with no house.</param>
/// <param name="SignUp">Where sign-up stands this week; null with no house.</param>
public sealed record HouseAdminView(
    HouseWorkspaceView? House,
    IReadOnlyList<HouseSettingView> Settings,
    HouseSignUpView? SignUp);

public sealed record HouseWorkspaceView(
    Guid TenantId,
    string Name,
    string Slug,
    string TimeZoneId,
    DayOfWeek WeekStartsOn,
    DateOnly CurrentDate);

/// <param name="Value">The value in force; null while the setting is empty.</param>
/// <param name="Version">The number of the change in force, 0 while the setting was never changed. A change sends it back.</param>
public sealed record HouseSettingView(
    HouseSetting Setting,
    string? Value,
    int Version,
    DateTimeOffset? ChangedAtUtc = null,
    Guid? ChangedByUserId = null,
    string? ChangedByName = null);

/// <param name="SignUpsThisWeek">The week's places taken: sign-ups confirmed in it.</param>
/// <param name="WaitingForConfirmation">
/// Sign-ups of any week that hold no place yet: their email is not confirmed, or it was confirmed while the week
/// was full.
/// </param>
public sealed record HouseSignUpView(
    TraineeSignUpStatus Status,
    DateOnly WeekStartsOn,
    DateOnly WeekEndsOnExclusive,
    int SignUpsThisWeek,
    int WaitingForConfirmation);

/// <param name="Value">The new value as typed; null or blank empties the setting.</param>
/// <param name="ExpectedVersion">The version the admin's page read, so two admins never overwrite each other.</param>
public sealed record ChangeHouseSettingRequest(string? Value, int ExpectedVersion);

public sealed record HouseSettingResult(
    HouseSettingStatus Status,
    HouseSettingView? Setting = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public enum HouseSettingStatus
{
    Changed = 1,

    /// <summary>No workspace is marked as the house, so it has no settings to change.</summary>
    NoHouse = 2,

    Invalid = 3,

    /// <summary>The setting changed since the page read it.</summary>
    Conflict = 4,

    NotFound = 5,
}
