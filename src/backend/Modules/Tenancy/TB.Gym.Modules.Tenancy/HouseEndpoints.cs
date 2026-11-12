using System.Globalization;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

/// <summary>
/// The house's routes (ADR 0041): the public sign-up beside the coach's, and the platform admin's read and write of
/// the house's settings. Which workspace is the house is never set here; the <c>platform-admin house</c> command does.
/// </summary>
public static class HouseEndpoints
{
    public static IEndpointRouteBuilder MapHouseEndpoints(this IEndpointRouteBuilder endpoints)
    {
        // What the public page may know before it shows a form (CLI-024). Never cached: the week fills up.
        endpoints.MapGet("/api/auth/register/trainee", async (
            HttpContext context,
            ITraineeSignUpService service,
            CancellationToken cancellationToken) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return Results.Ok(await service.GetStatusAsync(cancellationToken));
        })
        .AllowAnonymous()
        .WithName("GetTraineeSignUp")
        .WithTags(TenancyModule.Name)
        .Produces<TraineeSignUpStatusView>();

        endpoints.MapPost("/api/auth/register/trainee", async (
            RegisterTraineeRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITraineeSignUpService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.RegisterAsync(request, cancellationToken);
            return result.Status switch
            {
                // A filled honeypot is answered exactly as a sign-up that worked (WEB-002).
                TraineeRegistrationStatus.Created or TraineeRegistrationStatus.Dropped => Results.Accepted(
                    value: new TraineeRegistrationResponse(
                        result.Email,
                        result.DevelopmentConfirmationUrl,
                        result.EmailAvailable,
                        Joined: false)),
                TraineeRegistrationStatus.Joined => Results.Ok(
                    new TraineeRegistrationResponse(result.Email, null, result.EmailAvailable, Joined: true)),
                TraineeRegistrationStatus.Closed => Results.Conflict(new
                {
                    code = "trainee_sign_up_closed",
                    message = "Sign-up is not open right now.",
                }),
                TraineeRegistrationStatus.Full => Results.Conflict(new
                {
                    code = "trainee_sign_up_full",
                    message = FullMessage(result.OpensAgainOn),
                    opensAgainOn = result.OpensAgainOn,
                }),
                TraineeRegistrationStatus.Invalid => Results.ValidationProblem(
                    result.Errors ?? new Dictionary<string, string[]>()),
                TraineeRegistrationStatus.TooFast => Results.BadRequest(new
                {
                    code = "sign_up_form_too_fast",
                    message = "That was quick. Give it a moment and send again.",
                }),
                TraineeRegistrationStatus.StampInvalid => Results.BadRequest(new
                {
                    code = "sign_up_form_stamp_invalid",
                    message = "The form needs to be opened again before it can be sent.",
                }),
                // The age itself is the house's setting; the sentence a form shows beside it is the lawyer's.
                TraineeRegistrationStatus.AgeNotMet => Results.Conflict(new
                {
                    code = "trainee_sign_up_age_not_met",
                    message = string.Create(
                        CultureInfo.InvariantCulture,
                        $"Sign-up is open to people aged {result.MinimumAge} or older."),
                    minimumAge = result.MinimumAge,
                }),
                // Saying the email has an account is the accepted trade-off of a registration form (audit BEB-4),
                // as the coach's sign-up and an invitation make it; the sentence says what to do next, in one
                // wording whether the account is somebody's own or a sign-up here still waiting for its link.
                TraineeRegistrationStatus.ExistingAccountSignInRequired => Results.Conflict(new
                {
                    code = "existing_account_sign_in_required",
                    message = "An account already uses this email. Sign in with it, then sign up from there. If you already signed up here, open the link in the email we sent you; if that link has stopped working, sign up again in a few days.",
                }),
                TraineeRegistrationStatus.WrongSignedInAccount => Results.Json(
                    new
                    {
                        code = "wrong_signed_in_account",
                        message = "You are signed in with a different email. Use that email, or sign out first.",
                    },
                    statusCode: StatusCodes.Status403Forbidden),
                TraineeRegistrationStatus.AlreadyJoined => Results.Conflict(new
                {
                    code = "trainee_already_joined",
                    message = "You are already part of this coaching space.",
                }),
                TraineeRegistrationStatus.FormerStaff => Results.Conflict(new
                {
                    code = "trainee_former_staff",
                    message = "You were on this coaching space's team, so you can't sign up to train in it. Talk to its owner.",
                }),
                // Coming back after the space ended the coaching, or blocked access, is the space's choice (CLI-016).
                TraineeRegistrationStatus.EndedByTheHouse => Results.Conflict(new
                {
                    code = "trainee_sign_up_not_available",
                    message = "This coaching space ended your coaching or blocked your access, so you can't sign up again by yourself. Ask it to invite you back.",
                }),
                TraineeRegistrationStatus.AlreadySignedUpThisWeek => Results.Conflict(new
                {
                    code = "trainee_sign_up_once_a_week",
                    message = AgainMessage(result.OpensAgainOn),
                    opensAgainOn = result.OpensAgainOn,
                }),
                // The Identity module's code (CLI-010): the page reads the documents again.
                TraineeRegistrationStatus.LegalAcceptanceRequired => Results.Conflict(new
                {
                    code = "legal_acceptance_required",
                    message = "Read and accept the documents shown before you continue. They may have changed since the page opened.",
                }),
                _ => Results.Conflict(new
                {
                    code = "registration_conflict",
                    message = "The sign-up could not be completed. Try again.",
                }),
            };
        })
        .AllowAnonymous()
        // A limit of its own, tighter than public authentication's, which it therefore keeps too: a route
        // carries one policy (CLI-024).
        .RequireRateLimiting(RateLimitPolicies.TraineeSignUp)
        .WithMetadata(new RequestSizeLimitAttribute(TraineeSignUpRule.MaximumRequestBytes))
        .WithName("RegisterTrainee")
        .WithTags(TenancyModule.Name)
        .Produces<TraineeRegistrationResponse>(StatusCodes.Status202Accepted)
        .Produces<TraineeRegistrationResponse>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status409Conflict);

        var admin = endpoints
            .MapGroup("/api/platform-admin/house")
            .RequireAuthorization(AuthorizationPolicies.PlatformAdmin)
            .WithTags(TenancyModule.Name);

        admin.MapGet("/", async (
            IHouseAdminService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetAsync(cancellationToken)))
            .WithName("GetHouse")
            .Produces<HouseAdminView>();

        admin.MapPut("/settings/{setting}", async (
            HouseSetting setting,
            ChangeHouseSettingRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IHouseAdminService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.ChangeSettingAsync(setting, request, cancellationToken);
            return result.Status switch
            {
                HouseSettingStatus.Changed => Results.Ok(result.Setting),
                HouseSettingStatus.NotFound => Results.NotFound(),
                HouseSettingStatus.Invalid => Results.ValidationProblem(
                    result.Errors ?? new Dictionary<string, string[]>()),
                HouseSettingStatus.NoHouse => Results.Conflict(new
                {
                    code = "house_not_set",
                    message = "No coaching space is marked as the house yet, so it has no settings to change.",
                }),
                _ => Results.Conflict(new
                {
                    code = "house_setting_changed",
                    message = "This setting changed since the page loaded. Refresh and try again.",
                }),
            };
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("ChangeHouseSetting")
        .Produces<HouseSettingView>()
        .Produces(StatusCodes.Status404NotFound)
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    /// <summary>"It opens again on Monday.", with the house's own first day of the week.</summary>
    private static string FullMessage(DateOnly? opensAgainOn) =>
        opensAgainOn is { } day
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"Sign-up is full for this week. It opens again on {day.DayOfWeek}.")
            : "Sign-up is full for this week.";

    /// <summary>For someone who signed up, left and comes back inside the same house week.</summary>
    private static string AgainMessage(DateOnly? opensAgainOn) =>
        opensAgainOn is { } day
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"You already signed up this week. You can sign up again on {day.DayOfWeek}.")
            : "You already signed up this week.";
}
