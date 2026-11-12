import { toNumber } from '../../core/api/api-client';
import type {
  AdminFoundingView,
  FoundingBadgeState,
  FoundingBadgeView,
  FoundingStatusView,
  FoundingTermsView,
} from '../../core/api/generated';

/**
 * The Founding coach badge (notes plan N3b, PBL-009) as the screens show it. The server marks a
 * space as founding, reads its badge with the named rule `founding-badge-v1`, counts the clients and
 * the months, and records the day it was earned; these models only carry what it said, as numbers.
 * Nothing about the badge is decided here.
 */
export type FoundingState = FoundingBadgeState;

/** A space's badge as the server reads it today (PBL-009). */
export interface FoundingBadge {
  state: FoundingState;
  foundingSince: string | null;
  /** Clients with an active plan right now; null when the badge is not waiting. */
  clientsWithActivePlan: number | null;
  clientsNeeded: number;
  /** Whole months since the space started; null when the badge is not waiting. */
  monthsSinceStart: number | null;
  monthsNeeded: number;
  termsVersion: number;
  earnedOn: string | null;
  endedOn: string | null;
  hidden: boolean;
}

/** One founding mark, open or ended, as the platform admin's history keeps it. */
export interface FoundingRecord {
  id: string;
  foundingSince: string;
  note: string;
  markedAtUtc: string;
  earnedOn: string | null;
  earnedUnderTermsVersion: number | null;
  earnedClientCount: number | null;
  badgeHidden: boolean;
  endedAtUtc: string | null;
  endReason: string | null;
}

/** A space's open founding status with its live reading (the admin's space page). */
export interface AdminFounding {
  status: FoundingRecord;
  badge: FoundingBadge;
  /**
   * What its owner's seat includes while the status stays open (notes plan N11a): the founding
   * number in force when it is above the price plan's seat, else null.
   */
  foundingSeatIncludedClients: number | null;
}

/**
 * One published version of the founding terms, the newest in force: the badge's two thresholds, the
 * clients a founding space's owner seat includes (notes plan N11a) and the months its prices are held
 * after its last discount (notes plan N8), each null for none.
 */
export interface FoundingTerms {
  id: string;
  versionNumber: number;
  clientsWithActivePlan: number;
  monthsSinceStart: number;
  note: string | null;
  publishedAtUtc: string;
  isCurrent: boolean;
  foundingSeatIncludedClients: number | null;
  priceGuaranteeMonths: number | null;
}

/** The badge's name, the same everywhere it shows (the plan's Point 8). */
export const FOUNDING_COACH = $localize`Founding coach`;

/** The one line that always goes with the badge, so nobody reads it as a check of a coach. */
export const FOUNDING_COACH_LINE = $localize`One of the first coaches on TB Gym. Not a check of qualifications`;

export function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : toNumber(value);
}

export function toFoundingBadge(value: FoundingBadgeView): FoundingBadge {
  return {
    ...value,
    clientsWithActivePlan: toNullableNumber(value.clientsWithActivePlan),
    clientsNeeded: toNumber(value.clientsNeeded),
    monthsSinceStart: toNullableNumber(value.monthsSinceStart),
    monthsNeeded: toNumber(value.monthsNeeded),
    termsVersion: toNumber(value.termsVersion),
  };
}

export function toFoundingRecord(value: FoundingStatusView): FoundingRecord {
  return {
    ...value,
    earnedUnderTermsVersion: toNullableNumber(value.earnedUnderTermsVersion),
    earnedClientCount: toNullableNumber(value.earnedClientCount),
  };
}

export function toAdminFounding(value: AdminFoundingView): AdminFounding {
  return {
    status: toFoundingRecord(value.status),
    badge: toFoundingBadge(value.badge),
    foundingSeatIncludedClients: toNullableNumber(value.foundingSeatIncludedClients),
  };
}

export function toFoundingTerms(value: FoundingTermsView): FoundingTerms {
  return {
    ...value,
    versionNumber: toNumber(value.versionNumber),
    clientsWithActivePlan: toNumber(value.clientsWithActivePlan),
    monthsSinceStart: toNumber(value.monthsSinceStart),
    foundingSeatIncludedClients: toNullableNumber(value.foundingSeatIncludedClients),
    priceGuaranteeMonths: toNullableNumber(value.priceGuaranteeMonths),
  };
}

/** The version in force: the one the server marks current, else the newest. */
export function currentFoundingTerms(versions: readonly FoundingTerms[]): FoundingTerms | null {
  return (
    versions.find((terms) => terms.isCurrent) ??
    [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ??
    null
  );
}

/** Whether the space's owner should find the Founding coach page under Settings › Your account. */
export function showsFoundingPage(state: FoundingState | null | undefined): boolean {
  return state === 'Waiting' || state === 'Earned';
}

// ---------- the badge's terms in words ----------
// Every number below is the server's: the terms in force, or its live count. The sentences only
// choose between one and many, and leave out a wait of no months, which the terms allow (0 to 24).

/** "1 client" or "10 clients". */
export function clientCount(count: number): string {
  return count === 1 ? $localize`1 client` : $localize`${count}:count: clients`;
}

/** "1 month" or "2 months". */
export function monthCount(count: number): string {
  return count === 1 ? $localize`1 month` : $localize`${count}:count: months`;
}

/** The mark sheet's account of the terms in force, about the space being marked. */
export function markTermsSentence(clients: number, months: number): string {
  if (months === 0) {
    return clients === 1
      ? $localize`The badge is earned once 1 of the space’s clients has an active plan (the terms in force).`
      : $localize`The badge is earned once ${clients}:clients: of the space’s clients have an active plan (the terms in force).`;
  }
  return clients === 1
    ? $localize`The badge is earned once 1 of the space’s clients has an active plan and the space is ${monthCount(months)}:months: old (the terms in force).`
    : $localize`The badge is earned once ${clients}:clients: of the space’s clients have an active plan and the space is ${monthCount(months)}:months: old (the terms in force).`;
}

/** The list's account of the terms in force, about any founding space. */
export function termsSentence(clients: number, months: number): string {
  if (months === 0) {
    return clients === 1
      ? $localize`Earned once 1 of a founding space’s clients has an active plan.`
      : $localize`Earned once ${clients}:clients: of a founding space’s clients have an active plan.`;
  }
  return clients === 1
    ? $localize`Earned once 1 of a founding space’s clients has an active plan and the space is ${monthCount(months)}:months: old.`
    : $localize`Earned once ${clients}:clients: of a founding space’s clients have an active plan and the space is ${monthCount(months)}:months: old.`;
}

/** The owner's account of the terms their waiting badge is read against. */
export function ownerTermsSentence(clients: number, months: number): string {
  if (months === 0) {
    return clients === 1
      ? $localize`The badge is earned once 1 of your clients has an active plan.`
      : $localize`The badge is earned once ${clients}:clients: of your clients have an active plan.`;
  }
  return clients === 1
    ? $localize`The badge is earned once 1 of your clients has an active plan and your space is ${monthCount(months)}:months: old.`
    : $localize`The badge is earned once ${clients}:clients: of your clients have an active plan and your space is ${monthCount(months)}:months: old.`;
}

/** Where a waiting badge stands, for its owner: "So far: 7 of 10 clients, 1 of 2 months." */
export function ownerProgressLine(badge: FoundingBadge): string {
  const clients = $localize`${badge.clientsWithActivePlan ?? 0}:have: of ${clientCount(badge.clientsNeeded)}:needed:`;
  return badge.monthsNeeded === 0
    ? $localize`So far: ${clients}:clients:.`
    : $localize`So far: ${clients}:clients:, ${badge.monthsSinceStart ?? 0}:have: of ${monthCount(badge.monthsNeeded)}:needed:.`;
}

// ---------- the founding seat in words (notes plan N11b) ----------
// The number is the server's: the founding terms in force, or what a space's open status holds. A
// founding seat includes the larger of it and the price plan's seat (PBL-011), so a number at or below
// the plan's reads as the plan's seat, as the server reads it by sending none.

/** The founding number when it is above the plan's seat, or when the plan's is unknown; else null. */
function raisedSeat(founding: number | null, planSeat: number | null): number | null {
  return founding !== null && (planSeat === null || founding > planSeat) ? founding : null;
}

/** The admin's Founding panel: what the space's owner seat includes while it stays founding. */
export function foundingSeatLine(clients: number | null): string {
  return clients === null
    ? $localize`Its owner’s seat includes what the price plan’s seat includes: no founding number above it is published yet.`
    : $localize`Its owner’s seat includes ${clientCount(clients)}:clients: while it stays founding.`;
}

/**
 * The mark sheet's line: marking changes no access, and what the owner's seat includes while the
 * space stays founding, from the terms in force and the price plan's seat when they could be read.
 */
export function markSeatSentence(terms: FoundingTerms | null, planSeat: number | null): string {
  if (!terms) {
    return $localize`Marking changes no access. While the space stays founding, its owner’s seat includes what the terms in force give a founding seat.`;
  }
  const clients = raisedSeat(terms.foundingSeatIncludedClients, planSeat);
  return clients === null
    ? $localize`Marking changes no access. While the space stays founding, its owner’s seat includes what the price plan’s seat includes: no founding number above it is published yet.`
    : $localize`Marking changes no access. While the space stays founding, its owner’s seat includes ${clientCount(clients)}:clients: (the terms in force).`;
}

/** The list's account of the founding seat in the terms in force, about any founding space. */
export function termsSeatSentence(terms: FoundingTerms, planSeat: number | null): string {
  const clients = raisedSeat(terms.foundingSeatIncludedClients, planSeat);
  return clients === null
    ? $localize`A founding space’s owner seat includes what the price plan’s seat includes: no founding number above it is published yet.`
    : $localize`A founding space’s owner seat includes ${clientCount(clients)}:clients:.`;
}

// ---------- the price guarantee in words (notes plan N8) ----------
// The months are the server's: the founding terms in force. A founding space keeps the price plan
// version of its founding day until that many months after its last discount's last day, or after its
// founding day when it has no discount (PBL-012); with no months published nothing is held.

/** The list's account of the guarantee in the terms in force, about any founding space. */
export function termsGuaranteeSentence(months: number | null): string {
  if (months === null) {
    return $localize`A founding space’s prices are not held: no guarantee months are published yet.`;
  }
  return months === 0
    ? $localize`A founding space keeps its plan version until its last discount ends; with no discount, only for its founding month.`
    : $localize`A founding space keeps its plan version until ${monthCount(months)}:months: after its last discount ends, or after its founding day when it has none.`;
}

/** The mark sheet's line on the guarantee, from the terms in force when they could be read. */
export function markGuaranteeSentence(terms: FoundingTerms | null): string {
  if (!terms) {
    return $localize`The space keeps its plan version for as long as the terms in force say.`;
  }
  const months = terms.priceGuaranteeMonths;
  if (months === null) {
    return $localize`The space’s prices are not held: no guarantee months are published yet.`;
  }
  return months === 0
    ? $localize`The space keeps its plan version until its last discount ends; with no discount, only for its founding month.`
    : $localize`The space keeps its plan version until ${monthCount(months)}:months: after its last discount ends, or after its founding day when it has none.`;
}

/**
 * What a new price plan version means for founding spaces, on the price plan sheet: they keep their
 * version while the terms in force name guarantee months (0 included: until the last discount ends);
 * with none published nothing is held, and the sheet says so before the admin publishes. Null when the
 * terms could not be read (months undefined): the sheet then says nothing of founding spaces.
 */
export function planGuaranteeSentence(months: number | null | undefined): string | null {
  if (months === undefined) return null;
  return months === null
    ? $localize`No guarantee months are published yet, so founding spaces are billed at the new version too.`
    : $localize`Founding spaces keep their version until their guarantee ends.`;
}

/** The toast after a price plan version is published, with the same account of founding spaces. */
export function planPublishedSentence(version: number, months: number | null | undefined): string {
  if (months === undefined) {
    return $localize`Price plan version ${version}:version: is published. Invoices issued from now on use it.`;
  }
  return months === null
    ? $localize`Price plan version ${version}:version: is published. Invoices issued from now on use it, founding spaces’ too: no guarantee months are published.`
    : $localize`Price plan version ${version}:version: is published. Invoices issued from now on use it; a founding space keeps its version until its guarantee ends.`;
}

/** The admin's line under "Where it stands": the version a founding space is held at, and until when. */
export function priceHoldLine(version: number, until: string): string {
  return $localize`Prices held at plan version ${version}:version: until ${until}:until:.`;
}

/** Where a waiting badge stands, for the platform admin, counted right now. */
export function adminProgressLine(badge: FoundingBadge): string {
  const clients = $localize`${badge.clientsWithActivePlan ?? 0}:have: of ${clientCount(badge.clientsNeeded)}:needed: with an active plan right now`;
  return badge.monthsNeeded === 0
    ? $localize`Badge: ${clients}:clients:.`
    : $localize`Badge: ${clients}:clients: · ${badge.monthsSinceStart ?? 0}:have: of ${monthCount(badge.monthsNeeded)}:needed: since the space started.`;
}
