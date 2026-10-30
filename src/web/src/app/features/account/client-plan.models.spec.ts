import { describe, expect, it } from 'vitest';
import type { OwnPlanView } from '../../core/api/generated';
import { ownPlan, ownPlans } from './client-plan.models';

const TODAY = '2026-10-15';

function plan(overrides: Partial<OwnPlanView> = {}): OwnPlanView {
  return {
    id: 'plan-1',
    name: 'Online Coaching',
    optionLabel: '12 weeks',
    description: 'Your own program and a weekly check-in.',
    startDate: '2026-10-05',
    lastDay: '2026-12-27',
    cancelledOn: null,
    status: 'Active',
    features: ['Training', 'Nutrition'],
    ...overrides,
  };
}

const read = (overrides: Partial<OwnPlanView> = {}) => ownPlan(plan(overrides), TODAY, 'en-GB');

describe('ownPlan', () => {
  it('carries the plan’s name, its price’s name, its dates and the coach’s description', () => {
    expect(read()).toMatchObject({
      id: 'plan-1',
      name: 'Online Coaching',
      option: '12 weeks',
      dates: 'Mon 5 Oct – Sun 27 Dec',
      description: 'Your own program and a weekly check-in.',
    });
  });

  it('says the years when the dates are not all this year’s', () => {
    expect(read({ lastDay: '2027-01-10' }).dates).toBe('5 Oct 2026 – 10 Jan 2027');
  });

  it('has no description to show when the coach wrote none', () => {
    expect(read({ description: null }).description).toBeNull();
  });

  it('lists what’s included in one fixed order, each with its icon', () => {
    const features: OwnPlanView['features'] = ['Messaging', 'Training', 'ResourceLibrary'];
    expect(read({ features }).includes).toEqual([
      { feature: 'Training', label: 'Training', icon: 'training' },
      { feature: 'Messaging', label: 'Messaging', icon: 'messages' },
      { feature: 'ResourceLibrary', label: 'Resources', icon: 'resources' },
    ]);
  });

  describe('where a plan stands', () => {
    it('counts a running plan’s days down, its last two by name', () => {
      expect(read({ lastDay: '2026-10-25' }).pill).toEqual({
        label: 'Active · 10 days left',
        tone: 'success',
      });
      expect(read({ lastDay: '2026-10-17' }).pill.label).toBe('Active · 2 days left');
      expect(read({ lastDay: '2026-10-16' }).pill.label).toBe('Ends tomorrow');
      expect(read({ lastDay: TODAY }).pill.label).toBe('Ends today');
      expect(read().note).toBeNull();
    });

    it('counts down to a plan that has not started', () => {
      const coming = { status: 'Upcoming', startDate: '2026-10-20' } as const;
      expect(read(coming).pill).toEqual({ label: 'Starts in 5 days', tone: 'info' });
      expect(read({ ...coming, startDate: '2026-10-16' }).pill.label).toBe('Starts tomorrow');
    });

    it('says a plan waits for payment in the words of the notice, and no amount', () => {
      const waiting = read({ status: 'PendingPayment' });
      expect(waiting.pill).toEqual({ label: 'Waiting for payment', tone: 'warm' });
      expect(waiting.note).toBe('It starts once your coach has your payment.');
    });

    it('says a pause does not move the plan’s end', () => {
      const paused = read({ status: 'Paused' });
      expect(paused.pill).toEqual({ label: 'Paused', tone: 'warning' });
      expect(paused.note).toBe('Your coach has paused this plan. It still ends on Sun 27 Dec.');
    });

    it('says a block as the coach having paused their access', () => {
      const blocked = read({ status: 'Blocked' });
      expect(blocked.pill).toEqual({ label: 'Access paused', tone: 'warning' });
      expect(blocked.note).toBe('Your coach has paused your access.');
    });

    it('says the day a plan was cancelled, never a last day that may still be to come', () => {
      const cancelled = read({ status: 'Cancelled', cancelledOn: '2026-10-11' });
      expect(cancelled.pill).toEqual({ label: 'Cancelled Sun 11 Oct', tone: 'neutral' });
      expect(cancelled.note).toBeNull();
      expect(read({ status: 'Cancelled' }).pill.label).toBe('Cancelled');
    });

    it('sends only a plan that ran out on to Today, in the words of the notice', () => {
      const ended = read({ status: 'Expired', lastDay: '2026-10-10' });
      expect(ended.pill).toEqual({ label: 'Ended', tone: 'neutral' });
      expect(ended.note).toBe('If you’d like to keep going, ask your coach to renew it.');
      expect(ended.ended).toBe(true);
      expect(read({ status: 'Cancelled' }).ended).toBe(false);
      expect(read().ended).toBe(false);
    });
  });
});

describe('ownPlans', () => {
  it('reads each plan in the server’s order on the workspace’s today', () => {
    const plans = ownPlans(
      {
        today: '2026-12-26',
        plans: [plan(), plan({ id: 'plan-2', status: 'Upcoming', startDate: '2026-12-28' })],
      },
      'en-GB',
    );
    expect(plans.map((item) => [item.id, item.pill.label])).toEqual([
      ['plan-1', 'Ends tomorrow'],
      ['plan-2', 'Starts in 2 days'],
    ]);
  });
});
