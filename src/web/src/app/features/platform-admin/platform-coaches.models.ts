import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { toNumber } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CoachCertificateCoachView,
  CoachCertificateErasureReason,
  CoachCertificateLinesView,
  CoachCertificateLineState,
  CoachCertificateLineView,
  CoachCertificateRole,
} from '../../core/api/generated';
import { addDays, isIsoDate, type IsoDate } from '../../ui/calendar';
import type { StatusPillTone } from '../../ui/status-pill';
import { foldText } from './platform-admin.models';

/**
 * The platform admin's certificate record (notes plan N4a, CLI-021) as the Coaches page reads it: who
 * coaches where, their lines, and the words the page and its sheets say about them. The server writes
 * every line's sentence in the space's own language, works out every space's day, and refuses what a
 * line may not hold; nothing here decides a line. The owned models keep the API's field names, so a
 * test's fixture answers a request as it is.
 */

export type CertificateRole = CoachCertificateRole;
export type CertificateLineState = CoachCertificateLineState;
export type CertificateErasureReason = CoachCertificateErasureReason;

/** One membership on the list: a coach in one coaching space, with their lines counted. */
export interface CertificateCoach {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly tenantId: string;
  readonly spaceName: string;
  readonly role: CertificateRole;
  /** False for someone who no longer coaches in the space but still holds lines there. */
  readonly isActiveStaff: boolean;
  readonly waitingLines: number;
  readonly confirmedLines: number;
  readonly takenDownLines: number;
  readonly erasedLines: number;
}

/** One line, text only. Every `…On` day is the space's calendar day, as the server read it. */
export interface CertificateLine {
  readonly id: string;
  readonly state: CertificateLineState;
  /** The finished sentence in the space's language; null once erased. */
  readonly text: string | null;
  readonly what: string | null;
  readonly shownOn: IsoDate | null;
  readonly wordingVersion: number;
  readonly recordedByName: string;
  readonly recordedAtUtc: string;
  readonly recordedOn: IsoDate;
  readonly confirmedAtUtc: string | null;
  readonly confirmedOn: IsoDate | null;
  readonly confirmedByName: string | null;
  readonly takenDownAtUtc: string | null;
  readonly takenDownOn: IsoDate | null;
  readonly takenDownByName: string | null;
  readonly erasedAtUtc: string | null;
  readonly erasedOn: IsoDate | null;
  readonly erasureReason: CertificateErasureReason | null;
  readonly requestedOn: IsoDate | null;
  readonly erasedByName: string | null;
  readonly coachShows: boolean;
  /** Sent back unchanged with every change, so a line changed meanwhile is refused (409). */
  readonly version: number;
}

/** One coach's lines in one space, newest first, with the space's own today. */
export interface CertificateLines {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly tenantId: string;
  readonly spaceName: string;
  readonly role: CertificateRole;
  readonly isActiveStaff: boolean;
  /** Today in the space's time zone: the latest day a line or a request may name. */
  readonly spaceToday: IsoDate;
  readonly lines: readonly CertificateLine[];
}

/** Who a write sheet is about, and the space's today it checks days against. */
export type CertificateSpace = Pick<
  CertificateLines,
  'userId' | 'tenantId' | 'name' | 'spaceName' | 'spaceToday'
>;

/** A line Add answered with: the new one (201), or the one already recorded (200). */
export interface AddedLine {
  readonly line: CertificateLine;
  readonly created: boolean;
}

/** An erasure on request, in counts only. */
export interface CertificateErasure {
  readonly erased: number;
  readonly dropped: number;
}

export interface CertificatePill {
  readonly label: string;
  readonly tone: StatusPillTone;
}

export function toCertificateCoach(value: CoachCertificateCoachView): CertificateCoach {
  return {
    ...value,
    waitingLines: toNumber(value.waitingLines),
    confirmedLines: toNumber(value.confirmedLines),
    takenDownLines: toNumber(value.takenDownLines),
    erasedLines: toNumber(value.erasedLines),
  };
}

export function toCertificateLine(value: CoachCertificateLineView): CertificateLine {
  return {
    ...value,
    wordingVersion: toNumber(value.wordingVersion),
    version: toNumber(value.version),
  };
}

export function toCertificateLines(value: CoachCertificateLinesView): CertificateLines {
  return { ...value, lines: value.lines.map(toCertificateLine) };
}

// ---------- the list ----------

type Membership = Pick<CertificateCoach, 'role' | 'isActiveStaff'>;

/**
 * Their role in the space in words. Someone who no longer coaches there is a former owner or coach;
 * a membership that is a client's now only shows while it holds lines, which it was given while they
 * coached, so it reads "Former coach" too.
 */
export function roleLabel(coach: Membership): string {
  if (coach.isActiveStaff) return coach.role === 'Owner' ? $localize`Owner` : $localize`Coach`;
  return coach.role === 'Owner' ? $localize`Former owner` : $localize`Former coach`;
}

/** "Owner · Atlas Performance". */
export function roleLine(coach: Membership & Pick<CertificateCoach, 'spaceName'>): string {
  return $localize`${roleLabel(coach)}:role: · ${coach.spaceName}:space:`;
}

/**
 * How many lines a coach has in the space, counting every line not erased, then what is waiting,
 * taken down and erased: "No lines yet", "2 lines · 1 waiting", "No lines · 2 erased".
 */
export function countLine(
  coach: Pick<
    CertificateCoach,
    'waitingLines' | 'confirmedLines' | 'takenDownLines' | 'erasedLines'
  >,
): string {
  const lines = coach.waitingLines + coach.confirmedLines + coach.takenDownLines;
  const parts: string[] = [];
  if (lines === 0) {
    parts.push(coach.erasedLines === 0 ? $localize`No lines yet` : $localize`No lines`);
  } else {
    parts.push(lines === 1 ? $localize`1 line` : $localize`${lines}:count: lines`);
  }
  if (coach.waitingLines > 0) parts.push($localize`${coach.waitingLines}:count: waiting`);
  if (coach.takenDownLines > 0) parts.push($localize`${coach.takenDownLines}:count: taken down`);
  if (coach.erasedLines > 0) parts.push($localize`${coach.erasedLines}:count: erased`);
  return parts.join(' · ');
}

/** Whether a row matches the search, by the coach's name, their email or the space's name. */
export function matchesCoach(
  coach: Pick<CertificateCoach, 'name' | 'email' | 'spaceName'>,
  query: string,
): boolean {
  const wanted = foldText(query.trim());
  if (wanted === '') return true;
  return [coach.name, coach.email, coach.spaceName].some((text) => foldText(text).includes(wanted));
}

/** What the visually hidden status says of the rows on screen. */
export function coachCountSummary(count: number): string {
  if (count === 0) return $localize`No coach matches`;
  return count === 1 ? $localize`1 coach` : $localize`${count}:count: coaches`;
}

// ---------- a coach's lines ----------

/**
 * A day as the server's sentence writes it, "3 Nov 2026", so a sheet reads one way. A `YYYY-MM-DD`
 * day is read by Angular as that day at local midnight, so it is written on the local clock too: a
 * UTC clock would write the day before on a device east of UTC (Beirut's, say).
 */
export function formatCertificateDay(day: IsoDate, locale: string): string {
  return formatDate(day, 'd MMM y', locale);
}

function dayOrNull(day: IsoDate | null, locale: string): string | null {
  return day && isIsoDate(day) ? formatCertificateDay(day, locale) : null;
}

/** Where a line stands, in words and a tone, with the day it got there. */
export function pillFor(line: CertificateLine, locale: string): CertificatePill {
  switch (line.state) {
    case 'Waiting':
      return { label: $localize`Waiting for confirmation`, tone: 'warning' };
    case 'Confirmed': {
      const day = dayOrNull(line.confirmedOn, locale);
      return {
        label: day ? $localize`Confirmed ${day}:day:` : $localize`Confirmed`,
        tone: 'success',
      };
    }
    case 'TakenDown': {
      const day = dayOrNull(line.takenDownOn, locale);
      return {
        label: day ? $localize`Taken down ${day}:day:` : $localize`Taken down`,
        tone: 'neutral',
      };
    }
    default: {
      const day = dayOrNull(line.erasedOn, locale);
      return { label: day ? $localize`Erased ${day}:day:` : $localize`Erased`, tone: 'neutral' };
    }
  }
}

function sameName(first: string, second: string): boolean {
  return first.trim().toLocaleLowerCase() === second.trim().toLocaleLowerCase();
}

/** Who acted on a line, as the line under it says. */
export function byLine(line: CertificateLine, locale: string): string {
  switch (line.state) {
    case 'Confirmed':
    case 'TakenDown': {
      const confirmer = line.confirmedByName?.trim();
      if (!confirmer) return $localize`Recorded by ${line.recordedByName}:recorder:`;
      return sameName(confirmer, line.recordedByName)
        ? $localize`Confirmed and recorded by ${confirmer}:name:`
        : $localize`Confirmed by ${confirmer}:confirmer: · recorded by ${line.recordedByName}:recorder:`;
    }
    case 'Erased': {
      if (line.erasureReason !== 'Request') return $localize`Erased after the keeping period`;
      const asked = dayOrNull(line.requestedOn, locale);
      const by = line.erasedByName?.trim();
      if (!asked) return by ? $localize`Erased by ${by}:name:` : erasedText(line);
      return by
        ? $localize`Asked on ${asked}:day: · erased by ${by}:name:`
        : $localize`Asked on ${asked}:day:`;
    }
    default:
      return $localize`Recorded by ${line.recordedByName}:recorder:`;
  }
}

/** What an erased line shows in place of its sentence, which is gone. */
export function erasedText(line: Pick<CertificateLine, 'erasureReason'>): string {
  switch (line.erasureReason) {
    case 'Request':
      return $localize`Erased at the coach’s request`;
    case 'KeepingPeriod':
      return $localize`Erased after the keeping period`;
    default:
      return $localize`Erased`;
  }
}

// ---------- the writes ----------

/** Requests are met within this many days (the law's 10). */
export const ERASE_WITHIN_DAYS = 10;

/** The earliest day the server takes for a line or a request. */
export const CERTIFICATE_EARLIEST_DAY: IsoDate = '2000-01-01';

/** The last day an erasure asked for on `requestedOn` may be met. */
export function eraseDeadline(requestedOn: IsoDate): IsoDate {
  return addDays(requestedOn, ERASE_WITHIN_DAYS);
}

/** "Requests are met within 10 days: by 19 Oct 2026." */
export function deadlineSentence(requestedOn: string, locale: string): string {
  if (!isIsoDate(requestedOn)) return $localize`Requests are met within 10 days.`;
  const by = formatCertificateDay(eraseDeadline(requestedOn), locale);
  return $localize`Requests are met within 10 days: by ${by}:day:.`;
}

/** What an erasure did, in the toast's words. */
export function erasureToast(erasure: CertificateErasure): string {
  const { erased, dropped } = erasure;
  if (erased === 0 && dropped === 0) return $localize`Nothing was left to erase.`;
  const lines = erased === 1 ? $localize`1 line` : $localize`${erased}:count: lines`;
  const waiting =
    dropped === 1 ? $localize`1 waiting line` : $localize`${dropped}:count: waiting lines`;
  if (dropped === 0) return $localize`Erased ${lines}:lines:.`;
  if (erased === 0) return $localize`Dropped ${waiting}:waiting:.`;
  return $localize`Erased ${lines}:lines: and dropped ${waiting}:waiting:.`;
}

export type CertificateField = 'what' | 'shownOn' | 'confirmedByName' | 'requestedOn';

export type CertificateFieldErrors = Partial<Record<CertificateField, string[]>>;

const CERTIFICATE_FIELDS: readonly string[] = ['what', 'shownOn', 'confirmedByName', 'requestedOn'];

function pastDayErrors(day: string, today: IsoDate, missing: string): string[] {
  if (!isIsoDate(day)) return [missing];
  if (day > today) return [$localize`Choose today or an earlier day.`];
  if (day < CERTIFICATE_EARLIEST_DAY)
    return [$localize`Choose a day from 1 January 2000 to today.`];
  return [];
}

/**
 * Add a line's own checks, in the server's words: the words and the day are needed, the words fit
 * in 120 characters and the day is not after the space's today. Which words a line may not hold is
 * the server's to say; its refusal shows under the field.
 */
export function addLineErrors(
  entry: { what: string; shownOn: string },
  today: IsoDate,
): CertificateFieldErrors {
  const errors: CertificateFieldErrors = {};
  const what = entry.what.trim();
  if (what === '') {
    errors.what = [$localize`Write what the coach showed: the certificate, the gym, the years.`];
  } else if (what.length > 120) {
    errors.what = [$localize`Use 120 characters or fewer.`];
  }
  const day = pastDayErrors(entry.shownOn, today, $localize`Choose the day the coach showed it.`);
  if (day.length > 0) errors.shownOn = day;
  return errors;
}

export function confirmLineErrors(entry: { confirmedByName: string }): CertificateFieldErrors {
  const name = entry.confirmedByName.trim();
  if (name === '') return { confirmedByName: [$localize`Write who confirmed it with the coach.`] };
  if (name.length > 80) return { confirmedByName: [$localize`Use 80 characters or fewer.`] };
  return {};
}

export function eraseErrors(
  entry: { requestedOn: string },
  today: IsoDate,
): CertificateFieldErrors {
  const day = pastDayErrors(entry.requestedOn, today, $localize`Choose the day the coach asked.`);
  return day.length > 0 ? { requestedOn: day } : {};
}

/**
 * The server's refusal of a save, in the sheet's terms: the sentences a 400 gives a field, to show
 * under that field, and the one sentence for the sheet's alert. A 409 says the server's own message;
 * a 404, a lost connection or anything else says `fallback` or the app's connection sentence.
 */
export function certificateRefusal(
  error: unknown,
  fallback = $localize`The change couldn’t be saved. Try again.`,
): { readonly fields: CertificateFieldErrors; readonly message: string | null } {
  const fields: CertificateFieldErrors = {};
  if (error instanceof HttpErrorResponse && error.status === 400) {
    const errors = (error.error as { errors?: Record<string, unknown> } | null)?.errors ?? {};
    const others: string[] = [];
    for (const [key, messages] of Object.entries(errors)) {
      if (!Array.isArray(messages) || messages.length === 0) continue;
      const sentences = messages.filter(
        (message): message is string => typeof message === 'string',
      );
      if (CERTIFICATE_FIELDS.includes(key)) fields[key as CertificateField] = sentences;
      else others.push(...sentences);
    }
    if (Object.keys(fields).length > 0) return { fields, message: others[0] ?? null };
  }
  return { fields, message: apiErrorMessage(error, fallback) };
}
