import { formatNumber } from '@angular/common';
import type {
  ClientProgramSummaryView,
  TrainingLoadUnit,
  WorkoutPersonalRecordView,
} from '../../core/api/generated';

/**
 * What a share card is made from (M9, R6.1a): a personal record by the server's rule (TRN-019), as the
 * finish summary told it, or a finished program's facts (TRN-030). Nothing else reaches a card.
 */
export type ShareFact =
  | { readonly kind: 'record'; readonly record: WorkoutPersonalRecordView }
  | { readonly kind: 'program'; readonly program: ClientProgramSummaryView };

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
      : programCard(fact.program, identity),
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
