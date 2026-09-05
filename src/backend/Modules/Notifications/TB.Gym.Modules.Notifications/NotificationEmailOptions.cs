using System.Buffers.Text;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// Whether this deployment may materialize email at all, with what, and against which provider.
/// </summary>
/// <remarks>
/// Disabled by default, and validated at startup in both composition roots rather than discovered at
/// the first send. A deployment that believes it is emailing people while the messages go into a
/// process's memory — or into an endpoint somebody typo'd — is worse than a process that refuses to
/// start, so every rule below fails closed:
/// <list type="bullet">
/// <item><description>an unknown adapter name fails startup instead of being read as "none";</description></item>
/// <item><description><see cref="Enabled"/> with no adapter fails startup, because enabling a channel
/// that cannot send is a configuration error and not a quiet no-op;</description></item>
/// <item><description>the captured adapter in Production fails startup whether email is enabled or
/// not, so production configuration can never silently use it;</description></item>
/// <item><description>a provider adapter without its API key, sender, webhook signing secret or
/// address-fingerprint key fails startup, whether or not the channel is switched on: a half-configured
/// provider that one flag flip would activate is the failure this exists to prevent;</description></item>
/// <item><description>an endpoint that is not HTTPS, or in Production is not one of the provider's
/// own approved hosts, fails startup;</description></item>
/// <item><description>configuration that contradicts itself — provider secrets beside the captured
/// adapter, a webhook secret with no provider — fails startup rather than leaving somebody to guess
/// which half is in force.</description></item>
/// </list>
/// <para>
/// Secrets are read from configuration and environment only. Nothing here has a committed default,
/// nothing is written to a log, and <see cref="Validate"/> never quotes a configured value back.
/// </para>
/// </remarks>
public sealed class NotificationEmailOptions
{
    public const string SectionName = "Notifications:Email";

    /// <summary>Off by default. A durable channel that reaches a mailbox is opt-in for a deployment too.</summary>
    public bool Enabled { get; set; }

    public string Adapter { get; set; } = NotificationEmailAdapters.None;

    /// <summary>The production provider's own configuration. Ignored entirely unless the adapter names it.</summary>
    public NotificationEmailProviderOptions Provider { get; set; } = new();

    public bool IsKnownAdapter =>
        IsAdapter(NotificationEmailAdapters.None) ||
        IsAdapter(NotificationEmailAdapters.Captured) ||
        IsAdapter(NotificationEmailAdapters.Resend);

    public bool UsesCapturedAdapter => IsAdapter(NotificationEmailAdapters.Captured);

    public bool UsesProviderAdapter => IsAdapter(NotificationEmailAdapters.Resend);

    /// <summary>Whether email may actually be planned and materialized right now.</summary>
    public bool IsAvailable => Enabled && (UsesCapturedAdapter || UsesProviderAdapter);

    /// <summary>The adapter name recorded on a delivery this configuration materializes.</summary>
    public string? MaterializingAdapterName => Adapter switch
    {
        _ when UsesCapturedAdapter => NotificationEmailAdapters.CapturedAdapterName,
        _ when UsesProviderAdapter => NotificationEmailAdapters.ResendAdapterName,
        _ => null,
    };

    /// <summary>
    /// The startup rule, in one place so the API, the Worker and the architecture tests all assert the
    /// same thing. Returns null when the configuration is acceptable, or the reason it is not.
    /// </summary>
    public string? Validate(bool isProduction)
    {
        if (!IsKnownAdapter)
        {
            return $"{SectionName}:Adapter must be '{NotificationEmailAdapters.None}', " +
                $"'{NotificationEmailAdapters.Captured}' or '{NotificationEmailAdapters.Resend}'.";
        }

        if (isProduction && UsesCapturedAdapter)
        {
            return $"{SectionName}:Adapter cannot be '{NotificationEmailAdapters.Captured}' in Production; " +
                "captured email is a development and test adapter.";
        }

        if (Enabled && !UsesCapturedAdapter && !UsesProviderAdapter)
        {
            return $"{SectionName}:Enabled requires a configured email adapter.";
        }

        // Provider secrets beside an adapter that contacts nothing. One of the two is a mistake and
        // the deployment cannot know which, so neither is guessed at.
        if (!UsesProviderAdapter && Provider.IsConfigured)
        {
            return $"{SectionName}:Provider is configured while {SectionName}:Adapter is " +
                $"'{Adapter}', which contacts no provider.";
        }

        return UsesProviderAdapter ? Provider.Validate(isProduction) : null;
    }

    /// <summary>
    /// The provider's idempotency keys expire, so a retry schedule longer than that window would send
    /// a second real message under a key the provider has already forgotten.
    /// </summary>
    /// <remarks>
    /// Enforced at startup rather than documented and hoped for: the dispatch schedule and the
    /// retention window are configured in two different sections, and nothing else would notice that
    /// raising <c>Notifications:Dispatch:MaximumAttempts</c> had quietly crossed it.
    /// </remarks>
    public string? ValidateRetentionAgainst(int maximumAttempts)
    {
        if (!UsesProviderAdapter)
        {
            return null;
        }

        var retention = TimeSpan.FromHours(Provider.IdempotencyRetentionHours);
        var span = NotificationRetryPolicy.MaximumRetrySpan(maximumAttempts);
        return span <= retention
            ? null
            : $"{NotificationDispatchOptions.SectionName}:MaximumAttempts of {maximumAttempts} spans " +
                $"{span.TotalHours:0.##} hours under '{NotificationRetryPolicy.Name}', which exceeds the " +
                $"{Provider.IdempotencyRetentionHours}-hour provider idempotency retention window in " +
                $"{SectionName}:Provider:IdempotencyRetentionHours.";
    }

    private bool IsAdapter(string candidate) =>
        string.Equals(Adapter, candidate, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// One production transactional email provider's configuration.
/// </summary>
/// <remarks>
/// Every secret here comes from configuration or the environment and none of them has a committed
/// default. The shapes are validated, never the values: startup checks that a signing secret looks
/// like a signing secret and that a fingerprint key is long enough to be one, and it does not log,
/// echo or quote either.
/// </remarks>
public sealed class NotificationEmailProviderOptions
{
    /// <summary>The provider's send endpoint. Overridable so tests can point at a controlled double.</summary>
    public string Endpoint { get; set; } = NotificationEmailProviderEndpoints.ResendSend;

    /// <summary>The provider API key. Never logged, never echoed, never part of an exception.</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>The verified sending identity, such as <c>TB Gym &lt;notifications@mail.example.com&gt;</c>.</summary>
    public string FromAddress { get; set; } = string.Empty;

    /// <summary>How long one provider call may take. Allowed 1 to 60 seconds.</summary>
    public int TimeoutSeconds { get; set; } = 15;

    /// <summary>
    /// How long the provider remembers an idempotency key. Resend documents 24 hours; it is
    /// configurable only downwards, because claiming a longer window than the provider offers would
    /// make the startup check pass and the guarantee false.
    /// </summary>
    public int IdempotencyRetentionHours { get; set; } = NotificationEmailProviderEndpoints.ResendIdempotencyRetentionHours;

    /// <summary>The webhook signing secret, in the provider's own <c>whsec_</c> form.</summary>
    public string WebhookSigningSecret { get; set; } = string.Empty;

    /// <summary>
    /// How far a signed webhook timestamp may be from now, in either direction. Allowed 30 to 900
    /// seconds; the scheme's own libraries use 300.
    /// </summary>
    public int WebhookToleranceSeconds { get; set; } = 300;

    /// <summary>The largest webhook body this deployment will read. Allowed 1 KiB to 256 KiB.</summary>
    public int MaximumWebhookBodyBytes { get; set; } = 64 * 1024;

    /// <summary>The key id new address fingerprints are written under. Must name a configured key.</summary>
    public string FingerprintKeyId { get; set; } = string.Empty;

    /// <summary>
    /// Every fingerprint key this deployment can still recognise, by id, base64-encoded.
    /// </summary>
    /// <remarks>
    /// Rotation is additive and explicit. Adding a key and pointing
    /// <see cref="FingerprintKeyId"/> at it makes new fingerprints use it while every retired key in
    /// this map keeps matching the suppressions written under it; removing a key from the map is the
    /// deliberate act that drops those suppressions, and is the only way to drop them.
    /// </remarks>
    public Dictionary<string, string> FingerprintKeys { get; set; } = new(StringComparer.Ordinal);

    /// <summary>Whether anything provider-shaped has been configured at all.</summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ApiKey) ||
        !string.IsNullOrWhiteSpace(FromAddress) ||
        !string.IsNullOrWhiteSpace(WebhookSigningSecret) ||
        !string.IsNullOrWhiteSpace(FingerprintKeyId) ||
        FingerprintKeys.Count > 0 ||
        !string.Equals(Endpoint, NotificationEmailProviderEndpoints.ResendSend, StringComparison.Ordinal);

    public string? Validate(bool isProduction)
    {
        if (string.IsNullOrWhiteSpace(ApiKey))
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:ApiKey is required for the " +
                $"'{NotificationEmailAdapters.Resend}' adapter.";
        }

        if (string.IsNullOrWhiteSpace(FromAddress) || FromAddress.Length > 200)
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:FromAddress must be the verified " +
                "sending identity, at most 200 characters.";
        }

        if (NotificationEmailProviderEndpoints.Validate(Endpoint, isProduction) is { } endpointError)
        {
            return endpointError;
        }

        if (TimeoutSeconds is < 1 or > 60)
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:TimeoutSeconds must be between 1 and 60.";
        }

        if (IdempotencyRetentionHours is < 1 ||
            IdempotencyRetentionHours > NotificationEmailProviderEndpoints.ResendIdempotencyRetentionHours)
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:IdempotencyRetentionHours must be " +
                $"between 1 and {NotificationEmailProviderEndpoints.ResendIdempotencyRetentionHours}, which is " +
                "the window the provider documents.";
        }

        if (WebhookToleranceSeconds is < 30 or > 900)
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:WebhookToleranceSeconds must be " +
                "between 30 and 900.";
        }

        if (MaximumWebhookBodyBytes is < 1024 or > 262_144)
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:MaximumWebhookBodyBytes must be " +
                "between 1024 and 262144.";
        }

        if (!NotificationWebhookSignature.TryParseSecret(WebhookSigningSecret, out _, out var secretError))
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:WebhookSigningSecret {secretError}";
        }

        return ValidateFingerprintKeys();
    }

    /// <summary>
    /// Every configured fingerprint key, decoded, newest-written-under first. The active key leads so
    /// a suppression check matches the common case on its first comparison.
    /// </summary>
    public IReadOnlyList<NotificationAddressFingerprintKey> ResolveFingerprintKeys()
    {
        var keys = new List<NotificationAddressFingerprintKey>(FingerprintKeys.Count);
        if (FingerprintKeys.TryGetValue(FingerprintKeyId, out var active) &&
            TryDecodeKey(active, out var activeMaterial))
        {
            keys.Add(new NotificationAddressFingerprintKey(FingerprintKeyId, activeMaterial));
        }

        foreach (var (keyId, encoded) in FingerprintKeys.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
            if (!string.Equals(keyId, FingerprintKeyId, StringComparison.Ordinal) &&
                TryDecodeKey(encoded, out var material))
            {
                keys.Add(new NotificationAddressFingerprintKey(keyId, material));
            }
        }

        return keys;
    }

    private string? ValidateFingerprintKeys()
    {
        if (string.IsNullOrWhiteSpace(FingerprintKeyId) ||
            !NotificationAddressFingerprint.IsValidKeyId(FingerprintKeyId))
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:FingerprintKeyId must be 1 to 40 " +
                "characters of letters, digits, dot, dash or underscore.";
        }

        if (!FingerprintKeys.ContainsKey(FingerprintKeyId))
        {
            return $"{NotificationEmailOptions.SectionName}:Provider:FingerprintKeys must contain the " +
                "key named by FingerprintKeyId.";
        }

        foreach (var (keyId, encoded) in FingerprintKeys)
        {
            if (!NotificationAddressFingerprint.IsValidKeyId(keyId))
            {
                return $"{NotificationEmailOptions.SectionName}:Provider:FingerprintKeys contains a key id " +
                    "that is not 1 to 40 characters of letters, digits, dot, dash or underscore.";
            }

            if (!TryDecodeKey(encoded, out _))
            {
                return $"{NotificationEmailOptions.SectionName}:Provider:FingerprintKeys contains a key " +
                    $"that is not base64 for at least {NotificationAddressFingerprint.MinimumKeyBytes} bytes.";
            }
        }

        return null;
    }

    private static bool TryDecodeKey(string encoded, out byte[] material)
    {
        material = [];
        if (string.IsNullOrWhiteSpace(encoded))
        {
            return false;
        }

        var buffer = new byte[Base64.GetMaxDecodedFromUtf8Length(encoded.Length)];
        if (!Convert.TryFromBase64String(encoded, buffer, out var written) ||
            written < NotificationAddressFingerprint.MinimumKeyBytes)
        {
            return false;
        }

        material = buffer[..written];
        return true;
    }
}

/// <summary>One decoded address-fingerprint key and the id it is recorded under.</summary>
public sealed record NotificationAddressFingerprintKey(string KeyId, byte[] Material);

/// <summary>
/// The provider endpoints this build will talk to, and the rule for anything configured instead.
/// </summary>
/// <remarks>
/// The production allowlist is a constant rather than a setting. An endpoint is where an API key and
/// a recipient address are sent, so a deployment that can point it anywhere by configuration has a
/// credential-exfiltration switch; outside Production the rule relaxes only as far as loopback, which
/// is what lets the adapter be proven against a controlled HTTP double with no network at all.
/// </remarks>
public static class NotificationEmailProviderEndpoints
{
    public const string ResendSend = "https://api.resend.com/emails";

    /// <summary>The window the provider documents for an idempotency key.</summary>
    public const int ResendIdempotencyRetentionHours = 24;

    public static IReadOnlyList<string> ApprovedProductionHosts { get; } = ["api.resend.com"];

    public static string? Validate(string endpoint, bool isProduction)
    {
        const string setting = $"{NotificationEmailOptions.SectionName}:Provider:Endpoint";
        if (string.IsNullOrWhiteSpace(endpoint) ||
            !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            return $"{setting} must be an absolute URL with no user information, query or fragment.";
        }

        if (isProduction)
        {
            return uri.Scheme == Uri.UriSchemeHttps &&
                ApprovedProductionHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase)
                ? null
                : $"{setting} must be HTTPS on an approved provider host " +
                    $"({string.Join(", ", ApprovedProductionHosts)}) in Production.";
        }

        if (uri.Scheme == Uri.UriSchemeHttps)
        {
            return null;
        }

        return uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback
            ? null
            : $"{setting} must be HTTPS, or plain HTTP on loopback outside Production.";
    }
}
