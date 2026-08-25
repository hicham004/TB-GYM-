import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
import { button, field, fill, press, query, settle, tick } from '../../../testing/dom';
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

async function render(api: Partial<ApiClient> = {}, today: ClientTrainingDayResult = day()) {
  await TestBed.configureTestingModule({
    imports: [TodayTraining],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getMyTrainingToday: vi.fn(() => of(today)),
          recordMyTrainingSet: vi.fn(() => of(saved())),
          startMyWorkout: vi.fn(() => of(undefined)),
          completeMyWorkout: vi.fn(() => of(undefined)),
          addWorkoutNote: vi.fn(() => of(undefined)),
          substituteMyTrainingExercise: vi.fn(() => of(undefined)),
          ...api,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TodayTraining);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: TestBed.inject(ApiClient) };
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
    fill(host, 'Actual load unit', 'Kilogram');
    fill(host, 'Actual repetitions', '8');
    fill(host, 'Actual RPE', '8.5');
    fill(host, 'Set note', 'Felt heavy.');
    tick(host, 'Set completed');
    await settle(fixture);

    expect(button(host, 'Save').disabled).toBe(false);
    press(host, 'Save');
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
    expect(button(host, 'Complete workout').disabled).toBe(true);

    press(host, 'Save');
    await settle(fixture);

    expect(button(host, 'Complete workout').disabled).toBe(false);
    press(host, 'Complete workout');
    await settle(fixture);

    // Completion carries the version the last save returned, not the one first rendered.
    expect(api.completeMyWorkout).toHaveBeenCalledWith('execution-1', { version: 4 });
  });

  /** An edited set that was never saved must not be silently dropped by completing the workout. */
  it('refuses to complete a workout with an unsaved set', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Actual repetitions', '8');
    await settle(fixture);

    expect(button(host, 'Complete workout').disabled).toBe(true);
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

    fill(host, 'Actual load', '60');
    await settle(fixture);
    press(host, 'Save');
    await settle(fixture);

    expect(api.recordMyTrainingSet).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain(
      'Select kg or lb before saving a load.',
    );
  });

  /** The set falls back to the prescribed unit rather than asking again for the obvious answer. */
  it('sends the prescribed unit when the client does not change it', async () => {
    const { fixture, host, api } = await render();

    fill(host, 'Actual load', '60');
    await settle(fixture);
    press(host, 'Save');
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

    fill(host, 'Workout note', 'Knee felt fine today.');
    await settle(fixture);

    press(host, 'Add note');
    await settle(fixture);

    expect(api.addWorkoutNote).toHaveBeenCalledWith('execution-1', {
      exercisePerformanceId: null,
      text: 'Knee felt fine today.',
    });
    expect(field(host, 'Workout note').value).toBe('');
  });

  it('offers no note button until something has been typed', async () => {
    const { host } = await render();

    expect(button(host, 'Add note').disabled).toBe(true);
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

    fill(host, 'Approved exercise alternative', 'exercise-2');
    await settle(fixture);

    expect(api.substituteMyTrainingExercise).toHaveBeenCalledWith(
      'execution-1',
      'exercise-performance-1',
      { exerciseId: 'exercise-2', version: 3 },
    );
  });

  it('offers no swap control for a locked main lift', async () => {
    const { host } = await render();

    expect(host.querySelector('.swap-picker')).toBeNull();
  });

  it('renders a completed workout read-only', async () => {
    const done = day({ workouts: [workout({ status: 'Completed' })] });
    const { host } = await render({}, done);

    expect(field(host, 'Actual load').disabled).toBe(true);
    expect(field(host, 'Set completed').disabled).toBe(true);
    expect(() => button(host, 'Complete workout')).toThrow();
  });

  /** An unentitled day says why, and offers no workout to log against. */
  it('explains a closed entitlement instead of showing an empty day', async () => {
    const closed = day({ isAllowed: false, accessReason: 'Expired', workouts: [] });
    const { host } = await render({}, closed);

    expect(host.textContent).toContain('Training is not available');
    expect(host.textContent).not.toContain('Recovery day');
    expect(host.querySelector('.workout')).toBeNull();
  });

  it('distinguishes a real recovery day from a closed one', async () => {
    const rest = day({ workouts: [] });
    const { host } = await render({}, rest);

    expect(host.textContent).toContain('Recovery day');
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
    press(host, 'Save');
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
    expect(host.textContent).not.toContain('Recovery day');
  });
});
