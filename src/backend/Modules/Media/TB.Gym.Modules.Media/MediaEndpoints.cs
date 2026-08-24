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
                context.Response.Cookies.Append(
                    MediaAccessCookie.Name,
                    result.BrowserGrant,
                    new CookieOptions
                    {
                        HttpOnly = true,
                        IsEssential = true,
                        Secure = context.Request.IsHttps,
                        SameSite = Microsoft.AspNetCore.Http.SameSiteMode.Strict,
                        Path = MediaAccessCookie.Path(assetId),
                        MaxAge = result.GrantLifetime,
                    });
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

        endpoints.MapGet("/api/media/{assetId:guid}/content", async (
            Guid assetId,
            HttpContext context,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
                await StreamGrantedAsync(
                    context,
                    grant => service.OpenContentAsync(assetId, grant, cancellationToken)))
        .WithName("StreamPrivateMedia")
        .RequireAuthorization()
        .Produces(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);

        // A thumbnail is a rendition of the asset above, not a resource of its own: it is addressed
        // through its parent, presents the same grant cookie, and is authorized by the same check.
        endpoints.MapGet("/api/media/{assetId:guid}/content/thumbnail", async (
            Guid assetId,
            HttpContext context,
            IMediaApplicationService service,
            CancellationToken cancellationToken) =>
                await StreamGrantedAsync(
                    context,
                    grant => service.OpenThumbnailAsync(assetId, grant, cancellationToken)))
        .WithName("StreamPrivateMediaThumbnail")
        .RequireAuthorization()
        .Produces(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);

        return endpoints;
    }

    private static async Task<IResult> StreamGrantedAsync(
        HttpContext context,
        Func<string, Task<MediaContentResult>> open)
    {
        if (!context.Request.Cookies.TryGetValue(MediaAccessCookie.Name, out var grant) ||
            string.IsNullOrWhiteSpace(grant))
        {
            return Results.Forbid();
        }

        var result = await open(grant);
        return result.Status switch
        {
            MediaContentStatus.Success => Results.Stream(
                result.Content!,
                result.ContentType,
                enableRangeProcessing: true),
            MediaContentStatus.Forbidden => Results.Forbid(),
            _ => Results.NotFound(),
        };
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
            // A full allowance is a conflict with stored state, not a malformed request, and it
            // carries a stable code so the client can tell the caller which limit was reached.
            MediaCommandStatus.QuotaExceeded => Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: result.Message ?? "The storage allowance is full.",
                extensions: new Dictionary<string, object?> { ["code"] = result.Code }),
            _ => Results.Conflict(new { code = "media_conflict" }),
        };
}
