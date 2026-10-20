using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// Refuses a request carrying a NUL character in a query value or in a JSON string, before any rule or
/// query sees it (audit SEC-2): PostgreSQL cannot store a NUL in text, so a note, an intake answer or a
/// search holding one failed as a 500. The answer is a 400 that names the field.
/// </summary>
/// <remarks>
/// A middleware rather than a JSON converter, deliberately: a custom converter for <c>string</c> made the
/// OpenAPI document describe every string as "anything", and the generated client with it. JSON can only
/// carry a NUL as the escape <c>\u0000</c> (a raw control character is already a reader error), so only
/// escaped strings are decoded and checked. It runs after authorization, so nobody's body is read before
/// the request is let in, and within the route's own size limit (the contact form's is 16 KB).
/// </remarks>
internal sealed class StorableTextMiddleware(RequestDelegate next)
{
    public const string Code = "text_invalid_character";

    public async Task InvokeAsync(HttpContext context)
    {
        var field = QueryField(context.Request) ?? await BodyFieldAsync(context.Request, context.RequestAborted);
        if (field is null)
        {
            await next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new UnreadableRequestAnswer(
            Code,
            field.Length == 0 ? null : field,
            field.Length == 0
                ? "The text contains a character that can't be saved. Remove it and try again."
                : $"The text in {field} contains a character that can't be saved. Remove it and try again."));
    }

    private static string? QueryField(HttpRequest request)
    {
        if (!request.QueryString.HasValue)
        {
            return null;
        }

        foreach (var (key, values) in request.Query)
        {
            if (key.Contains('\0', StringComparison.Ordinal) ||
                values.Any(value => value?.Contains('\0', StringComparison.Ordinal) == true))
            {
                return key.Replace("\0", string.Empty, StringComparison.Ordinal);
            }
        }

        return null;
    }

    private static async Task<string?> BodyFieldAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength == 0 || !request.HasJsonContentType())
        {
            return null;
        }

        // Read once into memory and rewound for the binder. Past the route's limit the read itself
        // throws, and the unreadable-request handler answers 413.
        request.EnableBuffering();
        using var body = new MemoryStream();
        await request.Body.CopyToAsync(body, cancellationToken);
        request.Body.Position = 0;
        return UnstorableField(body.GetBuffer().AsSpan(0, (int)body.Length));
    }

    /// <summary>
    /// The path of the first JSON string holding a NUL ("sets[0].note"), "" when it is the whole body,
    /// or null when there is none. Malformed JSON is left to the binder, which names its own field.
    /// </summary>
    internal static string? UnstorableField(ReadOnlySpan<byte> json)
    {
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 64 });
        var frames = new List<Frame>();
        try
        {
            while (reader.Read())
            {
                switch (reader.TokenType)
                {
                    case JsonTokenType.PropertyName:
                        var name = reader.GetString() ?? string.Empty;
                        if (name.Contains('\0', StringComparison.Ordinal))
                        {
                            return PathOf(frames, withLastProperty: false);
                        }

                        frames[^1].Property = name;
                        break;
                    case JsonTokenType.StartObject:
                    case JsonTokenType.StartArray:
                        BeginValue(frames);
                        frames.Add(new Frame(reader.TokenType == JsonTokenType.StartArray));
                        break;
                    case JsonTokenType.EndObject:
                    case JsonTokenType.EndArray:
                        frames.RemoveAt(frames.Count - 1);
                        break;
                    case JsonTokenType.String:
                        BeginValue(frames);
                        if (reader.ValueIsEscaped && reader.GetString()!.Contains('\0', StringComparison.Ordinal))
                        {
                            return PathOf(frames, withLastProperty: true);
                        }

                        break;
                    default:
                        BeginValue(frames);
                        break;
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    /// <summary>A value inside an array is its next element.</summary>
    private static void BeginValue(List<Frame> frames)
    {
        if (frames.Count > 0 && frames[^1].IsArray)
        {
            frames[^1].Elements++;
        }
    }

    private static string PathOf(List<Frame> frames, bool withLastProperty)
    {
        var path = new StringBuilder();
        for (var index = 0; index < frames.Count; index++)
        {
            var frame = frames[index];
            if (frame.IsArray)
            {
                path.Append('[').Append(frame.Elements - 1).Append(']');
            }
            else if (frame.Property is { } property && (withLastProperty || index < frames.Count - 1))
            {
                if (path.Length > 0)
                {
                    path.Append('.');
                }

                path.Append(property);
            }
        }

        return path.ToString();
    }

    private sealed class Frame(bool isArray)
    {
        public bool IsArray { get; } = isArray;

        public int Elements { get; set; }

        public string? Property { get; set; }
    }
}

public static class StorableTextExtensions
{
    /// <summary>After authorization: refuses text PostgreSQL cannot store (audit SEC-2).</summary>
    public static IApplicationBuilder UseTbGymStorableText(this IApplicationBuilder app) =>
        app.UseMiddleware<StorableTextMiddleware>();
}
