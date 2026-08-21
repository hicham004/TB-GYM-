import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [FormsModule],
  templateUrl: './client-training.html',
  styleUrl: './client-training.scss',
})
export class ClientTraining {
  readonly clientId = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
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
    startDate: new Date().toISOString().slice(0, 10),
    loadUnit: 'Kilogram' as TrainingLoadUnit,
    loadIncrement: 2.5,
    loadRoundingMode: 'Nearest' as TrainingLoadRoundingMode,
  };
  protected readonly maxForm = {
    exerciseId: '',
    kind: 'CoachWorkingMax' as StrengthMaxKind,
    value: null as number | null,
    unit: 'Kilogram' as TrainingLoadUnit,
    effectiveDate: new Date().toISOString().slice(0, 10),
    note: '',
  };
  protected readonly progression = { iterations: 3, rpeIncrement: 0.5 };
  protected readonly replacementSessionIds: Record<string, string> = {};
  protected rescheduleDate = '';
  protected cancelReason = '';
  protected readonly maxKindLabel = strengthMaxKindLabel;
  protected readonly mesocycleStatusLabel = mesocycleStatusLabel;
  protected readonly progressionCoverageFallback = $localize`This progression exceeds paid training coverage.`;

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

  protected async templateChanged(): Promise<void> {
    const versionId = this.assignment.templateVersionId;
    if (!versionId) {
      this.workingMaxes.set([]);
      return;
    }

    this.busy.set(true);
    try {
      const version = await firstValueFrom(this.api.getProgramTemplateVersion(versionId));
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
      this.error.set(apiErrorMessage(error, $localize`The program details could not be loaded.`));
    } finally {
      this.busy.set(false);
    }
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
    const rows = this.workingMaxes();
    if (
      !this.assignment.enrollmentId ||
      !this.assignment.templateVersionId ||
      !this.assignment.startDate ||
      rows.some((item) => item.value === null || item.value <= 0)
    ) {
      this.error.set(
        $localize`Enrollment, published program, date, and all working maxes are required.`,
      );
      return;
    }

    await this.runWrite(async () => {
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
      const mesocycle = await firstValueFrom(
        this.api.assignClientMesocycle(this.clientId(), {
          ...payload,
          idempotencyKey: this.assignmentIntent.forPayload(payload),
        }),
      );
      this.assignmentIntent.complete();
      await this.reloadMesocycles();
      this.setMesocycle(mesocycle);
      this.notice.set($localize`Client-specific mesocycle snapshot assigned.`);
    });
  }

  protected async openMesocycle(id: string): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      this.setMesocycle(await firstValueFrom(this.api.getTrainingMesocycle(id)));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The mesocycle could not be loaded.`));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleReveal(): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    if (!mesocycle) {
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.updateMesocycleVisibility(mesocycle.id, {
        revealAllWeeks: !mesocycle.revealAllWeeks,
        version: numeric(mesocycle.version),
      }),
    );
  }

  protected async togglePublished(weekId: string, isPublished: boolean): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    if (!mesocycle) {
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.setMesocycleWeekPublished(mesocycle.id, weekId, {
        isPublished,
        version: numeric(mesocycle.version),
      }),
    );
  }

  protected async reschedule(): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    if (!mesocycle || !this.rescheduleDate) {
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.rescheduleMesocycle(mesocycle.id, {
        startDate: this.rescheduleDate,
        version: numeric(mesocycle.version),
      }),
    );
  }

  protected async cancelMesocycle(): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    const reason = this.cancelReason.trim();
    if (!mesocycle || this.isTerminal(mesocycle) || !reason) {
      this.error.set($localize`A cancellation reason is required.`);
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.cancelTrainingMesocycle(mesocycle.id, {
        reason,
        version: numeric(mesocycle.version),
      }),
    );
    this.cancelReason = '';
  }

  protected async completeMesocycle(): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    if (!mesocycle || mesocycle.status !== 'Active') {
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.completeTrainingMesocycle(mesocycle.id, {
        version: numeric(mesocycle.version),
      }),
    );
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
    const mesocycle = this.selectedMesocycle();
    if (!mesocycle || this.isTerminal(mesocycle)) {
      return;
    }
    if (this.progressionWeeks().size === 0) {
      this.error.set($localize`Select at least one source week.`);
      return;
    }
    if (this.progression.iterations < 1 || this.progression.iterations > 12) {
      this.error.set($localize`Progression iterations must be between 1 and 12.`);
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
    await this.runWrite(async () => {
      this.progressionPreview.set(
        await firstValueFrom(
          this.api.previewTrainingProgression(mesocycle.id, {
            sourceWeekIds: [...this.progressionWeeks()],
            iterations: this.progression.iterations,
            rpeIncrement: this.progression.rpeIncrement,
            mesocycleVersion: numeric(mesocycle.version),
          }),
        ),
      );
    });
  }

  protected async applyProgression(): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    const preview = this.progressionPreview();
    if (!mesocycle || !preview || !preview.isInsideTrainingCoverage) {
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.applyTrainingProgression(mesocycle.id, {
        sourceWeekIds: [...this.progressionWeeks()],
        iterations: this.progression.iterations,
        rpeIncrement: this.progression.rpeIncrement,
        previewHash: preview.previewHash,
        mesocycleVersion: numeric(mesocycle.version),
      }),
    );
    this.progressionPreview.set(null);
    this.progressionWeeks.set(new Set());
  }

  protected progressionChanged(): void {
    this.progressionPreview.set(null);
  }

  protected async replaceSession(sessionId: string): Promise<void> {
    const mesocycle = this.selectedMesocycle();
    const saved = this.savedSessions().find(
      (item) => item.id === this.replacementSessionIds[sessionId],
    );
    if (!mesocycle || !saved) {
      return;
    }
    await this.runMesocycleWrite(() =>
      this.api.replaceFutureTrainingSession(mesocycle.id, sessionId, {
        session: toTrainingSessionRequest(sessionFromSaved(saved)),
        version: numeric(mesocycle.version),
      }),
    );
    this.replacementSessionIds[sessionId] = '';
  }

  protected async recordMax(): Promise<void> {
    if (!this.maxForm.exerciseId || !this.maxForm.value || this.maxForm.value <= 0) {
      this.error.set($localize`Exercise and positive max value are required.`);
      return;
    }
    await this.runWrite(async () => {
      await firstValueFrom(
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
      );
      const page = await firstValueFrom(this.api.listStrengthMaxes(this.clientId()));
      this.maxHistory.set(page.items);
      this.maxHistoryTotal.set(numeric(page.total));
      this.maxForm.value = null;
      this.maxForm.note = '';
      this.notice.set($localize`Strength max appended to history.`);
    });
  }

  protected async loadExerciseHistory(): Promise<void> {
    if (!this.historyExerciseId()) {
      this.exerciseHistory.set([]);
      this.exerciseHistoryTotal.set(0);
      return;
    }
    this.loading.set(true);
    try {
      const page = await firstValueFrom(
        this.api.getExerciseHistory(this.clientId(), this.historyExerciseId()),
      );
      this.exerciseHistory.set(page.items);
      this.exerciseHistoryTotal.set(numeric(page.total));
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Exercise history could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadMoreExerciseHistory(): Promise<void> {
    if (!this.historyExerciseId() || this.exerciseHistory().length >= this.exerciseHistoryTotal()) {
      return;
    }
    const page = await firstValueFrom(
      this.api.getExerciseHistory(
        this.clientId(),
        this.historyExerciseId(),
        this.exerciseHistory().length,
      ),
    );
    this.exerciseHistory.update((items) => [...items, ...page.items]);
  }

  protected async loadMoreMaxHistory(): Promise<void> {
    if (this.maxHistory().length >= this.maxHistoryTotal()) {
      return;
    }
    const page = await firstValueFrom(
      this.api.listStrengthMaxes(this.clientId(), undefined, this.maxHistory().length),
    );
    this.maxHistory.update((items) => [...items, ...page.items]);
  }

  protected async loadMoreTemplates(): Promise<void> {
    if (this.templates().length >= this.templateTotal()) {
      return;
    }
    const page = await firstValueFrom(this.api.listProgramTemplates(this.templates().length));
    this.templates.update((items) => [...items, ...page.items]);
  }

  protected enrollmentLabel(enrollment: ClientEnrollment): string {
    return `${enrollment.productName} / ${enrollment.offerLabel} (${enrollment.startDate} - ${enrollment.lastActiveDate})`;
  }

  protected displayNumber(value: null | number | string): string {
    return value === null ? '-' : `${numeric(value)}`;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.clearMessages();
    try {
      const [commercial, templatePage, exercises, maxPage, mesocycles, savedSessions] =
        await Promise.all([
          firstValueFrom(this.api.getClientCommercialOverview(this.clientId())),
          firstValueFrom(this.api.listProgramTemplates()),
          firstValueFrom(this.api.searchExercises({})),
          firstValueFrom(this.api.listStrengthMaxes(this.clientId())),
          firstValueFrom(this.api.listClientMesocycles(this.clientId())),
          firstValueFrom(this.api.listSavedSessions()),
        ]);
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
        await this.templateChanged();
      }
      if (mesocycles[0]) {
        this.setMesocycle(await firstValueFrom(this.api.getTrainingMesocycle(mesocycles[0].id)));
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Client training could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  private async reloadMesocycles(): Promise<void> {
    this.mesocycles.set(await firstValueFrom(this.api.listClientMesocycles(this.clientId())));
  }

  private async runMesocycleWrite(
    command: () => ReturnType<ApiClient['updateMesocycleVisibility']>,
  ): Promise<void> {
    await this.runWrite(async () => {
      const mesocycle = await firstValueFrom(command());
      this.setMesocycle(mesocycle);
      await this.reloadMesocycles();
      this.notice.set($localize`Mesocycle updated.`);
    });
  }

  private async runWrite(command: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      await this.csrf.refresh();
      await command();
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The training change could not be saved.`));
    } finally {
      this.busy.set(false);
    }
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
}
