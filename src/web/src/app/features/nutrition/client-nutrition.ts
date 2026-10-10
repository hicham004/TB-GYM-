import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type { AllergenCode, FeatureAccessReason } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill, type StatusPillTone } from '../../ui/status-pill';
import { ClientWorkspaceContext } from '../clients/client-workspace.context';
import { ProgressEntriesApi } from '../progress/progress-entries-api';
import { ClientNutritionApi } from './client-nutrition-api';
import { ClientNutritionSheets, type NutritionChange } from './client-nutrition-sheets';
import {
  addDaysIso,
  ageOn,
  allergenList,
  allergenName,
  inListOrder,
  mapPlan,
  mapWorkedOut,
  nutritionClosed,
  nutritionCovers,
  planDates,
  planStateWords,
  splitPlans,
  workedOutOn,
  type PlanRow,
  type PlanState,
  type Starting,
  type WorkedOut,
} from './client-nutrition.models';
import { TargetsResult } from './targets-result';

type PageState = 'loading' | 'ready' | 'denied' | 'error';

/** A meal plan with its dates and state already in words. */
interface PlanView {
  readonly row: PlanRow;
  readonly dates: string;
  readonly state: string;
  readonly tone: StatusPillTone;
}

const PLAN_TONES: Record<PlanState, StatusPillTone> = {
  running: 'success',
  coming: 'info',
  ended: 'neutral',
  stopped: 'warning',
};

/**
 * A client's Nutrition tab for their coach (C3, C7; R5.3d): the targets worked out, the meal plan they
 * are on, the allergens declared, and what the client said about food. Each of the three changes is a
 * sheet. Every number is the server's; this page reads, shows and asks, and a plan that does not
 * include Nutrition says so instead of "could not be loaded".
 */
@Component({
  selector: 'app-client-nutrition',
  imports: [
    Button,
    ClientNutritionSheets,
    DecimalPipe,
    RouterLink,
    Skeleton,
    StatusPill,
    TargetsResult,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-nutrition.html',
  styleUrl: './client-nutrition.scss',
})
export class ClientNutrition {
  protected readonly context = inject(ClientWorkspaceContext);
  private readonly api = inject(ClientNutritionApi);
  private readonly progress = inject(ProgressEntriesApi);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly tenants = inject(TenantStore);
  protected readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;

  private readonly sheets = viewChild.required(ClientNutritionSheets);

  protected readonly loadingLabel = $localize`Reading their nutrition`;
  protected readonly state = signal<PageState>('loading');
  protected readonly deniedReason = signal<FeatureAccessReason | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly today = signal('');
  protected readonly calculations = signal<WorkedOut[]>([]);
  protected readonly planRows = signal<PlanRow[]>([]);
  protected readonly declared = signal<AllergenCode[]>([]);
  /** The latest weigh-in, read when the calculation sheet is opened. */
  private readonly weight = signal<{ value: number; on: string } | null>(null);
  protected readonly preparing = signal(false);
  protected readonly refreshFailed = signal(false);

  protected readonly clientId = computed(() => this.context.clientId());
  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');
  protected readonly name = computed(() => this.firstName() || $localize`This client`);
  protected readonly timeZone = computed(() => this.context.workspace()?.timeZoneId ?? 'UTC');
  protected readonly covers = computed(() =>
    nutritionCovers(this.context.plans()?.enrollments ?? []),
  );

  protected readonly latest = computed(() => this.calculations()[0] ?? null);
  protected readonly earlier = computed(() => this.calculations().slice(1));
  private readonly split = computed(() => splitPlans(this.planRows()));
  protected readonly currentPlan = computed(() => this.view(this.split().current));
  protected readonly otherPlans = computed(() =>
    this.split()
      .others.map((row) => this.view(row))
      .filter((item): item is PlanView => item !== null),
  );
  protected readonly earlierWorkedOut = computed(() =>
    this.earlier().map((item) => ({ item, on: this.workedOn(item) })),
  );
  protected readonly declaredNames = computed(() =>
    inListOrder(this.declared()).map((code) => allergenName(code).replace(/ \(.*\)$/, '')),
  );
  protected readonly declaredWords = computed(() => allergenList(this.declared()));
  protected readonly closedMessage = computed(() => {
    const reason = this.deniedReason();
    return reason ? nutritionClosed(reason, this.name()) : '';
  });

  /** What they said about food, in their own words, left out when empty. */
  protected readonly theirWords = computed(() => {
    const profile = this.context.profile();
    const said = [
      { label: $localize`Allergies`, text: profile?.allergies },
      { label: $localize`Likes`, text: profile?.foodPreferences },
      { label: $localize`Dislikes`, text: profile?.foodAversions },
      { label: $localize`Their goal`, text: profile?.goals },
    ];
    return said
      .filter((item) => (item.text ?? '').trim() !== '')
      .map((item) => ({ label: item.label, text: (item.text ?? '').trim() }));
  });
  protected readonly allergiesWords = computed(() => {
    const text = (this.context.profile()?.allergies ?? '').trim();
    return text === '' ? null : text;
  });

  protected readonly starting = computed<Starting>(() => {
    const profile = this.context.profile();
    const height = profile?.heightCentimeters;
    const steps = profile?.averageDailySteps;
    return {
      weight: this.weight(),
      height: height === null || height === undefined ? null : Number(height),
      age: ageOn(profile?.birthDate, this.today()),
      steps: steps === null || steps === undefined ? null : Number(steps),
    };
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const ready = this.context.workspace() !== null && this.context.profile() !== null;
      const key = tenantId && clientId && ready ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load();
      }
    });
  }

  protected workedOn(item: WorkedOut): string {
    return workedOutOn(item.calculatedAtUtc, this.timeZone(), this.today(), this.locale);
  }

  private view(row: PlanRow | null): PlanView | null {
    return row
      ? {
          row,
          dates: planDates(row, this.today(), this.locale),
          state: planStateWords(row, this.today(), this.locale),
          tone: PLAN_TONES[row.state],
        }
      : null;
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      this.loadError.set(null);
      // The plan already says whether Nutrition is included, so a client without it is not asked:
      // the server would refuse with the same reason.
      const decision = this.context
        .plans()
        ?.featureAccess.find((item) => item.feature === 'Nutrition');
      if (decision && !decision.isAllowed) {
        this.deniedReason.set(decision.reason);
        this.state.set('denied');
        return;
      }
      const clientId = this.context.clientId();
      try {
        const [today, allergens, calculations, plans] = await owner.wait(
          Promise.all([
            this.calendar.resolveToday(),
            firstValueFrom(this.api.allergens(clientId)),
            firstValueFrom(this.api.calculations(clientId, 5)),
            firstValueFrom(this.api.plans(clientId)),
          ]),
        );
        this.today.set(today);
        this.declared.set(allergens.codes);
        this.calculations.set(calculations.map(mapWorkedOut));
        this.planRows.set(plans.map((plan) => mapPlan(plan, today)));
        this.state.set('ready');
      } catch (error) {
        if (!owner.current) return;
        const reason = featureAccessReason(error);
        if (reason !== null) {
          this.deniedReason.set(reason);
          this.state.set('denied');
        } else {
          this.loadError.set(
            apiErrorMessage(error, $localize`Their nutrition could not be loaded.`),
          );
          this.state.set('error');
        }
      }
    });
  }

  /** After a sheet saved: read that part again, keeping what is on screen if the read fails. */
  protected async refresh(change: NutritionChange): Promise<void> {
    return this.scope.run(`refresh-${change}`, async (owner) => {
      const clientId = this.context.clientId();
      this.refreshFailed.set(false);
      try {
        switch (change) {
          case 'targets': {
            const items = await owner.wait(firstValueFrom(this.api.calculations(clientId, 5)));
            this.calculations.set(items.map(mapWorkedOut));
            break;
          }
          case 'plans': {
            const items = await owner.wait(firstValueFrom(this.api.plans(clientId)));
            this.planRows.set(items.map((plan) => mapPlan(plan, this.today())));
            break;
          }
          case 'allergens': {
            const items = await owner.wait(firstValueFrom(this.api.allergens(clientId)));
            this.declared.set(items.codes);
            break;
          }
        }
      } catch {
        if (owner.current) this.refreshFailed.set(true);
      }
    });
  }

  protected async workOut(): Promise<void> {
    if (this.preparing()) return;
    this.preparing.set(true);
    await this.scope.run('prepare', async (owner) => {
      try {
        const today = this.today();
        const from = addDaysIso(today, -83);
        const read = await owner.wait(
          firstValueFrom(this.progress.weighIns(this.context.clientId(), 'Kilogram', from, null)),
        );
        const latest = [...read.days].reverse().find((day) => day.observation !== null);
        this.weight.set(
          latest?.observation
            ? { value: latest.observation.valueKilograms, on: latest.date }
            : null,
        );
      } catch {
        // No weigh-in to start from is not a reason to stop: the coach types the weight.
        if (owner.current) this.weight.set(null);
      } finally {
        if (owner.current) this.preparing.set(false);
      }
    });
    if (this.state() === 'ready') this.sheets().workOut();
  }

  protected assign(): void {
    this.sheets().assign();
  }

  protected editAllergens(): void {
    this.sheets().editAllergens();
  }

  private reset(): void {
    this.loadedKey = null;
    this.state.set('loading');
    this.deniedReason.set(null);
    this.loadError.set(null);
    this.today.set('');
    this.calculations.set([]);
    this.planRows.set([]);
    this.declared.set([]);
    this.weight.set(null);
    this.preparing.set(false);
    this.refreshFailed.set(false);
  }
}
