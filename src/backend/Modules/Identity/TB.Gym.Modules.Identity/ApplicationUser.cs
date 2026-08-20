using Microsoft.AspNetCore.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;

    public string PreferredCulture { get; set; } = "en-LB";

    public bool IsPlatformBlocked { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class AccountEmailDelivery : AuditableEntity
{
    private AccountEmailDelivery()
    {
    }

    private AccountEmailDelivery(
        Guid userId,
        string recipient,
        AccountEmailPurpose purpose,
        EmailDeliveryStatus status,
        string? providerMessageId)
    {
        UserId = userId;
        Recipient = recipient;
        Purpose = purpose;
        Status = status;
        ProviderMessageId = providerMessageId;
    }

    public Guid UserId { get; private set; }

    public string Recipient { get; private set; } = string.Empty;

    public AccountEmailPurpose Purpose { get; private set; }

    public EmailDeliveryStatus Status { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public string? FailureCode { get; private set; }

    public static AccountEmailDelivery Create(
        Guid userId,
        string recipient,
        AccountEmailPurpose purpose,
        EmailDeliveryStatus status,
        string? providerMessageId = null)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A user id is required.", nameof(userId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(recipient);
        return new AccountEmailDelivery(
            userId,
            recipient.Trim().ToLowerInvariant(),
            purpose,
            status,
            providerMessageId);
    }
}

public enum AccountEmailPurpose
{
    ConfirmEmail = 1,
    ResetPassword = 2,
}

public enum EmailDeliveryStatus
{
    Queued = 1,
    CapturedForDevelopment = 2,
    Delivered = 3,
    Failed = 4,
}

public static class SystemRoles
{
    public const string PlatformAdmin = "PlatformAdmin";
}

public sealed class IdentityModule : IModuleMarker
{
    public const string Name = "Identity";
}
