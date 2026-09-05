using System.Net.Mail;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

/// <summary>
/// One tenant-scoped, expiring, revocable invitation for one person to join one workspace.
/// </summary>
/// <remarks>
/// The invitation holds no token and no token hash. What it holds is the <b>logical send
/// generation</b>: which round of "we asked this person to join" is currently valid. Every token ever
/// minted for it lives in <see cref="InvitationTokenIssue"/>, append-only, tagged with the generation
/// it belongs to.
/// <para>
/// That separation exists because a deliberate resend and a transport retry are different facts, and
/// ADR 0002's "resending rotates the token" was written before there was a dispatcher that could retry
/// on its own. A person pressing <i>Resend</i> means "the old link should stop working"; a dispatcher
/// retrying six hours later means "the first attempt may have reached them and we do not know". So a
/// resend increments this generation and revokes every hash of the previous ones, and a transport
/// retry mints against the <i>same</i> generation and appends — which leaves a link that is already
/// sitting in somebody's mailbox working, however many times the dispatcher tries.
/// </para>
/// </remarks>
public sealed class ClientInvitation : TenantEntity
{
    /// <summary>The generation every invitation starts at.</summary>
    public const int FirstLogicalSendGeneration = 1;

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
        DateTimeOffset expiresAtUtc)
        : base(tenantId)
    {
        Email = email;
        NormalizedEmail = email.ToUpperInvariant();
        FirstName = firstName;
        LastName = lastName;
        PhoneNumber = phoneNumber;
        BirthDate = birthDate;
        ExpiresAtUtc = expiresAtUtc;
        Status = InvitationStatus.Pending;
        SendCount = 1;
        LogicalSendGeneration = FirstLogicalSendGeneration;
    }

    public string Email { get; private set; } = string.Empty;

    public string NormalizedEmail { get; private set; } = string.Empty;

    public string FirstName { get; private set; } = string.Empty;

    public string LastName { get; private set; } = string.Empty;

    public string? PhoneNumber { get; private set; }

    public DateOnly? BirthDate { get; private set; }

    public InvitationStatus Status { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public DateTimeOffset? AcceptedAtUtc { get; private set; }

    public Guid? AcceptedByUserId { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    /// <summary>How many deliberate sends this invitation has had. Never incremented by a retry.</summary>
    public int SendCount { get; private set; }

    /// <summary>
    /// Which round of sending is currently valid. Only tokens issued for this generation may be
    /// redeemed; every earlier generation's tokens are revoked when this one is created.
    /// </summary>
    /// <remarks>
    /// Moves by exactly one, only forward, and only through <see cref="BeginNewLogicalSend"/>. A
    /// database trigger enforces the same rule, because a skipped or repeated generation would either
    /// orphan tokens that are still in mailboxes or resurrect ones a coach deliberately killed.
    /// </remarks>
    public int LogicalSendGeneration { get; private set; }

    public static ClientInvitation Create(
        Guid tenantId,
        string email,
        string firstName,
        string lastName,
        string? phoneNumber,
        DateOnly? birthDate,
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

        ValidateExpiry(expiresAtUtc, now);

        return new ClientInvitation(
            tenantId,
            normalizedEmail,
            normalizedFirstName,
            normalizedLastName,
            NormalizeOptional(phoneNumber),
            birthDate,
            expiresAtUtc);
    }

    /// <summary>
    /// A person deliberately resent this invitation.
    /// </summary>
    /// <remarks>
    /// Increments the generation, which is what revokes every token issued under the previous ones,
    /// and recalculates expiry from now rather than extending the old window silently. It does
    /// <b>not</b> mint anything: minting happens at materialization, once, per attempt, and the raw
    /// token never comes back here.
    /// </remarks>
    public int BeginNewLogicalSend(DateTimeOffset expiresAtUtc, DateTimeOffset now)
    {
        if (Status != InvitationStatus.Pending)
        {
            throw new InvalidOperationException("Only a pending invitation can be resent.");
        }

        if (ExpiresAtUtc <= now)
        {
            throw new InvalidOperationException("An expired invitation cannot be resent.");
        }

        ValidateExpiry(expiresAtUtc, now);
        SendCount++;
        LogicalSendGeneration++;
        ExpiresAtUtc = expiresAtUtc;
        return LogicalSendGeneration;
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

    /// <summary>Whether a token may still be minted and mailed for this invitation right now.</summary>
    public bool IsMailable(DateTimeOffset now) =>
        Status == InvitationStatus.Pending && ExpiresAtUtc > now;

    private static void ValidateExpiry(DateTimeOffset expiresAtUtc, DateTimeOffset now)
    {
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

/// <summary>
/// One high-entropy invitation token that was minted, recorded as a one-way hash.
/// </summary>
/// <remarks>
/// Append-only evidence. A row is written — and committed — <b>before</b> the provider is invoked, so a
/// link a provider accepted can never become invalid merely because the process lost the later commit
/// acknowledgement. That ordering is the whole point: the failure mode it removes is a recipient
/// holding a link this system has no record of and therefore refuses.
/// <para>
/// The raw token exists only in memory during materialization. What is durable is
/// <see cref="TokenHash"/>, which cannot be presented as a credential, plus the facts that explain it:
/// which invitation, which workspace, which logical-send generation, which materialization attempt
/// issued it, when it was issued and when it expires.
/// </para>
/// <para>
/// Two later facts may each be written exactly once — revocation and redemption — and nothing else
/// about a row may ever change. A database trigger enforces that; the application-level guard catches
/// the mistake in the code path that made it.
/// </para>
/// </remarks>
public sealed class InvitationTokenIssue : TenantEntity
{
    private InvitationTokenIssue()
    {
    }

    private InvitationTokenIssue(
        Guid tenantId,
        Guid invitationId,
        int logicalSendGeneration,
        Guid actionMailRequestId,
        Guid actionMailAttemptId,
        int attemptNumber,
        string tokenHash,
        DateTimeOffset issuedAtUtc,
        DateTimeOffset expiresAtUtc)
        : base(tenantId)
    {
        if (invitationId == Guid.Empty || actionMailRequestId == Guid.Empty || actionMailAttemptId == Guid.Empty)
        {
            throw new ArgumentException("An issued token names its invitation, request, and attempt.");
        }

        if (logicalSendGeneration < ClientInvitation.FirstLogicalSendGeneration)
        {
            throw new ArgumentOutOfRangeException(
                nameof(logicalSendGeneration),
                "Logical send generations start at 1.");
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        if (!InvitationTokenHash.IsValid(tokenHash))
        {
            throw new ArgumentException("A token hash is 64 lowercase hexadecimal characters.", nameof(tokenHash));
        }

        if (expiresAtUtc <= issuedAtUtc)
        {
            throw new ArgumentOutOfRangeException(nameof(expiresAtUtc), "A token must expire after it is issued.");
        }

        InvitationId = invitationId;
        LogicalSendGeneration = logicalSendGeneration;
        ActionMailRequestId = actionMailRequestId;
        ActionMailAttemptId = actionMailAttemptId;
        AttemptNumber = attemptNumber;
        TokenHash = tokenHash;
        IssuedAtUtc = issuedAtUtc;
        ExpiresAtUtc = expiresAtUtc;
    }

    public Guid InvitationId { get; private set; }

    public int LogicalSendGeneration { get; private set; }

    /// <summary>The durable action-mail request this token was minted for.</summary>
    public Guid ActionMailRequestId { get; private set; }

    /// <summary>The started materialization attempt that minted it. A token has no other origin.</summary>
    public Guid ActionMailAttemptId { get; private set; }

    public int AttemptNumber { get; private set; }

    /// <summary>SHA-256 of the raw token, lowercase hex. Not usable as a credential.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset IssuedAtUtc { get; private set; }

    public DateTimeOffset ExpiresAtUtc { get; private set; }

    public DateTimeOffset? RevokedAtUtc { get; private set; }

    /// <summary>A stable code naming why. Never free text and never an address.</summary>
    public string? RevocationReason { get; private set; }

    public DateTimeOffset? RedeemedAtUtc { get; private set; }

    public Guid? RedeemedByUserId { get; private set; }

    public static InvitationTokenIssue Issue(
        Guid tenantId,
        Guid invitationId,
        int logicalSendGeneration,
        Guid actionMailRequestId,
        Guid actionMailAttemptId,
        int attemptNumber,
        string tokenHash,
        DateTimeOffset issuedAtUtc,
        DateTimeOffset expiresAtUtc) =>
        new(
            tenantId,
            invitationId,
            logicalSendGeneration,
            actionMailRequestId,
            actionMailAttemptId,
            attemptNumber,
            tokenHash,
            issuedAtUtc,
            expiresAtUtc);

    /// <summary>Whether this token may still be redeemed at <paramref name="now"/>.</summary>
    public bool IsRedeemable(int currentGeneration, DateTimeOffset now) =>
        LogicalSendGeneration == currentGeneration &&
        RevokedAtUtc is null &&
        RedeemedAtUtc is null &&
        ExpiresAtUtc > now;

    /// <summary>
    /// Kills this token. Write-once: revoking an already revoked token is a no-op rather than a
    /// rewrite, and a redeemed one cannot be revoked afterwards to erase that it was used.
    /// </summary>
    public bool Revoke(DateTimeOffset now, string reasonCode)
    {
        if (RevokedAtUtc is not null || RedeemedAtUtc is not null)
        {
            return false;
        }

        RevokedAtUtc = now;
        RevocationReason = Normalize(reasonCode, 100, nameof(reasonCode));
        return true;
    }

    /// <summary>Records the single use this token gets.</summary>
    public void Redeem(Guid userId, DateTimeOffset now)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A redeeming user id is required.", nameof(userId));
        }

        if (RedeemedAtUtc is not null)
        {
            throw new InvalidOperationException("An invitation token is single-use.");
        }

        if (RevokedAtUtc is not null)
        {
            throw new InvalidOperationException("A revoked invitation token cannot be redeemed.");
        }

        RedeemedAtUtc = now;
        RedeemedByUserId = userId;
    }

    private static string Normalize(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }
}

public enum InvitationStatus
{
    Pending = 1,
    Accepted = 2,
    Revoked = 3,
    Expired = 4,
}
