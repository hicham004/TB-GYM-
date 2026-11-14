import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  FeatureAccessDecision,
  WorkspaceDetails,
} from '../../core/api/api.models';
import type { CoachAttentionItemView, CoachClientRef } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  checkInItem,
  personalRecords,
  profileOverview,
  programBlock,
  progressDashboardView,
  record,
} from '../../../testing/client-profile-fixtures';
import { attentionItem, COACH_NOW, COACH_TODAY, MAYA } from '../../../testing/coach-today-fixtures';
import { field, press, settle } from '../../../testing/dom';
import { DRAWN_TOGETHER_PATIENCE_MS } from '../../ui/drawn-together';
import { ConversationStarter } from '../messaging/conversation-starter';
import { ClientOverview } from './client-overview';
import { ClientWorkspaceContext } from './client-workspace.context';

const WORKSPACE: WorkspaceDetails = {
  id: 'tenant-1',
  name: 'Atlas Performance',
  slug: 'atlas',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: COACH_TODAY,
  version: 1,
  brandColor: null,
  accentColor: null,
  logoAssetId: null,
};

const PROFILE = {
  id: MAYA.clientProfileId,
  firstName: 'Maya',
  lastName: 'Fakhoury',
  email: 'maya@example.test',
  onboardingStatus: 'Completed',
  coachNotes: 'Wedding in mid-December. Prefers messages in the morning.',
  version: 7,
  release: null,
} as unknown as CoachClientDetails;

function access(
  feature: FeatureAccessDecision['feature'],
  isAllowed = true,
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

function plans(overrides: Partial<ClientCommercialOverview> = {}): ClientCommercialOverview {
  return {
    clientProfileId: MAYA.clientProfileId,
    isRelationshipBlocked: false,
    featureAccess: [
      access('Training'),
      access('Nutrition'),
      access('CheckIns'),
      access('Messaging'),
    ],
    enrollments: [],
    ...overrides,
  };
}

const RECORDS = personalRecords([
  record('Back Squat', 5, 60, '2026-09-28'),
  record('Bench Press', 8, 40, '2026-09-21'),
]);

async function render(
  options: {
    api?: Partial<Record<keyof ApiClient, unknown>>;
    profile?: CoachClientDetails;
    plans?: ClientCommercialOverview;
    starter?: { open: ReturnType<typeof vi.fn> };
  } = {},
) {
  vi.useFakeTimers({ now: new Date(COACH_NOW), toFake: ['Date'] });
  const commercial = options.plans ?? plans();
  const api = {
    getClientCommercialOverview: vi.fn(() => of(commercial)),
    getClientOverview: vi.fn(() => of(profileOverview())),
    getClientProgressDashboard: vi.fn(() => of(progressDashboardView())),
    getClientTrainingPersonalRecords: vi.fn(() => of(RECORDS)),
    listClientMesocycles: vi.fn(() => of([programBlock()])),
    listClientCheckInAssignments: vi.fn(() =>
      of({
        clientProfileId: MAYA.clientProfileId,
        total: 2,
        items: [
          checkInItem(
            'last',
            '2026-09-24',
            'Reviewed',
            '2026-09-24T07:00:00Z',
            '2026-09-26T12:00:00Z',
          ),
          checkInItem('next', '2026-10-08', null),
        ],
      }),
    ),
    updateCoachNotes: vi.fn(() => of({ ...PROFILE, coachNotes: 'Lighter volume.', version: 8 })),
    ...options.api,
  };
  await TestBed.configureTestingModule({
    imports: [ClientOverview],
    providers: [
      provideRouter([]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      {
        provide: ConversationStarter,
        useValue: options.starter ?? { open: vi.fn().mockResolvedValue(true) },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(true) },
      },
    ],
  }).compileComponents();
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set(MAYA.clientProfileId);
  context.profile.set(options.profile ?? PROFILE);
  context.workspace.set(WORKSPACE);
  context.plans.set(commercial);
  const fixture = TestBed.createComponent(ClientOverview);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, context };
}

/**
 * What a reader takes in: each piece of text on its own, a space between them, runs of whitespace
 * collapsed. Angular drops the whitespace between sibling elements, so `textContent` alone would
 * run "Weight" and "71.4" together.
 */
function said(host: Node): string {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (piece) pieces.push(piece);
  }
  return pieces.join(' ');
}

function link(host: ParentNode, name: string): HTMLAnchorElement {
  const found = Array.from(host.querySelectorAll('a')).find(
    (anchor) => anchor.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No link named "${name}"`);
  return found;
}

describe('ClientOverview', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('tells the story: this week, weight, records, the check-in and the notes', async () => {
    const { host, api } = await render();
    const text = said(host);

    // One dashboard window serves both: this week plus seven weeks of weight (Mon 28 Sep is week 0).
    expect(api.getClientProgressDashboard).toHaveBeenCalledWith(
      MAYA.clientProfileId,
      '2026-08-10',
      '2026-10-05',
    );
    expect(text).toContain('This week Mon 28 Sep – Sun 4 Oct');
    expect(text).toContain('Lean & Strong · Phase 2 · Week 3 of 6');
    expect(text).toContain('2 of 5 workouts done');
    expect(
      Array.from(host.querySelectorAll('.strip .day')).map((day) => day.getAttribute('data-mark')),
    ).toEqual(['done', 'rest', 'partial', 'due', 'due', 'rest', 'rest']);
    // "Thu", and "T" for a strip too narrow for it, as at 200% text on a phone (UIQ-3).
    expect(host.querySelector('.strip .day.today .day-short')?.textContent?.trim()).toBe('Thu');
    expect(host.querySelector('.strip .day.today .day-narrow')?.textContent?.trim()).toBe('T');
    expect(text).toContain('Last activity Trained 2 hours ago');
    expect(text).toContain('Nutrition 4 of 4 days logged so far');

    expect(text).toContain('71.4 kg ↓ 0.4 kg vs last week');
    expect(text).toContain('Weekly average · Last weighed Thu 1 Oct');
    expect(host.querySelector('app-sparkline')).not.toBeNull();

    // Each record in the unit it was lifted in, newest first as the server sent them.
    expect(Array.from(host.querySelectorAll('.record')).map((row) => said(row))).toEqual([
      'PR Back Squat 60 kg × 5 Mon 28 Sep',
      'PR Bench Press 40 kg × 8 Mon 21 Sep',
    ]);

    const checkIn = said(host.querySelector('.checkin')!);
    expect(checkIn).toContain('Reviewed');
    expect(checkIn).toContain('Weekly check-in Sent 7 days ago. Reviewed 5 days ago');
    expect(checkIn).toContain('Next one due Thu 8 Oct');
    expect(text).toContain('Wedding in mid-December. Prefers messages in the morning.');
    expect(text).toContain('Nothing needs you right now.');
  });

  it('puts what needs the coach first, in the server’s order, one filled action', async () => {
    const { host } = await render({
      api: {
        getClientOverview: vi.fn(() =>
          of(
            profileOverview({
              status: 'NeedsAttention',
              attention: [
                attentionItem('CheckInToReview', MAYA, {
                  count: 1,
                  since: '2026-10-01T09:00:00Z',
                  subjectId: 'assignment-9',
                }),
                attentionItem('UnreadMessages', MAYA, {
                  count: 2,
                  since: '2026-10-01T08:00:00Z',
                  subjectId: 'conversation-4',
                }),
              ],
            }),
          ),
        ),
      },
    });

    const needs = host.querySelector('.needs')!;
    expect(said(needs as HTMLElement)).toContain('Needs you 2');
    expect(
      Array.from(needs.querySelectorAll('.need-heading')).map((item) => item.textContent),
    ).toEqual(['Check-in ready to review', '2 unread messages']);
    expect(link(needs, 'Review').getAttribute('href')).toBe(
      `/clients/${MAYA.clientProfileId}/checkins/assignment-9`,
    );
    expect(link(needs, 'Reply').getAttribute('href')).toBe('/messages?conversation=conversation-4');
    // Rule 5: one primary action, the first. The other is outlined.
    expect(needs.querySelectorAll('.tb-button--filled')).toHaveLength(1);
    expect(link(needs, 'Review').classList.contains('tb-button--filled')).toBe(true);
    expect(said(host)).not.toContain('Nothing needs you right now.');
  });

  it('reminds about an overdue check-in from Needs you, starting the chat when there is none (critique B4a)', async () => {
    const starter = { open: vi.fn().mockResolvedValue(true) };
    const { fixture, host, context } = await render({
      starter,
      api: {
        getClientOverview: vi.fn(() =>
          of(
            profileOverview({
              status: 'NeedsAttention',
              attention: [
                attentionItem('CheckInOverdue', MAYA, {
                  count: 1,
                  date: '2026-09-28',
                  canMessage: true,
                }),
              ],
            }),
          ),
        ),
      },
    });

    const need = host.querySelector<HTMLElement>('li.need[data-kind="CheckInOverdue"]')!;
    expect(said(need)).toBe('Check-in overdue It was due Mon 28 Sep Overdue Remind');
    press(need, 'Remind');
    await settle(fixture);
    expect(starter.open).toHaveBeenCalledWith(MAYA.clientProfileId);

    // A refusal is said where the header says its own.
    starter.open.mockRejectedValueOnce(new Error('offline'));
    press(need, 'Remind');
    await settle(fixture);
    expect(context.error()).toBe(
      'Couldn’t open this conversation. Check messaging access and retry.',
    );
  });

  it('reads the overview once with the header, from the record’s shared read', async () => {
    const { api, context } = await render();

    expect(api.getClientOverview).toHaveBeenCalledTimes(1);
    // The header's flag for a plan ending soon comes from the same answer.
    expect(context.overview()?.client.clientProfileId).toBe(MAYA.clientProfileId);
  });

  describe('drawn in one frame (audit UIQ-5)', () => {
    it('keeps the overview’s shape until every part has answered, then draws them all at once', async () => {
      const records = new Subject<typeof RECORDS>();
      const { fixture, host } = await render({
        api: { getClientTrainingPersonalRecords: vi.fn(() => records) },
      });

      expect(host.querySelector('.overview > [role="status"]')?.textContent).toBe('Loading…');
      expect(host.querySelector('section.needs')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('#needs-heading')).toBeNull();
      expect(said(host)).not.toContain('Back Squat');

      records.next(RECORDS);
      records.complete();
      await settle(fixture);

      expect(host.querySelector('.overview > [role="status"]')).toBeNull();
      expect(host.querySelector('#needs-heading')).not.toBeNull();
      expect(said(host)).toContain('PR Back Squat 60 kg × 5 Mon 28 Sep');
    });

    it('stops waiting for a slow part a moment after the first has answered', async () => {
      const { fixture, host } = await render({
        api: { getClientTrainingPersonalRecords: vi.fn(() => new Subject()) },
      });
      expect(host.querySelector('#needs-heading')).toBeNull();

      await new Promise((resolve) => setTimeout(resolve, DRAWN_TOGETHER_PATIENCE_MS + 50));
      await settle(fixture);

      expect(host.querySelector('#needs-heading')).not.toBeNull();
      // The part still out keeps its own skeleton.
      expect(host.querySelector('section.records app-skeleton')).not.toBeNull();
    });
  });

  it('keeps the other cards when one read fails, and retries only that one', async () => {
    const failing = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(RECORDS));
    const { host, fixture, api } = await render({
      api: { getClientTrainingPersonalRecords: failing },
    });

    expect(said(host)).toContain('Records could not be loaded.');
    // Everything else is on screen.
    expect(said(host)).toContain('2 of 5 workouts done');
    expect(said(host)).toContain('71.4 kg');
    press(host, 'Try again');
    await settle(fixture);

    expect(failing).toHaveBeenCalledTimes(2);
    expect(said(host)).toContain('PR Back Squat 60 kg × 5 Mon 28 Sep');
    expect(api.getClientOverview).toHaveBeenCalledTimes(1);
    expect(api.getClientProgressDashboard).toHaveBeenCalledTimes(1);
  });

  it('shows what a failed read could not, as its own message, not as an empty card', async () => {
    const { host } = await render({
      api: {
        getClientOverview: vi.fn(() => throwError(() => new Error('offline'))),
        getClientProgressDashboard: vi.fn(() => throwError(() => new Error('offline'))),
      },
    });

    expect(said(host)).toContain('What needs you could not be loaded.');
    expect(said(host)).toContain('This week could not be loaded.');
    expect(said(host)).toContain('Weight could not be loaded.');
    // Not a calm "nothing needs you", which would be a false all-clear.
    expect(said(host)).not.toContain('Nothing needs you right now.');
    expect(said(host)).toContain('Back Squat');
  });

  it('says a client with no weigh-ins has none, and draws no line for a single week', async () => {
    const none = progressDashboardView({ weeks: [], latestDate: null });
    const { host } = await render({ api: { getClientProgressDashboard: vi.fn(() => of(none)) } });
    expect(said(host)).toContain(
      'No weigh-ins in the last 8 weeks. Maya logs them from their Progress page.',
    );
    expect(host.querySelector('app-sparkline')).toBeNull();

    TestBed.resetTestingModule();
    const single = progressDashboardView({
      weeks: [{ weekStart: '2026-09-28', displayMean: 66.5, observedDayCount: 3 }],
    });
    const lone = await render({ api: { getClientProgressDashboard: vi.fn(() => of(single)) } });
    expect(said(lone.host)).toContain('66.5 kg One week of weigh-ins so far');
    expect(lone.host.querySelector('app-sparkline')).toBeNull();
  });

  it('names where the client started and the change since, even without a recent weigh-in (critique B6)', async () => {
    const none = progressDashboardView({ weeks: [], latestDate: null });
    const started = {
      ...none,
      bodyweight: {
        ...none.bodyweight,
        start: {
          starts: [
            {
              clientProfileId: 'maya',
              kind: 'Started' as const,
              measurementDate: '2026-05-04',
              valueKilograms: 74.2,
              displayValue: 74.2,
            },
          ],
          sinceStart: {
            methodKey: 'BodyweightSinceStartWeeklyMean',
            methodVersion: '1.0',
            startWeekStart: '2026-05-04',
            startWeekMeanKilograms: 74.2,
            startWeekObservedDayCount: 1,
            latestWeekStart: '2026-07-27',
            latestWeekMeanKilograms: 71.4,
            latestWeekObservedDayCount: 2,
            deltaKilograms: -2.8,
            displayDelta: -2.8,
            percent: -3.8,
          },
          current: null,
        },
      },
    };
    const { host } = await render({
      api: { getClientProgressDashboard: vi.fn(() => of(started)) },
    });

    expect(said(host)).toContain(
      'No weigh-ins in the last 8 weeks. Maya logs them from their Progress page.',
    );
    expect(
      Array.from(host.querySelectorAll('[data-start] li')).map((item) => item.textContent?.trim()),
    ).toEqual(['Started at 74.2 kg · Mon 4 May 2026']);
    expect(host.querySelector('.since-start')?.textContent?.trim()).toBe(
      'Since start −2.8 kg (−3.8%)',
    );
    // The Overview reads; corrections are made from Progress.
    expect(said(host)).not.toContain('Correct start');
  });

  it('explains a closed training week from where the plan stands, not “not in the plan”', async () => {
    const { host } = await render({
      api: {
        getClientOverview: vi.fn(() => of(profileOverview({ planState: 'Ended', week: null }))),
        getClientTrainingPersonalRecords: vi.fn(() =>
          of(personalRecords([], { isAllowed: false, accessReason: 'Expired' })),
        ),
      },
    });
    const text = said(host);

    expect(text).toContain('Maya’s plan has ended, so their training isn’t shown.');
    expect(text).not.toContain('Training isn’t part of');
    expect(host.querySelector('.strip')).toBeNull();
    // The program line belongs to an open week.
    expect(text).not.toContain('Lean & Strong');

    // A plan that simply lacks training says that.
    TestBed.resetTestingModule();
    const lacking = await render({
      api: {
        getClientOverview: vi.fn(() => of(profileOverview({ week: null }))),
        getClientTrainingPersonalRecords: vi.fn(() =>
          of(personalRecords([], { isAllowed: false, accessReason: 'NoEntitlement' })),
        ),
      },
    });
    expect(said(lacking.host)).toContain('Training isn’t part of Maya’s plan.');
  });

  it('says nothing is scheduled for a client in training with an empty week', async () => {
    const { host } = await render({
      api: {
        getClientOverview: vi.fn(() =>
          of(
            profileOverview({
              week: {
                ...profileOverview().week!,
                scheduled: 0,
                completed: 0,
                days: profileOverview().week!.days.map((day) => ({
                  ...day,
                  scheduled: 0,
                  completed: 0,
                })),
              },
            }),
          ),
        ),
      },
    });
    expect(said(host)).toContain('Nothing is scheduled for Maya this week.');
    expect(host.querySelector('.strip')).toBeNull();
  });

  it('says check-ins are not in the plan without asking for them', async () => {
    const { host, api } = await render({
      plans: plans({
        featureAccess: [access('Training'), access('Messaging'), access('CheckIns', false)],
      }),
    });

    expect(api.listClientCheckInAssignments).not.toHaveBeenCalled();
    expect(said(host)).toContain('Check-ins aren’t part of Maya’s plan.');
    expect(said(host)).not.toContain('Check-ins could not be loaded.');
  });

  it('turns a refused check-in read into its reason, not a load failure', async () => {
    const refused = new HttpErrorResponse({ status: 403, error: { accessReason: 'Expired' } });
    const { host } = await render({
      api: { listClientCheckInAssignments: vi.fn(() => throwError(() => refused)) },
    });

    expect(said(host)).toContain(
      "This client's plan has ended, so their check-ins can no longer be read.",
    );
    expect(said(host)).not.toContain('Check-ins could not be loaded.');
  });

  it('keeps the review of the latest check-in a quiet twin of the one in Needs you', async () => {
    const { host } = await render({
      api: {
        listClientCheckInAssignments: vi.fn(() =>
          of({
            clientProfileId: MAYA.clientProfileId,
            total: 1,
            items: [checkInItem('new', '2026-10-01', 'Submitted', '2026-10-01T09:00:00Z')],
          }),
        ),
      },
    });

    const card = host.querySelector('.checkin')!;
    expect(said(card as HTMLElement)).toContain('Needs review');
    expect(link(card, 'Review').getAttribute('href')).toBe(
      `/clients/${MAYA.clientProfileId}/checkins/new`,
    );
    expect(link(card, 'Review').classList.contains('tb-button--filled')).toBe(false);
    expect(link(card, 'All check-ins').getAttribute('href')).toBe(
      `/clients/${MAYA.clientProfileId}/checkins`,
    );
  });

  it('shows a blocked relationship instead of reading anything it cannot', async () => {
    const { host, api } = await render({ plans: plans({ isRelationshipBlocked: true }) });

    expect(said(host)).toContain('Access blocked');
    expect(said(host)).toContain('Maya’s access is blocked.');
    expect(link(host, 'Open Service & access').getAttribute('href')).toBe(
      `/clients/${MAYA.clientProfileId}/service`,
    );
    expect(api.getClientOverview).not.toHaveBeenCalled();
    expect(api.getClientProgressDashboard).not.toHaveBeenCalled();
    expect(api.getClientTrainingPersonalRecords).not.toHaveBeenCalled();
    // The coach's own notes stay.
    expect(said(host)).toContain('Wedding in mid-December.');
  });

  it('edits the coach notes in place and saves them against the record version', async () => {
    const { host, fixture, api, context } = await render();

    press(host, 'Edit notes');
    await settle(fixture);
    const textarea = field<HTMLTextAreaElement>(host, 'Coach notes');
    textarea.value = 'Lighter volume.';
    textarea.dispatchEvent(new Event('input'));
    press(host, 'Save note');
    await settle(fixture);

    expect(api.updateCoachNotes).toHaveBeenCalledWith(MAYA.clientProfileId, 'Lighter volume.', 7);
    expect(context.profile()?.version).toBe(8);
    expect(said(host)).toContain('Lighter volume.');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('asks the browser before a refresh loses an unsaved note', async () => {
    const { host, fixture } = await render();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leave()).toBe(false);
    press(host, 'Edit notes');
    await settle(fixture);
    expect(leave()).toBe(false);

    const textarea = field<HTMLTextAreaElement>(host, 'Coach notes');
    textarea.value = 'A change not saved yet.';
    textarea.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(leave()).toBe(true);

    press(host, 'Cancel');
    await settle(fixture);
    expect(leave()).toBe(false);
  });

  it('shows a former client’s release, loads none of the current-client reads, and edits nothing', async () => {
    const { host, api } = await render({
      profile: {
        ...PROFILE,
        release: {
          releasedAtUtc: '2026-09-20T10:00:00Z',
          reason: 'Followed her coach',
          releasedByName: 'Olivia Owner',
          departureKind: 'ReleasedByOwner',
        },
      } as CoachClientDetails,
    });

    expect(said(host)).toContain('Coaching ended on Sun 20 Sep 2026 by Olivia Owner.');
    expect(said(host)).toContain('Followed her coach');
    expect(said(host)).toContain('You can invite them back as a new client.');
    expect(said(host)).not.toContain('This week');
    // Their notes are kept, read-only, and still read only by the owner who coached them.
    expect(said(host)).toContain('Wedding in mid-December.');
    expect(said(host.querySelector('section.notes')!)).toContain('Coach notes Only you see these.');
    expect(said(host)).not.toContain('as Maya’s coach');
    expect(
      Array.from(host.querySelectorAll('button')).map((item) => item.textContent?.trim()),
    ).not.toContain('Edit notes');
    for (const read of [
      api.getClientOverview,
      api.getClientProgressDashboard,
      api.getClientTrainingPersonalRecords,
      api.listClientMesocycles,
      api.listClientCheckInAssignments,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('says when a client left on their own rather than naming who released them', async () => {
    const { host } = await render({
      profile: {
        ...PROFILE,
        release: {
          releasedAtUtc: '2026-09-21T10:00:00Z',
          reason: 'Moving abroad',
          releasedByName: 'Maya Fakhoury',
          departureKind: 'LeftByClient',
        },
      } as CoachClientDetails,
    });

    expect(said(host)).toContain('Left on Mon 21 Sep 2026.');
    expect(said(host)).not.toContain('Coaching ended on');
  });

  it('tells the client’s coach that only they see the notes', async () => {
    const { host } = await render();

    expect(said(host.querySelector('section.notes')!)).toContain(
      'Coach notes Only you see these, as Maya’s coach.',
    );
    expect(said(host)).not.toContain('Private to your team');
  });

  describe('for an owner who does not coach the client (N9d1a)', () => {
    /** Lea's client, read by the owner: the server withholds the private side and its notes. */
    const LEAS = {
      ...PROFILE,
      coachNotes: null,
      assignedCoachUserId: MAYA.assignedCoachUserId,
      assignedCoachName: 'Lea Khoury',
      mayCoach: false,
    } as CoachClientDetails;
    const LEAS_REF = { ...MAYA, mayCoach: false };
    const WAITING = {
      ...LEAS,
      assignedCoachUserId: null,
      assignedCoachName: '',
    } as CoachClientDetails;
    const WAITING_REF = {
      ...MAYA,
      assignedCoachUserId: null,
      assignedCoachName: null,
      mayCoach: false,
    };
    const PRIVATE_READS = [
      'getClientProgressDashboard',
      'getClientTrainingPersonalRecords',
      'listClientMesocycles',
      'listClientCheckInAssignments',
    ] as const;

    /** The overview as the server answers it then: no last activity or workout, and the week kept. */
    function businessOverview(client: CoachClientRef, attention: CoachAttentionItemView[] = []) {
      return profileOverview({
        client,
        lastActivityKind: null,
        lastActivityAtUtc: null,
        lastWorkout: null,
        attention,
      });
    }

    it('says why first, reads the business side alone, and shows only what needs doing and the week', async () => {
      const { host, api } = await render({
        profile: LEAS,
        api: { getClientOverview: vi.fn(() => of(businessOverview(LEAS_REF))) },
      });

      const first = host.querySelector('.overview > section');
      expect(first?.classList).toContain('why');
      expect(said(first as HTMLElement)).toBe(
        'Lea Khoury coaches Maya As the owner you see Maya’s plan, payments and sessions. Their training, nutrition, check-ins and progress open only to their coach. Service & access',
      );
      const service = link(first!, 'Service & access');
      expect(service.getAttribute('href')).toBe(`/clients/${MAYA.clientProfileId}/service`);
      expect(service.classList.contains('tb-button--outlined')).toBe(true);

      expect(api.getClientOverview).toHaveBeenCalledTimes(1);
      for (const read of PRIVATE_READS) expect(api[read]).not.toHaveBeenCalled();

      const text = said(host);
      expect(text).toContain('2 of 5 workouts done');
      expect(text).toContain('Nothing needs you right now.');
      // No program line, no last activity, no food log, and none of the private cards.
      expect(text).not.toContain('Lean & Strong');
      expect(text).not.toContain('Last activity');
      expect(text).not.toContain('No activity yet');
      expect(text).not.toContain('Nutrition');
      for (const card of ['weight', 'records', 'checkin', 'notes']) {
        expect(host.querySelector(`section.${card}`)).toBeNull();
      }
      expect(host.querySelector('.rail')).toBeNull();
    });

    it('keeps only the needs and the week in its shape while the overview is read', async () => {
      const overview = new Subject<ReturnType<typeof businessOverview>>();
      const { fixture, host } = await render({
        profile: LEAS,
        api: { getClientOverview: vi.fn(() => overview) },
      });

      expect(host.querySelector('.overview > [role="status"]')?.textContent).toBe('Loading…');
      expect(host.querySelector('section.why')).not.toBeNull();
      expect(host.querySelectorAll('section.needs, section.week')).toHaveLength(2);
      for (const card of ['weight', 'records', 'checkin', 'notes']) {
        expect(host.querySelector(`section.${card}`)).toBeNull();
      }

      // Drawn as soon as its one read answers, with nothing else to wait for.
      overview.next(businessOverview(LEAS_REF));
      overview.complete();
      await settle(fixture);
      expect(host.querySelector('#needs-heading')).not.toBeNull();
    });

    it('says who acts on a private item, never what was withheld, and links nowhere private', async () => {
      const { host } = await render({
        profile: LEAS,
        api: {
          getClientOverview: vi.fn(() =>
            of(
              businessOverview(LEAS_REF, [
                attentionItem('CheckInToReview', LEAS_REF, {
                  count: 1,
                  since: '2026-10-01T09:00:00Z',
                }),
                attentionItem('MissedSessions', LEAS_REF, { count: 3 }),
                attentionItem('CheckInOverdue', LEAS_REF, { count: 1, date: '2026-09-28' }),
                attentionItem('PlanEndingSoon', LEAS_REF, {
                  date: '2026-10-06',
                  subjectId: 'e-1',
                }),
              ]),
            ),
          ),
        },
      });

      const needs = host.querySelector<HTMLElement>('.needs')!;
      expect(Array.from(needs.querySelectorAll('li.need')).map((row) => said(row))).toEqual([
        'Check-in ready to review Lea Khoury reviews it. Check-in',
        'Missed 3 workouts in a row Lea Khoury follows up. Missed',
        'Check-in overdue Lea Khoury follows up. Overdue',
        'Plan ends in 5 days Last day Tue 6 Oct Ending soon Renew plan',
      ]);
      expect(said(needs)).not.toContain('No workout logged yet');
      const hrefs = Array.from(needs.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual([`/clients/${MAYA.clientProfileId}/service?renew=e-1`]);
      // The one filled action is the first the owner can take.
      expect(link(needs, 'Renew plan').classList.contains('tb-button--filled')).toBe(true);
    });

    it('tells the owner a waiting client needs a coach, with that the one filled action', async () => {
      const { host } = await render({
        profile: WAITING,
        api: {
          getClientOverview: vi.fn(() =>
            of(
              businessOverview(WAITING_REF, [
                attentionItem('CheckInOverdue', WAITING_REF, { count: 2, date: '2026-09-28' }),
                attentionItem('PlanEndingSoon', WAITING_REF, {
                  date: '2026-10-06',
                  subjectId: 'e-1',
                }),
              ]),
            ),
          ),
        },
      });

      const first = host.querySelector<HTMLElement>('.overview > section.why')!;
      expect(said(first)).toBe(
        'Maya is waiting for a coach Nobody sees Maya’s training, nutrition, check-ins and progress until you give them a coach, yourself included. Their plan keeps running and they can still log. Choose a coach',
      );
      const choose = link(first, 'Choose a coach');
      expect(choose.getAttribute('href')).toBe(
        `/clients/${MAYA.clientProfileId}/service?action=coach`,
      );
      expect(host.querySelectorAll('.tb-button--filled')).toHaveLength(1);
      expect(choose.classList.contains('tb-button--filled')).toBe(true);
      expect(said(host.querySelector('li.need[data-kind="CheckInOverdue"]')!)).toBe(
        '2 check-ins overdue Their new coach follows up once you choose one. Overdue',
      );
      expect(link(host, 'Renew plan').classList.contains('tb-button--outlined')).toBe(true);
    });

    it('says a block is lifted from Service & access, with no promise about the private side', async () => {
      const { host, api } = await render({
        profile: LEAS,
        plans: plans({ isRelationshipBlocked: true }),
      });

      expect(said(host)).toContain('Lea Khoury coaches Maya');
      expect(said(host)).toContain('Maya’s access is blocked until you unblock them.');
      expect(said(host)).not.toContain('stay closed to you until you unblock them');
      expect(host.querySelector('section.notes')).toBeNull();
      for (const read of PRIVATE_READS) expect(api[read]).not.toHaveBeenCalled();
    });

    it('says in a former client’s own panel why their private side stays closed', async () => {
      const { host } = await render({
        profile: {
          ...LEAS,
          release: {
            releasedAtUtc: '2026-09-20T10:00:00Z',
            reason: 'Followed her coach',
            releasedByName: 'Karim Haddad',
            departureKind: 'ReleasedByOwner',
          },
        } as CoachClientDetails,
      });

      // One panel, not a second "Former client" above it.
      expect(Array.from(host.querySelectorAll('h2')).map((h2) => h2.textContent?.trim())).toEqual([
        'Former client',
      ]);
      expect(said(host)).toContain('Coaching ended on Sun 20 Sep 2026 by Karim Haddad.');
      expect(said(host)).toContain(
        'You keep Maya’s plan and payments. Their training, check-ins and progress stay closed: you did not coach them when coaching ended.',
      );
      expect(said(host)).not.toContain('Training, nutrition and detailed progress records');
      expect(host.querySelector('section.notes')).toBeNull();
    });
  });

  it('says the day coaching ended on the workspace’s calendar, not the device’s (audit WEB-17)', async () => {
    const { fixture, host, context } = await render({
      profile: {
        ...PROFILE,
        release: {
          // 03:00 UTC on Monday is still Sunday evening in the workspace below.
          releasedAtUtc: '2026-09-21T03:00:00Z',
          reason: 'Moving abroad',
          releasedByName: 'Olivia Owner',
          departureKind: 'ReleasedByOwner',
        },
      } as CoachClientDetails,
    });
    context.workspace.set({ ...WORKSPACE, timeZoneId: 'America/Los_Angeles' });
    await settle(fixture);

    expect(said(host)).toContain('Coaching ended on Sun 20 Sep 2026 by Olivia Owner.');
  });
});
