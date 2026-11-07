namespace TB.Gym.Modules.Identity;

/// <summary>
/// The platform admin's certificate record (CLI-021, notes plan N4a): every coach of every coaching space with
/// their lines, adding a line, marking it confirmed, dropping a waiting one, taking a confirmed one down, and
/// erasing a coach's lines in a space on their request. Nothing here reaches a coach or a client yet (N4b).
/// </summary>
public interface ICoachCertificateAdminService
{
    /// <summary>
    /// Every active owner and coach of every coaching space, one row per membership, with their lines counted,
    /// and any membership no longer active that still holds a line, so a departed coach's request can be met.
    /// </summary>
    Task<IReadOnlyList<CoachCertificateCoachView>> ListCoachesAsync(CancellationToken cancellationToken);

    Task<CoachCertificateCommandResult<CoachCertificateLinesView>> ListLinesAsync(
        Guid userId,
        Guid tenantId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Adds a waiting line for active staff of the space; the same words and day for the same coach and space
    /// answer the line that exists (<see cref="CoachCertificateCommandStatus.Success"/>), so a double press adds
    /// nothing twice.
    /// </summary>
    Task<CoachCertificateCommandResult<CoachCertificateLineView>> AddLineAsync(
        Guid userId,
        Guid tenantId,
        AddCoachCertificateLineRequest? request,
        CancellationToken cancellationToken);

    Task<CoachCertificateCommandResult<CoachCertificateLineView>> ConfirmLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        ConfirmCoachCertificateLineRequest? request,
        CancellationToken cancellationToken);

    /// <summary>Deletes a waiting line outright: nothing about a "not confirmed" result is kept.</summary>
    Task<CoachCertificateCommandResult<CoachCertificateDropView>> DropLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        CoachCertificateLineChangeRequest? request,
        CancellationToken cancellationToken);

    Task<CoachCertificateCommandResult<CoachCertificateLineView>> TakeDownLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        CoachCertificateLineChangeRequest? request,
        CancellationToken cancellationToken);

    /// <summary>
    /// Erases every line of the coach in the space on their request (waiting ones dropped), the request's day kept;
    /// the answer carries counts only. It takes no version: a request covers every line, those added since too.
    /// </summary>
    Task<CoachCertificateCommandResult<CoachCertificateErasureView>> EraseAsync(
        Guid userId,
        Guid tenantId,
        EraseCoachCertificateLinesRequest? request,
        CancellationToken cancellationToken);
}

/// <summary>A coach's role in the space the row is about.</summary>
public enum CoachCertificateRole
{
    Owner = 1,
    Coach = 2,
    Client = 3,
}

/// <summary>
/// One membership on the admin's list: the coach, the space and their role in it, whether they are active staff
/// of it now (only then can a line be added), and their lines counted by state.
/// </summary>
public sealed record CoachCertificateCoachView(
    Guid UserId,
    string Name,
    string Email,
    Guid TenantId,
    string SpaceName,
    CoachCertificateRole Role,
    bool IsActiveStaff,
    int WaitingLines,
    int ConfirmedLines,
    int TakenDownLines,
    int ErasedLines);

/// <summary>
/// One coach's lines in one space, newest first, with the space's own today, the latest day a line or a request
/// may name.
/// </summary>
public sealed record CoachCertificateLinesView(
    Guid UserId,
    string Name,
    string Email,
    Guid TenantId,
    string SpaceName,
    CoachCertificateRole Role,
    bool IsActiveStaff,
    DateOnly SpaceToday,
    IReadOnlyList<CoachCertificateLineView> Lines);

/// <summary>
/// One line as the admin reads it. <see cref="Text"/> is the finished sentence of
/// <see cref="CoachCertificateLineWording"/> version <see cref="WordingVersion"/>, written in the space's language;
/// it, <see cref="What"/>, <see cref="ShownOn"/> and <see cref="ConfirmedByName"/> are null once erased. Every
/// <c>…On</c> day is the instant beside it read in the space's time zone. Names are display names, never ids.
/// </summary>
public sealed record CoachCertificateLineView(
    Guid Id,
    CoachCertificateLineState State,
    string? Text,
    string? What,
    DateOnly? ShownOn,
    int WordingVersion,
    string RecordedByName,
    DateTimeOffset RecordedAtUtc,
    DateOnly RecordedOn,
    DateTimeOffset? ConfirmedAtUtc,
    DateOnly? ConfirmedOn,
    string? ConfirmedByName,
    DateTimeOffset? TakenDownAtUtc,
    DateOnly? TakenDownOn,
    string? TakenDownByName,
    DateTimeOffset? ErasedAtUtc,
    DateOnly? ErasedOn,
    CoachCertificateErasureReason? ErasureReason,
    DateOnly? RequestedOn,
    string? ErasedByName,
    bool CoachShows,
    uint Version);

public sealed record AddCoachCertificateLineRequest(string? What, DateOnly? ShownOn);

public sealed record ConfirmCoachCertificateLineRequest(string? ConfirmedByName, uint? Version);

/// <summary>Drop and take down: the version of the line the admin saw.</summary>
public sealed record CoachCertificateLineChangeRequest(uint? Version);

public sealed record EraseCoachCertificateLinesRequest(DateOnly? RequestedOn);

/// <summary>What a drop removed: the line's id, so the page can tell which one went.</summary>
public sealed record CoachCertificateDropView(Guid LineId);

/// <summary>An erasure on request, in counts only: lines erased and waiting lines dropped.</summary>
public sealed record CoachCertificateErasureView(int Erased, int Dropped);

public enum CoachCertificateCommandStatus
{
    Success = 1,
    Created = 2,
    NotFound = 3,
    Invalid = 4,
    Conflict = 5,
}

public sealed record CoachCertificateCommandResult<T>(
    CoachCertificateCommandStatus Status,
    T? Value = default,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public static class CoachCertificateCommand
{
    public static CoachCertificateCommandResult<T> Success<T>(T value) =>
        new(CoachCertificateCommandStatus.Success, value);

    public static CoachCertificateCommandResult<T> Created<T>(T value) =>
        new(CoachCertificateCommandStatus.Created, value);

    public static CoachCertificateCommandResult<T> NotFound<T>() =>
        new(CoachCertificateCommandStatus.NotFound);

    public static CoachCertificateCommandResult<T> Invalid<T>(IReadOnlyDictionary<string, string[]> errors) =>
        new(CoachCertificateCommandStatus.Invalid, Errors: errors);

    public static CoachCertificateCommandResult<T> Conflict<T>(string code, string message) =>
        new(CoachCertificateCommandStatus.Conflict, Code: code, Message: message);
}
