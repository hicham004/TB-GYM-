import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachClientDetails,
  WorkspaceDetails,
} from '../../core/api/api.models';
import type { CoachClientProgramView, TrainingMesocycleView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  cancelledBlock,
  closedProgram,
  coachProgram,
  endedBlock,
  completedBlock,
  plannedBlock,
  runningBlock,
} from '../../../testing/client-program-fixtures';
import { formSummary, press, settle, type } from '../../../testing/dom';
import { ClientProgramApi } from './client-program-api';
import { ClientProgram } from './client-program';
import { ClientWorkspaceContext } from './client-workspace.context';

const PROFILE = {
  id: 'client-1',
  firstName: 'Maya',
  lastName: 'Fakhoury',
  onboardingStatus: 'Completed',
  version: 3,
  release: null,
} as unknown as CoachClientDetails;

function plan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    productName: 'Online Coaching',
    offerLabel: '12 weeks',
    startDate: '2026-09-01',
    endDateExclusive: '2026-11-24',
    lastActiveDate: '2026-11-23',
    storedStatus: 'Active',
    effectiveStatus: 'Active',
    features: ['Training'],
    ...overrides,
  } as ClientEnrollment;
}

interface Options {
  program?: CoachClientProgramView;
  /** Replaces the program read, to fail it or to answer differently the second time. */
  getProgram?: () => Observable<CoachClientProgramView>;
  /** What the program's training maxes read answers; by default the program uses none. */
  maxes?: unknown;
  enrollments?: ClientEnrollment[];
  featureAccess?: ClientCommercialOverview['featureAccess'];
  url?: string;
  api?: Record<string, unknown>;
  programApi?: Record<string, unknown>;
}

const NO_MAXES = {
  mesocycleId: 'block-lean',
  version: 4,
  loadUnit: 'Kilogram',
  isClosed: false,
  maxes: [],
};

async function render(options: Options = {}) {
  const getProgram = options.getProgram
    ? vi.fn(options.getProgram)
    : vi.fn(() => of(options.program ?? coachProgram()));
  const programApi = {
    getProgram,
    getTrainingMaxes: vi.fn(() => of(options.maxes ?? NO_MAXES)),
    previewTrainingMaxes: vi.fn(() => of({})),
    applyTrainingMaxes: vi.fn(() => of({})),
    renameProgram: vi.fn(() => of({})),
    getPreviousMaxes: vi.fn(() =>
      of({ mesocycleId: null, programName: null, lastDay: null, loadUnit: null, maxes: [] }),
    ),
    ...options.programApi,
  };
  const api = {
    setMesocycleWeekPublished: vi.fn(() => of({})),
    updateMesocycleVisibility: vi.fn(() => of({})),
    cancelTrainingMesocycle: vi.fn(() => of({})),
    completeTrainingMesocycle: vi.fn(() => of({})),
    rescheduleMesocycle: vi.fn(() => of({})),
    getTrainingMesocycle: vi.fn(() => of(null)),
    listSavedSessions: vi.fn(() => of([])),
    listProgramTemplates: vi.fn(() => of({ items: [], total: 0 })),
    listStrengthMaxes: vi.fn(() => of({ items: [], total: 0 })),
    searchExercises: vi.fn(() => of({ items: [], total: 0 })),
    getWorkspace: vi.fn(() => of({ currentDate: '2026-10-01', weekStartsOn: 'Monday' })),
    getCoachWorkoutDetail: vi.fn(() =>
      of({ isAllowed: true, accessReason: 'Granted', detail: null, nextNotesSkip: null }),
    ),
    ...options.api,
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'clients/:clientId/training', component: ClientProgram },
        { path: 'clients/:clientId/training/:mesocycleId/edit', children: [] },
      ]),
      ClientWorkspaceContext,
      { provide: ApiClient, useValue: api },
      { provide: ClientProgramApi, useValue: programApi },
      { provide: CsrfService, useValue: csrf },
      {
        provide: TenantStore,
        useValue: { selectedTenantId: signal('tenant-1'), isOwner: signal(true) },
      },
    ],
  });
  const context = TestBed.inject(ClientWorkspaceContext);
  context.clientId.set('client-1');
  context.profile.set(PROFILE);
  context.plans.set({
    clientProfileId: 'client-1',
    isRelationshipBlocked: false,
    featureAccess: options.featureAccess ?? [],
    enrollments: options.enrollments ?? [plan()],
  } as ClientCommercialOverview);
  context.workspace.set({ currentDate: '2026-10-01', weekStartsOn: 'Monday' } as WorkspaceDetails);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(options.url ?? '/clients/client-1/training', ClientProgram);
  await settle(harness.fixture);
  return {
    harness,
    host: harness.routeNativeElement as HTMLElement,
    api,
    csrf,
    context,
    getProgram,
    programApi,
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

describe('a client’s Training', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('.cdk-overlay-container')
      .forEach((node) => node.replaceChildren());
    TestBed.resetTestingModule();
  });

  describe('the running program', () => {
    it('opens on it: its week, its dates, how far it has got and every week side by side', async () => {
      const { host } = await render();

      expect(textOf(host.querySelector('.eyebrow'))).toBe('Week 3 of 6');
      expect(textOf(host.querySelector('#program-title'))).toBe('Lean & Strong · Phase 2');
      expect(all(host, '.facts li').map(textOf)).toEqual([
        'Mon 14 Sep – Sun 25 Oct',
        '9 of 24 sessions done',
        '1 missed',
      ]);
      expect(all(host, '.week h3').map(textOf)).toEqual([
        'Week 1',
        'Week 2',
        'Week 3',
        'Week 4',
        'Week 5',
        'Week 6',
      ]);
      const current = host.querySelector('.week.current');
      expect(textOf(current?.querySelector('h3'))).toBe('Week 3');
      expect(textOf(current?.querySelector('.now'))).toBe('This week');
    });

    it('marks each session of the current week by what happened, in words', async () => {
      const { host } = await render();

      const sessions = all(host.querySelector('.week.current')!, 'button.session');

      expect(sessions.map((session) => session.getAttribute('data-mark'))).toEqual([
        'done',
        'done',
        'today',
        'upcoming',
      ]);
      expect(sessions.map((session) => textOf(session.querySelector('.s-mark')))).toEqual([
        'Done',
        'Done',
        'Today',
        'Upcoming',
      ]);
      expect(
        ['.s-day', '.s-mark', '.s-name', '.s-detail'].map((part) =>
          textOf(sessions[2].querySelector(part)),
        ),
      ).toEqual(['Thu 1 Oct', 'Today', 'Lower B', '4 exercises · 12 sets']);
    });

    it('tells a week that is shared but locked from one that is not shared', async () => {
      const { host } = await render();

      const weeks = all(host, '.week');
      const boxes = weeks.map((week) =>
        week.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
      );

      expect(boxes.map((box) => box.checked)).toEqual([true, true, true, true, false, false]);
      expect(textOf(weeks[3].querySelector('.share-note'))).toBe('Shared · opens Mon 5 Oct');
      expect(weeks[4].querySelector('.share-note')).toBeNull();
      expect(
        all(weeks[4], 'button.session').map((session) => session.getAttribute('data-mark')),
      ).toEqual(Array(4).fill('unshared'));
      // Each box names its week, so a list of boxes is not six of the same.
      expect(boxes[3].getAttribute('aria-label')).toBe('Week 4: Shared with Maya');
    });

    it('speaks of programs and weeks, with no engine words and no raw dates', async () => {
      const { host } = await render({
        program: coachProgram([runningBlock(), plannedBlock(), completedBlock()]),
      });

      const text = textOf(host);

      for (const word of ['snapshot', 'mesocycle', 'enrollment', 'working max', 'transform']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text).not.toContain('Asia/Beirut');
    });

    it('shows one week at a time under a row of week numbers, starting on this week', async () => {
      const { harness, host } = await render();

      const picks = all(host, '.pick');
      expect(picks.map((pick) => pick.getAttribute('aria-pressed'))).toEqual([
        'false',
        'false',
        'true',
        'false',
        'false',
        'false',
      ]);
      expect(all(host, '.week.shown').map((week) => textOf(week.querySelector('h3')))).toEqual([
        'Week 3',
      ]);

      picks[4].click();
      await settle(harness.fixture);

      expect(all(host, '.week.shown').map((week) => textOf(week.querySelector('h3')))).toEqual([
        'Week 5',
      ]);
      expect(picks[4].getAttribute('aria-label')).toBe('Week 5, 12–18 Oct');
    });
  });

  describe('when training is not open, or nothing is assigned', () => {
    it('says why a lapsed plan hides the program, and offers the way forward', async () => {
      const { host } = await render({
        program: closedProgram('Expired'),
        enrollments: [plan({ storedStatus: 'Expired', effectiveStatus: 'Expired' })],
      });

      expect(textOf(host)).toContain('Maya’s plan has ended, so their training isn’t shown.');
      expect(host.querySelector('.timeline')).toBeNull();
      expect(host.querySelector('app-client-strength')).toBeNull();
      expect(textOf(host.querySelector('a'))).toBe('Open Service & access');
      // A plan that is over cannot take a new program, so none is offered.
      expect(host.querySelector('button.tb-button')).toBeNull();
    });

    describe('before a booked plan begins (TRN-023)', () => {
      const booked = {
        enrollments: [
          plan({
            startDate: '2026-10-12',
            endDateExclusive: '2026-12-01',
            lastActiveDate: '2026-11-30',
          }),
        ],
        featureAccess: [
          {
            feature: 'Training',
            isAllowed: false,
            reason: 'NotStarted',
            enrollmentId: 'enrollment-1',
            accessibleFrom: '2026-10-12',
            accessibleUntilExclusive: '2026-12-01',
          },
        ] as ClientCommercialOverview['featureAccess'],
      };

      it('shows the program lined up and says from when the client sees it', async () => {
        const { host } = await render({
          ...booked,
          program: coachProgram([plannedBlock({ start: '2026-10-12' })], {
            accessReason: 'NotStarted',
          }),
        });

        expect(all(host, '.facts li').map(textOf)).toContain(
          'Maya sees it from Mon 12 Oct, when the plan starts',
        );
        expect(host.querySelector('.timeline')).not.toBeNull();
      });

      it('says when a plan waiting for its payment starts', async () => {
        const { host } = await render({
          ...booked,
          featureAccess: [{ ...booked.featureAccess[0], reason: 'PaymentRequired' }],
          program: coachProgram([plannedBlock({ start: '2026-10-12' })], {
            accessReason: 'PaymentRequired',
          }),
        });

        expect(all(host, '.facts li').map(textOf)).toContain(
          'Maya sees it from Mon 12 Oct, once the plan is paid',
        );
      });

      it('invites a first program before the plan begins', async () => {
        const { host } = await render({
          ...booked,
          program: coachProgram([], { accessReason: 'NotStarted' }),
        });

        expect(textOf(host)).toContain(
          'Maya’s plan starts Mon 12 Oct. Assign a program now and Maya sees it from that day.',
        );
        expect(all(host, 'button').map(textOf)).toContain('Assign program');
      });

      it('says nothing of it beside a program that is running', async () => {
        const { host } = await render();

        expect(all(host, '.facts li').map(textOf).join(' ')).not.toContain('sees it from');
      });

      it('says nothing of it beside an earlier program that ended', async () => {
        const { host } = await render({
          ...booked,
          program: coachProgram([endedBlock()], { accessReason: 'NotStarted' }),
        });

        expect(all(host, '.facts li').map(textOf).join(' ')).not.toContain('sees it from');
      });
    });

    it('does not offer to open a plan for someone who has left', async () => {
      const { host } = await render({ program: closedProgram('MembershipInactive') });

      expect(textOf(host)).toContain('no longer with you');
      expect(host.querySelector('a')).toBeNull();
    });

    it('invites a first program when none is assigned', async () => {
      const { host } = await render({ program: coachProgram([]) });

      expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No program yet');
      expect(textOf(host)).toContain('Maya sees it as soon as its first week opens.');
      expect(all(host, 'button').map(textOf)).toContain('Assign program');
      // The strength history is there for a client whose training is open.
      expect(host.querySelector('app-client-strength')).not.toBeNull();
    });

    it('says the program could not be loaded, and tries again', async () => {
      let attempts = 0;
      const { harness, host } = await render({
        getProgram: () =>
          ++attempts === 1 ? throwError(() => new Error('offline')) : of(coachProgram()),
      });

      expect(textOf(host.querySelector('[role="alert"]'))).toBe('The program could not be loaded.');
      expect(host.querySelector('.timeline')).toBeNull();

      press(host, 'Try again');
      await settle(harness.fixture);

      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(textOf(host.querySelector('.eyebrow'))).toBe('Week 3 of 6');
    });
  });

  describe('the other programs', () => {
    it('lists the ones running or coming and the earlier ones, and opens one on a tap', async () => {
      const program = coachProgram([
        plannedBlock(),
        runningBlock(),
        completedBlock(),
        cancelledBlock(),
      ]);
      const { harness, host } = await render({ program });

      expect(all(host, '.others .group').map(textOf)).toEqual(['Current and next', 'Earlier']);
      expect(
        all(host, '.others .row').map((row) => textOf(row.querySelector('.row-name'))),
      ).toEqual(['Strength Base', 'Foundations', 'Summer Reset']);
      const first = host.querySelector('.others .row')!;
      expect(textOf(first.querySelector('.row-meta'))).toBe('Mon 26 Oct – Sun 8 Nov · 8 sessions');
      expect(textOf(first.querySelector('app-status-pill'))).toBe('Starts Mon 26 Oct');

      all(host, '.others .row')[1].click();
      await settle(harness.fixture);

      expect(textOf(host.querySelector('#program-title'))).toBe('Foundations');
      expect(textOf(host.querySelector('.eyebrow'))).toBe('Completed');
      // The one that was open is now in the list.
      expect(all(host, '.others .row-name').map(textOf)).toContain('Lean & Strong · Phase 2');
      // Another program is running, so a finished one does not ask for a new one.
      expect(all(host, '.hero-actions button').map(textOf)).toEqual(['Manage program']);
    });

    it('keeps the program’s history in a closed fold under its header, with the cancel reason (LOST-6)', async () => {
      const lifecycle = [
        {
          id: 'e1',
          eventType: 'Assigned' as const,
          fromStatus: null,
          toStatus: 'Active' as const,
          reason: 'Assigned from a published program template.',
          occurredAtUtc: '2026-05-01T09:00:00Z',
          actorUserId: 'owner-1',
        },
        {
          id: 'e2',
          eventType: 'Cancelled' as const,
          fromStatus: 'Active' as const,
          toStatus: 'Cancelled' as const,
          reason: 'Moved to a gym program',
          occurredAtUtc: '2026-05-11T09:00:00Z',
          actorUserId: 'owner-1',
        },
      ];
      const { host } = await render({ program: coachProgram([cancelledBlock({ lifecycle })]) });

      const fold = host.querySelector<HTMLDetailsElement>('.hero [data-program-history]')!;
      expect(fold.open).toBe(false);
      expect(textOf(fold.querySelector('summary'))).toBe('History (2)');
      expect(all(fold, 'li').map(textOf)).toEqual([
        'Assigned Fri 1 May',
        'Cancelled Mon 11 May Moved to a gym program',
      ]);
    });

    it('asks for a new program when the one in front of the coach is over and none is lined up', async () => {
      const { host } = await render({ program: coachProgram([completedBlock()]) });

      expect(all(host, '.hero-actions button').map(textOf)).toEqual([
        'Assign program',
        'Manage program',
      ]);
      expect(host.querySelector('.others')).toBeNull();
    });
  });

  describe('sharing a week', () => {
    it('shares or stops sharing a week with the program’s token, then reads the program again', async () => {
      const { harness, host, api, csrf, getProgram, context } = await render();
      const week5 = all(host, '.week')[4];
      const box = week5.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle(harness.fixture);

      expect(csrf.refresh).toHaveBeenCalled();
      expect(api['setMesocycleWeekPublished']).toHaveBeenCalledWith(
        'block-lean',
        'block-lean-week5',
        {
          isPublished: true,
          version: 4,
        },
      );
      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(context.notice()).toBe('Week 5 is shared with Maya.');
    });

    it('puts the box back and says so when the week could not be changed', async () => {
      const conflict = new HttpErrorResponse({
        status: 409,
        error: {
          code: 'concurrency_conflict',
          message: 'Training data was changed by another request.',
        },
      });
      const { harness, host, context } = await render({
        api: { setMesocycleWeekPublished: vi.fn(() => throwError(() => conflict)) },
      });
      const box = all(host, '.week')[4].querySelector<HTMLInputElement>('input[type="checkbox"]')!;

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle(harness.fixture);

      expect(box.checked).toBe(false);
      expect(context.error()).toContain('changed somewhere else');
      expect(context.notice()).toBeNull();
    });

    it('keeps the program on screen, and says so, when only the re-read after a change fails', async () => {
      let reads = 0;
      const { harness, host, context } = await render({
        getProgram: () =>
          ++reads === 1 ? of(coachProgram()) : throwError(() => new Error('offline')),
      });
      const box = all(host, '.week')[4].querySelector<HTMLInputElement>('input[type="checkbox"]')!;

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle(harness.fixture);

      expect(host.querySelector('.timeline')).not.toBeNull();
      expect(context.error()).toBe(
        'The program could not be refreshed. Reload the page to see it as it is now.',
      );
      // The boxes work again once the attempt is over.
      expect(box.disabled).toBe(false);
    });

    it('cannot change the weeks of a program that is over', async () => {
      const { host } = await render({ program: coachProgram([completedBlock()]) });

      expect(
        all(host, '.week input[type="checkbox"]').every(
          (box) => (box as HTMLInputElement).disabled,
        ),
      ).toBe(true);
    });
  });

  describe('the Actions menu', () => {
    it('lists what a coach can do about a running program, and says why one is not available', async () => {
      const { harness, host } = await render();

      press(host, 'Manage program');
      await settle(harness.fixture);

      const items = all(host, 'app-client-actions .item');
      expect(items.map((item) => textOf(item.querySelector('.item-title')))).toEqual([
        'Assign program',
        'Rename program',
        'Build next block',
        'Edit weeks',
        'Reschedule',
        'Open every shared week now',
        'Close program',
        'Cancel program',
      ]);
      expect(items[4].getAttribute('aria-disabled')).toBe('true');
      expect(textOf(items[4])).toContain('Not possible once a workout has started');
      expect(items[6].getAttribute('aria-disabled')).toBe('true');
      expect(items[7].getAttribute('aria-disabled')).toBeNull();
    });

    it('cancels a program only with a reason, then reads it again', async () => {
      const { harness, host, api, getProgram, context } = await render();
      press(host, 'Manage program');
      await settle(harness.fixture);
      all(host, 'app-client-actions .item')[7].click();
      await settle(harness.fixture);

      const cancel = dialog()!;
      expect(textOf(cancel.querySelector('h2'))).toBe('Cancel program');
      expect(textOf(cancel)).toContain('Maya stops seeing the sessions still to come.');

      // Without a reason nothing is sent, and the field says why.
      press(cancel, 'Cancel program');
      await settle(harness.fixture);
      expect(api['cancelTrainingMesocycle']).not.toHaveBeenCalled();
      expect(textOf(cancel)).toContain('Say why, so it is on record.');

      const reason = cancel.querySelector<HTMLTextAreaElement>('textarea')!;
      reason.value = 'Client is travelling';
      reason.dispatchEvent(new Event('input'));
      await settle(harness.fixture);
      press(cancel, 'Cancel program');
      await settle(harness.fixture);

      expect(api['cancelTrainingMesocycle']).toHaveBeenCalledWith('block-lean', {
        reason: 'Client is travelling',
        version: 4,
      });
      expect(dialog()).toBeNull();
      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(context.notice()).toBe('Lean & Strong · Phase 2 is cancelled.');
    });

    it('turns a refusal into a sentence in the dialog and keeps it open', async () => {
      const refused = new HttpErrorResponse({
        status: 400,
        error: {
          errors: { mesocycle: ['A mesocycle with a workout in progress cannot be cancelled.'] },
        },
      });
      const { harness, host } = await render({
        api: { cancelTrainingMesocycle: vi.fn(() => throwError(() => refused)) },
      });
      press(host, 'Manage program');
      await settle(harness.fixture);
      all(host, 'app-client-actions .item')[7].click();
      await settle(harness.fixture);
      const cancel = dialog()!;
      const reason = cancel.querySelector<HTMLTextAreaElement>('textarea')!;
      reason.value = 'Travelling';
      reason.dispatchEvent(new Event('input'));
      await settle(harness.fixture);

      press(cancel, 'Cancel program');
      await settle(harness.fixture);

      expect(dialog()).not.toBeNull();
      expect(textOf(formSummary(cancel))).toBe(
        'Maya has a workout open right now. Cancel the program once it is finished.',
      );
      expect(document.activeElement).toBe(formSummary(cancel));
    });

    it('opens the weeks still to come in the builder’s grid', async () => {
      const { harness, host, router } = await render();
      press(host, 'Manage program');
      await settle(harness.fixture);

      all(host, 'app-client-actions .item')[3].click();
      await settle(harness.fixture);

      expect(router.url).toBe('/clients/client-1/training/block-lean/edit');
    });

    it('moves a program that has not started, to the date typed', async () => {
      const { harness, host, api, context } = await render({
        program: coachProgram([plannedBlock()]),
      });
      press(host, 'Manage program');
      await settle(harness.fixture);
      const items = all(host, 'app-client-actions .item');
      expect(items[4].getAttribute('aria-disabled')).toBeNull();
      items[4].click();
      await settle(harness.fixture);

      const move = dialog()!;
      const date = move.querySelector<HTMLInputElement>('input[type="date"]')!;
      expect(date.value).toBe('2026-10-26');
      expect(textOf(move)).toContain('Runs Mon 26 Oct – Sun 8 Nov');
      date.value = '2026-11-02';
      date.dispatchEvent(new Event('input'));
      await settle(harness.fixture);
      expect(textOf(move)).toContain('Runs Mon 2 Nov – Sun 15 Nov');
      press(move, 'Reschedule');
      await settle(harness.fixture);

      expect(api['rescheduleMesocycle']).toHaveBeenCalledWith('block-next', {
        startDate: '2026-11-02',
        version: 1,
      });
      expect(context.notice()).toBe('Strength Base is moved.');
    });

    it('opens every shared week now, or goes back to opening them as they start', async () => {
      const { harness, host, api, context } = await render();
      press(host, 'Manage program');
      await settle(harness.fixture);

      all(host, 'app-client-actions .item')[5].click();
      await settle(harness.fixture);

      expect(api['updateMesocycleVisibility']).toHaveBeenCalledWith('block-lean', {
        revealAllWeeks: true,
        version: 4,
      });
      expect(context.notice()).toBe('Maya now sees every shared week.');
    });
  });

  describe('the program’s training maxes (P2)', () => {
    const maxes = {
      mesocycleId: 'block-lean',
      version: 4,
      loadUnit: 'Kilogram',
      isClosed: false,
      maxes: [
        {
          exerciseId: 'squat',
          exerciseName: 'Back squat',
          current: {
            id: 'max-1',
            value: 100,
            unit: 'Kilogram',
            source: 'SavedMax',
            basis: null,
            effectiveFromWeek: 1,
            setOn: '2026-09-14',
            reason: 'Assignment training max.',
          },
          weekOneSet: { repetitions: 5, rpe: 8, load: 80 },
          earlier: [],
          suggestion: null,
        },
      ],
    };
    const emptyPreview = {
      previewHash: 'hash-1',
      loadUnit: 'Kilogram',
      effectiveFromWeek: 1,
      lifts: [],
      sets: [],
      changedSetCount: 0,
      unchangedSetCount: 0,
      sessionCount: 0,
      keptSessionCount: 0,
    };

    it('shows them beside the program, and only when the program uses any', async () => {
      const { host, programApi } = await render({ maxes });

      expect(programApi.getTrainingMaxes).toHaveBeenCalledWith('block-lean');
      const panel = host.querySelector('app-program-maxes')!;
      expect(panel.hasAttribute('data-filled')).toBe(true);
      expect(textOf(panel.querySelector('.name'))).toBe('Back squat');
      expect(textOf(panel.querySelector('.value'))).toBe('100 kg');
      expect(panel.closest('.top')).not.toBeNull();
    });

    it('reads them once, before the page first draws, so it is laid out once (audit UIQ-5, UIQ-8)', async () => {
      const answer = new Subject<typeof maxes>();
      const { harness, host, programApi } = await render({
        programApi: { getTrainingMaxes: vi.fn(() => answer) },
      });

      // The program has answered; the page keeps its loading shape until its maxes have too.
      expect(host.querySelector('.program [aria-busy="true"]')).not.toBeNull();
      expect(host.querySelector('app-program-maxes')).toBeNull();

      answer.next(maxes);
      answer.complete();
      await settle(harness.fixture);

      const panel = host.querySelector('app-program-maxes')!;
      expect(panel.hasAttribute('data-filled')).toBe(true);
      expect(panel.querySelector('[aria-busy="true"]')).toBeNull();
      expect(programApi.getTrainingMaxes).toHaveBeenCalledTimes(1);
    });

    it('leaves the page at full width for a program that works out no weight from a max', async () => {
      const { host } = await render();

      expect(host.querySelector('app-program-maxes')!.hasAttribute('data-filled')).toBe(false);
      expect(host.querySelector('app-program-maxes section')).toBeNull();
    });

    it('opens the update sheet from the panel, and reads the program again once the maxes are updated', async () => {
      const { harness, host, getProgram, programApi, context, api } = await render({
        maxes,
        programApi: { previewTrainingMaxes: vi.fn(() => of(emptyPreview)) },
      });
      press(host, 'Update maxes for the coming weeks');
      await settle(harness.fixture);

      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Update training maxes');
      type(sheet, 'input[type="number"]', '120');
      await settle(harness.fixture);
      press(sheet, 'Show the new weights');
      await settle(harness.fixture);
      const historyReads = api.listStrengthMaxes.mock.calls.length;
      press(sheet, 'Update maxes');
      await settle(harness.fixture);
      await settle(harness.fixture);

      expect(programApi.applyTrainingMaxes).toHaveBeenCalledWith(
        'block-lean',
        expect.objectContaining({ mesocycleVersion: 4, previewHash: 'hash-1' }),
      );
      expect(dialog()).toBeNull();
      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(context.notice()).toBe('Training maxes updated. The weeks still to come follow them.');
      // The strength history below lists the program's maxes too, so it reads them again (R5.4c, D6).
      expect(api.listStrengthMaxes.mock.calls.length).toBe(historyReads + 1);
    });

    it('offers no way to change the maxes of a program that is over', async () => {
      const { host } = await render({
        program: coachProgram([cancelledBlock()]),
        maxes: { ...maxes, isClosed: true },
      });

      expect(textOf(host.querySelector('app-program-maxes .note'))).toBe(
        'This program is over, so its maxes stay as they were.',
      );
      expect(host.querySelector('app-program-maxes button')).toBeNull();
    });

    it('renames the program from the Manage menu, and reads it again', async () => {
      const { harness, host, getProgram, programApi, context } = await render();
      press(host, 'Manage program');
      await settle(harness.fixture);
      all(host, 'app-client-actions .item')[1].click();
      await settle(harness.fixture);

      const rename = dialog()!;
      expect(textOf(rename.querySelector('h2'))).toBe('Rename program');
      const name = rename.querySelector<HTMLInputElement>('input[type="text"]')!;
      expect(name.value).toBe('Lean & Strong · Phase 2');
      type(rename, 'input[type="text"]', '  Peaking block  ');
      await settle(harness.fixture);
      press(rename, 'Rename program');
      await settle(harness.fixture);

      expect(programApi.renameProgram).toHaveBeenCalledWith('block-lean', {
        name: 'Peaking block',
        version: 4,
      });
      expect(dialog()).toBeNull();
      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(context.notice()).toBe('The program was renamed.');
    });

    it('will not rename a program to nothing', async () => {
      const { harness, host, programApi } = await render();
      press(host, 'Manage program');
      await settle(harness.fixture);
      all(host, 'app-client-actions .item')[1].click();
      await settle(harness.fixture);

      const rename = dialog()!;
      type(rename, 'input[type="text"]', '   ');
      await settle(harness.fixture);
      press(rename, 'Rename program');
      await settle(harness.fixture);

      expect(programApi.renameProgram).not.toHaveBeenCalled();
      expect(textOf(rename)).toContain('Give the program a name.');
    });
  });

  describe('assigning a program', () => {
    it('opens the Assign program sheet from the address, once', async () => {
      const { harness, router } = await render({ url: '/clients/client-1/training?action=assign' });
      await settle(harness.fixture);

      expect(textOf(dialog()!.querySelector('h2'))).toBe('Assign program');
      // The word is taken out of the address, so Back and a reload do not open it again.
      expect(router.url).toBe('/clients/client-1/training');
    });

    it('brings the training maxes into view when the coach came to review them, once', async () => {
      const { harness, router } = await render({ url: '/clients/client-1/training?action=maxes' });
      await settle(harness.fixture);

      const panel = harness.fixture.debugElement.query(
        (element) => element.name === 'app-program-maxes',
      );
      expect(panel.componentInstance.reveal()).toBe(true);
      expect(router.url).toBe('/clients/client-1/training');
    });

    it('opens the sheet from the empty state', async () => {
      const { harness, host } = await render({ program: coachProgram([]) });

      press(host, 'Assign program');
      await settle(harness.fixture);

      expect(textOf(dialog()!.querySelector('h2'))).toBe('Assign program');
    });
  });

  describe('a session', () => {
    function blockView(): TrainingMesocycleView {
      return {
        id: 'block-lean',
        loadUnit: 'Kilogram',
        weeks: [
          {
            id: 'block-lean-week3',
            weekNumber: 3,
            sessions: [
              {
                id: 'block-lean-s33',
                name: 'Lower B',
                coachNotes: 'Brace before every rep.',
                exercises: [
                  {
                    id: 'ex-1',
                    exerciseName: 'Back squat',
                    coachNotes: null,
                    sets: [
                      {
                        repetitionsMinimum: 8,
                        repetitionsMaximum: 10,
                        prescribedLoad: 60,
                        targetRpe: 8,
                      },
                      {
                        repetitionsMinimum: 8,
                        repetitionsMaximum: 10,
                        prescribedLoad: 60,
                        targetRpe: 8,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      } as unknown as TrainingMesocycleView;
    }

    it('opens what it prescribes, and offers a swap for one still to come', async () => {
      const { harness, host, api } = await render({
        api: { getTrainingMesocycle: vi.fn(() => of(blockView())) },
      });

      all(host.querySelector('.week.current')!, 'button.session')[2].click();
      await settle(harness.fixture);

      const sheet = dialog()!;
      expect(textOf(sheet.querySelector('h2'))).toBe('Lower B');
      expect(api['getTrainingMesocycle']).toHaveBeenCalledWith('block-lean');
      expect(textOf(sheet)).toContain('Thu 1 Oct · Week 3');
      expect(textOf(sheet)).toContain('Brace before every rep.');
      expect(textOf(sheet)).toContain('Back squat');
      expect(textOf(sheet)).toContain('2 × 8–10 reps · 60 kg · RPE 8');
      expect(sheet.querySelector('app-coach-workout')).toBeNull();
      expect(textOf(sheet.querySelector('.swap summary'))).toBe('Swap this session');
    });

    it('swaps a session for a saved one on the day it already has (TRAIN-3)', async () => {
      const view = blockView();
      (view.weeks[0].sessions[0] as unknown as { dayOffset: number }).dayOffset = 3;
      const saved = {
        id: 'saved-1',
        name: 'Lower A (saved)',
        sourceTemplateVersionId: 'version-1',
        sourceTemplateSessionId: 'template-session-1',
        session: {
          id: 'template-session-1',
          name: 'Lower A',
          // Where it sat in its own program: the first day.
          dayOffset: 0,
          coachNotes: null,
          exercises: [
            {
              exerciseId: 'exercise-1',
              exerciseName: 'Back squat',
              isMainLift: false,
              modificationPolicy: 'CoachApprovedSwap',
              coachNotes: null,
              approvedAlternativeExerciseIds: [],
              sets: [
                {
                  setType: 'Normal',
                  repetitionsMinimum: 5,
                  repetitionsMaximum: 5,
                  loadStrategy: 'Direct',
                  directLoad: 100,
                  loadUnit: 'Kilogram',
                  percentageWorkingMax: null,
                  exertionDisplayPreference: 'Rpe',
                  targetRpe: 8,
                  targetRir: null,
                  restSeconds: null,
                  tempo: null,
                  coachNotes: null,
                  isManualLoadOverride: false,
                  prescribedLoad: 100,
                },
              ],
            },
          ],
        },
      };
      const replaceFutureTrainingSession = vi.fn(() => of({}));
      const { harness, host } = await render({
        api: {
          getTrainingMesocycle: vi.fn(() => of(view)),
          listSavedSessions: vi.fn(() => of([saved])),
          replaceFutureTrainingSession,
        },
      });

      all(host.querySelector('.week.current')!, 'button.session')[2].click();
      await settle(harness.fixture);
      const sheet = dialog()!;
      const swap = sheet.querySelector<HTMLDetailsElement>('.swap')!;
      swap.open = true;
      swap.dispatchEvent(new Event('toggle'));
      await settle(harness.fixture);
      expect(textOf(swap)).toContain('It stays on Thu 1 Oct');
      const select = swap.querySelector('select')!;
      select.value = 'saved-1';
      select.dispatchEvent(new Event('change'));
      await settle(harness.fixture);
      press(sheet, 'Swap session');
      await settle(harness.fixture);

      expect(replaceFutureTrainingSession).toHaveBeenCalledWith(
        'block-lean',
        'block-lean-s33',
        expect.objectContaining({
          session: expect.objectContaining({ name: 'Lower A', dayOffset: 3 }),
        }),
      );
    });

    it('sends a swap with nothing chosen to the list, and says a refused swap in its summary', async () => {
      const saved = {
        id: 'saved-2',
        name: 'Upper A (saved)',
        sourceTemplateVersionId: 'version-1',
        sourceTemplateSessionId: 'template-session-2',
        session: {
          id: 'template-session-2',
          name: 'Upper A',
          dayOffset: 0,
          coachNotes: null,
          exercises: [],
        },
      };
      const replaceFutureTrainingSession = vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { code: 'concurrency_conflict' } }),
        ),
      );
      const { harness, host } = await render({
        api: {
          getTrainingMesocycle: vi.fn(() => of(blockView())),
          listSavedSessions: vi.fn(() => of([saved])),
          replaceFutureTrainingSession,
        },
      });

      all(host.querySelector('.week.current')!, 'button.session')[2].click();
      await settle(harness.fixture);
      const sheet = dialog()!;
      const swap = sheet.querySelector<HTMLDetailsElement>('.swap')!;
      swap.open = true;
      swap.dispatchEvent(new Event('toggle'));
      await settle(harness.fixture);
      expect(textOf(formSummary(swap))).toBe('');

      press(sheet, 'Swap session');
      await settle(harness.fixture);
      const select = swap.querySelector('select')!;
      expect(textOf(swap)).toContain('Choose a saved session.');
      expect(document.activeElement).toBe(select);
      expect(replaceFutureTrainingSession).not.toHaveBeenCalled();

      select.value = 'saved-2';
      select.dispatchEvent(new Event('change'));
      await settle(harness.fixture);
      press(sheet, 'Swap session');
      await settle(harness.fixture);

      expect(replaceFutureTrainingSession).toHaveBeenCalledTimes(1);
      expect(dialog()).toBe(sheet);
      expect(textOf(formSummary(swap))).toBe(
        'This program was changed somewhere else since you opened it. It has been reloaded: check it, then try again.',
      );
      expect(document.activeElement).toBe(formSummary(swap));
    });

    it('opens the session a client’s note is on when a notice links to it, once', async () => {
      const { harness, router } = await render({
        url: '/clients/client-1/training?session=block-lean-s33',
        api: { getTrainingMesocycle: vi.fn(() => of(blockView())) },
      });
      await settle(harness.fixture);

      expect(textOf(dialog()!.querySelector('h2'))).toBe('Lower B');
      // The word leaves the address, so Back and a reload do not open it again.
      expect(router.url).toBe('/clients/client-1/training');
    });

    it('shows what the client did for a finished session, and offers no swap', async () => {
      const { harness, host } = await render({
        api: { getTrainingMesocycle: vi.fn(() => of(blockView())) },
      });

      all(host.querySelector('.week.current')!, 'button.session')[0].click();
      await settle(harness.fixture);

      const sheet = dialog()!;
      expect(textOf(sheet)).toContain('What Maya did');
      expect(sheet.querySelector('app-coach-workout')).not.toBeNull();
      expect(sheet.querySelector('.swap')).toBeNull();
    });
  });

  describe('the strength history', () => {
    it('is read with the page, one history per lift: recorded maxes and every program’s (STR-015)', async () => {
      const { host, api } = await render();

      expect(host.querySelector('app-client-strength')).not.toBeNull();
      expect(api.listStrengthMaxes).toHaveBeenCalledWith('client-1', undefined, 0, 100, true);
    });
  });
});
