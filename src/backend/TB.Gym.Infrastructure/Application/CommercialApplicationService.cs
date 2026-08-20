using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class CommercialApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService)
    : ICommercialApplicationService
{
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ProductCatalog> ListProductsAsync(CancellationToken cancellationToken)
    {
        var currency = await dbContext.Tenants
            .Where(tenant => tenant.Id == tenantContext.TenantId)
            .Select(tenant => tenant.DefaultCurrencyCode)
            .SingleAsync(cancellationToken);
        return new ProductCatalog(currency, await LoadProductsAsync(cancellationToken));
    }

    public async Task<CommercialCommandResult> CreateProductAsync(
        CreateCoachingProductRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            ArgumentNullException.ThrowIfNull(request.InitialOffer);
            var currency = await ResolveCurrencyAsync(request.InitialOffer.PriceCurrency, cancellationToken);
            var product = CoachingProduct.Create(tenantContext.TenantId, request.Name, request.Description);
            var offer = CreateOffer(product, request.InitialOffer, currency);
            dbContext.CoachingProducts.Add(product);
            dbContext.ProductOffers.Add(offer);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new CommercialCommandResult(
                CommercialCommandStatus.Success,
                Product: await LoadProductAsync(product.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("product", exception.Message);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("product_conflict", "A product with conflicting data already exists.");
        }
    }

    public async Task<CommercialCommandResult> UpdateProductAsync(
        Guid productId,
        UpdateCoachingProductRequest request,
        CancellationToken cancellationToken)
    {
        var product = await dbContext.CoachingProducts.SingleOrDefaultAsync(
            item => item.Id == productId,
            cancellationToken);
        if (product is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(product).Property(item => item.Version).OriginalValue = request.Version;
            product.Update(request.Name, request.Description, request.IsActive);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new CommercialCommandResult(
                CommercialCommandStatus.Success,
                Product: await LoadProductAsync(product.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("product", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The product was changed by another request.");
        }
    }

    public async Task<CommercialCommandResult> AddOfferAsync(
        Guid productId,
        CreateProductOfferRequest request,
        CancellationToken cancellationToken)
    {
        var product = await dbContext.CoachingProducts.SingleOrDefaultAsync(
            item => item.Id == productId,
            cancellationToken);
        if (product is null)
        {
            return NotFound();
        }

        try
        {
            var currency = await ResolveCurrencyAsync(request.PriceCurrency, cancellationToken);
            dbContext.ProductOffers.Add(CreateOffer(product, request, currency));
            await dbContext.SaveChangesAsync(cancellationToken);
            return new CommercialCommandResult(
                CommercialCommandStatus.Success,
                Product: await LoadProductAsync(product.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("offer", exception.Message);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("offer_conflict", "The offer conflicts with an existing offer.");
        }
    }

    public async Task<CommercialCommandResult> SetOfferAvailabilityAsync(
        Guid offerId,
        SetOfferAvailabilityRequest request,
        CancellationToken cancellationToken)
    {
        var offer = await dbContext.ProductOffers.SingleOrDefaultAsync(
            item => item.Id == offerId,
            cancellationToken);
        if (offer is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(offer).Property(item => item.Version).OriginalValue = request.Version;
            offer.SetAvailability(request.IsActive);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new CommercialCommandResult(
                CommercialCommandStatus.Success,
                Product: await LoadProductAsync(offer.ProductId, cancellationToken));
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The offer was changed by another request.");
        }
    }

    public async Task<ClientCommercialOverview?> GetClientOverviewAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var exists = await dbContext.ClientProfiles.AnyAsync(
            item => item.Id == clientProfileId,
            cancellationToken);
        return exists
            ? await BuildOverviewAsync(clientProfileId, cancellationToken)
            : null;
    }

    public Task<CommercialCommandResult> AssignAsync(
        Guid clientProfileId,
        AssignProductRequest request,
        CancellationToken cancellationToken) =>
        AssignCoreAsync(
            clientProfileId,
            request.OfferId,
            request.StartDate,
            request.IdempotencyKey,
            renewedFromEnrollmentId: null,
            cancellationToken);

    public async Task<CommercialCommandResult> RecordManualPaymentAsync(
        Guid enrollmentId,
        RecordManualPaymentRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } actorId)
        {
            return NotFound();
        }

        var priorPayment = await dbContext.PaymentRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
        if (priorPayment is not null)
        {
            return PaymentMatchesRequest(priorPayment, enrollmentId, request)
                ? await EnrollmentSuccessAsync(enrollmentId, cancellationToken)
                : Conflict("idempotency_key_reused", "The payment idempotency key was already used for another operation.");
        }

        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT 1 FROM subscriptions.\"ClientEnrollments\" WHERE \"TenantId\" = {tenantContext.TenantId} AND \"Id\" = {enrollmentId} FOR UPDATE",
                    cancellationToken);

                var racedPayment = await dbContext.PaymentRecords
                    .AsNoTracking()
                    .SingleOrDefaultAsync(
                        item => item.IdempotencyKey == request.IdempotencyKey,
                        cancellationToken);
                if (racedPayment is not null)
                {
                    return PaymentMatchesRequest(racedPayment, enrollmentId, request)
                        ? await EnrollmentSuccessAsync(enrollmentId, cancellationToken)
                        : Conflict(
                            "idempotency_key_reused",
                            "The payment idempotency key was already used for another operation.");
                }

                var enrollment = await dbContext.ClientEnrollments
                    .Include(item => item.Entitlements)
                    .SingleOrDefaultAsync(item => item.Id == enrollmentId, cancellationToken);
                if (enrollment is null)
                {
                    return NotFound();
                }

                var tenantToday = await GetTenantTodayAsync(cancellationToken);
                if (tenantToday >= enrollment.EndDateExclusive)
                {
                    return Invalid("enrollment", "An expired enrollment cannot receive a payment.");
                }

                if (enrollment.Status != EnrollmentStatus.PendingPayment)
                {
                    return Invalid("enrollment", "Only a pending-payment enrollment can receive a manual payment.");
                }

                var currency = MoneyRules.NormalizeCurrency(request.CurrencyCode);
                if (!string.Equals(currency, enrollment.PriceCurrency, StringComparison.Ordinal))
                {
                    return Invalid(
                        "currencyCode",
                        "Phase 2 payments must use the enrollment price currency; cross-currency settlement requires an explicit FX record.");
                }

                var amount = MoneyRules.NormalizeAmount(request.Amount, allowZero: false);
                var paidAmount = await dbContext.PaymentRecords
                    .Where(item =>
                        item.EnrollmentId == enrollmentId &&
                        item.Operation == PaymentOperation.Receipt)
                    .SumAsync(item => (decimal?)item.Amount, cancellationToken) ?? 0m;
                var balance = enrollment.PriceAmount - paidAmount;
                if (amount > balance)
                {
                    return Invalid("amount", "The payment cannot exceed the outstanding enrollment balance.");
                }

                var payment = PaymentRecord.RecordManualReceipt(
                    enrollment.TenantId,
                    enrollment.Id,
                    amount,
                    currency,
                    request.ReceivedAtUtc,
                    request.Method,
                    request.Reference,
                    request.Note,
                    actorId,
                    request.IdempotencyKey,
                    clock.UtcNow);
                dbContext.PaymentRecords.Add(payment);

                if (paidAmount + amount == enrollment.PriceAmount)
                {
                    enrollment.Activate(clock.UtcNow);
                    var pendingPaymentNotices = await dbContext.NotificationOutboxItems
                        .Where(item =>
                            item.AggregateId == enrollment.Id &&
                            item.Kind == CommercialNotificationKind.PaymentRequired &&
                            item.Status == NotificationOutboxStatus.Pending)
                        .ToListAsync(cancellationToken);
                    foreach (var notice in pendingPaymentNotices)
                    {
                        notice.Cancel();
                    }

                    var context = await GetNotificationContextAsync(enrollment.ClientProfileId, cancellationToken);
                    ScheduleImmediate(
                        enrollment,
                        context,
                        CommercialNotificationKind.EnrollmentActivated,
                        "activated");
                }

                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return await EnrollmentSuccessAsync(enrollment.Id, cancellationToken);
            }
            catch (ArgumentException exception)
            {
                return Invalid("payment", exception.Message);
            }
            catch (InvalidOperationException exception)
            {
                return Invalid("enrollment", exception.Message);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict("concurrency_conflict", "The enrollment changed while payment was being recorded.");
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception))
            {
                return Conflict("payment_conflict", "The payment was already recorded or conflicted with another request.");
            }
        });
    }

    public async Task<CommercialCommandResult> RenewAsync(
        Guid enrollmentId,
        RenewEnrollmentRequest request,
        CancellationToken cancellationToken)
    {
        var source = await dbContext.ClientEnrollments
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == enrollmentId, cancellationToken);
        if (source is null)
        {
            return NotFound();
        }

        var offerProductId = await dbContext.ProductOffers
            .Where(item => item.Id == request.OfferId)
            .Select(item => (Guid?)item.ProductId)
            .SingleOrDefaultAsync(cancellationToken);
        if (offerProductId is null)
        {
            return NotFound();
        }

        if (offerProductId != source.ProductId)
        {
            return Invalid("offerId", "A renewal offer must belong to the original coaching product.");
        }

        return await AssignCoreAsync(
            source.ClientProfileId,
            request.OfferId,
            request.StartDate,
            request.IdempotencyKey,
            source.Id,
            cancellationToken);
    }

    public Task<CommercialCommandResult> PauseAsync(
        Guid enrollmentId,
        ChangeEnrollmentStatusRequest request,
        CancellationToken cancellationToken) =>
        ChangeStatusAsync(
            enrollmentId,
            request.Version,
            enrollment => enrollment.Pause(clock.UtcNow, request.Reason),
            cancelNotifications: false,
            cancellationToken);

    public Task<CommercialCommandResult> ResumeAsync(
        Guid enrollmentId,
        ResumeEnrollmentRequest request,
        CancellationToken cancellationToken) =>
        ChangeStatusAsync(
            enrollmentId,
            request.Version,
            enrollment => enrollment.Resume(clock.UtcNow),
            cancelNotifications: false,
            cancellationToken);

    public Task<CommercialCommandResult> CancelAsync(
        Guid enrollmentId,
        ChangeEnrollmentStatusRequest request,
        CancellationToken cancellationToken) =>
        ChangeStatusAsync(
            enrollmentId,
            request.Version,
            enrollment => enrollment.Cancel(clock.UtcNow, request.Reason),
            cancelNotifications: true,
            cancellationToken);

    public async Task<IReadOnlyList<FeatureAccessDecision>?> GetSelfAccessAsync(
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return null;
        }

        var clientId = await dbContext.ClientProfiles
            .Where(item => item.UserId == userId)
            .Select(item => (Guid?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        return clientId is null
            ? null
            : await featureAccessService.EvaluateAllAsync(
                tenantContext.TenantId,
                clientId.Value,
                cancellationToken);
    }

    private async Task<CommercialCommandResult> AssignCoreAsync(
        Guid clientProfileId,
        Guid offerId,
        DateOnly startDate,
        Guid idempotencyKey,
        Guid? renewedFromEnrollmentId,
        CancellationToken cancellationToken)
    {
        if (idempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "An idempotency key is required.");
        }

        var existing = await dbContext.ClientEnrollments
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.AssignmentCommandId == idempotencyKey, cancellationToken);
        if (existing is not null)
        {
            return AssignmentMatchesRequest(
                existing,
                clientProfileId,
                offerId,
                startDate,
                renewedFromEnrollmentId)
                ? await EnrollmentSuccessAsync(existing.Id, cancellationToken)
                : Conflict("idempotency_key_reused", "The assignment idempotency key was already used for another operation.");
        }

        var client = await dbContext.ClientProfiles
            .SingleOrDefaultAsync(item => item.Id == clientProfileId, cancellationToken);
        if (client?.UserId is not { })
        {
            return NotFound();
        }

        var offer = await dbContext.ProductOffers
            .Include(item => item.Entitlements)
            .SingleOrDefaultAsync(item => item.Id == offerId, cancellationToken);
        if (offer is null)
        {
            return NotFound();
        }

        var product = await dbContext.CoachingProducts.SingleOrDefaultAsync(
            item => item.Id == offer.ProductId,
            cancellationToken);
        if (product is null)
        {
            return NotFound();
        }

        if (!product.IsActive || !offer.IsActive)
        {
            return Invalid("offerId", "Only an active product and offer can be assigned.");
        }

        try
        {
            var enrollment = ClientEnrollment.Assign(
                tenantContext.TenantId,
                clientProfileId,
                product,
                offer,
                startDate,
                idempotencyKey,
                clock.UtcNow,
                renewedFromEnrollmentId);
            var tenantToday = await GetTenantTodayAsync(cancellationToken);
            if (enrollment.EndDateExclusive <= tenantToday)
            {
                return Invalid("startDate", "The assigned service period must end after today in the workspace time zone.");
            }

            var blockingFeatures = offer.Entitlements
                .Where(item => !item.AllowsConcurrentCoverage)
                .Select(item => item.Feature)
                .ToArray();
            var overlaps = blockingFeatures.Length > 0 &&
                await dbContext.EnrollmentEntitlements.AnyAsync(
                    item =>
                        item.ClientProfileId == clientProfileId &&
                        item.BlocksOverlap &&
                        blockingFeatures.Contains(item.Feature) &&
                        item.StartDate < enrollment.EndDateExclusive &&
                        startDate < item.EndDateExclusive,
                    cancellationToken);
            if (overlaps)
            {
                return Conflict(
                    "entitlement_overlap",
                    "This client already has overlapping coverage for at least one selected feature.");
            }

            dbContext.ClientEnrollments.Add(enrollment);
            var notificationContext = await GetNotificationContextAsync(clientProfileId, cancellationToken);
            ScheduleEnrollmentNotifications(enrollment, notificationContext);
            if (renewedFromEnrollmentId is not null)
            {
                ScheduleImmediate(
                    enrollment,
                    notificationContext,
                    CommercialNotificationKind.EnrollmentRenewed,
                    "renewed");
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return await EnrollmentSuccessAsync(enrollment.Id, cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return Invalid("assignment", exception.Message);
        }
        catch (OverflowException)
        {
            return Invalid("startDate", "The offer duration produces an unsupported date range.");
        }
        catch (DbUpdateException exception) when (
            IsExclusionViolation(exception) || IsUniqueViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            var racedEnrollment = await dbContext.ClientEnrollments
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    item => item.AssignmentCommandId == idempotencyKey,
                    cancellationToken);
            if (racedEnrollment is not null)
            {
                return AssignmentMatchesRequest(
                    racedEnrollment,
                    clientProfileId,
                    offerId,
                    startDate,
                    renewedFromEnrollmentId)
                    ? await EnrollmentSuccessAsync(racedEnrollment.Id, cancellationToken)
                    : Conflict(
                        "idempotency_key_reused",
                        "The assignment idempotency key was already used for another operation.");
            }

            return IsExclusionViolation(exception)
                ? Conflict(
                    "entitlement_overlap",
                    "Another request created overlapping coverage for at least one selected feature.")
                : Conflict(
                    "assignment_conflict",
                    "The assignment was already created or conflicts with another request.");
        }
    }

    private async Task<CommercialCommandResult> ChangeStatusAsync(
        Guid enrollmentId,
        uint version,
        Action<ClientEnrollment> transition,
        bool cancelNotifications,
        CancellationToken cancellationToken)
    {
        var enrollment = await dbContext.ClientEnrollments
            .Include(item => item.Entitlements)
            .SingleOrDefaultAsync(item => item.Id == enrollmentId, cancellationToken);
        if (enrollment is null)
        {
            return NotFound();
        }

        try
        {
            if (await GetTenantTodayAsync(cancellationToken) >= enrollment.EndDateExclusive)
            {
                return Invalid("enrollment", "An expired enrollment cannot change to the requested status.");
            }

            dbContext.Entry(enrollment).Property(item => item.Version).OriginalValue = version;
            transition(enrollment);
            if (cancelNotifications)
            {
                var pending = await dbContext.NotificationOutboxItems
                    .Where(item =>
                        item.AggregateId == enrollment.Id &&
                        item.Status == NotificationOutboxStatus.Pending)
                    .ToListAsync(cancellationToken);
                foreach (var item in pending)
                {
                    item.Cancel();
                }
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return await EnrollmentSuccessAsync(enrollment.Id, cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return Invalid("reason", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("status", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The enrollment was changed by another request.");
        }
    }

    private ProductOffer CreateOffer(
        CoachingProduct product,
        CreateProductOfferRequest request,
        string currency)
    {
        ArgumentNullException.ThrowIfNull(request.Features);
        if (request.Features.Count != request.Features.Select(item => item.Feature).Distinct().Count())
        {
            throw new ArgumentException("Each coaching feature may appear only once.", nameof(request));
        }

        return ProductOffer.CreateFixedDuration(
            tenantContext.TenantId,
            product.Id,
            request.Label,
            request.DurationCount,
            request.DurationUnit,
            request.PriceAmount,
            currency,
            request.Features.Select(item =>
                new OfferFeatureDefinition(item.Feature, item.AllowsConcurrentCoverage)));
    }

    private async Task<string> ResolveCurrencyAsync(
        string? requestedCurrency,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(requestedCurrency))
        {
            return MoneyRules.NormalizeCurrency(requestedCurrency);
        }

        return await dbContext.Tenants
            .Where(tenant => tenant.Id == tenantContext.TenantId)
            .Select(tenant => tenant.DefaultCurrencyCode)
            .SingleAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<CoachingProductView>> LoadProductsAsync(
        CancellationToken cancellationToken)
    {
        var products = await dbContext.CoachingProducts
            .AsNoTracking()
            .OrderByDescending(item => item.IsActive)
            .ThenBy(item => item.Name)
            .ToListAsync(cancellationToken);
        var offers = await dbContext.ProductOffers
            .AsNoTracking()
            .Include(item => item.Entitlements)
            .OrderByDescending(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return products
            .Select(product => ToProductView(
                product,
                offers.Where(offer => offer.ProductId == product.Id).ToArray()))
            .ToArray();
    }

    private async Task<CoachingProductView> LoadProductAsync(
        Guid productId,
        CancellationToken cancellationToken)
    {
        var product = await dbContext.CoachingProducts
            .AsNoTracking()
            .SingleAsync(item => item.Id == productId, cancellationToken);
        var offers = await dbContext.ProductOffers
            .AsNoTracking()
            .Include(item => item.Entitlements)
            .Where(item => item.ProductId == productId)
            .OrderByDescending(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        return ToProductView(product, offers);
    }

    private static CoachingProductView ToProductView(
        CoachingProduct product,
        IReadOnlyList<ProductOffer> offers) =>
        new(
            product.Id,
            product.Name,
            product.Description,
            product.IsActive,
            offers.Select(offer => new ProductOfferView(
                offer.Id,
                offer.Label,
                offer.BillingModel,
                offer.DurationCount,
                offer.DurationUnit,
                offer.PriceAmount,
                offer.PriceCurrency,
                offer.IsActive,
                offer.Entitlements
                    .OrderBy(item => item.Feature)
                    .Select(item => new OfferFeatureView(item.Feature, item.AllowsConcurrentCoverage))
                    .ToArray(),
                offer.CreatedAtUtc,
                offer.Version)).ToArray(),
            product.Version);

    private async Task<ClientCommercialOverview> BuildOverviewAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(item => item.Id == clientProfileId)
            .Select(item => new { item.IsCoachBlocked })
            .SingleAsync(cancellationToken);
        var access = await featureAccessService.EvaluateAllAsync(
            tenantContext.TenantId,
            clientProfileId,
            cancellationToken);
        var enrollments = await dbContext.ClientEnrollments
            .AsNoTracking()
            .Include(item => item.Entitlements)
            .Where(item => item.ClientProfileId == clientProfileId)
            .OrderByDescending(item => item.StartDate)
            .ThenByDescending(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        var enrollmentIds = enrollments.Select(item => item.Id).ToArray();
        var payments = await dbContext.PaymentRecords
            .AsNoTracking()
            .Where(item => enrollmentIds.Contains(item.EnrollmentId))
            .OrderByDescending(item => item.ReceivedAtUtc)
            .ToListAsync(cancellationToken);
        var tenantToday = await GetTenantTodayAsync(cancellationToken);

        return new ClientCommercialOverview(
            clientProfileId,
            client.IsCoachBlocked,
            access,
            enrollments
                .Select(enrollment => ToEnrollmentView(
                    enrollment,
                    payments.Where(payment => payment.EnrollmentId == enrollment.Id).ToArray(),
                    tenantToday,
                    client.IsCoachBlocked))
                .ToArray());
    }

    private async Task<CommercialCommandResult> EnrollmentSuccessAsync(
        Guid enrollmentId,
        CancellationToken cancellationToken)
    {
        var enrollment = await dbContext.ClientEnrollments
            .AsNoTracking()
            .Include(item => item.Entitlements)
            .SingleAsync(item => item.Id == enrollmentId, cancellationToken);
        var payments = await dbContext.PaymentRecords
            .AsNoTracking()
            .Where(item => item.EnrollmentId == enrollmentId)
            .OrderByDescending(item => item.ReceivedAtUtc)
            .ToListAsync(cancellationToken);
        var blocked = await dbContext.ClientProfiles
            .Where(item => item.Id == enrollment.ClientProfileId)
            .Select(item => item.IsCoachBlocked)
            .SingleAsync(cancellationToken);
        var tenantToday = await GetTenantTodayAsync(cancellationToken);
        return new CommercialCommandResult(
            CommercialCommandStatus.Success,
            Enrollment: ToEnrollmentView(enrollment, payments, tenantToday, blocked));
    }

    private static ClientEnrollmentView ToEnrollmentView(
        ClientEnrollment enrollment,
        IReadOnlyList<PaymentRecord> payments,
        DateOnly tenantToday,
        bool relationshipBlocked)
    {
        var paidAmount = payments
            .Where(item => item.Operation == PaymentOperation.Receipt)
            .Sum(item => item.Amount);
        return new ClientEnrollmentView(
            enrollment.Id,
            enrollment.ProductId,
            enrollment.OfferId,
            enrollment.RenewedFromEnrollmentId,
            enrollment.ProductNameSnapshot,
            enrollment.OfferLabelSnapshot,
            enrollment.PriceAmount,
            enrollment.PriceCurrency,
            paidAmount,
            decimal.Max(0m, enrollment.PriceAmount - paidAmount),
            enrollment.StartDate,
            enrollment.EndDateExclusive,
            enrollment.EndDateExclusive.AddDays(-1),
            enrollment.Status,
            enrollment.GetEffectiveStatus(tenantToday, relationshipBlocked),
            enrollment.StatusReason,
            enrollment.Entitlements.Select(item => item.Feature).Order().ToArray(),
            payments.Select(item => new PaymentRecordView(
                item.Id,
                item.Amount,
                item.CurrencyCode,
                item.ReceivedAtUtc,
                item.Method,
                item.Reference,
                item.Note,
                item.RecordedByUserId,
                item.Operation,
                item.Source,
                item.CreatedAtUtc)).ToArray(),
            enrollment.CreatedAtUtc,
            enrollment.Version);
    }

    private async Task<DateOnly> GetTenantTodayAsync(CancellationToken cancellationToken)
    {
        var timeZoneId = await dbContext.Tenants
            .Where(tenant => tenant.Id == tenantContext.TenantId)
            .Select(tenant => tenant.TimeZoneId)
            .SingleAsync(cancellationToken);
        var localNow = TimeZoneInfo.ConvertTime(
            clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(timeZoneId));
        return DateOnly.FromDateTime(localNow.DateTime);
    }

    private async Task<NotificationContext> GetNotificationContextAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var userId = await dbContext.ClientProfiles
            .Where(item => item.Id == clientProfileId)
            .Select(item => item.UserId)
            .SingleAsync(cancellationToken)
            ?? throw new InvalidOperationException("The client profile is not linked to an account.");
        var timeZoneId = await dbContext.Tenants
            .Where(item => item.Id == tenantContext.TenantId)
            .Select(item => item.TimeZoneId)
            .SingleAsync(cancellationToken);
        return new NotificationContext(userId, timeZoneId);
    }

    private void ScheduleEnrollmentNotifications(
        ClientEnrollment enrollment,
        NotificationContext context)
    {
        if (enrollment.Status == EnrollmentStatus.PendingPayment)
        {
            ScheduleImmediate(
                enrollment,
                context,
                CommercialNotificationKind.PaymentRequired,
                "payment-required");
        }
        else
        {
            ScheduleImmediate(
                enrollment,
                context,
                CommercialNotificationKind.EnrollmentActivated,
                "activated");
        }

        var endingAtUtc = ToUtc(enrollment.EndDateExclusive.AddDays(-3), new TimeOnly(9, 0), context.TimeZoneId);
        if (endingAtUtc > clock.UtcNow)
        {
            Schedule(
                enrollment,
                context,
                CommercialNotificationKind.EnrollmentEndingSoon,
                "ending-soon",
                endingAtUtc);
        }

        var expiredAtUtc = ToUtc(enrollment.EndDateExclusive, new TimeOnly(9, 0), context.TimeZoneId);
        Schedule(
            enrollment,
            context,
            CommercialNotificationKind.EnrollmentExpired,
            "expired",
            expiredAtUtc);
    }

    private void ScheduleImmediate(
        ClientEnrollment enrollment,
        NotificationContext context,
        CommercialNotificationKind kind,
        string eventKey) =>
        Schedule(enrollment, context, kind, eventKey, clock.UtcNow);

    private void Schedule(
        ClientEnrollment enrollment,
        NotificationContext context,
        CommercialNotificationKind kind,
        string eventKey,
        DateTimeOffset scheduledAtUtc)
    {
        var payload = JsonSerializer.Serialize(
            new { enrollmentId = enrollment.Id, clientProfileId = enrollment.ClientProfileId },
            PayloadJsonOptions);
        dbContext.NotificationOutboxItems.Add(NotificationOutboxItem.Schedule(
            enrollment.TenantId,
            context.RecipientUserId,
            enrollment.Id,
            kind,
            $"enrollment:{enrollment.Id:N}:{eventKey}:v1",
            payload,
            scheduledAtUtc,
            context.TimeZoneId));
    }

    private static DateTimeOffset ToUtc(DateOnly date, TimeOnly time, string timeZoneId)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        var utc = TimeZoneInfo.ConvertTimeToUtc(local, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId));
        return new DateTimeOffset(utc, TimeSpan.Zero);
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static bool IsExclusionViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.ExclusionViolation };

    private static bool AssignmentMatchesRequest(
        ClientEnrollment enrollment,
        Guid clientProfileId,
        Guid offerId,
        DateOnly startDate,
        Guid? renewedFromEnrollmentId) =>
        enrollment.ClientProfileId == clientProfileId &&
        enrollment.OfferId == offerId &&
        enrollment.StartDate == startDate &&
        enrollment.RenewedFromEnrollmentId == renewedFromEnrollmentId;

    private static bool PaymentMatchesRequest(
        PaymentRecord payment,
        Guid enrollmentId,
        RecordManualPaymentRequest request)
    {
        try
        {
            return payment.EnrollmentId == enrollmentId &&
                payment.Amount == MoneyRules.NormalizeAmount(request.Amount, allowZero: false) &&
                payment.CurrencyCode == MoneyRules.NormalizeCurrency(request.CurrencyCode) &&
                payment.ReceivedAtUtc == ToPostgresPrecision(request.ReceivedAtUtc) &&
                payment.Method == request.Method &&
                payment.Reference == NormalizeOptional(request.Reference) &&
                payment.Note == NormalizeOptional(request.Note);
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static string? NormalizeOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static DateTimeOffset ToPostgresPrecision(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - (utc.Ticks % 10), TimeSpan.Zero);
    }

    private static CommercialCommandResult Invalid(string field, string message) =>
        new(
            CommercialCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static CommercialCommandResult NotFound() =>
        new(CommercialCommandStatus.NotFound);

    private static CommercialCommandResult Conflict(string code, string message) =>
        new(CommercialCommandStatus.Conflict, Code: code, Message: message);

    private sealed record NotificationContext(Guid RecipientUserId, string TimeZoneId);
}
