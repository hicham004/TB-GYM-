using System.Buffers;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

internal sealed class LocalObjectStorage : IObjectStorage
{
    private readonly string root;

    public LocalObjectStorage(IConfiguration configuration)
    {
        var configured = configuration["Media:StorageRoot"];
        root = Path.GetFullPath(string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(AppContext.BaseDirectory, ".data", "media")
            : configured);
        // Deliberately do not create anything here. Composition must accept the adapter before a
        // local path is touched, and only a successful Put needs the directory to exist.
    }

    public string WriteLocation => MediaStorageLocations.LocalV1;

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

        var destination = Resolve(upload.Locator);
        var temporary = $"{destination}.{Guid.NewGuid():N}.upload";
        var buffer = ArrayPool<byte>.Shared.Rent(128 * 1024);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            long length = 0;
            var signature = new byte[16];
            var signatureLength = 0;
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var output = new FileStream(
                temporary,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                buffer.Length,
                FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                while (true)
                {
                    var read = await upload.Content.ReadAsync(buffer, cancellationToken);
                    if (read == 0)
                    {
                        break;
                    }

                    length = checked(length + read);
                    if (length > upload.MaximumLength)
                    {
                        throw new ArgumentOutOfRangeException(
                            nameof(upload),
                            "The media stream exceeds the allowed size.");
                    }

                    if (signatureLength < signature.Length)
                    {
                        var copy = Math.Min(read, signature.Length - signatureLength);
                        buffer.AsSpan(0, copy).CopyTo(signature.AsSpan(signatureLength));
                        signatureLength += copy;
                    }

                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }
            }

            File.Move(temporary, destination, overwrite: false);
            return new ObjectWriteResult(
                ObjectStorageOperationStatus.Success,
                new StoredObject(
                    upload.Locator,
                    length,
                    upload.ContentType,
                    Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
                    signature[..signatureLength]));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (UnauthorizedAccessException)
        {
            return FailedWrite("storage_access_denied");
        }
        catch (IOException)
        {
            return FailedWrite("storage_io_error");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
            TryDeletePartial(temporary);
        }
    }

    public Task<ObjectReadResult> ReadAsync(
        ObjectReadRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        if (!CanServe(request.Locator))
        {
            return Task.FromResult(FailedRead("storage_location_unavailable"));
        }

        try
        {
            var stream = new FileStream(
                Resolve(request.Locator),
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                128 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            var objectLength = stream.Length;
            if (request.Range is { } range)
            {
                if (range.Offset >= objectLength || range.EndInclusive >= objectLength)
                {
                    stream.Dispose();
                    return Task.FromResult(new ObjectReadResult(
                        ObjectStorageOperationStatus.RangeNotSatisfiable,
                        Metadata: new ObjectReadMetadata(objectLength, request.ContentType, null)));
                }

                stream.Position = range.Offset;
                Stream content = new BoundedReadStream(stream, range.Length);
                return Task.FromResult(new ObjectReadResult(
                    ObjectStorageOperationStatus.Success,
                    content,
                    new ObjectReadMetadata(objectLength, request.ContentType, range)));
            }

            return Task.FromResult(new ObjectReadResult(
                ObjectStorageOperationStatus.Success,
                stream,
                new ObjectReadMetadata(objectLength, request.ContentType, null)));
        }
        catch (FileNotFoundException)
        {
            return Task.FromResult(new ObjectReadResult(ObjectStorageOperationStatus.NotFound));
        }
        catch (DirectoryNotFoundException)
        {
            return Task.FromResult(new ObjectReadResult(ObjectStorageOperationStatus.NotFound));
        }
        catch (UnauthorizedAccessException)
        {
            return Task.FromResult(FailedRead("storage_access_denied"));
        }
        catch (IOException)
        {
            return Task.FromResult(FailedRead("storage_io_error"));
        }
    }

    public Task<ObjectDeleteResult> DeleteAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(locator);
        cancellationToken.ThrowIfCancellationRequested();
        if (!CanServe(locator))
        {
            return Task.FromResult(new ObjectDeleteResult(
                ObjectStorageOperationStatus.Failed,
                "storage_location_unavailable"));
        }

        try
        {
            var path = Resolve(locator);
            if (File.Exists(path))
            {
                File.Delete(path);
            }

            return Task.FromResult(new ObjectDeleteResult(ObjectStorageOperationStatus.Success));
        }
        catch (UnauthorizedAccessException)
        {
            return Task.FromResult(new ObjectDeleteResult(
                ObjectStorageOperationStatus.Failed,
                "storage_access_denied"));
        }
        catch (IOException)
        {
            return Task.FromResult(new ObjectDeleteResult(
                ObjectStorageOperationStatus.Failed,
                "storage_io_error"));
        }
    }

    private bool CanServe(StorageObjectLocator locator) =>
        string.Equals(locator.Location, WriteLocation, StringComparison.Ordinal);

    private string Resolve(StorageObjectLocator locator)
    {
        var normalized = locator.ObjectKey.Replace('/', Path.DirectorySeparatorChar);
        var path = Path.GetFullPath(Path.Combine(root, normalized));
        var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!path.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("The object key escapes the configured storage root.", nameof(locator));
        }

        return path;
    }

    private static ObjectWriteResult FailedWrite(string code) =>
        new(ObjectStorageOperationStatus.Failed, FailureCode: code);

    private static ObjectReadResult FailedRead(string code) =>
        new(ObjectStorageOperationStatus.Failed, FailureCode: code);

    private static void TryDeletePartial(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // The durable ingest reservation remains available for reconciliation. This best-effort
            // cleanup must not replace the stable result of the operation that just failed.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}

/// <summary>A non-seekable view over exactly one bounded interval of a local file.</summary>
internal sealed class BoundedReadStream(Stream inner, long remaining) : Stream
{
    private long remaining = remaining > 0
        ? remaining
        : throw new ArgumentOutOfRangeException(nameof(remaining));

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => remaining;
    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var requested = (int)Math.Min(count, remaining);
        var read = requested == 0 ? 0 : inner.Read(buffer, offset, requested);
        remaining -= read;
        return read;
    }

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
        var requested = (int)Math.Min(buffer.Length, remaining);
        var read = requested == 0
            ? 0
            : await inner.ReadAsync(buffer[..requested], cancellationToken);
        remaining -= read;
        return read;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            inner.Dispose();
        }

        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        await inner.DisposeAsync();
        await base.DisposeAsync();
        GC.SuppressFinalize(this);
    }

    public override void Flush() => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

internal sealed class UnavailableObjectStorage : IObjectStorage
{
    private const string FailureCode = "storage_not_configured";

    public string WriteLocation => MediaStorageLocations.Unavailable;

    public bool IsAvailable => false;

    public Task<ObjectWriteResult> PutAsync(ObjectUpload upload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ObjectWriteResult(
            ObjectStorageOperationStatus.Failed,
            FailureCode: FailureCode));
    }

    public Task<ObjectReadResult> ReadAsync(ObjectReadRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ObjectReadResult(
            ObjectStorageOperationStatus.Failed,
            FailureCode: FailureCode));
    }

    public Task<ObjectDeleteResult> DeleteAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ObjectDeleteResult(
            ObjectStorageOperationStatus.Failed,
            FailureCode));
    }
}

internal sealed class DevelopmentMediaScanner : IMediaScanner
{
    public bool IsAvailable => true;

    public Task<MediaScanResult> ScanAsync(
        StorageObjectLocator locator,
        string verifiedContentType,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new MediaScanResult(
            true,
            "DevelopmentSignatureScanner",
            "1.0",
            null));
    }
}

internal sealed class UnavailableMediaScanner : IMediaScanner
{
    public bool IsAvailable => false;

    public Task<MediaScanResult> ScanAsync(
        StorageObjectLocator locator,
        string verifiedContentType,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new MediaScanResult(
            false,
            "UnavailableProductionScanner",
            "1.0",
            "scanner_not_configured"));
    }
}
