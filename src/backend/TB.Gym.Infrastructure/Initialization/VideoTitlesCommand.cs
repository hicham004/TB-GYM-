using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Asks YouTube or Vimeo once for the title of every video link that has none, in every workspace, as adding a link
/// does (critique B17, MED-015): the links from before B9, and those whose provider did not answer then. It is run
/// once, by whoever operates the deployment, against the deployment's own database.
/// </summary>
/// <remarks>
/// <code>
/// dotnet TB.Gym.Api.dll video-titles
/// </code>
/// A video that is gone or private, or a provider that cannot say just now, leaves the link exactly as it is, so its
/// tile does not change. A link with a title is never asked about, so a second run changes nothing. Each link is
/// asked and saved on its own, so a run that stops loses nothing it has done, and it prints only how many.
/// </remarks>
public static class VideoTitlesCommand
{
    public const string Name = "video-titles";

    public static bool IsInvocation(IReadOnlyList<string> args) =>
        args.Count > 0 && string.Equals(args[0], Name, StringComparison.Ordinal);

    /// <returns>A process exit code: 0 once every link has been asked about, 2 for a usage problem.</returns>
    public static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyList<string> args,
        TextWriter output,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);
        if (args.Count != 1)
        {
            await output.WriteLineAsync($"Usage: {Name}");
            return 2;
        }

        var links = await FindLinksWithNoTitleAsync(services, cancellationToken);
        var titled = 0;
        foreach (var link in links)
        {
            if (await TakeTitleAsync(services, link, cancellationToken))
            {
                titled++;
            }
        }

        var left = links.Count - titled;
        await output.WriteLineAsync($"Video links with no title: {links.Count}");
        await output.WriteLineAsync($"Given their title: {titled}");
        await output.WriteLineAsync($"Left as they are: {left}");
        if (left > 0)
        {
            await output.WriteLineAsync(
                "A video that is gone or private stays as it is. Running this again asks about these once more, " +
                "which fills in any whose provider could not say just now.");
        }

        return 0;
    }

    private static async Task<IReadOnlyList<LinkWithNoTitle>> FindLinksWithNoTitleAsync(
        IServiceProvider services,
        CancellationToken cancellationToken)
    {
        await using var scope = services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<GymDbContext>().MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.ExternalProvider != null && item.ExternalTitle == null)
            .OrderBy(item => item.TenantId)
            .ThenBy(item => item.Id)
            .Select(item => new LinkWithNoTitle(
                item.TenantId,
                item.Id,
                item.ExternalProvider!.Value,
                item.ExternalMediaId!))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// One link, asked with nothing open in the database and read again inside its workspace only once the provider
    /// has answered: a coach who added the same video meanwhile keeps the title that gave it.
    /// </summary>
    private static async Task<bool> TakeTitleAsync(
        IServiceProvider services,
        LinkWithNoTitle link,
        CancellationToken cancellationToken)
    {
        await using var scope = services.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        var title = await provider.GetRequiredService<IExternalVideoTitles>().FindAsync(
            link.Provider,
            link.ExternalMediaId,
            cancellationToken);
        if (title is null)
        {
            return false;
        }

        provider.GetRequiredService<IMutableTenantContext>().SetTenant(link.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var asset = await context.MediaAssets.SingleOrDefaultAsync(item => item.Id == link.Id, cancellationToken);
        if (asset is null || !asset.TakeExternalTitle(title))
        {
            return false;
        }

        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Someone changed the link at this moment: it stays as they left it, for a later run to ask about.
            return false;
        }
    }

    private sealed record LinkWithNoTitle(
        Guid TenantId,
        Guid Id,
        ExternalMediaProvider Provider,
        string ExternalMediaId);
}
