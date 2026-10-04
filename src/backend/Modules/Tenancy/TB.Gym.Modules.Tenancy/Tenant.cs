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

    /// <summary>The coach's brand colour (GAM-005), lower-case <c>#rrggbb</c>; null keeps TB Gym's.</summary>
    public string? BrandColor { get; private set; }

    /// <summary>The coach's accent colour, set and cleared together with <see cref="BrandColor"/>.</summary>
    public string? AccentColor { get; private set; }

    /// <summary>The workspace logo, a media asset of this workspace with the logo purpose (MED-013).</summary>
    public Guid? LogoMediaAssetId { get; private set; }

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

    /// <summary>
    /// Sets the coach's brand (GAM-005). Both colours or neither: a lone accent has no brand to sit
    /// on, and clearing both returns the workspace to TB Gym's colours. Only the stored values are
    /// checked here; the readable tones are derived from them where they are drawn.
    /// </summary>
    public void SetBrand(string? brandColor, string? accentColor, Guid? logoMediaAssetId)
    {
        var colors = WorkspaceBrand.Validate(brandColor, accentColor);
        if (logoMediaAssetId == Guid.Empty)
        {
            throw new ArgumentException("A logo must name a media asset.", nameof(logoMediaAssetId));
        }

        BrandColor = colors?.BrandColor;
        AccentColor = colors?.AccentColor;
        LogoMediaAssetId = logoMediaAssetId;
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

/// <summary>A workspace's two brand colours, each lower-case <c>#rrggbb</c> (GAM-005).</summary>
public sealed partial record WorkspaceBrand(string BrandColor, string AccentColor)
{
    /// <summary>
    /// Null when both are blank, the two normalised colours when both are given, and an error when
    /// only one is, or either is not a six-digit hex colour. No names, alpha or CSS functions: the
    /// value is written into style properties, so only this one shape is ever stored.
    /// </summary>
    public static WorkspaceBrand? Validate(string? brandColor, string? accentColor)
    {
        var brand = string.IsNullOrWhiteSpace(brandColor) ? null : brandColor.Trim().ToLowerInvariant();
        var accent = string.IsNullOrWhiteSpace(accentColor) ? null : accentColor.Trim().ToLowerInvariant();
        if (brand is null && accent is null)
        {
            return null;
        }

        if (brand is null || accent is null)
        {
            throw new ArgumentException("A brand needs both its brand colour and its accent colour.");
        }

        if (!HexColor().IsMatch(brand) || !HexColor().IsMatch(accent))
        {
            throw new ArgumentException("Brand colours must be six-digit hex colours such as #153d33.");
        }

        return new WorkspaceBrand(brand, accent);
    }

    [GeneratedRegex("^#[0-9a-f]{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex HexColor();
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

    /// <summary>Whether this member may coach clients here: an active Owner or Coach.</summary>
    public bool IsActiveStaff =>
        Status == MembershipStatus.Active && Role is TenantRole.Owner or TenantRole.Coach;

    /// <summary>
    /// The owner removes a coach from the workspace. The row is kept so the coach's authored work and
    /// the assignment history still name a real member; access ends because it is no longer Active.
    /// </summary>
    public void RemoveCoach()
    {
        if (Role != TenantRole.Coach)
        {
            throw new InvalidOperationException("Only a coach membership can be removed from the team.");
        }

        if (Status != MembershipStatus.Active)
        {
            throw new InvalidOperationException("Only an active coach can be removed.");
        }

        Status = MembershipStatus.Removed;
    }

    /// <summary>
    /// The owner released this client from the workspace. The row is kept, like a removed coach's,
    /// and a database trigger refuses ever making it active again.
    /// </summary>
    public void ReleaseClient()
    {
        if (Role != TenantRole.Client || Status != MembershipStatus.Active)
        {
            throw new InvalidOperationException("Only an active client membership can be released.");
        }

        Status = MembershipStatus.Removed;
    }

    /// <summary>
    /// A former client accepted a new client invitation to the same workspace (ADR 0027). The
    /// membership row is reused, because a person has one per workspace; the relationship is new,
    /// with a new client profile, and the old profile stays read-only.
    /// </summary>
    public void RejoinAsClient()
    {
        if (Role != TenantRole.Client || Status != MembershipStatus.Removed)
        {
            throw new InvalidOperationException("Only a former client can rejoin as a client.");
        }

        Status = MembershipStatus.Active;
    }

    /// <summary>A removed coach accepted a new coach invitation to the same workspace.</summary>
    public void RejoinAsCoach()
    {
        if (Role != TenantRole.Coach || Status != MembershipStatus.Removed)
        {
            throw new InvalidOperationException("Only a removed coach can rejoin the team.");
        }

        Status = MembershipStatus.Active;
    }
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
