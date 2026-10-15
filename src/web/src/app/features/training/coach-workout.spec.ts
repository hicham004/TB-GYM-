import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import type { CoachWorkoutDetail } from './training-read.models';
import { CoachWorkout } from './coach-workout';

/** Each set's Target and Actual figures, in order. */
function figures(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll('.set')).map((set) =>
    Array.from(set.querySelectorAll('.figures dd')).map((value) => value.textContent?.trim() ?? ''),
  );
}

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
                  coachNotes: 'Brace before you unrack.',
                  actualRepetitions: 7,
                  actualLoad: 62.5,
                  actualLoadUnit: 'Kilogram',
                  actualRpe: 8.5,
                  actualRir: null,
                  isCompleted: true,
                  clientNote: 'Knees felt good.',
                },
                {
                  prescriptionId: 'set-2',
                  performanceId: 'set-performance-2',
                  position: 2,
                  setType: 'Normal',
                  // One number asked for, so it is said once: "5 reps", not "5–5 reps".
                  prescribedRepetitionsMinimum: 5,
                  prescribedRepetitionsMaximum: 5,
                  prescribedLoad: 60,
                  prescribedLoadUnit: 'Kilogram',
                  prescribedTargetRpe: null,
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
    expect(host.textContent).toContain('Their plan has ended');
    // Said to the coach about the client, never as "Your plan".
    expect(host.textContent).not.toContain('Your');
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
    // Each set reads Target then Actual; a set nothing was logged for says so once, in its
    // status, and shows a dash for the figures.
    expect(figures(host)).toEqual([
      ['6–8 reps · 60 kg · RPE 8', '7 reps · 62.5 kg · RPE 8.5'],
      ['5 reps · 60 kg', '—'],
    ]);
    expect(content()).toContain('Logged');
    expect(content()).toContain('Not logged');
    // The coach's own note on the set, which the client saw too (C3), then the client's answer.
    const sets = host.querySelectorAll('li.set');
    expect(
      Array.from(sets[0].querySelectorAll('.aside')).map((item) =>
        (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Set note Brace before you unrack.', 'Client note Knees felt good.']);
    expect(sets[1].querySelector('.aside')).toBeNull();
    expect(content()).toContain('Felt stable today.');
    // What the client logged is read only; the one field is the coach's own note (P4).
    expect(host.querySelector('input, select')).toBeNull();
    expect(host.querySelectorAll('textarea')).toHaveLength(1);

    press(host, 'Older notes');
    await settle(fixture);

    expect(read).toHaveBeenLastCalledWith('client-1', 'workout-1', 50);
    expect(content()).toContain('Felt stable today.');
    expect(content()).toContain('Increase only if form stays clean.');
    expect(
      Array.from(host.querySelectorAll('button')).map((item) => item.textContent?.trim()),
    ).toEqual(['Send note']);
  });

  it('sends the coach’s note on the workout, then reads the workout again', async () => {
    const read = vi.fn(() => of(workoutDetail(null)));
    const addWorkoutNote = vi.fn(() => of({}));
    const refresh = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [CoachWorkout],
      providers: [
        { provide: ApiClient, useValue: { getCoachWorkoutDetail: read, addWorkoutNote } },
        { provide: CsrfService, useValue: { refresh } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CoachWorkout);
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('workoutId', 'workout-1');
    fixture.componentRef.setInput('clientName', 'Maya');
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('label.reply-label')?.textContent?.trim()).toBe(
      'Note for Maya on this workout',
    );
    const send = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === 'Send note',
    )!;
    expect(send.disabled).toBe(true);

    const box = host.querySelector('textarea')!;
    box.value = '  Great depth on the last set.  ';
    box.dispatchEvent(new Event('input'));
    await settle(fixture);
    send.click();
    await settle(fixture);

    expect(refresh).toHaveBeenCalled();
    expect(addWorkoutNote).toHaveBeenCalledWith('workout-1', {
      text: 'Great depth on the last set.',
      exercisePerformanceId: null,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(box.value).toBe('');
  });

  it('offers no note on a former client’s record', async () => {
    await TestBed.configureTestingModule({
      imports: [CoachWorkout],
      providers: [
        {
          provide: ApiClient,
          useValue: { getCoachWorkoutDetail: vi.fn(() => of(workoutDetail(null))) },
        },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CoachWorkout);
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('workoutId', 'workout-1');
    fixture.componentRef.setInput('canReply', false);
    await settle(fixture);

    expect((fixture.nativeElement as HTMLElement).querySelector('textarea')).toBeNull();
  });

  it('shows a failed read in words with a Retry that reads it again', async () => {
    const read = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of(workoutDetail(null)));
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

    expect(host.querySelector('.problem[role="alert"]')?.textContent).toContain('Retry');
    expect(host.textContent).not.toContain('Front squat');

    press(host, 'Retry');
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.problem')).toBeNull();
    expect(host.textContent).toContain('Front squat');
  });

  it('says a pound load in pounds and a missing load by leaving it out', async () => {
    const detail = workoutDetail(null);
    const sets = detail.detail!.workout.exercises[0].sets;
    sets[0] = {
      ...sets[0],
      prescribedLoad: 135,
      prescribedLoadUnit: 'Pound',
      actualLoad: null,
      actualLoadUnit: null,
    };
    sets[1] = { ...sets[1], prescribedLoad: null, prescribedLoadUnit: null };
    await TestBed.configureTestingModule({
      imports: [CoachWorkout],
      providers: [
        { provide: ApiClient, useValue: { getCoachWorkoutDetail: vi.fn(() => of(detail)) } },
        { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CoachWorkout);
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('workoutId', 'workout-1');
    await settle(fixture);

    expect(figures(fixture.nativeElement as HTMLElement)).toEqual([
      ['6–8 reps · 135 lb · RPE 8', '7 reps · RPE 8.5'],
      ['5 reps', '—'],
    ]);
  });
});
