import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachMonthReportView } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, segment, settle, toggleFold } from '../../../testing/dom';
import {
  coachMonthReport,
  coachOwnMonthReport,
  emptyMonthReport,
  ownerAloneWaitingMonthReport,
  waitingMonthReport,
} from '../../../testing/month-fixtures';
import { ThisMonth } from './month';
import { MonthApi } from './month-api';

async function render(getMonth: () => unknown = () => of(coachMonthReport())) {
  const tenant = signal<string | null>('tenant-1');
  const api = { getMonth: vi.fn(getMonth) };
  await TestBed.configureTestingModule({
    imports: [ThisMonth],
    providers: [
      provideRouter([]),
      { provide: MonthApi, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ThisMonth);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, tenant };
}

const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const lines = (host: HTMLElement, selector: string) =>
  [...host.querySelectorAll(selector)].map((node) => squash(node.textContent));

describe('ThisMonth', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the month’s numbers with last month’s beside each, each currency on its own line', async () => {
    const { host } = await render();

    expect(host.querySelector('h1')?.textContent).toContain('This month');
    expect(squash(host.querySelector('#numbers-heading')?.textContent)).toBe('Your coaching space');
    expect(squash(host.querySelector('.numbers-span')?.textContent)).toBe('October so far');
    expect(lines(host, '.money-line')).toEqual([
      'EUR 0 September: EUR 90.50',
      'LBP 4,500,000 1 payment Nothing in September',
      'USD 2,340 7 payments September: USD 1,980',
    ]);
    expect(lines(host, '.counts .part')).toEqual([
      '1-on-1 sessions held12September: 9',
      'Coaching plans sold3September: 2',
      'Session packs sold2September: 1',
      'Clients started2September: 1',
      'Clients ended1September: 0',
    ]);
  });

  it('keeps a space between a number and its note for a screen reader', async () => {
    const { host } = await render();

    expect(host.querySelector('.money-line')?.textContent).toMatch(/EUR 0\s+September/);
  });

  it('gives the owner each coach and the total, the month switching them together', async () => {
    const { fixture, host } = await render();

    expect(lines(host, 'tbody tr')).toEqual([
      expect.stringContaining('You'),
      expect.stringContaining('Lea Khoury'),
      expect.stringContaining('Omar Saleh'),
      expect.stringContaining('Hadi Nasr'),
    ]);
    const leas = host.querySelectorAll('tbody tr')[1];
    expect(lines(leas as HTMLElement, 'td')).toEqual([
      'LBP 4,500,000USD 1,440',
      '8',
      '2',
      '1',
      '1',
      '1',
    ]);
    expect(lines(host, 'tfoot td')).toEqual(['LBP 4,500,000USD 2,340', '12', '3', '2', '2', '1']);
    expect(lines(host, '.who-left')).toEqual(['Left the team']);
    expect(lines(host, 'tbody tr:nth-child(3) td')[0]).toBe('None');

    segment(host, 'Month shown', 'September').click();
    await settle(fixture);

    expect(lines(leas as HTMLElement, 'td')).toEqual(['USD 1,000', '6', '1', '1', '1', '0']);
    expect(lines(host, 'tfoot td')).toEqual(['EUR 90.50USD 1,980', '9', '2', '1', '1', '0']);
    expect(lines(host, 'tbody tr:nth-child(4) td')[0]).toBe('EUR 90.50USD 280');
  });

  it('adds a No coach line before the total, switching with the month (N9d1b)', async () => {
    const { fixture, host } = await render(() => of(waitingMonthReport()));

    const noCoach = host.querySelector<HTMLElement>('tbody tr[data-no-coach]')!;
    // Last among the rows, before the Total; no face, since nobody held it.
    expect(host.querySelector('tbody tr:last-child')).toBe(noCoach);
    expect(noCoach.querySelector('app-avatar')).toBeNull();
    expect(squash(noCoach.querySelector('th')?.textContent)).toBe(
      'No coach While clients waited for a coach',
    );
    expect(lines(noCoach, 'td')).toEqual(['USD 300', '0', '1', '0', '0', '0']);
    // The rows plus No coach add up to the Total.
    expect(lines(host, 'tfoot td')).toEqual(['LBP 4,500,000USD 2,340', '12', '3', '2', '2', '1']);

    segment(host, 'Month shown', 'September').click();
    await settle(fixture);

    expect(lines(noCoach, 'td')).toEqual(['USD 280', '0', '0', '0', '0', '0']);
    expect(lines(host, 'tfoot td')).toEqual(['EUR 90.50USD 1,980', '9', '2', '1', '1', '0']);
  });

  it('shows an owner alone the table once something counted for no coach', async () => {
    const { host } = await render(() => of(ownerAloneWaitingMonthReport()));

    expect(lines(host, 'tbody tr')).toEqual([
      expect.stringContaining('You'),
      expect.stringContaining('No coach'),
    ]);
    expect(lines(host, 'tfoot td')[0]).toBe('USD 1,200');
  });

  it('says in Whose numbers where a waiting client counts, only beside the No coach line', async () => {
    const waiting = await render(() => of(waitingMonthReport()));
    await toggleFold(waiting.fixture, waiting.host, 'How these are counted');
    expect(squash(waiting.host.querySelector('.how')?.textContent)).toContain(
      'client who moves on leaves their earlier numbers behind. While a client waits for a coach, it counts on the No coach line.',
    );
    TestBed.resetTestingModule();

    const { fixture, host } = await render();
    await toggleFold(fixture, host, 'How these are counted');
    expect(host.querySelector('tbody tr[data-no-coach]')).toBeNull();
    expect(squash(host.querySelector('.how')?.textContent)).not.toContain('No coach line');
  });

  it('labels each number for the card it becomes on a phone', async () => {
    const { host } = await render();

    expect(
      [...host.querySelectorAll('tbody tr:first-child td')].map((cell) =>
        cell.getAttribute('data-label'),
      ),
    ).toEqual([
      'Money received',
      'Sessions held',
      'Coaching plans sold',
      'Packs sold',
      'Started',
      'Ended',
    ]);
    expect(lines(host, 'thead th')).toEqual([
      'Coach',
      'Money received',
      'Sessions held',
      'Coaching plans sold',
      'Packs sold',
      'Started',
      'Ended',
    ]);
  });

  it('gives a coach their own numbers and no rows', async () => {
    const { host } = await render(() => of(coachOwnMonthReport()));

    expect(squash(host.querySelector('#numbers-heading')?.textContent)).toBe('Your numbers');
    expect(host.querySelector('table')).toBeNull();
    expect(squash(host.textContent)).not.toContain('By coach');
  });

  it('invites when there is nothing to count yet', async () => {
    const { host } = await render(() => of(emptyMonthReport()));

    expect(squash(host.textContent)).toContain('Nothing to count yet');
    expect(host.querySelector('.numbers')).toBeNull();
    expect(host.querySelector('a[href="/clients"]')?.textContent).toContain('Open Clients');
  });

  it('says what each number counts, with no word for profit', async () => {
    const { fixture, host } = await render();

    await toggleFold(fixture, host, 'How these are counted');

    expect(lines(host, '.how dt')).toEqual([
      'Money received',
      '1-on-1 sessions held',
      'Coaching plans and session packs sold',
      'Clients started',
      'Clients ended',
      'Whose numbers',
      'Last month',
    ]);
    expect(squash(host.textContent)).not.toMatch(/profit|earned|earning/i);
    expect(squash(host.textContent)).toContain('for whoever held them');
    expect(squash(host.textContent)).toContain(
      'A coaching plan is the coaching a client pays for over dates; a session pack is a set of 1-on-1 sessions.',
    );
  });

  it('goes back to Today', async () => {
    const { host } = await render();

    expect(host.querySelector('a.back')?.getAttribute('href')).toBe('/');
  });

  it('shows a skeleton while it reads, and offers another try when it fails', async () => {
    const pending = new Subject<CoachMonthReportView>();
    const first = await render(() => pending);
    expect(first.host.querySelector('app-skeleton')).not.toBeNull();
    pending.next(coachMonthReport());
    pending.complete();
    await settle(first.fixture);
    expect(first.host.querySelector('app-skeleton')).toBeNull();
    TestBed.resetTestingModule();

    let calls = 0;
    const { fixture, host } = await render(() =>
      calls++ === 0 ? throwError(() => new Error('offline')) : of(coachMonthReport()),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'This month couldn’t be loaded.',
    );
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelector('.numbers')).not.toBeNull();
  });

  it('reads the new workspace’s numbers when the coach switches, dropping a late reply', async () => {
    const late = new Subject<CoachMonthReportView>();
    const answers = [late, of(emptyMonthReport())];
    const { fixture, host, api, tenant } = await render(() => answers.shift());

    tenant.set('tenant-2');
    await settle(fixture);
    late.next(coachMonthReport());
    await settle(fixture);

    expect(api.getMonth).toHaveBeenCalledTimes(2);
    expect(squash(host.textContent)).toContain('Nothing to count yet');
  });
});
