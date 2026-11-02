import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ClientTrainingDayResult,
  ClientWorkoutView,
  WorkoutSetSaveView,
} from '../../core/api/generated';
import type { Motion } from '../../core/motion/motion';
import {
  BURST_DOTS,
  buzzSet,
  planSetMoment,
  playSetMoment,
  recordNotice,
  SET_MOMENT,
} from './set-moment';

function set(
  performanceId: string,
  isCompleted = false,
): ClientWorkoutView['exercises'][0]['sets'][0] {
  return {
    prescriptionId: `rx-${performanceId}`,
    performanceId,
    position: 1,
    setType: 'Normal',
    prescribedRepetitionsMinimum: 5,
    prescribedRepetitionsMaximum: 5,
    prescribedLoad: 52.5,
    prescribedLoadUnit: 'Kilogram',
    prescribedTargetRpe: null,
    prescribedTargetRir: null,
    restSeconds: 90,
    isCompleted,
    actualRepetitions: isCompleted ? 5 : null,
    actualLoad: isCompleted ? 52.5 : null,
    actualLoadUnit: isCompleted ? 'Kilogram' : null,
    actualRpe: null,
    actualRir: null,
    clientNote: null,
  } as ClientWorkoutView['exercises'][0]['sets'][0];
}

function day(): ClientTrainingDayResult {
  return {
    isAllowed: true,
    accessReason: 'Granted',
    localDate: '2026-11-02',
    workouts: [
      {
        sessionId: 'session-1',
        workoutExecutionId: 'execution-1',
        executionVersion: 3,
        name: 'Lower A',
        status: 'InProgress',
        exercises: [
          {
            prescriptionId: 'ex-1',
            actualExerciseName: 'Back squat',
            prescribedExerciseName: 'Back squat',
            wasSubstituted: false,
            sets: [set('s1', true), set('s2'), set('s3')],
          },
          {
            prescriptionId: 'ex-2',
            actualExerciseName: 'Leg press',
            prescribedExerciseName: 'Leg press',
            wasSubstituted: false,
            sets: [set('s4'), set('s5')],
          },
        ],
      } as unknown as ClientWorkoutView,
    ],
  } as ClientTrainingDayResult;
}

function answer(overrides: Partial<WorkoutSetSaveView> = {}): WorkoutSetSaveView {
  return {
    workoutExecutionId: 'execution-1',
    executionVersion: 4,
    setPerformanceId: 's2',
    actualRepetitions: 5,
    actualLoad: 52.5,
    actualLoadUnit: 'Kilogram',
    actualRpe: null,
    actualRir: null,
    isCompleted: true,
    clientNote: null,
    ...overrides,
  };
}

describe('planSetMoment', () => {
  it('reads the segment from the exercise completion before and after the set', () => {
    const moment = planSetMoment(day(), answer(), new Set());
    expect(moment).toEqual({
      setId: 's2',
      exerciseName: 'Back squat',
      record: 'none',
      segment: { index: 0, from: 100 / 3, to: 200 / 3 },
    });
  });

  it('gives the full burst to the first record and the small one to a later record', () => {
    expect(planSetMoment(day(), answer({ isPersonalRecord: true }), new Set())?.record).toBe(
      'first',
    );
    expect(planSetMoment(day(), answer({ isPersonalRecord: true }), new Set(['s1']))?.record).toBe(
      'again',
    );
  });

  it('never bursts twice for a set edited and saved again as a record', () => {
    const moment = planSetMoment(day(), answer({ isPersonalRecord: true }), new Set(['s2']));
    expect(moment?.record).toBe('none');
  });

  it('moves no segment when the set was already done, and finds the second exercise', () => {
    expect(planSetMoment(day(), answer({ setPerformanceId: 's1' }), new Set())?.segment).toBeNull();
    expect(planSetMoment(day(), answer({ setPerformanceId: 's5' }), new Set())?.segment).toEqual({
      index: 1,
      from: 0,
      to: 50,
    });
  });

  it('plans nothing for a set the page does not show', () => {
    expect(planSetMoment(null, answer(), new Set())).toBeNull();
    expect(planSetMoment(day(), answer({ setPerformanceId: 'elsewhere' }), new Set())).toBeNull();
  });
});

describe('recordNotice', () => {
  it('names the lift, the load with its unit and the reps', () => {
    expect(recordNotice('Back squat', answer())).toBe(
      'New personal record · Back squat 52.5 kg × 5',
    );
    expect(recordNotice('Pull-up', answer({ actualLoad: null, actualLoadUnit: null }))).toBe(
      'New personal record · Pull-up × 5',
    );
    expect(recordNotice('Bench', answer({ actualLoad: 100, actualLoadUnit: 'Pound' }))).toBe(
      'New personal record · Bench 100 lb × 5',
    );
  });
});

describe('buzzSet', () => {
  it('buzzes 25 ms for a tick and the record pattern for a record, where the phone can', () => {
    const vibrate = vi.fn();
    buzzSet(false, { vibrate } as unknown as Navigator);
    buzzSet(true, { vibrate } as unknown as Navigator);
    expect(vibrate.mock.calls).toEqual([[25], [[80, 40, 80]]]);
    expect(() => buzzSet(true, {} as Navigator)).not.toThrow();
  });
});

describe('playSetMoment', () => {
  const host = document.createElement('div');
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));

  function page(record: boolean): void {
    host.innerHTML = `
      <div class="segments"><span><b></b></span><span><b></b></span></div>
      <section class="set-card done" data-set-id="s2">
        <span class="done-tick">✓</span>${record ? '<strong class="pr-badge">PR</strong>' : ''}
      </section>`;
    document.body.append(host);
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
  }

  afterEach(() => {
    host.remove();
    animate.mockClear();
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  const motion = (allowed: boolean) => ({ allowed: vi.fn(() => allowed) }) as unknown as Motion;

  it('does nothing where motion is not allowed: the template already drew the final state', () => {
    page(true);
    const allowed = motion(false);
    playSetMoment(
      host,
      { setId: 's2', exerciseName: 'Back squat', record: 'first', segment: null },
      allowed,
    );
    expect(allowed.allowed).toHaveBeenCalledWith(SET_MOMENT);
    expect(animate).not.toHaveBeenCalled();
    expect(host.querySelector('.set-burst')).toBeNull();
  });

  it('springs the row and draws the tick on a plain tick, leaving the segment to its own transition (W9)', () => {
    page(false);
    playSetMoment(
      host,
      {
        setId: 's2',
        exerciseName: 'Back squat',
        record: 'none',
        segment: { index: 0, from: 100 / 3, to: 200 / 3 },
      },
      motion(true),
    );
    expect(animate).toHaveBeenCalledTimes(2);
    const [row, tick] = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][][];
    expect(row[0][0]).toEqual({ transform: 'scale(0.96)' });
    expect(tick[0][0]).toEqual({ transform: 'scale(0.4) rotate(-30deg)' });
    expect(host.querySelector('.set-burst')).toBeNull();
  });

  it('pops the chip and bursts sixteen dots from it on the first record, eight on a later one', async () => {
    page(true);
    playSetMoment(
      host,
      { setId: 's2', exerciseName: 'Back squat', record: 'first', segment: null },
      motion(true),
    );
    const layer = host.querySelector('.set-burst');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(layer?.children).toHaveLength(BURST_DOTS.first);
    expect(animate).toHaveBeenCalledTimes(2 + 1 + BURST_DOTS.first);
    // The layer leaves once every dot has finished.
    await vi.waitFor(() => expect(host.querySelector('.set-burst')).toBeNull());

    animate.mockClear();
    playSetMoment(
      host,
      { setId: 's2', exerciseName: 'Back squat', record: 'again', segment: null },
      motion(true),
    );
    expect(host.querySelector('.set-burst')?.children).toHaveLength(BURST_DOTS.again);
  });
});
