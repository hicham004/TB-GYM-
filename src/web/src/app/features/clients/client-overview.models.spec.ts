import { describe, expect, it } from 'vitest';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  CheckInAssignmentListItem,
  CheckInResponseStatus,
  MesocycleSummary,
  TrainingMesocycleView,
} from '../../core/api/generated';
import {
  addDays,
  bodyweightSummary,
  checkInState,
  currentEnrollment,
  daysBetween,
  renewalPrompt,
  trainingWeekState,
  trendPath,
  weekContaining,
} from './client-overview.models';

// Sunday 20 September 2026, the approved scenario day.
const TODAY = '2026-09-20';

function enrollment(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'enrollment-1',
    productId: 'product-1',
    offerId: 'offer-1',
    renewedFromEnrollmentId: null,
    productName: 'Strength & Body Composition',
    offerLabel: '16 weeks',
    priceAmount: 200,
    priceCurrency: 'USD',
    paidAmount: 200,
    balanceAmount: 0,
    startDate: '2026-07-21',
    endDateExclusive: '2026-10-01',
    lastActiveDate: '2026-09-30',
    storedStatus: 'Active',
    effectiveStatus: 'Active',
    statusReason: null,
    features: ['Training', 'Nutrition'],
    payments: [],
    createdAtUtc: '2026-07-20T09:00:00Z',
    version: 1,
    ...overrides,
  } as ClientEnrollment;
}

function checkIn(
  id: string,
  dueDate: string,
  status: CheckInResponseStatus | null,
  submittedAtUtc: string | null = null,
  reviewedAtUtc: string | null = null,
): CheckInAssignmentListItem {
  return {
    assignment: {
      id,
      formId: 'form-1',
      formTitle: 'Weekly check-in',
      formVersionId: 'version-1',
      formVersionNumber: 1,
      clientProfileId: 'client-1',
      dueDate,
      assignedAtUtc: '2026-09-01T09:00:00Z',
      assignedByUserId: 'coach-1',
    },
    response:
      status === null
        ? null
        : {
            responseId: `response-${id}`,
            status,
            submittedDate: submittedAtUtc?.slice(0, 10) ?? null,
            submittedAtUtc,
            reviewedAtUtc,
            isLate: false,
          },
  };
}

function block(overrides: Partial<MesocycleSummary> = {}): MesocycleSummary {
  return {
    id: 'block-1',
    enrollmentId: 'enrollment-1',
    name: 'Upper-Body Strength v3',
    startDate: '2026-08-24',
    endDateExclusive: '2026-10-19',
    kind: 'Primary',
    status: 'Active',
    revealAllWeeks: false,
    version: 1,
    ...overrides,
  };
}

/** Eight weeks from Mon 24 Aug; week 4 (14-20 Sep) holds today. */
function detail(
  week4: { isPublished: boolean; isVisible: boolean | null },
  sessions: { date: string; name: string; isCompleted?: boolean; position?: number }[] = [],
): TrainingMesocycleView {
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const startsOn = addDays('2026-08-24', index * 7);
    const number = index + 1;
    return {
      id: `week-${number}`,
      weekNumber: number,
      label: null,
      startsOn,
      isPublished: number === 4 ? week4.isPublished : true,
      isVisible: number === 4 ? week4.isVisible : true,
      unlockDate: null,
      sessions: sessions
        .filter((session) => session.date >= startsOn && session.date < addDays(startsOn, 7))
        .map((session, position) => ({
          id: `${session.name}-${session.date}`,
          position: session.position ?? position,
          dayOffset: daysBetween(startsOn, session.date),
          scheduledDate: session.date,
          name: session.name,
          coachNotes: null,
          hasStarted: false,
          isCompleted: session.isCompleted ?? false,
          workoutExecutionId: null,
          exercises: [],
        })),
    };
  });
  return { ...block(), weeks } as unknown as TrainingMesocycleView;
}

describe('workspace calendar arithmetic', () => {
  it('adds and counts calendar days without a local-time Date', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // Beirut's spring-forward day
    expect(daysBetween('2026-09-14', '2026-09-20')).toBe(6);
    expect(daysBetween('2026-09-20', '2026-09-14')).toBe(-6);
  });

  it('finds the week containing today from the workspace week start', () => {
    expect(weekContaining(TODAY, 'Monday')).toEqual({
      start: '2026-09-14',
      endExclusive: '2026-09-21',
    });
    // With Sunday weeks, Sunday is the first day rather than the last.
    expect(weekContaining(TODAY, 'Sunday')).toEqual({
      start: '2026-09-20',
      endExclusive: '2026-09-27',
    });
    expect(weekContaining('2026-09-14', 'Monday').start).toBe('2026-09-14');
  });
});

describe('the plan the header describes', () => {
  it('prefers the active plan covering today, then the next one, then the last to end', () => {
    const active = enrollment({ id: 'active' });
    const paused = enrollment({ id: 'paused', effectiveStatus: 'Paused' });
    const next = enrollment({
      id: 'next',
      startDate: '2026-10-01',
      endDateExclusive: '2026-12-01',
      effectiveStatus: 'Upcoming',
    });
    const ended = enrollment({
      id: 'ended',
      startDate: '2026-05-01',
      endDateExclusive: '2026-07-01',
      effectiveStatus: 'Expired',
    });
    const cancelled = enrollment({ id: 'cancelled', effectiveStatus: 'Cancelled' });

    expect(currentEnrollment([paused, active, next], TODAY)?.id).toBe('active');
    expect(currentEnrollment([cancelled, paused, next], TODAY)?.id).toBe('paused');
    expect(currentEnrollment([ended, next], TODAY)?.id).toBe('next');
    expect(currentEnrollment([ended], TODAY)?.id).toBe('ended');
    expect(currentEnrollment([], TODAY)).toBeNull();
  });
});

describe('the renewal prompt (14 days, agreed 2026-09-25)', () => {
  it('appears from 14 days before the last day through the last day itself', () => {
    expect(renewalPrompt([enrollment({ lastActiveDate: '2026-10-04' })], TODAY)?.daysLeft).toBe(14);
    expect(renewalPrompt([enrollment({ lastActiveDate: '2026-10-05' })], TODAY)).toBeNull();
    expect(
      renewalPrompt([enrollment({ lastActiveDate: TODAY, endDateExclusive: '2026-09-21' })], TODAY)
        ?.daysLeft,
    ).toBe(0);
  });

  it('is not offered for a plan that is not active or is already followed by another', () => {
    expect(renewalPrompt([enrollment({ effectiveStatus: 'Paused' })], TODAY)).toBeNull();
    expect(renewalPrompt([enrollment({ effectiveStatus: 'PendingPayment' })], TODAY)).toBeNull();

    const renewal = enrollment({
      id: 'renewal',
      renewedFromEnrollmentId: 'enrollment-1',
      startDate: '2026-10-01',
      endDateExclusive: '2027-01-01',
      effectiveStatus: 'PendingPayment',
    });
    expect(renewalPrompt([enrollment(), renewal], TODAY)).toBeNull();

    const nextCovering = enrollment({
      id: 'next',
      startDate: '2026-10-01',
      endDateExclusive: '2026-12-01',
      effectiveStatus: 'Upcoming',
      features: ['Training'],
    });
    expect(renewalPrompt([enrollment(), nextCovering], TODAY)).toBeNull();

    // A cancelled renewal no longer follows the plan, so the prompt comes back.
    expect(
      renewalPrompt([enrollment(), { ...renewal, effectiveStatus: 'Cancelled' }], TODAY),
    ).not.toBeNull();
  });
});

describe('the check-in line (workflow facts only)', () => {
  it('ranks a submission awaiting review above everything else, newest first', () => {
    const state = checkInState(
      [
        checkIn('old', '2026-09-13', 'Submitted', '2026-09-13T07:00:00Z'),
        checkIn('new', '2026-09-20', 'Submitted', '2026-09-20T04:12:00Z'),
        checkIn('overdue', '2026-09-18', null),
      ],
      TODAY,
    );
    expect(state.kind).toBe('needsReview');
    expect(state.kind === 'needsReview' && state.item.assignment.id).toBe('new');
  });

  it('then an overdue check-in, then the next one due, then the last reviewed', () => {
    expect(
      checkInState([checkIn('a', '2026-09-18', 'Draft'), checkIn('b', '2026-09-27', null)], TODAY)
        .kind,
    ).toBe('overdue');

    const due = checkInState(
      [checkIn('later', '2026-10-04', null), checkIn('sooner', '2026-09-27', null)],
      TODAY,
    );
    expect(due.kind === 'due' && due.item.assignment.id).toBe('sooner');

    const reviewed = checkInState(
      [
        checkIn('first', '2026-09-06', 'Reviewed', '2026-09-06T08:00:00Z', '2026-09-06T12:00:00Z'),
        checkIn('second', '2026-09-13', 'Reviewed', '2026-09-13T08:00:00Z', '2026-09-14T12:00:00Z'),
      ],
      TODAY,
    );
    expect(reviewed.kind === 'reviewed' && reviewed.item.assignment.id).toBe('second');
    expect(checkInState([], TODAY).kind).toBe('none');
  });
});

describe('the training week', () => {
  const sessions = [
    { date: '2026-09-18', name: 'Lower Body — Strength A', isCompleted: true },
    { date: TODAY, name: 'Upper Body — Strength B' },
    { date: '2026-09-22', name: 'Conditioning' },
  ];

  it('says the week is not shared when the client cannot see the current week', () => {
    const unpublished = trainingWeekState(
      [block()],
      detail({ isPublished: false, isVisible: false }, sessions),
      TODAY,
    );
    expect(unpublished).toMatchObject({ kind: 'notShared', weekNumber: 4, weekCount: 8 });

    // Published but not yet unlocked for the client is still not shared: the server's
    // `isVisible` decides, not the published flag alone.
    const locked = trainingWeekState(
      [block()],
      detail({ isPublished: true, isVisible: false }, sessions),
      TODAY,
    );
    expect(locked.kind).toBe('notShared');
  });

  it('names today’s session and the next one when the week is shared', () => {
    const state = trainingWeekState(
      [block()],
      detail({ isPublished: true, isVisible: true }, sessions),
      TODAY,
    );
    expect(state).toMatchObject({
      kind: 'shared',
      blockName: 'Upper-Body Strength v3',
      weekNumber: 4,
      today: { name: 'Upper Body — Strength B', date: TODAY },
      next: { name: 'Upper Body — Strength B', date: TODAY },
    });

    const doneToday = trainingWeekState(
      [block()],
      detail({ isPublished: true, isVisible: true }, [
        { date: TODAY, name: 'Upper Body — Strength B', isCompleted: true },
        { date: '2026-09-22', name: 'Conditioning' },
      ]),
      TODAY,
    );
    expect(doneToday).toMatchObject({ today: null, next: { name: 'Conditioning' } });
  });

  it('tells between programs from no program, ignoring cancelled and completed blocks', () => {
    const next = block({ id: 'next', startDate: '2026-10-05', endDateExclusive: '2026-11-30' });
    const finished = block({ id: 'done', status: 'Completed' });
    expect(trainingWeekState([finished, next], null, TODAY)).toEqual({
      kind: 'betweenPrograms',
      nextStartDate: '2026-10-05',
    });
    expect(
      trainingWeekState([finished, block({ id: 'x', status: 'Cancelled' })], null, TODAY),
    ).toEqual({ kind: 'noProgram' });
  });

  it('reads the primary block when a supplemental one also covers today', () => {
    const supplemental = block({ id: 'supplemental', kind: 'Supplemental', name: 'Mobility' });
    const state = trainingWeekState(
      [supplemental, block()],
      detail({ isPublished: true, isVisible: true }, sessions),
      TODAY,
    );
    expect(state).toMatchObject({ kind: 'shared', blockName: 'Upper-Body Strength v3' });
  });
});

describe('the bodyweight trend', () => {
  it('uses weekly means with a value and compares the last two', () => {
    const summary = bodyweightSummary([
      { weekStart: '2026-08-31', displayMean: 73.1 },
      { weekStart: '2026-09-07', displayMean: null },
      { weekStart: '2026-09-14', displayMean: 72.4 },
    ]);
    expect(summary.latest).toEqual({ weekStart: '2026-09-14', value: 72.4 });
    expect(summary.change).toBe(-0.7);
    expect(bodyweightSummary([{ weekStart: '2026-09-14', displayMean: 72.4 }]).change).toBeNull();
  });

  it('keeps a missing week as a gap in x rather than closing it up', () => {
    const plot = trendPath(
      [
        { weekStart: '2026-07-27', value: 74 },
        { weekStart: '2026-09-14', value: 72 },
      ],
      '2026-07-27',
      8,
      240,
      80,
    );
    expect(plot.path).toBe('4,4 236,76');
    expect(plot.last).toEqual({ x: 236, y: 76 });
    expect([plot.min, plot.max]).toEqual([72, 74]);
  });
});
