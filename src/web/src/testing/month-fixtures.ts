import type {
  CoachMonthNumbersView,
  CoachMonthReportView,
  CoachMonthRowView,
} from '../app/core/api/generated';
import { LEA_ID, OMAR_ID, OWNER_ID } from './coach-today-fixtures';

/**
 * The This month page for Atlas Performance on 20 October 2026, beside September: Karim owns it, Lea
 * and Omar coach, and Hadi left the team with a number in September.
 */
export function monthNumbers(
  overrides: Partial<CoachMonthNumbersView> = {},
): CoachMonthNumbersView {
  return {
    moneyReceived: [],
    sessionsHeld: 0,
    plansSold: 0,
    packsSold: 0,
    clientsStarted: 0,
    clientsEnded: 0,
    ...overrides,
  };
}

function coachRow(
  coachUserId: string,
  name: string,
  thisMonth: CoachMonthNumbersView,
  lastMonth: CoachMonthNumbersView,
  flags: Partial<Pick<CoachMonthRowView, 'isYou' | 'hasLeftTheTeam'>> = {},
): CoachMonthRowView {
  return { coachUserId, name, isYou: false, hasLeftTheTeam: false, thisMonth, lastMonth, ...flags };
}

export function coachMonthReport(
  overrides: Partial<CoachMonthReportView> = {},
): CoachMonthReportView {
  return {
    today: '2026-10-20',
    thisMonthFrom: '2026-10-01',
    lastMonthFrom: '2026-09-01',
    thisMonth: monthNumbers({
      moneyReceived: [
        { currency: 'LBP', amount: '4500000.00', paymentCount: 1 },
        { currency: 'USD', amount: '2340.00', paymentCount: 7 },
      ],
      sessionsHeld: 12,
      plansSold: 3,
      packsSold: 2,
      clientsStarted: 2,
      clientsEnded: 1,
    }),
    lastMonth: monthNumbers({
      moneyReceived: [
        { currency: 'EUR', amount: '90.50', paymentCount: 1 },
        { currency: 'USD', amount: '1980.00', paymentCount: 5 },
      ],
      sessionsHeld: 9,
      plansSold: 2,
      packsSold: 1,
      clientsStarted: 1,
      clientsEnded: 0,
    }),
    coaches: [
      coachRow(
        OWNER_ID,
        'Karim Haddad',
        monthNumbers({
          moneyReceived: [{ currency: 'USD', amount: '900.00', paymentCount: 3 }],
          sessionsHeld: 4,
          plansSold: 1,
          packsSold: 1,
          clientsStarted: 1,
        }),
        monthNumbers({
          moneyReceived: [{ currency: 'USD', amount: '700.00', paymentCount: 2 }],
          sessionsHeld: 3,
          plansSold: 1,
        }),
        { isYou: true },
      ),
      coachRow(
        LEA_ID,
        'Lea Khoury',
        monthNumbers({
          moneyReceived: [
            { currency: 'LBP', amount: '4500000.00', paymentCount: 1 },
            { currency: 'USD', amount: '1440.00', paymentCount: 4 },
          ],
          sessionsHeld: 8,
          plansSold: 2,
          packsSold: 1,
          clientsStarted: 1,
          clientsEnded: 1,
        }),
        monthNumbers({
          moneyReceived: [{ currency: 'USD', amount: '1000.00', paymentCount: 2 }],
          sessionsHeld: 6,
          plansSold: 1,
          packsSold: 1,
          clientsStarted: 1,
        }),
      ),
      coachRow(OMAR_ID, 'Omar Saleh', monthNumbers(), monthNumbers()),
      coachRow(
        '00000000-0000-4000-8000-0000000000a4',
        'Hadi Nasr',
        monthNumbers(),
        monthNumbers({
          moneyReceived: [
            { currency: 'EUR', amount: '90.50', paymentCount: 1 },
            { currency: 'USD', amount: '280.00', paymentCount: 1 },
          ],
        }),
        { hasLeftTheTeam: true },
      ),
    ],
    monthRuleKey: 'MonthNumbers',
    monthRuleVersion: 1,
    moneyRuleKey: 'MoneyReceived',
    moneyRuleVersion: 1,
    ...overrides,
  };
}

/** Lea's page: her own numbers, and no one else's. */
export function coachOwnMonthReport(): CoachMonthReportView {
  const whole = coachMonthReport();
  const lea = whole.coaches![1];
  return { ...whole, thisMonth: lea.thisMonth, lastMonth: lea.lastMonth, coaches: null };
}

/**
 * The same month with clients who waited for a coach (N9d1b, MonthNumbers v3): a plan sold and a
 * payment in October and a payment in September counted on the No coach line, taken from Lea's and
 * Hadi's rows, so the rows plus the No coach line still add up to the same totals. A session never
 * counts for nobody.
 */
export function waitingMonthReport(): CoachMonthReportView {
  const whole = coachMonthReport();
  const [karim, lea, omar, hadi] = whole.coaches!;
  return {
    ...whole,
    coaches: [
      karim,
      {
        ...lea,
        thisMonth: {
          ...lea.thisMonth,
          moneyReceived: [
            { currency: 'LBP', amount: '4500000.00', paymentCount: 1 },
            { currency: 'USD', amount: '1140.00', paymentCount: 3 },
          ],
          plansSold: 1,
        },
      },
      omar,
      {
        ...hadi,
        lastMonth: monthNumbers({
          moneyReceived: [{ currency: 'EUR', amount: '90.50', paymentCount: 1 }],
        }),
      },
    ],
    noCoach: {
      thisMonth: monthNumbers({
        moneyReceived: [{ currency: 'USD', amount: '300.00', paymentCount: 1 }],
        plansSold: 1,
      }),
      lastMonth: monthNumbers({
        moneyReceived: [{ currency: 'USD', amount: '280.00', paymentCount: 1 }],
      }),
    },
    monthRuleVersion: 3,
  };
}

/** The owner alone, with a paying trainee who waited for a coach: one row, and the No coach line. */
export function ownerAloneWaitingMonthReport(): CoachMonthReportView {
  const whole = waitingMonthReport();
  const noCoach = whole.noCoach!;
  const karim = whole.coaches![0];
  return {
    ...whole,
    thisMonth: monthNumbers({
      moneyReceived: [{ currency: 'USD', amount: '1200.00', paymentCount: 4 }],
      sessionsHeld: 4,
      plansSold: 2,
      packsSold: 1,
      clientsStarted: 1,
    }),
    lastMonth: monthNumbers({
      moneyReceived: [{ currency: 'USD', amount: '980.00', paymentCount: 3 }],
      sessionsHeld: 3,
      plansSold: 1,
    }),
    coaches: [karim],
    noCoach,
  };
}

/** A coaching space with nothing to count yet. */
export function emptyMonthReport(): CoachMonthReportView {
  return coachMonthReport({
    thisMonth: monthNumbers(),
    lastMonth: monthNumbers(),
    coaches: [coachRow(OWNER_ID, 'Karim Haddad', monthNumbers(), monthNumbers(), { isYou: true })],
  });
}
