import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { OwnPlansView, OwnPlanView, OwnSessionsView } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { click, settle } from '../../../testing/dom';
import { ClientPlanPage } from './client-plan';

const TODAY = '2026-10-15';

function plan(overrides: Partial<OwnPlanView> = {}): OwnPlanView {
  return {
    id: 'plan-1',
    name: 'Online Coaching',
    optionLabel: '12 weeks',
    description: 'Your own program.\nAsk me anything.',
    startDate: '2026-10-05',
    lastDay: '2026-12-27',
    cancelledOn: null,
    status: 'Active',
    features: ['Training', 'Nutrition'],
    ...overrides,
  };
}

const view = (...plans: OwnPlanView[]): OwnPlansView => ({
  today: TODAY,
  plans,
  coachName: 'Karim Haddad',
});

const sessions = (fields: Partial<OwnSessionsView> = {}): OwnSessionsView => ({
  count: 10,
  left: 8,
  used: 2,
  lapsed: 0,
  lapsedOn: null,
  sessions: [
    { day: '2026-10-13', outcome: 'Charged', reason: 'No-show: you didn’t come' },
    { day: '2026-10-09', outcome: 'Held', reason: null },
  ],
  ...fields,
});

const pack = (fields: Partial<OwnPlanView> = {}) =>
  plan({
    id: 'pack-1',
    name: 'Personal training',
    optionLabel: '10 sessions',
    description: null,
    lastDay: '2027-01-09',
    features: ['Sessions'],
    sessions: sessions(),
    ...fields,
  });

async function render(answer: () => ReturnType<ApiClient['getOwnPlans']>) {
  const api = { getOwnPlans: vi.fn(answer) };
  const selectedTenantId = signal<string | null>('tenant-atlas');
  await TestBed.configureTestingModule({
    imports: [ClientPlanPage],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientPlanPage);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, selectedTenantId };
}

const text = (host: Element) => host.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('ClientPlanPage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads the plan: its name, its price’s name, the dates and where it stands', async () => {
    const { host } = await render(() => of(view(plan())));

    const card = host.querySelector('section.plan')!;
    expect(card.getAttribute('aria-labelledby')).toBe(
      `${card.querySelector('h2')!.id} ${card.querySelector('.plan-when')!.id}`,
    );
    expect(text(card.querySelector('h2')!)).toBe('Online Coaching');
    expect(text(card.querySelector('.plan-when')!)).toBe('12 weeks · Mon 5 Oct – Sun 27 Dec');
    expect(text(card.querySelector('app-status-pill')!)).toBe('Active · 73 days left');
  });

  it('lists what’s included and the coach’s description in the lines they wrote', async () => {
    const { host } = await render(() => of(view(plan())));

    expect([...host.querySelectorAll('h3')].map(text)).toEqual([
      'What’s included',
      'About this plan',
    ]);
    expect([...host.querySelectorAll('.includes li')].map(text)).toEqual(['Training', 'Nutrition']);
    expect(host.querySelector('.description')!.textContent).toBe(
      'Your own program.\nAsk me anything.',
    );
    expect(host.querySelector('.description')!.getAttribute('dir')).toBe('auto');
  });

  it('leaves the description’s part out when the coach wrote none', async () => {
    const { host } = await render(() => of(view(plan({ description: null }))));

    expect([...host.querySelectorAll('h3')].map(text)).toEqual(['What’s included']);
    expect(host.querySelector('.description')).toBeNull();
  });

  it('shows each plan the server sends, in its order', async () => {
    const { host } = await render(() =>
      of(
        view(
          plan(),
          plan({
            id: 'plan-2',
            name: 'Next block',
            status: 'PendingPayment',
            startDate: '2026-12-28',
          }),
        ),
      ),
    );

    expect([...host.querySelectorAll('section.plan h2')].map(text)).toEqual([
      'Online Coaching',
      'Next block',
    ]);
    expect(text(host.querySelectorAll('.plan-note')[0])).toBe(
      'It starts once your coach has your payment.',
    );
  });

  it('sends a plan that ran out on to Today, and no other', async () => {
    const { host } = await render(() => of(view(plan({ status: 'Expired' }))));

    expect(text(host.querySelector('.plan-note')!)).toBe(
      'If you’d like to keep going, ask your coach to renew it.',
    );
    expect(host.querySelector<HTMLAnchorElement>('a.plan-action')!.getAttribute('href')).toBe('/');
    TestBed.resetTestingModule();

    const running = await render(() => of(view(plan())));
    expect(running.host.querySelector('a.plan-action')).toBeNull();
  });

  it('says what is left on a pack, on the card, with whom and until when', async () => {
    const { host } = await render(() => of(view(pack())));

    expect(text(host.querySelector('.plan-sessions')!)).toBe(
      '8 of 10 sessions with Karim left, until 9 January',
    );
    expect(host.querySelector('.plan-head .plan-sessions')).not.toBeNull();
  });

  it('lists what happened to each session, newest first, with a charge’s reason', async () => {
    const { host } = await render(() => of(view(pack())));

    const rows = Array.from(host.querySelectorAll('.sessions li'));
    expect(rows.map(text)).toEqual([
      'Tue 13 Oct Charged No-show: you didn’t come',
      'Fri 9 Oct Held',
    ]);
    expect(rows[0].querySelector('.session-reason')?.getAttribute('dir')).toBe('auto');
    expect(host.querySelector('.sessions-toggle')).toBeNull();
    expect(text(host)).toContain('Sessions so far');
  });

  it('shows a pack’s newest five, and the rest on request', async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      day: `2026-10-${String(14 - index).padStart(2, '0')}`,
      outcome: 'Held' as const,
      reason: null,
    }));
    const { fixture, host } = await render(() =>
      of(view(pack({ sessions: sessions({ left: 3, used: 7, sessions: many }) }))),
    );

    const list = host.querySelector('.sessions')!;
    expect(list.querySelectorAll('li')).toHaveLength(5);
    const toggle = host.querySelector<HTMLButtonElement>('.sessions-toggle')!;
    expect(text(toggle)).toBe('Show all 7');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(list.id);

    toggle.click();
    await settle(fixture);

    expect(list.querySelectorAll('li')).toHaveLength(7);
    expect(text(toggle)).toBe('Show less');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the list out until a session has counted', async () => {
    const { host } = await render(() =>
      of(view(pack({ sessions: sessions({ left: 10, used: 0, sessions: [] }) }))),
    );

    expect(text(host.querySelector('.plan-sessions')!)).toBe(
      '10 of 10 sessions with Karim left, until 9 January',
    );
    expect(host.querySelector('.sessions')).toBeNull();
    expect(text(host)).not.toContain('Sessions so far');
  });

  it('says nothing of sessions on a coaching plan or a pack waiting for payment', async () => {
    const { host } = await render(() =>
      of(
        view(
          plan({ sessions: null }),
          pack({
            status: 'PendingPayment',
            sessions: sessions({ left: 0, used: 0, sessions: [] }),
          }),
        ),
      ),
    );

    expect(host.querySelector('.plan-sessions')).toBeNull();
    expect(host.querySelector('.sessions')).toBeNull();
    expect(text(host)).toContain('It starts once your coach has your payment.');
  });

  it('says what became of a pack that is over, and keeps what happened', async () => {
    const { host } = await render(() =>
      of(
        view(
          pack({
            status: 'Expired',
            lastDay: '2026-10-14',
            sessions: sessions({ left: 8, lapsed: 8, lapsedOn: '2026-10-14' }),
          }),
        ),
      ),
    );

    expect(text(host.querySelector('.plan-sessions')!)).toBe(
      '2 of 10 sessions with Karim used, and 8 lapsed on 14 October',
    );
    expect(host.querySelectorAll('.sessions li')).toHaveLength(2);
    expect(host.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('says so when there is no plan yet', async () => {
    const { host } = await render(() => of(view()));

    expect(text(host.querySelector('app-empty-state h2')!)).toBe('No plan yet');
    expect(text(host.querySelector('app-empty-state p')!)).toBe(
      'Your coach will put your plan here.',
    );
  });

  it('shows a skeleton while it reads, then the plan', async () => {
    const reply = new Subject<OwnPlansView>();
    const { fixture, host } = await render(() => reply);

    expect(host.querySelector('[aria-busy="true"] app-skeleton')).not.toBeNull();
    expect(host.querySelector('section.plan')).toBeNull();

    reply.next(view(plan()));
    reply.complete();
    await settle(fixture);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.querySelector('section.plan')).not.toBeNull();
  });

  it('says it could not be read and reads it again on Try again', async () => {
    let refused = true;
    const { fixture, host, api } = await render(() =>
      refused ? throwError(() => new Error('down')) : of(view(plan())),
    );

    expect(text(host.querySelector('[role="alert"]')!)).toBe('Your plan couldn’t be loaded.');
    refused = false;
    click(host, '.load-failed button');
    await settle(fixture);

    expect(api.getOwnPlans).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('section.plan')).not.toBeNull();
  });

  it('reads the new coach’s plan after a switch and drops the late answer of the old', async () => {
    const atlas = new Subject<OwnPlansView>();
    const barbell = new Subject<OwnPlansView>();
    const replies = [atlas, barbell];
    const { fixture, host, selectedTenantId } = await render(() => replies.shift()!);

    selectedTenantId.set('tenant-barbell');
    await settle(fixture);
    atlas.next(view(plan({ name: 'From the old coach' })));
    atlas.complete();
    await settle(fixture);
    expect(text(host)).not.toContain('From the old coach');

    barbell.next(view(plan({ name: 'From the new coach' })));
    barbell.complete();
    await settle(fixture);
    expect(text(host.querySelector('section.plan h2')!)).toBe('From the new coach');
  });

  it('points back to Me', async () => {
    const { host } = await render(() => of(view()));

    expect(host.querySelector('a.back')!.getAttribute('href')).toBe('/me');
  });
});
