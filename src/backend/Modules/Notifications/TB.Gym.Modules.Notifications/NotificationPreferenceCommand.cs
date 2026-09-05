using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// Binds a preference idempotency key to the normalized command it was spent on.
/// </summary>
/// <remarks>
/// The fingerprint starts with the command name, the workspace and the member, so a key spent in one
/// workspace, on one operation, or by one person can never be honoured in another. Local times are
/// hashed in their already-normalized <c>HH:mm</c> form, so a retry differing only in how the browser
/// formatted them is recognised as the same command rather than written a second time.
/// <para>
/// The expected concurrency version is deliberately <b>not</b> part of the fingerprint. A client that
/// lost the response and re-read its settings before retrying carries a newer version, and binding to
/// it would turn an honest retry into a conflict about a change the caller already made.
/// </para>
/// </remarks>
public static class NotificationPreferenceFingerprint
{
    public static string ForUpdate(
        Guid tenantId,
        Guid userId,
        bool emailServiceEnabled,
        bool quietHoursEnabled,
        TimeOnly? quietHoursStartLocal,
        TimeOnly? quietHoursEndLocal)
    {
        // Quiet-hours times are only part of the command when quiet hours are on. Otherwise two
        // requests that both mean "off" but carry different leftover times would be different
        // commands, and a retry after a lost response would conflict with itself.
        var start = quietHoursEnabled ? NotificationLocalTime.Format(quietHoursStartLocal) : string.Empty;
        var end = quietHoursEnabled ? NotificationLocalTime.Format(quietHoursEndLocal) : string.Empty;
        return Hash(
            $"update-notification-preferences|{tenantId:N}|{userId:N}|{(emailServiceEnabled ? 1 : 0)}|{(quietHoursEnabled ? 1 : 0)}|{start}|{end}");
    }

    private static string Hash(string canonical) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
}

/// <summary>
/// The one wire format for a workspace-local time of day: 24-hour <c>HH:mm</c>, invariant culture.
/// </summary>
/// <remarks>
/// Minutes only. Seconds on a quiet-hours boundary would be a precision the feature cannot honour —
/// the sweep runs on an interval measured in seconds and the boundary is a policy, not a deadline —
/// and accepting them would invite a client to send a value the server then silently truncated.
/// </remarks>
public static class NotificationLocalTime
{
    public const string Format24Hour = "HH\\:mm";

    public static string? Format(TimeOnly? value) =>
        value?.ToString(Format24Hour, CultureInfo.InvariantCulture);

    /// <summary>
    /// Parses a wire value, rejecting anything that is not exactly <c>HH:mm</c>. Deliberately strict:
    /// a lenient parse accepts "9", "09:00:00.5" and locale-specific forms and then stores something
    /// the caller did not mean.
    /// </summary>
    public static bool TryParse(string? value, out TimeOnly parsed)
    {
        parsed = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return TimeOnly.TryParseExact(
            value.Trim(),
            Format24Hour,
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out parsed);
    }
}
