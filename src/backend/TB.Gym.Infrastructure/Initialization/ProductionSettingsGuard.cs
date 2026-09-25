using System.Net;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Refuses a Production start that still carries a development setting.
/// </summary>
/// <remarks>
/// The adapters already refuse their own development values (captured email, local media, the
/// allow-everything scanner, an HTTP action origin, an ephemeral key ring). This covers the settings no
/// adapter owns: the ones the local compose file and a copied <c>.env</c> set, and that a production
/// deployment would otherwise carry across silently. Every problem is reported at once, naming the
/// setting and never quoting its value, so an operator fixes the file in one pass.
/// </remarks>
public static class ProductionSettingsGuard
{
    public static void EnsureNoDevelopmentSettings(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var problems = FindDevelopmentSettings(configuration);
        if (problems.Count > 0)
        {
            throw new InvalidOperationException(
                "Production refuses development settings: " + string.Join(" ", problems));
        }
    }

    public static IReadOnlyList<string> FindDevelopmentSettings(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var problems = new List<string>();

        if (configuration.GetValue<bool>("Seed:Enabled"))
        {
            problems.Add("Seed:Enabled is a development-only setting and must be false.");
        }

        // Migrations are the deployment's separate migrate step, run once before the API and the
        // Worker start; an API that migrates on boot races that step and runs DDL as the app role.
        if (configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
        {
            problems.Add("Database:ApplyMigrationsOnStartup must be false; run the migrate step instead.");
        }

        if (IsLoopbackOrigin(configuration["Application:PublicBaseUrl"]))
        {
            problems.Add("Application:PublicBaseUrl must be the public domain, not localhost.");
        }

        if (configuration.GetSection("Application:PublicOriginAllowlist").GetChildren()
            .Any(entry => IsLoopbackOrigin(entry.Value)))
        {
            problems.Add("Application:PublicOriginAllowlist must not list localhost.");
        }

        if (configuration.GetSection("Messaging:Realtime:AllowedOrigins").GetChildren()
            .Any(entry => !IsPublicHttpsOrigin(entry.Value)))
        {
            problems.Add("Messaging:Realtime:AllowedOrigins must list only the public HTTPS origin.");
        }

        // Both options copy SQL parameter values - names, emails, health answers - into exception
        // messages or logs. Useful on a laptop, a data leak in production.
        if (TryReadConnectionString(configuration.GetConnectionString("Database"), out var database) &&
            (database.IncludeErrorDetail || database.LogParameters))
        {
            problems.Add(
                "ConnectionStrings:Database must not enable Include Error Detail or Log Parameters.");
        }

        return problems;
    }

    private static bool TryReadConnectionString(string? value, out NpgsqlConnectionStringBuilder builder)
    {
        builder = new NpgsqlConnectionStringBuilder();
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        try
        {
            builder.ConnectionString = value;
            return true;
        }
        catch (ArgumentException)
        {
            // A malformed string is the database composition's error to report, not this guard's.
            return false;
        }
    }

    private static bool IsPublicHttpsOrigin(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) &&
        uri.Scheme == Uri.UriSchemeHttps &&
        !IsLoopbackHost(uri);

    private static bool IsLoopbackOrigin(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) && IsLoopbackHost(uri);

    private static bool IsLoopbackHost(Uri uri)
    {
        var host = uri.IdnHost.TrimEnd('.');
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return IPAddress.TryParse(host.Trim('[', ']'), out var address) &&
            (IPAddress.IsLoopback(address) ||
             address.Equals(IPAddress.Any) ||
             address.Equals(IPAddress.IPv6Any));
    }
}
