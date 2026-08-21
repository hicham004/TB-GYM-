import { Component, effect, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ExerciseView,
  ProgramTemplateSummary,
  SavedSessionView,
  TrainingLoadStrategy,
  TrainingSetType,
} from '../../core/api/generated';
import { trainingLoadStrategyLabel, trainingSetTypeLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  DraftExercise,
  DraftSession,
  DraftSet,
  duplicateSession,
  duplicateWeek,
  draftFromVersion,
  emptyExercise,
  emptyProgram,
  emptySession,
  emptySet,
  emptyWeek,
  moveItem,
  numeric,
  ProgramDraft,
  sessionFromSaved,
  toProgramRequest,
  withExertionPreference,
} from './training-builder.models';

@Component({
  selector: 'app-program-builder',
  imports: [FormsModule],
  templateUrl: './program-builder.html',
  styleUrl: './program-builder.scss',
})
export class ProgramBuilder {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private loadedTenantId: string | null = null;
  private draggedWeek: number | null = null;
  private draggedSession: { week: number; session: number } | null = null;

  protected readonly templates = signal<ProgramTemplateSummary[]>([]);
  protected readonly templateTotal = signal(0);
  protected readonly exercises = signal<ExerciseView[]>([]);
  protected readonly savedSessions = signal<SavedSessionView[]>([]);
  protected readonly draft = signal<ProgramDraft>(emptyProgram());
  protected readonly selectedWeeks = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedSessions = signal<ReadonlySet<string>>(new Set());
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly setTypes: TrainingSetType[] = [
    'WarmUp',
    'Normal',
    'Top',
    'BackOff',
    'Drop',
    'Failure',
  ];
  protected readonly loadStrategies: TrainingLoadStrategy[] = [
    'None',
    'Direct',
    'PercentageWorkingMax',
    'RpeBasedEpley',
  ];
  protected readonly loadStrategyLabel = trainingLoadStrategyLabel;
  protected readonly setTypeLabel = trainingSetTypeLabel;

  constructor() {
    effect(() => {
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.loadCatalog();
      }
    });
  }

  protected newTemplate(): void {
    this.draft.set(emptyProgram());
    this.selectedWeeks.set(new Set());
    this.selectedSessions.set(new Set());
    this.clearMessages();
  }

  protected async openVersion(versionId: string): Promise<void> {
    this.busy.set(true);
    this.clearMessages();
    try {
      const version = await firstValueFrom(this.api.getProgramTemplateVersion(versionId));
      const draft = draftFromVersion(version);
      const template = this.templates().find((item) => item.id === version.templateId);
      draft.sourceVersion = template ? numeric(template.version) : null;
      this.draft.set(draft);
      this.selectedWeeks.set(new Set());
      this.selectedSessions.set(new Set());
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`The program version could not be loaded.`));
    } finally {
      this.busy.set(false);
    }
  }

  protected addWeek(): void {
    this.mutate((draft) => draft.weeks.push(emptyWeek(draft.weeks.length + 1)));
  }

  protected copyWeek(index: number): void {
    this.mutate((draft) => draft.weeks.splice(index + 1, 0, duplicateWeek(draft.weeks[index])));
  }

  protected copySelectedWeeks(): void {
    const selected = this.selectedWeeks();
    this.mutate((draft) => {
      const copies = draft.weeks.filter((week) => selected.has(week.key)).map(duplicateWeek);
      draft.weeks.push(...copies);
    });
    this.selectedWeeks.set(new Set());
  }

  protected removeWeek(index: number): void {
    this.mutate((draft) => {
      if (draft.weeks.length > 1) {
        draft.weeks.splice(index, 1);
      }
    });
  }

  protected moveWeek(index: number, direction: -1 | 1): void {
    this.mutate((draft) => (draft.weeks = moveItem(draft.weeks, index, index + direction)));
  }

  protected toggleWeek(key: string, event: Event): void {
    this.toggleSelection(this.selectedWeeks, key, (event.target as HTMLInputElement).checked);
  }

  protected addSession(weekIndex: number): void {
    this.mutate((draft) => {
      const sessions = draft.weeks[weekIndex].sessions;
      const nextDay = Math.min(6, Math.max(-1, ...sessions.map((item) => item.dayOffset)) + 1);
      sessions.push(emptySession(nextDay));
    });
  }

  protected copySession(weekIndex: number, sessionIndex: number): void {
    this.mutate((draft) => {
      const sessions = draft.weeks[weekIndex].sessions;
      sessions.splice(sessionIndex + 1, 0, duplicateSession(sessions[sessionIndex]));
    });
  }

  protected copySelectedSessions(): void {
    const selected = this.selectedSessions();
    this.mutate((draft) => {
      for (const week of draft.weeks) {
        week.sessions.push(
          ...week.sessions.filter((session) => selected.has(session.key)).map(duplicateSession),
        );
      }
    });
    this.selectedSessions.set(new Set());
  }

  protected removeSession(weekIndex: number, sessionIndex: number): void {
    this.mutate((draft) => draft.weeks[weekIndex].sessions.splice(sessionIndex, 1));
  }

  protected moveSession(weekIndex: number, sessionIndex: number, direction: -1 | 1): void {
    this.mutate((draft) => {
      const week = draft.weeks[weekIndex];
      week.sessions = moveItem(week.sessions, sessionIndex, sessionIndex + direction);
    });
  }

  protected toggleSession(key: string, event: Event): void {
    this.toggleSelection(this.selectedSessions, key, (event.target as HTMLInputElement).checked);
  }

  protected reuseSession(weekIndex: number, event: Event): void {
    const savedId = (event.target as HTMLSelectElement).value;
    const saved = this.savedSessions().find((item) => item.id === savedId);
    if (!saved) {
      return;
    }

    this.mutate((draft) => draft.weeks[weekIndex].sessions.push(sessionFromSaved(saved)));
    (event.target as HTMLSelectElement).value = '';
  }

  protected async saveSession(session: DraftSession): Promise<void> {
    const versionId = this.draft().sourceVersionId;
    if (!versionId || !session.sourceId) {
      this.error.set(
        $localize`Save the program version before adding this session to the library.`,
      );
      return;
    }

    await this.runWrite(async () => {
      await firstValueFrom(
        this.api.saveTrainingSession({
          name: session.name,
          sourceTemplateVersionId: versionId,
          sourceTemplateSessionId: session.sourceId!,
        }),
      );
      this.savedSessions.set(await firstValueFrom(this.api.listSavedSessions()));
      this.notice.set($localize`Session saved to the reusable library.`);
    });
  }

  protected addExercise(weekIndex: number, sessionIndex: number, event: Event): void {
    const exerciseId = (event.target as HTMLSelectElement).value;
    if (!exerciseId) {
      return;
    }
    const exercise = this.exercises().find((item) => item.id === exerciseId);
    this.mutate((draft) => {
      const prescription = emptyExercise(exerciseId);
      prescription.approvedAlternativeExerciseIds =
        exercise?.alternatives.map((item) => item.exerciseId) ?? [];
      draft.weeks[weekIndex].sessions[sessionIndex].exercises.push(prescription);
    });
    (event.target as HTMLSelectElement).value = '';
  }

  protected removeExercise(weekIndex: number, sessionIndex: number, exerciseIndex: number): void {
    this.mutate((draft) =>
      draft.weeks[weekIndex].sessions[sessionIndex].exercises.splice(exerciseIndex, 1),
    );
  }

  protected moveExercise(
    weekIndex: number,
    sessionIndex: number,
    exerciseIndex: number,
    direction: -1 | 1,
  ): void {
    this.mutate((draft) => {
      const session = draft.weeks[weekIndex].sessions[sessionIndex];
      session.exercises = moveItem(session.exercises, exerciseIndex, exerciseIndex + direction);
    });
  }

  protected mainLiftChanged(exercise: DraftExercise): void {
    if (exercise.isMainLift) {
      exercise.modificationPolicy = 'Locked';
      exercise.approvedAlternativeExerciseIds = [];
    }
    this.touch();
  }

  protected addSet(exercise: DraftExercise): void {
    exercise.sets.push(emptySet());
    this.touch();
  }

  protected copySet(exercise: DraftExercise, set: DraftSet): void {
    exercise.sets.push({ ...set, key: emptySet().key });
    this.touch();
  }

  protected exertionPreferenceChanged(
    set: DraftSet,
    preference: DraftSet['exertionDisplayPreference'],
  ): void {
    Object.assign(set, withExertionPreference(set, preference));
    this.touch();
  }

  protected removeSet(exercise: DraftExercise, index: number): void {
    if (exercise.sets.length > 1) {
      exercise.sets.splice(index, 1);
      this.touch();
    }
  }

  protected exerciseName(exerciseId: string): string {
    return this.exercises().find((item) => item.id === exerciseId)?.name ?? $localize`Exercise`;
  }

  protected loadValueLabel(set: DraftSet): string {
    if (set.loadStrategy === 'Direct') {
      return $localize`Load`;
    }
    if (set.loadStrategy === 'PercentageWorkingMax') {
      return $localize`% max`;
    }
    return $localize`Calculated`;
  }

  protected async saveProgram(): Promise<void> {
    const draft = this.draft();
    const validation = this.validate(draft);
    if (validation) {
      this.error.set(validation);
      return;
    }

    await this.runWrite(async () => {
      const request = toProgramRequest(draft);
      const saved = draft.templateId
        ? await firstValueFrom(this.api.addProgramTemplateVersion(draft.templateId, request))
        : await firstValueFrom(this.api.createProgramTemplate(request));
      await this.loadCatalog(false);
      await this.openVersion(saved.id);
      this.notice.set(
        draft.templateId
          ? $localize`New immutable program version saved.`
          : $localize`Program template created.`,
      );
    });
  }

  protected weekDragStart(index: number): void {
    this.draggedWeek = index;
  }

  protected weekDrop(index: number): void {
    if (this.draggedWeek !== null) {
      this.mutate((draft) => (draft.weeks = moveItem(draft.weeks, this.draggedWeek!, index)));
    }
    this.draggedWeek = null;
  }

  protected sessionDragStart(week: number, session: number): void {
    this.draggedSession = { week, session };
  }

  protected sessionDrop(targetWeek: number, targetSession: number): void {
    const source = this.draggedSession;
    if (!source) {
      return;
    }
    this.mutate((draft) => {
      const [session] = draft.weeks[source.week].sessions.splice(source.session, 1);
      const adjustedTarget =
        source.week === targetWeek && source.session < targetSession
          ? targetSession - 1
          : targetSession;
      draft.weeks[targetWeek].sessions.splice(adjustedTarget, 0, session);
    });
    this.draggedSession = null;
  }

  private async loadCatalog(showLoading = true): Promise<void> {
    if (showLoading) {
      this.loading.set(true);
    }
    this.clearMessages();
    try {
      const [templatePage, exercises, savedSessions] = await Promise.all([
        firstValueFrom(this.api.listProgramTemplates()),
        firstValueFrom(this.api.searchExercises({})),
        firstValueFrom(this.api.listSavedSessions()),
      ]);
      this.templates.set(templatePage.items);
      this.templateTotal.set(numeric(templatePage.total));
      this.exercises.set(exercises.items.filter((item) => !item.isArchived));
      this.savedSessions.set(savedSessions);
    } catch (error) {
      this.error.set(apiErrorMessage(error, $localize`Training resources could not be loaded.`));
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadMoreTemplates(): Promise<void> {
    if (this.templates().length >= this.templateTotal()) {
      return;
    }
    this.busy.set(true);
    try {
      const page = await firstValueFrom(this.api.listProgramTemplates(this.templates().length));
      this.templates.update((items) => [...items, ...page.items]);
    } catch (error) {
      this.error.set(
        apiErrorMessage(error, $localize`More program templates could not be loaded.`),
      );
    } finally {
      this.busy.set(false);
    }
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

  private mutate(change: (draft: ProgramDraft) => void): void {
    const draft = structuredClone(this.draft());
    change(draft);
    this.draft.set(draft);
  }

  private touch(): void {
    this.draft.set({ ...this.draft(), weeks: [...this.draft().weeks] });
  }

  private toggleSelection(
    state: WritableSignal<ReadonlySet<string>>,
    key: string,
    selected: boolean,
  ): void {
    const next = new Set(state());
    if (selected) {
      next.add(key);
    } else {
      next.delete(key);
    }
    state.set(next);
  }

  private validate(draft: ProgramDraft): string | null {
    if (!draft.name.trim()) {
      return $localize`Program name is required.`;
    }
    if (draft.weeks.length === 0) {
      return $localize`Add at least one week.`;
    }
    for (const week of draft.weeks) {
      for (const session of week.sessions) {
        if (!session.name.trim()) {
          return $localize`Every session needs a name.`;
        }
        if (
          session.exercises.some((exercise) => !exercise.exerciseId || exercise.sets.length === 0)
        ) {
          return $localize`Every prescribed exercise needs at least one set.`;
        }
        for (const exercise of session.exercises) {
          for (const set of exercise.sets) {
            if (
              set.repetitionsMinimum !== null &&
              (set.repetitionsMinimum < 1 || set.repetitionsMinimum > 100)
            ) {
              return $localize`Set repetitions must be between 1 and 100.`;
            }
            if (
              set.repetitionsMaximum !== null &&
              (set.repetitionsMaximum < 1 || set.repetitionsMaximum > 100)
            ) {
              return $localize`Set repetitions must be between 1 and 100.`;
            }
            if (
              set.repetitionsMinimum !== null &&
              set.repetitionsMaximum !== null &&
              set.repetitionsMinimum > set.repetitionsMaximum
            ) {
              return $localize`Minimum repetitions cannot exceed maximum repetitions.`;
            }
            if (set.restSeconds !== null && (set.restSeconds < 0 || set.restSeconds > 3600)) {
              return $localize`Rest must be between 0 and 3600 seconds.`;
            }
            if (set.exertionTarget !== null) {
              const minimum = set.exertionDisplayPreference === 'Rpe' ? 5 : 0;
              const maximum = set.exertionDisplayPreference === 'Rpe' ? 10 : 5;
              if (
                set.exertionTarget < minimum ||
                set.exertionTarget > maximum ||
                set.exertionTarget * 2 !== Math.trunc(set.exertionTarget * 2)
              ) {
                return set.exertionDisplayPreference === 'Rpe'
                  ? $localize`RPE must be between 5 and 10 in 0.5 steps.`
                  : $localize`RIR must be between 0 and 5 in 0.5 steps.`;
              }
            }
            if (
              set.loadStrategy === 'Direct' &&
              (set.loadValue === null || set.loadValue <= 0 || set.loadValue > 2000)
            ) {
              return $localize`Direct load must be greater than 0 and at most 2000.`;
            }
            if (
              set.loadStrategy === 'PercentageWorkingMax' &&
              (set.loadValue === null || set.loadValue <= 0 || set.loadValue > 150)
            ) {
              return $localize`Working-max percentage must be greater than 0 and at most 150.`;
            }
            if (set.loadStrategy === 'RpeBasedEpley') {
              if (set.exertionTarget === null || set.repetitionsMaximum === null) {
                return $localize`The working-max recommendation needs maximum repetitions and an exertion target.`;
              }
              const rir =
                set.exertionDisplayPreference === 'Rir'
                  ? set.exertionTarget
                  : 10 - set.exertionTarget;
              if (set.repetitionsMaximum + rir > 12) {
                return $localize`Maximum repetitions plus RIR cannot exceed 12 for this recommendation strategy.`;
              }
            }
          }
        }
      }
    }
    return null;
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
