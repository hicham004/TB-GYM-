import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ProgressView } from './progress-view';
import type { ProgressViewModel } from './progress.models';

const progress: ProgressViewModel = {
  clientProfileId: 'client-1',
  timeZoneId: 'Asia/Beirut',
  weekStartsOn: 'Monday',
  displayUnit: 'Kilogram',
  from: '2026-06-29',
  toExclusive: '2026-07-02',
  days: [
    {
      date: '2026-06-29',
      observation: {
        id: 'observation-1',
        measurementDate: '2026-06-29',
        valueKilograms: 80,
        enteredValue: 80,
        enteredUnit: 'Kilogram',
        source: 'Client',
        recordedByUserId: 'user-1',
        recordedAtUtc: '2026-06-29T08:00:00Z',
        status: 'Active',
        version: 1,
      },
      displayValue: 80,
      trendEstimate: null,
      trendSampleCount: 1,
    },
    {
      date: '2026-06-30',
      observation: null,
      displayValue: null,
      trendEstimate: null,
      trendSampleCount: null,
    },
    {
      date: '2026-07-01',
      observation: null,
      displayValue: null,
      trendEstimate: null,
      trendSampleCount: null,
    },
  ],
  weeks: [
    {
      weekStart: '2026-06-29',
      weekEndExclusive: '2026-07-06',
      meanKilograms: 80,
      displayMean: 80,
      observedDayCount: 1,
    },
  ],
  trend: {
    isEstimate: true,
    availability: 'NotEnoughData',
    methodKey: 'BodyweightTrendEwma',
    methodVersion: '2.0',
    timeConstantDays: 10,
    warmupDays: 7,
    minimumSampleCount: 3,
    sampleCount: 1,
    windowStart: '2026-06-29',
    windowEndExclusive: '2026-07-02',
    latestEstimateKilograms: null,
    latestDisplayEstimate: null,
  },
};

async function renderProgress(): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [ProgressView],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getMyProgress: vi.fn(() => of(progress)),
          getMyBodyMeasurements: vi.fn(() => of(null)),
          getMyProgressPhotos: vi.fn(() => of(null)),
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProgressView);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ProgressView day list dates', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders each day as a readable weekday and date', async () => {
    const element = await renderProgress();

    const days = [...element.querySelectorAll('.day-list article time')].map((time) => ({
      datetime: time.getAttribute('datetime'),
      text: time.textContent?.trim(),
    }));

    // `date: 'EEE, mediumDate' : 'UTC'` produced "Sun, 0e28iu0DPMte" under Asia/Beirut: the named
    // alias was read as pattern characters, and the 'UTC' argument moved the day back one.
    // The rendered weekday and date must agree with the `datetime` attribute in every time zone.
    expect(days).toEqual([
      { datetime: '2026-06-29', text: 'Mon, Jun 29, 2026' },
      { datetime: '2026-06-30', text: 'Tue, Jun 30, 2026' },
      { datetime: '2026-07-01', text: 'Wed, Jul 1, 2026' },
    ]);
  });

  it('never embeds a named date alias inside a custom pattern anywhere on the page', async () => {
    const element = await renderProgress();

    // Any surviving alias-in-pattern shows up as lowercase pattern noise in the rendered text.
    for (const time of element.querySelectorAll('time')) {
      expect(time.textContent).not.toMatch(/iu0DPMte/);
    }
  });

  it('dates the weekly card and the trend window on the days they actually cover', async () => {
    const element = await renderProgress();

    // These carried ': "UTC"' on a bare calendar date, which renders local midnight in UTC and so
    // moves the day back one for every zone east of UTC.
    expect(element.querySelector('.week-grid article span')?.textContent?.trim()).toBe(
      'Jun 29, 2026',
    );
    expect(element.querySelector('.trend-summary small')?.textContent).toContain(
      'Window Jun 29, 2026 to Jul 2, 2026',
    );
  });
});
