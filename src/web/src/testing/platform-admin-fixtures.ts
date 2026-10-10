import type {
  AdminWorkspace,
  AdminWorkspaceDetail,
  BillingAmounts,
  BillingDiscount,
  BillingInvoice,
  PricePlan,
} from '../app/features/billing/billing.models';

/**
 * Platform billing (R5.2b): the coaching spaces the platform admin sees, in every state the screen
 * has to tell apart, on the fixed day TODAY. The objects have the API's own JSON shape, so a
 * Playwright check can answer a request with them as they are.
 */

export const TODAY = '2026-10-09';
export const NOW = '2026-10-09T12:00:00Z';

export const SPACE_IDS = {
  cedar: '10000000-0000-4000-8000-000000000001',
  atlas: '10000000-0000-4000-8000-000000000002',
  beirut: '10000000-0000-4000-8000-000000000003',
  nour: '10000000-0000-4000-8000-000000000004',
  strength: '10000000-0000-4000-8000-000000000005',
  maya: '10000000-0000-4000-8000-000000000006',
  arz: '10000000-0000-4000-8000-000000000007',
} as const;

export function amounts(overrides: Partial<BillingAmounts> = {}): BillingAmounts {
  return {
    seats: 3,
    billableClients: 14,
    includedClients: 15,
    extraClients: 0,
    seatAmount: 45,
    extraClientAmount: 0,
    gymFeeAmount: 10,
    subtotal: 55,
    discountPercent: 0,
    discountAmount: 0,
    total: 55,
    currencyCode: 'USD',
    ...overrides,
  };
}

export function space(overrides: Partial<AdminWorkspace> = {}): AdminWorkspace {
  return {
    tenantId: SPACE_IDS.atlas,
    name: 'Atlas Performance',
    ownerName: 'Karim Atlas',
    ownerEmail: 'karim@atlas.example',
    createdAtUtc: '2026-06-01T09:00:00Z',
    status: 'Active',
    trialEndsAtUtc: '2026-07-01T09:00:00Z',
    seatsThisMonth: 3,
    billableClientsThisMonth: 14,
    unpaidTotal: 0,
    currencyCode: 'USD',
    currentDiscountPercent: 0,
    oldestUnpaidDueOn: null,
    readOnlyFrom: null,
    ...overrides,
  };
}

/**
 * Seven spaces, one for each thing the list has to say: locked, overdue, owing but not yet due, paid
 * up with a discount, a trial ending in three days, a trial with time left, and a paid-up space
 * with an Arabic name.
 */
export function platformSpaces(): AdminWorkspace[] {
  return [
    space({
      tenantId: SPACE_IDS.nour,
      name: 'Nour Fitness',
      ownerName: 'Nour Khoury',
      ownerEmail: 'nour@nourfitness.example',
      seatsThisMonth: 1,
      billableClientsThisMonth: 6,
      currentDiscountPercent: 30,
    }),
    space({
      tenantId: SPACE_IDS.maya,
      name: 'Maya Rahme Coaching',
      ownerName: 'Maya Rahme',
      ownerEmail: 'maya@rahme.example',
      status: 'Trial',
      trialEndsAtUtc: '2026-10-29T09:00:00Z',
      createdAtUtc: '2026-09-29T09:00:00Z',
      seatsThisMonth: 1,
      billableClientsThisMonth: 1,
    }),
    space({
      tenantId: SPACE_IDS.beirut,
      name: 'Beirut Barbell',
      ownerName: 'Rami Tabet',
      ownerEmail: 'rami@beirutbarbell.example',
      seatsThisMonth: 2,
      billableClientsThisMonth: 9,
      unpaidTotal: 30,
      oldestUnpaidDueOn: '2026-10-14',
      readOnlyFrom: '2026-10-21',
    }),
    space({
      tenantId: SPACE_IDS.cedar,
      name: 'Cedar Barbell Club',
      ownerName: 'Olivia Haddad',
      ownerEmail: 'olivia@cedarbarbell.example',
      status: 'ReadOnly',
      seatsThisMonth: 3,
      billableClientsThisMonth: 22,
      unpaidTotal: 70,
      oldestUnpaidDueOn: '2026-09-24',
      readOnlyFrom: '2026-10-01',
    }),
    space({
      tenantId: SPACE_IDS.atlas,
      status: 'Overdue',
      unpaidTotal: 55,
      oldestUnpaidDueOn: '2026-10-05',
      readOnlyFrom: '2026-10-12',
    }),
    space({
      tenantId: SPACE_IDS.strength,
      name: 'Strength Lab',
      ownerName: 'Sara Mansour',
      ownerEmail: 'sara@strengthlab.example',
      status: 'Trial',
      trialEndsAtUtc: '2026-10-12T09:00:00Z',
      createdAtUtc: '2026-09-12T09:00:00Z',
      seatsThisMonth: 1,
      billableClientsThisMonth: 2,
    }),
    space({
      tenantId: SPACE_IDS.arz,
      name: 'نادي الأرز',
      ownerName: 'سامي الخوري',
      ownerEmail: 'sami@arz.example',
      seatsThisMonth: 2,
      billableClientsThisMonth: 11,
    }),
  ];
}

export function invoice(overrides: Partial<BillingInvoice> = {}): BillingInvoice {
  return {
    id: 'invoice-sep',
    referenceCode: 'TBG-202609-KX4P7Q',
    periodStart: '2026-09-01',
    periodEndExclusive: '2026-10-01',
    usageFromUtc: '2026-09-01T00:00:00Z',
    issuedAtUtc: '2026-10-01T00:10:00Z',
    dueOn: '2026-10-08',
    readOnlyFrom: '2026-10-15',
    pricePlanVersion: 1,
    planSeatPrice: 15,
    planIncludedClientsPerSeat: 5,
    planExtraClientPrice: 2,
    planGymFee: 10,
    planGymFeeMinimumSeats: 2,
    amounts: amounts(),
    status: 'Overdue',
    locksWorkspace: false,
    payment: null,
    voidedAtUtc: null,
    voidReason: null,
    replacesInvoiceId: null,
    replacedByInvoiceId: null,
    ...overrides,
  };
}

export function discount(overrides: Partial<BillingDiscount> = {}): BillingDiscount {
  return {
    id: 'discount-1',
    percent: 30,
    startsOn: '2026-09-01',
    endsOnExclusive: '2026-12-01',
    note: 'Founding coach',
    grantedAtUtc: '2026-09-01T08:00:00Z',
    revokedAtUtc: null,
    ...overrides,
  };
}

/**
 * Atlas: September is unpaid and overdue, August was paid, July was voided and replaced by a
 * corrected invoice, and a founding-coach discount is running.
 */
export function atlasDetail(overrides: Partial<AdminWorkspaceDetail> = {}): AdminWorkspaceDetail {
  const summary = platformSpaces().find((item) => item.tenantId === SPACE_IDS.atlas)!;
  return {
    summary,
    currentMonth: {
      periodStart: '2026-10-01',
      usageFromUtc: '2026-10-01T00:00:00Z',
      usageToUtc: '2026-10-09T12:00:00Z',
      inTrial: false,
      pricePlanVersion: 1,
      amounts: amounts({ seats: 3, billableClients: 14 }),
    },
    invoices: [
      invoice(),
      invoice({
        id: 'invoice-aug',
        referenceCode: 'TBG-202608-M2D8RT',
        periodStart: '2026-08-01',
        periodEndExclusive: '2026-09-01',
        issuedAtUtc: '2026-09-01T00:10:00Z',
        dueOn: '2026-09-08',
        readOnlyFrom: '2026-09-15',
        status: 'Paid',
        payment: {
          id: 'payment-aug',
          amount: 55,
          currencyCode: 'USD',
          reference: 'WHISH-88214',
          note: 'Paid at the Hamra shop',
          receivedOn: '2026-09-06',
          recordedAtUtc: '2026-09-07T10:00:00Z',
        },
      }),
      invoice({
        id: 'invoice-jul',
        referenceCode: 'TBG-202607-A9C3VW',
        periodStart: '2026-07-01',
        periodEndExclusive: '2026-08-01',
        issuedAtUtc: '2026-08-01T00:10:00Z',
        dueOn: '2026-08-08',
        readOnlyFrom: '2026-08-15',
        status: 'Void',
        voidedAtUtc: '2026-08-03T09:00:00Z',
        voidReason: 'The founding discount was applied late',
        replacedByInvoiceId: 'invoice-jul-2',
      }),
      invoice({
        id: 'invoice-jul-2',
        referenceCode: 'TBG-202607-HH6E2N',
        periodStart: '2026-07-01',
        periodEndExclusive: '2026-08-01',
        issuedAtUtc: '2026-08-03T09:00:00Z',
        dueOn: '2026-08-10',
        readOnlyFrom: '2026-08-17',
        status: 'Paid',
        amounts: amounts({ discountPercent: 30, discountAmount: 16.5, total: 38.5 }),
        replacesInvoiceId: 'invoice-jul',
        payment: {
          id: 'payment-jul',
          amount: 38.5,
          currencyCode: 'USD',
          reference: 'WHISH-77120',
          note: null,
          receivedOn: '2026-08-05',
          recordedAtUtc: '2026-08-05T11:00:00Z',
        },
      }),
    ],
    discounts: [
      discount(),
      discount({
        id: 'discount-0',
        percent: 10,
        startsOn: '2026-06-01',
        endsOnExclusive: '2026-09-01',
        note: 'Launch month',
        revokedAtUtc: '2026-06-20T09:00:00Z',
      }),
    ],
    ...overrides,
  };
}

export function plan(overrides: Partial<PricePlan> = {}): PricePlan {
  return {
    id: 'plan-2',
    versionNumber: 2,
    currencyCode: 'USD',
    seatPrice: 15,
    includedClientsPerSeat: 5,
    extraClientPrice: 2,
    gymFee: 10,
    gymFeeMinimumSeats: 2,
    trialDays: 30,
    paymentTermDays: 7,
    graceDays: 7,
    note: 'Launch prices',
    publishedAtUtc: '2026-09-20T09:00:00Z',
    isCurrent: true,
    ...overrides,
  };
}

/** Newest first, as the API lists them. */
export function pricePlans(): PricePlan[] {
  return [
    plan(),
    plan({
      id: 'plan-1',
      versionNumber: 1,
      seatPrice: 12,
      note: 'Placeholder',
      publishedAtUtc: '2026-09-01T09:00:00Z',
      isCurrent: false,
    }),
  ];
}
