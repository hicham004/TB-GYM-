import { formatDate, formatNumber } from '@angular/common';
import type {
  ClientEnrollment,
  CoachingFeature,
  ManualPaymentMethod,
  PaymentRecord,
  ProductCatalog,
} from '../../core/api/api.models';
import type { StatusPillTone } from '../../ui/status-pill';
import type { ClientAction } from './client-actions';
import {
  currentEnrollment,
  daysBetween,
  RENEWAL_PROMPT_DAYS,
  renewalPrompt,
} from './client-overview.models';

/**
 * A client's Service & access (C3, R3.4b): their plans, what each includes, what has been paid, and
 * what the coach can do about it. Pure functions of the server's answers and the workspace's own
 * date, so every rule here has a fixed test. The server decides every change again (SUB-006 to
 * SUB-008); this only spares the coach a trip to a refusal and says why something is not possible.
 */

export interface ServiceContext {
  readonly locale: string;
  /** The workspace's today, `YYYY-MM-DD`; never the browser's. */
  readonly today: string;
  readonly firstName: string;
}

export interface PlanFact {
  readonly text: string;
  readonly warm: boolean;
}

export interface PlanPill {
  readonly label: string;
  readonly tone: StatusPillTone;
}

export interface PaymentLine {
  readonly id: string;
  /** "Mon 28 Sep" */
  readonly date: string;
  /** "USD 150" */
  readonly amount: string;
  /** "Cash · ref 2231" */
  readonly detail: string;
  readonly note: string | null;
}

/** The plan in front of the coach, as the page's header and its payments. */
export interface PlanCard {
  readonly id: string;
  readonly productId: string;
  readonly offerId: string;
  /** "Online Coaching" */
  readonly name: string;
  /** "Current plan", "Starts Mon 12 Oct", "Ended Fri 23 Oct" or "Cancelled". */
  readonly eyebrow: string;
  readonly pill: PlanPill;
  /** Dates, length and price, the payment state and any reason it was paused or cancelled. */
  readonly facts: readonly PlanFact[];
  /** "Training", "Nutrition"…: what the plan includes. */
  readonly includes: readonly string[];
  /** "USD 150 of 330 paid", "Paid in full" or "Free". */
  readonly paidText: string;
  /** Identifies the dated purchase these receipts belong to, even after renewal. */
  readonly paymentContext: string;
  /** How much of the price is paid, 0 to 100, for the bar. */
  readonly paidPercent: number;
  readonly payments: readonly PaymentLine[];
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly lastActiveDate: string;
  readonly currency: string;
  readonly price: number;
  readonly balance: number;
  readonly version: number;
  /** Waiting for a payment it can still take: not over, not cancelled. */
  readonly canPay: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canCancel: boolean;
  /** Past its last day, or cancelled: nothing about it can change any more (SUB-006). */
  readonly over: boolean;
  readonly cancelled: boolean;
  readonly free: boolean;
}

const FEATURE_ORDER: readonly CoachingFeature[] = [
  'Training',
  'Nutrition',
  'CheckIns',
  'Messaging',
  'ResourceLibrary',
];

export function featureLabel(feature: CoachingFeature): string {
  switch (feature) {
    case 'Training':
      return $localize`Training`;
    case 'Nutrition':
      return $localize`Nutrition`;
    case 'CheckIns':
      return $localize`Check-ins`;
    case 'Messaging':
      return $localize`Messaging`;
    case 'ResourceLibrary':
      return $localize`Resources`;
  }
}

/** The plan's features in one fixed order, so two plans read alike. */
export function featureLabels(features: readonly CoachingFeature[]): string[] {
  return FEATURE_ORDER.filter((feature) => features.includes(feature)).map(featureLabel);
}

export function paymentMethodLabel(method: ManualPaymentMethod): string {
  switch (method) {
    case 'Cash':
      return $localize`Cash`;
    case 'BankTransfer':
      return $localize`Bank transfer`;
    case 'Card':
      return $localize`Card`;
    case 'MobileWallet':
      return $localize`Mobile wallet`;
    case 'Other':
      return $localize`Other`;
  }
}

/** "USD 330", "USD 82.50": the currency code first, as Lebanon reads both USD and LBP. */
export function money(amount: number, currency: string, locale: string): string {
  return `${currency} ${formatNumber(amount, locale, Number.isInteger(amount) ? '1.0-0' : '1.2-2')}`;
}

export function shortDate(date: string, locale: string): string {
  return formatDate(date, 'EEE d MMM', locale);
}

function dateRange(start: string, lastDay: string, context: ServiceContext): string {
  const thisYear = context.today.slice(0, 4);
  const sameYear = start.slice(0, 4) === thisYear && lastDay.slice(0, 4) === thisYear;
  const pattern = sameYear ? 'EEE d MMM' : 'd MMM y';
  return $localize`${formatDate(start, pattern, context.locale)}:from: – ${formatDate(lastDay, pattern, context.locale)}:to:`;
}

function isOver(plan: ClientEnrollment, today: string): boolean {
  return plan.storedStatus === 'Cancelled' || today >= plan.endDateExclusive;
}

function daysLeftPill(plan: ClientEnrollment, today: string): PlanPill {
  const left = daysBetween(today, plan.lastActiveDate);
  if (left <= 0) return { label: $localize`Ends today`, tone: 'warm' };
  if (left === 1) return { label: $localize`Ends tomorrow`, tone: 'warm' };
  if (left <= RENEWAL_PROMPT_DAYS) {
    return { label: $localize`Ends in ${left}:count: days`, tone: 'warm' };
  }
  return { label: $localize`Active · ${left}:count: days left`, tone: 'success' };
}

function startsPill(plan: ClientEnrollment, today: string): PlanPill {
  const until = daysBetween(today, plan.startDate);
  return until === 1
    ? { label: $localize`Starts tomorrow`, tone: 'info' }
    : { label: $localize`Starts in ${until}:count: days`, tone: 'info' };
}

/** The words for where a plan stands, from its stored and effective state (SUB-006). */
function planState(
  plan: ClientEnrollment,
  context: ServiceContext,
): { eyebrow: string; pill: PlanPill } {
  const { today, locale } = context;
  const starts = $localize`Starts ${shortDate(plan.startDate, locale)}:date:`;
  if (plan.storedStatus === 'Cancelled') {
    return {
      eyebrow: $localize`Cancelled`,
      pill: { label: $localize`Cancelled`, tone: 'neutral' },
    };
  }
  if (today >= plan.endDateExclusive) {
    return {
      eyebrow: $localize`Ended ${shortDate(plan.lastActiveDate, locale)}:date:`,
      pill: { label: $localize`Ended`, tone: 'neutral' },
    };
  }
  const eyebrow = today < plan.startDate ? starts : $localize`Current plan`;
  if (plan.effectiveStatus === 'Blocked') {
    return { eyebrow, pill: { label: $localize`Access blocked`, tone: 'danger' } };
  }
  if (plan.storedStatus === 'PendingPayment') {
    return { eyebrow, pill: { label: $localize`Waiting for payment`, tone: 'warm' } };
  }
  if (plan.storedStatus === 'Paused') {
    return { eyebrow, pill: { label: $localize`Paused`, tone: 'warning' } };
  }
  return {
    eyebrow,
    pill: today < plan.startDate ? startsPill(plan, today) : daysLeftPill(plan, today),
  };
}

function paymentLine(payment: PaymentRecord, locale: string): PaymentLine {
  const parts = [paymentMethodLabel(payment.method)];
  if (payment.reference) parts.push($localize`ref ${payment.reference}:reference:`);
  return {
    id: payment.id,
    date: formatDate(payment.receivedAtUtc, 'EEE d MMM y', locale),
    amount: money(payment.amount, payment.currencyCode, locale),
    detail: parts.join(' · '),
    note: payment.note,
  };
}

export function planCard(plan: ClientEnrollment, context: ServiceContext): PlanCard {
  const { locale, today } = context;
  const state = planState(plan, context);
  const free = plan.priceAmount === 0;
  const over = isOver(plan, today);
  const price = money(plan.priceAmount, plan.priceCurrency, locale);
  const paidText = free
    ? $localize`Free`
    : plan.balanceAmount <= 0
      ? $localize`Paid in full`
      : plan.paidAmount <= 0
        ? $localize`Not paid yet`
        : $localize`${money(plan.paidAmount, plan.priceCurrency, locale)}:paid: of ${formatNumber(plan.priceAmount, locale, '1.0-2')}:price: paid`;
  const facts: PlanFact[] = [
    { text: dateRange(plan.startDate, plan.lastActiveDate, context), warm: false },
    {
      text: $localize`${plan.offerLabel}:option: · ${free ? $localize`Free` : price}:price:`,
      warm: false,
    },
  ];
  if (!free) {
    facts.push({
      text: paidText,
      warm: plan.balanceAmount > 0 && plan.storedStatus !== 'Cancelled',
    });
  }
  if (plan.statusReason && (plan.storedStatus === 'Paused' || plan.storedStatus === 'Cancelled')) {
    facts.push({ text: $localize`Reason: ${plan.statusReason}:reason:`, warm: false });
  }
  const payments = [...plan.payments]
    .filter((payment) => payment.operation === 'Receipt')
    .sort((a, b) => b.receivedAtUtc.localeCompare(a.receivedAtUtc))
    .map((payment) => paymentLine(payment, locale));
  return {
    id: plan.id,
    productId: plan.productId,
    offerId: plan.offerId,
    name: plan.productName,
    eyebrow: state.eyebrow,
    pill: state.pill,
    facts,
    includes: featureLabels(plan.features),
    paidText,
    paymentContext: `${plan.productName} · ${dateRange(plan.startDate, plan.lastActiveDate, context)}`,
    paidPercent: free
      ? 100
      : Math.max(0, Math.min(100, Math.round((plan.paidAmount / plan.priceAmount) * 100))),
    payments,
    startDate: plan.startDate,
    endDateExclusive: plan.endDateExclusive,
    lastActiveDate: plan.lastActiveDate,
    currency: plan.priceCurrency,
    price: plan.priceAmount,
    balance: Math.max(0, plan.balanceAmount),
    version: plan.version,
    canPay: !over && plan.storedStatus === 'PendingPayment' && plan.balanceAmount > 0,
    canPause: !over && plan.storedStatus === 'Active',
    canResume: !over && plan.storedStatus === 'Paused',
    canCancel: !over,
    over,
    cancelled: plan.storedStatus === 'Cancelled',
    free,
  };
}

// ------------------------------------------------------------------------------------------------
// Which plan, and the others
// ------------------------------------------------------------------------------------------------

/** The plan the page opens on: the one the header describes (current, next, else the latest). */
export function focusPlanId(plans: readonly ClientEnrollment[], today: string): string | null {
  return currentEnrollment(plans, today)?.id ?? null;
}

export interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly range: string;
  readonly summary: string;
  readonly pill: PlanPill;
}

function planRow(plan: ClientEnrollment, context: ServiceContext): PlanRow {
  const card = planCard(plan, context);
  return {
    id: plan.id,
    name: plan.productName,
    range: dateRange(plan.startDate, plan.lastActiveDate, context),
    summary: card.free
      ? $localize`${plan.offerLabel}:option: · Free`
      : `${plan.offerLabel} · ${card.paidText}`,
    pill: card.pill,
  };
}

/**
 * Every plan but the one in front: those running or still to come, soonest first, then the earlier
 * ones, newest first. Cancelled plans are history however their dates fall.
 */
export function otherPlans(
  plans: readonly ClientEnrollment[],
  focusId: string | null,
  context: ServiceContext,
): { coming: PlanRow[]; earlier: PlanRow[] } {
  const rest = plans.filter((plan) => plan.id !== focusId);
  const live = (plan: ClientEnrollment) => !isOver(plan, context.today);
  return {
    coming: rest
      .filter(live)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((plan) => planRow(plan, context)),
    earlier: rest
      .filter((plan) => !live(plan))
      .sort((a, b) => b.endDateExclusive.localeCompare(a.endDateExclusive))
      .map((plan) => planRow(plan, context)),
  };
}

// ------------------------------------------------------------------------------------------------
// What the coach can do
// ------------------------------------------------------------------------------------------------

/** The price options a coach can sell now: active plans and options only (SUB-002). */
export interface OfferChoice {
  readonly offerId: string;
  readonly productId: string;
  /** "Online Coaching · 12 weeks" */
  readonly label: string;
  /** "USD 330 · Training, Nutrition, Check-ins, Messaging" */
  readonly detail: string;
  readonly days: number;
  readonly price: number;
  readonly currency: string;
  readonly features: readonly CoachingFeature[];
  /** Features this option may cover alongside another plan for the same feature (SUB-004). */
  readonly concurrent: readonly CoachingFeature[];
}

export function offerChoices(
  catalog: ProductCatalog | null,
  locale: string,
  productId: string | null = null,
): OfferChoice[] {
  if (!catalog) return [];
  return catalog.products
    .filter((product) => product.isActive && (productId === null || product.id === productId))
    .flatMap((product) =>
      product.offers
        .filter((offer) => offer.isActive)
        .map((offer) => {
          const features = offer.features.map((item) => item.feature);
          const price =
            offer.priceAmount === 0
              ? $localize`Free`
              : money(offer.priceAmount, offer.priceCurrency, locale);
          return {
            offerId: offer.id,
            productId: product.id,
            label: `${product.name} · ${offer.label}`,
            detail: [price, featureLabels(features).join(', ')].join(' · '),
            days: offer.durationUnit === 'Week' ? offer.durationCount * 7 : offer.durationCount,
            price: offer.priceAmount,
            currency: offer.priceCurrency,
            features,
            concurrent: offer.features
              .filter((item) => item.allowsConcurrentCoverage)
              .map((item) => item.feature),
          };
        }),
    );
}

export type ServiceActionId = 'start' | 'renew' | 'pay' | 'pause' | 'resume' | 'cancel';

/** The one filled button for the plan in front, or null when nothing needs the coach. */
export interface PrimaryAction {
  readonly id: ServiceActionId;
  readonly label: string;
}

/**
 * What needs the coach first, in that order: money owed on a plan that can still take it, a paused
 * plan, then a plan to renew (ending within the prompt window, over with nothing after it, or the
 * plan the client asked to renew while nothing follows it yet).
 */
export function primaryAction(
  card: PlanCard | null,
  plans: readonly ClientEnrollment[],
  context: ServiceContext,
  renewalAsked: boolean,
): PrimaryAction | null {
  if (!card) return { id: 'start', label: $localize`Start a plan` };
  if (card.canPay) return { id: 'pay', label: $localize`Record payment` };
  if (card.canResume) return { id: 'resume', label: $localize`Resume plan` };
  const prompt = renewalPrompt(plans, context.today);
  const nothingAfter = !plans.some(
    (plan) =>
      plan.id !== card.id && !isOver(plan, context.today) && plan.startDate >= context.today,
  );
  const renew =
    prompt?.enrollment.id === card.id ||
    (renewalAsked && nothingAfter) ||
    (card.over && !card.cancelled && nothingAfter);
  return renew ? { id: 'renew', label: $localize`Renew plan` } : null;
}

/**
 * Manage plan: everything else a coach can do about the plan in front, and starting another. What
 * cannot be done stays in the list with its reason, so the coach is never left guessing.
 */
export function planMenu(
  card: PlanCard | null,
  primary: PrimaryAction | null,
  renewable: boolean,
): ClientAction[] {
  const items: ClientAction[] = [];
  const add = (item: ClientAction & { action: ServiceActionId }) => {
    if (primary?.id !== item.action) items.push(item);
  };
  if (card) {
    if (!card.free && card.balance > 0 && !card.over) {
      add(
        card.canPay
          ? {
              label: $localize`Record payment`,
              hint: $localize`Cash, transfer or wallet`,
              action: 'pay',
            }
          : {
              label: $localize`Record payment`,
              hint: $localize`Possible while the plan is waiting for payment`,
              action: 'pay',
              disabled: true,
            },
      );
    }
    add(
      renewable
        ? {
            label: $localize`Renew plan`,
            hint: $localize`A new plan that follows this one`,
            action: 'renew',
          }
        : {
            label: $localize`Renew plan`,
            hint: $localize`None of this plan’s price options is offered now`,
            action: 'renew',
            disabled: true,
          },
    );
    if (card.canResume) {
      add({
        label: $localize`Resume plan`,
        hint: $localize`Open everything it includes again`,
        action: 'resume',
      });
    } else if (!card.over) {
      add(
        card.canPause
          ? {
              label: $localize`Pause plan`,
              hint: $localize`It still ends on its last day`,
              action: 'pause',
            }
          : {
              label: $localize`Pause plan`,
              hint: $localize`Possible once it is paid`,
              action: 'pause',
              disabled: true,
            },
      );
    }
    if (card.canCancel) {
      add({
        label: $localize`Cancel plan`,
        hint: $localize`Closes it from today`,
        action: 'cancel',
      });
    }
  }
  add({
    label: $localize`Start another plan`,
    hint: $localize`Another plan or an add-on`,
    action: 'start',
  });
  return items;
}

// ------------------------------------------------------------------------------------------------
// The client's renewal request (ADR 0029)
// ------------------------------------------------------------------------------------------------

/**
 * The client asks to renew only once their whole plan has run out (SUB-014), so a request is about
 * the plan that ended (`subjectId`) and stands until a plan follows it.
 */
export interface RenewalRequest {
  readonly since: string;
  readonly subjectId: string | null;
}

/** Whether the request is about this plan: the one it names, else any plan that is over. */
export function renewalAskedFor(request: RenewalRequest | null, card: PlanCard | null): boolean {
  if (!request || !card) return false;
  return request.subjectId ? request.subjectId === card.id : card.over;
}

/** "Maya asked to renew on Mon 5 Oct", from the attention read the Overview already uses. */
export function renewalAskedLine(
  since: string | null,
  firstName: string,
  locale: string,
): string | null {
  return since
    ? $localize`${firstName}:name: asked to renew on ${formatDate(since, 'EEE d MMM', locale)}:date:`
    : null;
}

/** Where a new plan or a renewal starts by default: after the plan it follows, never before today. */
export function defaultPlanStart(today: string, follows: ClientEnrollment | null): string {
  return follows && follows.endDateExclusive > today ? follows.endDateExclusive : today;
}
