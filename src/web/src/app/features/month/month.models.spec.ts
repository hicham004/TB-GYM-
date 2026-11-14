import { describe, expect, it } from 'vitest';
import {
  coachMonthReport,
  coachOwnMonthReport,
  emptyMonthReport,
  monthNumbers,
  ownerAloneWaitingMonthReport,
  waitingMonthReport,
} from '../../../testing/month-fixtures';
import { monthPage } from './month.models';

const page = (view = coachMonthReport()) => monthPage(view, 'en-US');

describe('monthPage', () => {
  it('names this month so far and the whole of the last', () => {
    const month = page();

    expect(month.soFar).toBe('October so far');
    expect(month.lastMonth).toBe('September');
  });

  it('keeps each currency on its own line beside last month, never adding them', () => {
    expect(page().money).toEqual([
      { currency: 'EUR', amount: 'EUR 0', payments: '', last: 'September: EUR 90.50' },
      {
        currency: 'LBP',
        amount: 'LBP 4,500,000',
        payments: '1 payment',
        last: 'Nothing in September',
      },
      {
        currency: 'USD',
        amount: 'USD 2,340',
        payments: '7 payments',
        last: 'September: USD 1,980',
      },
    ]);
  });

  it('says every count with last month’s beside it, with no change worked out', () => {
    expect(page().counts).toEqual([
      { key: 'sessions', label: '1-on-1 sessions held', value: '12', last: 'September: 9' },
      { key: 'plans', label: 'Coaching plans sold', value: '3', last: 'September: 2' },
      { key: 'packs', label: 'Session packs sold', value: '2', last: 'September: 1' },
      { key: 'started', label: 'Clients started', value: '2', last: 'September: 1' },
      { key: 'ended', label: 'Clients ended', value: '1', last: 'September: 0' },
    ]);
  });

  it('says whose numbers they are', () => {
    expect(page().whose).toBe('Your coaching space');
    expect(page(coachOwnMonthReport()).whose).toBe('Your numbers');
  });

  it('gives the owner each coach, themselves as You and who left the team marked', () => {
    const coaches = page().coaches!;

    expect(coaches.map((row) => [row.name, row.initials, row.hasLeftTheTeam])).toEqual([
      ['You', 'KH', false],
      ['Lea Khoury', 'LK', false],
      ['Omar Saleh', 'OS', false],
      ['Hadi Nasr', 'HN', true],
    ]);
    expect(coaches[1].thisMonth).toEqual({
      money: ['LBP 4,500,000', 'USD 1,440'],
      sessions: '8',
      plans: '2',
      packs: '1',
      started: '1',
      ended: '1',
    });
    expect(coaches[2].thisMonth.money).toEqual([]);
    expect(coaches[3].lastMonth.money).toEqual(['EUR 90.50', 'USD 280']);
  });

  it('gives a coach no rows, and an owner alone none either', () => {
    expect(page(coachOwnMonthReport()).coaches).toBeNull();
    expect(page(coachOwnMonthReport()).noCoach).toBeNull();
    const alone = coachMonthReport();
    expect(page({ ...alone, coaches: alone.coaches!.slice(0, 1) }).coaches).toBeNull();
    expect(page({ ...alone, coaches: alone.coaches!.slice(0, 1) }).noCoach).toBeNull();
  });

  it('gives the owner a No coach line for what counted while clients waited (N9d1b)', () => {
    const month = page(waitingMonthReport());

    expect(month.noCoach).toEqual({
      thisMonth: {
        money: ['USD 300'],
        sessions: '0',
        plans: '1',
        packs: '0',
        started: '0',
        ended: '0',
      },
      lastMonth: {
        money: ['USD 280'],
        sessions: '0',
        plans: '0',
        packs: '0',
        started: '0',
        ended: '0',
      },
    });
    // The line stands apart from the coaches' rows: nobody is its coach.
    expect(month.coaches!.map((row) => row.name)).toEqual([
      'You',
      'Lea Khoury',
      'Omar Saleh',
      'Hadi Nasr',
    ]);
  });

  it('shows an owner alone their row beside the No coach line, so the two add up to the total', () => {
    const month = page(ownerAloneWaitingMonthReport());

    expect(month.coaches!.map((row) => row.name)).toEqual(['You']);
    expect(month.noCoach!.thisMonth.money).toEqual(['USD 300']);
    expect(month.total.thisMonth.money).toEqual(['USD 1,200']);
    expect(month.coaches![0].thisMonth.money).toEqual(['USD 900']);
  });

  it('leaves a No coach line out of a coach’s own page, even if one were sent', () => {
    const own = coachOwnMonthReport();
    const month = page({ ...own, noCoach: waitingMonthReport().noCoach });

    expect(month.coaches).toBeNull();
    expect(month.noCoach).toBeNull();
  });

  it('keeps the total the server sent, the same as the top of the page', () => {
    expect(page().total.thisMonth).toEqual({
      money: ['LBP 4,500,000', 'USD 2,340'],
      sessions: '12',
      plans: '3',
      packs: '2',
      started: '2',
      ended: '1',
    });
    expect(page().total.lastMonth.money).toEqual(['EUR 90.50', 'USD 1,980']);
  });

  it('is empty only with nothing to count in either month', () => {
    expect(page().empty).toBe(false);
    expect(page(emptyMonthReport()).empty).toBe(true);
    const ended = coachMonthReport({
      thisMonth: monthNumbers({ clientsEnded: 1 }),
      lastMonth: monthNumbers(),
    });
    expect(page(ended).empty).toBe(false);
    const lastOnly = coachMonthReport({
      thisMonth: monthNumbers(),
      lastMonth: monthNumbers({
        moneyReceived: [{ currency: 'USD', amount: '10.00', paymentCount: 1 }],
      }),
    });
    expect(page(lastOnly).empty).toBe(false);
  });

  it('reads January’s last month as December', () => {
    const month = page(
      coachMonthReport({ thisMonthFrom: '2027-01-01', lastMonthFrom: '2026-12-01' }),
    );

    expect(month.soFar).toBe('January so far');
    expect(month.lastMonth).toBe('December');
  });

  it('never calls money profit or earnings, and adds no percent', () => {
    const words = JSON.stringify(page());

    expect(words).not.toMatch(/profit|earned|earning|%/i);
  });
});
