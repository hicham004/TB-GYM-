using System.Reflection;
using TB.Gym.Modules.Messaging;
using TB.Gym.SharedKernel;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The boundaries Phase 6B-2A had to hold: Messaging owns its own entities and depends on nothing but
/// the shared kernel; persistence is PostgreSQL rows in one database and not a new piece of
/// infrastructure; and <c>ChatHub</c> is still the empty authorized shell it was, because realtime
/// delivery is Phase 6B-2B.
/// </summary>
[TestClass]
public sealed class MessagingBoundaryTests
{
    private static readonly Assembly MessagingAssembly = typeof(MessagingModule).Assembly;

    [TestMethod]
    public void MessagingReferencesTheSharedKernelAndNoOtherModule()
    {
        var references = MessagingAssembly.GetReferencedAssemblies()
            .Select(reference => reference.Name ?? string.Empty)
            .ToArray();

        Assert.Contains(
            typeof(IClock).Assembly.GetName().Name!,
            references,
            "Messaging composes with the shared kernel; that is the only module-facing reference it may have.");
        var moduleReferences = references
            .Where(name => name.StartsWith("TB.Gym.Modules.", StringComparison.Ordinal))
            .ToArray();
        Assert.IsEmpty(
            moduleReferences,
            $"Messaging references another module: {string.Join(", ", moduleReferences)}");
    }

    /// <summary>
    /// A module owns its entities. Composing Messaging with the coaching feature-access port is
    /// exactly what SharedKernel exists for; reaching into Subscriptions, Clients or Notifications for
    /// a <c>DbSet</c>, a repository or a domain entity is what it exists to prevent.
    /// </summary>
    [TestMethod]
    public void MessagingContractsExposeNoOtherModulesTypes()
    {
        var leaked = MessagingAssembly.GetExportedTypes()
            .SelectMany(SurfaceTypes)
            .Where(type => type.Assembly != MessagingAssembly)
            .Where(type => type.Assembly.GetName().Name?.StartsWith("TB.Gym.", StringComparison.Ordinal) == true)
            .Where(type => type.Assembly != typeof(IClock).Assembly)
            .Select(type => type.FullName ?? type.Name)
            .Distinct()
            .ToArray();

        Assert.IsEmpty(
            leaked,
            $"Messaging exposes another module's types: {string.Join(", ", leaked)}");
    }

    /// <summary>
    /// The Messaging entities are Messaging's. If another module ever declared a Conversation,
    /// Message or MessageRevision, the two would drift and the ownership rule would already be gone.
    /// </summary>
    [TestMethod]
    public void MessagingEntitiesAreDeclaredOnlyByMessaging()
    {
        string[] owned =
        [
            nameof(Conversation),
            nameof(ConversationParticipant),
            nameof(Message),
            nameof(MessageRevision),
            nameof(MessageDeletionEvent),
            nameof(MessagingCommandRecord),
        ];

        foreach (var name in owned)
        {
            var declaring = MessagingAssembly.GetExportedTypes().SingleOrDefault(type => type.Name == name);
            Assert.IsNotNull(declaring, $"{name} must be declared by the Messaging module.");
            Assert.IsTrue(
                typeof(TenantEntity).IsAssignableFrom(declaring),
                $"{name} is tenant-owned and must carry TenantId through TenantEntity.");
        }

        foreach (var assembly in OtherModuleAssemblies())
        {
            var clashes = assembly.GetTypes()
                .Where(type => owned.Contains(type.Name, StringComparer.Ordinal))
                .Select(type => type.FullName ?? type.Name)
                .ToArray();
            Assert.IsEmpty(
                clashes,
                $"{assembly.GetName().Name} declares a Messaging entity: {string.Join(", ", clashes)}");
        }
    }

    /// <summary>
    /// Phase 6B-2A adds persistence and no realtime delivery. This is the assertion that keeps that
    /// honest: the hub gains a method only when 6B-2B deliberately changes this test as well.
    /// </summary>
    [TestMethod]
    public void ChatHubIsStillAnEmptyAuthorizedShell()
    {
        var declared = typeof(ChatHub)
            .GetMembers(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance |
                        BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(member => member is not ConstructorInfo)
            .Select(member => member.Name)
            .ToArray();

        Assert.IsEmpty(
            declared,
            $"ChatHub declares {string.Join(", ", declared)}; Phase 6B-2A adds no realtime behaviour.");
        Assert.IsNotNull(
            typeof(ChatHub).GetCustomAttribute<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>(),
            "The hub is an authorized hosting shell, so it keeps its Authorize attribute.");

        // Group membership, broadcasting, acknowledgement and connection mapping are what a realtime
        // slice adds. Property accessors are excluded because the two reserved acknowledgement
        // columns are data this slice deliberately leaves null, not behaviour; the assertion below
        // is what keeps them that way.
        var realtimeSurface = MessagingAssembly.GetTypes()
            .SelectMany(type => type.GetMethods(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance |
                BindingFlags.Static | BindingFlags.DeclaredOnly))
            .Where(method => !method.IsSpecialName)
            .Select(method => $"{method.DeclaringType?.Name}.{method.Name}")
            .Where(name =>
                name.Contains("Group", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Broadcast", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Acknowledge", StringComparison.OrdinalIgnoreCase) ||
                name.Contains("Connection", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Assert.IsEmpty(
            realtimeSurface,
            $"Messaging carries realtime behaviour it should not yet have: {string.Join(", ", realtimeSurface)}");

        // The reserved acknowledgement columns exist so 6B-2B can record delivery without rewriting
        // message history. Nothing may write them yet, and nothing may write them from outside the
        // aggregate ever, which is what "no public setter" states.
        foreach (var reserved in new[] { "RealtimeAcknowledgedAtUtc", "ProviderAcknowledgedAtUtc" })
        {
            var property = typeof(Message).GetProperty(reserved);
            Assert.IsNotNull(property, $"{reserved} is the seam Phase 6B-2B writes through.");
            Assert.IsNull(
                property.SetMethod is { IsPublic: true } ? property : null,
                $"{reserved} must not be publicly settable.");
        }
    }

    /// <summary>
    /// Persisted messaging is rows in the one PostgreSQL database, claimed with ordinary transactions
    /// and row locks. A broker, a bus, a cache, a scheduler or a second store would be a distributed
    /// system decision needing its own ADR, not a package reference added while building a feature.
    /// </summary>
    [TestMethod]
    public void MessagingIntroducedNoBrokerBusCacheSchedulerOrSecondDatabase()
    {
        string[] forbidden =
        [
            "MassTransit",
            "Hangfire",
            "Quartz",
            "StackExchange.Redis",
            "Microsoft.Extensions.Caching.StackExchangeRedis",
            "Microsoft.AspNetCore.SignalR.StackExchangeRedis",
            "RabbitMQ.Client",
            "Confluent.Kafka",
            "Azure.Messaging.ServiceBus",
            "NServiceBus",
            "MongoDB.Driver",
        ];

        Assembly[] assemblies =
        [
            MessagingAssembly,
            typeof(TB.Gym.Infrastructure.DependencyInjection).Assembly,
        ];
        foreach (var assembly in assemblies)
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

    /// <summary>
    /// The Worker and the notification architecture are untouched by this slice. Messaging has no
    /// background sweep, no worker of its own and no dispatcher: a message is written by the request
    /// that sent it.
    /// </summary>
    [TestMethod]
    public void MessagingAddedNoBackgroundWorkerAndLeftNotificationDispatchAlone()
    {
        var hostedServices = MessagingAssembly.GetTypes()
            .Where(type => typeof(Microsoft.Extensions.Hosting.IHostedService).IsAssignableFrom(type))
            .Select(type => type.Name)
            .ToArray();
        Assert.IsEmpty(
            hostedServices,
            $"Messaging hosts a background service: {string.Join(", ", hostedServices)}");

        var worker = LoadWorkerAssembly();
        Assert.DoesNotContain(
            "TB.Gym.Modules.Messaging",
            worker.GetReferencedAssemblies().Select(reference => reference.Name).ToArray(),
            "The Worker gained a Messaging dependency; nothing in this slice runs in the background.");

        var notificationTypes = typeof(TB.Gym.Modules.Notifications.NotificationsModule).Assembly
            .GetExportedTypes()
            .Select(type => type.Name)
            .ToArray();
        foreach (var expected in new[]
                 {
                     "Notification",
                     "NotificationDeliveryAttempt",
                     "NotificationOutboxItem",
                     "INotificationDispatchService",
                 })
        {
            Assert.Contains(
                expected,
                notificationTypes,
                $"{expected} is missing; the notification architecture must be unchanged by this slice.");
        }
    }

    private static IEnumerable<Assembly> OtherModuleAssemblies() =>
    [
        typeof(TB.Gym.Modules.CheckIns.CheckInsModule).Assembly,
        typeof(TB.Gym.Modules.Clients.ClientsModule).Assembly,
        typeof(TB.Gym.Modules.ExerciseLibrary.ExerciseLibraryModule).Assembly,
        typeof(TB.Gym.Modules.Gamification.GamificationModule).Assembly,
        typeof(TB.Gym.Modules.Identity.IdentityModule).Assembly,
        typeof(TB.Gym.Modules.Integrations.IntegrationsModule).Assembly,
        typeof(TB.Gym.Modules.Invitations.InvitationsModule).Assembly,
        typeof(TB.Gym.Modules.Media.MediaModule).Assembly,
        typeof(TB.Gym.Modules.Notifications.NotificationsModule).Assembly,
        typeof(TB.Gym.Modules.Nutrition.NutritionModule).Assembly,
        typeof(TB.Gym.Modules.Progress.ProgressModule).Assembly,
        typeof(TB.Gym.Modules.Strength.StrengthModule).Assembly,
        typeof(TB.Gym.Modules.Subscriptions.SubscriptionsModule).Assembly,
        typeof(TB.Gym.Modules.Tenancy.TenancyModule).Assembly,
        typeof(TB.Gym.Modules.Training.TrainingModule).Assembly,
    ];

    /// <summary>
    /// Every type reachable through a public signature: property types, method parameters and return
    /// types, unwrapped through generics and arrays so a leak cannot hide inside a collection.
    /// </summary>
    private static IEnumerable<Type> SurfaceTypes(Type type)
    {
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            foreach (var unwrapped in Unwrap(property.PropertyType))
            {
                yield return unwrapped;
            }
        }

        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
        {
            foreach (var unwrapped in Unwrap(method.ReturnType))
            {
                yield return unwrapped;
            }

            foreach (var unwrapped in method.GetParameters().SelectMany(parameter => Unwrap(parameter.ParameterType)))
            {
                yield return unwrapped;
            }
        }
    }

    private static IEnumerable<Type> Unwrap(Type type)
    {
        if (type.IsArray)
        {
            foreach (var element in Unwrap(type.GetElementType()!))
            {
                yield return element;
            }

            yield break;
        }

        if (type.IsGenericType)
        {
            yield return type.GetGenericTypeDefinition();
            foreach (var argument in type.GetGenericArguments().SelectMany(Unwrap))
            {
                yield return argument;
            }

            yield break;
        }

        yield return type;
    }

    private static Assembly LoadWorkerAssembly()
    {
        const string assemblyName = "TB.Gym.Worker";
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
