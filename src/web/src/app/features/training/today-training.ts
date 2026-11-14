import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { DatePipe, DecimalPipe, formatDate, formatNumber } from '@angular/common';
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
import type { DialogRef } from '@angular/cdk/dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, failureKind } from '../../core/api/api-error';
import type {
  ClientExerciseView,
  ClientSetView,
  ClientTrainingDayResult,
  ClientWorkoutView,
  MediaAccessView,
  OwnWorkoutView,
  PoolExerciseView,
  PreviousSetPerformanceView,
  TrainingLoadUnit,
  WorkoutFinishSummaryView,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import type { HoldsUnsavedWork } from '../../core/forms/leave-guard';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { workoutStatusLabel } from '../../core/i18n/display-labels';
import { Motion } from '../../core/motion/motion';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { EmptyState } from '../../ui/empty-state';
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import type { ModalSurface } from '../../ui/modal-surface';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { UiSheet } from '../../ui/sheet';
import { StatusLabel } from '../../ui/status-label';
import type { ShareFact } from '../share-cards/share-card.models';
import { ShareTeaser } from '../share-cards/share-teaser';
import { PoolPicker } from './pool-picker';
import { DemoClip } from './demo-clip';
import { type ClipDemo, DemoClips } from './demo-clips';
import { externalVideo } from './external-video';
import { OwnWorkoutApi } from './own-workout-api';
import {
  changeRefusalWords,
  exerciseHasNote,
  isOwnWorkout,
  OWN_EXERCISE_LIMIT,
  OWN_SET_LIMIT,
  ownRefusal,
  ownWorkoutAsPlayed,
  startRefusalWords,
  type OwnPlayedWorkout,
} from './own-workout.models';
import { PlatesSheet } from './plates-sheet';
import { type FinishFormats, playFinishMoment } from './finish-moment';
import { playPlayerMoment } from './player-moment';
import { weightNoteLine, type WeightNoteLine } from './weight-note-words';
import { RestTimer } from './rest-timer';
import { buzzSet, planSetMoment, playSetMoment, recordNotice } from './set-moment';
import { nullableNumeric, numeric } from './training-builder.models';
import {
  mapUpcomingTraining,
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
  repsMissing,
  snapshotWorkoutSetDraft,
  startingWorkoutUnit,
  startsWithoutReps,
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

/**
 * The workout's program of TB Gym's lost its plan (TRN-034, notes plan N9c3): nothing more is logged,
 * finishing stays open, and no read lists the workout any more, so the page must not read it again.
 */
function isPlanClosed(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 409 &&
    (error.error as { code?: string } | null)?.code === 'program_plan_closed'
  );
}

/** Another tab or phone changed or finished this workout since this page read it. */
function isConflict(error: unknown): error is HttpErrorResponse {
  return error instanceof HttpErrorResponse && error.status === 409 && !isPlanClosed(error);
}

/** The same demos in the same order: a reload that reads them again changes nothing in the clip. */
function sameDemos(a: readonly ClipDemo[], b: readonly ClipDemo[]): boolean {
  return (
    a.length === b.length &&
    a.every((demo, index) => demo.id === b[index].id && demo.kind === b[index].kind)
  );
}

@Component({
  selector: 'app-today-training',
  imports: [
    Button,
    ButtonLink,
    DemoClip,
    PoolPicker,
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
    UiDisclosure,
    UiDisclosureContent,
    UiMenu,
    PlatesSheet,
  ],
  templateUrl: './today-training.html',
  // The set rows, the demo overlay's link panel, the shown exercise's clip and a workout of one's own
  // have their own sheets: the main one sits near the 8 kB style budget.
  styleUrls: [
    './today-training.scss',
    './today-training-sets.scss',
    './today-training-media.scss',
    './today-training-clip.scss',
    './today-training-moments.scss',
    './today-training-note.scss',
    './today-training-own.scss',
  ],
  // The player is always drawn on the night colour, so the kit pieces inside it read the dark tokens.
  host: { 'data-mode': 'dark', '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class TodayTraining implements HoldsUnsavedWork {
  private readonly api = inject(ApiClient);
  private readonly ownApi = inject(OwnWorkoutApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly dialogs = inject(UiDialog);
  private readonly sheets = inject(UiSheet);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly locale = inject(LOCALE_ID);
  private readonly motion = inject(Motion);
  /** The one pause every demo clip follows; the overlay's bigger view starts as the clips do (N9b4). */
  protected readonly clips = inject(DemoClips);
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
  /** Each change to a workout of one's own has a lane of its own, so a second press queues, never cancels. */
  private ownChanges = 0;
  // A workout of one's own (notes plan N9b3): the pool's picker in the kit's sheet, and the question
  // before an exercise or a set with something logged is taken away.
  private readonly pickerSheet = viewChild<TemplateRef<unknown>>('pickerSheet');
  private pickerRef: DialogRef<unknown, ModalSurface> | null = null;
  private readonly removeDialog = viewChild.required<TemplateRef<unknown>>('removeDialog');
  /** The exercises added since the picker opened, and those on their way, so a second press adds none. */
  protected readonly pickerAdded = signal<ReadonlyMap<string, number>>(new Map());
  private readonly pickerPending = new Set<string>();
  /** Each sentence counted, so the same words said twice are heard twice. */
  protected readonly pickerAnnouncement = signal<{
    readonly text: string;
    readonly version: number;
  } | null>(null);
  private announcements = 0;
  protected readonly pickerProblem = signal<string | null>(null);
  protected readonly removeMessage = signal('');
  protected readonly removeConfirm = signal('');
  protected readonly removeCancel = $localize`Keep it`;
  /**
   * Who sees the page when there is nothing to train: a trainee of TB Gym's own space starts a workout of
   * their own (CLI-026), a coach's client reads why there is nothing; read only then, and 'unknown' when the
   * profile could not say, which gets a line true for both.
   */
  protected readonly profile = signal<'trainee' | 'coached' | 'unknown' | null>(null);
  protected readonly isOwn = isOwnWorkout;
  protected readonly exerciseLimit = OWN_EXERCISE_LIMIT;
  protected readonly setLimit = OWN_SET_LIMIT;
  /** The exercises whose last set or whole is being taken away: a second press waits for nothing. */
  private readonly removing = new Set<string>();
  protected readonly ownNoteLabel = $localize`Workout note`;
  protected readonly coachNoteLabel = $localize`Note for your coach`;

  protected readonly day = signal<ClientTrainingDayResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** Counts every sentence said, so the pinned pill is drawn anew even for the same words (W3). */
  private readonly noticeVersion = signal(0);
  protected readonly noticeLines = computed(() => {
    const text = this.notice();
    return text === null ? [] : [{ version: this.noticeVersion(), text }];
  });
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
  /** How the summary writes its time and its volume, so the count ends on the page's own strings (W4). */
  private readonly finishFormats: FinishFormats = {
    time: (seconds) => this.clockLabel(seconds),
    volume: (value) => formatNumber(value, this.locale, '1.0-1'),
  };
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
  /**
   * The shown exercise's demos as its looping clip reads them (notes plan N9b4): the ids alone, as a
   * workout's read names them, each one's kind learnt from its grant. The panel drawn is the shown
   * exercise's, and a reload that reads the same ids keeps this list, so the clip asks nothing again.
   */
  protected readonly shownDemos = computed<readonly ClipDemo[]>(
    () => (this.activeExercise()?.mediaAssetIds ?? []).map((id) => ({ id, kind: null })),
    { equal: sameDemos },
  );
  /** The exercises already in the workout shown, which the picker marks. */
  protected readonly pickerInWorkout = computed<ReadonlySet<string>>(
    () =>
      new Set((this.activeWorkout()?.exercises ?? []).map((exercise) => exercise.actualExerciseId)),
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
  /** The sets whose More options is open; a refused effort opens it on its box (critique B2b). */
  private readonly optionsOpen = signal<ReadonlySet<string>>(new Set());
  protected readonly workoutNotes: Record<string, string> = {};
  private readonly errorSummary = viewChild<ElementRef<HTMLElement>>('errorSummary');
  protected readonly mediaDialog = viewChild<ElementRef<HTMLElement>>('mediaDialog');
  // The barbell (W11): a reading of a set's draft weight as plates, in the kit's sheet over the player.
  private readonly platesSheet = viewChild<TemplateRef<unknown>>('platesSheet');
  protected readonly platesWeight = signal<number | null>(null);
  protected readonly platesUnit = signal<TrainingLoadUnit | null>(null);
  private platesRef: DialogRef<unknown, ModalSurface> | null = null;
  protected readonly mediaCloseButton = viewChild<ElementRef<HTMLButtonElement>>('mediaClose');
  protected readonly externalVideo = externalVideo;
  protected readonly accessReasonLabel = trainingReadAccessLabel;
  protected readonly workoutStatusLabel = workoutStatusLabel;
  protected readonly noteTime = workoutNoteTime;
  protected readonly unitWord = unitWord;
  protected readonly startsWithoutReps = startsWithoutReps;
  /** What ✓ says on a last time + step set whose reps box is empty (TRN-029 v2). */
  private readonly repsFirst = $localize`Type your reps first.`;
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
      this.platesRef?.close();
      this.pickerRef?.close();
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
            this.say($localize`Workout started.`);
            void this.keepScreenAwake();
          }
        }),
      );
    });
  }

  /**
   * A workout of one's own, started here when nothing is in progress (TRN-033): it opens empty, for its
   * first exercise. A refusal says why; one started on another phone or tab meanwhile is shown instead.
   */
  protected async startOwn(): Promise<void> {
    // Asked before the lane is taken: a second press would otherwise cancel the first start.
    if (this.busy()) return;
    return this.scope.run('startOwn', async (owner) => {
      await owner.wait(
        this.runWrite(async (generation) => {
          try {
            const view = await owner.wait(firstValueFrom(this.ownApi.start()));
            if (!this.ownsContext(generation)) return;
            this.showOwn(this.applyOwnWorkout(view));
            this.say($localize`Workout started.`);
            void this.keepScreenAwake();
            // The Start button is gone with the empty state: focus goes to the first thing to do.
            this.focusSoon('[data-add-exercise]');
          } catch (error) {
            if (!owner.current || !this.ownsContext(generation)) return;
            if (ownRefusal(error) === 'in-progress') await owner.wait(this.load(false));
            if (this.ownsContext(generation)) this.reportError(startRefusalWords(error), true);
          }
        }),
      );
    });
  }

  /** The picker over TB Gym's pool, in the kit's sheet, dark over the player; it stays open for more. */
  protected openPicker(): void {
    const template = this.pickerSheet();
    if (!template) return;
    this.pickerRef?.close();
    this.pickerAdded.set(new Map());
    this.pickerAnnouncement.set(null);
    this.pickerProblem.set(null);
    const ref = this.sheets.open(template, {
      title: $localize`Add an exercise`,
      closeLabel: $localize`Close`,
      mode: 'dark',
    });
    this.pickerRef = ref;
    ref.closed.subscribe(() => {
      if (this.pickerRef === ref) this.pickerRef = null;
    });
  }

  protected closePicker(): void {
    this.pickerRef?.close();
  }

  /**
   * An exercise from the pool, shown at once with one empty set to type into (the server adds none);
   * a second press on the same row while the first is on its way adds nothing.
   */
  protected async addExercise(exercise: PoolExerciseView): Promise<void> {
    const workout = this.activeWorkout();
    const workoutId = workout?.workoutExecutionId;
    if (!workout || !workoutId || !isOwnWorkout(workout) || workout.status === 'Completed') return;
    if (this.pickerPending.has(exercise.id)) return;
    this.pickerPending.add(exercise.id);
    this.pickerProblem.set(null);
    try {
      const before = new Set(workout.exercises.map((item) => item.performanceId));
      const added = await this.changeOwn(
        workoutId,
        (version) => this.ownApi.addExercise(workoutId, exercise.id, version),
        $localize`${exercise.name}:exercise: couldn’t be added. Try again.`,
      );
      // This pick's own row: another pick queued before it may have answered with a new row of its own.
      const fresh = added?.exercises
        .filter((item) => item.actualExerciseId === exercise.id && !before.has(item.performanceId))
        .at(-1);
      if (!added || !fresh?.performanceId) return;
      this.pickerAdded.update((counts) =>
        new Map(counts).set(exercise.id, (counts.get(exercise.id) ?? 0) + 1),
      );
      this.showExercise(added.exercises.indexOf(fresh));
      const performanceId = fresh.performanceId;
      if (fresh.sets.length === 0) {
        await this.changeOwn(
          workoutId,
          (version) => this.ownApi.addSet(workoutId, performanceId, version),
          $localize`${exercise.name}:exercise: was added without a set. Add one with Add set.`,
        );
      }
      this.tell(
        (this.pickerAdded().get(exercise.id) ?? 0) > 1
          ? $localize`${exercise.name}:exercise: added again.`
          : $localize`${exercise.name}:exercise: added.`,
      );
    } finally {
      this.pickerPending.delete(exercise.id);
    }
  }

  protected async addSet(workout: ClientWorkoutView, exercise: ClientExerciseView): Promise<void> {
    const workoutId = workout.workoutExecutionId;
    const performanceId = exercise.performanceId;
    if (!workoutId || !performanceId || !isOwnWorkout(workout)) return;
    const done = await this.changeOwn(
      workoutId,
      (version) => this.ownApi.addSet(workoutId, performanceId, version),
      $localize`The set couldn’t be added. Try again.`,
    );
    if (done) this.say($localize`Set added.`);
  }

  /** Only the last set goes, so the sets stay numbered as last time's (TRN-033); a logged one is asked about. */
  protected async removeLastSet(
    workout: ClientWorkoutView,
    exercise: ClientExerciseView,
  ): Promise<void> {
    const workoutId = workout.workoutExecutionId;
    const performanceId = exercise.performanceId;
    const last = exercise.sets.at(-1);
    const setId = last?.performanceId;
    if (!workoutId || !performanceId || !last || !setId || !isOwnWorkout(workout)) return;
    if (this.removing.has(performanceId)) return;
    this.removing.add(performanceId);
    try {
      if (
        this.loggedOrLogging(last) &&
        !(await this.ask(
          $localize`Remove set ${exercise.sets.length}:number:?`,
          $localize`It’s logged. Once it’s removed, it’s gone from this workout.`,
          $localize`Remove set`,
        ))
      ) {
        return;
      }
      const after = await this.changeOwn(
        workoutId,
        (version) => this.ownApi.removeSet(workoutId, setId, version),
        $localize`The set couldn’t be removed. Try again.`,
      );
      if (!after) return;
      this.say($localize`Set removed.`);
      // With no set left its Remove button is gone: focus stays in the row, on Add set.
      if (!after.exercises.find((item) => item.performanceId === performanceId)?.sets.length) {
        this.focusSoon('[data-add-set]');
      }
    } finally {
      this.removing.delete(performanceId);
    }
  }

  /**
   * An exercise taken away with its sets, before the workout is finished (TRN-033). One a note names
   * stays, and the page says why; one with logged sets is asked about first.
   */
  protected async removeExercise(
    workout: ClientWorkoutView,
    exercise: ClientExerciseView,
  ): Promise<void> {
    const workoutId = workout.workoutExecutionId;
    const performanceId = exercise.performanceId;
    if (!workoutId || !performanceId || !isOwnWorkout(workout)) return;
    const name = exercise.actualExerciseName;
    if (exerciseHasNote(workout, performanceId)) {
      this.reportError($localize`This exercise has a note, so it stays in this workout.`, true);
      return;
    }
    if (this.removing.has(performanceId)) return;
    this.removing.add(performanceId);
    try {
      const logged = exercise.sets.filter((set) => this.loggedOrLogging(set)).length;
      if (
        logged > 0 &&
        !(await this.ask(
          $localize`Remove ${name}:exercise:?`,
          logged === 1
            ? $localize`Its logged set goes with it.`
            : $localize`Its ${logged}:count: logged sets go with it.`,
          $localize`Remove exercise`,
        ))
      ) {
        return;
      }
      const index = this.activeExerciseIndex();
      const after = await this.changeOwn(
        workoutId,
        (version) => this.ownApi.removeExercise(workoutId, performanceId, version),
        $localize`${name}:exercise: couldn’t be removed. Try again.`,
      );
      if (!after) return;
      this.activeExerciseIndex.set(Math.max(0, Math.min(index, after.exercises.length - 1)));
      this.say($localize`${name}:exercise: removed.`);
      // Its button went with it: focus moves to Add an exercise, always there while the workout runs.
      this.focusSoon('[data-add-exercise]');
    } finally {
      this.removing.delete(performanceId);
    }
  }

  /** Logged, or on its way to being logged: a ✓ still saving counts, so taking it away is asked about. */
  private loggedOrLogging(set: ClientSetView): boolean {
    return (
      set.isCompleted ||
      this.setDraft(set)?.isCompleted === true ||
      (set.performanceId !== null && this.savingSetIds().has(set.performanceId))
    );
  }

  protected hasNote(workout: ClientWorkoutView, exercise: ClientExerciseView): boolean {
    return exercise.performanceId !== null && exerciseHasNote(workout, exercise.performanceId);
  }

  /** The set buttons' group, named for its exercise, since each exercise has its own. */
  protected setsLabel(exercise: ClientExerciseView): string {
    return $localize`Sets of ${exercise.actualExerciseName}:exercise:`;
  }

  /** Focus on the player's control once the next render has drawn it, unless focus went elsewhere. */
  private focusSoon(selector: string): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && this.host.nativeElement.contains(active)) return;
        (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** The kit's question, dark over the player, before something logged is taken away. */
  private async ask(title: string, message: string, confirm: string): Promise<boolean> {
    this.removeMessage.set(message);
    this.removeConfirm.set(confirm);
    const dialog = this.dialogs.open<boolean>(this.removeDialog(), {
      title,
      closeLabel: $localize`Close`,
      mode: 'dark',
    });
    return (await firstValueFrom(dialog.closed)) === true;
  }

  /** What a change did: in the picker while it is open over the page, else on the page's own line. */
  private tell(text: string): void {
    if (this.pickerRef) this.pickerAnnouncement.set({ text, version: ++this.announcements });
    else this.say(text);
  }

  /**
   * One change to a workout of one's own, queued behind any set still saving to it (each moves the
   * version), sent on the version the page holds then. The answer is the whole workout, put in place.
   * A refusal says why; when the workout moved on elsewhere it is read again first, so it shows as it is.
   * Never sent twice by itself: adding is not idempotent.
   */
  private async changeOwn(
    workoutId: string,
    send: (version: number) => Observable<OwnWorkoutView>,
    fallback: string,
  ): Promise<OwnPlayedWorkout | null> {
    return this.scope.run(
      `own:${++this.ownChanges}`,
      async (owner) => {
        const generation = this.contextGeneration;
        let changed: OwnPlayedWorkout | null = null;
        const previous = this.workoutSaveQueues.get(workoutId) ?? Promise.resolve(true);
        const operation = previous.then(async () => {
          if (!this.ownsContext(generation)) return false;
          this.busy.set(true);
          this.clearMessages();
          try {
            await owner.wait(this.csrf.refresh());
            const current = this.day()?.workouts.find(
              (item) => item.workoutExecutionId === workoutId,
            );
            if (!current || current.status === 'Completed' || current.executionVersion == null) {
              return false;
            }
            const view = await owner.wait(firstValueFrom(send(numeric(current.executionVersion))));
            if (!this.ownsContext(generation)) return false;
            changed = this.applyOwnWorkout(view);
            return true;
          } catch (error) {
            if (!owner.current || !this.ownsContext(generation)) return false;
            const refusal = ownRefusal(error);
            if (refusal === 'closed') {
              await this.refreshAccess(generation);
            } else if (refusal !== null && refusal !== 'limit') {
              await owner.wait(this.load(false));
            }
            if (this.ownsContext(generation)) {
              const words = changeRefusalWords(error, fallback);
              // While the picker is open its own line says why, and focus stays in it: the page's line is
              // behind the sheet, hidden from a screen reader.
              this.reportError(words, !this.pickerRef);
              if (this.pickerRef) this.pickerProblem.set(words);
            }
            return false;
          } finally {
            if (owner.current && this.ownsContext(generation)) this.busy.set(false);
          }
        });
        this.workoutSaveQueues.set(workoutId, operation);
        await owner.wait(operation);
        if (this.workoutSaveQueues.get(workoutId) === operation) {
          this.workoutSaveQueues.delete(workoutId);
        }
        return changed;
      },
      null,
    );
  }

  /** The workout of one's own as the server answered it, in its place in the day, typed work kept (TRN-017). */
  private applyOwnWorkout(view: OwnWorkoutView): OwnPlayedWorkout {
    const played = ownWorkoutAsPlayed(view);
    this.day.update((day) => {
      if (!day) return day;
      const at = day.workouts.findIndex(
        (item) => item.workoutExecutionId === played.workoutExecutionId,
      );
      return {
        ...day,
        workouts:
          at >= 0
            ? day.workouts.map((item, index) => (index === at ? played : item))
            : [played, ...day.workouts],
      };
    });
    const day = this.day();
    if (day) {
      this.setDrafts.update((drafts) => reconcileWorkoutSetDrafts(day, drafts, this.chosenUnits));
    }
    this.settleOwnUnit(played);
    return played;
  }

  /**
   * A workout of one's own shows one unit, and its sets follow it (TRN-029, TRN-016). With nothing
   * prescribed, the choice starts where last time's loads put it; once known, chosen or started so, it
   * holds for every set as a chosen unit does, so a set whose last time is in the other unit starts
   * empty rather than under a label it is not in, and a load typed before takes the unit shown.
   */
  private settleOwnUnit(workout: ClientWorkoutView | null | undefined): void {
    if (!isOwnWorkout(workout) || workout.status === 'Completed') return;
    const unit = this.unitFor(workout);
    if (!unit) return;
    if (this.activeWorkout()?.sessionId === workout.sessionId) {
      this.workoutUnit.set(unit);
      this.unitSessionId = workout.sessionId;
    }
    this.chosenUnits.set(workout.sessionId, unit);
    this.setDrafts.update((drafts) => withWorkoutUnit(drafts, workout, unit));
  }

  /** A workout of one's own just started: it is the one shown, from its first exercise. */
  private showOwn(played: OwnPlayedWorkout): void {
    this.selectedSession.set(played.sessionId);
    this.activeExerciseIndex.set(0);
    this.workoutUnit.set(this.unitFor(played));
    this.unitSessionId = played.sessionId;
    this.settleOwnUnit(played);
  }

  /** Training closed meanwhile: the page says so, as it does when a set is refused for it. */
  private async refreshAccess(generation: number): Promise<void> {
    try {
      const access = await firstValueFrom(this.api.getMyUpcomingTraining());
      if (!this.ownsContext(generation) || access.isAllowed) return;
      this.day.update((day) =>
        day ? { ...day, isAllowed: false, accessReason: access.accessReason } : day,
      );
    } catch {
      /* The refusal's own words still say what happened. */
    }
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
          this.optionsToggled(set, true);
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
            // Read before the page updates: what the answer changes is the moment (W3).
            const moment = planSetMoment(this.day(), recorded, this.prSetIds());
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
              this.say(
                moment
                  ? recordNotice(moment.exerciseName, recorded)
                  : $localize`New personal record!`,
              );
            } else {
              this.say($localize`Set saved.`);
            }
            buzzSet(recorded.isPersonalRecord === true, navigator);
            this.editingSetIds.update((ids) => new Set([...ids].filter((id) => id !== setId)));
            if (moment) {
              afterNextRender(() => playSetMoment(this.host.nativeElement, moment, this.motion), {
                injector: this.injector,
              });
            }
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
            if (isPlanClosed(error)) this.dropUnloggedSets(workoutId);
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

  /**
   * The workout's program lost its plan (TRN-034): no set of it can be logged any more, so what this page
   * typed for it goes back to what the server holds, and Finish and leaving wait for nothing. The page is
   * not read again, since no read lists the workout now: it stays on screen to be finished.
   */
  private dropUnloggedSets(workoutId: string): void {
    const day = this.day();
    const workout = day?.workouts.find((item) => item.workoutExecutionId === workoutId);
    if (!day || !workout) return;
    const kept = reconcileWorkoutSetDrafts({ ...day, workouts: [workout] }, {}, this.chosenUnits);
    this.setDrafts.update((drafts) => {
      const next = { ...drafts };
      for (const [id, draft] of Object.entries(kept)) {
        // A new revision, so a save still on its way cannot settle the dropped draft.
        next[id] = { ...draft, revision: (drafts[id]?.revision ?? 0) + 1 };
      }
      return next;
    });
  }

  /** Why a set was not saved, in words the client can act on. */
  private saveFailure(error: unknown, workoutId: string): string {
    if (isPlanClosed(error)) {
      return apiErrorMessage(error, '');
    }
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
      // A last time + step set counts only with the reps done (TRN-029 v2). Asked before the set is
      // marked logged, so it stays untouched: nothing is sent, no rest starts, Finish and leaving
      // wait for nothing.
      if (set.performanceId && repsMissing(set, this.setDraft(set))) {
        this.reportSetError(set.performanceId, this.repsFirst, true);
        return;
      }
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
    this.settleOwnUnit(workout);
  }

  /** The unit a workout shows: the one the client chose for it, else where TRN-029 starts it. */
  private unitFor(workout: ClientWorkoutView): TrainingLoadUnit | null {
    return (
      this.chosenUnits.get(workout.sessionId) ?? startingWorkoutUnit(workout, this.setDrafts())
    );
  }

  private workoutHint(workout: ClientWorkoutView, startedFor: string | undefined): string {
    if (isOwnWorkout(workout)) {
      return workout.status === 'Completed'
        ? $localize`Your own · done`
        : $localize`Your own · in progress`;
    }
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
  /**
   * Why the coach set this lift's weight (notes plan N6c): "Up 2 kg · all 3 × 10 done on Tue", from the day's own
   * date. None on a swap, as the Target line leaves the coach's weight out there (TRN-029).
   */
  protected weightNote(exercise: ClientExerciseView): WeightNoteLine | null {
    const note = exercise.weightNote;
    const today = this.day()?.localDate;
    return note && today && !exercise.wasSubstituted
      ? weightNoteLine(note, today, this.locale)
      : null;
  }

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
    const { sets, note, ownNote } = this.unsavedWork();
    if (!sets && !note) return true;
    // A note on a workout of one's own goes to nobody (TRN-033): it is saved, not sent.
    this.leaveMessage.set(
      sets && note
        ? ownNote
          ? $localize`Sets you changed aren’t logged and your note isn’t saved. If you leave now, they are lost.`
          : $localize`Sets you changed aren’t logged and your note isn’t sent. If you leave now, they are lost.`
        : sets
          ? $localize`Sets you changed aren’t logged. If you leave now, the changes are lost.`
          : ownNote
            ? $localize`Your workout note isn’t saved. If you leave now, it is lost.`
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
  private unsavedWork(): { sets: boolean; note: boolean; ownNote: boolean } {
    const open = (this.day()?.workouts ?? []).filter(
      (workout) => workout.workoutExecutionId && workout.status !== 'Completed',
    );
    const drafts = this.setDrafts();
    const noted = open.filter((workout) => Boolean(this.workoutNotes[workout.sessionId]?.trim()));
    return {
      sets: open.some((workout) =>
        workout.exercises.some((exercise) =>
          exercise.sets.some((set) => set.performanceId && drafts[set.performanceId]?.dirty),
        ),
      ),
      note: noted.length > 0,
      ownNote: noted.length > 0 && noted.every(isOwnWorkout),
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

  /** The reps box ✓ asked for (TRN-029 v2), marked until a number is in it. */
  protected repsAsked(set: ClientSetView, draft: WorkoutSetDraft | null): boolean {
    return (
      set.performanceId !== null &&
      this.setErrors()[set.performanceId] === this.repsFirst &&
      repsMissing(set, draft)
    );
  }

  protected optionsShown(set: ClientSetView): boolean {
    return set.performanceId !== null && this.optionsOpen().has(set.performanceId);
  }

  protected optionsToggled(set: ClientSetView, open: boolean): void {
    const id = set.performanceId;
    if (!id) return;
    this.optionsOpen.update((ids) => {
      const next = new Set(ids);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
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
            this.say($localize`Swapped to ${name}.`);
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
            this.say($localize`Workout note added.`);
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
          this.say($localize`Workout completed.`);
          const summary = response.finishSummary;
          if (summary) {
            // The summary is complete in this render; its moment runs after it (W4).
            afterNextRender(
              () =>
                playFinishMoment(this.host.nativeElement, summary, this.motion, this.finishFormats),
              { injector: this.injector },
            );
          }
        }),
      );
    });
  }

  /** The set being entered in this exercise, whose draft weight the Plates sheet reads; null once all are logged. */
  protected editableSet(exercise: ClientExerciseView): ClientSetView | null {
    return exercise.sets.find((set) => set.performanceId && !this.collapsed(set)) ?? null;
  }

  /**
   * Opens the Plates sheet (W11) on the exercise's draft weight in the client's own unit, or on the
   * target weight tapped. A reading and a guide: it changes nothing in the set.
   */
  protected openPlates(
    exercise: ClientExerciseView,
    weight?: string | number | null,
    unit?: TrainingLoadUnit | null,
  ): void {
    const set = this.editableSet(exercise);
    const draft = set ? this.setDraft(set) : null;
    const load =
      weight !== undefined ? weight : draft ? draft.actualLoad : (set?.prescribedLoad ?? null);
    const loadUnit =
      unit ?? draft?.actualLoadUnit ?? this.workoutUnit() ?? set?.prescribedLoadUnit ?? null;
    this.platesWeight.set(plateWeight(load));
    this.platesUnit.set(loadUnit);
    const template = this.platesSheet();
    if (!template) return;
    this.platesRef?.close();
    const ref = this.sheets.open(template, {
      title: $localize`Plates`,
      closeLabel: $localize`Close`,
      mode: 'dark',
    });
    this.platesRef = ref;
    ref.closed.subscribe(() => {
      if (this.platesRef === ref) this.platesRef = null;
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
        const [day, upcomingView] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getMyTrainingToday()),
            firstValueFrom(this.api.getMyUpcomingTraining(this.upcomingSkip)),
          ]),
        );
        if (!this.ownsLoad(generation, request)) return;
        const upcoming = mapUpcomingTraining(upcomingView);
        const allowed = day.isAllowed && upcoming.isAllowed;
        // A workout of one's own in progress comes first (TRN-033). Today's read carries only an
        // unfinished one, so one shown here that the read no longer carries was finished on another
        // phone or tab: it stays, read only, as a finished program's workout does.
        const own = day.ownWorkout ? ownWorkoutAsPlayed(day.ownWorkout) : null;
        const finishedElsewhere = (this.day()?.workouts ?? [])
          .filter(isOwnWorkout)
          .filter((item) => item.workoutExecutionId !== own?.workoutExecutionId)
          .map((item) =>
            item.status === 'Completed' ? item : { ...item, status: 'Completed' as const },
          );
        const combined: ClientTrainingDayResult = {
          ...day,
          ownWorkout: null,
          isAllowed: allowed,
          accessReason: !day.isAllowed ? day.accessReason : upcoming.accessReason,
          workouts: allowed
            ? [
                ...(own ? [own] : []),
                ...day.workouts,
                ...upcoming.unfinishedWorkouts.map((item) => item.workout),
                ...finishedElsewhere,
              ]
            : (this.day()?.workouts ?? []),
        };
        // With no program and nothing to train, who is asking decides the page (CLI-026): asked once.
        if (allowed && !combined.workouts.length && !upcoming.hasAssignedProgram) {
          if (this.profile() === null) {
            const profile = await owner.wait(this.readProfile());
            if (!this.ownsLoad(generation, request)) return;
            this.profile.set(profile);
          }
        }
        this.upcoming.set(upcoming);
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
        this.settleOwnUnit(active);
        if (showLoading) {
          // The skeleton goes in this render; the player's parts rise in after it (W7).
          afterNextRender(() => playPlayerMoment(this.host.nativeElement, this.motion), {
            injector: this.injector,
          });
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

  /** Whether a trainee of TB Gym's own space asks (CLI-026); 'unknown' when the profile could not say. */
  private async readProfile(): Promise<'trainee' | 'coached' | 'unknown'> {
    try {
      const self = await firstValueFrom(this.api.getSelfProfile());
      return self.selfDirected === true ? 'trainee' : 'coached';
    } catch {
      return 'unknown';
    }
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
    this.resetOwn();
    this.clearMessages();
  }

  /** A workout of one's own: the picker and its marks, and who the page was for, start again. */
  private resetOwn(): void {
    this.pickerRef?.close();
    this.pickerRef = null;
    this.pickerAdded.set(new Map());
    this.pickerPending.clear();
    this.pickerAnnouncement.set(null);
    this.pickerProblem.set(null);
    this.profile.set(null);
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
    this.say(null);
  }

  /** The status line's sentence; each one is counted so the pinned pill starts afresh (W3). */
  private say(text: string | null): void {
    this.notice.set(text);
    this.noticeVersion.update((version) => version + 1);
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
    this.say(null);
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
    this.resetOwn();
  }
}

/** A load as the sheet reads it: the API hands decimals as strings too; nothing numeric is null. */
function plateWeight(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
