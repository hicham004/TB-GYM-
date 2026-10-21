import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, formSummary, press, settle } from '../../../testing/dom';
import {
  measurement,
  measurementHistory,
  measurementsView,
  mayaMeasurements,
  TODAY,
} from '../../../testing/progress-fixtures';
import { CorrectMeasurement, LogMeasurements, MeasurementChanges } from './measurement-sheets';
import { ProgressEntriesApi } from './progress-entries-api';
import { measurementDays, type Audience } from './progress-entries.models';

const client: Audience = { coach: false, firstName: null, locale: 'en' };

type Api = Partial<Record<keyof ProgressEntriesApi, ReturnType<typeof vi.fn>>>;

async function render<T>(component: Type<T>, inputs: Record<string, unknown>, api: Api = {}) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [
      { provide: ProgressEntriesApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries({ audience: client, today: TODAY, ...inputs })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function choose(host: ParentNode, words: string) {
  const label = Array.from(host.querySelectorAll('label')).find(
    (candidate) => textOf(candidate) === words,
  );
  const radio = label?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`No choice reads "${words}".`);
  radio.click();
}

const refusal = (status: number, code: string, title = 'Refused') =>
  new HttpErrorResponse({ status, error: { code, title } });

const row = (type: 'Waist' | 'BodyFatPercentage' = 'Waist', date = '2026-10-03') => {
  const days = measurementDays(measurementsView(mayaMeasurements()), client);
  return days.find((day) => day.date === date)!.rows.find((item) => item.type === type)!;
};

describe('Log measurements', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('has a box for each line and says what the tape shows', async () => {
    const { host } = await render(LogMeasurements, {});

    const labels = Array.from(host.querySelectorAll('app-field label')).map(textOf);
    expect(labels).toEqual([
      'Waist (cm)',
      'Chest (cm)',
      'Hips (cm)',
      'Thigh (cm)',
      'Arm (cm)',
      'Body fat (%)',
    ]);
  });

  it('saves only the lines with a number, for today, and tells the page', async () => {
    const recordMeasurement = vi.fn(() => of(measurement()));
    const { fixture, host } = await render(LogMeasurements, {}, { recordMeasurement });
    const closed = vi.fn();
    const changed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.changed.subscribe(changed);

    fill(host, 'Waist (cm)', '82');
    fill(host, 'Hips (cm)', '96');
    fill(host, 'Body fat (%)', '22.5');
    await settle(fixture);
    press(host, 'Save measurements');
    await settle(fixture);

    expect(recordMeasurement.mock.calls).toEqual([
      [null, { measurementType: 'Waist', value: 82, unit: 'Centimetre', measurementDate: null }],
      [null, { measurementType: 'Hips', value: 96, unit: 'Centimetre', measurementDate: null }],
      [
        null,
        {
          measurementType: 'BodyFatPercentage',
          value: 22.5,
          unit: 'Percent',
          measurementDate: null,
        },
      ],
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(3);
  });

  it('sends inches when the tape shows inches, and body fat is still a percent', async () => {
    const recordMeasurement = vi.fn<
      (client: string | null, request: { measurementType: string; unit: string }) => unknown
    >(() => of(measurement()));
    const { fixture, host } = await render(LogMeasurements, {}, { recordMeasurement });

    choose(host, 'in');
    await settle(fixture);
    expect(Array.from(host.querySelectorAll('app-field label')).map(textOf)[0]).toBe('Waist (in)');
    expect(Array.from(host.querySelectorAll('app-field label')).map(textOf)[5]).toBe(
      'Body fat (%)',
    );
    fill(host, 'Waist (in)', '32.5');
    fill(host, 'Body fat (%)', '20');
    await settle(fixture);
    press(host, 'Save measurements');
    await settle(fixture);

    expect(
      recordMeasurement.mock.calls.map(([, request]) => [request.measurementType, request.unit]),
    ).toEqual([
      ['Waist', 'Inch'],
      ['BodyFatPercentage', 'Percent'],
    ]);
  });

  it('begins on the tape the page shows', async () => {
    const { host } = await render(LogMeasurements, { startUnit: 'Inch' });

    expect(textOf(host.querySelector('app-field label'))).toBe('Waist (in)');
  });

  it('asks for a number somewhere, and says which one cannot be right, before sending', async () => {
    const recordMeasurement = vi.fn(() => of(measurement()));
    const { fixture, host } = await render(LogMeasurements, {}, { recordMeasurement });

    expect(textOf(formSummary(host))).toBe('');
    press(host, 'Save measurements');
    await settle(fixture);
    // Nothing is marked wrong, so the summary that asks for a number takes focus itself.
    expect(textOf(formSummary(host))).toBe('Enter at least one measurement.');
    expect(document.activeElement).toBe(formSummary(host));

    fill(host, 'Waist (cm)', '5');
    fill(host, 'Body fat (%)', '90');
    await settle(fixture);
    press(host, 'Save measurements');
    await settle(fixture);
    expect(textOf(host)).toContain('Waist has to be between 10 and 300 cm.');
    expect(textOf(host)).toContain('Body fat has to be between 1 and 75 %.');
    expect(recordMeasurement).not.toHaveBeenCalled();
  });

  it('keeps a refused line marked with its reason while the others are saved, and tries only it again', async () => {
    const recordMeasurement = vi
      .fn()
      .mockReturnValueOnce(of(measurement()))
      .mockReturnValueOnce(
        throwError(() => refusal(409, 'BodyMeasurementDateAndTypeAlreadyExists')),
      )
      .mockReturnValue(of(measurement()));
    const { fixture, host } = await render(LogMeasurements, {}, { recordMeasurement });
    const closed = vi.fn();
    const changed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.changed.subscribe(changed);

    fill(host, 'Waist (cm)', '82');
    fill(host, 'Hips (cm)', '96');
    await settle(fixture);
    press(host, 'Save measurements');
    await settle(fixture);

    expect(closed).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(textOf(formSummary(host))).toBe(
      'Some measurements were saved. The ones marked above were not.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(textOf(host)).toContain(
      'Hips is already recorded for Sat 10 Oct. Correct that one instead.',
    );
    const waist = host.querySelector<HTMLInputElement>('input[name="Waist"]')!;
    expect(waist.disabled).toBe(true);
    expect(textOf(host)).toContain('Saved');

    // Pressing Save again sends the line that is still to do, not the one that is saved.
    press(host, 'Save measurements');
    await settle(fixture);
    expect(recordMeasurement).toHaveBeenCalledTimes(3);
    expect(recordMeasurement.mock.calls[2][1]).toMatchObject({
      measurementType: 'Hips',
      value: 96,
    });
    expect(closed).toHaveBeenCalledWith(2);
  });

  it('records for a client when a coach is logging', async () => {
    const recordMeasurement = vi.fn(() => of(measurement()));
    const { fixture, host } = await render(
      LogMeasurements,
      { clientId: 'client-9', audience: { coach: true, firstName: 'Maya', locale: 'en' } },
      { recordMeasurement },
    );

    fill(host, 'Arm (cm)', '34');
    await settle(fixture);
    press(host, 'Save measurements');
    await settle(fixture);
    expect(recordMeasurement).toHaveBeenCalledWith(
      'client-9',
      expect.objectContaining({ measurementType: 'Arm', value: 34 }),
    );
  });

  it('holds typed work until it is saved, and closes with nothing saved on Not now', async () => {
    const { fixture, host } = await render(LogMeasurements, {}, {});
    const dirty = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Chest (cm)', '101');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(true);
    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(0);
  });
});

describe('Correct measurement', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts from the number that was typed, in the unit it was typed in', async () => {
    const { host } = await render(CorrectMeasurement, { row: row('Waist', '2026-09-05') });

    expect(textOf(host.querySelector('.about'))).toBe(
      'Waist: 83.5 cm Sat 5 Sep · Added by your coach',
    );
    expect(host.querySelector<HTMLInputElement>('input[name="value"]')!.value).toBe('32.9');
    expect(host.querySelector<HTMLInputElement>('input[type="radio"][value="Inch"]')!.checked).toBe(
      true,
    );
  });

  it('sends the new number, the reason and the version it was shown', async () => {
    const correctMeasurement = vi.fn(() => of(measurementHistory()));
    const { fixture, host } = await render(
      CorrectMeasurement,
      { row: row() },
      { correctMeasurement },
    );
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    fill(host, 'Correct measurement', '81');
    choose(host, 'Measured in the wrong place');
    await settle(fixture);
    press(host, 'Save correction');
    await settle(fixture);

    expect(correctMeasurement).toHaveBeenCalledWith(null, 'Waist-2026-10-03', {
      value: 81,
      unit: 'Centimetre',
      reason: 'Measured in the wrong place',
      version: 1,
    });
    expect(closed).toHaveBeenCalledWith(measurementHistory());
  });

  it('shows body fat as a percent with no tape to choose', async () => {
    const { host } = await render(CorrectMeasurement, { row: row('BodyFatPercentage') });

    expect(host.querySelector('.value-unit input[type="radio"]')).toBeNull();
    expect(textOf(host.querySelector('.value-unit'))).toBe('%');
  });

  it('refuses an empty box, the same number and a missing reason, without asking the server', async () => {
    const correctMeasurement = vi.fn(() => of(measurementHistory()));
    const { fixture, host } = await render(
      CorrectMeasurement,
      { row: row() },
      { correctMeasurement },
    );

    press(host, 'Save correction');
    await settle(fixture);
    expect(textOf(host)).toContain('That is the number already saved. Change it, or close this.');
    expect(textOf(host)).toContain('Choose what was wrong.');

    fill(host, 'Correct measurement', '');
    await settle(fixture);
    expect(textOf(host)).toContain('Enter a measurement.');
    expect(correctMeasurement).not.toHaveBeenCalled();
  });
});

describe('Changes to a measurement', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists what the number was before each correction, why, and when', async () => {
    const measurementHistoryRead = vi.fn(() => of(measurementHistory()));
    const { host } = await render(
      MeasurementChanges,
      { row: row() },
      { measurementHistory: measurementHistoryRead },
    );

    expect(measurementHistoryRead).toHaveBeenCalledWith(null, 'Waist-2026-10-03');
    const item = host.querySelector('.changes li')!;
    expect(textOf(item.querySelector('strong'))).toBe('85 cm');
    expect(textOf(item)).toContain('Measured in the wrong place');
  });

  it('says so when the number was never corrected', async () => {
    const { host } = await render(
      MeasurementChanges,
      { row: row() },
      { measurementHistory: vi.fn(() => of({ ...measurementHistory(), previousValues: [] })) },
    );

    expect(textOf(host)).toContain('has not been corrected');
  });
});
