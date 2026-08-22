import { Component, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  AllergenCode,
  CalculateNutritionTargetsRequest,
  FormulaSex,
  OccupationActivityType,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientNutritionPlan, MealPlanSummary, NutritionCalculation } from './nutrition.models';

@Component({
  selector: 'app-client-nutrition',
  imports: [DecimalPipe, FormsModule],
  templateUrl: './client-nutrition.html',
  styleUrl: './client-nutrition.scss',
})
export class ClientNutrition {
  readonly clientId = input.required<string>();
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedKey: string | null = null;

  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly mealPlans = signal<MealPlanSummary[]>([]);
  protected readonly assignments = signal<ClientNutritionPlan[]>([]);
  protected readonly enrollmentIds = signal<string[]>([]);
  protected readonly calculation = signal<NutritionCalculation | null>(null);
  protected readonly selectedAllergens = signal<Set<AllergenCode>>(new Set());
  protected readonly acknowledgeAllergens = signal(false);

  protected bmrMethodKey = 'MifflinStJeor';
  protected weightKilograms = 80;
  protected heightCentimeters = 175;
  protected ageYears = 30;
  protected sex: FormulaSex = 'Male';
  protected bodyFatPercentage: number | null = null;
  protected occupationType: OccupationActivityType = 'Seated';
  protected averageDailySteps = 6000;
  protected coachGoalAdjustment = -300;
  protected proteinGrams = 150;
  protected fatPercentage = 25;
  protected isEnergyDeficit = true;
  protected mealPlanVersionId = '';
  protected enrollmentId = '';
  protected startDate = '';

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
      const clientId = this.clientId();
      const key = tenantId && clientId ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected async calculate(): Promise<void> {
    const request: CalculateNutritionTargetsRequest = {
      bmrMethodKey: this.bmrMethodKey,
      weightKilograms: this.weightKilograms,
      heightCentimeters: this.heightCentimeters,
      ageYears: this.ageYears,
      sex: this.sex,
      bodyFatPercentage: this.bmrMethodKey === 'KatchMcArdle' ? this.bodyFatPercentage : null,
      occupationType: this.occupationType,
      averageDailySteps: this.averageDailySteps,
      coachGoalAdjustment: this.coachGoalAdjustment,
      calorieTarget: null,
      proteinGrams: this.proteinGrams,
      fatPercentage: this.fatPercentage,
      isEnergyDeficit: this.isEnergyDeficit,
    };
    await this.run(
      async () => {
        this.calculation.set(
          await firstValueFrom(this.api.calculateNutritionTargets(this.clientId(), request)),
        );
      },
      $localize`Nutrition estimates calculated and snapshotted.`,
    );
  }

  protected toggleAllergen(code: AllergenCode, checked: boolean): void {
    const next = new Set(this.selectedAllergens());
    if (checked) {
      next.add(code);
    } else {
      next.delete(code);
    }
    this.selectedAllergens.set(next);
  }

  protected async saveAllergens(): Promise<void> {
    await this.run(
      async () => {
        await firstValueFrom(
          this.api.replaceClientAllergens(this.clientId(), [...this.selectedAllergens()]),
        );
      },
      $localize`Structured allergen declarations saved.`,
    );
  }

  protected async assign(): Promise<void> {
    const calculation = this.calculation();
    if (!calculation || !this.mealPlanVersionId || !this.enrollmentId || !this.startDate) {
      this.error.set(
        $localize`Choose a published plan, nutrition enrollment, start date, and calculation snapshot.`,
      );
      return;
    }

    await this.run(
      async () => {
        await firstValueFrom(
          this.api.assignNutritionPlan(this.clientId(), {
            mealPlanTemplateVersionId: this.mealPlanVersionId,
            enrollmentId: this.enrollmentId,
            calculationSnapshotId: calculation.id,
            startDate: this.startDate,
            acknowledgeAllergenWarnings: this.acknowledgeAllergens(),
          }),
        );
        this.assignments.set(
          await firstValueFrom(this.api.listClientNutritionPlans(this.clientId())),
        );
      },
      $localize`Client nutrition snapshot assigned.`,
    );
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [plans, assignments, commercial] = await Promise.all([
        firstValueFrom(this.api.listMealPlans()),
        firstValueFrom(this.api.listClientNutritionPlans(this.clientId())),
        firstValueFrom(this.api.getClientCommercialOverview(this.clientId())),
      ]);
      const published = plans.items.filter((item) => item.status === 'Published');
      this.mealPlans.set(published);
      this.assignments.set(assignments);
      this.enrollmentIds.set(
        commercial.enrollments
          .filter((item) => item.features.includes('Nutrition'))
          .map((item) => item.id),
      );
      this.mealPlanVersionId ||= published[0]?.versionId ?? '';
      this.enrollmentId ||= this.enrollmentIds()[0] ?? '';
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Client nutrition could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
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
      this.error.set(apiErrorMessage(error, $localize`Nutrition changes could not be saved.`));
    } finally {
      this.busy.set(false);
    }
  }
}
