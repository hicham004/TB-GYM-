using System.Globalization;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Http.Headers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

public static class MediaEndpoints
{
    private const long MaximumMultipartRequestBytes = MediaUploadPolicy.MaximumVideoBytes + (1024 * 1024);

    public static IEndpointRouteBuilder MapMediaModule(this IEndpointRouteBuilder endpoints)
    {
        var coach = endpoints
            .MapGroup("/api/media")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(MediaModule.Name);

        coach.MapGet("/", async (
            int? skip,
            int? take,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var page = NormalizePage(skip, take, 50);
            return Results.Ok(await service.ListAsync(page.Skip, page.Take, cancellationToken));
        })
            .WithName("ListMediaAssets")
            .Produces<MediaAssetPage>();

        coach.MapPost("/uploads", async (
            HttpRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return await StreamUploadAsync(request, service, cancellationToken);
        })
        .WithName("UploadExerciseMedia")
        .Accepts<IFormFile>("multipart/form-data")
        .Produces<MediaAssetView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status429TooManyRequests)
        .RequireRateLimiting(RateLimitPolicies.MediaUpload)
        .WithMetadata(new RequestSizeLimitAttribute(MaximumMultipartRequestBytes));

        coach.MapPost("/external", async (
            RegisterExternalMediaRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RegisterExternalAsync(request, cancellationToken));
        })
        .WithName("RegisterExternalExerciseMedia")
        .Produces<MediaAssetView>()
        .ProducesValidationProblem();

        coach.MapDelete("/{assetId:guid}", async (
            Guid assetId,
            [FromBody] DeleteMediaRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.DeleteAsync(assetId, request, cancellationToken));
        })
        .WithName("DeleteMediaAsset")
        .Produces<MediaAssetView>()
        .ProducesProblem(StatusCodes.Status409Conflict);

        var member = endpoints
            .MapGroup("/api/media")
            .RequireAuthorization(AuthorizationPolicies.TenantMember)
            .WithTags(MediaModule.Name);

        member.MapPost("/{assetId:guid}/access", async (
            Guid assetId,
            HttpContext context,
            IAntiforgery antiforgery,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.CreateAccessAsync(assetId, cancellationToken);
            if (result.Status == MediaAccessStatus.Success && result.BrowserGrant is not null)
            {
                AppendGrantCookie(context, assetId, result.BrowserGrant, result.GrantLifetime);
            }

            return result.Status switch
            {
                MediaAccessStatus.Success => Results.Ok(result.Access),
                MediaAccessStatus.Forbidden => Results.Forbid(),
                MediaAccessStatus.NotReady => Results.Conflict(new { code = "media_not_ready" }),
                _ => Results.NotFound(),
            };
        })
        .WithName("CreatePrivateMediaAccess")
        .Produces<MediaAccessView>()
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        // A screen showing many protected thumbnails needs one grant per asset before the browser
        // can fetch any of them. Asking per tile is one request per asset and grows with the
        // timeline; this is the bounded alternative, capped at MediaAccessBatchPolicy.MaximumAssets
        // and authorized asset by asset exactly as the route above is.
        member.MapPost("/access", async (
            MediaAccessBatchRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            if (request?.AssetIds is null)
            {
                return InvalidBatch();
            }

            var result = await service.CreateAccessBatchAsync(request.AssetIds, cancellationToken);
            if (result.Status != MediaAccessBatchStatus.Success)
            {
                return InvalidBatch();
            }

            foreach (var grant in result.Grants)
            {
                // One cookie per asset, each scoped to that asset's own content path. The batch is
                // a transport convenience; it does not widen a single grant's scope.
                AppendGrantCookie(context, grant.AssetId, grant.BrowserGrant, result.GrantLifetime);
            }

            return Results.Ok(new MediaAccessBatchView(
                [.. result.Grants.Select(grant => grant.Access)]));
        })
        .WithName("CreatePrivateMediaAccessBatch")
        .Produces<MediaAccessBatchView>()
        .ProducesValidationProblem();

        endpoints.MapGet("/api/media/{assetId:guid}/content", async (
            Guid assetId,
            HttpContext context,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
                await StreamGrantedAsync(
                    context,
                    (grant, range) => service.OpenContentAsync(
                        assetId,
                        grant,
                        range,
                        cancellationToken)))
        .WithName("StreamPrivateMedia")
        .RequireAuthorization()
        .Produces(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status206PartialContent)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status416RangeNotSatisfiable)
        .Produces(StatusCodes.Status503ServiceUnavailable);

        // A thumbnail is a rendition of the asset above, not a resource of its own: it is addressed
        // through its parent, presents the same grant cookie, and is authorized by the same check.
        endpoints.MapGet("/api/media/{assetId:guid}/content/thumbnail", async (
            Guid assetId,
            HttpContext context,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
                await StreamGrantedAsync(
                    context,
                    (grant, range) => service.OpenThumbnailAsync(
                        assetId,
                        grant,
                        range,
                        cancellationToken)))
        .WithName("StreamPrivateMediaThumbnail")
        .RequireAuthorization()
        .Produces(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status206PartialContent)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status416RangeNotSatisfiable)
        .Produces(StatusCodes.Status503ServiceUnavailable);

        return endpoints;
    }

    private static void AppendGrantCookie(
        HttpContext context,
        Guid assetId,
        string browserGrant,
        TimeSpan? lifetime) =>
        context.Response.Cookies.Append(
            MediaAccessCookie.Name,
            browserGrant,
            new CookieOptions
            {
                HttpOnly = true,
                IsEssential = true,
                Secure = context.Request.IsHttps,
                SameSite = Microsoft.AspNetCore.Http.SameSiteMode.Strict,
                Path = MediaAccessCookie.Path(assetId),
                MaxAge = lifetime,
            });

    private static IResult InvalidBatch() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["assetIds"] =
                [$"Between 1 and {MediaAccessBatchPolicy.MaximumAssets} media assets may be granted at once."],
        });

    private static async Task StreamGrantedAsync(
        HttpContext context,
        Func<string, RequestedByteRange?, Task<MediaContentResult>> open)
    {
        if (!context.Request.Cookies.TryGetValue(MediaAccessCookie.Name, out var grant) ||
            string.IsNullOrWhiteSpace(grant))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        if (!TryParseRange(context.Request, out var range))
        {
            context.Response.StatusCode = StatusCodes.Status416RangeNotSatisfiable;
            context.Response.Headers.AcceptRanges = "bytes";
            return;
        }

        var result = await open(grant, range);
        switch (result.Status)
        {
            case MediaContentStatus.Success:
                context.Response.StatusCode = result.Range is null
                    ? StatusCodes.Status200OK
                    : StatusCodes.Status206PartialContent;
                context.Response.ContentType = result.ContentType;
                context.Response.ContentLength = result.ContentLength;
                context.Response.Headers.AcceptRanges = "bytes";
                if (result.Range is { } fulfilled && result.ObjectLength is { } objectLength)
                {
                    context.Response.Headers.ContentRange =
                        $"bytes {fulfilled.Offset}-{fulfilled.EndInclusive}/{objectLength}";
                }

                var content = result.Content!;
                await using (content)
                {
                    await content.CopyToAsync(context.Response.Body, context.RequestAborted);
                }

                return;
            case MediaContentStatus.Forbidden:
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            case MediaContentStatus.RangeNotSatisfiable:
                context.Response.StatusCode = StatusCodes.Status416RangeNotSatisfiable;
                context.Response.Headers.AcceptRanges = "bytes";
                if (result.ObjectLength is { } length)
                {
                    context.Response.Headers.ContentRange = $"bytes */{length}";
                }

                return;
            case MediaContentStatus.Unavailable:
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                return;
            default:
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
        }
    }

    private static bool TryParseRange(HttpRequest request, out RequestedByteRange? range)
    {
        range = null;
        var values = request.Headers.Range;
        if (values.Count == 0)
        {
            return true;
        }

        if (values.Count != 1)
        {
            return false;
        }

        var value = values[0];
        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var interval = value[6..].Trim();
        if (interval.Contains(',') ||
            interval.Count(character => character == '-') != 1)
        {
            return false;
        }

        var separator = interval.IndexOf('-');
        var first = interval[..separator];
        var last = interval[(separator + 1)..];
        if (first.Length == 0)
        {
            if (!long.TryParse(last, NumberStyles.None, CultureInfo.InvariantCulture, out var suffix) || suffix <= 0)
            {
                return false;
            }

            range = RequestedByteRange.FromSuffix(suffix);
            return true;
        }

        if (!long.TryParse(first, NumberStyles.None, CultureInfo.InvariantCulture, out var start) || start < 0)
        {
            return false;
        }

        if (last.Length == 0)
        {
            range = RequestedByteRange.FromStart(start);
            return true;
        }

        if (!long.TryParse(last, NumberStyles.None, CultureInfo.InvariantCulture, out var end) || end < start)
        {
            return false;
        }

        range = RequestedByteRange.FromStart(start, end);
        return true;
    }

    private static async Task<IResult> StreamUploadAsync(
        HttpRequest request,
        IMediaApplicationService service,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength > MaximumMultipartRequestBytes ||
            !MediaTypeHeaderValue.TryParse(request.ContentType, out var mediaType) ||
            !string.Equals(mediaType.MediaType.Value, "multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            return InvalidFile("A multipart media file within the configured size limit is required.");
        }

        var boundary = HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value;
        if (string.IsNullOrWhiteSpace(boundary) || boundary.Length > FormOptions.DefaultMultipartBoundaryLengthLimit)
        {
            return InvalidFile("The multipart boundary is missing or invalid.");
        }

        try
        {
            var reader = new MultipartReader(boundary, request.Body)
            {
                BodyLengthLimit = MediaUploadPolicy.MaximumVideoBytes,
            };
            string? title = null;
            while (await reader.ReadNextSectionAsync(cancellationToken) is { } section)
            {
                if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition))
                {
                    return InvalidFile("A multipart section has invalid content disposition.");
                }

                var fieldName = HeaderUtilities.RemoveQuotes(disposition.Name).Value;
                var fileName = HeaderUtilities.RemoveQuotes(
                    disposition.FileNameStar.HasValue ? disposition.FileNameStar : disposition.FileName).Value;
                if (string.Equals(fieldName, "title", StringComparison.Ordinal) && string.IsNullOrEmpty(fileName))
                {
                    title = await ReadSmallTextAsync(section.Body, 200, cancellationToken);
                    continue;
                }

                if (!string.Equals(fieldName, "file", StringComparison.Ordinal) || string.IsNullOrWhiteSpace(fileName))
                {
                    return InvalidFile("Only title and one media file are accepted.");
                }

                var contentType = section.ContentType ?? "application/octet-stream";
                return ToResult(await service.UploadAsync(
                    string.IsNullOrWhiteSpace(title) ? Path.GetFileNameWithoutExtension(fileName) : title,
                    Path.GetFileName(fileName),
                    contentType,
                    section.Body,
                    cancellationToken));
            }
        }
        catch (InvalidDataException exception)
        {
            return InvalidFile(exception.Message);
        }

        return InvalidFile("A media file is required.");
    }

    private static async Task<string> ReadSmallTextAsync(
        Stream stream,
        int maximumCharacters,
        CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        var buffer = new char[maximumCharacters + 1];
        var read = await reader.ReadBlockAsync(buffer.AsMemory(), cancellationToken);
        if (read > maximumCharacters)
        {
            throw new InvalidDataException($"The title cannot exceed {maximumCharacters} characters.");
        }

        return new string(buffer, 0, read).Trim();
    }

    private static IResult InvalidFile(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = [message] });

    private static (int Skip, int Take) NormalizePage(int? skip, int? take, int defaultTake) =>
        (Math.Max(skip ?? 0, 0), Math.Clamp(take ?? defaultTake, 1, 100));

    private static IResult ToResult(MediaCommandResult result) =>
        result.Status switch
        {
            MediaCommandStatus.Success => Results.Ok(result.Asset),
            MediaCommandStatus.NotFound => Results.NotFound(),
            MediaCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            MediaCommandStatus.RateLimited => Results.StatusCode(StatusCodes.Status429TooManyRequests),
            // The installation cannot scan, so it cannot publish. That is a server condition and
            // says so, rather than blaming a file that was never inspected.
            MediaCommandStatus.Unavailable => Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: result.Message ?? "Media uploads are unavailable."),
            // A full allowance is a conflict with stored state, not a malformed request, and it
            // carries a stable code so the client can tell the caller which limit was reached.
            MediaCommandStatus.QuotaExceeded => Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: result.Message ?? "The storage allowance is full.",
                extensions: new Dictionary<string, object?> { ["code"] = result.Code }),
            _ => Results.Conflict(new { code = "media_conflict" }),
        };
}
