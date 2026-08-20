using System.Globalization;
using System.Text.RegularExpressions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public sealed partial class Tenant : AuditableEntity
{
    private Tenant()
    {
    }

    private Tenant(
        string name,
        string slug,
        string timeZoneId,
        string defaultCulture,
        string defaultCurrencyCode,
        DayOfWeek weekStartsOn)
    {
        Name = name;
        Slug = slug;
        TimeZoneId = timeZoneId;
        DefaultCulture = defaultCulture;
        DefaultCurrencyCode = defaultCurrencyCode;
        WeekStartsOn = weekStartsOn;
        IsActive = true;
    }

    public string Name { get; private set; } = string.Empty;

    public string Slug { get; private set; } = string.Empty;

    public string TimeZoneId { get; private set; } = string.Empty;

    public string DefaultCulture { get; private set; } = string.Empty;

    public string DefaultCurrencyCode { get; private set; } = string.Empty;

    public DayOfWeek WeekStartsOn { get; private set; }

    public bool IsActive { get; private set; }

    public static Tenant Create(
        string name,
        string slug,
        string timeZoneId = "Asia/Beirut",
        string defaultCulture = "en-LB",
        string defaultCurrencyCode = "USD",
        DayOfWeek weekStartsOn = DayOfWeek.Monday)
    {
        var normalizedName = ValidateName(name);
        var normalizedSlug = NormalizeSlug(slug);
        var settings = WorkspaceSettings.Validate(
            timeZoneId,
            defaultCulture,
            defaultCurrencyCode,
            weekStartsOn);

        return new Tenant(
            normalizedName,
            normalizedSlug,
            settings.TimeZoneId,
            settings.DefaultCulture,
            settings.DefaultCurrencyCode,
            settings.WeekStartsOn);
    }

    public void UpdateSettings(
        string name,
        string timeZoneId,
        string defaultCulture,
        string defaultCurrencyCode,
        DayOfWeek weekStartsOn)
    {
        var settings = WorkspaceSettings.Validate(
            timeZoneId,
            defaultCulture,
            defaultCurrencyCode,
            weekStartsOn);

        Name = ValidateName(name);
        TimeZoneId = settings.TimeZoneId;
        DefaultCulture = settings.DefaultCulture;
        DefaultCurrencyCode = settings.DefaultCurrencyCode;
        WeekStartsOn = settings.WeekStartsOn;
    }

    private static string ValidateName(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalized = name.Trim();
        return normalized.Length <= 200
            ? normalized
            : throw new ArgumentException("Workspace name cannot exceed 200 characters.", nameof(name));
    }

    private static string NormalizeSlug(string slug)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(slug);
        var normalized = slug.Trim().ToLowerInvariant();
        if (normalized.Length > 100 || !SlugPattern().IsMatch(normalized))
        {
            throw new ArgumentException("Workspace slug must contain lowercase letters, numbers, and single hyphens.", nameof(slug));
        }

        return normalized;
    }

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();
}

public sealed record WorkspaceSettings(
    string TimeZoneId,
    string DefaultCulture,
    string DefaultCurrencyCode,
    DayOfWeek WeekStartsOn)
{
    public static WorkspaceSettings Validate(
        string timeZoneId,
        string defaultCulture,
        string defaultCurrencyCode,
        DayOfWeek weekStartsOn)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(timeZoneId);
        ArgumentException.ThrowIfNullOrWhiteSpace(defaultCulture);
        ArgumentException.ThrowIfNullOrWhiteSpace(defaultCurrencyCode);

        var normalizedTimeZone = timeZoneId.Trim();
        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(normalizedTimeZone);
        }
        catch (TimeZoneNotFoundException exception)
        {
            throw new ArgumentException("A valid IANA time zone is required.", nameof(timeZoneId), exception);
        }
        catch (InvalidTimeZoneException exception)
        {
            throw new ArgumentException("A valid IANA time zone is required.", nameof(timeZoneId), exception);
        }

        string normalizedCulture;
        try
        {
            normalizedCulture = CultureInfo.GetCultureInfo(defaultCulture.Trim()).Name;
        }
        catch (CultureNotFoundException exception)
        {
            throw new ArgumentException("A valid culture is required.", nameof(defaultCulture), exception);
        }

        var normalizedCurrency = defaultCurrencyCode.Trim().ToUpperInvariant();
        if (normalizedCurrency.Length != 3 || normalizedCurrency.Any(character => character is < 'A' or > 'Z'))
        {
            throw new ArgumentException("Currency must be a three-letter ISO code.", nameof(defaultCurrencyCode));
        }

        if (!Enum.IsDefined(weekStartsOn))
        {
            throw new ArgumentOutOfRangeException(nameof(weekStartsOn));
        }

        return new WorkspaceSettings(
            normalizedTimeZone,
            normalizedCulture,
            normalizedCurrency,
            weekStartsOn);
    }
}

public sealed class TenantMembership : AuditableEntity
{
    private TenantMembership()
    {
    }

    private TenantMembership(Guid tenantId, Guid userId, TenantRole role)
    {
        if (tenantId == Guid.Empty || userId == Guid.Empty)
        {
            throw new ArgumentException("Tenant and user ids are required.");
        }

        TenantId = tenantId;
        UserId = userId;
        Role = role;
        Status = MembershipStatus.Active;
    }

    public Guid TenantId { get; private set; }

    public Guid UserId { get; private set; }

    public TenantRole Role { get; private set; }

    public MembershipStatus Status { get; private set; }

    public static TenantMembership Create(Guid tenantId, Guid userId, TenantRole role) =>
        new(tenantId, userId, role);
}

public enum TenantRole
{
    Owner = 1,
    Coach = 2,
    Client = 3,
}

public enum MembershipStatus
{
    Invited = 1,
    Active = 2,
    Suspended = 3,
    Removed = 4,
}
