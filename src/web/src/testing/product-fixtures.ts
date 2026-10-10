import type {
  CoachingFeature,
  CoachingProductView,
  ProductCatalog,
  ProductOfferView,
} from '../app/core/api/generated';

/** Plans you sell (C8, R5.1a): generated-contract fixtures with the caller's clients on each plan. */

export function features(...list: CoachingFeature[]): ProductOfferView['features'] {
  return list.map((feature) => ({ feature, allowsConcurrentCoverage: false }));
}

export function offer(overrides: Partial<ProductOfferView> = {}): ProductOfferView {
  return {
    id: 'o-12',
    label: '12 weeks',
    billingModel: 'FixedDuration',
    durationCount: 12,
    durationUnit: 'Week',
    priceAmount: 330,
    priceCurrency: 'USD',
    isActive: true,
    features: features('Training', 'Nutrition', 'CheckIns', 'Messaging'),
    createdAtUtc: '2026-06-01T09:00:00Z',
    version: 1,
    clients: { now: 0, starting: 0 },
    ...overrides,
  };
}

export function product(overrides: Partial<CoachingProductView> = {}): CoachingProductView {
  return {
    id: 'p-online',
    name: 'Online Coaching',
    description: 'Your own program, a weekly check-in and direct chat with your coach.',
    isActive: true,
    offers: [offer()],
    version: 1,
    clients: { now: 0, starting: 0 },
    ...overrides,
  };
}

/**
 * The Atlas catalog: Online Coaching sells 12 and 4 weeks (an older 12-week price retired) to six
 * clients, one starting soon; Strength Program sells 8 weeks to two; Summer Shred is no longer sold.
 */
export function atlasCatalog(): ProductCatalog {
  return {
    workspaceCurrencyCode: 'USD',
    products: [
      product({
        offers: [
          offer({ id: 'o-12', clients: { now: 4, starting: 1 } }),
          offer({
            id: 'o-4',
            label: '4 weeks',
            durationCount: 4,
            priceAmount: 130,
            clients: { now: 2, starting: 0 },
          }),
          offer({ id: 'o-12-old', priceAmount: 300, isActive: false, version: 2 }),
        ],
        clients: { now: 6, starting: 1 },
      }),
      product({
        id: 'p-strength',
        name: 'Strength Program',
        description: 'Powerlifting-style programming with technique feedback on your lifts.',
        offers: [
          offer({
            id: 'o-8',
            label: 'Meet prep',
            durationCount: 8,
            priceAmount: 180.5,
            features: features('Training', 'Messaging'),
            clients: { now: 2, starting: 0 },
          }),
        ],
        clients: { now: 2, starting: 0 },
      }),
      product({
        id: 'p-summer',
        name: 'Summer Shred',
        description: null,
        isActive: false,
        version: 3,
        offers: [offer({ id: 'o-summer', durationCount: 6, label: '6 weeks', priceAmount: 99 })],
      }),
    ],
  };
}
