using System.Buffers;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The production object-storage adapter: a private Cloudflare R2 bucket in the EU jurisdiction,
/// reached over the S3 protocol.
/// </summary>
/// <remarks>
/// <para>
/// It serves exactly one location, <see cref="R2StorageOptions.LocationName"/>. A locator naming
/// <c>local-v1</c>, or any other location, is refused rather than reinterpreted: the whole point of
/// the durable <c>(location, key)</c> identity is that the adapter composed today cannot claim bytes
/// written by a different one. This is not a router and does not become one by adding a branch here.
/// </para>
/// <para>
/// Everything is streamed. A write reads the caller's stream one part at a time into a single pooled
/// buffer, hashes exactly the bytes it transmits, and switches to multipart the moment the content
/// does not fit that buffer — which is what makes a non-seekable 500 MiB upload storable without a
/// temporary file and without knowing its length in advance. The SHA-256 and the 16-byte signature
/// are computed over exactly those bytes. The provider's <c>ETag</c> is never consulted for either:
/// it is an opaque provider value, it is not a content hash for a multipart object, and trusting it
/// would let the provider decide what this repository believes it stored.
/// </para>
/// </remarks>
internal sealed class R2ObjectStorage(
    IAmazonS3 client,
    R2StorageOptions options,
    ILogger<R2ObjectStorage> logger)
    : IObjectStorage, IMediaDependencyProbe
{
    /// <summary>
    /// A key that cannot exist under the generated grammar, so a probe can ask the bucket a question
    /// whose expected answer is "no such object" without ever naming a workspace's object.
    /// </summary>
    private const string ProbeKey = "_readiness/probe";

    /// <summary>
    /// One line per failed provider operation, carrying the operation and a stable code and nothing
    /// else. No bucket, no key, no endpoint, no credential, no provider message: a media object key
    /// identifies a workspace's private content, and a provider exception message routinely contains
    /// the request URL that embeds it.
    /// </summary>
    private static readonly Action<ILogger, string, string, Exception?> LogProviderFailure =
        LoggerMessage.Define<string, string>(
            LogLevel.Warning,
            new EventId(5510, "MediaObjectStorageProviderFailure"),
            "A media object-storage {Operation} failed against the configured provider: {FailureCode}.");

    public string WriteLocation => R2StorageOptions.LocationName;

    public bool IsAvailable => true;

    public async Task<ObjectWriteResult> PutAsync(
        ObjectUpload upload,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(upload);
        if (upload.MaximumLength is <= 0 or > MediaUploadPolicy.MaximumVideoBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(upload), "The object size limit is invalid.");
        }

        if (!CanServe(upload.Locator))
        {
            return FailedWrite("storage_location_unavailable");
        }

        var buffer = ArrayPool<byte>.Shared.Rent(R2StorageOptions.PartSizeBytes);
        string? uploadId = null;
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var signature = new byte[16];
            var signatureLength = 0;
            long length = 0;

            // Reading one byte past the allowance is what makes the limit exact: a stream of exactly
            // MaximumLength bytes is stored, and one of MaximumLength + 1 is refused without ever
            // buffering the remainder of a hostile body.
            var firstCapacity = (int)Math.Min(R2StorageOptions.PartSizeBytes, upload.MaximumLength + 1);
            var first = await FillAsync(upload.Content, buffer.AsMemory(0, firstCapacity), cancellationToken);
            length = first;
            EnsureWithinAllowance(upload, length);
            Accumulate(hash, buffer, first, signature, ref signatureLength);

            if (first < firstCapacity)
            {
                // The whole object is in the buffer, so one request stores it. A short read only ever
                // means end of stream here: FillAsync loops until the span is full or the stream ends.
                await PutWholeObjectAsync(upload, buffer, first, cancellationToken);
            }
            else
            {
                uploadId = await BeginMultipartAsync(upload, cancellationToken);
                var partNumber = 1;
                var parts = new List<PartETag>();
                parts.Add(await UploadPartAsync(upload, uploadId, partNumber, buffer, first, cancellationToken));

                while (true)
                {
                    var capacity = (int)Math.Min(
                        R2StorageOptions.PartSizeBytes,
                        upload.MaximumLength + 1 - length);
                    var read = await FillAsync(upload.Content, buffer.AsMemory(0, capacity), cancellationToken);
                    if (read == 0)
                    {
                        break;
                    }

                    length += read;
                    EnsureWithinAllowance(upload, length);
                    Accumulate(hash, buffer, read, signature, ref signatureLength);
                    parts.Add(await UploadPartAsync(
                        upload,
                        uploadId,
                        ++partNumber,
                        buffer,
                        read,
                        cancellationToken));
                    if (read < capacity)
                    {
                        break;
                    }
                }

                await CompleteMultipartAsync(upload, uploadId, parts, cancellationToken);
                // Completed uploads own their parts; only an interrupted one still needs aborting.
                uploadId = null;
            }

            return new ObjectWriteResult(
                ObjectStorageOperationStatus.Success,
                new StoredObject(
                    upload.Locator,
                    length,
                    upload.ContentType,
                    Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
                    signature[..signatureLength]));
        }
        catch (AmazonS3Exception exception)
        {
            return FailedWrite(Classify(exception, "put"));
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or TimeoutException)
        {
            LogProviderFailure(logger, "put", "storage_provider_unavailable", null);
            return FailedWrite("storage_provider_unavailable");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
            // Cancellation, an oversized body, a provider error and a broken connection all leave
            // parts behind that nothing else will ever complete. One place aborts them, on a token
            // of its own so that a cancelled request still cleans up after itself.
            await AbortAsync(upload.Locator, uploadId);
        }
    }

    public async Task<ObjectReadResult> ReadAsync(
        ObjectReadRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        if (!CanServe(request.Locator))
        {
            return FailedRead("storage_location_unavailable");
        }

        GetObjectResponse? response = null;
        try
        {
            var get = new GetObjectRequest
            {
                BucketName = options.BucketName,
                Key = request.Locator.ObjectKey,
            };
            if (request.Range is { } requested)
            {
                get.ByteRange = new ByteRange(requested.Offset, requested.EndInclusive);
            }

            response = await client.GetObjectAsync(get, cancellationToken);
            if (request.Range is null)
            {
                var stream = new OwnedObjectStream(response);
                var metadata = new ObjectReadMetadata(response.ContentLength, request.ContentType, null);
                response = null;
                return new ObjectReadResult(ObjectStorageOperationStatus.Success, stream, metadata);
            }

            // A provider that ignored the Range header would answer 200 with the whole object. Serving
            // that as though it were the requested interval would hand a caller bytes it did not ask
            // for and describe them with a Content-Range it never received.
            if (response.HttpStatusCode != HttpStatusCode.PartialContent ||
                !TryParseObjectLength(response.ContentRange, out var objectLength) ||
                response.ContentLength != request.Range.Length)
            {
                return FailedRead("storage_range_not_honoured");
            }

            var ranged = new OwnedObjectStream(response);
            var rangedMetadata = new ObjectReadMetadata(objectLength, request.ContentType, request.Range);
            response = null;
            return new ObjectReadResult(ObjectStorageOperationStatus.Success, ranged, rangedMetadata);
        }
        catch (AmazonS3Exception exception) when (IsMissing(exception))
        {
            return new ObjectReadResult(ObjectStorageOperationStatus.NotFound);
        }
        catch (AmazonS3Exception exception)
        {
            return FailedRead(Classify(exception, "read"));
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or TimeoutException)
        {
            LogProviderFailure(logger, "read", "storage_provider_unavailable", null);
            return FailedRead("storage_provider_unavailable");
        }
        finally
        {
            // Only reached when the response was not handed to a stream that owns it.
            response?.Dispose();
        }
    }

    public async Task<ObjectDeleteResult> DeleteAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(locator);
        cancellationToken.ThrowIfCancellationRequested();
        if (!CanServe(locator))
        {
            return new ObjectDeleteResult(
                ObjectStorageOperationStatus.Failed,
                "storage_location_unavailable");
        }

        try
        {
            await client.DeleteObjectAsync(
                new DeleteObjectRequest
                {
                    BucketName = options.BucketName,
                    Key = locator.ObjectKey,
                },
                cancellationToken);
            return new ObjectDeleteResult(ObjectStorageOperationStatus.Success);
        }
        catch (AmazonS3Exception exception) when (IsMissing(exception))
        {
            // Idempotent by contract: a claim that outlives its process replays deletion, and an
            // object already gone is the outcome that claim wanted.
            return new ObjectDeleteResult(ObjectStorageOperationStatus.Success);
        }
        catch (AmazonS3Exception exception)
        {
            return new ObjectDeleteResult(
                ObjectStorageOperationStatus.Failed,
                Classify(exception, "delete"));
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or TimeoutException)
        {
            LogProviderFailure(logger, "delete", "storage_provider_unavailable", null);
            return new ObjectDeleteResult(
                ObjectStorageOperationStatus.Failed,
                "storage_provider_unavailable");
        }
    }

    /// <summary>
    /// Asks the bucket about an object that cannot exist. "No such key" is the healthy answer: it
    /// proves the endpoint resolved, the credential was accepted and the bucket is addressable,
    /// without reading, writing or naming any workspace's bytes.
    /// </summary>
    public async Task<bool> ProbeAsync(CancellationToken cancellationToken)
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(TimeSpan.FromSeconds(options.ProbeTimeoutSeconds));
        try
        {
            await client.GetObjectMetadataAsync(options.BucketName, ProbeKey, bounded.Token);
            return true;
        }
        catch (AmazonS3Exception exception) when (IsMissing(exception))
        {
            return true;
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or OperationCanceledException)
        {
            return false;
        }
    }

    private async Task PutWholeObjectAsync(
        ObjectUpload upload,
        byte[] buffer,
        int count,
        CancellationToken cancellationToken)
    {
        using var content = new MemoryStream(buffer, 0, count, writable: false);
        await client.PutObjectAsync(
            new PutObjectRequest
            {
                BucketName = options.BucketName,
                Key = upload.Locator.ObjectKey,
                ContentType = upload.ContentType,
                InputStream = content,
                AutoCloseStream = false,
                UseChunkEncoding = false,
                // R2 accepts an unsigned payload over TLS and does not implement the SDK's default
                // trailing-checksum flavours. Signing the payload would additionally require the
                // whole part in memory a second time; the integrity this repository relies on is the
                // SHA-256 it computes itself over the bytes it sent.
                DisablePayloadSigning = true,
                DisableDefaultChecksumValidation = true,
            },
            cancellationToken);
    }

    private async Task<string> BeginMultipartAsync(
        ObjectUpload upload,
        CancellationToken cancellationToken)
    {
        var initiated = await client.InitiateMultipartUploadAsync(
            new InitiateMultipartUploadRequest
            {
                BucketName = options.BucketName,
                Key = upload.Locator.ObjectKey,
                ContentType = upload.ContentType,
            },
            cancellationToken);
        return initiated.UploadId;
    }

    private async Task<PartETag> UploadPartAsync(
        ObjectUpload upload,
        string uploadId,
        int partNumber,
        byte[] buffer,
        int count,
        CancellationToken cancellationToken)
    {
        using var content = new MemoryStream(buffer, 0, count, writable: false);
        var uploaded = await client.UploadPartAsync(
            new UploadPartRequest
            {
                BucketName = options.BucketName,
                Key = upload.Locator.ObjectKey,
                UploadId = uploadId,
                PartNumber = partNumber,
                PartSize = count,
                InputStream = content,
                UseChunkEncoding = false,
                DisablePayloadSigning = true,
                DisableDefaultChecksumValidation = true,
            },
            cancellationToken);
        return new PartETag(partNumber, uploaded.ETag);
    }

    private async Task CompleteMultipartAsync(
        ObjectUpload upload,
        string uploadId,
        List<PartETag> parts,
        CancellationToken cancellationToken) =>
        await client.CompleteMultipartUploadAsync(
            new CompleteMultipartUploadRequest
            {
                BucketName = options.BucketName,
                Key = upload.Locator.ObjectKey,
                UploadId = uploadId,
                PartETags = parts,
            },
            cancellationToken);

    /// <summary>
    /// Abandons an interrupted multipart upload so its parts stop occupying the bucket.
    /// </summary>
    /// <remarks>
    /// The token is independent of the request's on purpose: the commonest reason to reach here is
    /// that the request was cancelled, and cleanup that inherits the cancellation would never run.
    /// A failed abort is left to R2's own incomplete-multipart lifecycle rather than being retried
    /// here, and it never replaces the failure the caller is about to see.
    /// </remarks>
    private async Task AbortAsync(StorageObjectLocator locator, string? uploadId)
    {
        if (uploadId is null)
        {
            return;
        }

        using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(options.AbortTimeoutSeconds));
        try
        {
            await client.AbortMultipartUploadAsync(
                new AbortMultipartUploadRequest
                {
                    BucketName = options.BucketName,
                    Key = locator.ObjectKey,
                    UploadId = uploadId,
                },
                cleanup.Token);
        }
        catch (Exception exception) when (exception is AmazonServiceException
                                              or HttpRequestException
                                              or IOException
                                              or OperationCanceledException)
        {
            LogProviderFailure(logger, "abort", "storage_multipart_abort_failed", null);
        }
    }

    /// <summary>
    /// Refuses a body larger than the allowance, in the same shape the local adapter refuses one:
    /// ingestion distinguishes "this workspace is full" from "this file is too large" by catching
    /// exactly this, and an adapter that reported it differently would blame the wrong thing.
    /// </summary>
    private static void EnsureWithinAllowance(ObjectUpload upload, long length)
    {
        if (length > upload.MaximumLength)
        {
            throw new ArgumentOutOfRangeException(
                nameof(upload),
                "The media stream exceeds the allowed size.");
        }
    }

    private static void Accumulate(
        IncrementalHash hash,
        byte[] buffer,
        int count,
        byte[] signature,
        ref int signatureLength)
    {
        if (count == 0)
        {
            return;
        }

        if (signatureLength < signature.Length)
        {
            var copy = Math.Min(count, signature.Length - signatureLength);
            buffer.AsSpan(0, copy).CopyTo(signature.AsSpan(signatureLength));
            signatureLength += copy;
        }

        hash.AppendData(buffer, 0, count);
    }

    /// <summary>Reads until the span is full or the stream ends; a short result means end of stream.</summary>
    private static async Task<int> FillAsync(
        Stream source,
        Memory<byte> destination,
        CancellationToken cancellationToken)
    {
        var filled = 0;
        while (filled < destination.Length)
        {
            var read = await source.ReadAsync(destination[filled..], cancellationToken);
            if (read == 0)
            {
                break;
            }

            filled += read;
        }

        return filled;
    }

    private bool CanServe(StorageObjectLocator locator) =>
        string.Equals(locator.Location, WriteLocation, StringComparison.Ordinal);

    private static bool IsMissing(AmazonS3Exception exception) =>
        exception.StatusCode == HttpStatusCode.NotFound ||
        string.Equals(exception.ErrorCode, "NoSuchKey", StringComparison.Ordinal);

    /// <summary>
    /// Provider failures become a small set of stable codes. The provider's own message, request id
    /// and response body are deliberately dropped: they quote the request URL, which embeds the
    /// object key, which identifies one workspace's private content.
    /// </summary>
    private string Classify(AmazonS3Exception exception, string operation)
    {
        var code = exception.StatusCode switch
        {
            HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized => "storage_access_denied",
            HttpStatusCode.RequestedRangeNotSatisfiable => "storage_range_not_satisfiable",
            _ => "storage_provider_error",
        };
        LogProviderFailure(logger, operation, code, null);
        return code;
    }

    /// <summary>Reads the object's total length out of a <c>bytes start-end/total</c> header.</summary>
    private static bool TryParseObjectLength(string? contentRange, out long objectLength)
    {
        objectLength = 0;
        var separator = contentRange?.LastIndexOf('/') ?? -1;
        return separator > 0 &&
            long.TryParse(
                contentRange!.AsSpan(separator + 1),
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out objectLength) &&
            objectLength > 0;
    }

    private static ObjectWriteResult FailedWrite(string code) =>
        new(ObjectStorageOperationStatus.Failed, FailureCode: code);

    private static ObjectReadResult FailedRead(string code) =>
        new(ObjectStorageOperationStatus.Failed, FailureCode: code);
}

/// <summary>
/// The provider's body, and the response object that owns the connection behind it, disposed as one.
/// </summary>
/// <remarks>
/// The caller of <c>ReadAsync</c> receives a stream and disposes it when the response is written.
/// Handing back the raw provider stream would leave the response — and the pooled connection it
/// holds — alive until a finalizer or a garbage collection got to it, which under load is how a
/// process runs out of sockets while every request looks correct.
/// </remarks>
internal sealed class OwnedObjectStream(GetObjectResponse response) : Stream
{
    private readonly Stream inner = response.ResponseStream;

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => response.ContentLength;

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default) =>
        inner.ReadAsync(buffer, cancellationToken);

    public override Task<int> ReadAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken) =>
        inner.ReadAsync(buffer, offset, count, cancellationToken);

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            response.Dispose();
        }

        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        response.Dispose();
        await base.DisposeAsync();
        GC.SuppressFinalize(this);
    }

    public override void Flush() => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
