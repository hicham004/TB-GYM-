using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

// Both namespaces above define an IPNetwork. The framework's own type is obsolete in favour of the
// runtime one, and ForwardedHeadersOptions.KnownIPNetworks is the property that takes it, so the
// alias names the type this file means rather than leaving the choice to using order.
using IPNetwork = System.Net.IPNetwork;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// Which reverse proxies, if any, this deployment believes about a request's origin.
/// </summary>
/// <remarks>
/// <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> are request headers, which is to say they are
/// attacker-controlled until something says otherwise. The only thing that can say otherwise is the
/// address the connection actually came from, so honouring them is a statement about the network:
/// "requests reaching this process from <em>these</em> addresses have already been through our edge,
/// and what they claim about the client is ours rather than the caller's."
/// <para>
/// Enabling forwarding without naming that network is the failure this contract exists to prevent.
/// ASP.NET Core's defaults trust loopback and nothing else — measured on this runtime as
/// <c>KnownProxies = [::1]</c> and <c>KnownIPNetworks = [127.0.0.0/8]</c> — so a reverse proxy in
/// another container, on another host or behind a service mesh is not trusted, and every forwarded
/// value it sends is silently discarded. <c>RemoteIpAddress</c> stays the proxy's own address, and
/// the per-address rate limiters in <c>DependencyInjection</c> — public authentication and the
/// provider webhook — collapse onto one partition shared by every caller in the world. That is not a
/// rejected request or a logged warning; it is a limiter that still appears to work.
/// </para>
/// <para>
/// Those loopback defaults are kept rather than replaced, which is a deliberate trade worth naming:
/// anything able to open a connection from <c>127.0.0.0/8</c> or <c>::1</c> is believed about the
/// client address whether or not an operator listed it. In a container that is the container itself
/// and its sidecars, which is why it is acceptable — and why the API must be bound to a private
/// interface and never reachable directly from outside the deployment.
/// </para>
/// <para>
/// The opposite mistake is worse and is refused here in three separate places. Clearing
/// <c>KnownProxies</c> and <c>KnownNetworks</c> — the recipe every search result offers — does not
/// mean "no restriction", it means the middleware stops checking at all and believes any caller;
/// this composition only ever <em>adds</em> to the framework's defaults. A configured network of
/// <c>0.0.0.0/0</c> or <c>::/0</c> is that same "trust everyone" expressed as data, so a zero prefix
/// length is refused. And an unspecified address is refused because <c>0.0.0.0</c> is not a proxy.
/// </para>
/// <para>
/// Disabled is a real answer and the default one. A deployment reached directly, with no proxy in
/// front of it, must not honour these headers from anybody — there is no edge to have set them, so
/// every value is the caller's own invention.
/// </para>
/// </remarks>
public sealed class ReverseProxyOptions
{
    public const string SectionName = "ReverseProxy";

    private readonly List<IPAddress> resolvedProxies = [];
    private readonly List<IPNetwork> resolvedNetworks = [];

    /// <summary>
    /// Whether this deployment sits behind a reverse proxy whose forwarded headers it will honour.
    /// </summary>
    /// <remarks>
    /// Deliberately opt-in and deliberately not inferred. There is no signal available at startup
    /// that distinguishes "behind an edge" from "directly reachable", and guessing wrong in the
    /// permissive direction is the whole vulnerability.
    /// </remarks>
    public bool Enabled { get; set; }

    /// <summary>Individual addresses of the proxies that connect to this process.</summary>
    public IList<string> TrustedProxies { get; set; } = [];

    /// <summary>
    /// CIDR networks whose addresses are proxies, for edges with an address that is assigned rather
    /// than fixed. Keep them as small as the deployment allows; every address inside one may rewrite
    /// the client address of every request it sends.
    /// </summary>
    public IList<string> TrustedNetworks { get; set; } = [];

    /// <summary>The parsed proxy addresses. Empty until <see cref="Validate"/> has accepted them.</summary>
    public IReadOnlyList<IPAddress> ResolvedProxies => resolvedProxies;

    /// <summary>The parsed proxy networks. Empty until <see cref="Validate"/> has accepted them.</summary>
    public IReadOnlyList<IPNetwork> ResolvedNetworks => resolvedNetworks;

    /// <summary>
    /// The startup rule, in one place so composition and the tests assert the same thing. Returns
    /// null when the configuration is acceptable, or the reason it is not.
    /// </summary>
    /// <remarks>
    /// Malformed entries are refused whether or not forwarding is enabled. A typo in a trusted proxy
    /// address is a mistake in either state, and finding it only on the day the flag is turned on is
    /// finding it during an incident.
    /// </remarks>
    public string? Validate()
    {
        resolvedProxies.Clear();
        resolvedNetworks.Clear();

        foreach (var candidate in TrustedProxies)
        {
            // An unset environment variable arrives as an empty entry, which is how a compose file
            // or a deployment template says "not configured" for a value it always passes. Absent is
            // not malformed. It is also not permission: an enabled deployment whose entries are all
            // empty resolves to nothing and is refused by the check at the end.
            if (string.IsNullOrWhiteSpace(candidate))
            {
                continue;
            }

            if (!IPAddress.TryParse(candidate.Trim(), out var address))
            {
                return $"{SectionName}:TrustedProxies contains an entry that is not an IP address.";
            }

            if (IsUnspecified(address))
            {
                return $"{SectionName}:TrustedProxies must not contain the unspecified address; " +
                    "it names no proxy and reads as trusting every caller.";
            }

            resolvedProxies.Add(address);
        }

        foreach (var candidate in TrustedNetworks)
        {
            if (string.IsNullOrWhiteSpace(candidate))
            {
                continue;
            }

            if (!IPNetwork.TryParse(candidate.Trim(), out var network))
            {
                return $"{SectionName}:TrustedNetworks contains an entry that is not CIDR notation " +
                    "such as 10.0.0.0/24.";
            }

            if (network.PrefixLength == 0)
            {
                return $"{SectionName}:TrustedNetworks must not contain a zero-length prefix; " +
                    "0.0.0.0/0 and ::/0 trust every caller on the internet as a proxy.";
            }

            resolvedNetworks.Add(network);
        }

        if (Enabled && resolvedProxies.Count == 0 && resolvedNetworks.Count == 0)
        {
            return $"{SectionName}:Enabled is true but no {SectionName}:TrustedProxies or " +
                $"{SectionName}:TrustedNetworks entry is configured. Forwarded headers would be " +
                "accepted from nobody, which silently collapses every per-address rate limit onto " +
                "the proxy's address. Name the edge, or set Enabled to false.";
        }

        return null;
    }

    private static bool IsUnspecified(IPAddress address) =>
        address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any);
}

public static class ReverseProxyMiddlewareExtensions
{
    /// <summary>
    /// Honours <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> from the configured edge, and from
    /// nothing else.
    /// </summary>
    /// <remarks>
    /// When forwarding is disabled this adds no middleware at all, so the headers are not read, not
    /// stripped and not acted on — a direct deployment sees exactly the request that reached it.
    /// <para>
    /// The framework's default known proxies are added to rather than replaced. The forward limit is
    /// left at its default of one hop, which is what makes a spoofed header harmless behind an edge
    /// that appends: nginx's <c>$proxy_add_x_forwarded_for</c> puts the address it actually accepted
    /// the connection from last, and the last entry is the one taken. An edge with more than one hop
    /// in front of this process needs its own decision and is not configured here.
    /// </para>
    /// </remarks>
    public static IApplicationBuilder UseTbGymForwardedHeaders(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // Resolved through the options pipeline, so the validation that refuses an unusable
        // configuration has already run and this can never compose an untrusted forwarder.
        var options = app.Services.GetRequiredService<IOptions<ReverseProxyOptions>>().Value;
        return options.Enabled ? app.UseForwardedHeaders(BuildForwardedHeaders(options)) : app;
    }

    /// <summary>
    /// The composed trusted set, as its own function so a test can assert what the middleware will
    /// decide without needing a socket the test machine cannot supply an untrusted address for.
    /// </summary>
    internal static ForwardedHeadersOptions BuildForwardedHeaders(ReverseProxyOptions options)
    {
        var forwarded = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        };

        // Added to, never replaced and never cleared. Clearing both collections does not narrow the
        // trusted set, it removes the check.
        foreach (var proxy in options.ResolvedProxies)
        {
            forwarded.KnownProxies.Add(proxy);
        }

        foreach (var network in options.ResolvedNetworks)
        {
            forwarded.KnownIPNetworks.Add(network);
        }

        return forwarded;
    }
}
