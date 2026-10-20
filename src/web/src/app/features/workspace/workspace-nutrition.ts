import { formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import type { NutritionWorkspaceSettingsView } from '../../core/api/generated';
import { FormAttempt } from '../../core/forms/form-attempt';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { Control, Field } from '../../ui/field';
import { Skeleton } from '../../ui/skeleton';
import { UiToast } from '../../ui/toast';
import { FoodApi } from '../nutrition/food-api';
import { RecipeApi } from '../nutrition/recipe-api';
import { numeric } from '../training/training-builder.models';
import { SettingsFrame } from '../settings/settings-frame';

export const MAX_TOLERANCE = 500;

export interface NutritionForm {
  policy: string;
  tolerance: number | null;
  requests: number | null;
  cost: number | null;
}

export type NutritionField = 'tolerance' | 'requests' | 'cost';

/** Each box's checks, the same bounds the server holds, with TB Gym's AI ceiling (R4.4c). */
export function nutritionFormIssues(
  form: NutritionForm,
  ceiling: { requests: number; cost: number },
  saved: { requests: number; cost: number },
  locale: string,
): Record<NutritionField, string[]> {
  const issues: Record<NutritionField, string[]> = { tolerance: [], requests: [], cost: [] };
  const whole = (value: number | null) => value !== null && Number.isInteger(value);
  if (form.tolerance === null || !(form.tolerance >= 0) || form.tolerance > MAX_TOLERANCE) {
    issues.tolerance.push($localize`Enter a number from 0 to ${MAX_TOLERANCE}:max: kcal.`);
  }
  // An allowance saved before a lower ceiling may stay as it is; it counts only up to the ceiling.
  if (!whole(form.requests) || form.requests! < 0) {
    issues.requests.push($localize`Enter a whole number, or 0 to turn suggestions off.`);
  } else if (form.requests! > ceiling.requests && form.requests! > saved.requests) {
    issues.requests.push($localize`TB Gym allows up to ${ceiling.requests}:max: a month.`);
  }
  if (form.cost === null || !(form.cost >= 0)) {
    issues.cost.push($localize`Enter an amount, or 0 to turn suggestions off.`);
  } else if (form.cost > ceiling.cost && form.cost > saved.cost) {
    issues.cost.push(
      $localize`TB Gym allows up to USD ${formatNumber(ceiling.cost, locale, '1.2-2')}:max: a month.`,
    );
  }
  return issues;
}

/**
 * Settings › Nutrition (C7 and C9, R4.4c): how calories are counted for every food and recipe in the
 * workspace, when a food's label calories are flagged, and the AI recipe suggestions the workspace
 * allows itself within TB Gym's ceiling. The owner's alone, like every Settings page; the API agrees.
 * Whether suggestions are on is the same answer the recipe editor reads (LOST-4). Leaving with changes
 * asks first, whether by a link, Browser Back, a workspace switch, sign-out or a reload (plan §9,
 * audit COACH-1).
 */
@Component({
  selector: 'app-workspace-nutrition',
  imports: [Button, Control, Field, FormsModule, SettingsFrame, Skeleton, UiConfirm],
  templateUrl: './workspace-nutrition.html',
  styleUrl: './workspace-nutrition.scss',
  host: { class: 'tb-theme', '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class WorkspaceNutrition implements HoldsUnsavedWork {
  private readonly api = inject(FoodApi);
  private readonly recipes = inject(RecipeApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly toast = inject(UiToast);
  private readonly dialogs = inject(UiDialog);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly leaveDialog = viewChild.required<TemplateRef<unknown>>('leaveDialog');
  private loadedTenantId: string | null = null;

  protected readonly leaveMessage = $localize`Your changes to these settings aren’t saved. If you leave now, they are lost.`;
  protected readonly leaveConfirm = $localize`Leave without saving`;
  protected readonly leaveCancel = $localize`Stay`;
  protected readonly attempt = new FormAttempt();
  protected readonly saved = signal<NutritionWorkspaceSettingsView | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly form = signal<NutritionForm>({
    policy: 'Atwater',
    tolerance: 25,
    requests: 0,
    cost: 0,
  });
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Someone saved these settings after this page loaded them. */
  protected readonly conflict = signal(false);
  /** Whether a coach can ask for a suggestion: set up, with TB Gym's ceiling above zero. */
  private readonly aiAvailable = signal(false);

  protected readonly ceiling = computed(() => {
    const saved = this.saved();
    return {
      requests: saved ? numeric(saved.aiMaximumMonthlyRequests) : 0,
      cost: saved ? numeric(saved.aiMaximumMonthlyCost) : 0,
    };
  });
  protected readonly aiOff = computed(() => !this.aiAvailable());
  protected readonly ceilingRequests = computed(
    () =>
      $localize`TB Gym allows up to ${this.ceiling().requests}:max: a month. 0 turns suggestions off.`,
  );
  protected readonly ceilingCost = computed(
    () =>
      $localize`TB Gym allows up to USD ${formatNumber(this.ceiling().cost, this.locale, '1.2-2')}:max:. A suggestion costs a few cents.`,
  );
  protected readonly issues = computed(() => {
    const saved = this.saved();
    return nutritionFormIssues(
      this.form(),
      this.ceiling(),
      {
        requests: saved ? numeric(saved.aiMonthlyRequestLimit) : 0,
        cost: saved ? numeric(saved.aiMonthlyCostLimit) : 0,
      },
      this.locale,
    );
  });

  /** The form differs from the settings as saved. */
  protected readonly dirty = computed(() => {
    const saved = this.saved();
    if (!saved) return false;
    const form = this.form();
    return (
      form.policy !== saved.energyPolicyKey ||
      form.tolerance !== numeric(saved.providerCalorieTolerance) ||
      form.requests !== numeric(saved.aiMonthlyRequestLimit) ||
      form.cost !== numeric(saved.aiMonthlyCostLimit)
    );
  });

  constructor() {
    // A workspace switch and a sign-out ask too: both change the session before any route changes.
    const unregister = inject(UnsavedWork).register(this);
    inject(DestroyRef).onDestroy(unregister);
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.saved.set(null);
      this.loadFailed.set(false);
      this.aiAvailable.set(false);
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  /** Asks before the router, a workspace switch or a sign-out drops changes not saved yet (plan §9). */
  async canLeave(): Promise<boolean> {
    if (!this.dirty() || this.saving()) return true;
    const dialog = this.dialogs.open<boolean>(this.leaveDialog(), {
      title: $localize`Leave without saving?`,
      closeLabel: $localize`Close`,
      closeOnNavigation: false,
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  protected shown(field: NutritionField): string[] | null {
    const messages = this.issues()[field];
    return this.attempt.shows(field, messages) ? messages : null;
  }

  protected setPolicy(policy: string): void {
    this.form.update((form) => ({ ...form, policy }));
  }

  protected setNumber(field: NutritionField, value: number | string | null): void {
    const parsed = value === null || value === '' ? null : numeric(value);
    const key = field === 'tolerance' ? 'tolerance' : field === 'requests' ? 'requests' : 'cost';
    this.form.update((form) => ({ ...form, [key]: Number.isFinite(parsed) ? parsed : null }));
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loadFailed.set(false);
      this.conflict.set(false);
      try {
        // A failed availability read leaves suggestions off, as the recipe editor does.
        const [settings, availability] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getSettings()),
            firstValueFrom(this.recipes.aiAvailability()).catch(() => ({ isConfigured: false })),
          ]),
        );
        this.aiAvailable.set(availability.isConfigured);
        this.adopt(settings);
      } catch {
        if (owner.current) this.loadFailed.set(true);
      }
    });
  }

  protected async save(): Promise<void> {
    const saved = this.saved();
    if (!saved || this.saving()) return;
    const issues = this.issues();
    if (issues.tolerance.length || issues.requests.length || issues.cost.length) {
      this.attempt.attempt();
      return;
    }
    const form = this.form();
    return this.scope.run('save', async (owner) => {
      this.saving.set(true);
      this.saveError.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const next = await owner.wait(
          firstValueFrom(
            this.api.updateSettings({
              energyPolicyKey: form.policy,
              providerCalorieTolerance: form.tolerance ?? 0,
              aiMonthlyRequestLimit: form.requests ?? 0,
              aiMonthlyCostLimit: form.cost ?? 0,
              aiCostCurrency: saved.aiCostCurrency,
              version: saved.version,
            }),
          ),
        );
        this.adopt(next);
        this.toast.show($localize`Nutrition settings saved.`, { tone: 'success' });
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.conflict.set(true);
        } else {
          this.saveError.set(
            apiErrorMessage(error, $localize`The settings could not be saved. Try again.`),
          );
        }
      } finally {
        if (owner.current) this.saving.set(false);
      }
    });
  }

  private adopt(settings: NutritionWorkspaceSettingsView): void {
    this.saved.set(settings);
    this.form.set({
      policy: settings.energyPolicyKey,
      tolerance: numeric(settings.providerCalorieTolerance),
      requests: numeric(settings.aiMonthlyRequestLimit),
      cost: numeric(settings.aiMonthlyCostLimit),
    });
    this.attempt.reset();
    this.conflict.set(false);
  }
}
