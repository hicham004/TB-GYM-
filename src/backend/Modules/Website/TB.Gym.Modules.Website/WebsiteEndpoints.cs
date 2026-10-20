using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.RateLimiting;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Website;

/// <summary>
/// The public website's routes (UI plan R6.2g). None needs a sign-in or a workspace: a gym that
/// writes to us is nobody's member yet, and the settings are the same for every visitor. The one
/// exception is the platform admin's list of requests not yet emailed (audit BEB-1).
/// </summary>
public static class WebsiteEndpoints
{
    public static IEndpointRouteBuilder MapWebsiteModule(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/website").WithTags(WebsiteModule.Name);

        group.MapGet("/settings", (IWebsiteSettingsReader settings) => Results.Ok(settings.Read()))
            .AllowAnonymous()
            .WithName("GetWebsiteSettings")
            .Produces<WebsiteSettingsView>();

        // The stamp behind the minimum-time rule: fetched when the form comes into view, sent back
        // with the request. Never cached, because its whole meaning is the moment it was issued.
        group.MapGet("/contact-form", (HttpContext context, IContactFormStamps stamps, IClock clock) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new ContactFormStampView(stamps.Issue(clock.UtcNow)));
        })
            .AllowAnonymous()
            .WithName("GetContactForm")
            .Produces<ContactFormStampView>();

        // Antiforgery as on every other state change, and a per-address allowance on top of
        // nginx's: a form anybody on the internet can post is the one route that must cost its
        // caller something.
        group.MapPost("/contact-requests", async (
            ContactRequestSubmission submission,
            HttpContext context,
            IAntiforgery antiforgery,
            IContactRequestApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.SubmitAsync(submission, cancellationToken);
            return result.Status switch
            {
                // A filled honeypot is answered exactly as a real request, so a bot learns nothing.
                ContactRequestSubmissionStatus.Accepted or ContactRequestSubmissionStatus.Dropped =>
                    Results.Accepted(),
                ContactRequestSubmissionStatus.Invalid => Results.ValidationProblem(
                    result.Errors ?? new Dictionary<string, string[]>()),
                ContactRequestSubmissionStatus.TooFast => Results.BadRequest(new
                {
                    code = "contact_form_too_fast",
                    message = "That was quick. Give it a moment and send again.",
                }),
                _ => Results.BadRequest(new
                {
                    code = "contact_form_stamp_invalid",
                    message = "The form needs to be opened again before it can be sent.",
                }),
            };
        })
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.PublicContact)
            // Refused at the socket past this (audit BEB-3), before antiforgery or the field rules read a
            // byte: Kestrel's default let an anonymous caller hand over 30 MB. The longest form a person
            // can send, every field at its limit in four-byte characters, is under 6 KB.
            .WithMetadata(new RequestSizeLimitAttribute(ContactRequestRules.MaximumRequestBytes))
            .WithName("SubmitContactRequest")
            .Accepts<ContactRequestSubmission>("application/json")
            .Produces(StatusCodes.Status202Accepted)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status429TooManyRequests);

        // The platform admin's view of requests whose email has not gone out (audit BEB-1), so a
        // request sent while email is off is still read. Beside the other admin routes; the policy
        // re-reads the global role from the database on every request.
        endpoints.MapGet("/api/platform-admin/contact-requests", async (
                IContactRequestAdminReader reader,
                CancellationToken cancellationToken) =>
                Results.Ok(await reader.ListUnsentAsync(cancellationToken)))
            .RequireAuthorization(AuthorizationPolicies.PlatformAdmin)
            .WithTags(WebsiteModule.Name)
            .WithName("ListUnsentContactRequests")
            .Produces<ContactRequestAdminView[]>();

        return endpoints;
    }
}
