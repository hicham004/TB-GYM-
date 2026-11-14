using System.Net.Mail;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

public sealed class ClientProfile : TenantEntity
{
    private ClientProfile()
    {
    }

    private ClientProfile(
        Guid tenantId,
        Guid userId,
        Guid? assignedCoachUserId,
        string firstName,
        string lastName,
        string email,
        string? phoneNumber,
        DateOnly? birthDate)
        : base(tenantId)
    {
        UserId = userId;
        AssignedCoachUserId = assignedCoachUserId;
        FirstName = firstName;
        LastName = lastName;
        Email = email;
        NormalizedEmail = email.ToUpperInvariant();
        PhoneNumber = phoneNumber;
        BirthDate = birthDate;
        OnboardingStatus = ClientOnboardingStatus.NotStarted;
    }

    public Guid? UserId { get; private set; }

    /// <summary>
    /// The one active Owner or Coach of this workspace who coaches this client, or nobody while the client waits for
    /// a coach (CLI-012, C8): their coach left the team, the coach who invited them had left by the time they joined,
    /// or the house had no Coach when they signed up. A Coach sees and acts only on the clients assigned to them; the
    /// Owner manages every client and coaches only their own (CLI-013), so nobody opens a waiting client's private
    /// side. Every change appends a <see cref="ClientCoachAssignment"/>, and the database refuses a change that does
    /// not. A released client always names the Owner, as the record's keeper (ADR 0027).
    /// </summary>
    public Guid? AssignedCoachUserId { get; private set; }

    /// <summary>Nobody coaches this client now; the Owner gives them a coach by reassigning them (CLI-012).</summary>
    public bool IsWaitingForCoach => AssignedCoachUserId is null;

    public string FirstName { get; private set; } = string.Empty;

    public string LastName { get; private set; } = string.Empty;

    public string Email { get; private set; } = string.Empty;

    public string NormalizedEmail { get; private set; } = string.Empty;

    public string? PhoneNumber { get; private set; }

    public DateOnly? BirthDate { get; private set; }

    public decimal? HeightCentimeters { get; private set; }

    public decimal? HeightEnteredValue { get; private set; }

    public LengthUnit? HeightEnteredUnit { get; private set; }

    public string? WorkType { get; private set; }

    public int? AverageDailySteps { get; private set; }

    public string? TrainingBackground { get; private set; }

    public string? FoodPreferences { get; private set; }

    public string? FoodAversions { get; private set; }

    public string? Goals { get; private set; }

    public string? Allergies { get; private set; }

    public string? Medications { get; private set; }

    public string? PreviousInjuries { get; private set; }

    public string? CoachNotes { get; private set; }

    public bool IsCoachBlocked { get; private set; }

    /// <summary>
    /// A trainee who signed up into the house with no invitation and trains as their own coach (CLI-026, ADR 0041).
    /// The record names the member of the house's staff who may read their private side, or nobody while the house
    /// has no Coach (ADR 0026), but nobody coaches this person: they raise nothing on Coach Today and their notes and
    /// leaving reach no staff inbox, unless a Max plan grants today, when the house coaches them as a coach's client is
    /// coached and their Health step is open (CLI-026, CLI-028). That is read from the house's plans at the time, so the
    /// mark itself never changes. A database trigger refuses the mark anywhere but in the house.
    /// </summary>
    public bool IsSelfDirected { get; private set; }

    public ClientOnboardingStatus OnboardingStatus { get; private set; }

    public DateTimeOffset? OnboardingCompletedAtUtc { get; private set; }

    /// <summary>
    /// When this relationship ended — the owner released the client, or the client left (ADR 0027).
    /// Permanent: the record is kept but is read-only from then on, and a database trigger refuses any
    /// later change to the row. A client invited back gets a new profile; this one stays as it is.
    /// </summary>
    public DateTimeOffset? ReleasedAtUtc { get; private set; }

    public bool IsReleased => ReleasedAtUtc is not null;

    /// <summary>
    /// When the person's account was closed and this record anonymised (CLI-027). Set once, on an ended record, and
    /// never undone: a database check keeps every personal field of an anonymised record empty or anonymous.
    /// </summary>
    public DateTimeOffset? AnonymisedAtUtc { get; private set; }

    public bool IsAnonymised => AnonymisedAtUtc is not null;

    /// <summary>The name every anonymised record carries, so the coach's lists and notices read "Closed account".</summary>
    public const string ClosedFirstName = "Closed";

    /// <inheritdoc cref="ClosedFirstName"/>
    public const string ClosedLastName = "account";

    /// <summary>The reserved domain an anonymised record's address sits under: no mail can ever reach it.</summary>
    public const string ClosedAddressDomain = "closed.tbgym.invalid";

    /// <summary>The address an anonymised record carries: unique to the record, and naming nobody.</summary>
    public static string ClosedAddress(Guid clientProfileId) => $"closed-{clientProfileId:N}@{ClosedAddressDomain}";

    /// <summary>
    /// The profile of someone who accepted an invitation: with the coach who sent it, or waiting for a coach when
    /// <paramref name="assignedCoachUserId"/> is null because that coach left the team before they accepted (CLI-012).
    /// </summary>
    public static ClientProfile CreateForAcceptedInvitation(
        Guid tenantId,
        Guid userId,
        Guid? assignedCoachUserId,
        string firstName,
        string lastName,
        string email,
        string? phoneNumber,
        DateOnly? birthDate)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A user id is required.", nameof(userId));
        }

        if (assignedCoachUserId == Guid.Empty || assignedCoachUserId == userId)
        {
            throw new ArgumentException(
                "A client is assigned to a coach other than themselves, or to nobody.",
                nameof(assignedCoachUserId));
        }

        var names = ValidateNames(firstName, lastName);
        var normalizedEmail = ValidateEmail(email);
        return new ClientProfile(
            tenantId,
            userId,
            assignedCoachUserId,
            names.FirstName,
            names.LastName,
            normalizedEmail,
            NormalizeOptional(phoneNumber, 32, nameof(phoneNumber)),
            birthDate);
    }

    /// <summary>
    /// The profile of someone who signed up into the house (CLI-024): self-directed from its first day, with the
    /// name and date of birth they typed. Whether they are old enough was decided before this, against the house's
    /// own age. <paramref name="assignedCoachUserId"/> is the house's Coach, or null while the house has none, and
    /// the trainee then waits for one (CLI-024).
    /// </summary>
    public static ClientProfile CreateForHouseSignUp(
        Guid tenantId,
        Guid userId,
        Guid? assignedCoachUserId,
        string firstName,
        string lastName,
        string email,
        DateOnly? birthDate)
    {
        var profile = CreateForAcceptedInvitation(
            tenantId,
            userId,
            assignedCoachUserId,
            firstName,
            lastName,
            email,
            phoneNumber: null,
            birthDate);
        profile.IsSelfDirected = true;
        return profile;
    }

    /// <summary>
    /// Saves the whole intake, field by field, and names the fields it changed (never their values).
    /// </summary>
    /// <param name="input">Every answer, as the form or the coach's sheet sends it.</param>
    /// <param name="tenantToday">The workspace's day, for the platform's adult age.</param>
    /// <param name="healthStepOpen">
    /// Whether the Health step is open (CLI-028): false for a house trainee off Max, worked out by the caller from the
    /// house's plans. While closed, a health answer that is added or changed is refused with
    /// <see cref="HealthStepClosedException"/> before anything changes; an unchanged answer, re-sent with the rest of
    /// the form, and an emptied one pass.
    /// </param>
    public IReadOnlyList<string> UpdateIntake(ClientIntakeInput input, DateOnly tenantToday, bool healthStepOpen = true)
    {
        ArgumentNullException.ThrowIfNull(input);
        EnsureNotReleased();
        // What completing asked for stays (audit SEC-3): only the database's check said so before, as a
        // 500 for an update that left a field out. Refused before anything changes.
        if (OnboardingStatus == ClientOnboardingStatus.Completed &&
            (input.BirthDate is null || input.HeightValue is null || string.IsNullOrWhiteSpace(input.Goals)))
        {
            throw new ArgumentException(
                "Birth date, height and at least one goal stay required once the profile is set up.");
        }

        if (!healthStepOpen)
        {
            EnsureHealthStepAllows(input);
        }

        var changed = new List<string>();
        var names = ValidateNames(input.FirstName, input.LastName);

        SetIfChanged(nameof(FirstName), FirstName, names.FirstName, value => FirstName = value!, changed);
        SetIfChanged(nameof(LastName), LastName, names.LastName, value => LastName = value!, changed);

        var phone = NormalizeOptional(input.PhoneNumber, 32, nameof(input.PhoneNumber));
        SetIfChanged(nameof(PhoneNumber), PhoneNumber, phone, value => PhoneNumber = value, changed);

        if (input.BirthDate is { } birthDate)
        {
            ValidateAdultBirthDate(birthDate, tenantToday);
        }

        if (BirthDate != input.BirthDate)
        {
            BirthDate = input.BirthDate;
            changed.Add(nameof(BirthDate));
        }

        var height = NormalizeHeight(input.HeightValue, input.HeightUnit);
        if (HeightCentimeters != height.Centimeters ||
            HeightEnteredValue != height.EnteredValue ||
            HeightEnteredUnit != height.EnteredUnit)
        {
            HeightCentimeters = height.Centimeters;
            HeightEnteredValue = height.EnteredValue;
            HeightEnteredUnit = height.EnteredUnit;
            changed.Add(nameof(HeightCentimeters));
        }

        if (input.AverageDailySteps is < 0 or > 100_000)
        {
            throw new ArgumentOutOfRangeException(
                nameof(input),
                "Average daily steps must be between 0 and 100,000.");
        }

        SetIfChanged(nameof(WorkType), WorkType, NormalizeOptional(input.WorkType, 200, nameof(input.WorkType)), value => WorkType = value, changed);
        if (AverageDailySteps != input.AverageDailySteps)
        {
            AverageDailySteps = input.AverageDailySteps;
            changed.Add(nameof(AverageDailySteps));
        }

        SetIfChanged(nameof(TrainingBackground), TrainingBackground, NormalizeOptional(input.TrainingBackground, 4_000, nameof(input.TrainingBackground)), value => TrainingBackground = value, changed);
        SetIfChanged(nameof(FoodPreferences), FoodPreferences, NormalizeOptional(input.FoodPreferences, 4_000, nameof(input.FoodPreferences)), value => FoodPreferences = value, changed);
        SetIfChanged(nameof(FoodAversions), FoodAversions, NormalizeOptional(input.FoodAversions, 4_000, nameof(input.FoodAversions)), value => FoodAversions = value, changed);
        SetIfChanged(nameof(Goals), Goals, NormalizeOptional(input.Goals, 4_000, nameof(input.Goals)), value => Goals = value, changed);
        SetIfChanged(nameof(Allergies), Allergies, NormalizeOptional(input.Allergies, 4_000, nameof(input.Allergies)), value => Allergies = value, changed);
        SetIfChanged(nameof(Medications), Medications, NormalizeOptional(input.Medications, 4_000, nameof(input.Medications)), value => Medications = value, changed);
        SetIfChanged(nameof(PreviousInjuries), PreviousInjuries, NormalizeOptional(input.PreviousInjuries, 4_000, nameof(input.PreviousInjuries)), value => PreviousInjuries = value, changed);

        if (changed.Count > 0 && OnboardingStatus == ClientOnboardingStatus.NotStarted)
        {
            OnboardingStatus = ClientOnboardingStatus.InProgress;
            changed.Add(nameof(OnboardingStatus));
        }

        return changed;
    }

    /// <summary>
    /// Saves the intake as <see cref="UpdateIntake"/> does, the Health step's rule included, and finishes the set-up.
    /// </summary>
    public IReadOnlyList<string> CompleteOnboarding(
        ClientIntakeInput input,
        DateOnly tenantToday,
        DateTimeOffset now,
        bool healthStepOpen = true)
    {
        var changed = UpdateIntake(input, tenantToday, healthStepOpen).ToList();
        if (BirthDate is null || HeightCentimeters is null || string.IsNullOrWhiteSpace(Goals))
        {
            throw new InvalidOperationException(
                "Birth date, height, and at least one goal are required to complete onboarding.");
        }

        if (OnboardingStatus != ClientOnboardingStatus.Completed)
        {
            OnboardingStatus = ClientOnboardingStatus.Completed;
            OnboardingCompletedAtUtc = now;
            changed.Add(nameof(OnboardingStatus));
        }

        return changed;
    }

    public bool UpdateCoachNotes(string? notes)
    {
        EnsureNotReleased();
        var normalized = NormalizeOptional(notes, 8_000, nameof(notes));
        if (CoachNotes == normalized)
        {
            return false;
        }

        CoachNotes = normalized;
        return true;
    }

    /// <summary>
    /// Moves this client to another coach, or gives them one while they wait. Returns false when they already have
    /// that coach, so a repeated request records no history.
    /// </summary>
    public bool AssignCoach(Guid coachUserId)
    {
        if (coachUserId == Guid.Empty || coachUserId == UserId)
        {
            throw new ArgumentException("A client is assigned to a coach other than themselves.", nameof(coachUserId));
        }

        EnsureNotReleased();
        if (AssignedCoachUserId == coachUserId)
        {
            return false;
        }

        AssignedCoachUserId = coachUserId;
        return true;
    }

    /// <summary>
    /// Leaves this client waiting for a coach, because theirs left the team (C8: the Owner never gets a departing
    /// coach's clients automatically). Returns false when they already wait, so a repeat records no history.
    /// </summary>
    public bool WaitForCoach()
    {
        EnsureNotReleased();
        if (AssignedCoachUserId is null)
        {
            return false;
        }

        AssignedCoachUserId = null;
        return true;
    }

    /// <summary>
    /// Ends this client's relationship with the workspace, whether the owner released them or they
    /// left. Nothing is deleted; the caller also ends the membership, closes open plans and programs,
    /// and records who ended it and why.
    /// </summary>
    /// <remarks>
    /// The client must already be with the owner, so a former client never keeps a coach's list
    /// populated or stops that coach being removed later. A waiting client is moved to the owner first too.
    /// </remarks>
    public void Release(Guid ownerUserId, DateTimeOffset now)
    {
        EnsureNotReleased();
        if (AssignedCoachUserId != ownerUserId)
        {
            throw new InvalidOperationException("A client is moved to the owner before being released.");
        }

        ReleasedAtUtc = now;
    }

    public bool BlockCoachAccess()
    {
        EnsureNotReleased();
        if (IsCoachBlocked)
        {
            return false;
        }

        IsCoachBlocked = true;
        return true;
    }

    public bool UnblockCoachAccess()
    {
        EnsureNotReleased();
        if (!IsCoachBlocked)
        {
            return false;
        }

        IsCoachBlocked = false;
        return true;
    }

    /// <summary>
    /// Erases the person from this ended record when they close their TB Gym account (CLI-027): the name becomes
    /// "Closed account", the address a reserved one naming nobody, and every other personal field, the intake
    /// answers, the health fields and the coach's notes, is emptied. The record itself stays, with its ids, its
    /// coach, its dates and every fact hung on it (plans, payments, workouts, records), so nothing paid or done
    /// is deleted (SYS-004).
    /// </summary>
    /// <returns>The fields that changed, for the profile's change history; empty when it was anonymised already.</returns>
    public IReadOnlyList<string> Anonymise(DateTimeOffset now)
    {
        if (!IsReleased)
        {
            throw new InvalidOperationException("A client record is ended before it is anonymised.");
        }

        if (IsAnonymised)
        {
            return [];
        }

        var changed = new List<string>();
        var address = ClosedAddress(Id);
        SetIfChanged(nameof(FirstName), FirstName, ClosedFirstName, value => FirstName = value!, changed);
        SetIfChanged(nameof(LastName), LastName, ClosedLastName, value => LastName = value!, changed);
        if (Email != address)
        {
            Email = address;
            NormalizedEmail = address.ToUpperInvariant();
            changed.Add(nameof(Email));
        }

        SetIfChanged(nameof(PhoneNumber), PhoneNumber, null, value => PhoneNumber = value, changed);
        if (BirthDate is not null)
        {
            BirthDate = null;
            changed.Add(nameof(BirthDate));
        }

        if (HeightCentimeters is not null || HeightEnteredValue is not null || HeightEnteredUnit is not null)
        {
            HeightCentimeters = null;
            HeightEnteredValue = null;
            HeightEnteredUnit = null;
            changed.Add("Height");
        }

        SetIfChanged(nameof(WorkType), WorkType, null, value => WorkType = value, changed);
        if (AverageDailySteps is not null)
        {
            AverageDailySteps = null;
            changed.Add(nameof(AverageDailySteps));
        }

        SetIfChanged(nameof(TrainingBackground), TrainingBackground, null, value => TrainingBackground = value, changed);
        SetIfChanged(nameof(FoodPreferences), FoodPreferences, null, value => FoodPreferences = value, changed);
        SetIfChanged(nameof(FoodAversions), FoodAversions, null, value => FoodAversions = value, changed);
        SetIfChanged(nameof(Goals), Goals, null, value => Goals = value, changed);
        SetIfChanged(nameof(Allergies), Allergies, null, value => Allergies = value, changed);
        SetIfChanged(nameof(Medications), Medications, null, value => Medications = value, changed);
        SetIfChanged(nameof(PreviousInjuries), PreviousInjuries, null, value => PreviousInjuries = value, changed);
        SetIfChanged(nameof(CoachNotes), CoachNotes, null, value => CoachNotes = value, changed);
        AnonymisedAtUtc = now;
        changed.Add(nameof(AnonymisedAtUtc));
        return changed;
    }

    private void EnsureNotReleased()
    {
        if (IsReleased)
        {
            throw new ClientReleasedException();
        }
    }

    /// <summary>
    /// The closed Health step (CLI-028): each health answer is weighed after the same normalising the save applies, so
    /// an answer re-sent as it is stored (the form sends every saved answer) or emptied passes, and one that is added
    /// or changed is refused, the whole save with it.
    /// </summary>
    private void EnsureHealthStepAllows(ClientIntakeInput input)
    {
        if (AddsOrChanges(Allergies, NormalizeOptional(input.Allergies, 4_000, nameof(input.Allergies))) ||
            AddsOrChanges(Medications, NormalizeOptional(input.Medications, 4_000, nameof(input.Medications))) ||
            AddsOrChanges(PreviousInjuries, NormalizeOptional(input.PreviousInjuries, 4_000, nameof(input.PreviousInjuries))))
        {
            throw new HealthStepClosedException();
        }

        static bool AddsOrChanges(string? stored, string? next) =>
            next is not null && !string.Equals(stored, next, StringComparison.Ordinal);
    }

    private static (string FirstName, string LastName) ValidateNames(string firstName, string lastName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(firstName);
        ArgumentException.ThrowIfNullOrWhiteSpace(lastName);
        var normalizedFirstName = firstName.Trim();
        var normalizedLastName = lastName.Trim();
        if (normalizedFirstName.Length > 100 || normalizedLastName.Length > 100)
        {
            throw new ArgumentException("First and last names cannot exceed 100 characters.");
        }

        return (normalizedFirstName, normalizedLastName);
    }

    private static string ValidateEmail(string email)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        var normalizedEmail = email.Trim().ToLowerInvariant();
        if (!MailAddress.TryCreate(normalizedEmail, out _) || normalizedEmail.Length > 320)
        {
            throw new ArgumentException("A valid email address is required.", nameof(email));
        }

        return normalizedEmail;
    }

    private static void ValidateAdultBirthDate(DateOnly birthDate, DateOnly tenantToday)
    {
        if (birthDate > tenantToday || birthDate.AddYears(18) > tenantToday)
        {
            throw new ArgumentOutOfRangeException(
                nameof(birthDate),
                "TB Gym onboarding currently requires the client to be at least 18 years old.");
        }

        if (birthDate < tenantToday.AddYears(-120))
        {
            throw new ArgumentOutOfRangeException(nameof(birthDate), "Birth date is outside the supported range.");
        }
    }

    private static (decimal? Centimeters, decimal? EnteredValue, LengthUnit? EnteredUnit) NormalizeHeight(
        decimal? value,
        LengthUnit? unit)
    {
        if (value is null && unit is null)
        {
            return (null, null, null);
        }

        if (value is null || unit is null || !Enum.IsDefined(unit.Value))
        {
            throw new ArgumentException("Height value and unit must be provided together.");
        }

        var centimeters = unit == LengthUnit.Centimeter ? value.Value : value.Value * 2.54m;
        if (centimeters is < 50m or > 300m)
        {
            throw new ArgumentOutOfRangeException(nameof(value), "Height must be between 50 and 300 centimeters.");
        }

        return (decimal.Round(centimeters, 2, MidpointRounding.AwayFromZero), value, unit);
    }

    private static string? NormalizeOptional(string? value, int maxLength, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    private static void SetIfChanged(
        string field,
        string? current,
        string? next,
        Action<string?> setter,
        List<string> changed)
    {
        if (current == next)
        {
            return;
        }

        setter(next);
        changed.Add(field);
    }
}

public sealed class ClientRelationshipEvent : TenantEntity
{
    private ClientRelationshipEvent()
    {
    }

    private ClientRelationshipEvent(
        Guid tenantId,
        Guid clientProfileId,
        ClientRelationshipEventType eventType,
        string reason,
        DateTimeOffset occurredAtUtc)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        EventType = eventType;
        Reason = ValidateReason(reason);
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid ClientProfileId { get; private set; }

    public ClientRelationshipEventType EventType { get; private set; }

    public string Reason { get; private set; } = string.Empty;

    public DateTimeOffset OccurredAtUtc { get; private set; }

    public static ClientRelationshipEvent Create(
        Guid tenantId,
        Guid clientProfileId,
        ClientRelationshipEventType eventType,
        string reason,
        DateTimeOffset occurredAtUtc)
    {
        if (clientProfileId == Guid.Empty || !Enum.IsDefined(eventType))
        {
            throw new ArgumentException("A client and relationship event type are required.");
        }

        return new ClientRelationshipEvent(
            tenantId,
            clientProfileId,
            eventType,
            reason,
            occurredAtUtc);
    }

    private static string ValidateReason(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        var normalized = reason.Trim();
        return normalized.Length <= 500
            ? normalized
            : throw new ArgumentException("The relationship status reason cannot exceed 500 characters.", nameof(reason));
    }
}

public sealed class ClientProfileChange : TenantEntity
{
    private ClientProfileChange()
    {
    }

    private ClientProfileChange(
        Guid tenantId,
        Guid clientProfileId,
        ClientChangeSource source,
        string changedFields)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        Source = source;
        ChangedFields = changedFields;
    }

    public Guid ClientProfileId { get; private set; }

    public ClientChangeSource Source { get; private set; }

    public string ChangedFields { get; private set; } = string.Empty;

    public static ClientProfileChange Create(
        Guid tenantId,
        Guid clientProfileId,
        ClientChangeSource source,
        IEnumerable<string> changedFields)
    {
        var normalized = string.Join(
            ',',
            changedFields.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));
        ArgumentException.ThrowIfNullOrWhiteSpace(normalized);
        return new ClientProfileChange(tenantId, clientProfileId, source, normalized);
    }
}

public sealed record ClientIntakeInput(
    string FirstName,
    string LastName,
    string? PhoneNumber,
    DateOnly? BirthDate,
    decimal? HeightValue,
    LengthUnit? HeightUnit,
    string? WorkType,
    int? AverageDailySteps,
    string? TrainingBackground,
    string? FoodPreferences,
    string? FoodAversions,
    string? Goals,
    string? Allergies,
    string? Medications,
    string? PreviousInjuries);

public enum LengthUnit
{
    Centimeter = 1,
    Inch = 2,
}

public enum ClientOnboardingStatus
{
    NotStarted = 1,
    InProgress = 2,
    Completed = 3,
}

public enum ClientChangeSource
{
    InvitationAcceptance = 1,
    Client = 2,
    Coach = 3,
    OnboardingCompletion = 4,

    /// <summary>The person signed up into the house with no invitation (CLI-024).</summary>
    SignUp = 5,

    /// <summary>The person closed their TB Gym account and the record was anonymised (CLI-027).</summary>
    AccountClosure = 6,
}

public enum ClientRelationshipEventType
{
    Blocked = 1,
    Unblocked = 2,

    /// <summary>The owner ended the client's relationship with the workspace. Permanent.</summary>
    Released = 3,

    /// <summary>The client ended their own relationship with the workspace. Permanent, like a release.</summary>
    Left = 4,
}

/// <summary>Who ended a former client's relationship with the workspace (ADR 0027).</summary>
public enum ClientDepartureKind
{
    ReleasedByOwner = 1,
    LeftByClient = 2,
}

/// <summary>
/// A write reached a client the owner has released. Their record is kept and readable by the owner,
/// but nothing about it changes any more; the API answers 409 <c>client_released</c>.
/// </summary>
/// <remarks>
/// Deliberately not an <see cref="InvalidOperationException"/>: application services translate those
/// into their own validation answers, and this one has to reach the API's single handler unchanged.
/// </remarks>
public sealed class ClientReleasedException()
    : Exception("This client has been released from the workspace; their record is read-only.");

/// <summary>
/// An intake added or changed a health answer while the Health step is closed (CLI-028): the person is a house trainee
/// whom Max does not coach today. Nothing was saved; the API answers 409 <c>health_step_closed</c>. The message names
/// no answer, so nothing typed reaches a log or a screen through it (CLI-008).
/// </summary>
/// <remarks>
/// Deliberately not an <see cref="InvalidOperationException"/> or an <see cref="ArgumentException"/>: the intake's
/// application service turns those into a 400 on the form, and this refusal is a 409 of its own.
/// </remarks>
public sealed class HealthStepClosedException() : Exception(Sentence)
{
    /// <summary>The refusal's words, the same in the exception and in the API's answer.</summary>
    public const string Sentence =
        "Health answers open on Max, TB Gym's coaching. Your other answers can still be saved.";
}
