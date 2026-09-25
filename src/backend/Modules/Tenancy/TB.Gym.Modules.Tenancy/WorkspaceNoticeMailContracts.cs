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

    public const string CoachDepartedKey = "workspace-notice.coach-departed";

    public const string InvoiceIssuedKey = "workspace-notice.invoice-issued";

    public const string InvoiceDueSoonKey = "workspace-notice.invoice-due-soon";

    public const string InvoiceOverdueKey = "workspace-notice.invoice-overdue";

    // The billing notices name no amount, date or workspace either: the Billing page, behind the
    // owner's sign-in, shows the amount, the due date and how to pay (ADR 0028).
    public static WorkspaceNoticeEmailContent Render(WorkspaceNoticeKind kind) => kind switch
    {
        WorkspaceNoticeKind.InvoiceIssued => new WorkspaceNoticeEmailContent(
            InvoiceIssuedKey,
            CurrentVersion,
            "Your TB Gym invoice is ready",
            string.Concat(
                "A monthly TB Gym invoice for a workspace you own is ready.\n\n",
                "Sign in to TB Gym and open Billing under Settings to see the amount, the due date\n",
                "and how to pay.\n")),
        WorkspaceNoticeKind.InvoiceDueSoon => new WorkspaceNoticeEmailContent(
            InvoiceDueSoonKey,
            CurrentVersion,
            "Your TB Gym invoice is due soon",
            string.Concat(
                "A TB Gym invoice for a workspace you own is due soon and has not been paid yet.\n\n",
                "Sign in to TB Gym and open Billing under Settings to see the amount and how to pay.\n",
                "If you have already paid, you can ignore this message.\n")),
        WorkspaceNoticeKind.InvoiceOverdue => new WorkspaceNoticeEmailContent(
            InvoiceOverdueKey,
            CurrentVersion,
            "Your TB Gym invoice is overdue",
            string.Concat(
                "A TB Gym invoice for a workspace you own is past its due date.\n\n",
                "If it stays unpaid, the workspace becomes read-only for you and your coaches until it\n",
                "is paid. Your clients keep their access, and nothing is deleted.\n\n",
                "Sign in to TB Gym and open Billing under Settings to see the amount and how to pay.\n")),
        WorkspaceNoticeKind.CoachDeparted => new WorkspaceNoticeEmailContent(
            CoachDepartedKey,
            CurrentVersion,
            "Your coach on TB Gym has changed",
            string.Concat(
                "Your coach is no longer with a coaching workspace you belong to on TB Gym. The\n",
                "workspace will assign you a new coach.\n\n",
                "You can keep using TB Gym as usual. Nothing you recorded there has changed.\n")),
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
