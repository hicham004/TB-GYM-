import { UnsavedWork } from '../../core/forms/unsaved-work';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, press, settle } from '../../../testing/dom';
import { workspace } from '../../../testing/intake-fixtures';
import {
  mayaMeasurements,
  mayaPhotos,
  mayaWeighIns,
  measurementsView,
  NOW,
  observation,
  photo,
  photosView,
  progressView,
  weightHistory,
} from '../../../testing/progress-fixtures';
import { ProgressEntries } from './progress-entries';
import { ProgressEntriesApi } from './progress-entries-api';

type Api = Partial<Record<keyof ProgressEntriesApi, ReturnType<typeof vi.fn>>>;

interface Options {
  api?: Api;
  url?: string;
  clientId?: string;
  clientName?: string;
  weightUnit?: 'Kilogram' | 'Pound';
  tenant?: ReturnType<typeof signal<string>>;
}

async function render(options: Options = {}) {
  const entries: Api = {
    weighIns: vi.fn(() => of(progressView(mayaWeighIns()))),
    weightSpan: vi.fn(() => of({ firstDate: '2026-10-05' })),
    measurements: vi.fn(() => of(measurementsView(mayaMeasurements()))),
    photos: vi.fn(() => of(photosView(mayaPhotos()))),
    thumbnails: vi.fn((ids: string[]) => of(new Map(ids.map((id) => [id, `/thumb/${id}`])))),
    recordWeight: vi.fn(() => of(observation())),
    weightHistory: vi.fn(() => of(weightHistory())),
    ...options.api,
  };
  const api = { getWorkspace: vi.fn(() => of(workspace())) };
  const csrf = { refresh: vi.fn(() => Promise.resolve()) };
  const tenant = options.tenant ?? signal('tenant-1');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'progress', component: ProgressEntries }]),
      { provide: ProgressEntriesApi, useValue: entries },
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: AuthStore, useValue: { weightUnit: signal(options.weightUnit ?? 'Kilogram') } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  });
  let fixture;
  let host: HTMLElement;
  if (options.clientId) {
    fixture = TestBed.createComponent(ProgressEntries);
    fixture.componentRef.setInput('clientId', options.clientId);
    fixture.componentRef.setInput('clientName', options.clientName ?? 'Maya');
    await settle(fixture);
    host = fixture.nativeElement as HTMLElement;
  } else {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(options.url ?? '/progress', ProgressEntries);
    fixture = harness.fixture;
    host = harness.routeNativeElement as HTMLElement;
    await settle(fixture);
  }
  return { fixture, host, entries, api, csrf, tenant, router: TestBed.inject(Router) };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};
const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

function tab(host: ParentNode, name: string): HTMLButtonElement {
  const found = all(host, '[role="tab"]').find((item) => textOf(item) === name);
  if (!found) throw new Error(`No tab reads "${name}".`);
  return found as HTMLButtonElement;
}

describe('Your entries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  it('protects an entry sheet during session exits and unregisters it when its page goes', async () => {
    const { fixture, host } = await render();
    press(host, 'Log weight');
    await settle(fixture);
    fill(dialog()!, 'Weight', '81');
    await settle(fixture);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const leave = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(fixture);
    press(dialog()!, 'Keep editing');
    expect(await leave).toBe(false);
    fixture.destroy();
    expect(await TestBed.inject(UnsavedWork).confirmLeave()).toBe(true);
  });

  describe('the weight tab', () => {
    it('opens on weights: only days with a weigh-in, newest first, with who added each', async () => {
      const { host } = await render();

      expect(textOf(host.querySelector('h1'))).toBe('Your entries');
      expect(host.querySelector('a.back')!.getAttribute('href')).toBe('/progress/dashboard');
      expect(all(host, '[role="tab"]').map(textOf)).toEqual(['Weight', 'Measurements', 'Photos']);
      const rows = all(host, '[data-weighin]');
      expect(rows.map((row) => textOf(row.querySelector('time')))).toEqual([
        'Fri 9 Oct',
        'Thu 8 Oct',
        'Wed 7 Oct',
        'Mon 5 Oct',
      ]);
      expect(rows.map((row) => textOf(row.querySelector('.value')))).toEqual([
        '80.2 kg',
        '79.8 kg',
        '80.1 kg',
        '80.6 kg',
      ]);
      expect(textOf(rows[0].querySelector('.meta'))).toBe('Added by your coach');
      expect(textOf(rows[1].querySelector('.meta'))).toBe('Added by you · Entered as 175.9 lb');
    });

    it('reads the last year in the client’s saved unit, with nothing else asked', async () => {
      const { entries } = await render({ weightUnit: 'Pound' });

      expect(entries['weighIns']).toHaveBeenCalledWith(null, 'Pound', '2025-10-10', '2026-10-11');
      expect(entries['weightSpan']).toHaveBeenCalledWith(null);
      // The other tabs are read when they are opened.
      expect(entries['measurements']).not.toHaveBeenCalled();
      expect(entries['photos']).not.toHaveBeenCalled();
    });

    it('reads the weights again in the other unit when it is changed', async () => {
      const { fixture, host, entries } = await render();

      host.querySelector<HTMLInputElement>('input[type="radio"][value="Pound"]')!.click();
      await settle(fixture);

      expect(entries['weighIns']).toHaveBeenLastCalledWith(
        null,
        'Pound',
        '2025-10-10',
        '2026-10-11',
      );
    });

    it('invites the first weight when there is none', async () => {
      const { host } = await render({
        api: { weighIns: vi.fn(() => of(progressView([]))) },
      });

      expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No weights yet');
      expect(host.querySelector('[data-weighin]')).toBeNull();
    });

    it('says so, with a way to try again, when the weights cannot be read', async () => {
      const weighIns = vi
        .fn()
        .mockReturnValueOnce(throwError(() => new Error('down')))
        .mockReturnValue(of(progressView(mayaWeighIns())));
      const { fixture, host } = await render({ api: { weighIns } });

      expect(textOf(host.querySelector('.load-failed'))).toContain('Weights couldn’t be loaded.');
      press(host, 'Try again');
      await settle(fixture);
      expect(all(host, '[data-weighin]')).toHaveLength(4);
    });

    it('logs a weight in a sheet, thanks the person, and reads the list again', async () => {
      const recordWeight = vi.fn(() => of(observation({ measurementDate: '2026-10-10' })));
      const { fixture, host, entries } = await render({ api: { recordWeight } });

      press(host, 'Log weight');
      await settle(fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Log weight');
      const box = sheet.querySelector<HTMLInputElement>('input[name="value"]')!;
      box.value = '80.4';
      box.dispatchEvent(new Event('input'));
      await settle(fixture);
      press(sheet, 'Save weight');
      await settle(fixture);

      expect(recordWeight).toHaveBeenCalledWith(null, {
        value: 80.4,
        unit: 'Kilogram',
        measurementDate: null,
      });
      expect(dialog()).toBeNull();
      expect(toast()).toContain('Weight logged for today.');
      expect(entries['weighIns']).toHaveBeenCalledTimes(2);
    });

    it('offers each weight a menu to correct it, move it to the right day or see its changes', async () => {
      const { fixture, host } = await render();

      const first = host.querySelector('[data-weighin]')!;
      const more = first.querySelector<HTMLButtonElement>(
        'button[aria-label="More for Fri 9 Oct"]',
      )!;
      // A 44 px button for a thumb, not the 36 px of a coach's dense rows (CLIENT-7).
      expect(more.classList).toContain('trigger-touch');
      more.click();
      await settle(fixture);
      expect(all(first, '[role="menuitem"], .item').map(textOf).join('|')).toContain(
        'Correct the weight',
      );
      expect(textOf(first)).toContain('Wrong day');
      expect(textOf(first)).toContain('See changes');
    });

    it('opens the correction for that weight in a sheet', async () => {
      const { fixture, host } = await render();

      const first = host.querySelector('[data-weighin]')!;
      first.querySelector<HTMLButtonElement>('button[aria-label="More for Fri 9 Oct"]')!.click();
      await settle(fixture);
      const item = all(first, 'button').find((button) =>
        textOf(button).startsWith('Correct the weight'),
      )!;
      item.click();
      await settle(fixture);

      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Correct this weight');
      expect(textOf(sheet.querySelector('.about'))).toBe('80.2 kg Fri 9 Oct · Added by your coach');
    });

    it('reads the year before when asked, until the first weigh-in is reached', async () => {
      const weighIns = vi.fn((_client: string | null, _unit: string, from: string) =>
        of(
          from === '2024-10-09'
            ? progressView([
                observation({
                  measurementDate: '2025-02-01',
                  valueKilograms: 84,
                  enteredValue: 84,
                }),
              ])
            : progressView(mayaWeighIns()),
        ),
      );
      const { fixture, host } = await render({
        api: { weighIns, weightSpan: vi.fn(() => of({ firstDate: '2025-02-01' })) },
      });

      press(host, 'Show earlier weights');
      await settle(fixture);

      expect(weighIns).toHaveBeenLastCalledWith(null, 'Kilogram', '2024-10-09', '2025-10-10');
      expect(all(host, '[data-weighin]')).toHaveLength(5);
      expect(textOf(all(host, '[data-weighin] time').at(-1))).toBe('Sat 1 Feb 2025');
      expect(host.querySelector('[data-earlier-weight]')).toBeNull();
    });

    it('offers the year before once a weight is logged for a day before the years shown', async () => {
      const weightSpan = vi
        .fn()
        .mockReturnValueOnce(of({ firstDate: '2026-10-05' }))
        .mockReturnValue(of({ firstDate: '2025-06-15' }));
      const recordWeight = vi.fn(() => of(observation({ measurementDate: '2025-06-15' })));
      const { fixture, host } = await render({ api: { weightSpan, recordWeight } });
      expect(host.querySelector('[data-earlier-weight]')).toBeNull();

      host.querySelector<HTMLButtonElement>('[data-log-weight]')!.click();
      await settle(fixture);
      const sheet = dialog()!;
      // The calendar is the way to a day; the sheet's own day is set through its model here.
      sheet.querySelector<HTMLButtonElement>('app-date-field button.trigger')!.click();
      await settle(fixture);
      for (let turn = 0; turn < 24; turn++) {
        const target = sheet.querySelector<HTMLButtonElement>('button.day[data-date="2025-06-15"]');
        if (target) {
          target.click();
          break;
        }
        const first = sheet.querySelector<HTMLElement>('button.day')!.dataset['date']!;
        sheet
          .querySelector<HTMLButtonElement>(
            `button[aria-label="${first > '2025-06-15' ? 'Previous month' : 'Next month'}"]`,
          )!
          .click();
        await settle(fixture);
      }
      await settle(fixture);
      const box = sheet.querySelector<HTMLInputElement>('input[name="value"]')!;
      box.value = '84.2';
      box.dispatchEvent(new Event('input'));
      await settle(fixture);
      press(sheet, 'Save weight');
      await settle(fixture);

      expect(toast()).toContain('Weight logged for Sun 15 Jun 2025.');
      expect(host.querySelector('[data-earlier-weight]')).not.toBeNull();
    });

    it('offers no earlier weights when the first weigh-in is inside the year shown', async () => {
      const { host } = await render();

      expect(host.querySelector('[data-earlier-weight]')).toBeNull();
    });
  });

  describe('the other tabs', () => {
    it('reads measurements only when their tab is opened, and shows them by day', async () => {
      const { fixture, host, entries } = await render();

      tab(host, 'Measurements').click();
      await settle(fixture);

      expect(entries['measurements']).toHaveBeenCalledWith(
        null,
        'Centimetre',
        '2025-10-10',
        '2026-10-11',
      );
      const days = all(host, '[data-day]');
      expect(days.map((day) => textOf(day.querySelector('h2')))).toEqual([
        'Saturday 3 October',
        'Saturday 5 September',
      ]);
      expect(all(days[0], '[data-measurement] .when').map(textOf)).toEqual([
        'Waist',
        'Hips',
        'Body fat',
      ]);
      expect(all(days[0], '.value').map(textOf)).toEqual(['82 cm', '96 cm', '22 %']);
    });

    it('lands on a tab named in the address, and reads only that one', async () => {
      const { host, entries } = await render({ url: '/progress?tab=photos' });

      expect(tab(host, 'Photos').getAttribute('aria-selected')).toBe('true');
      expect(entries['photos']).toHaveBeenCalledWith(null, '2025-10-10', '2026-10-11');
      expect(entries['measurements']).not.toHaveBeenCalled();
    });

    it('keeps the tab in the address as it is changed', async () => {
      const { fixture, host, router } = await render();

      tab(host, 'Photos').click();
      await settle(fixture);
      expect(router.url).toBe('/progress?tab=photos');
      tab(host, 'Weight').click();
      await settle(fixture);
      expect(router.url).toBe('/progress');
    });

    it('reads the measurements again on the other tape', async () => {
      const { fixture, host, entries } = await render({ url: '/progress?tab=measurements' });

      host
        .querySelector<HTMLInputElement>('[data-pane="measurements"] input[value="Inch"]')!
        .click();
      await settle(fixture);

      expect(entries['measurements']).toHaveBeenLastCalledWith(
        null,
        'Inch',
        '2025-10-10',
        '2026-10-11',
      );
    });

    it('reaches old measurements across empty years and stops only at the server boundary', async () => {
      const measurements = vi
        .fn()
        .mockReturnValueOnce(of({ ...measurementsView([]), earlierDate: '2022-06-15' }))
        .mockReturnValue(of({ ...measurementsView(mayaMeasurements()), earlierDate: null }));
      const { fixture, host } = await render({
        url: '/progress?tab=measurements',
        api: { measurements },
      });
      // An empty year is not "no measurements yet": the older ones are one press away.
      expect(host.textContent).toContain('No measurements in the last year.');
      expect(host.textContent).not.toContain('No measurements yet');
      expect(host.querySelector('[data-earlier-measurements]')).not.toBeNull();
      press(host, 'Show earlier measurements');
      await settle(fixture);
      expect(measurements).toHaveBeenLastCalledWith(null, 'Centimetre', '2021-06-15', '2022-06-16');
      expect(host.querySelector('[data-earlier-measurements]')).toBeNull();
      expect(host.textContent).toContain('There are no earlier measurements.');
    });

    it('reaches old photos from an empty initial year with bounded windows', async () => {
      const photos = vi
        .fn()
        .mockReturnValueOnce(of({ ...photosView([]), earlierDate: '2020-02-15' }))
        .mockReturnValue(of({ ...photosView(mayaPhotos()), earlierDate: null }));
      const { fixture, host } = await render({ url: '/progress?tab=photos', api: { photos } });
      expect(host.textContent).toContain('No photos in the last year.');
      expect(host.textContent).not.toContain('No photos yet');
      press(host, 'Show earlier photos');
      await settle(fixture);
      expect(photos).toHaveBeenLastCalledWith(null, '2019-02-15', '2020-02-16');
      expect(host.querySelector('[data-earlier-photos]')).toBeNull();
    });

    it('shows photos by day with their thumbnails granted in one batch, and what was removed apart', async () => {
      const { host, entries } = await render({ url: '/progress?tab=photos' });

      expect(entries['thumbnails']).toHaveBeenCalledTimes(1);
      const days = all(host, '[data-pane="photos"] [data-day]');
      expect(days.map((day) => textOf(day.querySelector('h2')))).toEqual([
        'Saturday 3 October',
        'Saturday 5 September',
      ]);
      expect(all(days[0], 'button.tile .pose').map(textOf)).toEqual(['Front', 'Side', 'Back']);
      expect(days[0].querySelector('button.tile img')!.getAttribute('src')).toBe(
        '/thumb/asset-Front-2026-10-03',
      );
      const removed = host.querySelector<HTMLDetailsElement>('[data-removed]')!;
      expect(removed.open).toBe(false);
      expect(textOf(removed.querySelector('summary'))).toBe('Photos you removed (1)');
    });

    it('says a tile has no preview when its grant was refused, without failing the page', async () => {
      const { host } = await render({
        url: '/progress?tab=photos',
        api: { thumbnails: vi.fn(() => throwError(() => new Error('no'))) },
      });

      expect(all(host, 'button.tile')).toHaveLength(4);
      expect(textOf(host.querySelector('button.tile .no-preview'))).toBe('No preview');
    });

    it('opens a photo in a sheet from its tile', async () => {
      const openPhoto = vi.fn(() =>
        of({ photoId: 'photo-Front-2026-10-03', fullUrl: '/full', thumbnailUrl: '/small' }),
      );
      const { fixture, host } = await render({
        url: '/progress?tab=photos',
        api: { openPhoto },
      });

      host.querySelector<HTMLButtonElement>('[data-photo="photo-Front-2026-10-03"]')!.click();
      await settle(fixture);

      expect(textOf(dialog()!.querySelector('h2'))).toBe('Front photo');
      expect(openPhoto).toHaveBeenCalled();
    });

    it('invites the first photos when there are none', async () => {
      const { host } = await render({
        url: '/progress?tab=photos',
        api: { photos: vi.fn(() => of(photosView([]))) },
      });

      expect(textOf(host.querySelector('[data-pane="photos"] app-empty-state h2'))).toBe(
        'No photos yet',
      );
    });

    it('offers a before and after beside Add photos once a pose has photos on two days', async () => {
      const { host } = await render({ url: '/progress?tab=photos' });
      expect(textOf(host.querySelector('[data-pane="photos"] .toolbar [data-before-after]'))).toBe(
        'Share a before and after',
      );
    });

    it('offers no before and after while each pose has one active photo', async () => {
      const { host } = await render({
        url: '/progress?tab=photos',
        api: {
          photos: vi.fn(() =>
            of(
              photosView([
                photo({ pose: 'Front', photoDate: '2026-10-03' }),
                photo({ pose: 'Front', photoDate: '2026-09-05', status: 'Removed' }),
                photo({ pose: 'Side', photoDate: '2026-09-05' }),
              ]),
            ),
          ),
        },
      });
      expect(all(host, 'button.tile')).toHaveLength(2);
      expect(host.querySelector('[data-before-after]')).toBeNull();
    });
  });

  describe('a coach reading a client’s entries', () => {
    it('reads that client’s entries, in kilograms, in a coach’s words and with no page heading', async () => {
      const { host, entries } = await render({ clientId: 'client-9', weightUnit: 'Pound' });

      expect(entries['weighIns']).toHaveBeenCalledWith(
        'client-9',
        'Kilogram',
        '2025-10-10',
        '2026-10-11',
      );
      expect(host.querySelector('h1')).toBeNull();
      expect(textOf(host.querySelectorAll('[data-weighin]')[2].querySelector('.meta'))).toBe(
        'Added by Maya',
      );
    });

    it('explains how the trend is worked out, in words and without the method code', async () => {
      const { host } = await render({ clientId: 'client-9' });

      const how = host.querySelector<HTMLDetailsElement>('details.how')!;
      expect(how.open).toBe(false);
      expect(textOf(how)).toContain('Smoothed average, version 2.0');
      expect(textOf(how)).toContain('time constant 10 days');
      expect(textOf(how)).not.toContain('BodyweightTrendEwma');
    });

    it('never shows a client how their trend is worked out', async () => {
      const { host } = await render();

      expect(host.querySelector('details.how')).toBeNull();
      expect(textOf(host)).not.toContain('Smoothed average');
    });

    it('names the client when there is nothing yet, and logs for them', async () => {
      const recordWeight = vi.fn(() => of(observation()));
      const { fixture, host } = await render({
        clientId: 'client-9',
        api: { weighIns: vi.fn(() => of(progressView([]))), recordWeight },
      });

      expect(textOf(host.querySelector('app-empty-state h2'))).toBe('Maya has no weights yet');
      host.querySelector<HTMLButtonElement>('[data-log-weight]')!.click();
      await settle(fixture);
      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Log weight for Maya');
      const box = sheet.querySelector<HTMLInputElement>('input[name="value"]')!;
      box.value = '81';
      box.dispatchEvent(new Event('input'));
      await settle(fixture);
      press(sheet, 'Save weight');
      await settle(fixture);
      expect(recordWeight).toHaveBeenCalledWith(
        'client-9',
        expect.objectContaining({ value: 81, unit: 'Kilogram' }),
      );
    });

    it('offers a coach no before and after: only the client makes one (M9)', async () => {
      const { fixture, host, entries } = await render({ clientId: 'client-9' });
      tab(host, 'Photos').click();
      await settle(fixture);

      expect(entries['photos']).toHaveBeenCalledWith(
        'client-9',
        expect.any(String),
        expect.any(String),
      );
      expect(all(host, 'button.tile').length).toBeGreaterThan(0);
      expect(host.querySelector('[data-before-after]')).toBeNull();
    });
  });

  describe('when the workspace changes', () => {
    it('forgets the first workspace’s entries and reads the second’s', async () => {
      const tenant = signal('tenant-1');
      const weighIns = vi
        .fn()
        .mockReturnValueOnce(of(progressView(mayaWeighIns())))
        .mockReturnValue(of(progressView([observation({ measurementDate: '2026-10-02' })])));
      const { fixture, host } = await render({ tenant, api: { weighIns } });
      expect(all(host, '[data-weighin]')).toHaveLength(4);

      tenant.set('tenant-2');
      await settle(fixture);

      expect(weighIns).toHaveBeenCalledTimes(2);
      expect(all(host, '[data-weighin]')).toHaveLength(1);
    });
  });
});
