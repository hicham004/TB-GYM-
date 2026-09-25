import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachClientDetails,
  WorkspaceDetails,
} from '../../core/api/api.models';
import type {
  CheckInAssignmentListItem,
  MesocycleSummary,
  TrainingMesocycleView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, press, settle } from '../../../testing/dom';
import type { ProgressDashboard } from '../progress/progress-dashboard.models';
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
  currentDate: '2026-09-20',
  version: 1,
} as WorkspaceDetails;

const PROFILE = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Rahman',
  email: 'maya@example.test',
  onboardingStatus: 'Completed',
  coachNotes: 'Keep overhead work pain-free this week.',
  version: 7,
  release: null,
} as unknown as CoachClientDetails;

function plan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    renewedFromEnrollmentId: null,
    productName: 'Strength & Body Composition',
    startDate: '2026-07-21',
    endDateExclusive: '2026-11-15',
    lastActiveDate: '2026-11-14',
    effectiveStatus: 'Active',
    features: ['Training', 'Nutrition', 'CheckIns'],
    ...overrides,
  } as ClientEnrollment;
}

function dashboard(): ProgressDashboard {
  return {
    clientProfileId: 'client-1',
    timeZoneId: 'Asia/Beirut',
    from: '2026-07-27',
    toExclusive: '2026-09-21',
    windowDayCount: 56,
    displayUnit: 'Kilogram',
    measurementDisplayUnit: 'Centimetre',
    bodyweight: {
      latestDate: '2026-09-20',
      latestDisplayValue: 72.3,
      change: null,
      weeks: [
        { weekStart: '2026-09-07', displayMean: 72.7, observedDayCount: 5 },
        { weekStart: '2026-09-14', displayMean: 72.4, observedDayCount: 6 },
      ],
      trendEstimate: null,
      trendIsAvailable: false,
      observedDayCount: 11,
    },
    measurements: [],
    measurementObservedDayCount: 0,
    photos: {
      poses: [
        {
          pose: 'Front',
          photos: [
            {
              id: 'p1',
              photoDate: '2026-09-08',
              pose: 'Front',
              mediaAssetId: 'm1',
              thumbnailUrl: null,
            },
          ],
        },
      ],
      photoCount: 1,
      missingThumbnailCount: 1,
      previewPhotoCount: 1,
    },
    nutrition: {
      available: true,
      reason: 'Granted',
      context: {
        recentDayCount: 7,
        recentLoggedDayCount: 5,
        recentCompletedDayCount: 4,
        windowLoggedDayCount: 30,
        windowCompletedDayCount: 20,
        lastLoggedDate: '2026-09-20',
      },
    },
    training: {
      available: true,
      reason: 'Granted',
      context: {
        recentDayCount: 7,
        recentScheduledSessionCount: 4,
        recentCompletedWorkoutCount: 3,
        windowScheduledSessionCount: 30,
        windowCompletedWorkoutCount: 27,
        windowInProgressWorkoutCount: 0,
        lastCompletedDate: '2026-09-18',
      },
    },
    isEmpty: false,
  } as ProgressDashboard;
}

const BLOCK: MesocycleSummary = {
  id: 'block-1',
  enrollmentId: 'enrollment-1',
  name: 'Upper-Body Strength v3',
  startDate: '2026-08-24',
  endDateExclusive: '2026-10-19',
  kind: 'Primary',
  status: 'Active',
  revealAllWeeks: false,
  version: 1,
};

function blockDetail(week4Visible: boolean): TrainingMesocycleView {
  const weeks = Array.from({ length: 8 }, (_, index) => ({
    id: `week-${index + 1}`,
    weekNumber: index + 1,
    label: null,
    startsOn: new Date(Date.UTC(2026, 7, 24 + index * 7)).toISOString().slice(0, 10),
    isPublished: index + 1 !== 4 || week4Visible,
    isVisible: index + 1 !== 4 || week4Visible,
    unlockDate: null,
    sessions:
      index + 1 === 4
        ? [
            {
              id: 's1',
              position: 0,
              dayOffset: 6,
              scheduledDate: '2026-09-20',
              name: 'Upper Body — Strength B',
              coachNotes: null,
              hasStarted: false,
              isCompleted: false,
              workoutExecutionId: null,
              exercises: [],
            },
          ]
        : [],
  }));
  return { ...BLOCK, weeks } as unknown as TrainingMesocycleView;
}

function submittedCheckIn(): CheckInAssignmentListItem {
  return {
    assignment: {
      id: 'assignment-9',
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'v1',
      formVersionNumber: 1,
      clientProfileId: 'client-1',
      dueDate: '2026-09-20',
      assignedAtUtc: '2026-09-14T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    response: {
      responseId: 'response-9',
      status: 'Submitted',
      submittedDate: '2026-09-20',
      submittedAtUtc: '2026-09-20T04:12:00Z',
      reviewedAtUtc: null,
      isLate: false,
    },
  };
}

async function render(
  options: {
    api?: Partial<Record<keyof ApiClient, unknown>>;
    profile?: CoachClientDetails;
    enrollments?: ClientEnrollment[];
  } = {},
) {
  const enrollments = options.enrollments ?? [plan()];
  const overview: ClientCommercialOverview = {
    clientProfileId: 'client-1',
    isRelationshipBlocked: false,
    featureAccess: [],
    enrollments,
  };
  const api = {
    getClientCommercialOverview: vi.fn(() => of(overview)),
    getClientProgressDashboard: vi.fn(() => of(dashboard())),
    listClientMesocycles: vi.fn(() => of([BLOCK])),
    getTrainingMesocycle: vi.fn(() => of(blockDetail(true))),
    listClientNutritionPlans: vi.fn(() =>
      of([
        {
          id: 'plan-1',
          sourceMealPlanTemplateVersionId: 'v',
          enrollmentId: 'enrollment-1',
          startDate: '2026-09-01',
          endDateExclusive: '2026-10-01',
          calorieTarget: 2050,
          status: 'Active',
        },
      ]),
    ),
    listClientCheckInAssignments: vi.fn(() =>
      of({ clientProfileId: 'client-1', total: 1, items: [submittedCheckIn()] }),
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
  context.clientId.set('client-1');
  context.profile.set(options.profile ?? PROFILE);
  context.workspace.set(WORKSPACE);
  context.plans.set(overview);
  const fixture = TestBed.createComponent(ClientOverview);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, context };
}

function link(host: HTMLElement, name: string): HTMLAnchorElement {
  const found = Array.from(host.querySelectorAll('a')).find(
    (anchor) => anchor.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No link named "${name}"`);
  return found;
}

describe('ClientOverview', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows this week from one dashboard window: this week plus seven weeks of trend', async () => {
    const { host, api } = await render();

    // Mon 14 – Sun 20 Sep is this week; the window starts seven weeks earlier for the trend.
    expect(api.getClientProgressDashboard).toHaveBeenCalledWith(
      'client-1',
      '2026-07-27',
      '2026-09-21',
    );
    const text = host.textContent ?? '';
    expect(text).toContain('Upper-Body Strength v3');
    expect(text).toContain('Week 4 of 8');
    expect(text).toContain('3 of 4');
    expect(text).toContain('Sessions done, one scheduled today');
    expect(text).toContain('5 of 7');
    expect(text).toContain('2,050 kcal');
    expect(text).toContain('72.4 kg');
    expect(text).toContain('Weekly average, down 0.3 kg');
    expect(text).toContain('Next: Upper Body — Strength B, scheduled today.');
    expect(text).toContain('1 session left');
    expect(text).toContain('2 days not logged');
    expect(text).toContain('Last progress photo Tue 8 Sep.');
  });

  it('flags a submitted check-in and links straight to reviewing it, without reading answers', async () => {
    const { host } = await render();

    expect(host.textContent).toContain('Maya’s check-in is ready to review');
    const review = link(host, 'Review check-in');
    expect(review.getAttribute('href')).toBe(
      '/checkins/clients?clientId=client-1&assignmentId=assignment-9',
    );
    expect(host.querySelectorAll('.tb-button--filled').length).toBe(1);
  });

  it('shows no attention notice when nothing is waiting for review', async () => {
    const { host } = await render({
      api: {
        listClientCheckInAssignments: vi.fn(() =>
          of({ clientProfileId: 'client-1', total: 0, items: [] }),
        ),
      },
    });

    expect(host.textContent).not.toContain('ready to review');
    expect(host.textContent).toContain('No check-ins assigned.');
  });

  it('tells the coach, not the client, that this week is not shared yet', async () => {
    const { host } = await render({
      api: { getTrainingMesocycle: vi.fn(() => of(blockDetail(false))) },
    });

    expect(host.textContent).toContain('This week isn’t shared yet.');
    expect(host.textContent).toContain('Maya can’t see week 4 until you publish it.');
    expect(host.textContent).toContain('Not shared');
  });

  it('offers a renewal in the last 14 days and links to that renewal', async () => {
    const { host } = await render({
      enrollments: [plan({ lastActiveDate: '2026-09-29', endDateExclusive: '2026-09-30' })],
    });

    expect(host.textContent).toContain('Maya’s plan ends in 9 days');
    expect(link(host, 'Renew plan').getAttribute('href')).toBe(
      '/clients/client-1/service?renew=enrollment-1',
    );
  });

  it('keeps the other sections when one read fails, and retries only that one', async () => {
    const failing = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of([BLOCK]));
    const { host, fixture } = await render({ api: { listClientMesocycles: failing } });

    expect(host.textContent).toContain('Training couldn’t be loaded.');
    expect(host.textContent).toContain('5 of 7 days logged this week.');
    press(host, 'Retry');
    await settle(fixture);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Next: Upper Body — Strength B, scheduled today.');
  });

  it('says a feature is not in the plan rather than inviting the coach to fill it', async () => {
    const refused = dashboard();
    refused.training = { available: false, reason: 'NoEntitlement', context: null };
    refused.nutrition = { available: false, reason: 'NoEntitlement', context: null };
    const { host } = await render({
      api: {
        getClientProgressDashboard: vi.fn(() => of(refused)),
        listClientMesocycles: vi.fn(() => of([])),
        // The plans list refuses without a reason; the dashboard's reason explains it.
        listClientNutritionPlans: vi.fn(() => throwError(() => new Error('403'))),
      },
    });

    const training = host.querySelectorAll('.evidence-row')[0].textContent ?? '';
    expect(training).toContain('Not in their plan');
    expect(training).not.toContain('No program assigned');
    expect(training).not.toContain('Assign program');
    expect(host.querySelectorAll('.metric')[2].textContent).toContain('Not in their plan');
    expect(host.textContent).not.toContain('Couldn’t load');
  });

  it('edits the coach note in place and saves it against the record version', async () => {
    const { host, fixture, api, context } = await render();

    press(host, 'Edit coach note');
    await settle(fixture);
    const textarea = field<HTMLTextAreaElement>(host, 'Coach note');
    textarea.value = 'Lighter volume.';
    textarea.dispatchEvent(new Event('input'));
    press(host, 'Save note');
    await settle(fixture);

    expect(api.updateCoachNotes).toHaveBeenCalledWith('client-1', 'Lighter volume.', 7);
    expect(context.profile()?.version).toBe(8);
    expect(host.textContent).toContain('Lighter volume.');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('shows a former client’s release and loads none of the current-client figures', async () => {
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

    expect(host.textContent).toContain('Released on Sep 20, 2026 by Olivia Owner');
    expect(host.textContent).toContain('Followed her coach');
    expect(host.textContent).toContain('You can invite them back as a new client.');
    expect(host.textContent).not.toContain('This week');
    expect(api.getClientProgressDashboard).not.toHaveBeenCalled();
    expect(api.listClientMesocycles).not.toHaveBeenCalled();
  });

  it('says when a client left on their own rather than naming who released them', async () => {
    const { host } = await render({
      profile: {
        ...PROFILE,
        release: {
          releasedAtUtc: '2026-09-21T10:00:00Z',
          reason: 'Moving abroad',
          releasedByName: 'Maya Rahman',
          departureKind: 'LeftByClient',
        },
      } as CoachClientDetails,
    });

    expect(host.textContent).toContain('Left the workspace on Sep 21, 2026.');
    expect(host.textContent).not.toContain('Released on');
  });
});
