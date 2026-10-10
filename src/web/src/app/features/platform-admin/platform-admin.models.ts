import { addDays, addMonths, isIsoDate, toIso, type IsoDate } from '../../ui/calendar';
import { formatBillingDay } from '../billing/billing-access';
import {
  formatMoney,
  type AdminWorkspace,
  type BillingDiscount,
  type BillingInvoice,
  type PricePlan,
} from '../billing/billing.models';
import type { PublishPlan } from './platform-admin-api';

/**
 * What the platform billing screen decides for itself (R5.2b, ADR 0028): which coaching space needs
 * the admin first, and what each form asks before it is sent. The API works out every amount, date
 * and status and refuses what is not allowed; nothing here adds up an invoice. Every day is a UTC
 * day, like every other billing date.
 */

export type SpaceFilter = 'all' | 'owing' | 'trial' | 'paid';

export const SPACE_FILTERS: readonly SpaceFilter[] = ['all', 'owing', 'trial', 'paid'];

/** A trial that ends within this many days is called out. */
export const TRIAL_ENDING_DAYS = 7;

const dayOf = (value: string): IsoDate => value.slice(0, 10);

/** Today in UTC, the days billing runs on. */
export function utcToday(now: Date = new Date()): IsoDate {
  return toIso(now);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function trialDaysLeft(space: AdminWorkspace, today: IsoDate): number {
  return daysBetween(today, dayOf(space.trialEndsAtUtc));
}

/** "1 day", "7 days". */
function dayCount(count: number): string {
  return count === 1 ? $localize`1 day` : $localize`${count}:count: days`;
}

export function shortDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dayOf(date)}T00:00:00Z`));
}

// ---------- the list ----------

/**
 * How soon the admin has to act, lowest first: read-only, overdue, owing but not yet due, a trial
 * ending within a week, paid up, then trials with time left.
 */
export function urgencyRank(space: AdminWorkspace, today: IsoDate): number {
  if (space.status === 'ReadOnly') return 0;
  if (space.status === 'Overdue') return 1;
  if (space.unpaidTotal > 0) return 2;
  if (space.status === 'Trial') return trialDaysLeft(space, today) <= TRIAL_ENDING_DAYS ? 3 : 5;
  return 4;
}

/** The day that orders spaces of the same rank: the earliest lock, due day or trial end first. */
function orderingDay(space: AdminWorkspace): string {
  if (space.status === 'ReadOnly') return space.readOnlyFrom ?? '';
  if (space.unpaidTotal > 0) return space.oldestUnpaidDueOn ?? '';
  if (space.status === 'Trial') return dayOf(space.trialEndsAtUtc);
  return '';
}

export function sortSpaces(spaces: readonly AdminWorkspace[], today: IsoDate): AdminWorkspace[] {
  return [...spaces].sort((a, b) => {
    const rank = urgencyRank(a, today) - urgencyRank(b, today);
    if (rank !== 0) return rank;
    const when = orderingDay(a).localeCompare(orderingDay(b));
    return when !== 0 ? when : a.name.localeCompare(b.name);
  });
}

export function matchesFilter(space: AdminWorkspace, filter: SpaceFilter): boolean {
  switch (filter) {
    case 'owing':
      return space.unpaidTotal > 0;
    case 'trial':
      return space.status === 'Trial';
    case 'paid':
      return space.unpaidTotal === 0 && space.status !== 'Trial';
    default:
      return true;
  }
}

/** Lower-cased and without accents, so "cafe" finds "Café" and an Arabic name matches itself. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function matchesQuery(space: AdminWorkspace, query: string): boolean {
  const wanted = foldText(query.trim());
  if (wanted === '') return true;
  return [space.name, space.ownerName, space.ownerEmail].some((text) =>
    foldText(text).includes(wanted),
  );
}

export function filterCounts(spaces: readonly AdminWorkspace[]): Record<SpaceFilter, number> {
  return {
    all: spaces.length,
    owing: spaces.filter((space) => matchesFilter(space, 'owing')).length,
    trial: spaces.filter((space) => matchesFilter(space, 'trial')).length,
    paid: spaces.filter((space) => matchesFilter(space, 'paid')).length,
  };
}

export interface BillingSummary {
  /** What is owed, per currency (the platform bills in one, so usually a single line). */
  readonly owed: readonly { currencyCode: string; amount: number }[];
  readonly owingSpaces: number;
  readonly readOnlySpaces: number;
  readonly overdueSpaces: number;
  readonly trialsEnding: number;
}

export function summarize(spaces: readonly AdminWorkspace[], today: IsoDate): BillingSummary {
  // Added in whole cents: 0.1 + 0.2 is not 0.3 in floating point, and a total must not drift.
  const owed = new Map<string, number>();
  for (const space of spaces) {
    if (space.unpaidTotal > 0) {
      owed.set(
        space.currencyCode,
        (owed.get(space.currencyCode) ?? 0) + Math.round(space.unpaidTotal * 100),
      );
    }
  }
  return {
    owed: Array.from(owed, ([currencyCode, cents]) => ({ currencyCode, amount: cents / 100 })),
    owingSpaces: spaces.filter((space) => space.unpaidTotal > 0).length,
    readOnlySpaces: spaces.filter((space) => space.status === 'ReadOnly').length,
    overdueSpaces: spaces.filter((space) => space.status === 'Overdue').length,
    trialsEnding: spaces.filter(
      (space) => space.status === 'Trial' && trialDaysLeft(space, today) <= TRIAL_ENDING_DAYS,
    ).length,
  };
}

/** The owed line of the first tile: one amount, or one per currency. */
export function owedText(summary: BillingSummary, locale: string): string {
  if (summary.owed.length === 0) return formatMoney(0, 'USD', locale);
  return summary.owed
    .map((line) => formatMoney(line.amount, line.currencyCode, locale))
    .join(' + ');
}

export function seatsAndClients(space: AdminWorkspace): string {
  const seats =
    space.seatsThisMonth === 1
      ? $localize`1 seat`
      : $localize`${space.seatsThisMonth}:seats: seats`;
  const clients =
    space.billableClientsThisMonth === 1
      ? $localize`1 client`
      : $localize`${space.billableClientsThisMonth}:clients: clients`;
  return $localize`${seats}:seats: · ${clients}:clients:`;
}

/** The line under a space's name: what happens next with its money. */
export function nextLine(space: AdminWorkspace, today: IsoDate, locale: string): string {
  const day = (date: string) => shortDay(date, locale);
  if (space.status === 'ReadOnly') {
    return space.readOnlyFrom
      ? $localize`Read-only since ${day(space.readOnlyFrom)}:date:`
      : $localize`Read-only until paid`;
  }
  if (space.status === 'Overdue') {
    return space.oldestUnpaidDueOn && space.readOnlyFrom
      ? $localize`Was due ${day(space.oldestUnpaidDueOn)}:due:, read-only from ${day(space.readOnlyFrom)}:lock:`
      : $localize`Overdue`;
  }
  if (space.unpaidTotal > 0 && space.oldestUnpaidDueOn) {
    return $localize`Due ${day(space.oldestUnpaidDueOn)}:date:`;
  }
  if (space.status === 'Trial') {
    const left = trialDaysLeft(space, today);
    if (left <= 0) return $localize`Trial ends today`;
    if (left === 1) return $localize`Trial ends tomorrow`;
    return left <= TRIAL_ENDING_DAYS
      ? $localize`Trial ends in ${left}:days: days`
      : $localize`Trial until ${day(space.trialEndsAtUtc)}:date:`;
  }
  return $localize`Paid up`;
}

// ---------- one coaching space ----------

/** Days from the day an invoice was issued to its due day: the term a reissue gets again. */
export function paymentTermDays(invoice: BillingInvoice): number {
  return daysBetween(dayOf(invoice.issuedAtUtc), invoice.dueOn);
}

export function isActiveDiscount(discount: BillingDiscount): boolean {
  return discount.revokedAtUtc === null;
}

export type DiscountState = 'running' | 'upcoming' | 'ended' | 'revoked';

export function discountState(discount: BillingDiscount, today: IsoDate): DiscountState {
  if (!isActiveDiscount(discount)) return 'revoked';
  if (discount.startsOn > today) return 'upcoming';
  return discount.endsOnExclusive > today ? 'running' : 'ended';
}

/** The last day a discount covers, from its half-open end. */
export function discountLastDay(discount: BillingDiscount): IsoDate {
  return addDays(discount.endsOnExclusive, -1);
}

/** Newest month first; a corrected invoice comes before the one it replaced. */
export function sortInvoices(invoices: readonly BillingInvoice[]): BillingInvoice[] {
  return [...invoices].sort(
    (a, b) =>
      b.periodStart.localeCompare(a.periodStart) || b.issuedAtUtc.localeCompare(a.issuedAtUtc),
  );
}

/** What the admin reads under a space's name: where it stands, in full sentences. */
export function statusSentence(space: AdminWorkspace, today: IsoDate, locale: string): string {
  const day = (date: string) => formatBillingDay(date, locale);
  switch (space.status) {
    case 'ReadOnly':
      return space.readOnlyFrom
        ? $localize`Read-only since ${day(space.readOnlyFrom)}:date:. Its owner and coaches can look but not change anything; its clients keep full use. Recording the payment lifts it at once.`
        : $localize`Read-only until the overdue invoice is paid. Its clients keep full use.`;
    case 'Overdue':
      return space.oldestUnpaidDueOn && space.readOnlyFrom
        ? $localize`An invoice was due ${day(space.oldestUnpaidDueOn)}:due:. The space goes read-only on ${day(space.readOnlyFrom)}:lock: if it is still unpaid.`
        : $localize`An invoice is overdue.`;
    case 'Trial': {
      const left = trialDaysLeft(space, today);
      return left <= 0
        ? $localize`The free trial ends today. Nothing has been charged.`
        : $localize`On a free trial until ${day(space.trialEndsAtUtc)}:date:. Nothing has been charged.`;
    }
    default:
      return space.unpaidTotal > 0 && space.oldestUnpaidDueOn
        ? $localize`An invoice is due ${day(space.oldestUnpaidDueOn)}:date:.`
        : $localize`Paid up. The next invoice comes on the 1st.`;
  }
}

/** The invoice row's second line: when it falls due or what became of it. */
export function invoiceWhen(invoice: BillingInvoice, locale: string): string {
  const day = (date: string) => formatBillingDay(date, locale);
  switch (invoice.status) {
    case 'Open':
      return $localize`Due ${day(invoice.dueOn)}:date:`;
    case 'Overdue':
      return $localize`Was due ${day(invoice.dueOn)}:due:, read-only from ${day(invoice.readOnlyFrom)}:lock:`;
    case 'Paid':
      return invoice.payment
        ? $localize`Paid ${day(invoice.payment.receivedOn)}:date:`
        : $localize`Paid`;
    case 'Void':
      return invoice.voidedAtUtc
        ? $localize`Voided ${day(invoice.voidedAtUtc)}:date:`
        : $localize`Voided`;
    default:
      return $localize`Nothing to pay`;
  }
}

/** What the invoice counted, as the admin checks it against the space. */
export function invoiceUsage(invoice: BillingInvoice): string {
  const seats =
    invoice.amounts.seats === 1
      ? $localize`1 seat`
      : $localize`${invoice.amounts.seats}:seats: seats`;
  const clients =
    invoice.amounts.billableClients === 1
      ? $localize`1 client`
      : $localize`${invoice.amounts.billableClients}:clients: clients`;
  return $localize`Plan version ${invoice.pricePlanVersion}:version: · ${seats}:seats: · ${clients}:clients:`;
}

// ---------- recording a payment ----------

export interface PaymentEntry {
  reference: string;
  receivedOn: string;
  note: string;
}

/** What is wrong with a payment entry before it is sent, field by field. */
export function paymentErrors(
  entry: PaymentEntry,
  invoice: BillingInvoice,
  today: IsoDate,
  locale: string,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const reference = entry.reference.trim();
  if (reference === '') {
    errors['reference'] = [$localize`Enter the Whish or transfer reference.`];
  } else if (reference.length > 100) {
    errors['reference'] = [$localize`Keep the reference to 100 characters.`];
  }
  const issued = dayOf(invoice.issuedAtUtc);
  if (!isIsoDate(entry.receivedOn)) {
    errors['receivedOn'] = [$localize`Choose the day the money arrived.`];
  } else if (entry.receivedOn < issued || entry.receivedOn > today) {
    errors['receivedOn'] = [
      $localize`Choose a day from ${formatBillingDay(issued, locale)}:from: (when the invoice was issued) up to today.`,
    ];
  }
  if (entry.note.trim().length > 500) {
    errors['note'] = [$localize`Keep the note to 500 characters.`];
  }
  return errors;
}

// ---------- voiding an invoice ----------

export function voidErrors(entry: { reason: string }): Record<string, string[]> {
  const reason = entry.reason.trim();
  if (reason === '') return { reason: [$localize`Say why the invoice is voided.`] };
  if (reason.length > 500) return { reason: [$localize`Keep the reason to 500 characters.`] };
  return {};
}

/** What voiding does, in one sentence, for the choice to issue a corrected invoice or not. */
export function voidOutcome(
  invoice: BillingInvoice,
  reissue: boolean,
  spaceName: string,
  month: string,
): string {
  return reissue
    ? $localize`A new invoice for ${month}:month: is issued today at plan version ${invoice.pricePlanVersion}:version:’s prices. It counts ${spaceName}:space:’s seats and clients again as of now, with any discount in force, and is due ${dayCount(paymentTermDays(invoice))}:term: from today. The owner is emailed it.`
    : $localize`${spaceName}:space: will owe nothing for ${month}:month:. The voided invoice stays on record, struck through.`;
}

// ---------- granting a discount ----------

export interface DiscountEntry {
  percent: number | null;
  startsOn: string;
  lastDay: string;
  note: string;
}

/** The half-open end the API takes, from the last day the admin chose. */
export function discountEndExclusive(lastDay: string): IsoDate {
  return addDays(lastDay, 1);
}

/** The last day of a discount that runs `months` whole months from its first day. */
export function lastDayAfterMonths(startsOn: string, months: number): IsoDate {
  return addDays(addMonths(startsOn, months), -1);
}

export function discountErrors(
  entry: DiscountEntry,
  existing: readonly BillingDiscount[],
  locale: string,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const percent = entry.percent;
  if (percent === null || !Number.isFinite(percent)) {
    errors['percent'] = [$localize`Enter how many percent off.`];
  } else if (percent <= 0 || percent > 100 || Math.round(percent * 100) / 100 !== percent) {
    errors['percent'] = [
      $localize`Enter a percentage above 0 and up to 100, with at most two decimals.`,
    ];
  }
  if (!isIsoDate(entry.startsOn)) {
    errors['startsOn'] = [$localize`Choose the first day.`];
  }
  if (!isIsoDate(entry.lastDay)) {
    errors['lastDay'] = [$localize`Choose the last day.`];
  } else if (isIsoDate(entry.startsOn) && entry.lastDay < entry.startsOn) {
    errors['lastDay'] = [$localize`The last day cannot be before the first.`];
  }
  const note = entry.note.trim();
  if (note === '') {
    errors['note'] = [$localize`Say what the discount is for.`];
  } else if (note.length > 200) {
    errors['note'] = [$localize`Keep it to 200 characters.`];
  }
  if (!errors['startsOn'] && !errors['lastDay']) {
    const end = discountEndExclusive(entry.lastDay);
    const clash = existing.find(
      (discount) =>
        isActiveDiscount(discount) &&
        discount.startsOn < end &&
        entry.startsOn < discount.endsOnExclusive,
    );
    if (clash) {
      errors['startsOn'] = [
        $localize`That overlaps the ${clash.percent}:percent:% discount from ${formatBillingDay(clash.startsOn, locale)}:from: to ${formatBillingDay(addDays(clash.endsOnExclusive, -1), locale)}:to:. Revoke it first.`,
      ];
    }
  }
  return errors;
}

// ---------- publishing a price plan version ----------

export interface PlanEntry {
  seatPrice: number | null;
  includedClientsPerSeat: number | null;
  extraClientPrice: number | null;
  gymFee: number | null;
  gymFeeMinimumSeats: number | null;
  trialDays: number | null;
  paymentTermDays: number | null;
  graceDays: number | null;
  note: string;
}

export type PlanKey = Exclude<keyof PlanEntry, 'note'>;

export interface PlanField {
  readonly key: PlanKey;
  readonly label: string;
  readonly kind: 'money' | 'count';
  readonly min: number;
  readonly max: number;
  readonly help?: string;
}

/** The terms of a plan, in the order the form and the change list show them. */
export function planFields(): readonly PlanField[] {
  return [
    { key: 'seatPrice', label: $localize`Price per seat`, kind: 'money', min: 0, max: 100_000 },
    {
      key: 'includedClientsPerSeat',
      label: $localize`Clients included with each seat`,
      kind: 'count',
      min: 0,
      max: 1_000,
    },
    {
      key: 'extraClientPrice',
      label: $localize`Price per extra client`,
      kind: 'money',
      min: 0,
      max: 100_000,
    },
    { key: 'gymFee', label: $localize`Gym fee`, kind: 'money', min: 0, max: 100_000 },
    {
      key: 'gymFeeMinimumSeats',
      label: $localize`Gym fee applies from (seats)`,
      kind: 'count',
      min: 1,
      max: 1_000,
    },
    {
      key: 'trialDays',
      label: $localize`Free trial (days)`,
      kind: 'count',
      min: 0,
      max: 365,
      help: $localize`For coaching spaces created after this version.`,
    },
    {
      key: 'paymentTermDays',
      label: $localize`Days to pay an invoice`,
      kind: 'count',
      min: 0,
      max: 90,
    },
    {
      key: 'graceDays',
      label: $localize`Days after it is due before read-only`,
      kind: 'count',
      min: 0,
      max: 90,
    },
  ];
}

export function planEntryFrom(plan: PricePlan): PlanEntry {
  return {
    seatPrice: plan.seatPrice,
    includedClientsPerSeat: plan.includedClientsPerSeat,
    extraClientPrice: plan.extraClientPrice,
    gymFee: plan.gymFee,
    gymFeeMinimumSeats: plan.gymFeeMinimumSeats,
    trialDays: plan.trialDays,
    paymentTermDays: plan.paymentTermDays,
    graceDays: plan.graceDays,
    note: '',
  };
}

export function planErrors(entry: PlanEntry): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of planFields()) {
    const value = entry[field.key];
    if (value === null || !Number.isFinite(value)) {
      errors[field.key] = [$localize`Enter a number.`];
    } else if (value < field.min || value > field.max) {
      errors[field.key] =
        field.kind === 'money'
          ? [$localize`Enter an amount from ${field.min}:min: to ${field.max}:max:.`]
          : [$localize`Enter a whole number from ${field.min}:min: to ${field.max}:max:.`];
    } else if (field.kind === 'money' && Math.round(value * 100) / 100 !== value) {
      errors[field.key] = [$localize`Use at most two decimal places.`];
    } else if (field.kind === 'count' && !Number.isInteger(value)) {
      errors[field.key] = [
        $localize`Enter a whole number from ${field.min}:min: to ${field.max}:max:.`,
      ];
    }
  }
  if (entry.note.trim().length > 500) {
    errors['note'] = [$localize`Keep the note to 500 characters.`];
  }
  return errors;
}

export interface PlanChange {
  readonly key: PlanKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** The terms that differ from the version now in force, as words for the admin to check. */
export function planChanges(
  current: PricePlan,
  entry: PlanEntry,
  locale: string,
): readonly PlanChange[] {
  const show = (field: PlanField, value: number) =>
    field.kind === 'money' ? formatMoney(value, current.currencyCode, locale) : String(value);
  return planFields()
    .filter((field) => entry[field.key] !== null && entry[field.key] !== current[field.key])
    .map((field) => ({
      key: field.key,
      label: field.label,
      from: show(field, current[field.key]),
      to: show(field, entry[field.key] as number),
    }));
}

export function toPublishRequest(entry: PlanEntry, current: PricePlan | null): PublishPlan {
  return {
    seatPrice: entry.seatPrice ?? 0,
    includedClientsPerSeat: entry.includedClientsPerSeat ?? 0,
    extraClientPrice: entry.extraClientPrice ?? 0,
    gymFee: entry.gymFee ?? 0,
    gymFeeMinimumSeats: entry.gymFeeMinimumSeats ?? 1,
    trialDays: entry.trialDays ?? 0,
    paymentTermDays: entry.paymentTermDays ?? 0,
    graceDays: entry.graceDays ?? 0,
    expectedCurrentVersion: current?.versionNumber ?? 0,
    note: entry.note.trim() || null,
  };
}

/** The terms of a version, one line each, for the price plan card. */
export function planTermRows(
  plan: PricePlan,
  locale: string,
): readonly { label: string; value: string }[] {
  const money = (value: number) => formatMoney(value, plan.currencyCode, locale);
  return [
    {
      label: $localize`Price per seat`,
      value: $localize`${money(plan.seatPrice)}:price:, with ${plan.includedClientsPerSeat}:included: clients included`,
    },
    { label: $localize`Price per extra client`, value: money(plan.extraClientPrice) },
    {
      label: $localize`Gym fee`,
      value: $localize`${money(plan.gymFee)}:price:, from ${plan.gymFeeMinimumSeats}:seats: seats`,
    },
    { label: $localize`Free trial`, value: dayCount(plan.trialDays) },
    {
      label: $localize`To pay an invoice`,
      value: $localize`${dayCount(plan.paymentTermDays)}:days: after it is issued`,
    },
    {
      label: $localize`Read-only`,
      value: $localize`${dayCount(Math.max(1, plan.graceDays))}:days: after it is due`,
    },
  ];
}

/** One version in a line, for the history under the price plan. */
export function planSummaryLine(plan: PricePlan, locale: string): string {
  const money = (value: number) => formatMoney(value, plan.currencyCode, locale);
  return $localize`${money(plan.seatPrice)}:seat: a seat · ${plan.includedClientsPerSeat}:included: included · ${money(plan.extraClientPrice)}:extra: extra · ${money(plan.gymFee)}:fee: gym fee`;
}
