using System.Security.Cryptography;
using Microsoft.Extensions.Logging.Abstractions;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The clamd adapter, against a local daemon that speaks the same framing.
/// </summary>
/// <remarks>
/// The verdicts a scanner returns are the ones this repository turns into a published asset or a
/// refused upload, so every answer the real daemon can give is scripted here — including the ones
/// that are not answers at all. No live engine, no signature database and no real malware sample is
/// involved: an <c>ERROR</c> line and a detection line are both just text on a socket, and testing
/// against a real virus would prove the same branch far less reliably.
/// </remarks>
[TestClass]
public sealed class Phase6B4BClamAvScannerTests
{
    private const string RealVersionLine = "ClamAV 1.5.4/28115/Sun Sep  6 06:26:06 2026";

    private static readonly Guid Tenant = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    private static readonly StorageObjectLocator Locator =
        new(Tenant, R2StorageOptions.LocationName, $"{Tenant:N}/object");

    [TestMethod]
    public async Task ACleanStreamIsAllowedAndRecordsTheEngineAndSignatureRevision()
    {
        var content = RandomNumberGenerator.GetBytes(200 * 1024);
        await using var daemon = FakeClamd.StartAnswering(RealVersionLine, "stream: OK");
        var scanner = ScannerFor(daemon, content);

        var result = await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);

        Assert.IsTrue(result.IsAllowed);
        Assert.AreEqual("ClamAV-clamd-instream", result.ScannerKey);
        Assert.AreEqual("ClamAV 1.5.4/28115", result.ScannerVersion);
        Assert.IsNull(result.FailureCode);

        // The evidence the application binds to the stored bytes must accept what the adapter says.
        var evidence = MediaScanEvidence.Record(
            Locator,
            Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant(),
            result,
            DateTimeOffset.UtcNow);
        Assert.AreEqual(MediaScanOutcome.Allowed, evidence.Outcome);
        Assert.IsLessThanOrEqualTo(40, evidence.ScannerVersion.Length);
    }

    [TestMethod]
    public async Task TheStoredBytesReachTheDaemonAsLengthPrefixedChunksEndedByAZeroLength()
    {
        var content = RandomNumberGenerator.GetBytes((ClamAvScannerOptions.ChunkBytes * 2) + 17);
        await using var daemon = FakeClamd.StartAnswering(RealVersionLine, "stream: OK");
        var scanner = ScannerFor(daemon, content);

        await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);

        var scan = daemon.Sessions.Single(session => session.Command == "zINSTREAM");
        Assert.IsTrue(scan.SawTerminator, "The stream was never terminated with a zero length.");
        CollectionAssert.AreEqual(content, scan.ReceivedBody);
        CollectionAssert.AreEqual(
            new[] { ClamAvScannerOptions.ChunkBytes, ClamAvScannerOptions.ChunkBytes, 17 },
            scan.ChunkSizes.ToArray());
    }

    [TestMethod]
    public async Task ADetectionRefusesTheFileWithoutNamingTheSignature()
    {
        await using var daemon = FakeClamd.StartAnswering(
            RealVersionLine,
            "stream: Eicar-Test-Signature FOUND");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        var result = await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);

        Assert.IsFalse(result.IsAllowed);
        Assert.AreEqual("scan_refused", result.FailureCode);
        Assert.AreEqual("ClamAV 1.5.4/28115", result.ScannerVersion);
        foreach (var value in new[] { result.FailureCode, result.ScannerKey, result.ScannerVersion })
        {
            Assert.DoesNotContain(
                "Eicar",
                value!,
                StringComparison.OrdinalIgnoreCase,
                "The signature name escaped into the scan result.");
        }
    }

    /// <summary>
    /// clamd answers the moment it recognises something, without waiting for the rest of the stream.
    /// The adapter has to accept a verdict that was already waiting when it finished writing.
    /// </summary>
    [TestMethod]
    public async Task ADetectionAnsweredBeforeTheStreamEndsIsStillARefusal()
    {
        await using var daemon = FakeClamd.Start(async session =>
        {
            if (session.Command != "zINSTREAM")
            {
                await session.ReplyAsync(session.Command == "zPING" ? "PONG" : RealVersionLine);
                return;
            }

            await session.ReadOneChunkAsync();
            await session.ReplyAsync("stream: Eicar-Test-Signature FOUND");
            // The remainder is drained rather than answered by closing the socket. A real daemon
            // does close early and the adapter tolerates the broken pipe that causes; forcing that
            // race here would make the assertion depend on whether the reply survived a reset.
            await session.ReadInstreamAsync();
        });
        var scanner = ScannerFor(daemon, RandomNumberGenerator.GetBytes(ClamAvScannerOptions.ChunkBytes * 6));

        var result = await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);

        Assert.IsFalse(result.IsAllowed);
        Assert.AreEqual("scan_refused", result.FailureCode);
    }

    /// <summary>
    /// Only the two frames clamd defines are verdicts. The suffix cases matter most: a reply that
    /// merely ends in the right word is not a reply the daemon formed, and reading one as clean is
    /// the single mistake in this adapter that would fail open.
    /// </summary>
    [TestMethod]
    [DataRow("INSTREAM size limit exceeded. ERROR", DisplayName = "a configured daemon limit")]
    [DataRow("stream: Can't allocate memory ERROR", DisplayName = "an engine error")]
    [DataRow("stream: something unexpected", DisplayName = "an unrecognised reply")]
    [DataRow("", DisplayName = "an empty reply")]
    [DataRow("garbage OK", DisplayName = "a malformed frame ending in OK")]
    [DataRow("OK", DisplayName = "a bare OK with no frame around it")]
    [DataRow("stream: OK extra", DisplayName = "a clean verdict with trailing content")]
    [DataRow("stream:OK", DisplayName = "a clean verdict missing its separator")]
    [DataRow("1: stream: OK", DisplayName = "a session-framed clean verdict this adapter never asks for")]
    [DataRow("garbage FOUND", DisplayName = "a malformed frame ending in FOUND")]
    [DataRow("stream: FOUND", DisplayName = "a detection naming no signature")]
    [DataRow(" FOUND", DisplayName = "a bare FOUND with no frame around it")]
    // NUL ends the record, so the bytes before it are the whole reply. None of these are frames the
    // daemon sends, and none of them may become one by having whitespace taken off first.
    [DataRow("stream: OK ", DisplayName = "a clean verdict with a trailing space")]
    [DataRow(" stream: OK", DisplayName = "a clean verdict with a leading space")]
    [DataRow("stream: OK\n", DisplayName = "a clean verdict with the line terminator this adapter never asks for")]
    [DataRow("stream: OK\t", DisplayName = "a clean verdict with a trailing tab")]
    [DataRow("stream:   FOUND", DisplayName = "a detection whose signature is only whitespace")]
    [DataRow("stream: \t FOUND", DisplayName = "a detection whose signature is only blank characters")]
    public async Task AnythingThatIsNotAVerdictIsAnOperationalFailure(string reply)
    {
        await using var daemon = FakeClamd.StartAnswering(RealVersionLine, reply);
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    /// <summary>
    /// Evidence names the engine and the signature set that inspected the exact stored bytes, so a
    /// version reply that names neither is unusable metadata rather than something to record.
    /// </summary>
    [TestMethod]
    [DataRow("", DisplayName = "an empty version")]
    [DataRow("PONG", DisplayName = "an answer to a different command")]
    [DataRow("ClamAV", DisplayName = "a product name with no version at all")]
    [DataRow("ClamAV 1.5.4", DisplayName = "an engine with no signature revision")]
    [DataRow("ClamAV /28115/Sun Sep  6 06:26:06 2026", DisplayName = "a missing engine version")]
    [DataRow("ClamAV x.y.z/28115", DisplayName = "an engine version that is not one")]
    [DataRow("ClamAV 1.5.4/latest", DisplayName = "a signature revision that is not a number")]
    [DataRow("SomethingElse 1.5.4/28115", DisplayName = "a different product")]
    [DataRow("ClamAV 1.5.4/28115 FOUND", DisplayName = "a verdict where a version belongs")]
    [DataRow(" ClamAV 1.5.4/28115", DisplayName = "a version with a leading space")]
    [DataRow("ClamAV 1.5.4/28115 ", DisplayName = "a version with a trailing space")]
    [DataRow("ClamAV 1.5 .4/28115", DisplayName = "a version with whitespace inside the engine")]
    public async Task AVersionThatCannotIdentifyTheEngineIsAnOperationalFailure(string version)
    {
        await using var daemon = FakeClamd.StartAnswering(version, "stream: OK");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    /// <summary>
    /// A control byte never reaches the version parser: the frame carrying it is refused first, as
    /// no status line clamd defines contains one. Both failures are operational and report 503.
    /// </summary>
    [TestMethod]
    public async Task AVersionFrameCarryingAControlByteIsRefusedAtTheFrameBoundary()
    {
        await using var daemon = FakeClamd.StartAnswering("ClamAV 1.5.4/28115\n", "stream: OK");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    /// <summary>The real shapes, including a release with a build suffix.</summary>
    [TestMethod]
    [DataRow("ClamAV 1.5.4/28115/Sun Sep  6 06:26:06 2026", "ClamAV 1.5.4/28115")]
    [DataRow("ClamAV 1.4.3-rc1/27700/Thu Sep  4 09:00:00 2026", "ClamAV 1.4.3-rc1/27700")]
    [DataRow("ClamAV 1.5.4/28115", "ClamAV 1.5.4/28115")]
    public async Task AUsableVersionIsRecordedAsTheEngineAndItsSignatureRevision(
        string reply,
        string expected)
    {
        await using var daemon = FakeClamd.StartAnswering(reply, "stream: OK");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        var result = await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);

        Assert.AreEqual(expected, result.ScannerVersion);
    }

    [TestMethod]
    public async Task ADaemonThatDisconnectsWithoutAnsweringIsAnOperationalFailure()
    {
        await using var daemon = FakeClamd.Start(async session =>
        {
            if (session.Command == "zVERSION")
            {
                await session.ReplyAsync(RealVersionLine);
                return;
            }

            await session.ReadInstreamAsync();
            session.Close();
        });
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    [TestMethod]
    public async Task AnUnterminatedReplyIsAnOperationalFailureRatherThanACleanPass()
    {
        await using var daemon = FakeClamd.Start(async session =>
        {
            if (session.Command == "zVERSION")
            {
                await session.ReplyAsync(RealVersionLine);
                return;
            }

            await session.ReadInstreamAsync();
            await session.ReplyUnterminatedAsync("stream: OK");
            session.Close();
        });
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    [TestMethod]
    public async Task AnOverLongReplyIsAnOperationalFailure()
    {
        await using var daemon = FakeClamd.StartAnswering(
            RealVersionLine,
            new string('x', 4096) + " OK");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    [TestMethod]
    public async Task ADaemonThatNeverAnswersTimesOut()
    {
        await using var daemon = FakeClamd.Start(async session =>
        {
            if (session.Command == "zVERSION")
            {
                await session.ReplyAsync(RealVersionLine);
                return;
            }

            await session.ReadInstreamAsync();
            await Task.Delay(TimeSpan.FromMinutes(5));
        });
        var scanner = ScannerFor(daemon, [1, 2, 3, 4], scanTimeoutSeconds: 5);

        await Assert.ThrowsAsync<TimeoutException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    /// <summary>
    /// Evidence holds forty characters. A version that does not fit is truncated into something that
    /// claims to identify an engine it does not, so it is refused as unusable metadata instead.
    /// </summary>
    [TestMethod]
    public async Task AVersionTooLongForEvidenceIsRefusedRatherThanTruncated()
    {
        await using var daemon = FakeClamd.StartAnswering(
            $"ClamAV {new string('9', 60)}/28115/Sun Sep  6 06:26:06 2026",
            "stream: OK");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    [TestMethod]
    public async Task StorageThatCannotOpenTheStoredObjectIsAnOperationalFailure()
    {
        await using var daemon = FakeClamd.StartAnswering(RealVersionLine, "stream: OK");
        var scanner = new ClamAvMediaScanner(
            new UnreadableStorage(),
            OptionsFor(daemon),
            NullLogger<ClamAvMediaScanner>.Instance);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    /// <summary>
    /// A high byte would otherwise be decoded to <c>?</c> and could complete a frame that parses;
    /// a control byte is not part of any status line either. Both are refused, not decoded.
    /// </summary>
    [TestMethod]
    public async Task AReplyCarryingBytesNoStatusLineUsesIsAnOperationalFailure()
    {
        await using var daemon = FakeClamd.Start(async session =>
        {
            if (session.Command == "zVERSION")
            {
                await session.ReplyAsync(RealVersionLine);
                return;
            }

            await session.ReadInstreamAsync();
            await session.ReplyBytesAsync([.. "stream: "u8.ToArray(), 0xff, 0x01, .. " FOUND\0"u8.ToArray()]);
        });
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await Assert.ThrowsAsync<IOException>(() =>
            scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None));
    }

    [TestMethod]
    public async Task TheReadinessProbeAnswersOnlyWhenTheDaemonDoes()
    {
        await using var daemon = FakeClamd.StartAnswering(RealVersionLine, "stream: OK");
        var reachable = ScannerFor(daemon, [1]);
        var unreachable = new ClamAvMediaScanner(
            new InMemoryStorage([1]),
            new ClamAvScannerOptions
            {
                Host = "127.0.0.1",
                // Nothing listens here; the probe must report that rather than throw or hang.
                Port = 1,
                ConnectTimeoutSeconds = 1,
                ProbeTimeoutSeconds = 2,
            },
            NullLogger<ClamAvMediaScanner>.Instance);

        Assert.IsTrue(await reachable.ProbeAsync(CancellationToken.None));
        Assert.IsFalse(await unreachable.ProbeAsync(CancellationToken.None));
        Assert.IsTrue(reachable.IsAvailable, "A composed scanner is available; reachability is readiness.");
    }

    [TestMethod]
    public async Task TheVersionIsResolvedOnceAndReusedAcrossScans()
    {
        await using var daemon = FakeClamd.StartAnswering(RealVersionLine, "stream: OK");
        var scanner = ScannerFor(daemon, [1, 2, 3, 4]);

        await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);
        await scanner.ScanAsync(Locator, "image/jpeg", CancellationToken.None);

        Assert.AreEqual(
            1,
            daemon.Sessions.Count(session => session.Command == "zVERSION"),
            "The engine version was re-read on every upload.");
        Assert.AreEqual(2, daemon.Sessions.Count(session => session.Command == "zINSTREAM"));
    }

    private static ClamAvMediaScanner ScannerFor(
        FakeClamd daemon,
        byte[] content,
        int scanTimeoutSeconds = 30) =>
        new(
            new InMemoryStorage(content),
            OptionsFor(daemon, scanTimeoutSeconds),
            NullLogger<ClamAvMediaScanner>.Instance);

    private static ClamAvScannerOptions OptionsFor(FakeClamd daemon, int scanTimeoutSeconds = 30) =>
        new()
        {
            Host = "127.0.0.1",
            Port = daemon.Port,
            ConnectTimeoutSeconds = 5,
            ScanTimeoutSeconds = scanTimeoutSeconds,
            ProbeTimeoutSeconds = 5,
        };

    /// <summary>The stored object the scanner streams, without a provider behind it.</summary>
    private sealed class InMemoryStorage(byte[] content) : IObjectStorage
    {
        public string WriteLocation => R2StorageOptions.LocationName;

        public bool IsAvailable => true;

        public Task<ObjectWriteResult> PutAsync(ObjectUpload upload, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ObjectReadResult> ReadAsync(
            ObjectReadRequest request,
            CancellationToken cancellationToken) =>
            Task.FromResult(new ObjectReadResult(
                ObjectStorageOperationStatus.Success,
                new MemoryStream(content),
                new ObjectReadMetadata(content.Length, request.ContentType, null)));

        public Task<ObjectDeleteResult> DeleteAsync(
            StorageObjectLocator locator,
            CancellationToken cancellationToken) =>
            Task.FromResult(new ObjectDeleteResult(ObjectStorageOperationStatus.Success));
    }

    private sealed class UnreadableStorage : IObjectStorage
    {
        public string WriteLocation => R2StorageOptions.LocationName;

        public bool IsAvailable => true;

        public Task<ObjectWriteResult> PutAsync(ObjectUpload upload, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<ObjectReadResult> ReadAsync(
            ObjectReadRequest request,
            CancellationToken cancellationToken) =>
            Task.FromResult(new ObjectReadResult(
                ObjectStorageOperationStatus.Failed,
                FailureCode: "storage_provider_unavailable"));

        public Task<ObjectDeleteResult> DeleteAsync(
            StorageObjectLocator locator,
            CancellationToken cancellationToken) =>
            Task.FromResult(new ObjectDeleteResult(ObjectStorageOperationStatus.Success));
    }
}
