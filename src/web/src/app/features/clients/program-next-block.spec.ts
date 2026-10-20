import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { runningBlock } from '../../../testing/client-program-fixtures';
import { field, fill, focusedId, leave, press, query, settle, tick } from '../../../testing/dom';
import {
  chartSet,
  exerciseView,
  leanProgram,
  sessionView,
  setView,
  weekView,
} from '../../../testing/mesocycle-fixtures';
import { blockCard, type ProgramContext } from './client-program.models';
import { ProgramNextBlock } from './program-next-block';

const context: ProgramContext = { locale: 'en-US', today: '2026-10-01', firstName: 'Maya' };

/** Weeks 7 to 9 of the program, each a half point of effort further on than the one before. */
function preview(overrides: Record<string, unknown> = {}) {
  return {
    previewHash: 'hash-1',
    transformKey: 'WeekStep',
    transformVersion: '1.0',
    resultingWeekCount: 9,
    resultingEndDateExclusive: '2026-11-16',
    isInsideTrainingCoverage: true,
    coverageMessage: null,
    overlapMessage: null,
    generatedWeeks: [7, 8, 9].map((weekNumber) =>
      weekView(`new-${weekNumber}`, weekNumber, [
        sessionView(`new-s${weekNumber}`, 'Lower A', [
          exerciseView(`new-squat-${weekNumber}`, 'Back squat', [
            setView({
              position: 1,
              setType: 'WarmUp',
              loadStrategy: 'Direct',
              loadUnit: 'Kilogram',
              directLoad: 60,
              prescribedLoad: 60,
              targetRpe: 6,
            }),
            chartSet(2, {
              prescribedLoad: 60 + weekNumber,
              targetRpe: 7 + (weekNumber - 6) * 0.5,
            }),
          ]),
        ]),
      ]),
    ),
    ...overrides,
  };
}

async function render(api: Record<string, unknown> = {}) {
  const calls = {
    getTrainingMesocycle: vi.fn(() => of(leanProgram())),
    previewTrainingProgression: vi.fn(() => of(preview())),
    applyTrainingProgression: vi.fn(() => of({})),
    ...api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    imports: [ProgramNextBlock],
    providers: [
      { provide: ApiClient, useValue: calls },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(ProgramNextBlock);
  fixture.componentRef.setInput('block', blockCard(runningBlock(), context));
  fixture.componentRef.setInput('firstName', 'Maya');
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** What the form's numbers read, in order: copies, RPE, reps, % of the training max and weight. */
const numbers = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[type="number"]')).map(
    (input) => input.value,
  );

/** The line of help or error under the field captioned `label`. */
function support(host: HTMLElement, label: string): string {
  const found = Array.from(host.querySelectorAll('app-field')).find(
    (item) => textOf(item.querySelector('label')) === label,
  );
  return textOf(found?.querySelector('.tb-field__support'));
}

/** Ticks the weeks by their number: the labels carry dates this spec does not care about. */
function chooseWeeks(host: HTMLElement, weeks: number[]): void {
  const boxes = host.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]');
  for (const week of weeks) {
    boxes[week - 1].checked = true;
    boxes[week - 1].dispatchEvent(new Event('change'));
  }
}

describe('Build next block', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('starts from the last week: three copies, half a point of effort, nothing else moving', async () => {
    const { host } = await render();

    const boxes = Array.from(
      host.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]'),
    );
    expect(boxes).toHaveLength(6);
    expect(boxes.map((box) => box.checked)).toEqual([false, false, false, false, false, true]);
    expect(textOf(Array.from(host.querySelectorAll('fieldset label')).at(-1))).toBe(
      'Week 6 · 19–25 Oct',
    );
    // The builder's four steps, then: copies, RPE, reps, % of the training max and weight.
    expect(numbers(host)).toEqual(['3', '0.5', '0', '0', '0']);
  });

  it('says what each step would move in the chosen weeks, and which formula the weights follow', async () => {
    const { fixture, host } = await render();

    expect(support(host, 'Copies of each week')).toBe('Added after the last week. Up to 12 fit.');
    expect(support(host, 'RPE a week')).toBe('Sets moved: 2. Warm-ups stay as they are.');
    expect(support(host, 'Reps a week')).toBe('Sets moved: 3.');
    expect(support(host, '% of training max a week')).toBe('Sets moved: 1.');
    expect(support(host, 'Weight a week (kg)')).toBe('Sets moved: 1, fixed or typed weights.');
    expect(textOf(host.querySelector('.body > p.small'))).toBe(
      'Weights come from this program’s training maxes. Where a weight follows an RPE, it uses the RTS chart, as it does now.',
    );

    // Choosing another week moves more sets.
    chooseWeeks(host, [5]);
    await settle(fixture);
    expect(support(host, 'RPE a week')).toBe('Sets moved: 4. Warm-ups stay as they are.');
  });

  it('says so when a step would move nothing in the chosen weeks, and names no formula', async () => {
    const typed = leanProgram();
    for (const week of typed.weeks) {
      week.sessions[0].exercises = [
        exerciseView('curl', 'Curl', [
          setView({ position: 1, repetitionsMinimum: null, repetitionsMaximum: null }),
        ]),
      ];
    }
    const { host } = await render({ getTrainingMesocycle: vi.fn(() => of(typed)) });

    expect(support(host, 'RPE a week')).toBe('No set in these weeks has an RPE or RIR.');
    expect(support(host, 'Reps a week')).toBe('No set in these weeks has reps.');
    expect(support(host, '% of training max a week')).toBe(
      'No set in these weeks uses a % of training max.',
    );
    expect(support(host, 'Weight a week (kg)')).toBe('No set in these weeks has a fixed weight.');
    expect(host.querySelector('.body > p.small')).toBeNull();
  });

  it('names the weight unit of a program in pounds', async () => {
    const pounds = leanProgram({ loadUnit: 'Pound' });
    for (const week of pounds.weeks) {
      for (const set of week.sessions[0].exercises.flatMap((exercise) => exercise.sets)) {
        if (set.loadUnit) set.loadUnit = 'Pound';
      }
    }
    const { host } = await render({ getTrainingMesocycle: vi.fn(() => of(pounds)) });

    expect(field(host, 'Weight a week (lb)')).toBeTruthy();
  });

  it('shows the new weeks before anything is added, and sends the version and every step it saw', async () => {
    const { fixture, host, api } = await render();
    fill(host, 'Reps a week', '-1');
    fill(host, '% of training max a week', '2.5');
    fill(host, 'Weight a week (kg)', '5');
    await settle(fixture);

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(api['previewTrainingProgression']).toHaveBeenCalledWith('block-lean', {
      sourceWeekIds: ['block-lean-week6'],
      iterations: 3,
      rpeIncrement: 0.5,
      repetitionsStep: -1,
      percentageStep: 2.5,
      loadStep: 5,
      mesocycleVersion: 4,
    });
    expect(api['applyTrainingProgression']).not.toHaveBeenCalled();
    const section = query<HTMLElement>(host, '.preview');
    expect(textOf(section.querySelector('.preview-line'))).toBe(
      '3 new weeks. The program would end Sun 15 Nov 2026.',
    );
    expect(Array.from(section.querySelectorAll('.preview-title')).map(textOf)).toEqual([
      'Week 7',
      'Week 8',
      'Week 9',
    ]);
    expect(textOf(section.querySelector('li strong'))).toBe('Back squat');
    expect(Array.from(section.querySelector('li')!.querySelectorAll('.set')).map(textOf)).toEqual([
      '5 reps · 60 kg · RPE 6',
      '5 reps · 67 kg · RPE 7.5 , changed',
    ]);
  });

  it('marks the sets that moved, in words as well as weight, and leaves the others alone', async () => {
    const { fixture, host } = await render();
    press(host, 'Preview the new weeks');
    await settle(fixture);

    const sets = Array.from(
      host.querySelectorAll<HTMLElement>('.preview-week')[0].querySelectorAll<HTMLElement>('.set'),
    );
    expect(sets.map((set) => set.classList.contains('changed'))).toEqual([false, true]);
    expect(textOf(sets[1].querySelector('.tb-visually-hidden'))).toBe(', changed');
    expect(sets[0].querySelector('.tb-visually-hidden')).toBeNull();
  });

  it('adds the weeks with the preview’s hash and the same steps, then closes', async () => {
    const { fixture, host, api, closed } = await render();
    fill(host, 'Reps a week', '-1');
    await settle(fixture);
    press(host, 'Preview the new weeks');
    await settle(fixture);

    press(host, 'Add these weeks');
    await settle(fixture);

    expect(api['applyTrainingProgression']).toHaveBeenCalledWith('block-lean', {
      sourceWeekIds: ['block-lean-week6'],
      iterations: 3,
      rpeIncrement: 0.5,
      repetitionsStep: -1,
      percentageStep: 0,
      loadStep: 0,
      previewHash: 'hash-1',
      mesocycleVersion: 4,
    });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('forgets a preview as soon as anything it was built from changes', async () => {
    const { fixture, host } = await render();

    for (const change of [
      () => fill(host, 'Copies of each week', '4'),
      () => fill(host, 'RPE a week', '1'),
      () => fill(host, 'Reps a week', '1'),
      () => fill(host, '% of training max a week', '1'),
      () => fill(host, 'Weight a week (kg)', '1'),
      () => chooseWeeks(host, [5]),
    ]) {
      press(host, 'Preview the new weeks');
      await settle(fixture);
      expect(host.querySelector('.preview')).not.toBeNull();

      change();
      await settle(fixture);
      expect(host.querySelector('.preview')).toBeNull();
    }
  });

  it('shows a field’s message once it is left, and every message after a refused preview', async () => {
    const { fixture, host, api } = await render();

    // Typing alone says nothing; leaving the field does.
    fill(host, 'Reps a week', '21');
    await settle(fixture);
    expect(host.querySelector('.tb-field__support--error')).toBeNull();
    leave(host, 'Reps a week');
    await settle(fixture);
    expect(support(host, 'Reps a week')).toBe('Use a whole number from -20 to 20.');
    expect(field(host, 'Reps a week').getAttribute('aria-invalid')).toBe('true');

    // A refused preview shows the rest, sends nothing and puts the cursor on the first wrong field.
    fill(host, 'Copies of each week', '0');
    fill(host, 'RPE a week', '0.3');
    fill(host, '% of training max a week', '60');
    fill(host, 'Weight a week (kg)', '501');
    await settle(fixture);
    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(api['previewTrainingProgression']).not.toHaveBeenCalled();
    expect(Array.from(host.querySelectorAll('.tb-field__support--error')).map(textOf)).toEqual([
      'Choose 1 to 12 copies.',
      'Use -2 to 2, in steps of 0.5.',
      'Use a whole number from -20 to 20.',
      'Use -50 to 50 points, with at most two decimals.',
      'Use -500 to 500, with at most two decimals.',
    ]);
    expect(focusedId()).toBe(field(host, 'Copies of each week').id);
  });

  it('asks for a week, and puts the cursor on the weeks when there is none', async () => {
    const { fixture, host, api } = await render();
    tick(host, 'Week 6 · 19–25 Oct', false);
    await settle(fixture);
    expect(textOf(host.querySelector('.field-error'))).toBe(
      'Choose at least one week to build on.',
    );

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(api['previewTrainingProgression']).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector('fieldset input'));
  });

  it('leaves room for the 52 weeks a program holds', async () => {
    const { fixture, host } = await render();
    // Six chosen weeks of a six-week program: 46 weeks of room is seven copies of each.
    chooseWeeks(host, [1, 2, 3, 4, 5]);
    await settle(fixture);
    expect(support(host, 'Copies of each week')).toBe('Added after the last week. Up to 7 fit.');

    fill(host, 'Copies of each week', '8');
    leave(host, 'Copies of each week');
    await settle(fixture);

    expect(support(host, 'Copies of each week')).toBe('Choose 1 to 7 copies.');
  });

  it('does not let weeks be added that run past the plan, and says so in coach words', async () => {
    const outside = preview({
      isInsideTrainingCoverage: false,
      coverageMessage: 'The entire mesocycle must remain inside its training entitlement period.',
    });
    const { fixture, host, api } = await render({
      previewTrainingProgression: vi.fn(() => of(outside)),
    });

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.preview .problem-text'))).toBe(
      'These weeks run past the end of Maya’s plan. Choose fewer copies, or renew the plan and assign the next program.',
    );
    const add = Array.from(host.querySelectorAll('button')).find(
      (b) => textOf(b) === 'Add these weeks',
    );
    expect(add?.disabled).toBe(true);
    expect(api['applyTrainingProgression']).not.toHaveBeenCalled();
  });

  it('does not let weeks be added that run into the next program, and names it (BEA-1)', async () => {
    const message =
      'Maya already has Peak from Mon 9 Nov 2026 to Sun 15 Nov 2026, so 1 new week fits before it. Choose fewer copies, or move or cancel that program first.';
    const { fixture, host, api } = await render({
      previewTrainingProgression: vi.fn(() => of(preview({ overlapMessage: message }))),
    });

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.preview [data-overlap]'))).toBe(message);
    expect(host.querySelector('.preview [data-overlap]')?.getAttribute('role')).toBe('alert');
    const add = Array.from(host.querySelectorAll('button')).find(
      (b) => textOf(b) === 'Add these weeks',
    );
    expect(add?.disabled).toBe(true);
    expect(api['applyTrainingProgression']).not.toHaveBeenCalled();
  });

  it('names the program in the way when it is assigned between the preview and adding', async () => {
    const message =
      'Maya already has Peak from Mon 9 Nov 2026 to Sun 15 Nov 2026, right after this program, so no new week fits. Move or cancel that program first.';
    const refused = new HttpErrorResponse({
      status: 409,
      error: { code: 'mesocycle_overlap', message },
    });
    const { fixture, host, closed } = await render({
      applyTrainingProgression: vi.fn(() => throwError(() => refused)),
    });
    press(host, 'Preview the new weeks');
    await settle(fixture);

    press(host, 'Add these weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.body > .problem-text'))).toBe(message);
    expect(closed).not.toHaveBeenCalled();
  });

  it('tells the coach which set a step pushes past its limits, in the server’s words', async () => {
    const message =
      'Week 6, copy 3, Lower A, Back squat, set 2: RPE would be 10.5, and RPE runs from 5 to 10. Use a smaller step or fewer copies.';
    const refused = new HttpErrorResponse({
      status: 400,
      error: { errors: { progression: [message] } },
    });
    const { fixture, host } = await render({
      previewTrainingProgression: vi.fn(() => throwError(() => refused)),
    });

    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.body > .problem-text'))).toBe(message);
    expect(host.querySelector('.preview')).toBeNull();
  });

  it('says a program that moved on since the preview, and a preview that no longer holds, in coach words', async () => {
    for (const [code, message, said] of [
      [
        'progression_conflict',
        'The mesocycle changed after this progression request was prepared.',
        'This program changed since you opened this.',
      ],
      [
        'progression_preview_changed',
        'The progression no longer matches the reviewed preview. Generate a new preview before applying.',
        'The new weeks changed since you looked at them. Preview them again, then add them.',
      ],
    ]) {
      const refused = new HttpErrorResponse({ status: 409, error: { code, message } });
      const { fixture, host, closed } = await render({
        applyTrainingProgression: vi.fn(() => throwError(() => refused)),
      });
      press(host, 'Preview the new weeks');
      await settle(fixture);

      press(host, 'Add these weeks');
      await settle(fixture);

      expect(textOf(host.querySelector('.body > .problem-text'))).toContain(said);
      expect(closed).not.toHaveBeenCalled();
      document.body.innerHTML = '';
      TestBed.resetTestingModule();
    }
  });

  it('says another change got there first, without engine words', async () => {
    const conflict = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'concurrency_conflict',
        message: 'Training data was changed by another request.',
      },
    });
    const { fixture, host, closed } = await render({
      applyTrainingProgression: vi.fn(() => throwError(() => conflict)),
    });
    press(host, 'Preview the new weeks');
    await settle(fixture);

    press(host, 'Add these weeks');
    await settle(fixture);

    expect(textOf(host.querySelector('.body > .problem-text'))).toContain('changed somewhere else');
    expect(closed).not.toHaveBeenCalled();
  });

  it('still previews when the program could not be read, only without what each step moves', async () => {
    const { fixture, host, api } = await render({
      getTrainingMesocycle: vi.fn(() => throwError(() => new Error('offline'))),
    });

    // Only the copies field has help of its own: nothing is known about the sets.
    expect(host.querySelectorAll('.tb-field__support')).toHaveLength(1);
    press(host, 'Preview the new weeks');
    await settle(fixture);

    expect(api['previewTrainingProgression']).toHaveBeenCalled();
    expect(textOf(host.querySelector('.preview-line'))).toContain('3 new weeks');
  });
});
