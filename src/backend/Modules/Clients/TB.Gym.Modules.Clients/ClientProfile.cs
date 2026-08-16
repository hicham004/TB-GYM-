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
        string firstName,
        string lastName,
        string email,
        DateOnly? birthDate)
        : base(tenantId)
    {
        FirstName = firstName;
        LastName = lastName;
        Email = email;
        NormalizedEmail = email.ToUpperInvariant();
        BirthDate = birthDate;
    }

    public Guid? UserId { get; private set; }

    public string FirstName { get; private set; } = string.Empty;

    public string LastName { get; private set; } = string.Empty;

    public string Email { get; private set; } = string.Empty;

    public string NormalizedEmail { get; private set; } = string.Empty;

    public string? PhoneNumber { get; private set; }

    public DateOnly? BirthDate { get; private set; }

    public bool IsCoachBlocked { get; private set; }

    public static ClientProfile Create(
        Guid tenantId,
        string firstName,
        string lastName,
        string email,
        DateOnly? birthDate)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(firstName);
        ArgumentException.ThrowIfNullOrWhiteSpace(lastName);

        var normalizedEmail = email.Trim().ToLowerInvariant();
        if (!MailAddress.TryCreate(normalizedEmail, out _))
        {
            throw new ArgumentException("A valid email address is required.", nameof(email));
        }

        return new ClientProfile(
            tenantId,
            firstName.Trim(),
            lastName.Trim(),
            normalizedEmail,
            birthDate);
    }
}
