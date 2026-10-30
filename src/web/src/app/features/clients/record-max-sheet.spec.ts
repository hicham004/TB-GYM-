import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maxView, SQUAT, BENCH, TODAY, library } from '../../../testing/client-strength-fixtures';
import { fill, formSummary, press, settle, tick } from '../../../testing/dom';
import { ApiClient } from '../../core/api/api-client';
import type { OneRepMaxEstimateView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ClientStrengthApi } from './client-strength-api';
import type { ExerciseChoice } from './exercise-picker';
import { RecordMax } from './record-max-sheet';

const SUGGESTED: ExerciseChoice[] = [
  { id: BENCH, name: 'Bench Press' },
  { id: SQUAT, name: 'Back Squat' },
];

interface Api {
  recordStrengthMax?: ReturnType<typeof vi.fn>;
  searchExercises?: ReturnType<typeof vi.fn>;
  estimateOneRepMax?: ReturnType<typeof vi.fn>;
  recordMaxFromSet?: ReturnType<typeof vi.fn>;
}

async function render(inputs: Record<string, unknown> = {}, api: Api = {}, tenant = signal('t-1')) {
  const { estimateOneRepMax, recordMaxFromSet, ...core } = api;
  await TestBed.configureTestingModule({
    imports: [RecordMax],
    providers: [
      { provide: ApiClient, useValue: { searchExercises: vi.fn(() => of(library([]))), ...core } },
      {
        provide: ClientStrengthApi,
        useValue: {
          estimateOneRepMax: estimateOneRepMax ?? vi.fn(() => of(epley())),
          recordMaxFromSet: recordMaxFromSet ?? vi.fn(),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(RecordMax);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Rana',
    today: TODAY,
    suggested: SUGGESTED,
    ...inputs,
  })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, tenant };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function chooseLift(host: ParentNode, id: string) {
  host.querySelector<HTMLInputElement>(`input[name^="tb-exercise"][value="${id}"]`)!.click();
}

function chooseKind(host: ParentNode, kind: string) {
  host.querySelector<HTMLInputElement>(`input[name="kind"][value="${kind}"]`)!.click();
}

/** What the server's calculator answers for 100 kg × 5 (Epley v1, and TrainingMaxShare v1 at 90%). */
function epley(overrides: Partial<OneRepMaxEstimateView> = {}): OneRepMaxEstimateView {
  return {
    estimate: 116.667,
    unit: 'Kilogram',
    methodKey: 'Epley',
    methodVersion: '1.0',
    qualification: 'Population-level estimate only.',
    explanation: 'Epley v1: 100 kg × (1 + 5 / 30) = 116.667 kg.',
    trainingMax: {
      value: 105,
      percent: 90,
      methodKey: 'TrainingMaxShare',
      methodVersion: '1.0',
      explanation: 'TrainingMaxShare v1: 90% of 116.667 kg = 105 kg.',
    },
    ...overrides,
  };
}

/** The pause after typing before the sheet asks the server, and a little more. */
const typingPause = () => new Promise((resolve) => setTimeout(resolve, 350));

/** The estimate and the training max set from it, as the server answers a set it recorded. */
function savedFromSet() {
  return {
    estimate: maxView({
      id: 'est-1',
      kind: 'EstimatedOneRepMax',
      value: 116.667,
      effectiveDate: TODAY,
      source: 'Calculation',
      methodKey: 'Epley',
      program: null,
      basis: { load: 100, repetitions: 5 },
    }),
    trainingMax: maxView({
      id: 'tm-1',
      kind: 'CoachWorkingMax',
      value: 105,
      effectiveDate: TODAY,
      source: 'Calculation',
      methodKey: 'TrainingMaxShare',
      program: null,
      fromEstimate: { estimateId: 'est-1', estimate: 116.667, percent: 90 },
    }),
  };
}

/** A set of 100 kg × 5 for Back Squat, typed into the sheet, and the pause before the server is asked. */
async function typeSet(fixture: ComponentFixture<RecordMax>, host: HTMLElement, reps = '5') {
  chooseLift(host, SQUAT);
  chooseKind(host, 'FromSet');
  await settle(fixture);
  fill(host, 'Weight', '100');
  fill(host, 'Reps', reps);
  await settle(fixture);
  await typingPause();
  await settle(fixture);
}

describe('Record a max', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers a training max, a tested one and a set they did, and never a typed estimate', async () => {
    const { host } = await render();

    const kinds = Array.from(host.querySelectorAll('input[name="kind"]')).map(
      (item) => (item as HTMLInputElement).value,
    );
    expect(kinds).toEqual(['CoachWorkingMax', 'TestedOneRepMax', 'FromSet']);
    expect(textOf(host)).toContain(
      'Training max The number a program’s percentages use; 5/3/1-style programs set it at 85 to 90% of the best single, others use the single itself.',
    );
    expect(textOf(host)).toContain(
      'Tested 1RM The heaviest single they actually lifted, on that day.',
    );
    expect(textOf(host)).toContain(
      'From a set they did Its weight × reps, up to 10 reps; their 1RM is worked out from it.',
    );
    expect(textOf(host)).not.toContain('Estimated');
    expect(host.querySelector<HTMLInputElement>('input[name="kind"]:checked')!.value).toBe(
      'CoachWorkingMax',
    );
    // Reps and the estimate belong to a set alone.
    expect(host.querySelector('input[name="repetitions"]')).toBeNull();
    expect(host.querySelector('[data-estimate]')).toBeNull();
  });

  it('records a training max for the lift, the day and the unit chosen, and hands back what was saved', async () => {
    const recordStrengthMax = vi.fn(() =>
      of(
        maxView({
          id: 'new',
          value: 100,
          effectiveDate: TODAY,
          kind: 'CoachWorkingMax',
          program: null,
        }),
      ),
    );
    const { fixture, host } = await render({}, { recordStrengthMax });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    chooseLift(host, SQUAT);
    fill(host, 'Weight', '100');
    await settle(fixture);
    press(host, 'Record max');
    await settle(fixture);

    expect(recordStrengthMax).toHaveBeenCalledWith('client-1', {
      exerciseId: SQUAT,
      kind: 'CoachWorkingMax',
      value: 100,
      unit: 'Kilogram',
      effectiveDate: TODAY,
      source: 'Manual',
      methodKey: null,
      methodVersion: null,
      sourceWorkoutExecutionId: null,
      note: null,
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 'new', value: 100, exerciseName: 'Back Squat' }),
    ]);
  });

  it('records a tested max in pounds with a note', async () => {
    const recordStrengthMax = vi.fn(() => of(maxView()));
    const { fixture, host } = await render({}, { recordStrengthMax });

    chooseLift(host, BENCH);
    host.querySelector<HTMLInputElement>('input[name="kind"][value="TestedOneRepMax"]')!.click();
    host.querySelector<HTMLInputElement>('input[type="radio"][value="Pound"]')!.click();
    fill(host, 'Weight', '135');
    fill(host, 'Note (optional)', 'Tested after the deload.');
    await settle(fixture);
    press(host, 'Record max');
    await settle(fixture);

    expect(recordStrengthMax).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({
        exerciseId: BENCH,
        kind: 'TestedOneRepMax',
        value: 135,
        unit: 'Pound',
        note: 'Tested after the deload.',
      }),
    );
  });

  it('starts on the lift it was opened from, in the unit that lift is kept in', async () => {
    const { host } = await render({
      start: { id: SQUAT, name: 'Back Squat' },
      startUnit: 'Pound',
    });

    expect(
      host.querySelector<HTMLInputElement>(`input[name^="tb-exercise"][value="${SQUAT}"]`)!.checked,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[type="radio"][value="Pound"]')!.checked,
    ).toBe(true);
    expect(textOf(host)).toContain('For Back Squat.');
  });

  it('says what is missing in words and sends nothing', async () => {
    const recordStrengthMax = vi.fn();
    const { fixture, host } = await render({}, { recordStrengthMax });

    press(host, 'Record max');
    await settle(fixture);

    expect(textOf(host)).toContain('Choose the exercise.');
    expect(textOf(host)).toContain('Enter the weight.');
    expect(textOf(host)).toContain('Check what is marked above.');
    expect(recordStrengthMax).not.toHaveBeenCalled();
  });

  it('tells the limit in the unit chosen', async () => {
    const { fixture, host } = await render();

    fill(host, 'Weight', '2500');
    host.querySelector<HTMLInputElement>('input[name="value"]')!.dispatchEvent(new Event('blur'));
    await settle(fixture);
    expect(textOf(host)).toContain('A max has to be more than 0 and at most 2,000 kg.');
    host.querySelector<HTMLInputElement>('input[type="radio"][value="Pound"]')!.click();
    await settle(fixture);
    expect(textOf(host)).toContain('A max has to be more than 0 and at most 2,000 lb.');
  });

  it('keeps what was typed and says why when the server refuses', async () => {
    const recordStrengthMax = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    const { fixture, host } = await render({}, { recordStrengthMax });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    expect(textOf(formSummary(host))).toBe('');
    chooseLift(host, SQUAT);
    fill(host, 'Weight', '100');
    await settle(fixture);
    press(host, 'Record max');
    await settle(fixture);

    expect(textOf(formSummary(host))).toContain('no longer in your library');
    expect(document.activeElement).toBe(formSummary(host));
    expect(host.querySelector<HTMLInputElement>('input[name="value"]')!.value).toBe('100');
    expect(closed).not.toHaveBeenCalled();
  });

  it('tells the page it holds typed work, and stops when it is emptied', async () => {
    const { fixture, host } = await render();
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    fill(host, 'Weight', '100');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(true);
    fill(host, 'Weight', '');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('drops the answer when the workspace changes while it is saved', async () => {
    const answer = new Subject<ReturnType<typeof maxView>>();
    const { fixture, host, tenant } = await render({}, { recordStrengthMax: vi.fn(() => answer) });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    chooseLift(host, SQUAT);
    fill(host, 'Weight', '100');
    await settle(fixture);
    press(host, 'Record max');
    await settle(fixture);
    tenant.set('t-2');
    answer.next(maxView());
    answer.complete();
    await settle(fixture);

    expect(closed).not.toHaveBeenCalled();
  });

  it('from a set they did, shows the server’s estimate and the training max at 90%, and records both', async () => {
    const estimateOneRepMax = vi.fn(() => of(epley()));
    const recordMaxFromSet = vi.fn(() => of(savedFromSet()));
    const recordStrengthMax = vi.fn();
    const { fixture, host } = await render(
      {},
      { estimateOneRepMax, recordMaxFromSet, recordStrengthMax },
    );
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    await typeSet(fixture, host);

    expect(estimateOneRepMax).toHaveBeenCalledTimes(1);
    expect(estimateOneRepMax).toHaveBeenCalledWith({
      load: 100,
      repetitions: 5,
      unit: 'Kilogram',
      methodKey: 'Epley',
    });
    const estimate = host.querySelector('[data-estimate]')!;
    expect(textOf(estimate.querySelector('.about p'))).toBe('Estimated 1RM 116.67 kg');
    expect(textOf(estimate.querySelector('[data-explanation]'))).toBe(
      'Epley v1: 100 kg × (1 + 5 / 30) = 116.667 kg.',
    );
    // Ticked from the start, and its figure is the server's.
    const box = host.querySelector<HTMLInputElement>('input[name="also-training-max"]')!;
    expect(box.checked).toBe(true);
    expect(textOf(host.querySelector('[data-training-max]'))).toBe(
      'Training max 105 kg · 90% of the estimate',
    );
    expect(box.getAttribute('aria-describedby')).toBe(
      host.querySelector('[data-training-max]')!.id,
    );
    expect(textOf(host)).toContain('Day they did it');
    expect(textOf(host)).toContain('The weight of the set, for Back Squat.');

    press(host, 'Record max');
    await settle(fixture);

    expect(recordMaxFromSet).toHaveBeenCalledWith('client-1', {
      exerciseId: SQUAT,
      load: 100,
      repetitions: 5,
      unit: 'Kilogram',
      effectiveDate: TODAY,
      alsoSetTrainingMax: true,
      note: null,
    });
    expect(recordStrengthMax).not.toHaveBeenCalled();
    const [entries] = closed.mock.calls[0];
    expect(
      entries.map((entry: { id: string; kind: string; value: number }) => [
        entry.id,
        entry.kind,
        entry.value,
      ]),
    ).toEqual([
      ['est-1', 'EstimatedOneRepMax', 116.667],
      ['tm-1', 'CoachWorkingMax', 105],
    ]);
    expect(entries[1].derivedFrom).toBe('est-1');
  });

  it('unticked, records the estimate alone and shows no training max', async () => {
    const recordMaxFromSet = vi.fn(() =>
      of({ estimate: savedFromSet().estimate, trainingMax: null }),
    );
    const { fixture, host } = await render({}, { recordMaxFromSet });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    await typeSet(fixture, host);
    tick(host, 'Also set their training max at 90%', false);
    await settle(fixture);
    expect(host.querySelector('[data-training-max]')).toBeNull();
    expect(
      host.querySelector('input[name="also-training-max"]')!.getAttribute('aria-describedby'),
    ).toBeNull();

    press(host, 'Record max');
    await settle(fixture);

    expect(recordMaxFromSet).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ alsoSetTrainingMax: false }),
    );
    expect(closed.mock.calls[0][0]).toHaveLength(1);
  });

  it('takes 1 to 10 reps and asks the server nothing until the set can make an estimate', async () => {
    const estimateOneRepMax = vi.fn(() => of(epley()));
    const recordMaxFromSet = vi.fn();
    const { fixture, host } = await render({}, { estimateOneRepMax, recordMaxFromSet });

    chooseLift(host, SQUAT);
    chooseKind(host, 'FromSet');
    await settle(fixture);
    fill(host, 'Weight', '100');
    await settle(fixture);
    await typingPause();
    await settle(fixture);
    expect(textOf(host.querySelector('[data-estimate] .about'))).toBe(
      'Their estimated 1RM shows here once the weight and the reps are in.',
    );

    fill(host, 'Reps', '11');
    host
      .querySelector<HTMLInputElement>('input[name="repetitions"]')!
      .dispatchEvent(new Event('blur'));
    await settle(fixture);
    await typingPause();
    await settle(fixture);
    expect(textOf(host)).toContain(
      'From 1 to 10 reps: past 10, an estimate from reps is too rough to use.',
    );
    fill(host, 'Reps', '2.5');
    await settle(fixture);
    await typingPause();
    expect(estimateOneRepMax).not.toHaveBeenCalled();

    press(host, 'Record max');
    await settle(fixture);
    expect(recordMaxFromSet).not.toHaveBeenCalled();
    expect(textOf(formSummary(host))).toContain('Check what is marked above.');
  });

  it('never shows an old estimate for numbers that changed since it was asked', async () => {
    const first = new Subject<OneRepMaxEstimateView>();
    const estimateOneRepMax = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(
        of(
          epley({
            estimate: 113.333,
            explanation: 'Epley v1: 100 kg × (1 + 4 / 30) = 113.333 kg.',
          }),
        ),
      );
    const { fixture, host } = await render({}, { estimateOneRepMax });

    await typeSet(fixture, host);
    expect(textOf(host.querySelector('[data-estimate] .about'))).toBe(
      'Working out their estimated 1RM…',
    );
    fill(host, 'Reps', '4');
    await settle(fixture);
    // The answer for 5 reps lands after the reps changed: it is dropped.
    first.next(epley());
    first.complete();
    await settle(fixture);
    expect(textOf(host)).not.toContain('116.67');
    await typingPause();
    await settle(fixture);
    expect(estimateOneRepMax).toHaveBeenCalledTimes(2);
    expect(textOf(host.querySelector('[data-estimate-value]'))).toBe('113.33 kg');
  });

  it('says why the server would not work a set out, and keeps the set typed', async () => {
    const estimateOneRepMax = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { errors: { estimate: ['Load must be greater than zero and at most 2,000.'] } },
          }),
      ),
    );
    const { fixture, host } = await render({}, { estimateOneRepMax });

    await typeSet(fixture, host);

    expect(textOf(host.querySelector('[data-estimate-error]'))).toBe(
      'A max has to be more than 0 and at most 2,000.',
    );
    expect(host.querySelector<HTMLInputElement>('input[name="value"]')!.value).toBe('100');
  });

  it('keeps a refused set on screen with the server’s words', async () => {
    const recordMaxFromSet = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              errors: {
                effectiveDate: ['A max from a set is for today or a day that has passed.'],
              },
            },
          }),
      ),
    );
    const { fixture, host } = await render({}, { recordMaxFromSet });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    await typeSet(fixture, host);
    press(host, 'Record max');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(
      'A max from a set is for today or a day that has passed.',
    );
    expect(host.querySelector<HTMLInputElement>('input[name="repetitions"]')!.value).toBe('5');
    expect(closed).not.toHaveBeenCalled();
  });

  it('counts reps typed as work that closing would lose', async () => {
    const { fixture, host } = await render();
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    chooseKind(host, 'FromSet');
    await settle(fixture);
    fill(host, 'Reps', '5');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(true);
  });

  it('closes without a max when the coach says not now', async () => {
    const { fixture, host } = await render();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});
