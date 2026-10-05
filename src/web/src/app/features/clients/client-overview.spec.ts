import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  CoachClientDetails,
  FeatureAccessDecision,
  WorkspaceDetails,
} from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  checkInItem,
  personalRecords,
  profileOverview,
  programBlock,
  progressDashboard,
  record,
} from '../../../testing/client-profile-fixtures';
import { attentionItem, COACH_NOW, COACH_TODAY, MAYA } from '../../../testing/coach-today-fixtures';
import { field, press, settle } from '../../../testing/dom';
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
  } = {},
) {
  vi.useFakeTimers({ now: new Date(COACH_NOW), toFake: ['Date'] });
  const commercial = options.plans ?? plans();
  const api = {
    getClientCommercialOverview: vi.fn(() => of(commercial)),
    getClientOverview: vi.fn(() => of(profileOverview())),
    getClientProgressDashboard: vi.fn(() => of(progressDashboard())),
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
    expect(text).toContain('2 of 5 sessions done');
    expect(
      Array.from(host.querySelectorAll('.strip .day')).map((day) => day.getAttribute('data-mark')),
    ).toEqual(['done', 'rest', 'partial', 'due', 'due', 'rest', 'rest']);
    expect(host.querySelector('.strip .day.today .day-label')?.textContent?.trim()).toBe('Thu');
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
    expect(said(host)).toContain('2 of 5 sessions done');
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
    const none = progressDashboard();
    none.bodyweight = { ...none.bodyweight, weeks: [], latestDate: null };
    const { host } = await render({ api: { getClientProgressDashboard: vi.fn(() => of(none)) } });
    expect(said(host)).toContain(
      'No weigh-ins in the last 8 weeks. Maya logs them from their Progress page.',
    );
    expect(host.querySelector('app-sparkline')).toBeNull();

    TestBed.resetTestingModule();
    const single = progressDashboard();
    single.bodyweight = {
      ...single.bodyweight,
      weeks: [{ weekStart: '2026-09-28', displayMean: 66.5, observedDayCount: 3 }],
    };
    const lone = await render({ api: { getClientProgressDashboard: vi.fn(() => of(single)) } });
    expect(said(lone.host)).toContain('66.5 kg One week of weigh-ins so far');
    expect(lone.host.querySelector('app-sparkline')).toBeNull();
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
    // Their notes are kept, read-only.
    expect(said(host)).toContain('Wedding in mid-December.');
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
});
