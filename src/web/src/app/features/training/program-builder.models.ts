import { formatDate } from '@angular/common';
import type {
  ExerciseView,
  MovementPattern,
  PreviewWeekProgressionRequest,
  ProgramDraftSummary,
  ProgramTemplateSummary,
  SavedSessionView,
  TrainingLoadStrategy,
  WeekProgressionPreviewView,
} from '../../core/api/generated';
import {
  exerciseEquipmentLabel,
  movementPatternLabel,
  trainingLoadStrategyLabel,
} from '../../core/i18n/display-labels';
import {
  chartPercent,
  RPE_CHART_MAXIMUM_REPS,
  RPE_CHART_MAXIMUM_RPE,
  RPE_CHART_MINIMUM_RPE,
} from './rpe-chart';
import { curvePercent } from './epley-curve';
import { lastTimeStepWords } from './step-words';
import {
  DraftExercise,
  DraftSession,
  DraftSet,
  DraftWeek,
  duplicateSession,
  duplicateWeek,
  emptyExercise,
  emptySession,
  emptyWeek,
  numeric,
  ProgramDraft,
  sessionFromSaved,
  takesTypedWeight,
  toWeekRequest,
  weekFromRequest,
} from './training-builder.models';

/**
 * The program builder (C4) as pure functions over the draft: where things sit on the week × day
 * grid, what a drop or a menu choice does to the draft, and what stops a save. The page draws the
 * result and the server still checks every rule when the program is saved.
 */

/** Session days are offsets 0–6 from the day the program starts (TRN-007), shown as Day 1–7. */
export const DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** A session, found by keys so it survives the copies the page makes of the draft. */
export interface SessionRef {
  weekKey: string;
  sessionKey: string;
}

export interface ExerciseRef extends SessionRef {
  exerciseKey: string;
}

/** One cell of the grid: a week and a day. */
export interface DayRef {
  weekKey: string;
  day: number;
}

// ---------- reading the draft ----------

export function findWeek(draft: ProgramDraft, weekKey: string): DraftWeek | undefined {
  return draft.weeks.find((week) => week.key === weekKey);
}

export function findSession(draft: ProgramDraft, ref: SessionRef): DraftSession | undefined {
  return findWeek(draft, ref.weekKey)?.sessions.find((session) => session.key === ref.sessionKey);
}

/** The sessions on one day of a week, in the order the week keeps them. */
export function daySessions(week: DraftWeek, day: number): DraftSession[] {
  return week.sessions.filter((session) => session.dayOffset === day);
}

/** The days that hold a session in any week: those columns get room, rest days stay narrow. */
export function trainingDays(draft: ProgramDraft): ReadonlySet<number> {
  return new Set(draft.weeks.flatMap((week) => week.sessions.map((session) => session.dayOffset)));
}

/**
 * The grid's columns, the same for every week so the days line up down the page. A day that holds
 * a session somewhere is wide enough for exercise names; a rest day everywhere is a thin strip
 * (its label written downward, with the add button) so the width goes to the training days.
 */
export function gridColumns(draft: ProgramDraft, editingDay: number | null = null): string {
  return columnsFor(trainingDays(draft), editingDay);
}

/** The columns for the days in `used`; the Edit weeks page counts a client's locked sessions too. */
export function columnsFor(used: ReadonlySet<number>, editingDay: number | null): string {
  return DAYS.map((day) =>
    day === editingDay ? 'minmax(20rem, 1.8fr)' : used.has(day) ? 'minmax(9rem, 1fr)' : '2.5rem',
  ).join(' ');
}

/** The weight a client's set was saved with, as it reads ("81 kg"); null keeps the set's share. */
export type SavedLoadOf = (set: DraftSet) => string | null;

/** A template has no client, so none of its sets has a weight (critique B15). */
export const noSavedLoad: SavedLoadOf = () => null;

/**
 * The grid's lines for an exercise (critique B7a): its working sets as a coach writes them, equal
 * neighbours told once as sets × reps ("2 × 10 · 70% of training max · RPE 7" is two sets of ten) and
 * each run of sets that differ on a line of its own, as the client's session sheet tells them. A
 * warm-up never counts (TRAIN-2), so an exercise of warm-ups only says so. On a client's program a
 * set's saved weight stands where its share would ("3 × 5 · 81 kg · RPE 8", critique B15).
 */
export function gridLines(exercise: DraftExercise, savedLoad: SavedLoadOf = noSavedLoad): string[] {
  const sets = exercise.sets;
  if (sets.length === 0) return [$localize`No sets yet`];
  const working = sets.filter((set) => set.setType !== 'WarmUp');
  const warmUps = working.length === 0;
  const runs: { reps: string | null; rest: string; count: number }[] = [];
  for (const set of warmUps ? sets : working) {
    const reps = repsText(set) || null;
    const rest = setParts(set, false, savedLoad(set)).join(' · ');
    const last = runs.at(-1);
    if (last && last.reps === reps && last.rest === rest) last.count += 1;
    else runs.push({ reps, rest, count: 1 });
  }
  return runs.map(({ reps, rest, count }) => {
    const head = warmUps
      ? reps === null
        ? count === 1
          ? $localize`1 warm-up set`
          : $localize`${count}:count: warm-up sets`
        : $localize`${count}:count: × ${reps}:reps: warm-up`
      : reps === null
        ? count === 1
          ? $localize`1 set`
          : $localize`${count}:count: sets`
        : `${count} × ${reps}`;
    return rest ? `${head} · ${rest}` : head;
  });
}

/** Every set's exact prescription, including a coach's override; a preview never guesses a load. */
export function setSummary(set: DraftSet): string {
  return [repsText(set) || $localize`Reps not prescribed`, ...setParts(set, true)].join(' · ');
}

/**
 * What a set asks after its reps: its load, then its effort. The share of a chart or Epley set follows
 * its effort, since the formula reads it from the reps and the RPE ("RPE 8 · 81% of training max"). A
 * saved weight comes first, as any weight does. The grid says nothing for a set with no load; the
 * set's own summary says so. A last time + step set names its step, then any starting weight ("last
 * time + 2 kg · start 5 kg", N6a); no max works it out, so it has no saved weight and no override.
 */
function setParts(set: DraftSet, sayEveryLoad: boolean, saved: string | null = null): string[] {
  const unit = set.loadUnit === 'Pound' ? 'lb' : 'kg';
  const effort =
    set.exertionTarget === null
      ? null
      : `${set.exertionDisplayPreference === 'Rir' ? 'RIR' : 'RPE'} ${set.exertionTarget}`;
  const parts: string[] = [];
  if (set.loadStrategy === 'LastTimeStep') {
    if (set.loadStep !== null) parts.push(lastTimeStepWords(`${set.loadStep}`, unit));
    else if (sayEveryLoad) parts.push(trainingLoadStrategyLabel('LastTimeStep'));
    if (set.loadValue !== null) parts.push($localize`start ${set.loadValue}:load: ${unit}:unit:`);
  } else if (saved !== null) {
    parts.push(saved);
  } else if (set.manualLoadOverride !== null) {
    parts.push(
      sayEveryLoad
        ? $localize`${set.manualLoadOverride}:load: ${unit}:unit: fixed load`
        : `${set.manualLoadOverride} ${unit}`,
    );
  } else if (set.loadStrategy === 'Direct' && set.loadValue !== null) {
    parts.push(`${set.loadValue} ${unit}`);
  } else if (set.loadStrategy === 'PercentageWorkingMax' && set.loadValue !== null) {
    parts.push($localize`${set.loadValue}:percentage:% of training max`);
  } else if (isRpeLoaded(set) && effort !== null && set.repetitionsMaximum !== null) {
    const share = formulaShare(set);
    return [
      effort,
      share !== null
        ? $localize`${Math.round(share)}:percentage:% of training max`
        : set.loadStrategy === 'RpeChart'
          ? $localize`outside the RTS chart`
          : $localize`outside the Epley curve`,
    ];
  } else if (sayEveryLoad) {
    parts.push(
      set.loadStrategy === 'RpeChart'
        ? $localize`Load from RTS chart & effort`
        : set.loadStrategy === 'RpeBasedEpley'
          ? $localize`Load from training max & effort`
          : $localize`No prescribed load`,
    );
  }
  if (effort !== null) parts.push(effort);
  return parts;
}

/** A set's RPE, read from RIR when the coach writes it that way (STR-003). */
export function rpeOf(set: DraftSet): number | null {
  if (set.exertionTarget === null) return null;
  return set.exertionDisplayPreference === 'Rpe' ? set.exertionTarget : 10 - set.exertionTarget;
}

/**
 * The share of the training max an RPE-loaded set's weight will be: the chart's cell for its top reps
 * at its RPE (STR-010) or the Epley curve's (STR-018), as the server works the weight out at
 * assignment. Null when the formula has no answer for the set.
 */
export function formulaShare(set: DraftSet): number | null {
  const rpe = rpeOf(set);
  if (!isRpeLoaded(set) || rpe === null || set.repetitionsMaximum === null) return null;
  return set.loadStrategy === 'RpeChart'
    ? chartPercent(set.repetitionsMaximum, rpe)
    : curvePercent(set.repetitionsMaximum, rpe);
}

/**
 * The warning a % set gets only when the chart says it cannot be done (the owner, 2026-10-27): its
 * share is heavier than the chart allows at RPE 10 for its fewest reps. Nothing else links a % to an
 * RPE: the % sets the weight, and an RPE on a % set is only how hard it should feel. Past 12 reps the
 * chart's last column bounds it, since more reps are never lighter. The share is compared as the
 * sentence shows it, in whole percents.
 */
export function impossiblePercentage(set: DraftSet): string | null {
  if (set.loadStrategy !== 'PercentageWorkingMax' || set.manualLoadOverride !== null) return null;
  const share = set.loadValue;
  if (share === null || !(share > 0)) return null;
  const fewest = set.repetitionsMinimum ?? (set.repetitionsMaximum !== null ? 1 : null);
  if (fewest === null || fewest < 1 || !Number.isInteger(fewest)) return null;
  const reps = Math.min(fewest, RPE_CHART_MAXIMUM_REPS);
  const most = chartPercent(reps, RPE_CHART_MAXIMUM_RPE)!;
  const shown = Math.round(most);
  if (share <= Math.max(most, shown)) return null;
  const asked = repsText(set);
  if (fewest > RPE_CHART_MAXIMUM_REPS) {
    return $localize`${share}:percentage:% × ${asked}:reps: reps is heavier than the chart allows even for ${reps}:chartReps: reps (${shown}:chart:%). Most lifters can’t do it.`;
  }
  return reps === 1
    ? $localize`${share}:percentage:% × ${asked}:reps: reps is heavier than the chart allows for 1 rep (${shown}:chart:%). Most lifters can’t do it.`
    : $localize`${share}:percentage:% × ${asked}:reps: reps is heavier than the chart allows for ${reps}:chartReps: reps (${shown}:chart:%). Most lifters can’t do it.`;
}

/** The two numbers a set stores for its reps; null on either end leaves that end open. */
export type RepsRange = Pick<DraftSet, 'repetitionsMinimum' | 'repetitionsMaximum'>;

/**
 * The Reps box's text for a set (B1): "10", "8–12", or empty. A set saved before the box with only
 * a highest number reads "up to 10", as the client's app says it, and one with only a lowest
 * "at least 8", so opening it changes nothing.
 */
export function repsText(set: RepsRange): string {
  const { repetitionsMinimum: minimum, repetitionsMaximum: maximum } = set;
  if (minimum === null && maximum === null) return '';
  if (minimum === null) return $localize`up to ${maximum}:reps:`;
  if (maximum === null) return $localize`at least ${minimum}:reps:`;
  return minimum === maximum ? `${minimum}` : `${minimum}–${maximum}`;
}

/**
 * Reads the Reps box: "10" stores 10 as both numbers, "8-12" (a hyphen, an en dash or "to") the
 * range, empty no reps, and "up to 10" or "at least 8" one end, as `repsText` shows an older set.
 * Null when the text is none of these; the numbers' limits are `setIssue`'s to check.
 */
export function parseReps(text: string): RepsRange | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const reps = (minimum: string | null, maximum: string | null): RepsRange => ({
    repetitionsMinimum: minimum === null ? null : Number(minimum),
    repetitionsMaximum: maximum === null ? null : Number(maximum),
  });
  if (!value) return reps(null, null);
  const single = /^(\d{1,4})$/.exec(value);
  if (single) return reps(single[1], single[1]);
  const range = /^(\d{1,4}) ?(?:-|–|—|to) ?(\d{1,4})$/.exec(value);
  if (range) return reps(range[1], range[2]);
  const upTo = /^up to (\d{1,4})$/.exec(value);
  if (upTo) return reps(null, upTo[1]);
  const atLeast = /^at least (\d{1,4})$/.exec(value);
  return atLeast ? reps(atLeast[1], null) : null;
}

// ---------- changing the draft ----------
// Every change starts from a deep copy, so the signal always gets a new draft and a drop that is
// refused leaves the old one untouched.

function copy(draft: ProgramDraft): ProgramDraft {
  return structuredClone(draft);
}

/** Sessions keep the order of their days, so the grid and the saved order agree. */
function sortByDay(week: DraftWeek): void {
  week.sessions = week.sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => a.session.dayOffset - b.session.dayOffset || a.index - b.index)
    .map((entry) => entry.session);
}

/** Inserts a session so it becomes the `indexInDay`-th session of its day. */
function placeInDay(week: DraftWeek, session: DraftSession, indexInDay: number): void {
  const sameDay = daySessions(week, session.dayOffset);
  const before = sameDay[indexInDay];
  if (before) {
    week.sessions.splice(week.sessions.indexOf(before), 0, session);
  } else {
    week.sessions.push(session);
  }
  sortByDay(week);
}

/** "Week 3" labels follow the week's place; a label the coach wrote is left as written. */
const DEFAULT_WEEK_LABEL = /^Week \d+$/;

function renumberWeeks(draft: ProgramDraft): void {
  draft.weeks.forEach((week, index) => {
    if (DEFAULT_WEEK_LABEL.test(week.label.trim())) {
      week.label = `Week ${index + 1}`;
    }
  });
}

/** A new exercise from the library, with the swaps the library approves for it. */
export function prescriptionFor(exercise: LibraryExercise): DraftExercise {
  const prescription = emptyExercise(exercise.id, false, exercise.name);
  prescription.approvedAlternativeExerciseIds = exercise.alternatives.map((item) => item.id);
  return prescription;
}

export function addExercise(
  draft: ProgramDraft,
  to: SessionRef,
  index: number,
  exercise: LibraryExercise,
): ProgramDraft {
  const next = copy(draft);
  const session = findSession(next, to);
  if (!session) {
    return draft;
  }
  session.exercises.splice(clamp(index, session.exercises.length), 0, prescriptionFor(exercise));
  return next;
}

export function moveExercise(
  draft: ProgramDraft,
  from: ExerciseRef,
  to: SessionRef,
  index: number,
): ProgramDraft {
  const next = copy(draft);
  const source = findSession(next, from);
  const target = findSession(next, to);
  const position = source?.exercises.findIndex((item) => item.key === from.exerciseKey) ?? -1;
  if (!source || !target || position < 0) {
    return draft;
  }
  const [moved] = source.exercises.splice(position, 1);
  target.exercises.splice(clamp(index, target.exercises.length), 0, moved);
  return next;
}

export function removeExercise(draft: ProgramDraft, ref: ExerciseRef): ProgramDraft {
  const next = copy(draft);
  const session = findSession(next, ref);
  if (!session) {
    return draft;
  }
  session.exercises = session.exercises.filter((item) => item.key !== ref.exerciseKey);
  return next;
}

/** A new, empty session on a day. Returns its key so the page can open it. */
export function addSession(
  draft: ProgramDraft,
  at: DayRef,
  name: string,
): { draft: ProgramDraft; sessionKey: string | null } {
  const next = copy(draft);
  const week = findWeek(next, at.weekKey);
  if (!week) {
    return { draft, sessionKey: null };
  }
  const session = emptySession(at.day);
  session.name = name;
  placeInDay(week, session, daySessions(week, at.day).length);
  return { draft: next, sessionKey: session.key };
}

/**
 * An exercise dropped on a rest day starts a session there: from the library, or taken out of the
 * session it was in.
 */
export function startSessionWith(
  draft: ProgramDraft,
  at: DayRef,
  name: string,
  exercise: { library: LibraryExercise } | { from: ExerciseRef },
): { draft: ProgramDraft; sessionKey: string | null } {
  const next = copy(draft);
  const week = findWeek(next, at.weekKey);
  if (!week) {
    return { draft, sessionKey: null };
  }

  let prescription: DraftExercise;
  if ('library' in exercise) {
    prescription = prescriptionFor(exercise.library);
  } else {
    const source = findSession(next, exercise.from);
    const position =
      source?.exercises.findIndex((item) => item.key === exercise.from.exerciseKey) ?? -1;
    if (!source || position < 0) {
      return { draft, sessionKey: null };
    }
    [prescription] = source.exercises.splice(position, 1);
  }

  const session = emptySession(at.day);
  session.name = name;
  session.exercises.push(prescription);
  placeInDay(week, session, 0);
  return { draft: next, sessionKey: session.key };
}

/** Moves a session to another day, in its own week or another. */
export function moveSession(
  draft: ProgramDraft,
  from: SessionRef,
  to: DayRef,
  indexInDay: number,
): ProgramDraft {
  const next = copy(draft);
  const source = findWeek(next, from.weekKey);
  const target = findWeek(next, to.weekKey);
  const position = source?.sessions.findIndex((item) => item.key === from.sessionKey) ?? -1;
  if (!source || !target || position < 0) {
    return draft;
  }
  const [session] = source.sessions.splice(position, 1);
  session.dayOffset = to.day;
  placeInDay(target, session, indexInDay);
  return next;
}

/** A saved session dropped on a day: a fresh copy, so the library's stays as it is. */
export function insertSavedSession(
  draft: ProgramDraft,
  to: DayRef,
  indexInDay: number,
  saved: SavedSessionView,
): { draft: ProgramDraft; sessionKey: string | null } {
  const next = copy(draft);
  const week = findWeek(next, to.weekKey);
  if (!week) {
    return { draft, sessionKey: null };
  }
  const session = sessionFromSaved(saved);
  session.dayOffset = to.day;
  placeInDay(week, session, indexInDay);
  return { draft: next, sessionKey: session.key };
}

/** A copy of a session on the next day without one, or beside it when the week is full. */
export function copySession(
  draft: ProgramDraft,
  ref: SessionRef,
): { draft: ProgramDraft; sessionKey: string | null } {
  const next = copy(draft);
  const week = findWeek(next, ref.weekKey);
  const session = findSession(next, ref);
  if (!week || !session) {
    return { draft, sessionKey: null };
  }
  const taken = new Set(week.sessions.map((item) => item.dayOffset));
  const freeDay = DAYS.find((day) => day > session.dayOffset && !taken.has(day));
  const duplicate = duplicateSession(session);
  duplicate.dayOffset = freeDay ?? session.dayOffset;
  placeInDay(
    week,
    duplicate,
    freeDay === undefined ? daySessions(week, session.dayOffset).indexOf(session) + 1 : 0,
  );
  return { draft: next, sessionKey: duplicate.key };
}

export function removeSession(draft: ProgramDraft, ref: SessionRef): ProgramDraft {
  const next = copy(draft);
  const week = findWeek(next, ref.weekKey);
  if (!week) {
    return draft;
  }
  week.sessions = week.sessions.filter((item) => item.key !== ref.sessionKey);
  return next;
}

export function addWeek(draft: ProgramDraft): ProgramDraft {
  const next = copy(draft);
  next.weeks.push(emptyWeek(next.weeks.length + 1));
  return next;
}

/** A full copy of a week, straight after it. */
export function duplicateWeekAfter(draft: ProgramDraft, weekKey: string): ProgramDraft {
  const next = copy(draft);
  const index = next.weeks.findIndex((week) => week.key === weekKey);
  if (index < 0) {
    return draft;
  }
  next.weeks.splice(index + 1, 0, duplicateWeek(next.weeks[index]));
  renumberWeeks(next);
  return next;
}

// ---------- duplicate with progression (TRN-025) ----------

/** What each copy moves by, per week: the copy N weeks on moves N times as far. */
export interface ProgressionSteps {
  rpe: number;
  reps: number;
  percentage: number;
  load: number;
}

export const NO_STEPS: Readonly<ProgressionSteps> = { rpe: 0, reps: 0, percentage: 0, load: 0 };
export const MAX_COPIES = 12;
export const MAX_WEEKS = 52;

/** How many copies still fit in the program, up to the most a preview makes. */
export function copiesThatFit(draft: ProgramDraft): number {
  return Math.max(0, Math.min(MAX_COPIES, MAX_WEEKS - draft.weeks.length));
}

/** The request the server previews: the week as the draft holds it, typing not yet saved included. */
export function progressionRequest(
  draft: ProgramDraft,
  weekKey: string,
  copies: number,
  steps: ProgressionSteps,
): PreviewWeekProgressionRequest | null {
  const week = findWeek(draft, weekKey);
  if (!week) return null;
  return {
    sourceWeek: toWeekRequest(week),
    copies,
    steps: {
      rpeStep: steps.rpe,
      repetitionsStep: steps.reps,
      percentageStep: steps.percentage,
      loadStep: steps.load,
    },
    weeksInProgram: draft.weeks.length,
  };
}

/** How many of a week's sets each step would move, so the form can say what a step does here. */
export interface ProgressionReach {
  rpe: number;
  reps: number;
  percentage: number;
  load: number;
  /** The unit of the fixed weights the load step moves: 'kg', 'lb', or both. */
  unit: string | null;
  /** The last time + step sets, whose starting weight alone the load step moves (N6a). */
  stepSets: number;
}

/**
 * Whether the weight step moves this set, as the server's copies do (TRN-025): a typed weight or a
 * step set's starting weight, and a fixed load instead, which a step set never sends.
 */
function movesByWeight(set: DraftSet): boolean {
  return (
    (takesTypedWeight(set.loadStrategy) && set.loadValue !== null) ||
    (set.loadStrategy !== 'LastTimeStep' && set.manualLoadOverride !== null)
  );
}

export function progressionReach(week: DraftWeek): ProgressionReach {
  const sets = week.sessions
    .flatMap((session) => session.exercises)
    .flatMap((exercise) => exercise.sets)
    .filter((set) => set.setType !== 'WarmUp');
  const fixed = sets.filter(movesByWeight);
  const units = new Set(fixed.map((set) => (set.loadUnit === 'Pound' ? 'lb' : 'kg')));
  return {
    rpe: sets.filter((set) => set.exertionTarget !== null).length,
    reps: sets.filter((set) => set.repetitionsMinimum !== null || set.repetitionsMaximum !== null)
      .length,
    percentage: sets.filter(
      (set) => set.loadStrategy === 'PercentageWorkingMax' && set.loadValue !== null,
    ).length,
    load: fixed.length,
    unit: units.size === 0 ? null : [...units].sort().join(' / '),
    stepSets: sets.filter((set) => set.loadStrategy === 'LastTimeStep').length,
  };
}

/** The previewed copies straight after their source week, as the builder holds them. */
export function insertProgression(
  draft: ProgramDraft,
  weekKey: string,
  preview: WeekProgressionPreviewView,
): ProgramDraft {
  const index = draft.weeks.findIndex((week) => week.key === weekKey);
  if (index < 0 || draft.weeks.length + preview.weeks.length > MAX_WEEKS) {
    return draft;
  }
  const next = copy(draft);
  const names = new Map(
    next.weeks.flatMap((week) =>
      week.sessions.flatMap((session) =>
        session.exercises.map((exercise) => [exercise.exerciseId, exercise.exerciseName] as const),
      ),
    ),
  );
  const source = next.weeks[index].label.trim();
  const copies = preview.weeks.map((week, step) => {
    const made = weekFromRequest(week, names);
    // "Week 3" labels are renumbered below; a label the coach wrote gets its place in the run.
    made.label = !source || DEFAULT_WEEK_LABEL.test(source) ? source : `${source} ${step + 2}`;
    return made;
  });
  next.weeks.splice(index + 1, 0, ...copies);
  renumberWeeks(next);
  return next;
}

/** The last week stays: a program has at least one. */
export function removeWeek(draft: ProgramDraft, weekKey: string): ProgramDraft {
  if (draft.weeks.length <= 1) {
    return draft;
  }
  const next = copy(draft);
  next.weeks = next.weeks.filter((week) => week.key !== weekKey);
  renumberWeeks(next);
  return next;
}

export function moveWeek(draft: ProgramDraft, weekKey: string, direction: -1 | 1): ProgramDraft {
  const index = draft.weeks.findIndex((week) => week.key === weekKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.weeks.length) {
    return draft;
  }
  const next = copy(draft);
  const [week] = next.weeks.splice(index, 1);
  next.weeks.splice(target, 0, week);
  renumberWeeks(next);
  return next;
}

/** After an edit in the session sheet: a changed day moves the session to its new place. */
export function resortDays(draft: ProgramDraft): void {
  draft.weeks.forEach(sortByDay);
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

// ---------- drag and drop ----------

/** What is being dragged: from the library panel, or something already on the grid. */
export type DragItem =
  | { kind: 'library'; exercise: LibraryExercise }
  | { kind: 'saved'; saved: SavedSessionView }
  | { kind: 'exercise'; ref: ExerciseRef }
  | { kind: 'session'; ref: SessionRef };

/** Where it can land: a session's exercise list, or a day of a week. */
export type DropTarget =
  { kind: 'session'; ref: SessionRef } | { kind: 'day'; at: DayRef; empty: boolean };

/**
 * Each target takes one kind of thing, so a drop over a session inside a day can never be read as
 * a drop on the day: exercises go into sessions, sessions onto days, and an exercise onto a day only
 * when the day is empty, where it starts a session.
 */
export function accepts(item: DragItem, target: DropTarget): boolean {
  const isExercise = item.kind === 'library' || item.kind === 'exercise';
  if (target.kind === 'session') {
    return isExercise;
  }
  return item.kind === 'session' || item.kind === 'saved' || (target.empty && isExercise);
}

/** The draft after a drop; the same draft when the target does not take the item. */
export function applyDrop(
  draft: ProgramDraft,
  item: DragItem,
  target: DropTarget,
  index: number,
  newSessionName: string,
): ProgramDraft {
  if (!accepts(item, target)) {
    return draft;
  }
  if (target.kind === 'session') {
    return item.kind === 'library'
      ? addExercise(draft, target.ref, index, item.exercise)
      : item.kind === 'exercise'
        ? moveExercise(draft, item.ref, target.ref, index)
        : draft;
  }
  switch (item.kind) {
    case 'session':
      return moveSession(draft, item.ref, target.at, index);
    case 'saved':
      return insertSavedSession(draft, target.at, index, item.saved).draft;
    case 'library':
      return startSessionWith(draft, target.at, newSessionName, { library: item.exercise }).draft;
    case 'exercise':
      return startSessionWith(draft, target.at, newSessionName, { from: item.ref }).draft;
  }
}

// ---------- what stops a save ----------

/** The first thing that stops a save, saying where it is. */
export interface DraftProblem {
  message: string;
  weekKey?: string;
  sessionKey?: string;
  exerciseKey?: string;
  setKey?: string;
}

export function draftProblem(draft: ProgramDraft): DraftProblem | null {
  if (!draft.name.trim()) {
    return { message: $localize`Give the program a name.` };
  }
  if (draft.weeks.length === 0) {
    return { message: $localize`Add at least one week.` };
  }

  for (const [weekIndex, week] of draft.weeks.entries()) {
    for (const session of week.sessions) {
      const where = { weekKey: week.key, sessionKey: session.key };
      const place = session.name.trim()
        ? $localize`Week ${weekIndex + 1}:week:, ${session.name.trim()}:session:`
        : $localize`Week ${weekIndex + 1}:week:, Day ${session.dayOffset + 1}:day:`;
      if (!session.name.trim()) {
        return { ...where, message: $localize`${place}:place:: give the workout a name.` };
      }
      for (const exercise of session.exercises) {
        if (exercise.sets.length === 0) {
          return {
            ...where,
            message: $localize`${place}:place:: every exercise needs at least one set.`,
          };
        }
        for (const set of exercise.sets) {
          const problem = setProblem(set);
          if (problem) {
            return {
              ...where,
              exerciseKey: exercise.key,
              setKey: set.key,
              message: `${place}: ${problem}`,
            };
          }
        }
      }
    }
  }
  return null;
}

/** The same limits the server checks (TRN-005, TRN-016 and the RPE rules), in coach words. */
export function setProblem(set: DraftSet): string | null {
  return setIssue(set)?.message ?? null;
}

export interface SetIssue {
  field:
    | 'repetitionsMinimum'
    | 'repetitionsMaximum'
    | 'restSeconds'
    | 'exertionTarget'
    | 'manualLoadOverride'
    | 'loadValue'
    | 'loadStep';
  message: string;
  /** A formula's limit, which the set editor offers a way out of (critique B7a); the caps stay. */
  limit?: 'chartEffort' | 'chartReps' | 'epleyReps';
}

/** The largest step a last time + step set takes, in the set's unit, as the server checks (TRN-032). */
export const MAXIMUM_LOAD_STEP = 50;

function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * A last time + step set's own limits (TRN-032): its step, then any starting weight, then the reps
 * the step is judged against. Its unit is always one the builder holds.
 */
function lastTimeStepIssue(set: DraftSet): SetIssue | null {
  const unit = set.loadUnit === 'Pound' ? 'lb' : 'kg';
  const step = set.loadStep;
  if (step === null || !(step > 0) || step > MAXIMUM_LOAD_STEP || !hasAtMostTwoDecimals(step)) {
    return {
      field: 'loadStep',
      message: $localize`a step must be more than 0 and at most ${MAXIMUM_LOAD_STEP}:maximum: ${unit}:unit:, with at most two decimals.`,
    };
  }
  // As the server judges it: the weight it would keep, to three decimals, is more than 0.
  if (set.loadValue !== null && !(Math.round(set.loadValue * 1000) > 0 && set.loadValue <= 2000)) {
    return {
      field: 'loadValue',
      message: $localize`a starting weight must be more than 0 and at most 2000, or left empty.`,
    };
  }
  if (set.repetitionsMaximum === null) {
    return {
      field: 'repetitionsMaximum',
      message: $localize`a last time + step set needs its reps: type one number, like 10, or a range, like 8-12.`,
    };
  }
  return null;
}

/** Identifies the field as well as the rule, so both editors explain and focus the same problem. */
export function setIssue(set: DraftSet): SetIssue | null {
  if (set.repetitionsEntry !== undefined && parseReps(set.repetitionsEntry) === null) {
    return {
      field: 'repetitionsMinimum',
      message: $localize`type the reps as one number, like 10, or a range, like 8-12.`,
    };
  }
  for (const field of ['repetitionsMinimum', 'repetitionsMaximum'] as const) {
    const value = set[field];
    if (value !== null && (value < 1 || value > 100))
      return { field, message: $localize`reps must be between 1 and 100.` };
    if (value !== null && !Number.isInteger(value))
      return { field, message: $localize`reps must be whole numbers.` };
  }
  if (
    set.repetitionsMinimum !== null &&
    set.repetitionsMaximum !== null &&
    set.repetitionsMinimum > set.repetitionsMaximum
  ) {
    return {
      field: 'repetitionsMinimum',
      message: $localize`the lowest reps can’t be more than the highest.`,
    };
  }
  if (set.restSeconds !== null && (set.restSeconds < 0 || set.restSeconds > 3600))
    return { field: 'restSeconds', message: $localize`rest must be between 0 and 3600 seconds.` };
  if (set.restSeconds !== null && !Number.isInteger(set.restSeconds))
    return { field: 'restSeconds', message: $localize`rest must be a whole number of seconds.` };
  if (set.exertionTarget !== null) {
    const rpe = set.exertionDisplayPreference === 'Rpe';
    const [minimum, maximum] = rpe ? [5, 10] : [0, 5];
    if (
      set.exertionTarget < minimum ||
      set.exertionTarget > maximum ||
      !Number.isInteger(set.exertionTarget * 2)
    ) {
      return {
        field: 'exertionTarget',
        message: rpe
          ? $localize`RPE must be between 5 and 10 in 0.5 steps.`
          : $localize`RIR must be between 0 and 5 in 0.5 steps.`,
      };
    }
  }
  // A step set sends no override (the server refuses one), so its own limits come first.
  if (set.loadStrategy === 'LastTimeStep') return lastTimeStepIssue(set);
  // The server builds a direct prescription from an override before checking a calculated load.
  if (set.manualLoadOverride !== null) {
    return set.manualLoadOverride <= 0 ||
      set.manualLoadOverride > 2000 ||
      set.loadStrategy === 'None'
      ? {
          field: 'manualLoadOverride',
          message: $localize`a fixed load must be more than 0 and at most 2000, with a load unit.`,
        }
      : null;
  }
  if (
    set.loadStrategy === 'Direct' &&
    (set.loadValue === null || set.loadValue <= 0 || set.loadValue > 2000)
  )
    return {
      field: 'loadValue',
      message: $localize`a set load must be more than 0 and at most 2000.`,
    };
  if (
    set.loadStrategy === 'PercentageWorkingMax' &&
    (set.loadValue === null || set.loadValue <= 0 || set.loadValue > 150)
  )
    return {
      field: 'loadValue',
      message: $localize`a percentage of the training max must be more than 0 and at most 150.`,
    };
  if (set.loadStrategy === 'RpeBasedEpley' || set.loadStrategy === 'RpeChart') {
    if (set.exertionTarget === null || set.repetitionsMaximum === null)
      return {
        field: set.exertionTarget === null ? 'exertionTarget' : 'repetitionsMaximum',
        message: $localize`a load from RPE needs the highest reps and an RPE or RIR target.`,
      };
    const rpe = rpeOf(set)!;
    if (set.loadStrategy === 'RpeChart') {
      // The same range as the server's RTS chart (STR-010), shown early; the server decides.
      if (rpe < RPE_CHART_MINIMUM_RPE)
        return {
          field: 'exertionTarget',
          limit: 'chartEffort',
          message: $localize`the RTS chart starts at RPE 6.5 (RIR 3.5): four or more reps from failure, its percentages no longer hold.`,
        };
      if (set.repetitionsMaximum > RPE_CHART_MAXIMUM_REPS)
        return {
          field: 'repetitionsMaximum',
          limit: 'chartReps',
          message: $localize`the formulas stop at 12 reps, so the RTS chart has no weight for ${set.repetitionsMaximum}:reps: reps.`,
        };
    } else if (set.repetitionsMaximum + (10 - rpe) > 12)
      return {
        field: 'repetitionsMaximum',
        limit: 'epleyReps',
        message: $localize`the formulas stop at 12 reps, and the Epley curve counts the reps left in reserve too: ${set.repetitionsMaximum}:reps: + ${10 - rpe}:reserve: = ${set.repetitionsMaximum + (10 - rpe)}:total:.`,
      };
  }
  return null;
}

/** A way out of a formula's limit, which the set editor offers as a button. */
export type SetWayOut = 'chart' | 'epley' | 'percentage' | 'direct' | 'none';

/**
 * The ways out of a set's formula limit (critique B7a). Past 12 reps the set keeps its reps (sets of
 * 20 stay possible): % of training max and a typed weight take 1 to 100, and the client can pick the
 * weight for an RPE target; an Epley set the RTS chart covers can move to the chart. Too far from
 * failure for the chart, the Epley curve takes the set when its reps plus RIR fit, else a typed weight
 * or the client's own pick. Nothing else is offered for any other problem.
 */
export function setWayOuts(set: DraftSet): SetWayOut[] {
  const limit = setIssue(set)?.limit;
  if (!limit) return [];
  const rpe = rpeOf(set)!;
  const reps = set.repetitionsMaximum!;
  if (limit === 'chartEffort') {
    return reps + (10 - rpe) <= 12 ? ['epley', 'direct'] : ['direct', 'none'];
  }
  const keepReps: SetWayOut[] = ['percentage', 'direct', 'none'];
  return limit === 'epleyReps' && chartPercent(reps, rpe) !== null
    ? ['chart', ...keepReps]
    : keepReps;
}

const WAY_OUT_STRATEGY: Record<SetWayOut, TrainingLoadStrategy> = {
  chart: 'RpeChart',
  epley: 'RpeBasedEpley',
  percentage: 'PercentageWorkingMax',
  direct: 'Direct',
  none: 'None',
};

/** What each way out does to the set: its reps and effort stay, only where its weight comes from moves. */
export function takeWayOut(set: DraftSet, way: SetWayOut): void {
  set.manualLoadOverride = null;
  set.loadStrategy = WAY_OUT_STRATEGY[way];
}

// ---------- RPE formulas (STR-010) ----------

/**
 * What the RTS RPE chart covers, from the builder's pinned copy of the server's chart, to warn while
 * the coach types. The server decides when the program is published or assigned.
 */
export const RPE_CHART = {
  minimumRpe: RPE_CHART_MINIMUM_RPE,
  maximumRpe: RPE_CHART_MAXIMUM_RPE,
  maximumReps: RPE_CHART_MAXIMUM_REPS,
} as const;

export type RpeFormula = Extract<TrainingLoadStrategy, 'RpeChart' | 'RpeBasedEpley'>;

export const RPE_FORMULAS: readonly RpeFormula[] = ['RpeChart', 'RpeBasedEpley'];

export function isRpeLoaded(set: DraftSet): boolean {
  return set.loadStrategy === 'RpeChart' || set.loadStrategy === 'RpeBasedEpley';
}

function everySet(draft: ProgramDraft): DraftSet[] {
  return draft.weeks.flatMap((week) =>
    week.sessions.flatMap((session) => session.exercises.flatMap((exercise) => exercise.sets)),
  );
}

export function rpeLoadedSetCount(draft: ProgramDraft): number {
  return everySet(draft).filter(isRpeLoaded).length;
}

/** The formula the program's RPE-loaded sets use; 'mixed' when they disagree, null when none does. */
export function programFormula(draft: ProgramDraft): RpeFormula | 'mixed' | null {
  const used = new Set(
    everySet(draft)
      .filter(isRpeLoaded)
      .map((set) => set.loadStrategy),
  );
  if (used.size === 0) return null;
  if (used.size > 1) return 'mixed';
  return used.has('RpeChart') ? 'RpeChart' : 'RpeBasedEpley';
}

/** RTS-chart sets the chart cannot cover (RPE under 6.5 or over 12 reps): they need a weight or the Epley curve. */
export function outsideChartCount(draft: ProgramDraft): number {
  return everySet(draft).filter((set) => {
    if (set.loadStrategy !== 'RpeChart' || set.exertionTarget === null) return false;
    const rpe =
      set.exertionDisplayPreference === 'Rpe' ? set.exertionTarget : 10 - set.exertionTarget;
    return rpe < RPE_CHART.minimumRpe || (set.repetitionsMaximum ?? 0) > RPE_CHART.maximumReps;
  }).length;
}

/** Every RPE-loaded set in the draft moves to one formula; the weights are worked out at assignment. */
export function withProgramFormula(draft: ProgramDraft, formula: RpeFormula): ProgramDraft {
  const next = copy(draft);
  for (const set of everySet(next)) {
    if (isRpeLoaded(set)) set.loadStrategy = formula;
  }
  return next;
}
// ---------- the exercise library panel ----------

export type LibraryGroup = 'all' | 'squat' | 'hinge' | 'push' | 'pull' | 'single' | 'other';

export interface LibraryExercise {
  id: string;
  name: string;
  /** "Barbell · Squat". */
  detail: string;
  group: Exclude<LibraryGroup, 'all'>;
  /** Up to two letters for the tile when there is no picture. */
  initials: string;
  /** The swaps the library offers for it, as named when read, archived ones flagged. */
  alternatives: readonly LibraryAlternative[];
  /** The first picture or video the coach attached, if any. */
  mediaId: string | null;
  /** Every picture and video attached, in order: the demos a coach can watch on the grid (P4). */
  mediaIds: readonly string[];
}

const GROUP_OF: Record<MovementPattern, Exclude<LibraryGroup, 'all'>> = {
  Squat: 'squat',
  Hinge: 'hinge',
  HorizontalPush: 'push',
  VerticalPush: 'push',
  HorizontalPull: 'pull',
  VerticalPull: 'pull',
  Isolation: 'single',
  Carry: 'other',
  Rotation: 'other',
  Locomotion: 'other',
  Mobility: 'other',
  Other: 'other',
};

export function groupLabel(group: LibraryGroup): string {
  const labels: Record<LibraryGroup, string> = {
    all: $localize`All`,
    squat: $localize`Squat`,
    hinge: $localize`Hinge`,
    push: $localize`Push`,
    pull: $localize`Pull`,
    single: $localize`Single joint`,
    other: $localize`Other`,
  };
  return labels[group];
}

/** The movement patterns a chip asks the server for (WEA-14). */
export interface LibraryAlternative {
  id: string;
  name: string;
  isArchived: boolean;
}

/** What the server reads of a library list's filter: two that ask the same are one search (WEA-14). */
export function libraryFilterKey(filter: { query: string; group: LibraryGroup }): string {
  return `${filter.group}|${filter.query.trim().toLocaleLowerCase().split(/\s+/).join(' ')}`;
}

export function groupPatterns(group: Exclude<LibraryGroup, 'all'>): MovementPattern[] {
  return (Object.keys(GROUP_OF) as MovementPattern[]).filter(
    (pattern) => GROUP_OF[pattern] === group,
  );
}

export function libraryExercise(view: ExerciseView): LibraryExercise {
  const equipment = exerciseEquipmentLabel(view.equipment);
  const pattern = movementPatternLabel(view.movementPattern);
  const words = view.name.trim().split(/\s+/).filter(Boolean);
  return {
    id: view.id,
    name: view.name,
    detail: `${equipment} · ${pattern}`,
    group: GROUP_OF[view.movementPattern],
    initials: words
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase() ?? '')
      .join(''),
    alternatives: view.alternatives.map((item) => ({
      id: item.exerciseId,
      name: item.exerciseName,
      isArchived: item.isArchived,
    })),
    mediaId: view.mediaAssetIds[0] ?? null,
    mediaIds: [...view.mediaAssetIds],
  };
}

export interface LibraryChip {
  value: LibraryGroup;
  label: string;
  count: number;
}

/**
 * "All" and then only the groups the library has, so no chip leads to nothing, from the server's count of
 * the library's exercises under each pattern (the builder never reads the whole library, WEA-14).
 */
export function libraryChips(
  patterns: readonly { pattern: MovementPattern; count: number | string }[],
): LibraryChip[] {
  const order: Exclude<LibraryGroup, 'all'>[] = [
    'squat',
    'hinge',
    'push',
    'pull',
    'single',
    'other',
  ];
  const counts = new Map<LibraryGroup, number>();
  for (const item of patterns) {
    const group = GROUP_OF[item.pattern];
    if (group) counts.set(group, (counts.get(group) ?? 0) + numeric(item.count));
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [
    { value: 'all' as LibraryGroup, label: groupLabel('all'), count: total },
    ...order
      .map((group) => ({
        value: group as LibraryGroup,
        label: groupLabel(group),
        count: counts.get(group) ?? 0,
      }))
      .filter((chip) => chip.count > 0),
  ];
}

/**
 * The library entries a program needs beyond the pages the coach browsed: every lift it holds and the swaps
 * approved for it. The swaps the library offers come named with each lift, so names, swaps and demos never
 * depend on the whole library (WEA-14).
 */
export function programLibraryIds(draft: ProgramDraft): string[] {
  const ids = new Set<string>();
  for (const exercise of draft.weeks.flatMap((week) => week.sessions).flatMap((s) => s.exercises)) {
    if (!exercise.exerciseId) continue;
    ids.add(exercise.exerciseId);
    for (const id of exercise.approvedAlternativeExerciseIds) ids.add(id);
  }
  return [...ids];
}

/**
 * Every exercise name the page has read: its exercises', and the swaps they offer unless archived, which a
 * sheet then calls an archived exercise as it did when the whole library was read.
 */
export function libraryNames(exercises: readonly LibraryExercise[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const alternative of exercises.flatMap((exercise) => exercise.alternatives)) {
    if (!alternative.isArchived) names.set(alternative.id, alternative.name);
  }
  for (const exercise of exercises) names.set(exercise.id, exercise.name);
  return names;
}

// ---------- the program list ----------

export interface ProgramCard {
  id: string;
  name: string;
  /** Where the card opens: the program, or a new program's draft. */
  link: readonly string[];
  query: Record<string, string> | null;
  weeks: string;
  status: string;
  tone: 'success' | 'neutral';
  /** Changes not published yet: the coach's own draft, or a newest version that is a draft. */
  note: string | null;
  changed: string;
}

function weeksText(weeks: number): string {
  return weeks === 1 ? $localize`1 week` : $localize`${weeks}:count: weeks`;
}

export function programCard(template: ProgramTemplateSummary, locale: string): ProgramCard {
  const latest = template.versions[0];
  const weeks = latest ? numeric(latest.weekCount) : 0;
  const assignable = template.versions.some((version) => version.isPublished);
  const draft = template.draft ?? null;
  return {
    id: template.id,
    name: template.name,
    link: ['/training/programs', template.id],
    query: null,
    weeks: weeksText(draft ? numeric(draft.weekCount) : weeks),
    status: assignable ? $localize`Ready to assign` : $localize`Draft`,
    tone: assignable ? 'success' : 'neutral',
    note: draft
      ? $localize`Your changes are not published yet`
      : assignable && latest && !latest.isPublished
        ? $localize`Newest changes not published`
        : null,
    changed: draft
      ? $localize`Changed ${formatDate(draft.updatedAtUtc, 'EEE d MMM', locale)}:date:`
      : latest
        ? $localize`Changed ${formatDate(latest.createdAtUtc, 'EEE d MMM', locale)}:date:`
        : '',
  };
}

/** A new program kept as its coach's draft (TRN-024): theirs alone until it is published. */
export function draftCard(draft: ProgramDraftSummary, locale: string): ProgramCard {
  return {
    id: draft.id,
    name: draft.name.trim() || $localize`Untitled program`,
    link: ['/training/programs', 'new'],
    query: { draft: draft.id },
    weeks: weeksText(numeric(draft.weekCount)),
    status: $localize`Draft`,
    tone: 'neutral',
    note: $localize`Only you can see it until you publish it`,
    changed: $localize`Changed ${formatDate(draft.updatedAtUtc, 'EEE d MMM', locale)}:date:`,
  };
}

export interface VersionRow {
  id: string;
  title: string;
  /** "Open version 2", so each row's button says which version it opens. */
  openLabel: string;
  state: string;
  isPublished: boolean;
  date: string;
  isOpen: boolean;
}

/** The history sheet: every saved version, newest first (plan §6: versions only in history). */
export function versionRows(
  template: ProgramTemplateSummary,
  openVersionId: string | null,
  locale: string,
): VersionRow[] {
  return template.versions.map((version) => ({
    id: version.id,
    title: $localize`Version ${numeric(version.versionNumber)}:number:`,
    openLabel: $localize`Open version ${numeric(version.versionNumber)}:number:`,
    state: version.isPublished ? $localize`Published` : $localize`Draft`,
    isPublished: version.isPublished,
    date: formatDate(version.createdAtUtc, 'EEE d MMM, HH:mm', locale),
    isOpen: version.id === openVersionId,
  }));
}

/** The version a program opens on: the newest, unless the address names an older one. */
export function versionToOpen(
  template: ProgramTemplateSummary,
  requested: string | null,
): string | null {
  const named = requested && template.versions.find((version) => version.id === requested);
  return named ? named.id : (template.versions[0]?.id ?? null);
}
