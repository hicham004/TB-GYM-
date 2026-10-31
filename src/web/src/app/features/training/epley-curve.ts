/**
 * A pinned copy of the curve in the server's WorkingMaxLoad v2 (STR-005,
 * `StrengthLoadRecommendationStrategy` in the Strength module): an Epley set's weight is the training
 * max / (1 + (reps + reps in reserve) / 30). The builder reads it to show that share on a template,
 * which has no client and so no weight; the server still works every weight out and decides. The
 * cells are never edited here: a change is a new WorkingMaxLoad version on the server first. The
 * server's domain tests parse this file and fail on any cell that differs from theirs.
 */
export const EPLEY_CURVE_VERSION = '2.0';
export const EPLEY_CURVE_MINIMUM_RPE = 5;
export const EPLEY_CURVE_MAXIMUM_RPE = 10;
export const EPLEY_CURVE_MAXIMUM_REPS = 12;

// One cell per half rep of reps plus reserve: cell 0 is 1, cell 22 is 12. Each is the weight the
// server works out from a training max of 100, to its own three decimals.
const PERCENTAGES: readonly number[] = [
  96.774, 95.238, 93.75, 92.308, 90.909, 89.552, 88.235, 86.957, 85.714, 84.507, 83.333, 82.192,
  81.081, 80, 78.947, 77.922, 76.923, 75.949, 75, 74.074, 73.171, 72.289, 71.429,
];

/** Whether the curve takes this many reps at this RPE: reps plus reserve up to 12, in half steps. */
export function curveCovers(repetitions: number, rpe: number): boolean {
  return (
    Number.isInteger(repetitions) &&
    repetitions >= 1 &&
    rpe >= EPLEY_CURVE_MINIMUM_RPE &&
    rpe <= EPLEY_CURVE_MAXIMUM_RPE &&
    Number.isInteger(rpe * 2) &&
    repetitions + (10 - rpe) <= EPLEY_CURVE_MAXIMUM_REPS
  );
}

/** The curve's percentage of the training max; null past its limit, never a guess. */
export function curvePercent(repetitions: number, rpe: number): number | null {
  if (!curveCovers(repetitions, rpe)) return null;
  return PERCENTAGES[(repetitions + (10 - rpe) - 1) * 2];
}
