using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class InvitationApplicationService(
    GymDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    IInvitationDelivery invitationDelivery,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IMutableTenantContext mutableTenantContext)
    : IInvitationApplicationService
{
    private static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    public async Task<IReadOnlyList<InvitationSummary>> ListAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var invitations = await dbContext.ClientInvitations
            .OrderByDescending(invitation => invitation.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        if (invitations.Aggregate(false, (changed, invitation) => invitation.MarkExpired(now) || changed))
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return invitations.Select(invitation => ToSummary(invitation)).ToArray();
    }

    public async Task<InvitationCommandResult> CreateAsync(
        CreateClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        var tenant = await dbContext.Tenants.SingleOrDefaultAsync(
            item => item.Id == tenantContext.TenantId && item.IsActive,
            cancellationToken);
        if (tenant is null)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        var now = clock.UtcNow;
        var tenantToday = GetTenantDate(now, tenant.TimeZoneId);
        if (request.BirthDate is { } birthDate &&
            (birthDate.AddYears(18) > tenantToday || birthDate < tenantToday.AddYears(-120)))
        {
            return Invalid(
                "birthDate",
                "Client birth date must represent an adult between 18 and 120 years old.");
        }

        var token = CreateToken();
        ClientInvitation invitation;
        try
        {
            invitation = ClientInvitation.Create(
                tenant.Id,
                request.Email,
                request.FirstName,
                request.LastName,
                request.PhoneNumber,
                request.BirthDate,
                HashToken(token),
                now.Add(InvitationLifetime),
                now);
        }
        catch (ArgumentException exception)
        {
            return Invalid("invitation", exception.Message);
        }

        var existingRelationship = await dbContext.ClientProfiles.AnyAsync(
            client => client.NormalizedEmail == invitation.NormalizedEmail,
            cancellationToken);
        var existingUser = await userManager.FindByEmailAsync(invitation.Email);
        if (existingUser is not null)
        {
            existingRelationship |= await dbContext.TenantMemberships.AnyAsync(
                membership => membership.TenantId == tenant.Id && membership.UserId == existingUser.Id,
                cancellationToken);
        }

        if (existingRelationship)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var pending = await dbContext.ClientInvitations.SingleOrDefaultAsync(
            item => item.NormalizedEmail == invitation.NormalizedEmail && item.Status == InvitationStatus.Pending,
            cancellationToken);
        if (pending is not null)
        {
            if (!pending.MarkExpired(now))
            {
                return new InvitationCommandResult(InvitationCommandStatus.Conflict);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var deliveryRecord = InvitationDelivery.Create(
            tenant.Id,
            invitation.Id,
            invitation.Email,
            invitation.SendCount,
            InvitationDeliveryStatus.Queued);
        dbContext.ClientInvitations.Add(invitation);
        dbContext.InvitationDeliveries.Add(deliveryRecord);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var dispatch = await invitationDelivery.SendAsync(
            new InvitationDeliveryRequest(
                invitation.Id,
                tenant.Id,
                tenant.Name,
                invitation.Email,
                token,
                invitation.SendCount),
            cancellationToken);
        deliveryRecord.ApplyDispatchResult(dispatch.Status, dispatch.ProviderMessageId);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new InvitationCommandResult(
            InvitationCommandStatus.Success,
            ToSummary(invitation, dispatch.DevelopmentActionUrl));
    }

    public async Task<InvitationCommandResult> ResendAsync(
        Guid invitationId,
        CancellationToken cancellationToken)
    {
        var invitation = await dbContext.ClientInvitations.SingleOrDefaultAsync(
            item => item.Id == invitationId,
            cancellationToken);
        if (invitation is null)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        var tenant = await dbContext.Tenants.SingleAsync(
            item => item.Id == invitation.TenantId,
            cancellationToken);
        var now = clock.UtcNow;
        var token = CreateToken();
        try
        {
            invitation.RotateToken(HashToken(token), now.Add(InvitationLifetime), now);
        }
        catch (InvalidOperationException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var deliveryRecord = InvitationDelivery.Create(
            invitation.TenantId,
            invitation.Id,
            invitation.Email,
            invitation.SendCount,
            InvitationDeliveryStatus.Queued);
        dbContext.InvitationDeliveries.Add(deliveryRecord);

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var dispatch = await invitationDelivery.SendAsync(
            new InvitationDeliveryRequest(
                invitation.Id,
                invitation.TenantId,
                tenant.Name,
                invitation.Email,
                token,
                invitation.SendCount),
            cancellationToken);
        deliveryRecord.ApplyDispatchResult(dispatch.Status, dispatch.ProviderMessageId);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new InvitationCommandResult(
            InvitationCommandStatus.Success,
            ToSummary(invitation, dispatch.DevelopmentActionUrl));
    }

    public async Task<InvitationCommandResult> RevokeAsync(
        Guid invitationId,
        CancellationToken cancellationToken)
    {
        var invitation = await dbContext.ClientInvitations.SingleOrDefaultAsync(
            item => item.Id == invitationId,
            cancellationToken);
        if (invitation is null)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        try
        {
            invitation.Revoke(clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new InvitationCommandResult(InvitationCommandStatus.Success, ToSummary(invitation));
        }
        catch (InvalidOperationException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }
        catch (DbUpdateConcurrencyException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }
    }

    public async Task<PublicInvitationDetails?> GetPublicAsync(
        string token,
        CancellationToken cancellationToken)
    {
        var tokenHash = TryHashToken(token);
        if (tokenHash is null)
        {
            return null;
        }

        var invitation = await dbContext.ClientInvitations
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
        if (invitation is null)
        {
            return null;
        }

        mutableTenantContext.SetTenant(invitation.TenantId);
        if (invitation.MarkExpired(clock.UtcNow))
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .SingleAsync(item => item.Id == invitation.TenantId, cancellationToken);
        var existingUser = await userManager.FindByEmailAsync(invitation.Email);
        return new PublicInvitationDetails(
            tenant.Name,
            invitation.Email,
            invitation.FirstName,
            invitation.LastName,
            invitation.Status,
            invitation.ExpiresAtUtc,
            existingUser is not null && currentUser.UserId != existingUser.Id);
    }

    public async Task<InvitationAcceptanceResult> AcceptAsync(
        AcceptClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        var tokenHash = TryHashToken(request.Token);
        if (tokenHash is null)
        {
            return new InvitationAcceptanceResult(InvitationAcceptanceStatus.InvalidOrExpired);
        }

        try
        {
            var outcome = await AcceptCoreAsync(tokenHash, request, cancellationToken);
            if (outcome.UserToSignIn is not null)
            {
                await signInManager.SignInAsync(outcome.UserToSignIn, isPersistent: false);
                return outcome.Result with { SignedIn = true };
            }

            return outcome.Result;
        }
        catch (DbUpdateConcurrencyException)
        {
            dbContext.ChangeTracker.Clear();
            return await ResolveAcceptedAsync(tokenHash, cancellationToken)
                ?? new InvitationAcceptanceResult(InvitationAcceptanceStatus.Conflict);
        }
        catch (DbUpdateException)
        {
            return new InvitationAcceptanceResult(InvitationAcceptanceStatus.Conflict);
        }
    }

    private async Task<AcceptanceOutcome> AcceptCoreAsync(
        string tokenHash,
        AcceptClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var invitation = await dbContext.ClientInvitations
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
            if (invitation is null)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.InvalidOrExpired);
            }

            mutableTenantContext.SetTenant(invitation.TenantId);
            var now = clock.UtcNow;
            if (invitation.Status == InvitationStatus.Revoked)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.Revoked);
            }

            if (invitation.Status == InvitationStatus.Accepted)
            {
                var accepted = await ResolveAcceptedAsync(tokenHash, cancellationToken);
                return new AcceptanceOutcome(
                    accepted ?? new InvitationAcceptanceResult(InvitationAcceptanceStatus.Conflict),
                    null);
            }

            if (invitation.MarkExpired(now) || invitation.Status == InvitationStatus.Expired)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.InvalidOrExpired);
            }

            var existingAccount = await userManager.FindByEmailAsync(invitation.Email);
            ApplicationUser user;
            var createdUser = false;
            if (currentUser.UserId is { } currentUserId)
            {
                user = await userManager.FindByIdAsync(currentUserId.ToString())
                    ?? throw new InvalidOperationException("The authenticated user no longer exists.");
                if (!string.Equals(user.NormalizedEmail, invitation.NormalizedEmail, StringComparison.Ordinal))
                {
                    return AcceptanceOutcome.From(InvitationAcceptanceStatus.WrongSignedInAccount);
                }
            }
            else if (existingAccount is not null)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.ExistingAccountSignInRequired);
            }
            else
            {
                if (string.IsNullOrWhiteSpace(request.Password))
                {
                    return new AcceptanceOutcome(
                        new InvitationAcceptanceResult(
                            InvitationAcceptanceStatus.Invalid,
                            Errors: new Dictionary<string, string[]>
                            {
                                ["password"] = ["A password is required for a new account."],
                            }),
                        null);
                }

                var tenant = await dbContext.Tenants.AsNoTracking().SingleAsync(
                    item => item.Id == invitation.TenantId,
                    cancellationToken);
                user = new ApplicationUser
                {
                    Id = Guid.CreateVersion7(),
                    UserName = invitation.Email,
                    Email = invitation.Email,
                    EmailConfirmed = true,
                    DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                        ? $"{invitation.FirstName} {invitation.LastName}"
                        : request.DisplayName.Trim(),
                    PreferredCulture = tenant.DefaultCulture,
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                };
                var identityResult = await userManager.CreateAsync(user, request.Password);
                if (!identityResult.Succeeded)
                {
                    return new AcceptanceOutcome(
                        new InvitationAcceptanceResult(
                            InvitationAcceptanceStatus.Invalid,
                            Errors: new Dictionary<string, string[]>
                            {
                                ["identity"] = identityResult.Errors.Select(error => error.Description).ToArray(),
                            }),
                        null);
                }

                createdUser = true;
            }

            var relationshipExists = await dbContext.TenantMemberships.AnyAsync(
                membership => membership.TenantId == invitation.TenantId && membership.UserId == user.Id,
                cancellationToken) ||
                await dbContext.ClientProfiles.AnyAsync(
                    profile => profile.UserId == user.Id || profile.NormalizedEmail == invitation.NormalizedEmail,
                    cancellationToken);
            if (relationshipExists)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.Conflict);
            }

            var profile = ClientProfile.CreateForAcceptedInvitation(
                invitation.TenantId,
                user.Id,
                invitation.FirstName,
                invitation.LastName,
                invitation.Email,
                invitation.PhoneNumber,
                invitation.BirthDate);
            dbContext.TenantMemberships.Add(
                TenantMembership.Create(invitation.TenantId, user.Id, TenantRole.Client));
            dbContext.ClientProfiles.Add(profile);
            dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                invitation.TenantId,
                profile.Id,
                ClientChangeSource.InvitationAcceptance,
                [nameof(ClientProfile.UserId), nameof(ClientProfile.Email)]));
            invitation.MarkAccepted(user.Id, now);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return new AcceptanceOutcome(
                new InvitationAcceptanceResult(
                    InvitationAcceptanceStatus.Accepted,
                    invitation.TenantId,
                    profile.Id,
                    SignedIn: currentUser.UserId == user.Id),
                createdUser ? user : null);
        });
    }

    private async Task<InvitationAcceptanceResult?> ResolveAcceptedAsync(
        string tokenHash,
        CancellationToken cancellationToken)
    {
        var accepted = await dbContext.ClientInvitations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invitation =>
                invitation.TokenHash == tokenHash &&
                invitation.Status == InvitationStatus.Accepted &&
                invitation.AcceptedByUserId != null)
            .Select(invitation => new
            {
                invitation.TenantId,
                UserId = invitation.AcceptedByUserId!.Value,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (accepted is null)
        {
            return null;
        }

        mutableTenantContext.SetTenant(accepted.TenantId);
        var profileId = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(profile => profile.UserId == accepted.UserId)
            .Select(profile => (Guid?)profile.Id)
            .SingleOrDefaultAsync(cancellationToken);
        return profileId is null
            ? null
            : new InvitationAcceptanceResult(
                InvitationAcceptanceStatus.Accepted,
                accepted.TenantId,
                profileId,
                SignedIn: currentUser.UserId == accepted.UserId);
    }

    private static InvitationCommandResult Invalid(string field, string message) =>
        new(
            InvitationCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static InvitationSummary ToSummary(
        ClientInvitation invitation,
        string? developmentActionUrl = null) =>
        new(
            invitation.Id,
            invitation.Email,
            invitation.FirstName,
            invitation.LastName,
            invitation.Status,
            invitation.ExpiresAtUtc,
            invitation.SendCount,
            invitation.CreatedAtUtc,
            developmentActionUrl);

    private static DateOnly GetTenantDate(DateTimeOffset now, string timeZoneId) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)).DateTime);

    private static string CreateToken() =>
        WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    private static string? TryHashToken(string token) =>
        string.IsNullOrWhiteSpace(token) || token.Length > 512 ? null : HashToken(token);

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private sealed record AcceptanceOutcome(
        InvitationAcceptanceResult Result,
        ApplicationUser? UserToSignIn)
    {
        public static AcceptanceOutcome From(InvitationAcceptanceStatus status) =>
            new(new InvitationAcceptanceResult(status), null);
    }
}
