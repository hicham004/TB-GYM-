using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Localization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Health;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Progress;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddTbGymInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        var connectionString = configuration.GetConnectionString("Database");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("ConnectionStrings:Database must be configured.");
        }

        services.AddHttpContextAccessor();
        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(provider => provider.GetRequiredService<TenantContext>());
        services.AddScoped<IMutableTenantContext>(provider => provider.GetRequiredService<TenantContext>());

        services.AddDbContext<GymDbContext>(options =>
            options.UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform");
                npgsql.EnableRetryOnFailure(3);
            }));

        services
            .AddIdentity<ApplicationUser, IdentityRole<Guid>>(options =>
            {
                options.Password.RequiredLength = 12;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = true;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.User.RequireUniqueEmail = true;
                options.SignIn.RequireConfirmedEmail = true;
            })
            .AddEntityFrameworkStores<GymDbContext>()
            .AddDefaultTokenProviders();

        services.Configure<SecurityStampValidatorOptions>(options =>
            options.ValidationInterval = TimeSpan.Zero);

        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.Name = environment.IsDevelopment() ? "tb-gym.auth" : "__Host-tb-gym.auth";
            options.Cookie.HttpOnly = true;
            options.Cookie.IsEssential = true;
            options.Cookie.Path = "/";
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = environment.IsDevelopment()
                ? CookieSecurePolicy.SameAsRequest
                : CookieSecurePolicy.Always;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
        });

        services.AddAntiforgery(options =>
        {
            options.Cookie.Name = "tb-gym-antiforgery";
            options.Cookie.HttpOnly = true;
            options.Cookie.Path = "/";
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = environment.IsDevelopment()
                ? CookieSecurePolicy.SameAsRequest
                : CookieSecurePolicy.Always;
            options.HeaderName = "X-XSRF-TOKEN";
        });

        services.AddAuthorization(options =>
        {
            options.AddPolicy(AuthorizationPolicies.PlatformAdmin, policy =>
                policy.RequireRole(SystemRoles.PlatformAdmin));
            options.AddPolicy(AuthorizationPolicies.TenantMember, policy =>
                policy.AddRequirements(new TenantRoleRequirement(
                    TenantRole.Owner,
                    TenantRole.Coach,
                    TenantRole.Client)));
            options.AddPolicy(AuthorizationPolicies.TenantOwner, policy =>
                policy.AddRequirements(new TenantRoleRequirement(TenantRole.Owner)));
            options.AddPolicy(AuthorizationPolicies.TenantCoach, policy =>
                policy.AddRequirements(new TenantRoleRequirement(
                    TenantRole.Owner,
                    TenantRole.Coach)));
            options.AddPolicy(AuthorizationPolicies.TenantClient, policy =>
                policy.AddRequirements(new TenantRoleRequirement(TenantRole.Client)));
        });

        services.AddScoped<IAuthorizationHandler, TenantRoleAuthorizationHandler>();
        services.AddScoped<ITenantMembershipStore, TenantMembershipStore>();
        services.AddScoped<IWorkspaceApplicationService, WorkspaceApplicationService>();
        services.AddScoped<IAccountEmailSender, AccountEmailSender>();
        services.AddScoped<IInvitationDelivery, CapturedInvitationDelivery>();
        services.AddScoped<IInvitationApplicationService, InvitationApplicationService>();
        services.AddScoped<IClientProfileApplicationService, ClientProfileApplicationService>();
        services.AddScoped<ICoachingFeatureAccessService, CoachingFeatureAccessService>();
        services.AddScoped<ICommercialApplicationService, CommercialApplicationService>();
        services.AddScoped<ILegalConsentApplicationService, LegalConsentApplicationService>();
        services.AddScoped<IExerciseLibraryApplicationService, ExerciseLibraryApplicationService>();
        services.AddScoped<IStrengthApplicationService, StrengthApplicationService>();
        services.AddScoped<ITrainingApplicationService, TrainingApplicationService>();
        services.AddScoped<INutritionApplicationService, NutritionApplicationService>();
        services.AddScoped<IProgressApplicationService, ProgressApplicationService>();
        services.AddScoped<CheckInAccessResolver>();
        services.AddScoped<ICheckInApplicationService, CheckInApplicationService>();
        services.AddScoped<ICheckInResponseApplicationService, CheckInResponseApplicationService>();
        services.AddScoped<IMessagingApplicationService, MessagingApplicationService>();
        services.AddTbGymMessagingRealtime(configuration, environment);
        services.AddHttpClient<INutritionDataProvider, UsdaFoodDataCentralProvider>((provider, client) =>
        {
            var configured = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<UsdaFoodDataCentralOptions>>().Value.BaseUrl;
            client.BaseAddress = new Uri(configured, UriKind.Absolute);
            client.Timeout = TimeSpan.FromSeconds(20);
        });
        services.AddSingleton<IAiMealDraftProvider, UnavailableAiMealDraftProvider>();
        services.AddOptions<UsdaFoodDataCentralOptions>()
            .Bind(configuration.GetSection("Nutrition:UsdaFoodDataCentral"));
        services.AddScoped<IMediaApplicationService, MediaApplicationService>();
        services.AddSingleton<MediaUploadConcurrencyGate>();
        services.AddSingleton<IObjectStorage, LocalObjectStorage>();
        services.AddSingleton<IMediaScanner>(_ => environment.IsDevelopment()
            ? new DevelopmentMediaScanner()
            : new UnavailableMediaScanner());
        services.AddScoped<IMediaPurgeService, MediaPurgeService>();
        services.AddHostedService<MediaPurgeWorker>();
        services.AddScoped<INotificationApplicationService, NotificationApplicationService>();
        services.AddScoped<INotificationPreferenceService, NotificationPreferenceService>();
        // The API composes the dispatcher so that integration tests can drive one sweep
        // deterministically. It runs no notification sweep of its own: dispatch is the Worker
        // process's job, and the API deliberately hosts no timer for it.
        services.AddNotificationDispatch(configuration);
        services.AddNotificationEmail(configuration, environment.IsProduction());
        services.AddOptions<MediaStorageOptions>()
            .Bind(configuration.GetSection(MediaStorageOptions.SectionName))
            .Validate(
                options => options.MaxWorkspaceStorageBytes is >= MediaUploadPolicy.MaximumImageBytes and <= 10L * 1024L * 1024L * 1024L * 1024L,
                "Media:MaxWorkspaceStorageBytes must be between 15 MB and 10 TB.")
            .Validate(
                // A client allowance below one image would reject every upload; above the workspace
                // ceiling it would never bind. Both are configuration mistakes worth failing on.
                options => options.MaxClientProgressPhotoBytes >= MediaUploadPolicy.MaximumImageBytes &&
                           options.MaxClientProgressPhotoBytes <= options.MaxWorkspaceStorageBytes,
                "Media:MaxClientProgressPhotoBytes must be between 15 MB and Media:MaxWorkspaceStorageBytes.")
            .Validate(
                options => options.PurgeIntervalSeconds is >= 30 and <= 86400,
                "Media:PurgeIntervalSeconds must be between 30 seconds and 24 hours.")
            .Validate(
                options => options.PurgeBatchSize is >= 1 and <= 1000,
                "Media:PurgeBatchSize must be between 1 and 1000.")
            .Validate(
                options => options.MaxConcurrentProgressPhotoDecodes is >= 1 and <= 8,
                "Media:MaxConcurrentProgressPhotoDecodes must be between 1 and 8.")
            .Validate(
                options => options.IngestCleanupAttemptTimeoutSeconds is >= 1 and <= 120,
                "Media:IngestCleanupAttemptTimeoutSeconds must be between 1 and 120.")
            .Validate(
                // The lower bound is deliberately a minute: sub-minute grants expire inside normal
                // request latency and produce intermittent playback failures rather than security.
                options => options.AccessLifetimeSeconds is >= 60 and <= 14400,
                "Media:AccessLifetimeSeconds must be between 60 seconds and 4 hours.")
            .ValidateOnStart();
        var dataProtection = services.AddDataProtection().SetApplicationName("TB.Gym");
        var dataProtectionKeyPath = configuration["DataProtection:KeyPath"];
        if (!string.IsNullOrWhiteSpace(dataProtectionKeyPath))
        {
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeyPath));
        }

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(RateLimitPolicies.PublicAuthentication, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 30,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    }));
            options.AddPolicy(RateLimitPolicies.SensitiveWrite, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ActorPartitionKey(context, "write"),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 60,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    }));
            options.AddPolicy(RateLimitPolicies.MediaUpload, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ActorPartitionKey(context, "media"),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromHours(1),
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    }));
        });

        var supportedCultures = new[]
        {
            CultureInfo.GetCultureInfo("en-LB"),
            CultureInfo.GetCultureInfo("ar-LB"),
        };
        services.Configure<RequestLocalizationOptions>(options =>
        {
            options.DefaultRequestCulture = new RequestCulture("en-LB");
            options.SupportedCultures = supportedCultures;
            options.SupportedUICultures = supportedCultures;
        });

        services.AddHealthChecks()
            .AddCheck("self", () => Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckResult.Healthy(), tags: ["live"])
            .AddCheck<PostgresHealthCheck>("postgres", tags: ["ready"])
            // Degraded, never unhealthy: an unscannable deployment refuses uploads but serves
            // everything else, so this makes the closed state visible without removing the
            // instance from rotation.
            .AddCheck<MediaScannerHealthCheck>("media-scanner", tags: ["ready"]);

        return services;
    }

    /// <summary>
    /// The bucket an authenticated-write policy counts against.
    /// </summary>
    /// <remarks>
    /// It is the signed-in user's own id, and nothing the caller supplies. The previous key mixed in
    /// the raw <c>X-Tenant-Id</c> request header, which is untrusted by design and is not verified
    /// until the tenant authorization handler runs well after this point — so a caller could reset
    /// their own allowance simply by varying that header, and an actor limit an attacker chooses the
    /// partition of is not a limit. The workspace dimension is gone rather than guessed at: one
    /// bucket per user is strictly tighter than one per user and workspace, and there is nothing
    /// verified here to split it by.
    /// <para>
    /// The source address remains the fallback for a request that is somehow unauthenticated on an
    /// authenticated route — the policies are only attached to routes behind a tenant policy, so it
    /// should not be reachable, but a limiter that fails open on a null claim would be worse than
    /// one that groups those requests by connection.
    /// </para>
    /// </remarks>
    private static string ActorPartitionKey(HttpContext context, string scope)
    {
        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        return userId is { Length: > 0 }
            ? $"{scope}:user:{userId}"
            : $"{scope}:address:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
    }
}
