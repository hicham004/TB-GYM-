using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.ExerciseLibrary;

public static class ExerciseEndpoints
{
    public static IEndpointRouteBuilder MapExerciseLibraryModule(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/api/exercises")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(ExerciseLibraryModule.Name);

        group.MapGet("/", async (
            string? query,
            ExerciseEquipment? equipment,
            MovementPattern? movementPattern,
            MuscleGroup? muscle,
            ExerciseClassification? classification,
            string? tag,
            bool? includeArchived,
            int? skip,
            int? take,
            IExerciseLibraryApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.SearchAsync(
                new ExerciseSearchRequest(
                    query,
                    equipment,
                    movementPattern,
                    muscle,
                    classification,
                    tag,
                    includeArchived ?? false,
                    skip ?? 0,
                    take is null or 0 ? 50 : take.Value),
                cancellationToken)))
            .WithName("SearchExercises")
            .Produces<ExerciseSearchResult>();

        group.MapGet("/{exerciseId:guid}", async (
            Guid exerciseId,
            IExerciseLibraryApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var exercise = await service.GetAsync(exerciseId, cancellationToken);
            return exercise is null ? Results.NotFound() : Results.Ok(exercise);
        })
        .WithName("GetExercise")
        .Produces<ExerciseView>()
        .Produces(StatusCodes.Status404NotFound);

        group.MapPost("/", async (
            CreateExerciseRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IExerciseLibraryApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateAsync(request, cancellationToken));
        })
        .WithName("CreateExercise")
        .Produces<ExerciseView>(StatusCodes.Status201Created)
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapPut("/{exerciseId:guid}", async (
            Guid exerciseId,
            UpdateExerciseRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IExerciseLibraryApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateAsync(exerciseId, request, cancellationToken));
        })
        .WithName("UpdateExercise")
        .Produces<ExerciseView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapPut("/{exerciseId:guid}/archive", async (
            Guid exerciseId,
            SetExerciseArchivedRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IExerciseLibraryApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SetArchivedAsync(exerciseId, request, cancellationToken));
        })
        .WithName("SetExerciseArchived")
        .Produces<ExerciseView>()
        .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    private static IResult ToResult(ExerciseCommandResult result) =>
        result.Status switch
        {
            ExerciseCommandStatus.Success => Results.Ok(result.Exercise),
            ExerciseCommandStatus.NotFound => Results.NotFound(),
            ExerciseCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = result.Code ?? "exercise_conflict",
                message = result.Message ?? "The exercise changed or conflicts with existing data.",
            }),
        };
}
