using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

public static class NutritionEndpoints
{
    public static IEndpointRouteBuilder MapNutritionModule(this IEndpointRouteBuilder endpoints)
    {
        var coach = endpoints.MapGroup("/api/nutrition").RequireAuthorization(AuthorizationPolicies.TenantCoach).WithTags(NutritionModule.Name);

        coach.MapGet("/settings", async (INutritionApplicationService service, CancellationToken token) => Results.Ok(await service.GetSettingsAsync(token))).WithName("GetNutritionSettings").Produces<NutritionWorkspaceSettingsView>();
        coach.MapPut("/settings", async (UpdateNutritionSettingsRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateSettingsAsync(request, token));
        }).WithName("UpdateNutritionSettings").Produces<NutritionWorkspaceSettingsView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);

        coach.MapGet("/foods", async (string? query, int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.ListFoodsAsync(query, page.Skip, page.Take, token));
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
        coach.MapGet("/providers/usda/search", async (string query, int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.SearchUsdaAsync(query, page.Skip, page.Take, token));
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

        coach.MapGet("/recipes", async (string? query, int? skip, int? take, INutritionApplicationService service, CancellationToken token) =>
        {
            var page = Page(skip, take);
            return Results.Ok(await service.ListRecipesAsync(query, page.Skip, page.Take, token));
        }).WithName("ListRecipes").Produces<RecipePage>();
        coach.MapPost("/recipes", async (CreateRecipeRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateRecipeAsync(request, token));
        }).WithName("CreateRecipe").Produces<RecipeSummary>().ProducesValidationProblem();
        coach.MapPost("/recipes/{recipeId:guid}/versions", async (Guid recipeId, AddRecipeVersionRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddRecipeVersionAsync(recipeId, request, token));
        }).WithName("AddRecipeVersion").Produces<RecipeSummary>().ProducesValidationProblem().Produces(StatusCodes.Status404NotFound);
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

        coach.MapPost("/clients/{clientProfileId:guid}/calculations", async (Guid clientProfileId, CalculateNutritionTargetsRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CalculateTargetsAsync(clientProfileId, request, token));
        }).WithName("CalculateClientNutritionTargets").Produces<NutritionCalculationView>().ProducesValidationProblem().Produces(StatusCodes.Status403Forbidden);
        coach.MapPost("/clients/{clientProfileId:guid}/calculations/{calculationSnapshotId:guid}/macro-overrides", async (Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.OverrideMacrosAsync(clientProfileId, calculationSnapshotId, request, token));
        }).WithName("OverrideClientNutritionMacros").Produces<MacroOverrideView>().ProducesValidationProblem().Produces(StatusCodes.Status403Forbidden);
        coach.MapPut("/clients/{clientProfileId:guid}/allergens", async (Guid clientProfileId, ReplaceClientAllergensRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReplaceClientAllergensAsync(clientProfileId, request, token));
        }).WithName("ReplaceClientDeclaredAllergens").Produces(StatusCodes.Status200OK).ProducesValidationProblem().Produces(StatusCodes.Status403Forbidden);
        coach.MapGet("/clients/{clientProfileId:guid}/plans", async (Guid clientProfileId, INutritionApplicationService service, CancellationToken token) =>
        {
            var plans = await service.ListClientPlansAsync(clientProfileId, token);
            return plans is null ? Results.Forbid() : Results.Ok(plans);
        }).WithName("ListClientNutritionPlans").Produces<ClientNutritionPlanSummary[]>().Produces(StatusCodes.Status403Forbidden);
        coach.MapPost("/clients/{clientProfileId:guid}/plans", async (Guid clientProfileId, AssignNutritionPlanRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AssignPlanAsync(clientProfileId, request, token));
        }).WithName("AssignClientNutritionPlan").Produces<ClientNutritionPlanSummary>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden);

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
        client.MapPut("/choices", async (RecordNutritionChoiceRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RecordOwnChoiceAsync(request, token));
        }).WithName("RecordOwnNutritionChoice").Produces<ClientNutritionDayView>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden);
        client.MapPost("/logs/{dailyLogId:guid}/complete", async (Guid dailyLogId, CompleteNutritionLogRequest request, HttpContext context, IAntiforgery antiforgery, INutritionApplicationService service, CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CompleteOwnLogAsync(dailyLogId, request, token));
        }).WithName("CompleteOwnNutritionLog").Produces<ClientNutritionDayView>().ProducesProblem(StatusCodes.Status409Conflict).Produces(StatusCodes.Status403Forbidden);

        return endpoints;
    }

    private static IResult ToResult(NutritionCommandResult result) => result.Status switch
    {
        NutritionCommandStatus.Success => Results.Ok((object?)result.Settings ?? result.Food ?? (object?)result.Recipe ?? result.MealPlan ?? (object?)result.Calculation ?? result.CookingFactor ?? (object?)result.MacroOverride ?? result.ClientPlan ?? (object?)result.Day ?? result.AiDraft),
        NutritionCommandStatus.NotFound => Results.NotFound(),
        NutritionCommandStatus.Forbidden => Results.Forbid(),
        NutritionCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        NutritionCommandStatus.ProviderUnavailable => Results.Problem(result.Message, statusCode: StatusCodes.Status503ServiceUnavailable, title: result.Code ?? "nutrition_provider_unavailable"),
        _ => Results.Conflict(new { code = result.Code ?? "nutrition_conflict", message = result.Message ?? "Nutrition state changed or conflicts with another request." }),
    };

    private static (int Skip, int Take) Page(int? skip, int? take) => (Math.Max(skip ?? 0, 0), Math.Clamp(take ?? 25, 1, 100));
}
