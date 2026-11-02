import type { TrainingLoadUnit } from '../../core/api/generated';

/**
 * The plates for a target weight (docs/MOTION-PLAN-2026-11.md, W11): a reading of a weight in the
 * client's own unit as a barbell loaded from the collar out, on a fixed set, since no domain data
 * describes a gym's plates. It is a guide and changes nothing in the set or the coach's numbers.
 *
 * The split is `plates-greedy-v1`: the biggest plate first, per side, which loads every weight the
 * set can make (each plate is made of the smaller ones); the 25 kg plate, which many gyms lack,
 * goes on only where it saves a plate, so 100 kg is 20 and 20 a side and 120 kg is 25 and 25. A
 * weight no plate set makes names the nearest loadable weights below and above it; one under the
 * bar is "lighter than the bar".
 * Kilograms and pounds are never converted (TRN-019): each unit has its own bar and plates.
 */

/** The strategy's name and version, for the words that explain it and for the tests that pin it. */
export const PLATE_STRATEGY = 'plates-greedy-v1';

export interface PlateSet {
  readonly unit: TrainingLoadUnit;
  /** The bar the sheet opens with, and the one a tap switches to. */
  readonly bars: readonly [number, number];
  /** The plates, heaviest first. */
  readonly plates: readonly number[];
  /** A plate many gyms lack, loaded only where it saves a plate against the rest. */
  readonly rare?: number;
}

/** The fixed sets: competition kilogram plates on a 20 kg bar, pound plates on a 45 lb bar. */
export const PLATE_SETS: Readonly<Record<TrainingLoadUnit, PlateSet>> = {
  Kilogram: { unit: 'Kilogram', bars: [20, 15], plates: [25, 20, 15, 10, 5, 2.5, 1.25], rare: 25 },
  Pound: { unit: 'Pound', bars: [45, 35], plates: [45, 35, 25, 10, 5, 2.5] },
};

export interface PlateSplit {
  readonly strategy: typeof PLATE_STRATEGY;
  readonly target: number;
  readonly bar: number;
  /** The plates on one side, from the collar out (heaviest first); empty for the bar alone. */
  readonly perSide: readonly number[];
  /** `loadable` is a weight the set makes exactly; the other two name why not. */
  readonly state: 'loadable' | 'not-loadable' | 'lighter-than-bar';
  /** The nearest loadable weights either side of a target the set cannot make, else the target. */
  readonly below: number | null;
  readonly above: number | null;
}

/** Hundredths keep 1.25 and 2.5 exact: no floating-point remainder decides a plate. */
const SCALE = 100;

/** Splits `target` over `bar` with the set's plates, the biggest first, per side. */
export function splitPlates(target: number, set: PlateSet, bar = set.bars[0]): PlateSplit {
  const whole = Math.round(target * SCALE);
  const barWhole = Math.round(bar * SCALE);
  if (!Number.isFinite(target) || whole < barWhole) {
    return {
      strategy: PLATE_STRATEGY,
      target,
      bar,
      perSide: [],
      state: 'lighter-than-bar',
      below: null,
      above: bar,
    };
  }
  const step = Math.round(set.plates[set.plates.length - 1] * SCALE) * 2;
  const over = whole - barWhole;
  if (over % step !== 0) {
    const below = barWhole + Math.floor(over / step) * step;
    return {
      strategy: PLATE_STRATEGY,
      target,
      bar,
      perSide: greedy(below - barWhole, set),
      state: 'not-loadable',
      below: below / SCALE,
      above: (below + step) / SCALE,
    };
  }
  return {
    strategy: PLATE_STRATEGY,
    target,
    bar,
    perSide: greedy(over, set),
    state: 'loadable',
    below: target,
    above: target,
  };
}

/**
 * One side's plates for `overWhole` hundredths above the bar, the biggest first; the rare plate only
 * where it makes the side with fewer plates.
 */
function greedy(overWhole: number, set: PlateSet): number[] {
  const common = biggestFirst(
    overWhole,
    set.plates.filter((plate) => plate !== set.rare),
  );
  if (set.rare === undefined) return common;
  const withRare = biggestFirst(overWhole, set.plates);
  return withRare.length < common.length ? withRare : common;
}

function biggestFirst(overWhole: number, candidates: readonly number[]): number[] {
  let side = overWhole / 2;
  const plates: number[] = [];
  for (const plate of candidates) {
    const whole = Math.round(plate * SCALE);
    while (side >= whole) {
      plates.push(plate);
      side -= whole;
    }
  }
  return plates;
}

/**
 * The next loadable weight from `target` in `direction` (+1 or -1): the smallest plate on each side
 * away for a loadable weight, else the nearest loadable weight that way; null below the bar.
 */
export function stepLoadable(
  target: number,
  set: PlateSet,
  bar: number,
  direction: 1 | -1,
): number | null {
  const split = splitPlates(target, set, bar);
  const step = set.plates[set.plates.length - 1] * 2;
  if (split.state === 'lighter-than-bar') return direction > 0 ? bar : null;
  if (split.state === 'not-loadable') return direction > 0 ? split.above : split.below;
  const next = Math.round((target + direction * step) * SCALE) / SCALE;
  return next < bar ? null : next;
}

/** The words for one side: "15, 1.25", or "none" for the bar alone. */
export function perSideWords(perSide: readonly number[]): string {
  return perSide.length === 0 ? $localize`none` : perSide.map((plate) => String(plate)).join(', ');
}

/** "kg" or "lb". */
export function plateUnitLabel(unit: TrainingLoadUnit): string {
  return unit === 'Pound' ? 'lb' : 'kg';
}
