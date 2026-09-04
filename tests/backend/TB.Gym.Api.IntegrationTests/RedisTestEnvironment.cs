using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// A real Redis instance, per test, for the scale-out and outage tests.
/// </summary>
/// <remarks>
/// Real Redis rather than a fake backplane, because the properties under test are properties of the
/// real one: that a frame published by one process reaches a connection held by another, and that a
/// send during an outage is lost rather than queued. A fake that delivered reliably would prove the
/// wiring compiles and would hide the one behaviour the durable event and the catch-up endpoint exist
/// to compensate for.
/// <para>
/// One container per test, on its own port, because the outage test stops Redis and the suite runs
/// methods in parallel. Stopping a shared instance would fail whatever else was using it.
/// </para>
/// </remarks>
internal static class RedisTestEnvironment
{
    /// <summary>
    /// Pinned, never <c>latest</c>. A backplane that silently changed version between a passing run
    /// and a failing one is a variable nobody can hold still.
    /// </summary>
    public const string Image = "redis:8.2.2-alpine";

    private const string RequiredVariable = "TB_GYM_REQUIRE_REDIS_TESTS";

    public static async Task<RedisInstance> StartAsync(string prefix)
    {
        var name = $"tbgym-redis-{prefix}-{Guid.NewGuid():N}"[..Math.Min(60, $"tbgym-redis-{prefix}-{Guid.NewGuid():N}".Length)];
        var port = FreeTcpPort();

        var run = await DockerAsync(
            "run",
            "--detach",
            "--name",
            name,
            "--publish",
            $"127.0.0.1:{port.ToString(CultureInfo.InvariantCulture)}:6379",
            // No persistence. This is a backplane: nothing durable is expected to survive it, and
            // saying so here keeps the test honest about what Redis is for.
            Image,
            "redis-server",
            "--save",
            string.Empty,
            "--appendonly",
            "no");
        if (run.ExitCode != 0)
        {
            Unavailable($"docker run failed: {run.Error}");
        }

        var instance = new RedisInstance(name, port);
        await instance.WaitUntilReadyAsync();
        return instance;
    }

    /// <summary>
    /// Refuses to skip when the gate variable says these tests are required.
    /// </summary>
    /// <remarks>
    /// The same shape as the PostgreSQL gate: a developer without Docker gets an inconclusive
    /// result, and CI and <c>scripts/check.ps1</c> set the variable so a missing backplane is a
    /// failure rather than a quietly skipped proof.
    /// </remarks>
    public static void Unavailable(string reason)
    {
        var required = string.Equals(
            Environment.GetEnvironmentVariable(RequiredVariable),
            "true",
            StringComparison.OrdinalIgnoreCase);
        if (required)
        {
            Assert.Fail($"Required Redis integration tests cannot run: {reason}");
        }

        Assert.Inconclusive($"Redis integration test skipped: {reason}");
    }

    internal static async Task<(int ExitCode, string Output, string Error)> DockerAsync(params string[] arguments)
    {
        var start = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        try
        {
            using var process = Process.Start(start);
            if (process is null)
            {
                return (-1, string.Empty, "docker could not be started.");
            }

            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            await process.WaitForExitAsync(timeout.Token);
            return (process.ExitCode, (await output).Trim(), (await error).Trim());
        }
        catch (Exception exception) when (exception is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return (-1, string.Empty, exception.Message);
        }
    }

    private static int FreeTcpPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}

/// <summary>One running Redis container, with the controls the outage test needs.</summary>
internal sealed class RedisInstance(string containerName, int port) : IAsyncDisposable
{
    /// <summary>
    /// Deliberately not resilient. <c>abortConnect=false</c> lets a client be created while Redis is
    /// down so the failure surfaces at send time — which is the state the outage test is about — and
    /// short timeouts keep a stopped backplane from stalling the sweep for minutes.
    /// </summary>
    public string ConnectionString { get; } =
        $"127.0.0.1:{port.ToString(CultureInfo.InvariantCulture)},abortConnect=false,connectTimeout=2000,syncTimeout=2000,connectRetry=1";

    public int Port { get; } = port;

    /// <summary>Stops the container. A send while it is down is lost, which is the point.</summary>
    public async Task StopAsync()
    {
        var result = await RedisTestEnvironment.DockerAsync("stop", "--timeout", "1", containerName);
        Assert.AreEqual(0, result.ExitCode, $"docker stop failed: {result.Error}");
    }

    public async Task StartAsync()
    {
        var result = await RedisTestEnvironment.DockerAsync("start", containerName);
        Assert.AreEqual(0, result.ExitCode, $"docker start failed: {result.Error}");
        await WaitUntilReadyAsync();
    }

    /// <summary>Waits for the port to accept a connection, rather than sleeping a guess.</summary>
    public async Task WaitUntilReadyAsync()
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                using var probe = new TcpClient();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await probe.ConnectAsync(IPAddress.Loopback, Port, timeout.Token);
                if (probe.Connected)
                {
                    return;
                }
            }
            catch (Exception exception) when (exception is SocketException or OperationCanceledException)
            {
                await Task.Delay(100);
            }
        }

        RedisTestEnvironment.Unavailable($"Redis on port {Port} did not become ready.");
    }

    /// <summary>Confirms the port is refusing connections, so an outage test is really testing one.</summary>
    public async Task WaitUntilUnreachableAsync()
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                using var probe = new TcpClient();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                await probe.ConnectAsync(IPAddress.Loopback, Port, timeout.Token);
                await Task.Delay(100);
            }
            catch (Exception exception) when (exception is SocketException or OperationCanceledException)
            {
                return;
            }
        }

        Assert.Fail($"Redis on port {Port} was still reachable after it was stopped.");
    }

    public async ValueTask DisposeAsync() =>
        await RedisTestEnvironment.DockerAsync("rm", "--force", "--volumes", containerName);
}
