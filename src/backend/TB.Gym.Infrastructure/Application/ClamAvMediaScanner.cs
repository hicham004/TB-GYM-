using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Logging;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The production upload scanner: a private ClamAV <c>clamd</c>, asked over its INSTREAM protocol.
/// </summary>
/// <remarks>
/// <para>
/// It scans what was actually stored, not what was uploaded. The stored object is opened through the
/// same owned storage contract every other read uses and streamed to the daemon in bounded chunks,
/// so a 500 MiB video is never held in memory and never lands in a temporary file — a file that
/// would be a second copy of the very bytes the scan exists to distrust.
/// </para>
/// <para>
/// Only two answers are verdicts. <c>OK</c> allows the bytes and <c>FOUND</c> refuses them; every
/// other outcome — an <c>ERROR</c> reply, a stream that exceeded a configured daemon limit, a
/// timeout, a disconnect, a malformed or over-long response — is an operational failure that reports
/// <c>503</c> and commits no asset. A limit is never a clean result: a file the daemon declined to
/// finish reading has not been found clean, and treating a truncated pass as an allowance is exactly
/// how an unscanned file becomes a published one.
/// </para>
/// <para>
/// The signature name in a <c>FOUND</c> reply is never returned, never persisted and never logged.
/// The caller is told the file was rejected, which is all a caller needs and all this repository is
/// willing to say about the content of somebody's private upload.
/// </para>
/// </remarks>
internal sealed class ClamAvMediaScanner(
    IObjectStorage storage,
    ClamAvScannerOptions options,
    ILogger<ClamAvMediaScanner> logger)
    : IMediaScanner, IMediaDependencyProbe, IDisposable
{
    /// <summary>The reply frame is a short status line; anything longer is malformed by definition.</summary>
    private const int MaximumReplyBytes = 512;

    /// <summary>The two INSTREAM verdicts clamd defines, and nothing either side of them.</summary>
    private const string CleanReply = "stream: OK";
    private const string StreamPrefix = "stream: ";
    private const string FoundSuffix = " FOUND";

    /// <summary>The shape of a usable <c>VERSION</c> reply: an engine and a signature revision.</summary>
    private const string VersionPrefix = "ClamAV ";

    /// <summary>What scan evidence has room for, so a version that will not fit is not a version.</summary>
    private const int MaximumVersionLength = 40;

    private static readonly Action<ILogger, string, Exception?> LogScannerFailure =
        LoggerMessage.Define<string>(
            LogLevel.Warning,
            new EventId(5511, "MediaScannerProviderFailure"),
            "The media scanner could not produce a verdict: {FailureCode}.");

    private readonly SemaphoreSlim versionGate = new(1, 1);
    private string? cachedVersion;
    private long cachedVersionTicks;

    public bool IsAvailable => true;

    public void Dispose() => versionGate.Dispose();

    public async Task<MediaScanResult> ScanAsync(
        StorageObjectLocator locator,
        string verifiedContentType,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(locator);

        // Resolved first so that a refusal carries the same bindable evidence an allowance does. A
        // verdict this repository cannot attribute to an engine and a signature set is not evidence.
        var version = await ResolveVersionAsync(cancellationToken);

        var read = await storage.ReadAsync(
            new ObjectReadRequest(locator, verifiedContentType),
            cancellationToken);
        if (read is not { Status: ObjectStorageOperationStatus.Success, Content: { } content })
        {
            LogScannerFailure(logger, "scan_source_unavailable", null);
            throw new IOException("The stored object could not be opened for scanning.");
        }

        await using (content)
        {
            var allowed = await ScanStreamAsync(content, cancellationToken);
            return new MediaScanResult(
                allowed,
                ClamAvScannerOptions.ScannerKey,
                version,
                allowed ? null : "scan_refused");
        }
    }

    /// <summary>A bounded <c>PING</c>, so readiness can say whether the daemon answers at all.</summary>
    public async Task<bool> ProbeAsync(CancellationToken cancellationToken)
    {
        try
        {
            var reply = await ExecuteAsync(
                "zPING\0",
                null,
                TimeSpan.FromSeconds(options.ProbeTimeoutSeconds),
                cancellationToken);
            return string.Equals(reply, "PONG", StringComparison.Ordinal);
        }
        catch (Exception exception) when (exception is IOException
                                              or SocketException
                                              or TimeoutException
                                              or InvalidOperationException
                                              or OperationCanceledException)
        {
            return false;
        }
    }

    private async Task<bool> ScanStreamAsync(Stream content, CancellationToken cancellationToken)
    {
        var reply = await ExecuteAsync(
            "zINSTREAM\0",
            content,
            TimeSpan.FromSeconds(options.ScanTimeoutSeconds),
            cancellationToken);

        if (string.Equals(reply, CleanReply, StringComparison.Ordinal))
        {
            return true;
        }

        // "stream: <signature name> FOUND", with a name between the two. The whole frame is matched
        // rather than its suffix: a reply ending in the right word is not the same fact as a reply
        // the daemon actually formed, and "<anything> OK" reading as clean is the one mistake in
        // this method that fails open.
        if (reply.StartsWith(StreamPrefix, StringComparison.Ordinal) &&
            reply.EndsWith(FoundSuffix, StringComparison.Ordinal) &&
            reply.Length > StreamPrefix.Length + FoundSuffix.Length)
        {
            return false;
        }

        // ERROR, "INSTREAM size limit exceeded", a truncated frame, and anything else that is not
        // one of the two verdicts clamd defines. The reply text is not logged: an ERROR line can
        // quote the daemon's view of the content.
        LogScannerFailure(logger, "scan_not_completed", null);
        throw new IOException("The scanner did not complete a verdict for the stored object.");
    }

    /// <summary>
    /// The engine and signature-database version, cached for a bounded interval and normalized to
    /// what scan evidence can hold.
    /// </summary>
    /// <remarks>
    /// <c>clamd</c> answers one command per connection, so this is a second connection rather than a
    /// second command. Caching it keeps that off the upload path without letting the recorded version
    /// drift far from the engine that actually did the work.
    /// </remarks>
    private async Task<string> ResolveVersionAsync(CancellationToken cancellationToken)
    {
        var refresh = TimeSpan.FromMinutes(options.VersionRefreshMinutes).Ticks;
        var now = Environment.TickCount64 * TimeSpan.TicksPerMillisecond;
        // Read without the gate first. Several uploads scan concurrently, and the worst a stale read
        // can cost is one extra VERSION connection; taking a lock per upload to avoid that would be
        // the expensive half of the trade.
        if (Volatile.Read(ref cachedVersion) is { } current &&
            now - Volatile.Read(ref cachedVersionTicks) < refresh)
        {
            return current;
        }

        await versionGate.WaitAsync(cancellationToken);
        try
        {
            now = Environment.TickCount64 * TimeSpan.TicksPerMillisecond;
            if (cachedVersion is { } fresh && now - cachedVersionTicks < refresh)
            {
                return fresh;
            }

            var reply = await ExecuteAsync(
                "zVERSION\0",
                null,
                TimeSpan.FromSeconds(options.ProbeTimeoutSeconds),
                cancellationToken);
            if (NormalizeVersion(reply) is not { } normalized)
            {
                LogScannerFailure(logger, "scanner_version_unusable", null);
                throw new InvalidOperationException("The scanner reported no usable version.");
            }

            Volatile.Write(ref cachedVersionTicks, now);
            Volatile.Write(ref cachedVersion, normalized);
            return normalized;
        }
        finally
        {
            versionGate.Release();
        }
    }

    /// <summary>
    /// <c>ClamAV 1.4.3/27700/Thu Sep 4 09:00:00 2026</c> becomes <c>ClamAV 1.4.3/27700</c>: the
    /// engine and the signature-database revision, which are the two facts that identify what
    /// inspected the bytes. The build date is dropped because evidence has room for forty characters
    /// and the date is the least identifying part of the line.
    /// </summary>
    /// <remarks>
    /// The shape is checked rather than assumed, and <c>null</c> means "not a version this can be
    /// bound to". Evidence exists to say which engine and which signature set inspected the exact
    /// stored bytes, so a reply that names neither is unusable metadata — an operational failure
    /// under MED-006 — and not something to record as though it identified anything. A signature
    /// revision is required for the same reason: an engine version alone does not say what it knew.
    /// </remarks>
    private static string? NormalizeVersion(string reply)
    {
        var cleaned = new string(reply.Where(character => !char.IsControl(character)).ToArray()).Trim();
        if (!cleaned.StartsWith(VersionPrefix, StringComparison.Ordinal))
        {
            return null;
        }

        var remainder = cleaned[VersionPrefix.Length..];
        var engineEnd = remainder.IndexOf('/', StringComparison.Ordinal);
        if (engineEnd <= 0)
        {
            return null;
        }

        var engine = remainder[..engineEnd];
        var afterEngine = remainder[(engineEnd + 1)..];
        var signaturesEnd = afterEngine.IndexOf('/', StringComparison.Ordinal);
        var signatures = signaturesEnd < 0 ? afterEngine : afterEngine[..signaturesEnd];
        if (!IsEngineVersion(engine) || !IsSignatureRevision(signatures))
        {
            return null;
        }

        var normalized = $"{VersionPrefix}{engine}/{signatures}";
        return normalized.Length > MaximumVersionLength ? null : normalized;
    }

    /// <summary>A dotted release, possibly with a build suffix: <c>1.5.4</c>, <c>1.4.3-rc1</c>.</summary>
    private static bool IsEngineVersion(string value) =>
        value.Length > 0 &&
        char.IsAsciiDigit(value[0]) &&
        value.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or '_');

    private static bool IsSignatureRevision(string value) =>
        value.Length > 0 && value.All(char.IsAsciiDigit);

    /// <summary>
    /// One bounded clamd exchange: connect, send one command, optionally stream a body as INSTREAM
    /// chunks, and read one NUL-terminated reply.
    /// </summary>
    /// <remarks>
    /// Owned rather than taken from a package: this is a handful of framing rules, and the ones that
    /// matter here are bounds — a connect timeout, a whole-exchange timeout, a capped reply, and a
    /// daemon that may stop reading the moment it recognises something, which is a normal outcome and
    /// not an error to propagate. A library that treated any of those as an exception, or that
    /// buffered the file to answer them, would have to be worked around rather than used.
    /// </remarks>
    private async Task<string> ExecuteAsync(
        string command,
        Stream? body,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(timeout);
        using var connection = new TcpClient();
        try
        {
            using (var connecting = CancellationTokenSource.CreateLinkedTokenSource(bounded.Token))
            {
                connecting.CancelAfter(TimeSpan.FromSeconds(options.ConnectTimeoutSeconds));
                await connection.ConnectAsync(options.Host, options.Port, connecting.Token);
            }

            var stream = connection.GetStream();
            await stream.WriteAsync(Encoding.ASCII.GetBytes(command), bounded.Token);

            if (body is not null)
            {
                await StreamBodyAsync(stream, body, bounded.Token);
            }

            await stream.FlushAsync(bounded.Token);
            return await ReadReplyAsync(stream, bounded.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            LogScannerFailure(logger, "scanner_timeout", null);
            throw new TimeoutException("The scanner did not answer within the configured bound.");
        }
        catch (SocketException)
        {
            LogScannerFailure(logger, "scanner_unreachable", null);
            throw new IOException("The scanner could not be reached.");
        }
    }

    /// <summary>
    /// The INSTREAM body: each chunk is a four-byte big-endian length followed by that many bytes,
    /// and a zero length ends the stream.
    /// </summary>
    /// <remarks>
    /// A write failure part-way through is not treated as the answer. <c>clamd</c> stops reading and
    /// replies as soon as it recognises something, so a broken pipe here frequently means a verdict
    /// is already waiting on the socket; the reply is read either way, and only an unreadable or
    /// unrecognised one becomes an operational failure.
    /// </remarks>
    private static async Task StreamBodyAsync(
        NetworkStream stream,
        Stream body,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[ClamAvScannerOptions.ChunkBytes];
        var header = new byte[4];
        while (true)
        {
            // Deliberately outside the socket's try: a stored object that cannot be read is a
            // storage failure and must surface as one, not be mistaken for a daemon that answered
            // early.
            var read = await body.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            BinaryPrimitives.WriteUInt32BigEndian(header, (uint)read);
            if (!await TryWriteAsync(stream, header, buffer.AsMemory(0, read), cancellationToken))
            {
                return;
            }
        }

        BinaryPrimitives.WriteUInt32BigEndian(header, 0);
        await TryWriteAsync(stream, header, null, cancellationToken);
    }

    /// <summary>Writes one frame, reporting rather than throwing when the daemon has stopped reading.</summary>
    private static async Task<bool> TryWriteAsync(
        NetworkStream stream,
        byte[] header,
        ReadOnlyMemory<byte>? chunk,
        CancellationToken cancellationToken)
    {
        try
        {
            await stream.WriteAsync(header, cancellationToken);
            if (chunk is { } payload)
            {
                await stream.WriteAsync(payload, cancellationToken);
            }

            return true;
        }
        catch (IOException)
        {
            return false;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private static async Task<string> ReadReplyAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[MaximumReplyBytes];
        var filled = 0;
        while (filled < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(filled), cancellationToken);
            if (read == 0)
            {
                break;
            }

            filled += read;
            var terminator = Array.IndexOf(buffer, (byte)0, 0, filled);
            if (terminator >= 0)
            {
                return Encoding.ASCII.GetString(buffer, 0, terminator).Trim();
            }
        }

        // Either the daemon closed before terminating its reply, or it sent more than any status
        // line it defines. Both are unterminated frames, and an unterminated frame is not a verdict:
        // accepting the leading bytes of one would let a truncated exchange read as a clean pass.
        throw new IOException("The scanner reply was not a complete frame.");
    }
}
