using TB.Gym.Modules.Notifications;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The client's training notices (ADR 0036, R5.1c): how a week notice names its weeks, and that every
/// training kind is a service notice delivered in-app only.
/// </summary>
[TestClass]
public sealed class R51cTrainingNoticeDomainTests
{
    private static readonly CommercialNotificationKind[] TrainingKinds =
    [
        CommercialNotificationKind.ProgramAssigned,
        CommercialNotificationKind.WeeksShared,
        CommercialNotificationKind.WeeksChanged,
        CommercialNotificationKind.CoachWorkoutNote,
        CommercialNotificationKind.ClientWorkoutNote,
    ];

    [TestMethod]
    public void DeliveredWeekTargetsUseTheSameWeeksAsTheTitleAndAreCopied()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.WeeksShared, "en", out var template));
        var named = NotificationTemplateCatalog.NameWeeks(template, [3, 3]);
        var notice = Notification.Materialize(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), CommercialNotificationKind.WeeksShared, named);
        Assert.AreEqual("Your coach shared week 3", notice.Title);
        CollectionAssert.AreEqual(named.TargetWeeks, notice.TargetWeeks);
        named.TargetWeeks![0] = 2;
        Assert.AreEqual(3, notice.TargetWeeks!.Single(), "The stored snapshot owns its copy.");
    }

    [TestMethod]
    [DataRow(new[] { 3 }, "week 3")]
    [DataRow(new[] { 3, 5 }, "weeks 3 and 5")]
    [DataRow(new[] { 3, 4 }, "weeks 3 and 4")]
    [DataRow(new[] { 6, 3, 5, 4 }, "weeks 3 to 6")]
    [DataRow(new[] { 2, 4, 7 }, "weeks 2, 4 and 7")]
    [DataRow(new[] { 1, 3, 5, 7 }, "weeks 1, 3, 5 and 7")]
    [DataRow(new[] { 1, 3, 5, 7, 9, 11 }, "6 weeks")]
    [DataRow(new[] { 4, 4, 0, -2, 5 }, "weeks 4 and 5")]
    public void AWeekNoticeNamesItsWeeksInWords(int[] weeks, string expected) =>
        Assert.AreEqual(expected, NotificationTemplateCatalog.DescribeWeeks(weeks));

    [TestMethod]
    public void AWeekNoticeNeedsAWeek() =>
        Assert.ThrowsExactly<ArgumentException>(() => NotificationTemplateCatalog.DescribeWeeks([0, -1]));

    [TestMethod]
    public void TheWeeksGoIntoTheTitleOnlyAndTheBodyStaysFixed()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.WeeksChanged, "en", out var changed));
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.WeeksShared, "en", out var shared));

        var named = NotificationTemplateCatalog.NameWeeks(changed, [5, 3, 4]);
        Assert.AreEqual("Your coach updated weeks 3 to 5", named.Title);
        Assert.AreEqual(changed.Body, named.Body);
        Assert.AreEqual("Your coach shared week 2", NotificationTemplateCatalog.NameWeeks(shared, [2]).Title);
        // Even 52 scattered weeks keep a title well inside the 200-character column.
        Assert.IsLessThan(60, NotificationTemplateCatalog.NameWeeks(changed, Enumerable.Range(1, 52).Where(week => week % 2 == 0)).Title.Length);
    }

    [TestMethod]
    public void AClientsWorkoutNoteNamesTheClientAndTheWorkoutAndNeverTheNote()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.ClientWorkoutNote, "en", out var template));
        Assert.AreEqual(
            "Maya Rahman left a note on Lower A",
            NotificationTemplateCatalog.NameClientAndWorkout(template, "Maya Rahman", " Lower A ").Title);
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.CoachWorkoutNote, "en", out var coach));
        var named = NotificationTemplateCatalog.NameWorkout(coach, "Upper B");
        Assert.AreEqual("Your coach left a note on Upper B", named.Title);
        Assert.AreEqual(coach.Body, named.Body);
        Assert.DoesNotContain("{", named.Title + named.Body);
    }

    [TestMethod]
    public void EveryTrainingNoticeIsAServiceNoticeAndNotAWorkspaceKind()
    {
        foreach (var kind in Enum.GetValues<CommercialNotificationKind>())
        {
            Assert.AreEqual(TrainingKinds.Contains(kind), NotificationPurposeCatalog.IsTrainingKind(kind), kind.ToString());
        }

        foreach (var kind in TrainingKinds)
        {
            Assert.AreEqual(NotificationPurpose.ServiceTransactional, NotificationPurposeCatalog.For(kind));
            Assert.IsFalse(NotificationPurposeCatalog.IsWorkspaceKind(kind));
            Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, "en", out var template), kind.ToString());
            StringAssert.StartsWith(template.Key, "training.");
        }
    }

    [TestMethod]
    public void ATrainingNoticeIsPlannedInAppOnly()
    {
        // The training notices are scheduled with no email channel available, as the workspace kinds are.
        var plan = NotificationChannelPlanner.Plan(
            NotificationPurposeCatalog.For(CommercialNotificationKind.WeeksChanged),
            new NotificationChannelPlanInputs(false, false, false));
        Assert.HasCount(1, plan);
        Assert.AreEqual(NotificationChannel.InApp, plan[0].Channel);
    }
}
