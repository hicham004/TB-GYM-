using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure;

/// <summary>
/// The narrow composition path a background process needs, and nothing more.
/// </summary>
/// <remarks>
/// A worker that called <c>AddTbGymInfrastructure</c> to obtain a <see cref="GymDbContext"/> would
/// drag in cookie authentication, antiforgery, rate limiting, data protection, request localization,
/// health checks and every HTTP-shaped service in the API — none of which it can use, several of
/// which want an <c>HttpContext</c> that will never exist, and all of which would then have to be
/// kept working in a process that has no requests. This registers the database, the clock, the tenant
/// context, an explicitly anonymous background identity, and the dispatch service.
/// </remarks>
public static class WorkerDependencyInjection
{
    public static IServiceCollection AddTbGymNotificationWorkerInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isProduction)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString("Database");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:Database must be configured.");
        }

        services.AddSingleton<IClock, SystemClock>();
        // Deliberately anonymous. Audit stamps written by the sweep record no actor rather than
        // impersonating the coach or client whose data the notification happens to concern.
        services.AddSingleton<ICurrentUser, BackgroundSystemUser>();
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(provider => provider.GetRequiredService<TenantContext>());
        services.AddScoped<IMutableTenantContext>(provider => provider.GetRequiredService<TenantContext>());

        services.AddDbContext<GymDbContext>(options =>
            options.UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform");
                npgsql.EnableRetryOnFailure(3);
            }));

        services.AddNotificationDispatch(configuration);
        services.AddNotificationEmail(configuration, isProduction);
        return services;
    }

    /// <summary>
    /// The email seam and its startup-validated configuration, shared by both composition roots.
    /// </summary>
    /// <remarks>
    /// Validation is deliberately unforgiving, because every way this can be wrong is a way for a
    /// deployment to look like it is emailing people while it is not — or to email them through
    /// somewhere nobody intended. An unknown adapter, an enabled channel with nothing behind it, the
    /// captured development adapter in Production, a provider adapter missing its API key, sending
    /// identity, webhook signing secret or address-fingerprint key, an endpoint that is not HTTPS on
    /// an approved host in Production, and provider secrets sitting beside an adapter that contacts
    /// nothing all refuse startup.
    /// <para>
    /// One cross-section rule joins them: the provider remembers an idempotency key for a bounded
    /// window, so a retry schedule longer than that window would present a key the provider has
    /// forgotten and turn a deduplicated retry into a second real message. The configured
    /// <c>MaximumAttempts</c> is checked against the configured retention here, where both are
    /// visible, rather than left as a hazard in a document.
    /// </para>
    /// <para>
    /// A transport is registered only when it is both configured and permitted, so a deployment with
    /// no email adapter composes no transport at all rather than a disabled one somebody could
    /// resolve. Ingestion is registered unconditionally and answers <c>Unavailable</c> when there is no
    /// provider: the public route has to resolve it before it can decide anything, and a missing
    /// registration would turn that decision into a 500.
    /// </para>
    /// </remarks>
    internal static IServiceCollection AddNotificationEmail(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isProduction)
    {
        var configured = new NotificationEmailOptions();
        configuration.GetSection(NotificationEmailOptions.SectionName).Bind(configured);
        var dispatch = new NotificationDispatchOptions();
        configuration.GetSection(NotificationDispatchOptions.SectionName).Bind(dispatch);

        services.AddOptions<NotificationEmailOptions>()
            .Bind(configuration.GetSection(NotificationEmailOptions.SectionName))
            .Validate(options => options.Validate(isProduction) is null, ValidationMessage(configured, isProduction))
            .Validate(
                options => options.ValidateRetentionAgainst(dispatch.MaximumAttempts) is null,
                configured.ValidateRetentionAgainst(dispatch.MaximumAttempts)
                    ?? $"{NotificationEmailOptions.SectionName} retry span exceeds the provider idempotency retention window.")
            .ValidateOnStart();

        var valid = configured.Validate(isProduction) is null &&
            configured.ValidateRetentionAgainst(dispatch.MaximumAttempts) is null;
        if (valid && !isProduction && configured.UsesCapturedAdapter)
        {
            services.TryAddSingleton<CapturedNotificationEmailTransport>();
            services.TryAddSingleton<INotificationEmailTransport>(provider =>
                provider.GetRequiredService<CapturedNotificationEmailTransport>());
        }

        if (valid && configured.UsesProviderAdapter)
        {
            services.AddHttpClient(ResendNotificationEmailTransport.HttpClientName, client =>
            {
                // The adapter's own linked timeout is what classifies a slow provider, so this one is
                // deliberately looser: a handler timeout would surface as an ambiguous cancellation
                // instead of the stable code an operator needs.
                client.Timeout = TimeSpan.FromSeconds(configured.Provider.TimeoutSeconds + 5);
                client.DefaultRequestHeaders.UserAgent.ParseAdd(ResendNotificationEmailTransport.UserAgent);
            })
                // The factory's built-in logging is removed rather than tuned. It writes the request
                // URI at Information and, at Trace, every request header — which for this client means
                // the API key. The adapter already logs what an operator needs, as identifiers and
                // stable codes with no address, endpoint, body or credential in them, so the default
                // logging can only add things that must not be there. A deployment that turns on Trace
                // logging for diagnostics should not thereby start writing its own provider
                // credential into a log aggregator.
                .RemoveAllLoggers();
            services.TryAddSingleton<INotificationEmailTransport, ResendNotificationEmailTransport>();
        }

        services.TryAddScoped<INotificationProviderEventIngestion, NotificationProviderEventService>();
        services.TryAddScoped<INotificationRecipientContacts, NotificationRecipientContacts>();
        return services;
    }

    /// <summary>
    /// The exact reason, resolved once at composition, so a refused startup says which rule it broke
    /// rather than repeating the whole policy. It names a setting and never quotes its value.
    /// </summary>
    private static string ValidationMessage(NotificationEmailOptions configured, bool isProduction) =>
        configured.Validate(isProduction)
        ?? $"{NotificationEmailOptions.SectionName} is not a valid email configuration.";

    /// <summary>
    /// The dispatch service and its startup-validated engineering parameters, shared by the API
    /// composition root (which uses it for tests and diagnostics) and the Worker (which drives it).
    /// </summary>
    internal static IServiceCollection AddNotificationDispatch(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddScoped<INotificationDispatchService, NotificationDispatchService>();
        services.TryAddSingleton<INotificationDispatchCheckpoint, NoOpNotificationDispatchCheckpoint>();
        services.AddOptions<NotificationDispatchOptions>()
            .Bind(configuration.GetSection(NotificationDispatchOptions.SectionName))
            .Validate(
                // A sub-second poll is a busy loop against the database; five minutes between sweeps
                // is already a long time to leave a due notification sitting.
                options => options.PollIntervalSeconds is >= 1 and <= 300,
                "Notifications:Dispatch:PollIntervalSeconds must be between 1 and 300 seconds.")
            .Validate(
                options => options.BatchSize is >= 1 and <= 200,
                "Notifications:Dispatch:BatchSize must be between 1 and 200.")
            .Validate(
                // Below 30 seconds a lease can expire inside a normal sweep and cause needless
                // takeovers; above 15 minutes a crashed worker hides its item for too long.
                options => options.ClaimLeaseSeconds is >= 30 and <= 900,
                "Notifications:Dispatch:ClaimLeaseSeconds must be between 30 and 900 seconds.")
            .Validate(
                options => options.MaximumAttempts is
                    >= NotificationDispatchOptions.MinimumMaximumAttempts and
                    <= NotificationDispatchOptions.MaximumMaximumAttempts,
                $"Notifications:Dispatch:MaximumAttempts must be between {NotificationDispatchOptions.MinimumMaximumAttempts} and {NotificationDispatchOptions.MaximumMaximumAttempts}.")
            .ValidateOnStart();
        return services;
    }
}
