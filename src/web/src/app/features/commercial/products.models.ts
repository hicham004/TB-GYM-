import { formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CoachingFeature,
  CoachingProductView,
  CreateProductOfferRequest,
  OfferDurationUnit,
  PlanClientCount,
  ProductCatalog,
  ProductKind,
  ProductOfferView,
} from '../../core/api/generated';
import type { IconName } from '../../ui/icon';
import type { UiMenuItem } from '../../ui/menu';

/**
 * Plans you sell (C8, R5.1a) in coach words. The server holds every rule (one active price option per
 * length and currency, a new price is a new option, SUB-002) and counts the clients on each plan
 * (SUB-015); this only phrases what it says and checks what a form can check before a round trip.
 */

const num = (value: number | string): number => Number(value);

/**
 * What a coach ticks a plan to include, in the order a plan lists them, matching Service & access. Sessions
 * are not among them: a pack always includes its own, and a coaching plan never does (SES-001).
 */
export const FEATURES: readonly CoachingFeature[] = [
  'Training',
  'Nutrition',
  'CheckIns',
  'Messaging',
  'ResourceLibrary',
];

/** Every feature a plan can list, in that order. */
export const LISTED_FEATURES: readonly CoachingFeature[] = [...FEATURES, 'Sessions'];

export interface FeatureChip {
  readonly feature: CoachingFeature;
  readonly label: string;
  readonly icon: IconName;
}

export function featureChip(feature: CoachingFeature): FeatureChip {
  switch (feature) {
    case 'Training':
      return { feature, label: $localize`Training`, icon: 'training' };
    case 'Nutrition':
      return { feature, label: $localize`Nutrition`, icon: 'nutrition' };
    case 'CheckIns':
      return { feature, label: $localize`Check-ins`, icon: 'check-ins' };
    case 'Messaging':
      return { feature, label: $localize`Messaging`, icon: 'messages' };
    case 'ResourceLibrary':
      return { feature, label: $localize`Resources`, icon: 'resources' };
    case 'Sessions':
      return { feature, label: $localize`1-on-1 sessions`, icon: 'clients' };
  }
}

export function price(amount: number | string, currency: string, locale: string): string {
  const value = num(amount);
  return `${currency} ${formatNumber(value, locale, Number.isInteger(value) ? '1.0-0' : '1.2-2')}`;
}

export function duration(offer: Pick<ProductOfferView, 'durationCount' | 'durationUnit'>): string {
  const count = num(offer.durationCount);
  if (offer.durationUnit === 'Day') {
    return count === 1 ? $localize`1 day` : $localize`${count}:count: days`;
  }
  return count === 1 ? $localize`1 week` : $localize`${count}:count: weeks`;
}

/** What a pack's option is called until it is given a name of its own. */
export function sessionsName(count: number): string {
  return count === 1 ? $localize`Single session` : $localize`${count}:count: sessions`;
}

/** The length a pack is sold for until the coach changes it: every pack ends (SES-001). */
export function packValidity(sessions: number | null): number {
  return sessions === 1 ? 30 : 90;
}

/** "10 sessions · 90 days", or a coaching option's length. */
export function offerLength(
  offer: Pick<ProductOfferView, 'durationCount' | 'durationUnit' | 'sessionCount'>,
): string {
  const length = duration(offer);
  const sessions = offer.sessionCount;
  return sessions === null || sessions === undefined
    ? length
    : `${sessionsName(num(sessions))} · ${length}`;
}

/**
 * "3 clients · 1 starting", "1 starting", or "No clients yet": who is on it, in the caller's scope. An option
 * on sale counts the clients of the old prices it replaced too (COACH-2); an old price counts those still on it.
 */
export function clientsLine(clients: PlanClientCount, oldPrice = false): string {
  const now = num(clients.now);
  const starting = num(clients.starting);
  if (oldPrice) {
    const total = now + starting;
    if (total === 0) return $localize`No one on this price`;
    return total === 1
      ? $localize`1 client still on this price`
      : $localize`${total}:count: clients still on this price`;
  }
  const onIt = now === 1 ? $localize`1 client` : $localize`${now}:count: clients`;
  if (now > 0 && starting > 0) return $localize`${onIt}:clients: · ${starting}:count: starting`;
  if (now > 0) return onIt;
  if (starting > 0) return $localize`${starting}:count: starting soon`;
  return $localize`No clients yet`;
}

export interface OptionRow {
  readonly id: string;
  readonly price: string;
  /** "12 weeks", or "10 sessions · 90 days" for a pack. */
  readonly duration: string;
  /** The coach's own name for the option, when it says more than its length ("Summer offer"). */
  readonly name: string | null;
  readonly features: readonly FeatureChip[];
  readonly clients: string;
  readonly hasClients: boolean;
  readonly isActive: boolean;
  readonly menu: readonly UiMenuItem[];
  readonly offer: ProductOfferView;
}

export interface PlanCard {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  /** Whether it sells sessions rather than coaching (SES-001). */
  readonly isPack: boolean;
  readonly clients: string;
  readonly hasClients: boolean;
  /** What every option for sale includes, shown once; null when the options differ. */
  readonly includes: readonly FeatureChip[] | null;
  readonly options: readonly OptionRow[];
  readonly retired: readonly OptionRow[];
  readonly menu: readonly UiMenuItem[];
  readonly product: CoachingProductView;
}

export function optionRow(offer: ProductOfferView, locale: string): OptionRow {
  const sessions = offer.sessionCount;
  const called =
    sessions === null || sessions === undefined ? duration(offer) : sessionsName(num(sessions));
  const label = offer.label.trim();
  return {
    id: offer.id,
    price: price(offer.priceAmount, offer.priceCurrency, locale),
    duration: offerLength(offer),
    name:
      label && label.toLocaleLowerCase(locale) !== called.toLocaleLowerCase(locale) ? label : null,
    features: LISTED_FEATURES.filter((feature) =>
      offer.features.some((item) => item.feature === feature),
    ).map(featureChip),
    clients: clientsLine(offer.clients, !offer.isActive),
    hasClients: num(offer.clients.now) + num(offer.clients.starting) > 0,
    isActive: offer.isActive,
    menu: offer.isActive
      ? [
          { label: $localize`Change price`, action: 'price' },
          {
            label: $localize`Stop selling`,
            hint: $localize`Clients already on it keep their plan`,
            action: 'retire',
          },
        ]
      : [{ label: $localize`Sell again`, action: 'restore' }],
    offer,
  };
}

export function planCard(product: CoachingProductView, locale: string): PlanCard {
  const rows = product.offers.map((offer) => optionRow(offer, locale));
  const selling = rows.filter((row) => row.isActive);
  const sets = new Set(selling.map((row) => row.features.map((chip) => chip.feature).join(',')));
  return {
    id: product.id,
    name: product.name,
    description: product.description?.trim() || null,
    isActive: product.isActive,
    isPack: product.kind === 'SessionPack',
    clients: clientsLine(product.clients),
    hasClients: num(product.clients.now) + num(product.clients.starting) > 0,
    includes: sets.size === 1 ? selling[0].features : null,
    // Shortest first, as a client would compare them.
    options: selling.sort(
      (a, b) =>
        days(a.offer) - days(b.offer) || num(a.offer.priceAmount) - num(b.offer.priceAmount),
    ),
    retired: rows.filter((row) => !row.isActive),
    menu: [
      { label: $localize`Edit name and description`, action: 'edit' },
      product.isActive
        ? {
            label: $localize`Stop selling this plan`,
            hint: $localize`Clients already on it keep their plan`,
            action: 'archive',
          }
        : { label: $localize`Sell this plan again`, action: 'restore' },
    ],
    product,
  };
}

function days(offer: Pick<ProductOfferView, 'durationCount' | 'durationUnit'>): number {
  return num(offer.durationCount) * (offer.durationUnit === 'Week' ? 7 : 1);
}

/** Plans for sale first, then those no longer sold, each in the server's order (by name). */
export function planCards(catalog: ProductCatalog | null, locale: string) {
  const cards = (catalog?.products ?? []).map((product) => planCard(product, locale));
  return {
    selling: cards.filter((card) => card.isActive),
    stopped: cards.filter((card) => !card.isActive),
  };
}

/** "2 plans for sale · 6 clients on them now", counting each client once across plans is the server's job. */
export function catalogSummary(catalog: ProductCatalog | null): string {
  const selling = (catalog?.products ?? []).filter((product) => product.isActive);
  if (selling.length === 0) return '';
  const plans =
    selling.length === 1
      ? $localize`1 plan for sale`
      : $localize`${selling.length}:count: plans for sale`;
  const now = selling.reduce((sum, product) => sum + num(product.clients.now), 0);
  if (now === 0) return plans;
  return now === 1
    ? $localize`${plans}:plans: · 1 client on them now`
    : $localize`${plans}:plans: · ${now}:count: clients on them now`;
}

// ---------- the forms ----------

export interface OptionValues {
  readonly label: string;
  /** How long a client is on it, counted in `unit`: weeks, or days for a plan sold by the day (INV-7). */
  readonly length: number | null;
  readonly unit: OfferDurationUnit;
  readonly price: number | null;
  readonly currency: string;
  readonly features: readonly CoachingFeature[];
  /** The sessions a pack's option sells; null on a coaching plan's. */
  readonly sessions: number | null;
}

export type FieldMessages = Record<string, string[]>;

export function emptyOption(currency: string): OptionValues {
  return {
    label: '',
    length: 12,
    unit: 'Week',
    price: null,
    currency,
    features: ['Training', 'CheckIns', 'Messaging'],
    sessions: null,
  };
}

/** What a Max plan covers, exactly and all four (N9c5a): the server refuses any other set. */
export const MAX_FEATURES: readonly CoachingFeature[] = [
  'Training',
  'Nutrition',
  'CheckIns',
  'Messaging',
];

/** Another price option for the house's Max plan: its four, which the coach cannot change. */
export function emptyMaxOption(currency: string): OptionValues {
  return { ...emptyOption(currency), features: MAX_FEATURES };
}

/**
 * A Max plan's option refused for what it includes (N9c5a), in the server's sentence: a 400 on `offer`
 * when an option is added, on `product` when a plan is made. Null for anything else.
 */
export function maxFeaturesRefusal(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return null;
  const errors = (error.error as { errors?: Record<string, string[]> } | null)?.errors;
  for (const key of ['offer', 'Offer', 'product', 'Product']) {
    const message = errors?.[key]?.[0];
    if (message) return message;
  }
  return null;
}

/** A pack's first option: ten sessions over 90 days, and nothing else ticked (SES-001). */
export function emptyPackOption(currency: string): OptionValues {
  return {
    label: '',
    length: packValidity(10),
    unit: 'Day',
    price: null,
    currency,
    features: [],
    sessions: 10,
  };
}

export function optionErrors(
  values: OptionValues,
  kind: ProductKind = 'CoachingPlan',
): FieldMessages {
  const errors: FieldMessages = {};
  const pack = kind === 'SessionPack';
  if (
    pack &&
    (values.sessions === null ||
      !Number.isInteger(values.sessions) ||
      values.sessions < 1 ||
      values.sessions > 100)
  ) {
    errors['sessions'] = [$localize`Enter a whole number of sessions, 1 to 100.`];
  }
  // The server's own bounds (SUB-002), so the form never refuses what it would accept.
  const days = values.unit === 'Day';
  if (values.length === null || !Number.isInteger(values.length) || values.length < 1) {
    errors['length'] = [
      days
        ? $localize`Enter a whole number of days, 1 or more.`
        : $localize`Enter a whole number of weeks, 1 or more.`,
    ];
  } else if (values.length > 3650) {
    errors['length'] = [
      days
        ? $localize`Keep it to 3,650 days or fewer.`
        : $localize`Keep it to 3,650 weeks or fewer.`,
    ];
  }
  if (values.price === null || !Number.isFinite(values.price) || values.price < 0) {
    errors['price'] = [$localize`Enter a price of zero or more.`];
  } else if (Math.abs(values.price * 100 - Math.round(values.price * 100)) > 1e-6) {
    errors['price'] = [$localize`Use at most two decimals.`];
  }
  if (!/^[A-Za-z]{3}$/.test(values.currency.trim())) {
    errors['currency'] = [$localize`Use a three-letter currency code, like USD.`];
  }
  if (values.label.trim().length > 120) {
    errors['label'] = [$localize`Keep the name to 120 characters.`];
  }
  if (!pack && values.features.length === 0) {
    errors['features'] = [$localize`Choose at least one thing the plan includes.`];
  }
  return errors;
}

export function planErrors(name: string, description: string): FieldMessages {
  const errors: FieldMessages = {};
  if (!name.trim()) errors['name'] = [$localize`Give the plan a name clients will recognise.`];
  else if (name.trim().length > 160) errors['name'] = [$localize`Keep the name to 160 characters.`];
  if (description.trim().length > 2000) {
    errors['description'] = [$localize`Keep the description to 2,000 characters.`];
  }
  return errors;
}

/** The option's length as clients read it ("12 weeks", "30 days"); empty while the box is not a length. */
export function optionLength(values: Pick<OptionValues, 'length' | 'unit'>): string {
  const count = values.length;
  return count !== null && Number.isInteger(count) && count > 0
    ? duration({ durationCount: count, durationUnit: values.unit })
    : '';
}

/**
 * An option without its own name is called by its length, or by its count on a pack, as the server needs
 * a name. The server adds a pack's sessions to what is ticked.
 */
export function optionRequest(
  values: OptionValues,
  kind: ProductKind = 'CoachingPlan',
): CreateProductOfferRequest {
  const length = values.length ?? 0;
  const sessions = kind === 'SessionPack' ? (values.sessions ?? 0) : null;
  return {
    label:
      values.label.trim() ||
      (sessions === null
        ? duration({ durationCount: length, durationUnit: values.unit })
        : sessionsName(sessions)),
    durationCount: length,
    durationUnit: values.unit,
    priceAmount: values.price ?? 0,
    priceCurrency: values.currency.trim().toUpperCase(),
    features: FEATURES.filter((feature) => values.features.includes(feature)).map((feature) => ({
      feature,
      allowsConcurrentCoverage: false,
    })),
    ...(sessions === null ? {} : { sessionCount: sessions }),
  };
}

export function priceErrors(amount: number | null, current: number | string): string[] {
  if (amount === null || !Number.isFinite(amount) || amount < 0) {
    return [$localize`Enter a price of zero or more.`];
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return [$localize`Use at most two decimals.`];
  }
  if (amount === num(current)) return [$localize`Choose a different price for this option.`];
  return [];
}

/** A refusal in coach words; anything unexpected falls back to the server's own message. */
export function productWriteError(error: unknown, kind: ProductKind = 'CoachingPlan'): string {
  if (error instanceof HttpErrorResponse) {
    const code = (error.error as { code?: string } | null)?.code;
    switch (code) {
      case 'active_offer_slot_conflict':
        return kind === 'SessionPack'
          ? $localize`This pack already sells that many sessions for that length in that currency. Change its price instead, or stop selling it first.`
          : $localize`This plan already sells an option of that length in that currency. Change its price instead, or stop selling it first.`;
      case 'product_conflict':
        return $localize`You already sell a plan with this name. Choose another name.`;
      // BILL-7: a new, renamed or restored plan cannot take the name of another plan for sale.
      case 'product_name_taken':
        return $localize`You already sell a plan with this name. Choose another name, or rename that plan first.`;
      case 'concurrency_conflict':
      case 'offer_conflict':
        return $localize`This plan changed since you opened it. It has been reloaded; try again.`;
    }
  }
  return apiErrorMessage(error, $localize`The change could not be saved. Try again.`);
}
