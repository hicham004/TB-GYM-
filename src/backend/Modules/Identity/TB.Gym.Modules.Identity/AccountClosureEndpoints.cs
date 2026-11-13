using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// Closing an account (CLI-027): the signed-in person from Me, and the platform admin on a person's request. Neither
/// route reads a workspace: closing reaches every coaching space the person is in, and leaves each one.
/// </summary>
public static class AccountClosureEndpoints
{
    public static IEndpointRouteBuilder MapAccountClosureEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/account/close", CloseOwnAccountAsync)
            .WithTags(IdentityModule.Name)
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("CloseOwnAccount")
            .WithDescription("Closes the signed-in account for good and signs it out: every client membership ends and the person is anonymised.")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status409Conflict);

        endpoints.MapPost("/api/platform-admin/accounts/close", CloseAccountOnRequestAsync)
            .WithTags(IdentityModule.Name)
            .RequireAuthorization(AuthorizationPolicies.PlatformAdmin)
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("CloseAccountOnRequest")
            .WithDescription("The platform admin closes an account on its person's request, as they could themselves.")
            .Produces<AccountClosureView>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    private static async Task<IResult> CloseOwnAccountAsync(
        CloseOwnAccountRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        ICurrentUser currentUser,
        SignInManager<ApplicationUser> signInManager,
        IAccountClosureService closures,
        CancellationToken cancellationToken)
    {
        await antiforgery.ValidateRequestAsync(context);
        if (currentUser.UserId is not { } userId)
        {
            return Results.Unauthorized();
        }

        if (string.IsNullOrEmpty(request?.Password))
        {
            return PasswordProblem(AccountClosureText.PasswordRequired);
        }

        var result = await closures.CloseOwnAsync(userId, request.Password, cancellationToken);
        switch (result.Status)
        {
            case AccountClosureStatus.Closed:
            case AccountClosureStatus.AlreadyClosed:
                // Every session already ended with the account's stamp; this one's cookie goes too.
                await signInManager.SignOutAsync();
                return Results.NoContent();
            case AccountClosureStatus.WrongPassword:
                return PasswordProblem(AccountClosureText.PasswordWrong);
            case AccountClosureStatus.NotFound:
                return Results.Unauthorized();
            default:
                return Refused(result.Status);
        }
    }

    private static async Task<IResult> CloseAccountOnRequestAsync(
        CloseAccountOnRequestRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        ICurrentUser currentUser,
        IClock clock,
        IAccountClosureService closures,
        CancellationToken cancellationToken)
    {
        await antiforgery.ValidateRequestAsync(context);
        if (currentUser.UserId is not { } adminUserId)
        {
            return Results.Unauthorized();
        }

        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var email = request?.Email?.Trim();
        if (string.IsNullOrEmpty(email) || email.Length > 320)
        {
            errors["email"] = [AccountClosureText.EmailRequired];
        }

        if (request?.RequestedOn is not { } requestedOn || !AccountClosure.IsValidRequestedOn(requestedOn, clock.UtcNow))
        {
            errors["requestedOn"] = [AccountClosureText.RequestedOnRequired];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var result = await closures.CloseOnRequestAsync(email!, request!.RequestedOn!.Value, adminUserId, cancellationToken);
        return result.Status switch
        {
            AccountClosureStatus.Closed => Results.Ok(result.View),
            AccountClosureStatus.NotFound => Results.Json(
                new { code = "account_not_found", message = AccountClosureText.NotFound },
                statusCode: StatusCodes.Status404NotFound),
            _ => Refused(result.Status),
        };
    }

    private static IResult PasswordProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["password"] = [message],
        });

    private static IResult Refused(AccountClosureStatus status) =>
        status switch
        {
            AccountClosureStatus.Staff => Results.Json(
                new { code = "account_closure_staff", message = AccountClosureText.Staff },
                statusCode: StatusCodes.Status409Conflict),
            AccountClosureStatus.PlatformAdmin => Results.Json(
                new { code = "account_closure_platform_admin", message = AccountClosureText.PlatformAdmin },
                statusCode: StatusCodes.Status409Conflict),
            AccountClosureStatus.Changed => Results.Json(
                new { code = "account_closure_changed", message = AccountClosureText.Changed },
                statusCode: StatusCodes.Status409Conflict),
            _ => Results.Json(
                new { code = "account_already_closed", message = AccountClosureText.AlreadyClosed },
                statusCode: StatusCodes.Status409Conflict),
        };
}

/// <summary>The words of closing an account's refusals, in one place.</summary>
public static class AccountClosureText
{
    public const string PasswordRequired = "Type your password to close your account.";

    public const string PasswordWrong = "That password isn't right.";

    public const string Staff =
        "This account owns or coaches a coaching space on TB Gym, or once did, so it can't be closed here.";

    public const string PlatformAdmin = "A platform admin's account can't be closed here.";

    public const string AlreadyClosed = "This account is already closed.";

    public const string Changed = "Something changed while the account was closing, so nothing was closed. Try again.";

    public const string NotFound = "No TB Gym account has that email.";

    public const string EmailRequired = "Type the email of the account to close.";

    public const string RequestedOnRequired = "Choose the day the person asked, no later than today.";
}
