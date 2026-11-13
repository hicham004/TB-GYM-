import { describe, expect, it } from 'vitest';
import type { OwnFreePlanView, OwnPlanView } from '../../core/api/generated';
import { freePlan, ownPlan, ownPlans } from './client-plan.models';

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

  it('names a pack’s sessions among what’s included, whatever else it holds', () => {
    expect(read({ features: ['Sessions'] }).includes.map((chip) => chip.label)).toEqual([
      '1-on-1 sessions',
    ]);
    expect(read({ features: ['Sessions', 'Training'] }).includes.map((chip) => chip.label)).toEqual(
      ['Training', '1-on-1 sessions'],
    );
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

describe('a self-directed trainee of the house (notes plan N9c2)', () => {
  const FREE: OwnFreePlanView = {
    name: 'Free',
    since: '2026-10-01',
    status: 'Active',
    features: ['Training'],
  };

  const asTrainee = (overrides: Partial<OwnPlanView> = {}) =>
    ownPlan(plan(overrides), TODAY, 'en-GB', null, true);

  it('names TB Gym where a coach would stand, and leaves them on Free when a plan runs out', () => {
    expect(asTrainee({ status: 'PendingPayment' }).note).toBe(
      'It starts once TB Gym has your payment.',
    );
    expect(asTrainee({ status: 'Paused' }).note).toBe(
      'TB Gym has paused this plan. It still ends on Sun 27 Dec.',
    );
    expect(asTrainee({ status: 'Blocked' }).note).toBe('TB Gym has paused your access.');
    const ended = asTrainee({ status: 'Expired', lastDay: '2026-10-10' });
    expect(ended.pill).toEqual({ label: 'Ended', tone: 'neutral' });
    expect(ended.note).toBe('You’re back on Free. Everything you logged stays yours.');
    expect(asTrainee().pill).toEqual(read().pill);
  });

  it('reads the plans as a trainee’s only when the server gives Free', () => {
    const view = { today: TODAY, plans: [plan({ status: 'Blocked' })], coachName: null };
    expect(ownPlans(view, 'en-GB')[0].note).toBe('Your coach has paused your access.');
    expect(ownPlans({ ...view, free: null }, 'en-GB')[0].note).toBe(
      'Your coach has paused your access.',
    );
    expect(ownPlans({ ...view, free: FREE }, 'en-GB')[0].note).toBe(
      'TB Gym has paused your access.',
    );
  });

  it('draws Free with the day it began and no end date', () => {
    expect(freePlan(FREE, TODAY, 'en-GB')).toEqual({
      name: 'Free',
      since: 'Since Thu 1 Oct',
      pill: { label: 'No end date', tone: 'success' },
      notes: ['It never ends, and it keeps running beside any plan you add.'],
      includes: [{ feature: 'Training', label: 'Training', icon: 'training' }],
    });
    expect(freePlan({ ...FREE, since: '2025-11-30' }, TODAY, 'en-GB').since).toBe(
      'Since 30 Nov 2025',
    );
  });

  it('says TB Gym paused Free’s access, and otherwise takes a plan’s own pill', () => {
    const blocked = freePlan({ ...FREE, status: 'Blocked' }, TODAY, 'en-GB');
    expect(blocked.pill).toEqual({ label: 'Access paused', tone: 'warning' });
    expect(blocked.notes).toEqual([
      'TB Gym has paused your access.',
      'It never ends, and it keeps running beside any plan you add.',
    ]);
    const waiting = freePlan({ ...FREE, status: 'PendingPayment' }, TODAY, 'en-GB');
    expect(waiting.pill).toEqual({ label: 'Waiting for payment', tone: 'warm' });
    expect(JSON.stringify(freePlan({ ...FREE, status: 'Expired' }, TODAY, 'en-GB'))).not.toMatch(
      /days left|Ends /,
    );
  });
});
