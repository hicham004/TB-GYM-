import type {
  AdminWorkspace,
  AdminWorkspaceDetail,
  BillingAmounts,
  BillingClientGrant,
  BillingDiscount,
  BillingInvoice,
  PricePlan,
} from '../app/features/billing/billing.models';
import type {
  AdminFounding,
  FoundingBadge,
  FoundingRecord,
  FoundingTerms,
} from '../app/features/billing/founding.models';
import type { GymRequest } from '../app/features/platform-admin/platform-admin-api';
import type {
  CertificateCoach,
  CertificateLine,
  CertificateLines,
} from '../app/features/platform-admin/platform-coaches.models';

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
    // Where the included clients came from (notes plan N11a): the seats' alone, a plain space.
    seatIncludedClients: 15,
    foundingIncludedClients: 0,
    grantedIncludedClients: 0,
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
    isFounding: false,
    badgeEarnedOn: null,
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
      isFounding: true,
      badgeEarnedOn: '2026-10-01',
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
    foundingSeatIncludedClients: null,
    foundingTermsVersion: null,
    grantedIncludedClients: 0,
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
 * Extra included clients (notes plan N11a): 7 clients for September to November, running on TODAY.
 * Test figures are this file's own, never the owners' offer.
 */
export function clientGrant(overrides: Partial<BillingClientGrant> = {}): BillingClientGrant {
  return {
    id: 'grant-1',
    clients: 7,
    startsOn: '2026-09-01',
    endsOnExclusive: '2026-12-01',
    note: 'Brought Karim Haddad',
    grantedAtUtc: '2026-09-02T08:00:00Z',
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
    founding: null,
    foundingHistory: [],
    includedClientGrants: [],
    priceHold: null,
    ...overrides,
  };
}

/**
 * The Founding coach badge (notes plan N3b): Atlas's open founding status, read as waiting with 7 of
 * 10 clients and 1 of 2 months, under version 1 of the terms. Every number is the server's.
 */
export function foundingBadge(overrides: Partial<FoundingBadge> = {}): FoundingBadge {
  return {
    state: 'Waiting',
    foundingSince: '2026-09-15',
    clientsWithActivePlan: 7,
    clientsNeeded: 10,
    monthsSinceStart: 1,
    monthsNeeded: 2,
    termsVersion: 1,
    earnedOn: null,
    endedOn: null,
    hidden: false,
    ...overrides,
  };
}

export function foundingRecord(overrides: Partial<FoundingRecord> = {}): FoundingRecord {
  return {
    id: 'founding-1',
    foundingSince: '2026-09-15',
    note: 'One of the first ten coaches',
    markedAtUtc: '2026-09-15T10:00:00Z',
    earnedOn: null,
    earnedUnderTermsVersion: null,
    earnedClientCount: null,
    badgeHidden: false,
    endedAtUtc: null,
    endReason: null,
    ...overrides,
  };
}

/**
 * Atlas's open founding status as waiting, or as earned on 3 October with 11 clients; its owner's
 * seat includes `seat` clients while it stays founding (notes plan N11a), none by default.
 */
export function adminFounding(
  state: 'Waiting' | 'Earned' = 'Waiting',
  hidden = false,
  seat: number | null = null,
): AdminFounding {
  return state === 'Waiting'
    ? {
        status: foundingRecord({ badgeHidden: hidden }),
        badge: foundingBadge({ hidden }),
        foundingSeatIncludedClients: seat,
      }
    : {
        foundingSeatIncludedClients: seat,
        status: foundingRecord({
          earnedOn: '2026-10-03',
          earnedUnderTermsVersion: 1,
          earnedClientCount: 11,
          badgeHidden: hidden,
        }),
        badge: foundingBadge({
          state: 'Earned',
          clientsWithActivePlan: null,
          monthsSinceStart: null,
          earnedOn: '2026-10-03',
          hidden,
        }),
      };
}

/** An earlier founding status, ended for cause on 20 August. */
export function endedFounding(overrides: Partial<FoundingRecord> = {}): FoundingRecord {
  return foundingRecord({
    id: 'founding-0',
    foundingSince: '2026-06-01',
    note: 'Marked by mistake',
    markedAtUtc: '2026-06-01T09:00:00Z',
    endedAtUtc: '2026-08-20T09:00:00Z',
    endReason: 'The coach asked to leave the founding group',
    ...overrides,
  });
}

export function foundingTerms(overrides: Partial<FoundingTerms> = {}): FoundingTerms {
  return {
    id: 'terms-1',
    versionNumber: 1,
    clientsWithActivePlan: 10,
    monthsSinceStart: 2,
    note: null,
    publishedAtUtc: '2026-09-01T00:00:00Z',
    isCurrent: true,
    foundingSeatIncludedClients: null,
    priceGuaranteeMonths: null,
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

/**
 * Talk-to-us requests whose email has not reached the admin (audit BEB-1), newest first as the API
 * lists them: one waiting while email is off, one given up after its four tries.
 */
export function gymRequests(): GymRequest[] {
  return [
    {
      id: 'request-2',
      name: 'Rami Tabet',
      gymName: 'Oakline Strength',
      contact: '+96170123456',
      contactKind: 'WhatsApp',
      message: ['Six coaches, about 90 clients.', 'We start in January.'].join(
        String.fromCharCode(10),
      ),
      receivedAtUtc: '2026-10-08T15:30:00Z',
      deadLettered: false,
      sending: false,
      attemptCount: 0,
    },
    {
      id: 'request-1',
      name: 'Nadine Saliba',
      gymName: 'Cedar Barbell Club',
      contact: 'nadine@cedar.example',
      contactKind: 'Email',
      message: null,
      receivedAtUtc: '2026-10-02T08:05:00Z',
      deadLettered: true,
      sending: false,
      attemptCount: 4,
    },
  ];
}

// ---------- the certificate record (notes plan N4a) ----------

export const COACH_IDS = {
  karim: '20000000-0000-4000-8000-000000000001',
  lea: '20000000-0000-4000-8000-000000000002',
  nadine: '20000000-0000-4000-8000-000000000003',
  omar: '20000000-0000-4000-8000-000000000004',
  sami: '20000000-0000-4000-8000-000000000005',
} as const;

/** One membership on the Coaches list: Karim Haddad, the owner of Atlas Performance, with no lines. */
export function certificateCoach(overrides: Partial<CertificateCoach> = {}): CertificateCoach {
  return {
    userId: COACH_IDS.karim,
    name: 'Karim Haddad',
    email: 'karim@atlas.example',
    tenantId: SPACE_IDS.atlas,
    spaceName: 'Atlas Performance',
    role: 'Owner',
    isActiveStaff: true,
    waitingLines: 0,
    confirmedLines: 0,
    takenDownLines: 0,
    erasedLines: 0,
    ...overrides,
  };
}

/**
 * The list as the server orders it, by name then space, one row per membership: an owner with a line
 * in every state, a coach with none, a former coach who still holds a line, a coach of two spaces,
 * and an owner whose lines were all erased, with an Arabic name.
 */
export function certificateCoaches(): CertificateCoach[] {
  return [
    certificateCoach({ waitingLines: 1, confirmedLines: 1, takenDownLines: 1, erasedLines: 1 }),
    certificateCoach({
      userId: COACH_IDS.lea,
      name: 'Lea Khoury',
      email: 'lea@atlas.example',
      role: 'Coach',
    }),
    certificateCoach({
      userId: COACH_IDS.nadine,
      name: 'Nadine Saliba',
      email: 'nadine@atlas.example',
      role: 'Coach',
      isActiveStaff: false,
      confirmedLines: 1,
    }),
    certificateCoach({
      userId: COACH_IDS.omar,
      name: 'Omar Nassar',
      email: 'omar@atlas.example',
      role: 'Coach',
      waitingLines: 1,
    }),
    certificateCoach({
      userId: COACH_IDS.omar,
      name: 'Omar Nassar',
      email: 'omar@atlas.example',
      tenantId: SPACE_IDS.beirut,
      spaceName: 'Beirut Barbell',
      role: 'Coach',
    }),
    certificateCoach({
      userId: COACH_IDS.sami,
      name: 'سامي الخوري',
      email: 'sami@arz.example',
      tenantId: SPACE_IDS.arz,
      spaceName: 'نادي الأرز',
      erasedLines: 2,
    }),
  ];
}

/**
 * A line waiting for confirmation: Karim owns a gym, shown to TB Gym on 8 October. Whether clients
 * read it follows the line, as the server's does (confirmed and switched on), unless a test says
 * otherwise, as for a coach who left the space.
 */
export function certificateLine(overrides: Partial<CertificateLine> = {}): CertificateLine {
  const line: CertificateLine = {
    id: 'line-gym',
    state: 'Waiting',
    text: 'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
    what: 'Owns Iron House gym in Hamra',
    shownOn: '2026-10-08',
    wordingVersion: 1,
    recordedByName: 'Hicham Haddad',
    recordedAtUtc: '2026-10-08T09:00:00Z',
    recordedOn: '2026-10-08',
    confirmedAtUtc: null,
    confirmedOn: null,
    confirmedByName: null,
    takenDownAtUtc: null,
    takenDownOn: null,
    takenDownByName: null,
    erasedAtUtc: null,
    erasedOn: null,
    erasureReason: null,
    requestedOn: null,
    erasedByName: null,
    coachShows: true,
    shownToClients: false,
    version: 1,
    ...overrides,
  };
  return {
    ...line,
    shownToClients: overrides.shownToClients ?? (line.state === 'Confirmed' && line.coachShows),
  };
}

/** Confirmed on 2 October by the trainer partner, recorded by the admin. */
export function confirmedLine(overrides: Partial<CertificateLine> = {}): CertificateLine {
  return certificateLine({
    id: 'line-nasm',
    state: 'Confirmed',
    text: 'NASM CPT, 2019, shown to TB Gym on 1 Oct 2026',
    what: 'NASM CPT, 2019',
    shownOn: '2026-10-01',
    recordedAtUtc: '2026-10-01T10:00:00Z',
    recordedOn: '2026-10-01',
    confirmedAtUtc: '2026-10-02T08:30:00Z',
    confirmedOn: '2026-10-02',
    confirmedByName: 'Tarek Bou',
    version: 2,
    ...overrides,
  });
}

/** Confirmed and recorded by the admin in August, then taken down on 20 August. */
export function takenDownLine(overrides: Partial<CertificateLine> = {}): CertificateLine {
  return certificateLine({
    id: 'line-years',
    state: 'TakenDown',
    text: 'Six years coaching, shown to TB Gym on 10 Aug 2026',
    what: 'Six years coaching',
    shownOn: '2026-08-10',
    recordedAtUtc: '2026-08-10T10:00:00Z',
    recordedOn: '2026-08-10',
    confirmedAtUtc: '2026-08-11T10:00:00Z',
    confirmedOn: '2026-08-11',
    confirmedByName: 'Hicham Haddad',
    takenDownAtUtc: '2026-08-20T10:00:00Z',
    takenDownOn: '2026-08-20',
    takenDownByName: 'Hicham Haddad',
    version: 3,
    ...overrides,
  });
}

/** Erased on 2 July at the coach's request of 1 July: the words are gone, the dates stay. */
export function erasedLine(overrides: Partial<CertificateLine> = {}): CertificateLine {
  return certificateLine({
    id: 'line-erased',
    state: 'Erased',
    text: null,
    what: null,
    shownOn: null,
    recordedAtUtc: '2026-06-10T10:00:00Z',
    recordedOn: '2026-06-10',
    confirmedAtUtc: '2026-06-11T10:00:00Z',
    confirmedOn: '2026-06-11',
    confirmedByName: null,
    erasedAtUtc: '2026-07-02T10:00:00Z',
    erasedOn: '2026-07-02',
    erasureReason: 'Request',
    requestedOn: '2026-07-01',
    erasedByName: 'Hicham Haddad',
    version: 3,
    ...overrides,
  });
}

/** Karim's lines in Atlas Performance, newest first, on the space's day TODAY. */
export function certificateLines(overrides: Partial<CertificateLines> = {}): CertificateLines {
  return {
    userId: COACH_IDS.karim,
    name: 'Karim Haddad',
    email: 'karim@atlas.example',
    tenantId: SPACE_IDS.atlas,
    spaceName: 'Atlas Performance',
    role: 'Owner',
    isActiveStaff: true,
    spaceToday: TODAY,
    lines: [certificateLine(), confirmedLine(), takenDownLine(), erasedLine()],
    ...overrides,
  };
}

/** The server's refusal of a line holding a word TB Gym keeps out (a 400 on the field). */
export const CERTIFICATE_WORD_REFUSAL =
  "This line holds a word TB Gym keeps out of a coach's line. Write what the proof is: the certificate, the gym, the years.";
