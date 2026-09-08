using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using Amazon.Runtime;
using Amazon.S3;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// A local S3 bucket: the same protocol Cloudflare R2 speaks, answered in memory.
/// </summary>
/// <remarks>
/// The adapter is exercised through the real AWS SDK — real signing, real multipart XML, real
/// ranged GETs and real error shapes — with the socket replaced rather than the client. A test
/// double injected at <c>IAmazonS3</c> would prove the adapter's own branches and nothing about the
/// requests it actually makes, and a live bucket would make the suite depend on a Cloudflare
/// account, a network and somebody's credential.
/// </remarks>
internal sealed class FakeS3Bucket
{
    public ConcurrentDictionary<string, FakeS3Object> Objects { get; } = new(StringComparer.Ordinal);

    public ConcurrentDictionary<string, ConcurrentDictionary<int, byte[]>> ActiveUploads { get; } =
        new(StringComparer.Ordinal);

    public ConcurrentBag<string> AbortedUploads { get; } = [];

    public ConcurrentQueue<FakeS3Request> Requests { get; } = new();

    /// <summary>The provider's answer, replaced for one operation, so failures can be exact.</summary>
    public Func<FakeS3Request, HttpResponseMessage?>? Fault { get; set; }

    /// <summary>Returns a stale 200 for a ranged read, as a provider that ignored Range would.</summary>
    public bool IgnoreRangeRequests { get; set; }

    /// <summary>Every body handed to the SDK, so a test can see whether the caller disposed it.</summary>
    public ConcurrentQueue<TrackingStream> ServedBodies { get; } = new();

    public int RequestCount => Requests.Count;

    public IReadOnlyList<FakeS3Request> RecordedRequests => [.. Requests];

    public byte[] this[string key] => Objects[key].Content;
}

internal sealed record FakeS3Object(byte[] Content, string? ContentType, string ETag);

internal sealed record FakeS3Request(
    string Method,
    string Authority,
    string Path,
    string Query,
    IReadOnlyDictionary<string, string> Headers,
    byte[] Body)
{
    public string? Header(string name) => Headers.TryGetValue(name, out var value) ? value : null;
}

/// <summary>Serves <see cref="FakeS3Bucket"/> over the SDK's own HTTP pipeline.</summary>
internal sealed class FakeS3Handler(FakeS3Bucket bucket) : HttpMessageHandler
{
    private const string Namespace = "http://s3.amazonaws.com/doc/2006-03-01/";

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var uri = request.RequestUri!;
        var body = request.Content is null
            ? []
            : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        var headers = request.Headers
            .Concat(request.Content?.Headers ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>())
            .ToDictionary(header => header.Key, header => string.Join(",", header.Value), StringComparer.OrdinalIgnoreCase);
        var recorded = new FakeS3Request(
            request.Method.Method,
            uri.Authority,
            Uri.UnescapeDataString(uri.AbsolutePath),
            uri.Query,
            headers,
            body);
        bucket.Requests.Enqueue(recorded);

        if (bucket.Fault?.Invoke(recorded) is { } fault)
        {
            return fault;
        }

        // Path-style addressing: /{bucket}/{key}. The key keeps its own slashes.
        var segments = recorded.Path.TrimStart('/').Split('/', 2);
        var key = segments.Length > 1 ? segments[1] : string.Empty;
        var query = ParseQuery(uri.Query);
        query.TryGetValue("uploadId", out var uploadId);
        query.TryGetValue("partNumber", out var partNumber);

        if (request.Method == HttpMethod.Post && query.ContainsKey("uploads"))
        {
            var newUploadId = Guid.NewGuid().ToString("N");
            bucket.ActiveUploads[newUploadId] = new ConcurrentDictionary<int, byte[]>();
            return Xml(
                HttpStatusCode.OK,
                $"""<InitiateMultipartUploadResult xmlns="{Namespace}"><Bucket>{segments[0]}</Bucket><Key>{key}</Key><UploadId>{newUploadId}</UploadId></InitiateMultipartUploadResult>""");
        }

        if (request.Method == HttpMethod.Put && uploadId is not null && partNumber is not null)
        {
            if (!bucket.ActiveUploads.TryGetValue(uploadId, out var parts))
            {
                return Error(HttpStatusCode.NotFound, "NoSuchUpload");
            }

            parts[int.Parse(partNumber, CultureInfo.InvariantCulture)] = body;
            return Ok(EtagOf(body));
        }

        if (request.Method == HttpMethod.Post && uploadId is not null)
        {
            if (!bucket.ActiveUploads.TryRemove(uploadId, out var parts))
            {
                return Error(HttpStatusCode.NotFound, "NoSuchUpload");
            }

            var assembled = parts.OrderBy(part => part.Key)
                .SelectMany(part => part.Value)
                .ToArray();
            // The multipart form of an S3 ETag: a digest of the parts' digests, then the part count.
            // It is not the digest of the object, which is precisely why an ETag is not a checksum.
            var multipartEtag = $"{EtagOf(assembled)}-{parts.Count}";
            bucket.Objects[key] = new FakeS3Object(assembled, null, multipartEtag);
            return Xml(
                HttpStatusCode.OK,
                $"""<CompleteMultipartUploadResult xmlns="{Namespace}"><Bucket>{segments[0]}</Bucket><Key>{key}</Key><ETag>"{multipartEtag}"</ETag></CompleteMultipartUploadResult>""");
        }

        if (request.Method == HttpMethod.Delete && uploadId is not null)
        {
            bucket.ActiveUploads.TryRemove(uploadId, out _);
            bucket.AbortedUploads.Add(uploadId);
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        }

        if (request.Method == HttpMethod.Put)
        {
            bucket.Objects[key] = new FakeS3Object(
                body,
                request.Content?.Headers.ContentType?.ToString(),
                EtagOf(body));
            return Ok(EtagOf(body));
        }

        if (request.Method == HttpMethod.Get || request.Method == HttpMethod.Head)
        {
            if (!bucket.Objects.TryGetValue(key, out var stored))
            {
                return Error(HttpStatusCode.NotFound, "NoSuchKey");
            }

            if (request.Method == HttpMethod.Head)
            {
                var head = Ok(stored.ETag);
                head.Content = new ByteArrayContent([]);
                head.Content.Headers.ContentLength = stored.Content.Length;
                return head;
            }

            var range = request.Headers.Range?.Ranges.SingleOrDefault();
            if (range is null || bucket.IgnoreRangeRequests)
            {
                var full = Ok(stored.ETag);
                full.Content = Body(stored.Content);
                return full;
            }

            var from = (int)range.From!.Value;
            var to = (int)range.To!.Value;
            var partial = new HttpResponseMessage(HttpStatusCode.PartialContent)
            {
                Content = Body(stored.Content[from..(to + 1)]),
            };
            partial.Headers.ETag = new EntityTagHeaderValue($"\"{stored.ETag}\"");
            partial.Content.Headers.ContentRange =
                new ContentRangeHeaderValue(from, to, stored.Content.Length);
            return partial;
        }

        if (request.Method == HttpMethod.Delete)
        {
            bucket.Objects.TryRemove(key, out _);
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        }

        return Error(HttpStatusCode.MethodNotAllowed, "MethodNotAllowed");
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var parsed = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=', StringComparison.Ordinal);
            parsed[separator < 0 ? pair : pair[..separator]] =
                separator < 0 ? string.Empty : Uri.UnescapeDataString(pair[(separator + 1)..]);
        }

        return parsed;
    }

    /// <summary>
    /// An S3 ETag, in the form the protocol actually uses: the MD5 of a single-part body.
    /// </summary>
    /// <remarks>
    /// MD5 is the protocol's own tag rather than a security control here, and it has to be exactly
    /// that: the SDK verifies a single-part <c>GET</c> against it, so a fake that invented an opaque
    /// value would fail reads the real provider serves. The point being tested is the opposite one —
    /// that the adapter records its own SHA-256 over the bytes it streamed and never derives
    /// integrity from this value, which the multipart form above makes plainly impossible.
    /// </remarks>
#pragma warning disable CA5351 // The S3 ETag is defined as MD5; this reproduces the provider, not a hash choice.
    internal static string EtagOf(byte[] content) =>
        Convert.ToHexString(System.Security.Cryptography.MD5.HashData(content)).ToLowerInvariant();
#pragma warning restore CA5351

    /// <summary>
    /// A response body whose disposal is observable, with the length stated as a provider states it.
    /// </summary>
    private StreamContent Body(byte[] content)
    {
        var tracked = new TrackingStream(content);
        bucket.ServedBodies.Enqueue(tracked);
        var body = new StreamContent(tracked);
        body.Headers.ContentLength = content.Length;
        return body;
    }

    private static HttpResponseMessage Ok(string etag)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([]),
        };
        response.Headers.ETag = new EntityTagHeaderValue($"\"{etag}\"");
        return response;
    }

    private static HttpResponseMessage Xml(HttpStatusCode status, string body) =>
        new(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/xml"),
        };

    internal static HttpResponseMessage Error(HttpStatusCode status, string code) =>
        new(status)
        {
            Content = new StringContent(
                $"<Error><Code>{code}</Code><Message>Refused by the fake bucket.</Message><RequestId>fake</RequestId><HostId>fake</HostId></Error>",
                Encoding.UTF8,
                "application/xml"),
        };
}

/// <summary>Hands the SDK the fake transport in place of a real socket.</summary>
internal sealed class FakeS3HttpClientFactory(FakeS3Bucket bucket) : HttpClientFactory
{
    public override HttpClient CreateHttpClient(IClientConfig clientConfig) =>
        new(new FakeS3Handler(bucket));

    public override bool UseSDKHttpClientCaching(IClientConfig clientConfig) => false;

    public override bool DisposeHttpClientsAfterUse(IClientConfig clientConfig) => true;
}

/// <summary>
/// A local <c>clamd</c>: one TCP listener that speaks the framing the real daemon speaks and answers
/// whatever the test needs it to.
/// </summary>
/// <remarks>
/// Every case the adapter has to classify — a clean pass, a detection, an error reply, a size-limit
/// refusal, silence, a mid-stream disconnect and an unterminated frame — is a scripted answer here,
/// which makes them deterministic and keeps the suite free of a real virus signature, a real engine
/// and a real network.
/// </remarks>
internal sealed class FakeClamd : IAsyncDisposable
{
    private readonly TcpListener listener;
    private readonly CancellationTokenSource stopping = new();
    private readonly Task loop;

    private FakeClamd(TcpListener listener, Func<FakeClamdSession, Task> handle)
    {
        this.listener = listener;
        loop = AcceptAsync(handle);
    }

    public int Port => ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;

    /// <summary>What the daemon received: the command, then the reassembled INSTREAM body.</summary>
    public ConcurrentQueue<FakeClamdSession> Sessions { get; } = new();

    public static FakeClamd Start(Func<FakeClamdSession, Task> handle)
    {
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        return new FakeClamd(listener, handle);
    }

    /// <summary>The common case: one scripted reply per command, terminated as clamd terminates it.</summary>
    public static FakeClamd StartAnswering(string version, string instreamReply) =>
        Start(async session =>
        {
            if (session.Command == "zVERSION")
            {
                await session.ReplyAsync(version);
                return;
            }

            if (session.Command == "zPING")
            {
                await session.ReplyAsync("PONG");
                return;
            }

            await session.ReadInstreamAsync();
            await session.ReplyAsync(instreamReply);
        });

    private async Task AcceptAsync(Func<FakeClamdSession, Task> handle)
    {
        while (!stopping.IsCancellationRequested)
        {
            TcpClient connection;
            try
            {
                connection = await listener.AcceptTcpClientAsync(stopping.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (SocketException)
            {
                return;
            }

            _ = Task.Run(async () =>
            {
                using var owned = connection;
                var session = new FakeClamdSession(owned);
                try
                {
                    await session.ReadCommandAsync();
                    Sessions.Enqueue(session);
                    await handle(session);
                }
                catch (IOException)
                {
                    // A test that closes the socket early is exercising exactly that.
                }
                catch (SocketException)
                {
                }
            });
        }
    }

    public async ValueTask DisposeAsync()
    {
        await stopping.CancelAsync();
        listener.Stop();
        try
        {
            await loop;
        }
        catch (OperationCanceledException)
        {
        }

        stopping.Dispose();
    }
}

internal sealed class FakeClamdSession(TcpClient connection)
{
    private readonly NetworkStream stream = connection.GetStream();
    private readonly List<byte> received = [];

    public string Command { get; private set; } = string.Empty;

    /// <summary>The bytes the daemon was given, reassembled from their length-prefixed chunks.</summary>
    public byte[] ReceivedBody => [.. received];

    public IList<int> ChunkSizes { get; } = [];

    public bool SawTerminator { get; private set; }

    public async Task ReadCommandAsync()
    {
        var buffer = new byte[64];
        var filled = 0;
        while (filled < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(filled, 1));
            if (read == 0)
            {
                break;
            }

            if (buffer[filled] == 0)
            {
                Command = Encoding.ASCII.GetString(buffer, 0, filled);
                return;
            }

            filled += read;
        }

        Command = Encoding.ASCII.GetString(buffer, 0, filled);
    }

    public async Task ReadInstreamAsync()
    {
        var header = new byte[4];
        while (true)
        {
            if (!await ReadExactlyAsync(header))
            {
                return;
            }

            var length = (int)BinaryPrimitives.ReadUInt32BigEndian(header);
            if (length == 0)
            {
                SawTerminator = true;
                return;
            }

            ChunkSizes.Add(length);
            var chunk = new byte[length];
            if (!await ReadExactlyAsync(chunk))
            {
                return;
            }

            received.AddRange(chunk);
        }
    }

    /// <summary>Reads one chunk header, so a test can answer part-way through a stream.</summary>
    public async Task<bool> ReadOneChunkAsync()
    {
        var header = new byte[4];
        if (!await ReadExactlyAsync(header))
        {
            return false;
        }

        var length = (int)BinaryPrimitives.ReadUInt32BigEndian(header);
        if (length == 0)
        {
            SawTerminator = true;
            return false;
        }

        ChunkSizes.Add(length);
        var chunk = new byte[length];
        if (!await ReadExactlyAsync(chunk))
        {
            return false;
        }

        received.AddRange(chunk);
        return true;
    }

    public Task ReplyAsync(string text) =>
        stream.WriteAsync(Encoding.ASCII.GetBytes(text + "\0")).AsTask();

    /// <summary>Answers without the terminator clamd always sends, which is a malformed frame.</summary>
    public Task ReplyUnterminatedAsync(string text) =>
        stream.WriteAsync(Encoding.ASCII.GetBytes(text)).AsTask();

    /// <summary>Answers with exact bytes, for frames that are not representable as ASCII text.</summary>
    public Task ReplyBytesAsync(byte[] frame) => stream.WriteAsync(frame).AsTask();

    public void Close() => connection.Close();

    private async Task<bool> ReadExactlyAsync(byte[] destination)
    {
        var filled = 0;
        while (filled < destination.Length)
        {
            var read = await stream.ReadAsync(destination.AsMemory(filled));
            if (read == 0)
            {
                return false;
            }

            filled += read;
        }

        return true;
    }
}

/// <summary>A response body that remembers whether the caller disposed it.</summary>
internal sealed class TrackingStream(byte[] content) : MemoryStream(content, writable: false)
{
    public bool IsDisposed { get; private set; }

    protected override void Dispose(bool disposing)
    {
        IsDisposed = true;
        base.Dispose(disposing);
    }
}

/// <summary>
/// The composed production providers for one API fixture: a local bucket and a local daemon, with
/// the configuration that makes the application select them.
/// </summary>
/// <remarks>
/// It starts only for tests that ask for it by name, so the rest of the suite keeps the local
/// adapter and the switchable scanner it was written against. What is real here is everything above
/// the socket: the selection, the validated options, the S3 requests and the INSTREAM framing.
/// </remarks>
internal sealed class Phase6B4BProviderHarness : IAsyncDisposable
{
    private const string VersionLine = "ClamAV 1.5.4/28115/Sun Sep  6 06:26:06 2026";

    private Phase6B4BProviderHarness()
    {
        Daemon = FakeClamd.Start(async session =>
        {
            if (session.Command == "zVERSION")
            {
                await session.ReplyAsync(VersionLine);
                return;
            }

            if (session.Command == "zPING")
            {
                await session.ReplyAsync("PONG");
                return;
            }

            await session.ReadInstreamAsync();
            await session.ReplyAsync(InstreamReply);
        });
    }

    public FakeS3Bucket Bucket { get; } = new();

    public FakeClamd Daemon { get; }

    /// <summary>The daemon's verdict, so one test can make it a detection and another an error.</summary>
    public string InstreamReply { get; set; } = "stream: OK";

    public IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Media:StorageAdapter"] = "R2",
        ["Media:R2:AccountId"] = "0123456789abcdef0123456789abcdef",
        ["Media:R2:BucketName"] = "tb-gym-media",
        ["Media:R2:AccessKeyId"] = "0123456789abcdef0123456789abcdef",
        ["Media:R2:SecretAccessKey"] = "topsecret0123456789abcdefsecret0",
        ["Media:ScannerAdapter"] = "ClamAv",
        ["Media:ClamAv:Host"] = "127.0.0.1",
        ["Media:ClamAv:Port"] = Daemon.Port.ToString(CultureInfo.InvariantCulture),
        ["Media:ClamAv:ConnectTimeoutSeconds"] = "5",
        ["Media:ClamAv:ScanTimeoutSeconds"] = "30",
        ["Media:ClamAv:ProbeTimeoutSeconds"] = "5",
    };

    /// <summary>Applies the harness settings over the fixture's defaults, if one is running.</summary>
    public static Dictionary<string, string?> Merge(
        Phase6B4BProviderHarness? harness,
        Dictionary<string, string?> settings)
    {
        foreach (var (key, value) in harness?.Settings ?? new Dictionary<string, string?>())
        {
            settings[key] = value;
        }

        return settings;
    }

    public static Phase6B4BProviderHarness? StartIfRequestedBy(string? testName) =>
        testName?.StartsWith("Phase6B4BOverProviders", StringComparison.Ordinal) == true
            ? new Phase6B4BProviderHarness()
            : null;

    public ValueTask DisposeAsync() => Daemon.DisposeAsync();
}
