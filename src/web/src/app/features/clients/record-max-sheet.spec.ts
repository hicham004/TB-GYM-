import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maxView, SQUAT, BENCH, TODAY, library } from '../../../testing/client-strength-fixtures';
import { fill, press, settle } from '../../../testing/dom';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import type { ExerciseChoice } from './exercise-picker';
import { RecordMax } from './record-max-sheet';

const SUGGESTED: ExerciseChoice[] = [
  { id: BENCH, name: 'Bench Press' },
  { id: SQUAT, name: 'Back Squat' },
];

interface Api {
  recordStrengthMax?: ReturnType<typeof vi.fn>;
  searchExercises?: ReturnType<typeof vi.fn>;
}

async function render(inputs: Record<string, unknown> = {}, api: Api = {}, tenant = signal('t-1')) {
  await TestBed.configureTestingModule({
    imports: [RecordMax],
    providers: [
      { provide: ApiClient, useValue: { searchExercises: vi.fn(() => of(library([]))), ...api } },
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

describe('Record a max', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers a training max and a tested one, and never an estimate', async () => {
    const { host } = await render();

    const kinds = Array.from(host.querySelectorAll('input[name="kind"]')).map(
      (item) => (item as HTMLInputElement).value,
    );
    expect(kinds).toEqual(['CoachWorkingMax', 'TestedOneRepMax']);
    expect(textOf(host)).toContain('The number a program works its percentages from.');
    expect(textOf(host)).not.toContain('Estimated');
    expect(host.querySelector<HTMLInputElement>('input[name="kind"]:checked')!.value).toBe(
      'CoachWorkingMax',
    );
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
    expect(closed.mock.calls[0][0]).toMatchObject({
      id: 'new',
      value: 100,
      exerciseName: 'Back Squat',
    });
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

    chooseLift(host, SQUAT);
    fill(host, 'Weight', '100');
    await settle(fixture);
    press(host, 'Record max');
    await settle(fixture);

    expect(textOf(host.querySelector('.refusal'))).toContain('no longer in your library');
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

  it('closes without a max when the coach says not now', async () => {
    const { fixture, host } = await render();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});
