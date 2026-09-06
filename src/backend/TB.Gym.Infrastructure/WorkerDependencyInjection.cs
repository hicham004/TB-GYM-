using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
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
    /// <param name="isDevelopment">
    /// Whether this is a Development host. It relaxes exactly one rule - an action link may be built
    /// from an http origin - and relaxes nothing else. Defaulted so that a caller which knows only
    /// "this is Production" gets the strict rules, which is the safe direction to be wrong in.
    /// </param>
    public static IServiceCollection AddTbGymNotificationWorkerInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isProduction,
        bool isDevelopment = false)
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

        // The Worker mints Identity tokens, so it needs Identity's token providers and the same data
        // protection key ring the API validates them against. AddIdentityCore brings the user store,
        // the token providers and nothing HTTP-shaped: no cookies, no SignInManager, no authentication
        // handlers. A token minted here and redeemed against the API only validates if both processes
        // share the key ring and the application name, so both are configured identically.
        services.AddIdentityCore<ApplicationUser>(ConfigureIdentityOptions)
            .AddEntityFrameworkStores<GymDbContext>()
            .AddDefaultTokenProviders();
        services.AddTbGymDataProtection(configuration, isProduction);

        services.AddNotificationDispatch(configuration);
        services.AddNotificationEmail(configuration, isProduction);
        services.AddActionMail(configuration, isProduction, isDevelopment);
        return services;
    }

    /// <summary>
    /// The Identity policy both composition roots configure, in one place.
    /// </summary>
    /// <remarks>
    /// Shared because a token provider's behaviour depends on these options, and two roots that
    /// disagreed about them would mint credentials one of them then refused.
    /// </remarks>
    internal static void ConfigureIdentityOptions(IdentityOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.User.RequireUniqueEmail = true;
        options.SignIn.RequireConfirmedEmail = true;
    }

    /// <summary>
    /// The shared data-protection key ring, named identically in both roots.
    /// </summary>
    /// <remarks>
    /// Confirmation and reset tokens are protected payloads. The Worker mints them and the API
    /// unprotects them, so an unshared key ring means every link this system sends is refused the
    /// moment it is clicked - a failure that reads as "the token is invalid" and is really a
    /// deployment mistake. <c>DataProtection:KeyPath</c> must point at the same persisted location for
    /// both processes.
    /// </remarks>
    internal static IServiceCollection AddTbGymDataProtection(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isProduction)
    {
        var dataProtection = services.AddDataProtection().SetApplicationName("TB.Gym");
        var keyPath = configuration["DataProtection:KeyPath"];
        if (isProduction && string.IsNullOrWhiteSpace(keyPath))
        {
            throw new InvalidOperationException(
                "DataProtection:KeyPath must name the shared persisted key ring in Production.");
        }

        if (!string.IsNullOrWhiteSpace(keyPath))
        {
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keyPath));
        }

        return services;
    }

    /// <summary>
    /// The tokenless action-mail path: a validated public origin, one transport, and the two queues.
    /// </summary>
    /// <remarks>
    /// Composed in both roots because both need it for different halves of the same job - the API
    /// enqueues and, outside Production, materializes inline for the capture adapter; the Worker drains
    /// the queues on a timer. Both validate the public origin identically, because a link built from
    /// the wrong origin is the same credential-harvesting failure whichever process built it.
    /// <para>
    /// The transport is the same provider client the notification channel uses, through the same named
    /// <c>HttpClient</c>. One provider is configured once; a second set of credentials would be a
    /// second thing to rotate and a second way for the two to disagree about who is sending.
    /// </para>
    /// </remarks>
    internal static IServiceCollection AddActionMail(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isProduction,
        bool isDevelopment)
    {
        var email = new NotificationEmailOptions();
        configuration.GetSection(NotificationEmailOptions.SectionName).Bind(email);
        var origin = new PublicActionOriginOptions();
        configuration.GetSection(PublicActionOriginOptions.SectionName).Bind(origin);
        var dispatch = new ActionMailDispatchOptions();
        configuration.GetSection(ActionMailDispatchOptions.SectionName).Bind(dispatch);

        services.AddOptions<PublicActionOriginOptions>()
            .Bind(configuration.GetSection(PublicActionOriginOptions.SectionName))
            // Validation and resolution are the same call: whatever decides the configuration is
            // acceptable is what computes the origin every link is built from, so a link can never be
            // built from a value that was not validated.
            .Validate(
                options => options.Validate(isDevelopment) is null,
                origin.Validate(isDevelopment)
                    ?? $"{PublicActionOriginOptions.SectionName} is not a valid public origin configuration.")
            .ValidateOnStart();

        services.AddOptions<ActionMailDispatchOptions>()
            .Bind(configuration.GetSection(ActionMailDispatchOptions.SectionName))
            .Validate(
                options => options.Validate(email, isProduction) is null,
                dispatch.Validate(email, isProduction)
                    ?? $"{ActionMailDispatchOptions.SectionName} is not a valid action mail configuration.")
            .ValidateOnStart();

        var valid = origin.Validate(isDevelopment) is null &&
            dispatch.Validate(email, isProduction) is null &&
            email.Validate(isProduction) is null;

        services.TryAddSingleton<PublicActionLinkBuilder>();
        services.TryAddSingleton<ActionMailFingerprintKeyring>();

        if (valid && email.UsesProviderAdapter)
        {
            services.TryAddSingleton<IActionEmailTransport, ResendActionEmailTransport>();
        }
        else if (valid && !isProduction)
        {
            // Outside Production a deployment with no provider still has to be able to prove the whole
            // path end to end, so the captured adapter carries it. Production never reaches this
            // branch and composes no action-mail transport when email is deliberately disabled; the
            // launch checklist makes a configured provider a release gate instead of changing the
            // Phase 6B-3A decision that an email-off deployment may start.
            services.TryAddSingleton<CapturedActionEmailTransport>();
            services.TryAddSingleton<IActionEmailTransport>(provider =>
                provider.GetRequiredService<CapturedActionEmailTransport>());
        }

        services.TryAddScoped<InvitationMailAuthorizationService>();
        services.TryAddScoped<IInvitationMailAuthorization>(provider =>
            provider.GetRequiredService<InvitationMailAuthorizationService>());

        services.TryAddScoped<AccountActionMailService>();
        services.TryAddScoped<IAccountActionMailScheduler>(provider =>
            provider.GetRequiredService<AccountActionMailService>());
        services.TryAddScoped<IAccountActionMailDispatchService>(provider =>
            provider.GetRequiredService<AccountActionMailService>());

        services.TryAddScoped<InvitationActionMailService>();
        services.TryAddScoped<IInvitationActionMailDispatchService>(provider =>
            provider.GetRequiredService<InvitationActionMailService>());

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
