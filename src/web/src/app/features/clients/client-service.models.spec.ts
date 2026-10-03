import { describe, expect, it } from 'vitest';
import {
  cancelledPlan,
  catalog,
  enrollment,
  SERVICE_TODAY,
  unpaidRenewal,
} from '../../../testing/client-service-fixtures';
import {
  defaultPlanStart,
  focusPlanId,
  money,
  offerChoices,
  otherPlans,
  planCard,
  planMenu,
  primaryAction,
  renewalAskedFor,
  renewalAskedLine,
  type ServiceContext,
} from './client-service.models';

const context: ServiceContext = { locale: 'en-US', today: SERVICE_TODAY, firstName: 'Maya' };
const labels = (items: ReturnType<typeof planMenu>) => items.map((item) => item.label);

describe('the plan in front', () => {
  it('tells a running plan by its days left, warm in the last two weeks', () => {
    const card = planCard(enrollment(), context);

    expect(card.eyebrow).toBe('Current plan');
    expect(card.pill).toEqual({ label: 'Ends in 11 days', tone: 'warm' });
    expect(card.facts.map((fact) => fact.text)).toEqual([
      'Tue 21 Jul – Mon 12 Oct',
      '12 weeks · USD 330',
      'Paid in full',
    ]);
    expect(card.includes).toEqual(['Training', 'Nutrition', 'Check-ins', 'Messaging']);
    expect(card.payments).toEqual([
      { id: 'pay-1', date: 'Mon 20 Jul 2026', amount: 'USD 330', detail: 'Cash', note: null },
    ]);
    expect(card).toMatchObject({ canPay: false, canPause: true, canCancel: true, over: false });

    const later = planCard(
      enrollment({ lastActiveDate: '2026-11-10', endDateExclusive: '2026-11-11' }),
      context,
    );
    expect(later.pill).toEqual({ label: 'Active · 40 days left', tone: 'success' });
    expect(planCard(enrollment({ lastActiveDate: '2026-10-02' }), context).pill.label).toBe(
      'Ends tomorrow',
    );
  });

  it('says what is still owed on a plan waiting for its payment, and that it can take one', () => {
    const card = planCard(unpaidRenewal(), context);

    expect(card.eyebrow).toBe('Starts Tue 13 Oct');
    expect(card.pill).toEqual({ label: 'Waiting for payment', tone: 'warm' });
    expect(card.facts).toContainEqual({ text: 'USD 150 of 330 paid', warm: true });
    expect(
      planCard(unpaidRenewal({ paidAmount: 0, balanceAmount: 330, payments: [] }), context)
        .paidText,
    ).toBe('Not paid yet');
    expect(card.paidPercent).toBe(45);
    expect(card.balance).toBe(180);
    expect(card.payments[0].detail).toBe('Mobile wallet · ref WH-2231');
    // Not paid, so it cannot be paused yet; it can still be cancelled.
    expect(card).toMatchObject({ canPay: true, canPause: false, canCancel: true });
  });

  it('keeps the reason of a cancelled plan, and nothing about it can change', () => {
    const card = planCard(cancelledPlan(), context);

    expect(card.eyebrow).toBe('Cancelled');
    expect(card.pill).toEqual({ label: 'Cancelled', tone: 'neutral' });
    expect(card.facts.map((fact) => fact.text)).toEqual([
      'Mon 1 Jun – Sun 28 Jun',
      '4 weeks · Free',
      'Reason: Moved to Online Coaching',
    ]);
    expect(card.paidText).toBe('Free');
    expect(card).toMatchObject({ over: true, cancelled: true, canCancel: false, canPause: false });
  });

  it('calls a plan past its last day ended, and a blocked or paused one by that', () => {
    expect(planCard(enrollment(), { ...context, today: '2026-10-13' }).eyebrow).toBe(
      'Ended Mon 12 Oct',
    );
    expect(planCard(enrollment({ effectiveStatus: 'Blocked' }), context).pill).toEqual({
      label: 'Access blocked',
      tone: 'danger',
    });
    const paused = planCard(
      enrollment({ storedStatus: 'Paused', effectiveStatus: 'Paused', statusReason: 'Injured' }),
      context,
    );
    expect(paused.pill.label).toBe('Paused');
    expect(paused.facts.at(-1)?.text).toBe('Reason: Injured');
    expect(paused).toMatchObject({ canResume: true, canPause: false });
  });

  it('writes money with its currency first, cents only when there are some', () => {
    expect(money(330, 'USD', 'en-US')).toBe('USD 330');
    expect(money(82.5, 'USD', 'en-US')).toBe('USD 82.50');
    expect(money(1500000, 'LBP', 'en-US')).toBe('LBP 1,500,000');
  });
});

describe('which plan, and the others', () => {
  const plans = [cancelledPlan(), enrollment(), unpaidRenewal()];

  it('opens on the plan running today, then the next one, never a cancelled one first', () => {
    expect(focusPlanId(plans, SERVICE_TODAY)).toBe('e-1');
    expect(focusPlanId([cancelledPlan(), unpaidRenewal()], SERVICE_TODAY)).toBe('e-2');
    expect(focusPlanId([], SERVICE_TODAY)).toBeNull();
  });

  it('lists the plans still to come soonest first, then the earlier ones', () => {
    const others = otherPlans(plans, 'e-1', context);

    expect(others.coming.map((row) => [row.name, row.range, row.summary, row.pill.label])).toEqual([
      [
        'Online Coaching',
        '13 Oct 2026 – 4 Jan 2027',
        '12 weeks · USD 150 of 330 paid',
        'Waiting for payment',
      ],
    ]);
    expect(others.earlier.map((row) => [row.name, row.summary, row.pill.label])).toEqual([
      ['Starter', '4 weeks · Free', 'Cancelled'],
    ]);
  });
});

describe('what needs the coach', () => {
  it('starts with a plan when there is none', () => {
    expect(primaryAction(null, [], context, false)).toEqual({ id: 'start', label: 'Start a plan' });
  });

  it('asks for the money first, then a paused plan', () => {
    const renewal = unpaidRenewal();
    expect(primaryAction(planCard(renewal, context), [renewal], context, false)?.id).toBe('pay');
    const paused = enrollment({ storedStatus: 'Paused', effectiveStatus: 'Paused' });
    expect(primaryAction(planCard(paused, context), [paused], context, false)?.id).toBe('resume');
  });

  it('offers a renewal near the end, unless one already follows', () => {
    const current = enrollment();
    expect(primaryAction(planCard(current, context), [current], context, false)).toEqual({
      id: 'renew',
      label: 'Renew plan',
    });
    expect(
      primaryAction(planCard(current, context), [current, unpaidRenewal()], context, false),
    ).toBeNull();
  });

  it('offers a renewal for a plan that ended with nothing after it, or one the client asked for', () => {
    const ended = { ...context, today: '2026-10-20' };
    const current = enrollment();
    expect(primaryAction(planCard(current, ended), [current], ended, false)?.id).toBe('renew');

    const early = enrollment({ lastActiveDate: '2026-12-01', endDateExclusive: '2026-12-02' });
    expect(primaryAction(planCard(early, context), [early], context, false)).toBeNull();
    expect(primaryAction(planCard(early, context), [early], context, true)?.id).toBe('renew');

    // A cancelled plan is not offered for renewal by itself.
    const cancelled = cancelledPlan();
    expect(primaryAction(planCard(cancelled, context), [cancelled], context, false)).toBeNull();
  });

  it('keeps everything else in Manage plan, saying why what is not possible is not', () => {
    const renewal = planCard(unpaidRenewal(), context);
    const items = planMenu(renewal, { id: 'pay', label: 'Record payment' }, true);

    expect(labels(items)).toEqual([
      'Renew plan',
      'Pause plan',
      'Cancel plan',
      'Start another plan',
    ]);
    expect(items[1]).toMatchObject({ disabled: true, hint: 'Possible once it is paid' });

    const current = planCard(enrollment(), context);
    expect(labels(planMenu(current, { id: 'renew', label: 'Renew plan' }, true))).toEqual([
      'Pause plan',
      'Cancel plan',
      'Start another plan',
    ]);
  });

  it('says when a plan cannot be renewed because none of its price options is on sale', () => {
    const items = planMenu(planCard(cancelledPlan(), context), null, false);

    expect(labels(items)).toEqual(['Renew plan', 'Start another plan']);
    expect(items[0]).toMatchObject({
      disabled: true,
      hint: 'None of this plan’s price options is offered now',
    });
  });

  it('resumes a paused plan instead of pausing it again', () => {
    const paused = planCard(
      enrollment({ storedStatus: 'Paused', effectiveStatus: 'Paused' }),
      context,
    );

    expect(labels(planMenu(paused, { id: 'resume', label: 'Resume plan' }, true))).toEqual([
      'Renew plan',
      'Cancel plan',
      'Start another plan',
    ]);
    expect(labels(planMenu(paused, null, true))).toContain('Resume plan');
  });
});

describe('price options', () => {
  it('offers only what is on sale, with its price and what it includes', () => {
    const choices = offerChoices(catalog(), 'en-US');

    expect(choices.map((choice) => [choice.label, choice.detail, choice.days])).toEqual([
      ['Online Coaching · 12 weeks', 'USD 330 · Training, Nutrition, Check-ins, Messaging', 84],
      ['Online Coaching · 4 weeks', 'USD 120 · Training, Nutrition, Check-ins, Messaging', 28],
      ['Recipe Pack · 30 days', 'Free · Nutrition', 30],
    ]);
    expect(choices[2].concurrent).toEqual(['Nutrition']);
    expect(offerChoices(catalog(), 'en-US', 'p-online').map((choice) => choice.offerId)).toEqual([
      'o-12',
      'o-4',
    ]);
    expect(offerChoices(null, 'en-US')).toEqual([]);
  });

  it('starts a renewal the day after the plan it follows, never before today', () => {
    expect(defaultPlanStart(SERVICE_TODAY, enrollment())).toBe('2026-10-13');
    expect(defaultPlanStart('2026-10-20', enrollment())).toBe('2026-10-20');
    expect(defaultPlanStart(SERVICE_TODAY, null)).toBe(SERVICE_TODAY);
  });

  it('ties a request to renew to the plan it names, or else to a plan that is over', () => {
    const current = planCard(enrollment(), context);
    const cancelled = planCard(cancelledPlan(), context);
    const request = { since: '2026-09-28T07:30:00Z', subjectId: 'e-0' };

    expect(renewalAskedFor(request, cancelled)).toBe(true);
    expect(renewalAskedFor(request, current)).toBe(false);
    expect(renewalAskedFor({ ...request, subjectId: null }, cancelled)).toBe(true);
    expect(renewalAskedFor({ ...request, subjectId: null }, current)).toBe(false);
    expect(renewalAskedFor(null, cancelled)).toBe(false);
  });

  it('says when the client asked to renew', () => {
    expect(renewalAskedLine('2026-09-28T07:30:00Z', 'Maya', 'en-US')).toBe(
      'Maya asked to renew on Mon 28 Sep',
    );
    expect(renewalAskedLine(null, 'Maya', 'en-US')).toBeNull();
  });
});
