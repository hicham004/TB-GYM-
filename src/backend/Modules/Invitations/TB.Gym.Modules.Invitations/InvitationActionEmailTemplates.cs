namespace TB.Gym.Modules.Invitations;

/// <summary>One rendered invitation email. In memory only, for the duration of one transport call.</summary>
public sealed record InvitationActionEmailContent(
    string TemplateKey,
    int TemplateVersion,
    string Subject,
    string Body);

/// <summary>
/// The complete, code-owned set of invitation action-mail wordings.
/// </summary>
/// <remarks>
/// An allowlist compiled into the assembly, with no Razor, no HTML, no database-authored markup and no
/// format string a caller can influence. The only value composed into a body is the action URL, built
/// by the application from its own validated configured origin and a token it just minted.
/// <para>
/// It deliberately does <b>not</b> name the workspace, the coach, the invitee, or anything about the
/// coaching relationship. A coach's client list is workspace-private, and an invitation email is the
/// one message this system sends to an address it has never confirmed — a mistyped character sends it
/// to a stranger. The link itself is what discloses the workspace, to somebody holding a single-use
/// credential, on a page behind the API's own authorization.
/// </para>
/// </remarks>
public static class InvitationActionEmailTemplates
{
    public const string DefaultCulture = "en";

    public const int CurrentVersion = 1;

    public const string InviteKey = "invitation.client-invite";

    public static IReadOnlyList<string> PublishedKeys { get; } = [InviteKey];

    public static InvitationActionEmailContent Render(string actionUrl)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionUrl);
        return new InvitationActionEmailContent(
            InviteKey,
            CurrentVersion,
            "You have been invited to TB Gym",
            string.Concat(
                "A coach has invited you to join them on TB Gym.\n\n",
                "Open this link to see the invitation and accept it:\n\n",
                actionUrl,
                "\n\nThe link can be used once and expires. If you were not expecting this, ignore this\n",
                "message: nothing is created until the invitation is accepted.\n"));
    }
}
