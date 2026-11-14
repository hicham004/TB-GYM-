import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  HouseProgramListingView,
  OfferHouseProgramRequest,
  ProgramTemplateSummary,
  TrainingLoadRoundingMode,
  TrainingLoadUnit,
} from '../../core/api/generated';
import type { StatusPillTone } from '../../ui/status-pill';
import { numeric, nullableNumeric } from './training-builder.models';
import { unitLabel } from './training-program.models';

/**
 * TB Gym's programs for its trainees, as its staff mark them (TRN-034, notes plans N9c3 and N9c4): a published
 * program offered with whom it suits, its place in a run of blocks and how its loads round. The server checks
 * every term again and answers 404 outside the house; these mirror its rules so a refusal is rare.
 */

/** The server's limits on a listing's terms (`HouseProgramRules`). */
export const LISTING_LIMITS = {
  suits: 200,
  runName: 80,
  maxRunPosition: 52,
  maxIncrement: 50,
  defaultIncrement: 2.5,
} as const;

export const DEFAULT_ROUNDING: TrainingLoadRoundingMode = 'Nearest';

/** One program as the house offers it, or offered once and withdrawn. */
export interface HouseListing {
  readonly listingId: string;
  readonly templateId: string;
  readonly name: string;
  /** The latest published version, which a trainee's Start copies; null if none was ever published. */
  readonly templateVersionId: string | null;
  readonly weeks: number | null;
  /** Null when the program mixes kg and lb, or has no published version. */
  readonly loadUnit: TrainingLoadUnit | null;
  readonly mixesUnits: boolean;
  readonly suits: string;
  readonly runName: string | null;
  readonly runPosition: number | null;
  readonly loadIncrement: number;
  readonly loadRoundingMode: TrainingLoadRoundingMode;
  readonly isOffered: boolean;
  readonly timesStarted: number;
  readonly version: number;
}

export function toHouseListing(view: HouseProgramListingView): HouseListing {
  return {
    listingId: view.listingId,
    templateId: view.templateId,
    name: view.templateName,
    templateVersionId: view.templateVersionId,
    weeks: nullableNumeric(view.weeks),
    loadUnit: view.loadUnit,
    mixesUnits: view.mixesUnits,
    suits: view.suits,
    runName: view.runName,
    runPosition: nullableNumeric(view.runPosition),
    loadIncrement: numeric(view.loadIncrement),
    loadRoundingMode: view.loadRoundingMode,
    isOffered: view.isOffered,
    timesStarted: numeric(view.timesStarted),
    version: numeric(view.version),
  };
}

// ---------- the rows ----------

export interface ListingRow {
  readonly id: string;
  readonly templateId: string;
  readonly name: string;
  readonly link: readonly string[];
  readonly offered: boolean;
  readonly pill: { readonly label: string; readonly tone: StatusPillTone };
  /** "Block 2 of Strength Base", or null for a program on its own. */
  readonly block: string | null;
  readonly suits: string;
  readonly weeks: string;
  readonly rounding: string;
  readonly started: string;
  readonly archived: boolean;
  readonly mixesUnits: boolean;
  /** The accessible names of the row's actions: each starts with the words on the button. */
  readonly editLabel: string;
  readonly withdrawLabel: string;
  readonly offerAgainLabel: string;
}

export function weeksWords(weeks: number): string {
  return weeks === 1 ? $localize`1 week` : $localize`${weeks}:count: weeks`;
}

export function blockWords(runName: string | null, runPosition: number | null): string | null {
  return runName && runPosition !== null
    ? $localize`Block ${runPosition}:place: of ${runName}:run:`
    : null;
}

/** Assign program's rounding words: Nearest, Down or Up. */
export function roundingModeWord(mode: TrainingLoadRoundingMode): string {
  switch (mode) {
    case 'Down':
      return $localize`down`;
    case 'Up':
      return $localize`up`;
    default:
      return $localize`nearest`;
  }
}

/** "Loads rounded to 2.5 kg, nearest": the unit is the program's own, left out when it has none. */
export function roundingLine(
  increment: number,
  mode: TrainingLoadRoundingMode,
  unit: TrainingLoadUnit | null,
): string {
  const step = unit ? `${increment} ${unitLabel(unit)}` : `${increment}`;
  return $localize`Loads rounded to ${step}:step:, ${roundingModeWord(mode)}:mode:`;
}

/** "kg · rounded to the nearest 2.5", the hint of the folded rounding, as Assign program writes it. */
export function roundingHint(
  increment: number | null,
  mode: TrainingLoadRoundingMode,
  unit: TrainingLoadUnit | null,
): string {
  const unitWord = unit ? unitLabel(unit) : null;
  if (increment === null) return unitWord ?? '';
  const direction =
    mode === 'Down' ? $localize`down` : mode === 'Up' ? $localize`up` : $localize`to the nearest`;
  const rounded = $localize`rounded ${direction}:mode: ${increment}:step:`;
  return unitWord ? `${unitWord} · ${rounded}` : rounded;
}

export function startedWords(times: number): string {
  if (times === 0) return $localize`Not started yet`;
  return times === 1 ? $localize`Started once` : $localize`Started ${times}:count: times`;
}

function listingWeeks(listing: HouseListing): string {
  if (listing.weeks === null || listing.templateVersionId === null) {
    return $localize`Not published yet`;
  }
  const weeks = weeksWords(listing.weeks);
  return listing.loadUnit ? `${weeks} · ${unitLabel(listing.loadUnit)}` : weeks;
}

export function listingRow(
  listing: HouseListing,
  templates: readonly ProgramTemplateSummary[],
): ListingRow {
  const template = templates.find((item) => item.id === listing.templateId);
  return {
    id: listing.listingId,
    templateId: listing.templateId,
    name: listing.name,
    link: ['/training/programs', listing.templateId],
    offered: listing.isOffered,
    pill: listing.isOffered
      ? { label: $localize`Offered`, tone: 'success' }
      : { label: $localize`Withdrawn`, tone: 'neutral' },
    block: blockWords(listing.runName, listing.runPosition),
    suits: listing.suits,
    weeks: listingWeeks(listing),
    rounding: roundingLine(listing.loadIncrement, listing.loadRoundingMode, listing.loadUnit),
    started: startedWords(listing.timesStarted),
    archived: template?.isArchived === true,
    mixesUnits: listing.mixesUnits,
    editLabel: $localize`Edit for trainees, ${listing.name}:program:`,
    withdrawLabel: $localize`Withdraw, ${listing.name}:program:`,
    offerAgainLabel: $localize`Offer again, ${listing.name}:program:`,
  };
}

// ---------- what can be offered ----------

function isPublished(template: ProgramTemplateSummary): boolean {
  return template.versions.some((version) => version.isPublished);
}

/** Published programs not archived and not listed yet, even withdrawn: a listed one changes from its row. */
export function offerableTemplates(
  templates: readonly ProgramTemplateSummary[],
  listings: readonly HouseListing[],
): ProgramTemplateSummary[] {
  const listed = new Set(listings.map((listing) => listing.templateId));
  return templates.filter(
    (template) => !template.isArchived && isPublished(template) && !listed.has(template.id),
  );
}

/** Why Offer a program has nothing to offer, or null when it has. */
export function nothingToOffer(
  templates: readonly ProgramTemplateSummary[],
  listings: readonly HouseListing[],
): string | null {
  if (offerableTemplates(templates, listings).length > 0) return null;
  return templates.some((template) => !template.isArchived && isPublished(template))
    ? $localize`Every published program is listed here already.`
    : $localize`Publish a program first.`;
}

// ---------- the terms, as typed ----------

/** What the sheet holds: the numbers are null while their box is empty or not a number. */
export interface ListingTerms {
  readonly suits: string;
  readonly runName: string;
  readonly runPosition: number | null;
  readonly loadIncrement: number | null;
  readonly loadRoundingMode: TrainingLoadRoundingMode;
}

export type ListingErrors = Readonly<Record<string, readonly string[]>>;

/** Trimmed, with each run of spaces made one, as the server matches a run's name. */
export function singleSpaced(value: string): string {
  return value.trim().replace(/ {2,}/g, ' ');
}

function hasTwoDecimalsAtMost(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/** The server's checks (`HouseProgramRules.Terms`), in its words, so a refusal is rare. */
export function termsErrors(terms: ListingTerms): ListingErrors {
  const errors: Record<string, string[]> = {};
  const suits = terms.suits.trim();
  if (suits === '') {
    errors['suits'] = [$localize`Say in one line whom this program suits.`];
  } else if (suits.length > LISTING_LIMITS.suits) {
    errors['suits'] = [
      $localize`Keep whom it suits to ${LISTING_LIMITS.suits}:limit: characters or fewer.`,
    ];
  }
  const run = singleSpaced(terms.runName);
  if (run.length > LISTING_LIMITS.runName) {
    errors['runName'] = [
      $localize`Keep the run’s name to ${LISTING_LIMITS.runName}:limit: characters or fewer.`,
    ];
  }
  // A place counts only beside a run, as the server says.
  if (run === '') {
    if (terms.runPosition !== null) {
      errors['runName'] = [
        $localize`Name the run this block belongs to, or leave its place empty.`,
      ];
    }
  } else {
    const place = terms.runPosition;
    if (place === null) {
      errors['runPosition'] = [$localize`Say which block of the run this is: 1 for the first.`];
    } else if (!Number.isInteger(place) || place < 1 || place > LISTING_LIMITS.maxRunPosition) {
      errors['runPosition'] = [
        $localize`A block’s place in its run is a whole number from 1 to ${LISTING_LIMITS.maxRunPosition}:max:.`,
      ];
    }
  }
  const step = terms.loadIncrement;
  if (
    step === null ||
    !Number.isFinite(step) ||
    step <= 0 ||
    step > LISTING_LIMITS.maxIncrement ||
    !hasTwoDecimalsAtMost(step)
  ) {
    errors['loadIncrement'] = [
      $localize`Round loads to a step above 0 and at most ${LISTING_LIMITS.maxIncrement}:max:, with two decimals at most.`,
    ];
  }
  return errors;
}

/** The PUT's body: a run's place only beside a run, and the version of any listing there is (null for none). */
export function offerRequest(
  terms: ListingTerms,
  version: number | null,
): OfferHouseProgramRequest {
  const run = singleSpaced(terms.runName);
  return {
    suits: terms.suits.trim(),
    runName: run === '' ? null : run,
    runPosition: run === '' ? null : terms.runPosition,
    loadIncrement: terms.loadIncrement,
    loadRoundingMode: terms.loadRoundingMode,
    version,
  };
}

/** The terms a listing has now, or the defaults for a new one. */
export function listingTerms(listing: HouseListing | null): ListingTerms {
  return listing
    ? {
        suits: listing.suits,
        runName: listing.runName ?? '',
        runPosition: listing.runPosition,
        loadIncrement: listing.loadIncrement,
        loadRoundingMode: listing.loadRoundingMode,
      }
    : {
        suits: '',
        runName: '',
        runPosition: null,
        loadIncrement: LISTING_LIMITS.defaultIncrement,
        loadRoundingMode: DEFAULT_ROUNDING,
      };
}

// ---------- refusals ----------

/** A refusal: under its field or in the summary, and whether the section's list is out of date. */
export interface ListingRefusal {
  readonly field: string | null;
  readonly message: string;
  readonly stale: boolean;
}

const FIELDS = [
  'suits',
  'runName',
  'runPosition',
  'loadIncrement',
  'loadRoundingMode',
  'templateId',
];

function body(error: unknown): { code?: string; message?: string } | null {
  return error instanceof HttpErrorResponse
    ? ((error.error as { code?: string; message?: string } | null) ?? null)
    : null;
}

/** A 400 about one of the fields, in the server's words, which are written for the staff. */
function fieldRefusal(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return null;
  const errors = (error.error as { errors?: Record<string, string[]> } | null)?.errors;
  for (const field of FIELDS) {
    const pascal = field.charAt(0).toUpperCase() + field.slice(1);
    const message = errors?.[field]?.[0] ?? errors?.[pascal]?.[0];
    if (message) return { field, message };
  }
  return null;
}

const CHANGED_MEANWHILE = () =>
  $localize`Someone changed this program’s terms meanwhile. Read them again.`;
const GONE = () =>
  $localize`This program isn’t listed here any more. The list has been read again.`;

/** Why a Save was refused, and where to say it. */
export function offerRefusal(error: unknown, offering: boolean): ListingRefusal {
  const field = fieldRefusal(error);
  if (field) return { ...field, stale: false };
  const refused = body(error);
  if (error instanceof HttpErrorResponse && error.status === 409) {
    if (refused?.code === 'house_program_run_position_taken' && refused.message) {
      return { field: 'runPosition', message: refused.message, stale: false };
    }
    if (refused?.code === 'concurrency_conflict') {
      return { field: null, message: CHANGED_MEANWHILE(), stale: true };
    }
  }
  if (error instanceof HttpErrorResponse && error.status === 404) {
    return { field: null, message: GONE(), stale: true };
  }
  return {
    field: null,
    message: apiErrorMessage(
      error,
      offering
        ? $localize`The program couldn’t be offered. Try again.`
        : $localize`Your changes couldn’t be saved. Try again.`,
    ),
    stale: false,
  };
}

/** Why a Withdraw was refused; the list is read again when it was out of date. */
export function withdrawRefusal(error: unknown): { message: string; stale: boolean } {
  if (error instanceof HttpErrorResponse && error.status === 409) {
    if (body(error)?.code === 'concurrency_conflict') {
      return { message: CHANGED_MEANWHILE(), stale: true };
    }
  }
  if (error instanceof HttpErrorResponse && error.status === 404) {
    return { message: GONE(), stale: true };
  }
  return {
    message: apiErrorMessage(error, $localize`The program couldn’t be withdrawn. Try again.`),
    stale: false,
  };
}

/** Whether the list's read was answered "not the house", which hides the section for the session. */
export function notTheHouse(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 404;
}
