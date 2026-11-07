import { formatDate } from '@angular/common';
import { toNumber } from '../../core/api/api-client';
import type {
  CoachCertificateLineState,
  CoachCertificateOwnLineView,
  CoachCertificateOwnView,
} from '../../core/api/generated';
import { isIsoDate, type IsoDate } from '../../ui/calendar';
import type { StatusPillTone } from '../../ui/status-pill';

/**
 * Settings › Your account › Certificates (notes plan N4b, CLI-021): a coach's own certificate lines as
 * their page reads them, and the words it says about each. The server writes every line's sentence in
 * the space's own language, decides which lines take the switch and which ones a client reads; nothing
 * here decides a line. The owned model keeps the API's field names, so a test's fixture answers a
 * request as it is.
 */

export type OwnCertificateState = CoachCertificateLineState;

/** One of the coach's own lines. Every `…On` day is the space's calendar day, as the server read it. */
export interface OwnCertificateLine {
  readonly id: string;
  readonly state: OwnCertificateState;
  /** The sentence their clients read while the line is shown. */
  readonly text: string;
  readonly what: string;
  readonly shownOn: IsoDate;
  readonly wordingVersion: number;
  readonly confirmedOn: IsoDate | null;
  readonly takenDownOn: IsoDate | null;
  /** The coach's own switch; only a confirmed line that is still up takes it. */
  readonly coachShows: boolean;
  /** Sent back unchanged with the switch, so a line changed meanwhile is refused (409). */
  readonly version: number;
}

export interface OwnCertificatePill {
  readonly label: string;
  readonly tone: StatusPillTone;
}

export const CERTIFICATES_LEDE = $localize`What TB Gym shows your clients about you. Switch a line off and your clients stop seeing it at once. TB Gym keeps only these words, never a copy of a document.`;

export const CERTIFICATES_EMPTY = $localize`No lines yet. Send TB Gym your certificates, the gym you own or the years you’ve coached, and each confirmed one appears here.`;

export const SHOW_TO_CLIENTS = $localize`Show to my clients`;

export const SWITCH_REFUSED = $localize`Couldn’t save your choice. Try again.`;

export function toOwnCertificateLine(value: CoachCertificateOwnLineView): OwnCertificateLine {
  return {
    ...value,
    wordingVersion: toNumber(value.wordingVersion),
    version: toNumber(value.version),
  };
}

export function toOwnCertificateLines(
  value: CoachCertificateOwnView,
): readonly OwnCertificateLine[] {
  return value.lines.map(toOwnCertificateLine);
}

/** Whether the line takes the coach's switch: a confirmed line that is still up. */
export function takesSwitch(line: Pick<OwnCertificateLine, 'state'>): boolean {
  return line.state === 'Confirmed';
}

/**
 * A day as the line's sentence writes it, "3 Nov 2026", as the admin's Coaches page does too. A
 * `YYYY-MM-DD` day is read by Angular as that day at local midnight, so it is written on the local
 * clock: a UTC clock would write the day before on a device east of UTC.
 */
export function formatOwnCertificateDay(day: IsoDate, locale: string): string {
  return formatDate(day, 'd MMM y', locale);
}

/** Where a line stands for the coach, in words and a tone: shown, hidden, waiting or taken down. */
export function ownPillFor(
  line: Pick<OwnCertificateLine, 'state' | 'coachShows' | 'takenDownOn'>,
  locale: string,
): OwnCertificatePill {
  switch (line.state) {
    case 'Waiting':
      return { label: $localize`Waiting for TB Gym`, tone: 'warning' };
    case 'Confirmed':
      return line.coachShows
        ? { label: $localize`Shown to clients`, tone: 'success' }
        : { label: $localize`Hidden`, tone: 'neutral' };
    case 'TakenDown': {
      const day =
        line.takenDownOn && isIsoDate(line.takenDownOn)
          ? formatOwnCertificateDay(line.takenDownOn, locale)
          : null;
      return {
        label: day ? $localize`Taken down ${day}:day:` : $localize`Taken down`,
        tone: 'neutral',
      };
    }
    // The server never lists an erased line; were one sent, it would say only that.
    default:
      return { label: $localize`Erased`, tone: 'neutral' };
  }
}

/** The lines with one of them replaced by the server's newer reading of it. */
export function withLine(
  lines: readonly OwnCertificateLine[],
  line: OwnCertificateLine,
): readonly OwnCertificateLine[] {
  return lines.map((item) => (item.id === line.id ? line : item));
}
