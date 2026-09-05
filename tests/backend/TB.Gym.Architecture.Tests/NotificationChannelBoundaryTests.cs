using System.Reflection;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The boundaries the email channel has to hold, in both the phases that built it.
/// </summary>
/// <remarks>
/// Phase 6B-3A: the Notifications module owns its own model and reaches into no other module for a
/// recipient address; the email transport is an owned interface; and nothing in the durable model has
/// anywhere to put a recipient, a subject or a body.
/// <para>
/// Phase 6B-3B added a real provider and, with it, three boundaries worth asserting rather than
/// assuming — that integrating a provider did not bring in its SDK, that provider acceptance and
/// recipient-server acceptance stayed two separate facts on two separate roots, and that the
/// provider-event vocabulary stayed owned, small and free of tracking.
/// </para>
/// </remarks>
[TestClass]
public sealed class NotificationChannelBoundaryTests
{
    private static readonly Assembly NotificationsAssembly = typeof(NotificationsModule).Assembly;

    /// <summary>In-app and email; nothing else is claimed, and nothing else is reserved.</summary>
    private static readonly string[] ExpectedChannels = ["InApp", "Email"];

    /// <summary>Service/transactional and marketing, kept explicitly apart.</summary>
    private static readonly string[] ExpectedPurposes = ["ServiceTransactional", "Marketing"];

    /// <summary>The complete owned provider-event vocabulary, and nothing else.</summary>
    private static readonly string[] ExpectedProviderEventTypes =
    [
        "ProviderAccepted", "RecipientServerAccepted", "Bounced", "Complained",
        "DeliveryDelayed", "Failed", "ProviderSuppressed",
    ];

    private static readonly string[] ExpectedSuppressionReasons =
        ["PermanentBounce", "Complaint", "ProviderSuppressed"];

    /// <summary>
    /// Words that must never name a provider event. Two of them are absent facts, three are facts a
    /// different layer owns.
    /// </summary>
    private static readonly string[] ForbiddenProviderEventWords =
        ["Open", "Click", "Read", "Delivered", "Sent"];

    /// <summary>Method-name fragments that would amount to an un-suppression control.</summary>
    private static readonly string[] ForbiddenSuppressionVerbs =
        ["Clear", "Release", "Remove", "Lift", "Override", "Delete"];

    /// <summary>Parameters a provider webhook must never be able to assert for itself.</summary>
    private static readonly string[] ForbiddenIngestionParameters =
        ["TenantId", "UserId", "RecipientUserId", "ChannelDeliveryId"];

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
    /// No provider SDK, anywhere — now that a real provider is integrated, which is when this
    /// assertion starts being worth making.
    /// </summary>
    /// <remarks>
    /// Phase 6B-3B sends real email through Resend, and does it with <c>HttpClient</c> and two owned
    /// records rather than the vendor's package. An SDK would authenticate, serialize, retry and
    /// throw on this repository's behalf, and every one of those is already decided here: the retry
    /// schedule is durable and named, the idempotency key is derived from domain state, failures must
    /// be classified into stable codes before they touch a row, and no exception may carry a response
    /// body. It would also put the provider's own types one <c>using</c> away from the domain.
    /// <para>
    /// Checked against the central package manifest as well as the loaded assemblies, because the
    /// manifest covers every project in the repository — including the API host, whose assembly this
    /// test project deliberately does not reference.
    /// </para>
    /// </remarks>
    [TestMethod]
    public void NoEmailProviderSdkIsReferencedAnywhere()
    {
        string[] forbidden =
        [
            "Resend", "SendGrid", "MailKit", "MimeKit", "SimpleEmail", "Mailgun",
            "Postmark", "FluentEmail", "Smtp", "Svix", "StandardWebhooks",
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
                     // Phase 6B-3B's provider rows are held to the same rule. The mailbox they are
                     // about participates only as a keyed MAC, under a name that says so.
                     typeof(NotificationProviderMessage),
                     typeof(NotificationProviderEvent),
                     typeof(NotificationEmailSuppression),
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

        // The one place a mailbox is referred to at all, and it is a fingerprint by name and by type.
        foreach (var type in new[] { typeof(NotificationProviderMessage), typeof(NotificationEmailSuppression) })
        {
            foreach (var property in type.GetProperties().Where(candidate =>
                         candidate.Name.Contains("Address", StringComparison.Ordinal)))
            {
                Assert.EndsWith(
                    "Fingerprint",
                    property.Name,
                    $"{type.Name}.{property.Name} names an address without being a fingerprint of one.");
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

        // A synchronous call can establish that the provider took responsibility, and nothing beyond
        // it. So exactly one outcome may say "accepted", it must say whose acceptance it is, and no
        // outcome may claim delivery or sending — neither of which a send response can know.
        var outcomes = Enum.GetNames<NotificationEmailTransportOutcome>();
        Assert.IsFalse(
            outcomes.Any(name => name.Contains("Deliver", StringComparison.OrdinalIgnoreCase) ||
                                 name.Contains("Sent", StringComparison.OrdinalIgnoreCase)),
            "A transport outcome must not claim delivery or sending; only a verified provider event can.");
        CollectionAssert.AreEquivalent(
            new[] { nameof(NotificationEmailTransportOutcome.ProviderAccepted) },
            outcomes.Where(name => name.Contains("Accepted", StringComparison.OrdinalIgnoreCase)).ToArray(),
            "Provider acceptance is the one acceptance a send response establishes.");
        Assert.IsFalse(
            outcomes.Any(name => name.Contains("RecipientServer", StringComparison.OrdinalIgnoreCase)),
            "Recipient-server acceptance arrives asynchronously and is never a transport outcome.");
    }

    /// <summary>
    /// The provider event vocabulary is owned, small, and deliberately missing two members.
    /// </summary>
    /// <remarks>
    /// Open and click events are not modelled and are never persisted. An open is not a read — it is a
    /// tracking pixel firing, which happens when a preview pane renders and does not happen when
    /// somebody reads the message in plain text — and recording it would begin exactly the tracking
    /// log the consent evidence was carefully kept from becoming.
    /// </remarks>
    [TestMethod]
    public void TheProviderEventVocabularyIsOwnedAndExcludesTracking()
    {
        var events = Enum.GetNames<NotificationProviderEventType>();
        foreach (var forbidden in ForbiddenProviderEventWords)
        {
            Assert.IsFalse(
                events.Any(name => name.Contains(forbidden, StringComparison.OrdinalIgnoreCase)),
                $"'{forbidden}' is not a provider fact this repository records.");
        }

        CollectionAssert.AreEquivalent(ExpectedProviderEventTypes, events);
        CollectionAssert.AreEquivalent(
            ExpectedSuppressionReasons,
            Enum.GetNames<NotificationEmailSuppressionReason>());
    }

    /// <summary>
    /// Provider acceptance and recipient-server acceptance are two columns on two different roots, and
    /// nothing in the model offers a way to write one from the other.
    /// </summary>
    [TestMethod]
    public void ProviderAcceptanceAndRecipientServerAcceptanceAreSeparateFacts()
    {
        var deliveryProperties = typeof(NotificationChannelDelivery).GetProperties()
            .Select(property => property.Name)
            .ToArray();
        Assert.Contains(nameof(NotificationChannelDelivery.ProviderAcceptedAtUtc), deliveryProperties);
        Assert.DoesNotContain(
            "RecipientServerAcceptedAtUtc",
            deliveryProperties,
            "A later, asynchronous fact must not sit on the row whose terminal state is immutable.");

        var messageProperties = typeof(NotificationProviderMessage).GetProperties()
            .Select(property => property.Name)
            .ToArray();
        foreach (var expected in new[]
                 {
                     nameof(NotificationProviderMessage.ProviderAcceptedAtUtc),
                     nameof(NotificationProviderMessage.RecipientServerAcceptedAtUtc),
                     nameof(NotificationProviderMessage.BouncedAtUtc),
                     nameof(NotificationProviderMessage.ComplainedAtUtc),
                 })
        {
            Assert.Contains(expected, messageProperties);
        }

        Assert.DoesNotContain(
            "ReadAtUtc",
            messageProperties,
            "Read is the reader's own act on their inbox row and is never inferred from a provider.");
    }

    /// <summary>
    /// Suppression has no clearing surface, and the ingestion seam has no shape that lets a caller
    /// name a workspace.
    /// </summary>
    /// <remarks>
    /// A control that un-suppresses a mailbox is a control that can be used to keep mailing an address
    /// that complained, so its absence is deliberate rather than unfinished. The ingestion request
    /// carries a signature and a body and nothing else: the workspace is resolved from the durable
    /// provider-message relationship, so there is no parameter through which an unauthenticated caller
    /// could aim an event at somebody else's data.
    /// </remarks>
    [TestMethod]
    public void SuppressionHasNoOverrideAndIngestionNamesNoWorkspace()
    {
        var suppression = typeof(NotificationEmailSuppression);
        foreach (var method in suppression.GetMethods().Where(candidate => candidate.DeclaringType == suppression))
        {
            foreach (var forbidden in ForbiddenSuppressionVerbs)
            {
                Assert.DoesNotContain(
                    forbidden,
                    method.Name,
                    StringComparison.OrdinalIgnoreCase,
                    $"{method.Name} would be an un-suppression surface this phase deliberately does not have.");
            }
        }

        var request = typeof(NotificationProviderEventRequest).GetProperties()
            .Select(property => property.Name)
            .ToArray();
        foreach (var forbidden in ForbiddenIngestionParameters)
        {
            Assert.DoesNotContain(
                forbidden,
                request,
                $"A webhook request must not name '{forbidden}'; the workspace is resolved, never asserted.");
        }
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
