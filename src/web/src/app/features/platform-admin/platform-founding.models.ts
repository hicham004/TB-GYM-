import { isIsoDate, type IsoDate } from '../../ui/calendar';
import { clientCount, type FoundingTerms } from '../billing/founding.models';
import type { PublishFoundingTerms } from './platform-founding-api';

/**
 * What the platform admin's founding sheets check before they send (notes plan N3b, PBL-009). The
 * words are the server's own, so a refusal reads the same from either side. The server marks, ends,
 * counts and records; nothing here decides a badge.
 */

/** The earliest founding day the server takes. */
export const FOUNDING_EARLIEST_DAY: IsoDate = '2000-01-01';

// ---------- marking a space as founding ----------

export function markErrors(
  entry: { foundingSince: string; note: string },
  today: IsoDate,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!isIsoDate(entry.foundingSince)) {
    errors['foundingSince'] = [$localize`Choose the day the coaching space became founding.`];
  } else if (entry.foundingSince > today) {
    errors['foundingSince'] = [$localize`Choose today or an earlier day.`];
  } else if (entry.foundingSince < FOUNDING_EARLIEST_DAY) {
    errors['foundingSince'] = [$localize`Choose a day from 1 January 2000 to today.`];
  }
  const note = entry.note.trim();
  if (note === '' || note.length > 200) {
    errors['note'] = [$localize`Say what the founding status is for, in up to 200 characters.`];
  }
  return errors;
}

// ---------- ending it for cause ----------

/**
 * The three causes the plan names, offered over free text (the plan's Point 8): a preset lands in the
 * box as its words, and the admin may add to them.
 */
export function endPresets(): readonly string[] {
  return [
    $localize`Misrepresented qualifications`,
    $localize`Harm to clients`,
    $localize`The coach asked to end it`,
  ];
}

export function endErrors(entry: { reason: string }): Record<string, string[]> {
  const reason = entry.reason.trim();
  return reason === '' || reason.length > 500
    ? { reason: [$localize`Say why the founding status ends, in up to 500 characters.`] }
    : {};
}

// ---------- publishing the founding terms ----------

export interface TermsEntry {
  clientsWithActivePlan: number | null;
  monthsSinceStart: number | null;
  /** The clients a founding owner's seat includes (notes plan N11a); null for none. */
  foundingSeatIncludedClients: number | null;
  /** The months a founding space's prices are held after its last discount (notes plan N8); null for none. */
  priceGuaranteeMonths: number | null;
  note: string;
}

export type TermsKey = Exclude<keyof TermsEntry, 'note'>;

export interface TermsField {
  readonly key: TermsKey;
  readonly label: string;
  readonly help: string;
  readonly min: number;
  readonly max: number;
  /** What the server says when the number is missing; null when an empty box means none. */
  readonly missing: string | null;
  /** What the server says when the number is out of range, where it says more than the range. */
  readonly range?: string;
}

/**
 * The founding seat's help (notes plan N11b): the price plan's seat beside it, since the larger
 * applies (PBL-011), what an empty box sends, and that a space already founding keeps the highest
 * number it has had (N11a), so a lower number takes no clients from it.
 */
function seatHelp(planSeatClients: number | null): string {
  return planSeatClients === null
    ? $localize`The price plan’s seat applies when it includes more. Leave it empty for none; a space already founding keeps the highest number it has had.`
    : $localize`The price plan’s seat includes ${clientCount(planSeatClients)}:clients:; the larger applies. Leave it empty for none; a space already founding keeps the highest number it has had.`;
}

/**
 * The badge's two thresholds, the founding seat's clients and the price guarantee's months, in the
 * order the form and the change list show them; the plan's seat, when known, goes in the seat's help.
 * Unlike the seat's number, the months in force apply to every founding space, the ones already
 * founding too (PBL-012), and the box's help says so.
 */
export function termsFields(planSeatClients: number | null = null): readonly TermsField[] {
  return [
    {
      key: 'clientsWithActivePlan',
      label: $localize`Clients with an active plan`,
      help: $localize`Counted right now, the way Billing counts clients with a plan.`,
      min: 1,
      max: 1_000,
      missing: $localize`Enter how many clients with an active plan earn the badge.`,
    },
    {
      key: 'monthsSinceStart',
      label: $localize`Months since the space started`,
      help: $localize`Whole calendar months from the day the space was created.`,
      min: 0,
      max: 24,
      missing: $localize`Enter how many whole months since the space started earn the badge.`,
    },
    {
      key: 'foundingSeatIncludedClients',
      label: $localize`Clients a founding owner’s seat includes`,
      help: seatHelp(planSeatClients),
      min: 0,
      max: 1_000,
      missing: null,
      range: $localize`Enter a whole number of clients from 0 to 1000, or none for what the price plan’s seat includes.`,
    },
    {
      key: 'priceGuaranteeMonths',
      label: $localize`Months a founding space’s prices are held`,
      help: $localize`Counted from a space’s last discount, or from its founding day when it has no discount; until then it keeps the plan version of its founding day. Leave it empty to hold no price. The number in force applies to every founding space, those already founding too.`,
      min: 0,
      max: 120,
      missing: null,
      range: $localize`Enter a whole number of months from 0 to 120, or none to hold no price.`,
    },
  ];
}

export function termsEntryFrom(terms: FoundingTerms): TermsEntry {
  return {
    clientsWithActivePlan: terms.clientsWithActivePlan,
    monthsSinceStart: terms.monthsSinceStart,
    foundingSeatIncludedClients: terms.foundingSeatIncludedClients,
    priceGuaranteeMonths: terms.priceGuaranteeMonths,
    note: '',
  };
}

export function termsErrors(entry: TermsEntry): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of termsFields()) {
    const value = entry[field.key];
    if (value === null) {
      if (field.missing !== null) errors[field.key] = [field.missing];
    } else if (!Number.isInteger(value) || value < field.min || value > field.max) {
      errors[field.key] = [
        field.range ?? $localize`Enter a whole number from ${field.min}:min: to ${field.max}:max:.`,
      ];
    }
  }
  if (entry.note.trim().length > 500) {
    errors['note'] = [$localize`Keep the note to 500 characters.`];
  }
  return errors;
}

export interface TermsChange {
  readonly key: TermsKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The numbers that differ from the version in force, as words for the admin to check; the founding
 * seat's number or the guarantee's months going to none is a change too, shown as "None".
 */
export function termsChanges(current: FoundingTerms, entry: TermsEntry): readonly TermsChange[] {
  const shown = (value: number | null) => (value === null ? $localize`None` : String(value));
  return termsFields()
    .filter((field) => {
      const value = entry[field.key];
      return (value !== null || field.missing === null) && value !== current[field.key];
    })
    .map((field) => ({
      key: field.key,
      label: field.label,
      from: shown(current[field.key]),
      to: shown(entry[field.key]),
    }));
}

/**
 * The next version, against the one the admin saw, so a stale one is refused (409). The founding
 * seat's number and the guarantee's months are always sent, null for none, as the server requires
 * (notes plans N11a and N8): each box starts with the version in force's, so new thresholds alone
 * never drop either.
 */
export function toPublishTermsRequest(
  entry: TermsEntry,
  current: FoundingTerms,
): PublishFoundingTerms {
  return {
    clientsWithActivePlan: entry.clientsWithActivePlan ?? 0,
    monthsSinceStart: entry.monthsSinceStart ?? 0,
    note: entry.note.trim() || null,
    expectedCurrentVersion: current.versionNumber,
    foundingSeatIncludedClients: entry.foundingSeatIncludedClients,
    priceGuaranteeMonths: entry.priceGuaranteeMonths,
  };
}
