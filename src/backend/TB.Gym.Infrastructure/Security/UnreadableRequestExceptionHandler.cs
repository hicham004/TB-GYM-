using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// Answers a request the API could not read with its own status and a sentence that names the field
/// (audit SEC-1), the same in every environment.
/// </summary>
/// <remarks>
/// Minimal APIs throw <see cref="BadHttpRequestException"/> for a body of the wrong type, broken or
/// empty JSON, a misspelt enum, nesting past the reader's depth or a route or query value that does not
/// parse, because <c>RouteHandlerOptions.ThrowOnBadRequest</c> is on everywhere
/// (<c>AddTbGymInfrastructure</c>). Off, the framework answered Production with a bare 400 that named
/// nothing; on and unhandled, Development answered 500. Kestrel's own refusals (a body over the
/// endpoint's limit, 413) arrive here too. Only the field's path is echoed, never its value.
/// </remarks>
internal sealed partial class UnreadableRequestExceptionHandler : IExceptionHandler
{
    public const string InvalidCode = "request_invalid";

    public const string TooLargeCode = "request_too_large";

    public const string UnsupportedMediaTypeCode = "request_unsupported_media_type";

    private const int LongestField = 120;

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not BadHttpRequestException badRequest || httpContext.Response.HasStarted)
        {
            return false;
        }

        httpContext.Response.StatusCode = badRequest.StatusCode is >= 400 and < 500
            ? badRequest.StatusCode
            : StatusCodes.Status400BadRequest;
        await httpContext.Response.WriteAsJsonAsync(Describe(badRequest), cancellationToken);
        return true;
    }

    internal static UnreadableRequestAnswer Describe(BadHttpRequestException badRequest)
    {
        if (badRequest.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return new(TooLargeCode, null, "This request is too large to be read.");
        }

        if (badRequest.StatusCode == StatusCodes.Status415UnsupportedMediaType)
        {
            return new(UnsupportedMediaTypeCode, null, "Send this request as JSON.");
        }

        // An empty or `null` body: "Implicit body inferred for parameter … but no body was provided." or
        // "Required parameter … was not provided from body." The parameter's name is no field to fix.
        var json = badRequest.InnerException as JsonException;
        if (json is null &&
            (badRequest.Message.Contains("no body was provided", StringComparison.Ordinal) ||
             badRequest.Message.Contains("from body", StringComparison.Ordinal)))
        {
            return new(InvalidCode, null, "This request needs its fields as a JSON body.");
        }

        var field = FieldOf(json) ?? ParameterOf(badRequest.Message);
        return new(
            InvalidCode,
            field,
            field is null
                ? "This request could not be read. Check its fields and send it again."
                : $"The value of {field} could not be read. Check it and send the request again.");
    }

    /// <summary>The field a JSON reader stopped at, without the root: "$.sets[0].reps" reads "sets[0].reps".</summary>
    internal static string? FieldOf(JsonException? exception)
    {
        var path = exception?.Path;
        if (string.IsNullOrEmpty(path) || path == "$")
        {
            return null;
        }

        var field = path.StartsWith("$.", StringComparison.Ordinal) ? path[2..] : path.TrimStart('$');
        return field.Length > LongestField ? field[..LongestField] : field;
    }

    /// <summary>The parameter a route or query value failed to bind to, from the framework's own sentence.</summary>
    internal static string? ParameterOf(string message)
    {
        var match = BoundParameter().Match(message);
        return match.Success ? match.Groups["name"].Value : null;
    }

    // `Failed to bind parameter "int take" from "abc".` and `Required parameter "Guid id" was not provided…`
    [GeneratedRegex(@"parameter ""(?:[^""]* )?(?<name>[A-Za-z_][A-Za-z0-9_]*)""", RegexOptions.CultureInvariant)]
    private static partial Regex BoundParameter();
}

/// <summary>What <see cref="UnreadableRequestExceptionHandler"/> answers: a code, the field when known, a sentence.</summary>
internal sealed record UnreadableRequestAnswer(string Code, string? Field, string Message)
{
    /// <summary>The sentence under the field's path, as every other validation refusal of the API answers it.</summary>
    public IReadOnlyDictionary<string, string[]>? Errors =>
        Field is null ? null : new Dictionary<string, string[]> { [Field] = [Message] };
}
