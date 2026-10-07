import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { AllergenCode, FoodQuantityUnit, PreparationBasis } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { SectionNav } from '../../ui/section-nav';
import {
  ALLERGEN_LABELS,
  FoodItem,
  NutritionSettings,
  ProviderFoodSearch,
  preparationLabel,
  sourceLabel,
  unitLabel,
  UnreportedNutrient,
} from './nutrition.models';
import { NUTRITION_SECTIONS } from './nutrition-sections';

const UNREPORTED_NUTRIENT_NAMES: Record<UnreportedNutrient, string> = {
  Fibre: $localize`fibre`,
  Polyols: $localize`sugar alcohols`,
  Ethanol: $localize`alcohol`,
};

/**
 * Foods: the older library screen, kept for foods, USDA imports and the calculation defaults until
 * R4.4c rebuilds it. Meal plans (R4.4a) and recipes with AI suggestions (R4.4b) have their own pages.
 */
@Component({
  selector: 'app-nutrition-library',
  imports: [DecimalPipe, FormsModule, SectionNav],
  templateUrl: './nutrition-library.html',
  styleUrl: './nutrition-library.scss',
})
export class NutritionLibrary {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedTenantId: string | null = null;

  protected readonly foods = signal<FoodItem[]>([]);
  protected readonly settings = signal<NutritionSettings | null>(null);
  protected readonly usda = signal<ProviderFoodSearch | null>(null);
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
  protected readonly sections = NUTRITION_SECTIONS;
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

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const [foods, settings] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listFoods()),
            firstValueFrom(this.api.getNutritionSettings()),
          ]),
        );
        this.foods.set(foods.items);
        this.settings.set(settings);
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
  /** Stops a save the server would refuse, and highlights the empty boxes that caused it. */
  private refuse(form: NgForm, message: string): void {
    form.control.markAllAsTouched();
    this.notice.set(null);
    this.error.set(message);
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    return this.scope.run('run', async (owner) => {
      this.busy.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(action());
        this.notice.set(success);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(
          apiErrorMessage(error, $localize`The nutrition operation could not be completed.`),
        );
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
    this.settings.set(null);
    this.usda.set(null);
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
  }
}
