using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Critique B12, who held a session (SES-003): the ledger row keeps who held it and who recorded it, a charge keeps who
/// recorded it, the coach's History names the second person only when they differ, and a client reads neither.
/// </summary>
[TestClass]
public sealed class B12WhoHeldItDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000d1");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000000d1");
    private static readonly Guid Lea = Guid.Parse("30000000-0000-0000-0000-0000000000d1");
    private static readonly Guid Karim = Guid.Parse("30000000-0000-0000-0000-0000000000d2");
    private static readonly DateOnly Today = new(2026, 10, 15);
    private static readonly DateTimeOffset Now = new(2026, 10, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
    private static readonly Dictionary<Guid, string> Names = new() { [Lea] = "Lea Khoury", [Karim] = "Karim Haddad" };

    [TestMethod]
    public void ASessionKeepsWhoHeldItAndWhoRecordedIt()
    {
        var entry = SessionLedgerEntry.Hold(Pack(), Today, Lea, Karim, "Stood in", Guid.NewGuid());

        Assert.AreEqual((Lea, Karim), (entry.CoachUserId, entry.RecordedByUserId));
    }

    [TestMethod]
    public void AChargeKeepsWhoRecordedItAsNoSessionWasHeld()
    {
        var entry = SessionLedgerEntry.Charge(Pack(), Today, Karim, "No-show", Guid.NewGuid());

        Assert.AreEqual((Karim, Karim), (entry.CoachUserId, entry.RecordedByUserId));
    }

    [TestMethod]
    public void TheOtherRowsNameNobody()
    {
        var pack = Pack();
        var held = SessionLedgerEntry.Hold(pack, Today, Lea, Lea, null, Guid.NewGuid());
        var issued = SessionLedgerEntry.Issue(pack, Today);
        var voided = SessionLedgerEntry.Void(pack, held, Today, Guid.NewGuid());

        Assert.AreEqual(((Guid?)null, (Guid?)null), (issued.CoachUserId, issued.RecordedByUserId));
        Assert.AreEqual(((Guid?)null, (Guid?)null), (voided.CoachUserId, voided.RecordedByUserId));
    }

    [TestMethod]
    public void TheHistoryNamesWhoRecordedASessionOnlyWhenItWasSomeoneElse()
    {
        var pack = Pack();
        var forLea = SessionLedgerEntry.Hold(pack, Today.AddDays(-3), Lea, Karim, null, Guid.NewGuid());
        var own = SessionLedgerEntry.Hold(pack, Today.AddDays(-2), Lea, Lea, null, Guid.NewGuid());
        var charged = SessionLedgerEntry.Charge(pack, Today.AddDays(-1), Karim, "No-show", Guid.NewGuid());

        var view = SessionLedger.ViewOf(pack, [SessionLedgerEntry.Issue(pack, Today.AddDays(-5)), forLea, own, charged], Names, Today, Beirut);

        Assert.AreEqual(
            ("Lea Khoury", "Karim Haddad"),
            view.Entries.Where(item => item.Id == forLea.Id).Select(item => (item.CoachName, item.RecordedByName)).Single());
        Assert.AreEqual(
            ("Lea Khoury", (string?)null),
            view.Entries.Where(item => item.Id == own.Id).Select(item => (item.CoachName, item.RecordedByName)).Single());
        Assert.AreEqual(
            ("Karim Haddad", (string?)null),
            view.Entries.Where(item => item.Id == charged.Id).Select(item => (item.CoachName, item.RecordedByName)).Single());
    }

    [TestMethod]
    public void AClientReadsNeitherOfThem()
    {
        var pack = Pack();
        var held = SessionLedgerEntry.Hold(pack, Today, Lea, Karim, "Stood in", Guid.NewGuid());

        var own = OwnPlans.SessionsOf(SessionLedger.ViewOf(pack, [SessionLedgerEntry.Issue(pack, Today), held], Names, Today, Beirut));

        // What a client's row can say at all: the day, what happened and a charge's reason.
        var session = own.Sessions.Single();
        Assert.AreEqual((Today, SessionOutcome.Held, (string?)null), (session.Day, session.Outcome, session.Reason));
    }

    [TestMethod]
    public void MonthNumbersCountASessionForWhoHeldIt()
    {
        var from = new DateOnly(2026, 10, 1);
        var toExclusive = new DateOnly(2026, 11, 1);
        var facts = new MonthFacts([], [new HeldSession(Today, Lea), new HeldSession(Today, Lea), new HeldSession(Today, Karim)], []);

        Assert.AreEqual(2, MonthNumbersPolicy.Count(facts, from, toExclusive, Today, Beirut, Lea).SessionsHeld);
        Assert.AreEqual(1, MonthNumbersPolicy.Count(facts, from, toExclusive, Today, Beirut, Karim).SessionsHeld);
        Assert.AreEqual(3, MonthNumbersPolicy.Count(facts, from, toExclusive, Today, Beirut, null).SessionsHeld);
    }

    private static ClientEnrollment Pack()
    {
        var product = CoachingProduct.Create(TenantId, "Personal training", null, ProductKind.SessionPack);
        var offer = ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            "10 sessions",
            90,
            OfferDurationUnit.Day,
            0m,
            "USD",
            SessionPackRules.PackFeatures([]),
            10);
        return ClientEnrollment.Assign(TenantId, ClientId, product, offer, Today.AddDays(-10), Guid.NewGuid(), Now.AddDays(-30));
    }
}
