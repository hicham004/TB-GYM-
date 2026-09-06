using System.Reflection;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.SharedKernel;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The boundaries Phase 6B-3C's tokenless action mail has to hold.
/// </summary>
/// <remarks>
/// Four properties, each of which would be invisible if it broke and each of which is the reason a
/// piece of this design looks the way it does:
/// </remarks>
[TestClass]
public sealed class ActionMailBoundaryTests
{
    private static readonly Assembly IdentityAssembly = typeof(IdentityModule).Assembly;

    private static readonly Assembly InvitationsAssembly = typeof(InvitationsModule).Assembly;

    /// <summary>Words that would mean a durable row had somewhere to put a credential or a mailbox.</summary>
    private static readonly string[] ForbiddenDurableMembers =
    [
        "Token", "RawToken", "Recipient", "RecipientAddress", "EmailAddress", "Address",
        "ActionUrl", "Url", "Link", "Subject", "Body", "ApiKey", "Secret",
    ];

    /// <summary>
    /// Members allowed to contain a forbidden word, each for a stated reason.
    /// </summary>
    /// <remarks>
    /// <c>TokenHash</c> is a digest and cannot be presented as a credential; recording it is the whole
    /// design. <c>TokenMintedAtUtc</c> is an instant. The two <c>Subject*</c> members use "subject" in
    /// its Identity sense - the account an action concerns - rather than in its email sense, and
    /// <c>SubjectSecurityStampHash</c> is a digest of a value this application generated rather than of
    /// anything enumerable.
    /// </remarks>
    private static readonly string[] AllowedDurableMembers =
        ["TokenHash", "TokenMintedAtUtc", "SubjectUserId", "SubjectSecurityStampHash"];

    /// <summary>
    /// Both modules still reference only the SharedKernel.
    /// </summary>
    /// <remarks>
    /// Action mail gave Identity and Invitations a real reason to want each other and to want the
    /// Notifications module: they share a transport, a provider client and a public origin. All three
    /// are composed in Infrastructure instead, and this is what keeps that from quietly reverting the
    /// first time somebody needs one type from the other side.
    /// </remarks>
    [TestMethod]
    public void ActionMailDidNotGiveIdentityOrInvitationsAReferenceToAnotherModule()
    {
        foreach (var assembly in new[] { IdentityAssembly, InvitationsAssembly })
        {
            var moduleReferences = assembly.GetReferencedAssemblies()
                .Select(reference => reference.Name)
                .Where(name => name?.StartsWith("TB.Gym.Modules.", StringComparison.Ordinal) == true)
                .ToArray();

            Assert.IsEmpty(
                moduleReferences,
                $"{assembly.GetName().Name} references another module: {string.Join(", ", moduleReferences)}");

            Assert.DoesNotContain(
                "TB.Gym.Infrastructure",
                assembly.GetReferencedAssemblies().Select(reference => reference.Name).ToArray(),
                $"{assembly.GetName().Name} references Infrastructure, inverting the composition direction.");
        }
    }

    /// <summary>
    /// The global action-mail queue has no tenant, in the type system as well as in the schema.
    /// </summary>
    /// <remarks>
    /// ADR 0021 refuses a fabricated workspace on global Identity mail. The schema enforces it by
    /// having no column; this enforces it a step earlier, so a well-meaning refactor cannot make the
    /// entity tenant-owned and then discover the problem in a migration.
    /// </remarks>
    [TestMethod]
    public void GlobalAccountActionMailIsNotTenantOwned()
    {
        foreach (var type in new[] { typeof(AccountActionMailRequest), typeof(AccountActionMailAttempt) })
        {
            Assert.IsFalse(
                typeof(ITenantOwnedEntity).IsAssignableFrom(type),
                $"{type.Name} is tenant-owned; global Identity mail must never carry a workspace.");
            Assert.IsFalse(
                typeof(TenantEntity).IsAssignableFrom(type),
                $"{type.Name} derives from TenantEntity, which would give it a TenantId.");
            Assert.IsNull(
                type.GetProperty("TenantId"),
                $"{type.Name} has a TenantId property; a column that does not exist cannot be fabricated.");
        }

        // The invitation queue is the opposite, and equally deliberate.
        foreach (var type in new[]
                 {
                     typeof(InvitationActionMailRequest),
                     typeof(InvitationActionMailAttempt),
                     typeof(InvitationTokenIssue),
                 })
        {
            Assert.IsTrue(
                typeof(ITenantOwnedEntity).IsAssignableFrom(type),
                $"{type.Name} must be tenant-owned; an invitation is a workspace's own act.");
        }
    }

    /// <summary>
    /// No durable action-mail row has anywhere to put a token, an address, a link or a rendered body.
    /// </summary>
    /// <remarks>
    /// The privacy rule asserted structurally rather than by inspecting data. An integration test
    /// proves nothing sensitive reached a column; this proves there is no column it could reach, which
    /// is the version that keeps holding when somebody adds a field next year.
    /// <para>
    /// <c>TokenHash</c> is the one deliberate exception: recording it is the whole design, and a
    /// digest cannot be presented as a credential.
    /// </para>
    /// </remarks>
    [TestMethod]
    public void NoDurableActionMailRowCanHoldACredentialOrAMailbox()
    {
        var durableTypes = new[]
        {
            typeof(AccountActionMailRequest),
            typeof(AccountActionMailAttempt),
            typeof(InvitationActionMailRequest),
            typeof(InvitationActionMailAttempt),
            typeof(InvitationTokenIssue),
            typeof(ClientInvitation),
        };

        var offenders = durableTypes
            // The invitation aggregate legitimately owns the invited person's own details: it is the
            // record of who was invited, and it predates all of this.
            .Where(type => type != typeof(ClientInvitation))
            .SelectMany(type => type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(property => property.PropertyType == typeof(string))
                .Where(property => !AllowedDurableMembers.Contains(property.Name, StringComparer.Ordinal))
                .Where(property => ForbiddenDurableMembers.Any(forbidden =>
                    property.Name.Contains(forbidden, StringComparison.OrdinalIgnoreCase)))
                .Select(property => $"{type.Name}.{property.Name}"))
            .ToArray();

        Assert.IsEmpty(
            offenders,
            "These durable members look like somewhere a credential, a mailbox or a rendered message " +
            $"could be stored: {string.Join(", ", offenders)}. Either rename them, or add them to " +
            "AllowedDurableMembers with a reason.");
    }

    /// <summary>
    /// The action-mail scheduling contract takes no address, no token and no return URL.
    /// </summary>
    /// <remarks>
    /// A caller that could supply any of the three would be a caller that could redirect somebody
    /// else's credential — which is the same class of defect as trusting a <c>Host</c> header, only
    /// reachable from inside the application instead of from outside it.
    /// </remarks>
    [TestMethod]
    public void TheActionMailSchedulingContractCannotBeToldWhereToSend()
    {
        var request = typeof(IAccountActionMailScheduler)
            .GetMethod(nameof(IAccountActionMailScheduler.RequestAsync))!;
        var command = request.GetParameters()[0].ParameterType;

        foreach (var property in command.GetProperties())
        {
            Assert.IsFalse(
                property.PropertyType == typeof(string) &&
                    property.Name is not "RequestSource",
                $"{command.Name}.{property.Name} lets a caller supply free text to the mail path.");
        }

        Assert.IsNull(command.GetProperty("Recipient"));
        Assert.IsNull(command.GetProperty("Token"));
        Assert.IsNull(command.GetProperty("ReturnUrl"));
        Assert.IsNull(command.GetProperty("ActionUrl"));
    }

    /// <summary>
    /// The invitation mail authorization contract answers with a code or a mailbox, never both.
    /// </summary>
    /// <remarks>
    /// A refusal that still carried an address would be a refusal somebody could log, and the point of
    /// resolving the recipient at materialization is that it exists for one call and no longer.
    /// </remarks>
    [TestMethod]
    public void ARefusedInvitationAuthorizationCarriesNoMailbox()
    {
        var refused = InvitationMailAuthorization.Refused(InvitationActionMailCodes.InvitationRevoked);

        Assert.IsFalse(refused.IsAuthorized);
        Assert.IsNull(refused.RecipientAddress);
        Assert.IsNull(refused.ExpiresAtUtc);
        Assert.AreEqual(InvitationActionMailCodes.InvitationRevoked, refused.SuppressionCode);

        var allowed = InvitationMailAuthorization.Allowed(
            "invited@example.test",
            DateTimeOffset.UtcNow.AddDays(7));
        Assert.IsTrue(allowed.IsAuthorized);
        Assert.IsNull(allowed.SuppressionCode);
    }

    /// <summary>
    /// Every host that can serve a token-bearing page declares <c>no-referrer</c>.
    /// </summary>
    /// <remarks>
    /// A confirmation, reset or invitation link carries a single-use credential in its query string
    /// until the page exchanges it. Without this policy, any subresource request or outbound click
    /// from that page sends the whole URL — credential included — to a third party in the
    /// <c>Referer</c> header.
    /// <para>
    /// It is declared in three places on purpose, and this asserts the two that are not C#. The API
    /// sends the header from its own middleware; the production nginx configuration sends it for the
    /// static application; and the document repeats it in a <c>meta</c> so the guarantee survives a
    /// development server, a static preview, or any host that forgets. Asserting the file contents
    /// rather than a description of them is the point: a deployment ships these files.
    /// </para>
    /// </remarks>
    [TestMethod]
    public void EveryHostServingATokenBearingPageDeclaresNoReferrer()
    {
        var index = ReadCopiedFile("web.index.html");
        Assert.Contains(
            "name=\"referrer\"",
            index,
            StringComparison.Ordinal,
            "The application document does not declare a referrer policy.");
        Assert.Contains(
            "content=\"no-referrer\"",
            index,
            StringComparison.Ordinal,
            "The application document declares a referrer policy other than no-referrer.");

        var nginx = ReadCopiedFile("web.nginx.conf");
        Assert.Contains(
            "add_header Referrer-Policy \"no-referrer\" always;",
            nginx,
            StringComparison.Ordinal,
            "The production static host does not send Referrer-Policy: no-referrer.");

        // And no token-bearing page may pull in a third party, because the policy protects the
        // referrer and not the URL a script could read and send itself.
        foreach (var forbidden in new[] { "http://", "https://" })
        {
            var external = index
                .Split('\n')
                .Where(line => line.Contains("src=", StringComparison.Ordinal) ||
                    line.Contains("href=", StringComparison.Ordinal))
                .Where(line => line.Contains(forbidden, StringComparison.OrdinalIgnoreCase))
                .ToArray();
            Assert.IsEmpty(
                external,
                $"The application document loads a third-party resource: {string.Join(" | ", external)}");
        }
    }

    private static string ReadCopiedFile(string name)
    {
        var path = Path.Combine(AppContext.BaseDirectory, name);
        Assert.IsTrue(File.Exists(path), $"{name} is not in the test output.");
        return File.ReadAllText(path);
    }

    /// <summary>
    /// Every action-mail code is stable, lower-case, hyphenated and namespaced by its own module.
    /// </summary>
    /// <remarks>
    /// These reach log lines and rows an operator reads, so they have to be safe to show to somebody
    /// who is not the recipient — and they have to be greppable. A code that means two things in two
    /// places explains neither, which is why the two modules prefix their own.
    /// </remarks>
    [TestMethod]
    public void ActionMailCodesAreStableGreppableAndModuleNamespaced()
    {
        AssertCodes(typeof(AccountActionMailCodes), "account-action-mail-");
        AssertCodes(typeof(InvitationActionMailCodes), "invitation-");

        static void AssertCodes(Type type, string prefix)
        {
            var codes = type
                .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
                .Where(field => field is { IsLiteral: true, IsInitOnly: false })
                .Select(field => (string)field.GetRawConstantValue()!)
                .ToArray();

            Assert.IsNotEmpty(codes, $"{type.Name} publishes no codes.");
            foreach (var code in codes)
            {
                Assert.StartsWith(prefix, code, $"'{code}' is not namespaced by its owning module.");
                Assert.AreEqual(code, code.ToLowerInvariant(), $"'{code}' is not lower-case.");
                Assert.IsLessThanOrEqualTo(100, code.Length, $"'{code}' exceeds the stored column width.");
                Assert.DoesNotContain(" ", code, StringComparison.Ordinal);
            }

            Assert.AreEqual(codes.Length, codes.Distinct(StringComparer.Ordinal).Count(),
                $"{type.Name} publishes a duplicate code.");
        }
    }
}
