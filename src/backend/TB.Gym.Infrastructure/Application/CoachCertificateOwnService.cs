using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A coach's own certificate lines (CLI-021, notes plan N4b), behind the tenant-coach policy, so the request's
/// space is a workspace the caller is verified staff of. Every read passes the tenant query filter and also names
/// that space and the caller, so a read without a tenant context carries nothing and no other coach's line is ever
/// reached. The switch changes the line's <see cref="CoachCertificateLine.CoachShows"/> alone. Nothing logs a line's
/// words.
/// </summary>
internal sealed class CoachCertificateOwnService(
    GymDbContext dbContext,
    ICurrentUser currentUser,
    ITenantContext tenantContext) : ICoachCertificateOwnService
{
    public async Task<CoachCertificateOwnView> ReadOwnAsync(CancellationToken cancellationToken)
    {
        if (await SpaceAsync(cancellationToken) is not { } space)
        {
            return new CoachCertificateOwnView([]);
        }

        var lines = await dbContext.CoachCertificateLines
            .AsNoTracking()
            .Where(line => line.TenantId == space.TenantId &&
                           line.CoachUserId == space.UserId &&
                           line.ErasedAtUtc == null)
            .OrderBy(line => line.CreatedAtUtc)
            .ThenBy(line => line.Id)
            .ToListAsync(cancellationToken);
        return new CoachCertificateOwnView(lines.Select(line => ToView(line, space)).ToList());
    }

    public async Task<CoachCertificateCommandResult<CoachCertificateOwnLineView>> SetShownAsync(
        Guid lineId,
        SetCoachCertificateLineShownRequest? request,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (request?.Shown is null)
        {
            errors[Fields.Shown] = [CoachCertificateText.ShownRequired];
        }

        if (request?.Version is null)
        {
            errors[Fields.Version] = [CoachCertificateText.VersionRequired];
        }

        if (errors.Count > 0)
        {
            return CoachCertificateCommand.Invalid<CoachCertificateOwnLineView>(errors);
        }

        var shown = request!.Shown!.Value;
        var version = request.Version!.Value;
        if (await SpaceAsync(cancellationToken) is not { } space)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateOwnLineView>();
        }

        // Another coach's line, or one of another space, is not found: it is never theirs to see.
        var line = await dbContext.CoachCertificateLines.SingleOrDefaultAsync(
            item => item.Id == lineId && item.TenantId == space.TenantId && item.CoachUserId == space.UserId,
            cancellationToken);
        if (line is null)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateOwnLineView>();
        }

        if (line.Version != version)
        {
            return CoachCertificateCommand.Conflict<CoachCertificateOwnLineView>(
                CoachCertificateText.ChangedCode,
                CoachCertificateText.Changed);
        }

        if (line.State != CoachCertificateLineState.Confirmed)
        {
            return CoachCertificateCommand.Conflict<CoachCertificateOwnLineView>(
                CoachCertificateText.StateCode,
                CoachCertificateText.ShownNotConfirmed);
        }

        // The same choice again changes nothing and answers the line as it stands.
        if (line.CoachShows != shown)
        {
            dbContext.Entry(line).Property(item => item.Version).OriginalValue = version;
            line.SetShown(shown);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                return CoachCertificateCommand.Conflict<CoachCertificateOwnLineView>(
                    CoachCertificateText.ChangedCode,
                    CoachCertificateText.Changed);
            }
        }

        return CoachCertificateCommand.Success(ToView(line, space));
    }

    private async Task<Space?> SpaceAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return null;
        }

        var tenantId = tenantContext.TenantId;
        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .Where(item => item.Id == tenantId)
            .Select(item => new { item.TimeZoneId, item.DefaultCulture })
            .SingleOrDefaultAsync(cancellationToken);
        return tenant is null
            ? null
            : new Space(tenantId, userId, TimeZoneInfo.FindSystemTimeZoneById(tenant.TimeZoneId), tenant.DefaultCulture);
    }

    private static CoachCertificateOwnLineView ToView(CoachCertificateLine line, Space space)
    {
        // Only an erased line lacks its day, and an erased line is never read here.
        var shownOn = line.ShownOn ?? throw new InvalidOperationException("A certificate line that is not erased has its day.");
        return new CoachCertificateOwnLineView(
            line.Id,
            line.State,
            CoachCertificateLineWording.Compose(line.What, shownOn, space.Culture),
            line.What,
            shownOn,
            CoachCertificateLineWording.Version,
            line.ConfirmedAtUtc is { } confirmedAt ? CoachCertificateReader.DayIn(space.Zone, confirmedAt) : null,
            line.TakenDownAtUtc is { } takenDownAt ? CoachCertificateReader.DayIn(space.Zone, takenDownAt) : null,
            line.CoachShows,
            line.Version);
    }

    /// <summary>The request's fields as the page names them.</summary>
    private static class Fields
    {
        public const string Shown = "shown";
        public const string Version = "version";
    }

    private sealed record Space(Guid TenantId, Guid UserId, TimeZoneInfo Zone, string Culture);
}

/// <summary>
/// What a client reads about their coach (CLI-021, notes plan N4b), composed here so the Clients module knows nothing
/// of the Identity module's record. The server decides it line by line: a confirmed line still up, neither taken down
/// nor erased, that the coach shows, about the coach of the client's current profile, in the client's space, while
/// that coach is staff of it. Like <see cref="FoundingReader"/>, the caller is itself authorized for the space.
/// </summary>
internal static class CoachCertificateReader
{
    /// <summary>The coach's lines a client of theirs in <paramref name="tenantId"/> reads, in the order recorded.</summary>
    public static async Task<IReadOnlyList<OwnCoachLineView>> ShownToClientsAsync(
        GymDbContext dbContext,
        Guid tenantId,
        Guid coachUserId,
        CancellationToken cancellationToken)
    {
        // Only while the coach is staff of the space, as the admin's page decides too. The database already moves a
        // departing coach's clients first (TR_Memberships_DepartingStaff), so this is the second line of defense.
        var culture = await (
                from membership in dbContext.TenantMemberships.AsNoTracking()
                join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
                where membership.TenantId == tenantId &&
                      membership.UserId == coachUserId &&
                      membership.Status == MembershipStatus.Active &&
                      (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach)
                select tenant.DefaultCulture)
            .SingleOrDefaultAsync(cancellationToken);
        if (culture is null)
        {
            return [];
        }

        // The tenant query filter keeps every other space's lines out; the space is named as well.
        var lines = await dbContext.CoachCertificateLines
            .AsNoTracking()
            .Where(CoachCertificateLine.ShownToClients)
            .Where(line => line.TenantId == tenantId && line.CoachUserId == coachUserId)
            .OrderBy(line => line.CreatedAtUtc)
            .ThenBy(line => line.Id)
            .Select(line => new { line.What, line.ShownOn })
            .ToListAsync(cancellationToken);
        return lines
            .Where(line => line.ShownOn is not null)
            .Select(line => new OwnCoachLineView(
                CoachCertificateLineWording.Compose(line.What, line.ShownOn!.Value, culture),
                line.What,
                line.ShownOn.Value))
            .ToList();
    }

    /// <summary>The space's calendar day of an instant.</summary>
    public static DateOnly DayIn(TimeZoneInfo zone, DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
}
