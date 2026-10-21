using TB.Gym.Modules.Notifications;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Audit A12 (COACH-12, UIQ-21): the plan and team notices in the screens' words, published as version 2 of
/// their templates, a client leaving named to the staff it tells, and a note's notice naming the workout it
/// is on. A name is data: shortened, written out as typed, never read for tokens.
/// </summary>
[TestClass]
public sealed class A12NoticeWordsDomainTests
{
    private static readonly CommercialNotificationKind[] Reworded =
    [
        CommercialNotificationKind.PaymentRequired,
        CommercialNotificationKind.EnrollmentActivated,
        CommercialNotificationKind.EnrollmentEndingSoon,
        CommercialNotificationKind.EnrollmentExpired,
        CommercialNotificationKind.EnrollmentRenewed,
        CommercialNotificationKind.CoachDeparted,
        CommercialNotificationKind.ClientLeft,
        CommercialNotificationKind.CoachResigned,
        CommercialNotificationKind.CoachWorkoutNote,
        CommercialNotificationKind.ClientWorkoutNote,
    ];

    /// <summary>System words the glossary (UI plan section 6) keeps off screens.</summary>
    private static readonly string[] SystemWords = ["workspace", "service", "access", "enrollment", "activated"];

    [TestMethod]
    public void ThePlanAndTeamNoticesSpeakTheScreensWordsAtTheirSecondVersion()
    {
        foreach (var kind in Enum.GetValues<CommercialNotificationKind>())
        {
            Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, "en", out var template), kind.ToString());
            // A template changed only by this pass moves to version 2; the others keep the wording, and
            // the version, they were delivered with.
            Assert.AreEqual(Reworded.Contains(kind) ? 2 : 1, template.Version, kind.ToString());
            if (!Reworded.Contains(kind))
            {
                continue;
            }

            foreach (var word in SystemWords)
            {
                Assert.DoesNotContain(word, template.Title + " " + template.Body, StringComparison.OrdinalIgnoreCase,
                    $"The {kind} notice says '{word}'.");
            }
        }

        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.PaymentRequired, "en", out var payment));
        Assert.AreEqual(("Your new plan is waiting for payment", "It starts once your coach has your payment."), (payment.Title, payment.Body));
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.EnrollmentExpired, "en", out var ended));
        Assert.AreEqual(("Your plan has ended", "If you'd like to keep going, ask your coach to renew it."), (ended.Title, ended.Body));
        // A renewal may still be waiting for payment: it says only that the next plan was set up.
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.EnrollmentRenewed, "en", out var renewed));
        Assert.AreEqual("Your coach set up your next plan", renewed.Title);
        Assert.DoesNotContain("started", renewed.Title + renewed.Body, StringComparison.OrdinalIgnoreCase);
        // A coach's departure still names nobody (CLI-014).
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.CoachDeparted, "en", out var departed));
        Assert.DoesNotContain("{", departed.Title + departed.Body);
    }

    [TestMethod]
    public void AClientLeavingIsNamedToTheStaffItTells()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.ClientLeft, "en", out var template));

        var named = NotificationTemplateCatalog.NameClient(template, " Maya Rahman ");

        Assert.AreEqual("Maya Rahman left your coaching space", named.Title);
        Assert.AreEqual("Their record is kept, read-only, under Former clients.", named.Body);
    }

    [TestMethod]
    public void AWorkoutIsNamedAsPlainTextShortenedAndAWorkoutWithNoNameReadsAWorkout()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.CoachWorkoutNote, "en", out var coach));
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.ClientWorkoutNote, "en", out var client));

        Assert.AreEqual("Your coach left a note on a workout", NotificationTemplateCatalog.NameWorkout(coach, "   ").Title);
        Assert.AreEqual("Your coach left a note on a workout", NotificationTemplateCatalog.NameWorkout(coach, null).Title);
        Assert.AreEqual("Your coach left a note on <b>Squat</b>", NotificationTemplateCatalog.NameWorkout(coach, "<b>Squat</b>").Title);

        // Cut at 60 characters with an ellipsis, so the longest client and workout still fit the 200 column.
        var cut = NotificationTemplateCatalog.NameWorkout(coach, new string('W', 100)).Title;
        Assert.AreEqual("Your coach left a note on " + new string('W', 59) + "…", cut);
        var longest = NotificationTemplateCatalog.NameClientAndWorkout(client, new string('M', 300), new string('W', 300)).Title;
        Assert.IsLessThanOrEqualTo(200, longest.Length);
        StringAssert.StartsWith(longest, new string('M', 120) + " left a note on ");
    }

    [TestMethod]
    public void NeitherNameIsReadForTheOthersToken()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.ClientWorkoutNote, "en", out var template));

        // Filled in one pass over the template's own words: what a name holds is written out as typed.
        Assert.AreEqual(
            "{workout} left a note on {client}",
            NotificationTemplateCatalog.NameClientAndWorkout(template, "{workout}", "{client}").Title);
        Assert.AreEqual(
            "{weeks} left a note on Lower A",
            NotificationTemplateCatalog.NameClientAndWorkout(template, "{weeks}", "Lower A").Title);
    }
}
