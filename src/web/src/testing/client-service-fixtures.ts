import type {
  ClientCommercialOverview,
  ClientEnrollment,
  CoachingFeature,
  PaymentRecord,
  ProductCatalog,
} from '../app/core/api/api.models';

/**
 * Plans and payments for a client's Service & access (R3.4b): Maya Fakhoury on Atlas Performance,
 * read on Thu 1 Oct 2026. Shared by the unit tests and the browser tests, so both read one story.
 */
export const SERVICE_TODAY = '2026-10-01';

export const ALL_FEATURES: CoachingFeature[] = ['Training', 'Nutrition', 'CheckIns', 'Messaging'];

export function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'pay-1',
    amount: 330,
    currencyCode: 'USD',
    receivedAtUtc: '2026-07-20T09:00:00Z',
    receivedOn: '2026-07-20',
    method: 'Cash',
    reference: null,
    note: null,
    recordedByUserId: 'owner-1',
    operation: 'Receipt',
    source: 'Manual',
    createdAtUtc: '2026-07-20T09:00:00Z',
    ...overrides,
  };
}

/** Online Coaching, 12 weeks from Tue 21 Jul, paid in full: the plan running today. */
export function enrollment(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return {
    id: 'e-1',
    productId: 'p-online',
    offerId: 'o-12',
    renewedFromEnrollmentId: null,
    productName: 'Online Coaching',
    offerLabel: '12 weeks',
    priceAmount: 330,
    priceCurrency: 'USD',
    paidAmount: 330,
    balanceAmount: 0,
    startDate: '2026-07-21',
    endDateExclusive: '2026-10-13',
    lastActiveDate: '2026-10-12',
    storedStatus: 'Active',
    effectiveStatus: 'Active',
    statusReason: null,
    cancelledOn: null,
    features: ALL_FEATURES,
    payments: [payment()],
    createdAtUtc: '2026-07-20T09:00:00Z',
    version: 2,
    ...overrides,
  };
}

/** The renewal waiting for its payment: 12 more weeks from Tue 13 Oct, USD 150 of 330 paid. */
export function unpaidRenewal(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return enrollment({
    id: 'e-2',
    renewedFromEnrollmentId: 'e-1',
    startDate: '2026-10-13',
    endDateExclusive: '2027-01-05',
    lastActiveDate: '2027-01-04',
    storedStatus: 'PendingPayment',
    effectiveStatus: 'PendingPayment',
    paidAmount: 150,
    balanceAmount: 180,
    payments: [
      payment({
        id: 'pay-2',
        amount: 150,
        receivedAtUtc: '2026-09-28T10:00:00Z',
        receivedOn: '2026-09-28',
        method: 'MobileWallet',
        reference: 'WH-2231',
      }),
    ],
    version: 1,
    ...overrides,
  });
}

/** A starter plan that ran before, cancelled half way with a reason. */
export function cancelledPlan(overrides: Partial<ClientEnrollment> = {}): ClientEnrollment {
  return enrollment({
    id: 'e-0',
    productId: 'p-starter',
    offerId: 'o-4',
    productName: 'Starter',
    offerLabel: '4 weeks',
    priceAmount: 0,
    paidAmount: 0,
    balanceAmount: 0,
    startDate: '2026-06-01',
    endDateExclusive: '2026-06-29',
    lastActiveDate: '2026-06-28',
    storedStatus: 'Cancelled',
    effectiveStatus: 'Cancelled',
    statusReason: 'Moved to Online Coaching',
    cancelledOn: '2026-06-14',
    features: ['Training'],
    payments: [],
    version: 3,
    ...overrides,
  });
}

export function plansOverview(
  enrollments: ClientEnrollment[] = [enrollment()],
  overrides: Partial<ClientCommercialOverview> = {},
): ClientCommercialOverview {
  return {
    clientProfileId: 'client-1',
    isRelationshipBlocked: false,
    featureAccess: ALL_FEATURES.map((feature) => ({
      feature,
      isAllowed: true,
      reason: 'Granted',
      enrollmentId: 'e-1',
      accessibleFrom: '2026-07-21',
      accessibleUntilExclusive: '2026-10-13',
    })),
    enrollments,
    ...overrides,
  };
}

/** What the coach sells: Online Coaching in 12 and 4 weeks, a retired option, and a free add-on. */
export function catalog(): ProductCatalog {
  const features = (list: CoachingFeature[], concurrent: CoachingFeature[] = []) =>
    list.map((feature) => ({ feature, allowsConcurrentCoverage: concurrent.includes(feature) }));
  return {
    workspaceCurrencyCode: 'USD',
    products: [
      {
        id: 'p-online',
        name: 'Online Coaching',
        description: null,
        isActive: true,
        version: 1,
        offers: [
          {
            id: 'o-12',
            label: '12 weeks',
            billingModel: 'FixedDuration',
            durationCount: 12,
            durationUnit: 'Week',
            priceAmount: 330,
            priceCurrency: 'USD',
            isActive: true,
            features: features(ALL_FEATURES),
            createdAtUtc: '2026-06-01T09:00:00Z',
            replacedByOfferId: null,
            version: 1,
          },
          {
            id: 'o-4',
            label: '4 weeks',
            billingModel: 'FixedDuration',
            durationCount: 4,
            durationUnit: 'Week',
            priceAmount: 120,
            priceCurrency: 'USD',
            isActive: true,
            features: features(ALL_FEATURES),
            createdAtUtc: '2026-06-01T09:00:00Z',
            replacedByOfferId: null,
            version: 1,
          },
          {
            id: 'o-old',
            label: '8 weeks (old price)',
            billingModel: 'FixedDuration',
            durationCount: 8,
            durationUnit: 'Week',
            priceAmount: 200,
            priceCurrency: 'USD',
            isActive: false,
            features: features(ALL_FEATURES),
            createdAtUtc: '2026-01-01T09:00:00Z',
            replacedByOfferId: null,
            version: 1,
          },
        ],
      },
      {
        id: 'p-recipes',
        name: 'Recipe Pack',
        description: null,
        isActive: true,
        version: 1,
        offers: [
          {
            id: 'o-recipes',
            label: '30 days',
            billingModel: 'FixedDuration',
            durationCount: 30,
            durationUnit: 'Day',
            priceAmount: 0,
            priceCurrency: 'USD',
            isActive: true,
            features: features(['Nutrition'], ['Nutrition']),
            createdAtUtc: '2026-06-01T09:00:00Z',
            replacedByOfferId: null,
            version: 1,
          },
        ],
      },
    ],
  };
}
