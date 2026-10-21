import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachClientDetails,
  FeatureAccessDecision,
} from '../../core/api/api.models';
import type { ConversationDetail } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { ClientWorkspace } from './client-workspace';

@Component({ selector: 'app-section-stub', template: 'section' })
class SectionStub {}

const OWNER_ID = 'owner-1';

const PROFILE = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Rahman',
  email: 'maya@example.test',
  goals: 'Lose 6 kg and feel strong for my wedding in December.',
  onboardingStatus: 'Completed',
  coachNotes: null,
  version: 3,
  assignedCoachUserId: OWNER_ID,
  assignedCoachName: 'Karim Haddad',
  release: null,
} as unknown as CoachClientDetails;

function plan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    renewedFromEnrollmentId: null,
    productName: 'Online Coaching',
    offerLabel: '12 weeks',
    startDate: '2026-07-21',
    endDateExclusive: '2026-11-15',
    lastActiveDate: '2026-11-14',
    effectiveStatus: 'Active',
    features: ['Training'],
    ...overrides,
  } as ClientEnrollment;
}

function decision(
  feature: FeatureAccessDecision['feature'],
  isAllowed: boolean,
  reason: FeatureAccessDecision['reason'] = isAllowed ? 'Granted' : 'NoEntitlement',
): FeatureAccessDecision {
  return {
    feature,
    isAllowed,
    reason,
    enrollmentId: null,
    accessibleFrom: null,
    accessibleUntilExclusive: null,
  };
}

async function render(
  options: {
    profile?: CoachClientDetails;
    enrollments?: ClientEnrollment[];
    featureAccess?: FeatureAccessDecision[];
    userId?: string;
    isOwner?: boolean;
    api?: Record<string, unknown>;
  } = {},
) {
  const overview: ClientCommercialOverview = {
    clientProfileId: 'client-1',
    isRelationshipBlocked: false,
    featureAccess: options.featureAccess ?? [decision('Messaging', true)],
    enrollments: options.enrollments ?? [plan()],
  };
  const api = {
    getClient: vi.fn(() => of(options.profile ?? PROFILE)),
    getClientCommercialOverview: vi.fn(() => of(overview)),
    getWorkspace: vi.fn(() =>
      of({ timeZoneId: 'Asia/Beirut', weekStartsOn: 'Monday', currentDate: '2026-09-20' }),
    ),
    ...options.api,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'clients/:clientId',
          component: ClientWorkspace,
          children: [
            { path: '', component: SectionStub },
            { path: 'training', component: SectionStub },
          ],
        },
        { path: 'messages', component: SectionStub },
      ]),
      { provide: ApiClient, useValue: api },
      { provide: AuthStore, useValue: { user: signal({ id: options.userId ?? OWNER_ID }) } },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          isOwner: signal(options.isOwner ?? true),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/clients/client-1');
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

function sectionNames(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('app-section-nav a')).map(
    (anchor) => anchor.textContent?.trim() ?? '',
  );
}

function pill(host: HTMLElement): string {
  return host.querySelector('app-status-pill')?.textContent?.trim() ?? '';
}

function menuLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('app-client-actions a.item .item-title')).map(
    (item) => item.textContent?.trim() ?? '',
  );
}

describe('ClientWorkspace', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('heads the record with the person: face, name, goal, plan and the sections', async () => {
    const { host } = await render();

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Maya Rahman');
    expect(host.querySelector('app-avatar')?.textContent?.trim()).toBe('MR');
    expect(host.querySelector('.goal')?.textContent?.trim()).toBe(
      'Lose 6 kg and feel strong for my wedding in December.',
    );
    // The plan pill says how long is left, and the line names the plan.
    expect(pill(host)).toBe('Active · 55 days left');
    expect(host.querySelector('.plan-line')?.textContent?.trim()).toBe(
      'Online Coaching · 12 weeks · until Sat 14 Nov',
    );
    expect(sectionNames(host)).toEqual([
      'Overview',
      'Training',
      'Nutrition',
      'Check-ins',
      'Progress',
      'Service & access',
    ]);
    // Each section is a link to its own route, and the open one is marked as the current page.
    const overview = host.querySelector('app-section-nav a');
    expect(overview?.getAttribute('href')).toBe('/clients/client-1');
    expect(overview?.getAttribute('aria-current')).toBe('page');
    // The one primary action is Message; the rest sit behind Actions.
    expect(host.querySelectorAll('.header-actions .tb-button--filled')).toHaveLength(1);
    expect(host.querySelector('.header-actions .tb-button--filled')?.textContent?.trim()).toBe(
      'Message Maya',
    );
  });

  it('puts focus on the client’s name when the record opens, once', async () => {
    const { host } = await render();

    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('warns in the pill when the plan ends within 14 days, in days, tomorrow and today', async () => {
    const ends = async (lastActiveDate: string) => {
      TestBed.resetTestingModule();
      const day = new Date(Date.parse(`${lastActiveDate}T00:00:00Z`) + 86_400_000);
      const { host } = await render({
        enrollments: [plan({ lastActiveDate, endDateExclusive: day.toISOString().slice(0, 10) })],
      });
      return pill(host);
    };

    expect(await ends('2026-09-29')).toBe('Plan ends in 9 days');
    expect(await ends('2026-09-21')).toBe('Plan ends tomorrow');
    expect(await ends('2026-09-20')).toBe('Plan ends today');
    // Far enough away it counts the days left instead.
    expect(await ends('2026-10-04')).toBe('Plan ends in 14 days');
    expect(await ends('2026-10-05')).toBe('Active · 15 days left');
  });

  it('names where each other kind of plan stands, with the right tone', async () => {
    const standing = async (effectiveStatus: ClientEnrollment['effectiveStatus']) => {
      TestBed.resetTestingModule();
      const { host } = await render({ enrollments: [plan({ effectiveStatus })] });
      return [pill(host), host.querySelector('app-status-pill')?.className.replace(/\s+/g, ' ')];
    };

    expect((await standing('Paused'))[0]).toBe('Plan paused');
    expect((await standing('PendingPayment'))[0]).toBe('Awaiting payment');
    expect((await standing('Upcoming'))[0]).toBe('Plan not started');
    expect((await standing('Expired'))[0]).toBe('Plan ended');
    expect((await standing('Cancelled'))[0]).toBe('Plan cancelled');
    expect((await standing('Blocked'))[0]).toBe('Access blocked');
    expect((await standing('Blocked'))[1]).toContain('danger');
    expect((await standing('Active'))[1]).toContain('success');
  });

  it('says the day a plan was cancelled, never its last day still to come (COACH-20)', async () => {
    const { host } = await render({
      enrollments: [
        plan({
          effectiveStatus: 'Cancelled',
          storedStatus: 'Cancelled',
          cancelledOn: '2026-09-18',
        }),
      ],
    });

    expect(host.querySelector('.plan-line')?.textContent?.trim()).toBe(
      'Online Coaching · 12 weeks · cancelled Fri 18 Sep',
    );
  });

  it('offers only the kept sections for a former client, and no message action', async () => {
    const { host, harness } = await render({
      profile: {
        ...PROFILE,
        release: {
          releasedAtUtc: '2026-09-20T10:00:00Z',
          reason: 'Moved',
          releasedByName: 'Olivia Owner',
          departureKind: 'ReleasedByOwner',
        },
      } as CoachClientDetails,
    });

    expect(pill(host)).toBe('Former client');
    expect(sectionNames(host)).toEqual(['Overview', 'Progress', 'Service & access']);
    expect(host.textContent).not.toContain('Message Maya');
    expect(host.querySelector('.plan-line')).toBeNull();
    // A former client's intake is read, not edited: it is the one thing behind Actions.
    press(host, 'Actions');
    await settle(harness.fixture);
    expect(menuLabels(host)).toEqual(['View intake']);
  });

  it('names the coach to an owner when the client is a team member’s, and not otherwise', async () => {
    const theirs = await render({ userId: 'coach-9' });
    expect(theirs.host.textContent).toContain('Coached by Karim Haddad');

    TestBed.resetTestingModule();
    const mine = await render({ userId: OWNER_ID });
    expect(mine.host.textContent).not.toContain('Coached by');

    // A coach never sees the line: it is for the owner.
    TestBed.resetTestingModule();
    const coach = await render({ userId: 'coach-9', isOwner: false });
    expect(coach.host.textContent).not.toContain('Coached by');
  });

  it('tells an owner who messages a team member’s client instead of offering a chat (COACH-13)', async () => {
    const theirs = await render({ userId: 'coach-9' });
    expect(theirs.host.textContent).not.toContain('Message Maya');
    expect(theirs.host.querySelector('.messaging-note')?.textContent?.trim()).toBe(
      'Messages go through Karim Haddad.',
    );

    // Their own client is theirs to message.
    TestBed.resetTestingModule();
    const mine = await render({ userId: OWNER_ID });
    expect(mine.host.textContent).toContain('Message Maya');
    expect(mine.host.querySelector('.messaging-note')).toBeNull();
  });

  it('offers Message only while the plan includes messaging, and says so when it lacks it', async () => {
    const without = await render({ featureAccess: [decision('Messaging', false)] });
    expect(without.host.textContent).not.toContain('Message Maya');
    expect(without.host.querySelector('.messaging-note')?.textContent?.trim()).toBe(
      'Messaging isn’t part of this plan.',
    );

    // A lapsed or paused plan is told by the pill, not by a second line about messaging.
    TestBed.resetTestingModule();
    const paused = await render({ featureAccess: [decision('Messaging', false, 'Paused')] });
    expect(paused.host.textContent).not.toContain('Message Maya');
    expect(paused.host.querySelector('.messaging-note')).toBeNull();

    // Until the plans arrive it is offered, so the coach is never left without it by a slow read.
    TestBed.resetTestingModule();
    const unknown = await render({
      api: { getClientCommercialOverview: vi.fn(() => throwError(() => new Error('refused'))) },
    });
    expect(unknown.host.textContent).toContain('Message Maya');
  });

  it('says No plan yet alone for a client with no plan at all (COACH-10)', async () => {
    const { host } = await render({
      enrollments: [],
      featureAccess: [decision('Messaging', false)],
    });

    expect(pill(host)).toBe('No plan yet');
    // Not "Messaging isn't part of this plan." about a plan that does not exist.
    expect(host.querySelector('.messaging-note')).toBeNull();
    expect(host.textContent).not.toContain('Message Maya');
    expect(host.querySelector('.plan-line')).toBeNull();
  });

  it('puts the secondary actions behind one menu that names where each goes', async () => {
    const { host, harness } = await render();

    expect(menuLabels(host)).toEqual([]);
    press(host, 'Actions');
    await settle(harness.fixture);

    expect(menuLabels(host)).toEqual(['Assign program', 'Plan and payments', 'Edit intake']);
    const hrefs = Array.from(host.querySelectorAll('app-client-actions a.item')).map((anchor) =>
      anchor.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/clients/client-1/training?action=assign',
      '/clients/client-1/service',
      '/clients/client-1/intake',
    ]);
  });

  it('turns Plan and payments into Renew plan, with its target, in the last 14 days', async () => {
    const { host, harness } = await render({
      enrollments: [plan({ lastActiveDate: '2026-09-29', endDateExclusive: '2026-09-30' })],
    });

    press(host, 'Actions');
    await settle(harness.fixture);

    expect(menuLabels(host)).toEqual(['Assign program', 'Renew plan', 'Edit intake']);
    expect(host.querySelectorAll('app-client-actions a.item')[1].getAttribute('href')).toBe(
      '/clients/client-1/service?renew=enrollment-1',
    );
    const hints = Array.from(host.querySelectorAll('app-client-actions .item-hint')).map((item) =>
      item.textContent?.trim(),
    );
    expect(hints).toContain('Ends in 9 days');
  });

  it('opens a direct conversation and reuses its command key after a failed attempt', async () => {
    // As the server sends it; the page maps it before handing it to Messages.
    const detail: ConversationDetail = {
      conversation: {
        id: 'conversation-1',
        clientProfileId: 'client-1',
        counterpart: { userId: 'user-maya', displayName: 'Maya Fakhoury', role: 'Client' },
        callerRole: 'Coach',
        canModerate: true,
        startedAtUtc: '2026-10-01T08:00:00Z',
        lastActivityAtUtc: '2026-10-01T08:00:00Z',
        lastSequence: '0',
        unreadCount: '0',
        lastReadSequence: '0',
        lastReadAtUtc: null,
        isAvailable: true,
        accessReason: 'Granted',
        lastMessage: null,
      },
      readState: {
        conversationId: 'conversation-1',
        userId: 'coach-1',
        role: 'Coach',
        lastReadSequence: '0',
        lastReadAtUtc: null,
        unreadCount: '0',
        latestSequence: '0',
      },
    };
    const create = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(detail));
    const { harness, host } = await render({ api: { createDirectConversation: create } });

    press(host, 'Message Maya');
    await settle(harness.fixture);
    expect(host.textContent).toContain('Couldn’t open this conversation');

    press(host, 'Message Maya');
    await settle(harness.fixture);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(create.mock.calls[0][0]).toBe('client-1');
    expect(TestBed.inject(Router).url).toBe('/messages');
    expect(TestBed.inject(ConversationLaunch).take('tenant-1')).toMatchObject({
      id: 'conversation-1',
      clientProfileId: 'client-1',
      counterpart: { displayName: 'Maya Fakhoury' },
      lastSequence: 0,
    });
  });

  it('keeps the header when plans or the calendar cannot be read, and retries a failed record', async () => {
    const getClient = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(PROFILE));
    const { harness, host } = await render({
      api: {
        getClient,
        getClientCommercialOverview: vi.fn(() => throwError(() => new Error('refused'))),
      },
    });

    expect(host.textContent).toContain('The client profile could not be loaded.');
    press(host, 'Retry');
    await settle(harness.fixture);
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Maya Rahman');
    expect(host.querySelector('app-section-stub')).not.toBeNull();
    // Without plans the header says nothing about a plan rather than guessing one.
    expect(host.querySelector('app-status-pill')).toBeNull();
    expect(host.querySelector('.plan-line')).toBeNull();
  });

  it('says a client the server does not find is not here, with the way to Clients and no Retry', async () => {
    // What a coach gets for another coach's client (ADR 0026) or an old link.
    const getClient = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 404, url: '/api/clients/client-1' })),
    );
    const { host } = await render({ api: { getClient } });

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('This client isn’t here');
    expect(host.querySelector('app-empty-state p')?.textContent?.trim()).toBe(
      'The link may be old, or this client isn’t in your client list.',
    );
    const link = host.querySelector<HTMLAnchorElement>('app-empty-state a');
    expect(link?.textContent?.trim()).toBe('See your clients');
    expect(link?.getAttribute('href')).toBe('/clients');
    // Asking again can never help, so nothing offers it or reads as a failure.
    expect(buttonNames(host)).not.toContain('Retry');
    expect(alerts(host)).toEqual([]);
    expect(host.querySelector('app-section-nav')).toBeNull();
    expect(host.querySelector('app-section-stub')).toBeNull();
    expect(getClient).toHaveBeenCalledTimes(1);
  });

  it('keeps Retry for a failure that may pass, such as a server error', async () => {
    const getClient = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValueOnce(of(PROFILE));
    const { harness, host } = await render({ api: { getClient } });

    expect(alerts(host)).toEqual(['The client profile could not be loaded.']);
    expect(host.querySelector('app-empty-state')).toBeNull();
    press(host, 'Retry');
    await settle(harness.fixture);
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Maya Rahman');
  });
});

function buttonNames(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('button')).map(
    (button) => button.textContent?.trim() ?? '',
  );
}

/** The alerts that say something; the page keeps an empty one ready for a failed change. */
function alerts(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[role="alert"]'))
    .map((alert) => alert.textContent?.trim() ?? '')
    .filter((text) => text !== '');
}
