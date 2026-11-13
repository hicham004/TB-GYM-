import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { OwnWorkoutView, PoolExerciseView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { DemoClip } from './demo-clip';
import { ExerciseDemo } from './exercise-demo';
import { ExercisePoolApi } from './exercise-pool-api';
import { clipDemos, poolExerciseFacts, poolExerciseIdFrom } from './exercise-pool.models';
import { OwnWorkoutApi } from './own-workout-api';
import {
  changeRefusalWords,
  ownRefusal,
  ownTrainingClosedWords,
  startRefusalWords,
} from './own-workout.models';

type PageState = 'loading' | 'ready' | 'error' | 'gone' | 'closed';

/** Why the last press did not open the player, and where to carry on when a workout waits there. */
interface Problem {
  readonly text: string;
  /** Carry on into the player: on this workout, or on whichever is unfinished when it is not known. */
  readonly carryOn: { readonly sessionId: string | null } | null;
}

/**
 * One exercise of TB Gym's pool (notes plan N9b4, LIB-006): its demo playing like a GIF with its own
 * pause, every demo behind one button when it has several, what it needs and works, and how it is
 * done. A trainee of the house's own space (CLI-026, notes plan N9b3) starts a workout with it, or adds
 * it to the one they have not finished: it comes with one empty set, as the player's picker adds one,
 * and the player opens on the workout. Each write is sent once, never again by itself (adding is not
 * idempotent); the server decides whether it may be done (TRN-033), and the page says why not.
 */
@Component({
  selector: 'app-pool-exercise',
  imports: [Button, ButtonLink, DemoClip, EmptyState, ExerciseDemo, Icon, RouterLink, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pool-exercise.html',
  styleUrl: './pool-exercise.scss',
})
export class PoolExercise {
  private readonly pool = inject(ExercisePoolApi);
  private readonly ownApi = inject(OwnWorkoutApi);
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  private readonly exerciseId = toSignal(
    this.route.paramMap.pipe(map((params) => poolExerciseIdFrom(params.get('exerciseId')))),
    { initialValue: poolExerciseIdFrom(this.route.snapshot.paramMap.get('exerciseId')) },
  );

  protected readonly loadingLabel = $localize`Loading the exercise…`;
  protected readonly state = signal<PageState>('loading');
  protected readonly exercise = signal<PoolExerciseView | null>(null);
  /** Why Training is closed, when the pool says it is. */
  private readonly closedReason = signal('');
  /** A trainee of TB Gym's own space, who alone is offered a workout here (N9b3); null until read. */
  private readonly selfDirected = signal<boolean | null>(null);
  /** Today's unfinished workout of one's own: null when there is none, undefined until Today is read. */
  private readonly unfinished = signal<OwnWorkoutView | null | undefined>(undefined);
  protected readonly working = signal(false);
  protected readonly problem = signal<Problem | null>(null);

  protected readonly demos = computed(() => {
    const exercise = this.exercise();
    return exercise ? clipDemos(exercise) : [];
  });
  protected readonly demoIds = computed(() => this.demos().map((demo) => demo.id));
  protected readonly facts = computed(() => {
    const exercise = this.exercise();
    return exercise ? poolExerciseFacts(exercise) : [];
  });
  protected readonly instructions = computed(() => this.exercise()?.instructions?.trim() || null);
  protected readonly closedWords = computed(() => ownTrainingClosedWords(this.closedReason()));
  /** What the page offers: a new workout, the unfinished one, or nothing to a coach's client. */
  protected readonly offer = computed<'start' | 'add' | null>(() => {
    const unfinished = this.unfinished();
    if (this.state() !== 'ready' || this.selfDirected() !== true || unfinished === undefined) {
      return null;
    }
    return unfinished ? 'add' : 'start';
  });

  constructor() {
    // Another workspace starts from nothing: who reads, and what they have running, are asked again.
    this.scope.onReset(() => {
      this.state.set('loading');
      this.exercise.set(null);
      this.closedReason.set('');
      this.selfDirected.set(null);
      this.unfinished.set(undefined);
      this.working.set(false);
      this.problem.set(null);
    });
    effect(() => {
      this.scope.epoch();
      this.exerciseId();
      if (this.tenants.selectedTenantId()) untracked(() => void this.load());
    });
  }

  /**
   * The exercise, with who reads and Today's unfinished workout asked beside it. The page is drawn
   * once they have answered, or could not, so the action is drawn with the page rather than after it
   * (it would push the facts and instructions down); reading them together costs no extra time.
   */
  protected async load(): Promise<void> {
    const id = this.exerciseId();
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      this.exercise.set(null);
      this.problem.set(null);
      if (id === null) {
        this.state.set('gone');
        return;
      }
      const known = this.selfDirected();
      const profile = known === null ? this.readSelfDirected() : Promise.resolve(known);
      const today = known === false ? Promise.resolve(null) : this.readUnfinished();
      let exercise: PoolExerciseView;
      try {
        const result = await owner.wait(firstValueFrom(this.pool.get(id)));
        if (!result.isAllowed) {
          this.closedReason.set(result.accessReason);
          this.state.set('closed');
          return;
        }
        if (!result.exercise) {
          this.state.set('gone');
          return;
        }
        exercise = result.exercise;
      } catch (error) {
        if (!owner.current) return;
        // A 404 is no failure: the exercise left the pool, or this is not TB Gym's own space.
        this.state.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'error',
        );
        return;
      }
      // A profile that cannot be read offers nothing, as Training then offers nothing, and is asked
      // again on the next read. Either way the page is drawn.
      const self = await owner.wait(profile);
      if (self !== null) this.selfDirected.set(self);
      // Today unread holds nothing back: a start the server refuses says so, and Today is read then.
      if (self) this.unfinished.set((await owner.wait(today)) ?? null);
      this.exercise.set(exercise);
      this.state.set('ready');
    });
  }

  /**
   * Starts a workout with this exercise, or adds it to the unfinished one: one antiforgery read for the
   * chain, the start when there is none, the exercise with its empty set, then the player on the
   * workout.
   */
  protected async startWithIt(): Promise<void> {
    const exercise = this.exercise();
    // Asked before the lane is taken: a second run in the lane would cancel the first (notes plan N9b3).
    if (!exercise || this.working() || this.offer() === null) return;
    const unfinished = this.unfinished() ?? null;
    return this.scope.run('start', async (owner) => {
      this.working.set(true);
      this.problem.set(null);
      let started: OwnWorkoutView | null = null;
      try {
        let workout: OwnWorkoutView;
        try {
          await owner.wait(this.csrf.refresh());
          if (!unfinished) started = await owner.wait(firstValueFrom(this.ownApi.start()));
          workout = await this.addWithSet(owner, (unfinished ?? started)!, exercise);
        } catch (error) {
          if (owner.current) await this.refused(owner, error, exercise, unfinished, started);
          return;
        }
        // A player that could not be opened is said by the app's own toast (D5), with Try again.
        const opened = await this.router
          .navigate(['/training/today'], { queryParams: { sessionId: workout.workoutExecutionId } })
          .catch(() => false);
        // Still here: a next press adds to the workout that now runs.
        if (!opened && owner.current) this.unfinished.set(workout);
      } finally {
        if (owner.current) this.working.set(false);
      }
    });
  }

  /** The exercise into the workout, with one empty set when the server added none (TRN-033). */
  private async addWithSet(
    owner: TenantOperation,
    workout: OwnWorkoutView,
    exercise: PoolExerciseView,
  ): Promise<OwnWorkoutView> {
    const before = new Set(workout.exercises.map((item) => item.performanceId));
    const added = await owner.wait(
      firstValueFrom(
        this.ownApi.addExercise(workout.workoutExecutionId, exercise.id, Number(workout.version)),
      ),
    );
    // This press's own row: the exercise may be in the workout already.
    const row = added.exercises
      .filter((item) => item.exerciseId === exercise.id && !before.has(item.performanceId))
      .at(-1);
    if (!row || row.sets.length > 0) return added;
    try {
      return await owner.wait(
        firstValueFrom(
          this.ownApi.addSet(added.workoutExecutionId, row.performanceId, Number(added.version)),
        ),
      );
    } catch {
      // The exercise is in, and the player offers Add set: it opens all the same.
      owner.check();
      return added;
    }
  }

  /** Says why where the press was, and reads Today again when the workout waiting there may have moved. */
  private async refused(
    owner: TenantOperation,
    error: unknown,
    exercise: PoolExerciseView,
    unfinished: OwnWorkoutView | null,
    started: OwnWorkoutView | null,
  ): Promise<void> {
    if (started) {
      // The workout runs, empty: the player is where to add the exercise now.
      this.unfinished.set(started);
      this.problem.set({
        text: $localize`Your workout started, but ${exercise.name}:exercise: couldn’t be added. Carry on to add it there.`,
        carryOn: { sessionId: started.workoutExecutionId },
      });
      await this.readToday(owner);
      return;
    }
    if (!unfinished) {
      const text = startRefusalWords(error);
      if (ownRefusal(error) !== 'in-progress') {
        this.problem.set({ text, carryOn: null });
        return;
      }
      // One is running after all: Carry on goes to it, and the button turns into Add to your workout.
      this.problem.set({ text, carryOn: { sessionId: null } });
      const own = await this.readToday(owner);
      if (own) this.problem.set({ text, carryOn: { sessionId: own.workoutExecutionId } });
      return;
    }
    this.problem.set({
      text: changeRefusalWords(
        error,
        $localize`${exercise.name}:exercise: couldn’t be added. Try again.`,
      ),
      carryOn: null,
    });
    // Its version, or whether it still runs, may have moved on elsewhere.
    await this.readToday(owner);
  }

  /** Reads Today's unfinished workout again; kept as it was when Today cannot be read. */
  private async readToday(owner: TenantOperation): Promise<OwnWorkoutView | null> {
    const own = await owner.wait(this.readUnfinished());
    if (own !== undefined) this.unfinished.set(own);
    return own ?? null;
  }

  /** Whether the reader trains on their own in TB Gym's space (CLI-026); null when it cannot be read. */
  private async readSelfDirected(): Promise<boolean | null> {
    try {
      return (await firstValueFrom(this.api.getSelfProfile())).selfDirected === true;
    } catch {
      return null;
    }
  }

  /** Today's unfinished workout of one's own: null when there is none, undefined when Today is unread. */
  private async readUnfinished(): Promise<OwnWorkoutView | null | undefined> {
    try {
      const own = (await firstValueFrom(this.api.getMyTrainingToday())).ownWorkout;
      return own && own.status !== 'Completed' ? own : null;
    } catch {
      return undefined;
    }
  }
}
