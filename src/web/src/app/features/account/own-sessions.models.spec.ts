import { describe, expect, it } from 'vitest';
import type { OwnPlansView, OwnPlanView, OwnSessionsView } from '../../core/api/generated';
import { sessionsLine, todaySessions } from './own-sessions.models';

const TODAY = '2026-11-02';
const LOCALE = 'en-US';

const pack = (fields: Partial<OwnSessionsView> = {}): OwnSessionsView => ({
  count: 10,
  left: 7,
  used: 3,
  lapsed: 0,
  lapsedOn: null,
  sessions: [],
  ...fields,
});

function plan(fields: Partial<OwnPlanView> = {}): OwnPlanView {
  return {
    id: 'pack-1',
    name: 'Personal training',
    optionLabel: '10 sessions',
    description: null,
    startDate: '2026-10-11',
    lastDay: '2027-01-09',
    cancelledOn: null,
    status: 'Active',
    features: ['Sessions'],
    sessions: pack(),
    ...fields,
  };
}

const line = (fields: Partial<OwnPlanView> = {}, coach: string | null = 'Karim Haddad') =>
  sessionsLine(plan(fields), coach, TODAY, LOCALE);

const view = (...plans: OwnPlanView[]): OwnPlansView => ({
  today: TODAY,
  plans,
  coachName: 'Karim Haddad',
});

describe('a client’s sessions in a sentence (SES-007)', () => {
  it('says what is left, with whom and until when', () => {
    expect(line()).toBe('7 of 10 sessions with Karim left, until 9 January');
  });

  it('leaves the coach out when they have no name', () => {
    expect(line({}, null)).toBe('7 of 10 sessions left, until 9 January');
    expect(line({}, '   ')).toBe('7 of 10 sessions left, until 9 January');
  });

  it('counts a single session as one', () => {
    expect(line({ sessions: pack({ count: 1, left: 1, used: 0 }) })).toBe(
      '1 session with Karim left, until 9 January',
    );
    expect(line({ sessions: pack({ count: 1, left: 0, used: 1 }) })).toBe(
      'Your session with Karim is used',
    );
  });

  it('says when every session is used, with no date left to read', () => {
    expect(line({ sessions: pack({ left: 0, used: 10 }) })).toBe('All 10 sessions with Karim used');
  });

  it('names the year only of a date that could be taken for another', () => {
    expect(line({ lastDay: '2027-11-30' })).toBe(
      '7 of 10 sessions with Karim left, until 30 November 2027',
    );
  });

  it('reads the same on a pack still to come, paused or with access closed', () => {
    for (const status of ['Upcoming', 'Paused', 'Blocked'] as const) {
      expect(line({ status })).toBe('7 of 10 sessions with Karim left, until 9 January');
    }
  });

  it('says nothing of a pack waiting for payment, or of a coaching plan', () => {
    expect(line({ status: 'PendingPayment', sessions: pack({ left: 0, used: 0 }) })).toBeNull();
    expect(line({ sessions: null })).toBeNull();
  });

  it('says what became of a pack that is over', () => {
    const over = (fields: Partial<OwnSessionsView>, status: OwnPlanView['status'] = 'Expired') =>
      line({ status, sessions: pack({ left: 0, lapsedOn: '2026-10-30', ...fields }) });

    expect(over({ used: 7, left: 3, lapsed: 3 })).toBe(
      '7 of 10 sessions with Karim used, and 3 lapsed on 30 October',
    );
    expect(over({ used: 0, left: 10, lapsed: 10 }, 'Cancelled')).toBe(
      'All 10 sessions with Karim lapsed on 30 October',
    );
    expect(over({ used: 10, lapsedOn: null })).toBe('All 10 sessions with Karim used');
    expect(over({ count: 1, used: 0, left: 1, lapsed: 1 })).toBe(
      'Your session with Karim lapsed on 30 October',
    );
    expect(over({ count: 1, used: 1, lapsedOn: null })).toBe('Your session with Karim is used');
  });
});

describe('a client’s sessions on Today (SES-007)', () => {
  it('has nothing to say with no pack, or with every pack over', () => {
    expect(todaySessions(view(), LOCALE)).toBeNull();
    expect(todaySessions(view(plan({ sessions: null })), LOCALE)).toBeNull();
    expect(todaySessions(view(plan({ status: 'Expired' })), LOCALE)).toBeNull();
    expect(todaySessions(view(plan({ status: 'Cancelled' })), LOCALE)).toBeNull();
  });

  it('says the pack a session goes on next and counts the others, whatever the server’s order', () => {
    const later = plan({
      id: 'later',
      lastDay: '2027-03-01',
      sessions: pack({ left: 9, used: 1 }),
    });
    const first = plan({
      id: 'first',
      lastDay: '2026-12-20',
      sessions: pack({ left: 2, used: 8 }),
    });
    const usedUp = plan({
      id: 'used',
      lastDay: '2026-11-20',
      sessions: pack({ left: 0, used: 10 }),
    });

    expect(todaySessions(view(later, usedUp, first), LOCALE)).toEqual({
      line: '2 of 10 sessions with Karim left, until 20 December',
      more: '+2 more packs',
    });
    expect(todaySessions(view(later, first), LOCALE)?.more).toBe('+1 more pack');
  });

  it('says where a pack stands while it can take no session', () => {
    const say = (status: OwnPlanView['status'], fields: Partial<OwnSessionsView> = {}) =>
      todaySessions(view(plan({ status, sessions: pack(fields) })), LOCALE)?.line;

    expect(say('PendingPayment', { left: 0, used: 0 })).toBe('Waiting for payment');
    expect(say('Paused')).toBe('Paused · 7 of 10 sessions with Karim left, until 9 January');
    expect(say('Blocked')).toBe('Your coach has paused your access');
    expect(say('Upcoming')).toBe('7 of 10 sessions with Karim left, until 9 January');
  });

  it('says a pack is used up while it still runs', () => {
    expect(todaySessions(view(plan({ sessions: pack({ left: 0, used: 10 }) })), LOCALE)).toEqual({
      line: 'All 10 sessions with Karim used',
      more: null,
    });
  });
});
