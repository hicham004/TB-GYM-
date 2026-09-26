using System.Text.RegularExpressions;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// Go-live preparation (commercial Step 4): who can become a platform admin, and what the single-server
/// production stack may expose.
/// </summary>
[TestClass]
public sealed partial class GoLiveBoundaryTests
{
    /// <summary>
    /// The global platform-admin role is granted only by the <c>platform-admin</c> CLI command, and by
    /// the development seed that Production refuses to run (ADR 0028). No endpoint, service or raw SQL
    /// writes a role membership.
    /// </summary>
    /// <remarks>
    /// A source scan rather than a reflection check, because the dangerous shapes are calls and SQL
    /// strings, not types. Anything new that grants a role has to be added here on purpose.
    /// </remarks>
    [TestMethod]
    public void OnlyTheCliCommandAndTheDevelopmentSeedGrantARole()
    {
        var allowed = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["TB.Gym.Infrastructure/Initialization/PlatformAdminCommand.cs"] = "AddToRoleAsync",
            ["TB.Gym.Infrastructure/Initialization/DatabaseInitializer.cs"] = "AddToRoleAsync",
            ["TB.Gym.Infrastructure/Persistence/GymDbContext.cs"] = "IdentityUserRole",
        };
        var backend = Path.Combine(RepositoryRoot(), "src", "backend");
        var offenders = new List<string>();
        foreach (var file in Directory.EnumerateFiles(backend, "*.cs", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(backend, file).Replace('\\', '/');
            if (relative.Contains("/obj/", StringComparison.Ordinal) ||
                relative.Contains("/bin/", StringComparison.Ordinal) ||
                relative.Contains("/Migrations/", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match match in RoleGrant().Matches(File.ReadAllText(file)))
            {
                if (!allowed.TryGetValue(relative, out var permitted) ||
                    !match.Value.StartsWith(permitted, StringComparison.Ordinal))
                {
                    offenders.Add($"{relative}: {match.Value}");
                }
            }
        }

        Assert.IsEmpty(offenders, "A role is granted outside the platform-admin command: " + string.Join("; ", offenders));
        var seed = File.ReadAllText(Path.Combine(backend, "TB.Gym.Infrastructure", "Initialization", "DatabaseInitializer.cs"));
        Assert.Contains("cannot run outside Development", seed, "The development seed lost its Production refusal.");
    }

    /// <summary>
    /// The production stack publishes ports only on the HTTPS edge, runs as Production, never seeds,
    /// never migrates from the API, and keeps the scanner private.
    /// </summary>
    [TestMethod]
    public void TheProductionStackExposesOnlyTheEdge()
    {
        var compose = File.ReadAllText(Path.Combine(RepositoryRoot(), "compose.production.yaml"));

        foreach (var service in new[] { "postgres", "migrate", "api", "worker", "web", "clamav", "backup" })
        {
            Assert.DoesNotContain(
                "ports:",
                Section(compose, $"  {service}:"),
                StringComparison.Ordinal,
                $"The {service} service publishes a port; only the edge may.");
        }

        var edge = Section(compose, "  edge:");
        Assert.Contains("\"80:80\"", edge, StringComparison.Ordinal);
        Assert.Contains("\"443:443\"", edge, StringComparison.Ordinal);

        var api = Section(compose, "  api:");
        Assert.Contains("ASPNETCORE_ENVIRONMENT: Production", api, StringComparison.Ordinal);
        Assert.Contains("Database__ApplyMigrationsOnStartup: \"false\"", api, StringComparison.Ordinal);
        Assert.Contains("Seed__Enabled: \"false\"", api, StringComparison.Ordinal);
        Assert.Contains("ReverseProxy__Enabled: \"true\"", api, StringComparison.Ordinal);
        Assert.Contains("DOTNET_ENVIRONMENT: Production", Section(compose, "  worker:"), StringComparison.Ordinal);

        var scanner = Section(compose, "  clamav:");
        Assert.Contains("@sha256:", scanner, StringComparison.Ordinal, "The scanner image is not pinned by digest.");
        Assert.Contains("user: \"clamav\"", scanner, StringComparison.Ordinal, "The scanner runs as root.");
        Assert.DoesNotContain("ENVIRONMENT: Development", compose, StringComparison.Ordinal);
        Assert.DoesNotContain("Adapter: Local", compose, StringComparison.Ordinal);
    }

    /// <summary>
    /// Compose substitutes variables in values only. A <c>${...}</c> inside a setting's name stays
    /// literal, so the setting silently never reaches the application (it hid the dev fingerprint key).
    /// </summary>
    [TestMethod]
    public void NoComposeSettingNameContainsAVariable()
    {
        foreach (var file in new[] { "compose.yaml", "compose.production.yaml" })
        {
            var offenders = File.ReadAllLines(Path.Combine(RepositoryRoot(), file))
                .Where(line => VariableInKey().IsMatch(line))
                .ToArray();

            Assert.IsEmpty(offenders, $"{file} puts a variable in a setting name: {string.Join("; ", offenders)}");
        }
    }

    [GeneratedRegex(@"(AddToRoles?Async|IdentityUserRole|INSERT\s+INTO\s+[^;]*UserRoles)", RegexOptions.IgnoreCase)]
    private static partial Regex RoleGrant();

    [GeneratedRegex(@"^\s*[^\s#:'""-][^\s#:'""]*\$\{[^}]*\}[^\s:]*:(\s|$)")]
    private static partial Regex VariableInKey();

    /// <summary>
    /// The block of a compose service, from its key at the start of a line to the next key at the same
    /// indent. Anchored to a line start so a <c>depends_on</c> entry of the same name is not mistaken for it.
    /// </summary>
    private static string Section(string compose, string key)
    {
        var start = compose.IndexOf("\n" + key, StringComparison.Ordinal);
        Assert.IsGreaterThan(-1, start, $"The compose file has no {key.Trim()} service.");
        start++;
        var next = compose.IndexOf("\n  ", start + key.Length, StringComparison.Ordinal);
        while (next > 0 && compose.Length > next + 3 && compose[next + 3] is ' ' or '#')
        {
            next = compose.IndexOf("\n  ", next + 3, StringComparison.Ordinal);
        }

        return next < 0 ? compose[start..] : compose[start..next];
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "TB.Gym.slnx")))
        {
            directory = directory.Parent;
        }

        Assert.IsNotNull(directory, "The repository root could not be located from the test output directory.");
        return directory.FullName;
    }
}
