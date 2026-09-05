using TB.Gym.Modules.Notifications;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Channel planning, preferences, consent evidence and quiet hours, in isolation from the database.
/// </summary>
/// <remarks>
/// Every instant here is supplied rather than observed, including the daylight-saving cases: the
/// transitions are asserted against the real IANA rules for real zones at their exact boundaries,
/// without a test ever waiting for a clock to reach one.
/// </remarks>
[TestClass]
public sealed class Phase6B3ANotificationChannelDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 4, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid MemberId = Guid.CreateVersion7();
    private static readonly Guid OtherMemberId = Guid.CreateVersion7();
    private static readonly TimeSpan Lease = TimeSpan.FromSeconds(120);

    /// <summary>Beirut observes DST, which is what makes the gap and fold cases reachable.</summary>
    private static TimeZoneInfo Beirut => TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");

    // ---------- channel planning ----------

    [TestMethod]
    public void InAppIsAlwaysSelectedAndEmailDefaultsOff()
    {
        var plan = NotificationChannelPlanner.Plan(
            NotificationPurpose.ServiceTransactional,
            new NotificationChannelPlanInputs(false, false, true));

        Assert.HasCount(1, plan);
        Assert.AreEqual(NotificationChannel.InApp, plan[0].Channel);
        Assert.AreEqual(NotificationChannelPlanner.InAppAlways, plan[0].Reason);
    }

    [TestMethod]
    public void EmailIsSelectedOnlyAfterAnExplicitOptIn()
    {
        var plan = NotificationChannelPlanner.Plan(
            NotificationPurpose.ServiceTransactional,
            new NotificationChannelPlanInputs(true, false, true));

        Assert.HasCount(2, plan);
        var email = plan.Single(selection => selection.Channel == NotificationChannel.Email);
        Assert.AreEqual(NotificationPurpose.ServiceTransactional, email.Purpose);
        Assert.AreEqual(NotificationChannelPlanner.EmailServiceOptIn, email.Reason);
    }

    /// <summary>
    /// A deployment with no configured transport plans no email at all, rather than creating rows that
    /// could only ever be suppressed. In-app is unaffected, because it is not a transport.
    /// </summary>
    [TestMethod]
    public void EmailIsNotSelectedWhenTheDeploymentHasNoTransport()
    {
        var plan = NotificationChannelPlanner.Plan(
            NotificationPurpose.ServiceTransactional,
            new NotificationChannelPlanInputs(true, true, false));

        Assert.HasCount(1, plan);
        Assert.AreEqual(NotificationChannel.InApp, plan[0].Channel);
    }

    /// <summary>
    /// Marketing fails closed and can never ride on the service preference. Somebody who wants payment
    /// reminders has not thereby agreed to promotional mail, and the two decisions are separate fields
    /// precisely so that no code path can conflate them.
    /// </summary>
    [TestMethod]
    public void MarketingRequiresItsOwnConsentAndNeverRidesOnTheServicePreference()
    {
        var serviceOnly = NotificationChannelPlanner.Plan(
            NotificationPurpose.Marketing,
            new NotificationChannelPlanInputs(true, false, true));
        Assert.HasCount(1, serviceOnly);
        Assert.AreEqual(NotificationChannel.InApp, serviceOnly[0].Channel);

        var consented = NotificationChannelPlanner.Plan(
            NotificationPurpose.Marketing,
            new NotificationChannelPlanInputs(false, true, true));
        Assert.HasCount(2, consented);
        Assert.AreEqual(
            NotificationChannelPlanner.EmailMarketingConsent,
            consented.Single(selection => selection.Channel == NotificationChannel.Email).Reason);
    }

    /// <summary>
    /// Every kind this repository produces states a fact about a service the recipient already has.
    /// The mapping is explicit so that adding a kind is a decision about its purpose.
    /// </summary>
    [TestMethod]
    public void EveryCommercialKindIsClassifiedServiceTransactional()
    {
        foreach (var kind in Enum.GetValues<CommercialNotificationKind>())
        {
            Assert.AreEqual(
                NotificationPurpose.ServiceTransactional,
                NotificationPurposeCatalog.For(kind),
                $"{kind} must be classified explicitly, and it is not promotional.");
        }
    }

    [TestMethod]
    public void ADeliveryRecordsWhyItsChannelWasSelected()
    {
        var delivery = NotificationChannelDelivery.Select(
            TenantId,
            Guid.CreateVersion7(),
            NotificationChannel.Email,
            NotificationPurpose.ServiceTransactional,
            NotificationChannelPlanner.EmailServiceOptIn,
            NotificationChannelPlanner.PolicyVersion,
            Now);

        Assert.AreEqual(NotificationChannelPlanner.EmailServiceOptIn, delivery.SelectionReason);
        Assert.AreEqual(NotificationChannelPlanner.PolicyVersion, delivery.SelectionPolicyVersion);
        Assert.AreEqual(NotificationPurpose.ServiceTransactional, delivery.Purpose);
    }

    // ---------- quiet-hours deferral ----------

    /// <summary>
    /// A deferral is not an attempt. Nothing was tried, nothing went wrong, and the notification is
    /// still wanted — the row simply becomes invisible again until the window ends.
    /// </summary>
    [TestMethod]
    public void DeferringConsumesNoAttemptAndMovesTheDeliveryForward()
    {
        var delivery = SelectEmail(Now);

        delivery.Defer(Now, Now.AddHours(8), NotificationDeferralCodes.QuietHours);

        Assert.AreEqual(NotificationDeliveryStatus.Pending, delivery.Status);
        Assert.AreEqual(0, delivery.AttemptCount);
        Assert.AreEqual(1, delivery.DeferralCount);
        Assert.AreEqual(Now.AddHours(8), delivery.NextAttemptAtUtc);
        Assert.AreEqual(Now.AddHours(8), delivery.DeferredUntilUtc);
        Assert.AreEqual(NotificationDeferralCodes.QuietHours, delivery.DeferralCode);
        // Invisible to a sweep until the window ends, so the worker never polls it.
        Assert.IsFalse(delivery.IsClaimable(Now.AddHours(8).AddTicks(-1)));
        Assert.IsTrue(delivery.IsClaimable(Now.AddHours(8)));
    }

    [TestMethod]
    public void DeferringReleasesAClaimWithoutSpendingAnotherAttempt()
    {
        var delivery = SelectEmail(Now);
        delivery.Claim(Now, Lease);

        delivery.Defer(Now, Now.AddHours(4), NotificationDeferralCodes.QuietHours);

        Assert.AreEqual(NotificationDeliveryStatus.Pending, delivery.Status);
        Assert.AreEqual(0, delivery.AttemptCount, "A reservation released for quiet hours spends no attempt.");
        Assert.IsNull(delivery.ClaimToken);
    }

    [TestMethod]
    public void ADeferralMustMoveTheDeliveryForward()
    {
        var delivery = SelectEmail(Now);

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => delivery.Defer(Now, Now, NotificationDeferralCodes.QuietHours));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => delivery.Defer(Now, Now.AddSeconds(-1), NotificationDeferralCodes.QuietHours));
    }

    // ---------- quiet-hours windows ----------

    [TestMethod]
    public void AWindowWithEqualStartAndEndIsRefusedRatherThanReadAsAWholeDay()
    {
        Assert.IsFalse(NotificationQuietHours.TryCreate(
            new TimeOnly(22, 0),
            new TimeOnly(22, 0),
            out _,
            out var error));
        Assert.IsNotNull(error);
        Assert.ThrowsExactly<ArgumentException>(
            () => new NotificationQuietHours(new TimeOnly(9, 0), new TimeOnly(9, 0)));
    }

    /// <summary>The half-open rule: the start instant is quiet, the end instant is not.</summary>
    [TestMethod]
    public void ASameDayWindowIsHalfOpenAtBothBoundaries()
    {
        var window = new NotificationQuietHours(new TimeOnly(9, 0), new TimeOnly(17, 0));

        Assert.IsFalse(window.SpansMidnight);
        Assert.IsFalse(window.Contains(new TimeOnly(8, 59)));
        Assert.IsTrue(window.Contains(new TimeOnly(9, 0)));
        Assert.IsTrue(window.Contains(new TimeOnly(16, 59)));
        Assert.IsFalse(window.Contains(new TimeOnly(17, 0)));
        Assert.IsFalse(window.Contains(new TimeOnly(17, 1)));
    }

    [TestMethod]
    public void AnOvernightWindowWrapsPastMidnightAndKeepsTheSameBoundaryRule()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));

        Assert.IsTrue(window.SpansMidnight);
        Assert.IsFalse(window.Contains(new TimeOnly(21, 59)));
        Assert.IsTrue(window.Contains(new TimeOnly(22, 0)));
        Assert.IsTrue(window.Contains(new TimeOnly(23, 59)));
        Assert.IsTrue(window.Contains(new TimeOnly(0, 0)));
        Assert.IsTrue(window.Contains(new TimeOnly(6, 59)));
        Assert.IsFalse(window.Contains(new TimeOnly(7, 0)));
        Assert.IsFalse(window.Contains(new TimeOnly(12, 0)));
    }

    /// <summary>
    /// The window is interpreted in the workspace's zone, never the server's. Beirut is UTC+3 in
    /// September, so 23:00 local is 20:00 UTC and a naive UTC reading would call it daytime.
    /// </summary>
    [TestMethod]
    public void MembershipIsDecidedInTheWorkspaceZoneRatherThanUtc()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));
        var insideLocalNight = new DateTimeOffset(2026, 9, 4, 20, 0, 0, TimeSpan.Zero);

        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(insideLocalNight, window, Beirut));
        Assert.IsFalse(
            NotificationQuietHoursPolicy.IsWithin(insideLocalNight, window, TimeZoneInfo.Utc),
            "The same instant is daytime in UTC, which is exactly why the workspace zone is used.");
    }

    [TestMethod]
    public void TheNextAllowedInstantIsTheLocalEndBoundary()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));
        // 23:30 local on 4 September 2026 (UTC+3).
        var due = new DateTimeOffset(2026, 9, 4, 20, 30, 0, TimeSpan.Zero);

        var next = NotificationQuietHoursPolicy.NextAllowedInstantUtc(due, window, Beirut);

        // 07:00 local the following morning is 04:00 UTC.
        Assert.AreEqual(new DateTimeOffset(2026, 9, 5, 4, 0, 0, TimeSpan.Zero), next);
        Assert.IsFalse(NotificationQuietHoursPolicy.IsWithin(next, window, Beirut));
    }

    [TestMethod]
    public void AnInstantOutsideTheWindowIsReturnedUnchanged()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));
        var noon = new DateTimeOffset(2026, 9, 4, 9, 0, 0, TimeSpan.Zero);

        Assert.AreEqual(noon, NotificationQuietHoursPolicy.NextAllowedInstantUtc(noon, window, Beirut));
    }

    /// <summary>
    /// The exclusive end boundary is already allowed, so a delivery due exactly then is not deferred by
    /// a second. The start boundary is inside, so one due exactly then is.
    /// </summary>
    [TestMethod]
    public void BoundaryInstantsBehaveConsistently()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));
        var endBoundary = new DateTimeOffset(2026, 9, 5, 4, 0, 0, TimeSpan.Zero);
        var startBoundary = new DateTimeOffset(2026, 9, 4, 19, 0, 0, TimeSpan.Zero);

        Assert.IsFalse(NotificationQuietHoursPolicy.IsWithin(endBoundary, window, Beirut));
        Assert.AreEqual(endBoundary, NotificationQuietHoursPolicy.NextAllowedInstantUtc(endBoundary, window, Beirut));

        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(startBoundary, window, Beirut));
        Assert.IsTrue(NotificationQuietHoursPolicy.NextAllowedInstantUtc(startBoundary, window, Beirut) > startBoundary);
    }

    /// <summary>
    /// Spring forward in Beirut 2026: local 00:00 on 29 March becomes 01:00, so the hour from 00:00 to
    /// 01:00 never happens. A window ending inside it ends when the clocks finish moving, and the
    /// answer is a real instant that is genuinely outside the window.
    /// </summary>
    [TestMethod]
    public void ADaylightSavingGapResolvesForwardToTheInstantTheGapEnds()
    {
        var gapLocal = new DateTime(2026, 3, 29, 0, 30, 0, DateTimeKind.Unspecified);
        Assert.IsTrue(Beirut.IsInvalidTime(gapLocal), "The fixture assumes Beirut's 2026 spring-forward gap.");

        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(0, 30));
        // 23:00 local on 28 March 2026 (UTC+2 before the transition) is 21:00 UTC.
        var due = new DateTimeOffset(2026, 3, 28, 21, 0, 0, TimeSpan.Zero);
        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(due, window, Beirut));

        var next = NotificationQuietHoursPolicy.NextAllowedInstantUtc(due, window, Beirut);

        Assert.IsTrue(next > due);
        Assert.IsFalse(
            NotificationQuietHoursPolicy.IsWithin(next, window, Beirut),
            "A resolved instant must be genuinely allowed, not merely computed.");
        // The gap ends at 01:00 local, which is 22:00 UTC on 28 March.
        Assert.AreEqual(new DateTimeOffset(2026, 3, 28, 22, 0, 0, TimeSpan.Zero), next);
    }

    /// <summary>
    /// A window that lies entirely inside a spring-forward gap simply never occurs that day, and
    /// membership says so without any special case: converting UTC to local is always unambiguous.
    /// </summary>
    [TestMethod]
    public void AWindowInsideTheGapContainsNoInstantAtAll()
    {
        var window = new NotificationQuietHours(new TimeOnly(0, 10), new TimeOnly(0, 50));
        var transitionDay = new DateTimeOffset(2026, 3, 28, 20, 0, 0, TimeSpan.Zero);

        for (var minutes = 0; minutes < 8 * 60; minutes++)
        {
            var instant = transitionDay.AddMinutes(minutes);
            Assert.IsFalse(
                NotificationQuietHoursPolicy.IsWithin(instant, window, Beirut),
                $"{instant:O} fell inside a window whose local times do not exist that day.");
        }
    }

    /// <summary>
    /// Autumn fold in Beirut 2026: the clocks go back at local midnight on 25 October, so local 23:00
    /// to 00:00 on 24 October happens twice, at UTC+3 and then again at UTC+2. The documented rule
    /// takes the latest instant, matching the rule that both passes through a repeated quiet hour are
    /// quiet.
    /// </summary>
    [TestMethod]
    public void ADaylightSavingFoldResolvesToTheLatestMatchingEndInstant()
    {
        var foldLocal = new DateTime(2026, 10, 24, 23, 30, 0, DateTimeKind.Unspecified);
        Assert.IsTrue(Beirut.IsAmbiguousTime(foldLocal), "The fixture assumes Beirut's 2026 autumn fold.");

        var window = new NotificationQuietHours(new TimeOnly(21, 0), new TimeOnly(23, 30));
        // 22:00 local on 24 October 2026, still UTC+3 before the transition, is 19:00 UTC.
        var due = new DateTimeOffset(2026, 10, 24, 19, 0, 0, TimeSpan.Zero);
        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(due, window, Beirut));

        var next = NotificationQuietHoursPolicy.NextAllowedInstantUtc(due, window, Beirut);

        // The second 23:30 instant is 21:30 UTC. Releasing at the first would make the second pass
        // simultaneously quiet by membership and already released by boundary resolution.
        Assert.AreEqual(new DateTimeOffset(2026, 10, 24, 21, 30, 0, TimeSpan.Zero), next);
        Assert.IsFalse(NotificationQuietHoursPolicy.IsWithin(next, window, Beirut));
    }

    [TestMethod]
    public void ASecondFoldPassNeverReturnsAnInstantThatIsStillQuiet()
    {
        var window = new NotificationQuietHours(new TimeOnly(21, 0), new TimeOnly(23, 30));
        var secondPassBeforeEnd = new DateTimeOffset(2026, 10, 24, 21, 15, 0, TimeSpan.Zero);

        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(secondPassBeforeEnd, window, Beirut));
        var next = NotificationQuietHoursPolicy.NextAllowedInstantUtc(secondPassBeforeEnd, window, Beirut);

        Assert.AreEqual(new DateTimeOffset(2026, 10, 24, 21, 30, 0, TimeSpan.Zero), next);
        Assert.IsFalse(NotificationQuietHoursPolicy.IsWithin(next, window, Beirut));
    }

    /// <summary>
    /// The repeated local hour is quiet on both passes, because membership is decided from the local
    /// wall clock and both passes read the same wall clock.
    /// </summary>
    [TestMethod]
    public void AFoldedLocalHourInsideTheWindowIsQuietOnBothPasses()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(2, 0));
        // Local 23:30 on 24 October, first at UTC+3 and then again an hour later at UTC+2.
        var firstPass = new DateTimeOffset(2026, 10, 24, 20, 30, 0, TimeSpan.Zero);
        var secondPass = new DateTimeOffset(2026, 10, 24, 21, 30, 0, TimeSpan.Zero);

        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(firstPass, window, Beirut));
        Assert.IsTrue(NotificationQuietHoursPolicy.IsWithin(secondPass, window, Beirut));
        // Local 02:00 on 25 October, the exclusive end, is 00:00 UTC at the post-transition offset.
        Assert.IsFalse(NotificationQuietHoursPolicy.IsWithin(
            new DateTimeOffset(2026, 10, 25, 0, 0, 0, TimeSpan.Zero),
            window,
            Beirut));
    }

    /// <summary>
    /// The fold day is scanned minute by minute for the same property the ordinary day is: every
    /// instant is either allowed or deferred to an instant that genuinely is, including both passes
    /// over the repeated hour.
    /// </summary>
    [TestMethod]
    public void EveryMinuteAcrossBothDaylightSavingTransitionsIsDecidedDeterministically()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));

        foreach (var start in new[]
                 {
                     new DateTimeOffset(2026, 3, 28, 12, 0, 0, TimeSpan.Zero),
                     new DateTimeOffset(2026, 10, 24, 12, 0, 0, TimeSpan.Zero),
                 })
        {
            for (var minutes = 0; minutes < 24 * 60; minutes++)
            {
                var instant = start.AddMinutes(minutes);
                var next = NotificationQuietHoursPolicy.NextAllowedInstantUtc(instant, window, Beirut);

                Assert.IsTrue(next >= instant, $"{instant:O} was moved backwards.");
                Assert.IsFalse(
                    NotificationQuietHoursPolicy.IsWithin(next, window, Beirut),
                    $"{instant:O} resolved to another quiet instant across a transition.");
                if (!NotificationQuietHoursPolicy.IsWithin(instant, window, Beirut))
                {
                    Assert.AreEqual(instant, next, $"{instant:O} is allowed and must not be deferred.");
                }
            }
        }
    }

    /// <summary>
    /// A window with no daylight-saving complication is still checked exhaustively across a whole day,
    /// so no minute is both quiet and not quiet and the answer never depends on how it was reached.
    /// </summary>
    [TestMethod]
    public void EveryMinuteOfAnOrdinaryDayIsDecidedDeterministically()
    {
        var window = new NotificationQuietHours(new TimeOnly(22, 0), new TimeOnly(7, 0));
        var midnightUtc = new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);

        for (var minutes = 0; minutes < 24 * 60; minutes++)
        {
            var instant = midnightUtc.AddMinutes(minutes);
            var inside = NotificationQuietHoursPolicy.IsWithin(instant, window, Beirut);
            var next = NotificationQuietHoursPolicy.NextAllowedInstantUtc(instant, window, Beirut);

            if (inside)
            {
                Assert.IsTrue(next > instant, $"{instant:O} is quiet but was not deferred.");
                Assert.IsFalse(
                    NotificationQuietHoursPolicy.IsWithin(next, window, Beirut),
                    $"{instant:O} was deferred to another quiet instant.");
            }
            else
            {
                Assert.AreEqual(instant, next, $"{instant:O} is allowed and must not be deferred.");
            }
        }
    }

    [TestMethod]
    public void AnUnknownOrInvalidTimeZoneFailsClosed()
    {
        Assert.IsFalse(NotificationQuietHoursPolicy.TryResolveZone("Mars/Olympus_Mons", out _));
        Assert.IsFalse(NotificationQuietHoursPolicy.TryResolveZone(null, out _));
        Assert.IsFalse(NotificationQuietHoursPolicy.TryResolveZone("   ", out _));
        Assert.IsTrue(NotificationQuietHoursPolicy.TryResolveZone("Asia/Beirut", out var zone));
        Assert.IsNotNull(zone);
    }

    // ---------- preferences and consent evidence ----------

    [TestMethod]
    public void ANewPreferenceHasInAppOnEmailOffAndNoQuietHours()
    {
        var preference = NotificationChannelPreference.CreateDefault(TenantId, MemberId);

        Assert.IsFalse(preference.EmailServiceEnabled);
        Assert.IsFalse(preference.EmailMarketingEnabled);
        Assert.IsFalse(preference.QuietHoursEnabled);
        Assert.IsNull(preference.QuietHours);
        Assert.IsNull(preference.EmailServiceDecidedAtUtc);
        Assert.AreEqual(NotificationPreferencePolicy.CurrentVersion, preference.PolicyVersion);
    }

    [TestMethod]
    public void OptingInAndOutBothAppendEvidenceAndNeitherErasesTheOther()
    {
        var preference = NotificationChannelPreference.CreateDefault(TenantId, MemberId);

        var granted = preference.SetEmailService(true, MemberId, Now, NotificationPreferencePolicy.OwnSettingsSource);
        Assert.IsNotNull(granted);
        Assert.AreEqual(NotificationConsentDecision.Granted, granted.Decision);
        Assert.AreEqual(NotificationChannel.Email, granted.Channel);
        Assert.AreEqual(NotificationPurpose.ServiceTransactional, granted.Purpose);
        Assert.AreEqual(Now, granted.RecordedAtUtc);
        Assert.AreEqual(MemberId, granted.ActorUserId);
        Assert.AreEqual(NotificationPreferencePolicy.CurrentVersion, granted.PolicyVersion);
        Assert.AreEqual(Now, preference.EmailServiceDecidedAtUtc);

        var withdrawn = preference.SetEmailService(false, MemberId, Now.AddDays(1), NotificationPreferencePolicy.OwnSettingsSource);
        Assert.IsNotNull(withdrawn);
        Assert.AreEqual(NotificationConsentDecision.Withdrawn, withdrawn.Decision);
        Assert.AreEqual(Now.AddDays(1), preference.EmailServiceDecidedAtUtc);
        // The withdrawal is a new fact; the grant it withdraws is a separate row and still exists.
        Assert.AreNotEqual(granted.Id, withdrawn.Id);
        Assert.AreEqual(NotificationConsentDecision.Granted, granted.Decision);
    }

    /// <summary>
    /// Saving a value that did not change writes no evidence, so the history is a list of decisions
    /// rather than a list of times somebody pressed Save.
    /// </summary>
    [TestMethod]
    public void AnUnchangedDecisionAppendsNoEvidence()
    {
        var preference = NotificationChannelPreference.CreateDefault(TenantId, MemberId);

        Assert.IsNull(preference.SetEmailService(false, MemberId, Now, NotificationPreferencePolicy.OwnSettingsSource));
        Assert.IsNull(preference.EmailServiceDecidedAtUtc);

        preference.SetEmailService(true, MemberId, Now, NotificationPreferencePolicy.OwnSettingsSource);
        Assert.IsNull(preference.SetEmailService(true, MemberId, Now.AddDays(1), NotificationPreferencePolicy.OwnSettingsSource));
        Assert.AreEqual(Now, preference.EmailServiceDecidedAtUtc, "A no-op save must not move the decision instant.");
    }

    /// <summary>
    /// Nobody decides on somebody else's behalf. The API already derives the subject from the cookie;
    /// this is the domain refusing the shape as well, so a future caller cannot reintroduce it.
    /// </summary>
    [TestMethod]
    public void OnlyTheMemberThemselvesMayChangeTheirOwnEmailDecision()
    {
        var preference = NotificationChannelPreference.CreateDefault(TenantId, MemberId);

        Assert.ThrowsExactly<InvalidOperationException>(
            () => preference.SetEmailService(true, OtherMemberId, Now, NotificationPreferencePolicy.OwnSettingsSource));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => preference.SetEmailMarketing(true, OtherMemberId, Now, NotificationPreferencePolicy.OwnSettingsSource));
        Assert.ThrowsExactly<InvalidOperationException>(
            () => preference.SetEmailService(true, Guid.Empty, Now, NotificationPreferencePolicy.OwnSettingsSource));
        Assert.IsFalse(preference.EmailServiceEnabled);
    }

    [TestMethod]
    public void MarketingConsentIsRecordedSeparatelyFromServiceEmail()
    {
        var preference = NotificationChannelPreference.CreateDefault(TenantId, MemberId);

        preference.SetEmailService(true, MemberId, Now, NotificationPreferencePolicy.OwnSettingsSource);
        Assert.IsFalse(preference.EmailMarketingEnabled, "Service email is not marketing consent.");

        var marketing = preference.SetEmailMarketing(true, MemberId, Now.AddMinutes(1), NotificationPreferencePolicy.OwnSettingsSource);
        Assert.IsNotNull(marketing);
        Assert.AreEqual(NotificationPurpose.Marketing, marketing.Purpose);
        Assert.AreEqual(Now.AddMinutes(1), preference.EmailMarketingDecidedAtUtc);
        Assert.AreEqual(Now, preference.EmailServiceDecidedAtUtc, "The service decision is untouched.");
    }

    /// <summary>
    /// Consent evidence carries only what explains the decision. Anything that would turn a consent log
    /// into a tracking log is absent by construction, which a shape assertion is the only way to keep.
    /// </summary>
    [TestMethod]
    public void ConsentEvidenceCarriesNoTrackingOrContactData()
    {
        var properties = typeof(NotificationConsentEvent)
            .GetProperties()
            .Select(property => property.Name)
            .ToArray();

        foreach (var forbidden in new[]
                 {
                     "IpAddress", "UserAgent", "Recipient", "EmailAddress", "Address",
                     "Body", "Subject", "Token", "PayloadJson", "Message",
                 })
        {
            Assert.DoesNotContain(forbidden, properties, $"Consent evidence must not carry {forbidden}.");
        }

        // Exactly two strings, both of them stable codes rather than anything a caller supplies.
        var strings = typeof(NotificationConsentEvent)
            .GetProperties()
            .Where(property => property.PropertyType == typeof(string))
            .Select(property => property.Name)
            .ToArray();
        Assert.HasCount(1, strings, $"Unexpected string on consent evidence: {string.Join(", ", strings)}");
        Assert.AreEqual("Source", strings[0]);
    }

    [TestMethod]
    public void QuietHoursAreStoredOnlyWhenEnabledAndValid()
    {
        var preference = NotificationChannelPreference.CreateDefault(TenantId, MemberId);

        preference.SetQuietHours(true, new TimeOnly(22, 0), new TimeOnly(7, 0));
        Assert.IsTrue(preference.QuietHoursEnabled);
        Assert.AreEqual(new TimeOnly(22, 0), preference.QuietHours!.StartLocal);
        Assert.AreEqual(new TimeOnly(7, 0), preference.QuietHours.EndLocal);

        preference.SetQuietHours(false, new TimeOnly(22, 0), new TimeOnly(7, 0));
        Assert.IsFalse(preference.QuietHoursEnabled);
        Assert.IsNull(preference.QuietHoursStartLocal);
        Assert.IsNull(preference.QuietHoursEndLocal);
        Assert.IsNull(preference.QuietHours);

        Assert.ThrowsExactly<ArgumentException>(
            () => preference.SetQuietHours(true, new TimeOnly(22, 0), new TimeOnly(22, 0)));
        Assert.ThrowsExactly<ArgumentException>(() => preference.SetQuietHours(true, new TimeOnly(22, 0), null));
        Assert.ThrowsExactly<ArgumentException>(() => preference.SetQuietHours(true, null, new TimeOnly(7, 0)));
    }

    // ---------- idempotency fingerprints ----------

    [TestMethod]
    public void AFingerprintIsBoundToTheWorkspaceTheMemberAndTheNormalizedPayload()
    {
        var baseline = NotificationPreferenceFingerprint.ForUpdate(
            TenantId, MemberId, true, true, new TimeOnly(22, 0), new TimeOnly(7, 0));

        Assert.AreEqual(
            baseline,
            NotificationPreferenceFingerprint.ForUpdate(
                TenantId, MemberId, true, true, new TimeOnly(22, 0), new TimeOnly(7, 0)),
            "An identical retry must produce an identical fingerprint.");

        Assert.AreNotEqual(baseline, NotificationPreferenceFingerprint.ForUpdate(
            Guid.CreateVersion7(), MemberId, true, true, new TimeOnly(22, 0), new TimeOnly(7, 0)));
        Assert.AreNotEqual(baseline, NotificationPreferenceFingerprint.ForUpdate(
            TenantId, OtherMemberId, true, true, new TimeOnly(22, 0), new TimeOnly(7, 0)));
        Assert.AreNotEqual(baseline, NotificationPreferenceFingerprint.ForUpdate(
            TenantId, MemberId, false, true, new TimeOnly(22, 0), new TimeOnly(7, 0)));
        Assert.AreNotEqual(baseline, NotificationPreferenceFingerprint.ForUpdate(
            TenantId, MemberId, true, true, new TimeOnly(23, 0), new TimeOnly(7, 0)));
    }

    /// <summary>
    /// Leftover times on a disabled window are not part of the command. The browser keeps the last
    /// values in its inputs so the user can switch quiet hours back on without retyping them, and a
    /// retry after a lost response must not conflict with itself because of them.
    /// </summary>
    [TestMethod]
    public void DisabledQuietHoursIgnoreLeftoverTimesInTheFingerprint()
    {
        Assert.AreEqual(
            NotificationPreferenceFingerprint.ForUpdate(
                TenantId, MemberId, true, false, new TimeOnly(22, 0), new TimeOnly(7, 0)),
            NotificationPreferenceFingerprint.ForUpdate(
                TenantId, MemberId, true, false, null, null));
    }

    [TestMethod]
    public void LocalTimesAreParsedStrictlyAsTwentyFourHourHoursAndMinutes()
    {
        Assert.IsTrue(NotificationLocalTime.TryParse("22:00", out var parsed));
        Assert.AreEqual(new TimeOnly(22, 0), parsed);
        Assert.AreEqual("22:00", NotificationLocalTime.Format(new TimeOnly(22, 0)));
        Assert.AreEqual("07:05", NotificationLocalTime.Format(new TimeOnly(7, 5)));
        Assert.IsNull(NotificationLocalTime.Format(null));

        foreach (var rejected in new[] { "9", "9:00", "22:00:00", "10:00 PM", "25:00", "22:60", "", "   ", null })
        {
            Assert.IsFalse(NotificationLocalTime.TryParse(rejected, out _), $"'{rejected}' should be refused.");
        }
    }

    // ---------- email configuration fails closed ----------

    /// <summary>
    /// Production cannot silently use the captured adapter, and cannot enable a channel that has no
    /// real provider behind it. Both are startup failures rather than a quiet no-op, because a
    /// deployment that believes it is emailing people while messages go into a process's memory is a
    /// far worse outcome than a process that refuses to start.
    /// </summary>
    [TestMethod]
    public void ProductionRefusesTheCapturedAdapterAndAnEnabledEmailChannel()
    {
        Assert.IsNotNull(
            new NotificationEmailOptions { Adapter = NotificationEmailAdapters.Captured }.Validate(isProduction: true),
            "Production must refuse the captured adapter even when email is disabled.");
        Assert.IsNotNull(
            new NotificationEmailOptions { Enabled = true, Adapter = NotificationEmailAdapters.None }.Validate(isProduction: true));
        Assert.IsNotNull(
            new NotificationEmailOptions { Enabled = true, Adapter = NotificationEmailAdapters.Captured }.Validate(isProduction: true));
        Assert.IsNull(
            new NotificationEmailOptions().Validate(isProduction: true),
            "Disabled email with no adapter is the production default and must start.");
    }

    [TestMethod]
    public void AnEnabledChannelWithNoAdapterOrAnUnknownAdapterFailsStartup()
    {
        Assert.IsNotNull(
            new NotificationEmailOptions { Enabled = true, Adapter = NotificationEmailAdapters.None }.Validate(isProduction: false));
        Assert.IsNotNull(
            new NotificationEmailOptions { Adapter = "Resend" }.Validate(isProduction: false));
        Assert.IsNotNull(
            new NotificationEmailOptions { Enabled = true, Adapter = "Smtp" }.Validate(isProduction: false));
    }

    [TestMethod]
    public void EmailIsUnavailableUnlessItIsBothEnabledAndConfigured()
    {
        Assert.IsFalse(new NotificationEmailOptions().IsAvailable);
        Assert.IsFalse(new NotificationEmailOptions { Adapter = NotificationEmailAdapters.Captured }.IsAvailable);
        Assert.IsFalse(new NotificationEmailOptions { Enabled = true }.IsAvailable);

        var configured = new NotificationEmailOptions
        {
            Enabled = true,
            Adapter = NotificationEmailAdapters.Captured,
        };
        Assert.IsTrue(configured.IsAvailable);
        Assert.IsNull(configured.Validate(isProduction: false));
    }

    /// <summary>
    /// The one wording an email may carry. It must tell somebody that a notification is waiting and
    /// nothing else: an email sits in a mailbox that a lock screen shows and a provider stores.
    /// </summary>
    [TestMethod]
    public void TheServiceEmailTemplateDisclosesNothingBeyondSignIn()
    {
        var template = NotificationTemplateCatalog.ServiceEmailV1;
        var text = template.Title + " " + template.Body;

        Assert.AreEqual(NotificationTemplateCatalog.CurrentVersion, template.Version);
        Assert.AreEqual(NotificationTemplateCatalog.DefaultCulture, template.Culture);
        Assert.Contains("TB Gym", text);
        Assert.Contains("Sign in", text, StringComparison.OrdinalIgnoreCase);
        // No format placeholder, so nothing a coach types or a payload carries can reach the wording.
        Assert.DoesNotContain("{", text);

        foreach (var forbidden in new[]
                 {
                     "$", "USD", "amount", "price", "invoice", "receipt", "http://", "https://",
                     "token", "kg", "calorie", "payment", "enrollment", "client", "coach",
                 })
        {
            Assert.IsFalse(
                text.Contains(forbidden, StringComparison.OrdinalIgnoreCase),
                $"The service email template mentions '{forbidden}'.");
        }
    }

    private static NotificationChannelDelivery SelectEmail(DateTimeOffset dueAtUtc) =>
        NotificationChannelDelivery.Select(
            TenantId,
            Guid.CreateVersion7(),
            NotificationChannel.Email,
            NotificationPurpose.ServiceTransactional,
            NotificationChannelPlanner.EmailServiceOptIn,
            NotificationChannelPlanner.PolicyVersion,
            dueAtUtc);
}
