using Amazon.Runtime;
using Amazon.S3;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure;

/// <summary>
/// Media provider composition: which object store this deployment writes to, and which scanner
/// decides whether stored bytes may be published.
/// </summary>
/// <remarks>
/// <para>
/// Selection is explicit and its failures are loud. Naming a provider with a configuration it cannot
/// use refuses startup, because the alternative is a deployment that looks composed, accepts uploads
/// and fails every one of them at the moment a coach tries to add a photo. Naming nothing keeps the
/// Phase 6B-4A behaviour exactly: the fail-closed adapters, refused uploads, and a Degraded media
/// entry on <c>/health/ready</c> rather than an unhealthy API.
/// </para>
/// <para>
/// Both provider types live here and nowhere else. The Media module owns <c>IObjectStorage</c> and
/// <c>IMediaScanner</c> and has never heard of S3, R2 or clamd; an architecture test holds that
/// boundary rather than leaving it to habit.
/// </para>
/// </remarks>
public static class MediaProviderDependencyInjection
{
    private const string LocalAdapter = "Local";
    private const string R2Adapter = "R2";
    private const string DevelopmentScanner = "Development";
    private const string ClamAvScanner = "ClamAv";
    private const string NoAdapter = "None";

    internal static IServiceCollection AddTbGymMediaProviders(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        AddObjectStorage(services, configuration, environment);
        AddScanner(services, configuration, environment);
        return services;
    }

    /// <summary>
    /// The S3 client configuration for one R2 bucket, derived entirely from validated options.
    /// </summary>
    /// <remarks>
    /// The endpoint is the account's own EU-jurisdiction host and the signing region is R2's fixed
    /// <c>auto</c>; neither is configurable, so no setting can redirect this deployment's credential
    /// to a host somebody else chose. Path-style addressing is what R2 serves on that endpoint.
    /// <para>
    /// Checksum behaviour is deliberately reduced to what R2 implements. The SDK's default
    /// trailing-checksum flavours are not accepted there, and the integrity this repository actually
    /// relies on is the SHA-256 it computes over the exact bytes it transmitted — not a provider
    /// header and never an <c>ETag</c>.
    /// </para>
    /// </remarks>
    internal static AmazonS3Config CreateS3Config(R2StorageOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return new AmazonS3Config
        {
            ServiceURL = options.ServiceUrl,
            AuthenticationRegion = R2StorageOptions.SigningRegion,
            ForcePathStyle = true,
            Timeout = TimeSpan.FromSeconds(options.OperationTimeoutSeconds),
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        };
    }

    private static void AddObjectStorage(
        IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        var adapter = configuration["Media:StorageAdapter"]?.Trim();
        adapter = string.IsNullOrEmpty(adapter)
            ? (environment.IsDevelopment() ? LocalAdapter : NoAdapter)
            : adapter;

        if (string.Equals(adapter, LocalAdapter, StringComparison.OrdinalIgnoreCase))
        {
            if (!environment.IsDevelopment())
            {
                throw new InvalidOperationException(
                    "Local media storage may be selected only in Development.");
            }

            services.AddSingleton<IObjectStorage, LocalObjectStorage>();
            return;
        }

        if (string.Equals(adapter, R2Adapter, StringComparison.OrdinalIgnoreCase))
        {
            var options = ReadValidated<R2StorageOptions>(
                configuration,
                R2StorageOptions.SectionName,
                candidate => candidate.Validate());
            services.AddSingleton(options);
            services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client(
                new BasicAWSCredentials(options.AccessKeyId.Trim(), options.SecretAccessKey.Trim()),
                CreateS3Config(options)));
            services.AddSingleton<IObjectStorage>(provider => new R2ObjectStorage(
                provider.GetRequiredService<IAmazonS3>(),
                options,
                provider.GetRequiredService<ILogger<R2ObjectStorage>>()));
            return;
        }

        if (string.Equals(adapter, NoAdapter, StringComparison.OrdinalIgnoreCase))
        {
            services.AddSingleton<IObjectStorage, UnavailableObjectStorage>();
            return;
        }

        throw new InvalidOperationException("Media:StorageAdapter is not supported.");
    }

    private static void AddScanner(
        IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        var adapter = configuration["Media:ScannerAdapter"]?.Trim();
        adapter = string.IsNullOrEmpty(adapter)
            ? (environment.IsDevelopment() ? DevelopmentScanner : NoAdapter)
            : adapter;

        if (string.Equals(adapter, DevelopmentScanner, StringComparison.OrdinalIgnoreCase))
        {
            if (!environment.IsDevelopment())
            {
                // The development scanner allows every file. Composing it anywhere else would turn
                // the fail-closed rule into a fail-open one with no visible sign that it had.
                throw new InvalidOperationException(
                    "The development media scanner may be selected only in Development.");
            }

            services.AddSingleton<IMediaScanner, DevelopmentMediaScanner>();
            return;
        }

        if (string.Equals(adapter, ClamAvScanner, StringComparison.OrdinalIgnoreCase))
        {
            var options = ReadValidated<ClamAvScannerOptions>(
                configuration,
                ClamAvScannerOptions.SectionName,
                candidate => candidate.Validate());
            services.AddSingleton(options);
            services.AddSingleton<IMediaScanner>(provider => new ClamAvMediaScanner(
                provider.GetRequiredService<IObjectStorage>(),
                options,
                provider.GetRequiredService<ILogger<ClamAvMediaScanner>>()));
            return;
        }

        if (string.Equals(adapter, NoAdapter, StringComparison.OrdinalIgnoreCase))
        {
            services.AddSingleton<IMediaScanner, UnavailableMediaScanner>();
            return;
        }

        throw new InvalidOperationException("Media:ScannerAdapter is not supported.");
    }

    /// <summary>
    /// Binds one provider section and refuses startup on the first broken rule.
    /// </summary>
    /// <remarks>
    /// Validated here rather than only through <c>ValidateOnStart</c> because the adapter is
    /// constructed from these values: a client built on an unusable endpoint or a missing credential
    /// would be a registered, resolvable, permanently failing dependency. The message names the
    /// setting and never quotes its value.
    /// </remarks>
    private static TOptions ReadValidated<TOptions>(
        IConfiguration configuration,
        string sectionName,
        Func<TOptions, string?> validate)
        where TOptions : class, new()
    {
        var options = new TOptions();
        configuration.GetSection(sectionName).Bind(options);
        var failure = validate(options);
        return failure is null
            ? options
            : throw new InvalidOperationException(failure);
    }
}
