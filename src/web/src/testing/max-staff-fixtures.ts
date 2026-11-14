import type { ClientEnrollment } from '../app/core/api/api.models';
import type { CoachingProductView, HousePlanAskView } from '../app/core/api/generated';
import { ALL_FEATURES, enrollment, housePlanAsk, payment } from './client-service-fixtures';
import { features, offer, product } from './product-fixtures';

/**
 * Max, TB Gym coaching the trainee for a limited number of places (notes plan N9c5a), as the house's staff
 * read it: Maya's ask for Max coaching, 4 weeks at USD 120, the plan booked from it, and the plan as Plans
 * you sell lists it. Shared by the unit tests and the browser tests of the staff's side (N9c5b).
 */

/** Maya's ask for Max coaching on Tue 29 Sep, money not said sent, second in line with no place open. */
export function maxAsk(overrides: Partial<HousePlanAskView> = {}): HousePlanAskView {
  return housePlanAsk({
    id: 'ask-max',
    offerId: 'o-max-4',
    tier: 'Max',
    planName: 'Max coaching',
    optionLabel: '4 weeks',
    priceAmount: 120,
    state: 'Asked',
    moneySent: null,
    placeOpen: false,
    placeInLine: 2,
    ...overrides,
  });
}

/** Max coaching, 4 weeks from Thu 1 Oct at USD 120, paid by Whish: booked from Maya's ask, beside Free. */
export function houseMaxPlan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return enrollment({
    id: 'e-max',
    productId: 'p-max',
    offerId: 'o-max-4',
    productName: 'Max coaching',
    offerLabel: '4 weeks',
    priceAmount: 120,
    paidAmount: 120,
    balanceAmount: 0,
    startDate: '2026-10-01',
    endDateExclusive: '2026-10-29',
    lastActiveDate: '2026-10-28',
    features: ALL_FEATURES,
    payments: [
      payment({
        id: 'pay-max',
        amount: 120,
        receivedOn: '2026-10-01',
        receivedAtUtc: '2026-10-01T12:00:00Z',
        method: 'MobileWallet',
        reference: 'WH-90412',
        createdAtUtc: '2026-10-01T12:00:00Z',
      }),
    ],
    createdAtUtc: '2026-10-01T12:00:00Z',
    version: 1,
    houseTier: 'Max',
    ...overrides,
  });
}

/** The house's Max coaching as Plans you sell lists it: 4 weeks at USD 120, its four features. */
export function maxProduct(overrides: Partial<CoachingProductView> = {}): CoachingProductView {
  return product({
    id: 'p-max',
    name: 'Max coaching',
    description: 'TB Gym coaches you: your program, your meals, weekly check-ins and chat.',
    houseTier: 'Max',
    offers: [
      offer({
        id: 'o-max-4',
        label: '4 weeks',
        durationCount: 4,
        priceAmount: 120,
        features: features('Training', 'Nutrition', 'CheckIns', 'Messaging'),
        clients: { now: 3, starting: 0 },
      }),
    ],
    clients: { now: 3, starting: 0 },
    ...overrides,
  });
}
