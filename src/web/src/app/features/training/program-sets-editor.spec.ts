import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  button,
  field,
  fill,
  leave,
  menuChoices,
  press,
  query,
  settle,
  toggleFold,
} from '../../../testing/dom';
import { setIssue } from './program-builder.models';
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
    fill(host, 'Reps', '3-6');
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
    expect(edited).toHaveBeenCalledTimes(3);
  });

  it('takes the reps in one box, as one number or a range, and writes them back the usual way', async () => {
    const { fixture, host, exercise } = await render();
    const reps = field(host, 'Reps');
    expect(reps.value).toBe('5');
    fill(host, 'Reps', '10');
    await settle(fixture);
    expect(exercise.sets[0]).toMatchObject({ repetitionsMinimum: 10, repetitionsMaximum: 10 });
    for (const typed of ['8-12', '8 – 12', '8 to 12']) {
      fill(host, 'Reps', typed);
      leave(host, 'Reps');
      await settle(fixture);
      expect(exercise.sets[0]).toMatchObject({ repetitionsMinimum: 8, repetitionsMaximum: 12 });
      expect(reps.value).toBe('8–12');
    }
    expect(exercise.sets[1]).toMatchObject({ repetitionsMinimum: 5, repetitionsMaximum: 5 });
  });

  it('reads an older set with only a highest number as “up to” and leaves it as it was', async () => {
    const { fixture, host, exercise } = await render();
    exercise.sets[0].repetitionsMinimum = null;
    exercise.sets[0].repetitionsMaximum = 10;
    fixture.componentRef.setInput('revision', 1);
    await settle(fixture);
    expect(field(host, 'Reps').value).toBe('up to 10');
    expect(host.querySelector('.set-summary')?.textContent).toContain('up to 10');
    leave(host, 'Reps');
    await settle(fixture);
    expect(exercise.sets[0]).toMatchObject({ repetitionsMinimum: null, repetitionsMaximum: 10 });
  });

  it('keeps reps it cannot read in the box with a reason, and holds the set back from a save', async () => {
    const { fixture, host, exercise } = await render();
    fill(host, 'Reps', '8 or 9');
    leave(host, 'Reps');
    host.querySelector('.set-fields')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle(fixture);
    expect(field(host, 'Reps').value).toBe('8 or 9');
    expect(field(host, 'Reps').getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('.tb-field__support--error')?.textContent).toContain(
      'type the reps as one number, like 10, or a range, like 8-12.',
    );
    expect(setIssue(exercise.sets[0])?.field).toBe('repetitionsMinimum');
    fill(host, 'Reps', '12-8');
    await settle(fixture);
    expect(host.querySelector('.tb-field__support--error')?.textContent).toContain(
      'the lowest reps can’t be more than the highest.',
    );
    fill(host, 'Reps', '8-9');
    leave(host, 'Reps');
    await settle(fixture);
    expect(setIssue(exercise.sets[0])).toBeNull();
    expect(exercise.sets[0].repetitionsEntry).toBeUndefined();
  });

  it('changes effort display without changing canonical effort and selects units without converting the load', async () => {
    const { fixture, host, exercise } = await render();
    press(host, 'Effort: RPE');
    await settle(fixture);
    // A menu's list is drawn in an overlay of its own, outside the editor.
    press(query(document, '.tb-menu-pane'), 'RIR');
    await settle(fixture);
    expect(exercise.sets[0].exertionTarget).toBe(3);
    press(host, 'Unit: kg');
    await settle(fixture);
    press(query(document, '.tb-menu-pane'), 'lb');
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
    expect(host.querySelector<HTMLDetailsElement>('.more details')?.open).toBe(true);
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
  });

  it('opens Rest, tempo & notes it never drew for a refused rest, with focus on it (critique B2b)', async () => {
    const { fixture, host, exercise } = await render();
    const invalid = exercise.sets[1];
    invalid.restSeconds = 4000;

    // The second set's fields, and its fold's boxes, are not drawn until it is asked for.
    expect(host.querySelector(`[data-set-key="${invalid.key}"] .more`)).toBeNull();
    fixture.componentInstance.focus(invalid.key);
    await settle(fixture);

    const more = query<HTMLDetailsElement>(host, `[data-set-key="${invalid.key}"] .more details`);
    expect(more.open).toBe(true);
    expect(document.activeElement).toBe(field(more, 'Rest (seconds)'));
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
    expect(more.textContent).toContain('rest must be between 0 and 3600 seconds.');
  });
});

describe('a last time + step set in the set editor (N6a)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const errorText = (host: ParentNode) =>
    host.querySelector('.tb-field__support--error')?.textContent?.trim();

  it('offers it as the sixth load, with a step and an optional starting weight in the set’s unit', async () => {
    const { fixture, host, exercise, edited } = await render(1);
    const set = exercise.sets[0];
    // A % set with a fixed load instead, which the step choice must not keep.
    await toggleFold(fixture, host, 'Rest, tempo & notes');
    expect(field(host, 'Fixed load instead').value).toBe('80');
    // In a browser the set is checked by then: opening the menu moved the cursor out of a box.
    host.querySelector('.set-fields')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const menu = button(host, '% of training max');
    menu.click();
    await settle(fixture);
    expect(
      menuChoices(menu).map((item) => item.querySelector('.item-title')?.textContent?.trim()),
    ).toEqual([
      'No prescribed load',
      'Direct load',
      '% of training max',
      'RPE · RTS chart',
      'RPE · Epley curve',
      'Last time + step',
    ]);
    press(query(document, '.tb-menu-pane'), 'Last time + step');
    await settle(fixture);

    // The 75 was a share of the max: it never becomes a 75 kg start.
    expect(set).toMatchObject({
      loadStrategy: 'LastTimeStep',
      manualLoadOverride: null,
      loadValue: null,
    });
    expect(edited).toHaveBeenCalled();
    expect(() => field(host, 'Fixed load instead')).toThrow('No field is labelled');
    expect(() => field(host, 'Load (kg)')).toThrow('No field is labelled');
    // The cursor is in the step, the box to fill next, which says its sentence rather than a refusal.
    expect(document.activeElement).toBe(field(host, 'Step (kg)'));
    expect(field(host, 'Step (kg)').getAttribute('aria-invalid')).toBeNull();
    expect(errorText(host)).toBeUndefined();
    expect(field(host, 'Starting weight (kg)').value).toBe('');
    const attributes = (box: HTMLInputElement) =>
      ['data-field', 'type', 'min', 'max', 'step', 'inputmode'].map((name) =>
        box.getAttribute(name),
      );
    expect(attributes(field(host, 'Step (kg)'))).toEqual([
      'step',
      'number',
      '0',
      '50',
      '0.25',
      'decimal',
    ]);
    expect(attributes(field(host, 'Starting weight (kg)'))).toEqual([
      'start',
      'number',
      '0',
      '2000',
      '0.25',
      'decimal',
    ]);
    expect(host.textContent).toContain(
      'You add the step each week, after reading the logged sets.',
    );
    expect(host.textContent).toContain('Optional. Without one, the client picks the weight.');

    fill(host, 'Step (kg)', '2');
    fill(host, 'Starting weight (kg)', '5');
    await settle(fixture);
    expect(set).toMatchObject({ loadStep: 2, loadValue: 5 });
    expect(host.querySelector('.set-summary')?.textContent?.trim()).toBe(
      'Working · 5 · last time + 2 kg · start 5 kg · RPE 7',
    );
    const session = emptySession(0);
    session.exercises = [exercise];
    expect(toTrainingSessionRequest(session).exercises[0].sets[0]).toMatchObject({
      loadStrategy: 'LastTimeStep',
      directLoad: 5,
      loadUnit: 'Kilogram',
      percentageWorkingMax: null,
      loadStep: 2,
      manualLoadOverride: null,
    });

    // Pounds relabel both boxes and convert nothing.
    press(host, 'Unit: kg');
    await settle(fixture);
    press(query(document, '.tb-menu-pane'), 'lb');
    await settle(fixture);
    expect([field(host, 'Step (lb)').value, field(host, 'Starting weight (lb)').value]).toEqual([
      '2',
      '5',
    ]);
    expect(set).toMatchObject({ loadUnit: 'Pound', loadStep: 2, loadValue: 5 });
    expect(host.querySelector('.set-summary')?.textContent?.trim()).toBe(
      'Working · 5 · last time + 2 lb · start 5 lb · RPE 7',
    );
  });

  it('keeps a typed weight as the start, and refuses an empty step once the coach leaves it', async () => {
    const { fixture, host, exercise } = await render(1);
    const set = exercise.sets[0];
    Object.assign(set, { loadStrategy: 'Direct', loadValue: 60, manualLoadOverride: null });
    fixture.componentRef.setInput('revision', 1);
    await settle(fixture);

    press(host, 'Direct load');
    await settle(fixture);
    press(query(document, '.tb-menu-pane'), 'Last time + step');
    await settle(fixture);

    expect(set).toMatchObject({ loadStrategy: 'LastTimeStep', loadValue: 60, loadStep: null });
    expect(field(host, 'Starting weight (kg)').value).toBe('60');
    const step = field(host, 'Step (kg)');
    expect(document.activeElement).toBe(step);
    expect(host.textContent).toContain(
      'You add the step each week, after reading the logged sets.',
    );

    // Leaving it empty says what it needs, in place of the sentence.
    host.querySelector('.set-fields')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle(fixture);
    expect(step.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(host)).toBe(
      'a step must be more than 0 and at most 50 kg, with at most two decimals.',
    );
    expect(host.textContent).not.toContain(
      'You add the step each week, after reading the logged sets.',
    );
  });

  it('refuses a step or a start outside the server’s limits under its box, and takes the cursor there', async () => {
    const { fixture, host, exercise } = await render(2);
    const set = exercise.sets[1];
    Object.assign(set, {
      loadStrategy: 'LastTimeStep',
      loadStep: null,
      loadValue: null,
      manualLoadOverride: null,
    });

    // Publish's check opens the set and focuses the refused box.
    fixture.componentInstance.focus(set.key);
    await settle(fixture);
    const step = field(host, 'Step (kg)');
    expect(document.activeElement).toBe(step);
    expect(step.getAttribute('aria-invalid')).toBe('true');
    const refusal = 'a step must be more than 0 and at most 50 kg, with at most two decimals.';
    expect(errorText(host)).toBe(refusal);

    for (const wrong of ['0', '51', '2.555', '']) {
      fill(host, 'Step (kg)', wrong);
      await settle(fixture);
      expect(errorText(host)).toBe(refusal);
    }
    fill(host, 'Step (kg)', '2.5');
    await settle(fixture);
    expect(errorText(host)).toBeUndefined();
    expect(step.getAttribute('aria-invalid')).toBeNull();
    expect(set.loadStep).toBe(2.5);

    fill(host, 'Starting weight (kg)', '2001');
    await settle(fixture);
    expect(field(host, 'Starting weight (kg)').getAttribute('aria-invalid')).toBe('true');
    expect(errorText(host)).toBe(
      'a starting weight must be more than 0 and at most 2000, or left empty.',
    );
    fill(host, 'Starting weight (kg)', '');
    await settle(fixture);
    expect(set.loadValue).toBeNull();
    expect(errorText(host)).toBeUndefined();

    // A step set needs its reps: the Reps box says so.
    fill(host, 'Reps', '');
    await settle(fixture);
    expect(field(host, 'Reps').getAttribute('aria-invalid')).toBe('true');
    expect(errorText(host)).toBe(
      'a last time + step set needs its reps: type one number, like 10, or a range, like 8-12.',
    );
  });
});

describe('a formula’s limit in the set editor (critique B7a)', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function chartSet(reps: number, rpe: number) {
    const rendered = await render(1);
    Object.assign(rendered.exercise.sets[0], {
      loadStrategy: 'RpeChart',
      loadValue: null,
      manualLoadOverride: null,
      repetitionsMinimum: reps,
      repetitionsMaximum: reps,
      exertionTarget: rpe,
    });
    rendered.fixture.componentRef.setInput('revision', 1);
    await settle(rendered.fixture);
    return rendered;
  }

  const refuse = async (host: HTMLElement, fixture: Parameters<typeof settle>[0]) => {
    host.querySelector('.set-fields')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle(fixture);
  };
  const ways = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-ways] button')).map((node) => node.textContent?.trim());

  it('says the chart’s own cell for the set’s reps and effort', async () => {
    const { host } = await chartSet(5, 8);
    expect(host.textContent).toContain('RTS chart: 5 reps at RPE 8 is 81.1% of the training max.');
    expect(host.querySelector('.set-summary')?.textContent).toContain(
      '5 · RPE 8 · 81% of training max',
    );
  });

  it('says the Epley curve’s own number too, and its limit until the set fits (critique B15)', async () => {
    const { fixture, host, exercise } = await chartSet(5, 8);
    exercise.sets[0].loadStrategy = 'RpeBasedEpley';
    fixture.componentRef.setInput('revision', 2);
    await settle(fixture);
    expect(host.textContent).toContain(
      'Epley curve: 5 reps at RPE 8 is 81.1% of the training max.',
    );
    expect(host.querySelector('.set-summary')?.textContent).toContain(
      '5 · RPE 8 · 81% of training max',
    );

    exercise.sets[0].repetitionsMaximum = 11;
    fixture.componentRef.setInput('revision', 3);
    await settle(fixture);
    expect(host.textContent).toContain('Epley curve: reps plus RIR up to 12');
    expect(host.querySelector('.set-summary')?.textContent).toContain(
      'RPE 8 · outside the Epley curve',
    );
  });

  it('offers a way out past 12 reps that keeps a 20-rep set, and puts the cursor where it goes', async () => {
    const { fixture, host, exercise, edited } = await chartSet(20, 8);
    expect(ways(host)).toEqual([]);
    await refuse(host, fixture);
    expect(host.querySelector('.tb-field__support--error')?.textContent).toContain(
      'the formulas stop at 12 reps, so the RTS chart has no weight for 20 reps.',
    );
    expect(ways(host)).toEqual([
      'Use % of training max',
      'Type a weight',
      'Let the client pick the weight',
    ]);

    press(host, 'Use % of training max');
    await settle(fixture);
    expect(exercise.sets[0]).toMatchObject({
      loadStrategy: 'PercentageWorkingMax',
      repetitionsMinimum: 20,
      repetitionsMaximum: 20,
      exertionTarget: 8,
    });
    expect(edited).toHaveBeenCalled();
    // The box that appeared has the cursor, and is not called empty before the coach types in it.
    expect(document.activeElement).toBe(field(host, '% of training max'));
    expect(host.querySelector('.tb-field__support--error')).toBeNull();
    expect(ways(host)).toEqual([]);
  });

  it('offers the Epley curve to a set too far from failure for the chart, while it can take it', async () => {
    const { fixture, host, exercise } = await chartSet(5, 6);
    await refuse(host, fixture);
    expect(host.querySelector('.tb-field__support--error')?.textContent).toContain(
      'four or more reps from failure, its percentages no longer hold.',
    );
    expect(ways(host)).toEqual(['Use the Epley curve for this set', 'Type a weight']);
    press(host, 'Use the Epley curve for this set');
    await settle(fixture);
    expect(exercise.sets[0].loadStrategy).toBe('RpeBasedEpley');
    expect(document.activeElement).toBe(field(host, 'RPE target'));
    expect(setIssue(exercise.sets[0])).toBeNull();
  });

  it('flags a % set the chart says cannot be done, under its line, without refusing it', async () => {
    const { fixture, host, exercise } = await render(2);
    Object.assign(exercise.sets[1], {
      manualLoadOverride: null,
      loadValue: 85,
      repetitionsMinimum: 10,
      repetitionsMaximum: 10,
    });
    fixture.componentRef.setInput('revision', 1);
    await settle(fixture);
    // The second set is closed, and still says so.
    const flagged = Array.from(host.querySelectorAll('[data-impossible]'));
    expect(flagged.map((node) => node.textContent?.trim())).toEqual([
      '85% × 10 reps is heavier than the chart allows for 10 reps (74%). Most lifters can’t do it.',
    ]);
    expect(setIssue(exercise.sets[1])).toBeNull();
  });
});
