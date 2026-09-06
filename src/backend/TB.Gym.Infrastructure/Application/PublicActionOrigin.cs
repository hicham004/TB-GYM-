using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The one place an action link's origin may come from.
/// </summary>
/// <remarks>
/// Every link in a confirmation, password-reset or invitation email is built from this validated
/// configuration and from nothing else. The request's <c>Host</c>, <c>X-Forwarded-Host</c> and
/// <c>Origin</c> headers are untrusted input and never reach a link: a host-header injection turns a
/// password-reset mail into a credential-harvesting mail that the victim's own account legitimately
/// triggered, and the victim has no way to tell.
/// <para>
/// The Worker has no request at all, which makes this easy to get right there and easy to get wrong in
/// the opposite direction — configuration is the only source available, so it must be present and
/// validated at startup rather than defaulted. Both composition roots therefore run exactly this
/// validation, and both refuse to start when it fails.
/// </para>
/// <para>
/// Outside Development the rules are deliberately strict: HTTPS, a host on an explicit allowlist, no
/// credentials, no query, no fragment and no path. A base URL carrying a path is how
/// <c>https://app.example.com/../evil</c> and <c>https://app.example.com@attacker.test</c> become
/// links that look like the product; refusing anything but a bare origin removes the class rather than
/// trying to sanitise it.
/// </para>
/// </remarks>
public sealed class PublicActionOriginOptions
{
    public const string SectionName = "Application";

    /// <summary>The origin every action link is built from. Scheme, host and optional port only.</summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// Every origin this deployment will build a link for.
    /// </summary>
    /// <remarks>
    /// Required outside Development, and <see cref="PublicBaseUrl"/> must be one of its entries. It is
    /// a list rather than a single value so that a planned migration between hosts is a configuration
    /// change reviewed in advance rather than an unchecked edit to one setting.
    /// </remarks>
    public IList<string> PublicOriginAllowlist { get; set; } = [];

    /// <summary>
    /// The validated origin, or null when the configuration is unusable. Never falls back to a
    /// default: a defaulted origin is how an action link quietly points at localhost in production.
    /// </summary>
    public Uri? ResolvedOrigin { get; private set; }

    /// <summary>
    /// The startup rule, in one place so the API, the Worker and the tests all assert the same thing.
    /// Returns null when the configuration is acceptable, or the reason it is not.
    /// </summary>
    public string? Validate(bool isDevelopment)
    {
        ResolvedOrigin = null;
        if (TryNormalizeOrigin(PublicBaseUrl, isDevelopment, out var origin, out var error) is false)
        {
            return $"{SectionName}:PublicBaseUrl {error}";
        }

        var allowed = new List<Uri>(PublicOriginAllowlist.Count);
        foreach (var candidate in PublicOriginAllowlist)
        {
            if (TryNormalizeOrigin(candidate, isDevelopment, out var allowedOrigin, out var allowlistError) is false)
            {
                return $"{SectionName}:PublicOriginAllowlist contains an entry that {allowlistError}";
            }

            allowed.Add(allowedOrigin!);
        }

        if (!isDevelopment)
        {
            if (allowed.Count == 0)
            {
                return $"{SectionName}:PublicOriginAllowlist must list at least one HTTPS origin " +
                    "outside Development.";
            }

            if (!allowed.Any(entry => IsSameOrigin(entry, origin!)))
            {
                return $"{SectionName}:PublicBaseUrl must be one of the origins in " +
                    $"{SectionName}:PublicOriginAllowlist.";
            }
        }

        ResolvedOrigin = origin;
        return null;
    }

    /// <summary>
    /// Parses one configured value into a bare origin, or explains why it is not one.
    /// </summary>
    /// <remarks>
    /// The refusals are the interesting part. User information is refused because
    /// <c>https://app.example.com@attacker.test</c> is a link to the attacker that reads as a link to
    /// the product. A query or fragment is refused because the action link appends its own and a
    /// configured one would either be lost or would change what the appended parameters mean. A path
    /// is refused because there is no legitimate use for one here and every illegitimate use is a
    /// traversal or a lookalike.
    /// </remarks>
    private static bool TryNormalizeOrigin(
        string? configured,
        bool isDevelopment,
        out Uri? origin,
        out string? error)
    {
        origin = null;
        if (string.IsNullOrWhiteSpace(configured))
        {
            error = "is required.";
            return false;
        }

        if (!Uri.TryCreate(configured.Trim(), UriKind.Absolute, out var parsed))
        {
            error = "must be an absolute URL.";
            return false;
        }

        if (!string.IsNullOrEmpty(parsed.UserInfo))
        {
            error = "must not contain user information.";
            return false;
        }

        if (!string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment))
        {
            error = "must not contain a query string or a fragment.";
            return false;
        }

        if (parsed.AbsolutePath is not ("" or "/"))
        {
            error = "must be a bare origin with no path.";
            return false;
        }

        if (parsed.Scheme == Uri.UriSchemeHttps)
        {
            origin = new Uri(parsed.GetLeftPart(UriPartial.Authority), UriKind.Absolute);
            error = null;
            return true;
        }

        if (isDevelopment && parsed.Scheme == Uri.UriSchemeHttp)
        {
            origin = new Uri(parsed.GetLeftPart(UriPartial.Authority), UriKind.Absolute);
            error = null;
            return true;
        }

        error = isDevelopment
            ? "must be HTTP or HTTPS."
            : "must be HTTPS outside Development.";
        return false;
    }

    private static bool IsSameOrigin(Uri left, Uri right) =>
        string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase) &&
        left.Port == right.Port;
}

/// <summary>
/// Builds the three action URLs, and only from the validated configured origin.
/// </summary>
/// <remarks>
/// It takes no <c>HttpContext</c>, holds no reference to one, and is registered as a singleton usable
/// from a process that has no requests at all. That is the design: a builder that <i>cannot</i> see a
/// request header cannot be persuaded to trust one.
/// </remarks>
internal sealed class PublicActionLinkBuilder(IOptions<PublicActionOriginOptions> options)
{
    private const string ConfirmEmailPath = "/auth/confirm-email";

    private const string ResetPasswordPath = "/auth/reset-password";

    private const string AcceptInvitationPath = "/invite";

    private readonly PublicActionOriginOptions settings = options.Value;

    /// <summary>Whether a link can be built at all. False is a permanent dispatch failure, never a guess.</summary>
    public bool IsAvailable => settings.ResolvedOrigin is not null;

    /// <summary>The validated origin, for diagnostics and for tests.</summary>
    public Uri? Origin => settings.ResolvedOrigin;

    public string? BuildAccountActionUrl(TB.Gym.Modules.Identity.AccountActionKind kind, Guid userId, string encodedCode)
    {
        var path = kind switch
        {
            TB.Gym.Modules.Identity.AccountActionKind.ConfirmEmail => ConfirmEmailPath,
            TB.Gym.Modules.Identity.AccountActionKind.ResetPassword => ResetPasswordPath,
            _ => null,
        };

        return path is null || settings.ResolvedOrigin is null
            ? null
            : QueryHelpers.AddQueryString(
                Combine(settings.ResolvedOrigin, path),
                new Dictionary<string, string?>
                {
                    ["userId"] = userId.ToString(),
                    ["code"] = encodedCode,
                });
    }

    public string? BuildInvitationUrl(string token) =>
        settings.ResolvedOrigin is null
            ? null
            : QueryHelpers.AddQueryString(
                Combine(settings.ResolvedOrigin, AcceptInvitationPath),
                "token",
                token);

    private static string Combine(Uri origin, string path) =>
        string.Concat(origin.GetLeftPart(UriPartial.Authority), path);
}
