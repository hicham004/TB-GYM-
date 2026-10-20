using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

public static class NutritionEndpoints
{
    /// <summary>A draft as the builder sends it, with room for the nulls it writes out in full.</summary>
    private const long MaximumDraftRequestBytes = MealPlanDraftShape.MaximumContentLength * 3L;

    public static IEndpointRouteBuilder MapNutritionModule(this IEndpointRouteBuilder endpoints)
    {
        var coach = endpoints.MapGroup("/api/nutrition").RequireAuthorization(AuthorizationPolicies.TenantCoach).WithTags(NutritionModule.Name);

        coach.MapGet("/ai-drafts/availability", (INutritionApplicationService service) => Results.Ok(service.GetAiAvailability()))
            .WithName("GetAiMealDraftAvailability").Produces<AiMealDraftAvailabilityView>();

        coach.MapGet("/settings", async (INutritionApplicationService service, CancellationToken token) => Results.Ok(await service.GetSettingsAsync(token))).WithName("GetNutritionSettings").Produces<NutritionWorkspaceSettingsView>();
        coach.MapPut("/settings", async (UpdateNutritionSettingsRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateSettingsAsync(request, token));
        }).WithName("UpdateNutritionSettings").Produces<NutritionWorkspaceSettingsView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict)
            // Workspace-wide calculation defaults and the AI allowance are a Settings page (R4.4c).
            .RequireAuthorization(AuthorizationPolicies.TenantOwner);

        // The workspace's foods, or with archived=true only those archived (R4.4c).
        coach.MapGet("/foods", async (string? query, bool? archived, int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.ListFoodsAsync(query, archived ?? false, page.Skip, page.Take, token));
        }).WithName("ListFoodItems").Produces<FoodItemPage>();
        coach.MapPost("/foods", async (CreateFoodItemRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateFoodAsync(request, token));
        }).WithName("CreateFoodItem").Produces<FoodItemView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);
        coach.MapPost("/foods/{foodItemId:guid}/versions", async (Guid foodItemId, AddFoodVersionRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddFoodVersionAsync(foodItemId, request, token));
        }).WithName("AddFoodItemVersion").Produces<FoodItemView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);
        coach.MapPut("/foods/{foodItemId:guid}/archive", async (Guid foodItemId, SetFoodArchivedRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SetFoodArchivedAsync(foodItemId, request, token));
        }).WithName("SetFoodItemArchived").Produces<FoodItemView>().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status404NotFound);
        coach.MapGet("/providers/usda/search", async (string query, FoodSearchKind? kind, int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.SearchUsdaAsync(query, kind ?? FoodSearchKind.Basic, page.Skip, page.Take, token));
        }).WithName("SearchUsdaFoodDataCentral").Produces<ProviderFoodSearchPage>();
        coach.MapPost("/providers/usda/import", async (ImportUsdaFoodRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ImportUsdaFoodAsync(request, token));
        }).WithName("ImportUsdaFoodDataCentralFood").Produces<FoodItemView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        coach.MapGet("/cooking-factors", async (int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.ListCookingFactorsAsync(page.Skip, page.Take, token));
        }).WithName("ListCookingFactors").Produces<CookingFactorPage>();
        coach.MapPost("/cooking-factors", async (CreateCookingFactorRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateCookingFactorAsync(request, token));
        }).WithName("CreateCookingFactor").Produces<CookingFactorView>().ProducesValidationProblem();

        coach.MapGet("/recipes", async (string? query, int? skip, int? take, bool? published, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.ListRecipesAsync(query, page.Skip, page.Take, published == true, token));
        }).WithName("ListRecipes").Produces<RecipePage>();
        coach.MapGet("/recipes/{recipeId:guid}", async (Guid recipeId, INutritionApplicationService service, CancellationToken token) =>
        {
            var recipe = await service.GetRecipeAsync(recipeId, token);
            return recipe is null ? Results.NotFound() : Results.Ok(recipe);
        }).WithName("GetRecipe").Produces<RecipeDetail>().Produces(StatusCodes.Status404NotFound);
        coach.MapPost("/recipes", async (CreateRecipeRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateRecipeAsync(request, token));
        }).WithName("CreateRecipe").Produces<RecipeSummary>().ProducesValidationProblem();
        coach.MapPost("/recipes/{recipeId:guid}/versions", async (Guid recipeId, AddRecipeVersionRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddRecipeVersionAsync(recipeId, request, token));
        }).WithName("AddRecipeVersion").Produces<RecipeSummary>().ProducesValidationProblem().Produces(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);
        coach.MapPost("/recipe-versions/{recipeVersionId:guid}/publish", async (Guid recipeVersionId, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.PublishRecipeVersionAsync(recipeVersionId, token));
        }).WithName("PublishRecipeVersion").Produces<RecipeSummary>().ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/meal-plans", async (int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.ListMealPlansAsync(page.Skip, page.Take, token));
        }).WithName("ListMealPlanTemplates").Produces<MealPlanTemplatePage>();
        coach.MapPost("/meal-plans", async (CreateMealPlanRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateMealPlanAsync(request, token));
        }).WithName("CreateMealPlanTemplate").Produces<MealPlanTemplateSummary>().ProducesValidationProblem();
        coach.MapPost("/meal-plans/{mealPlanTemplateId:guid}/versions", async (Guid mealPlanTemplateId, AddMealPlanVersionRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddMealPlanVersionAsync(mealPlanTemplateId, request, token));
        }).WithName("AddMealPlanTemplateVersion").Produces<MealPlanTemplateSummary>().ProducesValidationProblem().Produces(StatusCodes.Status404NotFound);
        coach.MapPost("/meal-plan-versions/{mealPlanVersionId:guid}/publish", async (Guid mealPlanVersionId, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.PublishMealPlanVersionAsync(mealPlanVersionId, token));
        }).WithName("PublishMealPlanTemplateVersion").Produces<MealPlanTemplateSummary>().ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/meal-plans/{mealPlanTemplateId:guid}", async (Guid mealPlanTemplateId, INutritionApplicationService service, CancellationToken token) =>
        {
            var plan = await service.GetMealPlanAsync(mealPlanTemplateId, token);
            return plan is null ? Results.NotFound() : Results.Ok(plan);
        }).WithName("GetMealPlanTemplate").Produces<MealPlanTemplateDetail>().Produces(StatusCodes.Status404NotFound);
        coach.MapGet("/meal-plan-versions/{mealPlanVersionId:guid}", async (Guid mealPlanVersionId, INutritionApplicationService service, CancellationToken token) =>
        {
            var version = await service.GetMealPlanVersionAsync(mealPlanVersionId, token);
            return version is null ? Results.NotFound() : Results.Ok(version);
        }).WithName("GetMealPlanTemplateVersion").Produces<MealPlanVersionView>().Produces(StatusCodes.Status404NotFound);

        // The meal-plan builder's working copies (NUT-013, R4.4a), as the program builder keeps them.
        coach.MapGet("/meal-plan-drafts", async (INutritionApplicationService service, CancellationToken token) =>
            Results.Ok(await service.ListMealPlanDraftsAsync(token)))
            .WithName("ListMealPlanDrafts").Produces<MealPlanDraftSummary[]>();
        coach.MapGet("/meal-plan-drafts/{draftId:guid}", async (Guid draftId, INutritionApplicationService service, CancellationToken token) =>
        {
            var draft = await service.GetMealPlanDraftAsync(draftId, token);
            return draft is null ? Results.NotFound() : Results.Ok(draft);
        }).WithName("GetMealPlanDraft").Produces<MealPlanDraftView>().Produces(StatusCodes.Status404NotFound);
        coach.MapPost("/meal-plan-drafts", async (CreateMealPlanDraftRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateMealPlanDraftAsync(request, token));
        }).WithName("CreateMealPlanDraft").WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
            .Produces<MealPlanDraftSaveView>().ProducesValidationProblem().Produces(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);
        coach.MapPut("/meal-plan-drafts/{draftId:guid}", async (Guid draftId, SaveMealPlanDraftRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SaveMealPlanDraftAsync(draftId, request, token));
        }).WithName("SaveMealPlanDraft").WithMetadata(new RequestSizeLimitAttribute(MaximumDraftRequestBytes))
            .Produces<MealPlanDraftSaveView>().ProducesValidationProblem().Produces(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);
        coach.MapPost("/meal-plan-drafts/{draftId:guid}/discard", async (Guid draftId, DiscardMealPlanDraftRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.DiscardMealPlanDraftAsync(draftId, request, token);
            return result.Status == NutritionCommandStatus.Success ? Results.NoContent() : ToResult(result);
        }).WithName("DiscardMealPlanDraft").Produces(StatusCodes.Status204NoContent).Produces(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);
        coach.MapPost("/meal-plan-drafts/{draftId:guid}/publish", async (Guid draftId, PublishMealPlanDraftRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.PublishMealPlanDraftAsync(draftId, request, token));
        }).WithName("PublishMealPlanDraft").Produces<MealPlanTemplateSummary>().ProducesValidationProblem().Produces(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);

        // A client that is not in the workspace is 404 on every route that names one (SEC-8), as in the
        // other modules; a client whose Nutrition is closed is 403.
        coach.MapPost("/clients/{clientProfileId:guid}/calculations", async (Guid clientProfileId, CalculateNutritionTargetsRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CalculateTargetsAsync(clientProfileId, request, token));
        }).WithName("CalculateClientNutritionTargets").Produces<NutritionCalculationView>().ProducesValidationProblem().Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        // The coach's own macros (NUT-008, INV-2): recorded with why, as new targets for the next plan.
        coach.MapPost("/clients/{clientProfileId:guid}/calculations/{calculationSnapshotId:guid}/macro-overrides", async (Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.OverrideMacrosAsync(clientProfileId, calculationSnapshotId, request, token));
        }).WithName("OverrideClientNutritionMacros").Produces<NutritionCalculationRecord>().ProducesValidationProblem().Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        coach.MapPut("/clients/{clientProfileId:guid}/allergens", async (Guid clientProfileId, ReplaceClientAllergensRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReplaceClientAllergensAsync(clientProfileId, request, token));
        }).WithName("ReplaceClientDeclaredAllergens").Produces(StatusCodes.Status200OK).ProducesValidationProblem().Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        coach.MapGet("/clients/{clientProfileId:guid}/allergens", async (Guid clientProfileId, INutritionApplicationService service, CancellationToken token) =>
            ToReadResult(await service.GetClientAllergensAsync(clientProfileId, token)))
            .WithName("GetClientDeclaredAllergens").Produces<ClientAllergensView>().Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        coach.MapGet("/clients/{clientProfileId:guid}/calculations", async (Guid clientProfileId, int? take, INutritionApplicationService service, CancellationToken token) =>
            ToReadResult(await service.ListCalculationsAsync(clientProfileId, Math.Clamp(take ?? 5, 1, 20), token)))
            .WithName("ListClientNutritionCalculations").Produces<NutritionCalculationRecord[]>().Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        coach.MapGet("/clients/{clientProfileId:guid}/plans", async (Guid clientProfileId, INutritionApplicationService service, CancellationToken token) =>
            ToReadResult(await service.ListClientPlansAsync(clientProfileId, token)))
            .WithName("ListClientNutritionPlans").Produces<ClientNutritionPlanSummary[]>().Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        coach.MapPost("/clients/{clientProfileId:guid}/plans", async (Guid clientProfileId, AssignNutritionPlanRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AssignPlanAsync(clientProfileId, request, token));
        }).WithName("AssignClientNutritionPlan").Produces<ClientNutritionPlanSummary>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/clients/{clientProfileId:guid}/plans/{planId:guid}/cancel", async (Guid clientProfileId, Guid planId, CancelNutritionPlanRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CancelPlanAsync(clientProfileId, planId, request, token));
        }).WithName("CancelClientNutritionPlan").Produces<ClientNutritionPlanSummary>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);

        coach.MapPost("/ai-drafts", async (GenerateAiMealDraftRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.GenerateAiDraftAsync(request, token));
        }).WithName("GenerateAiMealDraft").Produces<AiMealDraftView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        coach.MapPost("/ai-drafts/{operationId:guid}/review", async (Guid operationId, ReviewAiMealDraftRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReviewAiDraftAsync(operationId, request, token));
        }).WithName("ReviewAiMealDraft").Produces<AiMealDraftView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);

        var client = endpoints.MapGroup("/api/nutrition/me").RequireAuthorization(AuthorizationPolicies.TenantClient).WithTags(NutritionModule.Name);
        client.MapGet("/day", async (DateOnly? localDate, INutritionApplicationService service, CancellationToken token) =>
        {
            var day = await service.GetOwnDayAsync(localDate, token);
            return day is null ? Results.NotFound() : Results.Ok(day);
        }).WithName("GetOwnNutritionDay").Produces<ClientNutritionDayView>().Produces(StatusCodes.Status404NotFound);
        client.MapGet("/recipes/{recipeId:guid}", async (Guid recipeId, INutritionApplicationService service, CancellationToken token) =>
        {
            var recipe = await service.GetOwnRecipeAsync(recipeId, token);
            return recipe is null ? Results.NotFound() : Results.Ok(recipe);
        }).WithName("GetOwnPlanRecipe").Produces<ClientPlanRecipeView>().Produces(StatusCodes.Status404NotFound);
        client.MapPut("/choices", async (RecordNutritionChoiceRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RecordOwnChoiceAsync(request, token));
        }).WithName("RecordOwnNutritionChoice").Produces<ClientNutritionDayView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden);
        client.MapPost("/custom-foods", async (AddNutritionCustomFoodRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddOwnCustomFoodAsync(request, token));
        }).WithName("AddOwnNutritionCustomFood").Produces<ClientNutritionDayView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden);
        client.MapPost("/custom-foods/{foodId:guid}/reverse", async (Guid foodId, ReverseNutritionCustomFoodRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReverseOwnCustomFoodAsync(foodId, request, token));
        }).WithName("ReverseOwnNutritionCustomFood").Produces<ClientNutritionDayView>().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound);
        client.MapPost("/logs/{dailyLogId:guid}/complete", async (Guid dailyLogId, CompleteNutritionLogRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CompleteOwnLogAsync(dailyLogId, request, token));
        }).WithName("CompleteOwnNutritionLog").Produces<ClientNutritionDayView>().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden);

        return endpoints;
    }

    private static IResult ToResult(NutritionCommandResult result) => result.Status switch
    {
        NutritionCommandStatus.Success => Results.Ok((object?)result.Settings ?? result.Food ?? (object?)result.Recipe ?? result.MealPlan ?? (object?)result.Calculation ?? result.CookingFactor ?? (object?)result.CalculationRecord ?? result.ClientPlan ?? (object?)result.Day ?? (object?)result.AiDraft ?? result.MealPlanDraft),
        NutritionCommandStatus.NotFound => Results.NotFound(),
        NutritionCommandStatus.Forbidden => Results.Forbid(),
        NutritionCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        NutritionCommandStatus.ProviderUnavailable => Results.Problem(
            result.Message,
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: result.Code ?? "nutrition_provider_unavailable",
            extensions: new Dictionary<string, object?> { ["code"] = result.Code ?? "nutrition_provider_unavailable", ["message"] = result.Message }),
        _ => Results.Conflict(new { code = result.Code ?? "nutrition_conflict", message = result.Message ?? "Nutrition state changed or conflicts with another request." }),
    };

    private static IResult ToReadResult<T>(ClientNutritionRead<T> read) where T : class => read.Reach switch
    {
        ClientNutritionReach.Allowed => Results.Ok(read.Value),
        ClientNutritionReach.NotFound => Results.NotFound(),
        _ => Results.Forbid(),
    };

    private static (int Skip, int Take) Page(int? skip, int? take) => (Math.Max(skip ?? 0, 0), Math.Clamp(take ?? 25, 1, 100));
}
