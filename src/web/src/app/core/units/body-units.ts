/**
 * What the server accepts for a body weight, a height, a girth and a body fat, and how the units
 * convert (ProgressModule, ClientProfile). The screens check a typed number against the same limits in
 * words before the server has to refuse it; the server stays the authority and checks again.
 */
export type MassUnit = 'Kilogram' | 'Pound';
/** The progress API's girth units (British spelling); the profile API spells its own `Centimeter`. */
export type GirthUnit = 'Centimetre' | 'Inch';

export const POUNDS_TO_KILOGRAMS = 0.45359237;
export const CENTIMETERS_PER_INCH = 2.54;

export const HEIGHT_CM = { min: 50, max: 300 } as const;
export const WEIGHT_KG = { min: 20, max: 500 } as const;
/** A waist, chest, hip, thigh or arm. */
export const GIRTH_CM = { min: 10, max: 300 } as const;
export const BODY_FAT_PERCENT = { min: 1, max: 75 } as const;

/** Kilograms in a typed weight, for the server's 20 to 500 kg rule. */
export function weightKilograms(value: number, unit: MassUnit): number {
  return unit === 'Pound' ? value * POUNDS_TO_KILOGRAMS : value;
}

/** Centimetres in a typed length (a height or a girth), in either API's spelling of the unit. */
export function lengthCentimeters(
  value: number,
  unit: 'Centimeter' | 'Centimetre' | 'Inch',
): number {
  return unit === 'Inch' ? value * CENTIMETERS_PER_INCH : value;
}

/**
 * A kilogram or centimetre range in another unit, rounded inwards to a tenth so every number it names
 * is one the server accepts.
 */
export function rangeInOtherUnit(
  range: { readonly min: number; readonly max: number },
  unitSize: number,
): { readonly low: number; readonly high: number } {
  return {
    low: Math.ceil((range.min / unitSize) * 10) / 10,
    high: Math.floor((range.max / unitSize) * 10) / 10,
  };
}
