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
        Directory.CreateDirectory(root);
    }

    public async Task<StoredObject> PutAsync(ObjectUpload upload, CancellationToken cancellationToken)
    {
        if (upload.MaximumLength is <= 0 or > MediaUploadPolicy.MaximumVideoBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(upload), "The object size limit is invalid.");
        }

        var destination = Resolve(upload.ObjectKey);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        var temporary = $"{destination}.{Guid.NewGuid():N}.upload";
        var buffer = ArrayPool<byte>.Shared.Rent(128 * 1024);
        try
        {
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
                        throw new ArgumentOutOfRangeException(nameof(upload), "The media stream exceeds the allowed size.");
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
            return new StoredObject(
                upload.ObjectKey,
                length,
                upload.ContentType,
                Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),
                signature[..signatureLength]);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
            if (File.Exists(temporary))
            {
                File.Delete(temporary);
            }
        }
    }

    public Task<Stream> OpenReadAsync(string objectKey, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Stream stream = new FileStream(
            Resolve(objectKey),
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Task.FromResult(stream);
    }

    public Task DeleteAsync(string objectKey, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = Resolve(objectKey);
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        return Task.CompletedTask;
    }

    private string Resolve(string objectKey)
    {
        if (string.IsNullOrWhiteSpace(objectKey) || Path.IsPathRooted(objectKey))
        {
            throw new ArgumentException("The object key is invalid.", nameof(objectKey));
        }

        var normalized = objectKey.Replace('/', Path.DirectorySeparatorChar);
        var path = Path.GetFullPath(Path.Combine(root, normalized));
        var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!path.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("The object key escapes the configured storage root.");
        }

        return path;
    }
}

internal sealed class DevelopmentMediaScanner : IMediaScanner
{
    public bool IsAvailable => true;

    public Task<MediaScanResult> ScanAsync(
        string objectKey,
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
        string objectKey,
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
