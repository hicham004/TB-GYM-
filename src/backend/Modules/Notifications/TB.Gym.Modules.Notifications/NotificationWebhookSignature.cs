using System.Buffers.Text;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// Verifies a provider webhook against the exact bytes it was signed over.
/// </summary>
/// <remarks>
/// The scheme is the one Resend publishes through Svix, and is the Standard Webhooks construction:
/// the signed content is <c>{id}.{timestamp}.{body}</c>, the key is the base64 payload of a
/// <c>whsec_</c> secret, the MAC is HMAC-SHA256, and the header carries a space-delimited list of
/// <c>v1,&lt;base64&gt;</c> signatures so a secret can be rotated with both keys live.
/// <para>
/// Three properties matter more than the algorithm and are the reason this is a pure function over a
/// byte span rather than something layered on a parsed model:
/// </para>
/// <list type="bullet">
/// <item><description><b>The raw body is what is verified.</b> Deserializing first and re-serializing
/// changes whitespace, member order and number formatting, and verifies something the provider never
/// signed.</description></item>
/// <item><description><b>The timestamp is signed and checked.</b> Without a bounded tolerance a valid
/// capture stays valid forever, and an attacker who once observed a bounce event can replay it to
/// suppress somebody's mail at any later time.</description></item>
/// <item><description><b>Comparison is constant time.</b> A byte-at-a-time comparison over a MAC is a
/// forgery oracle.</description></item>
/// </list>
/// <para>
/// Nothing here allocates a string from the body, and no failure reason quotes a header, a signature
/// or a secret: a caller learns only which rule was broken.
/// </para>
/// </remarks>
public static class NotificationWebhookSignature
{
    /// <summary>The named scheme, snapshotted onto every persisted provider event.</summary>
    public const string SchemeName = "standard-webhooks-hmac-sha256-v1";

    public const int SchemeVersion = 1;

    public const string IdHeader = "svix-id";

    public const string TimestampHeader = "svix-timestamp";

    public const string SignatureHeader = "svix-signature";

    public const string SecretPrefix = "whsec_";

    public const string SignatureVersionPrefix = "v1,";

    /// <summary>The shortest secret this build accepts. The provider issues 24 bytes.</summary>
    public const int MinimumSecretBytes = 16;

    /// <summary>A bound on every header this reads, so a hostile caller cannot make verification expensive.</summary>
    public const int MaximumHeaderLength = 1024;

    /// <summary>The provider's event identifier is stored, so it is bounded before it is trusted.</summary>
    public const int MaximumEventIdLength = 120;

    /// <summary>
    /// Decodes a configured <c>whsec_</c> secret, or explains why it is not one. The explanation never
    /// includes the value.
    /// </summary>
    public static bool TryParseSecret(string? configured, out byte[] key, out string? error)
    {
        key = [];
        if (string.IsNullOrWhiteSpace(configured))
        {
            error = "is required for the provider adapter.";
            return false;
        }

        if (!configured.StartsWith(SecretPrefix, StringComparison.Ordinal))
        {
            error = $"must start with '{SecretPrefix}', as issued by the provider.";
            return false;
        }

        var encoded = configured[SecretPrefix.Length..];
        var buffer = new byte[Base64.GetMaxDecodedFromUtf8Length(Math.Max(encoded.Length, 1))];
        if (!Convert.TryFromBase64String(encoded, buffer, out var written) || written < MinimumSecretBytes)
        {
            error = $"must be base64 for at least {MinimumSecretBytes} bytes after the prefix.";
            return false;
        }

        key = buffer[..written];
        error = null;
        return true;
    }

    /// <summary>
    /// Verifies one signed request. Every check that can be made without the key is made first, so a
    /// malformed or expired request costs no MAC computation.
    /// </summary>
    public static NotificationWebhookSignatureVerdict Verify(
        ReadOnlySpan<byte> key,
        string? eventId,
        string? timestamp,
        string? signature,
        ReadOnlySpan<byte> body,
        DateTimeOffset now,
        TimeSpan tolerance)
    {
        if (key.IsEmpty || tolerance <= TimeSpan.Zero)
        {
            return NotificationWebhookSignatureVerdict.NotConfigured;
        }

        if (!IsUsableHeader(eventId, MaximumEventIdLength) ||
            !IsUsableHeader(timestamp, MaximumHeaderLength) ||
            !IsUsableHeader(signature, MaximumHeaderLength))
        {
            return NotificationWebhookSignatureVerdict.MissingHeaders;
        }

        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds))
        {
            return NotificationWebhookSignatureVerdict.MalformedTimestamp;
        }

        DateTimeOffset signedAt;
        try
        {
            signedAt = DateTimeOffset.FromUnixTimeSeconds(seconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            return NotificationWebhookSignatureVerdict.MalformedTimestamp;
        }

        // Both directions. A future timestamp is as much a sign of a forged or replayed request as a
        // stale one, and accepting it would let an attacker mint a capture that stays valid for days.
        if ((now - signedAt).Duration() > tolerance)
        {
            return NotificationWebhookSignatureVerdict.Expired;
        }

        Span<byte> expected = stackalloc byte[HMACSHA256.HashSizeInBytes];
        ComputeMac(key, eventId!, timestamp!, body, expected);

        // One buffer, reused. Allocating inside the loop would let a header carrying many candidate
        // signatures grow the stack frame without bound.
        Span<byte> provided = stackalloc byte[HMACSHA256.HashSizeInBytes];
        var matched = false;
        var wellFormed = false;
        foreach (var candidate in signature!.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!candidate.StartsWith(SignatureVersionPrefix, StringComparison.Ordinal))
            {
                // A version this build does not implement is not a malformed request; the scheme is
                // explicitly versioned so a provider may send several at once.
                continue;
            }

            if (!Convert.TryFromBase64String(candidate[SignatureVersionPrefix.Length..], provided, out var written) ||
                written != HMACSHA256.HashSizeInBytes)
            {
                continue;
            }

            wellFormed = true;

            // Deliberately without an early exit. Every well-formed candidate is compared in constant
            // time and the result is accumulated, so neither the number of comparisons nor the time
            // they take tells a caller which one was close.
            matched |= CryptographicOperations.FixedTimeEquals(provided, expected);
        }

        if (!wellFormed)
        {
            return NotificationWebhookSignatureVerdict.MalformedSignature;
        }

        return matched
            ? NotificationWebhookSignatureVerdict.Valid
            : NotificationWebhookSignatureVerdict.SignatureMismatch;
    }

    /// <summary>
    /// The signing side of the same construction, so tests can produce a genuinely signed request
    /// instead of asserting against a constant somebody copied out of a document.
    /// </summary>
    public static string Sign(ReadOnlySpan<byte> key, string eventId, string timestamp, ReadOnlySpan<byte> body)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(eventId);
        ArgumentException.ThrowIfNullOrWhiteSpace(timestamp);
        Span<byte> mac = stackalloc byte[HMACSHA256.HashSizeInBytes];
        ComputeMac(key, eventId, timestamp, body, mac);
        return SignatureVersionPrefix + Convert.ToBase64String(mac);
    }

    private static void ComputeMac(
        ReadOnlySpan<byte> key,
        string eventId,
        string timestamp,
        ReadOnlySpan<byte> body,
        Span<byte> destination)
    {
        var idBytes = Encoding.UTF8.GetByteCount(eventId);
        var timestampBytes = Encoding.UTF8.GetByteCount(timestamp);
        var content = new byte[idBytes + 1 + timestampBytes + 1 + body.Length];
        var offset = Encoding.UTF8.GetBytes(eventId, content);
        content[offset++] = (byte)'.';
        offset += Encoding.UTF8.GetBytes(timestamp, content.AsSpan(offset));
        content[offset++] = (byte)'.';
        body.CopyTo(content.AsSpan(offset));
        HMACSHA256.HashData(key, content, destination);
    }

    private static bool IsUsableHeader(string? value, int maximumLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= maximumLength && IsPrintableAscii(value);

    private static bool IsPrintableAscii(string value)
    {
        foreach (var character in value)
        {
            if (character is < ' ' or > '~')
            {
                return false;
            }
        }

        return true;
    }
}

/// <summary>
/// Why a signed webhook was or was not accepted. Every refusal is one 401 to the caller; the
/// distinction exists for tests and for a counter, never for a response body.
/// </summary>
public enum NotificationWebhookSignatureVerdict
{
    Valid = 1,
    MissingHeaders = 2,
    MalformedTimestamp = 3,
    Expired = 4,
    MalformedSignature = 5,
    SignatureMismatch = 6,

    /// <summary>This deployment has no signing secret, so nothing can be verified and nothing is accepted.</summary>
    NotConfigured = 7,
}
