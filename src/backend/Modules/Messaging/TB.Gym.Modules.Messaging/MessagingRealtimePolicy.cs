using System.Globalization;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// Stable, bounded, content-free classifications for a failed publication.
/// </summary>
/// <remarks>
/// Every one of these reaches a durable row and a log line, so every one of them must be safe to show
/// to somebody who is not in the conversation: no body, no revision, no moderation reason, no name,
/// no address, no identifier, no Redis endpoint, no exception text. The list is enumerated rather
/// than derived from an exception, because an exception is exactly where a backplane connection
/// string or an untrusted response would eventually appear.
/// </remarks>
public static class MessagingRealtimeFailureCodes
{
    /// <summary>The hub or its backplane refused the send in a way that may succeed later.</summary>
    public const string PublishTransient = "messaging-realtime-publish-transient";

    /// <summary>The retry schedule ran out.</summary>
    public const string AttemptsExhausted = "messaging-realtime-attempts-exhausted";

    /// <summary>A claim lease expired before its attempt finished.</summary>
    public const string ClaimExpired = "messaging-realtime-claim-expired";

    /// <summary>A referenced row is absent or inconsistent; retrying will not fix it.</summary>
    public const string AggregateMismatch = "messaging-realtime-aggregate-mismatch";
}

/// <summary>
/// Why a queued publication stopped being one this participant may receive.
/// </summary>
/// <remarks>
/// Suppression is not failure. Nothing went wrong; current authorization simply says no, so no
/// projection is loaded, no frame is built and nothing is sent. The durable event survives, and a
/// later catch-up request may return it if that participant's authorization comes back — because the
/// catch-up request is authorized again, on its own terms, at the moment it is made.
/// </remarks>
public static class MessagingRealtimeSuppressionCodes
{
    public const string TenantInactive = "messaging-realtime-tenant-inactive";

    public const string RecipientBlocked = "messaging-realtime-recipient-blocked";

    public const string MembershipInactive = "messaging-realtime-membership-inactive";

    public const string RelationshipBlocked = "messaging-realtime-relationship-blocked";

    /// <summary>No explicit participant row for this user in this conversation any more.</summary>
    public const string NotAParticipant = "messaging-realtime-not-a-participant";

    /// <summary>The Messaging entitlement decision is currently denied.</summary>
    public const string FeatureDenied = "messaging-realtime-feature-denied";

    /// <summary>Realtime dispatch is switched off; REST and catch-up remain the whole truth.</summary>
    public const string DispatchDisabled = "messaging-realtime-dispatch-disabled";
}

/// <summary>
/// The named retry schedule, <c>messaging-realtime-backoff-v1</c>.
/// </summary>
/// <remarks>
/// A fixed table rather than a computed curve, so it can be asserted exactly and so changing it is a
/// visible, named decision. Realtime delivery is a convenience over a durable record, so the waits
/// are short and the ceiling is low: a frame nobody could be sent for five minutes is one the client
/// will have caught up on from PostgreSQL long before. Configured maxima beyond the table repeat the
/// last interval; a failure on the last permitted attempt dead-letters instead of waiting again.
/// Every instant comes from <c>IClock</c>, so tests move time rather than spending it.
/// </remarks>
public static class MessagingRealtimeRetryPolicy
{
    public const string Name = "messaging-realtime-backoff-v1";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(30),
        TimeSpan.FromMinutes(2),
        TimeSpan.FromMinutes(10),
    ];

    /// <summary>
    /// When the attempt numbered <paramref name="attemptNumber"/> should next be tried, or null when
    /// the schedule is exhausted and the row must be dead-lettered instead.
    /// </summary>
    public static DateTimeOffset? NextAttemptAtUtc(int attemptNumber, int maximumAttempts, DateTimeOffset now)
    {
        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        MessagingRealtimeOptions.ValidateMaximumAttempts(maximumAttempts);

        if (attemptNumber >= maximumAttempts)
        {
            return null;
        }

        var index = Math.Min(attemptNumber - 1, Backoff.Length - 1);
        return now.Add(Backoff[index]);
    }

    /// <summary>The backoff table, for tests and documentation.</summary>
    public static IReadOnlyList<TimeSpan> Schedule => Backoff;
}

/// <summary>How a deployment fans a hub frame out to every replica that holds a connection.</summary>
public enum MessagingScaleOutMode
{
    /// <summary>One API process. The in-process lifetime manager is the whole backplane.</summary>
    SingleProcess = 1,

    /// <summary>Several API processes sharing one Redis backplane.</summary>
    Redis = 2,
}

/// <summary>
/// Engineering parameters for realtime delivery, validated at startup so a misconfigured deployment
/// fails to start rather than silently losing frames.
/// </summary>
public sealed class MessagingRealtimeOptions
{
    public const string SectionName = "Messaging:Realtime";

    public const int DefaultMaximumAttempts = 5;

    public const int MinimumMaximumAttempts = 1;

    public const int MaximumMaximumAttempts = 20;

    /// <summary>
    /// Turns the dispatcher off without removing it. REST, catch-up and acknowledgement stay healthy;
    /// the API logs one safe line at startup saying realtime publication is not running.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How long the API-hosted sweep waits between passes. Allowed 1 to 300 seconds.</summary>
    public int PollIntervalSeconds { get; set; } = 2;

    /// <summary>
    /// The most recipient rows one sweep may claim in total, across every workspace. Global, not per
    /// workspace: a per-workspace cap multiplied by the number of workspaces is not a bound.
    /// </summary>
    public int BatchSize { get; set; } = 50;

    /// <summary>How long a claim stays valid before another replica may take it over.</summary>
    public int ClaimLeaseSeconds { get; set; } = 60;

    /// <summary>How many started attempts a publication gets before it is dead-lettered.</summary>
    public int MaximumAttempts { get; set; } = DefaultMaximumAttempts;

    /// <summary>
    /// How many API replicas this deployment declares. More than one requires a backplane, because
    /// the in-process lifetime manager only reaches connections held by the process that publishes.
    /// </summary>
    public int ApiReplicaCount { get; set; } = 1;

    public MessagingScaleOutMode ScaleOut { get; set; } = MessagingScaleOutMode.SingleProcess;

    /// <summary>
    /// The backplane endpoint. Never logged, never echoed into a failure code, never returned by an
    /// endpoint or a health check.
    /// </summary>
    public string? RedisConnectionString { get; set; }

    /// <summary>Namespaces this deployment's backplane keys so two environments cannot cross.</summary>
    public string RedisChannelPrefix { get; set; } = "tb-gym-signalr";

    /// <summary>
    /// The exact origins a cookie-authenticated hub connection may come from.
    /// </summary>
    /// <remarks>
    /// A WebSocket handshake is not protected by ordinary CORS, so the browser's <c>Origin</c> header
    /// is checked explicitly against this list. There is no wildcard: a wildcard origin with
    /// credentials is the configuration that makes every site on the internet able to open an
    /// authenticated socket as the signed-in user. Empty is allowed only in Development, where the
    /// Angular dev server proxies the hub.
    /// </remarks>
    public IList<string> AllowedOrigins { get; } = [];

    public static void ValidateMaximumAttempts(int maximumAttempts)
    {
        if (maximumAttempts is < MinimumMaximumAttempts or > MaximumMaximumAttempts)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumAttempts),
                $"Maximum attempts must be between {MinimumMaximumAttempts} and {MaximumMaximumAttempts}.");
        }
    }

    /// <summary>
    /// The one statement of what a valid realtime configuration is, shared by the options validation
    /// that runs at startup and by the composition that has to decide which lifetime manager to
    /// build before the host is running.
    /// </summary>
    /// <param name="requireAllowedOrigins">
    /// True outside Development, where an unconfigured origin list must fail closed rather than
    /// letting any site open an authenticated socket.
    /// </param>
    /// <returns>The first problem found, or null when the configuration is valid.</returns>
    public string? Validate(bool requireAllowedOrigins)
    {
        if (!Enum.IsDefined(ScaleOut))
        {
            return $"{SectionName}:ScaleOut must be SingleProcess or Redis.";
        }

        if (PollIntervalSeconds is < 1 or > 300)
        {
            return $"{SectionName}:PollIntervalSeconds must be between 1 and 300 seconds.";
        }

        if (BatchSize is < 1 or > 500)
        {
            return $"{SectionName}:BatchSize must be between 1 and 500.";
        }

        if (ClaimLeaseSeconds is < 15 or > 900)
        {
            return $"{SectionName}:ClaimLeaseSeconds must be between 15 and 900 seconds.";
        }

        if (MaximumAttempts is < MinimumMaximumAttempts or > MaximumMaximumAttempts)
        {
            return $"{SectionName}:MaximumAttempts must be between {MinimumMaximumAttempts} and {MaximumMaximumAttempts}.";
        }

        if (ApiReplicaCount is < 1 or > 100)
        {
            return $"{SectionName}:ApiReplicaCount must be between 1 and 100.";
        }

        // The load-bearing one. Several replicas without a backplane is not a degraded deployment,
        // it is one where a message reaches whichever replica happens to hold the sender's socket and
        // silently reaches nobody else — which looks like working software until somebody's client
        // never sees a reply.
        if (ApiReplicaCount > 1 && ScaleOut != MessagingScaleOutMode.Redis)
        {
            return $"{SectionName}:ApiReplicaCount is {ApiReplicaCount.ToString(CultureInfo.InvariantCulture)}, "
                + $"so {SectionName}:ScaleOut must be Redis. Several API replicas without a backplane "
                + "deliver each frame only to the replica that published it.";
        }

        if (ScaleOut == MessagingScaleOutMode.Redis && string.IsNullOrWhiteSpace(RedisConnectionString))
        {
            return $"{SectionName}:RedisConnectionString is required when {SectionName}:ScaleOut is Redis.";
        }

        if (string.IsNullOrWhiteSpace(RedisChannelPrefix) || RedisChannelPrefix.Length > 100)
        {
            return $"{SectionName}:RedisChannelPrefix must be 1 to 100 characters.";
        }

        foreach (var origin in AllowedOrigins)
        {
            if (!MessagingHubOrigin.IsValid(origin))
            {
                return $"{SectionName}:AllowedOrigins contains an entry that is not an absolute "
                    + "http or https origin without a path, or is a wildcard.";
            }
        }

        return requireAllowedOrigins && AllowedOrigins.Count == 0
            ? $"{SectionName}:AllowedOrigins must list at least one origin outside Development. "
                + "A cookie-authenticated WebSocket handshake is not protected by CORS."
            : null;
    }
}

/// <summary>
/// Origin comparison for the hub handshake.
/// </summary>
/// <remarks>
/// An origin is scheme, host and port and nothing else. Comparing the raw header string would make
/// <c>https://app.example.com</c> and <c>https://app.example.com/</c> different origins and
/// <c>HTTPS://APP.EXAMPLE.COM</c> neither, so both sides are normalized through <see cref="Uri"/>
/// before they are compared ordinally.
/// </remarks>
public static class MessagingHubOrigin
{
    public static bool IsValid(string? origin) => TryNormalize(origin, out _);

    public static bool TryNormalize(string? origin, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(origin) || origin.Contains('*', StringComparison.Ordinal))
        {
            return false;
        }

        if (!Uri.TryCreate(origin.Trim(), UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) ||
            parsed.PathAndQuery != "/" ||
            !string.IsNullOrEmpty(parsed.Fragment) ||
            !string.IsNullOrEmpty(parsed.UserInfo))
        {
            return false;
        }

        normalized = parsed.GetLeftPart(UriPartial.Authority);
        return true;
    }

    public static bool IsAllowed(string? origin, IEnumerable<string> allowedOrigins)
    {
        ArgumentNullException.ThrowIfNull(allowedOrigins);
        if (!TryNormalize(origin, out var candidate))
        {
            return false;
        }

        foreach (var allowed in allowedOrigins)
        {
            if (TryNormalize(allowed, out var normalized) &&
                string.Equals(normalized, candidate, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// The server-generated group names, and the only place they are built.
/// </summary>
/// <remarks>
/// A client never passes a group name. It passes a conversation identifier, the server re-establishes
/// that it may currently read that conversation, and then the server computes the name — so a caller
/// cannot address another user's group, another workspace's group, or a conversation it was never in,
/// because there is no input through which a name could be supplied.
/// <para>
/// Groups are routing, not authority. They are transient, they are lost on an ordinary reconnect,
/// they cannot be counted reliably across replicas, and removing somebody from one is a best-effort
/// convenience. Every hub method and every dispatched frame re-runs authorization; nothing depends on
/// a group having been left.
/// </para>
/// </remarks>
public static class MessagingRealtimeGroups
{
    /// <summary>Compact conversation-list invalidations for one signed-in user in one workspace.</summary>
    public static string TenantUser(Guid tenantId, Guid userId) =>
        $"msg:t:{tenantId:N}:u:{userId:N}";

    /// <summary>Full events for one user's currently open thread.</summary>
    public static string ConversationUser(Guid tenantId, Guid conversationId, Guid userId) =>
        $"msg:t:{tenantId:N}:c:{conversationId:N}:u:{userId:N}";
}
