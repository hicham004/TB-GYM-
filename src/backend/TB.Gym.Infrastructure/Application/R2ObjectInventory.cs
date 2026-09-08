using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Read-only enumeration of the production bucket, for reconciling stored objects against the rows
/// that own them.
/// </summary>
/// <remarks>
/// <para>
/// A separate adapter from <see cref="R2ObjectStorage"/> rather than a second interface on it. The
/// reconciliation service is composed with this type and only this type, so there is no object in
/// its constructor that can write or delete — not a discipline, an absence. Sharing one class would
/// have made a cast enough to reach deletion.
/// </para>
/// <para>
/// It serves exactly one location, and it never names a bucket, an endpoint, a key or a provider
/// message in a log. A list request is the only Class A call reconciliation makes; a stat is Class B,
/// which is why the owner pass probes rows one at a time rather than materialising the whole
/// key set.
/// </para>
/// </remarks>
internal sealed class R2ObjectInventory(
    IAmazonS3 client,
    R2StorageOptions options,
    ILogger<R2ObjectInventory> logger)
    : IObjectInventory
{
    /// <summary>
    /// One line per failed provider operation, carrying the operation and a stable code and nothing
    /// else — the same rule the storage adapter follows, for the same reason: a provider message
    /// routinely quotes the request URL, and that embeds an object key.
    /// </summary>
    private static readonly Action<ILogger, string, string, Exception?> LogProviderFailure =
        LoggerMessage.Define<string, string>(
            LogLevel.Warning,
            new EventId(5520, "MediaObjectInventoryProviderFailure"),
            "A media object-inventory {Operation} failed against the configured provider: {FailureCode}.");

    public string ReconciledLocation => R2StorageOptions.LocationName;

    public bool IsAvailable => true;

    public async Task<ObjectInventoryPage> ListAsync(
        string? cursor,
        int maximumKeys,
        CancellationToken cancellationToken)
    {
        if (maximumKeys is <= 0 or > MediaInventoryPolicy.PageSize)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumKeys));
        }

        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            var response = await client.ListObjectsV2Async(
                new ListObjectsV2Request
                {
                    BucketName = options.BucketName,
                    MaxKeys = maximumKeys,
                    ContinuationToken = cursor,
                },
                cancellationToken);

            // Truncation is the provider's answer, never a count: a page may carry fewer entries
            // than were asked for and still have more behind it, so counting to the page size would
            // stop an enumeration early and call the remainder verified. A response that does not
            // say is not an untruncated one — it is a response this adapter cannot read.
            if (response.IsTruncated is not { } hasMore)
            {
                return FailedPage(MediaInventoryFailureCodes.ListMetadataMissing, "list");
            }

            var entries = new List<ObjectInventoryEntry>(response.S3Objects?.Count ?? 0);
            foreach (var stored in response.S3Objects ?? [])
            {
                // A key, a length and a modification instant are what every decision downstream is
                // made of, and each of them fails open if it is invented: a missing length becomes a
                // length mismatch against the row that owns the object, and a missing instant
                // becomes an object old enough to be called an orphan nobody owns. A listing that
                // does not carry them has not described this object, so the page has not been read.
                if (string.IsNullOrEmpty(stored.Key) ||
                    stored.Size is not { } size ||
                    stored.LastModified is not { } modified)
                {
                    return FailedPage(MediaInventoryFailureCodes.ListMetadataMissing, "list");
                }

                entries.Add(new ObjectInventoryEntry(stored.Key, size, Utc(modified)));
            }

            // Reported exactly as the store answered. Whether "more behind it, and here is no cursor
            // to follow" is usable is the reconciliation pass's decision, and it treats it as a
            // failure rather than as the end of the enumeration.
            return new ObjectInventoryPage(
                ObjectStorageOperationStatus.Success,
                entries,
                hasMore ? response.NextContinuationToken : null,
                hasMore);
        }
        catch (AmazonS3Exception exception)
        {
            return new ObjectInventoryPage(
                ObjectStorageOperationStatus.Failed,
                [],
                FailureCode: Classify(exception, "list"));
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or TimeoutException)
        {
            return FailedPage("storage_provider_unavailable", "list");
        }
    }

    /// <summary>
    /// The instant a listing reports, read as the UTC the protocol defines it to be. An unspecified
    /// kind is not a local time here, and treating it as one would move an object across the
    /// unowned-object grace window by the deployment's own offset.
    /// </summary>
    private static DateTimeOffset Utc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => new DateTimeOffset(value, TimeSpan.Zero),
        DateTimeKind.Local => new DateTimeOffset(value).ToUniversalTime(),
        _ => new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc), TimeSpan.Zero),
    };

    public async Task<ObjectStatResult> StatAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(locator);
        cancellationToken.ThrowIfCancellationRequested();
        if (!string.Equals(locator.Location, ReconciledLocation, StringComparison.Ordinal))
        {
            return new ObjectStatResult(
                ObjectStorageOperationStatus.Failed,
                FailureCode: "storage_location_unavailable");
        }

        try
        {
            var metadata = await client.GetObjectMetadataAsync(
                options.BucketName,
                locator.ObjectKey,
                cancellationToken);
            return new ObjectStatResult(ObjectStorageOperationStatus.Success, metadata.ContentLength);
        }
        catch (AmazonS3Exception exception) when (IsMissing(exception))
        {
            // The store answered, and its answer was "no such object". This is the only path that
            // may report absence: a provider that did not answer has reported nothing at all.
            return new ObjectStatResult(ObjectStorageOperationStatus.NotFound);
        }
        catch (AmazonS3Exception exception)
        {
            return new ObjectStatResult(
                ObjectStorageOperationStatus.Failed,
                FailureCode: Classify(exception, "stat"));
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or TimeoutException)
        {
            LogProviderFailure(logger, "stat", "storage_provider_unavailable", null);
            return new ObjectStatResult(
                ObjectStorageOperationStatus.Failed,
                FailureCode: "storage_provider_unavailable");
        }
    }

    private ObjectInventoryPage FailedPage(string code, string operation)
    {
        LogProviderFailure(logger, operation, code, null);
        return new ObjectInventoryPage(ObjectStorageOperationStatus.Failed, [], FailureCode: code);
    }

    private static bool IsMissing(AmazonS3Exception exception) =>
        exception.StatusCode == HttpStatusCode.NotFound ||
        string.Equals(exception.ErrorCode, "NoSuchKey", StringComparison.Ordinal);

    private string Classify(AmazonS3Exception exception, string operation)
    {
        var code = exception.StatusCode switch
        {
            HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized => "storage_access_denied",
            _ => "storage_provider_error",
        };
        LogProviderFailure(logger, operation, code, null);
        return code;
    }
}

/// <summary>
/// The inventory of a deployment that has no enumerable object store: the local development adapter,
/// or no adapter at all.
/// </summary>
/// <remarks>
/// Registered rather than omitted so that the sweep can resolve it and decide to do nothing, instead
/// of a missing registration turning a background tick into a startup failure. Reconciliation is
/// meaningless without a store to enumerate, and pretending otherwise would produce a run that
/// reported a clean location it had never looked at.
/// </remarks>
internal sealed class UnavailableObjectInventory : IObjectInventory
{
    private const string FailureCode = "storage_inventory_not_configured";

    public string ReconciledLocation => MediaStorageLocations.Unavailable;

    public bool IsAvailable => false;

    public Task<ObjectInventoryPage> ListAsync(
        string? cursor,
        int maximumKeys,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ObjectInventoryPage(
            ObjectStorageOperationStatus.Failed,
            [],
            FailureCode: FailureCode));
    }

    public Task<ObjectStatResult> StatAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ObjectStatResult(
            ObjectStorageOperationStatus.Failed,
            FailureCode: FailureCode));
    }
}
