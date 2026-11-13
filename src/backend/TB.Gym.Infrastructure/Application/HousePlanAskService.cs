using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The house's asks for a paid plan (SUB-020, notes plan N9c1). A trainee asks for one of the house's Pro+ plans on
/// sale, which books nothing, then says the money was sent by Whish; each tells the house's Owner and the trainee's
/// coach in-app, in the same transaction. Once the money is there, one staff step books the plan from the house's
/// day, or from the day the paid plan still running ends, and records its receipt, the exact price only, in one
/// transaction under the staff's idempotency key. Every write of one trainee's asks takes the trainee's record's row
/// lock first, so two taps, two staff or a tap and a booking are told apart one after the other. Asks are closed while
/// the house's Whish number is empty (switched off, 12 Nov 2026).
/// </summary>
internal sealed class HousePlanAskService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ILogger<HousePlanAskService> logger)
    : IHousePlanAskService
{
    private static readonly Action<ILogger, Guid, Exception?> LogAsked = LoggerMessage.Define<Guid>(
        LogLevel.Information,
        new EventId(6416, "HousePlanAsked"),
        "A trainee asked for a plan of the house: ask {AskId}.");

    private static readonly Action<ILogger, Guid, Exception?> LogMoneySent = LoggerMessage.Define<Guid>(
        LogLevel.Information,
        new EventId(6417, "HousePlanMoneySent"),
        "A trainee said the money of ask {AskId} was sent.");

    private static readonly Action<ILogger, Guid, Guid, Exception?> LogBooked = LoggerMessage.Define<Guid, Guid>(
        LogLevel.Information,
        new EventId(6418, "HousePlanBooked"),
        "A plan of the house was booked from ask {AskId} with its receipt: enrollment {EnrollmentId}.");

    private static readonly Action<ILogger, Guid, Exception?> LogClosed = LoggerMessage.Define<Guid>(
        LogLevel.Information,
        new EventId(6419, "HousePlanAskClosed"),
        "An ask for a plan of the house was closed: ask {AskId}.");

    public async Task<HousePlansView?> GetOwnAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return null;
        }

        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantContext.TenantId, cancellationToken);
        var trainee = calendar.IsHouse ? await TraineeAsync(userId, cancellationToken) : null;
        if (trainee is null)
        {
            return null;
        }

        var whishNumber = await WhishNumberAsync(cancellationToken);
        var open = whishNumber is not null && !trainee.IsCoachBlocked;
        return new HousePlansView(
            calendar.Today,
            open,
            open ? whishNumber : null,
            open ? await AskablePlansAsync(cancellationToken) : [],
            await AskViewsAsync(trainee.Id, askId: null, forStaff: false, cancellationToken));
    }

    public async Task<HousePlanAskResult> AskAsync(AskForHousePlanRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        var tenantId = tenantContext.TenantId;
        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantId, cancellationToken);
        if (!calendar.IsHouse)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        var strategy = dbContext.Database.CreateExecutionStrategy();
        var (result, askId) = await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var trainee = await TraineeAsync(userId, cancellationToken);
            if (trainee is null)
            {
                return (new HousePlanAskResult(HousePlanAskStatus.NotFound), (Guid?)null);
            }

            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""SELECT 1 FROM clients."ClientProfiles" WHERE "TenantId" = {tenantId} AND "Id" = {trainee.Id} FOR UPDATE /* house-plan-ask */""",
                cancellationToken);
            // Read again under the lock: a leaving or a block committed while this waited is what stands now.
            trainee = await TraineeAsync(userId, cancellationToken);
            if (trainee is null)
            {
                return (new HousePlanAskResult(HousePlanAskStatus.NotFound), null);
            }

            if (trainee.IsCoachBlocked)
            {
                return (Conflict(
                    HousePlanAskCodes.Blocked,
                    "TB Gym's coaching space has paused your access, so a plan can't be asked for now."), null);
            }

            if (await WhishNumberAsync(cancellationToken) is null)
            {
                return (Conflict(
                    HousePlanAskCodes.AsksClosed,
                    "TB Gym isn't taking asks for a paid plan right now. Nothing you have changes."), null);
            }

            var offer = await dbContext.ProductOffers.AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == request.OfferId, cancellationToken);
            var product = offer is null
                ? null
                : await dbContext.CoachingProducts.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == offer.ProductId, cancellationToken);
            if (offer is null || product is null || !HousePlanAskRule.IsAskable(product, offer))
            {
                return (Conflict(HousePlanAskCodes.NotOnSale, HousePlanAskRule.NotOnSaleMessage), null);
            }

            if (await OpenAskAsync(trainee.Id, cancellationToken) is { } open)
            {
                if (open.OfferId == offer.Id)
                {
                    return (new HousePlanAskResult(HousePlanAskStatus.Unchanged), (Guid?)open.Id);
                }

                var openName = await dbContext.CoachingProducts.AsNoTracking()
                    .Where(item => item.Id == open.ProductId)
                    .Select(item => item.Name)
                    .SingleAsync(cancellationToken);
                var openOption = await dbContext.ProductOffers.AsNoTracking()
                    .Where(item => item.Id == open.OfferId)
                    .Select(item => item.Label)
                    .SingleAsync(cancellationToken);
                return (Conflict(
                    HousePlanAskCodes.AskOpen,
                    $"You already asked for {openName}, {openOption}. TB Gym books it once your money is there, or closes the ask, before you can ask for anything else."), null);
            }

            var now = clock.UtcNow;
            var ask = HousePlanAsk.Create(tenantId, trainee.Id, product, offer, userId, calendar.Today, now);
            dbContext.HousePlanAsks.Add(ask);
            WorkspaceRelationshipNotices.HousePlanAsked(
                dbContext,
                tenantId,
                calendar.TimeZoneId,
                await StaffToTellAsync(trainee, cancellationToken),
                trainee.Id,
                ask.Id,
                now);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            LogAsked(logger, ask.Id, null);
            return (new HousePlanAskResult(HousePlanAskStatus.Created), (Guid?)ask.Id);
        });

        return await WithViewAsync(result, askId, forStaff: false, cancellationToken);
    }

    public async Task<HousePlanAskResult> SayMoneySentAsync(
        Guid askId,
        HousePlanMoneySentRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new Dictionary<string, string[]>();
        if (HousePlanAskRule.NormalizeWhishName(request.WhishName) is { IsValid: false } name)
        {
            errors["whishName"] = [name.Error!];
        }

        if (HousePlanAskRule.NormalizeWhishNumber(request.WhishNumber) is { IsValid: false } number)
        {
            errors["whishNumber"] = [number.Error!];
        }

        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        var tenantId = tenantContext.TenantId;
        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantId, cancellationToken);
        if (!calendar.IsHouse)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        if (errors.Count > 0)
        {
            return new HousePlanAskResult(HousePlanAskStatus.Invalid, Errors: errors);
        }

        var strategy = dbContext.Database.CreateExecutionStrategy();
        var result = await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var trainee = await TraineeAsync(userId, cancellationToken);
            if (trainee is null)
            {
                return new HousePlanAskResult(HousePlanAskStatus.NotFound);
            }

            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""SELECT 1 FROM clients."ClientProfiles" WHERE "TenantId" = {tenantId} AND "Id" = {trainee.Id} FOR UPDATE /* house-plan-money-sent */""",
                cancellationToken);
            trainee = await TraineeAsync(userId, cancellationToken);
            var ask = trainee is null
                ? null
                : await dbContext.HousePlanAsks.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == askId && item.ClientProfileId == trainee.Id, cancellationToken);
            if (trainee is null || ask is null)
            {
                return new HousePlanAskResult(HousePlanAskStatus.NotFound);
            }

            // The same word again answers the first; on an ask already booked or closed nothing else can be said.
            var said = await dbContext.HousePlanTransfers.AsNoTracking()
                .SingleOrDefaultAsync(item => item.AskId == ask.Id, cancellationToken);
            if (said is not null && said.Matches(request.WhishName, request.WhishNumber))
            {
                return new HousePlanAskResult(HousePlanAskStatus.Unchanged);
            }

            if (await dbContext.HousePlanAskOutcomes.AsNoTracking().AnyAsync(item => item.AskId == ask.Id, cancellationToken))
            {
                return Conflict(HousePlanAskCodes.AskEnded, "This ask was already booked or closed. Reload the page to see where it stands.");
            }

            if (said is not null)
            {
                return Conflict(
                    HousePlanAskCodes.MoneyAlreadySent,
                    "You already said you sent this money, from other Whish details. TB Gym looks for it with the details you gave first.");
            }

            var now = clock.UtcNow;
            dbContext.HousePlanTransfers.Add(HousePlanTransfer.Record(
                tenantId,
                ask,
                request.WhishName!,
                request.WhishNumber!,
                calendar.Today,
                now));
            WorkspaceRelationshipNotices.HousePlanMoneySent(
                dbContext,
                tenantId,
                calendar.TimeZoneId,
                await StaffToTellAsync(trainee, cancellationToken),
                trainee.Id,
                ask.Id,
                now);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            LogMoneySent(logger, ask.Id, null);
            return new HousePlanAskResult(HousePlanAskStatus.Changed);
        });

        return await WithViewAsync(result, askId, forStaff: false, cancellationToken);
    }

    public async Task<IReadOnlyList<HousePlanAskView>?> ListForClientAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant ||
            !(await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantContext.TenantId, cancellationToken)).IsHouse ||
            !await dbContext.ClientProfiles.AsNoTracking().AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return null;
        }

        return await AskViewsAsync(clientProfileId, askId: null, forStaff: true, cancellationToken);
    }

    public async Task<HousePlanAskResult> BookAsync(
        Guid clientProfileId,
        Guid askId,
        BookHousePlanAskRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new Dictionary<string, string[]>();
        if (request.IdempotencyKey == Guid.Empty)
        {
            errors["idempotencyKey"] = ["An idempotency key is required."];
        }

        if (MoneyRules.AmountProblem(request.Amount, allowZero: false) is { } amountProblem)
        {
            errors["amount"] = [amountProblem];
        }

        string? currency = null;
        try
        {
            currency = MoneyRules.NormalizeCurrency(request.CurrencyCode ?? string.Empty);
        }
        catch (ArgumentException)
        {
            errors["currencyCode"] = ["Choose the currency the money came in: a three-letter code such as USD."];
        }

        var reference = HousePlanAskRule.NormalizeReference(request.Reference);
        if (!reference.IsValid)
        {
            errors["reference"] = [reference.Error!];
        }

        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        var tenantId = tenantContext.TenantId;
        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantId, cancellationToken);
        if (!calendar.IsHouse)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        if (errors.Count > 0)
        {
            return new HousePlanAskResult(HousePlanAskStatus.Invalid, Errors: errors);
        }

        var amount = decimal.Round(request.Amount, 2);
        var key = request.IdempotencyKey;
        var strategy = dbContext.Database.CreateExecutionStrategy();
        var result = await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"""SELECT 1 FROM clients."ClientProfiles" WHERE "TenantId" = {tenantId} AND "Id" = {clientProfileId} FOR UPDATE /* house-plan-book */""",
                    cancellationToken);
                if (await BookingReplayAsync(clientProfileId, askId, key, amount, currency!, reference.Value, cancellationToken) is { } replay)
                {
                    return replay;
                }

                var ask = await dbContext.HousePlanAsks.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == askId && item.ClientProfileId == clientProfileId, cancellationToken);
                var trainee = ask is null
                    ? null
                    : await dbContext.ClientProfiles.AsNoTracking()
                        .SingleOrDefaultAsync(item => item.Id == clientProfileId && item.ReleasedAtUtc == null, cancellationToken);
                if (ask is null || trainee is null)
                {
                    return new HousePlanAskResult(HousePlanAskStatus.NotFound);
                }

                if (trainee.IsCoachBlocked)
                {
                    return Conflict(
                        HousePlanAskCodes.Blocked,
                        "This trainee is blocked. Unblock them before booking a plan, or close the ask.");
                }

                if (await dbContext.HousePlanAskOutcomes.AsNoTracking().AnyAsync(item => item.AskId == ask.Id, cancellationToken))
                {
                    return Conflict(HousePlanAskCodes.AskEnded, "This ask was already booked or closed. Reload the client to see where it stands.");
                }

                var offer = await dbContext.ProductOffers.AsNoTracking()
                    .Include(item => item.Entitlements)
                    .SingleAsync(item => item.Id == ask.OfferId, cancellationToken);
                var product = await dbContext.CoachingProducts.AsNoTracking()
                    .SingleAsync(item => item.Id == ask.ProductId, cancellationToken);
                if (!string.Equals(currency, offer.PriceCurrency, StringComparison.Ordinal))
                {
                    return Invalid("currencyCode", $"Record the money in the plan's own currency, {offer.PriceCurrency}.");
                }

                if (amount != offer.PriceAmount)
                {
                    return Invalid(
                        "amount",
                        $"Record the plan's exact price, {HousePlanAskRule.Money(offer.PriceAmount, offer.PriceCurrency)}. A part books nothing: wait for the rest, or close the ask.");
                }

                // The plans the new one cannot run beside, as the database weighs them: the trainee's other Pro+ or Max
                // still to end (one paid plan of the house at a time), and any plan holding one of its features alone
                // (the coverage exclusion; Free and a cancelled plan hold none). It starts when the last of them ends.
                var today = calendar.Today;
                var blocking = offer.Entitlements
                    .Where(entitlement => !entitlement.AllowsConcurrentCoverage)
                    .Select(entitlement => entitlement.Feature)
                    .ToArray();
                var tieredEnds = await dbContext.ClientEnrollments.AsNoTracking()
                    .Where(item =>
                        item.ClientProfileId == clientProfileId &&
                        (item.HouseTier == HouseTier.ProPlus || item.HouseTier == HouseTier.Max) &&
                        item.Status != EnrollmentStatus.Cancelled &&
                        item.EndDateExclusive > today)
                    .Select(item => item.EndDateExclusive)
                    .ToListAsync(cancellationToken);
                var coverageEnds = await dbContext.EnrollmentEntitlements.AsNoTracking()
                    .Where(item =>
                        item.ClientProfileId == clientProfileId &&
                        item.BlocksOverlap &&
                        blocking.Contains(item.Feature) &&
                        item.EndDateExclusive > today)
                    .Select(item => item.EndDateExclusive)
                    .ToListAsync(cancellationToken);
                var start = HousePlanAskRule.BookingStart(today, [.. tieredEnds, .. coverageEnds]);

                var now = clock.UtcNow;
                var enrollment = ClientEnrollment.Assign(tenantId, clientProfileId, product, offer, start, key, now);
                // Booked when its money is recorded, and only then (SUB-020): the plan is active from the start.
                enrollment.Activate(now);
                dbContext.ClientEnrollments.Add(enrollment);
                var receipt = PaymentRecord.RecordManualReceipt(
                    tenantId,
                    enrollment.Id,
                    amount,
                    currency!,
                    now,
                    ManualPaymentMethod.MobileWallet,
                    reference.Value,
                    note: null,
                    userId,
                    key,
                    now);
                dbContext.PaymentRecords.Add(receipt);
                dbContext.HousePlanAskOutcomes.Add(HousePlanAskOutcome.Booked(
                    tenantId,
                    ask,
                    enrollment,
                    receipt,
                    userId,
                    today,
                    now));
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                LogBooked(logger, ask.Id, enrollment.Id, null);
                return new HousePlanAskResult(HousePlanAskStatus.Changed);
            }
            catch (DbUpdateException exception) when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.ExclusionViolation,
            } refused)
            {
                // A database guard spoke last: answer what stands now, read after the rollback.
                await transaction.RollbackAsync(cancellationToken);
                await transaction.DisposeAsync();
                dbContext.ChangeTracker.Clear();
                if (await BookingReplayAsync(clientProfileId, askId, key, amount, currency!, reference.Value, cancellationToken) is { } replay)
                {
                    return replay;
                }

                return refused.SqlState == PostgresErrorCodes.ExclusionViolation
                    ? Conflict(
                        HousePlanAskCodes.Overlap,
                        "Another plan already covers some of these days. Reload the client to check their plans.")
                    : Conflict(HousePlanAskCodes.AskEnded, "This ask was already booked or closed. Reload the client to see where it stands.");
            }
        });

        return await WithViewAsync(result, askId, forStaff: true, cancellationToken);
    }

    public async Task<HousePlanAskResult> CloseAsync(
        Guid clientProfileId,
        Guid askId,
        CloseHousePlanAskRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var reason = HousePlanAskRule.NormalizeReason(request.Reason);
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        var tenantId = tenantContext.TenantId;
        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantId, cancellationToken);
        if (!calendar.IsHouse)
        {
            return new HousePlanAskResult(HousePlanAskStatus.NotFound);
        }

        if (!reason.IsValid)
        {
            return Invalid("reason", reason.Error!);
        }

        var strategy = dbContext.Database.CreateExecutionStrategy();
        var result = await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""SELECT 1 FROM clients."ClientProfiles" WHERE "TenantId" = {tenantId} AND "Id" = {clientProfileId} FOR UPDATE /* house-plan-close */""",
                cancellationToken);
            var ask = await dbContext.HousePlanAsks.AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == askId && item.ClientProfileId == clientProfileId, cancellationToken);
            if (ask is null)
            {
                return new HousePlanAskResult(HousePlanAskStatus.NotFound);
            }

            if (await dbContext.HousePlanAskOutcomes.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.AskId == ask.Id, cancellationToken) is { } ended)
            {
                // A second tap of the same closing answers the first; anything else found it ended.
                return ended.Kind == HousePlanAskOutcomeKind.Closed &&
                    string.Equals(ended.Reason, reason.Value, StringComparison.Ordinal)
                    ? new HousePlanAskResult(HousePlanAskStatus.Unchanged)
                    : Conflict(HousePlanAskCodes.AskEnded, "This ask was already booked or closed. Reload the client to see where it stands.");
            }

            dbContext.HousePlanAskOutcomes.Add(HousePlanAskOutcome.Closed(
                tenantId,
                ask,
                reason.Value!,
                userId,
                calendar.Today,
                clock.UtcNow));
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            LogClosed(logger, ask.Id, null);
            return new HousePlanAskResult(HousePlanAskStatus.Changed);
        });

        return await WithViewAsync(result, askId, forStaff: true, cancellationToken);
    }

    /// <summary>
    /// What a booking key already did: the same request booked before answers that booking again; a key a booking,
    /// a plan or a receipt already carries for anything else is a conflict (SUB-011). Null for a key not used yet.
    /// </summary>
    private async Task<HousePlanAskResult?> BookingReplayAsync(
        Guid clientProfileId,
        Guid askId,
        Guid key,
        decimal amount,
        string currency,
        string? reference,
        CancellationToken cancellationToken)
    {
        var booked = await dbContext.HousePlanAskOutcomes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.CommandId == key, cancellationToken);
        if (booked is not null)
        {
            var receipt = await dbContext.PaymentRecords.AsNoTracking()
                .SingleAsync(item => item.Id == booked.PaymentRecordId, cancellationToken);
            var same = booked.AskId == askId &&
                booked.ClientProfileId == clientProfileId &&
                receipt.Amount == amount &&
                string.Equals(receipt.CurrencyCode, currency, StringComparison.Ordinal) &&
                string.Equals(receipt.Reference, reference, StringComparison.Ordinal);
            return same
                ? new HousePlanAskResult(HousePlanAskStatus.Unchanged)
                : Conflict(HousePlanAskCodes.IdempotencyKeyReused, "That clashes with an earlier request. Reload the client to see what was saved.");
        }

        var usedElsewhere =
            await dbContext.ClientEnrollments.AsNoTracking().AnyAsync(item => item.AssignmentCommandId == key, cancellationToken) ||
            await dbContext.PaymentRecords.AsNoTracking().AnyAsync(item => item.IdempotencyKey == key, cancellationToken);
        return usedElsewhere
            ? Conflict(HousePlanAskCodes.IdempotencyKeyReused, "That clashes with an earlier request. Reload the client to see what was saved.")
            : null;
    }

    /// <summary>The caller's current record in the house in scope, when they are a self-directed trainee there.</summary>
    private async Task<ClientProfile?> TraineeAsync(Guid userId, CancellationToken cancellationToken)
    {
        var profile = await dbContext.ClientProfiles.AsNoTracking().CurrentFor(userId).SingleOrDefaultAsync(cancellationToken);
        return profile is { IsSelfDirected: true } ? profile : null;
    }

    private async Task<string?> WhishNumberAsync(CancellationToken cancellationToken) =>
        (await HouseReader.SettingsAsync(dbContext, tenantContext.TenantId, cancellationToken)).WhishNumber;

    /// <summary>The trainee's ask still open, if any: one with no outcome. At most one at a time (SUB-020).</summary>
    private Task<HousePlanAsk?> OpenAskAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        dbContext.HousePlanAsks.AsNoTracking()
            .Where(ask => ask.ClientProfileId == clientProfileId &&
                !dbContext.HousePlanAskOutcomes.Any(outcome => outcome.AskId == ask.Id))
            .OrderByDescending(ask => ask.AskedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>
    /// Whom the house's money notices tell: its Owner, who sees every trainee, and the trainee's coach, whose
    /// client the trainee is (ADR 0026); one notice each, the same person once.
    /// </summary>
    private async Task<IReadOnlyList<Guid>> StaffToTellAsync(ClientProfile trainee, CancellationToken cancellationToken)
    {
        var owner = await CoachTeam.OwnerUserIdAsync(dbContext, tenantContext.TenantId, cancellationToken);
        return new[] { owner, trainee.AssignedCoachUserId }.Distinct().ToArray();
    }

    /// <summary>The house's Pro+ plans a trainee may ask for, each option on sale, by plan name, length and price.</summary>
    private async Task<IReadOnlyList<HousePlanOfferView>> AskablePlansAsync(CancellationToken cancellationToken)
    {
        var products = await dbContext.CoachingProducts.AsNoTracking()
            .Where(product => product.HouseTier == HouseTier.ProPlus && product.IsActive)
            .ToListAsync(cancellationToken);
        var productIds = products.Select(product => product.Id).ToArray();
        var offers = await dbContext.ProductOffers.AsNoTracking()
            .Include(offer => offer.Entitlements)
            .Where(offer => productIds.Contains(offer.ProductId) && offer.IsActive)
            .ToListAsync(cancellationToken);
        var byId = products.ToDictionary(product => product.Id);
        return offers
            .Where(offer => HousePlanAskRule.IsAskable(byId[offer.ProductId], offer))
            .Select(offer => (Offer: offer, Product: byId[offer.ProductId]))
            .OrderBy(item => item.Product.Name, StringComparer.CurrentCulture)
            .ThenBy(item => item.Offer.DurationUnit == OfferDurationUnit.Week ? item.Offer.DurationCount * 7 : item.Offer.DurationCount)
            .ThenBy(item => item.Offer.PriceAmount)
            .ThenBy(item => item.Offer.Id)
            .Select(item => new HousePlanOfferView(
                item.Offer.Id,
                item.Product.Id,
                item.Product.HouseTier!.Value,
                item.Product.Name,
                item.Product.Description,
                item.Offer.Label,
                item.Offer.PriceAmount,
                item.Offer.PriceCurrency,
                item.Offer.DurationCount,
                item.Offer.DurationUnit,
                [.. item.Offer.Entitlements.Select(entitlement => entitlement.Feature).Order()]))
            .ToArray();
    }

    /// <summary>A trainee's asks, newest first, or the one named; who decided is named for the staff alone.</summary>
    private async Task<IReadOnlyList<HousePlanAskView>> AskViewsAsync(
        Guid clientProfileId,
        Guid? askId,
        bool forStaff,
        CancellationToken cancellationToken)
    {
        var asks = await dbContext.HousePlanAsks.AsNoTracking()
            .Where(ask => ask.ClientProfileId == clientProfileId && (askId == null || ask.Id == askId))
            .OrderByDescending(ask => ask.AskedAtUtc)
            .ThenByDescending(ask => ask.Id)
            .ToListAsync(cancellationToken);
        if (asks.Count == 0)
        {
            return [];
        }

        var askIds = asks.Select(ask => ask.Id).ToArray();
        var transfers = await dbContext.HousePlanTransfers.AsNoTracking()
            .Where(transfer => askIds.Contains(transfer.AskId))
            .ToDictionaryAsync(transfer => transfer.AskId, cancellationToken);
        var outcomes = await dbContext.HousePlanAskOutcomes.AsNoTracking()
            .Where(outcome => askIds.Contains(outcome.AskId))
            .ToDictionaryAsync(outcome => outcome.AskId, cancellationToken);
        var offerIds = asks.Select(ask => ask.OfferId).Distinct().ToArray();
        var offers = await dbContext.ProductOffers.AsNoTracking()
            .Where(offer => offerIds.Contains(offer.Id))
            .ToDictionaryAsync(offer => offer.Id, cancellationToken);
        var productIds = asks.Select(ask => ask.ProductId).Distinct().ToArray();
        var products = await dbContext.CoachingProducts.AsNoTracking()
            .Where(product => productIds.Contains(product.Id))
            .ToDictionaryAsync(product => product.Id, product => product.Name, cancellationToken);
        var enrollmentIds = outcomes.Values
            .Where(outcome => outcome.EnrollmentId is not null)
            .Select(outcome => outcome.EnrollmentId!.Value)
            .ToArray();
        var plans = await dbContext.ClientEnrollments.AsNoTracking()
            .Where(enrollment => enrollmentIds.Contains(enrollment.Id))
            .Select(enrollment => new { enrollment.Id, enrollment.StartDate, enrollment.EndDateExclusive })
            .ToDictionaryAsync(enrollment => enrollment.Id, cancellationToken);
        var deciderIds = outcomes.Values.Select(outcome => outcome.DecidedByUserId).Distinct().ToArray();
        var deciders = forStaff
            ? await dbContext.Users.AsNoTracking()
                .Where(user => deciderIds.Contains(user.Id))
                .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken)
            : [];

        return asks.Select(ask =>
        {
            var offer = offers[ask.OfferId];
            var transfer = transfers.GetValueOrDefault(ask.Id);
            var outcome = outcomes.GetValueOrDefault(ask.Id);
            var plan = outcome?.EnrollmentId is { } enrollmentId ? plans.GetValueOrDefault(enrollmentId) : null;
            return new HousePlanAskView(
                ask.Id,
                ask.OfferId,
                ask.Tier,
                products[ask.ProductId],
                offer.Label,
                offer.PriceAmount,
                offer.PriceCurrency,
                offer.DurationCount,
                offer.DurationUnit,
                ask.AskedOn,
                HousePlanAskRule.State(transfer is not null, outcome?.Kind),
                transfer is null ? null : new HousePlanTransferView(transfer.WhishName, transfer.WhishNumber, transfer.SentOn),
                outcome is null
                    ? null
                    : new HousePlanAskOutcomeView(
                        outcome.Kind,
                        outcome.DecidedOn,
                        outcome.Reason,
                        outcome.EnrollmentId,
                        plan?.StartDate,
                        plan?.EndDateExclusive.AddDays(-1),
                        forStaff ? deciders.GetValueOrDefault(outcome.DecidedByUserId) : null));
        }).ToArray();
    }

    /// <summary>A successful result with the ask as it now stands, read after the commit; any other result as it is.</summary>
    private async Task<HousePlanAskResult> WithViewAsync(
        HousePlanAskResult result,
        Guid? askId,
        bool forStaff,
        CancellationToken cancellationToken)
    {
        if (result.Status is not (HousePlanAskStatus.Created or HousePlanAskStatus.Unchanged or HousePlanAskStatus.Changed) ||
            askId is not { } id)
        {
            return result;
        }

        var clientProfileId = await dbContext.HousePlanAsks.AsNoTracking()
            .Where(ask => ask.Id == id)
            .Select(ask => ask.ClientProfileId)
            .SingleAsync(cancellationToken);
        var view = (await AskViewsAsync(clientProfileId, id, forStaff, cancellationToken)).Single();
        return result with { Ask = view };
    }

    private static HousePlanAskResult Conflict(string code, string message) =>
        new(HousePlanAskStatus.Conflict, Code: code, Message: message);

    private static HousePlanAskResult Invalid(string field, string message) =>
        new(HousePlanAskStatus.Invalid, Errors: new Dictionary<string, string[]> { [field] = [message] });
}
