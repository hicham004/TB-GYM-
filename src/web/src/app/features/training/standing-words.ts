import { formatDate, formatNumber } from '@angular/common';
import type {
  LiftStandingView,
  LoggedSet,
  SetStanding,
  TrainingLoadUnit,
} from '../../core/api/generated';
import { houseDay } from '../../core/i18n/house-dates';

/** One piece of a standing line; the strong piece is what happens next. */
export interface StandingPart {
  readonly text: string;
  readonly strong: boolean;
}

/**
 * Where a lift stands, as the coach reads it on the session sheet and a logged workout (LastTimeStep v1,
 * STR-019, notes plan N6b): "Last 15 kg × 10, 10, 10 on Tue · every set done · next time 17 kg", or a hold
 * and its reason, "Same weight · set 3 reached 8 of 10 on Tue". The server judged it on its own day
 * (`judgedOn`), so the days here never come from the device's clock.
 */
export interface StandingLine {
  readonly outcome: 'StepUp' | 'Hold';
  readonly parts: readonly StandingPart[];
  /** The whole line as one sentence, for tests and anything that reads it at once. */
  readonly text: string;
}

type Quantity = number | string | null | undefined;

const number = (value: Quantity): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

/** Weights to the gram, never rounded further (decision 22): "17.5", "22.125". */
function amount(value: Quantity, locale: string): string {
  return formatNumber(number(value) ?? 0, locale, '1.0-3');
}

const unitWord = (unit: TrainingLoadUnit | null | undefined) => (unit === 'Pound' ? 'lb' : 'kg');

function weight(
  value: Quantity,
  unit: TrainingLoadUnit | null | undefined,
  locale: string,
): string {
  return `${amount(value, locale)} ${unitWord(unit)}`;
}

/** Whole days from `from` to `to`, both workspace dates ("2026-11-10"). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "today", "yesterday", "Tue" within the week, "Tue 3 Nov" before it. */
function dayWord(day: string, today: string, locale: string): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return $localize`today`;
  if (ago === 1) return $localize`yesterday`;
  return ago > 1 && ago < 7 ? formatDate(day, 'EEE', locale) : houseDay(day, locale, today);
}

/** "today", "yesterday", "on Tue" within the week, "on Tue 3 Nov" before it. */
function onDay(day: string, today: string, locale: string): string {
  const ago = daysBetween(day, today);
  return ago === 0 || ago === 1
    ? dayWord(day, today, locale)
    : $localize`on ${dayWord(day, today, locale)}:day:`;
}

/** Line (g): "Finish today’s workout", "Finish Monday’s workout", "Finish the workout from Mon 3 Nov". */
function finishWords(day: string, today: string, locale: string): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return $localize`Finish today’s workout to go up`;
  if (ago === 1) return $localize`Finish yesterday’s workout to go up`;
  if (ago > 1 && ago < 7) {
    return $localize`Finish ${formatDate(day, 'EEEE', locale)}:day:’s workout to go up`;
  }
  return $localize`Finish the workout from ${houseDay(day, locale, today)}:day: to go up`;
}

/** Last time's logged sets, equal weights told once: "15 kg × 10, 10, 10" or "20 kg × 10, 22.5 kg × 8". */
function loggedSets(sets: readonly LoggedSet[], locale: string): string {
  const groups: { weight: string | null; reps: string[] }[] = [];
  for (const set of sets) {
    if (!set.isCompleted) continue;
    const load = set.weight === null ? null : weight(set.weight, set.unit, locale);
    const reps = set.repetitions === null ? '–' : amount(set.repetitions, locale);
    const last = groups.at(-1);
    if (last && last.weight === load) last.reps.push(reps);
    else groups.push({ weight: load, reps: [reps] });
  }
  return groups
    .map((group) =>
      group.weight === null
        ? $localize`${group.reps.join(', ')}:reps: reps`
        : `${group.weight} × ${group.reps.join(', ')}`,
    )
    .join(', ');
}

/**
 * The weights the sets go to: once when every set goes to the same, "17 kg", else naming the sets, equal
 * neighbours together, "22.5 kg on set 2, 25 kg on sets 3–4", so the coach sees which set gets which.
 */
function weights(sets: readonly SetStanding[], locale: string): string | null {
  if (sets.length === 0) return null;
  const unit = unitWord(sets[0]?.unit);
  const ordered = [...sets].sort((a, b) => Number(a.setNumber) - Number(b.setNumber));
  const values = ordered.map((set) => amount(set.weight, locale));
  if (new Set(values).size === 1) return `${values[0]} ${unit}`;
  const groups: { first: number; last: number; value: string }[] = [];
  ordered.forEach((set, index) => {
    const place = Number(set.setNumber);
    const last = groups.at(-1);
    if (last && last.value === values[index] && last.last === place - 1) last.last = place;
    else groups.push({ first: place, last: place, value: values[index] });
  });
  return groups
    .map((group) =>
      group.first === group.last
        ? $localize`${group.value}:weight: ${unit}:unit: on set ${group.first}:set:`
        : $localize`${group.value}:weight: ${unit}:unit: on sets ${group.first}:first:–${group.last}:last:`,
    )
    .join(', ');
}

/**
 * A set that does not step while the answer moves the others, with the weight the answer gives it (its
 * own, or the latest it carried on): "set 4 is new since Tue, stays at 25 kg".
 */
function setNote(set: SetStanding, since: string, locale: string): string | null {
  const own = set.weight === null ? null : weight(set.weight, set.unit, locale);
  const place = amount(set.setNumber, locale);
  switch (set.note) {
    case 'NewSet':
      return own === null
        ? $localize`set ${place}:set: is new since ${since}:day:`
        : $localize`set ${place}:set: is new since ${since}:day:, stays at ${own}:weight:`;
    case 'NoWeightLogged':
      return own === null
        ? $localize`set ${place}:set: had no weight logged`
        : $localize`set ${place}:set: had no weight logged, stays at ${own}:weight:`;
    case 'NoRepsTyped':
      return own === null
        ? $localize`set ${place}:set: was logged without reps`
        : $localize`set ${place}:set: was logged without reps, stays at ${own}:weight:`;
    case 'AboveLimit':
      return $localize`set ${place}:set: stays at ${weight(set.weight, set.unit, locale)}:weight:, as a step would pass ${weight(2000, set.unit, locale)}:limit:`;
    default:
      return null;
  }
}

/**
 * The lead of a hold that keeps last time's weights (lines a and c): "Same weight" when the sets already
 * have them, else the weights to keep, "Keep 15 kg", as after a new program's starting weight (line d).
 */
function holdLead(view: LiftStandingView, locale: string): string {
  // A set with a note says its own weight after the reason; the lead names the others, or all when none is left.
  const carried = view.standing.sets.filter((set) => set.move === 'SameAsLastTime');
  const plain = carried.filter((set) => set.note === 'None');
  const kept = plain.length > 0 ? plain : carried;
  const changes = kept.some((set) => number(set.weight) !== number(set.currentWeight));
  if (!changes) return $localize`Same weight`;
  return $localize`Keep ${weights(kept, locale)}:weight:`;
}

/** An effort on the scale the coach wrote it in: RPE as stored, RIR as 10 minus RPE (STR-003). */
function effort(
  rpe: Quantity,
  display: LiftStandingView['exertionDisplay'],
  locale: string,
): string {
  const value = number(rpe) ?? 0;
  return formatNumber(display === 'Rir' ? 10 - value : value, locale, '1.0-1');
}

const scale = (display: LiftStandingView['exertionDisplay']) => (display === 'Rir' ? 'RIR' : 'RPE');

/** The hold's reason, in the coach's words, or null for a hold whose lead says it all. */
function reasonText(view: LiftStandingView, locale: string): string | null {
  const { reason, judgedOn } = view.standing;
  const day = reason.day ?? judgedOn;
  const on = onDay(day, judgedOn, locale);
  const set = reason.setNumber === null ? '' : amount(reason.setNumber, locale);
  switch (reason.kind) {
    case 'NeverDone':
      return $localize`nothing logged yet to step from`;
    case 'LastDoneTooLongAgo':
      return $localize`last done ${houseDay(day, locale, judgedOn)}:day:, more than 14 days ago`;
    case 'NoMatchLastTime':
      return $localize`nothing to match ${on}:day:`;
    case 'LoggedInOtherUnit':
      return $localize`set ${set}:set: logged in ${unitWord(reason.unit)}:unit: ${on}:day:`;
    case 'LooksLikeTypo':
      return $localize`${weight(reason.weight, reason.unit, locale)}:weight: logged ${on}:day: looks like a typo (${weight(reason.earlierWeight, reason.unit, locale)}:earlier: before)`;
    case 'SetNotLogged':
      return $localize`set ${set}:set: not logged ${on}:day:`;
    case 'NoRepsTyped':
      return $localize`set ${set}:set: logged without reps ${on}:day:`;
    case 'RepsShort':
      return $localize`set ${set}:set: reached ${amount(reason.repetitions, locale)}:reps: of ${amount(reason.repetitionsAsked, locale)}:asked: ${on}:day:`;
    case 'HarderThanPlanned': {
      const rated = effort(reason.rpe, view.exertionDisplay, locale);
      const target = effort(reason.targetRpe, view.exertionDisplay, locale);
      return $localize`set ${set}:set: felt harder than planned ${on}:day: (${scale(view.exertionDisplay)}:scale: ${rated}:rated: of ${target}:target:)`;
    }
    case 'NoWeightLogged':
      return $localize`set ${set}:set: had no weight logged ${on}:day:`;
    case 'AboveLimit':
      return $localize`a step would pass ${weight(2000, view.standing.sets[0]?.unit, locale)}:limit:`;
    default:
      return null;
  }
}

/** The set note a lift's hold reason already says, when no set could step for that reason. */
const TOLD_BY_REASON: Partial<
  Record<LiftStandingView['standing']['reason']['kind'], SetStanding['note']>
> = {
  NoWeightLogged: 'NoWeightLogged',
  NoRepsTyped: 'NoRepsTyped',
  AboveLimit: 'AboveLimit',
  NoMatchLastTime: 'NewSet',
};

/**
 * "every set done", or "every working set done" when a warm-up last time was skipped, short or had no reps:
 * warm-ups never decide the step (STR-019), and the line says so rather than call them done.
 */
function doneWords(sets: readonly LoggedSet[]): string {
  const warmUpMissed = sets.some(
    (set) =>
      set.setType === 'WarmUp' &&
      (!set.isCompleted ||
        set.repetitions === null ||
        (set.repetitionsAsked !== null && Number(set.repetitions) < Number(set.repetitionsAsked))),
  );
  return warmUpMissed ? $localize`every working set done` : $localize`every set done`;
}

export function standingLine(view: LiftStandingView, locale: string): StandingLine {
  const { standing } = view;
  const parts: StandingPart[] = [];
  const day = standing.lastTime?.day ?? standing.reason.day ?? standing.judgedOn;
  if (standing.outcome === 'StepUp') {
    const last = standing.lastTime;
    if (last) {
      parts.push({
        text: $localize`Last ${loggedSets(last.sets, locale)}:sets: ${onDay(day, standing.judgedOn, locale)}:day:`,
        strong: false,
      });
    }
    parts.push({ text: last ? doneWords(last.sets) : $localize`every set done`, strong: false });
    const stepping = standing.sets.filter((set) => set.move === 'StepUp');
    parts.push({ text: $localize`next time ${weights(stepping, locale)}:weight:`, strong: true });
  } else if (standing.reason.kind === 'WorkoutInProgress') {
    parts.push({
      text: finishWords(standing.reason.day ?? standing.judgedOn, standing.judgedOn, locale),
      strong: true,
    });
  } else {
    const lead =
      standing.reason.kind === 'RepsShort' ||
      standing.reason.kind === 'NoRepsTyped' ||
      standing.reason.kind === 'SetNotLogged' ||
      standing.reason.kind === 'HarderThanPlanned' ||
      standing.reason.kind === 'NoWeightLogged' ||
      standing.reason.kind === 'AboveLimit'
        ? holdLead(view, locale)
        : standing.reason.kind === 'NeverDone'
          ? $localize`First time`
          : $localize`Same weight`;
    parts.push({ text: lead, strong: true });
    const reason = reasonText(view, locale);
    if (reason) parts.push({ text: reason, strong: false });
  }
  // Every set that keeps its own weight while the answer moves the others says so, step or hold alike;
  // a note the hold's own reason already gives is not said twice.
  const since = dayWord(day, standing.judgedOn, locale);
  const told = TOLD_BY_REASON[standing.reason.kind];
  const named = standing.reason.setNumber === null ? null : Number(standing.reason.setNumber);
  for (const set of standing.sets) {
    const said = set.note === told && (named === null || Number(set.setNumber) === named);
    const note = said ? null : setNote(set, since, locale);
    if (note) parts.push({ text: note, strong: false });
  }
  return { outcome: standing.outcome, parts, text: parts.map((part) => part.text).join(' · ') };
}

/**
 * Whether a logged workout should say where its lift stands: only the workout the answer read as last time,
 * or the running one a forgotten Finish waits on. An older workout would describe another one's sets.
 */
export function standingBelongsTo(
  standing: LiftStandingView,
  workout: { workoutExecutionId: string | null },
): boolean {
  const { lastTime, reason } = standing.standing;
  if (lastTime) return lastTime.workoutExecutionId === workout.workoutExecutionId;
  return (
    reason.kind === 'WorkoutInProgress' &&
    workout.workoutExecutionId !== null &&
    reason.workoutExecutionId === workout.workoutExecutionId
  );
}

/** The standing of one writing on the session sheet: the coming session's exercise. */
export function standingFor(
  standings: readonly LiftStandingView[] | null | undefined,
  exercisePrescriptionId: string,
): LiftStandingView | null {
  return standings?.find((item) => item.exercisePrescriptionId === exercisePrescriptionId) ?? null;
}

/**
 * The standing of each exercise of a logged workout, by the lift the coach wrote there and which writing of
 * it the exercise is (line f): the first by position matches the coming session's first. A writing swapped
 * for another lift keeps its place in the count but is not the lift's, as on the server (STR-019).
 */
export function standingsByExercise(
  exercises: readonly {
    prescriptionId: string;
    prescribedExerciseId: string;
    actualExerciseId: string;
  }[],
  standings: readonly LiftStandingView[] | null | undefined,
): Map<string, LiftStandingView> {
  const found = new Map<string, LiftStandingView>();
  if (!standings?.length) return found;
  const seen = new Map<string, number>();
  for (const exercise of exercises) {
    const occurrence = (seen.get(exercise.prescribedExerciseId) ?? 0) + 1;
    seen.set(exercise.prescribedExerciseId, occurrence);
    if (exercise.actualExerciseId !== exercise.prescribedExerciseId) continue;
    const match = standings.find(
      (item) =>
        item.exerciseId === exercise.prescribedExerciseId && Number(item.occurrence) === occurrence,
    );
    if (match) found.set(exercise.prescriptionId, match);
  }
  return found;
}
