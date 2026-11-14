using TB.Gym.Modules.Clients;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9c5a, part C: the Health step opens only on Max (CLI-028, decision 33). The server has no steps,
/// so a closed step means an intake save may keep each health answer as it is stored or empty it, and may never add
/// or change one; the refusal comes before anything changes and repeats nothing typed. Whether the step is open is
/// worked out from the house's plans in Infrastructure; the profile only weighs the answer it is given. Every name and
/// answer here is the tests' own.
/// </summary>
[TestClass]
public sealed class N9c5HealthStepDomainTests
{
    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-000000009c5c");
    private static readonly Guid TraineeUserId = Guid.Parse("20000000-0000-0000-0000-000000009c5c");
    private static readonly Guid HouseCoachUserId = Guid.Parse("20000000-0000-0000-0000-000000009c5d");
    private static readonly DateOnly Today = new(2026, 11, 14);
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly BirthDate = new(1994, 3, 9);

    private const string Allergy = "Hazelnut weals";
    private const string Medication = "Quellotrine drops";
    private const string Injury = "Left meniscus scope";

    private static readonly HealthAnswers Stored = new(Allergy, Medication, Injury);

    private static readonly HealthAnswers None = new(null, null, null);

    private const string ClosedSentence =
        "Health answers open on Max, TB Gym's coaching. Your other answers can still be saved.";

    // ---- added ----

    [TestMethod]
    public void AHealthAnswerAddedWhileTheStepIsClosedIsRefusedBeforeAnythingChanges()
    {
        foreach (var added in new[]
        {
            None with { Allergies = Allergy },
            None with { Medications = Medication },
            None with { PreviousInjuries = Injury },
            Stored,
        })
        {
            var profile = Trainee();

            // The same save changes a name and a goal too: the whole save is refused, not only its health part.
            Assert.ThrowsExactly<HealthStepClosedException>(
                () => profile.UpdateIntake(Intake(added, firstName: "Rana", goals: "Run a 10k"), Today, healthStepOpen: false),
                added.ToString());

            Assert.AreEqual(("Lina", (string?)null), (profile.FirstName, profile.Goals), added.ToString());
            Assert.AreEqual(None, AnswersOf(profile), added.ToString());
            Assert.AreEqual(ClientOnboardingStatus.NotStarted, profile.OnboardingStatus, added.ToString());
        }
    }

    // ---- changed ----

    [TestMethod]
    public void AStoredHealthAnswerChangedWhileTheStepIsClosedIsRefused()
    {
        foreach (var changed in new[]
        {
            Stored with { Allergies = "Hazelnut and sesame weals" },
            Stored with { Medications = "Quellotrine tablets" },
            Stored with { PreviousInjuries = "Right meniscus scope" },
            // Compared ordinally, after the trimming the profile applies: a letter's case is a change.
            Stored with { Allergies = Allergy.ToUpperInvariant() },
        })
        {
            var profile = TraineeWithStoredAnswers();

            Assert.ThrowsExactly<HealthStepClosedException>(
                () => profile.UpdateIntake(Intake(changed, goals: "Run a 10k"), Today, healthStepOpen: false),
                changed.ToString());

            Assert.AreEqual(Stored, AnswersOf(profile), changed.ToString());
            Assert.AreEqual("Build strength", profile.Goals, changed.ToString());
        }
    }

    // ---- unchanged ----

    [TestMethod]
    public void AStoredHealthAnswerSentAgainAsItIsPassesWhileTheStepIsClosed()
    {
        var profile = TraineeWithStoredAnswers();

        // The form sends every saved answer with each step: the same answers, spaces around them trimmed as the save
        // trims them, let the other answers of the save through.
        var changed = profile.UpdateIntake(
            Intake(new HealthAnswers($"  {Allergy} ", $"{Medication}\t", Injury), goals: "Run a 10k"),
            Today,
            healthStepOpen: false);

        CollectionAssert.AreEqual(new[] { nameof(ClientProfile.Goals) }, changed.ToArray());
        Assert.AreEqual(Stored, AnswersOf(profile));
        Assert.AreEqual("Run a 10k", profile.Goals);
    }

    [TestMethod]
    public void AClosedStepWithNoHealthAnswerStoredOrSentSavesTheRestOfTheIntake()
    {
        var profile = Trainee();

        var changed = profile.UpdateIntake(Intake(None, firstName: "Rana", goals: "Run a 10k"), Today, healthStepOpen: false);

        CollectionAssert.AreEquivalent(
            new[] { nameof(ClientProfile.FirstName), nameof(ClientProfile.BirthDate), nameof(ClientProfile.HeightCentimeters), nameof(ClientProfile.Goals), nameof(ClientProfile.OnboardingStatus) },
            changed.ToArray());
        Assert.AreEqual(ClientOnboardingStatus.InProgress, profile.OnboardingStatus);
        Assert.AreEqual(None, AnswersOf(profile));
    }

    // ---- emptied ----

    [TestMethod]
    public void AStoredHealthAnswerEmptiedWhileTheStepIsClosedPasses()
    {
        // Each answer alone, emptied by null or by spaces alone, and the three at once.
        foreach (var (sent, kept, field) in new (HealthAnswers Sent, HealthAnswers Kept, string Field)[]
        {
            (Stored with { Allergies = null }, Stored with { Allergies = null }, nameof(ClientProfile.Allergies)),
            (Stored with { Medications = "   " }, Stored with { Medications = null }, nameof(ClientProfile.Medications)),
            (Stored with { PreviousInjuries = string.Empty }, Stored with { PreviousInjuries = null }, nameof(ClientProfile.PreviousInjuries)),
        })
        {
            var profile = TraineeWithStoredAnswers();

            var changed = profile.UpdateIntake(Intake(sent), Today, healthStepOpen: false);

            CollectionAssert.AreEqual(new[] { field }, changed.ToArray(), field);
            Assert.AreEqual(kept, AnswersOf(profile), field);
        }

        var emptied = TraineeWithStoredAnswers();
        CollectionAssert.AreEquivalent(
            new[] { nameof(ClientProfile.Allergies), nameof(ClientProfile.Medications), nameof(ClientProfile.PreviousInjuries) },
            emptied.UpdateIntake(Intake(None), Today, healthStepOpen: false).ToArray());
        Assert.AreEqual(None, AnswersOf(emptied));
    }

    [TestMethod]
    public void OneAnswerEmptiedBesideAnotherAddedIsStillRefused()
    {
        var profile = TraineeWithStoredAnswers();

        Assert.ThrowsExactly<HealthStepClosedException>(() => profile.UpdateIntake(
            Intake(new HealthAnswers(null, Medication, "Right meniscus scope")),
            Today,
            healthStepOpen: false));

        Assert.AreEqual(Stored, AnswersOf(profile), "Nothing emptied either: the refusal comes before any change.");
    }

    // ---- open ----

    [TestMethod]
    public void AnOpenStepSavesAndChangesHealthAnswersAsBefore()
    {
        // Open by default, so every caller that says nothing of the step (a coach's client) keeps today's behaviour.
        var byDefault = Trainee();
        CollectionAssert.IsSubsetOf(
            new[] { nameof(ClientProfile.Allergies), nameof(ClientProfile.Medications), nameof(ClientProfile.PreviousInjuries) },
            byDefault.UpdateIntake(Intake(Stored), Today).ToArray());
        Assert.AreEqual(Stored, AnswersOf(byDefault));

        var open = TraineeWithStoredAnswers();
        var changedTo = Stored with { Allergies = "Hazelnut and sesame weals" };
        CollectionAssert.AreEqual(
            new[] { nameof(ClientProfile.Allergies) },
            open.UpdateIntake(Intake(changedTo), Today, healthStepOpen: true).ToArray());
        Assert.AreEqual(changedTo, AnswersOf(open));

        // An invited client's profile, whose step the caller never closes, the same.
        var invited = ClientProfile.CreateForAcceptedInvitation(
            HouseId, TraineeUserId, HouseCoachUserId, "Rita", "Daher", "rita.daher@oakhall.example", null, null);
        invited.UpdateIntake(Intake(Stored), Today);
        Assert.AreEqual(Stored, AnswersOf(invited));
    }

    // ---- setting up ----

    [TestMethod]
    public void FinishingTheSetUpKeepsTheClosedStepsRule()
    {
        var refused = Trainee();
        Assert.ThrowsExactly<HealthStepClosedException>(
            () => refused.CompleteOnboarding(Intake(Stored), Today, Now, healthStepOpen: false));
        Assert.AreEqual(ClientOnboardingStatus.NotStarted, refused.OnboardingStatus);
        Assert.IsNull(refused.OnboardingCompletedAtUtc);
        Assert.AreEqual(None, AnswersOf(refused));

        var withoutHealth = Trainee();
        withoutHealth.CompleteOnboarding(Intake(None), Today, Now, healthStepOpen: false);
        Assert.AreEqual((ClientOnboardingStatus.Completed, (DateTimeOffset?)Now), (withoutHealth.OnboardingStatus, withoutHealth.OnboardingCompletedAtUtc));

        var open = Trainee();
        open.CompleteOnboarding(Intake(Stored), Today, Now, healthStepOpen: true);
        Assert.AreEqual((ClientOnboardingStatus.Completed, Stored), (open.OnboardingStatus, AnswersOf(open)));
    }

    // ---- the other refusals keep their place ----

    [TestMethod]
    public void TheEarlierRefusalsComeFirstAndAnAnswerTooLongIsTheFormsAsBefore()
    {
        // A released record is read-only whatever is sent (ADR 0027).
        var released = Trainee();
        released.UpdateIntake(Intake(None), Today);
        released.Release(HouseCoachUserId, Now);
        Assert.ThrowsExactly<ClientReleasedException>(
            () => released.UpdateIntake(Intake(Stored), Today, healthStepOpen: false));

        // A set-up profile keeps what completing asked for (SEC-3), still the form's own refusal.
        var setUp = Trainee();
        setUp.CompleteOnboarding(Intake(None), Today, Now, healthStepOpen: false);
        Assert.ThrowsExactly<ArgumentException>(
            () => setUp.UpdateIntake(Intake(Stored) with { Goals = null }, Today, healthStepOpen: false));

        // An answer longer than the field holds is refused for its length, open or closed.
        var tooLong = new string('x', 4_001);
        foreach (var open in new[] { true, false })
        {
            var profile = Trainee();
            Assert.ThrowsExactly<ArgumentException>(
                () => profile.UpdateIntake(Intake(None with { Medications = tooLong }), Today, open),
                open ? "open" : "closed");
        }
    }

    // ---- the refusal itself ----

    [TestMethod]
    public void TheRefusalIsAConflictOfItsOwnAndRepeatsNothingTyped()
    {
        var profile = TraineeWithStoredAnswers();
        var refused = Assert.ThrowsExactly<HealthStepClosedException>(() => profile.UpdateIntake(
            Intake(new HealthAnswers("Pollen of quince", "Brevadil 5 mg", "Torn rotator cuff")),
            Today,
            healthStepOpen: false));

        // Never one of the exceptions the intake's service turns into a 400 on the form.
        Assert.IsNotInstanceOfType<ArgumentException>(refused);
        Assert.IsNotInstanceOfType<InvalidOperationException>(refused);
        Assert.AreEqual(ClosedSentence, refused.Message);
        foreach (var typed in new[] { "quince", "Brevadil", "rotator", Allergy, Medication, Injury })
        {
            Assert.DoesNotContain(typed, refused.ToString(), StringComparison.OrdinalIgnoreCase);
        }

        // Its status keeps its number, beside the ones before it.
        Assert.AreEqual(
            "Success 1, NotFound 2, Invalid 3, Conflict 4, HealthStepClosed 5",
            string.Join(", ", Enum.GetValues<ClientCommandStatus>().Select(status => $"{status} {(int)status}")));
    }

    // ---- the reads ----

    [TestMethod]
    public void TheReadsSayNothingNewUnlessTold()
    {
        // Added last and optional: a reader that says nothing keeps the step open and nobody coached by the house.
        Assert.IsTrue(DefaultsTo(typeof(ClientSelfProfile), nameof(ClientSelfProfile.CoachedByTheHouse), false));
        Assert.IsTrue(DefaultsTo(typeof(ClientSelfProfile), nameof(ClientSelfProfile.HealthStepOpen), true));
        Assert.IsTrue(DefaultsTo(typeof(CoachClientDetails), nameof(CoachClientDetails.HealthStepOpen), true));
    }

    private static bool DefaultsTo(Type record, string parameter, bool expected)
    {
        var found = record.GetConstructors().Single().GetParameters().Single(item => item.Name == parameter);
        return found.HasDefaultValue && found.DefaultValue is bool value && value == expected;
    }

    private static ClientProfile Trainee() =>
        ClientProfile.CreateForHouseSignUp(
            HouseId, TraineeUserId, HouseCoachUserId, "Lina", "Haddad", "lina.haddad@oakhall.example", null);

    /// <summary>A trainee who gave all three answers while their step was open (on Max), and a goal.</summary>
    private static ClientProfile TraineeWithStoredAnswers()
    {
        var profile = Trainee();
        profile.UpdateIntake(Intake(Stored), Today, healthStepOpen: true);
        Assert.AreEqual(Stored, AnswersOf(profile));
        return profile;
    }

    private static HealthAnswers AnswersOf(ClientProfile profile) =>
        new(profile.Allergies, profile.Medications, profile.PreviousInjuries);

    private static ClientIntakeInput Intake(
        HealthAnswers health,
        string firstName = "Lina",
        string? goals = "Build strength") =>
        new(
            firstName,
            "Haddad",
            null,
            BirthDate,
            168m,
            LengthUnit.Centimeter,
            null,
            null,
            null,
            null,
            null,
            goals,
            health.Allergies,
            health.Medications,
            health.PreviousInjuries);

    private sealed record HealthAnswers(string? Allergies, string? Medications, string? PreviousInjuries);
}
