using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
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
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
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
            options.Cookie.Name = "XSRF-TOKEN";
            options.Cookie.HttpOnly = false;
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
            {
                var actor = context.User.FindFirstValue(ClaimTypes.NameIdentifier)
                    ?? context.Connection.RemoteIpAddress?.ToString()
                    ?? "unknown";
                var workspace = context.Request.Headers[TenantHeaders.TenantId].FirstOrDefault()
                    ?? "none";
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: $"{actor}:{workspace}",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 60,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    });
            });
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
            .AddCheck<PostgresHealthCheck>("postgres", tags: ["ready"]);

        return services;
    }
}
