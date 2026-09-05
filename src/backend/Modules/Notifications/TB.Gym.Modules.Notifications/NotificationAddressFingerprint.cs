using System.Security.Cryptography;
using System.Text;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The keyed fingerprint that lets suppression be about an address without storing one.
/// </summary>
/// <remarks>
/// Suppression has to be per address rather than per member, or a client who fixes a mistyped mailbox
/// stays silently suppressed by the old one's bounce for as long as the record exists. That requires
/// correlating "the address that bounced" with "the address we are about to write to", and the
/// obvious way to do it — storing the address, or a plain SHA-256 of it — is the wrong one.
/// <para>
/// An ordinary unsalted hash of an email address is not a pseudonym. The space of real addresses is
/// small and enumerable, so anybody holding the table can recover every address in it with a
/// dictionary; the digest is a synonym for the address, not a substitute for it. A keyed MAC is not,
/// because reversing it needs the key as well as the guess.
/// </para>
/// <para>
/// So this is HMAC-SHA256 under a configured key, recorded beside the id of the key that produced it.
/// Key management is deliberately explicit rather than implicit:
/// </para>
/// <list type="bullet">
/// <item><description>every fingerprint stores its <c>KeyId</c>, so a row can always be explained;</description></item>
/// <item><description>rotation is additive — a new key becomes the one new fingerprints are written
/// under, while every retired key stays configured and keeps matching the suppressions written under
/// it, so rotating does not quietly resurrect mail to addresses that bounced;</description></item>
/// <item><description>removing a retired key from configuration is the one act that drops those
/// suppressions, and it is a deliberate operator decision rather than a side effect;</description></item>
/// <item><description>losing the key entirely is recoverable in the only way that matters: the
/// suppressions written under it stop matching, mail resumes, and the provider's own suppression list
/// remains the backstop.</description></item>
/// </list>
/// <para>
/// The fingerprint is never reversible by this application either. Nothing reads an address out of
/// it; it exists only to answer "is this the same mailbox as the one that bounced".
/// </para>
/// </remarks>
public static class NotificationAddressFingerprint
{
    /// <summary>The named policy, snapshotted in documentation and asserted by tests.</summary>
    public const string PolicyName = "notification-address-fingerprint-hmac-sha256-v1";

    public const int PolicyVersion = 1;

    /// <summary>The shortest key material this build accepts, matching the MAC's own block security.</summary>
    public const int MinimumKeyBytes = 32;

    /// <summary>Lowercase hex of a SHA-256 MAC.</summary>
    public const int FingerprintLength = 64;

    public const int MaximumKeyIdLength = 40;

    /// <summary>
    /// Normalizes an address for fingerprinting.
    /// </summary>
    /// <remarks>
    /// Trimmed and lowercased with the invariant culture. The local part of an address is
    /// case-sensitive in the RFC and case-insensitive at every mail provider anybody actually uses, so
    /// treating <c>Sam@example.com</c> and <c>sam@example.com</c> as different mailboxes would let a
    /// bounce be sidestepped by a capitalization the recipient never chose. Nothing else is
    /// normalized: dots and plus-tags are meaningful at some providers and stripping them would
    /// suppress mail to a mailbox that never bounced.
    /// </remarks>
    public static string Normalize(string address)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(address);
        return address.Trim().ToLowerInvariant();
    }

    /// <summary>The fingerprint of <paramref name="address"/> under one key, as lowercase hex.</summary>
    public static string Compute(ReadOnlySpan<byte> key, string address)
    {
        if (key.Length < MinimumKeyBytes)
        {
            throw new ArgumentException(
                $"An address fingerprint key must be at least {MinimumKeyBytes} bytes.",
                nameof(key));
        }

        var normalized = Normalize(address);
        var payload = Encoding.UTF8.GetBytes($"{PolicyName}:{normalized}");
        Span<byte> mac = stackalloc byte[HMACSHA256.HashSizeInBytes];
        HMACSHA256.HashData(key, payload, mac);
        return Convert.ToHexStringLower(mac);
    }

    /// <summary>
    /// Every fingerprint an address has under the configured keys, active key first. A suppression
    /// check compares against all of them so a rotation does not silently un-suppress a mailbox.
    /// </summary>
    public static IReadOnlyList<string> ComputeAll(
        IReadOnlyList<NotificationAddressFingerprintKey> keys,
        string address)
    {
        ArgumentNullException.ThrowIfNull(keys);
        var fingerprints = new List<string>(keys.Count);
        foreach (var key in keys)
        {
            var fingerprint = Compute(key.Material, address);
            if (!fingerprints.Contains(fingerprint, StringComparer.Ordinal))
            {
                fingerprints.Add(fingerprint);
            }
        }

        return fingerprints;
    }

    public static bool IsValidKeyId(string? keyId)
    {
        if (string.IsNullOrWhiteSpace(keyId) || keyId.Length > MaximumKeyIdLength)
        {
            return false;
        }

        foreach (var character in keyId)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character is not ('.' or '-' or '_'))
            {
                return false;
            }
        }

        return true;
    }

    public static bool IsValidFingerprint(string? fingerprint)
    {
        if (fingerprint is null || fingerprint.Length != FingerprintLength)
        {
            return false;
        }

        foreach (var character in fingerprint)
        {
            if (!char.IsAsciiDigit(character) && character is < 'a' or > 'f')
            {
                return false;
            }
        }

        return true;
    }
}

/// <summary>
/// The identifier a provider returns for one accepted message.
/// </summary>
/// <remarks>
/// Validated before it reaches a column, because it arrives in an untrusted response body and is then
/// used as a durable correlation key that a public webhook route looks rows up by. Bounded length and
/// a restricted alphabet keep it from becoming a place to smuggle whitespace, control characters or
/// something a log parser would read as structure.
/// </remarks>
public static class NotificationProviderMessageId
{
    public const int MaximumLength = 200;

    public static bool IsValid(string? providerMessageId)
    {
        if (string.IsNullOrEmpty(providerMessageId) || providerMessageId.Length > MaximumLength)
        {
            return false;
        }

        foreach (var character in providerMessageId)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_' or '.' or ':'))
            {
                return false;
            }
        }

        return true;
    }
}
