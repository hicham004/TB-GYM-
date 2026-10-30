import type { TrainingLoadStrategy } from '../../core/api/generated';

/** The formulas that work a set's weight out from the client's training max (STR-002, STR-010). */
export type MaxFormula = Extract<
  TrainingLoadStrategy,
  'PercentageWorkingMax' | 'RpeChart' | 'RpeBasedEpley'
>;

const MAX_FORMULAS: readonly MaxFormula[] = ['PercentageWorkingMax', 'RpeChart', 'RpeBasedEpley'];

/** A set as the builder holds it or a published program gives it: only what the rule reads. */
export interface MaxRuleSet {
  readonly loadStrategy: TrainingLoadStrategy;
  /** A weight the coach typed in the builder, which the server saves as a direct load. */
  readonly manualLoadOverride?: number | string | null;
  /** A published set whose typed weight won over its formula. */
  readonly isManualLoadOverride?: boolean;
}

interface MaxRuleWeek {
  readonly sessions: readonly {
    readonly exercises: readonly {
      readonly exerciseId: string;
      readonly exerciseName: string;
      readonly sets: readonly MaxRuleSet[];
    }[];
  }[];
}

/**
 * The formula a set works its weight out from the training max with, or null. It is the rule Assign
 * program asks a lift's max by, and the server's: an assignment needs exactly one max for each lift
 * with such a set. A typed weight is saved as a direct load, so a set that has one needs no max.
 */
export function maxFormulaOf(set: MaxRuleSet): MaxFormula | null {
  if (set.isManualLoadOverride || (set.manualLoadOverride ?? null) !== null) return null;
  return MAX_FORMULAS.find((formula) => formula === set.loadStrategy) ?? null;
}

export interface LiftNeedingMax {
  readonly exerciseId: string;
  readonly name: string;
  /** How many of its sets work their weight out from the max, by formula. */
  readonly sets: ReadonlyMap<MaxFormula, number>;
  /** The program's weeks, from 1, that hold those sets. */
  readonly weeks: readonly number[];
}

/** The lifts that will need a training max when the program is assigned, in the order they first come. */
export function liftsNeedingMax(weeks: readonly MaxRuleWeek[]): LiftNeedingMax[] {
  const lifts = new Map<string, { name: string; sets: Map<MaxFormula, number>; weeks: number[] }>();
  weeks.forEach((week, index) => {
    for (const exercise of week.sessions.flatMap((session) => session.exercises)) {
      for (const set of exercise.sets) {
        const formula = maxFormulaOf(set);
        if (!formula) continue;
        let lift = lifts.get(exercise.exerciseId);
        if (!lift) {
          lift = { name: exercise.exerciseName, sets: new Map(), weeks: [] };
          lifts.set(exercise.exerciseId, lift);
        }
        lift.name ||= exercise.exerciseName;
        lift.sets.set(formula, (lift.sets.get(formula) ?? 0) + 1);
        if (lift.weeks.at(-1) !== index + 1) lift.weeks.push(index + 1);
      }
    }
  });
  return [...lifts].map(([exerciseId, lift]) => ({ exerciseId, ...lift }));
}

/** "week 2", "weeks 1 to 4", "weeks 1, 3 and 5", "weeks 1 to 3 and 6": a list of week numbers in words. */
export function weekListWords(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  if (sorted.length === 1) return $localize`week ${sorted[0]}:week:`;
  // Runs of three or more read "1 to 3"; a pair stays two numbers ("1 and 2").
  const parts: string[] = [];
  let start = 0;
  for (let index = 1; index <= sorted.length; index++) {
    if (index < sorted.length && sorted[index] === sorted[index - 1] + 1) continue;
    const run = sorted.slice(start, index);
    if (run.length >= 3) parts.push($localize`${run[0]}:first: to ${run.at(-1)}:last:`);
    else parts.push(...run.map(String));
    start = index;
  }
  const list = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(parts);
  return $localize`weeks ${list}:weeks:`;
}

function formulaName(formula: MaxFormula): string {
  switch (formula) {
    case 'PercentageWorkingMax':
      return $localize`% of training max`;
    case 'RpeChart':
      return $localize`the RTS chart`;
    case 'RpeBasedEpley':
      return $localize`the Epley curve`;
  }
}

/** Why Assign program asks for this lift's max: "3 sets use % of training max in weeks 1 to 4". */
export function maxReason(lift: LiftNeedingMax): string {
  const uses = MAX_FORMULAS.filter((formula) => lift.sets.has(formula)).map((formula) => {
    const count = lift.sets.get(formula)!;
    return count === 1
      ? $localize`1 set uses ${formulaName(formula)}:formula:`
      : $localize`${count}:count: sets use ${formulaName(formula)}:formula:`;
  });
  const list = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(uses);
  return $localize`${list}:uses: in ${weekListWords(lift.weeks)}:weeks:`;
}
