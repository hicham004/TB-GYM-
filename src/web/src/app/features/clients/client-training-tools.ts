import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ExerciseHistoryItem,
  ExerciseView,
  StrengthMaxKind,
  StrengthMaxView,
  TrainingLoadUnit,
} from '../../core/api/generated';
import { strengthMaxKindLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { numeric } from '../training/training-builder.models';
import { historySourceWords } from './program-maxes.models';

/**
 * The two older training tools that are not part of a program: the history of a client's training
 * maxes with a form to record one, and how a client has performed one exercise over time. They keep
 * their older forms for now, in a light scope behind "More training tools" (plan §0, follow-ups);
 * the program itself moved to the timeline. The history lists each program's training maxes beside
 * the recorded ones, named with their program (STR-015).
 */
@Component({
  selector: 'app-client-training-tools',
  imports: [DatePipe, FormsModule],
  templateUrl: './client-training-tools.html',
  styleUrl: './client-training-tools.scss',
})
export class ClientTrainingTools {
  readonly clientId = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;

  protected readonly exercises = signal<ExerciseView[]>([]);
  protected readonly maxHistory = signal<StrengthMaxView[]>([]);
  protected readonly maxHistoryTotal = signal(0);
  protected readonly exerciseHistory = signal<ExerciseHistoryItem[]>([]);
  protected readonly exerciseHistoryTotal = signal(0);
  protected readonly historyExerciseId = signal('');
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly maxForm = {
    exerciseId: '',
    kind: 'CoachWorkingMax' as StrengthMaxKind,
    value: null as number | null,
    unit: 'Kilogram' as TrainingLoadUnit,
    effectiveDate: '',
    note: '',
  };
  protected readonly maxKindLabel = strengthMaxKindLabel;

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId && clientId ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.applyWorkspaceDate();
        void this.load();
      }
    });
  }

  /** The date defaults to the workspace's, not the browser's: the server judges dates in its zone. */
  private async applyWorkspaceDate(): Promise<void> {
    return this.scope.run('workspaceDate', async (owner) => {
      const today = await owner.wait(this.calendar.resolveToday());
      if (!this.maxForm.effectiveDate) this.maxForm.effectiveDate = today;
    });
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.error.set(null);
      try {
        const [exercises, maxPage] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.searchExercises({})),
            firstValueFrom(this.maxHistoryPage(0)),
          ]),
        );
        this.exercises.set(exercises.items.filter((item) => !item.isArchived));
        this.maxHistory.set(maxPage.items);
        this.maxHistoryTotal.set(numeric(maxPage.total));
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Training maxes could not be loaded.`));
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  protected async recordMax(): Promise<void> {
    return this.scope.run('recordMax', async (owner) => {
      if (!this.maxForm.exerciseId || !this.maxForm.value || this.maxForm.value <= 0) {
        this.error.set($localize`Exercise and positive max value are required.`);
        return;
      }
      this.busy.set(true);
      this.error.set(null);
      this.notice.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(
          firstValueFrom(
            this.api.recordStrengthMax(this.clientId(), {
              exerciseId: this.maxForm.exerciseId,
              kind: this.maxForm.kind,
              value: this.maxForm.value,
              unit: this.maxForm.unit,
              effectiveDate: this.maxForm.effectiveDate,
              source: 'Manual',
              methodKey: 'CoachEntry',
              methodVersion: '1.0',
              sourceWorkoutExecutionId: null,
              note: this.maxForm.note.trim() || null,
            }),
          ),
        );
        const page = await owner.wait(firstValueFrom(this.maxHistoryPage(0)));
        this.maxHistory.set(page.items);
        this.maxHistoryTotal.set(numeric(page.total));
        this.maxForm.value = null;
        this.maxForm.note = '';
        this.notice.set($localize`Strength max recorded.`);
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The training max could not be saved.`));
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }

  protected async loadMoreMaxHistory(): Promise<void> {
    return this.scope.run('loadMoreMaxHistory', async (owner) => {
      if (this.maxHistory().length >= this.maxHistoryTotal()) return;
      const page = await owner.wait(firstValueFrom(this.maxHistoryPage(this.maxHistory().length)));
      this.maxHistory.update((items) => [...items, ...page.items]);
    });
  }

  protected async loadExerciseHistory(): Promise<void> {
    return this.scope.run('exerciseHistory', async (owner) => {
      if (!this.historyExerciseId()) {
        this.exerciseHistory.set([]);
        this.exerciseHistoryTotal.set(0);
        return;
      }
      this.loading.set(true);
      try {
        const page = await owner.wait(
          firstValueFrom(this.api.getExerciseHistory(this.clientId(), this.historyExerciseId())),
        );
        this.exerciseHistory.set(page.items);
        this.exerciseHistoryTotal.set(numeric(page.total));
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Exercise history could not be loaded.`));
      } finally {
        if (owner.current) this.loading.set(false);
      }
    });
  }

  protected async loadMoreExerciseHistory(): Promise<void> {
    return this.scope.run('exerciseHistory', async (owner) => {
      if (
        !this.historyExerciseId() ||
        this.exerciseHistory().length >= this.exerciseHistoryTotal()
      ) {
        return;
      }
      const page = await owner.wait(
        firstValueFrom(
          this.api.getExerciseHistory(
            this.clientId(),
            this.historyExerciseId(),
            this.exerciseHistory().length,
          ),
        ),
      );
      this.exerciseHistory.update((items) => [...items, ...page.items]);
    });
  }

  protected readonly methodLabel = historySourceWords;

  /** One history per lift: the recorded maxes and every program's training maxes (STR-015). */
  private maxHistoryPage(skip: number) {
    return this.api.listStrengthMaxes(this.clientId(), undefined, skip, 100, true);
  }

  protected displayNumber(value: null | number | string): string {
    return value === null ? '-' : `${numeric(value)}`;
  }

  private resetTenantState(): void {
    Object.assign(this.maxForm, {
      exerciseId: '',
      kind: 'CoachWorkingMax',
      value: null,
      unit: 'Kilogram',
      effectiveDate: '',
      note: '',
    });
    this.loadedKey = null;
    this.exercises.set([]);
    this.maxHistory.set([]);
    this.maxHistoryTotal.set(0);
    this.exerciseHistory.set([]);
    this.exerciseHistoryTotal.set(0);
    this.historyExerciseId.set('');
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
  }
}
