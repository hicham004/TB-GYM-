using System.Text.Json;
using Microsoft.Extensions.Logging;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A YouTube or Vimeo video's own title, from the provider's public oEmbed answer (critique B9, MED-015). TB Gym's
/// server asks it once, as a coach adds a link or as the one-time <c>video-titles</c> command reaches a link with
/// none (B17), so nothing from the provider loads in anyone's browser (C18). The address is built from the checked
/// id on the provider's own host, never from the link the coach pasted; at most 64 KB of the answer is read and only
/// its "title" is kept. Any failure is "no title": the link goes without one.
/// </summary>
internal sealed class OEmbedVideoTitles(HttpClient httpClient, ILogger<OEmbedVideoTitles> logger) : IExternalVideoTitles
{
    /// <summary>A title is a line of text; an answer past this size is not oEmbed's.</summary>
    internal const int MaximumAnswerBytes = 64 * 1024;

    private static readonly Action<ILogger, ExternalMediaProvider, string, Exception?> LogNoTitle =
        LoggerMessage.Define<ExternalMediaProvider, string>(
            LogLevel.Information,
            new EventId(5520, "ExternalVideoTitleUnavailable"),
            "{Provider} gave no title for a video link ({Reason}); it goes without one.");

    public async Task<string?> FindAsync(
        ExternalMediaProvider provider,
        string externalMediaId,
        CancellationToken cancellationToken)
    {
        if (AnswerAddress(provider, externalMediaId) is not { } address)
        {
            return null;
        }

        try
        {
            using var response = await httpClient.GetAsync(
                address,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                // A private, removed or unlisted-for-embedding video answers 401, 403 or 404.
                LogNoTitle(logger, provider, $"HTTP {(int)response.StatusCode}", null);
                return null;
            }

            if (response.Content.Headers.ContentLength > MaximumAnswerBytes)
            {
                LogNoTitle(logger, provider, "answer too long", null);
                return null;
            }

            var answer = new byte[MaximumAnswerBytes + 1];
            var length = 0;
            await using (var stream = await response.Content.ReadAsStreamAsync(cancellationToken))
            {
                int read;
                while (length < answer.Length &&
                       (read = await stream.ReadAsync(answer.AsMemory(length), cancellationToken)) > 0)
                {
                    length += read;
                }
            }

            if (length > MaximumAnswerBytes)
            {
                LogNoTitle(logger, provider, "answer too long", null);
                return null;
            }

            using var document = JsonDocument.Parse(answer.AsMemory(0, length));
            return document.RootElement.ValueKind == JsonValueKind.Object &&
                   document.RootElement.TryGetProperty("title", out var title) &&
                   title.ValueKind == JsonValueKind.String
                ? title.GetString()
                : null;
        }
        catch (HttpRequestException exception)
        {
            LogNoTitle(logger, provider, "unreachable", exception);
            return null;
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            LogNoTitle(logger, provider, "timed out", exception);
            return null;
        }
        catch (JsonException exception)
        {
            LogNoTitle(logger, provider, "not JSON", exception);
            return null;
        }
    }

    /// <summary>The provider's oEmbed address for the video's own page, as MED-016 builds that page.</summary>
    internal static Uri? AnswerAddress(ExternalMediaProvider provider, string externalMediaId) => provider switch
    {
        ExternalMediaProvider.YouTube => new Uri(
            "https://www.youtube.com/oembed?format=json&url=" +
            Uri.EscapeDataString("https://www.youtube.com/watch?v=" + externalMediaId)),
        ExternalMediaProvider.Vimeo => new Uri(
            "https://vimeo.com/api/oembed.json?url=" +
            Uri.EscapeDataString("https://vimeo.com/" + externalMediaId)),
        _ => null,
    };
}
