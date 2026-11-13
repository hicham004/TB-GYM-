using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The house's Free plan (SUB-019, notes plan N9b1): made with the house, started the day a trainee's sign-up is
/// confirmed, and renewed by the Worker before its last day. Each method writes into its caller's unit of work and
/// tenant scope (the house's), so a confirmation joins the house and starts Free in one transaction; it raises no
/// plan notice, since Free never asks for money, never ends and is never renewed by anyone a trainee could ask.
/// </summary>
/// <remarks>
/// Whoever makes the plan holds the house's sign-up lock (<see cref="TraineeSignUpService.SignUpLockKey"/>), so two
/// runs never make two; the unique index on the house's Free plan settles anything that slips past it.
/// </remarks>
internal sealed class HouseFreePlan(GymDbContext dbContext, ITenantContext tenantContext)
{
    /// <summary>
    /// The house's Free plan and its one option, made now in the caller's unit of work when the house has none.
    /// A plan of the staff's own already for sale under Free's name stops it (BILL-7): the caller says so.
    /// </summary>
    /// <exception cref="ProductNameTakenException">A plan for sale in the house is already called Free.</exception>
    public async Task<(CoachingProduct Product, ProductOffer Offer)> EnsureAsync(
        Tenant house,
        CancellationToken cancellationToken)
    {
        EnsureHouseScope(house.Id);
        var product = dbContext.CoachingProducts.Local.SingleOrDefault(item => item.IsHouseFree)
            ?? await dbContext.CoachingProducts.SingleOrDefaultAsync(
                item => item.HouseTier == HouseTier.Free,
                cancellationToken);
        if (product is null)
        {
            product = CoachingProduct.CreateHouseFree(house.Id);
            CoachingProduct.EnsureNameFree(
                product.Id,
                product.Name,
                await dbContext.CoachingProducts.AsNoTracking().Where(item => item.IsActive).ToListAsync(cancellationToken));
            dbContext.CoachingProducts.Add(product);
        }
        else if (!product.IsActive)
        {
            // Taken off sale when the space stopped being the house: back on sale, if its name is still free.
            CoachingProduct.EnsureNameFree(
                product.Id,
                product.Name,
                await dbContext.CoachingProducts.AsNoTracking().Where(item => item.IsActive).ToListAsync(cancellationToken));
            product.SetHouseFreeOnSale(true);
        }

        var offer = dbContext.ProductOffers.Local.SingleOrDefault(item => item.ProductId == product.Id && item.IsActive)
            ?? await dbContext.ProductOffers
                .Include(item => item.Entitlements)
                .Where(item => item.ProductId == product.Id && item.IsActive)
                .OrderBy(item => item.CreatedAtUtc)
                .FirstOrDefaultAsync(cancellationToken);
        if (offer is null)
        {
            offer = ProductOffer.CreateHouseFree(house.Id, product.Id, house.DefaultCurrencyCode);
            dbContext.ProductOffers.Add(offer);
        }

        return (product, offer);
    }

    /// <summary>
    /// Starts Free for a profile of the house from the house's today, in the caller's unit of work, unless it has
    /// started already: the row's command id is the profile's own, so a second start finds the first.
    /// </summary>
    /// <returns>Whether a row was added.</returns>
    public async Task<bool> StartAsync(
        Tenant house,
        Guid clientProfileId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var commandId = HouseFreePlanRule.StartCommandId(clientProfileId);
        if (await dbContext.ClientEnrollments.AnyAsync(item => item.AssignmentCommandId == commandId, cancellationToken))
        {
            return false;
        }

        var (product, offer) = await EnsureAsync(house, cancellationToken);
        dbContext.ClientEnrollments.Add(ClientEnrollment.Assign(
            house.Id,
            clientProfileId,
            product,
            offer,
            TodayIn(house, now),
            commandId,
            now));
        return true;
    }

    /// <summary>
    /// Adds the row that follows <paramref name="previous"/>: from the day it ends, linked to it, in the caller's
    /// unit of work. Its command id is the previous row's own, so a second renewal of one row finds the first.
    /// </summary>
    public async Task RenewAsync(
        Tenant house,
        ClientEnrollment previous,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!previous.IsHouseFree)
        {
            throw new InvalidOperationException("Only a row of the house's Free plan is renewed by the server.");
        }

        var (product, offer) = await EnsureAsync(house, cancellationToken);
        dbContext.ClientEnrollments.Add(ClientEnrollment.Assign(
            house.Id,
            previous.ClientProfileId,
            product,
            offer,
            HouseFreePlanRule.RenewalStart(previous.EndDateExclusive),
            HouseFreePlanRule.RenewalCommandId(previous.Id),
            now,
            previous.Id));
    }

    /// <summary>The house's calendar day at <paramref name="now"/>, in its own time zone.</summary>
    public static DateOnly TodayIn(Tenant house, DateTimeOffset now) =>
        PaymentDay.Of(now, TimeZoneInfo.FindSystemTimeZoneById(house.TimeZoneId));

    private void EnsureHouseScope(Guid houseId)
    {
        if (!tenantContext.HasTenant || tenantContext.TenantId != houseId)
        {
            throw new InvalidOperationException("The house's Free plan is written in the house's own scope.");
        }
    }
}

/// <summary>
/// Free's sweep (SUB-019): renews each current trainee's last Free row once it ends within
/// <see cref="HouseFreePlanRule.RenewWithinDays"/> days, from its exclusive end and linked to it, and starts Free for a
/// self-directed trainee of the house who has none. A trainee who left keeps what they had and is never renewed; a
/// blocked one is renewed, so lifting the block finds Free in place (a block decides access, not the plan).
/// </summary>
/// <remarks>
/// Each trainee is written in a scope and a transaction of its own under the house's sign-up lock, so one failure
/// leaves the rest, and two Workers end with one row: the second finds the first's row, or the unique command id and
/// the exclusion on Free's rows refuse its copy. It logs counts only, never who.
/// </remarks>
internal sealed class HouseFreePlanRenewal(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    ILogger<HouseFreePlanRenewal> logger)
    : IHouseFreePlanRenewal
{
    private const int BatchSize = 500;

    private static readonly Action<ILogger, int, int, Exception?> LogDone =
        LoggerMessage.Define<int, int>(
            LogLevel.Information,
            new EventId(6411, "HouseFreePlanSwept"),
            "Free plan sweep: {Started} trainees started and {Renewed} rows renewed.");

    private static readonly Action<ILogger, int, Exception?> LogSkipped =
        LoggerMessage.Define<int>(
            LogLevel.Warning,
            new EventId(6412, "HouseFreePlanSkipped"),
            "Free plan sweep: {Skipped} trainees changed while being swept or failed, and wait for the next sweep.");

    private static readonly Action<ILogger, Exception?> LogNameTaken =
        LoggerMessage.Define(
            LogLevel.Warning,
            new EventId(6413, "HouseFreePlanNameTaken"),
            "Free plan sweep: the house sells a plan of its own under Free's name, so Free cannot be made; rename that plan.");

    public async Task<HouseFreePlanRenewalResult> RunAsync(CancellationToken cancellationToken)
    {
        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null)
        {
            return new HouseFreePlanRenewalResult(0, 0, 0);
        }

        var now = clock.UtcNow;
        var dueBy = HouseFreePlanRule.DueBy(HouseFreePlan.TodayIn(house, now));
        var houseId = house.Id;
        var enrollments = dbContext.ClientEnrollments.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == houseId);
        var current = dbContext.ClientProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == houseId && item.ReleasedAtUtc == null && item.UserId != null);

        // Each current trainee's last Free row, when it ends within the window. Free's rows never overlap, so the
        // row that ends last is the last.
        var due = await enrollments
            .Where(item =>
                item.HouseTier == HouseTier.Free &&
                item.Status != EnrollmentStatus.Cancelled &&
                item.EndDateExclusive <= dueBy &&
                current.Any(profile => profile.Id == item.ClientProfileId) &&
                !enrollments.Any(later =>
                    later.ClientProfileId == item.ClientProfileId &&
                    later.HouseTier == HouseTier.Free &&
                    later.EndDateExclusive > item.EndDateExclusive))
            .OrderBy(item => item.EndDateExclusive)
            .ThenBy(item => item.Id)
            .Select(item => item.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        // A self-directed trainee with no Free row at all.
        var missing = await current
            .Where(profile =>
                profile.IsSelfDirected &&
                !enrollments.Any(item => item.ClientProfileId == profile.Id && item.HouseTier == HouseTier.Free))
            .OrderBy(profile => profile.Id)
            .Select(profile => profile.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        var work = missing.Select(profileId => (Start: (Guid?)profileId, Renew: (Guid?)null))
            .Concat(due.Select(enrollmentId => (Start: (Guid?)null, Renew: (Guid?)enrollmentId)))
            .ToArray();
        var started = 0;
        var renewed = 0;
        var skipped = 0;
        for (var index = 0; index < work.Length; index++)
        {
            var (start, renew) = work[index];
            var written = await WriteAsync(houseId, now, start, renew, cancellationToken);
            if (written == Written.NameTaken)
            {
                // Nothing of Free can be written until the staff's plan is renamed: the rest waits for that.
                LogNameTaken(logger, null);
                skipped += work.Length - index;
                break;
            }

            if (written == Written.Yes)
            {
                if (start is not null)
                {
                    started++;
                }
                else
                {
                    renewed++;
                }
            }
            else if (written == Written.Failed)
            {
                skipped++;
            }
        }

        return Done(started, renewed, skipped);
    }

    private HouseFreePlanRenewalResult Done(int started, int renewed, int skipped)
    {
        if (started + renewed > 0)
        {
            LogDone(logger, started, renewed, null);
        }

        if (skipped > 0)
        {
            LogSkipped(logger, skipped, null);
        }

        return new HouseFreePlanRenewalResult(started, renewed, skipped);
    }

    private async Task<Written> WriteAsync(
        Guid houseId,
        DateTimeOffset now,
        Guid? start,
        Guid? renew,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(houseId);
        var house = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var plan = scope.ServiceProvider.GetRequiredService<HouseFreePlan>();
        try
        {
            return await house.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                house.ChangeTracker.Clear();
                await using var transaction = await house.Database.BeginTransactionAsync(cancellationToken);
                await house.Database.ExecuteSqlAsync(
                    $"SELECT pg_advisory_xact_lock({TraineeSignUpService.SignUpLockKey}) /* house-free-plan */",
                    cancellationToken);
                // Read again under the lock: the house, and whether the trainee still needs this row.
                var tenant = await house.Tenants.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == houseId && item.IsHouse && item.IsActive, cancellationToken);
                if (tenant is null)
                {
                    return Written.No;
                }

                // The trainee's own row lock, as ending a relationship takes it before it cancels their plans: either
                // that commits first and this finds them gone, or it waits and cancels the row written here.
                var lockedProfileId = start ?? await house.ClientEnrollments.AsNoTracking()
                    .Where(item => item.Id == renew)
                    .Select(item => (Guid?)item.ClientProfileId)
                    .SingleOrDefaultAsync(cancellationToken);
                if (lockedProfileId is null)
                {
                    return Written.No;
                }

                await house.Database.ExecuteSqlAsync(
                    $"""SELECT 1 FROM clients."ClientProfiles" WHERE "Id" = {lockedProfileId.Value} FOR UPDATE /* house-free-plan */""",
                    cancellationToken);
                bool added;
                if (start is { } profileId)
                {
                    added = await house.ClientProfiles.AnyAsync(
                                profile => profile.Id == profileId && profile.ReleasedAtUtc == null && profile.IsSelfDirected,
                                cancellationToken) &&
                            !await house.ClientEnrollments.AnyAsync(
                                item => item.ClientProfileId == profileId && item.HouseTier == HouseTier.Free,
                                cancellationToken) &&
                            await plan.StartAsync(tenant, profileId, now, cancellationToken);
                }
                else
                {
                    var previous = await house.ClientEnrollments.AsNoTracking()
                        .SingleOrDefaultAsync(item => item.Id == renew, cancellationToken);
                    added = previous is { IsHouseFree: true, Status: not EnrollmentStatus.Cancelled } &&
                            await house.ClientProfiles.AnyAsync(
                                profile => profile.Id == previous.ClientProfileId && profile.ReleasedAtUtc == null,
                                cancellationToken) &&
                            !await house.ClientEnrollments.AnyAsync(
                                item => item.ClientProfileId == previous.ClientProfileId &&
                                        item.HouseTier == HouseTier.Free &&
                                        item.EndDateExclusive > previous.EndDateExclusive,
                                cancellationToken);
                    if (added)
                    {
                        await plan.RenewAsync(tenant, previous!, now, cancellationToken);
                    }
                }

                if (!added)
                {
                    return Written.No;
                }

                await house.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Written.Yes;
            });
        }
        catch (ProductNameTakenException)
        {
            return Written.NameTaken;
        }
        catch (DbUpdateException)
        {
            // Another Worker wrote the same row first (its command id or Free's exclusion refused this copy), or the
            // database refused it for another reason: either way the next sweep reads what stands.
            return Written.Failed;
        }
    }

    private enum Written
    {
        /// <summary>Nothing to write: the trainee left, has their row already, or the house is no longer marked.</summary>
        No,
        Yes,
        Failed,
        NameTaken,
    }
}
