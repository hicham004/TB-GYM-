import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  ClientExerciseView,
  ClientSetView,
  ClientTrainingDayResult,
  ClientWorkoutView,
  MediaAccessView,
  TrainingLoadUnit,
  WorkoutFinishSummaryView,
} from '../../core/api/generated';
import { workoutStatusLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { nullableNumeric, numeric } from './training-builder.models';
import {
  trainingReadAccessLabel,
  workoutNoteTime,
  type UpcomingTraining,
} from './training-read.models';
import {
  applyWorkoutSetSave,
  applyWorkoutSetSaveToDay,
  hasLoadUnitForActualLoad,
  reconcileWorkoutSetDrafts,
  snapshotWorkoutSetDraft,
  toRecordSetRequest,
  updateWorkoutSetDraft,
  type WorkoutSetDraft,
  type WorkoutSetDrafts,
} from './workout-set-drafts';

@Component({
  selector: 'app-today-training',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './today-training.html',
  styleUrl: './today-training.scss',
})
export class TodayTraining {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly route = inject(ActivatedRoute, { optional: true });
  private loadedTenantId: string | null = null;
  private contextGeneration = 0;
  private loadGeneration = 0;
  private upcomingSkip = 0;
  private readonly workoutSaveQueues = new Map<string, Promise<boolean>>();
  private mediaTrigger: HTMLElement | null = null;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private touchStartX: number | null = null;
  private unitSessionId: string | null = null;

  protected readonly day = signal<ClientTrainingDayResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly upcoming = signal<UpcomingTraining | null>(null);
  protected readonly setErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly editingSetIds = signal<ReadonlySet<string>>(new Set());
  protected readonly finishConfirmation = signal<string | null>(null);
  protected readonly finishSummary = signal<WorkoutFinishSummaryView | null>(null);
  protected readonly finishedWorkoutName = signal('');
  protected readonly activeExerciseIndex = signal(0);
  protected readonly workoutUnit = signal<TrainingLoadUnit | null>(null);
  protected readonly prSetIds = signal<ReadonlySet<string>>(new Set());
  protected readonly now = signal(Date.now());
  protected readonly restUntil = signal<number | null>(null);
  protected readonly restTotal = signal(0);
  protected readonly restRemaining = computed(() =>
    Math.max(0, Math.ceil(((this.restUntil() ?? 0) - this.now()) / 1000)),
  );
  protected readonly selectedSession = signal(
    this.route?.snapshot.queryParamMap.get('sessionId') ?? null,
  );
  protected readonly shownWorkouts = computed(() => {
    const workouts = this.day()?.workouts ?? [];
    const selected = workouts.find((item) => item.sessionId === this.selectedSession());
    return selected ? [selected] : workouts.slice(0, 1);
  });
  protected readonly activeWorkout = computed(() => this.shownWorkouts()[0] ?? null);
  protected readonly activeExercise = computed(
    () => this.activeWorkout()?.exercises[this.activeExerciseIndex()] ?? null,
  );
  protected readonly activeMedia = signal<MediaAccessView | null>(null);
  protected readonly setDrafts = signal<WorkoutSetDrafts>({});
  protected readonly savingSetIds = signal<ReadonlySet<string>>(new Set());
  protected readonly savingWorkoutIds = signal<ReadonlySet<string>>(new Set());
  protected readonly workoutNotes: Record<string, string> = {};
  private readonly errorSummary = viewChild<ElementRef<HTMLElement>>('errorSummary');
  protected readonly mediaDialog = viewChild<ElementRef<HTMLElement>>('mediaDialog');
  protected readonly mediaCloseButton = viewChild<ElementRef<HTMLButtonElement>>('mediaClose');
  protected readonly accessReasonLabel = trainingReadAccessLabel;
  protected readonly workoutStatusLabel = workoutStatusLabel;
  protected readonly noteTime = workoutNoteTime;

  constructor() {
    this.timerHandle = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => {
      if (this.timerHandle) clearInterval(this.timerHandle);
      void this.wakeLock?.release();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId === this.loadedTenantId) {
        return;
      }

      this.loadedTenantId = tenantId;
      ++this.contextGeneration;
      this.resetForTenant();
      if (tenantId !== null) {
        void this.load();
      }
    });
    effect(() => {
      const closeButton = this.mediaCloseButton()?.nativeElement;
      if (this.activeMedia() && closeButton) {
        queueMicrotask(() => closeButton.focus());
      }
    });
  }

  protected async start(workout: ClientWorkoutView): Promise<void> {
    return this.scope.run('start', async (owner) => {
      await owner.wait(
        this.runWrite(async (generation) => {
          await owner.wait(firstValueFrom(this.api.startMyWorkout(workout.sessionId)));
          if (!this.ownsContext(generation)) {
            return;
          }
          await owner.wait(this.load(false));
          if (this.ownsContext(generation)) {
            this.notice.set($localize`Workout started.`);
            void this.keepScreenAwake();
          }
        }),
      );
    });
  }

  protected async saveSet(workout: ClientWorkoutView, set: ClientSetView): Promise<boolean> {
    return this.scope.run(
      `set:${set.performanceId}`,
      async (owner) => {
        if (
          !workout.workoutExecutionId ||
          !set.performanceId ||
          workout.executionVersion === null
        ) {
          return false;
        }

        const workoutId = workout.workoutExecutionId;
        const setId = set.performanceId;
        const generation = this.contextGeneration;
        const snapshot = snapshotWorkoutSetDraft(this.setDrafts(), setId);
        if (!snapshot || this.savingSetIds().has(setId)) {
          return false;
        }
        if (!hasLoadUnitForActualLoad(snapshot, set.prescribedLoadUnit)) {
          this.reportSetError(setId, $localize`Select kg or lb before saving a load.`, true);
          return false;
        }

        this.markSaving(setId, workoutId, true);
        const previous = this.workoutSaveQueues.get(workoutId) ?? Promise.resolve(true);
        const operation = previous.then(async () => {
          if (!this.ownsContext(generation)) {
            return false;
          }
          this.clearMessages();
          this.setErrors.update((errors) => ({ ...errors, [setId]: '' }));
          try {
            await owner.wait(this.csrf.refresh());
            if (!this.ownsContext(generation)) {
              return false;
            }
            const currentWorkout = this.day()?.workouts.find(
              (item) => item.workoutExecutionId === workoutId,
            );
            if (
              currentWorkout?.executionVersion === null ||
              currentWorkout?.executionVersion === undefined
            ) {
              throw new Error('The workout version is no longer available.');
            }

            const response = await owner.wait(
              firstValueFrom(
                this.api.recordMyTrainingSet(
                  workoutId,
                  setId,
                  toRecordSetRequest(
                    snapshot,
                    set.prescribedLoadUnit,
                    numeric(currentWorkout.executionVersion),
                  ),
                ),
              ),
            );
            if (!this.ownsContext(generation)) {
              return false;
            }
            this.day.update((day) => (day ? applyWorkoutSetSaveToDay(day, response) : day));
            this.setDrafts.update((drafts) =>
              applyWorkoutSetSave(drafts, response, snapshot.revision),
            );
            this.prSetIds.update((ids) => {
              const next = new Set(ids);
              if (response.isPersonalRecord) next.add(setId);
              else next.delete(setId);
              return next;
            });
            if (response.isPersonalRecord) {
              this.notice.set($localize`New personal record!`);
              if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
            } else {
              this.notice.set($localize`Set saved.`);
            }
            this.editingSetIds.update((ids) => new Set([...ids].filter((id) => id !== setId)));
            return true;
          } catch (error) {
            if (!owner.current) return false;
            if (!this.ownsContext(generation)) {
              return false;
            }
            if (error instanceof HttpErrorResponse && error.status === 403) {
              try {
                const access = await owner.wait(firstValueFrom(this.api.getMyUpcomingTraining()));
                if (!this.ownsContext(generation)) {
                  return false;
                }
                if (!access.isAllowed)
                  this.day.update((day) =>
                    day
                      ? {
                          ...day,
                          isAllowed: false,
                          accessReason: access.accessReason,
                        }
                      : day,
                  );
              } catch {
                if (!owner.current) return false;
                /* Keep the draft and original refusal when the access refresh also fails. */
              }
            }
            if (!this.ownsContext(generation)) {
              return false;
            }
            const explanation = apiErrorMessage(error, '');
            this.reportSetError(
              setId,
              $localize`Couldn’t save this set. Your entries are still on this page. Retry.` +
                (explanation ? ` ${explanation}` : ''),
            );
            return false;
          } finally {
            if (owner.current) {
              if (this.ownsContext(generation)) {
                this.markSaving(setId, workoutId, false);
              }
            }
          }
        });

        this.workoutSaveQueues.set(workoutId, operation);
        const saved = await owner.wait(operation);
        if (this.workoutSaveQueues.get(workoutId) === operation) {
          this.workoutSaveQueues.delete(workoutId);
        }
        return saved;
      },
      false,
    );
  }

  protected async logSet(
    workout: ClientWorkoutView,
    set: ClientSetView,
    event: Event,
  ): Promise<void> {
    return this.scope.run('logSet', async (owner) => {
      if (
        !this.day()?.isAllowed ||
        this.busy() ||
        (set.performanceId && this.savingSetIds().has(set.performanceId))
      )
        return;
      const trigger = event.currentTarget as HTMLElement | null;
      const restoreFocus = trigger !== null && document.activeElement === trigger;
      this.updateSetDraft(set, { isCompleted: true, actualRir: null });
      const saved = await owner.wait(this.saveSet(workout, set));
      if (saved && set.performanceId) {
        if (set.restSeconds && Number(set.restSeconds) > 0) {
          this.startRest(Number(set.restSeconds));
        }
        this.restoreSetFocus(set.performanceId, 'edit', trigger, restoreFocus);
      }
    });
  }

  protected editSet(set: ClientSetView, event: Event): void {
    if (!set.performanceId) {
      return;
    }

    const trigger = event.currentTarget as HTMLElement | null;
    const restoreFocus = trigger !== null && document.activeElement === trigger;
    this.editingSetIds.update((ids) => new Set([...ids, set.performanceId!]));
    this.restoreSetFocus(set.performanceId, 'input', trigger, restoreFocus);
  }

  protected collapsed(set: ClientSetView): boolean {
    return (
      set.isCompleted &&
      !this.setDraft(set)?.dirty &&
      (!set.performanceId || !this.editingSetIds().has(set.performanceId))
    );
  }

  protected setTypeLabel(type: ClientSetView['setType']): string {
    const labels: Record<string, string> = {
      Normal: $localize`Working set`,
      WarmUp: $localize`Warm-up`,
      Warmup: $localize`Warm-up`,
      TopSet: $localize`Top set`,
      BackOff: $localize`Back-off set`,
      Backoff: $localize`Back-off set`,
      DropSet: $localize`Drop set`,
      Amrap: $localize`As many reps as prescribed`,
      AMRAP: $localize`As many reps as prescribed`,
      Top: $localize`Top set`,
      Drop: $localize`Drop set`,
      Failure: $localize`To failure`,
    };
    return labels[type] ?? $localize`Set`;
  }

  protected restLabel(seconds: number | string): string {
    const value = Number(seconds);
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  protected clockLabel(seconds: number | string): string {
    const safe = Math.max(0, Math.floor(Number(seconds)));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }

  protected elapsed(workout: ClientWorkoutView): number {
    return workout.startedAtUtc
      ? Math.max(0, Math.floor((this.now() - Date.parse(workout.startedAtUtc)) / 1000))
      : 0;
  }

  protected startRest(seconds: number): void {
    this.restTotal.set(seconds);
    this.restUntil.set(Date.now() + seconds * 1000);
  }

  protected addRest(): void {
    this.restUntil.update((until) => (until ?? Date.now()) + 15_000);
    this.restTotal.update((total) => total + 15);
  }

  protected skipRest(): void {
    this.restUntil.set(null);
  }

  protected showExercise(index: number): void {
    const workout = this.activeWorkout();
    if (!workout || index < 0 || index >= workout.exercises.length) return;
    this.activeExerciseIndex.set(index);
    this.skipRest();
  }

  protected touchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0]?.clientX ?? null;
  }

  protected touchEnd(event: TouchEvent): void {
    if (this.touchStartX === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? this.touchStartX) - this.touchStartX;
    this.touchStartX = null;
    if (Math.abs(delta) < 70) return;
    this.showExercise(this.activeExerciseIndex() + (delta < 0 ? 1 : -1));
  }

  protected chooseUnit(unit: TrainingLoadUnit | null): void {
    this.workoutUnit.set(unit);
    const workout = this.activeWorkout();
    if (!workout) return;
    this.unitSessionId = workout.sessionId;
    for (const set of workout.exercises.flatMap((exercise) => exercise.sets)) {
      if (!set.performanceId || set.isCompleted) continue;
      const draft = this.setDrafts()[set.performanceId];
      if (!draft) continue;
      this.updateSetDraft(set, {
        actualLoadUnit: unit,
        actualLoad: draft.actualLoadUnit === unit ? draft.actualLoad : null,
      });
    }
  }

  protected selectWorkout(sessionId: string): void {
    this.selectedSession.set(sessionId);
    this.activeExerciseIndex.set(0);
    const workout = this.day()?.workouts.find((item) => item.sessionId === sessionId);
    this.workoutUnit.set(
      workout?.exercises.flatMap((exercise) => exercise.sets).find((set) => set.prescribedLoadUnit)
        ?.prescribedLoadUnit ?? null,
    );
    this.unitSessionId = sessionId;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.activeWorkout()?.status === 'InProgress') {
      void this.keepScreenAwake();
    }
  };

  protected stepSet(set: ClientSetView, field: 'load' | 'reps', direction: number): void {
    const draft = this.setDraft(set);
    if (!draft) return;
    if (field === 'load') {
      const step = this.workoutUnit() === 'Pound' ? 5 : 2.5;
      this.updateSetDraft(set, {
        actualLoad: Math.max(0, Number(draft.actualLoad ?? 0) + step * direction),
        actualLoadUnit: this.workoutUnit(),
      });
    } else {
      this.updateSetDraft(set, {
        actualRepetitions: Math.max(0, Number(draft.actualRepetitions ?? 0) + direction),
      });
    }
  }

  private async keepScreenAwake(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // The workout remains usable when the browser or device refuses Wake Lock.
    }
  }

  protected loggedSetCount(workout: ClientWorkoutView): number {
    return workout.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.isCompleted)
      .length;
  }

  protected totalSetCount(workout: ClientWorkoutView): number {
    return workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  }

  protected exerciseCompletion(exercise: ClientExerciseView): number {
    return exercise.sets.length
      ? (100 * exercise.sets.filter((set) => set.isCompleted).length) / exercise.sets.length
      : 0;
  }

  protected requestFinish(workout: ClientWorkoutView): void {
    this.clearMessages();
    if (this.hasUnsavedSets(workout) || this.isWorkoutSaving(workout)) {
      this.reportError($localize`Save every edited set before completing the workout.`, true);
      this.finishConfirmation.set(null);
      return;
    }
    this.finishConfirmation.set(workout.sessionId);
  }

  protected noteTimeZone(sessionId: string): string | undefined {
    return (
      this.upcoming()?.unfinishedWorkouts.find((item) => item.workout.sessionId === sessionId)
        ?.timeZoneId ?? this.upcoming()?.timeZoneId
    );
  }

  protected async moreUnfinished(): Promise<void> {
    return this.scope.run('moreUnfinished', async (owner) => {
      const skip = this.upcoming()?.nextSkip;
      if (skip == null || this.loading()) {
        return;
      }
      if (
        this.day()?.workouts.some(
          (workout) => this.hasUnsavedSets(workout) || this.isWorkoutSaving(workout),
        )
      ) {
        this.reportError(
          $localize`Save every edited set before opening another page of workouts.`,
          true,
        );
        return;
      }
      this.upcomingSkip = skip;
      this.selectedSession.set(null);
      await owner.wait(this.load());
    });
  }

  protected setDraft(set: ClientSetView): WorkoutSetDraft | null {
    return set.performanceId ? (this.setDrafts()[set.performanceId] ?? null) : null;
  }

  protected updateSetDraft(
    set: ClientSetView,
    changes: Partial<Omit<WorkoutSetDraft, 'revision' | 'dirty'>>,
  ): void {
    if (!set.performanceId) {
      return;
    }
    this.setDrafts.update((drafts) => updateWorkoutSetDraft(drafts, set.performanceId!, changes));
  }

  protected isWorkoutSaving(workout: ClientWorkoutView): boolean {
    return Boolean(
      workout.workoutExecutionId && this.savingWorkoutIds().has(workout.workoutExecutionId),
    );
  }

  protected hasUnsavedSets(workout: ClientWorkoutView): boolean {
    return workout.exercises.some((exercise) =>
      exercise.sets.some((set) => set.performanceId && this.setDrafts()[set.performanceId]?.dirty),
    );
  }

  protected async substitute(
    workout: ClientWorkoutView,
    exercise: ClientExerciseView,
    event: Event,
  ): Promise<void> {
    return this.scope.run('substitute', async (owner) => {
      const exerciseId = (event.target as HTMLSelectElement).value;
      if (
        !exerciseId ||
        !workout.workoutExecutionId ||
        !exercise.performanceId ||
        workout.executionVersion === null
      ) {
        return;
      }
      const generation = this.contextGeneration;
      const workoutId = workout.workoutExecutionId;
      await owner.wait(this.workoutSaveQueues.get(workoutId));
      if (!this.ownsContext(generation)) {
        return;
      }
      const currentWorkout = this.day()?.workouts.find(
        (item) => item.workoutExecutionId === workoutId,
      );
      if (
        currentWorkout?.executionVersion === null ||
        currentWorkout?.executionVersion === undefined
      ) {
        return;
      }
      await owner.wait(
        this.runWrite(async (writeGeneration) => {
          await owner.wait(
            firstValueFrom(
              this.api.substituteMyTrainingExercise(workoutId, exercise.performanceId!, {
                exerciseId,
                version: numeric(currentWorkout.executionVersion!),
              }),
            ),
          );
          if (!this.ownsContext(writeGeneration)) {
            return;
          }
          await owner.wait(this.load(false));
          if (this.ownsContext(writeGeneration)) {
            this.notice.set($localize`Approved substitution recorded.`);
          }
        }),
      );
    });
  }

  protected async addNote(workout: ClientWorkoutView): Promise<void> {
    return this.scope.run('addNote', async (owner) => {
      const text = this.workoutNotes[workout.sessionId]?.trim();
      if (!workout.workoutExecutionId || !text) {
        return;
      }
      await owner.wait(
        this.runWrite(async (generation) => {
          await owner.wait(
            firstValueFrom(
              this.api.addWorkoutNote(workout.workoutExecutionId!, {
                exercisePerformanceId: null,
                text,
              }),
            ),
          );
          if (!this.ownsContext(generation)) {
            return;
          }
          this.workoutNotes[workout.sessionId] = '';
          await owner.wait(this.load(false));
          if (this.ownsContext(generation)) {
            this.notice.set($localize`Workout note added.`);
          }
        }),
      );
    });
  }

  protected async complete(workout: ClientWorkoutView): Promise<void> {
    return this.scope.run('complete', async (owner) => {
      if (!workout.workoutExecutionId || workout.executionVersion === null) {
        return;
      }
      if (this.hasUnsavedSets(workout) || this.isWorkoutSaving(workout)) {
        this.reportError($localize`Save every edited set before completing the workout.`, true);
        return;
      }
      await owner.wait(
        this.runWrite(async (generation) => {
          const response = await owner.wait(
            firstValueFrom(
              this.api.completeMyWorkout(workout.workoutExecutionId!, {
                version: numeric(workout.executionVersion!),
              }),
            ),
          );
          if (!this.ownsContext(generation)) {
            return;
          }
          this.day.update((day) =>
            day
              ? {
                  ...day,
                  workouts: day.workouts.map((item) =>
                    item.workoutExecutionId === workout.workoutExecutionId
                      ? { ...item, status: response.status, executionVersion: response.version }
                      : item,
                  ),
                }
              : day,
          );
          this.finishConfirmation.set(null);
          this.finishedWorkoutName.set(workout.name);
          this.finishSummary.set(response.finishSummary ?? null);
          this.skipRest();
          void this.wakeLock?.release();
          this.wakeLock = null;
          if (response.finishSummary?.personalRecords.length && 'vibrate' in navigator) {
            navigator.vibrate([80, 40, 80]);
          }
          this.notice.set($localize`Workout completed.`);
        }),
      );
    });
  }

  protected async showMedia(assetId: string, event: Event): Promise<void> {
    return this.scope.run('showMedia', async (owner) => {
      const trigger = event.currentTarget as HTMLElement | null;
      const generation = this.contextGeneration;
      this.busy.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsContext(generation)) {
          return;
        }
        const access = await owner.wait(firstValueFrom(this.api.createMediaAccess(assetId)));
        if (!this.ownsContext(generation)) {
          return;
        }
        if (access.source === 'ExternalEmbed') {
          this.reportError($localize`External video demos are not enabled for this beta.`, true);
          return;
        }
        this.mediaTrigger = trigger;
        this.activeMedia.set(access);
      } catch (error) {
        if (!owner.current) return;
        if (this.ownsContext(generation)) {
          this.reportError(apiErrorMessage(error, $localize`Exercise media could not be opened.`));
        }
      } finally {
        if (owner.current) {
          if (this.ownsContext(generation)) {
            this.busy.set(false);
          }
        }
      }
    });
  }

  protected closeMedia(): void {
    this.activeMedia.set(null);
    const trigger = this.mediaTrigger;
    this.mediaTrigger = null;
    setTimeout(() => trigger?.focus());
  }

  protected mediaDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMedia();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = this.mediaDialog()?.nativeElement;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], iframe',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected prescribedReps(set: ClientSetView): string {
    const minimum = nullableNumeric(set.prescribedRepetitionsMinimum);
    const maximum = nullableNumeric(set.prescribedRepetitionsMaximum);
    if (minimum === null && maximum === null) {
      return '-';
    }
    if (minimum === null) {
      return `${maximum}`;
    }
    return minimum === maximum || maximum === null ? `${minimum}` : `${minimum}-${maximum}`;
  }

  protected prescribedEffort(set: ClientSetView): string {
    if (set.prescribedTargetRpe !== null) {
      const rpe = numeric(set.prescribedTargetRpe);
      return $localize`RPE ${rpe} · about ${10 - rpe} reps left`;
    }
    if (set.prescribedTargetRir !== null) {
      return `RIR ${numeric(set.prescribedTargetRir)}`;
    }
    return '-';
  }

  protected async load(showLoading = true): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const generation = this.contextGeneration;
      const request = ++this.loadGeneration;
      if (showLoading) {
        this.loading.set(true);
      }
      this.clearMessages();
      try {
        const [day, upcoming] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getMyTrainingToday()),
            firstValueFrom(this.api.getMyUpcomingTraining(this.upcomingSkip)),
          ]),
        );
        if (!this.ownsLoad(generation, request)) return;
        this.upcoming.set(upcoming);
        const allowed = day.isAllowed && upcoming.isAllowed;
        const combined = {
          ...day,
          isAllowed: allowed,
          accessReason: !day.isAllowed ? day.accessReason : upcoming.accessReason,
          workouts: allowed
            ? [...day.workouts, ...upcoming.unfinishedWorkouts.map((item) => item.workout)]
            : (this.day()?.workouts ?? []),
        };
        this.day.set(combined);
        this.setDrafts.update((drafts) => reconcileWorkoutSetDrafts(combined, drafts));
        const active =
          combined.workouts.find((item) => item.sessionId === this.selectedSession()) ??
          combined.workouts[0];
        if (active && this.unitSessionId !== active.sessionId) {
          this.workoutUnit.set(
            active.exercises
              .flatMap((exercise) => exercise.sets)
              .find((set) => set.prescribedLoadUnit)?.prescribedLoadUnit ?? null,
          );
          this.unitSessionId = active.sessionId;
        }
      } catch (error) {
        if (!owner.current) return;
        if (this.ownsLoad(generation, request))
          this.error.set(apiErrorMessage(error, $localize`Today's training could not be loaded.`));
      } finally {
        if (owner.current) {
          if (this.ownsLoad(generation, request)) this.loading.set(false);
        }
      }
    });
  }

  private async runWrite(command: (generation: number) => Promise<void>): Promise<void> {
    return this.scope.run('runWrite', async (owner) => {
      const generation = this.contextGeneration;
      this.busy.set(true);
      this.clearMessages();
      try {
        await owner.wait(this.csrf.refresh());
        if (!this.ownsContext(generation)) {
          return;
        }
        await owner.wait(command(generation));
      } catch (error) {
        if (!owner.current) return;
        if (this.ownsContext(generation)) {
          this.reportError(
            apiErrorMessage(error, $localize`The workout change could not be saved.`),
          );
        }
      } finally {
        if (owner.current) {
          if (this.ownsContext(generation)) {
            this.busy.set(false);
          }
        }
      }
    });
  }

  private resetForTenant(): void {
    ++this.loadGeneration;
    this.day.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.upcoming.set(null);
    this.setDrafts.set({});
    this.setErrors.set({});
    this.editingSetIds.set(new Set());
    this.savingSetIds.set(new Set());
    this.savingWorkoutIds.set(new Set());
    this.workoutSaveQueues.clear();
    this.finishConfirmation.set(null);
    this.finishSummary.set(null);
    this.finishedWorkoutName.set('');
    this.activeExerciseIndex.set(0);
    this.workoutUnit.set(null);
    this.unitSessionId = null;
    this.prSetIds.set(new Set());
    this.skipRest();
    void this.wakeLock?.release();
    this.wakeLock = null;
    this.activeMedia.set(null);
    this.mediaTrigger = null;
    this.upcomingSkip = 0;
    this.clearMessages();
  }

  private ownsContext(generation: number): boolean {
    return this.contextGeneration === generation;
  }

  private ownsLoad(generation: number, request: number): boolean {
    return this.ownsContext(generation) && this.loadGeneration === request;
  }

  private reportSetError(setId: string, message: string, focus = false): void {
    this.setErrors.update((errors) => ({ ...errors, [setId]: message }));
    this.reportError(message, focus);
  }

  private reportError(message: string, focus = false): void {
    this.error.set(message);
    if (focus) {
      afterNextRender(
        () => {
          if (this.error() === message) {
            this.errorSummary()?.nativeElement.focus();
          }
        },
        { injector: this.injector },
      );
    }
  }

  private restoreSetFocus(
    setId: string,
    target: 'edit' | 'input',
    trigger: HTMLElement | null,
    shouldRestore: boolean,
  ): void {
    if (!shouldRestore) {
      return;
    }

    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active !== trigger && active !== document.body) {
          return;
        }

        const controls = Array.from(
          (this.host.nativeElement as HTMLElement).querySelectorAll(`[data-set-focus="${target}"]`),
        ) as HTMLElement[];
        const control = controls.find((element) => element.dataset['setId'] === setId);
        control?.focus();
      },
      { injector: this.injector },
    );
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private markSaving(setId: string, workoutId: string, saving: boolean): void {
    this.savingSetIds.update((ids) => {
      const next = new Set(ids);
      if (saving) {
        next.add(setId);
      } else {
        next.delete(setId);
      }
      return next;
    });
    this.savingWorkoutIds.update((ids) => {
      const next = new Set(ids);
      const workoutStillSaving =
        saving ||
        this.day()
          ?.workouts.find((workout) => workout.workoutExecutionId === workoutId)
          ?.exercises.some((exercise) =>
            exercise.sets.some(
              (set) => set.performanceId && this.savingSetIds().has(set.performanceId),
            ),
          );
      if (workoutStillSaving) {
        next.add(workoutId);
      } else {
        next.delete(workoutId);
      }
      return next;
    });
  }

  private resetTenantState(): void {
    this.loadedTenantId = null;
    ++this.contextGeneration;
    ++this.loadGeneration;
    this.upcomingSkip = 0;
    this.workoutSaveQueues.clear();
    this.mediaTrigger = null;
    this.day.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set(null);
    this.notice.set(null);
    this.upcoming.set(null);
    this.setErrors.set({});
    this.editingSetIds.set(new Set());
    this.finishConfirmation.set(null);
    this.finishSummary.set(null);
    this.finishedWorkoutName.set('');
    this.activeExerciseIndex.set(0);
    this.workoutUnit.set(null);
    this.unitSessionId = null;
    this.prSetIds.set(new Set());
    this.skipRest();
    void this.wakeLock?.release();
    this.wakeLock = null;
    this.selectedSession.set(null);
    this.activeMedia.set(null);
    this.setDrafts.set({});
    this.savingSetIds.set(new Set());
    this.savingWorkoutIds.set(new Set());
    for (const key of Object.keys(this.workoutNotes)) delete this.workoutNotes[key];
  }
}
