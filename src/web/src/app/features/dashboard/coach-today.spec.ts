import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CoachTodayView } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import {
  attentionItem,
  coachTodayView,
  emptyCoachTodayView,
  JAD,
  MAYA,
  OWNER_ID,
  SARA,
} from '../../../testing/coach-today-fixtures';
import { ConversationStarter } from '../messaging/conversation-starter';
import { CoachToday } from './coach-today';

async function render(
  getCoachToday: () => unknown = () => of(coachTodayView()),
  role: 'Owner' | 'Coach' = 'Owner',
  starter: { open: ReturnType<typeof vi.fn> } = { open: vi.fn().mockResolvedValue(true) },
) {
  const tenant = signal<string | null>('tenant-1');
  const membership = signal({ tenantId: 'tenant-1', tenantName: 'Atlas Performance', role });
  const api = { getCoachToday: vi.fn(getCoachToday) };
  await TestBed.configureTestingModule({
    imports: [CoachToday],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ConversationStarter, useValue: starter },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: tenant, selectedMembership: membership },
      },
      {
        provide: AuthStore,
        useValue: { user: signal({ id: OWNER_ID, displayName: 'Karim Haddad' }) },
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
    read: () => (host.textContent ?? '').replace(/\s+/g, ' '),
  };
}

const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

describe('CoachToday', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
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

  it('shows three tiles with their context and the faces waiting', async () => {
    const { host } = await render();

    const tiles = [...host.querySelectorAll('app-stat-tile')].map((tile) =>
      (tile.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(tiles[0]).toContain('Clients');
    expect(tiles[0]).toContain('12');
    expect(tiles[0]).toContain('7 have something for you today');
    expect(tiles[1]).toContain('10 of 27');
    expect(tiles[1]).toContain('15 were due by today');
    expect(tiles[2]).toContain('3');
    expect(tiles[2]).toContain('1 client asked to renew');
    expect(host.querySelector('app-avatar-stack')).not.toBeNull();
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

  it('starts the feed with the newest six and opens the rest on request', async () => {
    const base = coachTodayView();
    const activity = Array.from({ length: 9 }, (_, index) => ({
      ...base.activity[2],
      subjectId: `w-${index}`,
    }));
    const { fixture, host } = await render(() => of(coachTodayView({ activity })));

    expect(host.querySelectorAll('li.event')).toHaveLength(6);
    const toggle = host.querySelector<HTMLButtonElement>('button.feed-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('coach-activity');

    press(host, 'Show all 9');
    await settle(fixture);
    expect(host.querySelectorAll('li.event')).toHaveLength(9);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    press(host, 'Show less');
    await settle(fixture);
    expect(host.querySelectorAll('li.event')).toHaveLength(6);
  });

  it('offers no toggle when the feed already fits', async () => {
    const { host } = await render();

    expect(host.querySelector('button.feed-toggle')).toBeNull();
  });

  it('draws the week as seven bars with a table behind them for screen readers', async () => {
    const { host } = await render();

    expect(host.querySelectorAll('.bars .bar')).toHaveLength(7);
    expect(host.querySelector('.bars')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll('.week table tbody tr')).toHaveLength(7);
    expect(host.querySelector('.week-number')?.textContent?.trim()).toBe('10 of 27');
  });

  it('says everyone is caught up when nothing waits', async () => {
    const { host, read } = await render(() => of(coachTodayView({ attention: [] })));

    expect(host.querySelector('li.need')).toBeNull();
    expect(read()).toContain('All caught up.');
    expect(read()).toContain('Nothing needs you today.');
    expect(read()).toContain('Nothing waiting for you today');
    expect(read()).not.toContain('on track');
  });

  it('invites the first client in an empty coaching space instead of showing zeros', async () => {
    const { host, read } = await render(() => of(emptyCoachTodayView()));

    expect(host.querySelector('app-stat-tile')).toBeNull();
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

    expect(host.querySelector('app-stat-tile')).toBeNull();
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
});
