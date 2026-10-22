import { describe, expect, it } from 'vitest';
import type {
  AdminWorkspaceSummary,
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
import { amounts, invoice } from '../../../testing/platform-admin-fixtures';
import {
  billingStatusLabel,
  billingStatusTone,
  billLines,
  formatDay,
  formatMoney,
  formatMonth,
  invoicePrices,
  invoiceStatusLabel,
  invoiceStatusTone,
  isUnpaid,
  toAdminWorkspace,
  toAdminWorkspaceDetail,
  toAmounts,
  toDiscount,
  toEstimate,
  toInvoice,
  toPayment,
  toPricePlan,
  toWorkspaceBilling,
} from './billing.models';

/** The minus sign a discount line carries, which is not a hyphen. */
const MINUS = String.fromCharCode(0x2212);

/** The API's JSON: a decimal may arrive as a string, so no cent is lost on the way. */
const AMOUNTS_VIEW: BillingAmountsView = {
  seats: '3',
  billableClients: 17,
  includedClients: '15',
  extraClients: '2',
  seatAmount: '45.00',
  extraClientAmount: '4.10',
  gymFeeAmount: 10,
  subtotal: '59.10',
  discountPercent: '12.5',
  discountAmount: '7.39',
  total: '51.71',
  currencyCode: 'USD',
};

const AMOUNTS = {
  seats: 3,
  billableClients: 17,
  includedClients: 15,
  extraClients: 2,
  seatAmount: 45,
  extraClientAmount: 4.1,
  gymFeeAmount: 10,
  subtotal: 59.1,
  discountPercent: 12.5,
  discountAmount: 7.39,
  total: 51.71,
  currencyCode: 'USD',
};

const PAYMENT_VIEW: PlatformPaymentView = {
  id: 'payment-1',
  invoiceId: 'invoice-1',
  amount: '51.71',
  currencyCode: 'USD',
  reference: 'WHISH-88214',
  note: 'Paid at the Hamra shop',
  receivedOn: '2026-10-06',
  recordedAtUtc: '2026-10-07T10:00:00Z',
};

function invoiceView(overrides: Partial<PlatformInvoiceView> = {}): PlatformInvoiceView {
  return {
    id: 'invoice-1',
    referenceCode: 'TBG-202609-KX4P7Q',
    periodStart: '2026-09-01',
    periodEndExclusive: '2026-10-01',
    usageFromUtc: '2026-09-01T00:00:00Z',
    issuedAtUtc: '2026-10-01T00:10:00Z',
    dueOn: '2026-10-08',
    readOnlyFrom: '2026-10-15',
    pricePlanVersion: '2',
    calculationName: 'platform-invoice-v1',
    planSeatPrice: '15.00',
    planIncludedClientsPerSeat: '5',
    planExtraClientPrice: '2.05',
    planGymFee: 10,
    planGymFeeMinimumSeats: '2',
    amounts: AMOUNTS_VIEW,
    status: 'Paid',
    locksWorkspace: false,
    payment: PAYMENT_VIEW,
    voidedAtUtc: null,
    voidReason: null,
    replacesInvoiceId: 'invoice-0',
    replacedByInvoiceId: null,
    ...overrides,
  };
}

/** What `toInvoice` makes of `invoiceView()`: numbers for display, nothing the screens do not read. */
const INVOICE = {
  id: 'invoice-1',
  referenceCode: 'TBG-202609-KX4P7Q',
  periodStart: '2026-09-01',
  periodEndExclusive: '2026-10-01',
  usageFromUtc: '2026-09-01T00:00:00Z',
  issuedAtUtc: '2026-10-01T00:10:00Z',
  dueOn: '2026-10-08',
  readOnlyFrom: '2026-10-15',
  pricePlanVersion: 2,
  planSeatPrice: 15,
  planIncludedClientsPerSeat: 5,
  planExtraClientPrice: 2.05,
  planGymFee: 10,
  planGymFeeMinimumSeats: 2,
  amounts: AMOUNTS,
  status: 'Paid',
  locksWorkspace: false,
  payment: {
    id: 'payment-1',
    amount: 51.71,
    currencyCode: 'USD',
    reference: 'WHISH-88214',
    note: 'Paid at the Hamra shop',
    receivedOn: '2026-10-06',
    recordedAtUtc: '2026-10-07T10:00:00Z',
  },
  voidedAtUtc: null,
  voidReason: null,
  replacesInvoiceId: 'invoice-0',
  replacedByInvoiceId: null,
};

const ESTIMATE_VIEW: CurrentMonthEstimateView = {
  periodStart: '2026-10-01',
  periodEndExclusive: '2026-11-01',
  usageFromUtc: '2026-10-01T00:00:00Z',
  usageToUtc: '2026-10-09T12:00:00Z',
  inTrial: false,
  pricePlanVersion: '2',
  amounts: AMOUNTS_VIEW,
};

const ESTIMATE = {
  periodStart: '2026-10-01',
  usageFromUtc: '2026-10-01T00:00:00Z',
  usageToUtc: '2026-10-09T12:00:00Z',
  inTrial: false,
  pricePlanVersion: 2,
  amounts: AMOUNTS,
};

const SUMMARY_VIEW: AdminWorkspaceSummary = {
  tenantId: 'tenant-atlas',
  name: 'Atlas Performance',
  ownerName: 'Karim Atlas',
  ownerEmail: 'karim@atlas.example',
  createdAtUtc: '2026-06-01T09:00:00Z',
  status: 'Overdue',
  trialEndsAtUtc: '2026-07-01T09:00:00Z',
  seatsThisMonth: '3',
  billableClientsThisMonth: '14',
  unpaidTotal: '55.05',
  currencyCode: 'USD',
  currentDiscountPercent: '12.5',
  oldestUnpaidDueOn: '2026-10-05',
  readOnlyFrom: '2026-10-12',
};

const SUMMARY = {
  tenantId: 'tenant-atlas',
  name: 'Atlas Performance',
  ownerName: 'Karim Atlas',
  ownerEmail: 'karim@atlas.example',
  createdAtUtc: '2026-06-01T09:00:00Z',
  status: 'Overdue',
  trialEndsAtUtc: '2026-07-01T09:00:00Z',
  seatsThisMonth: 3,
  billableClientsThisMonth: 14,
  unpaidTotal: 55.05,
  currencyCode: 'USD',
  currentDiscountPercent: 12.5,
  oldestUnpaidDueOn: '2026-10-05',
  readOnlyFrom: '2026-10-12',
};

const DISCOUNT_VIEW: WorkspaceDiscountView = {
  id: 'discount-1',
  percent: '12.5',
  startsOn: '2026-09-01',
  endsOnExclusive: '2026-12-01',
  note: 'Founding coach',
  grantedAtUtc: '2026-09-01T08:00:00Z',
  revokedAtUtc: null,
};

/**
 * Runs `check` with every `Intl.DateTimeFormat` that names no zone of its own on Los Angeles's clock, west
 * of UTC, where midnight UTC on the 1st is still the last day of the month before. The process's own zone
 * stays as it is (Date's getters, `toLocaleDateString` and Angular's `formatDate` read that one), so this
 * proves the billing formatters name UTC, not that no code anywhere reads the device's day.
 */
function onDeviceWestOfUtc(check: () => void): void {
  const device = Intl.DateTimeFormat;
  const west = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new device(locales, { timeZone: 'America/Los_Angeles', ...options });
  };
  Object.defineProperty(Intl, 'DateTimeFormat', {
    value: west,
    configurable: true,
    writable: true,
  });
  try {
    check();
  } finally {
    Object.defineProperty(Intl, 'DateTimeFormat', {
      value: device,
      configurable: true,
      writable: true,
    });
  }
}

describe('platform billing: what the API said, as numbers', () => {
  it('reads every amount the API sent as a string or a number, cents and all', () => {
    const read = toAmounts(AMOUNTS_VIEW);

    expect(read).toEqual(AMOUNTS);
    expect(formatMoney(read.total, read.currencyCode, 'en-US')).toBe('$51.71');
    expect(formatMoney(read.extraClientAmount, read.currencyCode, 'en-US')).toBe('$4.10');
  });

  it('keeps a payment as it was recorded, its amount as a number', () => {
    expect(toPayment(PAYMENT_VIEW)).toEqual(INVOICE.payment);
  });

  it('reads an invoice with the prices it was issued at, its payment and what replaced what', () => {
    expect(toInvoice(invoiceView())).toEqual(INVOICE);
    expect(toInvoice(invoiceView({ status: 'Open', payment: null })).payment).toBeNull();
  });

  it('reads the month so far with its plan version and amounts', () => {
    expect(toEstimate(ESTIMATE_VIEW)).toEqual(ESTIMATE);
  });

  it('reads a workspace’s billing with where to pay, from Whish to the support inbox', () => {
    const view: WorkspaceBillingView = {
      status: 'Overdue',
      trialEndsAtUtc: '2026-07-01T09:00:00Z',
      currentMonth: ESTIMATE_VIEW,
      invoices: [invoiceView({ status: 'Overdue', payment: null })],
      unpaidTotal: '51.71',
      currencyCode: 'USD',
      readOnlyFrom: '2026-10-15',
      paymentInstructions: {
        whishNumber: null,
        supportEmail: 'billing@tbgym.example',
        whatsAppNumber: '+96170123456',
      },
    };

    expect(toWorkspaceBilling(view)).toEqual({
      status: 'Overdue',
      trialEndsAtUtc: '2026-07-01T09:00:00Z',
      currentMonth: ESTIMATE,
      invoices: [{ ...INVOICE, status: 'Overdue', payment: null }],
      unpaidTotal: 51.71,
      currencyCode: 'USD',
      readOnlyFrom: '2026-10-15',
      whishNumber: null,
      supportEmail: 'billing@tbgym.example',
      whatsAppNumber: '+96170123456',
    });
  });

  it('reads a coaching space for the platform admin, its counts and money as numbers', () => {
    expect(toAdminWorkspace(SUMMARY_VIEW)).toEqual(SUMMARY);
    expect(toDiscount(DISCOUNT_VIEW)).toEqual({ ...DISCOUNT_VIEW, percent: 12.5 });
    expect(
      toAdminWorkspaceDetail({
        summary: SUMMARY_VIEW,
        currentMonth: ESTIMATE_VIEW,
        invoices: [invoiceView()],
        discounts: [DISCOUNT_VIEW],
      }),
    ).toEqual({
      summary: SUMMARY,
      currentMonth: ESTIMATE,
      invoices: [INVOICE],
      discounts: [{ ...DISCOUNT_VIEW, percent: 12.5 }],
    });
  });

  it('reads a price plan version with every term as a number', () => {
    const view: PricePlanView = {
      id: 'plan-2',
      versionNumber: '2',
      currencyCode: 'USD',
      seatPrice: '15.50',
      includedClientsPerSeat: '5',
      extraClientPrice: '2.05',
      gymFee: 10,
      gymFeeMinimumSeats: '2',
      trialDays: '30',
      paymentTermDays: '7',
      graceDays: '7',
      note: null,
      publishedAtUtc: '2026-09-20T09:00:00Z',
      isCurrent: true,
    };

    expect(toPricePlan(view)).toEqual({
      id: 'plan-2',
      versionNumber: 2,
      currencyCode: 'USD',
      seatPrice: 15.5,
      includedClientsPerSeat: 5,
      extraClientPrice: 2.05,
      gymFee: 10,
      gymFeeMinimumSeats: 2,
      trialDays: 30,
      paymentTermDays: 7,
      graceDays: 7,
      note: null,
      publishedAtUtc: '2026-09-20T09:00:00Z',
      isCurrent: true,
    });
  });
});

describe('platform billing: months, days and money in words', () => {
  it('names a billing month and day on UTC’s calendar, even on a device west of UTC', () => {
    onDeviceWestOfUtc(() => {
      // The device's own clock would put midnight UTC on 1 July in June.
      expect(
        new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
          new Date('2026-07-01T00:00:00Z'),
        ),
      ).toBe('June 2026');

      expect(formatMonth('2026-07-01', 'en-US')).toBe('July 2026');
      expect(formatMonth('2026-07-01T00:10:00Z', 'en-US')).toBe('July 2026');
      expect(formatDay('2026-07-01', 'en-US')).toBe('Jul 1, 2026');
      // Half past midnight UTC is still the 14th in Los Angeles.
      expect(formatDay('2026-10-15T00:30:00Z', 'en-US')).toBe('Oct 15, 2026');
    });
  });

  it('writes money in its currency’s own style, cents included where it has them', () => {
    expect(formatMoney(55, 'USD', 'en-US')).toBe('$55.00');
    expect(formatMoney(38.5, 'USD', 'en-US')).toBe('$38.50');
    expect(formatMoney(1234.5, 'EUR', 'en-US')).toBe('€1,234.50');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
  });

  it('names each invoice status and gives it its tone', () => {
    const statuses: PlatformInvoiceStatus[] = ['Open', 'Overdue', 'Paid', 'Void', 'NothingToPay'];

    expect(
      statuses.map((status) => [status, invoiceStatusLabel(status), invoiceStatusTone(status)]),
    ).toEqual([
      ['Open', 'Awaiting payment', 'warning'],
      ['Overdue', 'Overdue', 'danger'],
      ['Paid', 'Paid', 'success'],
      ['Void', 'Void', 'neutral'],
      ['NothingToPay', 'Nothing to pay', 'success'],
    ]);
  });

  it('names each workspace billing status and gives it its tone', () => {
    const statuses: WorkspaceBillingStatus[] = ['Trial', 'Active', 'Overdue', 'ReadOnly'];

    expect(
      statuses.map((status) => [status, billingStatusLabel(status), billingStatusTone(status)]),
    ).toEqual([
      ['Trial', 'Free trial', 'neutral'],
      ['Active', 'Active', 'success'],
      ['Overdue', 'Overdue', 'warning'],
      ['ReadOnly', 'Read-only until paid', 'danger'],
    ]);
  });

  it('says only invoices still open or overdue ask for money', () => {
    const statuses: PlatformInvoiceStatus[] = ['Open', 'Overdue', 'Paid', 'Void', 'NothingToPay'];

    expect(statuses.filter((status) => isUnpaid(invoice({ status })))).toEqual(['Open', 'Overdue']);
  });
});

describe('platform billing: a bill line by line', () => {
  const full = amounts({
    seats: 3,
    billableClients: 17,
    includedClients: 15,
    extraClients: 2,
    seatAmount: 45,
    extraClientAmount: 4,
    gymFeeAmount: 10,
    subtotal: 59,
    discountPercent: 30,
    discountAmount: 17.7,
    total: 41.3,
  });

  it('lists the month so far as amounts alone: seats, clients, and the fee and discount only when there are any', () => {
    expect(
      billLines(
        amounts({
          seats: 1,
          billableClients: 4,
          includedClients: 5,
          seatAmount: 15,
          gymFeeAmount: 0,
          subtotal: 15,
          total: 15,
        }),
        'en-US',
      ),
    ).toEqual([
      { label: '1 seat', amount: '$15.00' },
      { label: 'Clients with a plan: 4, 5 included with your seats', amount: '$0.00' },
    ]);

    expect(billLines(full, 'en-US')).toEqual([
      { label: '3 seats', amount: '$45.00' },
      { label: 'Clients with a plan: 17, 15 included with your seats', amount: '$4.00' },
      { label: 'Gym fee', amount: '$10.00' },
      { label: 'Discount (30%)', amount: `${MINUS}$17.70`, discount: true },
    ]);
  });

  it('says how each line of an issued invoice was worked out, from the prices it kept', () => {
    const issued = invoice({
      planSeatPrice: 15,
      planExtraClientPrice: 2,
      planGymFeeMinimumSeats: 2,
      amounts: full,
    });

    expect(billLines(issued.amounts, 'en-US', invoicePrices(issued))).toEqual([
      { label: 'Seats: 3 × $15.00', amount: '$45.00' },
      {
        label: 'Clients with a plan: 17, 15 included with your seats, 2 more × $2.00',
        amount: '$4.00',
      },
      { label: 'Gym fee, from 2 seats', amount: '$10.00' },
      { label: 'Discount (30%)', amount: `${MINUS}$17.70`, discount: true },
    ]);
  });

  it('works an invoice out at its own prices, not today’s, and names no extra clients when there are none', () => {
    const issued = invoice({
      planSeatPrice: 12,
      planExtraClientPrice: 3,
      planGymFeeMinimumSeats: 4,
      amounts: amounts({
        seats: 1,
        billableClients: 5,
        includedClients: 5,
        extraClients: 0,
        seatAmount: 12,
        extraClientAmount: 0,
        gymFeeAmount: 0,
        subtotal: 12,
        total: 12,
      }),
    });

    expect(invoicePrices(issued)).toEqual({
      seatPrice: 12,
      extraClientPrice: 3,
      gymFeeMinimumSeats: 4,
    });
    expect(billLines(issued.amounts, 'en-US', invoicePrices(issued))).toEqual([
      { label: 'Seats: 1 × $12.00', amount: '$12.00' },
      { label: 'Clients with a plan: 5, 5 included with your seats', amount: '$0.00' },
    ]);
  });
});
