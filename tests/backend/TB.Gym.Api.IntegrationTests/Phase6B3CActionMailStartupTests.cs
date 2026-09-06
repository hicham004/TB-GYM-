using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Startup validation for the public action origin and the action-mail configuration.
/// </summary>
/// <remarks>
/// A link in a password-reset email is a credential pointed at a host. If that host can be wrong, the
/// mail becomes a credential-harvesting message the victim's own account legitimately triggered — so
/// every way the origin can be wrong is a refused startup rather than a runtime surprise, and both
/// composition roots refuse identically.
/// <para>
/// These build the composition directly rather than starting a host. What is under test is the
/// validation rule, and driving it through a web host would add a database, a listener and a dozen
/// unrelated ways to fail.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B3CActionMailStartupTests
{
    private const string SigningSecret = "whsec_c3RhcnR1cC10ZXN0LXNlY3JldC12YWx1ZQ==";

    private const string FingerprintKey = "c3RhcnR1cC10ZXN0LWZpbmdlcnByaW50LWtleS0zMg==";

    private const string ActiveKeyId = "startup-active";

    /// <summary>
    /// Development accepts a plain-HTTP loopback origin, and resolves it for the link builder.
    /// </summary>
    /// <remarks>
    /// The relaxation is exactly one rule wide: <c>http</c> is allowed and nothing else is. Everything
    /// below still applies, which is what stops "it works in development" from being the reason a
    /// production rule is discovered late.
    /// </remarks>
    [TestMethod]
    public void DevelopmentAcceptsAPlainHttpOriginAndResolvesIt()
    {
        var options = Resolve(Origin("http://localhost:4200"), isDevelopment: true, isProduction: false);

        Assert.IsNotNull(options.ResolvedOrigin);
        Assert.AreEqual("http://localhost:4200", options.ResolvedOrigin!.GetLeftPart(UriPartial.Authority));
    }

    /// <summary>Outside Development an action link must be HTTPS.</summary>
    [TestMethod]
    public void OutsideDevelopmentAPlainHttpOriginRefusesStartup()
    {
        AssertRefused(
            Origin("http://app.tbgym.test", allowlist: "http://app.tbgym.test"),
            "must be HTTPS outside Development");
    }

    /// <summary>
    /// Outside Development the origin must be on an explicit allowlist.
    /// </summary>
    /// <remarks>
    /// A list rather than a single setting, so that moving between hosts is a change somebody reviewed
    /// in advance rather than an unchecked edit to one value.
    /// </remarks>
    [TestMethod]
    public void OutsideDevelopmentAnUnlistedOriginRefusesStartup()
    {
        AssertRefused(
            Origin("https://app.tbgym.test", allowlist: "https://other.tbgym.test"),
            "must be one of the origins");

        AssertRefused(Origin("https://app.tbgym.test"), "must list at least one HTTPS origin");
    }

    /// <summary>
    /// Credentials, a query string, a fragment and any path are refused.
    /// </summary>
    /// <remarks>
    /// Each of these is a way to build a lookalike out of a real setting.
    /// <c>https://app.example.com@attacker.test</c> reads as the product and resolves to the attacker;
    /// a configured query or fragment either disappears when the action parameters are appended or
    /// changes what they mean; and a path has no legitimate use here while every illegitimate one is a
    /// traversal. Refusing the whole shape removes the class rather than sanitising it.
    /// </remarks>
    [TestMethod]
    public void AnOriginWithCredentialsQueryFragmentOrPathRefusesStartup()
    {
        AssertRefused(
            Origin("https://app.tbgym.test@attacker.test", allowlist: "https://app.tbgym.test"),
            "must not contain user information");
        AssertRefused(
            Origin("https://app.tbgym.test?next=/x", allowlist: "https://app.tbgym.test"),
            "must not contain a query string or a fragment");
        AssertRefused(
            Origin("https://app.tbgym.test#/x", allowlist: "https://app.tbgym.test"),
            "must not contain a query string or a fragment");
        AssertRefused(
            Origin("https://app.tbgym.test/app", allowlist: "https://app.tbgym.test"),
            "must be a bare origin with no path");
        AssertRefused(Origin(""), "is required");
        AssertRefused(Origin("not-a-url"), "must be an absolute URL");
    }

    /// <summary>An allowlist entry is held to exactly the same rules as the origin itself.</summary>
    [TestMethod]
    public void AnAllowlistEntryIsValidatedAsStrictlyAsTheOrigin()
    {
        AssertRefused(
            Origin("https://app.tbgym.test", allowlist: "https://app.tbgym.test/app"),
            "PublicOriginAllowlist contains an entry");
    }

    /// <summary>
    /// A retry schedule longer than the provider's idempotency retention refuses to start.
    /// </summary>
    /// <remarks>
    /// Every action-mail attempt presents its own key, so a schedule that outruns the provider's
    /// memory means a late attempt is genuinely a second message rather than a deduplicated retry.
    /// That may be an acceptable trade, but it has to be a decision somebody made rather than a
    /// consequence of raising one number in a different configuration section.
    /// </remarks>
    [TestMethod]
    public void ARetryScheduleLongerThanTheProviderRetentionRefusesToStart()
    {
        var email = ProviderEmailOptions();
        email.Provider.IdempotencyRetentionHours = 1;

        // Ten attempts span 1 + 5 + 30 x 8 minutes, which is over four hours. The default of four
        // spans 36 minutes and fits comfortably, which is the other half of the rule.
        Assert.IsNull(new ActionMailDispatchOptions { MaximumAttempts = 4 }.Validate(email, isProduction: true));

        var refusal = new ActionMailDispatchOptions { MaximumAttempts = 10 }
            .Validate(email, isProduction: true);

        Assert.IsNotNull(refusal, "A schedule spanning four hours must not fit a 1-hour window silently.");
        Assert.Contains("provider idempotency retention", refusal!, StringComparison.Ordinal);
    }

    /// <summary>
    /// Action mail does not refuse to start when a deployment has configured no provider.
    /// </summary>
    /// <remarks>
    /// Deliberate, and worth an explicit test because the opposite is tempting. Phase 6B-3A decided
    /// that a deployment may run with email switched off, and Phase 6B-3C does not reverse another
    /// phase's decision as a side effect. What a Production deployment without a provider gets is
    /// action mail that dead-letters with <c>*-transport-unavailable</c>, and a release-gate item in
    /// <c>LAUNCH-CHECKLIST.md</c> that says so.
    /// </remarks>
    [TestMethod]
    public void ActionMailDoesNotRefuseAProductionDeploymentWithNoProvider()
    {
        var withoutProvider = new NotificationEmailOptions();

        Assert.IsNull(
            new ActionMailDispatchOptions().Validate(withoutProvider, isProduction: true),
            "Phase 6B-3A allows Production with email disabled; this phase does not reverse that.");
        Assert.IsNull(
            new ActionMailDispatchOptions().Validate(withoutProvider, isProduction: false),
            "Outside Production the captured adapter carries action mail, which is the point of it.");
    }

    /// <summary>The engineering parameters are bounded, and the bounds are the two modules' own.</summary>
    [TestMethod]
    public void ActionMailDispatchParametersAreBounded()
    {
        var email = ProviderEmailOptions();

        AssertDispatchRefused(new ActionMailDispatchOptions { PollIntervalSeconds = 0 }, email, "PollIntervalSeconds");
        AssertDispatchRefused(new ActionMailDispatchOptions { PollIntervalSeconds = 301 }, email, "PollIntervalSeconds");
        AssertDispatchRefused(new ActionMailDispatchOptions { BatchSize = 0 }, email, "BatchSize");
        AssertDispatchRefused(new ActionMailDispatchOptions { BatchSize = 201 }, email, "BatchSize");
        AssertDispatchRefused(new ActionMailDispatchOptions { ClaimLeaseSeconds = 29 }, email, "ClaimLeaseSeconds");
        AssertDispatchRefused(new ActionMailDispatchOptions { ClaimLeaseSeconds = 901 }, email, "ClaimLeaseSeconds");
        AssertDispatchRefused(new ActionMailDispatchOptions { MaximumAttempts = 0 }, email, "MaximumAttempts");
        AssertDispatchRefused(new ActionMailDispatchOptions { MaximumAttempts = 11 }, email, "MaximumAttempts");

        Assert.IsNull(new ActionMailDispatchOptions().Validate(email, isProduction: true));
    }

    /// <summary>
    /// The Worker composition validates the origin exactly as the API does.
    /// </summary>
    /// <remarks>
    /// This is the root where getting it wrong is most likely and most damaging: the Worker has no
    /// request to take an origin from even if that were allowed, so configuration is the only possible
    /// source, and a Worker that started with an unusable one would dead-letter every action email it
    /// touched. Both roots therefore run the same rule, and this proves it rather than assuming it.
    /// </remarks>
    [TestMethod]
    public void TheWorkerRefusesToStartWithoutAValidatedPublicOrigin()
    {
        var refusal = Assert.ThrowsExactly<OptionsValidationException>(() =>
            ResolveWorkerOrigin(
                new Dictionary<string, string?>
                {
                    ["Application:PublicBaseUrl"] = "http://app.tbgym.test",
                    ["Application:PublicOriginAllowlist:0"] = "http://app.tbgym.test",
                },
                isProduction: true,
                isDevelopment: false));
        Assert.Contains("must be HTTPS outside Development", string.Join(" ", refusal.Failures), StringComparison.Ordinal);

        // And it starts, and resolves the origin, when the configuration is right.
        var resolved = ResolveWorkerOrigin(
            new Dictionary<string, string?>
            {
                ["Application:PublicBaseUrl"] = "https://app.tbgym.test",
                ["Application:PublicOriginAllowlist:0"] = "https://app.tbgym.test",
            },
            isProduction: true,
            isDevelopment: false);
        Assert.AreEqual("https://app.tbgym.test", resolved.GetLeftPart(UriPartial.Authority));
    }

    /// <summary>Production cannot mint action tokens under an ephemeral, process-local key ring.</summary>
    [TestMethod]
    public void ProductionCompositionRefusesAnUnpersistedDataProtectionKeyRing()
    {
        var configuration = new ConfigurationBuilder().Build();
        var services = new ServiceCollection();

        var refusal = Assert.ThrowsExactly<InvalidOperationException>(() =>
            services.AddTbGymDataProtection(configuration, isProduction: true));

        Assert.Contains("DataProtection:KeyPath", refusal.Message, StringComparison.Ordinal);
        services.AddTbGymDataProtection(configuration, isProduction: false);
    }

    /// <summary>
    /// The link builder produces links only from the validated origin, and null when there is none.
    /// </summary>
    /// <remarks>
    /// Null rather than a default is the important half. A builder that fell back to localhost when
    /// configuration was missing would send production users a link to their own machine; returning
    /// nothing makes it a permanent dispatch failure with a stable code instead.
    /// </remarks>
    [TestMethod]
    public void TheLinkBuilderUsesTheValidatedOriginAndNeverADefault()
    {
        var valid = new PublicActionLinkBuilder(
            Options.Create(Resolve(Origin("https://app.tbgym.test", allowlist: "https://app.tbgym.test"),
                isDevelopment: false,
                isProduction: true)));

        Assert.IsTrue(valid.IsAvailable);
        var confirm = valid.BuildAccountActionUrl(
            TB.Gym.Modules.Identity.AccountActionKind.ConfirmEmail,
            Guid.NewGuid(),
            "encoded-code");
        Assert.IsNotNull(confirm);
        Assert.StartsWith("https://app.tbgym.test/auth/confirm-email?", confirm!);

        var reset = valid.BuildAccountActionUrl(
            TB.Gym.Modules.Identity.AccountActionKind.ResetPassword,
            Guid.NewGuid(),
            "encoded-code");
        Assert.StartsWith("https://app.tbgym.test/auth/reset-password?", reset!);
        Assert.StartsWith("https://app.tbgym.test/invite?token=", valid.BuildInvitationUrl("raw-token")!);

        var unusable = new PublicActionOriginOptions { PublicBaseUrl = "not-a-url" };
        unusable.Validate(isDevelopment: true);
        var broken = new PublicActionLinkBuilder(Options.Create(unusable));

        Assert.IsFalse(broken.IsAvailable);
        Assert.IsNull(broken.BuildInvitationUrl("raw-token"));
        Assert.IsNull(broken.BuildAccountActionUrl(
            TB.Gym.Modules.Identity.AccountActionKind.ConfirmEmail,
            Guid.NewGuid(),
            "encoded-code"));
    }

    // ---------- helpers ----------

    private static PublicActionOriginOptions Origin(string publicBaseUrl, string? allowlist = null)
    {
        var options = new PublicActionOriginOptions { PublicBaseUrl = publicBaseUrl };
        if (allowlist is not null)
        {
            options.PublicOriginAllowlist.Add(allowlist);
        }

        return options;
    }

    private static PublicActionOriginOptions Resolve(
        PublicActionOriginOptions options,
        bool isDevelopment,
        bool isProduction)
    {
        var refusal = options.Validate(isDevelopment);
        Assert.IsNull(refusal, $"Expected a valid configuration, and it was refused: {refusal}");
        Assert.IsFalse(isProduction && options.ResolvedOrigin?.Scheme != Uri.UriSchemeHttps);
        return options;
    }

    private static void AssertRefused(PublicActionOriginOptions options, string expectedFragment)
    {
        var refusal = options.Validate(isDevelopment: false);

        Assert.IsNotNull(refusal, $"'{options.PublicBaseUrl}' was accepted and must not be.");
        Assert.Contains(expectedFragment, refusal!, StringComparison.Ordinal);
        Assert.IsNull(options.ResolvedOrigin, "A refused configuration must resolve no origin.");
    }

    private static void AssertDispatchRefused(
        ActionMailDispatchOptions options,
        NotificationEmailOptions email,
        string expectedSetting)
    {
        var refusal = options.Validate(email, isProduction: true);

        Assert.IsNotNull(refusal, $"{expectedSetting} was accepted out of range.");
        Assert.Contains(expectedSetting, refusal!, StringComparison.Ordinal);
    }

    private static NotificationEmailOptions ProviderEmailOptions()
    {
        var email = new NotificationEmailOptions
        {
            Enabled = true,
            Adapter = NotificationEmailAdapters.Resend,
        };
        email.Provider.ApiKey = "re_startup_test_key";
        email.Provider.FromAddress = "TB Gym <notifications@mail.tbgym.test>";
        email.Provider.WebhookSigningSecret = SigningSecret;
        email.Provider.FingerprintKeyId = ActiveKeyId;
        email.Provider.FingerprintKeys[ActiveKeyId] = FingerprintKey;
        return email;
    }

    /// <summary>
    /// Composes the Worker exactly as its entry point does, and resolves the origin it would use.
    /// </summary>
    private static Uri ResolveWorkerOrigin(
        Dictionary<string, string?> origin,
        bool isProduction,
        bool isDevelopment)
    {
        var settings = new Dictionary<string, string?>(origin)
        {
            ["ConnectionStrings:Database"] = "Host=unused;Database=unused;Username=unused;Password=unused",
            ["DataProtection:KeyPath"] = Path.Combine(Path.GetTempPath(), "tb-gym-action-mail-startup-tests"),
            ["Notifications:Email:Adapter"] = NotificationEmailAdapters.Resend,
            ["Notifications:Email:Provider:ApiKey"] = "re_startup_test_key",
            ["Notifications:Email:Provider:FromAddress"] = "TB Gym <notifications@mail.tbgym.test>",
            ["Notifications:Email:Provider:WebhookSigningSecret"] = SigningSecret,
            ["Notifications:Email:Provider:FingerprintKeyId"] = ActiveKeyId,
            [$"Notifications:Email:Provider:FingerprintKeys:{ActiveKeyId}"] = FingerprintKey,
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddTbGymNotificationWorkerInfrastructure(configuration, isProduction, isDevelopment);

        using var provider = services.BuildServiceProvider(validateScopes: true);
        var resolved = provider.GetRequiredService<IOptions<PublicActionOriginOptions>>().Value;
        Assert.IsNotNull(resolved.ResolvedOrigin);
        return resolved.ResolvedOrigin!;
    }
}
