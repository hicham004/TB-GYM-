import { describe, expect, it } from 'vitest';
import { chartCovers, chartPercent } from './rpe-chart';

const RPE_ROWS = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5];

// RpeChart v1 exactly as the server's RpeChartDomainTests lock it. A failing cell here means the copy
// was changed by accident; the server's own test compares this file with its chart cell by cell.
const LOCKED = [
  [100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0],
  [97.8, 93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7],
  [95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3],
  [93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0],
  [92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6],
  [90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3],
  [89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9],
  [87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3, 58.6],
];

describe('the pinned RpeChart v1', () => {
  it('has every one of its 96 cells as locked', () => {
    const mismatches: string[] = [];
    RPE_ROWS.forEach((rpe, row) => {
      for (let reps = 1; reps <= 12; reps++) {
        const cell = chartPercent(reps, rpe);
        if (cell !== LOCKED[row][reps - 1]) mismatches.push(`RPE ${rpe} × ${reps}: ${cell}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('gives the cells the plan names', () => {
    expect(chartPercent(5, 8)).toBe(81.1);
    expect(chartPercent(10, 10)).toBe(73.9);
    expect(chartPercent(5, 7)).toBe(78.6);
  });

  it('covers RPE 6.5 to 10 in half steps and 1 to 12 reps, and nothing past them', () => {
    expect(chartCovers(1, 10)).toBe(true);
    expect(chartCovers(12, 6.5)).toBe(true);
    for (const [reps, rpe] of [
      [0, 8],
      [13, 8],
      [5, 6],
      [5, 5],
      [5, 10.5],
      [5, 7.25],
      [5.5, 8],
    ]) {
      expect(chartCovers(reps, rpe), `${reps} at RPE ${rpe}`).toBe(false);
      expect(chartPercent(reps, rpe)).toBeNull();
    }
  });
});
