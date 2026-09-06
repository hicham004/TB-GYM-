using System.Globalization;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class WorkspaceApplicationService(
    GymDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    IAccountActionMailScheduler accountActionMail,
    IClock clock,
    ITenantContext tenantContext)
    : IWorkspaceApplicationService
{
    public async Task<WorkspaceRegistrationResult> RegisterCoachAsync(
        RegisterCoachRequest request,
        CancellationToken cancellationToken)
    {
        var validationErrors = ValidateRegistration(request);
        if (validationErrors.Count > 0)
        {
            return new WorkspaceRegistrationResult(
                WorkspaceRegistrationStatus.Invalid,
                request.Email,
                Errors: validationErrors);
        }

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        if (await userManager.FindByEmailAsync(normalizedEmail) is not null)
        {
            return new WorkspaceRegistrationResult(
                WorkspaceRegistrationStatus.EmailAlreadyRegistered,
                normalizedEmail);
        }

        Tenant tenant;
        try
        {
            tenant = Tenant.Create(
                request.WorkspaceName,
                CreateSlug(request.WorkspaceName),
                request.TimeZoneId,
                request.DefaultCulture,
                request.DefaultCurrencyCode,
                request.WeekStartsOn);
        }
        catch (ArgumentException exception)
        {
            return InvalidRegistration(normalizedEmail, exception.Message);
        }

        var now = clock.UtcNow;
        var user = new ApplicationUser
        {
            Id = Guid.CreateVersion7(),
            UserName = normalizedEmail,
            Email = normalizedEmail,
            EmailConfirmed = false,
            DisplayName = request.DisplayName.Trim(),
            PreferredCulture = tenant.DefaultCulture,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };

        var strategy = dbContext.Database.CreateExecutionStrategy();
        var identityResult = await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var createUserResult = await userManager.CreateAsync(user, request.Password);
            if (!createUserResult.Succeeded)
            {
                return createUserResult;
            }

            dbContext.Tenants.Add(tenant);
            dbContext.TenantMemberships.Add(
                TenantMembership.Create(tenant.Id, user.Id, TenantRole.Owner));
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return IdentityResult.Success;
        });

        if (!identityResult.Succeeded)
        {
            var duplicateEmail = identityResult.Errors.Any(error =>
                error.Code.Contains("DuplicateEmail", StringComparison.OrdinalIgnoreCase) ||
                error.Code.Contains("DuplicateUserName", StringComparison.OrdinalIgnoreCase));
            return duplicateEmail
                ? new WorkspaceRegistrationResult(
                    WorkspaceRegistrationStatus.EmailAlreadyRegistered,
                    normalizedEmail)
                : new WorkspaceRegistrationResult(
                    WorkspaceRegistrationStatus.Invalid,
                    normalizedEmail,
                    Errors: new Dictionary<string, string[]>
                    {
                        ["identity"] = identityResult.Errors.Select(error => error.Description).ToArray(),
                    });
        }

        // No token is minted here. Registration records a durable request for a confirmation email and
        // returns; the dispatcher mints the token, builds the link from the configured origin and
        // sends it. Outside Production the captured adapter materializes it inline, which is where the
        // development confirmation link comes from — the caller supplied this address, so handing them
        // back a link for it discloses nothing they did not already know.
        var dispatch = await accountActionMail.RequestAsync(
            new AccountActionMailCommand(
                user.Id,
                AccountActionKind.ConfirmEmail,
                AccountActionMailSources.CoachRegistration,
                user.Id),
            cancellationToken);

        return new WorkspaceRegistrationResult(
            WorkspaceRegistrationStatus.Created,
            normalizedEmail,
            dispatch.DevelopmentActionUrl);
    }

    public async Task<WorkspaceDetails?> GetCurrentAsync(CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return null;
        }

        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == tenantContext.TenantId && item.IsActive,
                cancellationToken);
        return tenant is null ? null : ToDetails(tenant);
    }

    public async Task<WorkspaceUpdateResult> UpdateCurrentAsync(
        UpdateWorkspaceRequest request,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return new WorkspaceUpdateResult(WorkspaceUpdateStatus.NotFound);
        }

        var tenant = await dbContext.Tenants.SingleOrDefaultAsync(
            item => item.Id == tenantContext.TenantId && item.IsActive,
            cancellationToken);
        if (tenant is null)
        {
            return new WorkspaceUpdateResult(WorkspaceUpdateStatus.NotFound);
        }

        try
        {
            dbContext.Entry(tenant).Property(item => item.Version).OriginalValue = request.Version;
            tenant.UpdateSettings(
                request.Name,
                request.TimeZoneId,
                request.DefaultCulture,
                request.DefaultCurrencyCode,
                request.WeekStartsOn);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new WorkspaceUpdateResult(WorkspaceUpdateStatus.Updated, ToDetails(tenant));
        }
        catch (ArgumentException exception)
        {
            return new WorkspaceUpdateResult(
                WorkspaceUpdateStatus.Invalid,
                Errors: new Dictionary<string, string[]> { ["workspace"] = [exception.Message] });
        }
        catch (DbUpdateConcurrencyException)
        {
            return new WorkspaceUpdateResult(WorkspaceUpdateStatus.Conflict);
        }
    }

    private static Dictionary<string, string[]> ValidateRegistration(RegisterCoachRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 200)
        {
            errors["displayName"] = ["Display name is required and cannot exceed 200 characters."];
        }

        var email = string.IsNullOrWhiteSpace(request.Email)
            ? string.Empty
            : request.Email.Trim().ToLowerInvariant();
        if (!MailAddress.TryCreate(email, out _) || email.Length > 320)
        {
            errors["email"] = ["A valid email address is required."];
        }

        if (string.IsNullOrWhiteSpace(request.WorkspaceName) || request.WorkspaceName.Trim().Length > 200)
        {
            errors["workspaceName"] = ["Workspace name is required and cannot exceed 200 characters."];
        }

        return errors;
    }

    private static WorkspaceRegistrationResult InvalidRegistration(string email, string message) =>
        new(
            WorkspaceRegistrationStatus.Invalid,
            email,
            Errors: new Dictionary<string, string[]> { ["workspace"] = [message] });

    private static string CreateSlug(string workspaceName)
    {
        var decomposed = workspaceName.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        var previousHyphen = false;
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (character is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(character);
                previousHyphen = false;
            }
            else if (!previousHyphen && builder.Length > 0)
            {
                builder.Append('-');
                previousHyphen = true;
            }
        }

        var slugBase = builder.ToString().Trim('-');
        if (string.IsNullOrEmpty(slugBase))
        {
            slugBase = "workspace";
        }

        if (slugBase.Length > 80)
        {
            slugBase = slugBase[..80].TrimEnd('-');
        }

        var suffix = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
        return $"{slugBase}-{suffix}";
    }

    private WorkspaceDetails ToDetails(Tenant tenant) =>
        new(
            tenant.Id,
            tenant.Name,
            tenant.Slug,
            tenant.TimeZoneId,
            tenant.DefaultCulture,
            tenant.DefaultCurrencyCode,
            tenant.WeekStartsOn,
            // The workspace-local date, resolved from IClock through the workspace's own zone, so a
            // browser never has to work out what "today" means here.
            WorkspaceLocalDate(tenant),
            tenant.Version);

    private DateOnly WorkspaceLocalDate(Tenant tenant) =>
        DateOnly.FromDateTime(
            TimeZoneInfo
                .ConvertTime(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(tenant.TimeZoneId))
                .DateTime);
}
