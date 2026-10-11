import { formatDate, formatNumber } from '@angular/common';
import type {
  ProgramTemplateVersionView,
  StrengthMaxView,
  TrainingLoadUnit,
  TrainingMaxBasisView,
  TrainingMaxChangeRequest,
  TrainingMaxEntryView,
  TrainingMaxesPreviewView,
  TrainingMaxesView,
  TrainingMaxView,
} from '../../core/api/generated';
import { nearestLoadStep } from '../../core/units/load-steps';
import { unitLabel } from '../training/training-program.models';
import type { FieldMessages } from './client-program-forms.models';

/**
 * A program's own training maxes in coach words (P2). The server holds every rule: which max is in
 * use, which sessions follow a new one, how each weight is worked out and why. This only phrases what
 * it says, and checks what a form can check to save a round trip.
 */

const num = (value: number | string): number => Number(value);

function weight(value: number | string, unit: TrainingLoadUnit, locale: string): string {
  return `${formatNumber(num(value), locale, '1.0-2')} ${unitLabel(unit)}`;
}

function day(date: string, locale: string): string {
  return formatDate(date, 'EEE d MMM', locale);
}

// ------------------------------------------------------------------------------------------------
// The panel
// ------------------------------------------------------------------------------------------------

export interface MaxHistoryRow {
  readonly id: string;
  /** "100 kg". */
  readonly value: string;
  /** "From Maya’s recorded max · Sat 3 Oct". */
  readonly words: string;
  readonly reason: string;
}

export interface MaxCard {
  readonly exerciseId: string;
  readonly name: string;
  /** "140 kg". */
  readonly value: string;
  /** "Typed by you · Tue 6 Oct". */
  readonly source: string;
  /** For a max worked out from week 1's weight: "110 kg for 5 reps at RPE 7 in week 1". */
  readonly basis: string | null;
  /** The number against the one before it: "Up 20 kg from 100 kg". Null for a first max. */
  readonly change: string | null;
  /** "Applies from week 3. Earlier weeks keep 100 kg." Null when it applies from the start. */
  readonly appliesFrom: string | null;
  readonly earlier: readonly MaxHistoryRow[];
  /** The max the client's logged sets suggest (P4b); null when they suggest nothing. */
  readonly suggestion: MaxSuggestion | null;
  /** "You kept 100 kg on Thu 8 Oct, when logged sets suggested about 110 kg." Only while nothing newer is suggested. */
  readonly kept: string | null;
}

/**
 * The max a lift's logged sets suggest (STR-007). The server picks the set and works the number out; the
 * coach applies it through the usual preview, sending back only the set. A sentence says it in the
 * program's steps (R5.4c); the exact estimate is what the sheet applies and what "How it is worked out"
 * shows.
 */
export interface MaxSuggestion {
  readonly setId: string;
  readonly value: number;
  /** The exact estimate: "110.97 kg". */
  readonly valueText: string;
  /** In the program's steps: "Logged sets suggest about 110 kg, up from 100 kg." */
  readonly headline: string;
  /** "From 90 kg for 5 reps at RPE 8 on Thu 8 Oct, week 1." */
  readonly from: string;
  /** The server's own working, to the exact estimate. */
  readonly explanation: string;
  /** "Keep 100 kg": the max in use, kept over the suggestion (STR-013). */
  readonly keepLabel: string;
}

/** Where a max came from, in words; never a system word. */
export function sourceWords(entry: TrainingMaxEntryView, firstName: string): string {
  switch (entry.source) {
    case 'SavedMax':
      return $localize`From ${firstName}:name:’s recorded max`;
    case 'WeekOneWeight':
      return $localize`Worked out from week 1’s weight`;
    case 'LoggedSet':
      return $localize`Estimated from ${firstName}:name:’s logged sets`;
    case 'PreviousProgram':
      return $localize`Carried over from the last program`;
    default:
      return $localize`Typed by you`;
  }
}

/**
 * Where a row of the client's max history came from (STR-015): a program's training max names its
 * program and the week it applies from, a recorded max how it was recorded.
 */
export function historySourceWords(record: StrengthMaxView): string {
  const program = record.program;
  if (program) {
    const origin = (() => {
      switch (program.origin) {
        case 'SavedMax':
          return $localize`from a recorded max`;
        case 'WeekOneWeight':
          return $localize`from week 1’s weight`;
        case 'LoggedSet':
          return $localize`from logged sets`;
        case 'PreviousProgram':
          return $localize`carried over`;
        default:
          return $localize`typed`;
      }
    })();
    return $localize`${program.programName}:program:, from week ${program.effectiveFromWeek}:week:, ${origin}:origin:`;
  }
  switch (record.methodKey) {
    case 'CoachSelection':
    case 'CoachEntry':
      return $localize`Recorded by a coach`;
    case 'TestedLift':
      return $localize`Tested`;
    default:
      return $localize`Estimated (${record.methodKey}:method:)`;
  }
}

function setParts(basis: TrainingMaxBasisView, unit: TrainingLoadUnit, locale: string) {
  return {
    load: weight(basis.load, unit, locale),
    reps: num(basis.repetitions),
    rpe: formatNumber(num(basis.rpe), locale, '1.0-1'),
  };
}

function basisWords(entry: TrainingMaxEntryView, locale: string): string | null {
  const basis = entry.basis;
  if (!basis) return null;
  const { load, reps, rpe } = setParts(basis, entry.unit, locale);
  const logged = basis.loggedSet;
  // A max a new program took from the last program's logged sets (STR-014) names a set of that program.
  return logged
    ? $localize`${load}:weight: for ${reps}:reps: reps at RPE ${rpe}:rpe: on ${day(logged.performedOn, locale)}:date:, week ${num(logged.weekNumber)}:week:`
    : entry.source === 'LoggedSet'
      ? $localize`${load}:weight: for ${reps}:reps: reps at RPE ${rpe}:rpe:, logged in the last program`
      : $localize`${load}:weight: for ${reps}:reps: reps at RPE ${rpe}:rpe: in week 1`;
}

/** A suggested max in the program's steps: an estimate is not a plate load, so it is said as one (U1). */
function stepWeight(
  value: number | string,
  unit: TrainingLoadUnit,
  step: number | string,
  locale: string,
): string {
  return weight(nearestLoadStep(num(value), unit, step), unit, locale);
}

function suggestionOf(
  lift: TrainingMaxView,
  step: number | string,
  locale: string,
): MaxSuggestion | null {
  const suggestion = lift.suggestion;
  const logged = suggestion?.basis.loggedSet;
  if (!suggestion || !logged) return null;
  const value = num(suggestion.value);
  const current = num(lift.current.value);
  const about = stepWeight(value, suggestion.unit, step, locale);
  const now = weight(current, lift.current.unit, locale);
  const { load, reps, rpe } = setParts(suggestion.basis, suggestion.unit, locale);
  return {
    setId: logged.setPerformanceId,
    value,
    valueText: weight(value, suggestion.unit, locale),
    headline:
      value > current
        ? $localize`Logged sets suggest about ${about}:value:, up from ${now}:current:.`
        : $localize`Logged sets suggest about ${about}:value:, down from ${now}:current:.`,
    from: $localize`From ${load}:weight: for ${reps}:reps: reps at RPE ${rpe}:rpe: on ${day(logged.performedOn, locale)}:date:, week ${num(logged.weekNumber)}:week:.`,
    explanation: suggestion.explanation,
    keepLabel: $localize`Keep ${now}:current:`,
  };
}

function keptWords(lift: TrainingMaxView, step: number | string, locale: string): string | null {
  const kept = lift.kept;
  if (!kept || lift.suggestion) return null;
  return $localize`You kept ${weight(lift.current.value, lift.current.unit, locale)}:current: on ${day(kept.keptOn, locale)}:date:, when logged sets suggested about ${stepWeight(kept.suggestedValue, kept.unit, step, locale)}:suggested:.`;
}

function entryWords(entry: TrainingMaxEntryView, firstName: string, locale: string): string {
  return `${sourceWords(entry, firstName)} · ${day(entry.setOn, locale)}`;
}

function cardOf(
  lift: TrainingMaxView,
  step: number | string,
  firstName: string,
  locale: string,
): MaxCard {
  const current = lift.current;
  const previous = lift.earlier[0] ?? null;
  const difference = previous ? num(current.value) - num(previous.value) : 0;
  const amount = weight(Math.abs(difference), current.unit, locale);
  return {
    exerciseId: lift.exerciseId,
    name: lift.exerciseName,
    value: weight(current.value, current.unit, locale),
    source: entryWords(current, firstName, locale),
    basis: basisWords(current, locale),
    change:
      previous === null || difference === 0
        ? null
        : difference > 0
          ? $localize`Up ${amount}:amount: from ${weight(previous.value, previous.unit, locale)}:before:`
          : $localize`Down ${amount}:amount: from ${weight(previous.value, previous.unit, locale)}:before:`,
    appliesFrom:
      previous !== null && num(current.effectiveFromWeek) > 1
        ? $localize`Applies from week ${num(current.effectiveFromWeek)}:week:. Earlier weeks keep ${weight(previous.value, previous.unit, locale)}:before:.`
        : null,
    // The oldest max is the one chosen when the program was assigned. Its stored reason is the
    // engine's own sentence, so it is told in coach words; the later ones carry what the coach wrote.
    earlier: lift.earlier.map((entry, position) => ({
      id: entry.id,
      value: weight(entry.value, entry.unit, locale),
      words: entryWords(entry, firstName, locale),
      reason:
        position === lift.earlier.length - 1
          ? $localize`When the program was assigned`
          : entry.reason,
    })),
    suggestion: suggestionOf(lift, step, locale),
    kept: keptWords(lift, step, locale),
  };
}

export function maxCards(view: TrainingMaxesView, firstName: string, locale: string): MaxCard[] {
  return view.maxes.map((lift) => cardOf(lift, view.loadIncrement, firstName, locale));
}

// ------------------------------------------------------------------------------------------------
// Updating the maxes
// ------------------------------------------------------------------------------------------------

export const MAX_LIMIT = 2000;
export const REASON_LIMIT = 500;

export interface WeekOneSet {
  readonly repetitions: number;
  readonly rpe: number;
  /** The weight the set has now. */
  readonly load: number | null;
}

export interface MaxEditRow {
  readonly exerciseId: string;
  readonly name: string;
  readonly current: number;
  readonly unit: TrainingLoadUnit;
  /** The set "from week 1's weight" reads; null when the chart covers none of this lift's week 1 sets. */
  readonly weekOneSet: WeekOneSet | null;
  /** A training max the coach typed; null while the lift keeps the one it has. */
  readonly value: number | null;
  /** The weight of week 1's first set, from which the max is worked out; null when not used. */
  readonly weekOneWeight: number | null;
  /** What the client's logged sets suggest for this lift; null when they suggest nothing. */
  readonly logged: MaxSuggestion | null;
  /** The coach chose the logged sets' estimate. */
  readonly useLogged: boolean;
}

export function editRows(view: TrainingMaxesView, locale: string): MaxEditRow[] {
  return view.maxes.map((lift) => ({
    exerciseId: lift.exerciseId,
    name: lift.exerciseName,
    current: num(lift.current.value),
    unit: lift.current.unit,
    weekOneSet: lift.weekOneSet
      ? {
          repetitions: num(lift.weekOneSet.repetitions),
          rpe: num(lift.weekOneSet.rpe),
          load: lift.weekOneSet.load === null ? null : num(lift.weekOneSet.load),
        }
      : null,
    value: null,
    weekOneWeight: null,
    logged: suggestionOf(lift, view.loadIncrement, locale),
    useLogged: false,
  }));
}

/** A max is a number, week 1's weight or the logged sets' estimate, one at a time: choosing one clears the others. */
export function withValue(row: MaxEditRow, value: number | null): MaxEditRow {
  return value === null
    ? { ...row, value }
    : { ...row, value, weekOneWeight: null, useLogged: false };
}

export function withWeekOneWeight(row: MaxEditRow, weekOneWeight: number | null): MaxEditRow {
  return weekOneWeight === null
    ? { ...row, weekOneWeight }
    : { ...row, weekOneWeight, value: null, useLogged: false };
}

export function withLogged(row: MaxEditRow, useLogged: boolean): MaxEditRow {
  return useLogged && row.logged
    ? { ...row, useLogged: true, value: null, weekOneWeight: null }
    : { ...row, useLogged: false };
}

function outOfRange(value: number): boolean {
  return !(value > 0) || value > MAX_LIMIT;
}

/** Messages by field: `max:<exercise id>`, `week1:<exercise id>`, or `form` for nothing changed. */
export function editErrors(rows: readonly MaxEditRow[]): FieldMessages {
  const errors: FieldMessages = {};
  let changed = false;
  for (const row of rows) {
    if (row.useLogged && row.logged) changed = true;
    if (row.value !== null) {
      if (outOfRange(row.value)) {
        errors[`max:${row.exerciseId}`] = [
          $localize`Enter a number above 0, up to ${MAX_LIMIT}:limit:.`,
        ];
      } else if (row.value !== row.current) {
        changed = true;
      }
    }
    if (row.weekOneWeight !== null) {
      if (outOfRange(row.weekOneWeight)) {
        errors[`week1:${row.exerciseId}`] = [
          $localize`Enter a weight above 0, up to ${MAX_LIMIT}:limit:.`,
        ];
      } else {
        changed = true;
      }
    }
  }
  if (!changed && Object.keys(errors).length === 0) {
    errors['form'] = [$localize`Change at least one training max.`];
  }
  return errors;
}

/** Only the lifts that change are sent: the server refuses a "change" to the number already in use. */
export function changesRequest(rows: readonly MaxEditRow[]): TrainingMaxChangeRequest[] {
  return rows.flatMap((row): TrainingMaxChangeRequest[] => {
    const exerciseId = row.exerciseId;
    if (row.useLogged && row.logged) {
      return [{ exerciseId, value: null, weekOneWeight: null, loggedSetId: row.logged.setId }];
    }
    if (row.weekOneWeight !== null) {
      return [{ exerciseId, value: null, weekOneWeight: row.weekOneWeight, loggedSetId: null }];
    }
    if (row.value !== null && row.value !== row.current) {
      return [{ exerciseId, value: row.value, weekOneWeight: null, loggedSetId: null }];
    }
    return [];
  });
}

export function reasonErrors(reason: string): string[] {
  return reason.trim().length > REASON_LIMIT
    ? [$localize`Keep the reason to ${REASON_LIMIT}:limit: characters or fewer.`]
    : [];
}

// ------------------------------------------------------------------------------------------------
// What an update would change
// ------------------------------------------------------------------------------------------------

export interface PreviewLiftLine {
  readonly id: string;
  readonly name: string;
  /** "100 kg to 120 kg". */
  readonly change: string;
  /** The server's own words: how the new number was worked out. */
  readonly explanation: string;
}

export interface PreviewSetLine {
  readonly id: string;
  /** "Set 1 · 5 reps · RPE 8". */
  readonly label: string;
  readonly from: string | null;
  readonly to: string;
  /** "+17.5 kg" or "−2.5 kg"; null for a set that had no weight. */
  readonly delta: string | null;
  readonly explanation: string;
}

export interface PreviewExerciseGroup {
  readonly name: string;
  readonly sets: readonly PreviewSetLine[];
}

export interface PreviewSessionGroup {
  readonly id: string;
  /** "Mon 12 Oct · Lower A". */
  readonly title: string;
  readonly exercises: readonly PreviewExerciseGroup[];
}

export interface PreviewWeekGroup {
  readonly number: number;
  readonly title: string;
  readonly sessions: readonly PreviewSessionGroup[];
}

export interface MaxesPreviewSummary {
  readonly lifts: readonly PreviewLiftLine[];
  readonly weeks: readonly PreviewWeekGroup[];
  /** "6 weights change in 3 sessions." */
  readonly counts: string;
  /** "2 sessions have started or are already past, so they keep their weights."; null when none. */
  readonly kept: string | null;
  readonly appliesFrom: string;
  readonly changedSets: number;
}

function setLabel(
  position: number,
  set: TrainingMaxesPreviewView['sets'][number],
  locale: string,
): string {
  const parts = [$localize`Set ${position}:position:`];
  if (set.repetitions !== null) parts.push($localize`${num(set.repetitions)}:reps: reps`);
  if (set.targetRpe !== null) {
    parts.push(`RPE ${formatNumber(num(set.targetRpe), locale, '1.0-1')}`);
  } else if (set.percentageWorkingMax !== null) {
    parts.push(
      $localize`${formatNumber(num(set.percentageWorkingMax), locale, '1.0-2')}:percent:% of the max`,
    );
  }
  return parts.join(' · ');
}

function deltaText(from: number | null, to: number, unit: TrainingLoadUnit, locale: string) {
  if (from === null) return null;
  const difference = to - from;
  const amount = `${formatNumber(Math.abs(difference), locale, '1.0-2')} ${unitLabel(unit)}`;
  return difference < 0 ? `−${amount}` : `+${amount}`;
}

function countsText(preview: TrainingMaxesPreviewView): string {
  const changed = num(preview.changedSetCount);
  const unchanged = num(preview.unchangedSetCount);
  const sessions = num(preview.sessionCount);
  if (changed === 0) {
    return sessions === 0
      ? $localize`No session still to come uses this max, so no weight changes now. The new max is kept for weeks you add later.`
      : $localize`Once rounded, the new max gives the same weights as before.`;
  }
  const weights =
    changed === 1 ? $localize`1 weight changes` : $localize`${changed}:count: weights change`;
  const where =
    sessions === 1 ? $localize`in 1 session` : $localize`in ${sessions}:count: sessions`;
  const same =
    unchanged === 0
      ? ''
      : unchanged === 1
        ? $localize` 1 more stays the same once rounded.`
        : $localize` ${unchanged}:count: more stay the same once rounded.`;
  return `${weights} ${where}.${same}`;
}

function keptText(preview: TrainingMaxesPreviewView): string | null {
  const kept = num(preview.keptSessionCount);
  if (kept === 0) return null;
  return kept === 1
    ? $localize`1 session has started or is already past, so it keeps its weights.`
    : $localize`${kept}:count: sessions have started or are already past, so they keep their weights.`;
}

/** The preview, grouped the way a coach reads a program: week, then day, then lift. */
export function previewSummary(
  preview: TrainingMaxesPreviewView,
  locale: string,
): MaxesPreviewSummary {
  const unit = preview.loadUnit;
  const weeks: {
    number: number;
    sessions: Map<string, { title: string; lifts: Map<string, PreviewSetLine[]> }>;
  }[] = [];
  for (const set of preview.sets) {
    const number = num(set.weekNumber);
    let week = weeks.find((item) => item.number === number);
    if (!week) {
      week = { number, sessions: new Map() };
      weeks.push(week);
    }
    let session = week.sessions.get(set.sessionId);
    if (!session) {
      session = {
        title: `${day(set.scheduledDate, locale)} · ${set.sessionName}`,
        lifts: new Map(),
      };
      week.sessions.set(set.sessionId, session);
    }
    const lines = session.lifts.get(set.exerciseName) ?? [];
    const from = set.previousLoad === null ? null : num(set.previousLoad);
    const to = num(set.newLoad);
    lines.push({
      id: set.setId,
      label: setLabel(lines.length + 1, set, locale),
      from: from === null ? null : weight(from, unit, locale),
      to: weight(to, unit, locale),
      delta: deltaText(from, to, unit, locale),
      explanation: set.explanation,
    });
    session.lifts.set(set.exerciseName, lines);
  }
  return {
    lifts: preview.lifts.map((lift) => ({
      id: lift.exerciseId,
      name: lift.exerciseName,
      change: $localize`${weight(lift.previousValue, lift.unit, locale)}:before: to ${weight(lift.newValue, lift.unit, locale)}:after:`,
      explanation: lift.explanation,
    })),
    weeks: weeks.map((week) => ({
      number: week.number,
      title: $localize`Week ${week.number}:week:`,
      sessions: [...week.sessions].map(([id, session]) => ({
        id,
        title: session.title,
        exercises: [...session.lifts].map(([name, sets]) => ({ name, sets })),
      })),
    })),
    counts: countsText(preview),
    kept: keptText(preview),
    appliesFrom: $localize`The new max applies from week ${num(preview.effectiveFromWeek)}:week:.`,
    changedSets: num(preview.changedSetCount),
  };
}

// ------------------------------------------------------------------------------------------------
// Week 1's weight, read before the program exists (the assign sheet)
// ------------------------------------------------------------------------------------------------

export interface WeekOneAnchor {
  readonly repetitions: number;
  readonly rpe: number;
}

/** What the RTS chart covers: 1 to 12 repetitions at RPE 6.5 to 10, in half steps (STR-010). */
export function chartCovers(repetitions: number, rpe: number): boolean {
  return (
    Number.isInteger(repetitions) &&
    repetitions >= 1 &&
    repetitions <= 12 &&
    rpe >= 6.5 &&
    rpe <= 10 &&
    rpe * 2 === Math.trunc(rpe * 2)
  );
}

/**
 * The set a max would be worked out from: the first working set of the lift in week 1, by day and
 * then position, that names a repetition count and an RPE the chart covers. The server picks it the
 * same way and answers for it; this only lets the sheet say which set the weight is for.
 */
export function weekOneAnchor(
  version: ProgramTemplateVersionView,
  exerciseId: string,
): WeekOneAnchor | null {
  const weekOne = [...version.weeks].sort((a, b) => num(a.weekNumber) - num(b.weekNumber))[0];
  if (!weekOne) return null;
  for (const session of [...weekOne.sessions].sort((a, b) => num(a.dayOffset) - num(b.dayOffset))) {
    const exercises = session.exercises
      .filter((exercise) => exercise.exerciseId === exerciseId)
      .sort((a, b) => num(a.position) - num(b.position));
    for (const exercise of exercises) {
      for (const set of [...exercise.sets].sort((a, b) => num(a.position) - num(b.position))) {
        if (set.setType === 'WarmUp' || set.repetitionsMaximum === null || set.targetRpe === null) {
          continue;
        }
        const repetitions = num(set.repetitionsMaximum);
        const rpe = num(set.targetRpe);
        if (chartCovers(repetitions, rpe)) return { repetitions, rpe };
      }
    }
  }
  return null;
}
