import { describe, expect, it } from 'vitest';
import { curveCovers, curvePercent } from './epley-curve';

// WorkingMaxLoad v2 as the server rounds it, worked out here from the formula. A failing cell means
// the copy was changed by accident; the server's own test compares the file with its numbers.
const formula = (repetitions: number, rpe: number): number => {
  const share = 100 / (1 + (repetitions + (10 - rpe)) / 30);
  return Math.round(share * 1000) / 1000;
};

describe('the pinned WorkingMaxLoad v2 curve', () => {
  it('has every cell the formula gives, at every reps and RPE it takes', () => {
    const mismatches: string[] = [];
    for (let reps = 1; reps <= 12; reps++) {
      for (let rpe = 5; rpe <= 10; rpe += 0.5) {
        if (reps + (10 - rpe) > 12) continue;
        const cell = curvePercent(reps, rpe);
        if (cell !== formula(reps, rpe)) mismatches.push(`${reps} at RPE ${rpe}: ${cell}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('gives the numbers the plan and the server’s explanation name', () => {
    // WorkingMaxLoad v2: 100 kg / (1 + (5 reps + 2 in reserve) / 30) = 81.081 kg.
    expect(curvePercent(5, 8)).toBe(81.081);
    expect(curvePercent(5, 10)).toBe(85.714);
    expect(curvePercent(12, 10)).toBe(71.429);
    expect(curvePercent(1, 10)).toBe(96.774);
  });

  it('reads the reserve as reps, so one point of RPE is one rep along the curve', () => {
    expect(curvePercent(5, 9)).toBe(curvePercent(6, 10));
    expect(curvePercent(4, 7.5)).toBe(curvePercent(6, 9.5));
  });

  it('stops where the server refuses, reps plus reserve past 12, and guesses nothing', () => {
    expect(curveCovers(10, 8)).toBe(true);
    expect(curveCovers(7, 5)).toBe(true);
    for (const [reps, rpe] of [
      [0, 8],
      [13, 10],
      [11, 8],
      [10, 7.5],
      [8, 5],
      [5, 4.5],
      [5, 10.5],
      [5, 7.25],
      [5.5, 8],
    ]) {
      expect(curveCovers(reps, rpe), `${reps} at RPE ${rpe}`).toBe(false);
      expect(curvePercent(reps, rpe)).toBeNull();
    }
  });
});
