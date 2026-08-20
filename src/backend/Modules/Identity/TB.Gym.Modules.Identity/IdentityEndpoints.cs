using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

public static class IdentityEndpoints
{
    public static IEndpointRouteBuilder MapIdentityModule(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth").WithTags(IdentityModule.Name);

        group.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery) =>
        {
            var tokens = antiforgery.GetAndStoreTokens(context);
            return Results.Ok(new CsrfResponse(tokens.RequestToken ?? string.Empty));
        })
        .AllowAnonymous()
        .WithName("GetCsrfToken")
        .Produces<CsrfResponse>();

        group.MapPost("/login", LoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
            .WithName("Login")
            .Produces<CurrentUserResponse>()
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden);
        group.MapPost("/logout", LogoutAsync)
            .RequireAuthorization()
            .WithName("Logout")
            .Produces(StatusCodes.Status204NoContent);
        group.MapGet("/me", MeAsync)
            .RequireAuthorization()
            .WithName("GetCurrentUser")
            .Produces<CurrentUserResponse>()
            .Produces(StatusCodes.Status401Unauthorized);
        group.MapPost("/confirm-email", ConfirmEmailAsync)
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
            .WithName("ConfirmEmail")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        group.MapPost("/forgot-password", ForgotPasswordAsync)
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
            .WithName("ForgotPassword")
            .Produces<EmailActionResponse>(StatusCodes.Status202Accepted);
        group.MapPost("/reset-password", ResetPasswordAsync)
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
            .WithName("ResetPassword")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem();
        group.MapPost("/change-password", ChangePasswordAsync)
            .RequireAuthorization()
            .WithName("ChangePassword")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem();
        group.MapPost("/sessions/revoke-all", RevokeAllSessionsAsync)
            .RequireAuthorization()
            .WithName("RevokeAllSessions")
            .Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        await antiforgery.ValidateRequestAsync(context);

        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        {
            return AuthenticationFailed();
        }

        var email = request.Email.Trim().ToLowerInvariant();
        var user = await userManager.FindByEmailAsync(email);
        if (user is null || user.IsPlatformBlocked)
        {
            return AuthenticationFailed();
        }

        var result = await signInManager.PasswordSignInAsync(
            user,
            request.Password,
            request.RememberMe,
            lockoutOnFailure: true);

        if (result.IsNotAllowed && !user.EmailConfirmed)
        {
            return Results.Json(
                new { code = "email_not_confirmed", message = "Confirm your email before signing in." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        if (!result.Succeeded)
        {
            return AuthenticationFailed();
        }

        return Results.Ok(await ToResponseAsync(user, userManager));
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        SignInManager<ApplicationUser> signInManager)
    {
        await antiforgery.ValidateRequestAsync(context);
        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> MeAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager)
    {
        var user = await userManager.GetUserAsync(principal);
        return user is null || user.IsPlatformBlocked
            ? Results.Unauthorized()
            : Results.Ok(await ToResponseAsync(user, userManager));
    }

    private static async Task<IResult> ConfirmEmailAsync(
        ConfirmEmailRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<ApplicationUser> userManager)
    {
        await antiforgery.ValidateRequestAsync(context);
        var user = await userManager.FindByIdAsync(request.UserId.ToString());
        if (user is null)
        {
            return InvalidToken();
        }

        var token = DecodeToken(request.Code);
        if (token is null)
        {
            return InvalidToken();
        }

        var result = await userManager.ConfirmEmailAsync(user, token);
        return result.Succeeded || user.EmailConfirmed
            ? Results.NoContent()
            : InvalidToken();
    }

    private static async Task<IResult> ForgotPasswordAsync(
        ForgotPasswordRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<ApplicationUser> userManager,
        IAccountEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        await antiforgery.ValidateRequestAsync(context);
        string? developmentActionUrl = null;
        var email = string.IsNullOrWhiteSpace(request.Email)
            ? null
            : request.Email.Trim().ToLowerInvariant();
        var user = email is null ? null : await userManager.FindByEmailAsync(email);
        if (user is not null && user.EmailConfirmed && !user.IsPlatformBlocked)
        {
            var token = await userManager.GeneratePasswordResetTokenAsync(user);
            var dispatch = await emailSender.SendAsync(
                new AccountEmailDispatchRequest(
                    user.Id,
                    user.Email ?? email!,
                    AccountEmailPurpose.ResetPassword,
                    token),
                cancellationToken);
            developmentActionUrl = dispatch.DevelopmentActionUrl;
        }

        return Results.Accepted(value: new EmailActionResponse(
            "If the account is eligible, password reset instructions have been queued.",
            developmentActionUrl));
    }

    private static async Task<IResult> ResetPasswordAsync(
        ResetPasswordRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<ApplicationUser> userManager)
    {
        await antiforgery.ValidateRequestAsync(context);
        var user = request.UserId == Guid.Empty
            ? null
            : await userManager.FindByIdAsync(request.UserId.ToString());
        var token = DecodeToken(request.Code);
        if (user is null || token is null || string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return InvalidToken();
        }

        var result = await userManager.ResetPasswordAsync(user, token, request.NewPassword);
        if (result.Succeeded)
        {
            await userManager.UpdateSecurityStampAsync(user);
            return Results.NoContent();
        }

        return IdentityValidationProblem(result);
    }

    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        await antiforgery.ValidateRequestAsync(context);
        if (string.IsNullOrEmpty(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["password"] = ["Current and new passwords are required."],
            });
        }

        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        var result = await userManager.ChangePasswordAsync(
            user,
            request.CurrentPassword,
            request.NewPassword);
        if (!result.Succeeded)
        {
            return IdentityValidationProblem(result);
        }

        await signInManager.RefreshSignInAsync(user);
        return Results.NoContent();
    }

    private static async Task<IResult> RevokeAllSessionsAsync(
        ClaimsPrincipal principal,
        HttpContext context,
        IAntiforgery antiforgery,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        await antiforgery.ValidateRequestAsync(context);
        var user = await userManager.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        var result = await userManager.UpdateSecurityStampAsync(user);
        if (!result.Succeeded)
        {
            return IdentityValidationProblem(result);
        }

        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

    private static async Task<CurrentUserResponse> ToResponseAsync(
        ApplicationUser user,
        UserManager<ApplicationUser> userManager)
    {
        var roles = await userManager.GetRolesAsync(user);
        return new CurrentUserResponse(
            user.Id,
            user.Email ?? string.Empty,
            user.DisplayName,
            user.PreferredCulture,
            user.EmailConfirmed,
            roles.ToArray());
    }

    private static IResult AuthenticationFailed() =>
        Results.Json(
            new { code = "invalid_credentials", message = "Email or password is incorrect." },
            statusCode: StatusCodes.Status401Unauthorized);

    private static IResult InvalidToken() =>
        Results.Json(
            new { code = "invalid_or_expired_token", message = "The link is invalid or expired." },
            statusCode: StatusCodes.Status400BadRequest);

    private static IResult IdentityValidationProblem(IdentityResult result) =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["identity"] = result.Errors.Select(error => error.Description).ToArray(),
        });

    private static string? DecodeToken(string? encodedToken)
    {
        if (string.IsNullOrWhiteSpace(encodedToken))
        {
            return null;
        }

        try
        {
            return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encodedToken));
        }
        catch (FormatException)
        {
            return null;
        }
    }
}

public sealed record LoginRequest(string Email, string Password, bool RememberMe = false);

public sealed record CsrfResponse(string Token);

public sealed record ConfirmEmailRequest(Guid UserId, string Code);

public sealed record ForgotPasswordRequest(string Email);

public sealed record ResetPasswordRequest(Guid UserId, string Code, string NewPassword);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record EmailActionResponse(string Message, string? DevelopmentActionUrl);

public sealed record CurrentUserResponse(
    Guid Id,
    string Email,
    string DisplayName,
    string PreferredCulture,
    bool EmailConfirmed,
    IReadOnlyList<string> Roles);
