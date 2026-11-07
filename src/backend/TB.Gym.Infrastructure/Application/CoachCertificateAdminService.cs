using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The platform admin's certificate record (CLI-021, notes plan N4a). Every endpoint reaching this is behind the
/// platform-admin policy, so no workspace header is read: reads name their space explicitly and ignore the tenant
/// query filter, and a write sets its space as the request's tenant context first, so it passes the ordinary
/// tenant write guard, as the billing admin's do. Nothing logs a line's words or the confirmer's name.
/// </summary>
internal sealed class CoachCertificateAdminService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext) : ICoachCertificateAdminService
{
    private const int EraseAttempts = 3;

    private static readonly StringComparer NameOrder = StringComparer.Create(
        System.Globalization.CultureInfo.InvariantCulture,
        ignoreCase: true);

    public async Task<IReadOnlyList<CoachCertificateCoachView>> ListCoachesAsync(CancellationToken cancellationToken)
    {
        var lines = dbContext.CoachCertificateLines.IgnoreQueryFilters().AsNoTracking();
        var memberships = await (
                from membership in dbContext.TenantMemberships.AsNoTracking()
                join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
                join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
                where (membership.Status == MembershipStatus.Active &&
                       (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach)) ||
                      lines.Any(line => line.TenantId == membership.TenantId && line.CoachUserId == membership.UserId)
                select new
                {
                    membership.TenantId,
                    membership.UserId,
                    membership.Role,
                    membership.Status,
                    SpaceName = tenant.Name,
                    user.DisplayName,
                    user.Email,
                })
            .ToListAsync(cancellationToken);

        var counts = (await lines
                .GroupBy(line => new { line.TenantId, line.CoachUserId })
                .Select(group => new
                {
                    group.Key.TenantId,
                    group.Key.CoachUserId,
                    Waiting = group.Count(line => line.ConfirmedAtUtc == null),
                    Confirmed = group.Count(line =>
                        line.ConfirmedAtUtc != null && line.TakenDownAtUtc == null && line.ErasedAtUtc == null),
                    TakenDown = group.Count(line => line.TakenDownAtUtc != null && line.ErasedAtUtc == null),
                    Erased = group.Count(line => line.ErasedAtUtc != null),
                })
                .ToListAsync(cancellationToken))
            .ToDictionary(item => (item.TenantId, item.CoachUserId));

        return memberships
            .Select(item =>
            {
                counts.TryGetValue((item.TenantId, item.UserId), out var count);
                return new CoachCertificateCoachView(
                    item.UserId,
                    item.DisplayName,
                    item.Email ?? string.Empty,
                    item.TenantId,
                    item.SpaceName,
                    RoleOf(item.Role),
                    IsActiveStaff(item.Role, item.Status),
                    count?.Waiting ?? 0,
                    count?.Confirmed ?? 0,
                    count?.TakenDown ?? 0,
                    count?.Erased ?? 0);
            })
            .OrderBy(item => item.Name, NameOrder)
            .ThenBy(item => item.SpaceName, NameOrder)
            .ThenBy(item => item.TenantId)
            .ToList();
    }

    public async Task<CoachCertificateCommandResult<CoachCertificateLinesView>> ListLinesAsync(
        Guid userId,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var member = await MemberAsync(userId, tenantId, cancellationToken);
        if (member is null)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateLinesView>();
        }

        var lines = await dbContext.CoachCertificateLines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(line => line.TenantId == tenantId && line.CoachUserId == userId)
            .OrderByDescending(line => line.CreatedAtUtc)
            .ThenByDescending(line => line.Id)
            .ToListAsync(cancellationToken);
        if (!member.IsStaffRole && lines.Count == 0)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateLinesView>();
        }

        var names = await NamesAsync(lines, cancellationToken);
        return CoachCertificateCommand.Success(new CoachCertificateLinesView(
            member.UserId,
            member.Name,
            member.Email,
            member.TenantId,
            member.SpaceName,
            member.Role,
            member.IsActiveStaff,
            member.Today,
            lines.Select(line => ToView(line, member, names)).ToList()));
    }

    public async Task<CoachCertificateCommandResult<CoachCertificateLineView>> AddLineAsync(
        Guid userId,
        Guid tenantId,
        AddCoachCertificateLineRequest? request,
        CancellationToken cancellationToken)
    {
        // Only for someone who is staff of the space right now; anyone else is not found, as a missing space is.
        var member = await MemberAsync(userId, tenantId, cancellationToken);
        if (member is not { IsActiveStaff: true })
        {
            return CoachCertificateCommand.NotFound<CoachCertificateLineView>();
        }

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var words = string.Empty;
        var day = default(DateOnly);
        try
        {
            words = CoachCertificateLine.NormalizeWhat(request?.What);
        }
        catch (ArgumentException exception)
        {
            errors[Fields.What] = [exception.PersonMessage()];
        }

        try
        {
            day = CoachCertificateLine.NormalizeShownOn(request?.ShownOn, member.Today);
        }
        catch (ArgumentException exception)
        {
            errors[Fields.ShownOn] = [exception.PersonMessage()];
        }

        if (errors.Count > 0)
        {
            return CoachCertificateCommand.Invalid<CoachCertificateLineView>(errors);
        }

        var admin = RequiredAdmin();
        tenantContext.SetTenant(tenantId);
        CoachCertificateLine? recorded = null;
        var created = false;
        try
        {
            var gone = await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                // A retry starts from what is stored.
                dbContext.ChangeTracker.Clear();
                created = false;
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                // Adds for one coach in one space take turns on their membership row, so a double press finds the
                // first one's line and never trips the unique index, whose refusal PostgreSQL would write to its
                // own log with the words. The lock also holds off a removal: the coach is still staff when the line
                // is written.
                await dbContext.Database.ExecuteSqlAsync(
                    $"""SELECT 1 FROM tenancy."Memberships" WHERE "TenantId" = {tenantId} AND "UserId" = {userId} FOR UPDATE /* certificate-add */""",
                    cancellationToken);
                if (!await IsActiveStaffNowAsync(tenantId, userId, cancellationToken))
                {
                    return true;
                }

                recorded = await SameLineAsync(tenantId, userId, words, day, cancellationToken);
                if (recorded is null)
                {
                    recorded = CoachCertificateLine.Add(tenantId, userId, words, day, member.Today, admin);
                    dbContext.CoachCertificateLines.Add(recorded);
                    await dbContext.SaveChangesAsync(cancellationToken);
                    created = true;
                }

                await transaction.CommitAsync(cancellationToken);
                return false;
            });
            if (gone)
            {
                return CoachCertificateCommand.NotFound<CoachCertificateLineView>();
            }
        }
        catch (DbUpdateException exception) when (CheckInResponseApplicationService.IsConstraintViolation(
            exception,
            DatabaseConstraintNames.OneCoachCertificateLinePerWordsAndDay))
        {
            // Only a write made past this lock can still race here; the line already recorded is the answer.
            dbContext.ChangeTracker.Clear();
            created = false;
            recorded = await SameLineAsync(tenantId, userId, words, day, cancellationToken)
                ?? throw new InvalidOperationException("The certificate line that won the race could not be read.", exception);
        }

        var view = await ViewAsync(recorded!, member, cancellationToken);
        return created ? CoachCertificateCommand.Created(view) : CoachCertificateCommand.Success(view);
    }

    /// <summary>Whether the person is active staff of the space as the database stands now.</summary>
    private Task<bool> IsActiveStaffNowAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken) =>
        dbContext.TenantMemberships
            .AsNoTracking()
            .AnyAsync(
                membership => membership.TenantId == tenantId &&
                              membership.UserId == userId &&
                              membership.Status == MembershipStatus.Active &&
                              (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach),
                cancellationToken);

    public async Task<CoachCertificateCommandResult<CoachCertificateLineView>> ConfirmLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        ConfirmCoachCertificateLineRequest? request,
        CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var name = string.Empty;
        try
        {
            name = CoachCertificateLine.NormalizeConfirmedByName(request?.ConfirmedByName);
        }
        catch (ArgumentException exception)
        {
            errors[Fields.ConfirmedByName] = [exception.PersonMessage()];
        }

        if (request?.Version is null)
        {
            errors[Fields.Version] = [CoachCertificateText.VersionRequired];
        }

        if (errors.Count > 0)
        {
            return CoachCertificateCommand.Invalid<CoachCertificateLineView>(errors);
        }

        var (member, line) = await TrackedLineAsync(userId, tenantId, lineId, cancellationToken);
        if (member is null || line is null)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateLineView>();
        }

        if (line.Version != request!.Version!.Value)
        {
            return Changed<CoachCertificateLineView>();
        }

        if (line.State != CoachCertificateLineState.Waiting)
        {
            return WrongState<CoachCertificateLineView>(CoachCertificateText.ConfirmNotWaiting);
        }

        dbContext.Entry(line).Property(item => item.Version).OriginalValue = request.Version.Value;
        line.Confirm(name, clock.UtcNow);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Changed<CoachCertificateLineView>();
        }

        return CoachCertificateCommand.Success(await ViewAsync(line, member, cancellationToken));
    }

    public async Task<CoachCertificateCommandResult<CoachCertificateDropView>> DropLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        CoachCertificateLineChangeRequest? request,
        CancellationToken cancellationToken)
    {
        if (request?.Version is not { } version)
        {
            return VersionMissing<CoachCertificateDropView>();
        }

        var (member, line) = await TrackedLineAsync(userId, tenantId, lineId, cancellationToken);
        if (member is null || line is null)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateDropView>();
        }

        if (line.Version != version)
        {
            return Changed<CoachCertificateDropView>();
        }

        if (line.State != CoachCertificateLineState.Waiting)
        {
            return WrongState<CoachCertificateDropView>(CoachCertificateText.DropNotWaiting);
        }

        line.EnsureCanDrop();
        dbContext.Entry(line).Property(item => item.Version).OriginalValue = version;
        dbContext.CoachCertificateLines.Remove(line);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Changed<CoachCertificateDropView>();
        }

        return CoachCertificateCommand.Success(new CoachCertificateDropView(lineId));
    }

    public async Task<CoachCertificateCommandResult<CoachCertificateLineView>> TakeDownLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        CoachCertificateLineChangeRequest? request,
        CancellationToken cancellationToken)
    {
        if (request?.Version is not { } version)
        {
            return VersionMissing<CoachCertificateLineView>();
        }

        var (member, line) = await TrackedLineAsync(userId, tenantId, lineId, cancellationToken);
        if (member is null || line is null)
        {
            return CoachCertificateCommand.NotFound<CoachCertificateLineView>();
        }

        if (line.Version != version)
        {
            return Changed<CoachCertificateLineView>();
        }

        if (line.State != CoachCertificateLineState.Confirmed)
        {
            return WrongState<CoachCertificateLineView>(CoachCertificateText.TakeDownNotConfirmed);
        }

        dbContext.Entry(line).Property(item => item.Version).OriginalValue = version;
        line.TakeDown(RequiredAdmin(), clock.UtcNow);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Changed<CoachCertificateLineView>();
        }

        return CoachCertificateCommand.Success(await ViewAsync(line, member, cancellationToken));
    }

    public async Task<CoachCertificateCommandResult<CoachCertificateErasureView>> EraseAsync(
        Guid userId,
        Guid tenantId,
        EraseCoachCertificateLinesRequest? request,
        CancellationToken cancellationToken)
    {
        // A departed coach's request is met too: anyone the lines read answers for, staff or holding a line.
        var member = await MemberAsync(userId, tenantId, cancellationToken);
        if (member is null ||
            (!member.IsStaffRole &&
             !await dbContext.CoachCertificateLines
                 .IgnoreQueryFilters()
                 .AnyAsync(line => line.TenantId == tenantId && line.CoachUserId == userId, cancellationToken)))
        {
            return CoachCertificateCommand.NotFound<CoachCertificateErasureView>();
        }

        DateOnly requestedOn;
        try
        {
            requestedOn = CoachCertificateLine.NormalizeRequestedOn(request?.RequestedOn, member.Today);
        }
        catch (ArgumentException exception)
        {
            return CoachCertificateCommand.Invalid<CoachCertificateErasureView>(
                new Dictionary<string, string[]>(StringComparer.Ordinal)
                {
                    [Fields.RequestedOn] = [exception.PersonMessage()],
                });
        }

        var admin = RequiredAdmin();
        tenantContext.SetTenant(tenantId);
        for (var attempt = 1; ; attempt++)
        {
            // A retry starts from what is stored: a line confirmed meanwhile is erased, not dropped.
            dbContext.ChangeTracker.Clear();
            var lines = await dbContext.CoachCertificateLines
                .Where(line => line.CoachUserId == userId && line.ErasedAtUtc == null)
                .ToListAsync(cancellationToken);
            if (lines.Count == 0)
            {
                return CoachCertificateCommand.Success(new CoachCertificateErasureView(0, 0));
            }

            var now = clock.UtcNow;
            var erased = 0;
            var dropped = 0;
            foreach (var line in lines)
            {
                if (line.State == CoachCertificateLineState.Waiting)
                {
                    line.EnsureCanDrop();
                    dbContext.CoachCertificateLines.Remove(line);
                    dropped++;
                }
                else
                {
                    line.EraseOnRequest(admin, requestedOn, now);
                    erased++;
                }
            }

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                return CoachCertificateCommand.Success(new CoachCertificateErasureView(erased, dropped));
            }
            catch (DbUpdateConcurrencyException) when (attempt < EraseAttempts)
            {
            }
            catch (DbUpdateConcurrencyException)
            {
                return Changed<CoachCertificateErasureView>();
            }
        }
    }

    /// <summary>
    /// The line in the path, read only once it is known to be this coach's in this space (anything else is not
    /// found), then tracked through the filtered set inside its own space.
    /// </summary>
    private async Task<(Member? Member, CoachCertificateLine? Line)> TrackedLineAsync(
        Guid userId,
        Guid tenantId,
        Guid lineId,
        CancellationToken cancellationToken)
    {
        var belongs = await dbContext.CoachCertificateLines
            .IgnoreQueryFilters()
            .AnyAsync(
                line => line.Id == lineId && line.TenantId == tenantId && line.CoachUserId == userId,
                cancellationToken);
        if (!belongs || await MemberAsync(userId, tenantId, cancellationToken) is not { } member)
        {
            return (null, null);
        }

        tenantContext.SetTenant(tenantId);
        var line = await dbContext.CoachCertificateLines.SingleOrDefaultAsync(item => item.Id == lineId, cancellationToken);
        return (member, line);
    }

    private Task<CoachCertificateLine?> SameLineAsync(
        Guid tenantId,
        Guid userId,
        string words,
        DateOnly day,
        CancellationToken cancellationToken) =>
        dbContext.CoachCertificateLines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(
                line => line.TenantId == tenantId &&
                        line.CoachUserId == userId &&
                        line.What == words &&
                        line.ShownOn == day &&
                        line.ErasedAtUtc == null,
                cancellationToken);

    private async Task<Member?> MemberAsync(Guid userId, Guid tenantId, CancellationToken cancellationToken)
    {
        var row = await (
                from membership in dbContext.TenantMemberships.AsNoTracking()
                join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
                join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
                where membership.TenantId == tenantId && membership.UserId == userId
                select new
                {
                    membership.Role,
                    membership.Status,
                    SpaceName = tenant.Name,
                    tenant.TimeZoneId,
                    tenant.DefaultCulture,
                    user.DisplayName,
                    user.Email,
                })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return null;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(row.TimeZoneId);
        return new Member(
            userId,
            tenantId,
            row.DisplayName,
            row.Email ?? string.Empty,
            row.SpaceName,
            RoleOf(row.Role),
            IsActiveStaff(row.Role, row.Status),
            row.Role is TenantRole.Owner or TenantRole.Coach,
            zone,
            row.DefaultCulture,
            DayIn(zone, clock.UtcNow));
    }

    private async Task<CoachCertificateLineView> ViewAsync(
        CoachCertificateLine line,
        Member member,
        CancellationToken cancellationToken) =>
        ToView(line, member, await NamesAsync([line], cancellationToken));

    private async Task<IReadOnlyDictionary<Guid, string>> NamesAsync(
        IReadOnlyCollection<CoachCertificateLine> lines,
        CancellationToken cancellationToken)
    {
        var ids = lines
            .SelectMany(line => new[] { (Guid?)line.RecordedByUserId, line.TakenDownByUserId, line.ErasedByUserId })
            .OfType<Guid>()
            .Distinct()
            .ToList();
        return ids.Count == 0
            ? new Dictionary<Guid, string>()
            : await dbContext.Users
                .AsNoTracking()
                .Where(user => ids.Contains(user.Id))
                .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
    }

    private static CoachCertificateLineView ToView(
        CoachCertificateLine line,
        Member member,
        IReadOnlyDictionary<Guid, string> names)
    {
        var erased = line.ErasedAtUtc is not null;
        return new CoachCertificateLineView(
            line.Id,
            line.State,
            !erased && line.ShownOn is { } shownOn
                ? CoachCertificateLineWording.Compose(line.What, shownOn, member.Culture)
                : null,
            erased ? null : line.What,
            erased ? null : line.ShownOn,
            CoachCertificateLineWording.Version,
            NameOf(names, line.RecordedByUserId),
            line.CreatedAtUtc,
            DayIn(member.Zone, line.CreatedAtUtc),
            line.ConfirmedAtUtc,
            line.ConfirmedAtUtc is { } confirmedAt ? DayIn(member.Zone, confirmedAt) : null,
            erased ? null : line.ConfirmedByName,
            line.TakenDownAtUtc,
            line.TakenDownAtUtc is { } takenDownAt ? DayIn(member.Zone, takenDownAt) : null,
            line.TakenDownByUserId is { } takenDownBy ? NameOf(names, takenDownBy) : null,
            line.ErasedAtUtc,
            line.ErasedAtUtc is { } erasedAt ? DayIn(member.Zone, erasedAt) : null,
            line.ErasureReason,
            line.RequestedOn,
            line.ErasedByUserId is { } erasedBy ? NameOf(names, erasedBy) : null,
            line.CoachShows,
            // The client's read decides by the same two facts (CoachCertificateReader.ShownToClientsAsync).
            line.IsShownToClients && member.IsActiveStaff,
            line.Version);
    }

    private static string NameOf(IReadOnlyDictionary<Guid, string> names, Guid userId) =>
        names.TryGetValue(userId, out var name) ? name : string.Empty;

    private static DateOnly DayIn(TimeZoneInfo zone, DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);

    private static CoachCertificateRole RoleOf(TenantRole role) => role switch
    {
        TenantRole.Owner => CoachCertificateRole.Owner,
        TenantRole.Coach => CoachCertificateRole.Coach,
        _ => CoachCertificateRole.Client,
    };

    private static bool IsActiveStaff(TenantRole role, MembershipStatus status) =>
        status == MembershipStatus.Active && role is TenantRole.Owner or TenantRole.Coach;

    private Guid RequiredAdmin() =>
        currentUser.UserId ?? throw new InvalidOperationException("A platform admin operation needs a signed-in admin.");

    private static CoachCertificateCommandResult<T> Changed<T>() =>
        CoachCertificateCommand.Conflict<T>(CoachCertificateText.ChangedCode, CoachCertificateText.Changed);

    private static CoachCertificateCommandResult<T> WrongState<T>(string message) =>
        CoachCertificateCommand.Conflict<T>(CoachCertificateText.StateCode, message);

    private static CoachCertificateCommandResult<T> VersionMissing<T>() =>
        CoachCertificateCommand.Invalid<T>(new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            [Fields.Version] = [CoachCertificateText.VersionRequired],
        });

    /// <summary>The request's fields as the page names them, so a refusal lands under its own box.</summary>
    private static class Fields
    {
        public const string What = "what";
        public const string ShownOn = "shownOn";
        public const string ConfirmedByName = "confirmedByName";
        public const string RequestedOn = "requestedOn";
        public const string Version = "version";
    }

    private sealed record Member(
        Guid UserId,
        Guid TenantId,
        string Name,
        string Email,
        string SpaceName,
        CoachCertificateRole Role,
        bool IsActiveStaff,
        bool IsStaffRole,
        TimeZoneInfo Zone,
        string Culture,
        DateOnly Today);
}
