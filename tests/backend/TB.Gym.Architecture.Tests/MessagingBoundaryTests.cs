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
    /// Phase 6B-2B replaces the 6B-2A "empty shell" assertion with the narrow one it was holding the
    /// place for: the hub is strongly typed, it may subscribe and unsubscribe, and it may do nothing
    /// else.
    /// </summary>
    /// <remarks>
    /// The list is exhaustive rather than a prohibition list, because a prohibition list only forbids
    /// the names somebody thought of. A hub method that sends, edits, removes, moderates, marks read
    /// or acknowledges would carry none of the cookie authentication, antiforgery, idempotency,
    /// optimistic concurrency and authorization the REST commands do, and adding one has to mean
    /// deliberately changing this test.
    /// </remarks>
    [TestMethod]
    public void ChatHubExposesOnlyLifecycleAndSubscription()
    {
        string[] permitted =
        [
            nameof(ChatHub.OnConnectedAsync),
            nameof(ChatHub.SubscribeConversation),
            nameof(ChatHub.UnsubscribeConversation),
        ];

        var declared = typeof(ChatHub)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(method => !method.IsSpecialName)
            .Select(method => method.Name)
            .ToArray();
        var unexpected = declared.Except(permitted, StringComparer.Ordinal).ToArray();

        Assert.IsEmpty(
            unexpected,
            $"ChatHub declares {string.Join(", ", unexpected)}; the hub subscribes and does nothing else.");
        Assert.IsNotNull(
            typeof(ChatHub).GetCustomAttribute<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>(),
            "The hub is authorized, so it keeps its Authorize attribute.");

        // Strongly typed, so what the server may send a browser is a compile-time contract rather
        // than a magic string that can drift from whatever the client is listening for.
        var typedHub = typeof(ChatHub).BaseType;
        Assert.IsNotNull(typedHub, "ChatHub must derive from Hub<T>.");
        Assert.IsTrue(
            typedHub.IsGenericType &&
            typedHub.GetGenericTypeDefinition() == typeof(Microsoft.AspNetCore.SignalR.Hub<>) &&
            typedHub.GetGenericArguments()[0] == typeof(IMessagingRealtimeClient),
            "ChatHub must be Hub<IMessagingRealtimeClient> so its client surface is typed.");
    }

    /// <summary>
    /// No domain mutation may be reachable through the hub, and no hub method may accept a group
    /// name, a user identifier or a recipient.
    /// </summary>
    /// <remarks>
    /// The parameter check is the one that matters most. A hub method taking a group name would let a
    /// caller address another user's group; one taking a user identifier would let it claim to be
    /// somebody else. Every group name in this system is computed by the server from a connection it
    /// verified, so a conversation identifier is the only routing input a client may supply.
    /// </remarks>
    [TestMethod]
    public void TheHubCarriesNoDomainMutationAndAcceptsNoRoutingIdentity()
    {
        var methods = typeof(ChatHub)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(method => !method.IsSpecialName)
            .ToArray();

        string[] forbiddenVerbs =
        [
            "Send", "Edit", "Delete", "Remove", "Moderate", "Read", "Acknowledge", "Create", "Advance",
        ];
        foreach (var method in methods)
        {
            foreach (var verb in forbiddenVerbs)
            {
                Assert.IsFalse(
                    method.Name.StartsWith(verb, StringComparison.OrdinalIgnoreCase),
                    $"ChatHub.{method.Name} looks like a domain mutation; every messaging write stays on REST.");
            }

            foreach (var parameter in method.GetParameters())
            {
                var name = parameter.Name ?? string.Empty;
                Assert.IsFalse(
                    name.Contains("group", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("user", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("recipient", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("tenant", StringComparison.OrdinalIgnoreCase),
                    $"ChatHub.{method.Name} accepts '{name}'; a client may pass a conversation id and nothing else.");
                Assert.AreEqual(
                    typeof(Guid),
                    parameter.ParameterType,
                    $"ChatHub.{method.Name} accepts a {parameter.ParameterType.Name}; only conversation identifiers are accepted.");
            }
        }
    }

    /// <summary>
    /// The two acknowledgement columns still have no public setter, and only one of them is ever
    /// written.
    /// </summary>
    /// <remarks>
    /// <c>RealtimeAcknowledgedAtUtc</c> is now written, but only from inside the aggregate and only
    /// through the method that refuses a sender acknowledging their own message.
    /// <c>ProviderAcknowledgedAtUtc</c> stays null: there is no provider channel, and a column
    /// nothing can set is the only honest state for one.
    /// </remarks>
    [TestMethod]
    public void DeliveryColumnsAreWrittenOnlyByTheAggregate()
    {
        foreach (var reserved in new[] { "RealtimeAcknowledgedAtUtc", "ProviderAcknowledgedAtUtc" })
        {
            var property = typeof(Message).GetProperty(reserved);
            Assert.IsNotNull(property, $"{reserved} is part of the delivery model.");
            Assert.IsNull(
                property.SetMethod is { IsPublic: true } ? property : null,
                $"{reserved} must not be publicly settable.");
        }

        var acknowledge = typeof(Message).GetMethod(nameof(Message.AcknowledgeRealtimeDelivery));
        Assert.IsNotNull(
            acknowledge,
            "Message.AcknowledgeRealtimeDelivery is the only way the counterpart timestamp is written.");

        // No behaviour anywhere in the module may write the provider column: no phase has a provider
        // yet, and a null column is the only claim that can be substantiated. Property accessors are
        // excluded because the compiler generates them for the column itself; what this forbids is a
        // method that would call one.
        var providerWriters = MessagingAssembly.GetTypes()
            .SelectMany(type => type.GetMethods(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance |
                BindingFlags.Static | BindingFlags.DeclaredOnly))
            .Where(method => !method.IsSpecialName)
            .Where(method => method.Name.Contains("ProviderAcknowledge", StringComparison.OrdinalIgnoreCase))
            .Select(method => $"{method.DeclaringType?.Name}.{method.Name}")
            .ToArray();
        Assert.IsEmpty(
            providerWriters,
            $"Messaging writes provider acknowledgement it cannot substantiate: {string.Join(", ", providerWriters)}");

        // And the provider column has no setter reachable from outside the aggregate at all, so the
        // database trigger that refuses a non-null value is backed up rather than relied on alone.
        var providerSetter = typeof(Message).GetProperty("ProviderAcknowledgedAtUtc")!.SetMethod;
        Assert.IsNotNull(providerSetter, "The column exists, so it has a compiler-generated setter.");
        Assert.IsTrue(
            providerSetter.IsPrivate,
            "ProviderAcknowledgedAtUtc must be settable only from inside the aggregate.");
    }

    /// <summary>
    /// Messaging is still rows in the one PostgreSQL database. Redis is a hub backplane and nothing
    /// else: not a cache, not a queue, not a store, and not something the domain or the module knows
    /// exists.
    /// </summary>
    /// <remarks>
    /// A broker, a bus, a generic job framework or a second store would still be a distributed-system
    /// decision needing its own ADR. The one addition Phase 6B-2B makes is
    /// <c>Microsoft.AspNetCore.SignalR.StackExchangeRedis</c>, and the assertion below is what keeps
    /// it confined to the API composition root: the module must not know about it, and Infrastructure
    /// must not either, because Infrastructure is what the Worker composes.
    /// </remarks>
    [TestMethod]
    public void MessagingIntroducedNoBrokerBusCacheSchedulerOrSecondDatabase()
    {
        string[] forbiddenEverywhere =
        [
            "MassTransit",
            "Hangfire",
            "Quartz",
            "Microsoft.Extensions.Caching.StackExchangeRedis",
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
            foreach (var package in forbiddenEverywhere)
            {
                Assert.DoesNotContain(
                    package,
                    references,
                    $"{assembly.GetName().Name} references {package}; distributed infrastructure needs an approved ADR.");
            }

            // The backplane is composed by the API host. A module that referenced it would be a
            // domain that knows how it is deployed, and an Infrastructure that referenced it would
            // put a Redis client in the Worker's image whether the Worker used it or not.
            Assert.DoesNotContain(
                "Microsoft.AspNetCore.SignalR.StackExchangeRedis",
                references,
                $"{assembly.GetName().Name} references the SignalR backplane; only the API composition root may.");
            Assert.DoesNotContain(
                "StackExchange.Redis",
                references,
                $"{assembly.GetName().Name} references a Redis client; only the API composition root may.");
        }
    }

    /// <summary>
    /// Realtime dispatch runs in the API, and the Worker stays what it was.
    /// </summary>
    /// <remarks>
    /// Publishing needs an <c>IHubContext</c>, and an <c>IHubContext</c> is only useful in a process
    /// that holds connections or a backplane to reach them through. Giving the notification Worker one
    /// would mean giving a background process an HTTP surface, a listener and a Redis dependency it
    /// exists precisely not to have — so the sweep lives in the API host, and the Worker references
    /// neither Messaging nor SignalR nor Redis.
    /// </remarks>
    [TestMethod]
    public void RealtimeDispatchIsHostedByTheApiAndTheWorkerStaysNonHttp()
    {
        // The module itself hosts nothing. A hub is a request-scoped surface; the sweep that feeds it
        // is composed by the host, so a module-owned BackgroundService would be a module deciding how
        // it is run.
        var moduleHostedServices = MessagingAssembly.GetTypes()
            .Where(type => typeof(Microsoft.Extensions.Hosting.IHostedService).IsAssignableFrom(type))
            .Select(type => type.Name)
            .ToArray();
        Assert.IsEmpty(
            moduleHostedServices,
            $"Messaging hosts a background service: {string.Join(", ", moduleHostedServices)}");

        var worker = LoadWorkerAssembly();
        var workerReferences = worker.GetReferencedAssemblies()
            .Select(reference => reference.Name ?? string.Empty)
            .ToArray();
        foreach (var forbidden in new[]
                 {
                     "TB.Gym.Modules.Messaging",
                     "Microsoft.AspNetCore.SignalR",
                     "Microsoft.AspNetCore.SignalR.Core",
                     "Microsoft.AspNetCore.SignalR.StackExchangeRedis",
                     "StackExchange.Redis",
                 })
        {
            Assert.DoesNotContain(
                forbidden,
                workerReferences,
                $"The Worker gained {forbidden}; it stays a non-HTTP notification worker with no hub, no listener and no backplane.");
        }

        // The Worker's own composition. It must not pull the realtime services in through the
        // Infrastructure extension it does call.
        var workerComposition = typeof(TB.Gym.Infrastructure.WorkerDependencyInjection)
            .GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Select(method => method.Name)
            .ToArray();
        Assert.Contains(
            "AddTbGymNotificationWorkerInfrastructure",
            workerComposition,
            "The Worker composes the narrow background set and nothing else.");
        Assert.DoesNotContain(
            "AddTbGymMessagingRealtime",
            workerComposition,
            "The Worker must not expose realtime composition.");

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

    /// <summary>
    /// Every group name is computed by the server, and no client input can name one.
    /// </summary>
    /// <remarks>
    /// The names are built from the verified connection binding — the workspace whose membership was
    /// read from PostgreSQL, and the authenticated user — plus a conversation identifier. Two
    /// different users, two different workspaces or two different conversations therefore cannot
    /// collide, which is the property that makes a group safe to publish a caller-specific projection
    /// into.
    /// </remarks>
    [TestMethod]
    public void GroupNamesAreServerGeneratedAndUnambiguous()
    {
        var tenant = Guid.NewGuid();
        var otherTenant = Guid.NewGuid();
        var user = Guid.NewGuid();
        var otherUser = Guid.NewGuid();
        var conversation = Guid.NewGuid();
        var otherConversation = Guid.NewGuid();

        string[] names =
        [
            MessagingRealtimeGroups.TenantUser(tenant, user),
            MessagingRealtimeGroups.TenantUser(tenant, otherUser),
            MessagingRealtimeGroups.TenantUser(otherTenant, user),
            MessagingRealtimeGroups.ConversationUser(tenant, conversation, user),
            MessagingRealtimeGroups.ConversationUser(tenant, conversation, otherUser),
            MessagingRealtimeGroups.ConversationUser(tenant, otherConversation, user),
            MessagingRealtimeGroups.ConversationUser(otherTenant, conversation, user),
        ];

        Assert.AreEqual(
            names.Length,
            names.Distinct(StringComparer.Ordinal).Count(),
            "Two different (workspace, user, conversation) triples produced the same group name.");

        // Every builder takes identifiers only. A builder that accepted a string could be handed one
        // from a request, which is exactly the input this design does not have.
        foreach (var method in typeof(MessagingRealtimeGroups)
                     .GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly))
        {
            foreach (var parameter in method.GetParameters())
            {
                Assert.AreEqual(
                    typeof(Guid),
                    parameter.ParameterType,
                    $"MessagingRealtimeGroups.{method.Name} accepts a {parameter.ParameterType.Name}; group names are built from identifiers only.");
            }
        }
    }

    /// <summary>
    /// The messaging screen stays a lazy route, and no route in the shell became eager.
    /// </summary>
    /// <remarks>
    /// Asserted here rather than only in the browser suite because it is a composition rule of the
    /// same kind as the module-reference rules above: it says what may be loaded when, not what the
    /// screen does. Phase 6B-2B adds a root-scoped realtime service, and the temptation a root
    /// service creates is to pull the feature that uses it into the initial bundle with it. The
    /// service is root-scoped; the screen is not.
    /// </remarks>
    [TestMethod]
    public void AngularFeatureRoutesStayLazy()
    {
        var routes = File.ReadAllText(Path.Combine(RepositoryRoot(), "src", "web", "src", "app", "app.routes.ts"));

        Assert.Contains(
            "./features/messaging/messages.routes",
            routes,
            "The messaging screen must stay behind a lazy route.");
        Assert.DoesNotContain(
            "component:",
            routes,
            "A route declares an eager component; feature routes are loaded with loadComponent or loadChildren.");

        // The realtime service is root-provided, so it must not be listed as a route provider that
        // would tie its lifetime to a screen the user may never open.
        var service = File.ReadAllText(Path.Combine(
            RepositoryRoot(),
            "src", "web", "src", "app", "core", "messaging", "messaging-realtime.service.ts"));
        Assert.Contains(
            "providedIn: 'root'",
            service,
            "One realtime connection is owned by the application, not by a screen.");
    }

    /// <summary>
    /// Walks up from the test output directory to the repository root.
    /// </summary>
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
