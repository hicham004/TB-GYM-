using System.Reflection;
using System.Text.Json;

namespace TB.Gym.Architecture.Tests;

[TestClass]
public sealed class ModuleDependencyTests
{
    private const string ApiAssemblyName = "TB.Gym.Api";
    private const string InfrastructureAssemblyName = "TB.Gym.Infrastructure";
    private const string WorkerAssemblyName = "TB.Gym.Worker";

    private static readonly Assembly[] ModuleAssemblies =
    [
        typeof(TB.Gym.Modules.CheckIns.CheckInsModule).Assembly,
        typeof(TB.Gym.Modules.Clients.ClientsModule).Assembly,
        typeof(TB.Gym.Modules.ExerciseLibrary.ExerciseLibraryModule).Assembly,
        typeof(TB.Gym.Modules.Gamification.GamificationModule).Assembly,
        typeof(TB.Gym.Modules.Identity.IdentityModule).Assembly,
        typeof(TB.Gym.Modules.Integrations.IntegrationsModule).Assembly,
        typeof(TB.Gym.Modules.Invitations.InvitationsModule).Assembly,
        typeof(TB.Gym.Modules.Media.MediaModule).Assembly,
        typeof(TB.Gym.Modules.Messaging.MessagingModule).Assembly,
        typeof(TB.Gym.Modules.Notifications.NotificationsModule).Assembly,
        typeof(TB.Gym.Modules.Nutrition.NutritionModule).Assembly,
        typeof(TB.Gym.Modules.Progress.ProgressModule).Assembly,
        typeof(TB.Gym.Modules.Strength.StrengthModule).Assembly,
        typeof(TB.Gym.Modules.Subscriptions.SubscriptionsModule).Assembly,
        typeof(TB.Gym.Modules.Tenancy.TenancyModule).Assembly,
        typeof(TB.Gym.Modules.Training.TrainingModule).Assembly,
    ];

    [TestMethod]
    public void ModulesDoNotReferenceOtherModulesDirectly()
    {
        foreach (var assembly in ModuleAssemblies)
        {
            var forbiddenReferences = assembly.GetReferencedAssemblies()
                .Where(reference => reference.Name?.StartsWith("TB.Gym.Modules.", StringComparison.Ordinal) == true)
                .Select(reference => reference.Name)
                .ToArray();

            Assert.IsEmpty(
                forbiddenReferences,
                $"{assembly.GetName().Name} references another module: {string.Join(", ", forbiddenReferences)}");
        }
    }

    /// <summary>
    /// The Worker is a second composition root of the same monolith, so it may reference
    /// Infrastructure and the modules. What would make it a service instead of a composition root is
    /// something referencing it back, so that is what this asserts.
    /// </summary>
    [TestMethod]
    public void WorkerIsAComposureRootAndNothingReferencesIt()
    {
        var worker = LoadWorkerAssembly();
        var workerReferences = worker.GetReferencedAssemblies().Select(reference => reference.Name).ToArray();
        Assert.Contains(
            InfrastructureAssemblyName,
            workerReferences,
            "The Worker must compose Infrastructure rather than reimplementing persistence.");

        foreach (var assembly in ModuleAssemblies.Append(typeof(TB.Gym.SharedKernel.IClock).Assembly))
        {
            Assert.DoesNotContain(
                WorkerAssemblyName,
                assembly.GetReferencedAssemblies().Select(reference => reference.Name).ToArray(),
                $"{assembly.GetName().Name} references the Worker, which would invert the composition direction.");
        }

        Assert.DoesNotContain(
            WorkerAssemblyName,
            LoadInfrastructureAssembly().GetReferencedAssemblies().Select(reference => reference.Name).ToArray(),
            "Infrastructure references the Worker, which would invert the composition direction.");
    }

    /// <summary>
    /// The composition direction: SharedKernel &lt;- Modules &lt;- Infrastructure &lt;- API and
    /// Worker. Infrastructure may never reference either host.
    /// </summary>
    [TestMethod]
    public void InfrastructureDoesNotReferenceItsHosts()
    {
        var infrastructureReferences = LoadInfrastructureAssembly()
            .GetReferencedAssemblies()
            .Select(reference => reference.Name)
            .ToArray();

        Assert.DoesNotContain(ApiAssemblyName, infrastructureReferences);
        Assert.DoesNotContain(WorkerAssemblyName, infrastructureReferences);
    }

    /// <summary>
    /// The Worker hosts no HTTP surface. Its ASP.NET runtime base supplies a transitive shared
    /// framework dependency; it does not authorize controllers, endpoints, hubs or a listener.
    /// </summary>
    [TestMethod]
    public void WorkerHostsNoHttpSurface()
    {
        var workerTypes = LoadWorkerAssembly().GetTypes();
        foreach (var type in workerTypes)
        {
            Assert.IsFalse(
                type.Name.Contains("Controller", StringComparison.Ordinal) ||
                type.Name.Contains("Endpoint", StringComparison.Ordinal) ||
                type.Name.Contains("Hub", StringComparison.Ordinal),
                $"{type.Name} looks like an HTTP or realtime surface in the Worker process.");
        }
    }

    /// <summary>
    /// Guards the exact mismatch that makes an image build successfully and then fail only when its
    /// entry point starts: the published runtimeconfig requires Microsoft.AspNetCore.App, so the
    /// final container stage must provide the ASP.NET runtime even though it exposes no HTTP port.
    /// </summary>
    [TestMethod]
    public void WorkerContainerProvidesEveryRequiredSharedFrameworkWithoutExposingHttp()
    {
        var runtimeConfigPath = Path.Combine(AppContext.BaseDirectory, "TB.Gym.Worker.runtimeconfig.json");
        Assert.IsTrue(File.Exists(runtimeConfigPath), "The Worker runtimeconfig is not in the test output.");
        using var runtimeConfig = JsonDocument.Parse(File.ReadAllText(runtimeConfigPath));
        var frameworks = runtimeConfig.RootElement
            .GetProperty("runtimeOptions")
            .GetProperty("frameworks")
            .EnumerateArray()
            .Select(framework => framework.GetProperty("name").GetString())
            .ToArray();
        Assert.Contains(
            "Microsoft.AspNetCore.App",
            frameworks,
            "This assertion must follow the Worker's published transitive framework requirements.");

        var dockerfilePath = Path.Combine(AppContext.BaseDirectory, "Worker.Dockerfile");
        Assert.IsTrue(File.Exists(dockerfilePath), "The Worker Dockerfile is not in the test output.");
        var dockerfile = File.ReadAllText(dockerfilePath);
        Assert.Contains(
            "FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime",
            dockerfile,
            "The final image must provide Microsoft.AspNetCore.App.");
        Assert.IsFalse(
            dockerfile.Split('\n').Any(line => line.TrimStart().StartsWith("EXPOSE ", StringComparison.OrdinalIgnoreCase)),
            "The background Worker must not expose a port.");
    }

    /// <summary>
    /// No broker, bus, scheduler or second database was introduced. Durable dispatch is PostgreSQL
    /// rows claimed with FOR UPDATE SKIP LOCKED, and adding any of these would be a distributed
    /// system decision that needs an ADR rather than a package reference.
    /// </summary>
    [TestMethod]
    public void NoDistributedInfrastructureWasIntroduced()
    {
        string[] forbidden =
        [
            "MassTransit",
            "Hangfire",
            "Quartz",
            "StackExchange.Redis",
            "Microsoft.Extensions.Caching.StackExchangeRedis",
            "RabbitMQ.Client",
            "Confluent.Kafka",
            "Azure.Messaging.ServiceBus",
            "NServiceBus",
            "MongoDB.Driver",
        ];

        Assembly[] hosts = [LoadWorkerAssembly(), LoadInfrastructureAssembly()];
        foreach (var assembly in hosts.Concat(ModuleAssemblies))
        {
            var references = assembly.GetReferencedAssemblies()
                .Select(reference => reference.Name ?? string.Empty)
                .ToArray();
            foreach (var package in forbidden)
            {
                Assert.DoesNotContain(
                    package,
                    references,
                    $"{assembly.GetName().Name} references {package}; distributed infrastructure needs an approved ADR.");
            }
        }
    }

    private static Assembly LoadWorkerAssembly() => LoadByName(WorkerAssemblyName);

    private static Assembly LoadInfrastructureAssembly() => LoadByName(InfrastructureAssemblyName);

    /// <summary>
    /// The Worker is a host, so nothing in the test project references its types and it is not loaded
    /// by the runtime on its own. It is loaded from the test output directory instead, which the
    /// project reference guarantees is populated.
    /// </summary>
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
}
