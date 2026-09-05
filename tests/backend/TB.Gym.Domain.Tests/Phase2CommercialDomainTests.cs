using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase2CommercialDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 8, 20, 10, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void AssignmentSnapshotsImmutableOfferTermsAndFeatures()
    {
        var product = CoachingProduct.Create(TenantId, "Premium Coaching", "Full service");
        var offer = CreateOffer(
            product,
            250m,
            "usd",
            new OfferFeatureDefinition(CoachingFeature.Training),
            new OfferFeatureDefinition(CoachingFeature.Nutrition));

        var enrollment = ClientEnrollment.Assign(
            TenantId,
            ClientId,
            product,
            offer,
            new DateOnly(2026, 8, 24),
            Guid.NewGuid(),
            Now);

        offer.SetAvailability(false);
        product.Update("Premium Coaching 2027", "Changed catalog copy", false);

        Assert.AreEqual("Premium Coaching", enrollment.ProductNameSnapshot);
        Assert.AreEqual("8 weeks", enrollment.OfferLabelSnapshot);
        Assert.AreEqual(250m, enrollment.PriceAmount);
        Assert.AreEqual("USD", enrollment.PriceCurrency);
        CollectionAssert.AreEquivalent(
            new[] { CoachingFeature.Training, CoachingFeature.Nutrition },
            enrollment.Entitlements.Select(item => item.Feature).ToArray());
    }

    [TestMethod]
    public void EnrollmentUsesExplicitValidatedStateTransitions()
    {
        var enrollment = CreateEnrollment(100m);

        Assert.AreEqual(EnrollmentStatus.PendingPayment, enrollment.Status);
        Assert.ThrowsExactly<InvalidOperationException>(() => enrollment.Pause(Now, "Travel"));

        enrollment.Activate(Now);
        enrollment.Pause(Now.AddHours(1), "Client requested a planned break");
        Assert.AreEqual(EnrollmentStatus.Paused, enrollment.Status);

        enrollment.Resume(Now.AddHours(2));
        Assert.AreEqual(EnrollmentStatus.Active, enrollment.Status);

        enrollment.Cancel(Now.AddHours(3), "Service ended by agreement");
        Assert.AreEqual(EnrollmentStatus.Cancelled, enrollment.Status);
        Assert.IsTrue(enrollment.Entitlements.All(item => !item.BlocksOverlap));
        Assert.ThrowsExactly<InvalidOperationException>(() => enrollment.Activate(Now.AddHours(4)));
    }

    [TestMethod]
    public void ExpirationIsDateAuthoritativeEvenBeforeStatusProjectionIsPersisted()
    {
        var enrollment = CreateEnrollment(0m);

        Assert.AreEqual(
            EffectiveEnrollmentStatus.Active,
            enrollment.GetEffectiveStatus(new DateOnly(2026, 8, 20), relationshipBlocked: false));
        Assert.AreEqual(
            EffectiveEnrollmentStatus.Expired,
            enrollment.GetEffectiveStatus(enrollment.EndDateExclusive, relationshipBlocked: false));
        Assert.AreEqual(
            EffectiveEnrollmentStatus.Blocked,
            enrollment.GetEffectiveStatus(new DateOnly(2026, 8, 20), relationshipBlocked: true));
    }

    [TestMethod]
    public void PaymentRecordNormalizesAndPreservesHistoricalMoney()
    {
        var enrollment = CreateEnrollment(250m);
        var payment = PaymentRecord.RecordManualReceipt(
            TenantId,
            enrollment.Id,
            125.125m,
            "usd",
            Now,
            ManualPaymentMethod.Cash,
            "  RECEIPT-1  ",
            "  First installment  ",
            Guid.NewGuid(),
            Guid.NewGuid(),
            Now);

        Assert.AreEqual(125.13m, payment.Amount);
        Assert.AreEqual("USD", payment.CurrencyCode);
        Assert.AreEqual("RECEIPT-1", payment.Reference);
        Assert.AreEqual("First installment", payment.Note);
        Assert.AreEqual(PaymentOperation.Receipt, payment.Operation);
        Assert.AreEqual(PaymentSource.Manual, payment.Source);
    }

    [TestMethod]
    public void OfferCanExplicitlyAllowConcurrentCoverageForOneFeature()
    {
        var product = CoachingProduct.Create(TenantId, "Review add-on", null);
        var offer = CreateOffer(
            product,
            25m,
            "USD",
            new OfferFeatureDefinition(CoachingFeature.CheckIns, AllowsConcurrentCoverage: true));
        var enrollment = ClientEnrollment.Assign(
            TenantId,
            ClientId,
            product,
            offer,
            new DateOnly(2026, 8, 20),
            Guid.NewGuid(),
            Now);

        Assert.IsFalse(enrollment.Entitlements.Single().BlocksOverlap);
    }

    [TestMethod]
    public void NotificationOutboxTracksTimezoneAndRejectsDuplicateDispatchState()
    {
        var item = NotificationOutboxItem.Schedule(
            TenantId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            CommercialNotificationKind.EnrollmentEndingSoon,
            "enrollment:one:ending-soon:v1",
            "{\"enrollmentId\":\"one\"}",
            Now.AddDays(3),
            "Asia/Beirut");

        Assert.AreEqual(NotificationIntentStatus.Scheduled, item.Status);
        Assert.AreEqual("Asia/Beirut", item.TenantTimeZoneId);
        Assert.AreEqual(Now.AddDays(3), item.ScheduledAtUtc);
        Assert.AreEqual(NotificationPurpose.ServiceTransactional, item.Purpose);

        // Phase 6B-3A: the dispatch lifecycle belongs to the channel, one row per channel, so an
        // in-app success and an email retry can both be true at once. Completing one still requires
        // the lease token it was issued with, and a completed delivery accepts nothing further.
        var delivery = NotificationChannelDelivery.Select(
            TenantId,
            item.Id,
            NotificationChannel.InApp,
            item.Purpose,
            NotificationChannelPlanner.InAppAlways,
            NotificationChannelPlanner.PolicyVersion,
            item.ScheduledAtUtc);
        Assert.AreEqual(NotificationDeliveryStatus.Pending, delivery.Status);
        Assert.AreEqual(Now.AddDays(3), delivery.NextAttemptAtUtc);

        var claim = delivery.Claim(Now.AddDays(3), TimeSpan.FromMinutes(2));
        delivery.StartAttempt(claim);
        delivery.MarkMaterialized(claim, Now.AddDays(3));
        Assert.AreEqual(NotificationDeliveryStatus.Materialized, delivery.Status);
        Assert.AreEqual(1, delivery.AttemptCount);
        Assert.IsNull(delivery.ClaimToken);
        Assert.ThrowsExactly<InvalidOperationException>(() => delivery.MarkMaterialized(claim, Now.AddDays(3)));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => delivery.MarkRetrying(claim, Now.AddDays(4), "notification-dispatch-transient"));
    }

    [TestMethod]
    public void LegalConsentRequiresApprovedVersionAndExplicitContext()
    {
        var document = LegalDocumentVersion.CreateDraft(
            LegalDocumentKind.PrivacyPolicy,
            "2026-08",
            "en-LB",
            LegalConsentContext.Workspace,
            "/legal/privacy/2026-08",
            new string('a', 64));
        Assert.AreEqual(LegalReviewStatus.RequiresProfessionalReview, document.ReviewStatus);

        document.ApproveAndPublish(Now);
        var acceptance = LegalConsentAcceptance.Accept(
            Guid.NewGuid(),
            document.Id,
            document.Context,
            TenantId,
            Now);

        Assert.AreEqual(LegalReviewStatus.Approved, document.ReviewStatus);
        Assert.AreEqual(TenantId, acceptance.TenantId);
        Assert.ThrowsExactly<ArgumentException>(() => LegalConsentAcceptance.Accept(
            Guid.NewGuid(),
            document.Id,
            LegalConsentContext.Workspace,
            null,
            Now));
    }

    private static ClientEnrollment CreateEnrollment(decimal price)
    {
        var product = CoachingProduct.Create(TenantId, "Premium Coaching", null);
        var offer = CreateOffer(
            product,
            price,
            "USD",
            new OfferFeatureDefinition(CoachingFeature.Training));
        return ClientEnrollment.Assign(
            TenantId,
            ClientId,
            product,
            offer,
            new DateOnly(2026, 8, 20),
            Guid.NewGuid(),
            Now);
    }

    private static ProductOffer CreateOffer(
        CoachingProduct product,
        decimal amount,
        string currency,
        params OfferFeatureDefinition[] features) =>
        ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            "8 weeks",
            8,
            OfferDurationUnit.Week,
            amount,
            currency,
            features);
}
