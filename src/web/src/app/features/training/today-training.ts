import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, DecimalPipe, formatDate } from '@angular/common';
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
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, failureKind } from '../../core/api/api-error';
import type {
  ClientExerciseView,
  ClientSetView,
  ClientTrainingDayResult,
  ClientWorkoutView,
  MediaAccessView,
  PreviousSetPerformanceView,
  TrainingLoadUnit,
  WorkoutFinishSummaryView,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { workoutStatusLabel } from '../../core/i18n/display-labels';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { StatusLabel } from '../../ui/status-label';
import type { ShareFact } from '../share-cards/share-card.models';
import { ShareTeaser } from '../share-cards/share-teaser';
import { externalVideo } from './external-video';
import { RestTimer } from './rest-timer';
import { nullableNumeric, numeric } from './training-builder.models';
import {
  trainingReadAccessLabel,
  workoutNoteTime,
  type UpcomingTraining,
} from './training-read.models';
import {
  applyWorkoutSetSave,
  applyWorkoutSetSaveToDay,
  effortOutOfRange,
  hasLoadUnitForActualLoad,
  previousSetFor,
  reconcileWorkoutSetDrafts,
  snapshotWorkoutSetDraft,
  startingWorkoutUnit,
  toRecordSetRequest,
  updateWorkoutSetDraft,
  withWorkoutUnit,
  type WorkoutSetDraft,
  type WorkoutSetDrafts,
} from './workout-set-drafts';

/** The workout's kg or lb choice; neither is chosen until the coach or last time says (TRN-016). */
const UNIT_OPTIONS: readonly SegmentOption[] = [
  { value: 'Kilogram', label: 'kg' },
  { value: 'Pound', label: 'lb' },
];

const unitWord = (unit: TrainingLoadUnit | null | undefined) =>
  unit === 'Kilogram' ? 'kg' : unit === 'Pound' ? 'lb' : '';

/** The server kept the lift because a set is already logged under it (CLIENT-2). */
function isSwapLocked(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 409 &&
    (error.error as { code?: string } | null)?.code === 'substitution_after_logged_set'
  );
}

/** Another tab or phone changed or finished this workout since this page read it. */
function isConflict(error: unknown): error is HttpErrorResponse {
  return error instanceof HttpErrorResponse && error.status === 409;
}

@Component({
  selector: 'app-today-training',
  imports: [
    Button,
    ButtonLink,
    FormsModule,
    DatePipe,
    DecimalPipe,
    EmptyState,
    RestTimer,
    RouterLink,
    SegmentedControl,
    ShareTeaser,
    StatusLabel,
    UiConfirm,
    UiMenu,
  ],
  templateUrl: './today-training.html',
  // The set rows and the demo overlay's link panel have their own sheets: the main one sits near the
  // 8 kB style budget.
  styleUrls: ['./today-training.scss', './today-training-sets.scss', './today-training-media.scss'],
  // The player is always drawn on the night colour, so the kit pieces inside it read the dark tokens.
  host: { 'data-mode': 'dark', '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class TodayTraining implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly dialogs = inject(UiDialog);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly locale = inject(LOCALE_ID);
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
  /** The kg or lb the client chose, per workout, kept through every reload of the day (CLIENT-1). */
  private readonly chosenUnits = new Map<string, TrainingLoadUnit>();
  private readonly leaveDialog = viewChild.required<TemplateRef<unknown>>('leaveDialog');

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
  /** What the finish summary offers to share (M9): the program this workout finished, then its records. */
  protected readonly shareFacts = computed<ShareFact[]>(() => {
    const summary = this.finishSummary();
    if (!summary) return [];
    return [
      ...(summary.finishedProgram
        ? [{ kind: 'program' as const, program: summary.finishedProgram }]
        : []),
      ...summary.personalRecords.map((record) => ({ kind: 'record' as const, record })),
    ];
  });
  protected readonly finishedWorkoutName = signal('');
  protected readonly activeExerciseIndex = signal(0);
  protected readonly workoutUnit = signal<TrainingLoadUnit | null>(null);
  protected readonly prSetIds = signal<ReadonlySet<string>>(new Set());
  protected readonly now = signal(Date.now());
  private readonly restTimer = viewChild(RestTimer);
  protected readonly unitOptions = UNIT_OPTIONS;
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
  /** Today's workouts and the unfinished earlier ones, for Choose workout. */
  protected readonly workoutChoices = computed<UiMenuItem[]>(() => {
    const startedFor = new Map(
      (this.upcoming()?.unfinishedWorkouts ?? []).map((item) => [
        item.workout.sessionId,
        item.date,
      ]),
    );
    return (this.day()?.workouts ?? []).map((workout) => ({
      label: workout.name,
      hint: this.workoutHint(workout, startedFor.get(workout.sessionId)),
      action: workout.sessionId,
    }));
  });
  protected readonly activeMedia = signal<MediaAccessView | null>(null);
  protected readonly setDrafts = signal<WorkoutSetDrafts>({});
  protected readonly savingSetIds = signal<ReadonlySet<string>>(new Set());
  protected readonly savingWorkoutIds = signal<ReadonlySet<string>>(new Set());
  protected readonly workoutNotes: Record<string, string> = {};
  private readonly errorSummary = viewChild<ElementRef<HTMLElement>>('errorSummary');
  protected readonly mediaDialog = viewChild<ElementRef<HTMLElement>>('mediaDialog');
  protected readonly mediaCloseButton = viewChild<ElementRef<HTMLButtonElement>>('mediaClose');
  protected readonly externalVideo = externalVideo;
  protected readonly accessReasonLabel = trainingReadAccessLabel;
  protected readonly workoutStatusLabel = workoutStatusLabel;
  protected readonly noteTime = workoutNoteTime;
  protected readonly unitWord = unitWord;
  protected readonly leaveMessage = signal('');
  protected readonly leaveConfirm = $localize`Leave without saving`;
  protected readonly leaveCancel = $localize`Stay`;
  /** The unit sits far above the sets, so each load says which one it is in. */
  protected readonly loadCaption = computed(() => {
    const unit = this.workoutUnit();
    return unit === 'Kilogram'
      ? $localize`Load (kg)`
      : unit === 'Pound'
        ? $localize`Load (lb)`
        : $localize`Load`;
  });
  /**
   * Why loads are empty after choosing the other unit than the coach's: nothing is converted, so the
   * client types what they lift (CLIENT-1).
   */
  protected readonly unitNote = computed(() => {
    const workout = this.activeWorkout();
    const chosen = this.workoutUnit();
    if (!workout?.workoutExecutionId || workout.status === 'Completed' || !chosen) return null;
    const coachUnit = workout.exercises
      .filter((exercise) => !exercise.wasSubstituted)
      .flatMap((exercise) => exercise.sets)
      .find(
        (set) =>
          !set.isCompleted &&
          set.prescribedLoad !== null &&
          set.prescribedLoadUnit &&
          set.prescribedLoadUnit !== chosen,
      )?.prescribedLoadUnit;
    return coachUnit
      ? $localize`Your coach set these loads in ${unitWord(coachUnit)}:coachUnit:. Type what you lift in ${unitWord(chosen)}:chosenUnit:.`
      : null;
  });

  constructor() {
    const unregister = inject(UnsavedWork).register(this);
    this.destroyRef.onDestroy(unregister);
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
        // The server's own refusal would cost a round trip and read like a system (CLIENT-5).
        const effort = effortOutOfRange(snapshot);
        if (effort) {
          this.reportSetError(
            setId,
            effort === 'rpe'
              ? $localize`RPE is a number from 5 to 10 in half steps, like 8 or 8.5.`
              : $localize`Reps left is a number from 0 to 5 in half steps, like 2 or 1.5.`,
            true,
          );
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
            const send = async () => {
              await owner.wait(this.csrf.refresh());
              if (!this.ownsContext(generation)) {
                return null;
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

              return owner.wait(
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
            };

            let response: WorkoutSetSaveView | null;
            try {
              response = await send();
            } catch (error) {
              if (!isConflict(error) || !this.ownsContext(generation)) {
                throw error;
              }
              // Another tab or phone saved to this workout first (CLIENT-3): read it again, keeping
              // what is typed here (TRN-017), and try once more on the version it has now, unless
              // it was finished there.
              await owner.wait(this.load(false));
              if (!this.ownsContext(generation)) {
                return false;
              }
              if (this.workoutFinished(workoutId)) {
                throw error;
              }
              response = await send();
            }
            if (!response || !this.ownsContext(generation)) {
              return false;
            }
            const recorded = response;
            this.day.update((day) => (day ? applyWorkoutSetSaveToDay(day, recorded) : day));
            this.setDrafts.update((drafts) =>
              applyWorkoutSetSave(drafts, recorded, snapshot.revision),
            );
            this.prSetIds.update((ids) => {
              const next = new Set(ids);
              if (recorded.isPersonalRecord) next.add(setId);
              else next.delete(setId);
              return next;
            });
            if (recorded.isPersonalRecord) {
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
            this.reportSetError(setId, this.saveFailure(error, workoutId));
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

  /** Why a set was not saved, in words the client can act on. */
  private saveFailure(error: unknown, workoutId: string): string {
    if (isConflict(error)) {
      return this.workoutFinished(workoutId) ||
        (error.error as { code?: string } | null)?.code === 'workout_immutable'
        ? $localize`This workout was finished on another phone or tab, so this set wasn’t saved.`
        : $localize`This workout changed on another phone or tab, so this set wasn’t saved. Your entries are still on this page. Log the set again.`;
    }
    // A lost connection said once, in the app's words (audit UIQ-2); a server fault adds nothing to it.
    if (failureKind(error) === 'connection') {
      return $localize`Couldn’t save this set: the app couldn’t connect. Your entries are still on this page. Check your connection and retry.`;
    }
    const explanation = apiErrorMessage(error, '');
    return (
      $localize`Couldn’t save this set. Your entries are still on this page. Retry.` +
      (explanation ? ` ${explanation}` : '')
    );
  }

  private workoutFinished(workoutId: string): boolean {
    return (
      this.day()?.workouts.find((item) => item.workoutExecutionId === workoutId)?.status ===
      'Completed'
    );
  }

  protected async logSet(
    workout: ClientWorkoutView,
    set: ClientSetView,
    event: Event,
  ): Promise<void> {
    // One lane per set: a second set ticked while the first saves must not cancel the first set's
    // rest timer and focus return (WEA-11).
    return this.scope.run(`logSet:${set.performanceId}`, async (owner) => {
      if (
        !this.day()?.isAllowed ||
        this.busy() ||
        (set.performanceId && this.savingSetIds().has(set.performanceId))
      )
        return;
      const trigger = event.currentTarget as HTMLElement | null;
      const restoreFocus = trigger !== null && document.activeElement === trigger;
      const rest = Number(set.restSeconds ?? 0);
      // Still inside the tap: a phone plays the rest's closing tone only once a tap allowed sound.
      if (rest > 0) this.restTimer()?.prepareSound();
      this.updateSetDraft(set, { isCompleted: true });
      const saved = await owner.wait(this.saveSet(workout, set));
      if (saved && set.performanceId) {
        if (rest > 0) this.restTimer()?.start(rest);
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

  /**
   * The header's time: counting from the start while the workout runs, and once it is finished the
   * time it took, as its finish summary says, which stays put (UIQ-1). Null when there is none.
   */
  protected workoutSeconds(workout: ClientWorkoutView): number | null {
    if (workout.status === 'Completed') {
      return workout.durationSeconds == null ? null : numeric(workout.durationSeconds);
    }
    return workout.startedAtUtc ? this.elapsed(workout) : null;
  }

  /** The rest after an exercise's last set is the rest before the next, so it keeps running. */
  protected showExercise(index: number): void {
    const workout = this.activeWorkout();
    if (!workout || index < 0 || index >= workout.exercises.length) return;
    this.activeExerciseIndex.set(index);
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

  /** Choosing kg or lb is not an edit: it relabels typed loads and restarts untouched sets (CLIENT-1). */
  protected chooseUnit(value: string): void {
    const unit = (value || null) as TrainingLoadUnit | null;
    this.workoutUnit.set(unit);
    const workout = this.activeWorkout();
    if (!workout) return;
    this.unitSessionId = workout.sessionId;
    if (!unit) return;
    this.chosenUnits.set(workout.sessionId, unit);
    this.setDrafts.update((drafts) => withWorkoutUnit(drafts, workout, unit));
  }

  protected selectWorkout(sessionId: string): void {
    if (sessionId === this.activeWorkout()?.sessionId) return;
    this.selectedSession.set(sessionId);
    this.activeExerciseIndex.set(0);
    const workout = this.day()?.workouts.find((item) => item.sessionId === sessionId);
    this.workoutUnit.set(workout ? this.unitFor(workout) : null);
    this.unitSessionId = sessionId;
  }

  /** The unit a workout shows: the one the client chose for it, else where TRN-029 starts it. */
  private unitFor(workout: ClientWorkoutView): TrainingLoadUnit | null {
    return (
      this.chosenUnits.get(workout.sessionId) ?? startingWorkoutUnit(workout, this.setDrafts())
    );
  }

  private workoutHint(workout: ClientWorkoutView, startedFor: string | undefined): string {
    if (startedFor) {
      return $localize`Started for ${formatDate(startedFor, 'EEE d MMM', this.locale)}`;
    }
    if (workout.status === 'Completed') return $localize`Today · done`;
    return workout.status === 'InProgress'
      ? $localize`Today · in progress`
      : $localize`Today · not started`;
  }

  /**
   * The exercise the coach prescribed, then the alternatives they approved at assignment. Once a set
   * is logged, the lift it was done as stays for this workout (CLIENT-2): the others are still listed,
   * closed, saying why.
   */
  protected swapChoices(exercise: ClientExerciseView): UiMenuItem[] {
    const logged = exercise.sets.some((set) => set.isCompleted);
    const closed = (exerciseId: string) => logged && exerciseId !== exercise.actualExerciseId;
    const why = $localize`Not this workout: a set is logged as ${exercise.actualExerciseName}:exercise:`;
    return [
      {
        label: exercise.prescribedExerciseName,
        hint: closed(exercise.prescribedExerciseId)
          ? why
          : $localize`The one your coach prescribed`,
        action: exercise.prescribedExerciseId,
        disabled: closed(exercise.prescribedExerciseId),
      },
      ...exercise.alternatives.map((alternative) => ({
        label: alternative.name,
        hint: closed(alternative.exerciseId) ? why : undefined,
        action: alternative.exerciseId,
        disabled: closed(alternative.exerciseId),
      })),
    ];
  }

  /** Last time's numbers on this set, by position, as the drafts read them (TRN-029). */
  protected previousSet(exercise: ClientExerciseView, set: ClientSetView) {
    return previousSetFor(exercise, set);
  }

  /** "57.5 kg × 7", in the unit it was lifted in, or a dash when this set has no last time. */
  protected previousLabel(prior: PreviousSetPerformanceView | null): string {
    if (!prior) return '—';
    const unit = prior.load == null ? '' : unitWord(prior.loadUnit);
    return `${prior.load ?? '—'}${unit ? ` ${unit}` : ''} × ${prior.repetitions ?? '—'}`;
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

  /**
   * Asks before the router, a workspace switch, a sign-out or an ended session takes the client away
   * from sets they changed but did not log, or a note they did not send (WEA-1). Nothing is logged
   * for them on the way out: a set is logged only by its ✓.
   */
  async canLeave(): Promise<boolean> {
    const { sets, note } = this.unsavedWork();
    if (!sets && !note) return true;
    this.leaveMessage.set(
      sets && note
        ? $localize`Sets you changed aren’t logged and your note isn’t sent. If you leave now, they are lost.`
        : sets
          ? $localize`Sets you changed aren’t logged. If you leave now, the changes are lost.`
          : $localize`Your note to your coach isn’t sent. If you leave now, it is lost.`,
    );
    const dialog = this.dialogs.open<boolean>(this.leaveDialog(), {
      title: $localize`Leave without saving?`,
      closeLabel: $localize`Close`,
      closeOnNavigation: false,
      mode: 'dark',
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  /** A reload or a closed tab cannot be held for a question in the page, so the browser asks. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    const { sets, note } = this.unsavedWork();
    if (sets || note) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  /** Work only this page holds, in workouts still open: a finished one can take neither. */
  private unsavedWork(): { sets: boolean; note: boolean } {
    const open = (this.day()?.workouts ?? []).filter(
      (workout) => workout.workoutExecutionId && workout.status !== 'Completed',
    );
    const drafts = this.setDrafts();
    return {
      sets: open.some((workout) =>
        workout.exercises.some((exercise) =>
          exercise.sets.some((set) => set.performanceId && drafts[set.performanceId]?.dirty),
        ),
      ),
      note: open.some((workout) => Boolean(this.workoutNotes[workout.sessionId]?.trim())),
    };
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

  /** The effort field whose number the server would refuse, so its hint says so at once. */
  protected effortProblem(draft: WorkoutSetDraft | null): 'rpe' | 'rir' | null {
    return draft ? effortOutOfRange(draft) : null;
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
    exerciseId: string,
  ): Promise<void> {
    return this.scope.run('substitute', async (owner) => {
      if (
        !exerciseId ||
        exerciseId === exercise.actualExerciseId ||
        !workout.workoutExecutionId ||
        !exercise.performanceId ||
        workout.executionVersion === null
      ) {
        return;
      }
      const name =
        this.swapChoices(exercise).find((choice) => choice.action === exerciseId)?.label ?? '';
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
          try {
            await owner.wait(
              firstValueFrom(
                this.api.substituteMyTrainingExercise(workoutId, exercise.performanceId!, {
                  exerciseId,
                  version: numeric(currentWorkout.executionVersion!),
                }),
              ),
            );
          } catch (error) {
            if (!isSwapLocked(error)) throw error;
            // A set was logged under this lift somewhere else (another tab or phone): show the
            // workout as it is now, then say why the lift stays.
            await owner.wait(this.load(false));
            if (this.ownsContext(writeGeneration)) {
              const now = this.day()
                ?.workouts.flatMap((item) => item.exercises)
                .find((item) => item.performanceId === exercise.performanceId);
              const name = now?.actualExerciseName ?? exercise.actualExerciseName;
              this.reportError(
                $localize`You logged a set as ${name}:exercise:, so this exercise stays ${name}:exercise: for this workout.`,
              );
            }
            return;
          }
          if (!this.ownsContext(writeGeneration)) {
            return;
          }
          await owner.wait(this.load(false));
          if (this.ownsContext(writeGeneration)) {
            this.notice.set($localize`Swapped to ${name}.`);
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
                      ? {
                          ...item,
                          status: response.status,
                          executionVersion: response.version,
                          durationSeconds: response.finishSummary?.durationSeconds ?? null,
                        }
                      : item,
                  ),
                }
              : day,
          );
          this.finishConfirmation.set(null);
          this.finishedWorkoutName.set(workout.name);
          this.finishSummary.set(response.finishSummary ?? null);
          this.restTimer()?.stop();
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
        // A YouTube or Vimeo demo opens in the same overlay, as a link to the video's own page.
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
        this.setDrafts.update((drafts) =>
          reconcileWorkoutSetDrafts(combined, drafts, this.chosenUnits),
        );
        const active =
          combined.workouts.find((item) => item.sessionId === this.selectedSession()) ??
          combined.workouts[0];
        if (active && this.unitSessionId !== active.sessionId) {
          this.workoutUnit.set(this.unitFor(active));
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
    this.chosenUnits.clear();
    this.prSetIds.set(new Set());
    this.restTimer()?.stop();
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
    this.chosenUnits.clear();
    this.prSetIds.set(new Set());
    this.restTimer()?.stop();
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
