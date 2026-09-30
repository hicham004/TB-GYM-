using TB.Gym.Modules.Nutrition;
using static TB.Gym.Infrastructure.Initialization.DemoStepFailedException;

namespace TB.Gym.Infrastructure.Initialization;

internal sealed partial class DemoWorkspaceGenerator
{
    private async Task BuildMealPlanAsync()
    {
        // Fictional coach-authored values are confined to the development demo.
        var foods = new (string Key, string Name, decimal Protein, decimal Carbs, decimal Fat, PreparationBasis Basis)[]
        {
            ("yogurt", "Greek yogurt", 10m, 4m, 2m, PreparationBasis.AsSold),
            ("oats", "Rolled oats", 13m, 68m, 7m, PreparationBasis.AsSold),
            ("banana", "Banana", 1m, 23m, 0m, PreparationBasis.Raw),
            ("chicken", "Grilled chicken breast", 31m, 0m, 4m, PreparationBasis.Cooked),
            ("rice", "Cooked rice", 3m, 28m, 0m, PreparationBasis.Cooked),
            ("egg", "Boiled egg", 13m, 1m, 11m, PreparationBasis.Cooked),
        };
        var versions = new Dictionary<string, (Guid Id, PreparationBasis Basis)>();
        foreach (var food in foods)
        {
            var result = await As<INutritionApplicationService, NutritionCommandResult>(OwnerActor,
                (service, token) => service.CreateFoodAsync(new CreateFoodItemRequest(
                    food.Name, FoodProvenance.CoachAuthored, null, null, null,
                    new AddFoodVersionRequest(100m, FoodQuantityUnit.Gram, food.Basis,
                        food.Protein, food.Carbs, food.Fat, 0m, 0m, 0m, null,
                        "Atlas Performance fictional demo values", "demo-v1", [])), token));
            var created = Require(result.Food, result.Status == NutritionCommandStatus.Success, $"demo food {food.Name}", result);
            versions[food.Key] = (created.CurrentVersion.Id, food.Basis);
        }

        async Task<Guid> RecipeAsync(string name, params (string Key, decimal Grams)[] ingredients)
        {
            var lines = ingredients.Select(item => new RecipeIngredientRequest(
                versions[item.Key].Id, item.Grams, FoodQuantityUnit.Gram, versions[item.Key].Basis)).ToArray();
            var created = await As<INutritionApplicationService, NutritionCommandResult>(OwnerActor,
                (service, token) => service.CreateRecipeAsync(new CreateRecipeRequest(name, "Atlas demo meal.", 1m, lines), token));
            var draft = Require(created.Recipe, created.Status == NutritionCommandStatus.Success, $"demo recipe {name}", created);
            var published = await As<INutritionApplicationService, NutritionCommandResult>(OwnerActor,
                (service, token) => service.PublishRecipeVersionAsync(draft.VersionId, token));
            return Require(published.Recipe, published.Status == NutritionCommandStatus.Success, $"publish {name}", published).VersionId;
        }

        var breakfast = await RecipeAsync("Yogurt, oats & banana", ("yogurt", 250m), ("oats", 60m), ("banana", 100m));
        var lunch = await RecipeAsync("Grilled chicken & rice", ("chicken", 170m), ("rice", 220m));
        var snack = await RecipeAsync("Yogurt & banana", ("yogurt", 200m), ("banana", 120m));
        var alternative = await RecipeAsync("Egg & rice bowl", ("egg", 160m), ("rice", 180m));
        const int dayCount = 7;
        var slots = Enumerable.Range(0, dayCount).SelectMany(day => new[]
        {
            new MealPlanSlotRequest(day, 0, "Breakfast", [new MealPlanChoiceRequest(breakfast, 1m)]),
            new MealPlanSlotRequest(day, 1, "Lunch", [new MealPlanChoiceRequest(lunch, 1m), new MealPlanChoiceRequest(alternative, 1m)]),
            new MealPlanSlotRequest(day, 2, "Afternoon snack", [new MealPlanChoiceRequest(snack, 1m)]),
            new MealPlanSlotRequest(day, 3, "Dinner", [new MealPlanChoiceRequest(lunch, 1m), new MealPlanChoiceRequest(alternative, 1m)]),
        }).ToArray();
        var plan = await As<INutritionApplicationService, NutritionCommandResult>(OwnerActor,
            (service, token) => service.CreateMealPlanAsync(new CreateMealPlanRequest(
                "Atlas everyday meals", dayCount, 2000m, 120m, 220m, 65m, slots), token));
        var draftPlan = Require(plan.MealPlan, plan.Status == NutritionCommandStatus.Success, "create demo meal plan", plan);
        var publication = await As<INutritionApplicationService, NutritionCommandResult>(OwnerActor,
            (service, token) => service.PublishMealPlanVersionAsync(draftPlan.VersionId, token));
        mealPlanVersionId = Require(publication.MealPlan, publication.Status == NutritionCommandStatus.Success, "publish demo meal plan", publication).VersionId;
    }

    private void PlanNutrition(DemoClientState state)
    {
        timeline.At(calendar.At(-3, 8, 0), $"{state.Client.FirstName}: meal plan", () => AssignMealPlanAsync(state));
        foreach (var day in new[] { -2, -1 })
            timeline.At(calendar.At(day, 13, 0), $"{state.Client.FirstName}: meals {day}", () => LogMealsAsync(state, day, complete: true));
        timeline.At(calendar.EarlierToday(TimeSpan.FromHours(1)), $"{state.Client.FirstName}: meals today",
            () => LogMealsAsync(state, 0, complete: false));
    }

    private async Task AssignMealPlanAsync(DemoClientState state)
    {
        var client = state.Client;
        var target = await As<INutritionApplicationService, NutritionCommandResult>(CoachOf(state),
            (service, token) => service.CalculateTargetsAsync(state.ClientProfileId,
                new CalculateNutritionTargetsRequest(MifflinStJeorBmrStrategy.Key,
                    client.StartWeight, client.HeightCentimeters, client.Age, FormulaSex.Female,
                    null, OccupationActivityType.Seated, client.Steps, -250m, null, 120m, 25m, true), token));
        var calculation = Require(target.Calculation, target.Status == NutritionCommandStatus.Success, $"{client.FirstName}: nutrition target", target);
        var assigned = await As<INutritionApplicationService, NutritionCommandResult>(CoachOf(state),
            (service, token) => service.AssignPlanAsync(state.ClientProfileId,
                new AssignNutritionPlanRequest(mealPlanVersionId, state.EnrollmentIds[^1], calculation.Id,
                    calendar.Day(-3), false), token));
        Require(assigned.ClientPlan, assigned.Status == NutritionCommandStatus.Success, $"{client.FirstName}: assign meals", assigned);
    }

    private async Task LogMealsAsync(DemoClientState state, int offset, bool complete)
    {
        var date = calendar.Day(offset);
        var actor = ClientActor(state);
        var day = await As<INutritionApplicationService, ClientNutritionDayView?>(actor,
            (service, token) => service.GetOwnDayAsync(date, token));
        var current = Require(day, day is not null, $"{state.Client.FirstName}: open meals {date}", date);
        foreach (var slot in current.Slots.Where(slot => complete || slot.Order == 0))
        {
            var selected = slot.Choices[slot.Order == 1 && offset == -1 ? 1 : 0];
            var result = await As<INutritionApplicationService, NutritionCommandResult>(actor,
                (service, token) => service.RecordOwnChoiceAsync(new RecordNutritionChoiceRequest(
                    current.PlanDayId, slot.Id, selected.Id, 1m, current.DailyLogVersion), token));
            current = Require(result.Day, result.Status == NutritionCommandStatus.Success, $"{state.Client.FirstName}: log {slot.Name}", result);
        }

        if (offset == 0 && state.Client.Key == "maya")
        {
            var extra = await As<INutritionApplicationService, NutritionCommandResult>(actor,
                (service, token) => service.AddOwnCustomFoodAsync(new AddNutritionCustomFoodRequest(
                    current.PlanDayId, "Afternoon coffee", 1m, FoodQuantityUnit.Serving,
                    95m, 3m, 12m, 4m, current.DailyLogVersion), token));
            current = Require(extra.Day, extra.Status == NutritionCommandStatus.Success, "Maya: extra food", extra);
        }

        if (complete)
        {
            var finished = await As<INutritionApplicationService, NutritionCommandResult>(actor,
                (service, token) => service.CompleteOwnLogAsync(current.DailyLogId!.Value,
                    new CompleteNutritionLogRequest(current.DailyLogVersion!.Value), token));
            Require(finished.Status == NutritionCommandStatus.Success, $"{state.Client.FirstName}: finish meals {date}", finished);
        }
    }
}
