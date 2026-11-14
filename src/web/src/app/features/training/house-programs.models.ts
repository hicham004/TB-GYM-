import { formatDate, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  HouseProgramMaxSource,
  HouseProgramMaxView,
  HouseProgramSampleExerciseView,
  HouseProgramSampleSessionView,
  HouseProgramStartedView,
  HouseProgramsView,
  HouseProgramView,
  TrainingLoadUnit,
} from '../../core/api/generated';
import { ownTrainingClosedWords } from './own-workout.models';
import { addDays, unitLabel } from './training-program.models';

/**
 * TB Gym's programs as a self-directed trainee of the house reads them (notes plan N9c4, TRN-034): whom
 * each suits, a sample week, the maxes it works its weights out from, and whether it can start now. Pure
 * functions of the server's answer, so every line has a fixed test. The server decides what may start and
 * why not (N9c3); this only says it, in the house's words. Every day comes from the server, never the
 * browser's clock: `today` is the house's day.
 */

/** The trainee's max one lift of a program reads, in the program's unit; none until they type one. */
export interface HouseProgramMax {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly unit: TrainingLoadUnit;
  readonly value: number | null;
  readonly from: HouseProgramMaxSource | null;
  readonly on: string | null;
}

export interface HouseSampleExercise {
  readonly exerciseId: string;
  readonly name: string;
  readonly isMainLift: boolean;
  readonly sets: number;
  readonly repetitionsMinimum: number | null;
  readonly repetitionsMaximum: number | null;
}

export interface HouseSampleSession {
  readonly name: string;
  /** Days after the week's first: 0 is its first day. */
  readonly dayOffset: number;
  readonly exercises: readonly HouseSampleExercise[];
}

/** One program TB Gym offers, as the trainee may start it. "Started n times" is the staff's alone. */
export interface HouseProgram {
  readonly listingId: string;
  readonly templateId: string;
  /** The version read, sent back on Start so a program changed since is refused, never started blind. */
  readonly templateVersionId: string;
  readonly name: string;
  readonly description: string | null;
  readonly suits: string;
  readonly runName: string | null;
  readonly runPosition: number | null;
  readonly weeks: number;
  readonly loadUnit: TrainingLoadUnit;
  readonly sampleWeek: readonly HouseSampleSession[];
  readonly maxes: readonly HouseProgramMax[];
  readonly canStart: boolean;
  readonly refusal: string | null;
  /** The first day it can start, when that is a known day: inclusive. */
  readonly opensOn: string | null;
  /** The last day it can start inside the pass: inclusive. */
  readonly lastStartDay: string | null;
}

export interface HouseProgramPass {
  readonly enrollmentId: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  /** The pass's last day: the day before its exclusive end. */
  readonly lastDay: string;
}

export interface HouseProgramRunning {
  readonly programId: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly lastDay: string;
}

/** What `GET /api/training/me/house-programs` says. */
export interface HousePrograms {
  readonly today: string;
  readonly pass: HouseProgramPass | null;
  readonly running: HouseProgramRunning | null;
  /** In the server's order: runs first, by run and block, then the rest by name. */
  readonly programs: readonly HouseProgram[];
}

export interface HouseProgramStarted {
  readonly programId: string;
  readonly listingId: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
}

const nullableNumber = (value: null | number | string): number | null =>
  value === null || value === '' ? null : Number(value);

function toMax(view: HouseProgramMaxView): HouseProgramMax {
  return {
    exerciseId: view.exerciseId,
    exerciseName: view.exerciseName,
    unit: view.unit,
    value: nullableNumber(view.value),
    from: view.value === null ? null : view.from,
    on: view.value === null ? null : view.on,
  };
}

function toExercise(view: HouseProgramSampleExerciseView): HouseSampleExercise {
  return {
    exerciseId: view.exerciseId,
    name: view.name,
    isMainLift: view.isMainLift,
    sets: Number(view.sets),
    repetitionsMinimum: nullableNumber(view.repetitionsMinimum),
    repetitionsMaximum: nullableNumber(view.repetitionsMaximum),
  };
}

function toSession(view: HouseProgramSampleSessionView): HouseSampleSession {
  return {
    name: view.name,
    dayOffset: Number(view.dayOffset),
    exercises: view.exercises.map(toExercise),
  };
}

export function toHouseProgram(view: HouseProgramView): HouseProgram {
  const runName = view.runName?.trim().replace(/\s+/g, ' ') || null;
  return {
    listingId: view.listingId,
    templateId: view.templateId,
    templateVersionId: view.templateVersionId,
    name: view.name,
    description: view.description?.trim() || null,
    suits: view.suits.trim(),
    runName,
    runPosition: runName === null ? null : nullableNumber(view.runPosition),
    weeks: Number(view.weeks),
    loadUnit: view.loadUnit,
    sampleWeek: view.sampleWeek.map(toSession),
    maxes: view.maxes.map(toMax),
    canStart: view.canStart,
    refusal: view.canStart ? null : view.refusal || 'unknown',
    opensOn: view.opensOn,
    lastStartDay: view.lastStartDay,
  };
}

export function toHousePrograms(view: HouseProgramsView): HousePrograms {
  return {
    today: view.today,
    pass: view.pass ? { ...view.pass, lastDay: addDays(view.pass.endDateExclusive, -1) } : null,
    running: view.running
      ? { ...view.running, lastDay: addDays(view.running.endDateExclusive, -1) }
      : null,
    programs: view.programs.map(toHouseProgram),
  };
}

export function toHouseProgramStarted(view: HouseProgramStartedView): HouseProgramStarted {
  return {
    programId: view.programId,
    listingId: view.listingId,
    name: view.name,
    startDate: view.startDate,
    endDateExclusive: view.endDateExclusive,
  };
}

// ---------- the lines a card shows ----------

/**
 * A day as the page writes it: "Thu 26 Nov" this year, "Thu 7 Jan 2027" in another. Noon keeps a bare
 * date on its own day in every time zone.
 */
export function programDay(date: string, today: string, locale: string): string {
  const format = date.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'EEE d MMM y';
  return formatDate(`${date}T12:00:00`, format, locale);
}

/** "Block 2 of Strength Base", when the program is one block of a run. */
export function blockLine(program: HouseProgram): string | null {
  if (program.runName === null || program.runPosition === null) return null;
  return $localize`Block ${program.runPosition}:position: of ${program.runName}:run:`;
}

/** "6 weeks · kg". */
export function weeksLine(program: HouseProgram): string {
  const unit = unitLabel(program.loadUnit);
  return program.weeks === 1
    ? $localize`1 week · ${unit}:unit:`
    : $localize`${program.weeks}:weeks: weeks · ${unit}:unit:`;
}

/** "Day 4 · Upper B": the week's first day is day 1. */
export function sessionLine(session: HouseSampleSession): string {
  return $localize`Day ${session.dayOffset + 1}:day: · ${session.name}:session:`;
}

/** A set's reps: "5", "8–12", or null when the program asks for none. */
export function repsText(minimum: number | null, maximum: number | null): string | null {
  if (minimum === null && maximum === null) return null;
  if (minimum === null || maximum === null || minimum === maximum) {
    return String(minimum ?? maximum);
  }
  return `${minimum}–${maximum}`;
}

/** "3 × 5", "2 × 8–12", or "3 sets" when the program asks for no reps. */
export function setsText(exercise: HouseSampleExercise): string {
  const reps = repsText(exercise.repetitionsMinimum, exercise.repetitionsMaximum);
  if (reps !== null) return `${exercise.sets} × ${reps}`;
  return exercise.sets === 1 ? $localize`1 set` : $localize`${exercise.sets}:sets: sets`;
}

/** A max in its unit: "140 kg", "102.35 lb". */
export function maxValue(value: number, unit: TrainingLoadUnit, locale: string): string {
  return `${formatNumber(value, locale, '1.0-2')} ${unitLabel(unit)}`;
}

/** Where a max came from: "typed Thu 12 Nov", "from your last program", or "not typed yet". */
export function maxSource(max: HouseProgramMax, today: string, locale: string): string {
  if (max.value === null) return $localize`not typed yet`;
  if (max.from === 'LastProgram') return $localize`from your last program`;
  if (max.on) return $localize`typed ${programDay(max.on, today, locale)}:day:`;
  return $localize`typed`;
}

/** "Back squat: 140 kg, typed Thu 12 Nov" or "Back squat: not typed yet", the lift's name apart. */
export function maxDetail(max: HouseProgramMax, today: string, locale: string): string {
  const source = maxSource(max, today, locale);
  return max.value === null ? source : `${maxValue(max.value, max.unit, locale)}, ${source}`;
}

/** Whether every lift the program reads has a max: the button then says Change, not Type. */
export function allMaxesTyped(program: HouseProgram): boolean {
  return program.maxes.length > 0 && program.maxes.every((max) => max.value !== null);
}

/** "A", "A and B", "A, B and C", as the server joins the lifts it is missing. */
export function liftList(names: readonly string[]): string {
  return new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(names);
}

/** A run's name compared as the server keys it: trimmed, single-spaced, any case. */
export function runKey(name: string | null): string | null {
  const key = name?.trim().replace(/\s+/g, ' ').toLowerCase();
  return key || null;
}

/** What the page knows beside a card: the read's day, the pass, the program running, the list. */
export interface RefusalContext {
  readonly today: string;
  readonly locale: string;
  readonly pass: HouseProgramPass | null;
  readonly running: HouseProgramRunning | null;
  readonly programs: readonly HouseProgram[];
}

/**
 * Why a program cannot start, in the house's words, from the server's code and the days it sent; null
 * when the card says nothing of its own (on Free the pass card says Pro+ is needed, once for all).
 */
export function refusalWords(
  code: string,
  program: HouseProgram,
  context: RefusalContext,
): string | null {
  const day = (date: string) => programDay(date, context.today, context.locale);
  switch (code) {
    case 'house_program_needs_pass':
      return null;
    case 'house_program_block_not_open': {
      const position = program.runPosition ?? 1;
      const run = program.runName ?? '';
      const before = position - 1;
      if (program.opensOn) {
        return $localize`Block ${position}:position: of ${run}:run: opens on ${day(program.opensOn)}:day:, once block ${before}:before: has ended.`;
      }
      const key = runKey(program.runName);
      const offered = context.programs.some(
        (other) =>
          other.listingId !== program.listingId &&
          runKey(other.runName) === key &&
          other.runPosition === before,
      );
      return offered
        ? $localize`This is block ${position}:position: of ${run}:run:. Start block ${before}:before: first.`
        : $localize`This is block ${position}:position: of ${run}:run:, and block ${before}:before: isn’t offered now, so it can’t start yet.`;
    }
    case 'mesocycle_overlap': {
      if (program.opensOn) {
        const until = day(addDays(program.opensOn, -1));
        const holding = context.running
          ? $localize`“${context.running.name}:program:” runs until ${until}:day:.`
          : $localize`The program you’re on runs until ${until}:day:.`;
        return program.lastStartDay && program.opensOn <= program.lastStartDay
          ? $localize`${holding}:holding: One program at a time: this one can start from ${day(program.opensOn)}:opens:.`
          : $localize`${holding}:holding: One program at a time.`;
      }
      // No day: a workout of a block whose plan ended is still open. No read lists that workout now, so the
      // page never sends the trainee to finish it; it says what holds the days.
      return context.running
        ? $localize`A workout you started in “${context.running.name}:program:” is still open, and its plan has ended, so another program can’t start yet.`
        : $localize`A workout you started in the program you’re on is still open, and its plan has ended, so another program can’t start yet.`;
    }
    case 'house_program_does_not_fit':
      return program.lastStartDay && context.pass
        ? $localize`This block runs ${program.weeks}:weeks: weeks and your pass ends on ${day(context.pass.lastDay)}:passEnd:, so the last day to start it was ${day(program.lastStartDay)}:lastStart:. Start it under your next pass.`
        : $localize`This block runs ${program.weeks}:weeks: weeks, longer than your pass, so it can’t start under it.`;
    case 'house_program_needs_maxes': {
      const missing = program.maxes
        .filter((max) => max.value === null)
        .map((max) => max.exerciseName);
      const lifts = liftList(
        missing.length > 0 ? missing : program.maxes.map((max) => max.exerciseName),
      );
      const unit = unitLabel(program.loadUnit);
      return $localize`Type your max for ${lifts}:lifts: first, in ${unit}:unit:: this program works its weights out from it.`;
    }
    case 'house_program_unit':
      return $localize`This program mixes kg and lb, so it can’t be started until TB Gym puts it in one unit.`;
    case 'house_program_not_offered':
      return $localize`TB Gym no longer offers this program.`;
    case 'training_closed':
      return ownTrainingClosedWords('');
    default:
      return $localize`This program can’t start right now.`;
  }
}

/** Whether the read says Training is closed: the server then refuses every program with the same code. */
export function trainingClosed(read: HousePrograms): boolean {
  return read.programs.some((program) => program.refusal === 'training_closed');
}

/**
 * Whether the program running is one whose plan has ended while a workout of it is still open: the server
 * then refuses a program it would otherwise weigh with `mesocycle_overlap` and no day (N9c3), so its days
 * hold no end the page could name. A block whose plan ended with no workout open is never listed running:
 * the next Start closes it.
 */
export function runningStranded(read: HousePrograms): boolean {
  return (
    read.running !== null &&
    read.programs.some(
      (program) => program.refusal === 'mesocycle_overlap' && program.opensOn === null,
    )
  );
}

/**
 * Whether the pass card speaks of Max (notes plan N9c5b): TB Gym coaches the trainee, so their coach
 * picks their program, and with no Pro+ pass there is nothing for the page to offer. A running Pro+ pass
 * keeps its own card, since the trainee may still start under it; a profile not read (null) keeps Free's.
 */
export function coachedOnMax(read: HousePrograms, coachedByTheHouse: boolean | null): boolean {
  return read.pass === null && coachedByTheHouse === true;
}

/** What the Start confirmation says: the program's length from the house's day, and one at a time. */
export function startQuestion(
  program: HouseProgram,
  today: string,
  locale: string,
): { readonly title: string; readonly message: string } {
  const last = programDay(addDays(today, program.weeks * 7 - 1), today, locale);
  return {
    title: $localize`Start ${program.name}:program:?`,
    message:
      program.weeks === 1
        ? $localize`It runs 1 week, from today until ${last}:lastDay:. One program at a time: TB Gym’s other programs wait until it ends.`
        : $localize`It runs ${program.weeks}:weeks: weeks, from today until ${last}:lastDay:. One program at a time: TB Gym’s other programs wait until it ends.`,
  };
}

/** A refused Start: its words, whether the list is out of date, and whether the next press needs a new key. */
export interface StartRefusal {
  readonly message: string;
  /** The read on screen is out of date: the page reads the list again and says this above it. */
  readonly stale: boolean;
  /** The key was spent on another start: the next press makes a new one. */
  readonly newKey: boolean;
}

/** The words for a Start the server refused, from its code and the card's read. */
export function startRefusal(
  error: unknown,
  program: HouseProgram,
  context: RefusalContext,
): StartRefusal {
  const said = (message: string, stale = false, newKey = false): StartRefusal => ({
    message,
    stale,
    newKey,
  });
  if (!(error instanceof HttpErrorResponse) || error.status === 0) {
    return said($localize`Couldn’t start it. Check your connection and try again.`);
  }
  // Training closed since the read: reading again shows the page's closed state.
  if (error.status === 403) return said(ownTrainingClosedWords(''), true);
  if (error.status === 404) {
    return said($localize`TB Gym no longer offers this program. Pick another from the list.`, true);
  }
  const body = (error.error ?? null) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : null;
  switch (code) {
    case 'house_program_changed':
      return said(
        $localize`TB Gym changed this program since you read it. Read it again, then start it.`,
        true,
      );
    case 'house_program_not_offered':
      return said(
        $localize`TB Gym no longer offers this program. Pick another from the list.`,
        true,
      );
    case 'idempotency_conflict':
      return said($localize`Couldn’t start it. Press Start again.`, false, true);
    // The card could start when it was read, so these depend on what the server holds now (another tab's
    // Start, a max, the pass): words from the old read would be wrong. Read again: each card says its own.
    case 'mesocycle_overlap':
    case 'house_program_block_not_open':
    case 'house_program_does_not_fit':
    case 'house_program_needs_maxes':
      return said($localize`Your programs changed since you read them. Here they are again.`, true);
    case 'house_program_needs_pass':
      return said(
        $localize`Your Pro+ pass isn’t running now, so this program couldn’t start.`,
        true,
      );
    case null:
      return said(
        error.status >= 500
          ? $localize`Couldn’t start it. Try again.`
          : $localize`This program can’t start right now.`,
      );
    default:
      return said(
        refusalWords(code, program, context) ??
          apiErrorMessage(error, $localize`This program can’t start right now.`),
      );
  }
}

// ---------- typing a max ----------

/** The most a trainee may type for a max, as the server allows it (STR, N9c3): 500 kg or 1,100 lb. */
export const TRAINEE_MAX_LIMIT: Readonly<Record<TrainingLoadUnit, number>> = {
  Kilogram: 500,
  Pound: 1100,
};

/** Whether a number has two decimals at most; 102.35 is not exactly 10235 hundredths in floating point. */
function hasTwoDecimalsAtMost(value: number): boolean {
  const hundredths = value * 100;
  return Math.abs(hundredths - Math.round(hundredths)) < 1e-6;
}

/** What is wrong with a typed max, checked as the server checks it; null when it may be sent. */
export function maxProblem(value: number, unit: TrainingLoadUnit): string | null {
  return Number.isFinite(value) &&
    value > 0 &&
    value <= TRAINEE_MAX_LIMIT[unit] &&
    hasTwoDecimalsAtMost(value)
    ? null
    : $localize`Enter a max above 0 and at most 500 kg (1,100 lb), with two decimals at most.`;
}

/** The sentence under a lift's box: where the max shown came from. */
export function maxHelp(max: HouseProgramMax, today: string, locale: string): string {
  if (max.value === null) return $localize`Not typed yet.`;
  if (max.from === 'LastProgram') return $localize`From your last program.`;
  return max.on
    ? $localize`Typed ${programDay(max.on, today, locale)}:day:.`
    : $localize`Typed by you.`;
}

/** A max the sheet could not save: under its box (a 400 on the value), or in the summary. */
export interface MaxRefusal {
  readonly field: string | null;
  readonly message: string;
  /** The page's read is out of date (no pass any more, Training closed, not the house's lift). */
  readonly stale: boolean;
}

function firstMessage(value: unknown): string | null {
  const first = Array.isArray(value) ? (value as unknown[])[0] : null;
  return typeof first === 'string' && first.trim() ? first : null;
}

export function maxRefusal(error: unknown): MaxRefusal {
  const fallback = $localize`Your max couldn’t be saved. Try again.`;
  if (error instanceof HttpErrorResponse) {
    const body = (error.error ?? null) as { code?: unknown; errors?: unknown } | null;
    if (error.status === 400 && typeof body?.errors === 'object' && body.errors !== null) {
      const errors = body.errors as Record<string, unknown>;
      const value = firstMessage(errors['value'] ?? errors['Value']);
      if (value) return { field: value, message: value, stale: false };
    }
    if (error.status === 409 && body?.code === 'house_program_needs_pass') {
      return {
        field: null,
        message: $localize`Typing your max is for a program, which needs Pro+.`,
        stale: true,
      };
    }
    if (error.status === 404) {
      return {
        field: null,
        message: $localize`TB Gym’s programs changed since you opened this. Close it to read them again.`,
        stale: true,
      };
    }
    if (error.status === 403) {
      return { field: null, message: ownTrainingClosedWords(''), stale: true };
    }
  }
  return { field: null, message: apiErrorMessage(error, fallback), stale: false };
}
