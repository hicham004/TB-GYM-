using System.Reflection;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The boundaries Phase 6B-3A had to hold: the Notifications module owns its own model and reaches
/// into no other module for a recipient address; the email transport is an owned interface with no
/// provider SDK behind it; and nothing in the durable model has anywhere to put a recipient, a subject
/// or a body.
/// </summary>
[TestClass]
public sealed class NotificationChannelBoundaryTests
{
    private static readonly Assembly NotificationsAssembly = typeof(NotificationsModule).Assembly;

    /// <summary>In-app and email; nothing else is claimed, and nothing else is reserved.</summary>
    private static readonly string[] ExpectedChannels = ["InApp", "Email"];

    /// <summary>Service/transactional and marketing, kept explicitly apart.</summary>
    private static readonly string[] ExpectedPurposes = ["ServiceTransactional", "Marketing"];

    [TestMethod]
    public void NotificationsReferenceTheSharedKernelAndNoOtherModule()
    {
        var references = NotificationsAssembly.GetReferencedAssemblies()
            .Select(reference => reference.Name ?? string.Empty)
            .ToArray();

        Assert.Contains(
            typeof(IClock).Assembly.GetName().Name!,
            references,
            "Notifications composes with the shared kernel; that is the only module-facing reference it may have.");
        var moduleReferences = references
            .Where(name => name.StartsWith("TB.Gym.Modules.", StringComparison.Ordinal))
            .ToArray();
        Assert.IsEmpty(
            moduleReferences,
            $"Notifications references another module: {string.Join(", ", moduleReferences)}. " +
            "A recipient address is resolved through INotificationRecipientContacts, which Infrastructure implements.");
    }

    /// <summary>
    /// No provider SDK, anywhere. The email seam is an owned interface and the only implementation in
    /// this phase captures in memory; adding a provider is a new implementation behind this interface
    /// rather than a package reference that quietly starts making network calls.
    /// </summary>
    /// <remarks>
    /// Checked against the central package manifest as well as the loaded assemblies, because the
    /// manifest covers every project in the repository — including the API host, whose assembly this
    /// test project deliberately does not reference.
    /// </remarks>
    [TestMethod]
    public void NoEmailProviderPackageIsReferencedAnywhere()
    {
        string[] forbidden =
        [
            "Resend", "SendGrid", "MailKit", "MimeKit", "SimpleEmail", "Mailgun",
            "Postmark", "FluentEmail", "Smtp",
        ];

        var manifest = File.ReadAllText(Path.Combine(RepositoryRoot(), "Directory.Packages.props"));
        foreach (var package in forbidden)
        {
            Assert.DoesNotContain(
                package,
                manifest,
                StringComparison.OrdinalIgnoreCase,
                $"Directory.Packages.props references {package}; this phase adds no email provider.");
        }

        foreach (var assembly in AllProjectAssemblies())
        {
            var references = assembly.GetReferencedAssemblies()
                .Select(reference => reference.Name ?? string.Empty)
                .ToArray();
            foreach (var package in forbidden)
            {
                Assert.IsFalse(
                    references.Any(name => name.Contains(package, StringComparison.OrdinalIgnoreCase)),
                    $"{assembly.GetName().Name} references {package}; this phase adds no email provider.");
            }
        }
    }

    /// <summary>
    /// The durable model has nowhere to put a recipient, a subject, a body, a token or an action URL.
    /// A privacy rule that lives only in a code path is one refactor away from being untrue; a type
    /// with no such property cannot carry one however the code is rearranged.
    /// </summary>
    [TestMethod]
    public void NoDurableNotificationTypeCanCarryARecipientAddressOrRenderedEmail()
    {
        string[] forbidden =
        [
            "Recipient", "RecipientAddress", "EmailAddress", "Address", "To", "Cc", "Bcc",
            "Subject", "HtmlBody", "TextBody", "Token", "ActionUrl", "Url", "Link",
        ];

        foreach (var type in new[]
                 {
                     typeof(NotificationOutboxItem),
                     typeof(NotificationChannelDelivery),
                     typeof(NotificationDeliveryAttempt),
                     typeof(NotificationChannelPreference),
                     typeof(NotificationConsentEvent),
                     typeof(NotificationPreferenceCommandRecord),
                 })
        {
            var properties = type.GetProperties().Select(property => property.Name).ToArray();
            foreach (var name in forbidden)
            {
                Assert.DoesNotContain(
                    name,
                    properties,
                    $"{type.Name} can carry '{name}', which belongs only in memory at materialization.");
            }
        }

        // The dead-letter view an owner may read is the same rule, at the API boundary.
        var deadLetter = typeof(NotificationDeadLetterView).GetProperties()
            .Select(property => property.Name)
            .ToArray();
        foreach (var name in forbidden.Concat(["RecipientUserId", "PayloadJson", "Title", "Body"]))
        {
            Assert.DoesNotContain(
                name,
                deadLetter,
                $"The dead-letter view exposes '{name}'; it is an operational read, not somebody's inbox.");
        }
    }

    /// <summary>
    /// The message a transport is given exists only in memory, and the interface says so: the
    /// recipient and the wording are parameters of one call and are on no persisted type.
    /// </summary>
    [TestMethod]
    public void TheEmailSeamCarriesContentOnlyThroughItsCallParameters()
    {
        var message = typeof(NotificationEmailMessage);
        Assert.IsFalse(
            typeof(AuditableEntity).IsAssignableFrom(message),
            "A materialized email must not be a persistable entity.");

        var send = typeof(INotificationEmailTransport).GetMethod(nameof(INotificationEmailTransport.SendAsync));
        Assert.IsNotNull(send);
        Assert.AreEqual(message, send.GetParameters()[0].ParameterType);

        // The result a transport may report carries no provider acknowledgement this phase can honour.
        Assert.IsFalse(
            Enum.GetNames<NotificationEmailTransportOutcome>()
                .Any(name => name.Contains("Deliver", StringComparison.OrdinalIgnoreCase) ||
                             name.Contains("Sent", StringComparison.OrdinalIgnoreCase) ||
                             name.Contains("Accepted", StringComparison.OrdinalIgnoreCase)),
            "A transport outcome must not claim delivery, sending or provider acceptance.");
    }

    /// <summary>
    /// The delivery vocabulary keeps its distinctions. In particular there is no <c>Delivered</c>:
    /// this phase can establish that an inbox row exists or that a message was captured, and neither is
    /// a claim that a provider accepted anything or that a person read it.
    /// </summary>
    [TestMethod]
    public void NoDeliveryStateIsCalledDelivered()
    {
        foreach (var name in Enum.GetNames<NotificationDeliveryStatus>()
                     .Concat(Enum.GetNames<NotificationDeliveryOutcome>())
                     .Concat(Enum.GetNames<NotificationIntentStatus>()))
        {
            Assert.IsFalse(
                name.Contains("Deliver", StringComparison.OrdinalIgnoreCase),
                $"'{name}' claims delivery, which nothing in this phase can establish.");
        }

        // The two channels, and the two purposes, are the whole owned vocabulary.
        CollectionAssert.AreEquivalent(ExpectedChannels, Enum.GetNames<NotificationChannel>());
        CollectionAssert.AreEquivalent(ExpectedPurposes, Enum.GetNames<NotificationPurpose>());
    }

    /// <summary>
    /// The preference surface has no parameter that names a subject, so there is no shape in which one
    /// member changes another's settings — an absent shape rather than a forgotten check.
    /// </summary>
    [TestMethod]
    public void ThePreferenceServiceHasNoRouteToSomebodyElsesSettings()
    {
        foreach (var method in typeof(INotificationPreferenceService).GetMethods())
        {
            Assert.EndsWith("OwnAsync", method.Name, $"{method.Name} does not read as an own-settings operation.");
            foreach (var parameter in method.GetParameters())
            {
                Assert.AreNotEqual(
                    typeof(Guid),
                    parameter.ParameterType,
                    $"{method.Name} takes a bare identifier, which is how a subject gets named.");
            }
        }

        // And the update request carries no subject either.
        Assert.DoesNotContain(
            "UserId",
            typeof(UpdateNotificationPreferenceRequest).GetProperties().Select(property => property.Name).ToArray());
    }

    /// <summary>
    /// The Notifications module hosts nothing. A sweep is composed by a host, so a module-owned
    /// background service would be a module deciding how it is run.
    /// </summary>
    [TestMethod]
    public void NotificationsHostNoBackgroundServiceOfTheirOwn()
    {
        var hosted = NotificationsAssembly.GetTypes()
            .Where(type => typeof(Microsoft.Extensions.Hosting.IHostedService).IsAssignableFrom(type))
            .Select(type => type.Name)
            .ToArray();

        Assert.IsEmpty(hosted, $"Notifications host a background service: {string.Join(", ", hosted)}");
    }

    private static IEnumerable<Assembly> AllProjectAssemblies()
    {
        yield return NotificationsAssembly;
        yield return typeof(IClock).Assembly;
        yield return LoadByName("TB.Gym.Infrastructure");
        yield return LoadByName("TB.Gym.Worker");
    }

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
