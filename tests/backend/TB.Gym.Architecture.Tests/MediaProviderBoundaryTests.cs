using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The boundaries Phase 6B-4B has to hold now that real providers sit behind the media ports.
/// </summary>
/// <remarks>
/// Selecting Cloudflare R2 and ClamAV is a deployment decision. It became a code decision the moment
/// an SDK entered the repository, so what is asserted here is that it entered exactly one assembly,
/// that the Media module still describes storage and scanning in its own words, and that the private
/// daemon in <c>compose.yaml</c> stays private, pinned and unprivileged.
/// </remarks>
[TestClass]
public sealed class MediaProviderBoundaryTests
{
    private static readonly Assembly MediaAssembly = typeof(MediaModule).Assembly;

    /// <summary>
    /// Words that name a provider rather than a stored object. HTTP words the module legitimately
    /// owns — an endpoint it serves, a multipart form it parses — are deliberately not here: the
    /// rule is about whose vocabulary storage is described in, not about banning a spelling.
    /// </summary>
    private static readonly string[] ProviderVocabulary =
    [
        "Amazon", "AWS", "S3", "R2", "Cloudflare", "Bucket", "ClamAv", "Clamd", "Instream",
        "ETag", "AccessKey", "SecretKey", "SigV4", "PresignedUrl",
    ];

    [TestMethod]
    public void OnlyInfrastructureReferencesTheStorageProviderSdk()
    {
        foreach (var assembly in new[]
                 {
                     MediaAssembly,
                     typeof(IClock).Assembly,
                     typeof(TB.Gym.Modules.Progress.ProgressModule).Assembly,
                 })
        {
            var references = assembly.GetReferencedAssemblies()
                .Select(reference => reference.Name ?? string.Empty)
                .Where(name => name.StartsWith("AWSSDK", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            Assert.IsEmpty(
                references,
                $"{assembly.GetName().Name} references {string.Join(", ", references)}; " +
                "the S3 client belongs to Infrastructure, behind IObjectStorage.");
        }

        Assert.Contains(
            "AWSSDK.S3",
            LoadByName("TB.Gym.Infrastructure").GetReferencedAssemblies()
                .Select(reference => reference.Name ?? string.Empty)
                .ToArray(),
            "The adapter that speaks S3 is the one assembly that may.");
    }

    /// <summary>
    /// One storage SDK and no scanner client at all. The clamd exchange is a command, a length-
    /// prefixed body and a status line, and the bounds that matter — a connect timeout, a whole-scan
    /// timeout, a capped reply and a limit that is never read as clean — are the decisions this
    /// repository has to make itself rather than inherit.
    /// </summary>
    [TestMethod]
    public void NoOtherObjectStoreOrScannerClientIsReferencedAnywhere()
    {
        string[] forbidden =
        [
            "Minio", "Azure.Storage", "Google.Cloud.Storage", "AWSSDK.S3Control", "AWSSDK.Transfer",
            "nClam", "ClamAV.Net", "ClamAvClient", "VirusTotal",
        ];

        var manifest = File.ReadAllText(Path.Combine(RepositoryRoot(), "Directory.Packages.props"));
        foreach (var package in forbidden)
        {
            Assert.DoesNotContain(
                package,
                manifest,
                StringComparison.OrdinalIgnoreCase,
                $"Directory.Packages.props references {package}; this phase adds one storage SDK and no scanner client.");
        }

        Assert.Contains(
            "AWSSDK.S3",
            manifest,
            StringComparison.Ordinal,
            "The one provider SDK this phase adds is declared centrally, with its licence and reason.");
    }

    /// <summary>
    /// The Media module owns the vocabulary. A locator names a location and a key; a scan result
    /// names a scanner and a verdict. Neither has ever heard of a bucket, a part or an ETag, and a
    /// module that started using those words would be a module that had taken on a provider.
    /// </summary>
    [TestMethod]
    public void TheMediaModuleSurfaceNamesNoProvider()
    {
        foreach (var type in MediaAssembly.GetTypes().Where(candidate => candidate.IsPublic))
        {
            AssertNamesNoProvider(type.Name, type.FullName!);
            foreach (var member in type.GetMembers(
                         BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
            {
                AssertNamesNoProvider(member.Name, $"{type.Name}.{member.Name}");
            }
        }
    }

    /// <summary>
    /// The adapters are implementation details of one assembly, so nothing outside it can hold a
    /// reference to one, resolve it by type, or grow a second caller that bypasses the port.
    /// </summary>
    [TestMethod]
    public void TheProviderAdaptersAreInternalToInfrastructure()
    {
        var infrastructure = LoadByName("TB.Gym.Infrastructure");
        foreach (var name in new[]
                 {
                     "R2ObjectStorage", "ClamAvMediaScanner", "R2StorageOptions", "ClamAvScannerOptions",
                     "OwnedObjectStream", "LocalObjectStorage", "UnavailableObjectStorage",
                 })
        {
            var type = infrastructure.GetTypes().SingleOrDefault(candidate => candidate.Name == name);
            Assert.IsNotNull(type, $"{name} is missing from Infrastructure.");
            Assert.IsFalse(type.IsPublic, $"{name} is public; a provider adapter is an implementation detail.");
        }
    }

    /// <summary>
    /// A resolver hands out whatever the application registered, so it is a way to reach every
    /// capability rather than a dependency on one.
    /// </summary>
    private static readonly Type[] BroadResolvers =
    [
        typeof(IServiceProvider),
        typeof(IKeyedServiceProvider),
        typeof(IServiceScopeFactory),
        typeof(IServiceScope),
        typeof(IServiceCollection),
    ];

    /// <summary>
    /// Names of methods that hand back an arbitrary service. Matched exactly rather than by
    /// substring, so an honest port whose own vocabulary happens to contain one of these words is
    /// not mistaken for a container.
    /// </summary>
    private static readonly string[] ResolverMethods =
    [
        "GetService", "GetRequiredService", "GetKeyedService", "GetRequiredKeyedService",
        "CreateScope", "CreateAsyncScope", "Resolve",
    ];

    /// <summary>
    /// Reconciliation cannot delete an object because it was never given anything that can, and was
    /// never given anything that could ask for one either.
    /// </summary>
    /// <remarks>
    /// This is the whole safety argument of Phase 6B-4C, and it is a property of the constructor
    /// rather than of the code inside it. A reviewer can miss a call; a parameter list cannot hide
    /// one. If a later change hands this service <c>IObjectStorage</c> — or any other type with a
    /// delete on it — the read-only guarantee is gone, and that change should have to fail here
    /// rather than be noticed in review.
    /// <para>
    /// A container counts as delete-capable, and this is the correction the first cut needed: a
    /// service holding <c>IServiceScopeFactory</c> can resolve <c>IObjectStorage</c> in one line, so
    /// asserting the absence of the storage port while admitting the thing that produces it proved
    /// nothing at all. Writing a finding needs a per-workspace scope; that belongs behind a port
    /// that can only write findings.
    /// </para>
    /// </remarks>
    [TestMethod]
    public void TheReconciliationServiceIsNeverGivenADeleteCapableOrResolvingDependency()
    {
        var infrastructure = LoadByName("TB.Gym.Infrastructure");
        var service = infrastructure.GetTypes()
            .SingleOrDefault(candidate => candidate.Name == "MediaInventoryReconciliationService");
        Assert.IsNotNull(service, "The reconciliation service is missing from Infrastructure.");
        Assert.IsFalse(service.IsPublic, "The reconciliation service is public; it is an implementation detail.");

        var parameters = service.GetConstructors(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
            .SelectMany(constructor => constructor.GetParameters())
            .Select(parameter => parameter.ParameterType)
            .ToArray();
        Assert.DoesNotContain(
            typeof(IObjectStorage),
            parameters,
            "The reconciliation service takes IObjectStorage; it could then delete a workspace's bytes.");
        foreach (var resolver in BroadResolvers)
        {
            Assert.IsEmpty(
                parameters.Where(resolver.IsAssignableFrom),
                $"The reconciliation service takes {resolver.Name}; it could then resolve IObjectStorage and delete a workspace's bytes.");
        }

        foreach (var parameter in parameters)
        {
            Assert.IsEmpty(
                parameter.GetMethods().Where(method =>
                    method.Name.Contains("Delete", StringComparison.OrdinalIgnoreCase) ||
                    method.Name.Contains("Purge", StringComparison.OrdinalIgnoreCase) ||
                    method.Name.Contains("Put", StringComparison.OrdinalIgnoreCase)),
                $"{parameter.Name} gives the reconciliation service a way to write or delete stored objects.");
            Assert.IsEmpty(
                parameter.GetMethods().Where(method =>
                    ResolverMethods.Contains(method.Name, StringComparer.Ordinal)),
                $"{parameter.Name} is a service locator; it gives the reconciliation service every capability the application registered.");
        }
    }

    /// <summary>
    /// The port that replaced the container is narrow: it writes findings and nothing else, and it
    /// is what the reconciliation service is actually composed with.
    /// </summary>
    /// <remarks>
    /// The test above proves the service holds no resolver. This one proves the thing it holds
    /// instead is not a resolver by another name — a "persistence port" exposing a generic
    /// save-anything or context-returning member would move the hole rather than close it.
    /// </remarks>
    [TestMethod]
    public void TheReconciliationServiceWritesThroughANarrowFindingPort()
    {
        var infrastructure = LoadByName("TB.Gym.Infrastructure");
        var port = infrastructure.GetTypes()
            .SingleOrDefault(candidate => candidate.Name == "IMediaInventoryFindingStore");
        Assert.IsNotNull(port, "The reconciliation finding port is missing from Infrastructure.");
        Assert.IsFalse(port.IsPublic, "The finding port is public; it is an implementation detail.");

        var service = infrastructure.GetTypes()
            .Single(candidate => candidate.Name == "MediaInventoryReconciliationService");
        var parameters = service.GetConstructors(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
            .SelectMany(constructor => constructor.GetParameters())
            .Select(parameter => parameter.ParameterType)
            .ToArray();
        Assert.Contains(
            port,
            parameters,
            "The reconciliation service does not write through the finding port.");

        // Two operations, both about findings. Anything that returned a DbContext, a repository or a
        // service would be the container again with a different name on it.
        foreach (var method in port.GetMethods())
        {
            Assert.Contains(
                "Async",
                method.Name,
                StringComparison.Ordinal,
                $"{method.Name} is not one of the finding port's asynchronous write operations.");
            Assert.AreEqual(
                typeof(Task<>).Name,
                method.ReturnType.Name,
                $"{method.Name} hands back something other than the outcome of writing findings.");
            Assert.AreEqual(
                "MediaInventoryFindingWrite",
                method.ReturnType.GetGenericArguments().Single().Name,
                $"{method.Name} hands back something other than the outcome of writing findings.");
        }
    }

    /// <summary>
    /// The enumeration adapter is an implementation detail like every other one, and the port it
    /// serves describes stored objects rather than a provider's idea of them.
    /// </summary>
    [TestMethod]
    public void TheInventoryAdapterIsInternalAndItsPortNamesNoProvider()
    {
        var infrastructure = LoadByName("TB.Gym.Infrastructure");
        foreach (var name in new[] { "R2ObjectInventory", "UnavailableObjectInventory", "MediaInventoryReconciliationWorker" })
        {
            var type = infrastructure.GetTypes().SingleOrDefault(candidate => candidate.Name == name);
            Assert.IsNotNull(type, $"{name} is missing from Infrastructure.");
            Assert.IsFalse(type.IsPublic, $"{name} is public; a provider adapter is an implementation detail.");
        }

        // Belt and braces beside the module-wide sweep below: these are the types most likely to
        // acquire a provider word, because a bucket listing is what they are actually doing.
        foreach (var type in new[]
                 {
                     typeof(IObjectInventory),
                     typeof(ObjectInventoryEntry),
                     typeof(ObjectInventoryPage),
                     typeof(MediaInventoryFinding),
                     typeof(MediaInventoryRun),
                 })
        {
            AssertNamesNoProvider(type.Name, type.FullName!);
            foreach (var member in type.GetMembers(
                         BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
            {
                AssertNamesNoProvider(member.Name, $"{type.Name}.{member.Name}");
            }
        }
    }

    /// <summary>
    /// The daemon in the development stack: pinned to a digest, unprivileged, persistent, checked,
    /// and reachable only from inside the deployment.
    /// </summary>
    /// <remarks>
    /// clamd authenticates nobody. Publishing 3310 to a host interface would put an unauthenticated
    /// file-scanning service on the network, and the reason it is safe here is exactly that it is
    /// not published — which is a property of this file and therefore assertable in it.
    /// </remarks>
    [TestMethod]
    public void TheScannerServiceIsPinnedUnprivilegedAndPrivate()
    {
        var compose = File.ReadAllText(Path.Combine(RepositoryRoot(), "compose.yaml"));
        var service = Section(compose, "  clamav:");

        Assert.Contains("image: clamav/clamav:", service, StringComparison.Ordinal);
        Assert.Contains("@sha256:", service, StringComparison.Ordinal, "The scanner image is not pinned by digest.");
        Assert.Contains("user: \"clamav\"", service, StringComparison.Ordinal, "The scanner runs as root.");
        Assert.Contains("/var/lib/clamav", service, StringComparison.Ordinal, "The signature database is not persisted.");
        Assert.Contains("healthcheck:", service, StringComparison.Ordinal);
        Assert.Contains("mem_limit:", service, StringComparison.Ordinal, "The engine has no memory reservation.");
        Assert.Contains("FRESHCLAM_CHECKS", service, StringComparison.Ordinal, "Signature updates are not configured.");
        Assert.DoesNotContain(
            "ports:",
            service,
            StringComparison.Ordinal,
            "The scanner port is published to a host interface; clamd has no authentication of its own.");
        Assert.DoesNotContain(
            ":3310\"",
            service.Replace("- \"3310\"", string.Empty, StringComparison.Ordinal),
            StringComparison.Ordinal,
            "The scanner port is mapped to a host port.");
    }

    /// <summary>
    /// The limits that decide whether a 500 MiB video can be scanned at all. clamd answers a stream
    /// above <c>StreamMaxLength</c> with an error rather than a verdict, and the application refuses
    /// the upload rather than publishing it — so a default-sized daemon would fail every video.
    /// </summary>
    [TestMethod]
    public void TheScannerLimitsCoverTheLargestUploadTheApplicationAccepts()
    {
        var configuration = File.ReadAllLines(
            Path.Combine(RepositoryRoot(), "docker", "clamav", "clamd.conf"));

        Assert.IsGreaterThanOrEqualTo(
            MediaUploadPolicy.MaximumVideoBytes,
            Megabytes(configuration, "StreamMaxLength"),
            "clamd would refuse to read a video this application accepts.");
        Assert.IsGreaterThanOrEqualTo(
            MediaUploadPolicy.MaximumVideoBytes,
            Megabytes(configuration, "MaxFileSize"),
            "clamd would skip a file this application accepts.");
        Assert.IsGreaterThanOrEqualTo(
            Megabytes(configuration, "MaxFileSize"),
            Megabytes(configuration, "MaxScanSize"),
            "The total scanned size must cover the largest single file, plus what it can expand to.");
        Assert.Contains(
            "TCPAddr 0.0.0.0",
            string.Join('\n', configuration),
            StringComparison.Ordinal,
            "clamd binds to loopback without this, which inside a container means nothing can reach it.");
    }

    private static long Megabytes(string[] configuration, string setting)
    {
        var line = configuration.SingleOrDefault(candidate =>
            candidate.StartsWith(setting + " ", StringComparison.Ordinal));
        Assert.IsNotNull(line, $"clamd.conf does not set {setting}.");
        var value = line[(setting.Length + 1)..].Trim();
        Assert.EndsWith("M", value, $"{setting} is not expressed in megabytes.");
        return long.Parse(value[..^1], System.Globalization.CultureInfo.InvariantCulture) * 1024 * 1024;
    }

    private static void AssertNamesNoProvider(string name, string description)
    {
        foreach (var word in ProviderVocabulary)
        {
            Assert.DoesNotContain(
                word,
                name,
                StringComparison.OrdinalIgnoreCase,
                $"{description} names '{word}'; the Media module owns provider-neutral storage terms.");
        }
    }

    /// <summary>The block of a compose service, from its key to the next one at the same indent.</summary>
    private static string Section(string compose, string key)
    {
        var start = compose.IndexOf(key, StringComparison.Ordinal);
        Assert.IsGreaterThan(-1, start, $"compose.yaml has no {key.Trim()} service.");
        var next = compose.IndexOf("\n  ", start + key.Length, StringComparison.Ordinal);
        while (next > 0 && compose.Length > next + 3 && compose[next + 3] is ' ' or '#')
        {
            next = compose.IndexOf("\n  ", next + 3, StringComparison.Ordinal);
        }

        return next < 0 ? compose[start..] : compose[start..next];
    }

    private static Assembly LoadByName(string assemblyName)
    {
        var loaded = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(assembly => assembly.GetName().Name == assemblyName);
        if (loaded is not null)
        {
            return loaded;
        }

        var path = Path.Combine(AppContext.BaseDirectory, $"{assemblyName}.dll");
        Assert.IsTrue(File.Exists(path), $"{assemblyName}.dll is not in the test output directory.");
        return Assembly.LoadFrom(path);
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
