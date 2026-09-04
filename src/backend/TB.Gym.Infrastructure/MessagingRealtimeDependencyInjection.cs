using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Infrastructure;

/// <summary>
/// Realtime messaging composition: options, the authorization port, the dispatcher and the sweep.
/// </summary>
/// <remarks>
/// Only the API composition root calls this. The notification Worker composes the narrow background
/// set and gains nothing from here: no hub context, no listener, no backplane and no exposed port.
/// <para>
/// The backplane itself is wired in the API project rather than here, because a lifetime manager is
/// an HTTP-host concern and because keeping the package reference out of this assembly is what stops
/// it travelling into the Worker image. Infrastructure only ever holds the validated options and the
/// dispatcher that publishes through <c>IHubContext</c>.
/// </para>
/// </remarks>
public static class MessagingRealtimeDependencyInjection
{
    internal static IServiceCollection AddTbGymMessagingRealtime(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        services.AddScoped<MessagingRealtimeAuthorizer>();
        services.AddScoped<IMessagingRealtimeAuthorizer>(provider =>
            provider.GetRequiredService<MessagingRealtimeAuthorizer>());
        services.AddScoped<IMessagingRealtimeDispatchService, MessagingRealtimeDispatchService>();
        // TryAdd so a test can substitute a barrier before this runs and still get every other part
        // of the real composition.
        services.TryAddSingleton<IMessagingRealtimeDispatchCheckpoint, NoOpMessagingRealtimeDispatchCheckpoint>();
        services.AddMessagingRealtimeOptions(configuration, environment);
        services.AddHostedService<MessagingRealtimeWorker>();
        return services;
    }

    /// <summary>
    /// Binds and validates the realtime options.
    /// </summary>
    /// <remarks>
    /// <c>ValidateOnStart</c>, so a deployment that declares several API replicas without a backplane,
    /// names Redis without an endpoint, asks for an unknown scale-out mode, or reaches production
    /// without an allowed hub origin fails to start rather than running and quietly delivering each
    /// frame only to the replica that published it.
    /// </remarks>
    public static IServiceCollection AddMessagingRealtimeOptions(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);
        var requireAllowedOrigins = !environment.IsDevelopment();
        services.AddOptions<MessagingRealtimeOptions>()
            .Bind(configuration.GetSection(MessagingRealtimeOptions.SectionName))
            // One rule set, stated once on the options type, so the startup check and the composition
            // that has to pick a lifetime manager before the host exists cannot drift apart.
            .Validate(
                options => options.Validate(requireAllowedOrigins) is null,
                "Messaging:Realtime is not a valid configuration.")
            .ValidateOnStart();
        return services;
    }

    /// <summary>
    /// Reads and validates the realtime options directly from configuration, for the composition that
    /// must decide how to build SignalR before there is a host to resolve options from.
    /// </summary>
    /// <remarks>
    /// The message deliberately names the setting and the consequence and never the connection
    /// string: a startup failure is printed to a console and shipped to a log aggregator, and a
    /// backplane credential in either is a credential in both.
    /// </remarks>
    public static MessagingRealtimeOptions ReadValidatedMessagingRealtimeOptions(
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        var options = new MessagingRealtimeOptions();
        configuration.GetSection(MessagingRealtimeOptions.SectionName).Bind(options);
        var problem = options.Validate(!environment.IsDevelopment());
        return problem is null ? options : throw new InvalidOperationException(problem);
    }
}
