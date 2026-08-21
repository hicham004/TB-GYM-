using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public static class TrainingEndpoints
{
    public static IEndpointRouteBuilder MapTrainingModule(this IEndpointRouteBuilder endpoints)
    {
        var coach = endpoints
            .MapGroup("/api/training")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(TrainingModule.Name);

        coach.MapGet("/templates", async (
            int? skip,
            int? take,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var page = NormalizePage(skip, take, 25);
            return Results.Ok(await service.ListTemplatesAsync(page.Skip, page.Take, cancellationToken));
        })
            .WithName("ListProgramTemplates")
            .Produces<ProgramTemplatePage>();

        coach.MapGet("/template-versions/{templateVersionId:guid}", async (
            Guid templateVersionId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var version = await service.GetTemplateVersionAsync(templateVersionId, cancellationToken);
            return version is null ? Results.NotFound() : Results.Ok(version);
        })
        .WithName("GetProgramTemplateVersion")
        .Produces<ProgramTemplateVersionView>()
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/templates", async (
            SaveProgramTemplateRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateTemplateAsync(request, cancellationToken));
        })
        .WithName("CreateProgramTemplate")
        .Produces<ProgramTemplateVersionView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/templates/{templateId:guid}/versions", async (
            Guid templateId,
            SaveProgramTemplateRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddTemplateVersionAsync(templateId, request, cancellationToken));
        })
        .WithName("AddProgramTemplateVersion")
        .Produces<ProgramTemplateVersionView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/saved-sessions", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListSavedSessionsAsync(cancellationToken)))
            .WithName("ListSavedTrainingSessions")
            .Produces<SavedSessionView[]>();

        coach.MapPost("/saved-sessions", async (
            SaveSessionTemplateRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SaveSessionAsync(request, cancellationToken));
        })
        .WithName("SaveTrainingSessionTemplate")
        .Produces<SavedSessionView>()
        .ProducesValidationProblem();

        coach.MapGet("/clients/{clientProfileId:guid}/mesocycles", async (
            Guid clientProfileId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var items = await service.ListClientMesocyclesAsync(clientProfileId, cancellationToken);
            return items is null ? Results.NotFound() : Results.Ok(items);
        })
        .WithName("ListClientMesocycles")
        .Produces<MesocycleSummary[]>()
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/clients/{clientProfileId:guid}/mesocycles", async (
            Guid clientProfileId,
            AssignMesocycleRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AssignMesocycleAsync(clientProfileId, request, cancellationToken));
        })
        .WithName("AssignClientMesocycle")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/mesocycles/{mesocycleId:guid}", async (
            Guid mesocycleId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var item = await service.GetMesocycleAsync(mesocycleId, cancellationToken);
            return item is null ? Results.NotFound() : Results.Ok(item);
        })
        .WithName("GetTrainingMesocycle")
        .Produces<TrainingMesocycleView>()
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPut("/mesocycles/{mesocycleId:guid}/visibility", async (
            Guid mesocycleId,
            UpdateMesocycleVisibilityRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateMesocycleVisibilityAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("UpdateMesocycleVisibility")
        .Produces<TrainingMesocycleView>()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPut("/mesocycles/{mesocycleId:guid}/weeks/{weekId:guid}/publish", async (
            Guid mesocycleId,
            Guid weekId,
            SetWeekPublishedRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SetWeekPublishedAsync(mesocycleId, weekId, request, cancellationToken));
        })
        .WithName("SetMesocycleWeekPublished")
        .Produces<TrainingMesocycleView>()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPut("/mesocycles/{mesocycleId:guid}/schedule", async (
            Guid mesocycleId,
            RescheduleMesocycleRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RescheduleMesocycleAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("RescheduleMesocycle")
        .Produces<TrainingMesocycleView>()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/cancel", async (
            Guid mesocycleId,
            CancelMesocycleRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CancelMesocycleAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("CancelTrainingMesocycle")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/complete", async (
            Guid mesocycleId,
            CompleteMesocycleRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CompleteMesocycleAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("CompleteTrainingMesocycle")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPut("/mesocycles/{mesocycleId:guid}/sessions/{sessionId:guid}", async (
            Guid mesocycleId,
            Guid sessionId,
            ReplaceTrainingSessionRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReplaceSessionAsync(mesocycleId, sessionId, request, cancellationToken));
        })
        .WithName("ReplaceFutureTrainingSession")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/progression/preview", async (
            Guid mesocycleId,
            ProgressionPreviewRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            try
            {
                var preview = await service.PreviewProgressionAsync(mesocycleId, request, cancellationToken);
                return preview is null ? Results.NotFound() : Results.Ok(preview);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["progression"] = [exception.Message],
                });
            }
            catch (InvalidOperationException exception)
            {
                return Results.Conflict(new
                {
                    code = "progression_conflict",
                    message = exception.Message,
                });
            }
        })
        .WithName("PreviewTrainingProgression")
        .Produces<ProgressionPreviewView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/progression/apply", async (
            Guid mesocycleId,
            ApplyProgressionRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ApplyProgressionAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("ApplyTrainingProgression")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/clients/{clientProfileId:guid}/exercises/{exerciseId:guid}/history", async (
            Guid clientProfileId,
            Guid exerciseId,
            int? skip,
            int? take,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var page = NormalizePage(skip, take, 50);
            var history = await service.GetExerciseHistoryAsync(
                clientProfileId,
                exerciseId,
                page.Skip,
                page.Take,
                cancellationToken);
            return history is null ? Results.NotFound() : Results.Ok(history);
        })
        .WithName("GetClientExerciseHistory")
        .Produces<ExerciseHistoryPage>()
        .Produces(StatusCodes.Status404NotFound);

        var client = endpoints
            .MapGroup("/api/training/me")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(TrainingModule.Name);

        client.MapGet("/today", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetTodayAsync(cancellationToken)))
            .WithName("GetMyTrainingToday")
            .Produces<ClientTrainingDayResult>();

        client.MapPost("/sessions/{sessionId:guid}/start", async (
            Guid sessionId,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.StartWorkoutAsync(sessionId, cancellationToken));
        })
        .WithName("StartMyWorkout")
        .Produces<WorkoutExecutionView>()
        .Produces(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status409Conflict);

        client.MapPut("/workouts/{workoutExecutionId:guid}/sets/{setPerformanceId:guid}", async (
            Guid workoutExecutionId,
            Guid setPerformanceId,
            RecordSetActualRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RecordSetActualAsync(
                workoutExecutionId,
                setPerformanceId,
                request,
                cancellationToken));
        })
        .WithName("RecordMyTrainingSet")
        .Produces<WorkoutSetSaveView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        client.MapPut("/workouts/{workoutExecutionId:guid}/exercises/{exercisePerformanceId:guid}/substitution", async (
            Guid workoutExecutionId,
            Guid exercisePerformanceId,
            SubstituteExerciseRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SubstituteExerciseAsync(
                workoutExecutionId,
                exercisePerformanceId,
                request,
                cancellationToken));
        })
        .WithName("SubstituteMyTrainingExercise")
        .Produces<WorkoutExecutionView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        client.MapPost("/workouts/{workoutExecutionId:guid}/complete", async (
            Guid workoutExecutionId,
            CompleteWorkoutRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CompleteWorkoutAsync(workoutExecutionId, request, cancellationToken));
        })
        .WithName("CompleteMyWorkout")
        .Produces<WorkoutExecutionView>()
        .ProducesProblem(StatusCodes.Status409Conflict);

        var member = endpoints
            .MapGroup("/api/training/workouts")
            .RequireAuthorization(AuthorizationPolicies.TenantMember)
            .WithTags(TrainingModule.Name);

        member.MapPost("/{workoutExecutionId:guid}/notes", async (
            Guid workoutExecutionId,
            AddWorkoutNoteRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddWorkoutNoteAsync(workoutExecutionId, request, cancellationToken));
        })
        .WithName("AddWorkoutNote")
        .Produces<WorkoutExecutionView>()
        .ProducesValidationProblem();

        return endpoints;
    }

    private static IResult ToResult(TrainingCommandResult result) =>
        result.Status switch
        {
            TrainingCommandStatus.Success => Results.Ok(
                (object?)result.TemplateVersion ??
                result.Mesocycle ??
                (object?)result.SavedSession ??
                (object?)result.SetSave ??
                result.WorkoutExecution),
            TrainingCommandStatus.NotFound => Results.NotFound(),
            TrainingCommandStatus.Forbidden => Results.Forbid(),
            TrainingCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = result.Code ?? "training_conflict",
                message = result.Message ?? "Training state changed or conflicts with another request.",
            }),
        };

    private static (int Skip, int Take) NormalizePage(int? skip, int? take, int defaultTake) =>
        (Math.Max(skip ?? 0, 0), Math.Clamp(take ?? defaultTake, 1, 100));
}
