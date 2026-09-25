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
  PricePlanView,
  WorkspaceBillingStatus,
  WorkspaceBillingView,
  WorkspaceDiscountView,
} from '../../core/api/generated';

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

export interface WorkspaceBilling {
  status: BillingStatus;
  trialEndsAtUtc: string;
  currentMonth: BillingEstimate;
  invoices: BillingInvoice[];
  unpaidTotal: number;
  currencyCode: string;
  readOnlyFrom: string | null;
  whishNumber: string | null;
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

export interface AdminWorkspaceDetail {
  summary: AdminWorkspace;
  currentMonth: BillingEstimate;
  invoices: BillingInvoice[];
  discounts: BillingDiscount[];
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
  };
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

export function toAdminWorkspaceDetail(value: ContractAdminWorkspaceDetail): AdminWorkspaceDetail {
  return {
    summary: toAdminWorkspace(value.summary),
    currentMonth: toEstimate(value.currentMonth),
    invoices: value.invoices.map(toInvoice),
    discounts: value.discounts.map(toDiscount),
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
