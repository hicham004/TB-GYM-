using Microsoft.AspNetCore.Hosting;

using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The API on a real socket, so the realtime tests exercise the path a browser takes.
/// </summary>
/// <remarks>
/// <c>WebApplicationFactory</c> hosts on <c>TestServer</c>, which has no listener: a SignalR client
/// pointed at it never performs a WebSocket handshake, never sends an <c>Origin</c> header, and never
/// exercises the negotiate round trip or the cookie the browser would actually attach. Every one of
/// those is something this phase has to get right, so the realtime suite runs against Kestrel on a
/// loopback port instead.
/// <para>
/// The pattern builds the host twice from the same builder: once for Kestrel, which is the one that
/// serves, and once for the <c>TestServer</c> the factory itself insists on. Two instances of the
/// same factory therefore give two genuinely independent API processes-in-one — separate service
/// providers, separate SignalR lifetime managers, separate caches — which is what the two-replica
/// test needs. They share nothing but the PostgreSQL database and the Redis backplane they are both
/// configured to use, which is exactly the production topology.
/// </para>
/// </remarks>
/// <param name="configure">
/// This replica's web-host configuration, applied to the factory itself.
/// <para>
/// Not <c>WithWebHostBuilder</c>: that returns a <b>new</b> factory and leaves the original
/// unconfigured, so a derived factory whose own members the test needs — the listening address here —
/// has to take its configuration through the constructor instead.
/// </para>
/// </param>
internal sealed class KestrelApiFactory(Action<IWebHostBuilder> configure)
    : WebApplicationFactory<Program>
{
    private IHost? kestrelHost;
    private Uri? serverAddress;

    protected override void ConfigureWebHost(IWebHostBuilder builder) => configure(builder);

    /// <summary>The loopback address this replica is actually listening on.</summary>
    public Uri ServerAddress =>
        serverAddress ?? throw new InvalidOperationException("The Kestrel host has not started.");

    protected override IHost CreateHost(IHostBuilder builder)
    {
        // The TestServer host the factory expects. It is built first because ConfigureWebHost below
        // mutates the builder, and the factory's plumbing wants a host it can dispose.
        var testHost = builder.Build();

        // The second host — the one that actually serves — from the same builder, which replays the
        // entry point and every recorded setting. Both builds therefore run everything `Main` does
        // before it starts listening, which is why this fixture applies migrations once, separately,
        // and configures both hosts not to.
        builder.ConfigureWebHost(webHost => webHost.UseKestrel().UseUrls("http://127.0.0.1:0"));
        kestrelHost = builder.Build();
        kestrelHost.Start();

        var addresses = kestrelHost.Services.GetRequiredService<IServer>().Features
            .Get<IServerAddressesFeature>();
        var address = addresses?.Addresses.FirstOrDefault()
            ?? throw new InvalidOperationException("Kestrel reported no listening address.");
        serverAddress = new Uri(address, UriKind.Absolute);
        ClientOptions.BaseAddress = serverAddress;

        testHost.Start();
        return testHost;
    }

    /// <summary>The service provider of the replica that is actually serving requests.</summary>
    public IServiceProvider ReplicaServices =>
        kestrelHost?.Services ?? throw new InvalidOperationException("The Kestrel host has not started.");

    /// <summary>
    /// Stops the Kestrel host asynchronously.
    /// </summary>
    /// <remarks>
    /// Asynchronous deliberately. Blocking on <c>StopAsync</c> from a synchronous <c>Dispose</c> —
    /// which is what the obvious version of this does — deadlocks the whole run once several test
    /// methods tear their hosts down at the same time: the thread waiting is one of the threads the
    /// shutdown needs.
    /// </remarks>
    public async ValueTask StopAsync()
    {
        if (kestrelHost is not null)
        {
            await kestrelHost.StopAsync();
            kestrelHost.Dispose();
            kestrelHost = null;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            // Disposed without waiting on shutdown; the async path above is the one the fixture uses.
            kestrelHost?.Dispose();
            kestrelHost = null;
        }

        base.Dispose(disposing);
    }
}
