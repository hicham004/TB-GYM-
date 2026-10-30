/**
 * A pinned copy of the server's RpeChart v1 (STR-010, `RtsRpeChart` in the Strength module): the
 * Tuchscherer chart of what share of a max a set of 1 to 12 reps at RPE 6.5 to 10 is. The builder reads
 * it to show a chart set's percentage and to say when a % set is heavier than the chart allows; the
 * server still works every weight out and decides. The cells are never edited here: a change is
 * RpeChart v2 on the server first. The server's domain tests parse this file and fail on any cell that
 * differs from theirs.
 */
export const RPE_CHART_VERSION = '1.0';
export const RPE_CHART_MINIMUM_RPE = 6.5;
export const RPE_CHART_MAXIMUM_RPE = 10;
export const RPE_CHART_MAXIMUM_REPS = 12;

// Row 0 is RPE 10, row 7 is RPE 6.5; column 0 is 1 rep, column 11 is 12.
const PERCENTAGES: readonly (readonly number[])[] = [
  [100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0],
  [97.8, 93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7],
  [95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3],
  [93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0],
  [92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6],
  [90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3],
  [89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9],
  [87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3, 58.6],
];

/** Whether the chart has a cell for this many reps at this RPE, in its half steps. */
export function chartCovers(repetitions: number, rpe: number): boolean {
  return (
    Number.isInteger(repetitions) &&
    repetitions >= 1 &&
    repetitions <= RPE_CHART_MAXIMUM_REPS &&
    rpe >= RPE_CHART_MINIMUM_RPE &&
    rpe <= RPE_CHART_MAXIMUM_RPE &&
    Number.isInteger(rpe * 2)
  );
}

/** The chart's percentage of the max, one decimal as printed; null outside the chart, never a guess. */
export function chartPercent(repetitions: number, rpe: number): number | null {
  if (!chartCovers(repetitions, rpe)) return null;
  return PERCENTAGES[(RPE_CHART_MAXIMUM_RPE - rpe) * 2][repetitions - 1];
}
