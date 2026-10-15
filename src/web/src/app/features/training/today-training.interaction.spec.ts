import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientExerciseView,
  ClientSetView,
  ClientTrainingDayResult,
  ClientWorkoutView,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, field, fill, press, query, settle } from '../../../testing/dom';
import { personalRecord, programSummary } from '../../../testing/share-card-fixtures';
import { fakeShareCardMaker } from '../../../testing/share-card-maker-fake';
import { ShareCardMaker } from '../share-cards/share-card-maker';
import { TodayTraining } from './today-training';

function set(overrides: Partial<ClientSetView> = {}): ClientSetView {
  return {
    prescriptionId: 'prescription-1',
    performanceId: 'performance-1',
    position: 1,
    setType: 'Normal',
    prescribedRepetitionsMinimum: 6,
    prescribedRepetitionsMaximum: 8,
    prescribedLoad: 60,
    prescribedLoadUnit: 'Kilogram',
    prescribedTargetRpe: 8,
    prescribedTargetRir: null,
    restSeconds: 120,
    tempo: null,
    coachNotes: null,
    actualRepetitions: null,
    actualLoad: null,
    actualLoadUnit: null,
    actualRpe: null,
    actualRir: null,
    isCompleted: false,
    clientNote: null,
    ...overrides,
  };
}

function exercise(overrides: Partial<ClientExerciseView> = {}): ClientExerciseView {
  return {
    prescriptionId: 'prescription-1',
    performanceId: 'exercise-performance-1',
    prescribedExerciseId: 'exercise-1',
    prescribedExerciseName: 'Back squat',
    actualExerciseId: 'exercise-1',
    actualExerciseName: 'Back squat',
    wasSubstituted: false,
    modificationPolicy: 'Locked',
    alternatives: [],
    coachNotes: null,
    mediaAssetIds: [],
    previousPerformance: null,
    sets: [set()],
    ...overrides,
  };
}

function workout(overrides: Partial<ClientWorkoutView> = {}): ClientWorkoutView {
  return {
    sessionId: 'session-1',
    mesocycleId: 'mesocycle-1',
    workoutExecutionId: 'execution-1',
    name: 'Lower A',
    coachNotes: null,
    status: 'InProgress',
    exercises: [exercise()],
    notes: [],
    executionVersion: 3,
    ...overrides,
  };
}

function day(overrides: Partial<ClientTrainingDayResult> = {}): ClientTrainingDayResult {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: '2026-08-25',
    workouts: [workout()],
    ...overrides,
  };
}

function saved(overrides: Partial<WorkoutSetSaveView> = {}): WorkoutSetSaveView {
  return {
    workoutExecutionId: 'execution-1',
    executionVersion: 4,
    setPerformanceId: 'performance-1',
    actualRepetitions: 8,
    actualLoad: 62.5,
    actualLoadUnit: 'Kilogram',
    actualRpe: 8.5,
    actualRir: null,
    isCompleted: true,
    clientNote: 'Felt heavy.',
    ...overrides,
  };
}

async function render(
  api: Partial<ApiClient> = {},
  today: ClientTrainingDayResult = day(),
  tenant = signal<string | null>('tenant-1'),
) {
  await TestBed.configureTestingModule({
    imports: [TodayTraining],
    providers: [
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          getMyTrainingToday: vi.fn(() => of(today)),
          getMyUpcomingTraining: vi.fn(() =>
            of({
              isAllowed: true,
              accessReason: 'Granted',
              localDate: today.localDate,
              hasAssignedProgram: true,
              hasVisibleSessions: true,
              searchThrough: '2026-11-23',
              nextSession: null,
              unfinishedWorkouts: [],
              nextSkip: null,
              todayCoverage: null,
            }),
          ),
          recordMyTrainingSet: vi.fn(() => of(saved())),
          startMyWorkout: vi.fn(() => of(undefined)),
          completeMyWorkout: vi.fn(() =>
            of({
              id: 'execution-1',
              status: 'Completed',
              version: 5,
              startedAtUtc: '2026-08-25T10:00:00Z',
              completedAtUtc: '2026-08-25T11:00:00Z',
            }),
          ),
          addWorkoutNote: vi.fn(() => of(undefined)),
          substituteMyTrainingExercise: vi.fn(() => of(undefined)),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
      { provide: ShareCardMaker, useValue: fakeShareCardMaker() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TodayTraining);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: TestBed.inject(ApiClient),
    tenant,
  };
}

describe('TodayTraining interactions', () => {
  afterEach(() => {
    document.body.replaceChildren();
    TestBed.resetTestingModule();
  });

  /**
   * Logging a set is the client's primary action in the whole training feature, and every input on
   * the row is a one-way `[ngModel]` writing back through `(ngModelChange)`. A control that fails
   * to write its draft would send the previous value, or null, while the screen showed what the
   * client typed.
   */
  it('records the set the client actually entered', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Actual load', '62.5');
    // The coach prescribed kilograms, so the workout's choice starts there.
    expect(field(host, 'kg').checked).toBe(true);
    fill(host, 'Actual repetitions', '8');
    query<HTMLElement>(host, '.set-note summary').click();
    fill(host, 'Actual RPE', '8.5');
    fill(host, 'Note for your coach', 'Felt heavy.');
    await settle(fixture);

    expect(button(host, 'Log set').disabled).toBe(false);
    press(host, 'Log set');
    await settle(fixture);

    expect(api.recordMyTrainingSet).toHaveBeenCalledWith('execution-1', 'performance-1', {
      repetitions: 8,
      load: 62.5,
      loadUnit: 'Kilogram',
      rpe: 8.5,
      rir: null,
      isCompleted: true,
      clientNote: 'Felt heavy.',
      // The workout version the row was rendered at, so a stale save conflicts.
      version: 3,
    });
    expect(host.textContent).toContain('Set saved.');
  });

  /**
   * The saved row takes the server's values, and the draft stops being dirty, so completing the
   * workout is no longer blocked by an edit that has in fact been persisted.
   */
  it('clears the unsaved state once the server has the set', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Actual repetitions', '8');
    await settle(fixture);
    expect(button(host, 'Finish workout').disabled).toBe(false);

    press(host, 'Log set');
    await settle(fixture);

    expect(button(host, 'Finish workout').disabled).toBe(false);
    press(host, 'Finish workout');
    await settle(fixture);
    press(host, 'Confirm finish');
    await settle(fixture);

    // Completion carries the version the last save returned, not the one first rendered.
    expect(api.completeMyWorkout).toHaveBeenCalledWith('execution-1', { version: 4 });
  });

  it('offers the program a workout finished and its records as share cards on the summary', async () => {
    const summary = {
      durationSeconds: 3000,
      completedSetCount: 1,
      totalSetCount: 1,
      volume: [{ unit: 'Kilogram' as const, loadTimesRepetitions: 500 }],
      personalRecords: [personalRecord()],
      finishedProgram: programSummary(),
    };
    const { fixture, host } = await render({
      completeMyWorkout: vi.fn(() =>
        of({
          id: 'execution-1',
          status: 'Completed' as const,
          version: 5,
          startedAtUtc: '2026-08-25T10:00:00Z',
          completedAtUtc: '2026-08-25T11:00:00Z',
          finishSummary: summary,
        }),
      ),
    });
    press(host, 'Log set');
    await settle(fixture);
    press(host, 'Finish workout');
    await settle(fixture);
    press(host, 'Confirm finish');
    await settle(fixture);

    const teaser = query(host, '.finish-summary app-share-teaser');
    expect(teaser.querySelector('.kicker')?.textContent?.trim()).toBe('Program complete');
    expect(button(teaser, 'Share your progress').disabled).toBe(false);
    // The teaser sits before the way back, which stays the summary's one main action.
    expect(
      teaser.compareDocumentPosition(query(host, '.finish-home')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers no share card after a workout that set no record and finished no program', async () => {
    const { fixture, host } = await render({
      completeMyWorkout: vi.fn(() =>
        of({
          id: 'execution-1',
          status: 'Completed' as const,
          version: 5,
          startedAtUtc: '2026-08-25T10:00:00Z',
          completedAtUtc: '2026-08-25T11:00:00Z',
          finishSummary: {
            durationSeconds: 3000,
            completedSetCount: 1,
            totalSetCount: 1,
            volume: [],
            personalRecords: [],
          },
        }),
      ),
    });
    press(host, 'Log set');
    await settle(fixture);
    press(host, 'Finish workout');
    await settle(fixture);
    press(host, 'Confirm finish');
    await settle(fixture);
    expect(query(host, '.finish-summary').textContent).toContain('Workout done.');
    expect(host.querySelector('app-share-teaser')).toBeNull();
  });

  /** An edited set that was never saved must not be silently dropped by completing the workout. */
  it('refuses to complete a workout with an unsaved set', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Actual repetitions', '8');
    await settle(fixture);

    expect(button(host, 'Finish workout').disabled).toBe(false);
    press(host, 'Finish workout');
    await settle(fixture);
    expect(query(host, '[role="alert"]').textContent).toContain('Save every edited set');
    expect(api.completeMyWorkout).not.toHaveBeenCalled();
  });

  /** A load with no unit is not a load, and the server would have to guess kg or lb. */
  it('refuses to save a load with no unit', async () => {
    const noPrescribedUnit = day({
      workouts: [
        workout({
          exercises: [
            exercise({ sets: [set({ prescribedLoad: null, prescribedLoadUnit: null })] }),
          ],
        }),
      ],
    });
    const { fixture, host, api } = await render({}, noPrescribedUnit);

    // Nothing says kg or lb, so neither is chosen (TRN-016).
    expect(field(host, 'kg').checked).toBe(false);
    expect(field(host, 'lb').checked).toBe(false);
    fill(host, 'Actual load', '60');
    await settle(fixture);
    press(host, 'Log set');
    await settle(fixture);

    expect(api.recordMyTrainingSet).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Select kg or lb before saving a load.',
    );

    // Choosing the unit then keeps the 60 typed before it, now in pounds.
    field(host, 'lb').click();
    await settle(fixture);
    expect(field(host, 'Actual load').value).toBe('60');
    press(host, 'Log set');
    await settle(fixture);
    expect(api.recordMyTrainingSet).toHaveBeenCalledWith(
      'execution-1',
      'performance-1',
      expect.objectContaining({ load: 60, loadUnit: 'Pound' }),
    );
  });

  /** The set falls back to the prescribed unit rather than asking again for the obvious answer. */
  it('sends the prescribed unit when the client does not change it', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Actual load', '60');
    await settle(fixture);
    press(host, 'Log set');
    await settle(fixture);

    expect(api.recordMyTrainingSet).toHaveBeenCalledWith(
      'execution-1',
      'performance-1',
      expect.objectContaining({ load: 60, loadUnit: 'Kilogram' }),
    );
  });

  it('starts a workout that has not been started', async () => {
    const notStarted = day({
      workouts: [workout({ workoutExecutionId: null, status: null, executionVersion: null })],
    });
    const { fixture, host, api } = await render({}, notStarted);

    // Nothing is loggable until the workout exists on the server.
    expect(field(host, 'Actual load').disabled).toBe(true);
    press(host, 'Start workout');
    await settle(fixture);

    expect(api.startMyWorkout).toHaveBeenCalledWith('session-1');
  });

  it('adds a workout note and clears the box', async () => {
    const { fixture, host, api } = await render();

    query<HTMLElement>(host, '.workout-footer summary').click();
    fill(host, 'Workout note', 'Knee felt fine today.');
    await settle(fixture);

    press(host, 'Send note');
    await settle(fixture);

    expect(api.addWorkoutNote).toHaveBeenCalledWith('execution-1', {
      exercisePerformanceId: null,
      text: 'Knee felt fine today.',
    });
    expect(field(host, 'Workout note').value).toBe('');
  });

  it('offers no note button until something has been typed', async () => {
    const { host } = await render();

    query<HTMLElement>(host, '.workout-footer summary').click();
    expect(button(host, 'Send note').disabled).toBe(true);
  });

  /** A swap is only offered where the coach captured alternatives and allowed the policy. */
  it('records an approved substitution chosen from the offered alternatives', async () => {
    const swappable = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              modificationPolicy: 'CoachApprovedSwap',
              alternatives: [{ exerciseId: 'exercise-2', name: 'Hack squat' }],
            }),
          ],
        }),
      ],
    });
    const { fixture, host, api } = await render({}, swappable);

    press(host, 'Swap exercise');
    await settle(fixture);
    // The prescribed lift is listed first and marked as the one in use.
    expect(
      button(host, 'Back squatThe one your coach prescribed').getAttribute('aria-current'),
    ).toBe('true');
    press(host, 'Hack squat');
    await settle(fixture);

    expect(api.substituteMyTrainingExercise).toHaveBeenCalledWith(
      'execution-1',
      'exercise-performance-1',
      { exerciseId: 'exercise-2', version: 3 },
    );
    expect(host.textContent).toContain('Swapped to Hack squat.');
  });

  it('offers the way back to the prescribed lift after a swap', async () => {
    const swapped = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              modificationPolicy: 'CoachApprovedSwap',
              alternatives: [{ exerciseId: 'exercise-2', name: 'Hack squat' }],
              wasSubstituted: true,
              actualExerciseId: 'exercise-2',
              actualExerciseName: 'Hack squat',
            }),
          ],
        }),
      ],
    });
    const { fixture, host, api } = await render({}, swapped);

    press(host, 'Swap exercise');
    await settle(fixture);
    expect(button(host, 'Hack squat').getAttribute('aria-current')).toBe('true');
    press(host, 'Back squatThe one your coach prescribed');
    await settle(fixture);

    expect(api.substituteMyTrainingExercise).toHaveBeenCalledWith(
      'execution-1',
      'exercise-performance-1',
      { exerciseId: 'exercise-1', version: 3 },
    );
  });

  it('keeps Swap closed while a set is still being saved', async () => {
    const pending = new Subject<WorkoutSetSaveView>();
    const swappable = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              modificationPolicy: 'CoachApprovedSwap',
              alternatives: [{ exerciseId: 'exercise-2', name: 'Hack squat' }],
            }),
          ],
        }),
      ],
    });
    const { fixture, host } = await render(
      { recordMyTrainingSet: vi.fn(() => pending) },
      swappable,
    );

    press(host, 'Log set');
    await settle(fixture);
    expect(button(host, 'Swap exercise').disabled).toBe(true);

    pending.next(saved());
    pending.complete();
    await settle(fixture);
    expect(button(host, 'Swap exercise').disabled).toBe(false);
  });

  it('offers no swap control for a locked main lift', async () => {
    const { host } = await render();

    expect(host.querySelector('.swap-picker')).toBeNull();
  });

  it('renders a completed workout read-only', async () => {
    const done = day({ workouts: [workout({ status: 'Completed' })] });
    const { host } = await render({}, done);

    expect(host.querySelector('input[aria-label="Actual load"]')).toBeNull();
    expect(host.querySelector('app-status-label')?.textContent).toContain('Completed · read only');
    expect(() => button(host, 'Finish workout')).toThrow();
  });

  /** The player is always on the night colour, so the kit pieces in it read the dark tokens. */
  it('draws on the dark tokens and says an empty day with the kit’s empty state', async () => {
    const { host } = await render({}, day({ workouts: [] }));

    expect(host.getAttribute('data-mode')).toBe('dark');
    expect(host.querySelector('app-empty-state h2')?.textContent).toBe('Rest day');
    expect(host.querySelector('.empty-state, .player-empty')).toBeNull();
  });

  /** An unentitled day says why, and offers no workout to log against. */
  it('explains a closed entitlement instead of showing an empty day', async () => {
    const closed = day({ isAllowed: false, accessReason: 'Expired', workouts: [] });
    const { host } = await render({}, closed);

    expect(host.textContent).toContain('Training is not available');
    expect(host.textContent).not.toContain('Rest day');
    expect(host.querySelector('.workout')).toBeNull();
  });

  it('distinguishes a real recovery day from a closed one', async () => {
    const rest = day({ workouts: [] });
    const { host } = await render({}, rest);

    expect(host.textContent).toContain('Rest day');
    expect(host.textContent).not.toContain('Training is not available');
  });

  it('reports a rejected save and keeps the typed values to retry', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: { title: 'This workout was changed elsewhere.' },
    });
    const { fixture, host } = await render({
      recordMyTrainingSet: vi.fn(() => throwError(() => conflict)),
    });

    fill(host, 'Actual repetitions', '8');
    await settle(fixture);
    press(host, 'Log set');
    await settle(fixture);

    expect(query(host, '[role="alert"]').textContent).toContain(
      'This workout was changed elsewhere.',
    );
    expect(field(host, 'Actual repetitions').value).toBe('8');
    expect(host.textContent).not.toContain('Set saved.');
  });

  it('reports a failed load instead of rendering a day with no workouts', async () => {
    const { host } = await render({
      getMyTrainingToday: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    expect(query(host, '[role="alert"]').textContent).toContain(
      "Today's training could not be loaded.",
    );
    expect(host.textContent).not.toContain('Rest day');
  });

  it('preserves both drafts when one set fails, and retries without changing the other set', async () => {
    const twoSets = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              sets: [
                set(),
                set({
                  prescriptionId: 'prescription-2',
                  performanceId: 'performance-2',
                  position: 2,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const record = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValueOnce(of(saved({ actualRepetitions: 7 })));
    const { fixture, host } = await render({ recordMyTrainingSet: record }, twoSets);
    const cards = host.querySelectorAll<HTMLElement>('.set-card');
    fill(cards[0], 'Actual repetitions', '7');
    fill(cards[1], 'Actual repetitions', '9');
    await settle(fixture);
    press(cards[0], 'Log set');
    await settle(fixture);
    expect(cards[0].textContent).toContain('Your entries are still on this page. Retry.');
    expect(field(cards[0], 'Actual repetitions').value).toBe('7');
    expect(field(cards[1], 'Actual repetitions').value).toBe('9');
    press(cards[0], 'Log set');
    await settle(fixture);
    expect(field(cards[1], 'Actual repetitions').value).toBe('9');
    press(host, 'Finish workout');
    await settle(fixture);
    expect(host.textContent).toContain('Save every edited set');
  });

  it('serializes clicks on two sets using the version returned by the first save', async () => {
    const first = new Subject<WorkoutSetSaveView>();
    const record = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(
        of(
          saved({
            setPerformanceId: 'performance-2',
            executionVersion: 5,
          }),
        ),
      );
    const twoSets = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              sets: [
                set(),
                set({
                  prescriptionId: 'prescription-2',
                  performanceId: 'performance-2',
                  position: 2,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const { fixture, host } = await render({ recordMyTrainingSet: record }, twoSets);
    const cards = host.querySelectorAll<HTMLElement>('.set-card');
    press(cards[0], 'Log set');
    press(cards[1], 'Log set');
    await settle(fixture);
    expect(record).toHaveBeenCalledTimes(1);
    first.next(saved());
    first.complete();
    await settle(fixture);
    expect(record).toHaveBeenNthCalledWith(
      2,
      'execution-1',
      'performance-2',
      expect.objectContaining({ version: 4, isCompleted: true }),
    );
  });

  it('reopens an earlier workout and logs using its own saved version', async () => {
    const earlier = workout({ sessionId: 'yesterday', executionVersion: 12 });
    const { fixture, host, api } = await render(
      {
        getMyUpcomingTraining: vi.fn(() =>
          of({
            isAllowed: true,
            accessReason: 'Granted',
            localDate: '2026-08-25',
            hasAssignedProgram: true,
            hasVisibleSessions: true,
            searchThrough: '2026-11-23',
            nextSession: null,
            unfinishedWorkouts: [{ date: '2026-08-24', workout: earlier, hasMoreNotes: false }],
            nextSkip: null,
            todayCoverage: null,
          }),
        ),
      },
      day({ workouts: [] }),
    );
    expect(host.textContent).toContain('Started for Mon 24 Aug');
    fill(host, 'Actual repetitions', '8');
    press(host, 'Log set');
    await settle(fixture);
    expect(api.recordMyTrainingSet).toHaveBeenCalledWith(
      'execution-1',
      'performance-1',
      expect.objectContaining({ version: 12 }),
    );
  });

  it('shows rest, tempo and RPE meaning and never sends calculated RIR alongside RPE', async () => {
    const today = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              sets: [
                set({
                  tempo: '3-1-1',
                  actualRpe: 8,
                  actualRir: 2,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const { fixture, host, api } = await render({}, today);
    expect(host.textContent).toContain('rest 2:00');
    expect(host.textContent).toContain('tempo 3-1-1');
    expect(host.textContent).toContain('about 2 reps left');
    press(host, 'Log set');
    await settle(fixture);
    expect(api.recordMyTrainingSet).toHaveBeenCalledWith(
      'execution-1',
      'performance-1',
      expect.objectContaining({ rpe: 8, rir: null }),
    );
  });

  it('shows the coach’s note on a set under its target, and nothing for a set without one (C3)', async () => {
    const today = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              sets: [
                set({ coachNotes: 'Pause two seconds at the bottom.' }),
                set({ prescriptionId: 'prescription-2', performanceId: 'performance-2' }),
              ],
            }),
          ],
        }),
      ],
    });
    const { host } = await render({}, today);

    const cards = Array.from(host.querySelectorAll('.set-card'));
    expect(cards).toHaveLength(2);
    const note = cards[0].querySelector('.coach-note');
    expect(note?.textContent?.trim()).toBe('Pause two seconds at the bottom.');
    expect(note?.getAttribute('dir')).toBe('auto');
    // It comes right after the target line, before the client's own options.
    expect(note?.previousElementSibling?.classList.contains('prescription')).toBe(true);
    expect(cards[1].querySelector('.coach-note')).toBeNull();
  });

  it('asks for confirmation when finishing with unlogged sets', async () => {
    const { fixture, host, api } = await render();
    press(host, 'Finish workout');
    await settle(fixture);
    expect(host.textContent).toContain('0 of 1 sets logged');
    expect(api.completeMyWorkout).not.toHaveBeenCalled();
    press(host, 'Keep training');
    await settle(fixture);
    expect(host.querySelector('.finish-confirmation')).toBeNull();
  });

  it('keeps approved-upload demo entry points on the runner', async () => {
    const withDemo = day({
      workouts: [workout({ exercises: [exercise({ mediaAssetIds: ['asset-1'] })] })],
    });
    const { host } = await render({}, withDemo);

    expect(button(host, 'Watch demo 1').disabled).toBe(false);
  });

  it('focuses the persistent error summary when finishing is refused', async () => {
    const { fixture, host } = await render();
    document.body.append(host);

    fill(host, 'Actual repetitions', '8');
    await settle(fixture);
    const finish = button(host, 'Finish workout');
    finish.focus();
    finish.click();
    await settle(fixture);

    expect(document.activeElement).toBe(query(host, '#training-error-summary'));
  });

  it('moves focus from a logged set to Edit set and back to its inputs', async () => {
    const { fixture, host } = await render();
    document.body.append(host);

    const log = button(host, 'Log set');
    log.focus();
    log.click();
    await settle(fixture);

    const edit = button(host, 'Edit set');
    expect(document.activeElement).toBe(edit);
    edit.focus();
    edit.click();
    await settle(fixture);

    expect(document.activeElement).toBe(field(host, 'Actual load'));
  });

  it('moves focus through a logged set without taking it from another set while saving', async () => {
    const firstSave = new Subject<WorkoutSetSaveView>();
    const twoSets = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              sets: [
                set(),
                set({
                  prescriptionId: 'prescription-2',
                  performanceId: 'performance-2',
                  position: 2,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const { fixture, host } = await render(
      { recordMyTrainingSet: vi.fn(() => firstSave) },
      twoSets,
    );
    document.body.append(host);
    const cards = host.querySelectorAll<HTMLElement>('.set-card');
    const firstLog = query<HTMLButtonElement>(cards[0], '.log-set');
    firstLog.focus();
    firstLog.click();
    await Promise.resolve();
    await Promise.resolve();

    const secondRepetitions = field(cards[1], 'Actual repetitions');
    secondRepetitions.focus();
    firstSave.next(saved());
    firstSave.complete();
    await settle(fixture);

    expect(document.activeElement).toBe(secondRepetitions);
  });

  /**
   * TRN-029, the review's D1: one tap logs what the coach prescribed. Last time's numbers stay on
   * screen as a reference, and the row shows exactly what ✓ sends.
   */
  it('logs the prescription in one tap, with last time as a reference', async () => {
    const withHistory = day({
      workouts: [
        workout({
          exercises: [
            exercise({
              previousPerformance: {
                date: '2026-08-18',
                bestLoad: 57.5,
                unit: 'Kilogram',
                repetitions: 7,
                rpe: 8,
                sets: [{ position: 1, repetitions: 7, load: 57.5, loadUnit: 'Kilogram', rpe: 8 }],
              },
            }),
          ],
        }),
      ],
    });
    const { fixture, host, api } = await render({}, withHistory);

    expect(field(host, 'Actual load').value).toBe('60');
    expect(field(host, 'Actual repetitions').value).toBe('6');
    expect(query(host, '.set-previous').textContent).toContain('57.5 × 7');
    expect(query(host, '.previous-performance').textContent).toContain('57.5');

    press(host, 'Log set');
    await settle(fixture);

    expect(api.recordMyTrainingSet).toHaveBeenCalledWith(
      'execution-1',
      'performance-1',
      expect.objectContaining({ load: 60, loadUnit: 'Kilogram', repetitions: 6 }),
    );
  });

  /** The rest after an exercise's last set is the rest before the next one. */
  it('starts the rest after a logged set and keeps it through Next exercise', async () => {
    const twoExercises = day({
      workouts: [
        workout({
          exercises: [
            exercise(),
            exercise({
              prescriptionId: 'prescription-row',
              performanceId: 'exercise-performance-2',
              prescribedExerciseId: 'exercise-3',
              prescribedExerciseName: 'Row',
              actualExerciseId: 'exercise-3',
              actualExerciseName: 'Row',
              sets: [
                set({
                  prescriptionId: 'prescription-row-1',
                  performanceId: 'performance-row-1',
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const { fixture, host } = await render({}, twoExercises);
    expect(host.querySelector('[role="timer"]')).toBeNull();

    press(host, 'Log set');
    await settle(fixture);
    expect(query(host, '[role="timer"]').textContent).toContain('2:00');

    press(host, 'Next exercise →');
    await settle(fixture);
    expect(host.querySelector('h2')?.textContent).toContain('Row');
    expect(host.querySelector('[role="timer"]')).not.toBeNull();
  });

  it('switches between today’s workout and an unfinished earlier one from a menu', async () => {
    const earlier = workout({
      sessionId: 'yesterday',
      name: 'Upper B',
      exercises: [exercise({ actualExerciseName: 'Bench press' })],
    });
    const { fixture, host } = await render({
      getMyUpcomingTraining: vi.fn(() =>
        of({
          isAllowed: true,
          accessReason: 'Granted',
          localDate: '2026-08-25',
          hasAssignedProgram: true,
          hasVisibleSessions: true,
          searchThrough: '2026-11-23',
          nextSession: null,
          unfinishedWorkouts: [{ date: '2026-08-24', workout: earlier, hasMoreNotes: false }],
          nextSkip: null,
          todayCoverage: null,
        }),
      ),
    });
    expect(host.querySelector('h1')?.textContent).toContain('Lower A');
    expect(host.querySelector('select')).toBeNull();

    press(host, 'Choose workout');
    await settle(fixture);
    expect(button(host, 'Lower AToday · in progress').getAttribute('aria-current')).toBe('true');
    press(host, 'Upper BStarted for Mon 24 Aug');
    await settle(fixture);

    expect(host.querySelector('h1')?.textContent).toContain('Upper B');
    expect(host.querySelector('h2')?.textContent).toContain('Bench press');
  });

  it('drops a stale workout-start response after leaving the tenant', async () => {
    const started = new Subject<void>();
    const notStarted = day({
      workouts: [workout({ workoutExecutionId: null, status: null, executionVersion: null })],
    });
    const { fixture, host, api, tenant } = await render(
      { startMyWorkout: vi.fn(() => started) as unknown as ApiClient['startMyWorkout'] },
      notStarted,
    );

    press(host, 'Start workout');
    await Promise.resolve();
    await Promise.resolve();
    expect(api.startMyWorkout).toHaveBeenCalledWith('session-1');

    tenant.set(null);
    await settle(fixture);
    started.next();
    started.complete();
    await settle(fixture);

    expect(host.querySelector('.workout')).toBeNull();
    expect(host.textContent).not.toContain('Workout started.');
  });
});
