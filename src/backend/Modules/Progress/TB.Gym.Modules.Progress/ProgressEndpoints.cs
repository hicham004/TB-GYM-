using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

public static class ProgressEndpoints
{
    public static IEndpointRouteBuilder MapProgressModule(this IEndpointRouteBuilder endpoints)
    {
        var client = endpoints.MapGroup("/api/progress/me")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(ProgressModule.Name);

        client.MapGet("", async (
            DateOnly? from,
            DateOnly? to,
            RecordedMassUnit? displayUnit,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            try
            {
                var view = await service.GetOwnAsync(from, to, displayUnit ?? RecordedMassUnit.Kilogram, token);
                return view is null ? Results.NotFound() : Results.Ok(view);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["range"] = [exception.Message],
                });
            }
        }).WithName("GetOwnProgress").Produces<ProgressView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound);

        client.MapPost("/bodyweight", async (
            RecordBodyweightRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RecordOwnAsync(request, token));
        }).WithName("RecordOwnBodyweight").Produces<BodyweightObservationView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);

        client.MapPut("/bodyweight/{observationId:guid}", async (
            Guid observationId,
            CorrectBodyweightRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CorrectOwnAsync(observationId, request, token));
        }).WithName("CorrectOwnBodyweight").Produces<BodyweightHistoryView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        client.MapGet("/bodyweight/{observationId:guid}/history", async (
            Guid observationId,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            var view = await service.GetOwnHistoryAsync(observationId, token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        }).WithName("GetOwnBodyweightHistory").Produces<BodyweightHistoryView>().ProducesProblem(StatusCodes.Status404NotFound);

        client.MapGet("/measurements", async (
            DateOnly? from,
            DateOnly? to,
            MeasurementUnit? displayUnit,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            try
            {
                var view = await service.GetOwnMeasurementsAsync(
                    from,
                    to,
                    displayUnit ?? MeasurementUnit.Centimetre,
                    token);
                return view is null ? Results.NotFound() : Results.Ok(view);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["range"] = [exception.Message],
                });
            }
        }).WithName("GetOwnBodyMeasurements").Produces<BodyMeasurementsView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound);

        client.MapPost("/measurements", async (
            RecordBodyMeasurementRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMeasurementResult(await service.RecordOwnMeasurementAsync(request, token));
        }).WithName("RecordOwnBodyMeasurement").Produces<BodyMeasurementView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);

        client.MapPut("/measurements/{measurementId:guid}", async (
            Guid measurementId,
            CorrectBodyMeasurementRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMeasurementResult(await service.CorrectOwnMeasurementAsync(
                measurementId,
                request,
                token));
        }).WithName("CorrectOwnBodyMeasurement").Produces<BodyMeasurementHistoryView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        client.MapGet("/measurements/{measurementId:guid}/history", async (
            Guid measurementId,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            var view = await service.GetOwnMeasurementHistoryAsync(measurementId, token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        }).WithName("GetOwnBodyMeasurementHistory").Produces<BodyMeasurementHistoryView>().ProducesProblem(StatusCodes.Status404NotFound);

        var coach = endpoints.MapGroup("/api/progress/clients/{clientProfileId:guid}")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(ProgressModule.Name);

        coach.MapGet("", async (
            Guid clientProfileId,
            DateOnly? from,
            DateOnly? to,
            RecordedMassUnit? displayUnit,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            try
            {
                var view = await service.GetClientAsync(clientProfileId, from, to, displayUnit ?? RecordedMassUnit.Kilogram, token);
                return view is null ? Results.NotFound() : Results.Ok(view);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["range"] = [exception.Message],
                });
            }
        }).WithName("GetClientProgress").Produces<ProgressView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound);

        coach.MapPost("/bodyweight", async (
            Guid clientProfileId,
            RecordBodyweightRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RecordForClientAsync(clientProfileId, request, token));
        }).WithName("RecordClientBodyweight").Produces<BodyweightObservationView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status403Forbidden).ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPut("/bodyweight/{observationId:guid}", async (
            Guid clientProfileId,
            Guid observationId,
            CorrectBodyweightRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CorrectForClientAsync(clientProfileId, observationId, request, token));
        }).WithName("CorrectClientBodyweight").Produces<BodyweightHistoryView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status403Forbidden).ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/bodyweight/{observationId:guid}/history", async (
            Guid clientProfileId,
            Guid observationId,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            var view = await service.GetClientHistoryAsync(clientProfileId, observationId, token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        }).WithName("GetClientBodyweightHistory").Produces<BodyweightHistoryView>().ProducesProblem(StatusCodes.Status404NotFound);

        coach.MapGet("/measurements", async (
            Guid clientProfileId,
            DateOnly? from,
            DateOnly? to,
            MeasurementUnit? displayUnit,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            try
            {
                var view = await service.GetClientMeasurementsAsync(
                    clientProfileId,
                    from,
                    to,
                    displayUnit ?? MeasurementUnit.Centimetre,
                    token);
                return view is null ? Results.NotFound() : Results.Ok(view);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["range"] = [exception.Message],
                });
            }
        }).WithName("GetClientBodyMeasurements").Produces<BodyMeasurementsView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound);

        coach.MapPost("/measurements", async (
            Guid clientProfileId,
            RecordBodyMeasurementRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMeasurementResult(await service.RecordMeasurementForClientAsync(
                clientProfileId,
                request,
                token));
        }).WithName("RecordClientBodyMeasurement").Produces<BodyMeasurementView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status403Forbidden).ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPut("/measurements/{measurementId:guid}", async (
            Guid clientProfileId,
            Guid measurementId,
            CorrectBodyMeasurementRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMeasurementResult(await service.CorrectMeasurementForClientAsync(
                clientProfileId,
                measurementId,
                request,
                token));
        }).WithName("CorrectClientBodyMeasurement").Produces<BodyMeasurementHistoryView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status403Forbidden).ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/measurements/{measurementId:guid}/history", async (
            Guid clientProfileId,
            Guid measurementId,
            IProgressApplicationService service,
            CancellationToken token) =>
        {
            var view = await service.GetClientMeasurementHistoryAsync(
                clientProfileId,
                measurementId,
                token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        }).WithName("GetClientBodyMeasurementHistory").Produces<BodyMeasurementHistoryView>().ProducesProblem(StatusCodes.Status404NotFound);

        return endpoints;
    }

    private static IResult ToResult(ProgressCommandResult result) => result.Status switch
    {
        ProgressCommandStatus.Success when result.History is not null => Results.Ok(result.History),
        ProgressCommandStatus.Success => Results.Ok(result.Observation),
        ProgressCommandStatus.NotFound => Results.NotFound(),
        ProgressCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        ProgressCommandStatus.Conflict => Results.Problem(statusCode: StatusCodes.Status409Conflict, title: result.Message ?? "The bodyweight entry conflicts with current state.", extensions: result.Code is null ? null : new Dictionary<string, object?> { ["code"] = result.Code }),
        ProgressCommandStatus.Forbidden => Results.Forbid(),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToMeasurementResult(BodyMeasurementCommandResult result) => result.Status switch
    {
        ProgressCommandStatus.Success when result.History is not null => Results.Ok(result.History),
        ProgressCommandStatus.Success => Results.Ok(result.Measurement),
        ProgressCommandStatus.NotFound => Results.NotFound(),
        ProgressCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        ProgressCommandStatus.Conflict => Results.Problem(statusCode: StatusCodes.Status409Conflict, title: result.Message ?? "The body measurement conflicts with current state.", extensions: result.Code is null ? null : new Dictionary<string, object?> { ["code"] = result.Code }),
        ProgressCommandStatus.Forbidden => Results.Forbid(),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };
}
