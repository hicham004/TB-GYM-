import { formatDate, formatNumber } from '@angular/common';
import type {
  ClientProgramSummaryView,
  ProgressPhotoPose,
  TrainingLoadUnit,
  WorkoutPersonalRecordView,
} from '../../core/api/generated';
import { toDate } from '../../ui/calendar';
import { poseName } from '../progress/progress-entries.models';

/**
 * What a share card is made from (M9): a personal record by the server's rule (TRN-019), as the finish
 * summary told it, or a finished program's facts (TRN-030), from R6.1a; or, from R6.1b, two of the
 * client's own progress photos whose export the server has recorded (PRG-013). Nothing else reaches a card.
 */
export type ShareFact =
  | { readonly kind: 'record'; readonly record: WorkoutPersonalRecordView }
  | { readonly kind: 'program'; readonly program: ClientProgramSummaryView }
  | { readonly kind: 'photos'; readonly photos: ShareProgressPhotos };

/** A before-and-after as the server recorded it, with each photo's picture granted for drawing. */
export interface ShareProgressPhotos {
  /** The export the server recorded before anything was made. */
  readonly exportId: string;
  readonly pose: ProgressPhotoPose;
  readonly before: ShareProgressPhoto;
  readonly after: ShareProgressPhoto;
}

export interface ShareProgressPhoto {
  readonly date: string;
  /** The full-size picture on TB Gym's own address, so the canvas stays exportable. */
  readonly imageUrl: string;
}

/** One of a before-and-after's pictures as the card draws it. */
export interface ShareCardPhoto {
  readonly label: string;
  readonly imageUrl: string;
}

/** Who a card is from: the client's first name and their coaching space. */
export interface ShareIdentity {
  readonly firstName: string;
  readonly spaceName: string;
}

/** One card's words, the same on the screen and in the image. */
export interface ShareCard {
  readonly id: string;
  readonly kind: ShareFact['kind'];
  /** Its name in the chooser when there are several. */
  readonly choice: string;
  readonly kicker: string;
  readonly headline: string;
  readonly title: string;
  /** A program's numbers, each said whole ("30 workouts"); a record has none. */
  readonly facts: readonly string[];
  readonly byline: string;
  /** What the image shows, for its alternative text. */
  readonly description: string;
  readonly fileName: string;
  /** A before-and-after's two pictures, the earlier first. */
  readonly photos?: { readonly before: ShareCardPhoto; readonly after: ShareCardPhoto };
}

/**
 * The cards for these facts, in their order. Two records on one lift (at two rep counts) are told
 * apart in the chooser by their numbers.
 */
export function shareCards(
  facts: readonly ShareFact[],
  identity: ShareIdentity,
  locale: string,
): ShareCard[] {
  const cards = facts.map((fact) =>
    fact.kind === 'record'
      ? recordCard(fact.record, identity, locale)
      : fact.kind === 'program'
        ? programCard(fact.program, identity)
        : photosCard(fact.photos, identity, locale),
  );
  return cards.map((card) =>
    cards.filter((other) => other.choice === card.choice).length > 1
      ? { ...card, choice: `${card.choice}, ${card.headline}` }
      : card,
  );
}

/** A new personal record: the load and reps as lifted, in the unit lifted, never converted. */
export function recordCard(
  record: WorkoutPersonalRecordView,
  identity: ShareIdentity,
  locale: string,
): ShareCard {
  const load = formatNumber(Number(record.load), locale, '1.0-2');
  const headline = `${load} ${unitLabel(record.unit)} × ${Number(record.repetitions)}`;
  const kicker = $localize`New personal record`;
  const byline = bylineOf(identity);
  return {
    id: `record-${record.setPerformanceId}`,
    kind: 'record',
    choice: record.exerciseName,
    kicker,
    headline,
    title: record.exerciseName,
    facts: [],
    byline,
    description: [kicker, `${record.exerciseName}, ${headline}`, byline].join('. '),
    fileName: `${slug(record.exerciseName, 'record')}-personal-record.png`,
  };
}

/** A finished program: its weeks, the workouts done in it, and the records they set. */
export function programCard(program: ClientProgramSummaryView, identity: ShareIdentity): ShareCard {
  const weeks = Number(program.weekCount);
  const workouts = Number(program.workoutCount);
  const records = Number(program.personalRecordCount);
  const headline = weeks === 1 ? $localize`1 week` : $localize`${weeks}:count: weeks`;
  const facts = [
    workouts === 1 ? $localize`1 workout` : $localize`${workouts}:count: workouts`,
    ...(records === 0
      ? []
      : [
          records === 1
            ? $localize`1 personal record`
            : $localize`${records}:count: personal records`,
        ]),
  ];
  const kicker = $localize`Program complete`;
  const byline = bylineOf(identity);
  return {
    id: `program-${program.id}`,
    kind: 'program',
    choice: $localize`Your program`,
    kicker,
    headline,
    title: program.name,
    facts,
    byline,
    description: [kicker, `${program.name}, ${headline}`, facts.join(', '), byline].join('. '),
    fileName: `${slug(program.name, 'program')}-complete.png`,
  };
}

/**
 * A before-and-after (R6.1b): the two photos whole, labelled, with the time between them and the day
 * each was taken, so the picture says when and nothing more about the client.
 */
export function photosCard(
  photos: ShareProgressPhotos,
  identity: ShareIdentity,
  locale: string,
): ShareCard {
  const kicker = $localize`Before and after`;
  const headline = timeBetween(photos.before.date, photos.after.date);
  const start = formatDate(photos.before.date, 'd MMMM y', locale);
  const end = formatDate(photos.after.date, 'd MMMM y', locale);
  const range = dateRange(photos.before.date, photos.after.date, locale);
  const pose = poseName(photos.pose);
  const byline = bylineOf(identity);
  return {
    id: `photos-${photos.exportId}`,
    kind: 'photos',
    choice: kicker,
    kicker,
    headline,
    title: '',
    facts: [$localize`Before: ${start}:date:`, $localize`After: ${end}:date:`],
    byline,
    description: [
      kicker,
      $localize`${pose}:pose: photos from ${range}:dates:, ${headline}:time: apart`,
      byline,
    ].join('. '),
    fileName: `${slug(pose, 'progress')}-before-and-after.png`,
    photos: {
      before: { label: $localize`Before`, imageUrl: photos.before.imageUrl },
      after: { label: $localize`After`, imageUrl: photos.after.imageUrl },
    },
  };
}

/**
 * The time between two photos in whole units, never rounded up: days under two weeks, weeks under four
 * months, months under two years, then years. A picture that claims more time than passed would mislead.
 */
export function timeBetween(from: string, to: string): string {
  const start = toDate(from);
  const end = toDate(to);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) -
    (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
  if (days < 14) return days === 1 ? $localize`1 day` : $localize`${days}:count: days`;
  if (months < 4) return $localize`${Math.floor(days / 7)}:count: weeks`;
  if (months < 24) return $localize`${months}:count: months`;
  return $localize`${Math.floor(months / 12)}:count: years`;
}

/** "5 September to 3 October 2026", the year said once when both dates share it. */
export function dateRange(from: string, to: string, locale: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = formatDate(from, sameYear ? 'd MMMM' : 'd MMMM y', locale);
  const end = formatDate(to, 'd MMMM y', locale);
  return $localize`${start}:start: to ${end}:end:`;
}

/** "Maya · coached by Atlas Performance", or the coaching space alone without a name. */
export function bylineOf(identity: ShareIdentity): string {
  return identity.firstName
    ? $localize`${identity.firstName}:firstName: · coached by ${identity.spaceName}:spaceName:`
    : $localize`Coached by ${identity.spaceName}:spaceName:`;
}

/** The first word of a display name, which is all a card says of the client. */
export function firstNameOf(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}

function unitLabel(unit: TrainingLoadUnit): string {
  return unit === 'Pound' ? 'lb' : 'kg';
}

/** A file name from a name in Latin letters, or the fallback for one written otherwise. */
function slug(name: string, fallback: string): string {
  const words = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return words || fallback;
}
