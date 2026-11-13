import { HttpErrorResponse } from '@angular/common/http';
import { UnsavedWork } from '../../core/forms/unsaved-work';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  TeamMember,
  WorkspaceDetails,
} from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  bookedAsk,
  cancelledPlan,
  catalog,
  catalogWithPacks,
  closedAsk,
  enrollment,
  freePlan,
  housePlanAsk,
  plansOverview,
  SERVICE_TODAY,
  sessionPack,
  unpaidPack,
  unpaidRenewal,
} from '../../../testing/client-service-fixtures';
import { installDialogSupport } from '../../../testing/dialog';
import {
  button,
  field,
  fill,
  formSummary,
  menuChoices,
  press,
  settle,
  toggleFold,
} from '../../../testing/dom';
import { provideEmailDelivery } from '../../../testing/email-delivery';
import { TeamApi } from '../team/team-api';
import { ClientService } from './client-service';
import { ClientWorkspaceContext } from './client-workspace.context';
import { FormerClientsApi } from './former-clients-api';
import { HousePlanAsksApi } from './house-plan-asks-api';
import { toHousePlanAsk, type HousePlanAsk } from './house-plan-asks.models';

const PROFILE = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Fakhoury',
  isCoachBlocked: false,
  assignedCoachUserId: 'coach-1',
  assignedCoachName: 'Lea Khoury',
  version: 3,
  release: null,
} as unknown as CoachClientDetails;

const FORMER = {
  ...PROFILE,
  release: {
    releasedAtUtc: '2026-09-20T10:00:00Z',
    reason: 'Moved',
    releasedByName: 'Karim Haddad',
    departureKind: 'ReleasedByOwner',
  },
} as CoachClientDetails;

interface Options {
  plans?: ClientCommercialOverview;
  /** What the coach sells; the plain catalog when left out. */
  sells?: ReturnType<typeof catalog>;
  /** Replaces the plans read, to fail it or to answer differently the second time. */
  getPlans?: () => Observable<ClientCommercialOverview>;
  profile?: CoachClientDetails;
  isOwner?: boolean;
  renewalAskedAt?: string | null;
  /** The plan the request names; the client's plan that ran out. */
  renewalSubject?: string;
  /** False when the server does not flag the running plan ending soon (CLI-018); it does by default. */
  endingSoon?: boolean;
  url?: string;
  api?: Record<string, unknown>;
  /** This server sends no email (audit LOST-1). */
  emailOff?: boolean;
  releaseClient?: ReturnType<typeof vi.fn>;
  /** The team's read; nobody by default. */
  getTeamMembers?: () => Observable<TeamMember[]>;
  /** Who is signed in; nobody by default. */
  user?: { id: string; displayName: string };
  /** The house's asks API (SUB-020); a fake that answers no asks by default. */
  houseAsks?: Record<string, unknown>;
}

async function render(options: Options = {}) {
  const getClientCommercialOverview = options.getPlans
    ? vi.fn(options.getPlans)
    : vi.fn(() => of(options.plans ?? plansOverview([cancelledPlan(), enrollment()])));
  const api = {
    getClientCommercialOverview,
    getProductCatalog: vi.fn(() => of(options.sells ?? catalog())),
    getClientOverview: vi.fn(() =>
      of({
        attention: [
          ...(options.renewalAskedAt
            ? [
                {
                  kind: 'RenewalRequested',
                  since: options.renewalAskedAt,
                  subjectId: options.renewalSubject ?? 'e-1',
                },
              ]
            : []),
          // The server flags the plan running today ending soon, its last day 11 days on.
          ...(options.endingSoon === false
            ? []
            : [{ kind: 'PlanEndingSoon', date: '2026-10-12', subjectId: 'e-1', count: null }]),
        ],
      }),
    ),
    resumeEnrollment: vi.fn(() => of(enrollment())),
    renewEnrollment: vi.fn(() => of(unpaidRenewal())),
    assignProduct: vi.fn(() => of(enrollment({ id: 'e-new' }))),
    recordManualPayment: vi.fn(() => of(unpaidRenewal())),
    ...options.api,
  };
  const houseAsks = {
    list: vi.fn(() => of([])),
    book: vi.fn(() => of(toHousePlanAsk(bookedAsk()))),
    close: vi.fn(() => of(toHousePlanAsk(closedAsk()))),
    ...options.houseAsks,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'clients/:clientId/service', component: ClientService }]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TeamApi,
        useValue: { getTeamMembers: vi.fn(options.getTeamMembers ?? (() => of([]))) },
      },
      ...(options.user ? [{ provide: AuthStore, useValue: { user: signal(options.user) } }] : []),
      { provide: FormerClientsApi, useValue: { releaseClient: options.releaseClient ?? vi.fn() } },
      { provide: HousePlanAsksApi, useValue: houseAsks },
      provideEmailDelivery(options.emailOff),
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          isOwner: signal(options.isOwner ?? true),
        },
      },
    ],
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set(options.profile ?? PROFILE);
  context.workspace.set({ currentDate: SERVICE_TODAY, weekStartsOn: 'Monday' } as WorkspaceDetails);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/clients/client-1/service', ClientService);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    houseAsks,
    context,
    router: TestBed.inject(Router),
  };
}

const all = (host: ParentNode, selector: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(selector));
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

describe('a client’s Service & access', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('protects a payment sheet for session exits, close actions and refresh', async () => {
    const { harness, host } = await render({ plans: plansOverview([unpaidRenewal()]) });
    press(host, 'Record payment');
    await settle(harness.fixture);
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    fill(sheet, 'Reference (optional)', 'Receipt draft');
    await settle(harness.fixture);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const leave = TestBed.inject(UnsavedWork).confirmLeave();
    await settle(harness.fixture);
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    press(dialogs[dialogs.length - 1], 'Keep editing');
    expect(await leave).toBe(false);
    expect(sheet.querySelector<HTMLInputElement>('input[name="reference"]')!.value).toBe(
      'Receipt draft',
    );
    harness.fixture.destroy();
    expect(await TestBed.inject(UnsavedWork).confirmLeave()).toBe(true);
  });

  it('puts the plan running today in front, with the one thing that needs the coach', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('.eyebrow'))).toBe('Current plan');
    expect(textOf(host.querySelector('#plan-title'))).toBe('Online Coaching');
    expect(textOf(host.querySelector('.hero app-status-pill'))).toBe('Ends in 11 days');
    expect(all(host, '.facts li').map(textOf)).toEqual([
      'Tue 21 Jul – Mon 12 Oct',
      '12 weeks · USD 330',
      'Paid in full',
    ]);
    expect(all(host, '.chips li').map(textOf)).toEqual([
      'Training',
      'Nutrition',
      'Check-ins',
      'Messaging',
    ]);
    // Ending within two weeks with nothing after it: renewing is the page's one filled button.
    expect(all(host, '.hero-actions > button').map(textOf)).toEqual(['Renew plan']);
    expect(
      all(host, '.payment').map((row) =>
        ['.payment-date', '.payment-detail', '.payment-amount'].map((part) =>
          textOf(row.querySelector(part)),
        ),
      ),
    ).toEqual([['Mon 20 Jul 2026', 'Cash', 'USD 330']]);
    expect(all(host, '.row-name').map(textOf)).toEqual(['Starter']);
  });

  it('asks for no renewal and draws no warm pill while the server does not flag the plan (critique B4a)', async () => {
    const { host, context } = await render({ endingSoon: false });

    // Its last day is 11 days on, but the page counts no days of its own: the flag decides.
    expect(textOf(host.querySelector('.hero app-status-pill'))).toBe('Active · 11 days left');
    expect(all(host, '.hero-actions > button')).toEqual([]);
    // The header reads the same answer, so it says the same.
    expect(context.overview()?.attention).toEqual([]);
  });

  it('keeps every other change behind Manage plan', async () => {
    const { host, harness } = await render();

    press(host, 'Manage plan');
    await settle(harness.fixture);

    expect(all(host, 'app-client-actions .item-title').map(textOf)).toEqual([
      'Pause plan',
      'Cancel plan',
      'Start another plan',
    ]);
  });

  it('opens another plan from the list, and asks for the money a renewal still owes', async () => {
    const { host, harness } = await render({
      plans: plansOverview([cancelledPlan(), enrollment(), unpaidRenewal()]),
    });

    // A renewal follows the current plan, so nothing needs the coach about it.
    expect(all(host, '.hero-actions > button')).toEqual([]);
    all(host, '.row')
      .find((row) => textOf(row).includes('Waiting for payment'))!
      .click();
    await settle(harness.fixture);

    expect(textOf(host.querySelector('.eyebrow'))).toBe('Starts Tue 13 Oct');
    expect(all(host, '.hero-actions > button').map(textOf)).toEqual(['Record payment']);
    expect(textOf(host.querySelector('#payments-title + .panel-span'))).toBe('USD 150 of 330 paid');
    expect(textOf(host.querySelector('.paid-bar'))).toBe('');
    expect(host.querySelector('.paid-bar')?.getAttribute('aria-label')).toBe('USD 150 of 330 paid');
  });

  it('renews from the main button, then reads the plans again for the whole page', async () => {
    const { host, harness, api, context } = await render();

    press(host, 'Renew plan');
    await settle(harness.fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Renew plan');

    const renewed = plansOverview([cancelledPlan(), enrollment(), unpaidRenewal()]);
    api.getClientCommercialOverview.mockReturnValue(of(renewed));
    press(dialog()!, 'Renew plan');
    await settle(harness.fixture);

    expect(api.renewEnrollment).toHaveBeenCalledWith('e-1', {
      offerId: 'o-12',
      startDate: '2026-10-13',
      idempotencyKey: expect.any(String),
    });
    expect(context.notice()).toBe('Online Coaching is renewed for Maya.');
    expect(context.plans()).toBe(renewed);
    // The page now shows the renewal it made.
    expect(textOf(host.querySelector('.eyebrow'))).toBe('Starts Tue 13 Oct');
    expect(textOf(host.querySelector('.payment-context'))).toBe(
      'Online Coaching · 13 Oct 2026 – 4 Jan 2027',
    );
    expect(all(host, '.payment-amount').map(textOf)).toEqual(['USD 150']);

    // Opening the original plan still shows its own receipt and price after renewal.
    all(host, '.row')
      .find((row) => textOf(row).includes('Tue 21 Jul'))!
      .click();
    await settle(harness.fixture);
    expect(textOf(host.querySelector('.payment-context'))).toBe(
      'Online Coaching · Tue 21 Jul – Mon 12 Oct',
    );
    expect(all(host, '.payment-amount').map(textOf)).toEqual(['USD 330']);
    expect(textOf(host)).toContain(
      'Renewing starts a separate plan and keeps these payments here.',
    );
  });

  it('opens the renewal the Overview asked for once, then takes it out of the address', async () => {
    const { harness, router } = await render({ url: '/clients/client-1/service?renew=e-1' });
    await settle(harness.fixture);

    expect(textOf(dialog()?.querySelector('h2'))).toBe('Renew plan');
    expect(router.url).toBe('/clients/client-1/service');
  });

  it('opens the payment of the renewal Coach Today says is unpaid, once (BEB-7)', async () => {
    const { harness, host, router } = await render({
      plans: plansOverview([enrollment(), unpaidRenewal()]),
      url: '/clients/client-1/service?pay=e-2',
    });
    await settle(harness.fixture);

    expect(textOf(dialog()?.querySelector('h2'))).toBe('Record payment');
    expect(textOf(host.querySelector('.eyebrow'))).toBe('Starts Tue 13 Oct');
    expect(router.url).toBe('/clients/client-1/service');
  });

  it('says the client asked to renew beside the plan that ended, until a plan follows it', async () => {
    // A client asks only once their whole plan has run out (SUB-014); the request names that plan.
    const ended = enrollment({
      startDate: '2026-07-01',
      endDateExclusive: '2026-09-30',
      lastActiveDate: '2026-09-29',
      effectiveStatus: 'Expired',
    });
    const { host, harness, api } = await render({
      plans: plansOverview([ended]),
      renewalAskedAt: '2026-09-28T07:30:00Z',
    });

    expect(all(host, '.facts li.warm').map(textOf)).toContain('Maya asked to renew on Mon 28 Sep');
    expect(all(host, '.hero-actions > button').map(textOf)).toEqual(['Renew plan']);

    // Renewed: the overview no longer carries the request, and the new plan does not repeat it.
    api.getClientCommercialOverview.mockReturnValue(of(plansOverview([ended, unpaidRenewal()])));
    api.getClientOverview.mockReturnValue(of({ attention: [] }));
    press(host, 'Renew plan');
    await settle(harness.fixture);
    press(dialog()!, 'Renew plan');
    await settle(harness.fixture);

    expect(textOf(host.querySelector('.eyebrow'))).toBe('Starts Tue 13 Oct');
    expect(all(host, '.facts li').map(textOf).join(' ')).not.toContain('asked to renew');
    expect(all(host, '.hero-actions > button').map(textOf)).toEqual(['Record payment']);
  });

  it('does not repeat an old request beside a plan it is not about', async () => {
    const { host } = await render({
      renewalAskedAt: '2026-09-28T07:30:00Z',
      renewalSubject: 'e-0',
    });

    expect(all(host, '.facts li').map(textOf).join(' ')).not.toContain('asked to renew');
  });

  it('resumes a paused plan straight from its button', async () => {
    const paused = enrollment({
      storedStatus: 'Paused',
      effectiveStatus: 'Paused',
      statusReason: 'Injured',
    });
    const { host, harness, api, context } = await render({ plans: plansOverview([paused]) });

    press(host, 'Resume plan');
    await settle(harness.fixture);

    expect(api.resumeEnrollment).toHaveBeenCalledWith('e-1', 2);
    expect(context.notice()).toBe('Online Coaching is running again.');
  });

  it('gives the owner the coach and End coaching, and a coach only the access switch', async () => {
    const owner = await render();
    expect(owner.host.querySelector('app-client-coach')).not.toBeNull();
    expect(owner.host.querySelector('app-client-release')).not.toBeNull();
    expect(textOf(owner.host.querySelector('[data-access-line]'))).toBe(
      'Maya can use everything their plan includes.',
    );
    expect(all(owner.host, '[data-access-rows] li').map(textOf)).toEqual([
      'Training Open until Mon 12 Oct',
      'Nutrition Open until Mon 12 Oct',
      'Check-ins Open until Mon 12 Oct',
      'Messaging Open until Mon 12 Oct',
    ]);

    TestBed.resetTestingModule();
    const coach = await render({ isOwner: false });
    expect(coach.host.querySelector('app-client-coach')).toBeNull();
    expect(coach.host.querySelector('app-client-release')).toBeNull();
    expect(all(coach.host, '.setting button').map(textOf)).toEqual(['Block access']);
  });

  it('ends coaching and says no goodbye email went out when this server sends none', async () => {
    const uninstall = installDialogSupport();
    try {
      const releaseClient = vi.fn(() => of({ ...FORMER, version: 4 }));
      const { harness, host, context } = await render({ emailOff: true, releaseClient });

      press(host, 'End coaching');
      await settle(harness.fixture);
      fill(host, 'Reason', 'Moved away');
      await settle(harness.fixture);
      press(host, 'End coaching permanently');
      await settle(harness.fixture);

      expect(releaseClient).toHaveBeenCalledWith('client-1', 'Moved away', 3);
      // Audit LOST-1: the notice does not claim an email the server cannot send.
      expect(context.notice()).toBe(
        'Coaching with Maya has ended. They no longer have access. Email is off on this server, so they weren’t emailed.',
      );
    } finally {
      uninstall();
    }
  });

  it('blocks access through a dialog and keeps the updated client for every tab', async () => {
    const blockClientRelationship = vi.fn(() =>
      of({ ...PROFILE, isCoachBlocked: true, version: 4 }),
    );
    const { host, harness, api, context } = await render({ api: { blockClientRelationship } });

    press(host, 'Block access');
    await settle(harness.fixture);
    const textarea = dialog()!.querySelector('textarea')!;
    textarea.value = 'Unpaid';
    textarea.dispatchEvent(new Event('input'));
    press(dialog()!, 'Block access');
    await settle(harness.fixture);

    expect(blockClientRelationship).toHaveBeenCalledWith('client-1', 'Unpaid', 3);
    expect(context.profile()?.isCoachBlocked).toBe(true);
    expect(context.notice()).toBe('Maya is blocked in your coaching space only.');
    expect(api.getClientCommercialOverview).toHaveBeenCalledTimes(2);
  });

  it('shows a former client’s plans read-only, with nothing that changes them', async () => {
    const { host, api } = await render({ profile: FORMER });

    expect(textOf(host.querySelector('.former'))).toContain('This is a former client.');
    expect(host.querySelector('.hero-actions button')).toBeNull();
    expect(host.querySelector('app-client-actions')).toBeNull();
    expect(host.querySelector('#access-title')).toBeNull();
    expect(api.getProductCatalog).not.toHaveBeenCalled();
    expect(api.getClientOverview).not.toHaveBeenCalled();
  });

  it('invites a first plan when there is none', async () => {
    const { host, harness } = await render({ plans: plansOverview([]) });

    expect(textOf(host)).toContain('No plan yet');
    expect(textOf(host)).toContain(
      'Start a plan and Maya can use what it includes once it is paid.',
    );
    press(host, 'Start a plan');
    await settle(harness.fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Start a plan');
  });

  it('says the plans could not be loaded, and tries again', async () => {
    const getPlans = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of(plansOverview()));
    const { host, harness } = await render({ getPlans });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('The plans could not be loaded.');
    press(host, 'Try again');
    await settle(harness.fixture);
    expect(textOf(host.querySelector('#plan-title'))).toBe('Online Coaching');
  });

  describe('1-on-1 sessions (critique B10b)', () => {
    const section = (host: HTMLElement) =>
      host.querySelector<HTMLElement>('[aria-labelledby="sessions-title"]');

    it('stays away from a coach who sells no sessions', async () => {
      const { host } = await render();
      expect(section(host)).toBeNull();
    });

    it('invites the first sale once the coach sells sessions', async () => {
      const { host, harness } = await render({ sells: catalogWithPacks() });

      expect(textOf(section(host))).toContain(
        'No sessions running. Sell Maya a pack or a single session and it shows here.',
      );
      expect(all(section(host)!, 'button').map(textOf)).toEqual(['Sell sessions']);

      press(section(host)!, 'Sell sessions');
      await settle(harness.fixture);
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Sell sessions');
      expect(all(dialog()!, '.choice-label').map(textOf)).toEqual([
        'Personal training · 10 sessions',
        'Personal training · Single session',
      ]);
    });

    it('reads a pack beside the coaching plan, which stays in front', async () => {
      const { host } = await render({
        plans: plansOverview([sessionPack(), enrollment()]),
        sells: catalogWithPacks(),
      });

      expect(textOf(host.querySelector('#plan-title'))).toBe('Online Coaching');
      expect(textOf(section(host)?.querySelector('.pack-name'))).toBe(
        'Personal training · 10 sessions',
      );
      expect(textOf(section(host)?.querySelector('.pack-line'))).toBe(
        '7 of 10 left · until 29 Nov · last held Tue 29 Sep',
      );
    });

    it('makes Record a session the page’s one filled button unless the plan needs the coach', async () => {
      const plain = await render({
        plans: plansOverview([sessionPack()]),
        endingSoon: false,
      });
      expect(
        all(section(plain.host)!, 'button').find((item) => textOf(item) === 'Record a session')
          ?.className,
      ).toContain('tb-button--filled');
      TestBed.resetTestingModule();

      const owed = await render({ plans: plansOverview([sessionPack(), unpaidRenewal()]) });
      expect(textOf(owed.host.querySelector('.hero-actions button'))).toBe('Record payment');
      expect(
        all(section(owed.host)!, 'button').find((item) => textOf(item) === 'Record a session')
          ?.className,
      ).toContain('tb-button--outlined');
    });

    it('records a session in its sheet and says what is left', async () => {
      const after = sessionPack({}, { left: 6, held: 3 });
      const recordSession = vi.fn(() => of(after));
      const getPlans = vi
        .fn()
        .mockReturnValueOnce(of(plansOverview([sessionPack()])))
        .mockReturnValue(of(plansOverview([after])));
      const { host, harness, context } = await render({
        getPlans,
        api: { recordSession },
        endingSoon: false,
      });

      press(section(host)!, 'Record a session');
      await settle(harness.fixture);
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Record a session');
      fill(dialog()!, 'Note (optional)', 'Legs');
      press(dialog()!, 'Record session');
      await settle(harness.fixture);

      expect(recordSession).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({ outcome: 'Held', note: 'Legs' }),
      );
      expect(context.notice()).toBe('The session is recorded. 6 of 10 left on Personal training.');
      expect(textOf(section(host)?.querySelector('.pack-line'))).toContain('6 of 10 left');
    });

    describe('who held it', () => {
      const team = [
        { userId: 'owner-1', displayName: 'Karim Haddad' },
        { userId: 'coach-1', displayName: 'Lea Khoury' },
        { userId: 'coach-2', displayName: 'Omar Saleh' },
      ] as TeamMember[];
      const signedIn = { id: 'owner-1', displayName: 'Karim Haddad' };

      async function openSheet(options: Options) {
        const rendered = await render({ plans: plansOverview([sessionPack()]), ...options });
        press(section(rendered.host)!, 'Record a session');
        await settle(rendered.harness.fixture);
        return rendered;
      }

      const choices = async (harness: { fixture: Parameters<typeof settle>[0] }) => {
        field(dialog()!, 'Who held it').click();
        await settle(harness.fixture);
        return all(dialog()!, '[role="option"]').map(textOf);
      };

      it('offers the owner the team, the client’s coach first and themselves as You', async () => {
        const { harness } = await openSheet({ getTeamMembers: () => of(team), user: signedIn });

        expect(textOf(dialog())).toContain('Who held it');
        expect(await choices(harness)).toEqual(['Lea Khoury', 'You', 'Omar Saleh']);
      });

      it('asks a coach nothing, and reads no team for them', async () => {
        const getTeamMembers = vi.fn(() => of(team));
        await openSheet({
          isOwner: false,
          getTeamMembers,
          user: { id: 'coach-1', displayName: 'Lea Khoury' },
        });

        expect(textOf(dialog())).not.toContain('Who held it');
        expect(getTeamMembers).not.toHaveBeenCalled();
      });

      it('asks an owner on their own nothing', async () => {
        await openSheet({
          getTeamMembers: () => of([team[0]]),
          user: signedIn,
          profile: {
            ...PROFILE,
            assignedCoachUserId: 'owner-1',
            assignedCoachName: 'Karim Haddad',
          },
        });

        expect(textOf(dialog())).not.toContain('Who held it');
      });

      it('still offers the client’s coach and the owner when the team can’t be read', async () => {
        const { harness } = await openSheet({
          getTeamMembers: () => throwError(() => new Error('down')),
          user: signedIn,
        });

        expect(await choices(harness)).toEqual(['Lea Khoury', 'You']);
      });
    });

    it('sells a pack and brings it to the front while it waits for its payment', async () => {
      const sold = unpaidPack();
      const assignProduct = vi.fn(() => of(sold));
      const getPlans = vi
        .fn()
        .mockReturnValueOnce(of(plansOverview([enrollment()])))
        .mockReturnValue(of(plansOverview([sold, enrollment()])));
      const { host, harness } = await render({
        getPlans,
        sells: catalogWithPacks(),
        api: { assignProduct },
      });

      press(section(host)!, 'Sell sessions');
      await settle(harness.fixture);
      all(dialog()!, 'input[type="radio"]')
        .find((item) => (item as HTMLInputElement).value === 'o-pack-1')!
        .click();
      await settle(harness.fixture);
      press(dialog()!, 'Sell sessions');
      await settle(harness.fixture);

      expect(assignProduct).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({ offerId: 'o-pack-1' }),
      );
      expect(textOf(host.querySelector('#plan-title'))).toBe('Personal training');
      expect(textOf(host.querySelector('.hero-actions button'))).toBe('Record payment');
    });

    it('keeps the ledger folded, and undoes a session once the coach says so', async () => {
      const after = sessionPack({}, { left: 8, held: 1 });
      const voidSession = vi.fn(() => of(after));
      const getPlans = vi
        .fn()
        .mockReturnValueOnce(of(plansOverview([sessionPack()])))
        .mockReturnValue(of(plansOverview([after])));
      const { host, harness, context } = await render({ getPlans, api: { voidSession } });

      expect(all(section(host)!, '.ledger-row')).toEqual([]);
      await toggleFold(harness.fixture, section(host)!, 'History');
      const rows = all(section(host)!, '.ledger-row');
      expect(rows.map((row) => textOf(row.querySelector('.ledger-what')))).toEqual([
        'Undid the session of Wed 30 Sep',
        'Held',
        'Held',
        'Charged · No-show',
        'Held',
        '10 sessions added',
      ]);
      expect(rows[1].classList.contains('undone')).toBe(true);
      expect(rows.filter((row) => row.querySelector('button')).length).toBe(3);

      rows[2].querySelector<HTMLButtonElement>('button')!.click();
      await settle(harness.fixture);
      expect(textOf(dialog())).toContain(
        'The session of Tue 29 Sep goes back on the pack. Both stay in its history.',
      );
      press(dialog()!, 'Keep it');
      await settle(harness.fixture);
      expect(voidSession).not.toHaveBeenCalled();

      all(section(host)!, '.ledger-row')[2].querySelector<HTMLButtonElement>('button')!.click();
      await settle(harness.fixture);
      press(dialog()!, 'Undo session');
      await settle(harness.fixture);

      expect(voidSession).toHaveBeenCalledWith('client-1', 's-2', expect.any(String));
      expect(context.notice()).toBe('The session is back on the pack.');
    });

    it('says an undo refused in the server’s words', async () => {
      const voidSession = vi.fn(() =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: {
                code: 'session_already_undone',
                message: 'This session was already undone.',
              },
            }),
        ),
      );
      const { host, harness, context } = await render({
        plans: plansOverview([sessionPack()]),
        api: { voidSession },
      });

      await toggleFold(harness.fixture, section(host)!, 'History');
      all(section(host)!, '.ledger-row button')[0].click();
      await settle(harness.fixture);
      press(dialog()!, 'Undo session');
      await settle(harness.fixture);

      expect(context.error()).toBe('This session was already undone.');
    });

    it('folds the packs that are over', async () => {
      const ended = sessionPack(
        {
          id: 'ended',
          startDate: '2026-05-01',
          endDateExclusive: '2026-07-30',
          lastActiveDate: '2026-07-29',
          effectiveStatus: 'Expired',
        },
        { left: 2, held: 8, charged: 0, lapsed: 2, lapsedOn: '2026-07-29' },
      );
      const { host, harness } = await render({ plans: plansOverview([sessionPack(), ended]) });

      expect(all(section(host)!, '.pack').length).toBe(1);
      await toggleFold(harness.fixture, section(host)!, 'Earlier packs');
      expect(all(section(host)!, '.pack-line').map(textOf)).toContain('8 held · 2 lapsed');
    });

    it('lists a pack in its section alone, with its own menu on that pack', async () => {
      const { host, harness } = await render({
        plans: plansOverview([sessionPack(), enrollment()]),
        sells: catalogWithPacks(),
      });

      expect(host.querySelector('#others-title')).toBeNull();
      expect(textOf(host.querySelector('#plan-title'))).toBe('Online Coaching');

      const menu = section(host)!.querySelector<HTMLButtonElement>(
        'app-menu button[aria-label="More for Personal training · 10 sessions"]',
      )!;
      menu.click();
      await settle(harness.fixture);
      const pause = menuChoices(menu).find((item) => textOf(item).startsWith('Pause plan'))!;
      pause.click();
      await settle(harness.fixture);

      expect(textOf(dialog()?.querySelector('h2'))).toBe('Pause plan');
      // The plan it acts on comes to the front, with its payments.
      expect(textOf(host.querySelector('#plan-title'))).toBe('Personal training');
    });

    it('shows a former client’s ledger with nothing to change', async () => {
      const { host, harness } = await render({
        plans: plansOverview([sessionPack()]),
        profile: FORMER,
      });

      expect(all(section(host)!, '.sessions-actions button')).toEqual([]);
      await toggleFold(harness.fixture, section(host)!, 'History');
      expect(all(section(host)!, '.ledger-row').length).toBe(6);
      expect(all(section(host)!, '.ledger-row button')).toEqual([]);
    });
  });

  describe('a house trainee’s asks for a plan (SUB-020, N9c2)', () => {
    const ENDED =
      'This ask was already booked or closed. Reload the client to see where it stands.';
    const panel = (host: HTMLElement) =>
      host.querySelector<HTMLElement>('[aria-labelledby="asks-title"]');
    const rows = (host: HTMLElement) => all(panel(host)!, '.ask');
    const trainee = () => plansOverview([freePlan()]);
    const asked = (...views: ReturnType<typeof housePlanAsk>[]) =>
      vi.fn(() => of(views.map(toHousePlanAsk)));

    it('reads no asks for a client without the house’s Free', async () => {
      const { host, houseAsks } = await render();

      expect(houseAsks.list).not.toHaveBeenCalled();
      expect(panel(host)).toBeNull();
    });

    it('stays away while the trainee has asked for nothing', async () => {
      const { host, houseAsks } = await render({ plans: trainee() });

      expect(houseAsks.list).toHaveBeenCalledWith('client-1');
      expect(panel(host)).toBeNull();
    });

    it('lists each ask after the plan, newest first, with what the trainee said and how it ended', async () => {
      const { host } = await render({
        plans: trainee(),
        houseAsks: { list: asked(closedAsk(), housePlanAsk(), bookedAsk()) },
      });

      // After the plan in front, before the payments.
      const sections = all(host, 'section.panel');
      expect(sections.indexOf(panel(host)!)).toBe(1);
      expect(textOf(panel(host)!.querySelector('h2'))).toBe('Asks for a plan');
      expect(
        rows(host).map((row) => [
          textOf(row.querySelector('.row-name')),
          textOf(row.querySelector('.row-meta')),
          textOf(row.querySelector('app-status-pill')),
        ]),
      ).toEqual([
        ['Pro+ Programs, 4 weeks', 'USD 47.50 · asked Tue 29 Sep', 'Says it’s sent'],
        ['Pro+ Programs, 8 weeks', 'USD 89.75 · asked Sat 1 Aug', 'Booked'],
        ['Pro+ Programs, 4 weeks', 'USD 47.50 · asked Mon 20 Jul', 'Closed'],
      ]);
      const [open, booked, closed] = rows(host);
      expect(textOf(open.querySelector('[data-sent]'))).toBe(
        'Sent from Maya Fakhoury, +961 70 123 456 on Wed 30 Sep.',
      );
      const number = open.querySelector('[data-sent] .whish-number')!;
      expect([number.getAttribute('dir'), number.getAttribute('translate')]).toEqual(['ltr', 'no']);
      expect(open.querySelector('[data-sent] span[dir="auto"]')?.textContent).toBe('Maya Fakhoury');
      expect(textOf(booked.querySelector('[data-decided]'))).toBe(
        'Booked by Karim Haddad on Mon 3 Aug: runs Mon 3 Aug – Sun 27 Sep.',
      );
      expect(textOf(closed.querySelector('[data-decided]'))).toBe(
        'Closed by Lea Khoury on Mon 27 Jul.',
      );
      expect(textOf(closed.querySelector('[data-reason]'))).toBe(
        'No money came in a week. Ask again when you are ready.',
      );
      // The open ask alone can be booked or closed; neither is the page's one filled button.
      expect(
        all(panel(host)!, 'button').map((item) => [
          textOf(item),
          item.getAttribute('aria-label'),
          item.className.includes('tb-button--filled'),
        ]),
      ).toEqual([
        // Each name starts with the button's visible words (WCAG 2.5.3).
        ['Book plan', 'Book plan, Pro+ Programs, 4 weeks', false],
        ['Close ask', 'Close ask, Pro+ Programs, 4 weeks', false],
      ]);
    });

    it('says the day alone once the trainee’s Whish details were erased', async () => {
      const { host } = await render({
        plans: trainee(),
        houseAsks: {
          list: asked(
            housePlanAsk({
              moneySent: { whishName: null, whishNumber: null, sentOn: '2026-09-30' },
            }),
          ),
        },
      });

      expect(textOf(rows(host)[0].querySelector('[data-sent]'))).toBe('Sent on Wed 30 Sep.');
    });

    it('shows a former client’s asks with nothing to change', async () => {
      const { host, houseAsks } = await render({
        plans: trainee(),
        profile: FORMER,
        houseAsks: { list: asked(housePlanAsk()) },
      });

      expect(houseAsks.list).toHaveBeenCalled();
      expect(rows(host).length).toBe(1);
      expect(all(panel(host)!, 'button')).toEqual([]);
    });

    it('says the asks could not be loaded, keeps the rest of the page, and tries again', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockReturnValue(of([toHousePlanAsk(housePlanAsk())]));
      const { host, harness } = await render({ plans: trainee(), houseAsks: { list } });

      expect(textOf(host.querySelector('#plan-title'))).toBe('Free');
      expect(textOf(panel(host)!.querySelector('[role="alert"]'))).toBe(
        'The asks could not be loaded.',
      );
      const retry = button(panel(host)!, 'Try again');
      retry.focus();
      retry.click();
      await settle(harness.fixture);

      expect(list).toHaveBeenCalledTimes(2);
      expect(rows(host).length).toBe(1);
      expect(panel(host)!.querySelector('[role="alert"]')).toBeNull();
      // Try again went with the failed panel: focus waits on the asks' heading, not on the page.
      expect(document.activeElement?.id).toBe('asks-title');
    });

    it('books the plan in its sheet at the price asked, then says so and reads the plans and asks again', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([toHousePlanAsk(housePlanAsk())]))
        .mockReturnValue(of([toHousePlanAsk(bookedAsk({ id: 'ask-1' }))]));
      const { host, harness, api, houseAsks, context } = await render({
        plans: trainee(),
        houseAsks: { list },
      });

      press(panel(host)!, 'Book plan');
      await settle(harness.fixture);
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Book the plan');
      // The option is named by its length, so the length is not said twice.
      expect(textOf(dialog()?.querySelector('.plan-line'))).toBe('Pro+ Programs, 4 weeks');
      expect(textOf(dialog())).toContain(
        'Check the Whish account for USD 47.50 first. Booking starts Maya’s plan today, or the day after their current plan ends, and records the money as received by Whish today.',
      );
      expect(textOf(dialog()?.querySelector('.sent'))).toBe(
        'Maya says they sent it from Maya Fakhoury, +961 70 123 456 on Wed 30 Sep.',
      );
      expect(field(dialog()!, 'Amount received').value).toBe('47.50');
      fill(dialog()!, 'Reference (optional)', ' WH-88231 ');
      press(dialog()!, 'Book plan');
      await settle(harness.fixture);

      expect(houseAsks.book).toHaveBeenCalledWith('client-1', 'ask-1', {
        amount: 47.5,
        currencyCode: 'USD',
        reference: 'WH-88231',
        idempotencyKey: expect.any(String),
      });
      expect(dialog()).toBeNull();
      expect(context.notice()).toBe('The plan is booked and its payment recorded.');
      expect(api.getClientCommercialOverview).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(2);
      expect(textOf(rows(host)[0].querySelector('app-status-pill'))).toBe('Booked');
      expect(all(panel(host)!, 'button')).toEqual([]);
      // The buttons went with the ask's new state: focus stays in its section.
      expect(document.activeElement?.id).toBe('asks-title');
    });

    it('keeps a refused amount under the field, in the server’s words', async () => {
      const message =
        'Record the plan’s exact price, USD 47.50. A part books nothing: wait for the rest, or close the ask.';
      const book = vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { errors: { amount: [message] } } }),
        ),
      );
      const { host, harness, context } = await render({
        plans: trainee(),
        houseAsks: { list: asked(housePlanAsk()), book },
      });

      press(panel(host)!, 'Book plan');
      await settle(harness.fixture);
      fill(dialog()!, 'Amount received', '20');
      press(dialog()!, 'Book plan');
      await settle(harness.fixture);

      expect(book).toHaveBeenCalledWith(
        'client-1',
        'ask-1',
        expect.objectContaining({ amount: 20 }),
      );
      const amount = field(dialog()!, 'Amount received');
      expect(amount.getAttribute('aria-invalid')).toBe('true');
      expect(
        textOf(document.getElementById(amount.getAttribute('aria-describedby')!.split(' ')[0])),
      ).toBe(message);
      expect(textOf(formSummary(dialog()!))).toBe('Check the fields marked above.');
      expect(document.activeElement).toBe(formSummary(dialog()!));
      expect(context.notice()).toBeNull();
    });

    it('keeps the booking sheet open while it books, then reads the asks again once it is left after the ask ended meanwhile', async () => {
      const answer = new Subject<HousePlanAsk>();
      const list = vi
        .fn()
        .mockReturnValueOnce(of([toHousePlanAsk(housePlanAsk())]))
        .mockReturnValue(of([toHousePlanAsk(bookedAsk({ id: 'ask-1' }))]));
      const { host, harness, api, context } = await render({
        plans: trainee(),
        houseAsks: { list, book: vi.fn(() => answer) },
      });

      press(panel(host)!, 'Book plan');
      await settle(harness.fixture);
      press(dialog()!, 'Book plan');
      await settle(harness.fixture);
      expect(button(dialog()!, 'Not now').disabled).toBe(true);
      // Neither Escape nor the sheet's own close button ends it while the answer is on its way.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(harness.fixture);
      expect(textOf(dialog()?.querySelector('button[type="submit"]'))).toBe('Booking…');

      answer.error(
        new HttpErrorResponse({
          status: 409,
          error: { code: 'house_plan_ask_ended', message: ENDED },
        }),
      );
      await settle(harness.fixture);
      expect(textOf(formSummary(dialog()!))).toBe(ENDED);
      expect(button(dialog()!, 'Not now').disabled).toBe(false);
      expect(list).toHaveBeenCalledTimes(1);

      dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(harness.fixture);
      expect(dialog()).toBeNull();
      expect(api.getClientCommercialOverview).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(2);
      expect(textOf(rows(host)[0].querySelector('app-status-pill'))).toBe('Booked');
      expect(all(panel(host)!, 'button')).toEqual([]);
      expect(document.activeElement?.id).toBe('asks-title');
      expect(context.notice()).toBeNull();
    });

    it('keeps the closing dialog open while it closes the ask, so its answer is said', async () => {
      const answer = new Subject<HousePlanAsk>();
      const list = vi
        .fn()
        .mockReturnValueOnce(of([toHousePlanAsk(housePlanAsk())]))
        .mockReturnValue(of([toHousePlanAsk(closedAsk({ id: 'ask-1' }))]));
      const { host, harness, context } = await render({
        plans: trainee(),
        houseAsks: { list, close: vi.fn(() => answer) },
      });

      press(panel(host)!, 'Close ask');
      await settle(harness.fixture);
      fill(dialog()!, 'Reason', 'No money came in a week.');
      press(dialog()!, 'Close ask');
      await settle(harness.fixture);
      expect(button(dialog()!, 'Not now').disabled).toBe(true);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(harness.fixture);
      expect(textOf(dialog()?.querySelector('button[type="submit"]'))).toBe('Closing…');

      answer.next(toHousePlanAsk(closedAsk({ id: 'ask-1' })));
      answer.complete();
      await settle(harness.fixture);
      expect(dialog()).toBeNull();
      expect(context.notice()).toBe('The ask is closed.');
      expect(list).toHaveBeenCalledTimes(2);
      expect(textOf(rows(host)[0].querySelector('app-status-pill'))).toBe('Closed');
    });

    it('closes an ask with the reason the trainee reads', async () => {
      const list = vi
        .fn()
        .mockReturnValueOnce(of([toHousePlanAsk(housePlanAsk())]))
        .mockReturnValue(of([toHousePlanAsk(closedAsk({ id: 'ask-1' }))]));
      const { host, harness, houseAsks, context } = await render({
        plans: trainee(),
        houseAsks: { list },
      });

      press(panel(host)!, 'Close ask');
      await settle(harness.fixture);
      expect(textOf(dialog()?.querySelector('h2'))).toBe('Close this ask');
      expect(textOf(dialog()?.querySelector('.plan-line'))).toBe('Pro+ Programs, 4 weeks');
      expect(textOf(dialog())).toContain(
        'Maya reads this on their plan page. 500 characters at most.',
      );
      fill(dialog()!, 'Reason', ' No money came in a week. ');
      press(dialog()!, 'Close ask');
      await settle(harness.fixture);

      expect(houseAsks.close).toHaveBeenCalledWith('client-1', 'ask-1', 'No money came in a week.');
      expect(dialog()).toBeNull();
      expect(context.notice()).toBe('The ask is closed.');
      expect(textOf(rows(host)[0].querySelector('app-status-pill'))).toBe('Closed');
      expect(document.activeElement?.id).toBe('asks-title');
    });
  });
});
