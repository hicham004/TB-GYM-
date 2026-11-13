import { HttpErrorResponse } from '@angular/common/http';
import type { ClientEnrollment } from '../../core/api/api.models';
import type {
  HousePlanAskOutcomeKind,
  HousePlanAskState,
  HousePlanAskView,
  HouseTier,
  OfferDurationUnit,
} from '../../core/api/generated';
import { duration } from '../commercial/products.models';
import { serviceWriteError, type FieldMessages } from './client-service-forms.models';
import {
  dateRange,
  money,
  shortDate,
  type PlanPill,
  type ServiceContext,
} from './client-service.models';

/**
 * A self-directed trainee's asks for one of the house's paid plans (SUB-020, notes plan N9c2), as the house's
 * staff read them on the trainee's Service & access: the plan and price asked for, the Whish details the trainee
 * says the money came from, and how the staff ended it. The server books and closes and checks everything again;
 * these only phrase what it says, and every name, option, price and length comes from its read.
 */

export interface HousePlanTransfer {
  /** Null once the trainee closed their account, which erases both (CLI-027). */
  readonly whishName: string | null;
  readonly whishNumber: string | null;
  readonly sentOn: string;
}

export interface HousePlanAskOutcome {
  readonly kind: HousePlanAskOutcomeKind;
  readonly decidedOn: string;
  /** Why it was closed, which the trainee reads; none on a booking. */
  readonly reason: string | null;
  readonly planStartDate: string | null;
  readonly planLastDay: string | null;
  /** Who booked or closed it, on the staff's read alone. */
  readonly decidedByName: string | null;
}

export interface HousePlanAsk {
  readonly id: string;
  readonly offerId: string;
  readonly tier: HouseTier;
  readonly planName: string;
  readonly optionLabel: string;
  readonly priceAmount: number;
  readonly priceCurrency: string;
  readonly durationCount: number;
  readonly durationUnit: OfferDurationUnit;
  readonly askedOn: string;
  readonly state: HousePlanAskState;
  readonly moneySent: HousePlanTransfer | null;
  readonly outcome: HousePlanAskOutcome | null;
}

/** The server's ask with its figures as numbers: the generated type allows a string for each. */
export function toHousePlanAsk(view: HousePlanAskView): HousePlanAsk {
  return {
    id: view.id,
    offerId: view.offerId,
    tier: view.tier,
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
          reason: view.outcome.reason,
          planStartDate: view.outcome.planStartDate,
          planLastDay: view.outcome.planLastDay,
          decidedByName: view.outcome.decidedByName,
        }
      : null,
  };
}

/**
 * A client of the house with no coach holds Free, the house's endless plan, and nobody else does (N9b1): the
 * one sign this page has that the client may ask for a plan, so no other client's page reads the asks.
 */
export function isHouseTrainee(plans: readonly ClientEnrollment[] | null | undefined): boolean {
  return (plans ?? []).some((plan) => plan.houseTier === 'Free');
}

/** Still waiting for the staff: asked, or the money said sent. Asks never lapse (SUB-020). */
export function isOpenAsk(ask: Pick<HousePlanAsk, 'state'>): boolean {
  return ask.state === 'Asked' || ask.state === 'MoneySent';
}

export function askPill(state: HousePlanAskState): PlanPill {
  switch (state) {
    case 'Asked':
      return { label: $localize`Waiting for the money`, tone: 'warm' };
    case 'MoneySent':
      return { label: $localize`Says it’s sent`, tone: 'info' };
    case 'Booked':
      return { label: $localize`Booked`, tone: 'success' };
    case 'Closed':
      return { label: $localize`Closed`, tone: 'neutral' };
  }
}

/** "Pro+ Programs, 4 weeks": the plan and the option asked for, as the house's staff named them. */
export function askedPlan(ask: Pick<HousePlanAsk, 'planName' | 'optionLabel'>): string {
  return $localize`${ask.planName}:plan:, ${ask.optionLabel}:option:`;
}

/** The Whish details the trainee said they sent the money from; both null once erased (CLI-027). */
export interface AskSent {
  readonly name: string | null;
  readonly number: string | null;
  /** "Wed 30 Sep" */
  readonly day: string;
}

/** One ask as a row of the trainee's Service & access. */
export interface AskRow {
  readonly id: string;
  /** "Pro+ Programs, 4 weeks" */
  readonly name: string;
  /** "USD 47.50 · asked Tue 29 Sep" */
  readonly meta: string;
  readonly pill: PlanPill;
  readonly sent: AskSent | null;
  /** "Booked by Karim Haddad on Sun 20 Sep: runs Sun 20 Sep – Sat 17 Oct." or "Closed by … on …." */
  readonly decided: string | null;
  /** Why it was closed, on its own line. */
  readonly reason: string | null;
  /** Asked or said sent: the staff may still book or close it. */
  readonly open: boolean;
  /** The buttons' names: their visible words first, then the plan they act on (WCAG 2.5.3). */
  readonly bookLabel: string;
  readonly closeLabel: string;
}

function decidedLine(
  ask: HousePlanAsk,
  context: Pick<ServiceContext, 'locale' | 'today'>,
): string | null {
  const outcome = ask.outcome;
  if (!outcome) return null;
  const day = shortDate(outcome.decidedOn, context.locale);
  const name = outcome.decidedByName;
  if (outcome.kind === 'Closed') {
    return name
      ? $localize`Closed by ${name}:name: on ${day}:date:.`
      : $localize`Closed on ${day}:date:.`;
  }
  if (!outcome.planStartDate || !outcome.planLastDay) {
    return name
      ? $localize`Booked by ${name}:name: on ${day}:date:.`
      : $localize`Booked on ${day}:date:.`;
  }
  const runs = dateRange(outcome.planStartDate, outcome.planLastDay, context);
  return name
    ? $localize`Booked by ${name}:name: on ${day}:date:: runs ${runs}:dates:.`
    : $localize`Booked on ${day}:date:: runs ${runs}:dates:.`;
}

export function askRow(
  ask: HousePlanAsk,
  context: Pick<ServiceContext, 'locale' | 'today'>,
): AskRow {
  const name = askedPlan(ask);
  const price = money(ask.priceAmount, ask.priceCurrency, context.locale);
  const sent = ask.moneySent;
  return {
    id: ask.id,
    name,
    meta: $localize`${price}:price: · asked ${shortDate(ask.askedOn, context.locale)}:date:`,
    pill: askPill(ask.state),
    sent: sent
      ? {
          name: sent.whishName,
          number: sent.whishNumber,
          day: shortDate(sent.sentOn, context.locale),
        }
      : null,
    decided: decidedLine(ask, context),
    reason: ask.outcome?.kind === 'Closed' ? ask.outcome.reason : null,
    open: isOpenAsk(ask),
    bookLabel: $localize`Book plan, ${name}:plan:`,
    closeLabel: $localize`Close ask, ${name}:plan:`,
  };
}

/** Newest first, as the server lists them; asks of one day keep the server's order. */
export function askRows(
  asks: readonly HousePlanAsk[],
  context: Pick<ServiceContext, 'locale' | 'today'>,
): AskRow[] {
  return [...asks]
    .sort((a, b) => b.askedOn.localeCompare(a.askedOn))
    .map((ask) => askRow(ask, context));
}

// ------------------------------------------------------------------------------------------------
// Booking the plan and closing an ask
// ------------------------------------------------------------------------------------------------

/**
 * "Pro+ Programs, 1 month · 4 weeks": the plan, its option and how long it runs; the length is left out when
 * the option is already named by it ("Pro+ Programs, 4 weeks"), as the trainee's plans say it.
 */
export function bookingLine(
  ask: Pick<HousePlanAsk, 'planName' | 'optionLabel' | 'durationCount' | 'durationUnit'>,
  locale: string,
): string {
  const length = duration(ask);
  return ask.optionLabel.trim().toLocaleLowerCase(locale) === length.toLocaleLowerCase(locale)
    ? askedPlan(ask)
    : $localize`${askedPlan(ask)}:plan: · ${length}:length:`;
}

/**
 * The amount field's first figure, the price asked for: with its cents when it has any ("47.50"), a whole
 * number as it is ("45"). A number field takes a dot in every language.
 */
export function amountInput(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/** What booking does, said before the staff book: no day to pick, the price to look for first. */
export function bookingIntro(
  ask: Pick<HousePlanAsk, 'priceAmount' | 'priceCurrency'>,
  firstName: string,
  locale: string,
): string {
  const price = money(ask.priceAmount, ask.priceCurrency, locale);
  return $localize`Check the Whish account for ${price}:price: first. Booking starts ${firstName}:name:’s plan today, or the day after their current plan ends, and records the money as received by Whish today.`;
}

export interface BookingValues {
  readonly amount: number | null;
}

/**
 * The amount as typed. Only the server holds the price rule: a part or another figure is its refusal, said
 * under the amount, since it names the price to record.
 */
export function bookingErrors(values: BookingValues): FieldMessages {
  const amount = values.amount;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return { amount: [$localize`Enter the amount received.`] };
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return { amount: [$localize`Use at most two decimals.`] };
  }
  return {};
}

/** A refusal and where it is said: under the field it is about, or in the form's summary. */
export interface Refusal {
  readonly field: string | null;
  readonly message: string;
}

/** A 400 about one of `fields`, in the server's words, which are written for the staff. */
function fieldRefusal(error: unknown, fields: readonly string[]): Refusal | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return null;
  const errors = (error.error as { errors?: Record<string, string[]> } | null)?.errors;
  for (const field of fields) {
    const pascal = field.charAt(0).toUpperCase() + field.slice(1);
    const message = errors?.[field]?.[0] ?? errors?.[pascal]?.[0];
    if (message) return { field, message };
  }
  return null;
}

export function bookingRefusal(error: unknown, firstName: string): Refusal {
  const field = fieldRefusal(error, ['amount', 'reference']);
  if (field) return field;
  // The server's sentence fits a booking, which has no first day to move; the shared one says to pick one.
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { code?: string; message?: string } | null;
    if (body?.code === 'entitlement_overlap' && body.message) {
      return { field: null, message: body.message };
    }
  }
  return {
    field: null,
    message: serviceWriteError(
      error,
      $localize`The plan could not be booked. Try again.`,
      firstName,
    ),
  };
}

/** The ask was booked or closed meanwhile, so what the page lists of it is out of date. */
export function askEnded(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.error as { code?: string } | null)?.code === 'house_plan_ask_ended'
  );
}

export function closingRefusal(error: unknown, firstName: string): Refusal {
  return (
    fieldRefusal(error, ['reason']) ?? {
      field: null,
      message: serviceWriteError(
        error,
        $localize`The ask could not be closed. Try again.`,
        firstName,
      ),
    }
  );
}
