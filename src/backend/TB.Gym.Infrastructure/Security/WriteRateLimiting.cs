using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// Rate limits for every state-changing route of a group of endpoints (audit INV-10), so a route added
/// to a module later is limited without anyone remembering to say so.
/// </summary>
public static class WriteRateLimiting
{
    /// <summary>
    /// Gives each state-changing route under <paramref name="builder"/> the named policy. A route that
    /// names a stricter policy of its own keeps it: a route's conventions run after its group's, and the
    /// limiter reads the last policy a route carries. Reads are never limited.
    /// </summary>
    public static TBuilder RequireRateLimitingOnWrites<TBuilder>(this TBuilder builder, string policyName)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(policyName);
        builder.Add(endpoint =>
        {
            if (IsStateChanging(endpoint.Metadata.OfType<IHttpMethodMetadata>().LastOrDefault()))
            {
                endpoint.Metadata.Add(new EnableRateLimitingAttribute(policyName));
            }
        });
        return builder;
    }

    /// <summary>A route that answers any method but GET and HEAD.</summary>
    public static bool IsStateChanging(IHttpMethodMetadata? methods) =>
        methods?.HttpMethods.Any(method => !HttpMethods.IsGet(method) && !HttpMethods.IsHead(method)) == true;
}
