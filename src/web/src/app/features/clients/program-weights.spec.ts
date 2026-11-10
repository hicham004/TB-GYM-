import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiftStandingView } from '../../core/api/generated';
import { settle } from '../../../testing/dom';
import { liftStanding, standingReason, standingSet } from '../../../testing/lift-weight-fixtures';
import { ProgramWeights } from './program-weights';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

// Two lifts of Maya's: the leg curl steps 15 → 17 kg on Thu, and the leg press keeps last time's 25 kg over a new
// program's 30 kg start (line d, decision 22).
const curl = liftStanding();
const press = liftStanding(
  {
    outcome: 'Hold',
    reason: standingReason({
      kind: 'RepsShort',
      setNumber: 2,
      repetitions: 8,
      repetitionsAsked: 10,
    }),
    lastTime: {
      workoutExecutionId: 'workout-2',
      day: '2026-11-05',
      sets: [
        { ...liftStanding().standing.lastTime!.sets[0], weight: 25 },
        { ...liftStanding().standing.lastTime!.sets[1], weight: 25, repetitions: 8 },
      ],
    },
    sets: [1, 2].map((n) =>
      standingSet(n, { move: 'SameAsLastTime', weight: 25, currentWeight: 30, step: 5 }),
    ),
  },
  {
    exercisePrescriptionId: 'prescription-2',
    exerciseId: 'leg-press',
    exerciseName: 'Leg press',
    sessionName: 'Lower B',
    sessionDate: '2026-11-13',
  },
);

async function render(
  standings: readonly LiftStandingView[],
  apply = vi.fn<(views: readonly LiftStandingView[]) => Promise<void>>(() => Promise.resolve()),
) {
  const fixture = TestBed.createComponent(ProgramWeights);
  fixture.componentRef.setInput('standings', standings);
  fixture.componentRef.setInput('firstName', 'Maya');
  fixture.componentRef.setInput('apply', apply);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, apply };
}

const buttons = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button'));

describe('ProgramWeights (N6c, STR-020)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists each lift with its workout, where it stands and one Apply, and Apply all for several', async () => {
    const { host } = await render([curl, press]);

    expect(textOf(host.querySelector('h2'))).toBe('Weights to apply');
    const lifts = Array.from(host.querySelectorAll('.lift'));
    expect(lifts.map((lift) => textOf(lift.querySelector('.where')))).toEqual([
      'Seated Leg Curl Lower A · Thu 12 Nov',
      'Leg press Lower B · Fri 13 Nov',
    ]);
    expect(lifts.map((lift) => textOf(lift.querySelector('.standing')))).toEqual([
      'Last 15 kg × 10, 10, 10 on Thu · every set done · next time 17 kg',
      'Keep 25 kg · set 2 reached 8 of 10 on Thu',
    ]);
    expect(buttons(host).map(textOf)).toEqual(['Apply all', 'Apply 17 kg', 'Apply 25 kg']);
    expect(buttons(host).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Apply all 2 weights',
      'Apply 17 kg to Seated Leg Curl, Lower A on Thu 12 Nov',
      'Apply 25 kg to Leg press, Lower B on Fri 13 Nov',
    ]);
  });

  it('asks the page to apply one lift, or every lift with Apply all', async () => {
    const { fixture, host, apply } = await render([curl, press]);

    buttons(host)[1].click();
    await settle(fixture);
    expect(apply).toHaveBeenLastCalledWith([curl]);

    buttons(host)[0].click();
    await settle(fixture);
    expect(apply).toHaveBeenLastCalledWith([curl, press]);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('shows no Apply all for one lift', async () => {
    const { host } = await render([curl]);
    expect(buttons(host).map(textOf)).toEqual(['Apply 17 kg']);
  });

  it('stays busy until the page has read the program again, and takes no second press', async () => {
    let finish!: () => void;
    const apply = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { fixture, host } = await render([curl, press], apply);

    buttons(host)[1].click();
    await settle(fixture);
    expect(textOf(buttons(host)[1])).toBe('Applying…');
    expect(buttons(host)[1].getAttribute('aria-disabled')).toBe('true');
    // Neither this lift again nor all of them while the first is on its way.
    buttons(host)[1].click();
    buttons(host)[0].click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledTimes(1);

    finish();
    await settle(fixture);
    expect(textOf(buttons(host)[1])).toBe('Apply 17 kg');
  });
});
