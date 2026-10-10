import { describe, expect, it } from 'vitest';
import {
  BODY_FAT_PERCENT,
  GIRTH_CM,
  HEIGHT_CM,
  lengthCentimeters,
  POUNDS_TO_KILOGRAMS,
  rangeInOtherUnit,
  WEIGHT_KG,
  weightKilograms,
} from './body-units';

describe('body units', () => {
  it('keeps the server’s own limits', () => {
    expect(WEIGHT_KG).toEqual({ min: 20, max: 500 });
    expect(HEIGHT_CM).toEqual({ min: 50, max: 300 });
    expect(GIRTH_CM).toEqual({ min: 10, max: 300 });
    expect(BODY_FAT_PERCENT).toEqual({ min: 1, max: 75 });
  });

  it('turns pounds into kilograms exactly as the server does, and leaves kilograms alone', () => {
    expect(weightKilograms(100, 'Pound')).toBeCloseTo(45.359237, 6);
    expect(weightKilograms(80.2, 'Kilogram')).toBe(80.2);
  });

  it('turns inches into centimetres, in either spelling of centimetre', () => {
    expect(lengthCentimeters(10, 'Inch')).toBeCloseTo(25.4, 6);
    expect(lengthCentimeters(80, 'Centimetre')).toBe(80);
    expect(lengthCentimeters(80, 'Centimeter')).toBe(80);
  });

  it('names a range in another unit by rounding inwards, so every number it names is accepted', () => {
    const pounds = rangeInOtherUnit(WEIGHT_KG, POUNDS_TO_KILOGRAMS);

    expect(pounds).toEqual({ low: 44.1, high: 1102.3 });
    expect(weightKilograms(pounds.low, 'Pound')).toBeGreaterThanOrEqual(WEIGHT_KG.min);
    expect(weightKilograms(pounds.high, 'Pound')).toBeLessThanOrEqual(WEIGHT_KG.max);
    expect(rangeInOtherUnit(GIRTH_CM, 2.54)).toEqual({ low: 4, high: 118.1 });
  });
});
