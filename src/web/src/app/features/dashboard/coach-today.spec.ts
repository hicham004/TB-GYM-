import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachClientDetails } from '../../core/api/api.models';
import type { CoachTodayView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { MessagingRealtimeService } from '../../core/messaging/messaging-realtime.service';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { installDialogSupport } from '../../../testing/dialog';
import { fill, formSummary, press, settle, toggleFold } from '../../../testing/dom';
import { provideEmailDelivery } from '../../../testing/email-delivery';
import { fakeMotion, provideFakeMotion } from '../../../testing/motion-fake';
import { IDLE_AFTER_MS } from './arrival-moment';
import {
  attentionItem,
  coachMonth,
  coachOwnTodayView,
  coachTodayView,
  emptyCoachTodayView,
  JAD,
  LEA_ID,
  MAYA,
  OWNER_ID,
  SARA,
} from '../../../testing/coach-today-fixtures';
import { FormerClientsApi } from '../clients/former-clients-api';
import { ConversationStarter } from '../messaging/conversation-starter';
import { CoachToday } from './coach-today';

interface RenderOptions {
  releaseClient?: ReturnType<typeof vi.fn>;
  user?: { id: string; displayName: string };
  /** A browser that moves (W6): the moment's moves are asked for rather than landed at once. */
  motionAllowed?: boolean;
}

async function render(
  getCoachToday: () => unknown = () => of(coachTodayView()),
  role: 'Owner' | 'Coach' = 'Owner',
  starter: { open: ReturnType<typeof vi.fn> } = { open: vi.fn().mockResolvedValue(true) },
  options: RenderOptions = {},
) {
  const tenant = signal<string | null>('tenant-1');
  const membership = signal({ tenantId: 'tenant-1', tenantName: 'Atlas Performance', role });
  const api = { getCoachToday: vi.fn(getCoachToday) };
  /** The chat hub's "a conversation changed" count, which bumps the quiet re-read (W6). */
  const bumps = signal(0);
  const releaseClient =
    options.releaseClient ??
    vi.fn(() => of({ id: 'c-elie', firstName: 'Elie' } as CoachClientDetails));
  await TestBed.configureTestingModule({
    imports: [CoachToday],
    providers: [
      provideRouter([]),
      provideEmailDelivery(false),
      provideFakeMotion(fakeMotion({ allowed: options.motionAllowed ?? false })),
      { provide: MessagingRealtimeService, useValue: { listRefreshRequests: bumps } },
      { provide: ApiClient, useValue: api },
      { provide: ConversationStarter, useValue: starter },
      { provide: FormerClientsApi, useValue: { releaseClient } },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: tenant, selectedMembership: membership },
      },
      {
        provide: AuthStore,
        useValue: { user: signal(options.user ?? { id: OWNER_ID, displayName: 'Karim Haddad' }) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CoachToday);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    api,
    tenant,
    bumps,
    releaseClient,
    read: () => (host.textContent ?? '').replace(/\s+/g, ' '),
  };
}

const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** A browser at a phone's width, or wider; jsdom has no `matchMedia` of its own. */
function stubWidth(phone: boolean): void {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: phone && media.includes('max-width'),
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

/** The page's sections from the top, each named by its heading or its fold's row, counts left out. */
function sections(host: HTMLElement): string[] {
  return [
    ...host.querySelectorAll<HTMLElement>(
      'section.panel > header h2, app-disclosure summary .label',
    ),
  ].map((name) => squash(name.textContent).replace(/\s*\d+$/, ''));
}

/** A plan row's two lines, as read: the client (and their coach), then the plan and its day. */
function planLines(row: HTMLElement): string[] {
  return [...row.querySelectorAll('.plan-copy p')].map((line) => squash(line.textContent));
}

describe('CoachToday', () => {
  let uninstallDialog: () => void = () => undefined;

  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    uninstallDialog();
  });

  it('greets the coach with the workspace date and how many clients are in Needs you', async () => {
    const { host, read } = await render();

    expect(read()).toContain('Thursday 1 October');
    expect(host.querySelector('h1')?.textContent).toMatch(
      /Good (morning|afternoon|evening), Karim\./,
    );
    // It counts the queue, plans ending and maxes included, so it says so (COACH-4): the client list's
    // "need attention" leaves those out, and never claims everyone else is on track.
    expect(host.querySelector('.needs')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '7 clients have something for you today, listed under Needs you.',
    );
    expect(host.querySelector('a[href="/invitations"]')?.textContent).toContain('Invite client');
    expect(host.querySelector('a[href="/clients"]')?.textContent).toContain('Find a client');
  });

  it('keeps the date’s line while Today is read, and draws its buttons with the answer (audit UIQ-5)', async () => {
    const answer = new Subject<unknown>();
    const { fixture, host } = await render(() => answer);

    expect(host.querySelector('.date')?.textContent?.trim()).toBe('');
    expect(host.querySelector('.top-actions')).toBeNull();

    answer.next(coachTodayView());
    answer.complete();
    await settle(fixture);

    expect(host.querySelector('.date')?.textContent).toContain('Thursday 1 October');
    expect(host.querySelector('.top-actions a[href="/clients"]')).not.toBeNull();
  });

  it('lays Today out from the top: Needs you, This month, the plans, then the feed (critique B4b)', async () => {
    const { host } = await render();

    expect(sections(host)).toEqual([
      'Needs you',
      'This month',
      'Plans ending soon',
      'Ended, not renewed',
      'What your clients did',
    ]);
    // The tiles and the workspace week's bars are gone; nothing is folded wider than a phone.
    expect(host.querySelector('app-stat-tile')).toBeNull();
    expect(host.querySelector('.bars, .week')).toBeNull();
    expect(host.querySelector('app-disclosure')).toBeNull();
    expect(squash(host.querySelector('section.feed .panel-span')?.textContent)).toBe('Last 7 days');
  });

  it('shows the owner this month’s money per currency, the active clients and the team', async () => {
    const { host } = await render();
    const month = host.querySelector<HTMLElement>('section.month')!;

    expect(squash(month.querySelector('.panel-span')?.textContent)).toBe('October');
    expect(
      [...month.querySelectorAll('.money-line')].map((line) => squash(line.textContent)),
    ).toEqual(['LBP 4,500,000 1 payment', 'USD 2,340 7 payments']);
    expect(squash(month.textContent)).toContain('Received by your coaching space');
    expect(squash(month.querySelector('.month-value')?.textContent)).toBe('9 of 12 clients');
    expect(squash(month.textContent)).toContain('With a plan running today');
    expect(
      [...month.querySelectorAll('.staff-row')].map((row) => [
        squash(row.querySelector('app-avatar')?.textContent),
        squash(row.querySelector('.staff-copy')?.textContent),
      ]),
    ).toEqual([
      ['KH', 'You 7 of 10 clients active'],
      ['LK', 'Lea Khoury 2 of 2 clients active'],
      ['OS', 'Omar Saleh No clients yet'],
    ]);
    // Never one total across currencies, and never called profit or earnings (SUB-016).
    expect(squash(month.textContent)).not.toMatch(/profit|earning|total/i);
  });

  it('shows a coach only their own money and active clients, with no team', async () => {
    const { host } = await render(() => of(coachOwnTodayView()), 'Coach', undefined, {
      user: { id: LEA_ID, displayName: 'Lea Khoury' },
    });
    const month = host.querySelector<HTMLElement>('section.month')!;

    expect(
      [...month.querySelectorAll('.money-line')].map((line) => squash(line.textContent)),
    ).toEqual(['USD 82.50 1 payment']);
    expect(squash(month.textContent)).toContain('Received from your clients');
    expect(squash(month.querySelector('.month-value')?.textContent)).toBe('2 of 2 clients');
    expect(month.querySelector('.staff')).toBeNull();
    expect(squash(month.textContent)).not.toContain('Coaches');
  });

  it('shows the 1-on-1 sessions held only once a coach has any to count (critique B10c)', async () => {
    const none = await render();
    expect(none.host.querySelector('.month')?.textContent).not.toContain('1-on-1 sessions held');
    TestBed.resetTestingModule();

    const { host } = await render(() =>
      of(coachTodayView({ month: coachMonth({ sessionsHeld: 12 }) })),
    );
    const parts = Array.from(host.querySelectorAll('.month-part'));
    expect(parts.map((part) => part.querySelector('.month-label')?.textContent)).toEqual([
      'Money received',
      'Active clients',
      '1-on-1 sessions held',
      'Coaches',
    ]);
    expect(parts[2].querySelector('.month-value')?.textContent).toBe('12');
    expect(parts[2].querySelector('.month-note')?.textContent).toBe('Held by your coaching space');
  });

  it('opens the page of the month from This month (critique B10d)', async () => {
    const { host } = await render();
    const link = host.querySelector<HTMLAnchorElement>('section.month .month-foot a');

    expect(squash(link?.textContent)).toBe('See this month and last');
    expect(link?.getAttribute('href')).toBe('/month');
  });

  it('says plainly when nothing has been received this month, in no currency', async () => {
    const view = coachTodayView({ month: coachMonth({ moneyReceived: [] }) });
    const { host } = await render(() => of(view));
    const month = host.querySelector<HTMLElement>('section.month')!;

    expect(month.querySelector('.money')).toBeNull();
    expect(squash(month.textContent)).toContain('Nothing received yet this month');
    expect(squash(month.textContent)).toContain(
      'Payments you record show up here on the day they arrived.',
    );
    expect(squash(month.textContent)).not.toMatch(/USD|LBP|\b0\b/);
  });

  it('lists the plans ending soon with Renew, Record payment and Message only where allowed', async () => {
    const starter = { open: vi.fn().mockResolvedValue(true) };
    const { fixture, host } = await render(undefined, 'Owner', starter);
    const rows = [
      ...host.querySelectorAll<HTMLElement>('section.plan-list')[0].querySelectorAll('li'),
    ];

    expect(rows.map(planLines)).toEqual([
      ['Rita Daher', 'Strength coaching · Ends tomorrow'],
      ['Sara Mansour', 'Online coaching · Ends Wed 7 Oct'],
      [
        'Maya Fakhoury · Coached by Lea Khoury',
        'Fat loss · 12 weeks · Paid until Fri 9 Oct · The renewal isn’t paid yet',
      ],
    ]);
    const links = (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLElement>('a, button')].map((action) => [
        squash(action.textContent),
        action.getAttribute('href'),
      ]);
    expect(links(rows[0])).toEqual([
      ['Renew for Rita Daher', '/clients/c-rita/service?renew=e-rita'],
      ['Message Rita Daher', '/messages?conversation=conv-rita'],
    ]);
    expect(links(rows[1])).toEqual([
      ['Renew for Sara Mansour', '/clients/c-sara/service?renew=e-sara'],
      ['Message Sara Mansour', null],
    ]);
    // Lea coaches Maya: no Message for the owner, and the unpaid renewal's payment, not a second one.
    expect(links(rows[2])).toEqual([
      ['Record payment for Maya Fakhoury', '/clients/c-maya/service?pay=e-maya-next'],
    ]);

    // No chat with Sara yet: Message starts it, as the client page's Message does.
    press(rows[1], 'Message Sara Mansour');
    await settle(fixture);
    expect(starter.open).toHaveBeenCalledWith(SARA.clientProfileId);
  });

  it('lists the plans that ended unrenewed with Renew, and End coaching for the owner alone', async () => {
    const owner = await render();
    const ended = owner.host.querySelectorAll<HTMLElement>('section.plan-list')[1];
    const rows = [...ended.querySelectorAll<HTMLElement>(':scope > ul > li')];

    expect(rows.map(planLines)).toEqual([
      ['Elie Azar', 'Strength coaching · Ended Sun 27 Sep · Asked to renew on Tue 29 Sep'],
      [
        'Hadi Nassar · Coached by Lea Khoury',
        'Online coaching · Ended Sun 20 Sep · The next plan isn’t paid yet',
      ],
    ]);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe(
      '/clients/c-elie/service?renew=e-elie',
    );
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe(
      '/clients/c-hadi/service?pay=e-hadi-next',
    );
    expect(
      rows.map((row) => squash(row.querySelector('app-client-release > button')?.textContent)),
    ).toEqual(['End coaching with Elie Azar', 'End coaching with Hadi Nassar']);
    expect(ended.querySelector('a[href^="/messages"]')).toBeNull();
    TestBed.resetTestingModule();

    // A coach gets Renew (or Record payment) only: ending coaching is the owner's (ADR 0027).
    const coach = await render(() => of(coachOwnTodayView()), 'Coach', undefined, {
      user: { id: LEA_ID, displayName: 'Lea Khoury' },
    });
    const theirs = coach.host.querySelectorAll<HTMLElement>('section.plan-list')[1];
    expect(theirs.querySelector('app-client-release')).toBeNull();
    expect(squash(theirs.querySelector('li a')?.textContent)).toBe(
      'Record payment for Hadi Nassar',
    );
  });

  it('asks before ending coaching, and keeps the dialog open with the reason when it is refused', async () => {
    const refusal = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'concurrency_conflict',
        message: 'The client profile was changed by another request.',
      },
    });
    const releaseClient = vi.fn(() => throwError(() => refusal));
    const { fixture, host, api } = await render(undefined, 'Owner', undefined, { releaseClient });
    const elie = host.querySelectorAll<HTMLElement>('section.plan-list')[1].querySelector('li')!;

    press(elie, 'End coaching with Elie Azar');
    await settle(fixture);
    const dialog = elie.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(squash(dialog.querySelector('h2')?.textContent)).toBe('End coaching with Elie Azar?');
    expect(releaseClient).not.toHaveBeenCalled();

    fill(dialog, 'Reason', 'Moved abroad');
    press(dialog, 'End coaching permanently');
    await settle(fixture);

    expect(releaseClient).toHaveBeenCalledWith('c-elie', 'Moved abroad', 4);
    expect(dialog.open).toBe(true);
    expect(squash(formSummary(dialog).textContent)).not.toBe('');
    // Today is not read again: nothing changed.
    expect(api.getCoachToday).toHaveBeenCalledTimes(1);
  });

  it('reads Today again once coaching has ended, and says so', async () => {
    let reads = 0;
    const { fixture, host, api } = await render(() =>
      of(++reads === 1 ? coachTodayView() : coachTodayView({ plansEndedNotRenewed: [] })),
    );
    const elie = host.querySelectorAll<HTMLElement>('section.plan-list')[1].querySelector('li')!;

    press(elie, 'End coaching with Elie Azar');
    await settle(fixture);
    fill(elie.querySelector('dialog')!, 'Reason', 'Moved abroad');
    press(elie.querySelector('dialog')!, 'End coaching permanently');
    await settle(fixture);

    expect(api.getCoachToday).toHaveBeenCalledTimes(2);
    expect(squash(document.querySelector('.tb-toast__message')?.textContent)).toBe(
      'Coaching with Elie has ended. They no longer have access, and we are emailing them.',
    );
    const ended = host.querySelectorAll<HTMLElement>('section.plan-list')[1];
    expect(squash(ended.textContent)).toContain(
      'No plan ran out in the last 30 days without a renewal.',
    );
    expect(document.activeElement).toBe(ended.querySelector('h2'));
  });

  it('says so in plain words when no plan ends soon or ended unrenewed', async () => {
    const { host } = await render(() =>
      of(coachTodayView({ plansEndingSoon: [], plansEndedNotRenewed: [] })),
    );
    const [ending, ended] = host.querySelectorAll<HTMLElement>('section.plan-list');

    expect(ending.querySelector('li')).toBeNull();
    expect(squash(ending.querySelector('h2')?.textContent)).toBe('Plans ending soon');
    expect(squash(ending.querySelector('.list-empty')?.textContent)).toBe(
      'No plan ends in the next 14 days.',
    );
    expect(ended.querySelector('li')).toBeNull();
    expect(squash(ended.querySelector('.list-empty')?.textContent)).toBe(
      'No plan ran out in the last 30 days without a renewal.',
    );
  });

  it('ranks the queue as the server did, with one filled action and links that say whose', async () => {
    const { host } = await render();

    const rows = [...host.querySelectorAll<HTMLElement>('li.need')];
    expect(rows.map((row) => row.dataset['kind'])).toEqual([
      'CheckInToReview',
      'UnreadMessages',
      'RenewalRequested',
      'PlanEndingSoon',
      'WeekNotShared',
      'MissedSessions',
      'NoProgram',
    ]);
    const actions = rows.map((row) => row.querySelector<HTMLAnchorElement>('a.need-action')!);
    expect(actions[0].classList).toContain('tb-button--filled');
    expect(
      actions.slice(1).every((action) => action.classList.contains('tb-button--outlined')),
    ).toBe(true);
    expect(actions[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('Review for Maya Fakhoury');
    expect(actions[0].getAttribute('href')).toBe('/clients/c-maya/checkins/a-maya');
    expect(actions[1].getAttribute('href')).toBe('/messages?conversation=conv-sara');
    expect(actions[2].getAttribute('href')).toBe('/clients/c-elie/service?renew=e-elie');
    expect(rows[0].textContent).toContain('Coached by Lea Khoury');
    expect(rows[1].textContent).not.toContain('Coached by');
    expect(host.querySelector('#needs-heading .badge')?.textContent?.trim()).toBe('7');
  });

  it('reminds about an overdue check-in in the coach’s own chat, starting it when there is none (critique B4a)', async () => {
    const starter = { open: vi.fn().mockResolvedValue(true) };
    const view = coachTodayView({
      attention: [
        attentionItem('CheckInOverdue', JAD, { count: 2, date: '2026-09-19', canMessage: true }),
        attentionItem('CheckInOverdue', SARA, {
          count: 1,
          date: '2026-09-28',
          canMessage: true,
          subjectId: 'conv-sara',
        }),
        attentionItem('CheckInOverdue', MAYA, { count: 1, date: '2026-09-28', canMessage: false }),
      ],
    });
    const { fixture, host } = await render(() => of(view), 'Owner', starter);
    const rows = [...host.querySelectorAll<HTMLElement>('li.need')];

    expect(squash(rows[0].querySelector('.need-heading')?.textContent)).toBe(
      'Jad Karam has 2 check-ins overdue',
    );
    expect(squash(rows[0].querySelector('.need-detail')?.textContent)).toBe(
      'The oldest was due Sat 19 Sep',
    );
    // No chat with Jad yet: Remind is a button that starts it, as the client page's Message does.
    const remind = rows[0].querySelector<HTMLButtonElement>('button.need-action')!;
    expect(squash(remind.textContent)).toBe('Remind Jad Karam');
    remind.click();
    await settle(fixture);
    expect(starter.open).toHaveBeenCalledWith(JAD.clientProfileId);
    // Sara's chat exists: Remind opens it.
    expect(rows[1].querySelector('a.need-action')?.getAttribute('href')).toBe(
      '/messages?conversation=conv-sara',
    );
    // Lea coaches Maya: the owner is sent to her check-ins and told whose client she is (CLI-013).
    const maya = rows[2].querySelector('a.need-action');
    expect(squash(maya?.textContent)).toBe('See check-ins for Maya Fakhoury');
    expect(maya?.getAttribute('href')).toBe('/clients/c-maya/checkins');
    expect(rows[2].textContent).toContain('Coached by Lea Khoury');
  });

  it('says so when Remind cannot open the chat', async () => {
    const starter = { open: vi.fn().mockRejectedValue(new Error('offline')) };
    const view = coachTodayView({
      attention: [
        attentionItem('CheckInOverdue', JAD, { count: 1, date: '2026-09-28', canMessage: true }),
      ],
    });
    const { fixture, host } = await render(() => of(view), 'Owner', starter);

    press(host, 'Remind Jad Karam');
    await settle(fixture);

    expect(squash(document.querySelector('.tb-toast__message')?.textContent)).toBe(
      'Couldn’t open this conversation. Check messaging access and retry.',
    );
    // The button is pressable again.
    expect(host.querySelector('button.need-action')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('explains how the statuses work from under Needs you (critique B4a)', async () => {
    const { fixture, host } = await render();

    expect(host.querySelector('.queue app-statuses-help')).not.toBeNull();
    press(host, 'How these statuses work');
    await settle(fixture);

    const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(squash(sheet?.querySelector('h2')?.textContent)).toBe('How these statuses work');
    expect(squash(sheet?.textContent)).toContain('A check-in was due 2 to 13 days ago');
  });

  it('writes the feed as sentences with records and links to the client', async () => {
    const { host } = await render();

    const events = [...host.querySelectorAll<HTMLElement>('li.event')];
    expect(events).toHaveLength(3);
    const rami = events[0];
    expect(rami.querySelector('a.event-link')?.textContent?.trim()).toBe(
      'Rami Tabet finished Lower A in 58 min',
    );
    expect(rami.querySelector('a.event-link')?.getAttribute('href')).toBe(
      '/clients/c-rami/training',
    );
    expect(rami.querySelectorAll('.record')).toHaveLength(2);
    expect(rami.textContent).toContain('Personal record:');
    expect(rami.textContent).toContain('and 1 more record');
    expect(rami.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01T11:25:00Z');
  });

  it('starts the feed with the newest five, and Show all opens the rest (critique T2)', async () => {
    const base = coachTodayView();
    const activity = Array.from({ length: 9 }, (_, index) => ({
      ...base.activity[2],
      subjectId: `w-${index}`,
    }));
    const { fixture, host } = await render(() => of(coachTodayView({ activity })));

    expect(host.querySelectorAll('li.event')).toHaveLength(5);
    const toggle = host.querySelector<HTMLButtonElement>('button.feed-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('coach-activity');

    press(host, 'Show all 9');
    await settle(fixture);
    expect(host.querySelectorAll('li.event')).toHaveLength(9);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    press(host, 'Show less');
    await settle(fixture);
    expect(host.querySelectorAll('li.event')).toHaveLength(5);
  });

  it('offers no toggle when the feed already fits', async () => {
    const { host } = await render();

    expect(host.querySelector('button.feed-toggle')).toBeNull();
  });

  it('folds the feed under Needs you on a phone, with its count, and opens it on request', async () => {
    stubWidth(true);
    const base = coachTodayView();
    const activity = Array.from({ length: 7 }, (_, index) => ({
      ...base.activity[2],
      subjectId: `w-${index}`,
    }));
    const { fixture, host } = await render(() => of(coachTodayView({ activity })));

    expect(sections(host)).toEqual([
      'Needs you',
      'What your clients did',
      'This month',
      'Plans ending soon',
      'Ended, not renewed',
    ]);
    // Drawn once, as the fold under Needs you: never also as the panel at the end.
    expect(host.querySelector('section.feed')).toBeNull();
    const fold = host.querySelector<HTMLElement>('app-disclosure.feed-fold')!;
    expect(fold.previousElementSibling?.matches('section.queue')).toBe(true);
    expect(squash(fold.querySelector('summary')?.textContent)).toBe(
      'What your clients did Last 7 days 7',
    );
    expect(fold.querySelector('details')?.open).toBe(false);
    expect(host.querySelector('li.event')).toBeNull();

    await toggleFold(fixture, host, 'What your clients did');
    expect(host.querySelectorAll('li.event')).toHaveLength(5);
    press(host, 'Show all 7');
    await settle(fixture);
    expect(host.querySelectorAll('app-disclosure li.event')).toHaveLength(7);
  });

  it('keeps the feed as the last panel wider than a phone', async () => {
    stubWidth(false);
    const { host } = await render();

    expect(host.querySelector('app-disclosure')).toBeNull();
    const panels = [...host.querySelectorAll('section.panel')];
    expect(panels.at(-1)?.matches('section.feed')).toBe(true);
    expect(host.querySelectorAll('section.feed li.event')).toHaveLength(3);
  });

  it('says everyone is caught up when nothing waits', async () => {
    const { host, read } = await render(() => of(coachTodayView({ attention: [] })));

    expect(host.querySelector('li.need')).toBeNull();
    expect(read()).toContain('All caught up.');
    expect(read()).toContain('Nothing needs you today.');
    expect(read()).not.toContain('on track');
  });

  it('invites the first client in an empty coaching space instead of showing zeros', async () => {
    const { host, read } = await render(() => of(emptyCoachTodayView()));

    expect(host.querySelector('section.month, section.plan-list, section.feed')).toBeNull();
    expect(read()).toContain('Your coaching space is ready');
    expect(host.querySelector('app-empty-state a[href="/invitations"]')?.textContent).toContain(
      'Invite your first client',
    );
  });

  /**
   * Audit AUTH-16: a coach who joined somebody's team was told "Your coaching space is ready", as if
   * they had made it. The space is the owner's; their clients come from their own invitations or the
   * owner's hand.
   */
  it('welcomes a coach who joined a team to it, and says where their clients come from', async () => {
    const { host, read } = await render(() => of(emptyCoachTodayView()), 'Coach');

    expect(host.querySelector('section.month')).toBeNull();
    expect(host.querySelector('app-empty-state h2')?.textContent?.trim()).toBe(
      'Welcome to the team at Atlas Performance',
    );
    expect(read()).toContain(
      'Clients you invite are yours, and the owner can assign clients to you.',
    );
    expect(read()).not.toContain('Your coaching space is ready');
    expect(host.querySelector('app-empty-state a[href="/invitations"]')?.textContent?.trim()).toBe(
      'Invite a client',
    );
  });

  it('shows placeholders while loading and a retry when the read fails', async () => {
    const pending = new Subject<CoachTodayView>();
    let attempt = 0;
    const { fixture, host, read } = await render(() =>
      ++attempt === 1
        ? pending
        : attempt === 2
          ? throwError(() => new HttpErrorResponse({ status: 503 }))
          : of(coachTodayView()),
    );

    expect(host.querySelectorAll('app-skeleton').length).toBeGreaterThan(0);
    pending.error(new HttpErrorResponse({ status: 503 }));
    await settle(fixture);
    expect(read()).toContain('Today could not be loaded.');

    press(host, 'Try again');
    await settle(fixture);
    expect(read()).toContain('Today could not be loaded.');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelectorAll('li.need')).toHaveLength(7);
  });

  it('drops the previous workspace and reads the new one after a switch', async () => {
    const { fixture, host, api, tenant } = await render();
    api.getCoachToday.mockImplementation(() => of(coachTodayView({ attention: [] })));

    tenant.set('tenant-2');
    await settle(fixture);

    expect(api.getCoachToday).toHaveBeenCalledTimes(2);
    expect(host.querySelector('li.need')).toBeNull();
  });

  /**
   * Coach Today hears the phone (motion plan W6): a quiet re-read every 4 s while the tab is in
   * view, a workout a client just finished as a strip under the greeting and a highlighted row in
   * the feed, a message bumping the read at once. jsdom moves nothing, so every state is at once.
   * Today is rendered with the tab hidden (no timer armed on the real clock), then brought into
   * view on the faked one.
   */
  describe('hears the phone (W6)', () => {
    let visibility: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      visibility = vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden');
    });

    afterEach(() => {
      vi.useRealTimers();
      visibility.mockRestore();
    });

    /** `milliseconds` pass on the faked clock, and what they trigger settles. */
    async function pass(fixture: { detectChanges(): void }, milliseconds: number): Promise<void> {
      await vi.advanceTimersByTimeAsync(milliseconds);
      fixture.detectChanges();
      for (let index = 0; index < 4; index++) await Promise.resolve();
      fixture.detectChanges();
    }

    /** The tab comes into view on the faked clock: Today reads at once and starts its beat. */
    async function listen(fixture: { detectChanges(): void }): Promise<void> {
      vi.useFakeTimers();
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await pass(fixture, 0);
    }

    /** A workout Maya finished half a minute ago, as the feed's newest row. */
    function justFinished() {
      const base = coachTodayView();
      return coachTodayView({
        activity: [
          {
            ...base.activity[0],
            client: MAYA,
            subjectId: 'w-maya-now',
            title: 'Lower A',
            durationSeconds: 2520,
            occurredAtUtc: new Date(Date.now() - 30_000).toISOString(),
            personalRecords: [base.activity[0].personalRecords[0]],
          },
          ...base.activity,
        ],
      });
    }

    it('reads Today again every 4 seconds while in view, quietly, and animates nothing on a first read', async () => {
      const { fixture, host, api } = await render();
      expect(api.getCoachToday).toHaveBeenCalledTimes(1);
      expect(host.querySelector('.live-dot')).toBeNull();

      await listen(fixture);
      expect(api.getCoachToday).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.live-dot')).not.toBeNull();
      expect(host.querySelector('.arrival')).toBeNull();

      await pass(fixture, 3999);
      expect(api.getCoachToday).toHaveBeenCalledTimes(2);
      await pass(fixture, 1);
      expect(api.getCoachToday).toHaveBeenCalledTimes(3);
      await pass(fixture, 4000);
      expect(api.getCoachToday).toHaveBeenCalledTimes(4);
      // The view stayed: no placeholder, no failure, and the known rows raised no strip.
      expect(host.querySelector('app-skeleton')).toBeNull();
      expect(host.querySelector('.arrival')).toBeNull();
      expect(host.querySelectorAll('li.need')).toHaveLength(7);
      expect(host.querySelector('li.event.arrived')).toBeNull();
    });

    it('lands a workout finished on the phone as a strip under the greeting and a row in the feed, once', async () => {
      let reads = 0;
      const { fixture, host, api } = await render(() =>
        of(++reads >= 3 ? justFinished() : coachTodayView()),
      );
      await listen(fixture);
      expect(host.querySelector('.arrival')).toBeNull();

      await pass(fixture, 4000);
      expect(api.getCoachToday).toHaveBeenCalledTimes(3);
      const strip = host.querySelector<HTMLElement>('.arrival')!;
      expect(strip).not.toBeNull();
      expect(strip.previousElementSibling?.matches('[role="status"]')).toBe(true);
      expect(squash(strip.querySelector('app-avatar')?.textContent)).toBe('MF');
      expect(squash(strip.querySelector('.arrival-copy')?.textContent)).toBe(
        'Just now: Maya Fakhoury finished Lower A in 42 min · 1 record',
      );
      expect(strip.querySelector('a.arrival-link')?.getAttribute('href')).toBe(
        '/clients/c-maya/training',
      );
      expect(strip.querySelector('button.arrival-dismiss')?.getAttribute('aria-label')).toBe(
        'Dismiss',
      );
      expect(squash(host.querySelector('[role="status"]')?.textContent)).toBe(
        'Maya Fakhoury finished Lower A in 42 min · 1 record',
      );
      const row = host.querySelector<HTMLElement>('li.event')!;
      expect(row.dataset['key']).toBe('WorkoutCompleted:w-maya-now');
      expect(row.classList).toContain('arrived');
      expect(squash(row.textContent)).toContain('Maya Fakhoury finished Lower A in 42 min');

      // The next read knows the row: nothing is raised again.
      await pass(fixture, 4000);
      expect(api.getCoachToday).toHaveBeenCalledTimes(4);
      expect(host.querySelectorAll('.arrival')).toHaveLength(1);
      expect(host.querySelectorAll('li.event.arrived')).toHaveLength(1);

      // Dismiss takes the strip away at once here (no motion), and clears the live region.
      strip.querySelector<HTMLButtonElement>('button.arrival-dismiss')!.click();
      fixture.detectChanges();
      expect(host.querySelector('.arrival')).toBeNull();
      expect(squash(host.querySelector('[role="status"]')?.textContent)).toBe('');
    });

    it('takes the strip away on its own after a minute', async () => {
      let reads = 0;
      const { fixture, host } = await render(() =>
        of(++reads >= 3 ? justFinished() : coachTodayView()),
      );
      await listen(fixture);
      await pass(fixture, 4000);
      expect(host.querySelector('.arrival')).not.toBeNull();

      await pass(fixture, 59_000);
      expect(host.querySelector('.arrival')).not.toBeNull();
      await pass(fixture, 1000);
      expect(host.querySelector('.arrival')).toBeNull();
    });

    it('keeps the view when a quiet read fails, and tries again after 15 seconds', async () => {
      let reads = 0;
      const { fixture, host, api, read } = await render(() =>
        ++reads === 3
          ? throwError(() => new HttpErrorResponse({ status: 503 }))
          : of(coachTodayView()),
      );
      await listen(fixture);

      await pass(fixture, 4000);
      expect(api.getCoachToday).toHaveBeenCalledTimes(3);
      expect(host.querySelectorAll('li.need')).toHaveLength(7);
      expect(read()).not.toContain('Today could not be loaded.');
      expect(host.querySelector('.live-dot')).toBeNull();

      await pass(fixture, 14_999);
      expect(api.getCoachToday).toHaveBeenCalledTimes(3);
      await pass(fixture, 1);
      expect(api.getCoachToday).toHaveBeenCalledTimes(4);
      expect(host.querySelector('.live-dot')).not.toBeNull();
    });

    it('stops reading while the tab is hidden, and reads at once when it is back', async () => {
      const { fixture, host, api } = await render();
      await listen(fixture);
      expect(api.getCoachToday).toHaveBeenCalledTimes(2);

      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(host.querySelector('.live-dot')).toBeNull();
      await pass(fixture, 30_000);
      expect(api.getCoachToday).toHaveBeenCalledTimes(2);

      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await pass(fixture, 0);
      expect(api.getCoachToday).toHaveBeenCalledTimes(3);
      expect(host.querySelector('.live-dot')).not.toBeNull();
    });

    it('reads at once when a message lands, and slows to a minute after fifteen quiet minutes', async () => {
      const { fixture, api, bumps } = await render();
      await listen(fixture);

      await pass(fixture, 1000);
      bumps.set(1);
      fixture.detectChanges();
      await pass(fixture, 0);
      expect(api.getCoachToday).toHaveBeenCalledTimes(3);

      // Nothing touched for fifteen minutes: the beat becomes one a minute (two reads in the next
      // two minutes, against thirty at the 4 s beat).
      await pass(fixture, IDLE_AFTER_MS + 8000);
      const idle = api.getCoachToday.mock.calls.length;
      await pass(fixture, 120_000);
      expect(api.getCoachToday.mock.calls.length - idle).toBeGreaterThanOrEqual(1);
      expect(api.getCoachToday.mock.calls.length - idle).toBeLessThanOrEqual(3);

      // A key press brings the 4 s beat back from the next read on.
      document.dispatchEvent(new Event('keydown'));
      await pass(fixture, 60_000);
      const awake = api.getCoachToday.mock.calls.length;
      await pass(fixture, 20_000);
      expect(api.getCoachToday.mock.calls.length - awake).toBeGreaterThanOrEqual(4);
    });

    it('keeps a resolved Needs-you row in place, leaving, until its slide out has ended', async () => {
      // A browser that moves: Element.animate hands back a clock the test settles by hand.
      const settles: (() => void)[] = [];
      Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: vi.fn(() => {
          let settle: () => void = () => undefined;
          const finished = new Promise<void>((resolve) => {
            settle = resolve;
          });
          settles.push(settle);
          return { finished, cancel: vi.fn() };
        }),
      });
      try {
        let reads = 0;
        const base = coachTodayView();
        const { fixture, host } = await render(
          () => of(++reads >= 3 ? coachTodayView({ attention: base.attention.slice(1) }) : base),
          'Owner',
          undefined,
          { motionAllowed: true },
        );
        await listen(fixture);
        expect(host.querySelectorAll('li.need')).toHaveLength(7);

        // The third read has no check-in from Maya any more: her row stays, leaving, first.
        await pass(fixture, 4000);
        const rows = host.querySelectorAll<HTMLElement>('li.need');
        expect(rows).toHaveLength(7);
        expect(rows[0].classList).toContain('leaving');
        expect(rows[0].dataset['kind']).toBe('CheckInToReview');
        expect(host.querySelector('#needs-heading .badge')?.textContent?.trim()).toBe('6');
        expect(settles).toHaveLength(1);

        // The slide ends, the collapse runs, and only then does the list close over it.
        settles[0]();
        await pass(fixture, 0);
        expect(settles).toHaveLength(2);
        expect(host.querySelectorAll('li.need')).toHaveLength(7);
        settles[1]();
        await pass(fixture, 0);
        expect(host.querySelectorAll('li.need')).toHaveLength(6);
        expect(host.querySelector('li.need.leaving')).toBeNull();
        expect(host.querySelector<HTMLElement>('li.need')?.dataset['kind']).toBe('UnreadMessages');
      } finally {
        delete (Element.prototype as { animate?: unknown }).animate;
      }
    });

    it('closes the list over a resolved row at once where motion is not allowed', async () => {
      let reads = 0;
      const base = coachTodayView();
      const { fixture, host } = await render(() =>
        of(++reads >= 3 ? coachTodayView({ attention: base.attention.slice(1) }) : base),
      );
      await listen(fixture);
      await pass(fixture, 4000);
      expect(host.querySelectorAll('li.need')).toHaveLength(6);
      expect(host.querySelector('li.need.leaving')).toBeNull();
    });

    it('stops hearing the phone when it is destroyed', async () => {
      const { fixture, api } = await render();
      await listen(fixture);
      expect(api.getCoachToday).toHaveBeenCalledTimes(2);
      fixture.destroy();

      await vi.advanceTimersByTimeAsync(20_000);
      expect(api.getCoachToday).toHaveBeenCalledTimes(2);
    });
  });
});
