import { describe, expect, it } from 'vitest';
import type { ClientEnrollment } from '../../core/api/api.models';
import type { MesocycleSummary } from '../../core/api/generated';
import {
  activeBlock,
  addDays,
  bodyweightSummary,
  currentEnrollment,
  daysBetween,
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
