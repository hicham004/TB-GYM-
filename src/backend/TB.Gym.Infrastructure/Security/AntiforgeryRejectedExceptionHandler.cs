using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// Answers a write with a missing or invalid antiforgery token with 400 <c>antiforgery_token_invalid</c>
/// instead of letting it reach the generic handler as a 500.
/// </summary>
/// <remarks>
/// Every write endpoint calls <c>ValidateRequestAsync</c> itself, so the refusal arrives as an
/// exception. It is the caller's mistake (a stale tab, a bot, a forged request), not a server fault,
/// and counting it as one would bury real errors in 5xx monitoring. Nothing about the request is
/// echoed back.
/// </remarks>
internal sealed class AntiforgeryRejectedExceptionHandler : IExceptionHandler
{
    public const string Code = "antiforgery_token_invalid";

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not AntiforgeryValidationException)
        {
            return false;
        }

        httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
        await httpContext.Response.WriteAsJsonAsync(
            new
            {
                code = Code,
                message = "This page's security check has expired. Refresh the page and try again.",
            },
            cancellationToken);
        return true;
    }
}
