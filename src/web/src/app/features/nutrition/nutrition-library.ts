import { DecimalPipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  AiIngredientMappingRequest,
  AllergenCode,
  FoodQuantityUnit,
  PreparationBasis,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  AiMealDraft,
  FoodItem,
  MealPlanSummary,
  NutritionSettings,
  ProviderFoodSearch,
  RecipeSummary,
} from './nutrition.models';

interface RecipeLineEditor {
  foodVersionId: string;
  quantity: number;
  unit: FoodQuantityUnit;
  basis: PreparationBasis;
}

interface MealSlotEditor {
  dayOffset: number;
  order: number;
  name: string;
  recipeVersionId: string;
  servings: number;
}

@Component({
  selector: 'app-nutrition-library',
  imports: [DecimalPipe, FormsModule],
  templateUrl: './nutrition-library.html',
  styleUrl: './nutrition-library.scss',
})
export class NutritionLibrary {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;

  protected readonly foods = signal<FoodItem[]>([]);
  protected readonly recipes = signal<RecipeSummary[]>([]);
  protected readonly mealPlans = signal<MealPlanSummary[]>([]);
  protected readonly settings = signal<NutritionSettings | null>(null);
  protected readonly usda = signal<ProviderFoodSearch | null>(null);
  protected readonly aiDraft = signal<AiMealDraft | null>(null);
  protected readonly recipeLines = signal<RecipeLineEditor[]>([]);
  protected readonly mealSlots = signal<MealSlotEditor[]>([]);
  protected readonly foodAllergens = signal<Set<AllergenCode>>(new Set());
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected foodName = '';
  protected foodBasisQuantity = 100;
  protected foodBasisUnit: FoodQuantityUnit = 'Gram';
  protected foodPreparationBasis: PreparationBasis = 'AsSold';
  protected foodProtein = 0;
  protected foodCarbohydrate = 0;
  protected foodFat = 0;
  protected foodFibre = 0;
  protected foodPolyols = 0;
  protected foodEthanol = 0;
  protected foodProviderCalories: number | null = null;
  protected usdaQuery = '';
  protected recipeName = '';
  protected recipeInstructions = '';
  protected recipeServings = 1;
  protected planName = '';
  protected planDayCount = 1;
  protected planTargetCalories = 2000;
  protected planTargetProtein = 150;
  protected planTargetCarbohydrate = 220;
  protected planTargetFat = 60;
  protected aiPrompt = '';
  protected aiRecipeName = '';
  protected aiInstructions = '';
  protected aiServings = 1;
  protected aiMappings: AiIngredientMappingRequest[] = [];

  protected readonly allergenCodes: AllergenCode[] = [
    'GlutenCereals',
    'Crustaceans',
    'Eggs',
    'Fish',
    'Peanuts',
    'Soybeans',
    'Milk',
    'TreeNuts',
    'Celery',
    'Mustard',
    'Sesame',
    'SulphurDioxideAndSulphites',
    'Lupin',
    'Molluscs',
  ];

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected toggleFoodAllergen(code: AllergenCode, checked: boolean): void {
    const next = new Set(this.foodAllergens());
    if (checked) {
      next.add(code);
    } else {
      next.delete(code);
    }
    this.foodAllergens.set(next);
  }

  protected async createFood(): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(
          this.api.createFood({
            name: this.foodName,
            provenance: 'CoachAuthored',
            externalId: null,
            externalDataType: null,
            labelMediaAssetId: null,
            version: {
              basisQuantity: this.foodBasisQuantity,
              basisUnit: this.foodBasisUnit,
              preparationBasis: this.foodPreparationBasis,
              proteinGrams: this.foodProtein,
              carbohydrateGrams: this.foodCarbohydrate,
              fatGrams: this.foodFat,
              fibreGrams: this.foodFibre,
              polyolGrams: this.foodPolyols,
              ethanolGrams: this.foodEthanol,
              providerCalories: this.foodProviderCalories,
              sourceAttribution: 'Coach-authored food',
              sourceRecordVersion: 'coach-entry-v1',
              declaredAllergens: [...this.foodAllergens()],
            },
          }),
        );
        this.foodName = '';
        await this.reloadFoods();
      },
      $localize`Coach-authored food saved as a canonical version.`,
    );
  }

  protected async searchUsda(): Promise<void> {
    this.error.set(null);
    try {
      const result = await firstValueFrom(this.api.searchUsdaFoods(this.usdaQuery));
      this.usda.set(result);
      if (result.message) {
        this.error.set(result.message);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`USDA FoodData Central search failed.`));
    }
  }

  protected async importUsda(fdcId: string): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(this.api.importUsdaFood(fdcId));
        await this.reloadFoods();
      },
      $localize`USDA FoodData Central record cached locally with attribution.`,
    );
  }

  protected addRecipeLine(): void {
    const food = this.foods()[0];
    if (!food) return;
    this.recipeLines.update((items) => [
      ...items,
      {
        foodVersionId: food.versionId,
        quantity: food.basisQuantity,
        unit: food.basisUnit,
        basis: food.preparationBasis,
      },
    ]);
  }

  protected removeRecipeLine(index: number): void {
    this.recipeLines.update((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  protected foodChanged(line: RecipeLineEditor): void {
    const food = this.foods().find((item) => item.versionId === line.foodVersionId);
    if (food) {
      line.quantity = food.basisQuantity;
      line.unit = food.basisUnit;
      line.basis = food.preparationBasis;
    }
  }

  protected async createRecipe(): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(
          this.api.createRecipe({
            name: this.recipeName,
            instructions: this.recipeInstructions,
            servings: this.recipeServings,
            ingredients: this.recipeLines().map((line) => ({
              foodItemVersionId: line.foodVersionId,
              quantity: line.quantity,
              unit: line.unit,
              basis: line.basis,
              yieldFactorId: null,
              retentionFactorId: null,
            })),
          }),
        );
        this.recipeLines.set([]);
        await this.reloadRecipes();
      },
      $localize`Recipe draft created from canonical food snapshots.`,
    );
  }

  protected async publishRecipe(versionId: string): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(this.api.publishRecipe(versionId));
        await this.reloadRecipes();
      },
      $localize`Recipe version published and locked.`,
    );
  }

  protected addMealSlot(): void {
    const recipe = this.recipes().find((item) => item.status === 'Published');
    if (!recipe) return;
    this.mealSlots.update((items) => [
      ...items,
      {
        dayOffset: 0,
        order: items.length,
        name: $localize`Meal ${items.length + 1}`,
        recipeVersionId: recipe.versionId,
        servings: 1,
      },
    ]);
  }

  protected removeMealSlot(index: number): void {
    this.mealSlots.update((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  protected async createMealPlan(): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(
          this.api.createMealPlan({
            name: this.planName,
            dayCount: this.planDayCount,
            targetCalories: this.planTargetCalories,
            targetProteinGrams: this.planTargetProtein,
            targetCarbohydrateGrams: this.planTargetCarbohydrate,
            targetFatGrams: this.planTargetFat,
            slots: this.mealSlots().map((slot) => ({
              dayOffset: slot.dayOffset,
              order: slot.order,
              name: slot.name,
              choices: [{ recipeVersionId: slot.recipeVersionId, servings: slot.servings }],
            })),
          }),
        );
        this.mealSlots.set([]);
        await this.reloadPlans();
      },
      $localize`Meal-plan draft created with per-choice totals and alternative averages.`,
    );
  }

  protected async publishPlan(versionId: string): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(this.api.publishMealPlan(versionId));
        await this.reloadPlans();
      },
      $localize`Meal-plan version published and locked.`,
    );
  }

  protected async saveSettings(): Promise<void> {
    const settings = this.settings();
    if (!settings) return;
    await this.run(
      async () => {
        this.settings.set(
          await firstValueFrom(
            this.api.updateNutritionSettings({
              energyPolicyKey: settings.energyPolicyKey,
              providerCalorieTolerance: settings.providerCalorieTolerance,
              aiMonthlyRequestLimit: settings.aiMonthlyRequestLimit,
              aiMonthlyCostLimit: settings.aiMonthlyCostLimit,
              aiCostCurrency: settings.aiCostCurrency,
              version: settings.version,
            }),
          ),
        );
      },
      $localize`Nutrition workspace policy saved.`,
    );
  }

  protected async generateAi(): Promise<void> {
    await this.run(
      async () => {
        const draft = await firstValueFrom(
          this.api.generateAiMealDraft({
            prompt: this.aiPrompt,
            promptVersion: 'coach-ui-v1',
            culture: 'en-LB',
          }),
        );
        this.aiDraft.set(draft);
        const count = this.aiIngredientCount(draft);
        const food = this.foods()[0];
        this.aiMappings = food
          ? Array.from({ length: count }, () => ({
              foodItemVersionId: food.versionId,
              quantity: food.basisQuantity,
              unit: food.basisUnit,
              basis: food.preparationBasis,
              yieldFactorId: null,
              retentionFactorId: null,
            }))
          : [];
      },
      $localize`AI draft generated for coach review.`,
    );
  }

  protected async rejectAi(): Promise<void> {
    const draft = this.aiDraft();
    if (!draft) return;
    await this.run(
      async () => {
        this.aiDraft.set(
          await firstValueFrom(
            this.api.reviewAiMealDraft(draft.id, {
              approved: false,
              reason: 'Coach rejected the draft.',
              recipeName: null,
              instructions: null,
              servings: null,
              ingredientMappings: [],
            }),
          ),
        );
      },
      $localize`AI draft rejected.`,
    );
  }

  protected async approveAi(): Promise<void> {
    const draft = this.aiDraft();
    if (!draft) return;
    await this.run(
      async () => {
        this.aiDraft.set(
          await firstValueFrom(
            this.api.reviewAiMealDraft(draft.id, {
              approved: true,
              reason: 'Coach reviewed schema, foods, quantities, and units.',
              recipeName: this.aiRecipeName,
              instructions: this.aiInstructions,
              servings: this.aiServings,
              ingredientMappings: this.aiMappings,
            }),
          ),
        );
        await this.reloadRecipes();
      },
      $localize`AI draft approved into a coach-reviewed recipe draft.`,
    );
  }

  protected updateAiMappingFood(index: number, versionId: string): void {
    const food = this.foods().find((item) => item.versionId === versionId);
    if (!food) return;
    this.aiMappings[index] = {
      foodItemVersionId: food.versionId,
      quantity: food.basisQuantity,
      unit: food.basisUnit,
      basis: food.preparationBasis,
      yieldFactorId: null,
      retentionFactorId: null,
    };
  }

  private aiIngredientCount(draft: AiMealDraft): number {
    if (!draft.validatedDraftJson) return 0;
    try {
      return (
        (JSON.parse(draft.validatedDraftJson) as { ingredients?: unknown[] }).ingredients?.length ??
        0
      );
    } catch {
      return 0;
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [foods, recipes, plans, settings] = await Promise.all([
        firstValueFrom(this.api.listFoods()),
        firstValueFrom(this.api.listRecipes()),
        firstValueFrom(this.api.listMealPlans()),
        firstValueFrom(this.api.getNutritionSettings()),
      ]);
      this.foods.set(foods.items);
      this.recipes.set(recipes.items);
      this.mealPlans.set(plans.items);
      this.settings.set(settings);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Nutrition library could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async reloadFoods(): Promise<void> {
    this.foods.set((await firstValueFrom(this.api.listFoods())).items);
  }
  private async reloadRecipes(): Promise<void> {
    this.recipes.set((await firstValueFrom(this.api.listRecipes())).items);
  }
  private async reloadPlans(): Promise<void> {
    this.mealPlans.set((await firstValueFrom(this.api.listMealPlans())).items);
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.csrf.refresh();
      await action();
      this.notice.set(success);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`The nutrition operation could not be completed.`),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
