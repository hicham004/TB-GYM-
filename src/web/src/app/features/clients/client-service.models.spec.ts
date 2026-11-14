import { describe, expect, it } from 'vitest';
import type { FeatureAccessDecision } from '../../core/api/api.models';
import {
  cancelledPlan,
  catalog,
  catalogWithPacks,
  enrollment,
  houseProPlan,
  payment,
  SERVICE_TODAY,
  sessionPack,
  unpaidPack,
  unpaidRenewal,
} from '../../../testing/client-service-fixtures';
import { houseMaxPlan } from '../../../testing/max-staff-fixtures';
import {
  accessSummary,
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
  renewalOfferId,
  sessionHolders,
  sessionPackRows,
  sessionTarget,
  type ServiceContext,
} from './client-service.models';

// The server flags Maya's plan ending soon, its last day 11 days on (CLI-018).
const context: ServiceContext = {
  locale: 'en-US',
  today: SERVICE_TODAY,
  firstName: 'Maya',
  ending: { lastDay: '2026-10-12', renewId: 'e-1' },
};
const labels = (items: ReturnType<typeof planMenu>) => items.map((item) => item.label);

describe('the plan in front', () => {
  it('tells a running plan by its days left, warm while the server flags it ending soon', () => {
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
    expect(card.paymentContext).toBe('Online Coaching · Tue 21 Jul – Mon 12 Oct');
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
    expect(card.paymentContext).toBe('Online Coaching · 13 Oct 2026 – 4 Jan 2027');
    // Not paid, so it cannot be paused yet; it can still be cancelled.
    expect(card).toMatchObject({ canPay: true, canPause: false, canCancel: true });
  });

  it('keeps the reason of a cancelled plan, and nothing about it can change', () => {
    const card = planCard(cancelledPlan(), context);

    // The day it was cancelled, never its last day (COACH-20).
    expect(card.eyebrow).toBe('Cancelled Sun 14 Jun');
    expect(planCard(cancelledPlan({ cancelledOn: null }), context).eyebrow).toBe('Cancelled');
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

describe('the server’s ending-soon flag (critique B4a)', () => {
  it('decides the warm pill and the renewal, never a count of the page’s own', () => {
    const unflagged = { ...context, ending: null };
    const current = enrollment();

    // 11 days left but not flagged (say a renewal is paid): no warm pill, no renewal asked for.
    expect(planCard(current, unflagged).pill).toEqual({
      label: 'Active · 11 days left',
      tone: 'success',
    });
    expect(primaryAction(planCard(current, unflagged), [current], unflagged, false)).toBeNull();
    expect(planCard(current, context).pill).toEqual({ label: 'Ends in 11 days', tone: 'warm' });
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

  it('never offers to renew Max, which is booked from the trainee’s ask alone (N9c5a)', () => {
    const hint = 'Max is booked from the trainee’s ask, so its places are kept.';
    // Ending soon, over with nothing after it, or asked for: never the filled Renew plan.
    const ending = houseMaxPlan({ lastActiveDate: '2026-10-12', endDateExclusive: '2026-10-13' });
    expect(planCard(ending, context).tier).toBe('Max');
    expect(primaryAction(planCard(ending, context), [ending], context, false)).toBeNull();
    expect(primaryAction(planCard(ending, context), [ending], context, true)).toBeNull();
    const over = { ...context, today: '2026-11-02' };
    expect(primaryAction(planCard(ending, over), [ending], over, false)).toBeNull();

    // In Manage plan it stays, closed, with the server's reason, whether or not its option is on sale.
    for (const renewable of [true, false]) {
      const items = planMenu(planCard(ending, context), null, renewable);
      expect(items.find((item) => item.label === 'Renew plan')).toEqual({
        label: 'Renew plan',
        hint,
        action: 'renew',
        disabled: true,
      });
    }
    // Any other plan of the house's, and a coach's own, renews as before.
    expect(planCard(enrollment(), context).tier).toBeNull();
    const pro = houseProPlan({ lastActiveDate: '2026-10-12', endDateExclusive: '2026-10-13' });
    expect(primaryAction(planCard(pro, context), [pro], context, false)?.id).toBe('renew');
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

  it('renews on the option that replaced a plan’s old price, however many times it changed (COACH-3)', () => {
    const changed = catalog();
    const online = changed.products[0];
    online.offers = [
      { ...online.offers[0], id: 'o-130', isActive: false, replacedByOfferId: 'o-150' },
      { ...online.offers[0], id: 'o-150', isActive: false, replacedByOfferId: 'o-170' },
      { ...online.offers[0], id: 'o-170', isActive: true, replacedByOfferId: null },
    ];

    expect(renewalOfferId(changed, 'p-online', 'o-130')).toBe('o-170');
    expect(renewalOfferId(changed, 'p-online', 'o-170')).toBe('o-170');
    // An option stopped without a replacement has nothing to renew on.
    expect(renewalOfferId(catalog(), 'p-online', 'o-old')).toBeNull();
    expect(renewalOfferId(null, 'p-online', 'o-12')).toBeNull();
  });

  it('dates each payment by the workspace day the server sends, whatever the reader’s zone (WEA-6)', () => {
    const late = enrollment({
      payments: [
        payment({ id: 'pay-1', receivedAtUtc: '2026-07-19T22:30:00Z', receivedOn: '2026-07-20' }),
      ],
    });

    expect(planCard(late, context).payments[0].date).toBe('Mon 20 Jul 2026');
  });
});

describe('what the client can use (BILL-5, LOST-13)', () => {
  const decision = (
    feature: FeatureAccessDecision['feature'],
    reason: FeatureAccessDecision['reason'],
    from: string | null = null,
    until: string | null = null,
  ): FeatureAccessDecision => ({
    feature,
    isAllowed: reason === 'Granted',
    reason,
    enrollmentId: null,
    accessibleFrom: from,
    accessibleUntilExclusive: until,
  });

  it('says everything only when everything in the plans is open', () => {
    const summary = accessSummary(
      [
        decision('Training', 'Granted', '2026-07-21', '2026-10-13'),
        decision('Messaging', 'Granted', '2026-07-21', '2026-10-13'),
        decision('Nutrition', 'NoEntitlement'),
      ],
      'Maya',
      false,
      'en-US',
    );

    expect(summary.line).toBe('Maya can use everything their plan includes.');
    expect(summary.rows.map((row) => `${row.label}: ${row.state}`)).toEqual([
      'Training: Open until Mon 12 Oct',
      'Nutrition: Not in the plan',
      'Messaging: Open until Mon 12 Oct',
    ]);
    expect(summary.rows.map((row) => row.open)).toEqual([true, false, true]);
  });

  it('names what is open while an add-on waits for its payment', () => {
    const summary = accessSummary(
      [
        decision('Training', 'Granted', '2026-07-21', '2026-10-13'),
        decision('CheckIns', 'Granted', '2026-07-21', '2026-10-13'),
        decision('Nutrition', 'PaymentRequired', '2026-10-01', '2026-11-01'),
      ],
      'Maya',
      false,
      'en-US',
    );

    expect(summary.line).toBe(
      'Maya can use Training and Check-ins now. The rest of their plans is closed for now; why is below.',
    );
    expect(summary.rows[1].state).toBe('Waiting for payment');
  });

  it('never says everything for an unpaid, ended, cancelled, paused, coming or absent plan', () => {
    const line = (...decisions: FeatureAccessDecision[]) =>
      accessSummary(decisions, 'Maya', false, 'en-US').line;

    expect(line(decision('Training', 'PaymentRequired'))).toBe(
      'Maya can’t use anything until their plan is paid.',
    );
    expect(line(decision('Training', 'Expired', '2026-07-01', '2026-09-30'))).toBe(
      'Maya’s plan has ended, so they can’t use anything until it is renewed.',
    );
    expect(line(decision('Training', 'Cancelled'))).toBe(
      'Maya’s plan was cancelled, so they can’t use anything until you start a new one.',
    );
    expect(line(decision('Training', 'Paused'))).toBe(
      'Maya’s plan is paused, so they can’t use anything until you resume it.',
    );
    expect(line(decision('Training', 'NotStarted', '2026-10-13', '2027-01-05'))).toBe(
      'Maya can use their plan from Tue 13 Oct.',
    );
    expect(
      line(decision('Training', 'NoEntitlement'), decision('Nutrition', 'NoEntitlement')),
    ).toBe('Maya has no plan yet, so they can’t use anything until you start one.');
    // The reason the coach can act on first: a pause before a payment, a payment before an end.
    expect(line(decision('Training', 'Expired'), decision('Nutrition', 'PaymentRequired'))).toBe(
      'Maya can’t use anything until their plan is paid.',
    );
    expect(
      accessSummary(
        [decision('Training', 'Expired', '2026-07-01', '2026-09-30')],
        'Maya',
        false,
        'en-US',
      ).rows[0].state,
    ).toBe('Plan ended Tue 29 Sep');
  });

  it('says a blocked client can use nothing, without the rows', () => {
    const summary = accessSummary(
      [decision('Training', 'RelationshipBlocked')],
      'Maya',
      true,
      'en-US',
    );

    expect(summary.line).toBe(
      'Maya is blocked in your coaching space. They can’t use anything their plans include until you unblock them.',
    );
    expect(summary.rows).toEqual([]);
  });
});

describe('1-on-1 sessions (critique B10b)', () => {
  const rows = (plans = [sessionPack()], canChange = true) =>
    sessionPackRows(plans, context, canChange);

  it('keeps a pack out of Other plans, whatever it holds: it has a section of its own', () => {
    const others = otherPlans(
      [sessionPack(), enrollment(), unpaidPack(), cancelledPlan()],
      'e-1',
      context,
    );
    expect(others.coming).toEqual([]);
    expect(others.earlier.map((row) => row.id)).toEqual(['e-0']);
  });

  it('gives a pack what Manage plan offers, but for starting another', () => {
    const labels = (plan = sessionPack(), renewable = true) =>
      sessionPackRows([plan], context, true, () => renewable)[0].menu.map((item) => item.label);
    expect(labels()).toEqual(['Renew plan', 'Pause plan', 'Cancel plan']);
    expect(labels(unpaidPack())).toEqual([
      'Record payment',
      'Renew plan',
      'Pause plan',
      'Cancel plan',
    ]);
    expect(sessionPackRows([sessionPack()], context, true, () => false)[0].menu[0]).toEqual(
      expect.objectContaining({ label: 'Renew plan', disabled: true }),
    );
    expect(rows([sessionPack()], false)[0].menu).toEqual([]);
  });

  it('does not count a pack sold today as the plan that follows an ended one', () => {
    const ended = enrollment({
      startDate: '2026-06-01',
      endDateExclusive: '2026-09-01',
      lastActiveDate: '2026-08-31',
      effectiveStatus: 'Expired',
    });
    const pack = sessionPack({ startDate: SERVICE_TODAY });
    const card = planCard(ended, context);
    expect(primaryAction(card, [ended, pack], context, false)?.id).toBe('renew');
    expect(planCard(pack, context).isPack).toBe(true);
    expect(card.isPack).toBe(false);
  });

  it('opens on the coaching plan that ran out, with Renew plan, while a pack runs (SES-010)', () => {
    const ended = enrollment({
      id: 'ended',
      startDate: '2026-06-01',
      endDateExclusive: '2026-09-01',
      lastActiveDate: '2026-08-31',
      effectiveStatus: 'Expired',
    });
    const plans = [sessionPack(), ended];
    expect(focusPlanId(plans, SERVICE_TODAY)).toBe('ended');

    const card = planCard(ended, context);
    expect(card.pill.label).toBe('Ended');
    expect(primaryAction(card, plans, context, false)).toEqual({
      id: 'renew',
      label: 'Renew plan',
    });

    // The request is about that plan, so the page says so, and the pack's own row keeps its menu.
    const request = { since: '2026-09-28T08:00:00Z', subjectId: 'ended' };
    expect(renewalAskedFor(request, card)).toBe(true);
    expect(rows(plans).map((row) => row.name)).toEqual(['Personal training · 10 sessions']);
  });

  it('reads a running pack as the coach counts it', () => {
    const [pack] = rows();
    expect(pack.name).toBe('Personal training · 10 sessions');
    expect(pack.line).toBe('7 of 10 left · until 29 Nov · last held Tue 29 Sep');
    expect(pack.pill.label).toBe('Active · 59 days left');
    expect(pack.over).toBe(false);
  });

  it('says nothing of a last session before there is one, and the dates of a pack to come', () => {
    expect(rows([sessionPack({}, { left: 10, held: 0, lastHeldOn: null })])[0].line).toBe(
      '10 of 10 left · until 29 Nov',
    );
    expect(
      rows([
        sessionPack(
          { startDate: '2026-10-05', effectiveStatus: 'Upcoming' },
          { left: 10, lastHeldOn: null },
        ),
      ])[0].line,
    ).toBe('10 of 10 left · from 5 Oct until 29 Nov');
    expect(rows([unpaidPack()])[0].line).toBe('1 session · until 30 Oct');
    expect(rows([unpaidPack()])[0].pill.label).toBe('Waiting for payment');
  });

  it('keeps the ledger as words, a row undone struck and only what stands undoable', () => {
    expect(rows()[0].history).toEqual([
      expect.objectContaining({
        day: 'Wed 30 Sep',
        what: 'Undid the session of Wed 30 Sep',
        detail: null,
        canUndo: false,
      }),
      expect.objectContaining({ what: 'Held', undone: true, canUndo: false }),
      expect.objectContaining({ what: 'Held', detail: 'Lea Khoury · Legs', canUndo: true }),
      expect.objectContaining({
        day: 'Tue 22 Sep',
        what: 'Charged · No-show',
        detail: 'Lea Khoury',
        canUndo: true,
      }),
      expect.objectContaining({ what: 'Held', detail: 'Lea Khoury', canUndo: true }),
      expect.objectContaining({ what: '10 sessions added', detail: null, canUndo: false }),
    ]);
  });

  it('says who held a session and who recorded it, only when they differ', () => {
    const entry = sessionPack().sessions!.entries.find((item) => item.id === 's-2')!;
    const history = (recordedByName: string | null, note: string | null) =>
      rows([sessionPack({}, { entries: [{ ...entry, recordedByName, note }] })])[0].history[0]
        .detail;

    expect(history('Karim Haddad', null)).toBe('Held by Lea Khoury · recorded by Karim Haddad');
    expect(history('Karim Haddad', 'Legs')).toBe(
      'Held by Lea Khoury · recorded by Karim Haddad · Legs',
    );
    expect(history(null, 'Legs')).toBe('Lea Khoury · Legs');
    expect(history(null, null)).toBe('Lea Khoury');
  });

  it('changes nothing on a former client’s record', () => {
    expect(rows([sessionPack()], false)[0].history.some((line) => line.canUndo)).toBe(false);
  });

  it('says what became of a pack that is over, with what lapsed on top of its ledger', () => {
    const ended = sessionPack(
      {
        startDate: '2026-06-01',
        endDateExclusive: '2026-08-30',
        lastActiveDate: '2026-08-29',
        effectiveStatus: 'Expired',
      },
      { left: 3, held: 6, charged: 1, lapsed: 3, lapsedOn: '2026-08-29' },
    );
    const [pack] = rows([ended]);
    expect(pack.over).toBe(true);
    expect(pack.line).toBe('6 held · 1 charged · 3 lapsed');
    expect(pack.pill.label).toBe('Ended');
    expect(pack.history[0]).toEqual(
      expect.objectContaining({ day: 'Sat 29 Aug', what: '3 sessions lapsed', canUndo: false }),
    );
  });

  it('lists what runs first, ending first, then what is over, newest first', () => {
    const later = sessionPack({ id: 'later', endDateExclusive: '2026-12-30' });
    const sooner = sessionPack({ id: 'sooner', endDateExclusive: '2026-10-20' });
    const old = sessionPack({ id: 'old', endDateExclusive: '2026-05-01', startDate: '2026-02-01' });
    const older = sessionPack({
      id: 'older',
      endDateExclusive: '2026-01-01',
      startDate: '2025-10-01',
    });
    const plan = enrollment();
    expect(rows([older, later, plan, old, sooner]).map((row) => row.id)).toEqual([
      'sooner',
      'later',
      'old',
      'older',
    ]);
  });

  it('tells the sheet the pack ending first with a session left that day', () => {
    const later = sessionPack({ id: 'later', productName: 'Later pack' });
    const sooner = sessionPack(
      {
        id: 'sooner',
        productName: 'Sooner pack',
        endDateExclusive: '2026-10-20',
        lastActiveDate: '2026-10-19',
      },
      { left: 2 },
    );
    expect(sessionTarget([later, sooner], SERVICE_TODAY, 'en-US')).toEqual({
      line: 'Goes on Sooner pack: 2 of 10 left, until Mon 19 Oct.',
      receipt: null,
    });

    const empty = sessionPack(
      { id: 'sooner', productName: 'Sooner pack', endDateExclusive: '2026-10-20' },
      { left: 0 },
    );
    expect(sessionTarget([later, empty], SERVICE_TODAY, 'en-US')?.line).toContain('Later pack');
  });

  it('offers the money when the only pack that day waits for it, and is silent past every pack', () => {
    expect(sessionTarget([unpaidPack()], SERVICE_TODAY, 'en-US')).toEqual({
      line: 'Personal training is waiting for USD 35. Saving this records that payment too, received on the day of the session, and the session goes on it.',
      receipt: { amount: 35, currency: 'USD' },
    });
    expect(sessionTarget([unpaidPack()], '2026-09-30', 'en-US')).toBeNull();
    expect(sessionTarget([enrollment()], SERVICE_TODAY, 'en-US')).toBeNull();

    // A pack paused, used up or cancelled is the server's to refuse in words.
    expect(
      sessionTarget([sessionPack({ storedStatus: 'Paused' })], SERVICE_TODAY, 'en-US'),
    ).toBeNull();
    expect(sessionTarget([sessionPack({}, { left: 0 })], SERVICE_TODAY, 'en-US')).toBeNull();
    expect(
      sessionTarget([sessionPack({ storedStatus: 'Cancelled' })], SERVICE_TODAY, 'en-US'),
    ).toBeNull();
  });

  it('sells a pack by its count and how long it runs, with concurrency the server’s word', () => {
    const packs = offerChoices(catalogWithPacks(), 'en-US').filter(
      (item) => item.sessions !== null,
    );
    expect(packs.map((item) => [item.label, item.detail, item.days, item.sessions])).toEqual([
      ['Personal training · 10 sessions', 'USD 300 · 10 sessions · to use within 90 days', 90, 10],
      ['Personal training · Single session', 'USD 35 · 1 session · to use within 30 days', 30, 1],
    ]);
    expect(packs[0].concurrent).toEqual(['Sessions']);
    expect(offerChoices(catalog(), 'en-US').every((item) => item.sessions === null)).toBe(true);
  });

  it('lists sessions under Access for a client with a pack, and only then', () => {
    const granted = {
      feature: 'Training',
      isAllowed: true,
      reason: 'Granted',
      enrollmentId: 'e-1',
      accessibleFrom: '2026-07-21',
      accessibleUntilExclusive: '2026-10-13',
    } as FeatureAccessDecision;
    const none = {
      feature: 'Sessions',
      isAllowed: false,
      reason: 'NoEntitlement',
      enrollmentId: null,
      accessibleFrom: null,
      accessibleUntilExclusive: null,
    } as FeatureAccessDecision;
    expect(
      accessSummary([granted, none], 'Maya', false, 'en-US').rows.map((row) => row.label),
    ).toEqual(['Training']);

    const open = { ...granted, feature: 'Sessions', accessibleUntilExclusive: '2026-11-30' };
    const summary = accessSummary([open as FeatureAccessDecision], 'Maya', false, 'en-US');
    expect(summary.rows).toEqual([
      expect.objectContaining({ label: '1-on-1 sessions', state: 'Open until Sun 29 Nov' }),
    ]);
    expect(summary.line).toBe('Maya can use everything their plan includes.');
  });
});

describe('who the owner can say held a session', () => {
  const lea = { userId: 'lea', displayName: 'Lea Khoury' };
  const owner = { userId: 'owner', displayName: 'Karim Haddad' };
  const omar = { userId: 'omar', displayName: 'Omar Saleh' };

  it('puts the client’s coach first, then the rest of the team, each once, and you as You', () => {
    expect(sessionHolders(lea, [owner, lea, omar], 'owner')).toEqual([
      { value: 'lea', label: 'Lea Khoury' },
      { value: 'owner', label: 'You' },
      { value: 'omar', label: 'Omar Saleh' },
    ]);
  });

  it('leaves out a choice with nobody else to name', () => {
    expect(sessionHolders(owner, [owner], 'owner')).toEqual([]);
  });

  it('still tells the client’s coach and the owner apart without the rest of the team', () => {
    expect(sessionHolders(lea, [owner], 'owner')).toEqual([
      { value: 'lea', label: 'Lea Khoury' },
      { value: 'owner', label: 'You' },
    ]);
  });

  /** N9d1b: a client whose coach left has nobody to put first; nobody is left blank. */
  it('offers the team for a client waiting for a coach, You first, and nothing to an owner alone', () => {
    expect(sessionHolders(null, [lea, owner, omar], 'owner')).toEqual([
      { value: 'owner', label: 'You' },
      { value: 'lea', label: 'Lea Khoury' },
      { value: 'omar', label: 'Omar Saleh' },
    ]);
    expect(sessionHolders(null, [owner], 'owner')).toEqual([]);
    expect(sessionHolders(null, [], 'owner')).toEqual([]);
  });
});
