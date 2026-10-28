import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CheckInToReviewItem, CheckInToReviewList } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { press, settle } from '../../../testing/dom';
import { CheckInsToReview } from './checkins-to-review';

@Component({ template: '' })
class Stub {}

const OWNER = 'user-owner';
const LEA = 'user-lea';

function item(overrides: Partial<CheckInToReviewItem> = {}): CheckInToReviewItem {
  return {
    assignmentId: 'assignment-1',
    clientProfileId: 'client-maya',
    clientFirstName: 'Maya',
    clientLastName: 'Rahman',
    coachUserId: OWNER,
    coachName: 'Karim Haddad',
    formTitle: 'Weekly check-in',
    sentAtUtc: '2026-10-19T07:30:00Z',
    sentDate: '2026-10-19',
    dueDate: '2026-10-18',
    daysLate: 1,
    ...overrides,
  };
}

const RAMI = item({
  assignmentId: 'assignment-2',
  clientProfileId: 'client-rami',
  clientFirstName: 'Rami',
  clientLastName: 'Saliba',
  coachUserId: LEA,
  coachName: 'Lea Khoury',
  formTitle: 'Monthly review',
  sentAtUtc: '2026-10-21T09:00:00Z',
  sentDate: '2026-10-21',
  dueDate: '2026-10-21',
  daysLate: 0,
});

const ELIE = item({
  assignmentId: 'assignment-3',
  clientProfileId: 'client-elie',
  clientFirstName: 'Élie',
  clientLastName: 'Nassar',
  sentDate: '2026-10-22',
  dueDate: '2026-10-19',
  daysLate: 3,
});

const list = (items: CheckInToReviewItem[], total = items.length): CheckInToReviewList => ({
  items,
  total,
  maximum: 500,
});

async function render(read: () => Observable<CheckInToReviewList>, userId = OWNER) {
  const api = { listCheckInsToReview: vi.fn(read) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'checkins/review', component: CheckInsToReview },
        { path: 'checkins/forms', component: Stub },
        { path: 'clients/:clientId/checkins/:assignmentId', component: Stub },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: AuthStore, useValue: { user: signal({ id: userId }) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      {
        provide: WorkspaceCalendar,
        useValue: {
          today: signal('2026-10-22'),
          timeZone: signal('Asia/Beirut'),
          resolveToday: () => Promise.resolve('2026-10-22'),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/checkins/review', CheckInsToReview);
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const rowParts = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.row')).map((row) => ({
    initials: textOf(row.querySelector('app-avatar')),
    link: row.querySelector('a.row-link')?.getAttribute('href'),
    name: textOf(row.querySelector('a.row-link > span:first-child')),
    line: textOf(row.querySelector('.row-line')),
    coach: textOf(row.querySelector('.row-coach')),
  }));

async function search(harness: RouterTestingHarness, host: HTMLElement, text: string) {
  const box = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  box.value = text;
  box.dispatchEvent(new Event('input'));
  await settle(harness.fixture);
}

describe('Check-ins to review (critique B3b)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('says what a check-in is and lists every one waiting, oldest first, each opening its review', async () => {
    const { host } = await render(() => of(list([item(), RAMI, ELIE])));

    expect(textOf(host.querySelector('h1'))).toBe('Check-ins to review');
    expect(textOf(host.querySelector('.lede'))).toBe(
      'A check-in is a short form your clients fill in on a schedule: their weight, photos and your questions. Sent ones wait here for your review.',
    );
    const sections = Array.from(host.querySelectorAll('app-section-nav a'));
    expect(sections.map((link) => [textOf(link), link.getAttribute('href')])).toEqual([
      ['To review', '/checkins/review'],
      ['Forms', '/checkins/forms'],
    ]);
    expect(sections[0].getAttribute('aria-current')).toBe('page');
    expect(textOf(host.querySelector('.count'))).toBe('3 check-ins to review');

    // The owner reads a team coach's client with whose it is; their own name no coach.
    expect(rowParts(host)).toEqual([
      {
        initials: 'MR',
        link: '/clients/client-maya/checkins/assignment-1',
        name: 'Maya Rahman',
        line: 'Weekly check-in Sent Mon 19 Oct · 1 day late',
        coach: '',
      },
      {
        initials: 'RS',
        link: '/clients/client-rami/checkins/assignment-2',
        name: 'Rami Saliba',
        line: 'Monthly review Sent Wed 21 Oct',
        coach: 'Coached by Lea Khoury',
      },
      {
        initials: 'ÉN',
        link: '/clients/client-elie/checkins/assignment-3',
        name: 'Élie Nassar',
        line: 'Weekly check-in Sent Thu 22 Oct · 3 days late',
        coach: '',
      },
    ]);
  });

  it('names each row’s link with all it says, the lines drawn once for the eye', async () => {
    const { host } = await render(() => of(list([RAMI])));

    expect(textOf(host.querySelector('a.row-link'))).toBe(
      'Rami Saliba, Monthly review, Sent Wed 21 Oct, Coached by Lea Khoury',
    );
    expect(host.querySelector('.row-line')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.row-coach')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names no coach on a coach’s own list', async () => {
    const { host } = await render(() => of(list([RAMI])), LEA);

    expect(rowParts(host).map((row) => row.coach)).toEqual(['']);
  });

  it('opens the review on the client’s record', async () => {
    const { harness, host } = await render(() => of(list([item()])));

    host.querySelector<HTMLAnchorElement>('a.row-link')!.click();
    await settle(harness.fixture);

    expect(TestBed.inject(Router).url).toBe('/clients/client-maya/checkins/assignment-1');
  });

  it('searches by the client’s name, accents aside, and clears back to every row', async () => {
    const { harness, host } = await render(() => of(list([item(), RAMI, ELIE])));

    await search(harness, host, 'elie');
    expect(rowParts(host).map((row) => row.name)).toEqual(['Élie Nassar']);
    expect(textOf(host.querySelector('.count'))).toBe('1 of 3 check-ins to review');

    await search(harness, host, 'RAMI sal');
    expect(rowParts(host).map((row) => row.name)).toEqual(['Rami Saliba']);

    await search(harness, host, 'Nour');
    expect(host.querySelector('.rows')).toBeNull();
    expect(textOf(host.querySelector('.no-match p'))).toBe(
      'No client called “Nour” has a check-in to review.',
    );
    expect(textOf(host.querySelector('.count'))).toBe('0 of 3 check-ins to review');

    press(host, 'Clear search');
    await settle(harness.fixture);
    expect(rowParts(host)).toHaveLength(3);
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('');
    expect(textOf(host.querySelector('.count'))).toBe('3 check-ins to review');
  });

  it('says when nothing waits, with no search to make', async () => {
    const { host } = await render(() => of(list([])));

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe(
      'Nothing to review from clients with a plan',
    );
    expect(textOf(host.querySelector('app-empty-state p'))).toBe(
      'When a client whose plan includes check-ins sends one, it waits here, oldest first.',
    );
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(host.querySelector('.count')).toBeNull();
  });

  it('counts every one waiting and says the oldest are shown when more wait than one read brings', async () => {
    const { host } = await render(() => of(list([item(), RAMI], 612)));

    expect(textOf(host.querySelector('.count'))).toBe('612 check-ins to review');
    expect(textOf(host.querySelector('.note'))).toBe(
      'The oldest 2 of 612 are shown. The rest come as you review these.',
    );
  });

  it('says so when the list cannot be read, and tries again', async () => {
    let calls = 0;
    const { harness, host, api } = await render(() =>
      ++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 503 })) : of(list([item()])),
    );

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'The check-ins to review could not be loaded.',
    );
    press(host, 'Try again');
    await settle(harness.fixture);

    expect(api.listCheckInsToReview).toHaveBeenCalledTimes(2);
    expect(rowParts(host).map((row) => row.name)).toEqual(['Maya Rahman']);
  });
});
