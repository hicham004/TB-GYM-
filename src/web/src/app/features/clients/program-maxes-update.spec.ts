import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, formSummary, press, query, settle, type } from '../../../testing/dom';
import { ClientProgramApi } from './client-program-api';
import { ProgramMaxesUpdate } from './program-maxes-update';

const entry = (fields: Record<string, unknown>) => ({
  id: 'max-1',
  value: 100,
  unit: 'Kilogram',
  source: 'SavedMax',
  basis: null,
  effectiveFromWeek: 1,
  setOn: '2026-09-14',
  reason: 'Assignment training max.',
  ...fields,
});

const maxes = () => ({
  mesocycleId: 'block-lean',
  version: 4,
  loadUnit: 'Kilogram',
  isClosed: false,
  maxes: [
    {
      exerciseId: 'squat',
      exerciseName: 'Back squat',
      current: entry({}),
      weekOneSet: { repetitions: 5, rpe: 8, load: 80 },
      earlier: [],
      suggestion: null,
    },
    {
      exerciseId: 'bench',
      exerciseName: 'Bench press',
      current: entry({ id: 'max-2', value: 80 }),
      weekOneSet: null,
      earlier: [],
      suggestion: null,
    },
  ],
});

/** The same lifts, the squat with a max its logged sets suggest: 90 kg for 5 at RPE 8 in week 2. */
const suggesting = () => {
  const view = maxes();
  view.maxes[0].suggestion = {
    value: 110.974,
    unit: 'Kilogram',
    basis: {
      load: 90,
      repetitions: 5,
      rpe: 8,
      methodKey: 'RpeChart',
      methodVersion: '1.0',
      loggedSet: {
        setPerformanceId: 'set-9',
        weekNumber: 2,
        performedOn: '2026-10-13',
        sessionName: 'Lower A',
      },
    },
    explanation: 'Best logged set v1: …',
  } as never;
  return view;
};

const set = (fields: Record<string, unknown>) => ({
  setId: 'set-1',
  weekNumber: 2,
  scheduledDate: '2026-10-12',
  sessionId: 'session-2',
  sessionName: 'Lower A',
  exerciseId: 'squat',
  exerciseName: 'Back squat',
  setPosition: 0,
  repetitions: 5,
  targetRpe: 8,
  percentageWorkingMax: null,
  previousLoad: 80,
  newLoad: 97.5,
  explanation: 'WorkingMaxLoad v2: 120 kg / (1 + (5 reps + 2 in reserve) / 30) = 97.297 kg.',
  ...fields,
});

const preview = (fields: Record<string, unknown> = {}) => ({
  previewHash: 'hash-1',
  loadUnit: 'Kilogram',
  effectiveFromWeek: 2,
  lifts: [
    {
      exerciseId: 'squat',
      exerciseName: 'Back squat',
      previousValue: 100,
      newValue: 120,
      unit: 'Kilogram',
      source: 'Typed',
      basis: null,
      explanation: 'Typed by the coach: 120 kg.',
    },
  ],
  sets: [
    set({}),
    set({ setId: 'set-2', weekNumber: 3, scheduledDate: '2026-10-19', sessionId: 's3' }),
  ],
  changedSetCount: 2,
  unchangedSetCount: 0,
  sessionCount: 2,
  keptSessionCount: 1,
  ...fields,
});

async function render(api: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}) {
  const calls = {
    getTrainingMaxes: vi.fn(() => of(maxes())),
    previewTrainingMaxes: vi.fn(() => of(preview())),
    applyTrainingMaxes: vi.fn(() => of({})),
    ...api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    imports: [ProgramMaxesUpdate],
    providers: [
      { provide: ClientProgramApi, useValue: calls },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const fixture = TestBed.createComponent(ProgramMaxesUpdate);
  fixture.componentRef.setInput('blockId', 'block-lean');
  fixture.componentRef.setInput('blockName', 'Strength Base');
  fixture.componentRef.setInput('firstName', 'Maya');
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api: calls, closed, csrf };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The first number box of the first lift: its new training max. */
const squatMax = 'fieldset:nth-of-type(1) input[type="number"]:nth-of-type(1)';

describe('Update maxes for the coming weeks', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('lists each lift with the max it has now, and asks for nothing until the coach types one', async () => {
    const { host, api } = await render();

    expect(api.getTrainingMaxes).toHaveBeenCalledWith('block-lean');
    expect(Array.from(host.querySelectorAll('legend')).map(textOf)).toEqual([
      'Back squat now 100 kg',
      'Bench press now 80 kg',
    ]);
    // Week 1's weight is offered only where week 1 has a set the chart covers.
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(3);
    expect(textOf(query(host, '.muted.small'))).toBe(
      'Week 1 has no set the RTS chart covers for this lift, so type its max.',
    );
  });

  it('sends nothing while no max has changed, and says so', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Show the new weights');
    await settle(fixture);

    expect(api.previewTrainingMaxes).not.toHaveBeenCalled();
    expect(textOf(formSummary(host))).toBe('Change at least one training max.');
    // No box is wrong, so the summary that says what is missing takes focus.
    expect(document.activeElement).toBe(formSummary(host));
  });

  it('refuses a number that is not above zero, beside the box', async () => {
    const { fixture, host, api } = await render();
    type(host, squatMax, '0');
    await settle(fixture);

    press(host, 'Show the new weights');
    await settle(fixture);

    expect(api.previewTrainingMaxes).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('.tb-field__support--error'))).toBe(
      'Enter a number above 0, up to 2000.',
    );
  });

  it('shows every weight that would change, grouped by week, before anything is saved', async () => {
    const { fixture, host, api } = await render();
    type(host, squatMax, '120');
    await settle(fixture);

    press(host, 'Show the new weights');
    await settle(fixture);

    expect(api.previewTrainingMaxes).toHaveBeenCalledWith('block-lean', {
      mesocycleVersion: 4,
      changes: [{ exerciseId: 'squat', value: 120, weekOneWeight: null, loggedSetId: null }],
    });
    expect(api.applyTrainingMaxes).not.toHaveBeenCalled();
    const section = query<HTMLElement>(host, '.preview');
    expect(textOf(section.querySelector('.lift-move'))).toBe('100 kg to 120 kg');
    expect(textOf(section.querySelector('.strong'))).toBe('2 weights change in 2 sessions.');
    expect(textOf(section)).toContain('The new max applies from week 2.');
    expect(textOf(section)).toContain(
      '1 session has started or is already past, so it keeps its weights.',
    );
    expect(Array.from(section.querySelectorAll('.week-title')).map(textOf)).toEqual([
      'Week 2',
      'Week 3',
    ]);
    expect(textOf(section.querySelector('.sets li'))).toContain('Set 1 · 5 reps · RPE 8');
    expect(textOf(section.querySelector('.sets li .to'))).toBe('97.5 kg');
    expect(textOf(section.querySelector('.sets li .was'))).toBe('was 80 kg');
    expect(textOf(section.querySelector('.sets li .delta'))).toBe('+17.5 kg');
    // The working-out is there for the coach who asks.
    expect(textOf(section.querySelector('.how p'))).toContain('97.297 kg');
  });

  it('updates with the preview’s hash, the version it saw and the reason, then closes', async () => {
    const { fixture, host, api, closed, csrf } = await render();
    type(host, squatMax, '120');
    fill(host, 'Why? (optional)', 'New test result');
    await settle(fixture);
    press(host, 'Show the new weights');
    await settle(fixture);

    press(host, 'Update maxes');
    await settle(fixture);

    const body = api.applyTrainingMaxes.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(body[0]).toBe('block-lean');
    expect(body[1]).toMatchObject({
      mesocycleVersion: 4,
      changes: [{ exerciseId: 'squat', value: 120, weekOneWeight: null, loggedSetId: null }],
      reason: 'New test result',
      previewHash: 'hash-1',
    });
    expect(String(body[1]['idempotencyKey'])).toMatch(/^[0-9a-f-]{36}$/);
    expect(csrf.refresh).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('works a max out from week 1’s weight, and typing one way clears the other', async () => {
    const { fixture, host, api } = await render();
    type(host, squatMax, '120');
    await settle(fixture);
    const weekOne = query<HTMLInputElement>(
      host,
      'fieldset:nth-of-type(1) app-field:nth-of-type(2) input',
    );
    expect(query<HTMLInputElement>(host, squatMax).value).toBe('120');

    type(host, 'fieldset:nth-of-type(1) app-field:nth-of-type(2) input', '115');
    await settle(fixture);
    expect(weekOne.value).toBe('115');
    expect(query<HTMLInputElement>(host, squatMax).value).toBe('');

    press(host, 'Show the new weights');
    await settle(fixture);

    expect(api.previewTrainingMaxes).toHaveBeenCalledWith('block-lean', {
      mesocycleVersion: 4,
      changes: [{ exerciseId: 'squat', value: null, weekOneWeight: 115, loggedSetId: null }],
    });
  });

  it('offers the estimate the logged sets suggest, and sends only the set for the server to work out', async () => {
    const { fixture, host, api } = await render({
      getTrainingMaxes: vi.fn(() => of(suggesting())),
    });
    const box = query<HTMLInputElement>(host, 'fieldset:nth-of-type(1) input[type="checkbox"]');
    expect(box.checked).toBe(false);
    expect(textOf(box.closest('app-checkbox'))).toBe(
      'Use the estimate from logged sets: 110.97 kg',
    );
    expect(textOf(query(host, '#logged-from-squat'))).toBe(
      'From 90 kg for 5 reps at RPE 8 on Tue 13 Oct, week 2.',
    );
    // Only lifts with a suggestion offer it.
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);

    type(host, squatMax, '120');
    await settle(fixture);
    box.click();
    await settle(fixture);
    expect(query<HTMLInputElement>(host, squatMax).value).toBe('');

    press(host, 'Show the new weights');
    await settle(fixture);
    expect(api.previewTrainingMaxes).toHaveBeenCalledWith('block-lean', {
      mesocycleVersion: 4,
      changes: [{ exerciseId: 'squat', value: null, weekOneWeight: null, loggedSetId: 'set-9' }],
    });
  });

  it('opened from a lift’s suggestion, starts on its new weights already worked out', async () => {
    const { fixture, host, api } = await render(
      { getTrainingMaxes: vi.fn(() => of(suggesting())) },
      { suggested: 'squat' },
    );

    expect(api.previewTrainingMaxes).toHaveBeenCalledTimes(1);
    expect(api.previewTrainingMaxes).toHaveBeenCalledWith('block-lean', {
      mesocycleVersion: 4,
      changes: [{ exerciseId: 'squat', value: null, weekOneWeight: null, loggedSetId: 'set-9' }],
    });
    expect(host.querySelector('.preview')).not.toBeNull();
    expect(api.applyTrainingMaxes).not.toHaveBeenCalled();

    // Going back shows the choice it was worked out from; typing a number instead unticks it.
    press(host, 'Change the numbers');
    await settle(fixture);
    const box = query<HTMLInputElement>(host, 'fieldset:nth-of-type(1) input[type="checkbox"]');
    expect(box.checked).toBe(true);
    type(host, squatMax, '115');
    await settle(fixture);
    expect(box.checked).toBe(false);
  });

  it('forgets a preview as soon as the coach goes back to change a number', async () => {
    const { fixture, host } = await render();
    type(host, squatMax, '120');
    await settle(fixture);
    press(host, 'Show the new weights');
    await settle(fixture);
    expect(host.querySelector('.preview')).not.toBeNull();

    press(host, 'Change the numbers');
    await settle(fixture);

    expect(host.querySelector('.preview')).toBeNull();
    // What was typed is still there to change.
    expect(query<HTMLInputElement>(host, squatMax).value).toBe('120');
  });

  it('says the new weights changed since they were looked at, and a retry saves once', async () => {
    const stale = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'training_maxes_preview_changed',
        message:
          'The new weights no longer match the ones you reviewed. Preview them again before applying.',
      },
    });
    const apply = vi
      .fn()
      .mockReturnValueOnce(throwError(() => stale))
      .mockReturnValue(of({}));
    const { fixture, host, closed } = await render({ applyTrainingMaxes: apply });
    type(host, squatMax, '120');
    await settle(fixture);
    press(host, 'Show the new weights');
    await settle(fixture);

    press(host, 'Update maxes');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(
      'The new weights changed since you looked at them. Show them again, then update.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(closed).not.toHaveBeenCalled();

    press(host, 'Update maxes');
    await settle(fixture);

    // The same request goes out under the same key, so the server answers a retry with the first result.
    const keys = apply.mock.calls.map(
      (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('brings in the estimate of a set logged during the review, keeps the choice and says why', async () => {
    // Week 3's 95 kg for 5 at RPE 8 arrives while the coach looks at week 2's estimate.
    const newer = () => {
      const view = suggesting();
      view.version = 5;
      view.maxes[0].suggestion = {
        value: 117.139,
        unit: 'Kilogram',
        explanation: 'Best logged set v1: …',
        basis: {
          load: 95,
          repetitions: 5,
          rpe: 8,
          methodKey: 'RpeChart',
          methodVersion: '1.0',
          loggedSet: {
            setPerformanceId: 'set-10',
            weekNumber: 3,
            performedOn: '2026-10-20',
            sessionName: 'Lower A',
          },
        },
      } as never;
      return view;
    };
    const read = vi.fn().mockReturnValueOnce(of(suggesting())).mockReturnValue(of(newer()));
    const moved = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'training_max_suggestion_changed',
        message: 'Back squat has a newer logged set than the one you looked at.',
      },
    });
    const { fixture, host, api, closed } = await render(
      { getTrainingMaxes: read, applyTrainingMaxes: vi.fn(() => throwError(() => moved)) },
      { suggested: 'squat' },
    );

    press(host, 'Update maxes');
    await settle(fixture);

    expect(closed).not.toHaveBeenCalled();
    expect(textOf(formSummary(host))).toBe(
      'Maya logged a newer set since you looked, so the suggested max changed. Look at the new suggestion, then try again.',
    );
    // The sheet is back on the numbers, still on the logged sets' estimate, now week 3's.
    expect(host.querySelector('.preview')).toBeNull();
    const box = query<HTMLInputElement>(host, 'fieldset:nth-of-type(1) input[type="checkbox"]');
    expect(box.checked).toBe(true);
    expect(textOf(host.querySelector('#logged-from-squat'))).toContain('95 kg for 5 reps');

    press(host, 'Show the new weights');
    await settle(fixture);
    expect(api.previewTrainingMaxes).toHaveBeenLastCalledWith('block-lean', {
      mesocycleVersion: 5,
      changes: [{ exerciseId: 'squat', value: null, weekOneWeight: null, loggedSetId: 'set-10' }],
    });
  });

  it('says the program moved on when its version is no longer the one the coach opened', async () => {
    const moved = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'training_maxes_conflict',
        message: 'The program changed after this update was prepared.',
      },
    });
    const { fixture, host } = await render({
      previewTrainingMaxes: vi.fn(() => throwError(() => moved)),
    });
    type(host, squatMax, '120');
    await settle(fixture);

    press(host, 'Show the new weights');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(
      'This program changed since you opened this. Close it and open it again to see the latest, then try again.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(host.querySelector('.preview')).toBeNull();
  });

  it('says when the maxes could not be read, and reads them again on request', async () => {
    let fail = true;
    const { fixture, host, api } = await render({
      getTrainingMaxes: vi.fn(() =>
        fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(maxes()),
      ),
    });
    expect(textOf(query(host, '[role="alert"]'))).toBe('The training maxes could not be loaded.');

    fail = false;
    press(host, 'Try again');
    await settle(fixture);

    expect(api.getTrainingMaxes).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('legend')).toHaveLength(2);
  });
});
