namespace TB.Gym.Modules.Identity;

/// <summary>One rendered action email. In memory only, for the duration of one transport call.</summary>
public sealed record AccountActionEmailContent(string TemplateKey, int TemplateVersion, string Subject, string Body);

/// <summary>
/// The complete, code-owned set of global account action-mail wordings.
/// </summary>
/// <remarks>
/// An allowlist compiled into the assembly: no Razor, no HTML, no database-authored markup, and no
/// format string a caller can influence. The only value composed into a body is the action URL, which
/// this application builds from its own validated configured origin and a token it just minted — never
/// from a request header, a query string or anything a caller supplied.
/// <para>
/// The wording is deliberately generic and says the minimum the action needs. It names no workspace,
/// no coach, no client, no product, no amount and no health-adjacent fact, because a mailbox is shown
/// on lock screens, on shared computers and in a provider's storage. It also does not name the account
/// it was sent to: the recipient already knows their own address, and repeating it would put it in one
/// more place.
/// </para>
/// <para>
/// Culture <c>en</c> and template version 1 are the only published wordings, matching the notification
/// catalogue. A later wording change publishes version 2 rather than rewriting what was already sent.
/// </para>
/// </remarks>
public static class AccountActionEmailTemplates
{
    public const string DefaultCulture = "en";

    public const int CurrentVersion = 1;

    public const string ConfirmEmailKey = "account.confirm-email";

    public const string ResetPasswordKey = "account.reset-password";

    /// <summary>Every published template key, for tests and for documentation of the allowlist.</summary>
    public static IReadOnlyList<string> PublishedKeys { get; } = [ConfirmEmailKey, ResetPasswordKey];

    /// <summary>
    /// Renders the wording for one action and one already-built action URL.
    /// </summary>
    /// <remarks>
    /// The URL is validated by the caller before it reaches here — absolute, from the configured
    /// origin, on an allowlisted host — because a template that accepted any string would be one
    /// substitution away from mailing somebody a link to somewhere else.
    /// </remarks>
    public static AccountActionEmailContent Render(AccountActionKind kind, string actionUrl)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionUrl);
        return kind switch
        {
            AccountActionKind.ConfirmEmail => new AccountActionEmailContent(
                ConfirmEmailKey,
                CurrentVersion,
                "Confirm your TB Gym email address",
                string.Concat(
                    "Somebody asked to confirm this email address for a TB Gym account.\n\n",
                    "Open this link to confirm it:\n\n",
                    actionUrl,
                    "\n\nThe link can be used once and expires. If you did not ask for this, ignore this\n",
                    "message: nothing changes until the link is opened.\n")),

            AccountActionKind.ResetPassword => new AccountActionEmailContent(
                ResetPasswordKey,
                CurrentVersion,
                "Reset your TB Gym password",
                string.Concat(
                    "Somebody asked to reset the password for a TB Gym account using this email address.\n\n",
                    "Open this link to choose a new password:\n\n",
                    actionUrl,
                    "\n\nThe link can be used once and expires. If you did not ask for this, ignore this\n",
                    "message: your password stays as it is and no action is needed.\n")),

            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unsupported account action kind."),
        };
    }
}
