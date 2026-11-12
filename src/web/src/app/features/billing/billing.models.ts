import { toNumber } from '../../core/api/api-client';
import { formatBillingDay } from './billing-access';
import type {
  AdminWorkspaceDetail as ContractAdminWorkspaceDetail,
  AdminWorkspaceSummary as ContractAdminWorkspaceSummary,
  BillingAmountsView,
  CurrentMonthEstimateView,
  PlatformInvoiceStatus,
  PlatformInvoiceView,
  PlatformPaymentView,
  IncludedClientGrantView,
  PricePlanView,
  WorkspaceBillingDiscountView,
  WorkspaceBillingIncludedClientGrantView,
  WorkspaceBillingStatus,
  WorkspaceBillingView,
  WorkspaceDiscountView,
} from '../../core/api/generated';
import {
  toAdminFounding,
  toFoundingRecord,
  toNullableNumber,
  type AdminFounding,
  type FoundingRecord,
} from './founding.models';

/**
 * Owned view models for platform billing (ADR 0028). Every amount and total is calculated by the API;
 * these only carry what it said, as numbers, for display.
 */
export type BillingStatus = WorkspaceBillingStatus;
export type InvoiceStatus = PlatformInvoiceStatus;

export interface BillingAmounts {
  seats: number;
  billableClients: number;
  includedClients: number;
  extraClients: number;
  seatAmount: number;
  extraClientAmount: number;
  gymFeeAmount: number;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  currencyCode: string;
  /**
   * Where the included clients came from (notes plan N11a), adding up to `includedClients`: the
   * seats', what a founding seat adds over the plan's seat, and the grants' extra clients.
   */
  seatIncludedClients: number;
  foundingIncludedClients: number;
  grantedIncludedClients: number;
}

export interface BillingPayment {
  id: string;
  amount: number;
  currencyCode: string;
  reference: string;
  note: string | null;
  receivedOn: string;
  recordedAtUtc: string;
}

export interface BillingInvoice {
  id: string;
  referenceCode: string;
  periodStart: string;
  periodEndExclusive: string;
  usageFromUtc: string;
  issuedAtUtc: string;
  dueOn: string;
  readOnlyFrom: string;
  pricePlanVersion: number;
  planSeatPrice: number;
  planIncludedClientsPerSeat: number;
  planExtraClientPrice: number;
  planGymFee: number;
  planGymFeeMinimumSeats: number;
  /** The founding seat's number and its terms version this invoice counted; null when none applied. */
  foundingSeatIncludedClients: number | null;
  foundingTermsVersion: number | null;
  /** The extra clients of the grants it counted; 0 when none. */
  grantedIncludedClients: number;
  amounts: BillingAmounts;
  status: InvoiceStatus;
  locksWorkspace: boolean;
  payment: BillingPayment | null;
  voidedAtUtc: string | null;
  voidReason: string | null;
  replacesInvoiceId: string | null;
  replacedByInvoiceId: string | null;
}

export interface BillingEstimate {
  periodStart: string;
  usageFromUtc: string;
  usageToUtc: string;
  inTrial: boolean;
  pricePlanVersion: number;
  amounts: BillingAmounts;
}

/**
 * A discount as the owner's Billing page names it (notes plan N7): TB Gym's admin's note as its name,
 * its rate and its UTC days, all the API's. `endsOnExclusive` is only compared, never counted from.
 */
export interface OwnerDiscount {
  readonly name: string;
  readonly percent: number;
  readonly startsOn: string;
  readonly lastDay: string;
  readonly endsOnExclusive: string;
  /** It has not begun on the server's day. */
  readonly startsLater: boolean;
}

/**
 * Extra included clients TB Gym granted, as the owner's Billing page names them (notes plan N11b):
 * how many and the grant's UTC days, all the API's; never the admin's note.
 */
export interface OwnerClientGrant {
  readonly clients: number;
  readonly startsOn: string;
  readonly lastDay: string;
  readonly endsOnExclusive: string;
  /** It has not begun on the server's day. */
  readonly startsLater: boolean;
}

export interface WorkspaceBilling {
  status: BillingStatus;
  trialEndsAtUtc: string;
  currentMonth: BillingEstimate;
  invoices: BillingInvoice[];
  unpaidTotal: number;
  currencyCode: string;
  readOnlyFrom: string | null;
  whishNumber: string | null;
  /** TB Gym's support inbox, to ask for the payment details while no Whish number is set (BILL-2). */
  supportEmail: string | null;
  /** TB Gym's WhatsApp number, for the same. */
  whatsAppNumber: string | null;
  /** The unrevoked discounts running or still to come, oldest first; an ended one is only on its invoices. */
  discounts: readonly OwnerDiscount[];
  /** What the owner's own seat includes as a founding space, when above the plan's seat; else null. */
  foundingSeatIncludedClients: number | null;
  /** The unrevoked grants of extra included clients running or still to come, oldest first. */
  includedClientGrants: readonly OwnerClientGrant[];
}

export interface AdminWorkspace {
  tenantId: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  createdAtUtc: string;
  status: BillingStatus;
  trialEndsAtUtc: string;
  seatsThisMonth: number;
  billableClientsThisMonth: number;
  unpaidTotal: number;
  currencyCode: string;
  currentDiscountPercent: number;
  /** The earliest due day among its unpaid invoices, and the day it goes read-only; null when nothing is owed. */
  oldestUnpaidDueOn: string | null;
  readOnlyFrom: string | null;
  /** Whether the space has an open founding status (PBL-009), and the day its badge was earned. */
  isFounding: boolean;
  badgeEarnedOn: string | null;
}

export interface BillingDiscount {
  id: string;
  percent: number;
  startsOn: string;
  endsOnExclusive: string;
  note: string;
  grantedAtUtc: string;
  revokedAtUtc: string | null;
}

/** Extra included clients granted to a founding space for whole UTC months (notes plan N11a). */
export interface BillingClientGrant {
  id: string;
  clients: number;
  startsOn: string;
  endsOnExclusive: string;
  /** What it is for: TB Gym's admin alone reads it. */
  note: string;
  grantedAtUtc: string;
  revokedAtUtc: string | null;
}

export interface AdminWorkspaceDetail {
  summary: AdminWorkspace;
  currentMonth: BillingEstimate;
  invoices: BillingInvoice[];
  discounts: BillingDiscount[];
  /** The open founding status with the server's reading of its badge; null when there is none. */
  founding: AdminFounding | null;
  /** The ended founding statuses, kept as history. */
  foundingHistory: FoundingRecord[];
  /** Its grants of extra included clients, newest first, the revoked ones kept. */
  includedClientGrants: BillingClientGrant[];
}

export interface PricePlan {
  id: string;
  versionNumber: number;
  currencyCode: string;
  seatPrice: number;
  includedClientsPerSeat: number;
  extraClientPrice: number;
  gymFee: number;
  gymFeeMinimumSeats: number;
  trialDays: number;
  paymentTermDays: number;
  graceDays: number;
  note: string | null;
  publishedAtUtc: string;
  isCurrent: boolean;
}

export function toAmounts(value: BillingAmountsView): BillingAmounts {
  return {
    seats: toNumber(value.seats),
    billableClients: toNumber(value.billableClients),
    includedClients: toNumber(value.includedClients),
    extraClients: toNumber(value.extraClients),
    seatAmount: toNumber(value.seatAmount),
    extraClientAmount: toNumber(value.extraClientAmount),
    gymFeeAmount: toNumber(value.gymFeeAmount),
    subtotal: toNumber(value.subtotal),
    discountPercent: toNumber(value.discountPercent),
    discountAmount: toNumber(value.discountAmount),
    total: toNumber(value.total),
    currencyCode: value.currencyCode,
    seatIncludedClients: toNumber(value.seatIncludedClients),
    foundingIncludedClients: toNumber(value.foundingIncludedClients),
    grantedIncludedClients: toNumber(value.grantedIncludedClients),
  };
}

export function toPayment(value: PlatformPaymentView): BillingPayment {
  return {
    id: value.id,
    amount: toNumber(value.amount),
    currencyCode: value.currencyCode,
    reference: value.reference,
    note: value.note,
    receivedOn: value.receivedOn,
    recordedAtUtc: value.recordedAtUtc,
  };
}

export function toInvoice(value: PlatformInvoiceView): BillingInvoice {
  return {
    id: value.id,
    referenceCode: value.referenceCode,
    periodStart: value.periodStart,
    periodEndExclusive: value.periodEndExclusive,
    usageFromUtc: value.usageFromUtc,
    issuedAtUtc: value.issuedAtUtc,
    dueOn: value.dueOn,
    readOnlyFrom: value.readOnlyFrom,
    pricePlanVersion: toNumber(value.pricePlanVersion),
    planSeatPrice: toNumber(value.planSeatPrice),
    planIncludedClientsPerSeat: toNumber(value.planIncludedClientsPerSeat),
    planExtraClientPrice: toNumber(value.planExtraClientPrice),
    planGymFee: toNumber(value.planGymFee),
    planGymFeeMinimumSeats: toNumber(value.planGymFeeMinimumSeats),
    foundingSeatIncludedClients: toNullableNumber(value.foundingSeatIncludedClients),
    foundingTermsVersion: toNullableNumber(value.foundingTermsVersion),
    grantedIncludedClients: toNumber(value.grantedIncludedClients),
    amounts: toAmounts(value.amounts),
    status: value.status,
    locksWorkspace: value.locksWorkspace,
    payment: value.payment ? toPayment(value.payment) : null,
    voidedAtUtc: value.voidedAtUtc,
    voidReason: value.voidReason,
    replacesInvoiceId: value.replacesInvoiceId,
    replacedByInvoiceId: value.replacedByInvoiceId,
  };
}

export function toEstimate(value: CurrentMonthEstimateView): BillingEstimate {
  return {
    periodStart: value.periodStart,
    usageFromUtc: value.usageFromUtc,
    usageToUtc: value.usageToUtc,
    inTrial: value.inTrial,
    pricePlanVersion: toNumber(value.pricePlanVersion),
    amounts: toAmounts(value.amounts),
  };
}

export function toWorkspaceBilling(value: WorkspaceBillingView): WorkspaceBilling {
  return {
    status: value.status,
    trialEndsAtUtc: value.trialEndsAtUtc,
    currentMonth: toEstimate(value.currentMonth),
    invoices: value.invoices.map(toInvoice),
    unpaidTotal: toNumber(value.unpaidTotal),
    currencyCode: value.currencyCode,
    readOnlyFrom: value.readOnlyFrom,
    whishNumber: value.paymentInstructions.whishNumber,
    supportEmail: value.paymentInstructions.supportEmail,
    whatsAppNumber: value.paymentInstructions.whatsAppNumber,
    discounts: value.discounts.map(toOwnerDiscount),
    foundingSeatIncludedClients: toNullableNumber(value.foundingSeatIncludedClients),
    includedClientGrants: value.includedClientGrants.map(toOwnerClientGrant),
  };
}

export function toOwnerDiscount(value: WorkspaceBillingDiscountView): OwnerDiscount {
  return { ...value, percent: toNumber(value.percent) };
}

export function toOwnerClientGrant(
  value: WorkspaceBillingIncludedClientGrantView,
): OwnerClientGrant {
  return { ...value, clients: toNumber(value.clients) };
}

export function toAdminWorkspace(value: ContractAdminWorkspaceSummary): AdminWorkspace {
  return {
    ...value,
    seatsThisMonth: toNumber(value.seatsThisMonth),
    billableClientsThisMonth: toNumber(value.billableClientsThisMonth),
    unpaidTotal: toNumber(value.unpaidTotal),
    currentDiscountPercent: toNumber(value.currentDiscountPercent),
  };
}

export function toDiscount(value: WorkspaceDiscountView): BillingDiscount {
  return { ...value, percent: toNumber(value.percent) };
}

export function toClientGrant(value: IncludedClientGrantView): BillingClientGrant {
  return { ...value, clients: toNumber(value.clients) };
}

export function toAdminWorkspaceDetail(value: ContractAdminWorkspaceDetail): AdminWorkspaceDetail {
  return {
    summary: toAdminWorkspace(value.summary),
    currentMonth: toEstimate(value.currentMonth),
    invoices: value.invoices.map(toInvoice),
    discounts: value.discounts.map(toDiscount),
    founding: value.founding ? toAdminFounding(value.founding) : null,
    foundingHistory: value.foundingHistory.map(toFoundingRecord),
    includedClientGrants: value.includedClientGrants.map(toClientGrant),
  };
}

export function toPricePlan(value: PricePlanView): PricePlan {
  return {
    ...value,
    versionNumber: toNumber(value.versionNumber),
    seatPrice: toNumber(value.seatPrice),
    includedClientsPerSeat: toNumber(value.includedClientsPerSeat),
    extraClientPrice: toNumber(value.extraClientPrice),
    gymFee: toNumber(value.gymFee),
    gymFeeMinimumSeats: toNumber(value.gymFeeMinimumSeats),
    trialDays: toNumber(value.trialDays),
    paymentTermDays: toNumber(value.paymentTermDays),
    graceDays: toNumber(value.graceDays),
  };
}

/** A UTC calendar date as a short label, the same way the shell's billing banner shows one. */
export const formatDay = formatBillingDay;

/** The billing month an invoice or estimate is for, such as "July 2026". */
export function formatMonth(periodStart: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${periodStart.slice(0, 10)}T00:00:00Z`));
}

export function formatMoney(amount: number, currencyCode: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(
    amount,
  );
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'Open':
      return $localize`Awaiting payment`;
    case 'Overdue':
      return $localize`Overdue`;
    case 'Paid':
      return $localize`Paid`;
    case 'Void':
      return $localize`Void`;
    case 'NothingToPay':
      return $localize`Nothing to pay`;
  }
}

export function invoiceStatusTone(
  status: InvoiceStatus,
): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'Paid':
    case 'NothingToPay':
      return 'success';
    case 'Overdue':
      return 'danger';
    case 'Open':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function billingStatusLabel(status: BillingStatus): string {
  switch (status) {
    case 'Trial':
      return $localize`Free trial`;
    case 'Active':
      return $localize`Active`;
    case 'Overdue':
      return $localize`Overdue`;
    case 'ReadOnly':
      return $localize`Read-only until paid`;
  }
}

export function billingStatusTone(
  status: BillingStatus,
): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'Active':
      return 'success';
    case 'Trial':
      return 'neutral';
    case 'Overdue':
      return 'warning';
    case 'ReadOnly':
      return 'danger';
  }
}

export interface BillLine {
  readonly label: string;
  /** Formatted, with a minus sign for a discount. */
  readonly amount: string;
  readonly discount?: boolean;
}

/** The prices an issued invoice kept from its plan version, to show how each line was worked out. */
export interface BillPrices {
  readonly seatPrice: number;
  readonly extraClientPrice: number;
  readonly gymFeeMinimumSeats: number;
}

/**
 * A bill's lines in words, before its total: seats, clients with a plan, the gym fee when charged and
 * a discount when given. With an invoice's own prices each line says how it was worked out; the month
 * so far has only the amounts. Every number is the API's (ADR 0028); nothing is added up here.
 */
export function billLines(
  amounts: BillingAmounts,
  locale: string,
  prices: BillPrices | null = null,
): readonly BillLine[] {
  const money = (value: number) => formatMoney(value, amounts.currencyCode, locale);
  const lines: BillLine[] = [
    {
      label: prices
        ? $localize`Seats: ${amounts.seats}:seats: × ${money(prices.seatPrice)}:price:`
        : amounts.seats === 1
          ? $localize`1 seat`
          : $localize`${amounts.seats}:seats: seats`,
      amount: money(amounts.seatAmount),
    },
    { label: clientsLine(amounts, locale, prices), amount: money(amounts.extraClientAmount) },
  ];
  if (amounts.gymFeeAmount > 0) {
    lines.push({
      label: prices
        ? $localize`Gym fee, from ${prices.gymFeeMinimumSeats}:seats: seats`
        : $localize`Gym fee`,
      amount: money(amounts.gymFeeAmount),
    });
  }
  if (amounts.discountAmount > 0) {
    lines.push({
      label: $localize`Discount (${amounts.discountPercent}:percent:%)`,
      amount: `−${money(amounts.discountAmount)}`,
      discount: true,
    });
  }
  return lines;
}

/**
 * A bill's clients line: those with a plan, the clients its seats include and, with an invoice's own
 * prices, the extra ones at their price. When a founding seat or a grant counted (notes plan N11b) it
 * says where the included clients came from; a plain bill reads as it always has.
 */
export function clientsLine(
  amounts: BillingAmounts,
  locale: string,
  prices: BillPrices | null = null,
): string {
  const money = (value: number) => formatMoney(value, amounts.currencyCode, locale);
  const sources = includedSources(amounts);
  if (sources) {
    return amounts.extraClients > 0 && prices
      ? $localize`Clients with a plan: ${amounts.billableClients}:clients:, ${amounts.includedClients}:included: included: ${sources}:sources:, ${amounts.extraClients}:extra: more × ${money(prices.extraClientPrice)}:price:`
      : $localize`Clients with a plan: ${amounts.billableClients}:clients:, ${amounts.includedClients}:included: included: ${sources}:sources:`;
  }
  return amounts.extraClients > 0 && prices
    ? $localize`Clients with a plan: ${amounts.billableClients}:clients:, ${amounts.includedClients}:included: included with your seats, ${amounts.extraClients}:extra: more × ${money(prices.extraClientPrice)}:price:`
    : $localize`Clients with a plan: ${amounts.billableClients}:clients:, ${amounts.includedClients}:included: included with your seats`;
}

/**
 * Where a bill's included clients came from, each part only above zero: "15 with your seats, 12 more
 * as a founding space, 4 more granted". Null when the seats' alone counted, so a plain bill is
 * unchanged. Every number is the API's, which adds them up to the included clients.
 */
export function includedSources(amounts: BillingAmounts): string | null {
  if (amounts.foundingIncludedClients <= 0 && amounts.grantedIncludedClients <= 0) return null;
  const parts: string[] = [];
  if (amounts.seatIncludedClients > 0) {
    parts.push($localize`${amounts.seatIncludedClients}:seats: with your seats`);
  }
  if (amounts.foundingIncludedClients > 0) {
    parts.push($localize`${amounts.foundingIncludedClients}:founding: more as a founding space`);
  }
  if (amounts.grantedIncludedClients > 0) {
    parts.push($localize`${amounts.grantedIncludedClients}:granted: more granted`);
  }
  return parts.join($localize`, `);
}

/**
 * What the owner's seat includes as a founding space and each grant of extra included clients, one
 * sentence each (notes plan N11b): "As a founding coaching space, your own seat includes 25
 * clients." and "4 more clients included until Dec 31, 2026."; a grant still to come says from when.
 * Every number and day is the API's, which sends only what is running or to come; nothing is counted
 * here.
 */
export function includedClientSentences(
  foundingSeat: number | null,
  grants: readonly OwnerClientGrant[],
  locale: string,
): readonly string[] {
  const sentences: string[] = [];
  if (foundingSeat !== null) {
    sentences.push(
      foundingSeat === 1
        ? $localize`As a founding coaching space, your own seat includes 1 client.`
        : $localize`As a founding coaching space, your own seat includes ${foundingSeat}:clients: clients.`,
    );
  }
  for (const grant of grants) {
    const until = formatDay(grant.lastDay, locale);
    if (grant.startsLater) {
      const from = formatDay(grant.startsOn, locale);
      sentences.push(
        grant.clients === 1
          ? $localize`1 more client included from ${from}:from: until ${until}:until:.`
          : $localize`${grant.clients}:clients: more clients included from ${from}:from: until ${until}:until:.`,
      );
    } else {
      sentences.push(
        grant.clients === 1
          ? $localize`1 more client included until ${until}:until:.`
          : $localize`${grant.clients}:clients: more clients included until ${until}:until:.`,
      );
    }
  }
  return sentences;
}

/** One sentence of the owner's discount line: the name TB Gym's admin typed, and what it gives. */
export interface DiscountSentence {
  readonly name: string;
  /** What follows the name and its colon, such as "free until Dec 31, 2026, then the normal price." */
  readonly terms: string;
}

/**
 * The owner's discount line (notes plan N7): one sentence for each run of discounts that follow on, a
 * discount that starts the day the one before ends, named after the run's first: "free until <day>,
 * then 40% off until <day>, then the normal price." A run that has not begun says from when. Stretches
 * in a row at the same rate read as one, until the later last day. Every rate and day is the API's;
 * nothing is counted here.
 */
export function discountSentences(
  discounts: readonly OwnerDiscount[],
  locale: string,
): readonly DiscountSentence[] {
  const runs: OwnerDiscount[][] = [];
  for (const discount of discounts) {
    const run = runs.at(-1);
    const before = run?.at(-1);
    if (!run || !before || discount.startsOn !== before.endsOnExclusive) {
      runs.push([discount]);
    } else if (discount.percent === before.percent) {
      run[run.length - 1] = {
        ...before,
        lastDay: discount.lastDay,
        endsOnExclusive: discount.endsOnExclusive,
      };
    } else {
      run.push(discount);
    }
  }
  return runs.map((run) => {
    const clauses = run
      .map((stretch, index) => discountClause(stretch, index === 0, locale))
      .join($localize`, then `);
    return { name: run[0].name, terms: $localize`${clauses}:terms:, then the normal price.` };
  });
}

function discountClause(stretch: OwnerDiscount, first: boolean, locale: string): string {
  const until = formatDay(stretch.lastDay, locale);
  if (first && stretch.startsLater) {
    const from = formatDay(stretch.startsOn, locale);
    return stretch.percent === 100
      ? $localize`free from ${from}:from: until ${until}:until:`
      : $localize`${stretch.percent}:percent:% off from ${from}:from: until ${until}:until:`;
  }
  return stretch.percent === 100
    ? $localize`free until ${until}:until:`
    : $localize`${stretch.percent}:percent:% off until ${until}:until:`;
}

/** An invoice's own prices, as it was issued. */
export function invoicePrices(invoice: BillingInvoice): BillPrices {
  return {
    seatPrice: invoice.planSeatPrice,
    extraClientPrice: invoice.planExtraClientPrice,
    gymFeeMinimumSeats: invoice.planGymFeeMinimumSeats,
  };
}

/** Whether an invoice still asks for money. */
export function isUnpaid(invoice: BillingInvoice): boolean {
  return invoice.status === 'Open' || invoice.status === 'Overdue';
}
