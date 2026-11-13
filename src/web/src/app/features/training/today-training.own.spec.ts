import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientTrainingDayResult,
  ClientTrainingUpcomingView,
  ClientWorkoutView,
  OwnWorkoutSetView,
  OwnWorkoutView,
  PreviousExercisePerformanceView,
  WorkoutExecutionView,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { LIBRARY_SEARCH_PAUSE } from '../../ui/paged-search';
import {
  button,
  field,
  fill,
  fold,
  menuChoices,
  press,
  query,
  settle,
  toggleFold,
} from '../../../testing/dom';
import { finishedProfile } from '../../../testing/intake-fixtures';
import {
  loggedOwnSetView,
  ownExerciseView,
  ownSetView,
  ownWorkoutNote,
  ownWorkoutView,
  POOL_BENCH_PRESS,
  POOL_GOBLET_SQUAT,
  POOL_PLANK,
  poolPage,
} from '../../../testing/own-workout-fixtures';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import { ShareCardMaker } from '../share-cards/share-card-maker';
import { ExercisePoolApi } from './exercise-pool-api';
import { OwnWorkoutApi } from './own-workout-api';
import { TodayTraining } from './today-training';

/** Goblet squat last time, on Tue 10 Nov: 24 kg × 10, then 24 kg × 8. */
const LAST_TIME: PreviousExercisePerformanceView = {
  date: '2026-11-10',
  bestLoad: 24,
  unit: 'Kilogram',
  repetitions: 10,
  rpe: null,
  sets: [
    { position: 1, repetitions: 10, load: 24, loadUnit: 'Kilogram', rpe: null },
    { position: 2, repetitions: 8, load: 24, loadUnit: 'Kilogram', rpe: null },
  ],
};

/** Goblet squat, done before, with the sets given: one empty set unless told. */
function goblet(sets: OwnWorkoutSetView[] = [ownSetView()]) {
  return ownExerciseView({ previousPerformance: LAST_TIME, sets });
}

/** Goblet squat's second set, empty or logged. */
function secondSet(logged = false): OwnWorkoutSetView {
  return logged
    ? loggedOwnSetView({ performanceId: 'own-set-2', position: 2, actualRepetitions: 8 })
    : ownSetView({ performanceId: 'own-set-2', position: 2 });
}

/** Romanian deadlift, second in the workout, with the sets given. */
function deadlift(sets: OwnWorkoutSetView[]) {
  return ownExerciseView({
    performanceId: 'own-exercise-2',
    exerciseId: 'pool-romanian-deadlift',
    exerciseName: 'Romanian deadlift',
    position: 2,
    sets,
  });
}

/** The trainee's workout in progress: Goblet squat with one empty set, at version 5. */
function gobletWorkout(overrides: Partial<OwnWorkoutView> = {}): OwnWorkoutView {
  return ownWorkoutView({ exercises: [goblet()], ...overrides });
}

/** `GET /api/training/me/today` with a workout of one's own beside the program's workouts. */
function ownDay(
  own: OwnWorkoutView | null = gobletWorkout(),
  workouts: ClientWorkoutView[] = [],
): ClientTrainingDayResult {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: '2026-11-13',
    workouts,
    ownWorkout: own,
  };
}

/** A trainee's upcoming read: open, and no program assigned. */
function upcoming(overrides: Partial<ClientTrainingUpcomingView> = {}): ClientTrainingUpcomingView {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: '2026-11-13',
    timeZoneId: 'Asia/Beirut',
    hasAssignedProgram: false,
    hasVisibleSessions: false,
    searchThrough: '2026-12-11',
    nextSession: null,
    unfinishedWorkouts: [],
    nextSkip: null,
    todayCoverage: null,
    ...overrides,
  };
}

function saved(overrides: Partial<WorkoutSetSaveView> = {}): WorkoutSetSaveView {
  return {
    workoutExecutionId: 'own-1',
    executionVersion: 7,
    setPerformanceId: 'own-set-1',
    actualRepetitions: 10,
    actualLoad: 24,
    actualLoadUnit: 'Kilogram',
    actualRpe: null,
    actualRir: null,
    isCompleted: true,
    clientNote: null,
    ...overrides,
  };
}

function finished(): WorkoutExecutionView {
  return {
    id: 'own-1',
    status: 'Completed',
    version: 6,
    startedAtUtc: '2026-11-13T07:00:00Z',
    completedAtUtc: '2026-11-13T07:15:00Z',
    finishSummary: {
      durationSeconds: 900,
      completedSetCount: 0,
      totalSetCount: 1,
      volume: [],
      personalRecords: [],
    },
  };
}

/** A refusal of N9b2's routes: a 409 with its code and the server's English. */
function refused(code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, error: { code, message } });
}

interface Options {
  readonly today?: ClientTrainingDayResult;
  readonly upcoming?: Partial<ClientTrainingUpcomingView>;
  readonly api?: Partial<ApiClient>;
  readonly own?: Partial<OwnWorkoutApi>;
  readonly pool?: Partial<ExercisePoolApi>;
}

async function render(options: Options = {}) {
  const today = options.today ?? ownDay();
  const refresh = vi.fn(() => Promise.resolve());
  const tenant = signal<string | null>('house');
  const api = {
    getMyTrainingToday: vi.fn(() => of(today)),
    getMyUpcomingTraining: vi.fn(() => of(upcoming(options.upcoming))),
    // A trainee of TB Gym's own space (CLI-026), read only when there is nothing to train.
    getSelfProfile: vi.fn(() => of(finishedProfile({ selfDirected: true }))),
    recordMyTrainingSet: vi.fn(() => of(saved())),
    startMyWorkout: vi.fn(() => of(undefined)),
    completeMyWorkout: vi.fn(() => of(finished())),
    addWorkoutNote: vi.fn(() => of(undefined)),
    ...options.api,
  };
  const own = {
    start: vi.fn<OwnWorkoutApi['start']>(() =>
      of(ownWorkoutView({ workoutExecutionId: 'own-2', version: 1, exercises: [] })),
    ),
    addExercise: vi.fn<OwnWorkoutApi['addExercise']>(() => of(gobletWorkout())),
    removeExercise: vi.fn<OwnWorkoutApi['removeExercise']>(() => of(gobletWorkout())),
    addSet: vi.fn<OwnWorkoutApi['addSet']>(() => of(gobletWorkout())),
    removeSet: vi.fn<OwnWorkoutApi['removeSet']>(() => of(gobletWorkout())),
    ...options.own,
  };
  const pool = {
    search: vi.fn<ExercisePoolApi['search']>(() =>
      of(poolPage([POOL_BENCH_PRESS, POOL_GOBLET_SQUAT, POOL_PLANK])),
    ),
    ...options.pool,
  };
  await TestBed.configureTestingModule({
    imports: [TodayTraining],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: OwnWorkoutApi, useValue: own },
      { provide: ExercisePoolApi, useValue: pool },
      { provide: LIBRARY_SEARCH_PAUSE, useValue: 0 },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
      { provide: ShareCardMaker, useValue: fakeShareCardMaker() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TodayTraining);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, own, pool, refresh, tenant };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The last dialog open, which the kit draws at the end of the body, outside the player. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

/** The picker's sheet over the player, also drawn at the end of the body. */
const sheet = () => query<HTMLElement>(document, '.tb-modal-pane--sheet [role="dialog"]');

/** A row of the picker, found by the name a screen reader hears ("Add Plank"). */
const pick = (label: string) =>
  query<HTMLButtonElement>(sheet(), `button.pick[aria-label="${label}"]`);

/** What the picker said last, for a screen reader, in its own live region over the page's. */
const pickerSaid = () => textOf(query(sheet(), 'p.tb-visually-hidden[role="status"]'));

const setCards = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.set-card'));

/** The exercise on show: "EXERCISE n OF m" and its name. */
const shown = (host: HTMLElement) => [
  textOf(query(host, '.workout-exercise .eyebrow')),
  textOf(query(host, '.workout-exercise h2')),
];

const errorLine = (host: HTMLElement) => textOf(query(host, '#training-error-summary'));
const saidLine = (host: HTMLElement) => textOf(query(host, '.save-status'));
const eyebrow = (host: HTMLElement) => textOf(query(host, '.player-top .eyebrow'));

describe('TodayTraining, a workout of one’s own (notes plan N9b3, TRN-033)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  it('shows the workout Today reads, with nothing prescribed and last time beside each set', async () => {
    const { fixture, host, api } = await render();

    expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
    expect(textOf(query(host, '.player-top h1'))).toBe('Workout');
    expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Goblet squat']);
    expect(textOf(query(host, '.previous-performance span'))).toBe('Last time · 10 Nov');
    expect(textOf(query(host, '.previous-performance strong'))).toBe('24 kg × 10');
    const [card] = setCards(host);
    expect(textOf(query(card, '.set-previous'))).toBe('Last time 24 kg × 10');
    // Nothing is prescribed: no target line, and the set starts at last time's numbers (TRN-029).
    expect(host.querySelector('.prescription')).toBeNull();
    expect(host.textContent).not.toContain('Target:');
    expect(field(card, 'Actual load').value).toBe('24');
    expect(field(card, 'Actual repetitions').value).toBe('10');
    expect(field(host, 'kg').checked).toBe(true);

    // No coach reads it: the notes are the trainee's own.
    await toggleFold(fixture, card, 'More options');
    expect(field(card, 'Note (optional)').value).toBe('');
    expect(fold(host, 'Workout note')).toBeTruthy();
    expect(host.textContent).not.toContain('Note for your coach');
    // Someone with a workout in progress is never asked who they are.
    expect(api.getSelfProfile).not.toHaveBeenCalled();
  });

  it('puts it first, ahead of the program’s workout, chosen by its own id', async () => {
    const program: ClientWorkoutView = {
      sessionId: 'session-1',
      mesocycleId: 'mesocycle-1',
      workoutExecutionId: 'execution-1',
      name: 'Lower A',
      coachNotes: null,
      status: 'InProgress',
      exercises: [],
      notes: [],
      executionVersion: 3,
    };
    const { fixture, host } = await render({
      today: ownDay(gobletWorkout(), [program]),
      upcoming: { hasAssignedProgram: true, hasVisibleSessions: true },
    });
    expect(textOf(query(host, '.player-top h1'))).toBe('Workout');

    const chooser = button(host, 'Choose workout');
    chooser.click();
    await settle(fixture);
    expect(
      menuChoices(chooser).map((item) => [
        textOf(item.querySelector('.item-title')),
        textOf(item.querySelector('.item-hint')),
      ]),
    ).toEqual([
      ['Workout', 'Your own · in progress'],
      ['Lower A', 'Today · in progress'],
    ]);
    expect(menuChoices(chooser)[0].getAttribute('aria-current')).toBe('true');

    menuChoices(chooser)[1].click();
    await settle(fixture);
    expect(eyebrow(host)).toBe('YOUR WORKOUT');
    expect(textOf(query(host, '.player-top h1'))).toBe('Lower A');

    button(host, 'Choose workout').click();
    await settle(fixture);
    menuChoices(button(host, 'Choose workout'))[0].click();
    await settle(fixture);
    expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
    expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Goblet squat']);
  });

  describe('its exercises', () => {
    const bench = (sets: OwnWorkoutSetView[]) =>
      ownExerciseView({
        performanceId: 'own-exercise-2',
        exerciseId: POOL_BENCH_PRESS.id,
        exerciseName: 'Bench press',
        position: 2,
        sets,
      });
    /** Bench press a second time in the same workout: a row of its own. */
    const benchAgain = (sets: OwnWorkoutSetView[]) =>
      ownExerciseView({
        performanceId: 'own-exercise-3',
        exerciseId: POOL_BENCH_PRESS.id,
        exerciseName: 'Bench press',
        position: 3,
        sets,
      });
    const plank = (sets: OwnWorkoutSetView[]) =>
      ownExerciseView({
        performanceId: 'own-exercise-3',
        exerciseId: POOL_PLANK.id,
        exerciseName: 'Plank',
        position: 3,
        sets,
      });

    it('adds one from the pool with one empty set, each change on the version the last answer carried', async () => {
      const addExercise = vi.fn(() =>
        of(gobletWorkout({ version: 6, exercises: [goblet(), bench([])] })),
      );
      const addSet = vi.fn(() =>
        of(
          gobletWorkout({
            version: 7,
            exercises: [goblet(), bench([ownSetView({ performanceId: 'own-set-9' })])],
          }),
        ),
      );
      const { fixture, host, pool } = await render({ own: { addExercise, addSet } });

      press(host, 'Add an exercise');
      await settle(fixture);
      expect(textOf(query(sheet(), 'h2'))).toBe('Add an exercise');
      // Dark over the player, as the player is (R6.1a).
      expect(sheet().closest<HTMLElement>('.tb-modal-pane')?.dataset['mode']).toBe('dark');
      expect(pool.search).toHaveBeenCalledExactlyOnceWith({ query: '', skip: 0, take: 50 });
      // Goblet squat is in the workout already: offered again, and said to be.
      expect(textOf(pick('Add Goblet squat again').querySelector('.mark'))).toBe('In this workout');

      pick('Add Bench press').click();
      await settle(fixture);

      expect(addExercise).toHaveBeenCalledExactlyOnceWith('own-1', POOL_BENCH_PRESS.id, 5);
      // The server adds no set: the player adds the one to type into, on the version just answered.
      expect(addSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-2', 6);
      expect(textOf(pick('Add Bench press again').querySelector('.mark.added'))).toBe('Added');
      expect(textOf(query(sheet(), 'p.tb-visually-hidden[role="status"]'))).toBe(
        'Bench press added.',
      );

      // The picker stays open for the next one, until Done.
      press(sheet(), 'Done');
      await settle(fixture);
      expect(document.querySelector('.tb-modal-pane--sheet')).toBeNull();
      expect(shown(host)).toEqual(['EXERCISE 2 OF 2', 'Bench press']);
      expect(setCards(host)).toHaveLength(1);
      // Never done before: nothing to start from.
      expect(textOf(query(host, '.set-previous'))).toBe('Last time —');
    });

    it('adds nothing more when a row is pressed again while the first press is on its way', async () => {
      const answer = new Subject<OwnWorkoutView>();
      // A second press that got through would be sent once the first is answered, and answered too.
      const addExercise = vi
        .fn<OwnWorkoutApi['addExercise']>()
        .mockReturnValueOnce(answer)
        .mockReturnValue(
          of(
            gobletWorkout({
              version: 8,
              exercises: [
                goblet(),
                bench([ownSetView({ performanceId: 'own-set-9' })]),
                benchAgain([]),
              ],
            }),
          ),
        );
      const addSet = vi.fn<OwnWorkoutApi['addSet']>(() =>
        of(
          gobletWorkout({
            version: 7,
            exercises: [goblet(), bench([ownSetView({ performanceId: 'own-set-9' })])],
          }),
        ),
      );
      const { fixture, host } = await render({ own: { addExercise, addSet } });
      press(host, 'Add an exercise');
      await settle(fixture);

      pick('Add Bench press').click();
      await settle(fixture);
      // Sent, and not answered yet.
      expect(addExercise).toHaveBeenCalledExactlyOnceWith('own-1', POOL_BENCH_PRESS.id, 5);
      pick('Add Bench press').click();
      await settle(fixture);
      expect(addExercise).toHaveBeenCalledTimes(1);

      answer.next(gobletWorkout({ version: 6, exercises: [goblet(), bench([])] }));
      answer.complete();
      await settle(fixture);

      expect(addExercise).toHaveBeenCalledTimes(1);
      expect(addSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-2', 6);
      expect(sheet().querySelector('.problem')).toBeNull();
      expect(textOf(pick('Add Bench press again').querySelector('.mark.added'))).toBe('Added');
      expect(pickerSaid()).toBe('Bench press added.');
      expect(errorLine(host)).toBe('');
    });

    it('gives each of two exercises picked before the first is answered its own empty set, and shows the last', async () => {
      const answer = new Subject<OwnWorkoutView>();
      const addExercise = vi
        .fn<OwnWorkoutApi['addExercise']>()
        .mockReturnValueOnce(answer)
        .mockReturnValueOnce(
          of(gobletWorkout({ version: 7, exercises: [goblet(), bench([]), plank([])] })),
        );
      const addSet = vi
        .fn<OwnWorkoutApi['addSet']>()
        .mockReturnValueOnce(
          of(
            gobletWorkout({
              version: 8,
              exercises: [goblet(), bench([ownSetView({ performanceId: 'own-set-9' })]), plank([])],
            }),
          ),
        )
        .mockReturnValueOnce(
          of(
            gobletWorkout({
              version: 9,
              exercises: [
                goblet(),
                bench([ownSetView({ performanceId: 'own-set-9' })]),
                plank([ownSetView({ performanceId: 'own-set-10' })]),
              ],
            }),
          ),
        );
      const { fixture, host } = await render({ own: { addExercise, addSet } });
      press(host, 'Add an exercise');
      await settle(fixture);

      pick('Add Bench press').click();
      await settle(fixture);
      pick('Add Plank').click();
      await settle(fixture);
      // One change at a time: the second waits for the first's answer and the version it brings.
      expect(addExercise).toHaveBeenCalledTimes(1);

      answer.next(gobletWorkout({ version: 6, exercises: [goblet(), bench([])] }));
      answer.complete();
      await settle(fixture);

      expect(addExercise.mock.calls).toEqual([
        ['own-1', POOL_BENCH_PRESS.id, 5],
        ['own-1', POOL_PLANK.id, 6],
      ]);
      // Each pick's own row gets its one set: never the first new row twice and the second none.
      expect(addSet.mock.calls).toEqual([
        ['own-1', 'own-exercise-2', 7],
        ['own-1', 'own-exercise-3', 8],
      ]);
      expect(textOf(pick('Add Bench press again').querySelector('.mark.added'))).toBe('Added');
      expect(textOf(pick('Add Plank again').querySelector('.mark.added'))).toBe('Added');
      expect(pickerSaid()).toBe('Plank added.');
      expect(sheet().querySelector('.problem')).toBeNull();

      press(sheet(), 'Done');
      await settle(fixture);
      // The player shows the last one added, with its set to type into.
      expect(shown(host)).toEqual(['EXERCISE 3 OF 3', 'Plank']);
      expect(setCards(host)).toHaveLength(1);
      press(host, 'Previous exercise');
      await settle(fixture);
      expect(shown(host)).toEqual(['EXERCISE 2 OF 3', 'Bench press']);
      expect(setCards(host)).toHaveLength(1);
      expect(errorLine(host)).toBe('');
    });

    it('adds the same exercise again as a row of its own, seen and heard as a second', async () => {
      const set9 = [ownSetView({ performanceId: 'own-set-9' })];
      const addExercise = vi
        .fn<OwnWorkoutApi['addExercise']>()
        .mockReturnValueOnce(of(gobletWorkout({ version: 6, exercises: [goblet(), bench([])] })))
        .mockReturnValueOnce(
          of(gobletWorkout({ version: 8, exercises: [goblet(), bench(set9), benchAgain([])] })),
        );
      const addSet = vi
        .fn<OwnWorkoutApi['addSet']>()
        .mockReturnValueOnce(of(gobletWorkout({ version: 7, exercises: [goblet(), bench(set9)] })))
        .mockReturnValueOnce(
          of(
            gobletWorkout({
              version: 9,
              exercises: [
                goblet(),
                bench(set9),
                benchAgain([ownSetView({ performanceId: 'own-set-10' })]),
              ],
            }),
          ),
        );
      const { fixture, host } = await render({ own: { addExercise, addSet } });
      press(host, 'Add an exercise');
      await settle(fixture);

      pick('Add Bench press').click();
      await settle(fixture);
      expect(pickerSaid()).toBe('Bench press added.');
      expect(textOf(pick('Add Bench press again').querySelector('.mark.added'))).toBe('Added');

      pick('Add Bench press again').click();
      await settle(fixture);

      expect(addExercise).toHaveBeenLastCalledWith('own-1', POOL_BENCH_PRESS.id, 7);
      // The new row gets its set, not the Bench press added first.
      expect(addSet.mock.calls).toEqual([
        ['own-1', 'own-exercise-2', 6],
        ['own-1', 'own-exercise-3', 8],
      ]);
      expect(textOf(pick('Add Bench press again').querySelector('.mark.added'))).toBe('Added ×2');
      expect(pickerSaid()).toBe('Bench press added again.');

      press(sheet(), 'Done');
      await settle(fixture);
      expect(shown(host)).toEqual(['EXERCISE 3 OF 3', 'Bench press']);
      expect(setCards(host)).toHaveLength(1);

      // Opened again, the picker counts from nothing: the workout's own mark is back.
      press(host, 'Add an exercise');
      await settle(fixture);
      expect(textOf(pick('Add Bench press again').querySelector('.mark'))).toBe('In this workout');
      expect(pickerSaid()).toBe('');
    });

    it('says in the picker why one was not added, in the server’s words for a limit', async () => {
      const addExercise = vi.fn(() =>
        throwError(() => refused('own_workout_limit', 'A workout holds at most 40 exercises.')),
      );
      const { fixture, host, api, own } = await render({ own: { addExercise } });
      press(host, 'Add an exercise');
      await settle(fixture);

      pick('Add Plank').click();
      await settle(fixture);

      expect(textOf(query(sheet(), 'p.problem[role="alert"]'))).toBe(
        'A workout holds at most 40 exercises.',
      );
      expect(errorLine(host)).toBe('A workout holds at most 40 exercises.');
      expect(own.addSet).not.toHaveBeenCalled();
      expect(pick('Add Plank').querySelector('.mark')).toBeNull();
      // A limit is no change made elsewhere: nothing is read again.
      expect(api.getMyTrainingToday).toHaveBeenCalledTimes(1);
    });

    it('keeps focus in the picker when a press there is refused, where its own line says why', async () => {
      const addExercise = vi.fn(() =>
        throwError(() => refused('own_workout_limit', 'A workout holds at most 40 exercises.')),
      );
      const { fixture, host } = await render({ own: { addExercise } });
      press(host, 'Add an exercise');
      await settle(fixture);

      // While the sheet is open, the page behind it is hidden from assistive technology.
      expect(query(host, '#training-error-summary').closest('[aria-hidden="true"]')).not.toBeNull();
      // A keyboard press: focus is on the row.
      pick('Add Plank').focus();
      expect(document.activeElement).toBe(pick('Add Plank'));
      pick('Add Plank').click();
      await settle(fixture);

      // Said at the top of the sheet, beside the search, which stays in view however far it scrolled.
      expect(textOf(query(sheet(), '.top p.problem[role="alert"]'))).toBe(
        'A workout holds at most 40 exercises.',
      );
      // The player's own line is under the open sheet, which hides the page behind it from assistive
      // technology (aria-hidden): focus sent there would leave the sheet open with nothing focused in it.
      expect(document.activeElement).not.toBe(query(host, '#training-error-summary'));
      expect(sheet().contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(pick('Add Plank'));
    });

    it('asks before taking away one with logged sets, then shows an exercise still in the workout', async () => {
      const removeExercise = vi.fn(() => of(gobletWorkout({ version: 6 })));
      const { fixture, host } = await render({
        today: ownDay(
          gobletWorkout({
            exercises: [
              goblet(),
              deadlift([
                loggedOwnSetView({ performanceId: 'own-set-2' }),
                loggedOwnSetView({ performanceId: 'own-set-3', position: 2 }),
              ]),
            ],
          }),
        ),
        own: { removeExercise },
      });

      press(host, 'Next exercise →');
      await settle(fixture);
      expect(shown(host)).toEqual(['EXERCISE 2 OF 2', 'Romanian deadlift']);
      press(host, 'Remove exercise');
      await settle(fixture);
      expect(textOf(query(dialog()!, 'h2'))).toBe('Remove Romanian deadlift?');
      expect(textOf(dialog())).toContain('Its 2 logged sets go with it.');
      press(dialog()!, 'Remove exercise');
      await settle(fixture);

      expect(removeExercise).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-2', 5);
      // The second of two went: the first is on show, not an empty page.
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Goblet squat']);
      expect(saidLine(host)).toBe('Romanian deadlift removed.');
      // Its button went with it: focus is on Add an exercise.
      expect(document.activeElement).toBe(query(host, '[data-add-exercise]'));
    });

    it('takes one with nothing logged away at once, and asks in the singular about one logged set', async () => {
      const left = deadlift([loggedOwnSetView({ performanceId: 'own-set-2' })]);
      const removeExercise = vi.fn(() => of(gobletWorkout({ version: 6, exercises: [left] })));
      const { fixture, host } = await render({
        today: ownDay(gobletWorkout({ exercises: [goblet(), left] })),
        own: { removeExercise },
      });

      press(host, 'Remove exercise');
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(removeExercise).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-1', 5);
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Romanian deadlift']);
      expect(saidLine(host)).toBe('Goblet squat removed.');

      press(host, 'Remove exercise');
      await settle(fixture);
      expect(textOf(query(dialog()!, 'h2'))).toBe('Remove Romanian deadlift?');
      expect(textOf(dialog())).toContain('Its logged set goes with it.');
      press(dialog()!, 'Keep it');
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(removeExercise).toHaveBeenCalledTimes(1);
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Romanian deadlift']);
    });

    it('keeps one a note names, saying why, with no Remove', async () => {
      const { host } = await render({
        today: ownDay(
          gobletWorkout({
            notes: [ownWorkoutNote('Knee felt it on the way down.', 'own-exercise-1')],
          }),
        ),
      });

      expect(textOf(query(host, '.own-stays'))).toBe(
        'This exercise has a note, so it stays in this workout.',
      );
      expect(host.querySelector('[data-remove-exercise]')).toBeNull();
    });

    it('reads the workout again when a note written on another phone keeps one, and says why', async () => {
      const noted = gobletWorkout({
        version: 6,
        notes: [ownWorkoutNote('Knee felt it on the way down.', 'own-exercise-1')],
      });
      const getMyTrainingToday = vi
        .fn()
        .mockReturnValueOnce(of(ownDay()))
        .mockReturnValue(of(ownDay(noted)));
      const removeExercise = vi.fn(() =>
        throwError(() =>
          refused('own_exercise_has_note', 'An exercise a note names stays in the workout.'),
        ),
      );
      const { fixture, host } = await render({
        api: { getMyTrainingToday },
        own: { removeExercise },
      });

      press(host, 'Remove exercise');
      await settle(fixture);

      expect(removeExercise).toHaveBeenCalledTimes(1);
      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      expect(errorLine(host)).toBe('This exercise has a note, so it stays in this workout.');
      expect(textOf(query(host, '.own-stays'))).toBe(
        'This exercise has a note, so it stays in this workout.',
      );
      expect(host.querySelector('[data-remove-exercise]')).toBeNull();
      expect(textOf(query(host, '.note-history'))).toContain('Knee felt it on the way down.');
    });

    it('closes the picker when the workspace changes under it', async () => {
      const { fixture, host, tenant } = await render();
      press(host, 'Add an exercise');
      await settle(fixture);
      expect(textOf(query(sheet(), 'h2'))).toBe('Add an exercise');

      tenant.set(null);
      await settle(fixture);

      expect(document.querySelector('.tb-modal-pane--sheet')).toBeNull();
      expect(host.querySelector('.workout')).toBeNull();
    });
  });

  describe('its sets', () => {
    it('adds a set, and takes the last away at once while it is not logged', async () => {
      const addSet = vi.fn(() =>
        of(gobletWorkout({ version: 6, exercises: [goblet([ownSetView(), secondSet()])] })),
      );
      const removeSet = vi.fn(() => of(gobletWorkout({ version: 7 })));
      const { fixture, host } = await render({ own: { addSet, removeSet } });

      press(host, 'Add set');
      await settle(fixture);
      expect(addSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-1', 5);
      expect(setCards(host)).toHaveLength(2);
      expect(saidLine(host)).toBe('Set added.');
      // The new set starts at last time's second set (TRN-029).
      const second = setCards(host)[1];
      expect(textOf(query(second, '.set-previous'))).toBe('Last time 24 kg × 8');
      expect(field(second, 'Actual repetitions').value).toBe('8');

      press(host, 'Remove last set');
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(removeSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-2', 6);
      expect(setCards(host)).toHaveLength(1);
      expect(saidLine(host)).toBe('Set removed.');
    });

    it('asks before taking away a logged last set, and Keep it keeps it', async () => {
      const removeSet = vi.fn(() =>
        of(gobletWorkout({ version: 6, exercises: [goblet([loggedOwnSetView()])] })),
      );
      const { fixture, host } = await render({
        today: ownDay(
          gobletWorkout({ exercises: [goblet([loggedOwnSetView(), secondSet(true)])] }),
        ),
        own: { removeSet },
      });

      press(host, 'Remove last set');
      await settle(fixture);
      expect(textOf(query(dialog()!, 'h2'))).toBe('Remove set 2?');
      expect(textOf(dialog())).toContain(
        'It’s logged. Once it’s removed, it’s gone from this workout.',
      );
      press(dialog()!, 'Keep it');
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(removeSet).not.toHaveBeenCalled();
      expect(setCards(host)).toHaveLength(2);

      press(host, 'Remove last set');
      await settle(fixture);
      press(dialog()!, 'Remove set');
      await settle(fixture);
      expect(removeSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-2', 5);
      expect(setCards(host)).toHaveLength(1);
    });

    it('takes an exercise’s only set away and keeps focus in its row, on Add set', async () => {
      const removeSet = vi.fn(() => of(gobletWorkout({ version: 6, exercises: [goblet([])] })));
      const { fixture, host } = await render({ own: { removeSet } });

      press(host, 'Remove last set');
      await settle(fixture);

      expect(removeSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-1', 5);
      expect(setCards(host)).toHaveLength(0);
      expect(textOf(query(host, '.own-no-sets'))).toBe('No sets yet. Add one to log it.');
      expect(host.querySelector('[data-remove-set]')).toBeNull();
      expect(document.activeElement).toBe(button(host, 'Add set'));
    });

    it('logs a set on the version the workout holds after its last change, with a note of one’s own', async () => {
      const addSet = vi.fn(() =>
        of(gobletWorkout({ version: 6, exercises: [goblet([ownSetView(), secondSet()])] })),
      );
      const recordMyTrainingSet = vi.fn(() => of(saved({ clientNote: 'Felt easy.' })));
      const { fixture, host } = await render({ own: { addSet }, api: { recordMyTrainingSet } });
      press(host, 'Add set');
      await settle(fixture);

      const [first] = setCards(host);
      await toggleFold(fixture, first, 'More options');
      fill(first, 'Note (optional)', 'Felt easy.');
      await settle(fixture);
      press(first, 'Log set');
      await settle(fixture);

      expect(recordMyTrainingSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-1', {
        repetitions: 10,
        load: 24,
        loadUnit: 'Kilogram',
        rpe: null,
        rir: null,
        isCompleted: true,
        clientNote: 'Felt easy.',
        version: 6,
      });
      expect(saidLine(host)).toBe('Set saved.');
    });

    it('waits for a set still saving before a change, then sends the change on the version the save answered', async () => {
      const save = new Subject<WorkoutSetSaveView>();
      const recordMyTrainingSet = vi.fn(() => save);
      const addSet = vi.fn<OwnWorkoutApi['addSet']>(() =>
        of(gobletWorkout({ version: 8, exercises: [goblet([loggedOwnSetView(), secondSet()])] })),
      );
      const { fixture, host } = await render({ api: { recordMyTrainingSet }, own: { addSet } });

      press(setCards(host)[0], 'Log set');
      await settle(fixture);
      expect(recordMyTrainingSet).toHaveBeenCalledTimes(1);
      // Pressed while the ✓ is on its way, which moves the workout's version: it waits for it.
      press(host, 'Add set');
      await settle(fixture);
      expect(addSet).not.toHaveBeenCalled();

      save.next(saved());
      save.complete();
      await settle(fixture);

      expect(addSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-1', 7);
      // Nothing changed elsewhere: no conflict is said, and the set and the new one are both there.
      expect(errorLine(host)).toBe('');
      expect(setCards(host)).toHaveLength(2);
      expect(saidLine(host)).toBe('Set added.');
    });

    it('asks before taking away a set whose ✓ is still saving, or its exercise, and removes it only after the save', async () => {
      const save = new Subject<WorkoutSetSaveView>();
      const recordMyTrainingSet = vi.fn(() => save);
      const removeSet = vi.fn<OwnWorkoutApi['removeSet']>(() =>
        of(gobletWorkout({ version: 8, exercises: [goblet([])] })),
      );
      const removeExercise = vi.fn<OwnWorkoutApi['removeExercise']>(() =>
        of(gobletWorkout({ version: 8, exercises: [] })),
      );
      const { fixture, host } = await render({
        api: { recordMyTrainingSet },
        own: { removeSet, removeExercise },
      });

      press(setCards(host)[0], 'Log set');
      await settle(fixture);

      // Not logged on the server yet, but on its way: taking it away is asked about.
      press(host, 'Remove last set');
      await settle(fixture);
      expect(textOf(query(dialog()!, 'h2'))).toBe('Remove set 1?');
      expect(textOf(dialog())).toContain(
        'It’s logged. Once it’s removed, it’s gone from this workout.',
      );
      press(dialog()!, 'Keep it');
      await settle(fixture);
      expect(dialog()).toBeNull();

      press(host, 'Remove exercise');
      await settle(fixture);
      expect(textOf(query(dialog()!, 'h2'))).toBe('Remove Goblet squat?');
      expect(textOf(dialog())).toContain('Its logged set goes with it.');
      press(dialog()!, 'Keep it');
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(removeSet).not.toHaveBeenCalled();
      expect(removeExercise).not.toHaveBeenCalled();

      // Taken away on the answer to the question, once the save is in, on the version it answered.
      press(host, 'Remove last set');
      await settle(fixture);
      press(dialog()!, 'Remove set');
      await settle(fixture);
      expect(removeSet).not.toHaveBeenCalled();

      save.next(saved());
      save.complete();
      await settle(fixture);

      expect(removeSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-1', 7);
      expect(removeExercise).not.toHaveBeenCalled();
      expect(errorLine(host)).toBe('');
      expect(setCards(host)).toHaveLength(0);
      expect(saidLine(host)).toBe('Set removed.');
    });

    it('takes the last set away once however often it is pressed while that is on its way', async () => {
      const removed = new Subject<OwnWorkoutView>();
      // A second press that got through would be sent once the first is answered, and answered too.
      const removeSet = vi
        .fn<OwnWorkoutApi['removeSet']>()
        .mockReturnValueOnce(removed)
        .mockReturnValue(of(gobletWorkout({ version: 7, exercises: [goblet([])] })));
      const { fixture, host } = await render({
        today: ownDay(gobletWorkout({ exercises: [goblet([ownSetView(), secondSet()])] })),
        own: { removeSet },
      });

      press(host, 'Remove last set');
      await settle(fixture);
      expect(removeSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-2', 5);
      press(host, 'Remove last set');
      await settle(fixture);

      removed.next(gobletWorkout({ version: 6, exercises: [goblet([ownSetView()])] }));
      removed.complete();
      await settle(fixture);

      expect(removeSet).toHaveBeenCalledTimes(1);
      expect(setCards(host)).toHaveLength(1);
      expect(errorLine(host)).toBe('');
      expect(saidLine(host)).toBe('Set removed.');
    });

    it('takes an exercise away once however often it is pressed while that is on its way', async () => {
      const removed = new Subject<OwnWorkoutView>();
      const left = deadlift([ownSetView({ performanceId: 'own-set-2' })]);
      const removeExercise = vi
        .fn<OwnWorkoutApi['removeExercise']>()
        .mockReturnValueOnce(removed)
        .mockReturnValue(of(gobletWorkout({ version: 7, exercises: [] })));
      const { fixture, host } = await render({
        today: ownDay(gobletWorkout({ exercises: [goblet(), left] })),
        own: { removeExercise },
      });

      press(host, 'Remove exercise');
      await settle(fixture);
      expect(removeExercise).toHaveBeenCalledExactlyOnceWith('own-1', 'own-exercise-1', 5);
      press(host, 'Remove exercise');
      await settle(fixture);

      removed.next(gobletWorkout({ version: 6, exercises: [left] }));
      removed.complete();
      await settle(fixture);

      expect(removeExercise).toHaveBeenCalledTimes(1);
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Romanian deadlift']);
      expect(errorLine(host)).toBe('');
      expect(saidLine(host)).toBe('Goblet squat removed.');
    });

    it('says an exercise holds 20 sets and a workout 40 exercises before the server would refuse', async () => {
      const sets = Array.from({ length: 20 }, (_, index) =>
        ownSetView({ performanceId: `own-set-${index + 1}`, position: index + 1 }),
      );
      const others = Array.from({ length: 39 }, (_, index) =>
        ownExerciseView({
          performanceId: `own-exercise-${index + 2}`,
          exerciseId: `pool-exercise-${index + 2}`,
          exerciseName: `Exercise ${index + 2}`,
          position: index + 2,
        }),
      );
      const { host } = await render({
        today: ownDay(gobletWorkout({ exercises: [goblet(sets), ...others] })),
      });

      expect(button(host, 'Add set').disabled).toBe(true);
      expect(button(host, 'Add an exercise').disabled).toBe(true);
      expect(Array.from(host.querySelectorAll('.own-limit')).map((line) => textOf(line))).toEqual([
        'An exercise holds at most 20 sets.',
        'A workout holds at most 40 exercises.',
      ]);
      // Taking away is still open.
      expect(button(host, 'Remove last set').disabled).toBe(false);
    });
  });

  describe('kg or lb (TRN-016, TRN-029)', () => {
    /** Bench press, first in the workout and never done before: nothing to start a unit from. */
    const newBench = (sets: OwnWorkoutSetView[]) =>
      ownExerciseView({
        performanceId: 'own-exercise-2',
        exerciseId: POOL_BENCH_PRESS.id,
        exerciseName: 'Bench press',
        position: 1,
        sets,
      });
    /** Goblet squat, added second, last done in kg. */
    const addedGoblet = (sets: OwnWorkoutSetView[]) =>
      ownExerciseView({ position: 2, previousPerformance: LAST_TIME, sets });

    it('starts where last time puts it once an exercise is added, and a load typed before takes it', async () => {
      const benchSet = [ownSetView({ performanceId: 'own-set-5' })];
      const addExercise = vi.fn<OwnWorkoutApi['addExercise']>(() =>
        of(ownWorkoutView({ version: 6, exercises: [newBench(benchSet), addedGoblet([])] })),
      );
      const addSet = vi.fn<OwnWorkoutApi['addSet']>(() =>
        of(
          ownWorkoutView({
            version: 7,
            exercises: [newBench(benchSet), addedGoblet([ownSetView()])],
          }),
        ),
      );
      const recordMyTrainingSet = vi.fn(() =>
        of(
          saved({
            setPerformanceId: 'own-set-5',
            executionVersion: 8,
            actualRepetitions: 8,
            actualLoad: 60,
          }),
        ),
      );
      const { fixture, host } = await render({
        today: ownDay(ownWorkoutView({ exercises: [newBench(benchSet)] })),
        own: { addExercise, addSet },
        api: { recordMyTrainingSet },
      });

      // Nothing says kg or lb yet: no coach, and no last time.
      expect(field(host, 'kg').checked).toBe(false);
      expect(field(host, 'lb').checked).toBe(false);
      const [typed] = setCards(host);
      expect(textOf(query(typed, '.set-previous'))).toBe('Last time —');
      fill(typed, 'Load', '60');
      fill(typed, 'Actual repetitions', '8');
      await settle(fixture);

      press(host, 'Add an exercise');
      await settle(fixture);
      pick('Add Goblet squat').click();
      await settle(fixture);
      press(sheet(), 'Done');
      await settle(fixture);

      // Goblet squat was last done in kg: the workout is in kg, its set starting at last time's load.
      expect(shown(host)).toEqual(['EXERCISE 2 OF 2', 'Goblet squat']);
      expect(field(host, 'kg').checked).toBe(true);
      expect(field(host, 'lb').checked).toBe(false);
      const [goblet] = setCards(host);
      expect(field(goblet, 'Load (kg)').value).toBe('24');
      expect(field(goblet, 'Actual repetitions').value).toBe('10');

      // The load typed before any unit was shown keeps its number, in the unit now shown.
      press(host, 'Previous exercise');
      await settle(fixture);
      const [bench] = setCards(host);
      expect(field(bench, 'Load (kg)').value).toBe('60');
      press(bench, 'Log set');
      await settle(fixture);

      expect(recordMyTrainingSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-5', {
        repetitions: 8,
        load: 60,
        loadUnit: 'Kilogram',
        rpe: null,
        rir: null,
        isCompleted: true,
        clientNote: null,
        version: 7,
      });
      expect(errorLine(host)).toBe('');
      expect(host.textContent).not.toContain('Select kg or lb before saving a load.');
    });

    it('holds the unit for every exercise: one last done in the other unit starts with no load, its last time beside it', async () => {
      /** Dumbbell curl, last done in lb: 30 lb × 12 on Tue 10 Nov. */
      const curl = ownExerciseView({
        performanceId: 'own-exercise-2',
        exerciseId: 'pool-dumbbell-curl',
        exerciseName: 'Dumbbell curl',
        position: 2,
        previousPerformance: {
          date: '2026-11-10',
          bestLoad: 30,
          unit: 'Pound',
          repetitions: 12,
          rpe: null,
          sets: [{ position: 1, repetitions: 12, load: 30, loadUnit: 'Pound', rpe: null }],
        },
        sets: [ownSetView({ performanceId: 'own-set-2' })],
      });
      const recordMyTrainingSet = vi.fn(() =>
        of(
          saved({
            setPerformanceId: 'own-set-2',
            actualRepetitions: 12,
            actualLoad: 14,
            actualLoadUnit: 'Kilogram',
          }),
        ),
      );
      const { fixture, host } = await render({
        today: ownDay(gobletWorkout({ exercises: [goblet(), curl] })),
        api: { recordMyTrainingSet },
      });

      // Goblet squat, first, was last done in kg: the workout is in kg.
      expect(field(host, 'kg').checked).toBe(true);
      expect(field(setCards(host)[0], 'Load (kg)').value).toBe('24');

      press(host, 'Next exercise →');
      await settle(fixture);
      expect(shown(host)).toEqual(['EXERCISE 2 OF 2', 'Dumbbell curl']);
      expect(field(host, 'kg').checked).toBe(true);
      expect(textOf(query(host, '.previous-performance strong'))).toBe('30 lb × 12');
      const [set] = setCards(host);
      // Last time stays in the unit it was lifted in; its number is never shown as kg.
      expect(textOf(query(set, '.set-previous'))).toBe('Last time 30 lb × 12');
      expect(field(set, 'Load (kg)').value).toBe('');
      expect(field(set, 'Actual repetitions').value).toBe('12');

      fill(set, 'Load (kg)', '14');
      await settle(fixture);
      press(set, 'Log set');
      await settle(fixture);

      expect(recordMyTrainingSet).toHaveBeenCalledExactlyOnceWith('own-1', 'own-set-2', {
        repetitions: 12,
        load: 14,
        loadUnit: 'Kilogram',
        rpe: null,
        rir: null,
        isCompleted: true,
        clientNote: null,
        version: 5,
      });
      expect(errorLine(host)).toBe('');
    });
  });

  describe('when it changed or closed elsewhere', () => {
    it('reads it again when it changed on another phone, says so, and adds on the version it has now', async () => {
      const getMyTrainingToday = vi
        .fn()
        .mockReturnValueOnce(of(ownDay()))
        .mockReturnValue(
          of(
            ownDay(gobletWorkout({ version: 8, exercises: [goblet([ownSetView(), secondSet()])] })),
          ),
        );
      const addSet = vi
        .fn()
        .mockReturnValueOnce(
          throwError(() =>
            refused('concurrency_conflict', 'Training data was changed by another request.'),
          ),
        )
        .mockReturnValueOnce(
          of(
            gobletWorkout({
              version: 9,
              exercises: [
                goblet([
                  ownSetView(),
                  secondSet(),
                  ownSetView({ performanceId: 'own-set-3', position: 3 }),
                ]),
              ],
            }),
          ),
        );
      const { fixture, host } = await render({ api: { getMyTrainingToday }, own: { addSet } });

      press(host, 'Add set');
      await settle(fixture);

      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      // Adding is not idempotent, so it is never sent again by itself.
      expect(addSet).toHaveBeenCalledTimes(1);
      expect(errorLine(host)).toBe(
        'This workout changed on another phone or tab. It’s up to date now, so try again.',
      );
      expect(host.textContent).not.toContain('Training data was changed by another request.');
      expect(setCards(host)).toHaveLength(2);

      press(host, 'Add set');
      await settle(fixture);
      expect(addSet).toHaveBeenLastCalledWith('own-1', 'own-exercise-1', 8);
      expect(setCards(host)).toHaveLength(3);
      expect(errorLine(host)).toBe('');
    });

    it('keeps it on show, read only, once it was finished on another phone', async () => {
      const getMyTrainingToday = vi
        .fn()
        .mockReturnValueOnce(of(ownDay()))
        // Today's read carries only an unfinished workout of one's own.
        .mockReturnValue(of(ownDay(null)));
      const addSet = vi.fn(() =>
        throwError(() => refused('workout_immutable', 'Completed workout history is immutable.')),
      );
      const { fixture, host, api } = await render({ api: { getMyTrainingToday }, own: { addSet } });

      press(host, 'Add set');
      await settle(fixture);

      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      expect(errorLine(host)).toBe(
        'This workout was finished on another phone or tab, so it can’t change now.',
      );
      expect(textOf(query(host, 'app-status-label'))).toBe('Completed · read only');
      expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Goblet squat']);
      for (const control of [
        '[data-add-set]',
        '[data-remove-set]',
        '[data-remove-exercise]',
        '[data-add-exercise]',
        '.log-set',
        '.finish-button',
      ]) {
        expect(host.querySelector(control), control).toBeNull();
      }
      expect(api.getSelfProfile).not.toHaveBeenCalled();
      expect(await fixture.componentInstance.canLeave()).toBe(true);
    });

    it('says an exercise finished elsewhere with no sets had none logged, inviting nothing', async () => {
      const getMyTrainingToday = vi
        .fn()
        .mockReturnValueOnce(of(ownDay(gobletWorkout({ exercises: [goblet([])] }))))
        .mockReturnValue(of(ownDay(null)));
      const addSet = vi.fn(() =>
        throwError(() => refused('workout_immutable', 'Completed workout history is immutable.')),
      );
      const { fixture, host } = await render({ api: { getMyTrainingToday }, own: { addSet } });
      expect(textOf(query(host, '.own-no-sets'))).toBe('No sets yet. Add one to log it.');

      press(host, 'Add set');
      await settle(fixture);

      expect(textOf(query(host, 'app-status-label'))).toBe('Completed · read only');
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Goblet squat']);
      expect(textOf(query(host, '.own-no-sets'))).toBe('No sets were logged for this exercise.');
      expect(host.textContent).not.toContain('Add one to log it.');
      expect(host.querySelector('[data-add-set]')).toBeNull();
    });

    it('says a workout finished elsewhere with nothing in it holds no exercises, inviting none', async () => {
      const getMyTrainingToday = vi
        .fn()
        .mockReturnValueOnce(of(ownDay(gobletWorkout({ exercises: [] }))))
        .mockReturnValue(of(ownDay(null)));
      const addExercise = vi.fn(() =>
        throwError(() => refused('workout_immutable', 'Completed workout history is immutable.')),
      );
      const { fixture, host } = await render({
        api: { getMyTrainingToday },
        own: { addExercise },
      });
      expect(textOf(query(host, '.own-empty h2'))).toBe('No exercises yet');

      press(host, 'Add an exercise');
      await settle(fixture);
      pick('Add Plank').click();
      await settle(fixture);
      expect(textOf(query(sheet(), 'p.problem[role="alert"]'))).toBe(
        'This workout was finished on another phone or tab, so it can’t change now.',
      );
      press(sheet(), 'Done');
      await settle(fixture);

      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      expect(textOf(query(host, 'app-status-label'))).toBe('Completed · read only');
      expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
      expect(textOf(query(host, '.own-empty h2'))).toBe('No exercises');
      expect(textOf(query(host, '.own-empty p'))).toBe(
        'This workout was finished with no exercises in it.',
      );
      expect(host.textContent).not.toContain('Add your first exercise');
      expect(host.querySelector('[data-add-exercise]')).toBeNull();
      expect(host.querySelector('.finish-button')).toBeNull();
    });

    it('reads access again when a change is refused for it, and says Training is closed', async () => {
      const getMyUpcomingTraining = vi
        .fn()
        .mockReturnValueOnce(of(upcoming()))
        .mockReturnValue(of(upcoming({ isAllowed: false, accessReason: 'MembershipInactive' })));
      // The own-workout routes forbid with no body.
      const addSet = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 })));
      const { fixture, host, api } = await render({
        api: { getMyUpcomingTraining },
        own: { addSet },
      });

      press(host, 'Add set');
      await settle(fixture);

      expect(getMyUpcomingTraining).toHaveBeenCalledTimes(2);
      expect(api.getMyTrainingToday).toHaveBeenCalledTimes(1);
      expect(errorLine(host)).toBe(
        'Training isn’t open for you right now, so this workout can’t change.',
      );
      expect(textOf(query(host, 'app-empty-state h2'))).toBe('Training is not available');
      expect(textOf(query(host, 'app-empty-state p'))).toBe(
        'Your coaching has ended, so training is closed.',
      );
    });
  });

  describe('finishing and leaving', () => {
    it('asks before finishing with nothing logged, since it then stays in history with no sets', async () => {
      const { fixture, host, api } = await render();

      press(host, 'Finish workout');
      await settle(fixture);
      expect(textOf(query(host, '.finish-confirmation p'))).toBe(
        'Nothing is logged yet. If you finish now, this workout stays in your history with no sets, and you can’t change it afterwards.',
      );
      press(host, 'Confirm finish');
      await settle(fixture);

      expect(api.completeMyWorkout).toHaveBeenCalledExactlyOnceWith('own-1', { version: 5 });
      expect(textOf(query(host, '.finish-summary h2'))).toBe('Workout done.');
      expect(textOf(query(host, '.finish-summary [data-stat="sets"] strong'))).toBe('0 / 1');
    });

    it('counts the sets logged before finishing once something is logged', async () => {
      const { fixture, host } = await render({
        today: ownDay(gobletWorkout({ exercises: [goblet([loggedOwnSetView(), secondSet()])] })),
      });

      press(host, 'Finish workout');
      await settle(fixture);
      expect(textOf(query(host, '.finish-confirmation p'))).toBe(
        '1 of 2 sets logged. You can’t change this workout afterwards.',
      );
    });

    it('saves a note of one’s own, and before leaving one unsaved asks in words for nobody else', async () => {
      const { fixture, host, api } = await render();
      await toggleFold(fixture, host, 'Workout note');
      fill(host, 'Workout note', 'Short on time today.');
      await settle(fixture);

      const answer = fixture.componentInstance.canLeave();
      await settle(fixture);
      expect(textOf(dialog())).toContain(
        'Your workout note isn’t saved. If you leave now, it is lost.',
      );
      press(dialog()!, 'Stay');
      expect(await answer).toBe(false);

      press(host, 'Save note');
      await settle(fixture);
      expect(api.addWorkoutNote).toHaveBeenCalledExactlyOnceWith('own-1', {
        exercisePerformanceId: null,
        text: 'Short on time today.',
      });
      expect(saidLine(host)).toBe('Workout note added.');
      expect(await fixture.componentInstance.canLeave()).toBe(true);
    });
  });

  describe('with nothing in progress and no program (CLI-026)', () => {
    it('offers a trainee a workout of their own, which starts empty, ready for its first exercise', async () => {
      const { fixture, host, api, own, refresh } = await render({ today: ownDay(null) });

      expect(api.getSelfProfile).toHaveBeenCalledTimes(1);
      expect(textOf(query(host, 'app-empty-state h2'))).toBe('No workout in progress');
      expect(textOf(query(host, 'app-empty-state p'))).toBe(
        'Start one, add exercises from TB Gym’s pool and log each set as you go.',
      );
      expect(host.textContent).not.toContain('Nothing assigned yet');

      // A keyboard press: focus is on the button, which goes with the empty state.
      button(host, 'Start a workout').focus();
      press(host, 'Start a workout');
      await settle(fixture);

      expect(refresh).toHaveBeenCalled();
      expect(own.start).toHaveBeenCalledExactlyOnceWith();
      expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
      expect(textOf(query(host, '.own-empty h2'))).toBe('No exercises yet');
      expect(textOf(query(host, '.own-empty p'))).toBe(
        'Add your first exercise from TB Gym’s pool, then log its sets.',
      );
      expect(button(host, 'Add an exercise').disabled).toBe(false);
      expect(saidLine(host)).toBe('Workout started.');
      // Focus moves to the one next step rather than falling to the page.
      expect(document.activeElement).toBe(query(host, '[data-add-exercise]'));
      // The answer is the workout: nothing is read again, and nobody is asked again who they are.
      expect(api.getMyTrainingToday).toHaveBeenCalledTimes(1);
      expect(api.getSelfProfile).toHaveBeenCalledTimes(1);
    });

    it('starts one workout when Start is pressed twice before the page redraws', async () => {
      const { fixture, host, own } = await render({ today: ownDay(null) });

      const start = button(host, 'Start a workout');
      start.click();
      start.click();
      await settle(fixture);

      // The second press neither starts another nor stops the first.
      expect(own.start).toHaveBeenCalledTimes(1);
      expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
      expect(textOf(query(host, '.own-empty h2'))).toBe('No exercises yet');
      expect(saidLine(host)).toBe('Workout started.');
      expect(errorLine(host)).toBe('');
    });

    it('tells a coach’s client their coach will put the program here', async () => {
      const { host } = await render({
        today: ownDay(null),
        api: { getSelfProfile: vi.fn(() => of(finishedProfile())) },
      });

      expect(textOf(query(host, 'app-empty-state h2'))).toBe('Nothing assigned yet');
      expect(textOf(query(host, 'app-empty-state p'))).toBe(
        'Your coach will put your program here.',
      );
      expect(host.querySelector('[data-start-own]')).toBeNull();
    });

    it('says what is true for anyone when who is asking cannot be read', async () => {
      const { host } = await render({
        today: ownDay(null),
        api: {
          getSelfProfile: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
        },
      });

      expect(textOf(query(host, 'app-empty-state h2'))).toBe('No workouts yet');
      expect(textOf(query(host, 'app-empty-state p'))).toBe('Your workouts will start here.');
      expect(host.querySelector('[data-start-own]')).toBeNull();
    });

    it('never asks a client with a program who they are', async () => {
      const { host, api } = await render({
        today: ownDay(null),
        upcoming: { hasAssignedProgram: true, hasVisibleSessions: true },
      });

      expect(api.getSelfProfile).not.toHaveBeenCalled();
      expect(textOf(query(host, 'app-empty-state h2'))).toBe('Rest day');
    });

    it('shows the workout started elsewhere when a start is refused for one in progress', async () => {
      const getMyTrainingToday = vi
        .fn()
        .mockReturnValueOnce(of(ownDay(null)))
        .mockReturnValue(of(ownDay()));
      const start = vi.fn(() =>
        throwError(() =>
          refused('own_workout_in_progress', 'You have a workout of your own in progress.'),
        ),
      );
      const { fixture, host } = await render({ api: { getMyTrainingToday }, own: { start } });

      press(host, 'Start a workout');
      await settle(fixture);

      expect(start).toHaveBeenCalledTimes(1);
      expect(getMyTrainingToday).toHaveBeenCalledTimes(2);
      expect(errorLine(host)).toBe(
        'You have a workout you haven’t finished. Carry on with it, or finish it first.',
      );
      expect(eyebrow(host)).toBe('YOUR OWN WORKOUT');
      expect(shown(host)).toEqual(['EXERCISE 1 OF 1', 'Goblet squat']);
    });

    it('says a day holds ten starts, reading nothing again', async () => {
      const start = vi.fn(() =>
        throwError(() =>
          refused('own_workout_daily_limit', 'Ten workouts of your own a day at most.'),
        ),
      );
      const { fixture, host, api } = await render({ today: ownDay(null), own: { start } });

      press(host, 'Start a workout');
      await settle(fixture);

      expect(errorLine(host)).toBe(
        'You’ve started 10 workouts today, the most one day holds. Start the next one tomorrow.',
      );
      expect(api.getMyTrainingToday).toHaveBeenCalledTimes(1);
      expect(textOf(query(host, 'app-empty-state h2'))).toBe('No workout in progress');
    });
  });
});
