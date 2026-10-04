namespace TB.Gym.Modules.Messaging;

/// <summary>One of the caller's saved replies (MSG-023).</summary>
public sealed record SavedReplyView(
    Guid Id,
    string Title,
    string Body,
    DateTimeOffset UpdatedAtUtc,
    uint Version);

/// <summary>The caller's saved replies in this workspace, by title, and how many one may keep.</summary>
public sealed record SavedReplyList(IReadOnlyList<SavedReplyView> Items, int Maximum);

public sealed record CreateSavedReplyRequest(string? Title, string? Body);

public sealed record EditSavedReplyRequest(string? Title, string? Body, uint Version);

public sealed record DeleteSavedReplyRequest(uint Version);

/// <summary>Stable conflict codes, so a screen never has to read prose to decide what happened.</summary>
public static class SavedReplyConflictCodes
{
    public const string LimitReached = "saved_reply_limit_reached";

    public const string StaleVersion = "saved_reply_stale_version";
}

public enum SavedReplyCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
}

public sealed record SavedReplyCommandResult(
    SavedReplyCommandStatus Status,
    SavedReplyView? Reply = null,
    string? Field = null,
    string? Detail = null,
    string? Code = null)
{
    public static SavedReplyCommandResult Success(SavedReplyView? reply) =>
        new(SavedReplyCommandStatus.Success, reply);

    public static SavedReplyCommandResult NotFound() => new(SavedReplyCommandStatus.NotFound);

    public static SavedReplyCommandResult Invalid(string field, string detail) =>
        new(SavedReplyCommandStatus.Invalid, Field: field, Detail: detail);

    public static SavedReplyCommandResult Conflict(string code, string detail) =>
        new(SavedReplyCommandStatus.Conflict, Code: code, Detail: detail);
}

/// <summary>
/// The signed-in Owner's or Coach's own saved replies in the active workspace. Nothing here takes a
/// user identifier: the owner is always the caller, and somebody else's reply is not found.
/// </summary>
/// <remarks>
/// A saved reply touches no client, so no coaching-feature decision applies to keeping one; using it
/// is sending a message, which is decided where messages are sent.
/// </remarks>
public interface ISavedReplyService
{
    Task<SavedReplyList> ListAsync(CancellationToken cancellationToken);

    Task<SavedReplyCommandResult> CreateAsync(CreateSavedReplyRequest request, CancellationToken cancellationToken);

    Task<SavedReplyCommandResult> EditAsync(
        Guid savedReplyId,
        EditSavedReplyRequest request,
        CancellationToken cancellationToken);

    Task<SavedReplyCommandResult> DeleteAsync(
        Guid savedReplyId,
        DeleteSavedReplyRequest request,
        CancellationToken cancellationToken);
}
