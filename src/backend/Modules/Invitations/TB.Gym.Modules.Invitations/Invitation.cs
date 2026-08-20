using System.Net.Mail;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

public sealed class ClientInvitation : TenantEntity
{
    private ClientInvitation()
    {
    }

    private ClientInvitation(
        Guid tenantId,
        string email,
        string firstName,
        string lastName,
        string? phoneNumber,
        DateOnly? birthDate,
        string tokenHash,
        DateTimeOffset expiresAtUtc)
        : base(tenantId)
    {
        Email = email;
        NormalizedEmail = email.ToUpperInvariant();
        FirstName = firstName;
        LastName = lastName;
        PhoneNumber = phoneNumber;
        BirthDate = birthDate;
        TokenHash = tokenHash;
        ExpiresAtUtc = expiresAtUtc;
        Status = InvitationStatus.Pending;
        SendCount = 1;
    }

    public string Email { get; private set; } = string.Empty;

    public string NormalizedEmail { get; private set; } = string.Empty;

    public string FirstName { get; private set; } = string.Empty;

    public string LastName { get; private set; } = string.Empty;

    public string? PhoneNumber { get; private set; }

    public DateOnly? BirthDate { get; private set; }

    public string TokenHash { get; private set; } = string.Empty;

    public InvitationStatus Status { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public DateTimeOffset? AcceptedAtUtc { get; private set; }

    public Guid? AcceptedByUserId { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    public int SendCount { get; private set; }

    public static ClientInvitation Create(
        Guid tenantId,
        string email,
        string firstName,
        string lastName,
        string? phoneNumber,
        DateOnly? birthDate,
        string tokenHash,
        DateTimeOffset expiresAtUtc,
        DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        var normalizedEmail = email.Trim().ToLowerInvariant();
        if (!MailAddress.TryCreate(normalizedEmail, out _) || normalizedEmail.Length > 320)
        {
            throw new ArgumentException("A valid email address is required.", nameof(email));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(firstName);
        ArgumentException.ThrowIfNullOrWhiteSpace(lastName);
        var normalizedFirstName = firstName.Trim();
        var normalizedLastName = lastName.Trim();
        if (normalizedFirstName.Length > 100 || normalizedLastName.Length > 100)
        {
            throw new ArgumentException("First and last names cannot exceed 100 characters.");
        }

        ValidateTokenAndExpiry(tokenHash, expiresAtUtc, now);

        return new ClientInvitation(
            tenantId,
            normalizedEmail,
            normalizedFirstName,
            normalizedLastName,
            NormalizeOptional(phoneNumber),
            birthDate,
            tokenHash,
            expiresAtUtc);
    }

    public void RotateToken(string tokenHash, DateTimeOffset expiresAtUtc, DateTimeOffset now)
    {
        if (Status != InvitationStatus.Pending)
        {
            throw new InvalidOperationException("Only a pending invitation can be resent.");
        }

        ValidateTokenAndExpiry(tokenHash, expiresAtUtc, now);
        TokenHash = tokenHash;
        ExpiresAtUtc = expiresAtUtc;
        SendCount++;
    }

    public void MarkAccepted(Guid userId, DateTimeOffset now)
    {
        if (Status == InvitationStatus.Accepted && AcceptedByUserId == userId)
        {
            return;
        }

        if (Status != InvitationStatus.Pending || ExpiresAtUtc <= now)
        {
            throw new InvalidOperationException("The invitation is not available for acceptance.");
        }

        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A user id is required.", nameof(userId));
        }

        Status = InvitationStatus.Accepted;
        AcceptedByUserId = userId;
        AcceptedAtUtc = now;
    }

    public void Revoke(DateTimeOffset now)
    {
        if (Status == InvitationStatus.Revoked)
        {
            return;
        }

        if (Status != InvitationStatus.Pending)
        {
            throw new InvalidOperationException("Only a pending invitation can be revoked.");
        }

        Status = InvitationStatus.Revoked;
        RevokedAtUtc = now;
    }

    public bool MarkExpired(DateTimeOffset now)
    {
        if (Status != InvitationStatus.Pending || ExpiresAtUtc > now)
        {
            return false;
        }

        Status = InvitationStatus.Expired;
        return true;
    }

    private static void ValidateTokenAndExpiry(
        string tokenHash,
        DateTimeOffset expiresAtUtc,
        DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);
        if (expiresAtUtc <= now)
        {
            throw new ArgumentOutOfRangeException(nameof(expiresAtUtc), "Invitation expiry must be in the future.");
        }
    }

    private static string? NormalizeOptional(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        return normalized.Length <= 32
            ? normalized
            : throw new ArgumentException("Phone number cannot exceed 32 characters.", nameof(value));
    }
}

public sealed class InvitationDelivery : TenantEntity
{
    private InvitationDelivery()
    {
    }

    private InvitationDelivery(
        Guid tenantId,
        Guid invitationId,
        string recipient,
        int attemptNumber,
        InvitationDeliveryStatus status,
        string? providerMessageId)
        : base(tenantId)
    {
        InvitationId = invitationId;
        Recipient = recipient;
        Channel = InvitationChannel.Email;
        AttemptNumber = attemptNumber;
        Status = status;
        ProviderMessageId = providerMessageId;
    }

    public Guid InvitationId { get; private set; }

    public string Recipient { get; private set; } = string.Empty;

    public InvitationChannel Channel { get; private set; }

    public int AttemptNumber { get; private set; }

    public InvitationDeliveryStatus Status { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public string? FailureCode { get; private set; }

    public static InvitationDelivery Create(
        Guid tenantId,
        Guid invitationId,
        string recipient,
        int attemptNumber,
        InvitationDeliveryStatus status,
        string? providerMessageId = null) =>
        new(
            tenantId,
            invitationId,
            recipient.Trim().ToLowerInvariant(),
            attemptNumber,
            status,
            providerMessageId);

    public void ApplyDispatchResult(
        InvitationDeliveryStatus status,
        string? providerMessageId,
        string? failureCode = null)
    {
        Status = status;
        ProviderMessageId = providerMessageId;
        FailureCode = failureCode;
    }
}

public enum InvitationStatus
{
    Pending = 1,
    Accepted = 2,
    Revoked = 3,
    Expired = 4,
}

public enum InvitationChannel
{
    Email = 1,
}

public enum InvitationDeliveryStatus
{
    Queued = 1,
    CapturedForDevelopment = 2,
    Delivered = 3,
    Failed = 4,
}
