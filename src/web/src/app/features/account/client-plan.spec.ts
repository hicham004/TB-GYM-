import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  HousePlanAskView,
  HousePlanOfferView,
  HousePlansView,
  OwnFreePlanView,
  OwnPlansView,
  OwnPlanView,
  OwnSessionsView,
  RenewalStatusView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { UiToast } from '../../ui/toast';
import { button, click, fill, formSummary, press, settle } from '../../../testing/dom';
import { ClientPlanPage } from './client-plan';
import { HousePlansApi } from './house-plans-api';
import { toHouseAsk, toHousePlans, type HouseAsk } from './house-plans.models';

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

const renewal = (fields: Partial<RenewalStatusView> = {}): RenewalStatusView => ({
  planEnded: true,
  endedOn: '2026-10-14',
  endsOn: null,
  planId: 'plan-1',
  coachName: 'Karim Haddad',
  lastRequest: null,
  canAsk: true,
  ...fields,
});

const ending = (fields: Partial<RenewalStatusView> = {}) =>
  renewal({ planEnded: false, endedOn: null, endsOn: '2026-10-17', ...fields });

const sentRequest = {
  id: 'request-1',
  requestedOn: '2026-10-15',
  askAgainFrom: '2026-10-22',
};

async function render(
  answer: () => ReturnType<ApiClient['getOwnPlans']>,
  more: Partial<Record<'requestRenewal' | 'getOwnRenewalStatus', ReturnType<typeof vi.fn>>> = {},
  house: Partial<Record<'plans' | 'ask' | 'moneySent', ReturnType<typeof vi.fn>>> = {},
) {
  const api = {
    getOwnPlans: vi.fn(answer),
    requestRenewal: vi.fn(() => of(renewal({ canAsk: false, lastRequest: sentRequest }))),
    getOwnRenewalStatus: vi.fn(() => of(renewal())),
    ...more,
  };
  // Only a trainee of the house reads what it sells; a coach's client never calls these.
  const housePlans = {
    plans: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    ask: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    moneySent: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    ...house,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  const toast = { show: vi.fn() };
  const selectedTenantId = signal<string | null>('tenant-atlas');
  await TestBed.configureTestingModule({
    imports: [ClientPlanPage],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: HousePlansApi, useValue: housePlans },
      { provide: CsrfService, useValue: csrf },
      { provide: UiToast, useValue: toast },
      { provide: TenantStore, useValue: { selectedTenantId } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientPlanPage);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api,
    housePlans,
    csrf,
    toast,
    selectedTenantId,
  };
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

  describe('Ask to renew (critique B14)', () => {
    const over = () => plan({ status: 'Expired', lastDay: '2026-10-14' });
    const withRenewal = (status: RenewalStatusView, ...plans: OwnPlanView[]) => ({
      ...view(...plans),
      renewal: status,
    });
    const ask = (host: Element) =>
      [...host.querySelectorAll<HTMLButtonElement>('app-renewal-ask button')].filter((button) =>
        button.textContent?.includes('Ask to renew'),
      );

    it('stands in for Go to Today on a plan that ran out, the same request as Today’s', async () => {
      const { fixture, host, api } = await render(() => of(withRenewal(renewal(), over())));

      expect(host.querySelector('a.plan-action')).toBeNull();
      expect(text(host.querySelector('.plan-note')!)).toBe(
        'If you’d like to keep going, ask your coach to renew it.',
      );
      expect(ask(host)).toHaveLength(1);
      expect(ask(host)[0].classList).toContain('tb-button--accent');

      ask(host)[0].click();
      await settle(fixture);

      expect(api.requestRenewal).toHaveBeenCalledTimes(1);
      expect(text(host.querySelector('app-renewal-ask [role="status"]')!)).toBe(
        'Renewal request sent on Thu 15 Oct. You can ask again from Thu 22 Oct.',
      );
      expect(ask(host)).toHaveLength(0);
      // The answer replaces the invitation, and Today is not offered in its place.
      expect(host.querySelector('.plan-note')).toBeNull();
      expect(host.querySelector('a.plan-action')).toBeNull();
    });

    it('says when the plan ends and with whom, in its last days', async () => {
      const { host } = await render(() =>
        of(withRenewal(ending(), plan({ lastDay: '2026-10-17' }))),
      );

      expect(text(host.querySelector('.plan-note')!)).toBe(
        'Your coaching plan with Karim ends on Sat 17 Oct.',
      );
      expect(host.querySelector('.plan-note bdi')?.getAttribute('dir')).toBe('auto');
      expect(ask(host)).toHaveLength(1);
    });

    it('leaves the coach out when they have no name', async () => {
      const { host } = await render(() =>
        of(withRenewal(ending({ coachName: null }), plan({ lastDay: '2026-10-17' }))),
      );

      expect(text(host.querySelector('.plan-note')!)).toBe(
        'Your coaching plan ends on Sat 17 Oct.',
      );
    });

    it('asks nothing more of a pack, whose own line says when it ends', async () => {
      const { host } = await render(() =>
        of(withRenewal(ending({ planId: 'pack-1' }), pack({ lastDay: '2026-10-17' }))),
      );

      expect(text(host.querySelector('.plan-sessions')!)).toBe(
        '8 of 10 sessions with Karim left, until 17 October',
      );
      expect(host.querySelector('.plan-note')).toBeNull();
      expect(ask(host)).toHaveLength(1);
    });

    it('sits on the plan it is about, and no other', async () => {
      const { host } = await render(() =>
        of(withRenewal(renewal(), over(), pack({ status: 'Active' }))),
      );

      const [first, second] = [...host.querySelectorAll('section.plan')];
      expect(first.querySelector('app-renewal-ask')).not.toBeNull();
      expect(second.querySelector('app-renewal-ask')).toBeNull();
    });

    it('sends nobody to Today from another ended plan while the ask is on the page', async () => {
      const { host } = await render(() =>
        of(withRenewal(renewal(), over(), pack({ status: 'Expired' }))),
      );

      expect(host.querySelector('a.plan-action')).toBeNull();
      expect(ask(host)).toHaveLength(1);
    });

    it('shows the answer in place of the button while a request stands', async () => {
      const { host } = await render(() =>
        of(withRenewal(renewal({ canAsk: false, lastRequest: sentRequest }), over())),
      );

      expect(ask(host)).toHaveLength(0);
      expect(text(host.querySelector('app-renewal-ask [role="status"]')!)).toContain(
        'You can ask again from Thu 22 Oct.',
      );
    });

    it('shows the plan as it is when the server refuses the ask', async () => {
      const { fixture, host, api } = await render(
        () => of(withRenewal(ending(), plan({ lastDay: '2026-10-17' }))),
        {
          requestRenewal: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409 }))),
          getOwnRenewalStatus: vi.fn(() =>
            of(renewal({ planEnded: false, endedOn: null, planId: null, canAsk: false })),
          ),
        },
      );

      ask(host)[0].click();
      await settle(fixture);

      expect(api.getOwnRenewalStatus).toHaveBeenCalledTimes(1);
      expect(host.querySelector('app-renewal-ask')).toBeNull();
      expect(host.querySelector('.plan-note')).toBeNull();
    });

    it('says the request failed, in words that read on the brand colour', async () => {
      const { fixture, host } = await render(() => of(withRenewal(renewal(), over())), {
        requestRenewal: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
      });

      ask(host)[0].click();
      await settle(fixture);

      expect(text(host.querySelector('app-renewal-ask [role="alert"]')!)).toBe(
        'Couldn’t send your request. Try again.',
      );
      expect(host.querySelector('app-renewal-ask')?.classList).toContain('on-brand');
      expect(ask(host)).toHaveLength(1);
    });

    it('offers nothing on a plan the server says cannot ask', async () => {
      const { host } = await render(() =>
        of({ ...view(plan()), renewal: renewal({ planId: null, canAsk: false }) }),
      );

      expect(host.querySelector('app-renewal-ask')).toBeNull();
    });
  });

  it('sends a plan that ran out on to Today where it cannot be asked about here', async () => {
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

  it('never reads the plans TB Gym sells for a coach’s client', async () => {
    const { host, housePlans } = await render(() => of(view(plan())));

    expect(housePlans.plans).not.toHaveBeenCalled();
    expect(text(host.querySelector('.lede')!)).toBe('What’s in your plan and the dates it runs.');
    expect(host.querySelector('[data-free], [data-open-ask], [data-plans-to-add]')).toBeNull();
  });
});

// ---------- a self-directed trainee of TB Gym's own space (notes plan N9c2) ----------

const FREE: OwnFreePlanView = {
  name: 'Free',
  since: '2026-10-01',
  status: 'Active',
  features: ['Training'],
};

const traineeView = (...plans: OwnPlanView[]): OwnPlansView => ({
  today: TODAY,
  plans,
  coachName: null,
  renewal: null,
  tier: 'Free',
  free: FREE,
});

function offerView(overrides: Partial<HousePlanOfferView> = {}): HousePlanOfferView {
  return {
    offerId: 'offer-4w',
    productId: 'pro-plus',
    tier: 'ProPlus',
    name: 'Pro+',
    description: 'A program written for you by TB Gym, changed each block.',
    optionLabel: '4 weeks',
    priceAmount: '47.5',
    priceCurrency: 'USD',
    durationCount: 4,
    durationUnit: 'Week',
    features: ['Training', 'CheckIns'],
    ...overrides,
  };
}

const EIGHT_WEEKS = offerView({
  offerId: 'offer-8w',
  optionLabel: 'Two blocks',
  priceAmount: 89.75,
  durationCount: 8,
});

function askView(overrides: Partial<HousePlanAskView> = {}): HousePlanAskView {
  return {
    id: 'ask-1',
    offerId: 'offer-8w',
    tier: 'ProPlus',
    planName: 'Pro+',
    optionLabel: 'Two blocks',
    priceAmount: 89.75,
    priceCurrency: 'USD',
    durationCount: 8,
    durationUnit: 'Week',
    askedOn: TODAY,
    state: 'Asked',
    moneySent: null,
    outcome: null,
    ...overrides,
  };
}

const houseRead = (overrides: Partial<HousePlansView> = {}) =>
  toHousePlans({
    today: TODAY,
    asksOpen: true,
    whishNumber: '+961 70 123456',
    plans: [offerView(), EIGHT_WEEKS],
    asks: [],
    ...overrides,
  });

const BOOKED = askView({
  id: 'ask-booked',
  offerId: 'offer-4w',
  optionLabel: '4 weeks',
  priceAmount: 47.5,
  durationCount: 4,
  askedOn: '2026-10-01',
  state: 'Booked',
  outcome: {
    kind: 'Booked',
    decidedOn: '2026-10-02',
    reason: null,
    enrollmentId: 'plan-1',
    planStartDate: '2026-10-02',
    planLastDay: '2026-10-29',
    decidedByName: null,
  },
});

const CLOSED = askView({
  id: 'ask-closed',
  askedOn: '2026-08-10',
  state: 'Closed',
  outcome: {
    kind: 'Closed',
    decidedOn: '2026-08-20',
    reason: 'No money came from that Whish account.',
    enrollmentId: null,
    planStartDate: null,
    planLastDay: null,
    decidedByName: null,
  },
});

/** The sheet, which the CDK draws outside the page. */
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');

async function renderTrainee(
  house: Partial<Record<'plans' | 'ask' | 'moneySent', ReturnType<typeof vi.fn>>> = {},
  ...plans: OwnPlanView[]
) {
  return render(
    () => of(traineeView(...plans)),
    {},
    { plans: vi.fn(() => of(houseRead())), ...house },
  );
}

describe('ClientPlanPage for a self-directed trainee (notes plan N9c2)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('shows Free alone while asks are switched off, and never a coach’s words', async () => {
    const { host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asksOpen: false, whishNumber: null, plans: [] }))),
    });

    expect(housePlans.plans).toHaveBeenCalledTimes(1);
    expect(text(host.querySelector('.lede')!)).toBe(
      'What you train on with TB Gym, and the dates each plan runs.',
    );
    const free = host.querySelector('section.plan[data-free]')!;
    expect(free.getAttribute('aria-labelledby')).toBe('free-name free-when');
    expect(text(free.querySelector('h2')!)).toBe('Free');
    expect(free.querySelector('h2')!.getAttribute('dir')).toBe('auto');
    expect(text(free.querySelector('app-status-pill')!)).toBe('No end date');
    expect(text(free.querySelector('.plan-when')!)).toBe('Since Thu 1 Oct');
    expect([...free.querySelectorAll('.plan-note')].map(text)).toEqual([
      'It never ends, and it keeps running beside any plan you add.',
    ]);
    expect([...free.querySelectorAll('.includes li')].map(text)).toEqual(['Training']);
    expect(host.querySelector('[data-plans-to-add]')).toBeNull();
    expect(host.querySelector('[data-open-ask], [data-earlier-asks]')).toBeNull();
    expect(text(host)).not.toContain('Plans you can add');
    expect(text(host)).not.toContain('Your coach will put your plan here.');
    expect(text(host)).not.toContain('No plan yet');
  });

  it('lists the plans on sale, grouped, with an Ask for on each option', async () => {
    const { host } = await renderTrainee();

    const section = host.querySelector('[data-plans-to-add]')!;
    expect(text(section.querySelector('h2')!)).toBe('Plans you can add');
    expect(text(section.querySelector('.house-head .quiet')!)).toBe(
      'Pay by Whish. A plan starts once TB Gym has your money, or when your current plan ends if that is later. Free keeps running underneath.',
    );
    const offers = [...section.querySelectorAll('article.offer')];
    expect(offers).toHaveLength(1);
    expect(text(offers[0].querySelector('h3')!)).toBe('Pro+');
    expect(text(offers[0].querySelector('.description')!)).toBe(
      'A program written for you by TB Gym, changed each block.',
    );
    expect([...offers[0].querySelectorAll('.includes li')].map(text)).toEqual([
      'Training',
      'Check-ins',
    ]);
    expect([...offers[0].querySelectorAll('.option-text')].map(text)).toEqual([
      '4 weeks USD 47.50',
      'Two blocks 8 weeks USD 89.75',
    ]);
    const buttons = [...offers[0].querySelectorAll<HTMLButtonElement>('.option button')];
    expect(buttons.map(text)).toEqual(['Ask for 4 weeks', 'Ask for Two blocks']);
    // The name starts with the words on the button, so voice control finds it (WCAG 2.5.3).
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Ask for 4 weeks, Pro+',
      'Ask for Two blocks, Pro+',
    ]);
    // The order: Free, then what can be added.
    const order = [...host.querySelectorAll('[data-free], [data-plans-to-add]')];
    expect(order.map((node) => node.hasAttribute('data-free'))).toEqual([true, false]);
  });

  it('asks for an option after a confirmation, then shows the ask at the top with focus', async () => {
    const asked = toHouseAsk(askView());
    const { fixture, host, housePlans, csrf } = await renderTrainee({
      ask: vi.fn(() => of(asked)),
    });

    press(host, 'Ask for Two blocks');
    await settle(fixture);
    const opened = sheet()!;
    expect(text(opened.querySelector('.tb-modal__title')!)).toBe('Ask for Pro+');
    expect(text(opened.querySelector('[data-ask-choice]')!)).toBe(
      'Two blocks · 8 weeks · USD 89.75',
    );
    expect(text(opened)).toContain(
      'You pay TB Gym by Whish, then tell us here. The plan starts once TB Gym has your money, or when your current plan ends if that is later. Free keeps running underneath.',
    );
    expect(text(opened)).toContain(
      'You can ask for something else once TB Gym books or closes this ask.',
    );
    // Words alone in the sheet's body, its buttons in the footer: one focusable region a keyboard scrolls.
    const words = opened.querySelector<HTMLElement>('[data-ask-words]')!;
    expect(words.getAttribute('tabindex')).toBe('0');
    expect(words.getAttribute('role')).toBe('region');
    expect(words.getAttribute('aria-label')).toBe('The plan you ask for');
    expect(words.querySelector('[data-ask-choice]')).not.toBeNull();
    expect(text(words)).toContain('Free keeps running underneath.');
    expect(words.querySelector('button, app-form-summary')).toBeNull();

    press(opened, 'Ask for it');
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalled();
    expect(housePlans.ask).toHaveBeenCalledExactlyOnceWith('offer-8w');
    expect(sheet()).toBeNull();
    const card = host.querySelector('section.plan[data-open-ask]')!;
    expect(host.querySelector('section.plan')).toBe(card);
    expect(text(card.querySelector('h2')!)).toBe('Your ask');
    expect(text(card.querySelector('app-status-pill')!)).toBe('Waiting for your payment');
    expect(text(card.querySelector('#ask-line')!)).toBe('Pro+, Two blocks · USD 89.75 for 8 weeks');
    const news = card.querySelector<HTMLElement>('.ask-news')!;
    expect(news.getAttribute('role')).toBe('status');
    expect(text(news)).toBe('Asked. Send the money by Whish, then tell TB Gym here.');
    expect(document.activeElement).toBe(news);
    expect(text(card.querySelector('.whish .plan-note')!)).toBe(
      'Send USD 89.75 by Whish to +961 70 123456, then tell TB Gym you sent it.',
    );
    expect(text(card.querySelector('.whish [data-copy-whish]')!)).toBe('Copy the Whish number');
    expect(card.querySelector('.whish-number')!.getAttribute('dir')).toBe('ltr');
    expect(card.querySelector('.whish-number')!.getAttribute('translate')).toBe('no');
    expect(text(card)).toContain('Nothing changes until TB Gym books it. Free keeps running.');
    expect(card.querySelector('[data-paid]')!.classList).toContain('tb-button--accent');
    // One ask at a time: nothing more to ask for until TB Gym books or closes it.
    expect(host.querySelector('[data-plans-to-add]')).toBeNull();
  });

  it('asks nothing when the trainee says Not now', async () => {
    const { fixture, host, housePlans } = await renderTrainee();

    press(host, 'Ask for 4 weeks');
    await settle(fixture);
    press(sheet()!, 'Not now');
    await settle(fixture);

    expect(sheet()).toBeNull();
    expect(housePlans.ask).not.toHaveBeenCalled();
    expect(housePlans.plans).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-plans-to-add]')).not.toBeNull();
  });

  it('keeps the ask sheet open while the ask is on its way, so its answer lands in it', async () => {
    const answer = new Subject<HouseAsk>();
    const { fixture, host, housePlans } = await renderTrainee({ ask: vi.fn(() => answer) });

    press(host, 'Ask for Two blocks');
    await settle(fixture);
    press(sheet()!, 'Ask for it');
    await settle(fixture);
    expect(text(sheet()!)).toContain('Asking…');

    // A second tap, or the form sent again, asks nothing more.
    sheet()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    sheet()!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(housePlans.ask).toHaveBeenCalledTimes(1);

    // Neither Not now, the sheet's Close nor Escape ends it while the answer is on its way.
    press(sheet()!, 'Not now');
    sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(sheet()).not.toBeNull();
    expect(text(sheet()!)).toContain('Asking…');

    answer.next(toHouseAsk(askView()));
    answer.complete();
    await settle(fixture);

    expect(sheet()).toBeNull();
    const card = host.querySelector('[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Waiting for your payment');
    expect(document.activeElement).toBe(card.querySelector('.ask-news'));
  });

  it('says a refused ask in the server’s words, and reads the plans again once it closes', async () => {
    const message =
      'You already asked for Pro+, 4 weeks. TB Gym books it once your money is there, or closes the ask, before you can ask for anything else.';
    const reads = [houseRead(), houseRead({ asks: [askView({ offerId: 'offer-4w' })] })];
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(reads.shift()!)),
      ask: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({ status: 409, error: { code: 'house_plan_ask_open', message } }),
        ),
      ),
    });

    // Pressed from the keyboard: the sheet gives focus back to this button as it closes.
    const opener = button(host, 'Ask for Two blocks');
    opener.focus();
    opener.click();
    await settle(fixture);
    press(sheet()!, 'Ask for it');
    await settle(fixture);

    const summary = formSummary(sheet()!);
    expect(text(summary)).toBe(message);
    expect(document.activeElement).toBe(summary);
    expect(housePlans.plans).toHaveBeenCalledTimes(1);

    press(sheet()!, 'Not now');
    await settle(fixture);

    expect(housePlans.plans).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-open-ask]')).not.toBeNull();
    expect(host.querySelector('[data-plans-to-add]')).toBeNull();
    // The new read took the button away with its section; the ask's status line has nothing to say, so
    // it is hidden, and the h1 takes focus rather than the document's body.
    expect(opener.isConnected).toBe(false);
    expect(text(host.querySelector('[data-open-ask] .ask-news')!)).toBe('');
    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('says a failed ask in its own words and keeps the page as it was', async () => {
    const { fixture, housePlans } = await renderTrainee({
      ask: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 }))),
    });

    press(fixture.nativeElement, 'Ask for 4 weeks');
    await settle(fixture);
    press(sheet()!, 'Ask for it');
    await settle(fixture);

    expect(text(formSummary(sheet()!))).toBe('Your ask couldn’t be sent. Try again.');
    press(sheet()!, 'Not now');
    await settle(fixture);
    expect(housePlans.plans).toHaveBeenCalledTimes(1);
  });

  it('says where to send the money and takes "I’ve paid" with the Whish details', async () => {
    const sent = toHouseAsk(
      askView({
        state: 'MoneySent',
        moneySent: { whishName: 'Rima Aboud', whishNumber: '+961 71 234567', sentOn: TODAY },
      }),
    );
    const { fixture, host, housePlans, csrf } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asks: [askView()] }))),
      moneySent: vi.fn(() => of(sent)),
    });

    press(host, 'I’ve paid');
    await settle(fixture);
    const opened = sheet()!;
    expect(text(opened.querySelector('.tb-modal__title')!)).toBe('I’ve paid');
    expect(text(opened)).toContain(
      'Tell TB Gym which Whish account the USD 89.75 came from, so they can find it.',
    );
    expect(text(opened)).toContain('6 to 20 digits, with a + in front if you like.');
    expect(text(opened)).toContain('You can say this once for this ask.');
    const number = opened.querySelector<HTMLInputElement>('input[name="whishNumber"]')!;
    expect(number.getAttribute('inputmode')).toBe('tel');
    expect(number.getAttribute('autocomplete')).toBe('tel');
    expect(number.getAttribute('dir')).toBe('ltr');
    expect(number.getAttribute('maxlength')).toBe('40');
    const name = opened.querySelector<HTMLInputElement>('input[name="whishName"]')!;
    expect(name.getAttribute('autocomplete')).toBe('name');
    expect(name.getAttribute('maxlength')).toBe('100');

    fill(opened, 'Name on your Whish account', '  Rima   Aboud ');
    fill(opened, 'Your Whish number', '  +961   71 234567 ');
    await settle(fixture);
    press(opened, 'Send');
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalled();
    expect(housePlans.moneySent).toHaveBeenCalledExactlyOnceWith(
      'ask-1',
      'Rima Aboud',
      '+961 71 234567',
    );
    expect(sheet()).toBeNull();
    const card = host.querySelector('[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Money sent');
    const news = card.querySelector<HTMLElement>('.ask-news')!;
    expect(text(news)).toBe('You said you sent it on Thu 15 Oct from Rima Aboud, +961 71 234567.');
    expect(document.activeElement).toBe(news);
    expect(text(card)).toContain(
      'TB Gym books your plan once the money is there. Free keeps running underneath.',
    );
    expect(card.querySelector('[data-paid], [data-copy-whish]')).toBeNull();
  });

  it('keeps the "I’ve paid" sheet open while the word is on its way, so its answer lands in it', async () => {
    const answer = new Subject<HouseAsk>();
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asks: [askView()] }))),
      moneySent: vi.fn(() => answer),
    });

    press(host, 'I’ve paid');
    await settle(fixture);
    fill(sheet()!, 'Name on your Whish account', 'Rima Aboud');
    fill(sheet()!, 'Your Whish number', '+961 71 234567');
    await settle(fixture);
    press(sheet()!, 'Send');
    await settle(fixture);
    expect(text(sheet()!)).toContain('Sending…');

    sheet()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    sheet()!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(housePlans.moneySent).toHaveBeenCalledTimes(1);

    press(sheet()!, 'Not now');
    sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(sheet()).not.toBeNull();
    expect(text(sheet()!)).toContain('Sending…');

    answer.next(
      toHouseAsk(
        askView({
          state: 'MoneySent',
          moneySent: { whishName: 'Rima Aboud', whishNumber: '+961 71 234567', sentOn: TODAY },
        }),
      ),
    );
    answer.complete();
    await settle(fixture);

    expect(sheet()).toBeNull();
    const card = host.querySelector('[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Money sent');
    expect(document.activeElement).toBe(card.querySelector('.ask-news'));
  });

  it('checks the Whish details as the server does before sending them', async () => {
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asks: [askView()] }))),
    });

    press(host, 'I’ve paid');
    await settle(fixture);
    const opened = sheet()!;
    press(opened, 'Send');
    await settle(fixture);

    expect(housePlans.moneySent).not.toHaveBeenCalled();
    expect(text(formSummary(opened))).toBe('Check the fields marked above.');
    expect(text(opened)).toContain('Enter the name on the Whish account you sent the money from.');
    expect(text(opened)).toContain(
      'Enter the Whish number you sent the money from: 6 to 20 digits, with a + in front if you like.',
    );
    expect(document.activeElement).toBe(opened.querySelector('input[name="whishName"]'));

    fill(opened, 'Name on your Whish account', 'Rima Aboud');
    fill(opened, 'Your Whish number', '70-123-456');
    await settle(fixture);
    press(opened, 'Send');
    await settle(fixture);

    expect(housePlans.moneySent).not.toHaveBeenCalled();
    expect(text(opened)).not.toContain('Enter the name on the Whish account');
    expect(document.activeElement).toBe(opened.querySelector('input[name="whishNumber"]'));
  });

  it('puts the server’s refusal of a Whish detail under its field', async () => {
    const said =
      'Enter the Whish number you sent the money from: 6 to 20 digits, with a + in front if you like and spaces between groups.';
    const { fixture, host } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asks: [askView()] }))),
      moneySent: vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { errors: { whishNumber: [said] } } }),
        ),
      ),
    });

    press(host, 'I’ve paid');
    await settle(fixture);
    const opened = sheet()!;
    fill(opened, 'Name on your Whish account', 'Rima Aboud');
    fill(opened, 'Your Whish number', '96170123456');
    await settle(fixture);
    press(opened, 'Send');
    await settle(fixture);

    const number = opened.querySelector<HTMLInputElement>('input[name="whishNumber"]')!;
    expect(number.getAttribute('aria-invalid')).toBe('true');
    expect(text(opened.querySelector(`#${number.getAttribute('aria-describedby')}`)!)).toBe(said);
    expect(document.activeElement).toBe(number);
  });

  it('says "I’ve paid" was refused and reads the ask again once the sheet closes', async () => {
    const message =
      'You already said you sent this money, from other Whish details. TB Gym looks for it with the details you gave first.';
    const reads = [
      houseRead({ asks: [askView()] }),
      houseRead({
        asks: [
          askView({
            state: 'MoneySent',
            moneySent: { whishName: 'Rima A', whishNumber: '70123456', sentOn: TODAY },
          }),
        ],
      }),
    ];
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(reads.shift()!)),
      moneySent: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'house_plan_money_already_sent', message },
            }),
        ),
      ),
    });

    const opener = button(host, 'I’ve paid');
    opener.focus();
    opener.click();
    await settle(fixture);
    fill(sheet()!, 'Name on your Whish account', 'Rima Aboud');
    fill(sheet()!, 'Your Whish number', '+961 71 234567');
    await settle(fixture);
    press(sheet()!, 'Send');
    await settle(fixture);

    expect(text(formSummary(sheet()!))).toBe(message);
    press(sheet()!, 'Not now');
    await settle(fixture);

    expect(housePlans.plans).toHaveBeenCalledTimes(2);
    const news = host.querySelector<HTMLElement>('[data-open-ask] .ask-news')!;
    expect(text(news)).toBe('You said you sent it on Thu 15 Oct from Rima A, 70123456.');
    // "I've paid" went with the new read: the status line saying where the ask stands takes focus.
    expect(opener.isConnected).toBe(false);
    expect(document.activeElement).toBe(news);
  });

  it('asks only to be told when the house has no Whish number to show', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asksOpen: false, whishNumber: null, asks: [askView()] }))),
    });

    const card = host.querySelector('[data-open-ask]')!;
    expect(card.querySelector('.whish')).toBeNull();
    expect(text(card)).toContain('If you already sent the money, tell TB Gym here.');
    expect(card.querySelector('[data-paid]')).not.toBeNull();
    expect(host.querySelector('[data-plans-to-add]')).toBeNull();
  });

  it('copies the Whish number and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { fixture, host, toast } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asks: [askView()] }))),
    });

    press(host, 'Copy the Whish number');
    await settle(fixture);

    expect(writeText).toHaveBeenCalledWith('+961 70 123456');
    expect(toast.show).toHaveBeenCalledWith('Copied the Whish number.', { tone: 'success' });

    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    press(host, 'Copy the Whish number');
    await settle(fixture);

    expect(toast.show).toHaveBeenLastCalledWith('Couldn’t copy. Select it and copy it yourself.', {
      tone: 'error',
    });
    vi.unstubAllGlobals();
  });

  it('lists the asks TB Gym booked or closed, newest first, with the reason it gave', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() => of(houseRead({ asks: [BOOKED, CLOSED] }))),
    });

    const earlier = host.querySelector('[data-earlier-asks]')!;
    expect(text(earlier.querySelector('h2')!)).toBe('Earlier asks');
    const rows = [...earlier.querySelectorAll('li.earlier-ask')];
    expect(rows.map((row) => text(row.querySelector('.ask-name')!))).toEqual([
      'Pro+, 4 weeks',
      'Pro+, Two blocks',
    ]);
    expect(rows.map((row) => text(row.querySelector('app-status-pill')!))).toEqual([
      'Booked',
      'Closed',
    ]);
    expect(rows.map((row) => text(row.querySelector('.quiet')!))).toEqual([
      'USD 47.50 · asked Thu 1 Oct',
      'USD 89.75 · asked Mon 10 Aug',
    ]);
    expect(text(rows[0].querySelector('.ask-outcome')!)).toBe(
      'Booked Fri 2 Oct: runs Fri 2 Oct – Thu 29 Oct.',
    );
    expect(text(rows[1].querySelector('.ask-outcome')!)).toBe(
      'TB Gym closed this ask on Thu 20 Aug.',
    );
    expect(text(rows[1].querySelector('.ask-reason')!)).toBe(
      'No money came from that Whish account.',
    );
    expect(rows[1].querySelector('.ask-reason')!.getAttribute('dir')).toBe('auto');
    expect(rows[0].querySelector('.ask-reason')).toBeNull();
    // Asks still open again once each was booked or closed.
    expect(host.querySelector('[data-plans-to-add]')).not.toBeNull();
  });

  it('words a paid plan’s notes for a trainee, and Free still stands beside it', async () => {
    const { host } = await renderTrainee(
      {},
      plan({ id: 'pro', name: 'Pro+', status: 'Expired', lastDay: '2026-10-10' }),
      plan({ id: 'next', name: 'Pro+', status: 'PendingPayment', startDate: '2026-10-20' }),
    );

    expect(
      [...host.querySelectorAll('section.plan:not([data-free]) .plan-note')].map(text),
    ).toEqual([
      'You’re back on Free. Everything you logged stays yours.',
      'It starts once TB Gym has your payment.',
    ]);
    expect(host.querySelector('[data-free]')).not.toBeNull();
  });

  it('says Free’s access is paused when TB Gym paused it', async () => {
    const { host } = await render(
      () => of({ ...traineeView(), free: { ...FREE, status: 'Blocked' } }),
      {},
      { plans: vi.fn(() => of(houseRead({ asksOpen: false, whishNumber: null, plans: [] }))) },
    );

    const free = host.querySelector('[data-free]')!;
    expect(text(free.querySelector('app-status-pill')!)).toBe('Access paused');
    expect([...free.querySelectorAll('.plan-note')].map(text)).toEqual([
      'TB Gym has paused your access.',
      'It never ends, and it keeps running beside any plan you add.',
    ]);
  });

  it('says only the plans for sale failed to load, and reads them again on Try again', async () => {
    let refused = true;
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() =>
        refused ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(houseRead()),
      ),
    });

    const failed = host.querySelector('[data-house-failed]')!;
    expect(text(failed.querySelector('[role="alert"]')!)).toBe(
      'The plans TB Gym sells couldn’t be loaded.',
    );
    expect(host.querySelector('[data-free]')).not.toBeNull();
    expect(text(host)).not.toContain('Your plan couldn’t be loaded.');

    refused = false;
    const retry = button(failed as HTMLElement, 'Try again');
    retry.focus();
    retry.click();
    await settle(fixture);

    expect(housePlans.plans).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-house-failed]')).toBeNull();
    expect(host.querySelector('[data-plans-to-add]')).not.toBeNull();
    // Try again went with the failed read; focus stays on the page, at its h1.
    expect(retry.isConnected).toBe(false);
    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('shows nothing of the house when the server says it is not theirs', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 }))),
    });

    expect(host.querySelector('[data-free]')).not.toBeNull();
    expect(
      host.querySelector('[data-house-failed], [data-plans-to-add], [data-open-ask]'),
    ).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

// ---------- Max, TB Gym coaching the trainee, for a limited number of places (notes plan N9c5b) ----------

/** A month of Max, as the house sells it: TB Gym's four coaching features. */
const MAX_MONTH = offerView({
  offerId: 'max-month',
  productId: 'max',
  tier: 'Max',
  name: 'Max',
  description: 'TB Gym coaches you: your program, your food, a weekly check-in and messages.',
  optionLabel: 'A month',
  priceAmount: 120,
  durationCount: 4,
  features: ['Training', 'Nutrition', 'CheckIns', 'Messaging'],
  placeOpen: false,
});
const MAX_THREE = offerView({
  ...MAX_MONTH,
  offerId: 'max-three',
  optionLabel: 'Three months',
  priceAmount: 330,
  durationCount: 12,
});

/** An ask for a month of Max, waiting for its place unless a test says otherwise. */
const maxAskView = (overrides: Partial<HousePlanAskView> = {}) =>
  askView({
    offerId: 'max-month',
    tier: 'Max',
    planName: 'Max',
    optionLabel: 'A month',
    priceAmount: 120,
    durationCount: 4,
    placeOpen: false,
    ...overrides,
  });

const FULL_LINE =
  'Every place on Max is taken right now. You can still ask: your ask waits in line, and you send money only once a place opens for you.';
const NOT_OPEN =
  'A Max place isn’t open for you yet. Your ask is kept in line; don’t send money until a place opens.';
const MAX_CLOSED =
  'Max isn’t taking anyone right now. Your ask is kept; don’t send money until it opens again.';

describe('ClientPlanPage for a trainee asking for Max (notes plan N9c5b)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  const withMax = (overrides: Partial<HousePlansView> = {}) =>
    houseRead({ plans: [offerView(), EIGHT_WEEKS, MAX_MONTH, MAX_THREE], ...overrides });

  it('says under Max that every place is taken, tied to its Ask for buttons, which stay', async () => {
    const { host } = await renderTrainee({ plans: vi.fn(() => of(withMax())) });

    const offers = [...host.querySelectorAll<HTMLElement>('article.offer')];
    expect(offers.map((offer) => text(offer.querySelector('h3')!))).toEqual(['Pro+', 'Max']);
    const max = offers[1];
    const line = max.querySelector<HTMLElement>('[data-place-line]')!;
    expect(text(line)).toBe(FULL_LINE);
    expect(line.classList).toContain('quiet');
    // Under what it includes, before its options.
    expect(line.previousElementSibling?.matches('ul.includes')).toBe(true);
    expect(line.nextElementSibling?.matches('ul.options')).toBe(true);
    const asks = [...max.querySelectorAll<HTMLButtonElement>('.option button')];
    expect(asks.map(text)).toEqual(['Ask for A month', 'Ask for Three months']);
    expect(asks.map((ask) => ask.getAttribute('aria-describedby'))).toEqual([line.id, line.id]);
    expect(line.id).toBe('place-max');
    // The name still starts with the words on the button (WCAG 2.5.3).
    expect(asks.map((ask) => ask.getAttribute('aria-label'))).toEqual([
      'Ask for A month, Max',
      'Ask for Three months, Max',
    ]);
    // Pro+ says nothing of places.
    expect(offers[0].querySelector('[data-place-line]')).toBeNull();
    expect(offers[0].querySelector('button[aria-describedby]')).toBeNull();
  });

  it('says nothing of places while a Max place is open, or when the read does not say', async () => {
    for (const placeOpen of [true, null]) {
      const { host } = await renderTrainee({
        plans: vi.fn(() =>
          of(
            houseRead({
              plans: [
                { ...MAX_MONTH, placeOpen },
                { ...MAX_THREE, placeOpen },
              ],
            }),
          ),
        ),
      });

      expect(host.querySelector('[data-place-line]'), String(placeOpen)).toBeNull();
      expect(host.querySelector('.option button[aria-describedby]')).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('asks for Max in line: the sheet says not to send money, and the card shows nothing to pay', async () => {
    const asked = toHouseAsk(maxAskView());
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(withMax())),
      ask: vi.fn(() => of(asked)),
    });

    press(host, 'Ask for A month');
    await settle(fixture);
    const opened = sheet()!;
    expect(text(opened.querySelector('.tb-modal__title')!)).toBe('Ask for Max');
    const words = opened.querySelector<HTMLElement>('[data-ask-words]')!;
    expect(text(words.querySelector('[data-ask-choice]')!)).toBe('A month · 4 weeks · USD 120');
    expect(text(words.querySelector('[data-ask-waits]')!)).toBe(
      'Every place on Max is taken right now, so your ask waits in line, in the order asked. Don’t send money yet: once a place opens for you, this page shows where to send it. Free keeps running underneath.',
    );
    expect(text(words)).not.toContain('You pay TB Gym by Whish');
    expect(text(words)).toContain(
      'You can ask for something else once TB Gym books or closes this ask.',
    );
    // Still one focusable region of words (axe scrollable-region-focusable at 200% text).
    expect(words.getAttribute('tabindex')).toBe('0');
    expect(words.getAttribute('role')).toBe('region');

    press(opened, 'Ask for it');
    await settle(fixture);

    expect(housePlans.ask).toHaveBeenCalledExactlyOnceWith('max-month');
    expect(sheet()).toBeNull();
    const card = host.querySelector<HTMLElement>('section.plan[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Waiting for a place');
    expect(text(card.querySelector('#ask-line')!)).toBe('Max, A month · USD 120 for 4 weeks');
    const news = card.querySelector<HTMLElement>('.ask-news')!;
    expect(text(news)).toBe(
      'Asked. You’re in line for a place on Max; don’t send money until this page says one is open.',
    );
    expect(document.activeElement).toBe(news);
    // Nothing says to send money: no Whish number, no Copy, no I've paid.
    expect(
      card.querySelector('.whish, [data-copy-whish], [data-paid], [data-place-open]'),
    ).toBeNull();
    expect(text(card)).not.toContain('If you already sent the money');
    expect(text(card)).not.toContain('+961 70 123456');
    expect(text(card)).toContain('Nothing changes until TB Gym books it. Free keeps running.');
    expect(card.querySelectorAll('button')).toHaveLength(0);
  });

  it('words a Pro+ option as before beside a full Max', async () => {
    const { fixture, host } = await renderTrainee({ plans: vi.fn(() => of(withMax())) });

    press(host, 'Ask for Two blocks');
    await settle(fixture);

    expect(sheet()!.querySelector('[data-ask-waits]')).toBeNull();
    expect(text(sheet()!)).toContain('You pay TB Gym by Whish, then tell us here.');
  });

  it('reads a waiting Max ask with the server’s sentence in its status line, and nothing to pay', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() => of(withMax({ asks: [maxAskView()] }))),
    });

    const card = host.querySelector<HTMLElement>('[data-open-ask]')!;
    const pill = card.querySelector('app-status-pill')!;
    expect(text(pill)).toBe('Waiting for a place');
    expect(pill.classList).toContain('info');
    const news = card.querySelector<HTMLElement>('.ask-news')!;
    expect(news.getAttribute('role')).toBe('status');
    expect(text(news)).toBe(NOT_OPEN);
    expect(card.querySelector('.whish, [data-copy-whish], [data-paid]')).toBeNull();
    expect(text(card)).not.toContain('If you already sent the money');
    // One ask at a time, as for Pro+.
    expect(host.querySelector('[data-plans-to-add]')).toBeNull();
  });

  // "If you already sent the money" stands in for the Whish block only when the house shows no
  // Whish number, so a waiting Max ask must hide it there too. (A Pro+ ask still shows it: "asks
  // only to be told when the house has no Whish number to show" above.)
  it('asks nothing of the money for a waiting Max ask when the house has no Whish number', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() => of(withMax({ asksOpen: false, whishNumber: null, asks: [maxAskView()] }))),
    });

    const card = host.querySelector<HTMLElement>('[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Waiting for a place');
    expect(text(card.querySelector('.ask-news')!)).toBe(NOT_OPEN);
    expect(text(card)).not.toContain('If you already sent the money');
    expect(card.querySelector('.whish, [data-copy-whish], [data-paid]')).toBeNull();
    expect([...card.querySelectorAll('button')].map(text)).not.toContain('I’ve paid');
  });

  it('reads a Max ask whose place is open as Pro+’s, saying the place is open first', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() => of(withMax({ asks: [maxAskView({ placeOpen: true })] }))),
    });

    const card = host.querySelector<HTMLElement>('[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Waiting for your payment');
    const notes = [...card.querySelectorAll('.plan-note:not(.ask-news)')].map(text);
    expect(notes).toEqual([
      'A place on Max is open for you now.',
      'Send USD 120 by Whish to +961 70 123456, then tell TB Gym you sent it.',
      'Nothing changes until TB Gym books it. Free keeps running.',
    ]);
    expect(text(card.querySelector('.ask-news')!)).toBe('');
    expect(card.querySelector('[data-copy-whish]')).not.toBeNull();
    expect(card.querySelector('[data-paid]')).not.toBeNull();
  });

  it('reads a Max ask said paid exactly as any ask said paid', async () => {
    const { host } = await renderTrainee({
      plans: vi.fn(() =>
        of(
          withMax({
            asks: [
              maxAskView({
                state: 'MoneySent',
                placeOpen: true,
                moneySent: {
                  whishName: 'Rima Aboud',
                  whishNumber: '+961 71 234567',
                  sentOn: TODAY,
                },
              }),
            ],
          }),
        ),
      ),
    });

    const card = host.querySelector<HTMLElement>('[data-open-ask]')!;
    expect(text(card.querySelector('app-status-pill')!)).toBe('Money sent');
    expect(text(card.querySelector('.ask-news')!)).toBe(
      'You said you sent it on Thu 15 Oct from Rima Aboud, +961 71 234567.',
    );
    expect(text(card)).toContain(
      'TB Gym books your plan once the money is there. Free keeps running underneath.',
    );
    expect(card.querySelector('[data-place-open], [data-paid], [data-copy-whish]')).toBeNull();
  });

  for (const [code, message] of [
    ['house_max_place_not_open', NOT_OPEN],
    ['house_max_closed', MAX_CLOSED],
  ] as const) {
    it(`says "I’ve paid" refused with ${code} in the server’s words, then reads the ask again`, async () => {
      const reads = [
        withMax({ asks: [maxAskView({ placeOpen: true })] }),
        withMax({ asks: [maxAskView()] }),
      ];
      const { fixture, host, housePlans } = await renderTrainee({
        plans: vi.fn(() => of(reads.shift()!)),
        moneySent: vi.fn(() =>
          throwError(() => new HttpErrorResponse({ status: 409, error: { code, message } })),
        ),
      });

      const opener = button(host, 'I’ve paid');
      opener.focus();
      opener.click();
      await settle(fixture);
      fill(sheet()!, 'Name on your Whish account', 'Rima Aboud');
      fill(sheet()!, 'Your Whish number', '+961 71 234567');
      await settle(fixture);
      press(sheet()!, 'Send');
      await settle(fixture);

      const summary = formSummary(sheet()!);
      expect(text(summary)).toBe(message);
      expect(document.activeElement).toBe(summary);
      expect(housePlans.plans).toHaveBeenCalledTimes(1);
      press(sheet()!, 'Not now');
      await settle(fixture);

      expect(housePlans.plans).toHaveBeenCalledTimes(2);
      const card = host.querySelector<HTMLElement>('[data-open-ask]')!;
      expect(text(card.querySelector('app-status-pill')!)).toBe('Waiting for a place');
      expect(card.querySelector('[data-paid], .whish')).toBeNull();
      // "I've paid" went with the new read: the status line saying where the ask stands takes focus.
      const news = card.querySelector<HTMLElement>('.ask-news')!;
      expect(text(news)).toBe(NOT_OPEN);
      expect(opener.isConnected).toBe(false);
      expect(document.activeElement).toBe(news);
    });
  }

  it('opens no "I’ve paid" sheet for an ask waiting for its place, even when asked to', async () => {
    const { fixture, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(withMax({ asks: [maxAskView()] }))),
    });
    const page = fixture.componentInstance as unknown as {
      openAsk(): { waitingForPlace: boolean } | null;
      openPaidSheet(ask: unknown): void;
    };

    expect(page.openAsk()?.waitingForPlace).toBe(true);
    page.openPaidSheet(page.openAsk());
    await settle(fixture);

    expect(sheet()).toBeNull();
    expect(housePlans.moneySent).not.toHaveBeenCalled();
  });

  it('never leaves "send the money" on an ask whose Max place went before I’ve paid', async () => {
    const reads = [withMax(), withMax({ asks: [maxAskView()] })];
    const { fixture, host, housePlans } = await renderTrainee({
      plans: vi.fn(() => of(reads.shift()!)),
      // A place was open when the trainee asked.
      ask: vi.fn(() => of(toHouseAsk(maxAskView({ placeOpen: true })))),
      moneySent: vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'house_max_place_not_open', message: NOT_OPEN },
            }),
        ),
      ),
    });

    press(host, 'Ask for A month');
    await settle(fixture);
    press(sheet()!, 'Ask for it');
    await settle(fixture);
    const card = () => host.querySelector<HTMLElement>('[data-open-ask]')!;
    expect(text(card().querySelector('.ask-news')!)).toBe(
      'Asked. Send the money by Whish, then tell TB Gym here.',
    );
    expect(text(card().querySelector('[data-place-open]')!)).toBe(
      'A place on Max is open for you now.',
    );

    press(host, 'I’ve paid');
    await settle(fixture);
    fill(sheet()!, 'Name on your Whish account', 'Rima Aboud');
    fill(sheet()!, 'Your Whish number', '+961 71 234567');
    await settle(fixture);
    press(sheet()!, 'Send');
    await settle(fixture);
    press(sheet()!, 'Not now');
    await settle(fixture);

    expect(housePlans.plans).toHaveBeenCalledTimes(2);
    const news = card().querySelector<HTMLElement>('.ask-news')!;
    expect(text(news)).toBe(NOT_OPEN);
    expect(text(card())).not.toContain('Send the money');
    expect(card().querySelector('[data-paid], .whish, [data-place-open]')).toBeNull();
    expect(document.activeElement).toBe(news);
  });
});
