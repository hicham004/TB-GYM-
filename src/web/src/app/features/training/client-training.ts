import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, formatDate } from '@angular/common';
import { Component, computed, effect, inject, input, LOCALE_ID, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CoachWorkout } from './coach-workout';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ExerciseHistoryItem,
  ExerciseView,
  MesocycleSummary,
  ProgramTemplateSummary,
  ProgramTemplateVersionSummary,
  ProgressionPreviewView,
  SavedSessionView,
  StrengthMaxKind,
  StrengthMaxView,
  TrainingLoadRoundingMode,
  TrainingLoadUnit,
  TrainingMesocycleView,
} from '../../core/api/generated';
import type { ClientCommercialOverview, ClientEnrollment } from '../../core/api/api.models';
import { mesocycleStatusLabel, strengthMaxKindLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { addDays } from '../clients/client-overview.models';
import { numeric, sessionFromSaved, toTrainingSessionRequest } from './training-builder.models';
import { changeWorkingMaxUnit, IntentIdempotencyKey } from './training-assignment-state';

interface TemplateOption extends ProgramTemplateVersionSummary {
  templateId: string;
  templateName: string;
}

interface WorkingMaxInput {
  exerciseId: string;
  exerciseName: string;
  value: number | null;
  unit: TrainingLoadUnit;
  sourceRecordId: string | null;
}

@Component({
  selector: 'app-client-training',
  imports: [DatePipe, FormsModule, CoachWorkout],
  templateUrl: './client-training.html',
  styleUrl: './client-training.scss',
})
export class ClientTraining {
  readonly clientId = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;
  private readonly assignmentIntent = new IntentIdempotencyKey();

  protected readonly commercial = signal<ClientCommercialOverview | null>(null);
  protected readonly templates = signal<ProgramTemplateSummary[]>([]);
  protected readonly templateTotal = signal(0);
  protected readonly exercises = signal<ExerciseView[]>([]);
  protected readonly maxHistory = signal<StrengthMaxView[]>([]);
  protected readonly maxHistoryTotal = signal(0);
  protected readonly mesocycles = signal<MesocycleSummary[]>([]);
  protected readonly selectedMesocycle = signal<TrainingMesocycleView | null>(null);
  protected readonly savedSessions = signal<SavedSessionView[]>([]);
  protected readonly workingMaxes = signal<WorkingMaxInput[]>([]);
  protected readonly progressionWeeks = signal<ReadonlySet<string>>(new Set());
  protected readonly progressionPreview = signal<ProgressionPreviewView | null>(null);
  protected readonly exerciseHistory = signal<ExerciseHistoryItem[]>([]);
  protected readonly exerciseHistoryTotal = signal(0);
  protected readonly historyExerciseId = signal('');
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly assignment = {
    enrollmentId: '',
    templateVersionId: '',
    // Filled from the workspace's own calendar once it answers; see WorkspaceCalendar.
    startDate: '',
    loadUnit: 'Kilogram' as TrainingLoadUnit,
    loadIncrement: 2.5,
    loadRoundingMode: 'Nearest' as TrainingLoadRoundingMode,
  };
  protected readonly maxForm = {
    exerciseId: '',
    kind: 'CoachWorkingMax' as StrengthMaxKind,
    value: null as number | null,
    unit: 'Kilogram' as TrainingLoadUnit,
    effectiveDate: '',
    note: '',
  };
  protected readonly progression = { iterations: 3, rpeIncrement: 0.5 };
  protected readonly replacementSessionIds: Record<string, string> = {};
  protected rescheduleDate = '';
  protected cancelReason = '';
  protected readonly maxKindLabel = strengthMaxKindLabel;
  protected readonly mesocycleStatusLabel = mesocycleStatusLabel;
  protected readonly progressionCoverageFallback = $localize`These weeks run past the end of the client's plan.`;

  protected readonly trainingEnrollments = computed(() =>
    (this.commercial()?.enrollments ?? []).filter(
      (enrollment) =>
        enrollment.features.includes('Training') &&
        enrollment.storedStatus !== 'Cancelled' &&
        enrollment.storedStatus !== 'Expired',
    ),
  );
  protected readonly publishedVersions = computed<TemplateOption[]>(() =>
    this.templates().flatMap((template) =>
      template.versions
        .filter((version) => version.isPublished)
        .map((version) => ({ ...version, templateId: template.id, templateName: template.name })),
    ),
  );

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.clientId();
      const key = tenantId && clientId ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.applyWorkspaceDates();
        void this.load();
      }
    });
  }

  /**
   * Date defaults come from the workspace, not the browser: the server judges a start date in the
   * workspace's time zone, so at 01:00 in Asia/Beirut the browser's UTC date is a day behind.
   * A date the coach has already set is left alone.
   */
  private async applyWorkspaceDates(): Promise<void> {
    return this.scope.run('workspaceDates', async (owner) => {
      const today = await owner.wait(this.calendar.resolveToday());
      if (!this.assignment.startDate) this.assignment.startDate = today;
      if (!this.maxForm.effectiveDate) this.maxForm.effectiveDate = today;
    });
  }

  protected async templateChanged(): Promise<void> {
    return this.scope.run('templateChanged', async (owner) => {
      const versionId = this.assignment.templateVersionId;
      if (!versionId) {
        this.workingMaxes.set([]);
        return;
      }

      this.busy.set(true);
      try {
        const version = await owner.wait(
          firstValueFrom(this.api.getProgramTemplateVersion(versionId)),
        );
        const relevant = new Map<string, string>();
        for (const week of version.weeks) {
          for (const session of week.sessions) {
            for (const exercise of session.exercises) {
              if (
                exercise.sets.some(
                  (set) =>
                    set.loadStrategy === 'PercentageWorkingMax' ||
                    set.loadStrategy === 'RpeBasedEpley',
                )
              ) {
                relevant.set(exercise.exerciseId, exercise.exerciseName);
              }
            }
          }
        }
        this.workingMaxes.set(
          [...relevant].map(([exerciseId, exerciseName]) =>
            this.defaultWorkingMax(exerciseId, exerciseName, this.assignment.loadUnit),
          ),
        );
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The program details could not be loaded.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  protected loadUnitChanged(): void {
    this.workingMaxes.set(changeWorkingMaxUnit(this.workingMaxes(), this.assignment.loadUnit));
  }

  protected updateWorkingMax(index: number, value: number | null): void {
    const next = [...this.workingMaxes()];
    next[index] = { ...next[index], value, sourceRecordId: null };
    this.workingMaxes.set(next);
  }

  protected async assign(): Promise<void> {
    return this.scope.run('assign', async (owner) => {
      const rows = this.workingMaxes();
      if (
        !this.assignment.enrollmentId ||
        !this.assignment.templateVersionId ||
        !this.assignment.startDate ||
        rows.some((item) => item.value === null || item.value <= 0)
      ) {
        this.error.set(
          $localize`Choose a plan, a published program and a start date, and fill in every training max.`,
        );
        return;
      }

      await owner.wait(
        this.runWrite(async () => {
          const payload = {
            enrollmentId: this.assignment.enrollmentId,
            templateVersionId: this.assignment.templateVersionId,
            startDate: this.assignment.startDate,
            kind: 'Primary' as const,
            loadUnit: this.assignment.loadUnit,
            loadIncrement: this.assignment.loadIncrement,
            loadRoundingMode: this.assignment.loadRoundingMode,
            workingMaxes: rows.map((item) => ({
              exerciseId: item.exerciseId,
              strengthMaxRecordId: item.sourceRecordId,
              value: item.value!,
              unit: item.unit,
            })),
          };
          const mesocycle = await owner.wait(
            firstValueFrom(
              this.api.assignClientMesocycle(this.clientId(), {
                ...payload,
                idempotencyKey: this.assignmentIntent.forPayload(payload),
              }),
            ),
          );
          this.assignmentIntent.complete();
          await owner.wait(this.reloadMesocycles());
          this.setMesocycle(mesocycle);
          this.notice.set($localize`Program assigned.`);
        }),
      );
    });
  }

  protected async openMesocycle(id: string): Promise<void> {
    return this.scope.run('openMesocycle', async (owner) => {
      this.busy.set(true);
      this.clearMessages();
      try {
        this.setMesocycle(await owner.wait(firstValueFrom(this.api.getTrainingMesocycle(id))));
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The program block could not be loaded.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  protected async toggleReveal(): Promise<void> {
    return this.scope.run('toggleReveal', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      if (!mesocycle) {
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.updateMesocycleVisibility(mesocycle.id, {
            revealAllWeeks: !mesocycle.revealAllWeeks,
            version: numeric(mesocycle.version),
          }),
        ),
      );
    });
  }

  protected async togglePublished(weekId: string, isPublished: boolean): Promise<void> {
    return this.scope.run('togglePublished', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      if (!mesocycle) {
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.setMesocycleWeekPublished(mesocycle.id, weekId, {
            isPublished,
            version: numeric(mesocycle.version),
          }),
        ),
      );
    });
  }

  protected async reschedule(): Promise<void> {
    return this.scope.run('reschedule', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      if (!mesocycle || !this.rescheduleDate) {
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.rescheduleMesocycle(mesocycle.id, {
            startDate: this.rescheduleDate,
            version: numeric(mesocycle.version),
          }),
        ),
      );
    });
  }

  protected async cancelMesocycle(): Promise<void> {
    return this.scope.run('cancelMesocycle', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      const reason = this.cancelReason.trim();
      if (!mesocycle || this.isTerminal(mesocycle) || !reason) {
        this.error.set($localize`A cancellation reason is required.`);
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.cancelTrainingMesocycle(mesocycle.id, {
            reason,
            version: numeric(mesocycle.version),
          }),
        ),
      );
      this.cancelReason = '';
    });
  }

  protected async completeMesocycle(): Promise<void> {
    return this.scope.run('completeMesocycle', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      if (!mesocycle || mesocycle.status !== 'Active') {
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.completeTrainingMesocycle(mesocycle.id, {
            version: numeric(mesocycle.version),
          }),
        ),
      );
    });
  }

  protected isTerminal(mesocycle: TrainingMesocycleView): boolean {
    return mesocycle.status === 'Completed' || mesocycle.status === 'Cancelled';
  }

  protected toggleProgressionWeek(weekId: string, event: Event): void {
    const next = new Set(this.progressionWeeks());
    if ((event.target as HTMLInputElement).checked) {
      next.add(weekId);
    } else {
      next.delete(weekId);
    }
    this.progressionWeeks.set(next);
    this.progressionPreview.set(null);
  }

  protected async previewProgression(): Promise<void> {
    return this.scope.run('previewProgression', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      if (!mesocycle || this.isTerminal(mesocycle)) {
        return;
      }
      if (this.progressionWeeks().size === 0) {
        this.error.set($localize`Select at least one source week.`);
        return;
      }
      if (this.progression.iterations < 1 || this.progression.iterations > 12) {
        this.error.set($localize`Add between 1 and 12 weeks.`);
        return;
      }
      if (
        this.progression.rpeIncrement < -2 ||
        this.progression.rpeIncrement > 2 ||
        this.progression.rpeIncrement * 2 !== Math.trunc(this.progression.rpeIncrement * 2)
      ) {
        this.error.set($localize`RPE change must be between -2 and 2 in half-step increments.`);
        return;
      }
      await owner.wait(
        this.runWrite(async () => {
          this.progressionPreview.set(
            await owner.wait(
              firstValueFrom(
                this.api.previewTrainingProgression(mesocycle.id, {
                  sourceWeekIds: [...this.progressionWeeks()],
                  iterations: this.progression.iterations,
                  rpeIncrement: this.progression.rpeIncrement,
                  mesocycleVersion: numeric(mesocycle.version),
                }),
              ),
            ),
          );
        }),
      );
    });
  }

  protected async applyProgression(): Promise<void> {
    return this.scope.run('applyProgression', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      const preview = this.progressionPreview();
      if (!mesocycle || !preview || !preview.isInsideTrainingCoverage) {
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.applyTrainingProgression(mesocycle.id, {
            sourceWeekIds: [...this.progressionWeeks()],
            iterations: this.progression.iterations,
            rpeIncrement: this.progression.rpeIncrement,
            previewHash: preview.previewHash,
            mesocycleVersion: numeric(mesocycle.version),
          }),
        ),
      );
      this.progressionPreview.set(null);
      this.progressionWeeks.set(new Set());
    });
  }

  protected progressionChanged(): void {
    this.progressionPreview.set(null);
  }

  protected async replaceSession(sessionId: string): Promise<void> {
    return this.scope.run('replaceSession', async (owner) => {
      const mesocycle = this.selectedMesocycle();
      const saved = this.savedSessions().find(
        (item) => item.id === this.replacementSessionIds[sessionId],
      );
      if (!mesocycle || !saved) {
        return;
      }
      await owner.wait(
        this.runMesocycleWrite(() =>
          this.api.replaceFutureTrainingSession(mesocycle.id, sessionId, {
            session: toTrainingSessionRequest(sessionFromSaved(saved)),
            version: numeric(mesocycle.version),
          }),
        ),
      );
      this.replacementSessionIds[sessionId] = '';
    });
  }

  protected async recordMax(): Promise<void> {
    return this.scope.run('recordMax', async (owner) => {
      if (!this.maxForm.exerciseId || !this.maxForm.value || this.maxForm.value <= 0) {
        this.error.set($localize`Exercise and positive max value are required.`);
        return;
      }
      await owner.wait(
        this.runWrite(async () => {
          await owner.wait(
            firstValueFrom(
              this.api.recordStrengthMax(this.clientId(), {
                exerciseId: this.maxForm.exerciseId,
                kind: this.maxForm.kind,
                value: this.maxForm.value!,
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
          const page = await owner.wait(
            firstValueFrom(this.api.listStrengthMaxes(this.clientId())),
          );
          this.maxHistory.set(page.items);
          this.maxHistoryTotal.set(numeric(page.total));
          this.maxForm.value = null;
          this.maxForm.note = '';
          this.notice.set($localize`Strength max recorded.`);
        }),
      );
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
        if (owner.current) {
          this.loading.set(false);
        }
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

  protected async loadMoreMaxHistory(): Promise<void> {
    return this.scope.run('loadMoreMaxHistory', async (owner) => {
      if (this.maxHistory().length >= this.maxHistoryTotal()) {
        return;
      }
      const page = await owner.wait(
        firstValueFrom(
          this.api.listStrengthMaxes(this.clientId(), undefined, this.maxHistory().length),
        ),
      );
      this.maxHistory.update((items) => [...items, ...page.items]);
    });
  }

  protected async loadMoreTemplates(): Promise<void> {
    return this.scope.run('loadMoreTemplates', async (owner) => {
      if (this.templates().length >= this.templateTotal()) {
        return;
      }
      const page = await owner.wait(
        firstValueFrom(this.api.listProgramTemplates(this.templates().length)),
      );
      this.templates.update((items) => [...items, ...page.items]);
    });
  }

  protected enrollmentLabel(enrollment: ClientEnrollment): string {
    const start = formatDate(enrollment.startDate, 'd MMM', this.locale);
    const last = formatDate(enrollment.lastActiveDate, 'd MMM y', this.locale);
    return `${enrollment.productName} · ${enrollment.offerLabel} · ${start} – ${last}`;
  }

  /** Blocks end on a half-open date; people read the last day they train. */
  protected lastDay(endDateExclusive: string): string {
    return addDays(endDateExclusive, -1);
  }

  protected methodLabel(record: StrengthMaxView): string {
    return record.methodKey === 'CoachEntry'
      ? $localize`Entered by coach`
      : `${record.methodKey} v${record.methodVersion}`;
  }

  protected displayNumber(value: null | number | string): string {
    return value === null ? '-' : `${numeric(value)}`;
  }

  private async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.loading.set(true);
      this.clearMessages();
      try {
        const [commercial, templatePage, exercises, maxPage, mesocycles, savedSessions] =
          await owner.wait(
            Promise.all([
              firstValueFrom(this.api.getClientCommercialOverview(this.clientId())),
              firstValueFrom(this.api.listProgramTemplates()),
              firstValueFrom(this.api.searchExercises({})),
              firstValueFrom(this.api.listStrengthMaxes(this.clientId())),
              firstValueFrom(this.api.listClientMesocycles(this.clientId())),
              firstValueFrom(this.api.listSavedSessions()),
            ]),
          );
        this.commercial.set(commercial);
        this.templates.set(templatePage.items);
        this.templateTotal.set(numeric(templatePage.total));
        this.exercises.set(exercises.items.filter((item) => !item.isArchived));
        this.maxHistory.set(maxPage.items);
        this.maxHistoryTotal.set(numeric(maxPage.total));
        this.mesocycles.set(mesocycles);
        this.savedSessions.set(savedSessions);
        this.assignment.enrollmentId = this.trainingEnrollments()[0]?.id ?? '';
        this.assignment.templateVersionId = this.publishedVersions()[0]?.id ?? '';
        if (this.assignment.templateVersionId) {
          await owner.wait(this.templateChanged());
        }
        if (mesocycles[0]) {
          this.setMesocycle(
            await owner.wait(firstValueFrom(this.api.getTrainingMesocycle(mesocycles[0].id))),
          );
        }
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`Client training could not be loaded.`));
      } finally {
        if (owner.current) {
          this.loading.set(false);
        }
      }
    });
  }

  private async reloadMesocycles(): Promise<void> {
    return this.scope.run('reloadMesocycles', async (owner) => {
      this.mesocycles.set(
        await owner.wait(firstValueFrom(this.api.listClientMesocycles(this.clientId()))),
      );
    });
  }

  private async runMesocycleWrite(
    command: () => ReturnType<ApiClient['updateMesocycleVisibility']>,
  ): Promise<void> {
    return this.scope.run('runMesocycleWrite', async (owner) => {
      await owner.wait(
        this.runWrite(async () => {
          const mesocycle = await owner.wait(firstValueFrom(command()));
          this.setMesocycle(mesocycle);
          await owner.wait(this.reloadMesocycles());
          this.notice.set($localize`Program block updated.`);
        }),
      );
    });
  }

  private async runWrite(command: () => Promise<void>): Promise<void> {
    return this.scope.run('runWrite', async (owner) => {
      this.busy.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        await owner.wait(command());
      } catch (error) {
        if (!owner.current) return;
        this.error.set(apiErrorMessage(error, $localize`The training change could not be saved.`));
      } finally {
        if (owner.current) {
          this.busy.set(false);
        }
      }
    });
  }

  private defaultWorkingMax(
    exerciseId: string,
    exerciseName: string,
    unit: TrainingLoadUnit,
  ): WorkingMaxInput {
    const matching = this.maxHistory().filter(
      (item) => item.exerciseId === exerciseId && item.unit === unit,
    );
    const source = matching.find((item) => item.kind === 'CoachWorkingMax') ?? matching[0];
    return {
      exerciseId,
      exerciseName,
      value: source ? numeric(source.value) : null,
      unit,
      sourceRecordId: source?.id ?? null,
    };
  }

  private setMesocycle(mesocycle: TrainingMesocycleView): void {
    this.selectedMesocycle.set(mesocycle);
    this.rescheduleDate = mesocycle.startDate;
    this.cancelReason = '';
    this.progressionPreview.set(null);
    this.progressionWeeks.set(new Set());
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private resetTenantState(): void {
    Object.assign(this.assignment, {
      enrollmentId: '',
      templateVersionId: '',
      startDate: '',
      loadUnit: 'Kilogram',
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
    });
    Object.assign(this.maxForm, {
      exerciseId: '',
      kind: 'CoachWorkingMax',
      value: null,
      unit: 'Kilogram',
      effectiveDate: '',
      note: '',
    });
    Object.assign(this.progression, { iterations: 3, rpeIncrement: 0.5 });
    this.loadedKey = null;
    this.assignmentIntent.complete();
    this.commercial.set(null);
    this.templates.set([]);
    this.templateTotal.set(0);
    this.exercises.set([]);
    this.maxHistory.set([]);
    this.maxHistoryTotal.set(0);
    this.mesocycles.set([]);
    this.selectedMesocycle.set(null);
    this.savedSessions.set([]);
    this.workingMaxes.set([]);
    this.progressionWeeks.set(new Set());
    this.progressionPreview.set(null);
    this.exerciseHistory.set([]);
    this.exerciseHistoryTotal.set(0);
    this.historyExerciseId.set('');
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    for (const key of Object.keys(this.replacementSessionIds))
      delete this.replacementSessionIds[key];
    this.rescheduleDate = '';
    this.cancelReason = '';
  }
}
