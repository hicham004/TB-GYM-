import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settle, tick } from '../../../testing/dom';
import { ProgramSessionEditor } from './program-session-editor';
import { emptyExercise, emptySession } from './training-builder.models';

const MAIN_LIFT = 'Main lift: always done as written';

async function render() {
  const session = emptySession(0);
  const exercise = emptyExercise('squat', false, 'Back squat');
  // A second set whose rest the coach typed: it is theirs, so the switch leaves it.
  exercise.sets.push({ ...exercise.sets[0], key: 'own-rest', restSeconds: 120 });
  session.exercises.push(exercise);
  const fixture = TestBed.createComponent(ProgramSessionEditor);
  fixture.componentRef.setInput('session', session);
  fixture.componentRef.setInput('weekNumber', 1);
  const edited = vi.fn();
  fixture.componentInstance.edited.subscribe(edited);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  // The page bumps the revision on every edit so the sheet redraws in place; do the same here.
  let revision = 0;
  const redraw = async () => {
    fixture.componentRef.setInput('revision', ++revision);
    await settle(fixture);
  };
  // The sheet shows the details of the set being edited, the first one here.
  const restBox = () =>
    host.querySelector<HTMLInputElement>('input[type="number"][max="3600"]')?.value;
  return { fixture, host, exercise, edited, redraw, restBox };
}

describe('the program session editor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('moves a rest still on 1:30 to 3:00 when the exercise becomes a main lift, and back (C1)', async () => {
    const { host, exercise, edited, redraw, restBox } = await render();
    expect(restBox()).toBe('90');

    tick(host, MAIN_LIFT);
    await redraw();
    expect(exercise.isMainLift).toBe(true);
    expect(exercise.sets.map((set) => set.restSeconds)).toEqual([180, 120]);
    expect(restBox()).toBe('180');
    expect(edited).toHaveBeenCalledTimes(1);

    tick(host, MAIN_LIFT, false);
    await redraw();
    expect(exercise.sets.map((set) => set.restSeconds)).toEqual([90, 120]);
    expect(restBox()).toBe('90');
  });

  it('leaves an empty rest empty: the coach cleared it, so there is no rest and no timer', async () => {
    const { host, exercise, redraw } = await render();
    exercise.sets[0].restSeconds = null;

    tick(host, MAIN_LIFT);
    await redraw();
    expect(exercise.sets.map((set) => set.restSeconds)).toEqual([null, 120]);
  });
});
