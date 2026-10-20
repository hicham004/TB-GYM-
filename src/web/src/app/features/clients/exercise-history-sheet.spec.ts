import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  library,
  performance,
  SQUAT,
  squatHistory,
  TODAY,
} from '../../../testing/client-strength-fixtures';
import { press, settle } from '../../../testing/dom';
import { ApiClient } from '../../core/api/api-client';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ExerciseHistory } from './exercise-history-sheet';
import type { ExerciseChoice } from './exercise-picker';

const SQUAT_CHOICE: ExerciseChoice = { id: SQUAT, name: 'Back Squat' };

interface Api {
  getExerciseHistory?: ReturnType<typeof vi.fn>;
}

async function render(inputs: Record<string, unknown> = {}, api: Api = {}) {
  await TestBed.configureTestingModule({
    imports: [ExerciseHistory],
    providers: [
      {
        provide: ApiClient,
        useValue: { searchExercises: vi.fn(() => of(library([]))), ...api },
      },
      { provide: TenantStore, useValue: { selectedTenantId: signal('t-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ExerciseHistory);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Rana',
    today: TODAY,
    locale: 'en-US',
    suggested: [SQUAT_CHOICE],
    start: SQUAT_CHOICE,
    ...inputs,
  })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('How a client has done on an exercise', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads the first page of sets for the lift it was opened on', async () => {
    const getExerciseHistory = vi.fn(() => of(squatHistory()));
    const { host } = await render({}, { getExerciseHistory });

    expect(getExerciseHistory).toHaveBeenCalledWith('client-1', SQUAT, 0, 50);
    expect(textOf(host.querySelector('.lift'))).toBe('Back Squat');
  });

  it('shows the best estimated max, a chart of the estimates, and every set newest first', async () => {
    const { host } = await render({}, { getExerciseHistory: vi.fn(() => of(squatHistory())) });

    expect(textOf(host.querySelector('[data-best]'))).toBe('Best estimated max 70 kg Thu 8 Oct');
    expect(host.querySelector('app-sparkline')).not.toBeNull();
    expect(textOf(host.querySelector('app-sparkline'))).toContain('Estimated max of Back Squat');
    const rows = Array.from(host.querySelectorAll('[data-performance]')).map((item) =>
      textOf(item),
    );
    expect(rows).toEqual([
      'Thu 8 Oct 60 kg × 5 RPE 8 Estimated max 70 kg by Epley Volume 300 kg Felt fast.',
      'Sun 4 Oct 57.5 kg × 5 RPE 8 Estimated max 67.1 kg by Epley Volume 287.5 kg',
      'Tue 29 Sep 55 kg × 6 RPE 8 Estimated max 65.5 kg by Epley Volume 330 kg Substituted',
      'Thu 24 Sep 8 reps RIR 2',
    ]);
  });

  /** The same set reads the same max here as on the Training maxes panel (TRAIN-4). */
  it('names the formula behind each estimate, and says which sets each reads', async () => {
    const history = {
      total: 2,
      skip: 0,
      take: 50,
      items: [
        performance('2026-10-08', 62.5, 7, 80.749, { rpe: 8.5, estimateMethodKey: 'RpeChart' }),
        performance('2026-10-04', 50, 5, 58.333, { rpe: null }),
      ],
    };
    const { host } = await render({}, { getExerciseHistory: vi.fn(() => of(history)) });

    expect(
      Array.from(host.querySelectorAll('[data-estimate]')).map((item) => textOf(item)),
    ).toEqual(['Estimated max 80.75 kg by the RTS chart', 'Estimated max 58.33 kg by Epley']);
    expect(textOf(host.querySelector('[data-how]'))).toBe(
      'A set with an RPE is read on the RTS chart, as the Training maxes panel reads it. A set without one is read by Epley.',
    );
  });

  it('puts the rows newest first even when the server sent them oldest first', async () => {
    const reversed = { ...squatHistory(), items: [...squatHistory().items].reverse() };
    const { host } = await render({}, { getExerciseHistory: vi.fn(() => of(reversed)) });

    expect(textOf(host.querySelector('[data-performance] .when'))).toBe('Thu 8 Oct');
  });

  it('draws no chart from fewer than two estimates, and says so for a lift never done', async () => {
    const one = { total: 1, skip: 0, take: 50, items: [performance('2026-10-08', 60, 5, 70)] };
    const single = await render({}, { getExerciseHistory: vi.fn(() => of(one)) });
    expect(single.host.querySelector('app-sparkline')).toBeNull();
    TestBed.resetTestingModule();

    const none = await render(
      {},
      { getExerciseHistory: vi.fn(() => of({ total: 0, skip: 0, take: 50, items: [] })) },
    );
    expect(textOf(none.host.querySelector('[data-empty]'))).toBe(
      'Rana has no completed set of Back Squat yet.',
    );
  });

  it('reads the next page when asked, and stops offering more at the end', async () => {
    const all = squatHistory().items;
    const getExerciseHistory = vi
      .fn()
      .mockReturnValueOnce(of({ total: 4, skip: 0, take: 50, items: all.slice(0, 2) }))
      .mockReturnValueOnce(of({ total: 4, skip: 2, take: 50, items: all.slice(2) }));
    const { fixture, host } = await render({}, { getExerciseHistory });

    expect(host.querySelectorAll('[data-performance]')).toHaveLength(2);
    press(host, 'Show more');
    await settle(fixture);

    expect(getExerciseHistory).toHaveBeenLastCalledWith('client-1', SQUAT, 2, 50);
    expect(host.querySelectorAll('[data-performance]')).toHaveLength(4);
    expect(host.querySelector('[data-more]')).toBeNull();
  });

  it('says it could not be read, and reads again when asked', async () => {
    const getExerciseHistory = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(squatHistory()));
    const { fixture, host } = await render({}, { getExerciseHistory });

    expect(textOf(host.querySelector('[data-error]'))).toContain('Their sets could not be read.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelector('[data-error]')).toBeNull();
    expect(host.querySelectorAll('[data-performance]')).toHaveLength(4);
  });

  it('opens on a choice of lifts when it has none, and reads the one chosen', async () => {
    const getExerciseHistory = vi.fn(() => of(squatHistory()));
    const { fixture, host } = await render({ start: null }, { getExerciseHistory });

    expect(getExerciseHistory).not.toHaveBeenCalled();
    expect(host.querySelector('app-exercise-picker')).not.toBeNull();
    host.querySelector<HTMLInputElement>(`input[type="radio"][value="${SQUAT}"]`)!.click();
    await settle(fixture);

    expect(getExerciseHistory).toHaveBeenCalledWith('client-1', SQUAT, 0, 50);
    expect(host.querySelector('app-exercise-picker')).toBeNull();
  });

  it('goes back to the choice of lifts without closing', async () => {
    const { fixture, host } = await render(
      {},
      { getExerciseHistory: vi.fn(() => of(squatHistory())) },
    );

    press(host, 'Choose another exercise');
    await settle(fixture);
    expect(host.querySelector('app-exercise-picker')).not.toBeNull();
    expect(host.querySelector('[data-performance]')).toBeNull();
  });

  it('closes when the coach says so', async () => {
    const { fixture, host } = await render(
      {},
      { getExerciseHistory: vi.fn(() => of(squatHistory())) },
    );
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Close');
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
