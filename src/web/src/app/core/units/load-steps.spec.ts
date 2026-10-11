import { describe, expect, it } from 'vitest';
import { fallbackLoadStep, nearestLoadStep } from './load-steps';

describe('a suggested max in the program’s steps (R5.4c)', () => {
  it('rounds to the nearest step of the program, halves up', () => {
    // The review's numbers: Maya's deadlift and Rami's three lifts, in 2.5 kg steps.
    expect(nearestLoadStep(80.75, 'Kilogram', 2.5)).toBe(80);
    expect(nearestLoadStep(175.91, 'Kilogram', 2.5)).toBe(175);
    expect(nearestLoadStep(123.76, 'Kilogram', 2.5)).toBe(125);
    expect(nearestLoadStep(208.63, 'Kilogram', 2.5)).toBe(207.5);
    expect(nearestLoadStep(81.25, 'Kilogram', 2.5)).toBe(82.5);
    expect(nearestLoadStep(110.974, 'Kilogram', '1.25')).toBe(111.25);
    expect(nearestLoadStep(401.2, 'Pound', 5)).toBe(400);
  });

  it('keeps a value that sits on a midpoint from floating-point noise', () => {
    // 0.3 / 0.1 is 2.9999999999999996 in floating point; it still counts as three steps.
    expect(nearestLoadStep(0.3, 'Kilogram', 0.1)).toBe(0.3);
    expect(nearestLoadStep(32.375, 'Kilogram', 0.25)).toBe(32.5);
  });

  it('falls back to half a kilogram or one pound when the step is unknown or not positive', () => {
    expect(fallbackLoadStep('Kilogram')).toBe(0.5);
    expect(fallbackLoadStep('Pound')).toBe(1);
    expect(nearestLoadStep(80.75, 'Kilogram')).toBe(81);
    expect(nearestLoadStep(80.74, 'Kilogram', null)).toBe(80.5);
    expect(nearestLoadStep(80.75, 'Kilogram', 0)).toBe(81);
    expect(nearestLoadStep(176.4, 'Pound', -5)).toBe(176);
    expect(nearestLoadStep(176.5, 'Pound', 'not a number')).toBe(177);
  });
});
