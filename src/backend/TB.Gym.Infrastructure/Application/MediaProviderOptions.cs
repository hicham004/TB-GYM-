namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The private Cloudflare R2 bucket this deployment writes media to, reached over the S3 protocol.
/// </summary>
/// <remarks>
/// <para>
/// The durable location <see cref="LocationName"/> permanently binds one account, one jurisdiction
/// and one bucket. It is written onto every object this adapter stores and is what a later read or
/// purge resolves, so repointing these settings at a different account or bucket while keeping the
/// location name would make historical locators name bytes that are not theirs. Changing them is a
/// migration, never a configuration edit; nothing in this process can detect the substitution, which
/// is exactly why it is stated here and in ADR 0024 rather than assumed.
/// </para>
/// <para>
/// The endpoint and region are derived, not configured. A bucket in the EU jurisdiction is addressed
/// through the account's own EU endpoint, and R2 signs with the fixed region <c>auto</c>; offering
/// either as a setting would offer a way to send this deployment's credential to a host somebody
/// else chose.
/// </para>
/// </remarks>
internal sealed class R2StorageOptions
{
    public const string SectionName = "Media:R2";

    /// <summary>The one durable storage location this adapter serves.</summary>
    public const string LocationName = "r2-eu-v1";

    /// <summary>The only jurisdiction this phase supports, and the one the location name asserts.</summary>
    public const string EuJurisdiction = "eu";

    /// <summary>R2 signs every request with this fixed region rather than a geographic one.</summary>
    public const string SigningRegion = "auto";

    /// <summary>
    /// One multipart part, and the largest buffer one upload holds. Eight mebibytes keeps a 500 MiB
    /// video inside 63 sequential parts — far below the 10 000-part ceiling — while bounding the
    /// memory one concurrent upload can occupy, which a part size chosen for throughput alone would
    /// not.
    /// </summary>
    public const int PartSizeBytes = 8 * 1024 * 1024;

    /// <summary>The Cloudflare account that owns the bucket. A 32-character hexadecimal id.</summary>
    public string AccountId { get; set; } = string.Empty;

    /// <summary>The private bucket. It is never public and never fronted by a CDN.</summary>
    public string BucketName { get; set; } = string.Empty;

    /// <summary>
    /// A bucket-scoped Object Read and Write credential, supplied by environment or secret store.
    /// It is never logged, never returned in an error and never written to a durable row.
    /// </summary>
    public string AccessKeyId { get; set; } = string.Empty;

    public string SecretAccessKey { get; set; } = string.Empty;

    /// <summary>
    /// Declared rather than assumed, so a deployment that means to use a different jurisdiction
    /// fails to start instead of silently writing EU-named locators against another region.
    /// </summary>
    public string Jurisdiction { get; set; } = EuJurisdiction;

    /// <summary>
    /// Bounds one provider HTTP exchange — a part upload, a metadata read, a delete, the response
    /// headers of a read. It does not bound streaming a 500 MiB body to a caller, which the
    /// request's own cancellation owns.
    /// </summary>
    public int OperationTimeoutSeconds { get; set; } = 60;

    /// <summary>Bounds the readiness probe, which must never hold up a health endpoint.</summary>
    public int ProbeTimeoutSeconds { get; set; } = 5;

    /// <summary>
    /// One compensating abort of an interrupted multipart upload, on a token independent of the
    /// request's. A cancelled request must still clean up the parts it created.
    /// </summary>
    public int AbortTimeoutSeconds { get; set; } = 30;

    public string ServiceUrl =>
        $"https://{AccountId.Trim().ToLowerInvariant()}.{EuJurisdiction}.r2.cloudflarestorage.com";

    /// <summary>
    /// The first broken rule, naming the setting and never quoting its value: a refused startup is
    /// printed to a console and shipped to a log aggregator, and a credential in either is a
    /// credential in both.
    /// </summary>
    public string? Validate()
    {
        var accountId = AccountId?.Trim() ?? string.Empty;
        if (accountId.Length != 32 || !accountId.All(Uri.IsHexDigit))
        {
            return $"{SectionName}:AccountId must be a 32-character hexadecimal Cloudflare account id.";
        }

        var bucket = BucketName?.Trim() ?? string.Empty;
        if (bucket.Length is < 3 or > 63 ||
            !char.IsAsciiLetterOrDigit(bucket[0]) ||
            !char.IsAsciiLetterOrDigit(bucket[^1]) ||
            !bucket.All(character =>
                char.IsAsciiDigit(character) || char.IsAsciiLetterLower(character) || character is '-'))
        {
            return $"{SectionName}:BucketName must be a lower-case bucket name of 3 to 63 characters.";
        }

        if (!string.Equals(Jurisdiction?.Trim(), EuJurisdiction, StringComparison.OrdinalIgnoreCase))
        {
            return $"{SectionName}:Jurisdiction must be {EuJurisdiction}; the {LocationName} location asserts it.";
        }

        if (string.IsNullOrWhiteSpace(AccessKeyId) || AccessKeyId.Trim().Length is < 16 or > 128)
        {
            return $"{SectionName}:AccessKeyId is missing or not a bucket-scoped R2 access key id.";
        }

        if (string.IsNullOrWhiteSpace(SecretAccessKey) || SecretAccessKey.Trim().Length is < 16 or > 256)
        {
            return $"{SectionName}:SecretAccessKey is missing or not an R2 secret access key.";
        }

        if (OperationTimeoutSeconds is < 5 or > 600)
        {
            return $"{SectionName}:OperationTimeoutSeconds must be between 5 and 600 seconds.";
        }

        if (ProbeTimeoutSeconds is < 1 or > 30)
        {
            return $"{SectionName}:ProbeTimeoutSeconds must be between 1 and 30 seconds.";
        }

        return AbortTimeoutSeconds is < 1 or > 120
            ? $"{SectionName}:AbortTimeoutSeconds must be between 1 and 120 seconds."
            : null;
    }
}

/// <summary>
/// The private ClamAV <c>clamd</c> this deployment scans stored bytes with, over its INSTREAM
/// protocol on a network nobody outside the deployment can reach.
/// </summary>
/// <remarks>
/// There is no credential here, and that is the point: <c>clamd</c> has no authentication of its
/// own, so port 3310 belongs to a private network and never to a published one. The settings that
/// matter to correctness — the byte limits that decide whether a 500 MiB video can be scanned at
/// all — live in the daemon's own configuration and are asserted in <c>compose.yaml</c>, because a
/// file that exceeds <c>StreamMaxLength</c> is answered with an error and never with a clean verdict.
/// </remarks>
internal sealed class ClamAvScannerOptions
{
    public const string SectionName = "Media:ClamAv";

    /// <summary>The stable scanner identity persisted on scan evidence.</summary>
    public const string ScannerKey = "ClamAV-clamd-instream";

    /// <summary>
    /// One INSTREAM chunk. Small enough that a refusal reaches us within a chunk or two of the
    /// signature that caused it, large enough that a 500 MiB video is not eight thousand writes.
    /// </summary>
    public const int ChunkBytes = 64 * 1024;

    public string Host { get; set; } = string.Empty;

    public int Port { get; set; } = 3310;

    public int ConnectTimeoutSeconds { get; set; } = 5;

    /// <summary>
    /// Bounds one whole scan: the stream out, the daemon's own work and the reply back. A 500 MiB
    /// video over a container network plus a full engine pass is minutes, not seconds, so the
    /// default is generous; what matters is that it is bounded, because an unbounded scan holds an
    /// upload request open for ever.
    /// </summary>
    public int ScanTimeoutSeconds { get; set; } = 300;

    /// <summary>Bounds the readiness PING, which must never hold up a health endpoint.</summary>
    public int ProbeTimeoutSeconds { get; set; } = 5;

    /// <summary>
    /// How long a resolved engine/signature version is reused. The version is persisted as evidence,
    /// so it is re-read often enough that a signature-database update is reflected in what the next
    /// scans claim, and rarely enough that it is not a second connection per upload.
    /// </summary>
    public int VersionRefreshMinutes { get; set; } = 60;

    public string? Validate()
    {
        var host = Host?.Trim() ?? string.Empty;
        if (host.Length is 0 or > 253 ||
            !host.All(character =>
                char.IsAsciiLetterOrDigit(character) || character is '-' or '.' or '_' or ':'))
        {
            return $"{SectionName}:Host must be the private host name or address of a clamd instance.";
        }

        if (Port is < 1 or > 65535)
        {
            return $"{SectionName}:Port must be between 1 and 65535.";
        }

        if (ConnectTimeoutSeconds is < 1 or > 60)
        {
            return $"{SectionName}:ConnectTimeoutSeconds must be between 1 and 60 seconds.";
        }

        if (ScanTimeoutSeconds is < 5 or > 1800)
        {
            return $"{SectionName}:ScanTimeoutSeconds must be between 5 and 1800 seconds.";
        }

        if (ProbeTimeoutSeconds is < 1 or > 30)
        {
            return $"{SectionName}:ProbeTimeoutSeconds must be between 1 and 30 seconds.";
        }

        return VersionRefreshMinutes is < 1 or > 1440
            ? $"{SectionName}:VersionRefreshMinutes must be between 1 and 1440 minutes."
            : null;
    }
}

/// <summary>
/// A bounded liveness question a composed media dependency can answer for the readiness endpoint.
/// </summary>
/// <remarks>
/// Deliberately an Infrastructure-only interface. <c>IObjectStorage</c> and <c>IMediaScanner</c> are
/// the Media module's ports and describe what the application does with media; whether a particular
/// provider's socket answers today is an operational fact about an adapter, and putting it on the
/// module's port would make every future adapter owe an answer to a question only some of them have.
/// </remarks>
internal interface IMediaDependencyProbe
{
    /// <summary>
    /// Answers whether the dependency responded. It never throws, never names a bucket, host, key
    /// or credential, and is bounded by the adapter's own probe timeout.
    /// </summary>
    Task<bool> ProbeAsync(CancellationToken cancellationToken);
}
