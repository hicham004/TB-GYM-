using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public static class TrainingEndpoints
{
    /// <summary>A draft as the builder sends it, with room for the nulls it writes out in full.</summary>
    private const long MaximumDraftRequestBytes = ProgramDraftShape.MaximumContentLength * 3L;

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

        coach.MapGet("/templates/{templateId:guid}", async (
            Guid templateId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var template = await service.GetTemplateAsync(templateId, cancellationToken);
            return template is null ? Results.NotFound() : Results.Ok(template);
        })
        .WithName("GetProgramTemplate")
        .Produces<ProgramTemplateSummary>()
        .Produces(StatusCodes.Status404NotFound);

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

        MapProgramDrafts(coach);

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
        .ProducesValidationProblem()
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

        coach.MapPost("/week-progression/preview", async (
            PreviewWeekProgressionRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            try
            {
                return Results.Ok(await service.PreviewWeekProgressionAsync(request, cancellationToken));
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["progression"] = [exception.PersonMessage()],
                });
            }
        })
        .WithMetadata(AllowedWhileWorkspaceReadOnly.Instance)
        .WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
        .WithName("PreviewWeekProgression")
        .Produces<WeekProgressionPreviewView>()
        .ProducesValidationProblem();

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
                    ["progression"] = [exception.PersonMessage()],
                });
            }
            catch (InvalidOperationException exception)
            {
                return Results.Conflict(new
                {
                    code = "progression_conflict",
                    message = exception.PersonMessage(),
                });
            }
        })
        .WithMetadata(AllowedWhileWorkspaceReadOnly.Instance)
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

        // Editing a client's weeks in the builder's grid (TRN-028): preview saves nothing, apply carries out
        // exactly what the coach read.
        coach.MapPost("/mesocycles/{mesocycleId:guid}/edit/preview", async (
            Guid mesocycleId,
            PreviewProgramEditRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            try
            {
                var preview = await service.PreviewProgramEditAsync(mesocycleId, request, cancellationToken);
                return preview is null ? Results.NotFound() : Results.Ok(preview);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["edit"] = [exception.PersonMessage()],
                });
            }
            catch (InvalidOperationException exception)
            {
                return Results.Conflict(new
                {
                    code = "program_edit_conflict",
                    message = exception.PersonMessage(),
                });
            }
        })
        .WithMetadata(AllowedWhileWorkspaceReadOnly.Instance)
        .WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
        .WithName("PreviewProgramEdit")
        .Produces<ProgramEditPreviewView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/edit/apply", async (
            Guid mesocycleId,
            ApplyProgramEditRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ApplyProgramEditAsync(mesocycleId, request, cancellationToken));
        })
        .WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
        .WithName("ApplyProgramEdit")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        coach.MapGet("/mesocycles/{mesocycleId:guid}/training-maxes", async (
            Guid mesocycleId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var view = await service.GetTrainingMaxesAsync(mesocycleId, cancellationToken);
            return view is null ? Results.NotFound() : Results.Ok(view);
        })
        .WithName("GetTrainingMaxes")
        .Produces<TrainingMaxesView>()
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/training-maxes/preview", async (
            Guid mesocycleId,
            PreviewTrainingMaxesRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            try
            {
                var preview = await service.PreviewTrainingMaxesAsync(mesocycleId, request, cancellationToken);
                return preview is null ? Results.NotFound() : Results.Ok(preview);
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["maxes"] = [exception.PersonMessage()],
                });
            }
            catch (InvalidOperationException exception)
            {
                return Results.Conflict(new
                {
                    code = exception is TrainingMaxSuggestionChangedException
                        ? TrainingMaxSuggestionChangedException.Code
                        : "training_maxes_conflict",
                    message = exception.PersonMessage(),
                });
            }
        })
        .WithMetadata(AllowedWhileWorkspaceReadOnly.Instance)
        .WithName("PreviewTrainingMaxes")
        .Produces<TrainingMaxesPreviewView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/training-maxes/apply", async (
            Guid mesocycleId,
            ApplyTrainingMaxesRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ApplyTrainingMaxesAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("ApplyTrainingMaxes")
        .Produces<TrainingMesocycleView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/mesocycles/{mesocycleId:guid}/training-maxes/keep", async (
            Guid mesocycleId,
            KeepTrainingMaxRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.KeepTrainingMaxAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("KeepTrainingMax")
        .Produces<TrainingMaxesView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPut("/mesocycles/{mesocycleId:guid}/name", async (
            Guid mesocycleId,
            RenameMesocycleRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RenameMesocycleAsync(mesocycleId, request, cancellationToken));
        })
        .WithName("RenameMesocycle")
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

        // The coach's read of what the client's own "personal records" shows (R3.3b, TRN-019).
        coach.MapGet("/clients/{clientProfileId:guid}/personal-records", async (
            Guid clientProfileId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var records = await service.GetClientPersonalRecordsAsync(clientProfileId, cancellationToken);
            return records is null ? Results.NotFound() : Results.Ok(records);
        })
        .WithName("GetClientTrainingPersonalRecords")
        .Produces<ClientPersonalRecordsResult>()
        .Produces(StatusCodes.Status404NotFound);

        // The coach's read of what the client's own Training page shows, with the weeks not yet shared
        // (R3.4a, TRN-020, TRN-022).
        coach.MapGet("/clients/{clientProfileId:guid}/program", async (
            Guid clientProfileId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var program = await service.GetClientProgramAsync(clientProfileId, cancellationToken);
            return program is null ? Results.NotFound() : Results.Ok(program);
        })
        .WithName("GetClientTrainingProgram")
        .Produces<CoachClientProgramView>()
        .Produces(StatusCodes.Status404NotFound);

        // Where the client's latest program ended, for Assign program to start from (P4c, STR-014).
        coach.MapGet("/clients/{clientProfileId:guid}/previous-maxes", async (
            Guid clientProfileId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var maxes = await service.GetPreviousProgramMaxesAsync(clientProfileId, cancellationToken);
            return maxes is null ? Results.NotFound() : Results.Ok(maxes);
        })
        .WithName("GetPreviousProgramMaxes")
        .Produces<PreviousProgramMaxesView>()
        .Produces(StatusCodes.Status404NotFound);

        var client = endpoints
            .MapGroup("/api/training/me")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(TrainingModule.Name);

        coach.MapGet("/clients/{clientProfileId:guid}/workouts/{workoutExecutionId:guid}", async (
            Guid clientProfileId,
            Guid workoutExecutionId,
            int? notesSkip,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var result = await service.GetCoachWorkoutAsync(
                clientProfileId, workoutExecutionId, Math.Max(0, notesSkip ?? 0), cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        })
        .WithName("GetCoachWorkoutDetail")
        .Produces<CoachWorkoutDetailResult>()
        .Produces(StatusCodes.Status404NotFound);

        client.MapGet("/upcoming", async (
            int? skip,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetUpcomingAsync(Math.Max(0, skip ?? 0), cancellationToken)))
        .WithName("GetMyUpcomingTraining")
        .Produces<ClientTrainingUpcomingView>();

        client.MapGet("/today", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetTodayAsync(cancellationToken)))
            .WithName("GetMyTrainingToday")
            .Produces<ClientTrainingDayResult>();

        client.MapGet("/week", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetMyWeekAsync(cancellationToken)))
            .WithName("GetMyTrainingWeek")
             .Produces<ClientTrainingWeekView>();

        client.MapGet("/personal-records", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetMyPersonalRecordsAsync(cancellationToken)))
            .WithName("GetMyTrainingPersonalRecords")
            .Produces<ClientPersonalRecordsResult>();

        client.MapGet("/program", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetMyProgramAsync(cancellationToken)))
            .WithName("GetMyTrainingProgram")
            .Produces<ClientTrainingProgramView>();

        client.MapGet("/history", async (
            int? skip,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetMyWorkoutHistoryAsync(Math.Max(0, skip ?? 0), cancellationToken)))
            .WithName("GetMyWorkoutHistory")
            .Produces<ClientWorkoutHistoryPage>();

        client.MapGet("/programs/{programId:guid}/summary", async (
            Guid programId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var result = await service.GetMyProgramSummaryAsync(programId, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        })
        .WithName("GetMyProgramSummary")
        .Produces<ClientProgramSummaryResult>()
        .Produces(StatusCodes.Status404NotFound);

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

    /// <summary>
    /// A coach's working copies of programs in the builder (TRN-024): each person reads and writes only
    /// their own, and a draft becomes a version only through publish.
    /// </summary>
    private static void MapProgramDrafts(RouteGroupBuilder coach)
    {
        coach.MapGet("/program-drafts", async (
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListProgramDraftsAsync(cancellationToken)))
            .WithName("ListProgramDrafts")
            .Produces<ProgramDraftSummary[]>();

        coach.MapGet("/program-drafts/{draftId:guid}", async (
            Guid draftId,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var draft = await service.GetProgramDraftAsync(draftId, cancellationToken);
            return draft is null ? Results.NotFound() : Results.Ok(draft);
        })
        .WithName("GetProgramDraft")
        .Produces<ProgramDraftView>()
        .Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/program-drafts", async (
            CreateProgramDraftRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateProgramDraftAsync(request, cancellationToken));
        })
        .WithName("CreateProgramDraft")
        .WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
        .Produces<ProgramDraftSaveView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPut("/program-drafts/{draftId:guid}", async (
            Guid draftId,
            SaveProgramDraftRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SaveProgramDraftAsync(draftId, request, cancellationToken));
        })
        .WithName("SaveProgramDraft")
        .WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
        .Produces<ProgramDraftSaveView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/program-drafts/{draftId:guid}/discard", async (
            Guid draftId,
            DiscardProgramDraftRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.DiscardProgramDraftAsync(draftId, request, cancellationToken);
            return result.Status == TrainingCommandStatus.Success ? Results.NoContent() : ToResult(result);
        })
        .WithName("DiscardProgramDraft")
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapPost("/program-drafts/{draftId:guid}/publish", async (
            Guid draftId,
            PublishProgramDraftRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITrainingApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.PublishProgramDraftAsync(draftId, request, cancellationToken));
        })
        .WithName("PublishProgramDraft")
        .Produces<ProgramTemplateVersionView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static IResult ToResult(TrainingCommandResult result) =>
        result.Status switch
        {
            TrainingCommandStatus.Success => Results.Ok(
                (object?)result.TemplateVersion ??
                result.Mesocycle ??
                (object?)result.SavedSession ??
                (object?)result.SetSave ??
                (object?)result.Draft ??
                (object?)result.TrainingMaxes ??
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
