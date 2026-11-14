import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CoachingFeature,
  HousePlanAskState,
  HousePlanAskView,
  HousePlanOfferView,
  HousePlansView,
  HouseTier,
  OfferDurationUnit,
} from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import { dateRange, shortDate } from '../clients/client-service.models';
import {
  duration,
  featureChip,
  LISTED_FEATURES,
  price,
  type FeatureChip,
} from '../commercial/products.models';

/**
 * The plans TB Gym sells to its own self-directed trainees, as My plan shows them (notes plan N9c2,
 * SUB-020): every price, length, name and word comes from the house's offers, none is typed here. Pure
 * functions of the server's answer, so every line has a fixed test. The server decides what may be asked
 * for and where each ask stands; this only says it.
 */

export type HouseAskState = HousePlanAskState;

/** One option on sale of one of the house's paid plans. */
export interface HouseOffer {
  readonly offerId: string;
  readonly productId: string;
  /** Which of the house's tiers it sells: the programs page offers "Ask for Pro+" only while Pro+ is on sale. */
  readonly tier: HouseTier;
  readonly name: string;
  readonly description: string | null;
  readonly optionLabel: string;
  readonly priceAmount: number;
  readonly priceCurrency: string;
  readonly durationCount: number;
  readonly durationUnit: OfferDurationUnit;
  readonly features: readonly CoachingFeature[];
}

/** The trainee's word that the money was sent, with the Whish details they gave. */
export interface HouseAskTransfer {
  readonly whishName: string | null;
  readonly whishNumber: string | null;
  readonly sentOn: string;
}

export interface HouseAskOutcome {
  readonly kind: 'Booked' | 'Closed';
  readonly decidedOn: string;
  readonly reason: string | null;
  readonly planStartDate: string | null;
  readonly planLastDay: string | null;
}

export interface HouseAsk {
  readonly id: string;
  readonly offerId: string;
  readonly planName: string;
  readonly optionLabel: string;
  readonly priceAmount: number;
  readonly priceCurrency: string;
  readonly durationCount: number;
  readonly durationUnit: OfferDurationUnit;
  readonly askedOn: string;
  readonly state: HouseAskState;
  readonly moneySent: HouseAskTransfer | null;
  readonly outcome: HouseAskOutcome | null;
}

/** What `GET /api/house-plans/me` says: whether asks are open, where to send the money, the plans, the asks. */
export interface HousePlans {
  readonly today: string;
  readonly asksOpen: boolean;
  readonly whishNumber: string | null;
  readonly plans: readonly HouseOffer[];
  /** Newest first, as the server sends them. */
  readonly asks: readonly HouseAsk[];
}

export function toHouseOffer(view: HousePlanOfferView): HouseOffer {
  return {
    offerId: view.offerId,
    productId: view.productId,
    tier: view.tier,
    name: view.name,
    description: view.description?.trim() || null,
    optionLabel: view.optionLabel,
    priceAmount: Number(view.priceAmount),
    priceCurrency: view.priceCurrency,
    durationCount: Number(view.durationCount),
    durationUnit: view.durationUnit,
    features: view.features,
  };
}

export function toHouseAsk(view: HousePlanAskView): HouseAsk {
  return {
    id: view.id,
    offerId: view.offerId,
    planName: view.planName,
    optionLabel: view.optionLabel,
    priceAmount: Number(view.priceAmount),
    priceCurrency: view.priceCurrency,
    durationCount: Number(view.durationCount),
    durationUnit: view.durationUnit,
    askedOn: view.askedOn,
    state: view.state,
    moneySent: view.moneySent
      ? {
          whishName: view.moneySent.whishName,
          whishNumber: view.moneySent.whishNumber,
          sentOn: view.moneySent.sentOn,
        }
      : null,
    outcome: view.outcome
      ? {
          kind: view.outcome.kind,
          decidedOn: view.outcome.decidedOn,
          reason: view.outcome.reason?.trim() || null,
          planStartDate: view.outcome.planStartDate,
          planLastDay: view.outcome.planLastDay,
        }
      : null,
  };
}

export function toHousePlans(view: HousePlansView): HousePlans {
  return {
    today: view.today,
    asksOpen: view.asksOpen,
    whishNumber: view.whishNumber?.trim() || null,
    plans: view.plans.map(toHouseOffer),
    asks: view.asks.map(toHouseAsk),
  };
}

// ---------- what the page shows ----------

export interface Pill {
  readonly label: string;
  readonly tone: StatusPillTone;
}

/** A day the way the page writes it: "Thu 15 Oct" this year, "15 Oct 2025" in another, as dateRange does. */
export function houseDay(date: string, today: string, locale: string): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? shortDate(date, locale)
    : formatDate(date, 'd MMM y', locale);
}

/** One option of a plan, with the button that asks for it. */
export interface HouseOption {
  readonly offerId: string;
  /** The option's own name, as the house's staff typed it. */
  readonly label: string;
  /** "4 weeks"; null when the option's name already says it. */
  readonly length: string | null;
  /** "USD 47.50" */
  readonly price: string;
  /**
   * The button's name, for a person who cannot see which plan it sits in: "Ask for Two blocks, Pro+",
   * starting with the words on the button so voice control finds it (WCAG 2.5.3).
   */
  readonly askName: string;
  /** What this option includes, only when the plan's options do not all include the same. */
  readonly includes: readonly FeatureChip[] | null;
}

/** One of the house's paid plans and its options on sale, in the server's order. */
export interface HousePlanGroup {
  readonly productId: string;
  readonly name: string;
  readonly description: string | null;
  /** What every option includes, said once; null when the options differ. */
  readonly includes: readonly FeatureChip[] | null;
  readonly options: readonly HouseOption[];
}

/** What the trainee chose to ask for, which the confirmation repeats. */
export interface HouseAskChoice {
  readonly planName: string;
  readonly option: HouseOption;
}

function chips(features: readonly CoachingFeature[]): FeatureChip[] {
  return LISTED_FEATURES.filter((feature) => features.includes(feature)).map(featureChip);
}

function sameLength(label: string, length: string, locale: string): boolean {
  return label.trim().toLocaleLowerCase(locale) === length.toLocaleLowerCase(locale);
}

/**
 * The options on sale, one group per plan in the order the server sends them (by plan name, then length,
 * then price). What is included is said once for a plan whose options all include the same, as Plans you
 * sell does, and on each option otherwise.
 */
export function planGroups(plans: readonly HouseOffer[], locale: string): HousePlanGroup[] {
  const byPlan = new Map<string, HouseOffer[]>();
  for (const offer of plans) {
    const group = byPlan.get(offer.productId);
    if (group) group.push(offer);
    else byPlan.set(offer.productId, [offer]);
  }
  return [...byPlan.values()].map((offers) => {
    const first = offers[0];
    const sets = new Set(
      offers.map((offer) =>
        chips(offer.features)
          .map((chip) => chip.feature)
          .join(','),
      ),
    );
    const shared = sets.size === 1;
    return {
      productId: first.productId,
      name: first.name,
      description: first.description,
      includes: shared ? chips(first.features) : null,
      options: offers.map((offer) => {
        const length = duration(offer);
        return {
          offerId: offer.offerId,
          label: offer.optionLabel,
          length: sameLength(offer.optionLabel, length, locale) ? null : length,
          price: price(offer.priceAmount, offer.priceCurrency, locale),
          askName: $localize`Ask for ${offer.optionLabel}:option:, ${first.name}:plan:`,
          includes: shared ? null : chips(offer.features),
        };
      }),
    };
  });
}

/** Where an ask stands, in the pill on it. */
export function askPill(state: HouseAskState): Pill {
  switch (state) {
    case 'Asked':
      return { label: $localize`Waiting for your payment`, tone: 'warm' };
    case 'MoneySent':
      return { label: $localize`Money sent`, tone: 'info' };
    case 'Booked':
      return { label: $localize`Booked`, tone: 'success' };
    case 'Closed':
      return { label: $localize`Closed`, tone: 'neutral' };
  }
}

/** The ask still waiting on TB Gym: asked, or said paid. A trainee has one at a time. */
export function openAskOf(asks: readonly HouseAsk[]): HouseAsk | null {
  return asks.find((ask) => ask.state === 'Asked' || ask.state === 'MoneySent') ?? null;
}

/** The asks TB Gym booked or closed, newest first. */
export function earlierAsksOf(asks: readonly HouseAsk[]): HouseAsk[] {
  return asks.filter((ask) => ask.state === 'Booked' || ask.state === 'Closed');
}

/** The open ask's card: what was asked for, its price and where it stands. */
export interface OpenAskCard {
  readonly id: string;
  readonly state: 'Asked' | 'MoneySent';
  readonly planName: string;
  readonly optionLabel: string;
  /** "USD 47.50" */
  readonly price: string;
  /** "USD 89.75 for 8 weeks"; "USD 47.50" alone when the option's name already is the length. */
  readonly cost: string;
  readonly pill: Pill;
  /** What the trainee said of the money, once they said it. */
  readonly sent: {
    readonly on: string;
    readonly name: string;
    readonly number: string;
  } | null;
}

export function openAskCard(ask: HouseAsk, today: string, locale: string): OpenAskCard {
  const cost = price(ask.priceAmount, ask.priceCurrency, locale);
  const length = duration(ask);
  const sent = ask.state === 'MoneySent' ? ask.moneySent : null;
  return {
    id: ask.id,
    state: ask.state === 'MoneySent' ? 'MoneySent' : 'Asked',
    planName: ask.planName,
    optionLabel: ask.optionLabel,
    price: cost,
    // Said once, as the options on sale say it: never "4 weeks · USD 47.50 for 4 weeks".
    cost: sameLength(ask.optionLabel, length, locale)
      ? cost
      : $localize`${cost}:price: for ${length}:length:`,
    pill: askPill(ask.state),
    sent: sent
      ? {
          on: houseDay(sent.sentOn, today, locale),
          name: sent.whishName ?? '',
          number: sent.whishNumber ?? '',
        }
      : null,
  };
}

/** An ask TB Gym booked or closed, in the list of earlier asks. */
export interface EarlierAsk {
  readonly id: string;
  readonly planName: string;
  readonly optionLabel: string;
  readonly pill: Pill;
  /** "USD 47.50 · asked Thu 15 Oct" */
  readonly asked: string;
  /** "Booked Fri 16 Oct: runs Fri 16 Oct – Thu 12 Nov." or "TB Gym closed this ask on Fri 16 Oct." */
  readonly outcome: string;
  /** Why TB Gym closed it, in the staff's words; never who did. */
  readonly reason: string | null;
}

function outcomeLine(ask: HouseAsk, today: string, locale: string): string {
  const outcome = ask.outcome;
  if (!outcome) return '';
  const decided = houseDay(outcome.decidedOn, today, locale);
  if (outcome.kind === 'Closed') return $localize`TB Gym closed this ask on ${decided}:date:.`;
  return outcome.planStartDate && outcome.planLastDay
    ? $localize`Booked ${decided}:date:: runs ${dateRange(outcome.planStartDate, outcome.planLastDay, { today, locale })}:dates:.`
    : $localize`Booked ${decided}:date:.`;
}

export function earlierAsk(ask: HouseAsk, today: string, locale: string): EarlierAsk {
  return {
    id: ask.id,
    planName: ask.planName,
    optionLabel: ask.optionLabel,
    pill: askPill(ask.state),
    asked: $localize`${price(ask.priceAmount, ask.priceCurrency, locale)}:price: · asked ${houseDay(ask.askedOn, today, locale)}:date:`,
    outcome: outcomeLine(ask, today, locale),
    reason: ask.outcome?.kind === 'Closed' ? ask.outcome.reason : null,
  };
}

// ---------- "I've paid": the Whish details, checked as the server checks them ----------

export const WHISH_NAME_LIMIT = 100;
export const WHISH_NUMBER_LIMIT = 40;

/** Said under the name when it is missing. */
export const WHISH_NAME_NEEDED = $localize`Enter the name on the Whish account you sent the money from.`;
/** Said under the number when it is not one. */
export const WHISH_NUMBER_FORMAT = $localize`Enter the Whish number you sent the money from: 6 to 20 digits, with a + in front if you like.`;

/** Trimmed, every run of spaces one space, as the server keeps a name or a number. */
export function collapseSpaces(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ');
}

export function whishNameProblems(typed: string): string[] {
  const name = collapseSpaces(typed);
  return name.length > 0 && name.length <= WHISH_NAME_LIMIT ? [] : [WHISH_NAME_NEEDED];
}

/**
 * The number as the server keeps it (CLI-023's form): spaces collapsed, an optional + in front with no
 * space after it, then digits and single spaces; null when it is not a number the server takes (6 to 20
 * digits, 40 characters at most).
 */
export function whishNumberValue(typed: string): string | null {
  const text = collapseSpaces(typed);
  if (text.length === 0 || text.length > WHISH_NUMBER_LIMIT) return null;
  const plus = text.startsWith('+');
  const body = plus ? text.slice(1).trimStart() : text;
  if (!/^[0-9 ]+$/.test(body)) return null;
  const digits = body.replace(/ /g, '').length;
  if (digits < 6 || digits > 20) return null;
  return plus ? `+${body}` : body;
}

export function whishNumberProblems(typed: string): string[] {
  return whishNumberValue(typed) === null ? [WHISH_NUMBER_FORMAT] : [];
}

// ---------- refusals ----------

/** What a refused ask or "I've paid" says: under a field, or for the whole sheet. */
export interface HouseRefusal {
  readonly message: string | null;
  readonly whishName: string | null;
  readonly whishNumber: string | null;
  /** The page no longer shows how things stand: it reads the house's plans again once the sheet closes. */
  readonly stale: boolean;
}

/** The refusals after which the page's plans and asks are out of date. */
const STALE_CODES: ReadonlySet<string> = new Set([
  'house_plan_asks_closed',
  'house_plan_not_on_sale',
  'house_plan_ask_open',
  'client_blocked',
  'house_plan_money_already_sent',
  'house_plan_ask_ended',
]);

function firstMessage(value: unknown): string | null {
  const first = Array.isArray(value) ? (value as unknown[])[0] : null;
  return typeof first === 'string' && first.trim() ? first : null;
}

/**
 * The words for a write the server refused. A Whish detail it would not take is said under its field in
 * the server's sentence; a conflict is said in the server's own words, written for the trainee (N9c1),
 * with `fallback` when it sent none; a lost connection or a server fault reads the app's sentences.
 */
export function houseRefusal(error: unknown, fallback: string): HouseRefusal {
  if (error instanceof HttpErrorResponse) {
    const body = (error.error ?? null) as { code?: unknown; errors?: unknown } | null;
    if (error.status === 400 && typeof body?.errors === 'object' && body.errors !== null) {
      const errors = body.errors as Record<string, unknown>;
      const whishName = firstMessage(errors['whishName'] ?? errors['WhishName']);
      const whishNumber = firstMessage(errors['whishNumber'] ?? errors['WhishNumber']);
      if (whishName || whishNumber) return { message: null, whishName, whishNumber, stale: false };
    }
    const code = typeof body?.code === 'string' ? body.code : null;
    if (error.status === 404) {
      return { message: fallback, whishName: null, whishNumber: null, stale: true };
    }
    if (code !== null && STALE_CODES.has(code)) {
      return {
        message: apiErrorMessage(error, fallback),
        whishName: null,
        whishNumber: null,
        stale: true,
      };
    }
  }
  return {
    message: apiErrorMessage(error, fallback),
    whishName: null,
    whishNumber: null,
    stale: false,
  };
}
