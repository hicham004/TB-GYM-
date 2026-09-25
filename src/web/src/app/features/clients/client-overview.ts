import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  CheckInAssignmentListItem,
  FeatureAccessReason,
  MesocycleSummary,
  TrainingMesocycleView,
} from '../../core/api/generated';
import { featureAccessReason } from '../../core/api/api-error';
import {
  clientCheckInDenialMessage,
  featureUnavailableLabel,
} from '../../core/i18n/display-labels';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { StatusLabel } from '../../ui/status-label';
import type { ClientNutritionPlan } from '../nutrition/nutrition.models';
import type { ProgressDashboard } from '../progress/progress-dashboard.models';
import {
  activeBlock,
  addDays,
  bodyweightSummary,
  checkInState,
  daysBetween,
  renewalPrompt,
  trainingWeekState,
  trendPath,
  weekContaining,
} from './client-overview.models';
import { ClientWorkspaceContext } from './client-workspace.context';

/** One independently loaded part of the Overview: a failure in one never blanks the others. */
interface Part<T> {
  state: 'loading' | 'ready' | 'error';
  value: T | null;
  /** Set when the server refused the read and said why, which is not the same as a failure. */
  denied: FeatureAccessReason | null;
}

function loading<T>(): Part<T> {
  return { state: 'loading', value: null, denied: null };
}

interface TrainingData {
  blocks: MesocycleSummary[];
  detail: TrainingMesocycleView | null;
}

/** Eight weeks of weekly bodyweight means, ending with the current week. */
const TREND_WEEKS = 8;
const TREND_WIDTH = 240;
const TREND_HEIGHT = 80;

/**
 * The client Overview (Figma 131:419): what needs the coach now, this week across training,
 * nutrition, check-ins and progress, the bodyweight trend and the coach's own note. Every figure
 * comes from an existing read; nothing interprets a check-in answer (CHK-012) and nothing is
 * shown that no API returns (no intake, adherence, activity or sync times).
 */
@Component({
  selector: 'app-client-overview',
  imports: [
    Button,
    ButtonLink,
    Control,
    DatePipe,
    DecimalPipe,
    Field,
    ReactiveFormsModule,
    RouterLink,
    StatusLabel,
  ],
  templateUrl: './client-overview.html',
  styleUrl: './client-overview.scss',
})
export class ClientOverview {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly profile = this.context.profile;
  protected readonly dashboard = signal<Part<ProgressDashboard>>(loading());
  protected readonly training = signal<Part<TrainingData>>(loading());
  protected readonly nutritionPlans = signal<Part<ClientNutritionPlan[]>>(loading());
  protected readonly checkIns = signal<Part<CheckInAssignmentListItem[]>>(loading());
  protected readonly editingNote = signal(false);
  protected readonly noteForm = this.formBuilder.nonNullable.group({
    notes: ['', Validators.maxLength(8000)],
  });
  protected readonly trendWidth = TREND_WIDTH;
  protected readonly trendHeight = TREND_HEIGHT;

  protected readonly today = computed(() => this.context.workspace()?.currentDate ?? null);
  protected readonly week = computed(() => {
    const workspace = this.context.workspace();
    return workspace ? weekContaining(workspace.currentDate, workspace.weekStartsOn) : null;
  });
  protected readonly weekLastDay = computed(() => {
    const week = this.week();
    return week ? addDays(week.endExclusive, -1) : null;
  });
  /** Days of this week up to and including today: what "days logged" is counted against. */
  protected readonly elapsedDays = computed(() => {
    const week = this.week();
    const today = this.today();
    return week && today ? daysBetween(week.start, today) + 1 : 0;
  });

  protected readonly checkIn = computed(() => {
    const today = this.today();
    const part = this.checkIns();
    return today && part.value ? checkInState(part.value, today) : null;
  });

  protected readonly renewal = computed(() => {
    const today = this.today();
    const plans = this.context.plans();
    return today && plans && !this.context.isFormer()
      ? renewalPrompt(plans.enrollments, today)
      : null;
  });

  protected readonly trainingWeek = computed(() => {
    const today = this.today();
    const part = this.training();
    return today && part.value
      ? trainingWeekState(part.value.blocks, part.value.detail, today)
      : null;
  });

  /**
   * Why training figures are withheld, from whichever read reported a refusal. It wins over "no
   * program", which would otherwise invite assigning one the client's plan does not cover.
   */
  protected readonly trainingUnavailable = computed<FeatureAccessReason | null>(() => {
    const section = this.dashboard().value?.training;
    return section && !section.available ? section.reason : this.training().denied;
  });

  protected readonly nutritionUnavailable = computed<FeatureAccessReason | null>(() => {
    const section = this.dashboard().value?.nutrition;
    return section && !section.available ? section.reason : this.nutritionPlans().denied;
  });

  protected readonly trainingCounts = computed(() => {
    const section = this.dashboard().value?.training;
    return section?.available && section.context
      ? {
          done: section.context.recentCompletedWorkoutCount,
          scheduled: section.context.recentScheduledSessionCount,
        }
      : null;
  });

  protected readonly nutritionCounts = computed(() => {
    const section = this.dashboard().value?.nutrition;
    if (!section?.available || !section.context) return null;
    const elapsed = this.elapsedDays();
    const logged = Math.min(section.context.recentLoggedDayCount, elapsed);
    return {
      logged,
      elapsed,
      missing: Math.max(0, elapsed - logged),
      lastLoggedDate: section.context.lastLoggedDate,
    };
  });

  protected readonly calorieTarget = computed(() => {
    const today = this.today();
    const plans = this.nutritionPlans().value;
    if (!today || !plans) return null;
    return (
      plans.find(
        (plan) =>
          plan.status !== 'Cancelled' && plan.startDate <= today && today < plan.endDateExclusive,
      )?.calorieTarget ?? null
    );
  });

  protected readonly bodyweight = computed(() => {
    const dashboard = this.dashboard().value;
    return dashboard ? bodyweightSummary(dashboard.bodyweight.weeks) : null;
  });

  protected readonly massUnit = computed(() =>
    this.dashboard().value?.displayUnit === 'Pound' ? 'lb' : 'kg',
  );

  protected readonly trendStart = computed(() => {
    const week = this.week();
    return week ? addDays(week.start, -7 * (TREND_WEEKS - 1)) : null;
  });

  protected readonly trend = computed(() => {
    const summary = this.bodyweight();
    const start = this.trendStart();
    return summary && start && summary.points.length > 0
      ? trendPath(summary.points, start, TREND_WEEKS, TREND_WIDTH, TREND_HEIGHT)
      : null;
  });

  protected readonly lastPhotoDate = computed(() => {
    const photos = this.dashboard().value?.photos;
    const dates =
      photos?.poses.flatMap((pose) => pose.photos.map((photo) => photo.photoDate)) ?? [];
    return dates.length > 0
      ? dates.reduce((latest, date) => (date > latest ? date : latest))
      : null;
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const workspace = this.context.workspace();
      const former = this.context.isFormer();
      const key =
        tenantId && clientId && workspace && !former
          ? `${tenantId}:${clientId}:${workspace.currentDate}`
          : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.context.refreshPlans();
        void this.loadDashboard();
        void this.loadTraining();
        void this.loadNutrition();
        void this.loadCheckIns();
      }
    });
  }

  protected async loadDashboard(): Promise<void> {
    return this.scope.run('dashboard', async (owner) => {
      const week = this.week();
      if (!week) return;
      this.dashboard.set(loading());
      try {
        // One window serves both reads: its last seven days are exactly this week ("recent"), and
        // the eight weeks behind it carry the bodyweight trend.
        const value = await owner.wait(
          firstValueFrom(
            this.api.getClientProgressDashboard(
              this.context.clientId(),
              addDays(week.start, -7 * (TREND_WEEKS - 1)),
              week.endExclusive,
            ),
          ),
        );
        this.dashboard.set({ state: 'ready', value, denied: null });
      } catch (error) {
        if (!owner.current) return;
        this.dashboard.set({ state: 'error', value: null, denied: featureAccessReason(error) });
      }
    });
  }

  protected async loadTraining(): Promise<void> {
    return this.scope.run('training', async (owner) => {
      const today = this.today();
      if (!today) return;
      this.training.set(loading());
      try {
        const blocks = await owner.wait(
          firstValueFrom(this.api.listClientMesocycles(this.context.clientId())),
        );
        const active = activeBlock(blocks, today);
        const detail = active
          ? await owner.wait(firstValueFrom(this.api.getTrainingMesocycle(active.id)))
          : null;
        this.training.set({ state: 'ready', value: { blocks, detail }, denied: null });
      } catch (error) {
        if (!owner.current) return;
        this.training.set({ state: 'error', value: null, denied: featureAccessReason(error) });
      }
    });
  }

  protected async loadNutrition(): Promise<void> {
    return this.scope.run('nutrition', async (owner) => {
      this.nutritionPlans.set(loading());
      try {
        const value = await owner.wait(
          firstValueFrom(this.api.listClientNutritionPlans(this.context.clientId())),
        );
        this.nutritionPlans.set({ state: 'ready', value, denied: null });
      } catch (error) {
        if (!owner.current) return;
        this.nutritionPlans.set({
          state: 'error',
          value: null,
          denied: featureAccessReason(error),
        });
      }
    });
  }

  protected async loadCheckIns(): Promise<void> {
    return this.scope.run('checkins', async (owner) => {
      this.checkIns.set(loading());
      try {
        const list = await owner.wait(
          firstValueFrom(this.api.listClientCheckInAssignments(this.context.clientId(), 0, 50)),
        );
        this.checkIns.set({ state: 'ready', value: list.items, denied: null });
      } catch (error) {
        if (!owner.current) return;
        this.checkIns.set({ state: 'error', value: null, denied: featureAccessReason(error) });
      }
    });
  }

  protected checkInDenial(reason: FeatureAccessReason): string {
    return clientCheckInDenialMessage(reason);
  }

  /** Why a feature's figures are missing, when the server refused them and said why. */
  protected unavailable(reason: FeatureAccessReason): string {
    return featureUnavailableLabel(reason);
  }

  protected sessionsLeft(count: number): string {
    return count === 1 ? $localize`1 session left` : $localize`${count}:count: sessions left`;
  }

  protected daysNotLogged(count: number): string {
    return count === 1 ? $localize`1 day not logged` : $localize`${count}:count: days not logged`;
  }

  /** A fact about the weekly averages, in the neutral tone: a change is not good or bad here. */
  protected weightChange(change: number): string {
    const amount = `${Math.abs(change).toFixed(1)} ${this.massUnit()}`;
    return change < 0 ? $localize`Down ${amount}:amount:` : $localize`Up ${amount}:amount:`;
  }

  protected noteErrors(): string[] | null {
    const control = this.noteForm.controls.notes;
    return control.touched && control.hasError('maxlength')
      ? [$localize`Keep the note to 8,000 characters or fewer.`]
      : null;
  }

  protected startNoteEdit(): void {
    this.noteForm.reset({ notes: this.profile()?.coachNotes ?? '' });
    this.editingNote.set(true);
  }

  protected cancelNoteEdit(): void {
    this.editingNote.set(false);
  }

  protected async saveNote(): Promise<void> {
    const profile = this.profile();
    if (!profile || this.noteForm.invalid) {
      this.noteForm.markAllAsTouched();
      return;
    }
    const notes = this.noteForm.getRawValue().notes.trim();
    const saved = await this.context.save(
      () => this.api.updateCoachNotes(profile.id, notes || null, profile.version),
      $localize`Coach note saved.`,
    );
    if (saved) this.editingNote.set(false);
  }

  private reset(): void {
    this.loadedKey = null;
    this.dashboard.set(loading());
    this.training.set(loading());
    this.nutritionPlans.set(loading());
    this.checkIns.set(loading());
    this.editingNote.set(false);
  }
}
