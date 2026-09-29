import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { Component, effect, inject, input, LOCALE_ID, signal } from '@angular/core';
import { DatePipe, DecimalPipe, formatDate } from '@angular/common';
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
import { addDays } from '../clients/client-overview.models';
import {
  ALLERGEN_LABELS,
  ClientNutritionPlan,
  MealPlanSummary,
  NutritionCalculation,
} from './nutrition.models';

@Component({
  selector: 'app-client-nutrition',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './client-nutrition.html',
  styleUrl: './client-nutrition.scss',
})
export class ClientNutrition {
  readonly clientId = input.required<string>();
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;

  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly mealPlans = signal<MealPlanSummary[]>([]);
  protected readonly assignments = signal<ClientNutritionPlan[]>([]);
  protected readonly enrollmentOptions = signal<{ id: string; label: string }[]>([]);
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

  protected readonly allergens = ALLERGEN_LABELS;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
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
    return this.scope.run('calculate', async (owner) => {
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
      await owner.wait(
        this.run(
          async () => {
            this.calculation.set(
              await owner.wait(
                firstValueFrom(this.api.calculateNutritionTargets(this.clientId(), request)),
              ),
            );
          },
          $localize`Targets calculated.`,
        ),
      );
    });
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
    return this.scope.run('saveAllergens', async (owner) => {
      await owner.wait(
        this.run(
          async () => {
            await owner.wait(
              firstValueFrom(
                this.api.replaceClientAllergens(this.clientId(), [...this.selectedAllergens()]),
              ),
            );
          },
          $localize`Allergens saved.`,
        ),
      );
    });
  }

  protected async assign(): Promise<void> {
    return this.scope.run('assign', async (owner) => {
      const calculation = this.calculation();
      if (!calculation || !this.mealPlanVersionId || !this.enrollmentId || !this.startDate) {
        this.error.set(
          $localize`Calculate targets first, then choose a meal plan, a plan and a start date.`,
        );
        return;
      }

      await owner.wait(
        this.run(
          async () => {
            await owner.wait(
              firstValueFrom(
                this.api.assignNutritionPlan(this.clientId(), {
                  mealPlanTemplateVersionId: this.mealPlanVersionId,
                  enrollmentId: this.enrollmentId,
                  calculationSnapshotId: calculation.id,
                  startDate: this.startDate,
                  acknowledgeAllergenWarnings: this.acknowledgeAllergens(),
                }),
              ),
            );
            this.assignments.set(
              await owner.wait(firstValueFrom(this.api.listClientNutritionPlans(this.clientId()))),
            );
          },
          $localize`Meal plan assigned.`,
        ),
      );
    });
  }

  /** Meal plans end on a half-open date; people read the last day it covers. */
  protected lastDay(endDateExclusive: string): string {
    return addDays(endDateExclusive, -1);
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const [plans, assignments, commercial] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listMealPlans()),
            firstValueFrom(this.api.listClientNutritionPlans(this.clientId())),
            firstValueFrom(this.api.getClientCommercialOverview(this.clientId())),
          ]),
        );
        const published = plans.items.filter((item) => item.status === 'Published');
        this.mealPlans.set(published);
        this.assignments.set(assignments);
        this.enrollmentOptions.set(
          commercial.enrollments
            .filter((item) => item.features.includes('Nutrition'))
            .map((item) => ({
              id: item.id,
              label: `${item.productName} · ${formatDate(item.startDate, 'd MMM', this.locale)} – ${formatDate(item.lastActiveDate, 'd MMM y', this.locale)}`,
            })),
        );
        this.mealPlanVersionId ||= published[0]?.versionId ?? '';
        this.enrollmentId ||= this.enrollmentOptions()[0]?.id ?? '';
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Client nutrition could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
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
        this.error.set(apiErrorMessage(error, $localize`Nutrition changes could not be saved.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private resetTenantState(): void {
    this.loadedKey = null;
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.mealPlans.set([]);
    this.assignments.set([]);
    this.enrollmentOptions.set([]);
    this.calculation.set(null);
    this.selectedAllergens.set(new Set());
    this.acknowledgeAllergens.set(false);
    this.bmrMethodKey = 'MifflinStJeor';
    this.weightKilograms = 80;
    this.heightCentimeters = 175;
    this.ageYears = 30;
    this.sex = 'Male';
    this.bodyFatPercentage = null;
    this.occupationType = 'Seated';
    this.averageDailySteps = 6000;
    this.coachGoalAdjustment = -300;
    this.proteinGrams = 150;
    this.fatPercentage = 25;
    this.isEnergyDeficit = true;
    this.mealPlanVersionId = '';
    this.enrollmentId = '';
    this.startDate = '';
  }
}
