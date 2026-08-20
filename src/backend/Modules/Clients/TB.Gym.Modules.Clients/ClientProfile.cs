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
        string firstName,
        string lastName,
        string email,
        string? phoneNumber,
        DateOnly? birthDate)
        : base(tenantId)
    {
        UserId = userId;
        FirstName = firstName;
        LastName = lastName;
        Email = email;
        NormalizedEmail = email.ToUpperInvariant();
        PhoneNumber = phoneNumber;
        BirthDate = birthDate;
        OnboardingStatus = ClientOnboardingStatus.NotStarted;
    }

    public Guid? UserId { get; private set; }

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

    public ClientOnboardingStatus OnboardingStatus { get; private set; }

    public DateTimeOffset? OnboardingCompletedAtUtc { get; private set; }

    public static ClientProfile CreateForAcceptedInvitation(
        Guid tenantId,
        Guid userId,
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

        var names = ValidateNames(firstName, lastName);
        var normalizedEmail = ValidateEmail(email);
        return new ClientProfile(
            tenantId,
            userId,
            names.FirstName,
            names.LastName,
            normalizedEmail,
            NormalizeOptional(phoneNumber, 32, nameof(phoneNumber)),
            birthDate);
    }

    public IReadOnlyList<string> UpdateIntake(ClientIntakeInput input, DateOnly tenantToday)
    {
        ArgumentNullException.ThrowIfNull(input);
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

    public IReadOnlyList<string> CompleteOnboarding(
        ClientIntakeInput input,
        DateOnly tenantToday,
        DateTimeOffset now)
    {
        var changed = UpdateIntake(input, tenantToday).ToList();
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
        var normalized = NormalizeOptional(notes, 8_000, nameof(notes));
        if (CoachNotes == normalized)
        {
            return false;
        }

        CoachNotes = normalized;
        return true;
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
}
