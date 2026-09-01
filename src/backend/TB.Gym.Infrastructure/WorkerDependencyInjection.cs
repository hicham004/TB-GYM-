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
        IConfiguration configuration)
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
        return services;
    }

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
