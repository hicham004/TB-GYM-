namespace TB.Gym.Modules.Tenancy;

/// <summary>Drains the workspace notice queue. The Worker sweeps it; tests call it directly.</summary>
public interface IWorkspaceNoticeMailDispatchService
{
    Task<WorkspaceNoticeMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken);
}

public sealed record WorkspaceNoticeMailDispatchOutcome(
    int Claimed = 0,
    int Materialized = 0,
    int Suppressed = 0,
    int Retried = 0,
    int DeadLettered = 0,
    int Reclaimed = 0)
{
    public int Total => Materialized + Suppressed + Retried + DeadLettered + Reclaimed;

    public WorkspaceNoticeMailDispatchOutcome Add(WorkspaceNoticeMailDispatchOutcome other) =>
        new(
            Claimed + other.Claimed,
            Materialized + other.Materialized,
            Suppressed + other.Suppressed,
            Retried + other.Retried,
            DeadLettered + other.DeadLettered,
            Reclaimed + other.Reclaimed);
}

/// <summary>One rendered notice email. In memory only, for the duration of one transport call.</summary>
public sealed record WorkspaceNoticeEmailContent(string TemplateKey, int TemplateVersion, string Subject, string Body);

/// <summary>
/// The complete, code-owned set of workspace notice wordings: fixed text, no values composed in.
/// </summary>
/// <remarks>
/// Like the invitation emails, it names no workspace, coach, client or reason. A mailbox is read on
/// lock screens and shared computers, and which gym somebody left — let alone why — is theirs to share.
/// The owner's reason stays in the workspace's own history and is never emailed.
/// </remarks>
public static class WorkspaceNoticeEmailTemplates
{
    public const int CurrentVersion = 1;

    public const string ClientReleasedKey = "workspace-notice.client-released";

    public static WorkspaceNoticeEmailContent Render(WorkspaceNoticeKind kind) => kind switch
    {
        WorkspaceNoticeKind.ClientReleased => new WorkspaceNoticeEmailContent(
            ClientReleasedKey,
            CurrentVersion,
            "Your access to a TB Gym workspace has ended",
            string.Concat(
                "A coaching workspace you were a client of on TB Gym has ended your access to it.\n\n",
                "You can no longer open that workspace. Your TB Gym account still works, and any other\n",
                "workspaces you belong to are not affected. Nothing you recorded there was deleted.\n\n",
                "If you think this is a mistake, contact your coach directly.\n")),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), "No wording is published for this notice."),
    };
}
