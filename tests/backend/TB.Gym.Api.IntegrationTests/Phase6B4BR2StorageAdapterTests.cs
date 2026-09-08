using System.Net;
using System.Security.Cryptography;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.Extensions.Logging.Abstractions;
using TB.Gym.Infrastructure;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The R2 object-storage adapter, against a local bucket that speaks the same protocol.
/// </summary>
[TestClass]
public sealed class Phase6B4BR2StorageAdapterTests : IDisposable
{
    private static readonly Guid Tenant = Guid.Parse("11111111-2222-3333-4444-555555555555");

    private FakeS3Bucket bucket = null!;
    private AmazonS3Client client = null!;
    private R2StorageOptions options = null!;
    private R2ObjectStorage storage = null!;

    [TestInitialize]
    public void Initialize()
    {
        bucket = new FakeS3Bucket();
        options = ValidOptions();
        var config = MediaProviderDependencyInjection.CreateS3Config(options);
        config.HttpClientFactory = new FakeS3HttpClientFactory(bucket);
        // Deterministic failure assertions: a retried 500 would arrive as the same exception three
        // requests later and make the recorded request list depend on the SDK's backoff.
        config.MaxErrorRetry = 0;
        client = new AmazonS3Client(
            new BasicAWSCredentials(options.AccessKeyId, options.SecretAccessKey),
            config);
        storage = new R2ObjectStorage(client, options, NullLogger<R2ObjectStorage>.Instance);
    }

    public void Dispose() => client.Dispose();

    internal static R2StorageOptions ValidOptions() => new()
    {
        AccountId = "0123456789abcdef0123456789abcdef",
        BucketName = "tb-gym-media",
        AccessKeyId = "0123456789abcdef0123456789abcdef",
        SecretAccessKey = "0123456789abcdef0123456789abcdef0123456789abcdef",
    };

    [TestMethod]
    public void TheEndpointAndRegionAreDerivedFromTheAccountAndJurisdiction()
    {
        var config = MediaProviderDependencyInjection.CreateS3Config(ValidOptions());

        Assert.AreEqual(
            // The SDK normalizes the configured endpoint with a trailing separator.
            "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com/",
            config.ServiceURL);
        Assert.AreEqual("auto", config.AuthenticationRegion);
        Assert.IsTrue(config.ForcePathStyle, "R2's account endpoint serves path-style addressing.");
        Assert.AreEqual(RequestChecksumCalculation.WHEN_REQUIRED, config.RequestChecksumCalculation);
        Assert.AreEqual(ResponseChecksumValidation.WHEN_REQUIRED, config.ResponseChecksumValidation);
        Assert.AreEqual(
            "r2-eu-v1",
            storage.WriteLocation,
            "The location name is the durable identity of every object already stored under it.");
    }

    [TestMethod]
    public async Task ASmallObjectIsStoredInOneRequestWithAHashOverExactlyTheStoredBytes()
    {
        var content = RandomNumberGenerator.GetBytes(64 * 1024);
        var locator = LocatorFor("small");

        var result = await storage.PutAsync(Upload(locator, content), CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Success, result.Status);
        var stored = result.StoredObject!;
        Assert.AreEqual(content.Length, stored.Length);
        Assert.AreEqual(Sha256Of(content), stored.Sha256);
        CollectionAssert.AreEqual(content[..16], stored.Signature);
        CollectionAssert.AreEqual(content, bucket[locator.ObjectKey]);
        Assert.IsFalse(
            bucket.RecordedRequests.Any(request => request.Query.Contains("uploads", StringComparison.Ordinal)),
            "A single-part object started a multipart upload.");
        Assert.AreEqual("r2-eu-v1", stored.Locator.Location);
    }

    [TestMethod]
    public async Task ALargeNonSeekableStreamIsStoredAsSequentialPartsAndHashedOverTheBytesSent()
    {
        var content = RandomNumberGenerator.GetBytes((R2StorageOptions.PartSizeBytes * 2) + 4321);
        var locator = LocatorFor("large");

        var result = await storage.PutAsync(
            Upload(locator, content, seekable: false),
            CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Success, result.Status);
        var stored = result.StoredObject!;
        Assert.AreEqual(content.Length, stored.Length);
        Assert.AreEqual(Sha256Of(content), stored.Sha256);
        CollectionAssert.AreEqual(content, bucket[locator.ObjectKey]);

        var parts = bucket.RecordedRequests
            .Where(request => request.Query.Contains("partNumber", StringComparison.Ordinal))
            .ToArray();
        Assert.HasCount(3, parts, "The object should have been sent as three sequential parts.");
        Assert.HasCount(R2StorageOptions.PartSizeBytes, parts[0].Body);
        Assert.HasCount(R2StorageOptions.PartSizeBytes, parts[1].Body);
        Assert.HasCount(4321, parts[2].Body);
        Assert.IsEmpty(bucket.AbortedUploads, "A completed upload was also aborted.");
    }

    /// <summary>
    /// The provider's <c>ETag</c> is not the content hash and is never used as one, which a multipart
    /// object makes obvious: S3 and R2 both answer with a hash-of-hashes there.
    /// </summary>
    [TestMethod]
    public async Task TheProviderETagIsNeverTheRecordedChecksum()
    {
        var content = RandomNumberGenerator.GetBytes(1024);
        var locator = LocatorFor("etag");

        var result = await storage.PutAsync(Upload(locator, content), CancellationToken.None);

        Assert.AreEqual(Sha256Of(content), result.StoredObject!.Sha256);
        Assert.AreNotEqual(FakeS3Handler.EtagOf(content), result.StoredObject.Sha256);
        Assert.AreEqual(64, result.StoredObject.Sha256.Length);
    }

    [TestMethod]
    public async Task PayloadSigningAndDefaultChecksumsAreDisabledForEveryUploadedByte()
    {
        await storage.PutAsync(
            Upload(LocatorFor("unsigned"), RandomNumberGenerator.GetBytes(512)),
            CancellationToken.None);
        await storage.PutAsync(
            Upload(LocatorFor("unsignedmultipart"), RandomNumberGenerator.GetBytes(R2StorageOptions.PartSizeBytes + 1)),
            CancellationToken.None);

        var uploads = bucket.RecordedRequests
            .Where(request => request.Method == "PUT")
            .ToArray();
        Assert.IsNotEmpty(uploads);
        foreach (var request in uploads)
        {
            Assert.AreEqual(
                "UNSIGNED-PAYLOAD",
                request.Header("x-amz-content-sha256"),
                "A body was signed, which R2 does not accept for streamed uploads.");
            Assert.IsNull(
                request.Header("x-amz-decoded-content-length"),
                "Chunked transfer encoding was used for a body R2 expects whole.");
            Assert.IsNull(
                request.Header("x-amz-checksum-crc32"),
                "The SDK added a default checksum R2 does not implement.");
        }
    }

    [TestMethod]
    public async Task AStreamOneByteOverTheAllowanceIsRefusedAndItsMultipartUploadIsAborted()
    {
        var allowance = (R2StorageOptions.PartSizeBytes * 2) - 1;
        var content = RandomNumberGenerator.GetBytes(allowance + 1);
        var locator = LocatorFor("oversize");

        await Assert.ThrowsExactlyAsync<ArgumentOutOfRangeException>(() =>
            storage.PutAsync(
                new ObjectUpload(locator, "video/mp4", new MemoryStream(content), allowance),
                CancellationToken.None));

        Assert.HasCount(1, bucket.AbortedUploads);
        Assert.IsFalse(
            bucket.Objects.ContainsKey(locator.ObjectKey),
            "An oversized upload committed an object.");
        Assert.IsEmpty(bucket.ActiveUploads, "An oversized upload left its parts behind.");
    }

    [TestMethod]
    public async Task AStreamOfExactlyTheAllowanceIsStored()
    {
        var content = RandomNumberGenerator.GetBytes(R2StorageOptions.PartSizeBytes + 100);
        var locator = LocatorFor("exact");

        var result = await storage.PutAsync(
            new ObjectUpload(locator, "video/mp4", new MemoryStream(content), content.Length),
            CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Success, result.Status);
        Assert.AreEqual(content.Length, result.StoredObject!.Length);
        CollectionAssert.AreEqual(content, bucket[locator.ObjectKey]);
    }

    [TestMethod]
    public async Task CancellationMidStreamAbortsTheUploadOnAnIndependentToken()
    {
        using var cancellation = new CancellationTokenSource();
        var locator = LocatorFor("cancelled");
        var content = new CancellingStream(
            RandomNumberGenerator.GetBytes(R2StorageOptions.PartSizeBytes * 2),
            cancellation,
            cancelAfterBytes: R2StorageOptions.PartSizeBytes + 1024);

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            storage.PutAsync(
                new ObjectUpload(locator, "video/mp4", content, MediaUploadPolicy.MaximumVideoBytes),
                cancellation.Token));

        Assert.HasCount(1, bucket.AbortedUploads, "A cancelled upload left its parts in the bucket.");
        Assert.IsFalse(bucket.Objects.ContainsKey(locator.ObjectKey));
    }

    [TestMethod]
    public async Task AProviderFailureDuringAMultipartUploadIsGenericAndAbortsTheUpload()
    {
        var locator = LocatorFor("providerfailure");
        bucket.Fault = request => request.Query.Contains("partNumber", StringComparison.Ordinal)
            ? FakeS3Handler.Error(HttpStatusCode.Forbidden, "AccessDenied")
            : null;

        var result = await storage.PutAsync(
            Upload(locator, RandomNumberGenerator.GetBytes(R2StorageOptions.PartSizeBytes + 10)),
            CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Failed, result.Status);
        Assert.AreEqual("storage_access_denied", result.FailureCode);
        Assert.DoesNotContain(options.BucketName, result.FailureCode!, StringComparison.Ordinal);
        Assert.DoesNotContain(locator.ObjectKey, result.FailureCode!, StringComparison.Ordinal);
        Assert.HasCount(1, bucket.AbortedUploads);
    }

    [TestMethod]
    public async Task AFullReadReturnsEveryByteAndTheObjectLength()
    {
        var content = RandomNumberGenerator.GetBytes(5000);
        var locator = LocatorFor("read");
        await storage.PutAsync(Upload(locator, content), CancellationToken.None);

        var read = await storage.ReadAsync(
            new ObjectReadRequest(locator, "image/jpeg"),
            CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Success, read.Status);
        Assert.AreEqual(5000, read.Metadata!.ObjectLength);
        Assert.AreEqual(5000, read.Metadata.ContentLength);
        Assert.IsNull(read.Metadata.Range);
        using var buffer = new MemoryStream();
        await using (read.Content!)
        {
            await read.Content!.CopyToAsync(buffer);
        }

        CollectionAssert.AreEqual(content, buffer.ToArray());
    }

    [TestMethod]
    public async Task OneRangeIsServedExactlyAndStillReportsTheWholeObjectLength()
    {
        var content = RandomNumberGenerator.GetBytes(5000);
        var locator = LocatorFor("range");
        await storage.PutAsync(Upload(locator, content), CancellationToken.None);

        var read = await storage.ReadAsync(
            new ObjectReadRequest(locator, "image/jpeg", new ObjectByteRange(1000, 200)),
            CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Success, read.Status);
        Assert.AreEqual(5000, read.Metadata!.ObjectLength);
        Assert.AreEqual(200, read.Metadata.ContentLength);
        Assert.AreEqual(1000, read.Metadata.Range!.Offset);
        using var buffer = new MemoryStream();
        await using (read.Content!)
        {
            await read.Content!.CopyToAsync(buffer);
        }

        CollectionAssert.AreEqual(content[1000..1200], buffer.ToArray());
    }

    /// <summary>
    /// A provider that answered a ranged request with the whole object would otherwise have its
    /// bytes served as though they were the interval the caller asked for.
    /// </summary>
    [TestMethod]
    public async Task ARangeTheProviderIgnoredIsRefusedRatherThanServedAsTheRequestedInterval()
    {
        var locator = LocatorFor("ignoredrange");
        await storage.PutAsync(
            Upload(locator, RandomNumberGenerator.GetBytes(5000)),
            CancellationToken.None);
        bucket.IgnoreRangeRequests = true;

        var read = await storage.ReadAsync(
            new ObjectReadRequest(locator, "image/jpeg", new ObjectByteRange(10, 20)),
            CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Failed, read.Status);
        Assert.AreEqual("storage_range_not_honoured", read.FailureCode);
        Assert.IsNull(read.Content);
    }

    [TestMethod]
    public async Task DisposingTheReturnedStreamDisposesTheProviderResponse()
    {
        var locator = LocatorFor("disposal");
        await storage.PutAsync(
            Upload(locator, RandomNumberGenerator.GetBytes(1024)),
            CancellationToken.None);

        var read = await storage.ReadAsync(
            new ObjectReadRequest(locator, "image/jpeg"),
            CancellationToken.None);
        await read.Content!.DisposeAsync();

        Assert.IsTrue(
            bucket.ServedBodies.Single().IsDisposed,
            "The provider response outlived the stream the caller was handed.");
    }

    [TestMethod]
    public async Task AMissingObjectIsNotFoundAndDeletingOneIsStillSuccess()
    {
        var locator = LocatorFor("missing");

        var read = await storage.ReadAsync(
            new ObjectReadRequest(locator, "image/jpeg"),
            CancellationToken.None);
        var delete = await storage.DeleteAsync(locator, CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.NotFound, read.Status);
        Assert.AreEqual(
            ObjectStorageOperationStatus.Success,
            delete.Status,
            "Deletion must be idempotent so a replayed purge claim can finish.");
    }

    [TestMethod]
    public async Task DeletingAStoredObjectRemovesIt()
    {
        var locator = LocatorFor("deletable");
        await storage.PutAsync(Upload(locator, [1, 2, 3, 4]), CancellationToken.None);

        var delete = await storage.DeleteAsync(locator, CancellationToken.None);

        Assert.AreEqual(ObjectStorageOperationStatus.Success, delete.Status);
        Assert.IsFalse(bucket.Objects.ContainsKey(locator.ObjectKey));
    }

    /// <summary>
    /// One adapter serves one location. Bytes written by the local Development adapter are not this
    /// bucket's to read, write or delete, and refusing them must not cost a provider request.
    /// </summary>
    [TestMethod]
    public async Task AnotherLocationIsRefusedWithoutTouchingTheProvider()
    {
        var foreign = new StorageObjectLocator(
            Tenant,
            MediaStorageLocations.LocalV1,
            $"{Tenant:N}/historical");

        var write = await storage.PutAsync(
            Upload(foreign, [1, 2, 3]),
            CancellationToken.None);
        var read = await storage.ReadAsync(
            new ObjectReadRequest(foreign, "image/jpeg"),
            CancellationToken.None);
        var delete = await storage.DeleteAsync(foreign, CancellationToken.None);

        Assert.AreEqual("storage_location_unavailable", write.FailureCode);
        Assert.AreEqual("storage_location_unavailable", read.FailureCode);
        Assert.AreEqual("storage_location_unavailable", delete.FailureCode);
        Assert.AreEqual(0, bucket.RequestCount, "A foreign location reached the provider.");
    }

    /// <summary>
    /// A key is tenant-bound before it can become a locator at all, so an adapter is never the place
    /// a cross-tenant key is caught — but the adapter must not be able to widen one either.
    /// </summary>
    [TestMethod]
    public void AKeyBelongingToAnotherTenantCannotBecomeALocator()
    {
        var other = Guid.NewGuid();

        Assert.ThrowsExactly<ArgumentException>(() => new StorageObjectLocator(
            Tenant,
            R2StorageOptions.LocationName,
            $"{other:N}/object"));
        Assert.ThrowsExactly<ArgumentException>(() => new StorageObjectLocator(
            Tenant,
            R2StorageOptions.LocationName,
            $"{Tenant:N}/../{other:N}/object"));
    }

    [TestMethod]
    public async Task EveryRequestAddressesTheConfiguredBucketOnTheAccountEndpoint()
    {
        var locator = LocatorFor("addressing");
        await storage.PutAsync(Upload(locator, [9, 9, 9]), CancellationToken.None);

        var request = bucket.RecordedRequests.Single();
        Assert.AreEqual($"/{options.BucketName}/{locator.ObjectKey}", request.Path);
        Assert.AreEqual("0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com", request.Authority);
    }

    private static StorageObjectLocator LocatorFor(string name) =>
        new(Tenant, R2StorageOptions.LocationName, $"{Tenant:N}/{name}");

    private static ObjectUpload Upload(
        StorageObjectLocator locator,
        byte[] content,
        bool seekable = true) =>
        new(
            locator,
            "image/jpeg",
            seekable ? new MemoryStream(content) : new NonSeekableStream(content),
            MediaUploadPolicy.MaximumVideoBytes);

    private static string Sha256Of(byte[] content) =>
        Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();

    /// <summary>An upload body with no length and no seeking, which is what a request stream is.</summary>
    private sealed class NonSeekableStream(byte[] content) : Stream
    {
        private readonly MemoryStream inner = new(content);

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        // Deliberately short reads: a stream that answers with less than was asked for is normal on
        // a network, and an adapter that treated one as end of stream would truncate an upload.
        public override int Read(byte[] buffer, int offset, int count) =>
            inner.Read(buffer, offset, Math.Min(count, 7919));

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default) =>
            inner.ReadAsync(buffer[..Math.Min(buffer.Length, 7919)], cancellationToken);

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    /// <summary>Cancels the caller's token part-way through the body, as an abandoned request does.</summary>
    private sealed class CancellingStream(
        byte[] content,
        CancellationTokenSource cancellation,
        int cancelAfterBytes) : Stream
    {
        private readonly MemoryStream inner = new(content);

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) =>
            inner.Read(buffer, offset, count);

        public override async ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            if (inner.Position >= cancelAfterBytes)
            {
                await cancellation.CancelAsync();
                cancellationToken.ThrowIfCancellationRequested();
            }

            return await inner.ReadAsync(buffer, cancellationToken);
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
