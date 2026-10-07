import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
import { SectionNav } from '../../ui/section-nav';
import { FoodPicker } from './food-picker';
import {
  AiMealDraft,
  ALLERGEN_LABELS,
  FoodItem,
  NutritionSettings,
  ProviderFoodSearch,
  preparationLabel,
  RecipeSummary,
  sourceLabel,
  unitLabel,
  UnreportedNutrient,
} from './nutrition.models';

const UNREPORTED_NUTRIENT_NAMES: Record<UnreportedNutrient, string> = {
  Fibre: $localize`fibre`,
  Polyols: $localize`sugar alcohols`,
  Ethanol: $localize`alcohol`,
};

interface RecipeLineEditor {
  foodVersionId: string;
  quantity: number;
  unit: FoodQuantityUnit;
  basis: PreparationBasis;
}

interface AiSuggestion {
  name: string;
  ingredients: { name: string; quantity: number; unit: string; uncertain: boolean }[];
}

interface AiIngredientEditor extends Omit<AiIngredientMappingRequest, 'quantity'> {
  quantity: number;
}

function readAiSuggestion(draft: AiMealDraft | null): AiSuggestion | null {
  if (!draft?.validatedDraftJson) return null;
  try {
    const parsed = JSON.parse(draft.validatedDraftJson) as AiSuggestion;
    return typeof parsed.name === 'string' && Array.isArray(parsed.ingredients) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Recipes and foods: the older library screen, kept for foods, recipes, AI meal suggestions and the
 * calculation defaults until R4.4b and R4.4c rebuild them. Meal plans moved to their own builder
 * (R4.4a, `/nutrition/plans`).
 */
@Component({
  selector: 'app-nutrition-library',
  imports: [DecimalPipe, FoodPicker, FormsModule, RouterLink, SectionNav],
  templateUrl: './nutrition-library.html',
  styleUrl: './nutrition-library.scss',
})
export class NutritionLibrary {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly injector = inject(Injector);
  private readonly aiFeedback = viewChild<ElementRef<HTMLElement>>('aiFeedback');
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;

  protected readonly foods = signal<FoodItem[]>([]);
  protected readonly recipes = signal<RecipeSummary[]>([]);
  protected readonly settings = signal<NutritionSettings | null>(null);
  protected readonly usda = signal<ProviderFoodSearch | null>(null);
  protected readonly aiDraft = signal<AiMealDraft | null>(null);
  protected readonly aiConfigured = signal<boolean | null>(null);
  protected readonly aiError = signal<string | null>(null);
  protected readonly aiNotice = signal<string | null>(null);
  protected readonly aiGenerating = signal(false);
  protected readonly aiSuggestion = computed(() => readAiSuggestion(this.aiDraft()));
  protected readonly recipeLines = signal<RecipeLineEditor[]>([]);
  protected readonly foodAllergens = signal<Set<AllergenCode>>(new Set());
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** USDA ids already in the library, so a search result can say it was added. */
  protected readonly importedFdcIds = computed(
    () =>
      new Set(
        this.foods()
          .filter((food) => food.provenance === 'UsdaFdc' && food.externalId)
          .map((food) => food.externalId),
      ),
  );
  protected readonly sections = [
    { label: $localize`Meal plans`, link: '/nutrition/plans' },
    { label: $localize`Recipes and foods`, link: '/nutrition/library' },
  ];
  protected readonly unitLabel = unitLabel;
  protected readonly preparationLabel = preparationLabel;
  protected readonly sourceLabel = sourceLabel;

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
  protected aiPrompt = '';
  protected aiRecipeName = '';
  protected aiInstructions = '';
  protected aiServings = 1;
  protected aiMappings: AiIngredientEditor[] = [];

  protected readonly allergens = ALLERGEN_LABELS;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
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

  /** Clears the message the coach has read. */
  protected dismissMessage(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  protected async createFood(form: NgForm): Promise<void> {
    if (!this.foodName.trim()) {
      return this.refuse(form, $localize`Give the food a name before saving it.`);
    }

    return this.scope.run('createFood', async (owner) => {
      await owner.wait(
        this.run(
          async () => {
            await owner.wait(
              firstValueFrom(
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
              ),
            );
            this.foodName = '';
            await owner.wait(this.reloadFoods());
          },
          $localize`Food saved.`,
        ),
      );
    });
  }

  protected async searchUsda(): Promise<void> {
    if (!this.usdaQuery.trim()) {
      this.notice.set(null);
      this.error.set($localize`Type a food to search for, like "chicken breast raw".`);
      return;
    }

    return this.scope.run('searchUsda', async (owner) => {
      this.error.set(null);
      try {
        const result = await owner.wait(firstValueFrom(this.api.searchUsdaFoods(this.usdaQuery)));
        this.usda.set(result);
        if (result.message) {
          this.error.set(result.message);
        }
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`USDA FoodData Central search failed.`));
      }
    });
  }

  /** Names the nutrients USDA left out of a food, each saved as 0, so the coach can check them. */
  protected unreportedLabel(food: FoodItem): string {
    return food.unreportedNutrients
      .map((nutrient) => UNREPORTED_NUTRIENT_NAMES[nutrient])
      .join(', ');
  }

  protected async importUsda(fdcId: string): Promise<void> {
    return this.scope.run('importUsda', async (owner) => {
      await owner.wait(
        this.run(
          async () => {
            await owner.wait(firstValueFrom(this.api.importUsdaFood(fdcId)));
            await owner.wait(this.reloadFoods());
          },
          $localize`Food imported from USDA.`,
        ),
      );
    });
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

  protected chooseLineFood(line: RecipeLineEditor, foodVersionId: string): void {
    line.foodVersionId = foodVersionId;
    this.foodChanged(line);
  }

  private foodChanged(line: RecipeLineEditor): void {
    const food = this.foods().find((item) => item.versionId === line.foodVersionId);
    if (food) {
      line.quantity = food.basisQuantity;
      line.unit = food.basisUnit;
      line.basis = food.preparationBasis;
    }
  }

  protected async createRecipe(form: NgForm): Promise<void> {
    const missingName = !this.recipeName.trim();
    const missingInstructions = !this.recipeInstructions.trim();
    if (missingName || missingInstructions) {
      return this.refuse(
        form,
        missingName && missingInstructions
          ? $localize`Give the recipe a name and a few words on how to make it.`
          : missingName
            ? $localize`Give the recipe a name.`
            : $localize`Add a few words on how to make it.`,
      );
    }

    return this.scope.run('createRecipe', async (owner) => {
      await owner.wait(
        this.run(
          async () => {
            await owner.wait(
              firstValueFrom(
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
              ),
            );
            this.recipeLines.set([]);
            await owner.wait(this.reloadRecipes());
          },
          $localize`Recipe draft created.`,
        ),
      );
    });
  }

  protected async publishRecipe(versionId: string): Promise<void> {
    return this.scope.run('publishRecipe', async (owner) => {
      await owner.wait(
        this.run(
          async () => {
            await owner.wait(firstValueFrom(this.api.publishRecipe(versionId)));
            await owner.wait(this.reloadRecipes());
          },
          $localize`Recipe published. It can no longer be edited.`,
        ),
      );
    });
  }

  protected async saveSettings(): Promise<void> {
    return this.scope.run('saveSettings', async (owner) => {
      const settings = this.settings();
      if (!settings) return;
      await owner.wait(
        this.run(
          async () => {
            this.settings.set(
              await owner.wait(
                firstValueFrom(
                  this.api.updateNutritionSettings({
                    energyPolicyKey: settings.energyPolicyKey,
                    providerCalorieTolerance: settings.providerCalorieTolerance,
                    aiMonthlyRequestLimit: settings.aiMonthlyRequestLimit,
                    aiMonthlyCostLimit: settings.aiMonthlyCostLimit,
                    aiCostCurrency: settings.aiCostCurrency,
                    version: settings.version,
                  }),
                ),
              ),
            );
          },
          $localize`Calculation defaults saved.`,
        ),
      );
    });
  }

  protected async generateAi(): Promise<void> {
    if (this.aiConfigured() !== true || this.busy()) return;
    if (!this.aiPrompt.trim() || this.aiPrompt.length > 6000) {
      this.aiError.set($localize`Describe the meal in 1–6,000 characters.`);
      this.focusAiFeedback();
      return;
    }

    return this.scope.run('generateAi', async (owner) => {
      this.aiGenerating.set(true);
      this.aiDraft.set(null);
      this.aiMappings = [];
      try {
        await owner.wait(
          this.run(
            async () => {
              const draft = await owner.wait(
                firstValueFrom(
                  this.api.generateAiMealDraft({
                    prompt: this.aiPrompt,
                    promptVersion: 'coach-ui-v1',
                    culture: 'en-LB',
                  }),
                ),
              );
              this.aiDraft.set(draft);
              const count = this.aiIngredientCount(draft);
              this.aiRecipeName = this.aiSuggestion()?.name ?? '';
              this.aiInstructions = '';
              this.aiMappings = Array.from({ length: count }, () => ({
                foodItemVersionId: '',
                quantity: 0,
                unit: 'Gram',
                basis: 'AsSold',
                yieldFactorId: null,
                retentionFactorId: null,
              }));
            },
            $localize`AI draft generated for coach review.`,
            'ai',
          ),
        );
      } finally {
        if (owner.current) this.aiGenerating.set(false);
      }
    });
  }

  protected async rejectAi(): Promise<void> {
    return this.scope.run('rejectAi', async (owner) => {
      const draft = this.aiDraft();
      if (!draft) return;
      await owner.wait(
        this.run(
          async () => {
            this.aiDraft.set(
              await owner.wait(
                firstValueFrom(
                  this.api.reviewAiMealDraft(draft.id, {
                    approved: false,
                    reason: 'Coach rejected the draft.',
                    recipeName: null,
                    instructions: null,
                    servings: null,
                    ingredientMappings: [],
                  }),
                ),
              ),
            );
          },
          $localize`AI draft rejected.`,
          'ai',
        ),
      );
    });
  }

  protected async approveAi(): Promise<void> {
    if (
      !this.aiRecipeName.trim() ||
      !this.aiInstructions.trim() ||
      this.aiServings <= 0 ||
      this.aiMappings.length === 0 ||
      this.aiMappings.some(
        (mapping) =>
          !mapping.foodItemVersionId || !Number.isFinite(mapping.quantity) || mapping.quantity <= 0,
      )
    ) {
      this.aiError.set(
        $localize`Confirm the recipe name, instructions and servings, then choose a food and quantity for every ingredient.`,
      );
      this.focusAiFeedback();
      return;
    }

    return this.scope.run('approveAi', async (owner) => {
      const draft = this.aiDraft();
      if (!draft) return;
      await owner.wait(
        this.run(
          async () => {
            this.aiDraft.set(
              await owner.wait(
                firstValueFrom(
                  this.api.reviewAiMealDraft(draft.id, {
                    approved: true,
                    reason: 'Coach reviewed schema, foods, quantities, and units.',
                    recipeName: this.aiRecipeName,
                    instructions: this.aiInstructions,
                    servings: this.aiServings,
                    ingredientMappings: this.aiMappings,
                  }),
                ),
              ),
            );
            await owner.wait(this.reloadRecipes());
          },
          $localize`AI draft approved into a coach-reviewed recipe draft.`,
          'ai',
        ),
      );
    });
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
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const [foods, recipes, settings] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listFoods()),
            firstValueFrom(this.api.listRecipes()),
            firstValueFrom(this.api.getNutritionSettings()),
          ]),
        );
        this.foods.set(foods.items);
        this.recipes.set(recipes.items);
        this.settings.set(settings);
        await owner.wait(this.checkAiAvailability());
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Nutrition library could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async reloadFoods(): Promise<void> {
    return this.scope.run('reloadFoods', async (owner) => {
      this.foods.set((await owner.wait(firstValueFrom(this.api.listFoods()))).items);
    });
  }
  private async reloadRecipes(): Promise<void> {
    return this.scope.run('reloadRecipes', async (owner) => {
      this.recipes.set((await owner.wait(firstValueFrom(this.api.listRecipes()))).items);
    });
  }
  /** Stops a save the server would refuse, and highlights the empty boxes that caused it. */
  private refuse(form: NgForm, message: string): void {
    form.control.markAllAsTouched();
    this.notice.set(null);
    this.error.set(message);
  }

  protected async checkAiAvailability(): Promise<void> {
    return this.scope.run('aiAvailability', async (owner) => {
      this.aiConfigured.set(null);
      this.aiError.set(null);
      try {
        const result = await owner.wait(firstValueFrom(this.api.getAiMealDraftAvailability()));
        this.aiConfigured.set(result.isConfigured);
      } catch {
        if (!owner.current) return;
        this.aiError.set(
          $localize`AI suggestions could not be checked. Try checking again, or create the recipe yourself.`,
        );
      }
    });
  }

  private focusAiFeedback(): void {
    afterNextRender(() => this.aiFeedback()?.nativeElement.focus(), { injector: this.injector });
  }

  private async run(
    action: () => Promise<void>,
    success: string,
    feedback: 'page' | 'ai' = 'page',
  ): Promise<void> {
    return this.scope.run('run', async (owner) => {
      const errorMessage = feedback === 'ai' ? this.aiError : this.error;
      const noticeMessage = feedback === 'ai' ? this.aiNotice : this.notice;
      this.busy.set(true);
      errorMessage.set(null);
      noticeMessage.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(action());
        noticeMessage.set(success);
      } catch (error) {
        if (!owner.current) return;
        errorMessage.set(
          apiErrorMessage(error, $localize`The nutrition operation could not be completed.`),
        );
        if (feedback === 'ai') this.focusAiFeedback();
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    this.foods.set([]);
    this.recipes.set([]);
    this.settings.set(null);
    this.usda.set(null);
    this.aiDraft.set(null);
    this.aiConfigured.set(null);
    this.aiError.set(null);
    this.aiNotice.set(null);
    this.aiGenerating.set(false);
    this.recipeLines.set([]);
    this.foodAllergens.set(new Set());
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.foodName = '';
    this.foodBasisQuantity = 100;
    this.foodBasisUnit = 'Gram';
    this.foodPreparationBasis = 'AsSold';
    this.foodProtein = 0;
    this.foodCarbohydrate = 0;
    this.foodFat = 0;
    this.foodFibre = 0;
    this.foodPolyols = 0;
    this.foodEthanol = 0;
    this.foodProviderCalories = null;
    this.usdaQuery = '';
    this.recipeName = '';
    this.recipeInstructions = '';
    this.recipeServings = 1;
    this.aiPrompt = '';
    this.aiRecipeName = '';
    this.aiInstructions = '';
    this.aiServings = 1;
    this.aiMappings = [];
  }
}
