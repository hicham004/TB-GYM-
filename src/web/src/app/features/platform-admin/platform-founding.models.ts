import { isIsoDate, type IsoDate } from '../../ui/calendar';
import type { FoundingTerms } from '../billing/founding.models';
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

// ---------- publishing the badge's terms ----------

export interface TermsEntry {
  clientsWithActivePlan: number | null;
  monthsSinceStart: number | null;
  note: string;
}

export type TermsKey = Exclude<keyof TermsEntry, 'note'>;

export interface TermsField {
  readonly key: TermsKey;
  readonly label: string;
  readonly help: string;
  readonly min: number;
  readonly max: number;
  /** What the server says when the number is missing. */
  readonly missing: string;
}

/** The two thresholds, in the order the form and the change list show them. */
export function termsFields(): readonly TermsField[] {
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
  ];
}

export function termsEntryFrom(terms: FoundingTerms): TermsEntry {
  return {
    clientsWithActivePlan: terms.clientsWithActivePlan,
    monthsSinceStart: terms.monthsSinceStart,
    note: '',
  };
}

export function termsErrors(entry: TermsEntry): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of termsFields()) {
    const value = entry[field.key];
    if (value === null || !Number.isFinite(value)) {
      errors[field.key] = [field.missing];
    } else if (!Number.isInteger(value) || value < field.min || value > field.max) {
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

export interface TermsChange {
  readonly key: TermsKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** The thresholds that differ from the version in force, as words for the admin to check. */
export function termsChanges(current: FoundingTerms, entry: TermsEntry): readonly TermsChange[] {
  return termsFields()
    .filter((field) => entry[field.key] !== null && entry[field.key] !== current[field.key])
    .map((field) => ({
      key: field.key,
      label: field.label,
      from: String(current[field.key]),
      to: String(entry[field.key]),
    }));
}

/**
 * The next version, against the one the admin saw, so a stale one is refused (409). The founding
 * seat's number is the version in force's, unchanged, so new thresholds never drop it (notes plan N11a).
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
    foundingSeatIncludedClients: current.foundingSeatIncludedClients,
  };
}
