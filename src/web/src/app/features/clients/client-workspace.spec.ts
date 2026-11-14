import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { ConversationLaunch } from '../messaging/conversation-launch';
import { ClientWorkspace } from './client-workspace';
import { ClientWorkspaceContext } from './client-workspace.context';
import { clientRoutes } from './clients.routes';

@Component({ selector: 'app-section-stub', template: 'section' })
class SectionStub {}

/** A tab that asks the record for this page's plans, as Service & access and the Overview do. */
@Component({ selector: 'app-plans-tab', template: '{{ plans() }}' })
class PlansTab {
  private readonly context = inject(ClientWorkspaceContext);
  protected readonly plans = signal('');

  constructor() {
    void this.context
      .plansForPage()
      .then((overview) => this.plans.set(`${overview.enrollments.length} plans`));
  }
}

/** A tab that asks the record for this page's overview, as the Overview and Service & access do. */
@Component({ selector: 'app-overview-tab', template: '{{ kinds() }}' })
class OverviewTab {
  private readonly context = inject(ClientWorkspaceContext);
  protected readonly kinds = signal('');

  constructor() {
    void this.context
      .overviewForPage()
      .then((overview) => this.kinds.set(overview.attention.map((item) => item.kind).join(',')));
  }
}

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

/**
 * Lea's client, read by the owner (N9d1a): the server withholds the private side. The goal is left in,
 * as a leaky double would, to show the page does not draw it either.
 */
const LEAS = {
  ...PROFILE,
  assignedCoachUserId: 'coach-lea',
  assignedCoachName: 'Lea Khoury',
  mayCoach: false,
} as CoachClientDetails;

/** A client whose coach left (N9d1b): nobody coaches them, so nobody opens their private side. */
const WAITING = {
  ...LEAS,
  goals: null,
  assignedCoachUserId: null,
  assignedCoachName: '',
} as CoachClientDetails;

/** Each private section created, so a test can see one never was. */
const created: string[] = [];

@Component({ selector: 'app-private-stub', template: 'private section' })
class PrivateStub {
  constructor() {
    created.push('private');
  }

  /** As Edit weeks and the review do: a drawn page holding no work lets the person go. */
  canLeave(): boolean {
    return true;
  }
}

/** The record's sections as `clients.routes.ts` declares them (N9d1a), each with its marker and guards. */
const CLIENT_SECTIONS: Routes = clientRoutes.find((route) => route.path === ':clientId')!.children!;

const isPrivate = (section: Route) => section.data?.['side'] === 'private';

/**
 * The real sections, their markers and leave guards kept and each page stubbed: a private one counts
 * itself created, so a test sees a page the record must never draw.
 */
const SIDED_SECTIONS: Routes = CLIENT_SECTIONS.map((section) => ({
  path: section.path,
  pathMatch: section.pathMatch,
  data: section.data,
  canDeactivate: section.canDeactivate,
  component: isPrivate(section) ? PrivateStub : SectionStub,
}));

/** Each private section's address, its parameters filled in. */
const PRIVATE_ADDRESSES: Record<string, string> = {
  training: 'training',
  'training/:mesocycleId/edit': 'training/mesocycle-1/edit',
  nutrition: 'nutrition',
  checkins: 'checkins',
  'checkins/:assignmentId': 'checkins/assignment-1',
  progress: 'progress',
  intake: 'intake',
};

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
    sections?: Routes;
    /** The last day the server flags as ending soon (CLI-018), when it flags one. */
    endingSoon?: string | null;
    /** Where the record is opened: its Overview unless a test opens a section by address. */
    url?: string;
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
    getClientOverview: vi.fn(() =>
      of({
        attention: options.endingSoon
          ? [
              {
                kind: 'PlanEndingSoon',
                date: options.endingSoon,
                subjectId: 'enrollment-1',
                count: null,
              },
            ]
          : [],
      }),
    ),
    ...options.api,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'clients/:clientId',
          component: ClientWorkspace,
          children: options.sections ?? [
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
  await harness.navigateByUrl(options.url ?? '/clients/client-1');
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

  it('shows the record’s shape while it is read, said once (audit UIQ-5)', async () => {
    const client = new Subject<CoachClientDetails>();
    const { harness, host } = await render({ api: { getClient: vi.fn(() => client) } });

    const shape = host.querySelector('.record-skeleton');
    expect(shape?.getAttribute('role')).toBe('status');
    expect(shape?.textContent?.trim()).toBe('Loading client…');
    expect(host.querySelector('.panel-bones')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('h1')).toBeNull();

    client.next(PROFILE);
    client.complete();
    await settle(harness.fixture);

    expect(host.querySelector('.record-skeleton')).toBeNull();
    expect(host.querySelector('.panel-bones')).toBeNull();
    expect(host.querySelector('h1')?.textContent).toContain('Maya Rahman');
  });

  it('gives a tab that opens with the record its read of the plans, and a later page a fresh one (audit UIQ-8)', async () => {
    const { harness, host, api } = await render({
      sections: [
        { path: '', component: PlansTab },
        { path: 'service', component: PlansTab },
      ],
    });
    await settle(harness.fixture);

    expect(host.querySelector('app-plans-tab')?.textContent).toBe('1 plans');
    expect(api.getClientCommercialOverview).toHaveBeenCalledTimes(1);

    await harness.navigateByUrl('/clients/client-1/service');
    await settle(harness.fixture);
    await settle(harness.fixture);

    expect(host.querySelector('app-plans-tab')?.textContent).toBe('1 plans');
    expect(api.getClientCommercialOverview).toHaveBeenCalledTimes(2);
  });

  it('shares the header’s read of the overview with a tab that opens with it (critique B4a)', async () => {
    const { harness, host, api } = await render({
      endingSoon: '2026-09-29',
      enrollments: [plan({ lastActiveDate: '2026-09-29', endDateExclusive: '2026-09-30' })],
      sections: [{ path: '', component: OverviewTab }],
    });
    await settle(harness.fixture);

    expect(host.querySelector('app-overview-tab')?.textContent).toBe('PlanEndingSoon');
    expect(api.getClientOverview).toHaveBeenCalledTimes(1);
    expect(pill(host)).toBe('Plan ends in 9 days');
  });

  it('reads the plans again for a tab when the record could not read them', async () => {
    const getClientCommercialOverview = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('refused')))
      .mockReturnValue(
        of({
          clientProfileId: 'client-1',
          isRelationshipBlocked: false,
          featureAccess: [],
          enrollments: [],
        }),
      );
    const { harness, host } = await render({
      api: { getClientCommercialOverview },
      sections: [{ path: '', component: PlansTab }],
    });
    await settle(harness.fixture);

    expect(getClientCommercialOverview).toHaveBeenCalledTimes(2);
    expect(host.querySelector('app-plans-tab')?.textContent).toBe('0 plans');
  });

  it('puts focus on the client’s name when the record opens, once', async () => {
    const { host } = await render();

    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('warns in the pill while the server flags the plan ending soon, in days, tomorrow and today', async () => {
    const ends = async (lastActiveDate: string, flagged: boolean) => {
      TestBed.resetTestingModule();
      const day = new Date(Date.parse(`${lastActiveDate}T00:00:00Z`) + 86_400_000);
      const { host } = await render({
        enrollments: [plan({ lastActiveDate, endDateExclusive: day.toISOString().slice(0, 10) })],
        endingSoon: flagged ? lastActiveDate : null,
      });
      return pill(host);
    };

    expect(await ends('2026-09-29', true)).toBe('Plan ends in 9 days');
    expect(await ends('2026-09-21', true)).toBe('Plan ends tomorrow');
    expect(await ends('2026-09-20', true)).toBe('Plan ends today');
    // The server flags a last day 13 days on and not one 14 days on (critique B4a): the page shows
    // its flag and counts no days of its own, so the warm pill starts a day later than it did.
    expect(await ends('2026-10-03', true)).toBe('Plan ends in 13 days');
    expect(await ends('2026-10-04', false)).toBe('Active · 14 days left');
    expect(await ends('2026-10-05', false)).toBe('Active · 15 days left');
  });

  it('keeps the pill’s place until the server says whether the plan ends soon', async () => {
    const overview = new Subject<unknown>();
    const { harness, host } = await render({
      api: { getClientOverview: vi.fn(() => overview) },
    });

    expect(host.querySelector('.plan-row .pill-bone')).not.toBeNull();
    expect(host.querySelector('app-status-pill')).toBeNull();

    overview.next({ attention: [] });
    overview.complete();
    await settle(harness.fixture);
    expect(host.querySelector('.plan-row .pill-bone')).toBeNull();
    expect(pill(host)).toBe('Active · 55 days left');
  });

  it('says how long is left in the pill when the overview cannot be read', async () => {
    const { host } = await render({
      api: { getClientOverview: vi.fn(() => throwError(() => new Error('offline'))) },
    });

    expect(pill(host)).toBe('Active · 55 days left');
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
    const { host, harness, api } = await render({
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
    // A former client has no overview to read (it would answer 404).
    expect(api.getClientOverview).not.toHaveBeenCalled();
    expect(sectionNames(host)).toEqual(['Overview', 'Progress', 'Service & access']);
    expect(host.textContent).not.toContain('Message Maya');
    expect(host.querySelector('.plan-line')).toBeNull();
    // A former client's intake is read, not edited: it is the one thing behind Actions.
    press(host, 'Actions');
    await settle(harness.fixture);
    expect(menuLabels(host)).toEqual(['View intake']);
  });

  it('names the coach to an owner when the client is a team member’s, and not otherwise', async () => {
    // The owner reads a team member's client, whose private side is closed to them (N9d1a).
    const theirs = await render({ userId: 'coach-9', profile: { ...PROFILE, mayCoach: false } });
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
    const theirs = await render({ userId: 'coach-9', profile: { ...PROFILE, mayCoach: false } });
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

  it('turns Plan and payments into Renew plan, with its target, while the server flags the plan', async () => {
    const { host, harness } = await render({
      enrollments: [plan({ lastActiveDate: '2026-09-29', endDateExclusive: '2026-09-30' })],
      endingSoon: '2026-09-29',
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

  describe('for an owner who does not coach the client (N9d1a)', () => {
    beforeEach(() => {
      created.length = 0;
    });

    function why(host: HTMLElement) {
      const panel = host.querySelector<HTMLElement>('.section-content section.why');
      const link = panel?.querySelector<HTMLAnchorElement>('a') ?? null;
      return {
        panel,
        heading: panel?.querySelector('h2')?.textContent?.trim(),
        text: panel?.querySelector('p')?.textContent?.trim(),
        link: link && {
          name: link.textContent?.trim(),
          href: link.getAttribute('href'),
          filled: link.classList.contains('tb-button--filled'),
        },
      };
    }

    it('marks every section of the private side, and only those, as clients.routes.ts declares them', () => {
      expect(CLIENT_SECTIONS.filter(isPrivate).map((section) => section.path)).toEqual([
        'training',
        'training/:mesocycleId/edit',
        'nutrition',
        'checkins',
        'checkins/:assignmentId',
        'progress',
        'intake',
      ]);
      expect(
        CLIENT_SECTIONS.filter((section) => !isPrivate(section)).map((section) => section.path),
      ).toEqual(['', 'service']);
      // A private page may never be drawn, so its guard must not ask a page that is not there.
      for (const section of CLIENT_SECTIONS.filter(isPrivate)) {
        expect(section.canDeactivate ?? []).not.toContain(confirmBeforeLeaving);
      }
    });

    it.each(Object.entries(PRIVATE_ADDRESSES))(
      'says why in place of %s reached by address, creates nothing and lets the owner leave',
      async (_path, address) => {
        const { host } = await render({
          profile: LEAS,
          sections: SIDED_SECTIONS,
          url: `/clients/client-1/${address}`,
        });

        expect(why(host).heading).toBe('Lea Khoury coaches Maya');
        expect(host.querySelector('app-private-stub')).toBeNull();
        expect(created).toEqual([]);

        const router = TestBed.inject(Router);
        await expect(router.navigateByUrl('/clients/client-1')).resolves.toBe(true);
        expect(router.url).toBe('/clients/client-1');
        expect(created).toEqual([]);
      },
    );

    it('offers the business side alone: the Overview, Service & access and Plan and payments', async () => {
      const { host, harness } = await render({ profile: LEAS, sections: SIDED_SECTIONS });

      expect(sectionNames(host)).toEqual(['Overview', 'Service & access']);
      expect(host.querySelector('.plan-row')?.textContent).toContain('Coached by Lea Khoury');
      expect(host.querySelector('.messaging-note')?.textContent?.trim()).toBe(
        'Messages go through Lea Khoury.',
      );
      expect(host.textContent).not.toContain('Message Maya');
      // Their goal is their coach's to read.
      expect(host.querySelector('.goal')).toBeNull();
      press(host, 'Actions');
      await settle(harness.fixture);
      expect(menuLabels(host)).toEqual(['Plan and payments']);
    });

    it('says why in place of a private section reached by address, and never creates it', async () => {
      const { host, harness } = await render({
        profile: LEAS,
        sections: SIDED_SECTIONS,
        url: '/clients/client-1/training',
      });

      const closed = why(host);
      expect(closed.heading).toBe('Lea Khoury coaches Maya');
      expect(closed.text).toBe(
        'As the owner you see Maya’s plan, payments and sessions. Their training, nutrition, check-ins and progress open only to their coach.',
      );
      expect(closed.link).toEqual({
        name: 'Service & access',
        href: '/clients/client-1/service',
        filled: false,
      });
      expect(closed.panel?.getAttribute('aria-labelledby')).toBe('closed-section-title');
      // The section is never created, so nothing it would read is asked for.
      expect(host.querySelector('app-private-stub')).toBeNull();
      expect(created).toEqual([]);

      // A business section draws as ever.
      await harness.navigateByUrl('/clients/client-1/service');
      await settle(harness.fixture);
      expect(why(host).panel).toBeNull();
      expect(host.querySelector('app-section-stub')).not.toBeNull();
    });

    it('leaves a private page it never drew without asking that page anything', async () => {
      const { harness, host } = await render({
        profile: LEAS,
        sections: SIDED_SECTIONS,
        url: '/clients/client-1/checkins/assignment-1',
      });
      expect(why(host).heading).toBe('Lea Khoury coaches Maya');

      await harness.navigateByUrl('/clients/client-1/service');
      await settle(harness.fixture);

      expect(TestBed.inject(Router).url).toBe('/clients/client-1/service');
      expect(created).toEqual([]);
    });

    it('tells the owner a waiting client has no coach yet, offers no chat, and the way to choose one', async () => {
      const { host } = await render({
        profile: WAITING,
        sections: SIDED_SECTIONS,
        url: '/clients/client-1/training',
      });

      expect(host.querySelector('.plan-row')?.textContent).toContain('Waiting for a coach');
      expect(host.textContent).not.toContain('Coached by');
      // Nobody coaches them, so nobody messages them yet, and nothing says otherwise.
      expect(host.textContent).not.toContain('Message Maya');
      expect(host.querySelector('.messaging-note')).toBeNull();
      expect(sectionNames(host)).toEqual(['Overview', 'Service & access']);
      const closed = why(host);
      expect(closed.heading).toBe('Maya is waiting for a coach');
      expect(closed.text).toBe(
        'Nobody sees Maya’s training, nutrition, check-ins and progress until you give them a coach, yourself included. Their plan keeps running and they can still log.',
      );
      expect(closed.link).toEqual({
        name: 'Choose a coach',
        href: '/clients/client-1/service?action=coach',
        filled: true,
      });
      expect(created).toEqual([]);
    });

    it('closes a former client’s private side to an owner who did not coach them when it ended', async () => {
      const { host } = await render({
        profile: {
          ...LEAS,
          release: {
            releasedAtUtc: '2026-09-20T10:00:00Z',
            reason: 'Moved',
            releasedByName: 'Lea Khoury',
            departureKind: 'ReleasedByOwner',
          },
        } as CoachClientDetails,
        sections: SIDED_SECTIONS,
        url: '/clients/client-1/training',
      });

      // No Progress either: it is their coach's to read.
      expect(sectionNames(host)).toEqual(['Overview', 'Service & access']);
      // Not even View intake, so no Actions at all.
      expect(host.querySelector('app-client-actions')).toBeNull();
      const closed = why(host);
      expect(closed.heading).toBe('Former client');
      expect(closed.text).toBe(
        'You keep Maya’s plan and payments. Their training, check-ins and progress stay closed: you did not coach them when coaching ended.',
      );
      expect(closed.link).toBeNull();
      expect(created).toEqual([]);
    });

    it('follows a change of coach without a reload: the sections, the actions and the open section', async () => {
      const { host, harness } = await render({
        profile: LEAS,
        sections: SIDED_SECTIONS,
        url: '/clients/client-1/training',
      });
      expect(created).toEqual([]);

      // The coach panel saves the owner as Maya's coach and hands the record its answer.
      harness.routeDebugElement!.injector.get(ClientWorkspaceContext).setProfile({
        ...LEAS,
        assignedCoachUserId: OWNER_ID,
        assignedCoachName: 'Karim Haddad',
        mayCoach: true,
      });
      await settle(harness.fixture);

      expect(sectionNames(host)).toEqual([
        'Overview',
        'Training',
        'Nutrition',
        'Check-ins',
        'Progress',
        'Service & access',
      ]);
      expect(why(host).panel).toBeNull();
      expect(host.querySelector('app-private-stub')).not.toBeNull();
      expect(created).toEqual(['private']);
      expect(host.textContent).toContain('Message Maya');
      expect(host.textContent).not.toContain('Coached by');
      press(host, 'Actions');
      await settle(harness.fixture);
      expect(menuLabels(host)).toEqual(['Assign program', 'Plan and payments', 'Edit intake']);
    });

    it('draws a private section for the client’s own coach, and a missing flag counts as theirs', async () => {
      const { host } = await render({
        sections: SIDED_SECTIONS,
        url: '/clients/client-1/training',
      });

      expect(why(host).panel).toBeNull();
      expect(host.querySelector('app-private-stub')).not.toBeNull();
      expect(created).toEqual(['private']);
    });
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
