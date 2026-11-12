using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The platform admin's side of the house (CLI-023, ADR 0041): which workspace is the house, its settings with who
/// last changed each, and where sign-up stands this week. A setting is changed by appending one row; nothing here
/// marks a workspace as the house, which only the <c>platform-admin house</c> command does.
/// </summary>
internal sealed class HouseAdminService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext,
    ILogger<HouseAdminService> logger)
    : IHouseAdminService
{
    private static readonly Action<ILogger, HouseSetting, int, Exception?> LogChanged =
        LoggerMessage.Define<HouseSetting, int>(
            LogLevel.Information,
            new EventId(6407, "HouseSettingChanged"),
            "House setting {Setting} changed; its change number {Version} is in force.");

    public async Task<HouseAdminView> GetAsync(CancellationToken cancellationToken)
    {
        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null)
        {
            return new HouseAdminView(null, [], null);
        }

        var now = clock.UtcNow;
        var week = TraineeSignUpRule.WeekOf(
            now,
            TimeZoneInfo.FindSystemTimeZoneById(house.TimeZoneId),
            house.WeekStartsOn);
        var views = await SettingViewsAsync(house.Id, cancellationToken);
        var settings = HouseSettings.From(views.Select(view => KeyValuePair.Create(view.Setting, view.Value)));
        var taken = await HouseReader.ConfirmedBetweenAsync(
            dbContext,
            house.Id,
            week.StartsAtUtc,
            week.EndsAtUtc,
            cancellationToken);
        var waiting = await dbContext.TraineeSignUps
            .IgnoreQueryFilters()
            .CountAsync(signUp => signUp.TenantId == house.Id && signUp.ConfirmedAtUtc == null, cancellationToken);
        return new HouseAdminView(
            new HouseWorkspaceView(house.Id, house.Name, house.Slug, house.TimeZoneId, house.WeekStartsOn, week.Today),
            views,
            new HouseSignUpView(
                TraineeSignUpRule.Status(hasHouse: true, settings, taken),
                week.StartsOn,
                week.EndsOnExclusive,
                taken,
                waiting));
    }

    public async Task<HouseSettingResult> ChangeSettingAsync(
        HouseSetting setting,
        ChangeHouseSettingRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!Enum.IsDefined(setting))
        {
            return new HouseSettingResult(HouseSettingStatus.NotFound);
        }

        var value = HouseSettingRule.Normalize(setting, request.Value);
        if (!value.IsValid)
        {
            return new HouseSettingResult(
                HouseSettingStatus.Invalid,
                Errors: new Dictionary<string, string[]> { ["value"] = [value.Error!] });
        }

        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null)
        {
            return new HouseSettingResult(HouseSettingStatus.NoHouse);
        }

        // The admin names no workspace in a header; the house's rows are written inside the house's scope.
        tenantContext.SetTenant(house.Id);
        var current = (await SettingViewsAsync(house.Id, cancellationToken)).Single(view => view.Setting == setting);
        if (request.ExpectedVersion != current.Version)
        {
            return new HouseSettingResult(HouseSettingStatus.Conflict);
        }

        // Saving what already stands records nothing: the history holds changes, not visits.
        if (string.Equals(current.Value, value.Value, StringComparison.Ordinal))
        {
            return new HouseSettingResult(HouseSettingStatus.Changed, current);
        }

        var adminUserId = currentUser.UserId
            ?? throw new InvalidOperationException("A house setting is changed by a signed-in platform admin.");
        var change = HouseSettingChange.Record(
            house.Id,
            setting,
            current.Version + 1,
            value.Value,
            adminUserId,
            clock.UtcNow);
        dbContext.HouseSettingChanges.Add(change);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another admin's change took this number first (the unique index), or the mark moved meanwhile.
            dbContext.ChangeTracker.Clear();
            return new HouseSettingResult(HouseSettingStatus.Conflict);
        }

        LogChanged(logger, setting, change.Sequence, null);
        return new HouseSettingResult(
            HouseSettingStatus.Changed,
            (await SettingViewsAsync(house.Id, cancellationToken)).Single(view => view.Setting == setting));
    }

    /// <summary>Every setting the house has, each with its change in force, or empty at version 0.</summary>
    private async Task<IReadOnlyList<HouseSettingView>> SettingViewsAsync(
        Guid houseId,
        CancellationToken cancellationToken)
    {
        var latest = await (
            from change in dbContext.HouseSettingChanges.IgnoreQueryFilters().AsNoTracking()
            join user in dbContext.Users.AsNoTracking() on change.ChangedByUserId equals user.Id
            where change.TenantId == houseId &&
                  !dbContext.HouseSettingChanges.Any(later =>
                      later.TenantId == houseId &&
                      later.Setting == change.Setting &&
                      later.Sequence > change.Sequence)
            select new HouseSettingView(
                change.Setting,
                change.Value,
                change.Sequence,
                change.ChangedAtUtc,
                change.ChangedByUserId,
                user.DisplayName))
            .ToListAsync(cancellationToken);
        return [.. Enum.GetValues<HouseSetting>()
            .Select(setting => latest.SingleOrDefault(view => view.Setting == setting)
                ?? new HouseSettingView(setting, null, 0))];
    }
}

/// <summary>
/// Removes the house's sign-ups whose email was never confirmed (CLI-025): each waiting sign-up older than the
/// configured days is deleted with the name and date of birth it held, and its never-confirmed account is emptied,
/// so the email is free again and nothing of the person is kept. It touches nothing else: no coach's account, no
/// confirmed trainee, and no append-only record.
/// </summary>
/// <remarks>
/// A sign-up into the house creates no membership and no client profile until it is confirmed, so there is nothing
/// of those to remove. The account row itself stays, emptied, because its confirmation mail history and any legal
/// acceptance it recorded are append-only and name it; what it keeps identifies nobody. Each sign-up is removed in
/// a scope and a transaction of its own, taking the sign-up's row lock first, as a confirmation does: whichever of
/// the two gets there first wins, and the other finds nothing to do. It logs counts only.
/// </remarks>
internal sealed class TraineeSignUpSweep(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<TraineeSignUpOptions> options,
    ILogger<TraineeSignUpSweep> logger)
    : ITraineeSignUpSweep
{
    /// <summary>The reserved domain an emptied account's address sits under: no mail can ever reach it.</summary>
    internal const string RemovedAddressDomain = "signup.tbgym.invalid";

    private const int BatchSize = 500;

    private static readonly Action<ILogger, int, Exception?> LogRemoved =
        LoggerMessage.Define<int>(
            LogLevel.Information,
            new EventId(6403, "TraineeSignUpsRemoved"),
            "Trainee sign-up sweep: {Removed} sign-ups never confirmed were removed.");

    private static readonly Action<ILogger, int, Exception?> LogSkipped =
        LoggerMessage.Define<int>(
            LogLevel.Warning,
            new EventId(6404, "TraineeSignUpsSkipped"),
            "Trainee sign-up sweep: {Skipped} sign-ups changed while being swept or failed, and wait for the next sweep.");

    public async Task<TraineeSignUpSweepResult> RunAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var cutOff = now.AddDays(-options.Value.RemoveUnconfirmedAfterDays);
        var due = await dbContext.TraineeSignUps
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(signUp => signUp.ConfirmedAtUtc == null && signUp.RequestedAtUtc < cutOff)
            .OrderBy(signUp => signUp.RequestedAtUtc)
            .ThenBy(signUp => signUp.Id)
            .Take(BatchSize)
            .Select(signUp => new { signUp.Id, signUp.TenantId })
            .ToListAsync(cancellationToken);

        var removed = 0;
        var skipped = 0;
        foreach (var signUp in due)
        {
            bool gone;
            try
            {
                gone = await RemoveAsync(signUp.Id, signUp.TenantId, cutOff, now, cancellationToken);
            }
            catch (DbUpdateException)
            {
                gone = false;
            }

            if (gone)
            {
                removed++;
            }
            else
            {
                skipped++;
            }
        }

        if (removed > 0)
        {
            LogRemoved(logger, removed, null);
        }

        if (skipped > 0)
        {
            LogSkipped(logger, skipped, null);
        }

        return new TraineeSignUpSweepResult(removed, skipped);
    }

    private async Task<bool> RemoveAsync(
        Guid signUpId,
        Guid tenantId,
        DateTimeOffset cutOff,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var house = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return await house.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            house.ChangeTracker.Clear();
            await using var transaction = await house.Database.BeginTransactionAsync(cancellationToken);
            await house.Database.ExecuteSqlAsync(
                $"""SELECT 1 FROM tenancy."TraineeSignUps" WHERE "Id" = {signUpId} FOR UPDATE /* trainee-sign-up */""",
                cancellationToken);
            // Read under the lock: a confirmation that got here first has made it a trainee's.
            var signUp = await house.TraineeSignUps.SingleOrDefaultAsync(item => item.Id == signUpId, cancellationToken);
            if (signUp is null || !signUp.IsPending || signUp.RequestedAtUtc >= cutOff)
            {
                return false;
            }

            // An account confirmed some other way is somebody's: only the waiting sign-up goes.
            var user = await users.FindByIdAsync(signUp.UserId.ToString());
            if (user is { EmailConfirmed: false })
            {
                var address = $"removed-{user.Id:N}@{RemovedAddressDomain}";
                user.Email = address;
                user.UserName = address;
                user.DisplayName = string.Empty;
                user.PhoneNumber = null;
                user.PasswordHash = null;
                user.LockoutEnabled = true;
                user.LockoutEnd = now.AddYears(100);
                user.UpdatedAtUtc = now;
                // Saves the account, with its normalized address, and spends every link it was ever sent.
                if (!(await users.UpdateSecurityStampAsync(user)).Succeeded)
                {
                    return false;
                }
            }

            house.TraineeSignUps.Remove(signUp);
            await house.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        });
    }
}
