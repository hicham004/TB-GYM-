using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api;

/// <summary>
/// The API host's realtime composition: SignalR itself, and the backplane when there is more than
/// one replica to reach.
/// </summary>
/// <remarks>
/// This lives in the API project, not in Infrastructure, so the Redis backplane package reference
/// never travels into the Worker. The Worker composes Infrastructure for its database and dispatch
/// services and must keep having no HTTP listener, no hub and no Redis dependency; a package
/// reference in Infrastructure would put the assembly in its image whether it used it or not.
/// </remarks>
internal static class MessagingRealtimeHosting
{
    public static WebApplicationBuilder AddTbGymRealtimeMessaging(this WebApplicationBuilder builder)
    {
        // Read and validated before the host exists, because which lifetime manager to build is a
        // decision that has to be made now. The same rules run again through ValidateOnStart, so a
        // deployment cannot pass here and fail there or the reverse.
        var realtime = MessagingRealtimeDependencyInjection.ReadValidatedMessagingRealtimeOptions(
            builder.Configuration,
            builder.Environment);

        var signalR = builder.Services.AddSignalR(hub =>
        {
            // Detailed errors return exception text to the caller. In a messaging hub that text is
            // the one place a body, a moderation reason or a schema detail could leave the server
            // without any code deliberately sending it, so it is on in Development only.
            hub.EnableDetailedErrors = builder.Environment.IsDevelopment();
        })
        .AddJsonProtocol(json =>
        {
            // Enums as names, exactly as the REST surface sends them and exactly as the generated
            // TypeScript expects. SignalR's protocol has its own serializer options and does not
            // inherit `ConfigureHttpJsonOptions`, so without this an event kind, a deletion kind and
            // a delivery state all arrive as bare numbers — which the browser's string-union
            // contract silently fails to deserialize, dropping the frame with no error anybody sees.
            json.PayloadSerializerOptions.Converters.Add(
                new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false));
        });

        // The workspace identifier travels in the hub query string, and the framework's request log
        // records every URL it serves at Information level. That one category is therefore capped at
        // Warning: a workspace identifier in a log aggregator is exactly what this phase's privacy
        // rules exclude, and there is no per-path logging filter to be more surgical with. Endpoint
        // tracing, authorization, rate limiting and every module's own logging are untouched, and a
        // request that actually fails still logs.
        builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);

        if (realtime.ScaleOut == MessagingScaleOutMode.Redis)
        {
            // The backplane fans a frame out to every replica holding a connection; it is not a
            // cache, not a queue and not a source of truth. A send lost during a Redis outage is lost
            // for good, which is exactly why PostgreSQL holds the event and catch-up can replay it.
            signalR.AddStackExchangeRedis(
                realtime.RedisConnectionString!,
                redis => redis.Configuration.ChannelPrefix =
                    StackExchange.Redis.RedisChannel.Literal(realtime.RedisChannelPrefix));

            // The backplane announces its endpoints — "Connecting to Redis endpoints: host:port" —
            // at Information level, and does so again on every reconnection. The credential is
            // stripped, but the endpoint is still deployment topology that has no business in a log
            // aggregator, and this repository's rule is that the backplane never appears in a log at
            // all. Nothing operational is lost by silencing it: every publication attempt already
            // records a stable, content-free outcome code in durable attempt history, and the
            // dispatcher logs that. A backplane that is down shows up as retrying publications with
            // `messaging-realtime-publish-transient`, which is the signal an operator can act on.
            builder.Logging.AddFilter("Microsoft.AspNetCore.SignalR.StackExchangeRedis", LogLevel.None);
            builder.Logging.AddFilter("StackExchange.Redis", LogLevel.None);
        }

        return builder;
    }

    /// <summary>
    /// The hub route: authenticated, with transport fallback left on.
    /// </summary>
    /// <remarks>
    /// <b>The route requires authentication and nothing more, and the workspace is verified inside
    /// the hub.</b> It cannot use the REST <c>TenantMember</c> policy, because that policy resolves
    /// the workspace from the <c>X-Tenant-Id</c> header and a browser cannot put a custom header on a
    /// WebSocket handshake — a hub behind it is a hub no browser can reach. This does not weaken
    /// anything: the REST surface keeps that policy unchanged, and <see cref="ChatHub"/> reads active
    /// membership of the query-string workspace from PostgreSQL before the connection is usable,
    /// which is strictly stronger than trusting a header the caller supplies.
    /// <para>
    /// Negotiation and the long-polling/SSE fallbacks stay enabled, because a browser behind a proxy
    /// that will not upgrade a WebSocket still has to be able to connect. The consequence is stated
    /// rather than avoided: a multi-replica deployment needs load-balancer session affinity, and this
    /// deliberately does not take the WebSockets-only, skip-negotiation exception that would remove
    /// that requirement at the cost of every client that cannot hold a WebSocket.
    /// </para>
    /// </remarks>
    public static WebApplication MapTbGymChatHub(this WebApplication app)
    {
        app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization();
        return app;
    }

    /// <summary>
    /// A single startup line naming the topology, so an operator can see which mode a replica came up
    /// in without reading configuration off the box.
    /// </summary>
    /// <remarks>
    /// It names the mode, the declared replica count and whether an origin allowlist is configured.
    /// It never names the backplane endpoint or the origins themselves: one is a credential and the
    /// other is deployment detail a log aggregator does not need.
    /// </remarks>
    public static WebApplication LogRealtimeTopology(this WebApplication app)
    {
        var options = app.Services.GetRequiredService<IOptions<MessagingRealtimeOptions>>().Value;
        var logger = app.Services.GetRequiredService<ILoggerFactory>()
            .CreateLogger("TB.Gym.Api.MessagingRealtime");
        LogTopology(
            logger,
            options.ScaleOut.ToString(),
            options.ApiReplicaCount,
            options.Enabled,
            options.AllowedOrigins.Count,
            null);
        return app;
    }

    private static readonly Action<ILogger, string, int, bool, int, Exception?> LogTopology =
        LoggerMessage.Define<string, int, bool, int>(
            LogLevel.Information,
            new EventId(6230, "MessagingRealtimeTopology"),
            "Realtime messaging is configured for {ScaleOut} across {ApiReplicaCount} declared API replicas (dispatch enabled: {DispatchEnabled}, allowed hub origins: {AllowedOriginCount}).");
}
