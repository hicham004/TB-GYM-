import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fill, press, settle } from '../../../testing/dom';
import { ProgramSetsEditor } from './program-sets-editor';
import {
  emptyExercise,
  emptySet,
  toTrainingSessionRequest,
  emptySession,
} from './training-builder.models';

async function render(count = 2) {
  const exercise = emptyExercise('squat', true, 'Back squat');
  exercise.sets = Array.from({ length: count }, () => ({
    ...emptySet(),
    loadStrategy: 'PercentageWorkingMax' as const,
    loadValue: 75,
    exertionTarget: 7,
    manualLoadOverride: 80,
    restSeconds: 180,
    tempo: '3-1-1',
    coachNotes: 'Brace',
  }));
  const fixture = TestBed.createComponent(ProgramSetsEditor);
  fixture.componentRef.setInput('exercise', exercise);
  const edited = vi.fn();
  fixture.componentInstance.edited.subscribe(edited);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, exercise, edited };
}

describe('the shared program set editor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('edits one set, keeps the others and copies all prescription details into a new set', async () => {
    const { fixture, host, exercise, edited } = await render();
    fill(host, 'Reps from', '3');
    fill(host, 'Reps to', '6');
    fill(host, '% of training max', '82.5');
    await settle(fixture);
    expect(exercise.sets[0]).toMatchObject({
      repetitionsMinimum: 3,
      repetitionsMaximum: 6,
      loadValue: 82.5,
    });
    expect(exercise.sets[1].loadValue).toBe(75);
    press(host, 'Add a set like the last');
    await settle(fixture);
    expect(exercise.sets).toHaveLength(3);
    expect(exercise.sets[2]).toMatchObject({
      loadValue: 75,
      manualLoadOverride: 80,
      restSeconds: 180,
      tempo: '3-1-1',
      coachNotes: 'Brace',
    });
    expect(exercise.sets[2].key).not.toBe(exercise.sets[1].key);
    expect(edited).toHaveBeenCalledTimes(4);
  });

  it('changes effort display without changing canonical effort and selects units without converting the load', async () => {
    const { fixture, host, exercise } = await render();
    press(host, 'Effort: RPE');
    await settle(fixture);
    press(host, 'RIR');
    await settle(fixture);
    expect(exercise.sets[0].exertionTarget).toBe(3);
    press(host, 'Unit: kg');
    await settle(fixture);
    press(host, 'lb');
    await settle(fixture);
    expect(exercise.sets[0]).toMatchObject({
      loadUnit: 'Pound',
      loadValue: 75,
      manualLoadOverride: 80,
    });
    const session = emptySession(0);
    session.exercises = [exercise];
    expect(toTrainingSessionRequest(session).exercises[0].sets[0]).toMatchObject({
      targetRpe: null,
      targetRir: 3,
      exertionDisplayPreference: 'Rir',
      loadUnit: 'Pound',
      manualLoadOverride: 80,
    });
    expect(host.querySelector('select')).toBeNull();
  });

  it('keeps at least one set and never adds past the server’s limit', async () => {
    const { fixture, host, exercise } = await render(20);
    expect(press.bind(null, host, 'Add a set like the last')).toThrow('disabled');
    const remove = () => host.querySelector<HTMLButtonElement>('button[aria-label^="Remove set"]')!;
    while (exercise.sets.length > 1) {
      remove().click();
      await settle(fixture);
    }
    expect(remove().disabled).toBe(true);
    expect(exercise.sets).toHaveLength(1);
  });

  it('keeps invalid effort visible with an explanation instead of normalizing the coach’s input', async () => {
    const { fixture, host, exercise } = await render();
    fill(host, 'RPE target', '11');
    host.querySelector('.set-fields')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle(fixture);
    expect(exercise.sets[0].exertionTarget).toBe(11);
    expect(host.querySelector('.tb-field__support--error')?.textContent).toContain(
      'RPE must be between 5 and 10',
    );
  });

  it('edits a published fixed override as its actual load and opens hidden errors for correction', async () => {
    const { fixture, host, exercise } = await render();
    exercise.sets[0].loadStrategy = 'Direct';
    fixture.componentRef.setInput('revision', 1);
    await settle(fixture);
    fill(host, 'Load (kg)', '85');
    await settle(fixture);
    expect(exercise.sets[0]).toMatchObject({ loadValue: 85, manualLoadOverride: 85 });

    const invalid = exercise.sets[1];
    invalid.manualLoadOverride = -1;
    fixture.componentInstance.focus(invalid.key);
    await settle(fixture);
    expect((document.activeElement as HTMLInputElement).value).toBe('-1');
    expect(host.querySelector<HTMLDetailsElement>('.more')?.open).toBe(true);
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
  });
});
