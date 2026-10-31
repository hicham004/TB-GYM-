import { describe, expect, it } from 'vitest';
import type { ClientEnrollment } from '../../core/api/api.models';
import type { MesocycleSummary } from '../../core/api/generated';
import { sessionPack } from '../../../testing/client-service-fixtures';
import { attentionItem, MAYA } from '../../../testing/coach-today-fixtures';
import {
  activeBlock,
  addDays,
  bodyweightSummary,
  currentEnrollment,
  daysBetween,
  planEnding,
  renewalPrompt,
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

describe('a pack beside a coaching plan (ADR 0038)', () => {
  const today = '2026-10-01';

  it('never stands in front of a coaching plan, however it was sold', () => {
    const plan = enrollment({
      id: 'plan',
      startDate: '2026-07-21',
      endDateExclusive: '2026-10-13',
    });
    const pack = sessionPack();
    expect(currentEnrollment([pack, plan], today)?.id).toBe('plan');
    expect(currentEnrollment([plan, pack], today)?.id).toBe('plan');

    const next = enrollment({
      id: 'next',
      startDate: '2026-11-01',
      endDateExclusive: '2026-12-01',
      effectiveStatus: 'Upcoming',
    });
    expect(currentEnrollment([pack, next], today)?.id).toBe('next');
  });

  it('stands for the plan with no coaching plan ever', () => {
    const over = sessionPack({
      id: 'over',
      startDate: '2026-07-01',
      endDateExclusive: '2026-08-01',
      storedStatus: 'Expired',
      effectiveStatus: 'Expired',
    });
    expect(currentEnrollment([sessionPack()], today)?.id).toBe('e-pack');
    expect(currentEnrollment([over, sessionPack()], today)?.id).toBe('e-pack');
    expect(currentEnrollment([over], today)?.id).toBe('over');
  });

  describe('once a coaching plan has run out (SES-010)', () => {
    const ended = enrollment({
      id: 'ended',
      startDate: '2026-06-01',
      endDateExclusive: '2026-09-01',
      storedStatus: 'Expired',
      effectiveStatus: 'Expired',
    });

    it('leaves that plan in front while the pack runs, to be renewed', () => {
      expect(currentEnrollment([sessionPack(), ended], today)?.id).toBe('ended');
    });

    it('reads a plan past its last day as ended before the Worker has marked it', () => {
      const unmarked = { ...ended, id: 'unmarked', storedStatus: 'Active' } as ClientEnrollment;
      expect(currentEnrollment([sessionPack(), unmarked], today)?.id).toBe('unmarked');
    });

    it('stays on the coaching plan whichever of the two ended last', () => {
      const pack = sessionPack({
        startDate: '2026-08-01',
        endDateExclusive: '2026-09-20',
        storedStatus: 'Expired',
        effectiveStatus: 'Expired',
      });
      expect(currentEnrollment([ended, pack], today)?.id).toBe('ended');
      expect(currentEnrollment([pack, ended], today)?.id).toBe('ended');
    });

    it('takes the later of two that ran out', () => {
      const later = { ...ended, id: 'later', endDateExclusive: '2026-09-15' };
      expect(currentEnrollment([sessionPack(), ended, later], today)?.id).toBe('later');
    });

    it('gives way to the next coaching plan booked after it', () => {
      const next = enrollment({
        id: 'next',
        startDate: '2026-10-05',
        endDateExclusive: '2026-12-01',
        effectiveStatus: 'Upcoming',
      });
      expect(currentEnrollment([sessionPack(), ended, next], today)?.id).toBe('next');
    });
  });

  it('stands for the plan beside one the coach cancelled, which never ran out', () => {
    const cancelled = enrollment({
      id: 'cancelled',
      startDate: '2026-06-01',
      endDateExclusive: '2026-09-01',
      storedStatus: 'Cancelled',
      effectiveStatus: 'Cancelled',
    });
    expect(currentEnrollment([cancelled, sessionPack()], today)?.id).toBe('e-pack');
    expect(currentEnrollment([cancelled], today)?.id).toBe('cancelled');
  });
});

describe('the renewal prompt beside a pack (ADR 0038)', () => {
  it('stays on the plan the server flagged, whichever comes first in the list', () => {
    const plan = enrollment({
      id: 'plan',
      endDateExclusive: '2026-10-13',
      lastActiveDate: '2026-10-12',
    });
    const prompt = renewalPrompt([sessionPack(), plan], '2026-10-01', {
      lastDay: '2026-10-12',
      renewId: 'plan',
    });
    expect(prompt?.enrollment.id).toBe('plan');
  });
});

describe('the plan-ending flag the client page reads (CLI-018 v4, critique B4a)', () => {
  it('names the plan to renew, or none while a renewal of it waits for its payment', () => {
    const ending = (fields: Parameters<typeof attentionItem>[2]) =>
      planEnding([attentionItem('PlanEndingSoon', MAYA, fields)]);

    expect(ending({ date: '2026-09-30', subjectId: 'enrollment-1' })).toEqual({
      lastDay: '2026-09-30',
      renewId: 'enrollment-1',
    });
    expect(ending({ date: '2026-09-30', count: 1, subjectId: 'renewal-2' })).toEqual({
      lastDay: '2026-09-30',
      renewId: null,
    });
    expect(planEnding([attentionItem('MissedSessions', MAYA, { count: 2 })])).toBeNull();
    expect(planEnding(null)).toBeNull();
  });
});

describe('the renewal prompt, while the server flags the plan ending soon', () => {
  const flag = (lastDay: string) => ({ lastDay, renewId: 'enrollment-1' });

  it('follows the server’s flag and counts no days of its own: 13 days on is soon, 14 is not', () => {
    // The server flags a last day 13 days on and leaves one 14 days on alone (critique B4a).
    expect(
      renewalPrompt([enrollment({ lastActiveDate: '2026-10-03' })], TODAY, flag('2026-10-03'))
        ?.daysLeft,
    ).toBe(13);
    expect(renewalPrompt([enrollment({ lastActiveDate: '2026-10-04' })], TODAY, null)).toBeNull();
    expect(
      renewalPrompt(
        [enrollment({ lastActiveDate: TODAY, endDateExclusive: '2026-09-21' })],
        TODAY,
        flag(TODAY),
      )?.daysLeft,
    ).toBe(0);
    // A flag about another plan's last day is not about this one.
    expect(renewalPrompt([enrollment()], TODAY, flag('2026-12-01'))).toBeNull();
  });

  it('is not offered for a plan that is not active or is already followed by another', () => {
    const soon = flag('2026-09-30');
    expect(renewalPrompt([enrollment({ effectiveStatus: 'Paused' })], TODAY, soon)).toBeNull();
    expect(
      renewalPrompt([enrollment({ effectiveStatus: 'PendingPayment' })], TODAY, soon),
    ).toBeNull();

    const renewal = enrollment({
      id: 'renewal',
      renewedFromEnrollmentId: 'enrollment-1',
      startDate: '2026-10-01',
      endDateExclusive: '2027-01-01',
      effectiveStatus: 'PendingPayment',
    });
    expect(renewalPrompt([enrollment(), renewal], TODAY, soon)).toBeNull();

    const nextCovering = enrollment({
      id: 'next',
      startDate: '2026-10-01',
      endDateExclusive: '2026-12-01',
      effectiveStatus: 'Upcoming',
      features: ['Training'],
    });
    expect(renewalPrompt([enrollment(), nextCovering], TODAY, soon)).toBeNull();

    // A cancelled renewal no longer follows the plan, so the prompt comes back.
    expect(
      renewalPrompt([enrollment(), { ...renewal, effectiveStatus: 'Cancelled' }], TODAY, soon),
    ).not.toBeNull();
  });
});

describe('the program block covering today', () => {
  it('reads the primary block when a supplemental one also covers today', () => {
    const supplemental = block({ id: 'supplemental', kind: 'Supplemental', name: 'Mobility' });
    expect(activeBlock([supplemental, block()], TODAY)?.id).toBe('block-1');
    expect(activeBlock([supplemental], TODAY)?.id).toBe('supplemental');
  });

  it('ignores cancelled and completed blocks, and blocks that do not cover today', () => {
    const finished = block({ id: 'done', status: 'Completed' });
    const cancelled = block({ id: 'x', status: 'Cancelled' });
    const next = block({ id: 'next', startDate: '2026-10-05', endDateExclusive: '2026-11-30' });
    expect(activeBlock([finished, cancelled, next], TODAY)).toBeNull();
    // The end is exclusive: a block ending today no longer covers it.
    expect(activeBlock([block({ endDateExclusive: TODAY })], TODAY)).toBeNull();
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
});
