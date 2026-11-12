using System.Globalization;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public sealed partial class Tenant
{
    /// <summary>
    /// Whether this coaching space is the house (ADR 0041, CLI-022): TB Gym's own space, the one a person signs up
    /// into with no invitation. At most one workspace is, which a unique index keeps, and only the
    /// <c>platform-admin house</c> command sets or clears it.
    /// </summary>
    public bool IsHouse { get; private set; }

    /// <summary>Marks this workspace as the house; false when it already is.</summary>
    public bool MarkAsHouse()
    {
        if (IsHouse)
        {
            return false;
        }

        IsHouse = true;
        return true;
    }

    /// <summary>
    /// Takes the mark away; false when this is not the house. The database refuses it once the house holds a
    /// sign-up or a self-directed trainee.
    /// </summary>
    public bool ClearHouse()
    {
        if (!IsHouse)
        {
            return false;
        }

        IsHouse = false;
        return true;
    }
}

/// <summary>
/// The house's settings (CLI-023): figures the platform admin enters in the app, never a constant, a seed or a
/// document. Each starts empty, and an empty one closes what it governs. A later row of the plan adds its own.
/// </summary>
public enum HouseSetting
{
    /// <summary>New sign-ups the house takes in one of its calendar weeks. Empty or zero keeps sign-up closed.</summary>
    SignUpsPerWeek = 1,

    /// <summary>The age a person must have reached to sign up. Empty keeps sign-up closed.</summary>
    MinimumSignUpAge = 2,
}

/// <summary>What a setting's typed value comes to: the stored form, or why it is refused.</summary>
public sealed record HouseSettingValue(bool IsValid, string? Value, string? Error)
{
    public static HouseSettingValue Empty { get; } = new(true, null, null);

    public static HouseSettingValue Of(string value) => new(true, value, null);

    public static HouseSettingValue Refused(string error) => new(false, null, error);
}

/// <summary>What each house setting may hold. A value is kept as text, in the one form this rule writes.</summary>
public static class HouseSettingRule
{
    public const int ValueMaximumLength = 200;

    public const int MaximumSignUpsPerWeek = 10_000;

    /// <summary>
    /// TB Gym is for adults (DOMAIN-RULES section 11, and the intake's own check, CLI-004): the house's age may be
    /// higher than this, never lower.
    /// </summary>
    public const int AdultAge = 18;

    public const int MaximumSignUpAge = 100;

    public const string SignUpsPerWeekRefusal =
        "Enter a whole number from 0 to 10,000, or leave it empty. Empty or 0 keeps sign-up closed.";

    public const string MinimumSignUpAgeRefusal =
        "Enter an age from 18 to 100, or leave it empty, which keeps sign-up closed. TB Gym is for adults, so the age cannot be under 18.";

    public const string UnknownSettingRefusal = "Choose one of the house's settings.";

    /// <summary>The value as it is stored: trimmed, empty as none, a number without leading zeros.</summary>
    public static HouseSettingValue Normalize(HouseSetting setting, string? value)
    {
        if (!Enum.IsDefined(setting))
        {
            return HouseSettingValue.Refused(UnknownSettingRefusal);
        }

        var text = (value ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            return HouseSettingValue.Empty;
        }

        return setting switch
        {
            HouseSetting.SignUpsPerWeek => WholeNumber(text, 0, MaximumSignUpsPerWeek, SignUpsPerWeekRefusal),
            HouseSetting.MinimumSignUpAge => WholeNumber(text, AdultAge, MaximumSignUpAge, MinimumSignUpAgeRefusal),
            _ => HouseSettingValue.Refused(UnknownSettingRefusal),
        };
    }

    /// <summary>A stored whole number, or none when the setting is empty.</summary>
    public static int? Number(string? value) =>
        int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var number) ? number : null;

    private static HouseSettingValue WholeNumber(string text, int minimum, int maximum, string refusal) =>
        text.Length <= 9 &&
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number) &&
        number >= minimum &&
        number <= maximum
            ? HouseSettingValue.Of(number.ToString(CultureInfo.InvariantCulture))
            : HouseSettingValue.Refused(refusal);
}

/// <summary>The house's settings as they stand: the latest change of each, read as what it means.</summary>
public sealed record HouseSettings(int? SignUpsPerWeek, int? MinimumSignUpAge)
{
    public static HouseSettings Empty { get; } = new(null, null);

    public static HouseSettings From(IEnumerable<KeyValuePair<HouseSetting, string?>> latest)
    {
        ArgumentNullException.ThrowIfNull(latest);
        var values = latest.ToDictionary(item => item.Key, item => item.Value);
        return new HouseSettings(
            HouseSettingRule.Number(values.GetValueOrDefault(HouseSetting.SignUpsPerWeek)),
            HouseSettingRule.Number(values.GetValueOrDefault(HouseSetting.MinimumSignUpAge)));
    }
}

/// <summary>
/// One change of one house setting (CLI-023): what it became, who changed it and when. Rows are numbered 1, 2, 3
/// per setting and the highest is in force; none is ever edited or deleted, which a database trigger keeps.
/// </summary>
public sealed class HouseSettingChange : TenantEntity
{
    private HouseSettingChange()
    {
    }

    private HouseSettingChange(
        Guid tenantId,
        HouseSetting setting,
        int sequence,
        string? value,
        Guid changedByUserId,
        DateTimeOffset changedAtUtc)
        : base(tenantId)
    {
        Setting = setting;
        Sequence = sequence;
        Value = value;
        ChangedByUserId = changedByUserId;
        ChangedAtUtc = changedAtUtc;
    }

    public HouseSetting Setting { get; private set; }

    public int Sequence { get; private set; }

    /// <summary>The value in its stored form; null when the setting was emptied.</summary>
    public string? Value { get; private set; }

    public Guid ChangedByUserId { get; private set; }

    public DateTimeOffset ChangedAtUtc { get; private set; }

    public static HouseSettingChange Record(
        Guid tenantId,
        HouseSetting setting,
        int sequence,
        string? value,
        Guid changedByUserId,
        DateTimeOffset changedAtUtc)
    {
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "A setting's changes are numbered from 1.");
        }

        if (changedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A setting is changed by somebody.", nameof(changedByUserId));
        }

        var normalized = HouseSettingRule.Normalize(setting, value);
        if (!normalized.IsValid)
        {
            throw new ArgumentException(normalized.Error, nameof(value));
        }

        return new HouseSettingChange(tenantId, setting, sequence, normalized.Value, changedByUserId, changedAtUtc);
    }
}

/// <summary>
/// One sign-up into the house (CLI-024, ADR 0041). A new account's sign-up waits here, with the name and date of
/// birth the person typed, until the email is confirmed: only then do the membership and the client profile exist,
/// and the typed details leave this row for the profile. A sign-up never confirmed is removed by the Worker; a
/// confirmed one stays as the fact the week's count reads.
/// </summary>
public sealed class TraineeSignUp : TenantEntity
{
    public const int NameMaximumLength = 100;

    private TraineeSignUp()
    {
    }

    private TraineeSignUp(Guid tenantId, Guid userId, DateTimeOffset requestedAtUtc)
        : base(tenantId)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A sign-up belongs to an account.", nameof(userId));
        }

        UserId = userId;
        RequestedAtUtc = requestedAtUtc;
    }

    public Guid UserId { get; private set; }

    public string? FirstName { get; private set; }

    public string? LastName { get; private set; }

    public DateOnly? BirthDate { get; private set; }

    public DateTimeOffset RequestedAtUtc { get; private set; }

    public DateTimeOffset? ConfirmedAtUtc { get; private set; }

    public Guid? ClientProfileId { get; private set; }

    public bool IsPending => ConfirmedAtUtc is null;

    /// <summary>A new account's sign-up, waiting for its email to be confirmed.</summary>
    public static TraineeSignUp Request(
        Guid tenantId,
        Guid userId,
        string firstName,
        string lastName,
        DateOnly birthDate,
        DateTimeOffset requestedAtUtc)
    {
        var names = TraineeSignUpRule.NormalizeNames(firstName, lastName);
        return new TraineeSignUp(tenantId, userId, requestedAtUtc)
        {
            FirstName = names.FirstName,
            LastName = names.LastName,
            BirthDate = birthDate,
        };
    }

    /// <summary>A confirmed account that joined at once: nothing waits, so nothing typed is kept here.</summary>
    public static TraineeSignUp Joined(
        Guid tenantId,
        Guid userId,
        Guid clientProfileId,
        DateTimeOffset joinedAtUtc)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A joined sign-up names its client profile.", nameof(clientProfileId));
        }

        return new TraineeSignUp(tenantId, userId, joinedAtUtc)
        {
            ConfirmedAtUtc = joinedAtUtc,
            ClientProfileId = clientProfileId,
        };
    }

    /// <summary>The email was confirmed and the profile exists: the typed details now live there alone.</summary>
    public void Confirm(Guid clientProfileId, DateTimeOffset confirmedAtUtc)
    {
        if (!IsPending)
        {
            throw new InvalidOperationException("This sign-up was already confirmed.");
        }

        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A confirmed sign-up names its client profile.", nameof(clientProfileId));
        }

        ConfirmedAtUtc = confirmedAtUtc;
        ClientProfileId = clientProfileId;
        FirstName = null;
        LastName = null;
        BirthDate = null;
    }
}

public enum TraineeSignUpStatus
{
    /// <summary>No workspace is the house, or one of the settings that open sign-up is empty.</summary>
    Closed = 1,

    /// <summary>The house's week has taken every sign-up its setting allows.</summary>
    Full = 2,

    Open = 3,
}

public enum TraineeBirthDateCheck
{
    Valid = 1,

    /// <summary>Younger than the house's age on the house's day.</summary>
    TooYoung = 2,

    /// <summary>A day still to come, or more than 120 years ago.</summary>
    OutOfRange = 3,
}

/// <summary>
/// The house's calendar week holding an instant, in the house's own time: its days <c>[StartsOn, EndsOnExclusive)</c>
/// and the instants <c>[StartsAtUtc, EndsAtUtc)</c> the week's sign-ups are counted between.
/// </summary>
public sealed record TraineeSignUpWeek(
    DateOnly Today,
    DateOnly StartsOn,
    DateOnly EndsOnExclusive,
    DateTimeOffset StartsAtUtc,
    DateTimeOffset EndsAtUtc);

/// <summary>
/// Trainee sign-up v1 (CLI-024): when the house's sign-up is open, which week a sign-up counts in, and who is old
/// enough. Every figure it weighs is a house setting; this rule holds none of its own.
/// </summary>
public static class TraineeSignUpRule
{
    public const string Key = "TraineeSignUp";

    public const int Version = 1;

    /// <summary>The oldest date of birth accepted, as the intake's own range (CLI-004).</summary>
    public const int OldestAgeYears = 120;

    /// <summary>The sign-up form's request is small; anything larger is refused before it is read.</summary>
    public const int MaximumRequestBytes = 16 * 1024;

    /// <summary>Sign-up takes people only while both of its settings are filled and the week's number is above zero.</summary>
    public static bool IsOpenFor(HouseSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return settings.SignUpsPerWeek is > 0 && settings.MinimumSignUpAge is not null;
    }

    public static TraineeSignUpStatus Status(bool hasHouse, HouseSettings settings, int signUpsThisWeek)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (!hasHouse || !IsOpenFor(settings))
        {
            return TraineeSignUpStatus.Closed;
        }

        return signUpsThisWeek >= settings.SignUpsPerWeek ? TraineeSignUpStatus.Full : TraineeSignUpStatus.Open;
    }

    /// <summary>The house's week holding <paramref name="now"/>, starting on the house's first day of the week.</summary>
    public static TraineeSignUpWeek WeekOf(DateTimeOffset now, TimeZoneInfo houseZone, DayOfWeek weekStartsOn)
    {
        ArgumentNullException.ThrowIfNull(houseZone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, houseZone).DateTime);
        var daysIn = ((int)today.DayOfWeek - (int)weekStartsOn + 7) % 7;
        var startsOn = today.AddDays(-daysIn);
        var endsOn = startsOn.AddDays(7);
        return new TraineeSignUpWeek(
            today,
            startsOn,
            endsOn,
            StartOfDayUtc(startsOn, houseZone),
            StartOfDayUtc(endsOn, houseZone));
    }

    /// <summary>
    /// The first instant of a day in the house's zone. A midnight the clocks skip (Beirut moves forward at 00:00)
    /// starts the day when they land; a midnight they pass twice starts it at the first pass.
    /// </summary>
    public static DateTimeOffset StartOfDayUtc(DateOnly day, TimeZoneInfo houseZone)
    {
        ArgumentNullException.ThrowIfNull(houseZone);
        var midnight = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        var local = midnight;
        while (houseZone.IsInvalidTime(local) && local < midnight.AddDays(1))
        {
            local = local.AddMinutes(1);
        }

        var offset = houseZone.IsAmbiguousTime(local)
            ? houseZone.GetAmbiguousTimeOffsets(local).Max()
            : houseZone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    /// <summary>
    /// Whether a date of birth has reached <paramref name="minimumAge"/> on the house's day: the birthday itself
    /// counts, and someone born on 29 February reaches an age on 28 February of a year without one.
    /// </summary>
    public static TraineeBirthDateCheck CheckBirthDate(DateOnly birthDate, int minimumAge, DateOnly houseToday)
    {
        if (birthDate > houseToday || birthDate < houseToday.AddYears(-OldestAgeYears))
        {
            return TraineeBirthDateCheck.OutOfRange;
        }

        return birthDate.AddYears(minimumAge) > houseToday
            ? TraineeBirthDateCheck.TooYoung
            : TraineeBirthDateCheck.Valid;
    }

    /// <summary>The names as a client profile keeps them: trimmed, each required and 100 characters at most.</summary>
    public static (string FirstName, string LastName) NormalizeNames(string? firstName, string? lastName)
    {
        var first = (firstName ?? string.Empty).Trim();
        var last = (lastName ?? string.Empty).Trim();
        if (first.Length == 0 || last.Length == 0)
        {
            throw new ArgumentException("First and last names are required.");
        }

        if (first.Length > TraineeSignUp.NameMaximumLength || last.Length > TraineeSignUp.NameMaximumLength)
        {
            throw new ArgumentException("First and last names cannot exceed 100 characters.");
        }

        return (first, last);
    }
}

/// <summary>
/// The Worker's housekeeping for the house's sign-ups, section <c>TraineeSignUps</c> (CLI-025): how long a sign-up
/// may wait for its email to be confirmed, and the sweep that removes the ones that waited longer. Read when a host
/// starts; a host whose settings are wrong refuses to start, naming the setting and never quoting its value.
/// </summary>
public sealed class TraineeSignUpOptions
{
    public const string SectionName = "TraineeSignUps";

    public const int MinimumRemoveAfterDays = 1;

    public const int MaximumRemoveAfterDays = 90;

    public const int MinimumSweepIntervalSeconds = 60;

    public const int MaximumSweepIntervalSeconds = 86_400;

    /// <summary>
    /// Whole days a sign-up may wait for its confirmation before it is removed. A confirmation link works for a
    /// day and nothing sends a second one, so two days leaves room for a late email and then frees the address
    /// for the person to sign up again.
    /// </summary>
    public int RemoveUnconfirmedAfterDays { get; set; } = 2;

    /// <summary>Whether the Worker runs the sweep at all.</summary>
    public bool SweepEnabled { get; set; } = true;

    /// <summary>Seconds between two sweeps: once an hour.</summary>
    public int SweepIntervalSeconds { get; set; } = 3_600;

    /// <summary>The first setting that is wrong, named and never quoted; null when every one is right.</summary>
    public string? Validate()
    {
        if (RemoveUnconfirmedAfterDays is < MinimumRemoveAfterDays or > MaximumRemoveAfterDays)
        {
            return string.Create(
                CultureInfo.InvariantCulture,
                $"{SectionName}:RemoveUnconfirmedAfterDays must be a whole number of days from {MinimumRemoveAfterDays} to {MaximumRemoveAfterDays}.");
        }

        return SweepIntervalSeconds is < MinimumSweepIntervalSeconds or > MaximumSweepIntervalSeconds
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"{SectionName}:SweepIntervalSeconds must be from {MinimumSweepIntervalSeconds} to {MaximumSweepIntervalSeconds} seconds.")
            : null;
    }
}
