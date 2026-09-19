import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import type { CoachWorkoutDetail } from './training-read.models';
import { CoachWorkout } from './coach-workout';

describe('CoachWorkout', () => {
  afterEach(() => TestBed.resetTestingModule());

  function workoutDetail(notesSkip: number | null = 50): CoachWorkoutDetail {
    return {
      isAllowed: true,
      accessReason: 'Granted',
      nextNotesSkip: notesSkip,
      detail: {
        date: '2026-08-25',
        timeZoneId: 'UTC',
        hasMoreNotes: notesSkip !== null,
        workout: {
          sessionId: 'session-1',
          mesocycleId: 'mesocycle-1',
          workoutExecutionId: 'workout-1',
          name: 'Lower A',
          coachNotes: 'Keep the tempo controlled.',
          status: 'InProgress',
          executionVersion: 3,
          exercises: [
            {
              prescriptionId: 'prescription-1',
              performanceId: 'exercise-performance-1',
              prescribedExerciseId: 'exercise-1',
              prescribedExerciseName: 'Back squat',
              actualExerciseId: 'exercise-2',
              actualExerciseName: 'Front squat',
              wasSubstituted: true,
              modificationPolicy: 'CoachApprovedSwap',
              alternatives: [],
              coachNotes: 'Stop if your knees hurt.',
              mediaAssetIds: [],
              previousPerformance: null,
              sets: [
                {
                  prescriptionId: 'set-1',
                  performanceId: 'set-performance-1',
                  position: 1,
                  setType: 'Normal',
                  prescribedRepetitionsMinimum: 6,
                  prescribedRepetitionsMaximum: 8,
                  prescribedLoad: 60,
                  prescribedLoadUnit: 'Kilogram',
                  prescribedTargetRpe: 8,
                  prescribedTargetRir: null,
                  restSeconds: 120,
                  tempo: '3-1-1',
                  actualRepetitions: 7,
                  actualLoad: 62.5,
                  actualLoadUnit: 'Kilogram',
                  actualRpe: 8.5,
                  actualRir: null,
                  isCompleted: true,
                  clientNote: 'Knees felt good.',
                },
              ],
            },
          ],
          notes: [
            {
              id: 'note-newest',
              exercisePerformanceId: null,
              authorUserId: 'client-user-1',
              authorRole: 'Client',
              text: 'Felt stable today.',
              createdAtUtc: '2026-08-25T10:00:00Z',
            },
          ],
        },
      },
    };
  }

  it('clears the previous client while loading and ignores stale results', async () => {
    const delayed = new Subject<CoachWorkoutDetail>();
    const read = vi
      .fn()
      .mockReturnValueOnce(delayed)
      .mockReturnValue(
        of({ isAllowed: false, accessReason: 'Expired', detail: null, nextNotesSkip: null }),
      );
    await TestBed.configureTestingModule({
      imports: [CoachWorkout],
      providers: [
        { provide: ApiClient, useValue: { getCoachWorkoutDetail: read } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CoachWorkout);
    fixture.componentRef.setInput('clientId', 'first-client');
    fixture.componentRef.setInput('workoutId', 'first-workout');
    await settle(fixture);
    fixture.componentRef.setInput('clientId', 'second-client');
    fixture.componentRef.setInput('workoutId', 'second-workout');
    await settle(fixture);
    delayed.next({ isAllowed: false, accessReason: 'Paused', detail: null, nextNotesSkip: null });
    delayed.complete();
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('plan has ended');
    expect(host.textContent).not.toContain('plan is paused');
    expect(read).toHaveBeenLastCalledWith('second-client', 'second-workout', 0);
  });

  it('renders prescriptions, actuals, swaps and append-only workout notes', async () => {
    const newest = workoutDetail();
    const older = {
      ...workoutDetail(null),
      detail: {
        ...workoutDetail(null).detail!,
        workout: {
          ...workoutDetail(null).detail!.workout,
          notes: [
            {
              id: 'note-older',
              exercisePerformanceId: null,
              authorUserId: 'coach-user-1',
              authorRole: 'Coach' as const,
              text: 'Increase only if form stays clean.',
              createdAtUtc: '2026-08-24T10:00:00Z',
            },
          ],
        },
      },
    };
    const read = vi.fn().mockReturnValueOnce(of(newest)).mockReturnValueOnce(of(older));
    await TestBed.configureTestingModule({
      imports: [CoachWorkout],
      providers: [
        { provide: ApiClient, useValue: { getCoachWorkoutDetail: read } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CoachWorkout);
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('workoutId', 'workout-1');
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const content = () => (host.textContent ?? '').replace(/\s+/g, ' ').trim();

    expect(content()).toContain('Front squat');
    expect(content()).toContain('Approved swap. Prescribed: Back squat');
    expect(content()).toContain('Target: 6–8 reps · 60 kg · RPE 8');
    expect(content()).toContain('Actual: 7 reps · 62.5 kg · RPE 8.5 · Logged');
    expect(content()).toContain('Client note: Knees felt good.');
    expect(content()).toContain('Felt stable today.');
    expect(host.querySelector('input, textarea, select')).toBeNull();

    press(host, 'Older notes');
    await settle(fixture);

    expect(read).toHaveBeenLastCalledWith('client-1', 'workout-1', 50);
    expect(content()).toContain('Felt stable today.');
    expect(content()).toContain('Increase only if form stays clean.');
    expect(host.querySelector('button')).toBeNull();
  });
});
