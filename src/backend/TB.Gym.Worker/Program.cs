using TB.Gym.Infrastructure;

namespace TB.Gym.Worker;

/// <summary>
/// A second composition root of the same modular monolith, not a microservice.
/// </summary>
/// <remarks>
/// It shares the database, the domain assemblies and the tenant guards with the API; what it does not
/// share is the HTTP surface. It hosts no endpoints, runs no migrations — those stay a separate
/// deployment step, and this process retries until the schema is there — and composes only the narrow
/// set of services a background sweep needs.
/// <para>
/// Written as an explicit entry point rather than top-level statements: those emit a type named
/// <c>Program</c> in the global namespace, which collides with the API's own <c>Program</c> in any
/// assembly that references both, and the architecture tests reference both deliberately.
/// </para>
/// </remarks>
internal static class WorkerProgram
{
    private static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        builder.Logging.ClearProviders();
        builder.Logging.AddJsonConsole(options =>
        {
            options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
            options.UseUtcTimestamp = true;
        });

        builder.Services.AddTbGymNotificationWorkerInfrastructure(builder.Configuration);
        builder.Services.AddHostedService<NotificationDispatchWorker>();

        var host = builder.Build();
        await host.RunAsync();
    }
}
