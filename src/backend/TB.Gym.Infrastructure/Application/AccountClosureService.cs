using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Closes a client's TB Gym account (CLI-027, notes plan N9e): every coaching space they are a current client of is
/// left as Leave leaves it, every client record of theirs, current or earlier, is anonymised, the invitations they
/// accepted lose what the coach typed about them, their progress photos are removed and fall due for the media purge
/// at once, a sign-up still waiting is deleted, and the account itself is emptied and locked so it can never sign in
/// again and its address is free for a new person. What may not be deleted stays under the anonymous record:
/// payments, plans, workouts, records, maxes, and every append-only history (SYS-004).
/// </summary>
/// <remarks>
/// <para>
/// All or nothing, in one database transaction. A request's workspace cannot change, so each coaching space is
/// written through a scope of its own, set to that space, whose context joins the account's connection and
/// transaction: every write keeps its own space's query filter and write guard, and a failure anywhere rolls the
/// whole closing back, leaving the account as it was. A waiting sign-up's row lock and then the account's come first,
/// in the order a confirmation and the sign-up sweep take them, so two closings of one account, or a closing and a
/// confirmation, never interleave. A join, an invitation's acceptance or an upload never locks the account: one that
/// read it before the closing either committed first, and is closed with the rest, or waits on the account's row and
/// is refused at its commit by the database (<c>identity.refuse_closed_account</c>).
/// </para>
/// <para>
/// Who may be closed here: an account that never owned or coached a space and is not a platform admin. A staff
/// account carries the names of what it wrote in other people's records and is not closed by this (the row's Left
/// out). The person's own password is asked again for a closing from Me; the platform admin's closing on request
/// records the day the person asked. It logs counts only.
/// </para>
/// </remarks>
internal sealed class AccountClosureService(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    ILogger<AccountClosureService> logger)
    : IAccountClosureService
{
    /// <summary>The reserved domain a closed account's address sits under: no mail can ever reach it.</summary>
    internal const string ClosedAddressDomain = "closed.tbgym.invalid";

    /// <summary>What the space's history records as the reason the client left.</summary>
    internal const string LeftReason = "The client closed their TB Gym account.";

    /// <summary>What each plan, program and meal plan the closing cancels records.</summary>
    internal const string ClosureReason = "Closed because the client closed their TB Gym account.";

    /// <summary>What each progress photo's removal records.</summary>
    internal const string PhotoRemovalReason = "Removed because the client closed their TB Gym account.";

    private static readonly Action<ILogger, string, int, int, int, Exception?> LogClosed =
        LoggerMessage.Define<string, int, int, int>(
            LogLevel.Information,
            new EventId(6501, "AccountClosed"),
            "An account was closed ({Source}): {SpacesLeft} coaching spaces left, {RecordsAnonymised} client records anonymised, {PhotosRemoved} photos removed.");

    public Task<AccountClosureResult> CloseOwnAsync(Guid userId, string password, CancellationToken cancellationToken) =>
        CloseAsync(userId, password, AccountClosureSource.Self, requestedOn: null, actorUserId: userId, cancellationToken);

    public async Task<AccountClosureResult> CloseOnRequestAsync(
        string email,
        DateOnly requestedOn,
        Guid adminUserId,
        CancellationToken cancellationToken)
    {
        Guid? userId;
        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            userId = (await users.FindByEmailAsync(email.Trim()))?.Id;
        }

        return userId is { } id
            ? await CloseAsync(id, password: null, AccountClosureSource.OnRequest, requestedOn, adminUserId, cancellationToken)
            : new AccountClosureResult(AccountClosureStatus.NotFound);
    }

    private async Task<AccountClosureResult> CloseAsync(
        Guid userId,
        string? password,
        AccountClosureSource source,
        DateOnly? requestedOn,
        Guid actorUserId,
        CancellationToken cancellationToken)
    {
        await using var accountScope = scopeFactory.CreateAsyncScope();
        var account = accountScope.ServiceProvider.GetRequiredService<GymDbContext>();
        var users = accountScope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        try
        {
            return await account.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                account.ChangeTracker.Clear();
                await using var transaction = await account.Database.BeginTransactionAsync(cancellationToken);
                // A waiting sign-up's row before the account's, the order a confirmation and the sign-up sweep take
                // them in, so the three never wait on each other in a circle.
                await account.Database.ExecuteSqlAsync(
                    $"""SELECT 1 FROM tenancy."TraineeSignUps" WHERE "UserId" = {userId} AND "ConfirmedAtUtc" IS NULL FOR UPDATE /* trainee-sign-up */""",
                    cancellationToken);
                await account.Database.ExecuteSqlAsync(
                    $"""SELECT 1 FROM identity."Users" WHERE "Id" = {userId} FOR UPDATE /* account-closure */""",
                    cancellationToken);
                if (await account.AccountClosures.AnyAsync(item => item.UserId == userId, cancellationToken))
                {
                    return new AccountClosureResult(AccountClosureStatus.AlreadyClosed);
                }

                var user = await account.Users.SingleOrDefaultAsync(item => item.Id == userId, cancellationToken);
                if (user is null)
                {
                    return new AccountClosureResult(AccountClosureStatus.NotFound);
                }

                if (password is not null && !await users.CheckPasswordAsync(user, password))
                {
                    return new AccountClosureResult(AccountClosureStatus.WrongPassword);
                }

                if (await users.IsInRoleAsync(user, SystemRoles.PlatformAdmin))
                {
                    return new AccountClosureResult(AccountClosureStatus.PlatformAdmin);
                }

                // Memberships carry no query filter: every space the person was ever part of, in any role.
                var memberships = await account.TenantMemberships
                    .AsNoTracking()
                    .Where(membership => membership.UserId == userId)
                    .Select(membership => new { membership.TenantId, membership.Role })
                    .ToListAsync(cancellationToken);
                if (memberships.Any(membership => membership.Role != TenantRole.Client))
                {
                    return new AccountClosureResult(AccountClosureStatus.Staff);
                }

                var spaces = memberships.Select(membership => membership.TenantId)
                    .Concat(await account.ClientProfiles.IgnoreQueryFilters()
                        .Where(profile => profile.UserId == userId)
                        .Select(profile => profile.TenantId)
                        .ToListAsync(cancellationToken))
                    .Concat(await account.TraineeSignUps.IgnoreQueryFilters()
                        .Where(signUp => signUp.UserId == userId)
                        .Select(signUp => signUp.TenantId)
                        .ToListAsync(cancellationToken))
                    .Concat(await account.ClientInvitations.IgnoreQueryFilters()
                        .Where(invitation => invitation.AcceptedByUserId == userId)
                        .Select(invitation => invitation.TenantId)
                        .ToListAsync(cancellationToken))
                    .Distinct()
                    .Order()
                    .ToList();

                var now = clock.UtcNow;
                var connection = account.Database.GetDbConnection();
                var shared = transaction.GetDbTransaction();
                var done = new SpaceClosure(0, 0, 0);
                foreach (var tenantId in spaces)
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
                    var space = scope.ServiceProvider.GetRequiredService<GymDbContext>();
                    space.Database.SetDbConnection(connection, contextOwnsConnection: false);
                    await space.Database.UseTransactionAsync(shared, cancellationToken);
                    done += await CloseInSpaceAsync(
                        scope.ServiceProvider,
                        space,
                        tenantId,
                        userId,
                        actorUserId,
                        now,
                        cancellationToken);
                }

                await EmptyAccountAsync(account, users, user, now, cancellationToken);
                var closure = AccountClosure.Record(
                    userId,
                    source,
                    actorUserId,
                    requestedOn,
                    now,
                    done.SpacesLeft,
                    done.RecordsAnonymised,
                    done.PhotosRemoved);
                account.AccountClosures.Add(closure);
                await account.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                LogClosed(logger, source.ToString(), done.SpacesLeft, done.RecordsAnonymised, done.PhotosRemoved, null);
                return new AccountClosureResult(
                    AccountClosureStatus.Closed,
                    new AccountClosureView(
                        closure.ClosedAtUtc,
                        closure.RequestedOn,
                        closure.SpacesLeft,
                        closure.RecordsAnonymised,
                        closure.PhotosRemoved));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            // Someone changed the person's record while it closed (a coach's save, a sign-up confirmed): the whole
            // closing was rolled back and nothing is closed, so the person may simply try again.
            return new AccountClosureResult(AccountClosureStatus.Changed);
        }
    }

    /// <summary>
    /// One coaching space: leaves it if the person is a current client there, then anonymises every record of theirs
    /// in it, the invitations they accepted, their declared allergens and their photos, and deletes a sign-up still
    /// waiting. Saved into the closing's transaction; committed only with the rest.
    /// </summary>
    private static async Task<SpaceClosure> CloseInSpaceAsync(
        IServiceProvider services,
        GymDbContext space,
        Guid tenantId,
        Guid userId,
        Guid actorUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var profiles = await space.ClientProfiles
            .Where(profile => profile.UserId == userId)
            .OrderBy(profile => profile.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var spacesLeft = 0;
        // At most one current record a person and space (the unique index); an active membership always has one.
        if (profiles.SingleOrDefault(profile => !profile.IsReleased) is { } current)
        {
            await services.GetRequiredService<ClientProfileApplicationService>().EndInsideTransactionAsync(
                current,
                LeftReason,
                ClientDepartureKind.LeftByClient,
                ClosureReason,
                actorUserId,
                now,
                cancellationToken);
            spacesLeft = 1;
        }

        var recordsAnonymised = 0;
        foreach (var profile in profiles)
        {
            var changed = profile.Anonymise(now);
            if (changed.Count == 0)
            {
                continue;
            }

            space.ClientProfileChanges.Add(ClientProfileChange.Create(
                tenantId,
                profile.Id,
                ClientChangeSource.AccountClosure,
                changed));
            recordsAnonymised++;
        }

        var profileIds = profiles.Select(profile => profile.Id).ToList();
        space.ClientDeclaredAllergens.RemoveRange(await space.ClientDeclaredAllergens
            .Where(allergen => profileIds.Contains(allergen.ClientProfileId))
            .ToListAsync(cancellationToken));

        var photos = await space.ProgressPhotos
            .Where(photo => profileIds.Contains(photo.ClientProfileId))
            .ToListAsync(cancellationToken);
        var photosRemoved = 0;
        foreach (var photo in photos.Where(photo => photo.Status == ProgressPhotoStatus.Active))
        {
            photo.Remove();
            space.ProgressPhotoRemovals.Add(ProgressPhotoRemoval.Create(photo, PhotoRemovalReason, now, actorUserId));
            photosRemoved++;
        }

        // Every photo of theirs, removed now or earlier, and anything they uploaded that never became one.
        var photoAssetIds = photos.Select(photo => photo.MediaAssetId).Distinct().ToList();
        foreach (var asset in await space.MediaAssets
                     .Where(asset => photoAssetIds.Contains(asset.Id) || asset.OwnerUserId == userId)
                     .ToListAsync(cancellationToken))
        {
            asset.PurgeForClosedAccount(now);
        }

        foreach (var invitation in await space.ClientInvitations
                     .Where(invitation => invitation.AcceptedByUserId == userId)
                     .ToListAsync(cancellationToken))
        {
            invitation.Anonymise(now);
        }

        // A sign-up still waiting holds the name and date of birth typed; it is deleted as the sweep deletes one, under
        // the same row lock a confirmation takes.
        await space.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM tenancy."TraineeSignUps" WHERE "TenantId" = {tenantId} AND "UserId" = {userId} FOR UPDATE /* trainee-sign-up */""",
            cancellationToken);
        space.TraineeSignUps.RemoveRange(await space.TraineeSignUps
            .Where(signUp => signUp.UserId == userId && signUp.ConfirmedAtUtc == null)
            .ToListAsync(cancellationToken));

        await space.SaveChangesAsync(cancellationToken);
        return new SpaceClosure(spacesLeft, recordsAnonymised, photosRemoved);
    }

    /// <summary>
    /// Empties the account as the sign-up sweep empties one never confirmed (CLI-025): a reserved address unique to it,
    /// no name, phone or password, locked for good, every session and link spent by a new stamp, and its sign-in
    /// tokens, outside logins and claims gone. The row stays, because append-only records name it.
    /// </summary>
    private static async Task EmptyAccountAsync(
        GymDbContext account,
        UserManager<ApplicationUser> users,
        ApplicationUser user,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await account.UserTokens.Where(token => token.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);
        await account.UserLogins.Where(login => login.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);
        await account.UserClaims.Where(claim => claim.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);

        var address = $"closed-{user.Id:N}@{ClosedAddressDomain}";
        user.Email = address;
        user.UserName = address;
        user.DisplayName = string.Empty;
        user.PhoneNumber = null;
        user.PhoneNumberConfirmed = false;
        user.TwoFactorEnabled = false;
        user.PasswordHash = null;
        user.LockoutEnabled = true;
        user.LockoutEnd = now.AddYears(100);
        user.UpdatedAtUtc = now;
        // Saves the account with its normalized address, and spends every session and link it was ever given.
        var saved = await users.UpdateSecurityStampAsync(user);
        if (!saved.Succeeded)
        {
            throw new InvalidOperationException("The closed account could not be saved.");
        }
    }

    private readonly record struct SpaceClosure(int SpacesLeft, int RecordsAnonymised, int PhotosRemoved)
    {
        public static SpaceClosure operator +(SpaceClosure left, SpaceClosure right) =>
            new(
                left.SpacesLeft + right.SpacesLeft,
                left.RecordsAnonymised + right.RecordsAnonymised,
                left.PhotosRemoved + right.PhotosRemoved);
    }
}
