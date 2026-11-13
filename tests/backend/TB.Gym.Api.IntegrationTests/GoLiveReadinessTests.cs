using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure;
using TB.Gym.Infrastructure.Initialization;
using TB.Gym.Modules.Notifications;
using ProviderHttpDouble = TB.Gym.Api.IntegrationTests.Phase6B3BProviderEmailTests.ProviderHttpDouble;
using ProviderResponse = TB.Gym.Api.IntegrationTests.Phase6B3BProviderEmailTests.ProviderResponse;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Go-live preparation (commercial Step 4): Production refuses development settings, every mail
/// carries the support Reply-To, and an operator can prove the provider works with one command.
/// </summary>
/// <remarks>
/// None of these need a database. The guard runs at composition, before anything connects, and the
/// test-email command talks only to the provider.
/// </remarks>
[TestClass]
public sealed class GoLiveReadinessTests
{
    private const string UnusedDatabase = "Host=unused.invalid;Database=unused;Username=unused;Password=unused";

    private static readonly string SigningSecret =
        NotificationWebhookSignature.SecretPrefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));

    private static readonly string FingerprintKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    [TestMethod]
    public void ACleanProductionConfigurationHasNoDevelopmentSettings()
    {
        var problems = ProductionSettingsGuard.FindDevelopmentSettings(Configuration(CleanProduction()));

        Assert.IsEmpty(problems, string.Join(" ", problems));
    }

    /// <summary>
    /// Everything the local compose file and a copied development <c>.env</c> would carry across,
    /// reported together so an operator fixes the file in one pass, naming settings and never values.
    /// </summary>
    [TestMethod]
    public void EveryDevelopmentSettingIsNamedTogetherWithoutQuotingAValue()
    {
        var settings = CleanProduction();
        settings["Seed:Enabled"] = "true";
        settings["Database:ApplyMigrationsOnStartup"] = "true";
        settings["Application:PublicBaseUrl"] = "https://localhost:4200";
        settings["Application:PublicOriginAllowlist:1"] = "http://127.0.0.1:4200";
        settings["Messaging:Realtime:AllowedOrigins:0"] = "http://localhost:4200";
        settings["ConnectionStrings:Database"] =
            "Host=db;Database=tbgym;Username=tbgym;Password=s3cret-value;Include Error Detail=true";

        var problems = ProductionSettingsGuard.FindDevelopmentSettings(Configuration(settings));
        var failure = Assert.ThrowsExactly<InvalidOperationException>(
            () => ProductionSettingsGuard.EnsureNoDevelopmentSettings(Configuration(settings)));

        Assert.HasCount(6, problems);
        foreach (var setting in new[]
                 {
                     "Seed:Enabled", "Database:ApplyMigrationsOnStartup", "Application:PublicBaseUrl",
                     "Application:PublicOriginAllowlist", "Messaging:Realtime:AllowedOrigins",
                     "ConnectionStrings:Database",
                 })
        {
            Assert.Contains(setting, failure.Message);
        }

        Assert.DoesNotContain("s3cret-value", failure.Message);
        Assert.DoesNotContain("4200", failure.Message);
    }

    [TestMethod]
    public void EveryLoopbackSpellingIsADevelopmentOrigin()
    {
        foreach (var origin in new[]
                 {
                     "https://localhost", "https://LOCALHOST.", "https://app.localhost", "https://127.0.0.1",
                     "https://127.10.0.1:8443", "https://[::1]", "https://0.0.0.0",
                 })
        {
            var settings = CleanProduction();
            settings["Application:PublicBaseUrl"] = origin;
            Assert.HasCount(
                1,
                ProductionSettingsGuard.FindDevelopmentSettings(Configuration(settings)),
                $"{origin} was accepted as a production origin.");
        }
    }

    [TestMethod]
    public void ParameterLoggingInTheConnectionStringIsRefused()
    {
        var settings = CleanProduction();
        settings["ConnectionStrings:Database"] = UnusedDatabase + ";Log Parameters=true";

        Assert.HasCount(1, ProductionSettingsGuard.FindDevelopmentSettings(Configuration(settings)));
    }

    /// <summary>The real API host refuses to start, before it touches the database.</summary>
    [TestMethod]
    public void AProductionApiRefusesToMigrateOnStartup()
    {
        var settings = CleanProduction();
        settings["Database:ApplyMigrationsOnStartup"] = "true";

        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
        });

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("Database:ApplyMigrationsOnStartup", failure.Message);
    }

    /// <summary>
    /// Tests may lengthen the sensitive-write and routine-write windows, which only makes the limits
    /// stricter. No setting may shorten either below the production minute, which would loosen it.
    /// </summary>
    [TestMethod]
    public void TheWriteWindowsCanOnlyBeLengthened()
    {
        foreach (var key in new[] { "RateLimiting:SensitiveWriteWindowSeconds", "RateLimiting:RoutineWriteWindowSeconds" })
        {
            foreach (var seconds in new[] { "59", "1", "0", "86401" })
            {
                using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
                {
                    builder.UseEnvironment("Development");
                    builder.UseSetting("ConnectionStrings:Database", UnusedDatabase);
                    builder.UseSetting(key, seconds);
                });

                var failure = Assert.ThrowsExactly<InvalidOperationException>(
                    () => factory.CreateClient(),
                    $"A {seconds}-second window was accepted for {key}.");
                Assert.Contains(key, failure.Message);
            }
        }
    }

    /// <summary>The Worker is a second composition root and refuses the same settings.</summary>
    [TestMethod]
    public void TheWorkerRefusesDevelopmentSettingsInProductionOnly()
    {
        var settings = CleanProduction();
        settings["Application:PublicBaseUrl"] = "http://localhost:4200";
        settings["Application:PublicOriginAllowlist:0"] = "http://localhost:4200";

        var failure = Assert.ThrowsExactly<InvalidOperationException>(
            () => new ServiceCollection().AddTbGymNotificationWorkerInfrastructure(
                Configuration(settings), isProduction: true));
        Assert.Contains("Application:PublicBaseUrl", failure.Message);

        // Development keeps its local values; the guard only speaks for Production.
        new ServiceCollection().AddTbGymNotificationWorkerInfrastructure(
            Configuration(settings), isProduction: false, isDevelopment: true);
    }

    [TestMethod]
    public void AReplyToThatIsNotOneAddressRefusesStartup()
    {
        foreach (var replyTo in new[] { "support", "support@", "a@example.com, b@example.com", "a@example.com;b@example.com" })
        {
            var settings = Provider("https://api.resend.com/emails");
            settings["Notifications:Email:Provider:ReplyToAddress"] = replyTo;
            using var services = Worker(settings);

            var failure = Assert.ThrowsExactly<OptionsValidationException>(
                () => services.GetRequiredService<IOptions<NotificationEmailOptions>>().Value,
                $"'{replyTo}' was accepted as a Reply-To address.");
            Assert.Contains("ReplyToAddress must be one email address", string.Join(" ", failure.Failures));
        }

        // A Reply-To beside an adapter that contacts nobody is a contradiction like any other provider value.
        var orphaned = new Dictionary<string, string?>
        {
            ["Notifications:Email:Provider:ReplyToAddress"] = "support@tbgym.test",
        };
        using var none = Worker(orphaned);
        Assert.ThrowsExactly<OptionsValidationException>(
            () => none.GetRequiredService<IOptions<NotificationEmailOptions>>().Value);
    }

    /// <summary>
    /// A compose file passes an unset key through as an empty value. With email off that placeholder
    /// is not a provider configuration; with the provider selected an empty key is still refused.
    /// </summary>
    [TestMethod]
    public void AnEmptyFingerprintPlaceholderCountsOnlyWhenAProviderIsSelected()
    {
        var placeholder = new Dictionary<string, string?>
        {
            ["Notifications:Email:Provider:FingerprintKeyId"] = string.Empty,
            ["Notifications:Email:Provider:FingerprintKeys:key-1"] = string.Empty,
        };
        using (var emailOff = Worker(placeholder))
        {
            Assert.IsFalse(emailOff.GetRequiredService<IOptions<NotificationEmailOptions>>().Value.Provider.IsConfigured);
        }

        var emptyKey = Provider("https://api.resend.com/emails");
        emptyKey["Notifications:Email:Provider:FingerprintKeyId"] = "key-1";
        emptyKey["Notifications:Email:Provider:FingerprintKeys:key-1"] = string.Empty;
        using var providerOn = Worker(emptyKey);
        Assert.Contains(
            "not base64",
            string.Join(" ", Assert.ThrowsExactly<OptionsValidationException>(
                () => providerOn.GetRequiredService<IOptions<NotificationEmailOptions>>().Value).Failures));

        // A real key beside an adapter that contacts nobody is still a contradiction.
        using var realKeyEmailOff = Worker(new Dictionary<string, string?>
        {
            ["Notifications:Email:Provider:FingerprintKeys:key-1"] = FingerprintKey,
        });
        Assert.ThrowsExactly<OptionsValidationException>(
            () => realKeyEmailOff.GetRequiredService<IOptions<NotificationEmailOptions>>().Value);
    }

    /// <summary>
    /// The test email reaches the provider with the configured key, sender and Reply-To, and the
    /// operator is told it was accepted.
    /// </summary>
    [TestMethod]
    public async Task TheTestEmailIsAcceptedAndCarriesTheSupportReplyTo()
    {
        await using var provider = await ProviderHttpDouble.StartAsync();
        var settings = Provider(provider.SendEndpoint);
        settings["Notifications:Email:Provider:ReplyToAddress"] = "support@tbgym.test";
        using var services = Worker(settings);
        using var output = new StringWriter();

        var exitCode = await SendTestEmailCommand.RunAsync(
            services, [SendTestEmailCommand.Name, "owner@tbgym.test"], output);

        Assert.AreEqual(0, exitCode, output.ToString());
        Assert.StartsWith("Sent.", output.ToString());
        var request = provider.Requests.Single();
        Assert.AreEqual("Bearer re_go_live_test_key", request.Authorization);
        Assert.StartsWith("test-email-", request.IdempotencyKey);
        using var body = JsonDocument.Parse(request.Body);
        Assert.AreEqual("owner@tbgym.test", body.RootElement.GetProperty("to")[0].GetString());
        Assert.AreEqual("TB Gym <notifications@mail.tbgym.test>", body.RootElement.GetProperty("from").GetString());
        Assert.AreEqual("support@tbgym.test", body.RootElement.GetProperty("reply_to").GetString());
        Assert.AreEqual("TB Gym test email", body.RootElement.GetProperty("subject").GetString());
    }

    [TestMethod]
    public async Task WithoutASupportAddressNoReplyToIsSent()
    {
        await using var provider = await ProviderHttpDouble.StartAsync();
        using var services = Worker(Provider(provider.SendEndpoint));

        var exitCode = await SendTestEmailCommand.RunAsync(
            services, [SendTestEmailCommand.Name, "owner@tbgym.test"], TextWriter.Null);

        Assert.AreEqual(0, exitCode);
        using var body = JsonDocument.Parse(provider.Requests.Single().Body);
        Assert.IsFalse(body.RootElement.TryGetProperty("reply_to", out _));
    }

    [TestMethod]
    public async Task ARefusedKeyIsExplainedWithoutEchoingIt()
    {
        await using var provider = await ProviderHttpDouble.StartAsync();
        provider.Responder = _ => ProviderResponse.Status((int)HttpStatusCode.Unauthorized);
        using var services = Worker(Provider(provider.SendEndpoint));
        using var output = new StringWriter();

        var exitCode = await SendTestEmailCommand.RunAsync(
            services, [SendTestEmailCommand.Name, "owner@tbgym.test"], output);

        Assert.AreEqual(1, exitCode);
        Assert.Contains("TB_GYM_EMAIL_API_KEY", output.ToString());
        Assert.DoesNotContain("re_go_live_test_key", output.ToString());
    }

    /// <summary>
    /// The Worker's billing sweep resolves the Founding coach badge check and what it reads per space
    /// from the Worker's own composition (notes plan N3a). The integration tests drive the check from the
    /// API host, so a check that leaned on an API-only service would pass them and fail every tick.
    /// </summary>
    [TestMethod]
    public async Task N3aTheWorkerComposesTheFoundingBadgeCheck()
    {
        using var services = Worker([]);
        await using var scope = services.CreateAsyncScope();

        Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Modules.PlatformBilling.IFoundingBadgeCheck>());
        Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Modules.PlatformBilling.IPlatformInvoiceRun>());
        Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.SharedKernel.IMutableTenantContext>());
        Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Infrastructure.Persistence.GymDbContext>());
    }

    /// <summary>
    /// The certificate record's keeping sweep and its settings come from the Worker's own composition, with the
    /// plan's example by default, and the Worker's entry point runs the sweep on its timer (notes plan N4b). The
    /// integration tests drive the sweep from the API host, so a sweep that leaned on an API-only service would pass
    /// them and fail every day.
    /// </summary>
    [TestMethod]
    public async Task N4bTheWorkerComposesTheCertificateKeepingSweep()
    {
        using (var services = Worker([]))
        {
            await using var scope = services.CreateAsyncScope();
            Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Modules.Identity.ICoachCertificateKeepingSweep>());
            Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.SharedKernel.IMutableTenantContext>());
            var settings = scope.ServiceProvider.GetRequiredService<IOptions<TB.Gym.Modules.Identity.CoachCertificateOptions>>().Value;
            Assert.AreEqual(
                (12, true, 86_400),
                (settings.KeepMonthsAfterTakenDown, settings.SweepEnabled, settings.SweepIntervalSeconds));
            Assert.AreEqual(12, settings.KeepingPeriod.Months);
        }

        // Its entry point, on an empty content root so no appsettings file in the test output speaks for it.
        var contentRoot = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"tb-gym-n4b-worker-{Guid.NewGuid():N}")).FullName;
        try
        {
            var builder = TB.Gym.Worker.WorkerProgram.CreateBuilder(
            [
                "--environment", "Development",
                "--contentRoot", contentRoot,
                $"--ConnectionStrings:Database={UnusedDatabase}",
                "--Application:PublicBaseUrl=http://localhost:4200",
            ]);
            Assert.AreEqual(
                1,
                builder.Services.Count(service =>
                    !service.IsKeyedService &&
                    service.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService) &&
                    service.ImplementationType == typeof(TB.Gym.Worker.CoachCertificateKeepingWorker)),
                "The Worker runs the keeping sweep on its timer.");
        }
        finally
        {
            Directory.Delete(contentRoot, recursive: true);
        }
    }

    /// <summary>
    /// The keeping period and the sweep's interval are read when a host starts (notes plan N4b): outside 1 to 120
    /// months, or outside a minute to a day, the API refuses to start and the Worker's composition refuses its
    /// settings, each naming the setting and never quoting its value.
    /// </summary>
    [TestMethod]
    public void N4bACertificateSettingOutsideItsRangeRefusesStartup()
    {
        foreach (var (key, value) in new[]
                 {
                     ("CoachCertificates:KeepMonthsAfterTakenDown", "0"),
                     ("CoachCertificates:KeepMonthsAfterTakenDown", "121"),
                     ("CoachCertificates:SweepIntervalSeconds", "59"),
                     ("CoachCertificates:SweepIntervalSeconds", "86401"),
                 })
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("ConnectionStrings:Database", UnusedDatabase);
                builder.UseSetting(key, value);
            });

            var api = Assert.ThrowsExactly<OptionsValidationException>(
                () => factory.CreateClient(),
                $"The API started with {key} at {value}.");
            Assert.Contains(key, api.Message);

            using var services = Worker(new Dictionary<string, string?> { [key] = value });
            var worker = Assert.ThrowsExactly<OptionsValidationException>(
                () => services.GetRequiredService<IOptions<TB.Gym.Modules.Identity.CoachCertificateOptions>>().Value,
                $"The Worker took {key} at {value}.");
            Assert.Contains(key, worker.Message);

            // A zero is in the range's own words ("1 to 120"), so only the other values show none was quoted.
            if (value != "0")
            {
                Assert.DoesNotContain(value, api.Message);
                Assert.DoesNotContain(value, worker.Message);
            }
        }
    }

    /// <summary>
    /// A certificate setting that is not a number stops both hosts as they compose (notes plan N4b), naming the
    /// setting and never the value, which the configuration binder's own refusal would have quoted.
    /// </summary>
    [TestMethod]
    public void N4bACertificateSettingThatIsNoNumberRefusesStartupWithoutQuotingIt()
    {
        foreach (var (key, value) in new[]
                 {
                     ("CoachCertificates:KeepMonthsAfterTakenDown", "twelve-months"),
                     ("CoachCertificates:SweepIntervalSeconds", "one-day"),
                 })
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("ConnectionStrings:Database", UnusedDatabase);
                builder.UseSetting(key, value);
            });

            var api = Assert.ThrowsExactly<InvalidOperationException>(
                () => factory.CreateClient(),
                $"The API started with {key} at {value}.");
            Assert.Contains(key, api.Message);
            Assert.DoesNotContain(value, api.Message);
            Assert.IsNull(api.InnerException, "The binder's refusal, which quotes the value, is not carried along.");

            var worker = Assert.ThrowsExactly<InvalidOperationException>(
                () => Worker(new Dictionary<string, string?> { [key] = value }).Dispose(),
                $"The Worker composed with {key} at {value}.");
            Assert.Contains(key, worker.Message);
            Assert.DoesNotContain(value, worker.Message);
        }
    }

    /// <summary>
    /// The sweep of house sign-ups never confirmed and its settings come from the Worker's own composition, with
    /// what it needs to empty an account, and the Worker's entry point runs the sweep on its timer (notes plan
    /// N9a1, CLI-025). The integration tests drive the sweep from the API host, so a sweep that leaned on an
    /// API-only service would pass them and fail every hour.
    /// </summary>
    [TestMethod]
    public async Task N9a1TheWorkerComposesTheTraineeSignUpSweep()
    {
        using (var services = Worker([]))
        {
            await using var scope = services.CreateAsyncScope();
            Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Modules.Tenancy.ITraineeSignUpSweep>());
            Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.SharedKernel.IMutableTenantContext>());
            Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Infrastructure.Persistence.GymDbContext>());
            // The sweep empties an account through Identity's own manager, in a scope it makes for each sign-up.
            Assert.IsNotNull(scope.ServiceProvider
                .GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<TB.Gym.Modules.Identity.ApplicationUser>>());
            var settings = scope.ServiceProvider.GetRequiredService<IOptions<TB.Gym.Modules.Tenancy.TraineeSignUpOptions>>().Value;
            Assert.AreEqual(
                (2, true, 3_600),
                (settings.RemoveUnconfirmedAfterDays, settings.SweepEnabled, settings.SweepIntervalSeconds));
        }

        // Its entry point, on an empty content root so no appsettings file in the test output speaks for it.
        var contentRoot = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"tb-gym-n9a1-worker-{Guid.NewGuid():N}")).FullName;
        try
        {
            var builder = TB.Gym.Worker.WorkerProgram.CreateBuilder(
            [
                "--environment", "Development",
                "--contentRoot", contentRoot,
                $"--ConnectionStrings:Database={UnusedDatabase}",
                "--Application:PublicBaseUrl=http://localhost:4200",
            ]);
            Assert.AreEqual(
                1,
                builder.Services.Count(service =>
                    !service.IsKeyedService &&
                    service.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService) &&
                    service.ImplementationType == typeof(TB.Gym.Worker.TraineeSignUpSweepWorker)),
                "The Worker runs the sign-up sweep on its timer.");
        }
        finally
        {
            Directory.Delete(contentRoot, recursive: true);
        }
    }

    /// <summary>
    /// Free's sweep comes from the Worker's own composition too (notes plan N9b1, SUB-019), with the writer that makes
    /// Free's rows, and the sign-up sweep beside it: the Worker's timer runs both on one tick. The integration tests
    /// drive Free's sweep from the API host, so a sweep that leaned on an API-only service (the commercial service, the
    /// coach scope, the current user) would pass them and fail in the Worker every hour.
    /// </summary>
    [TestMethod]
    public async Task N9b1FreeTheWorkerComposesTheFreePlanSweepBesideTheSignUpSweep()
    {
        using var services = Worker([]);
        await using var scope = services.CreateAsyncScope();
        Assert.IsInstanceOfType<TB.Gym.Infrastructure.Application.HouseFreePlanRenewal>(
            scope.ServiceProvider.GetRequiredService<TB.Gym.Modules.Subscriptions.IHouseFreePlanRenewal>());
        Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Infrastructure.Application.HouseFreePlan>());
        Assert.IsNotNull(scope.ServiceProvider.GetRequiredService<TB.Gym.Modules.Tenancy.ITraineeSignUpSweep>());
    }

    /// <summary>
    /// The days a sign-up may wait and the sweep's interval are read when a host starts (notes plan N9a1): outside 1
    /// to 90 days, or outside a minute to a day, the API refuses to start and the Worker's composition refuses its
    /// settings, each naming the setting and never quoting its value.
    /// </summary>
    [TestMethod]
    public void N9a1ATraineeSignUpSettingOutsideItsRangeRefusesStartup()
    {
        foreach (var (key, value) in new[]
                 {
                     ("TraineeSignUps:RemoveUnconfirmedAfterDays", "0"),
                     ("TraineeSignUps:RemoveUnconfirmedAfterDays", "91"),
                     ("TraineeSignUps:RemoveUnconfirmedAfterDays", "-3"),
                     ("TraineeSignUps:RemoveUnconfirmedAfterDays", "365"),
                     ("TraineeSignUps:SweepIntervalSeconds", "59"),
                     ("TraineeSignUps:SweepIntervalSeconds", "86401"),
                 })
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("ConnectionStrings:Database", UnusedDatabase);
                builder.UseSetting(key, value);
            });

            var api = Assert.ThrowsExactly<OptionsValidationException>(
                () => factory.CreateClient(),
                $"The API started with {key} at {value}.");
            Assert.Contains(key, api.Message);

            using var services = Worker(new Dictionary<string, string?> { [key] = value });
            var worker = Assert.ThrowsExactly<OptionsValidationException>(
                () => services.GetRequiredService<IOptions<TB.Gym.Modules.Tenancy.TraineeSignUpOptions>>().Value,
                $"The Worker took {key} at {value}.");
            Assert.Contains(key, worker.Message);

            // A zero is in the range's own words ("1 to 90"), so only the other values show none was quoted.
            if (value != "0")
            {
                Assert.DoesNotContain(value, api.Message);
                Assert.DoesNotContain(value, worker.Message);
            }
        }
    }

    /// <summary>
    /// A sign-up setting that is not a number, or a switch that is neither true nor false, stops both hosts as they
    /// compose (notes plan N9a1), naming the setting and never the value, which the configuration binder's own
    /// refusal would have quoted.
    /// </summary>
    [TestMethod]
    public void N9a1ATraineeSignUpSettingThatIsNoNumberRefusesStartupWithoutQuotingIt()
    {
        foreach (var (key, value) in new[]
                 {
                     ("TraineeSignUps:RemoveUnconfirmedAfterDays", "a-fortnight"),
                     ("TraineeSignUps:RemoveUnconfirmedAfterDays", "2.5"),
                     ("TraineeSignUps:SweepIntervalSeconds", "hourly"),
                     ("TraineeSignUps:SweepEnabled", "perhaps"),
                 })
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("ConnectionStrings:Database", UnusedDatabase);
                builder.UseSetting(key, value);
            });

            var api = Assert.ThrowsExactly<InvalidOperationException>(
                () => factory.CreateClient(),
                $"The API started with {key} at {value}.");
            Assert.Contains(key, api.Message);
            Assert.DoesNotContain(value, api.Message);
            Assert.IsNull(api.InnerException, "The binder's refusal, which quotes the value, is not carried along.");

            var worker = Assert.ThrowsExactly<InvalidOperationException>(
                () => Worker(new Dictionary<string, string?> { [key] = value }).Dispose(),
                $"The Worker composed with {key} at {value}.");
            Assert.Contains(key, worker.Message);
            Assert.DoesNotContain(value, worker.Message);
        }
    }

    [TestMethod]
    public async Task WithoutAProviderOrAnAddressNothingIsSent()
    {
        using var noProvider = Worker([]);
        using var output = new StringWriter();

        Assert.AreEqual(2, await SendTestEmailCommand.RunAsync(
            noProvider, [SendTestEmailCommand.Name, "owner@tbgym.test"], output));
        Assert.Contains("Email is not set up", output.ToString());

        await using var provider = await ProviderHttpDouble.StartAsync();
        using var services = Worker(Provider(provider.SendEndpoint));
        foreach (var args in new[]
                 {
                     new[] { SendTestEmailCommand.Name },
                     [SendTestEmailCommand.Name, "not-an-address"],
                     [SendTestEmailCommand.Name, "a@tbgym.test", "b@tbgym.test"],
                 })
        {
            Assert.AreEqual(2, await SendTestEmailCommand.RunAsync(services, args, TextWriter.Null));
        }

        Assert.IsEmpty(provider.Requests);
    }

    /// <summary>A Production configuration with nothing development-shaped in it.</summary>
    private static Dictionary<string, string?> CleanProduction() => new()
    {
        ["ConnectionStrings:Database"] = UnusedDatabase,
        ["Database:ApplyMigrationsOnStartup"] = "false",
        ["Seed:Enabled"] = "false",
        ["Application:PublicBaseUrl"] = "https://app.tbgym.test",
        ["Application:PublicOriginAllowlist:0"] = "https://app.tbgym.test",
        ["Messaging:Realtime:AllowedOrigins:0"] = "https://app.tbgym.test",
        ["DataProtection:KeyPath"] = Path.Combine(Path.GetTempPath(), "tb-gym-go-live-keys"),
    };

    private static Dictionary<string, string?> Provider(string endpoint) => new()
    {
        ["Notifications:Email:Enabled"] = "true",
        ["Notifications:Email:Adapter"] = NotificationEmailAdapters.Resend,
        ["Notifications:Email:Provider:Endpoint"] = endpoint,
        ["Notifications:Email:Provider:ApiKey"] = "re_go_live_test_key",
        ["Notifications:Email:Provider:FromAddress"] = "TB Gym <notifications@mail.tbgym.test>",
        ["Notifications:Email:Provider:WebhookSigningSecret"] = SigningSecret,
        ["Notifications:Email:Provider:FingerprintKeyId"] = "go-live",
        ["Notifications:Email:Provider:FingerprintKeys:go-live"] = FingerprintKey,
    };

    /// <summary>
    /// The Worker's composition, which registers email exactly as the API does, plus the
    /// configuration the API host would also provide.
    /// </summary>
    private static ServiceProvider Worker(Dictionary<string, string?> email)
    {
        var configuration = Configuration(new Dictionary<string, string?>(email)
        {
            ["ConnectionStrings:Database"] = UnusedDatabase,
            ["Application:PublicBaseUrl"] = "http://localhost:4200",
        });
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddTbGymNotificationWorkerInfrastructure(configuration, isProduction: false, isDevelopment: true);
        return services.BuildServiceProvider(validateScopes: true);
    }

    private static IConfiguration Configuration(Dictionary<string, string?> settings) =>
        new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
}
