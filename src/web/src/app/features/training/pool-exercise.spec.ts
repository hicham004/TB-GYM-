import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientTrainingDayResult,
  ExercisePoolExerciseResult,
  OwnWorkoutView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, press, query, settle } from '../../../testing/dom';
import { access } from '../../../testing/exercise-fixtures';
import { finishedProfile } from '../../../testing/intake-fixtures';
import { dayWithOwn, ownWorkout } from '../../../testing/own-workout-day-fixtures';
import {
  ownExerciseView,
  ownSetView,
  ownWorkoutView,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  POOL_WALKING_LUNGE,
  poolExercise,
  poolResult,
} from '../../../testing/own-workout-fixtures';
import { ExercisePoolApi } from './exercise-pool-api';
import { OwnWorkoutApi } from './own-workout-api';
import { PoolExercise } from './pool-exercise';

/** The list, and the player a workout opens in, in place of theirs. */
@Component({ template: '<p>The pool</p>' })
class PoolStub {}
@Component({ template: '<p>The player</p>' })
class PlayerStub {}

const POOL = [POOL_GOBLET_SQUAT, POOL_PLANK, POOL_WALKING_LUNGE];

type Get = (id: string) => Observable<ExercisePoolExerciseResult>;

interface Options {
  readonly url?: string;
  readonly get?: Get;
  /** Overrides any `ApiClient` method: who reads, and Today's read. */
  readonly api?: Record<string, unknown>;
  /** Overrides any `OwnWorkoutApi` method. */
  readonly own?: Record<string, unknown>;
}

/** The workout the server answers once the exercise is in it: a row of its own with no set (TRN-033). */
function withExercise(workoutId: string, exerciseId: string, version: number): OwnWorkoutView {
  return ownWorkoutView({
    workoutExecutionId: workoutId,
    version: version + 1,
    exercises: [
      ownExerciseView({
        performanceId: 'own-exercise-new',
        exerciseId,
        exerciseName: 'Walking lunge',
        sets: [],
      }),
    ],
  });
}

async function render(options: Options = {}) {
  const pool = {
    search: vi.fn(),
    get: vi.fn<Get>(
      options.get ?? ((id) => of(poolResult(POOL.find((exercise) => exercise.id === id) ?? null))),
    ),
  };
  const api = {
    // A trainee of TB Gym's own space unless a test says otherwise (CLI-026).
    getSelfProfile: vi.fn(() => of(finishedProfile({ selfDirected: true }))),
    // Nothing unfinished today.
    getMyTrainingToday: vi.fn<() => Observable<ClientTrainingDayResult>>(() =>
      of(dayWithOwn(null)),
    ),
    createMediaAccess: vi.fn((assetId: string) =>
      of(access({ assetId, kind: 'Video', url: `/api/media/${assetId}/content` })),
    ),
    createMediaAccessBatch: vi.fn(() => of({ items: [] })),
    ...options.api,
  };
  const ownApi = {
    // A new workout of one's own, empty, as the server starts it.
    start: vi.fn(() =>
      of(ownWorkoutView({ workoutExecutionId: 'own-new', version: 1, exercises: [] })),
    ),
    addExercise: vi.fn((workoutId: string, exerciseId: string, version: number) =>
      of(withExercise(workoutId, exerciseId, version)),
    ),
    addSet: vi.fn((workoutId: string, performanceId: string, version: number) =>
      of(
        ownWorkoutView({
          workoutExecutionId: workoutId,
          version: version + 1,
          exercises: [ownExerciseView({ performanceId, sets: [ownSetView()] })],
        }),
      ),
    ),
    ...options.own,
  };
  const refresh = vi.fn(() => Promise.resolve());
  const selectedTenantId = signal<string | null>('tenant-house');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'training/pool', component: PoolStub },
        { path: 'training/pool/:exerciseId', component: PoolExercise },
        { path: 'training/today', component: PlayerStub },
      ]),
      { provide: ExercisePoolApi, useValue: pool },
      { provide: ApiClient, useValue: api },
      { provide: OwnWorkoutApi, useValue: ownApi },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/training/pool/pool-walking-lunge', PoolExercise);
  await settle(harness.fixture);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    pool,
    api,
    ownApi,
    refresh,
    navigate,
    selectedTenantId,
    settle: () => settle(harness.fixture),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const url = () => TestBed.inject(Router).url;

/** The start button, whichever it offers. */
const action = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[data-pool-start]');

/** A refusal as the own-workout routes send it: a 409 with its code and sentence. */
const refusal = (code: string, message: string) =>
  new HttpErrorResponse({ status: 409, error: { code, message } });

/** What the page's empty state says: its heading and its line. */
const emptyState = (host: HTMLElement) => {
  const empty = host.querySelector('app-empty-state');
  return empty ? [textOf(empty.querySelector('h1, h2')), textOf(empty.querySelector('p'))] : null;
};

describe('PoolExercise, one exercise of TB Gym’s pool (notes plan N9b4)', () => {
  afterEach(() => {
    // The page goes first, so its clips let their videos go while jsdom's media stand-ins are still in.
    TestBed.resetTestingModule();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  it('shows the exercise: its name, its demo, what it needs and works, and how it is done', async () => {
    const { host, pool } = await render();

    expect(pool.get).toHaveBeenCalledExactlyOnceWith('pool-walking-lunge');
    const heading = host.querySelector('h1');
    expect(textOf(heading)).toBe('Walking lunge');
    expect(heading?.getAttribute('dir')).toBe('auto');
    // The clip has a button of its own (WCAG 2.2.2): it is no list's thumbnail.
    const clip = host.querySelector('app-demo-clip')!;
    expect(clip).not.toBeNull();
    expect(clip.getAttribute('aria-hidden')).toBeNull();
    expect(clip.classList).not.toContain('decorative');
    expect(
      Array.from(host.querySelectorAll('.facts .fact')).map((fact) => [
        textOf(fact.querySelector('dt')),
        textOf(fact.querySelector('dd')),
      ]),
    ).toEqual([
      ['Equipment', 'No equipment'],
      ['Movement', 'Locomotion'],
      ['Type', 'Rehab'],
      ['Main muscle', 'Quadriceps'],
      ['Also works', 'Glutes, Hamstrings'],
    ]);
    const how = host.querySelector('section.how')!;
    expect(textOf(how.querySelector('h2'))).toBe('How to do it');
    const steps = how.querySelector<HTMLElement>('.instructions')!;
    // The house's words with their line break, kept as typed.
    expect(steps.textContent).toBe(
      'Step forward and lower the back knee.\nPush through the front heel to stand.',
    );
    expect(getComputedStyle(steps).whiteSpace).toBe('pre-line');
    expect(steps.getAttribute('dir')).toBe('auto');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('app-skeleton')).toBeNull();
  });

  it('draws instructions as text, never as markup', async () => {
    const tagged = poolExercise('Tagged', {
      instructions: '<b>Brace</b> <img src=x onerror=alert(1)>',
    });
    const { host } = await render({
      url: '/training/pool/pool-tagged',
      get: () => of(poolResult(tagged)),
    });

    const steps = query<HTMLElement>(host, '.instructions');
    expect(steps.textContent).toBe('<b>Brace</b> <img src=x onerror=alert(1)>');
    expect(steps.querySelector('b, img')).toBeNull();
  });

  it('goes back to the pool with the search and filters it was opened from', async () => {
    const { harness, host } = await render({
      url: '/training/pool/pool-walking-lunge?q=lunge&muscle=Glutes',
    });
    const back = query<HTMLAnchorElement>(host, 'a.back');
    expect(textOf(back)).toBe('Exercises');
    expect(back.getAttribute('href')).toBe('/training/pool?q=lunge&muscle=Glutes');

    back.click();
    await settle(harness.fixture);

    expect(url()).toBe('/training/pool?q=lunge&muscle=Glutes');
  });

  it('offers every demo behind one button only when there is more than one', async () => {
    const several = await render();
    const all = query<HTMLButtonElement>(several.host, 'app-exercise-demo button');
    expect(textOf(all)).toBe('See all 3 demos');

    all.click();
    await several.settle();

    // Each demo in turn, links included, in the sheet the coach's screens open.
    const sheet = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1)!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Walking lunge');
    expect(['Demo 1', 'Demo 2', 'Demo 3'].map((label) => button(sheet, label))).toHaveLength(3);
    expect(several.api.createMediaAccess).toHaveBeenCalledWith('m-lunge-photo');
    TestBed.resetTestingModule();

    const one = await render({ url: '/training/pool/pool-goblet-squat' });
    expect(one.host.querySelector('app-demo-clip')).not.toBeNull();
    expect(one.host.querySelector('app-exercise-demo')).toBeNull();
    TestBed.resetTestingModule();

    // An exercise with no demo shows none, and says nothing it does not have.
    const none = await render({ url: '/training/pool/pool-plank' });
    expect(none.host.querySelector('app-demo-clip')).toBeNull();
    expect(none.host.querySelector('app-exercise-demo')).toBeNull();
    expect(none.host.querySelector('section.how')).toBeNull();
    expect(none.host.querySelector('[data-fact="also"]')).toBeNull();
    expect(textOf(none.host.querySelector('[data-fact="equipment"] dd'))).toBe('No equipment');
  });

  describe('a workout with it, for a trainee of TB Gym’s own space alone', () => {
    it('offers it to a trainee, named for the exercise, and to nobody else', async () => {
      const trainee = await render();
      const start = action(trainee.host)!;
      expect(textOf(start)).toBe('Start a workout with Walking lunge');
      expect(textOf(start.querySelector('.tb-visually-hidden'))).toBe('with Walking lunge');
      expect(start.querySelector('.tb-visually-hidden bdi')?.textContent).toBe('Walking lunge');
      expect(start.classList).toContain('tb-button--filled');
      expect(start.classList).toContain('tb-button--touch');
      expect(start.getAttribute('aria-describedby')).toBeNull();
      expect(trainee.host.querySelector('#pool-add-note')).toBeNull();
      TestBed.resetTestingModule();

      const coached = await render({
        api: { getSelfProfile: vi.fn(() => of(finishedProfile({ selfDirected: false }))) },
      });
      expect(action(coached.host)).toBeNull();
      expect(textOf(coached.host.querySelector('h1'))).toBe('Walking lunge');
      TestBed.resetTestingModule();

      const unknown = await render({
        api: {
          getSelfProfile: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 }))),
        },
      });
      // Who reads couldn't be read: the page all the same, with nothing offered.
      expect(textOf(unknown.host.querySelector('h1'))).toBe('Walking lunge');
      expect(action(unknown.host)).toBeNull();
    });

    it('starts a workout with the token read first, adds the exercise with one empty set, then opens the player on it', async () => {
      const { host, ownApi, refresh, navigate, settle } = await render();
      refresh.mockClear();

      press(host, 'Start a workout with Walking lunge');
      await settle();

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(ownApi.start).toHaveBeenCalledExactlyOnceWith();
      expect(ownApi.addExercise).toHaveBeenCalledExactlyOnceWith(
        'own-new',
        'pool-walking-lunge',
        1,
      );
      expect(ownApi.addSet).toHaveBeenCalledExactlyOnceWith('own-new', 'own-exercise-new', 2);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/training/today'], {
        queryParams: { sessionId: 'own-new' },
      });
      const order = [
        refresh.mock.invocationCallOrder[0],
        ownApi.start.mock.invocationCallOrder[0],
        ownApi.addExercise.mock.invocationCallOrder[0],
        ownApi.addSet.mock.invocationCallOrder[0],
        navigate.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(url()).toBe('/training/today?sessionId=own-new');
    });

    it('adds no second set when the exercise came with one', async () => {
      const { host, ownApi, navigate, settle } = await render({
        own: {
          addExercise: vi.fn((workoutId: string, exerciseId: string) =>
            of(
              ownWorkoutView({
                workoutExecutionId: workoutId,
                version: 2,
                exercises: [ownExerciseView({ performanceId: 'own-exercise-new', exerciseId })],
              }),
            ),
          ),
        },
      });

      press(host, 'Start a workout with Walking lunge');
      await settle();

      expect(ownApi.addSet).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/training/today'], {
        queryParams: { sessionId: 'own-new' },
      });
    });

    it('adds it to the workout not finished yet, saying where it goes, at that workout’s version', async () => {
      const unfinished = ownWorkout({ workoutExecutionId: 'own-1', version: 3 });
      const { host, ownApi, navigate, settle } = await render({
        api: { getMyTrainingToday: vi.fn(() => of(dayWithOwn(unfinished))) },
      });
      const add = action(host)!;
      expect(textOf(add)).toBe('Add to your workout');
      expect(add.getAttribute('aria-describedby')).toBe('pool-add-note');
      expect(textOf(host.querySelector('#pool-add-note'))).toBe(
        'It goes into the workout you haven’t finished.',
      );

      press(host, 'Add to your workout');
      await settle();

      expect(ownApi.start).not.toHaveBeenCalled();
      expect(ownApi.addExercise).toHaveBeenCalledExactlyOnceWith('own-1', 'pool-walking-lunge', 3);
      expect(ownApi.addSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-new', 4);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/training/today'], {
        queryParams: { sessionId: 'own-1' },
      });
    });

    it('starts a new one when Today’s workout of one’s own is finished', async () => {
      const finished = ownWorkout({ status: 'Completed', completedAtUtc: '2026-09-20T07:10:00Z' });
      const { host } = await render({
        api: { getMyTrainingToday: vi.fn(() => of(dayWithOwn(finished))) },
      });

      expect(textOf(action(host))).toBe('Start a workout with Walking lunge');
    });

    it('gives a second of the same exercise its own empty set, found among the rows already there', async () => {
      const unfinished = ownWorkout({
        workoutExecutionId: 'own-1',
        version: 3,
        exercises: [
          ownExerciseView({ performanceId: 'own-lunge-1', exerciseId: 'pool-walking-lunge' }),
        ],
      });
      const { host, ownApi, settle } = await render({
        api: { getMyTrainingToday: vi.fn(() => of(dayWithOwn(unfinished))) },
        own: {
          addExercise: vi.fn(() =>
            of(
              ownWorkoutView({
                workoutExecutionId: 'own-1',
                version: 4,
                exercises: [
                  ownExerciseView({
                    performanceId: 'own-lunge-1',
                    exerciseId: 'pool-walking-lunge',
                  }),
                  ownExerciseView({
                    performanceId: 'own-lunge-2',
                    exerciseId: 'pool-walking-lunge',
                    position: 2,
                    sets: [],
                  }),
                ],
              }),
            ),
          ),
        },
      });

      press(host, 'Add to your workout');
      await settle();

      expect(ownApi.addSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-lunge-2', 4);
    });

    it('starts one workout when pressed twice before the page redraws, busy until it is in', async () => {
      const answer = new Subject<OwnWorkoutView>();
      const { host, ownApi, navigate, settle } = await render({
        own: { start: vi.fn(() => answer) },
      });
      const start = action(host)!;

      start.click();
      start.click();
      await settle();

      expect(ownApi.start).toHaveBeenCalledTimes(1);
      expect(start.getAttribute('aria-disabled')).toBe('true');
      expect(start.classList).toContain('tb-button--loading');

      answer.next(ownWorkoutView({ workoutExecutionId: 'own-new', version: 1, exercises: [] }));
      answer.complete();
      await settle();

      expect(ownApi.addExercise).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('opens the player all the same when the empty set is refused: the player offers Add set', async () => {
      const { host, navigate, settle } = await render({
        own: {
          addSet: vi.fn(() =>
            throwError(() => refusal('own_workout_limit', 'An exercise holds at most 20 sets.')),
          ),
        },
      });

      press(host, 'Start a workout with Walking lunge');
      await settle();

      expect(navigate).toHaveBeenCalledWith(['/training/today'], {
        queryParams: { sessionId: 'own-new' },
      });
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('a press the server refuses, said where it was pressed', () => {
    it('one already running: says so, reads Today again, and the button adds to it, with Carry on', async () => {
      const unfinished = ownWorkout({ workoutExecutionId: 'own-1', version: 3 });
      let running = false;
      const getMyTrainingToday = vi.fn(() => of(dayWithOwn(running ? unfinished : null)));
      const { host, ownApi, navigate, settle } = await render({
        api: { getMyTrainingToday },
        own: {
          start: vi.fn(() =>
            throwError(() =>
              refusal(
                'own_workout_in_progress',
                'You have a workout you have not finished. Carry on with it, or finish it first.',
              ),
            ),
          ),
        },
      });
      const start = action(host)!;
      start.focus();
      running = true;

      start.click();
      await settle();

      expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
        'You have a workout you haven’t finished. Carry on with it, or finish it first.',
      );
      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      // The same button, focus kept on it, now offering the workout that is running.
      expect(action(host)).toBe(start);
      expect(document.activeElement).toBe(start);
      expect(textOf(start)).toBe('Add to your workout');
      const carryOn = query<HTMLAnchorElement>(host, 'a[data-carry-on]');
      expect(textOf(carryOn)).toBe('Carry on');
      expect(carryOn.getAttribute('href')).toBe('/training/today?sessionId=own-1');
      expect(ownApi.addExercise).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    /** Today unread holds nothing back: the server refuses a start while one runs, and says so. */
    it('offers Start when Today can’t be read, and a start refused as one running reads Today again, with Carry on', async () => {
      const unfinished = ownWorkout({ workoutExecutionId: 'own-1', version: 3 });
      let readable = false;
      const getMyTrainingToday = vi.fn(() =>
        readable
          ? of(dayWithOwn(unfinished))
          : throwError(() => new HttpErrorResponse({ status: 503 })),
      );
      const { host, ownApi, navigate, settle } = await render({
        api: { getMyTrainingToday },
        own: {
          start: vi.fn(() =>
            throwError(() =>
              refusal(
                'own_workout_in_progress',
                'You have a workout you have not finished. Carry on with it, or finish it first.',
              ),
            ),
          ),
        },
      });

      expect(getMyTrainingToday).toHaveBeenCalledTimes(1);
      expect(textOf(host.querySelector('h1'))).toBe('Walking lunge');
      const start = action(host)!;
      expect(textOf(start)).toBe('Start a workout with Walking lunge');
      expect(host.querySelector('#pool-add-note')).toBeNull();

      readable = true;
      start.click();
      await settle();

      expect(ownApi.start).toHaveBeenCalledTimes(1);
      expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
        'You have a workout you haven’t finished. Carry on with it, or finish it first.',
      );
      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      expect(textOf(action(host))).toBe('Add to your workout');
      const carryOn = query<HTMLAnchorElement>(host, 'a[data-carry-on]');
      expect(textOf(carryOn)).toBe('Carry on');
      expect(carryOn.getAttribute('href')).toBe('/training/today?sessionId=own-1');
      expect(ownApi.addExercise).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('ten today: says so in the house’s words, with nothing to carry on', async () => {
      const { host, api, settle } = await render({
        own: {
          start: vi.fn(() =>
            throwError(() =>
              refusal(
                'own_workout_daily_limit',
                'You have started 10 workouts today, the most one day holds.',
              ),
            ),
          ),
        },
      });

      press(host, 'Start a workout with Walking lunge');
      await settle();

      expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
        'You’ve started 10 workouts today, the most one day holds. Start the next one tomorrow.',
      );
      expect(host.querySelector('a[data-carry-on]')).toBeNull();
      expect(api.getMyTrainingToday).toHaveBeenCalledTimes(1);
      expect(textOf(action(host))).toBe('Start a workout with Walking lunge');
      expect(textOf(host)).not.toMatch(/coach/i);
    });

    it('Training closed: says so, and a later press clears what was said', async () => {
      let closed = true;
      const { host, ownApi, settle } = await render({
        own: {
          start: vi.fn(() =>
            closed
              ? throwError(() => new HttpErrorResponse({ status: 403 }))
              : of(ownWorkoutView({ workoutExecutionId: 'own-new', version: 1, exercises: [] })),
          ),
          addExercise: vi.fn(() => new Subject<OwnWorkoutView>()),
        },
      });

      press(host, 'Start a workout with Walking lunge');
      await settle();
      expect(textOf(host.querySelector('.problem'))).toBe(
        'Training isn’t open for you right now, so a workout can’t be started.',
      );

      closed = false;
      press(host, 'Start a workout with Walking lunge');
      await settle();
      expect(ownApi.start).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.problem')).toBeNull();
    });

    it('started, then the exercise refused: says so with Carry on to the new workout, and never sends it again', async () => {
      const begun = ownWorkoutView({ workoutExecutionId: 'own-new', version: 1, exercises: [] });
      let started = false;
      const { host, ownApi, navigate, settle } = await render({
        // Today's read knows the new workout once it has started.
        api: { getMyTrainingToday: vi.fn(() => of(dayWithOwn(started ? begun : null))) },
        own: {
          start: vi.fn(() => {
            started = true;
            return of(begun);
          }),
          addExercise: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 0 }))),
        },
      });

      press(host, 'Start a workout with Walking lunge');
      await settle();

      expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
        'Your workout started, but Walking lunge couldn’t be added. Carry on to add it there.',
      );
      const carryOn = query<HTMLAnchorElement>(host, 'a[data-carry-on]');
      expect(carryOn.getAttribute('href')).toBe('/training/today?sessionId=own-new');
      expect(ownApi.addExercise).toHaveBeenCalledTimes(1);
      expect(ownApi.addSet).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      // The workout runs now: the button adds to it rather than starting another.
      expect(textOf(action(host))).toBe('Add to your workout');
    });

    it('the unfinished one changed elsewhere: says so, reads Today again, and the next press sends its new version', async () => {
      let version = 3;
      const getMyTrainingToday = vi.fn(() =>
        of(dayWithOwn(ownWorkout({ workoutExecutionId: 'own-1', version }))),
      );
      let refuse = true;
      const { host, ownApi, settle } = await render({
        api: { getMyTrainingToday },
        own: {
          addExercise: vi.fn((workoutId: string, exerciseId: string, sent: number) =>
            refuse
              ? throwError(() =>
                  refusal('concurrency_conflict', 'The workout changed. Read it again.'),
                )
              : of(withExercise(workoutId, exerciseId, sent)),
          ),
        },
      });
      version = 7;

      press(host, 'Add to your workout');
      await settle();

      expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
        'This workout changed on another phone or tab. It’s up to date now, so try again.',
      );
      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      expect(host.querySelector('a[data-carry-on]')).toBeNull();

      refuse = false;
      press(host, 'Add to your workout');
      await settle();

      expect(ownApi.addExercise.mock.calls.map((call) => call[2])).toEqual([3, 7]);
    });

    it('the unfinished one finished elsewhere: says so, and the button then starts a new one', async () => {
      let running = true;
      const { host, settle } = await render({
        api: {
          getMyTrainingToday: vi.fn(() =>
            of(dayWithOwn(running ? ownWorkout({ workoutExecutionId: 'own-1' }) : null)),
          ),
        },
        own: {
          addExercise: vi.fn(() =>
            throwError(() => refusal('workout_immutable', 'This workout is finished.')),
          ),
        },
      });
      running = false;

      press(host, 'Add to your workout');
      await settle();

      expect(textOf(host.querySelector('.problem'))).toBe(
        'This workout was finished on another phone or tab, so it can’t change now.',
      );
      expect(textOf(action(host))).toBe('Start a workout with Walking lunge');
    });

    it('anything else: the add’s own words, sent once', async () => {
      const { host, ownApi, settle } = await render({
        api: {
          getMyTrainingToday: vi.fn(() =>
            of(dayWithOwn(ownWorkout({ workoutExecutionId: 'own-1' }))),
          ),
        },
        own: { addExercise: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))) },
      });

      press(host, 'Add to your workout');
      await settle();

      expect(textOf(host.querySelector('.problem'))).toBe(
        'Walking lunge couldn’t be added. Try again.',
      );
      expect(ownApi.addExercise).toHaveBeenCalledTimes(1);
    });

    it('says each refused start in words the trainee can act on, with nothing to carry on', async () => {
      const refusals: [HttpErrorResponse, string][] = [
        [
          new HttpErrorResponse({ status: 404 }),
          'Workouts of your own are for people training with TB Gym’s own space.',
        ],
        [
          new HttpErrorResponse({ status: 0 }),
          'The app couldn’t connect. Check your connection and try again.',
        ],
        [new HttpErrorResponse({ status: 500 }), 'The workout couldn’t be started. Try again.'],
      ];
      for (const [error, words] of refusals) {
        const { host, ownApi, navigate, settle } = await render({
          own: { start: vi.fn(() => throwError(() => error)) },
        });

        press(host, 'Start a workout with Walking lunge');
        await settle();

        expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(words);
        expect(host.querySelector('a[data-carry-on]')).toBeNull();
        expect(ownApi.addExercise).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        TestBed.resetTestingModule();
      }
    });

    it('says each refused add to the unfinished one in its own words, sent once', async () => {
      const refusals: [HttpErrorResponse, string][] = [
        [
          new HttpErrorResponse({ status: 404 }),
          'That isn’t in this workout or in the exercise pool anymore.',
        ],
        [
          new HttpErrorResponse({ status: 403 }),
          'Training isn’t open for you right now, so this workout can’t change.',
        ],
        [
          refusal('own_workout_limit', 'A workout holds at most 40 exercises.'),
          'A workout holds at most 40 exercises.',
        ],
      ];
      for (const [error, words] of refusals) {
        const { host, ownApi, navigate, settle } = await render({
          api: {
            getMyTrainingToday: vi.fn(() =>
              of(dayWithOwn(ownWorkout({ workoutExecutionId: 'own-1' }))),
            ),
          },
          own: { addExercise: vi.fn(() => throwError(() => error)) },
        });

        press(host, 'Add to your workout');
        await settle();

        expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(words);
        expect(ownApi.addExercise).toHaveBeenCalledTimes(1);
        expect(ownApi.addSet).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        TestBed.resetTestingModule();
      }
    });

    it('sends nothing when the antiforgery token cannot be read, and says so', async () => {
      const { host, ownApi, refresh, settle } = await render();
      refresh.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

      press(host, 'Start a workout with Walking lunge');
      await settle();

      expect(ownApi.start).not.toHaveBeenCalled();
      expect(textOf(host.querySelector('.problem[role="alert"]'))).toBe(
        'The app couldn’t connect. Check your connection and try again.',
      );
      expect(action(host)?.getAttribute('aria-disabled')).toBeNull();
    });
  });

  describe('its states', () => {
    it('shows the skeleton while the exercise is on its way', async () => {
      const { host } = await render({ get: () => new Subject<ExercisePoolExerciseResult>() });

      expect(textOf(host.querySelector('app-skeleton'))).toBe('Loading the exercise…');
      expect(host.querySelector('h1')).toBeNull();
      expect(action(host)).toBeNull();
      expect(textOf(host.querySelector('a.back'))).toBe('Exercises');
    });

    /** Drawn after them, the action would push the facts and the instructions down as it came in. */
    it('draws the page and its action together, once who reads and Today’s workout have answered', async () => {
      const profile = new Subject<ReturnType<typeof finishedProfile>>();
      const today = new Subject<ClientTrainingDayResult>();
      const { host, settle } = await render({
        api: { getSelfProfile: vi.fn(() => profile), getMyTrainingToday: vi.fn(() => today) },
      });

      // The exercise is in; who reads is not yet.
      expect(textOf(host.querySelector('app-skeleton'))).toBe('Loading the exercise…');
      expect(host.querySelector('h1, app-demo-clip, .facts')).toBeNull();
      expect(action(host)).toBeNull();

      profile.next(finishedProfile({ selfDirected: true }));
      profile.complete();
      await settle();
      // A trainee: what they have running decides the action, so the page waits for Today too.
      expect(host.querySelector('app-skeleton')).not.toBeNull();
      expect(host.querySelector('h1, app-demo-clip, .facts')).toBeNull();

      today.next(dayWithOwn(ownWorkout({ workoutExecutionId: 'own-1' })));
      today.complete();
      await settle();

      expect(host.querySelector('app-skeleton')).toBeNull();
      expect(textOf(host.querySelector('h1'))).toBe('Walking lunge');
      expect(host.querySelector('.facts')).not.toBeNull();
      expect(textOf(action(host))).toBe('Add to your workout');
      expect(textOf(host.querySelector('#pool-add-note'))).toBe(
        'It goes into the workout you haven’t finished.',
      );
    });

    it('draws the page once Today can’t be read, Start with it, and a coach’s client’s without Today', async () => {
      const today = new Subject<ClientTrainingDayResult>();
      const trainee = await render({ api: { getMyTrainingToday: vi.fn(() => today) } });
      expect(trainee.host.querySelector('h1')).toBeNull();

      today.error(new HttpErrorResponse({ status: 0 }));
      await trainee.settle();

      expect(textOf(trainee.host.querySelector('h1'))).toBe('Walking lunge');
      expect(textOf(action(trainee.host))).toBe('Start a workout with Walking lunge');
      TestBed.resetTestingModule();

      // No workout of one's own to offer: the page does not wait for Today, which here never answers.
      const coached = await render({
        api: {
          getSelfProfile: vi.fn(() => of(finishedProfile({ selfDirected: false }))),
          getMyTrainingToday: vi.fn(() => new Subject<ClientTrainingDayResult>()),
        },
      });
      expect(textOf(coached.host.querySelector('h1'))).toBe('Walking lunge');
      expect(coached.host.querySelector('app-skeleton')).toBeNull();
      expect(action(coached.host)).toBeNull();
    });

    it('says the exercise couldn’t be loaded, and Try again reads it', async () => {
      let fail = true;
      const { host, pool, settle } = await render({
        get: () =>
          fail
            ? throwError(() => new HttpErrorResponse({ status: 503 }))
            : of(poolResult(POOL_WALKING_LUNGE)),
      });

      expect(textOf(host.querySelector('.load-failed [role="alert"]'))).toBe(
        'The exercise couldn’t be loaded.',
      );
      expect(action(host)).toBeNull();

      fail = false;
      press(host, 'Try again');
      await settle();

      expect(pool.get).toHaveBeenCalledTimes(2);
      expect(textOf(host.querySelector('h1'))).toBe('Walking lunge');
      expect(action(host)).not.toBeNull();
    });

    it('says an exercise is not in the pool in the house’s words, for a 404 and for none', async () => {
      const missing = await render({
        get: () => throwError(() => new HttpErrorResponse({ status: 404 })),
      });
      expect(emptyState(missing.host)).toEqual([
        'This exercise isn’t in the pool',
        'It may have been taken out of TB Gym’s pool, or the pool isn’t open to you.',
      ]);
      expect(missing.host.querySelector('app-empty-state h1')).not.toBeNull();
      const all = query<HTMLAnchorElement>(missing.host, 'app-empty-state a');
      expect(textOf(all)).toBe('All exercises');
      expect(all.getAttribute('href')).toBe('/training/pool');
      expect(textOf(missing.host)).not.toContain('Try again');
      expect(action(missing.host)).toBeNull();
      TestBed.resetTestingModule();

      const none = await render({ get: () => of(poolResult(null)) });
      expect(emptyState(none.host)?.[0]).toBe('This exercise isn’t in the pool');
    });

    it('asks nothing for an address that cannot name an exercise', async () => {
      const { host, pool } = await render({ url: '/training/pool/a.b' });

      expect(pool.get).not.toHaveBeenCalled();
      expect(emptyState(host)?.[0]).toBe('This exercise isn’t in the pool');
    });

    it('says why Training is closed in the house’s words, with nothing to start', async () => {
      const { host } = await render({
        get: () => of(poolResult(null, { isAllowed: false, accessReason: 'RelationshipBlocked' })),
      });

      expect(emptyState(host)).toEqual([
        'The pool is closed for now',
        'TB Gym has paused your access.',
      ]);
      expect(action(host)).toBeNull();
      expect(textOf(host)).not.toMatch(/coach/i);
    });

    it('reads the exercise and who reads again in another workspace', async () => {
      const { host, pool, api, selectedTenantId, settle } = await render();
      expect(action(host)).not.toBeNull();

      vi.mocked(api.getSelfProfile).mockReturnValue(of(finishedProfile({ selfDirected: false })));
      selectedTenantId.set('tenant-coach');
      await settle();

      expect(pool.get).toHaveBeenCalledTimes(2);
      expect(api.getSelfProfile).toHaveBeenCalledTimes(2);
      expect(action(host)).toBeNull();
    });
  });
});
