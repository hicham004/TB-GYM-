import { UnsavedWork } from '../../core/forms/unsaved-work';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  WorkspaceDetails,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  cancelledPlan,
  catalog,
  enrollment,
  plansOverview,
  SERVICE_TODAY,
  unpaidRenewal,
} from '../../../testing/client-service-fixtures';
import { fill, press, settle } from '../../../testing/dom';
import { TeamApi } from '../team/team-api';
import { ClientService } from './client-service';
import { ClientWorkspaceContext } from './client-workspace.context';
import { FormerClientsApi } from './former-clients-api';

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
  /** Replaces the plans read, to fail it or to answer differently the second time. */
  getPlans?: () => Observable<ClientCommercialOverview>;
  profile?: CoachClientDetails;
  isOwner?: boolean;
  renewalAskedAt?: string | null;
  /** The plan the request names; the client's plan that ran out. */
  renewalSubject?: string;
  url?: string;
  api?: Record<string, unknown>;
}

async function render(options: Options = {}) {
  const getClientCommercialOverview = options.getPlans
    ? vi.fn(options.getPlans)
    : vi.fn(() => of(options.plans ?? plansOverview([cancelledPlan(), enrollment()])));
  const api = {
    getClientCommercialOverview,
    getProductCatalog: vi.fn(() => of(catalog())),
    getClientOverview: vi.fn(() =>
      of({
        attention: options.renewalAskedAt
          ? [
              {
                kind: 'RenewalRequested',
                since: options.renewalAskedAt,
                subjectId: options.renewalSubject ?? 'e-1',
              },
            ]
          : [],
      }),
    ),
    resumeEnrollment: vi.fn(() => of(enrollment())),
    renewEnrollment: vi.fn(() => of(unpaidRenewal())),
    assignProduct: vi.fn(() => of(enrollment({ id: 'e-new' }))),
    recordManualPayment: vi.fn(() => of(unpaidRenewal())),
    ...options.api,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'clients/:clientId/service', component: ClientService }]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TeamApi, useValue: { getTeamMembers: vi.fn(() => of([])) } },
      { provide: FormerClientsApi, useValue: { releaseClient: vi.fn() } },
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
    expect(textOf(owner.host.querySelector('.setting p'))).toBe(
      'Maya can use everything their current plan includes.',
    );

    TestBed.resetTestingModule();
    const coach = await render({ isOwner: false });
    expect(coach.host.querySelector('app-client-coach')).toBeNull();
    expect(coach.host.querySelector('app-client-release')).toBeNull();
    expect(all(coach.host, '.setting button').map(textOf)).toEqual(['Block access']);
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
});
