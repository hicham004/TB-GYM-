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

        // movementPattern and ids repeat: ?movementPattern=HorizontalPush&movementPattern=VerticalPush;
        // patterns=true adds the library's count per pattern, facets=true the library page's filters, and
        // status reads the exercises in use (the default), the archived ones or both (critique B9).
        group.MapGet("/", async (
            string? query,
            ExerciseEquipment? equipment,
            MovementPattern[]? movementPattern,
            MuscleGroup? muscle,
            ExerciseClassification? classification,
            string? typeName,
            string? tag,
            ExerciseListStatus? status,
            Guid[]? ids,
            bool? patterns,
            bool? facets,
            int? skip,
            int? take,
            IExerciseLibraryApplicationService service,
            CancellationToken cancellationToken) =>
        {
            if (ids is { Length: > ExerciseSearchRequest.MaximumIds })
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["ids"] = [$"Ask for at most {ExerciseSearchRequest.MaximumIds} exercises at once."],
                });
            }

            if (status is { } asked && !Enum.IsDefined(asked))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["status"] = ["Ask for Active, Archived or Both."],
                });
            }

            return Results.Ok(await service.SearchAsync(
                new ExerciseSearchRequest(
                    query,
                    equipment,
                    movementPattern,
                    muscle,
                    classification,
                    tag,
                    status ?? ExerciseListStatus.Active,
                    skip ?? 0,
                    take is null or 0 ? 50 : take.Value,
                    ids,
                    patterns ?? false,
                    typeName,
                    facets ?? false),
                cancellationToken));
        })
            .WithName("SearchExercises")
            .Produces<ExerciseSearchResult>()
            .ProducesValidationProblem();

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
