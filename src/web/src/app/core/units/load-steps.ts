/**
 * A training load in the steps a program loads in (STR-008), for the screens that name a max the client's
 * logged sets suggest (R5.4c, review finding U1): "about 80 kg", not "80.75 kg". The server keeps and
 * applies the exact estimate (STR-012); this only words it, and the exact number stays where the coach
 * applies it.
 */
export type LoadUnit = 'Kilogram' | 'Pound';

/** The step when a screen does not know the program's own: half a kilogram, or one pound. */
export function fallbackLoadStep(unit: LoadUnit): number {
  return unit === 'Pound' ? 1 : 0.5;
}

/**
 * The nearest whole number of the program's steps, halves up. A missing or non-positive step falls back
 * to the unit's own.
 */
export function nearestLoadStep(
  value: number,
  unit: LoadUnit,
  step?: number | string | null,
): number {
  const size = Number(step);
  const increment =
    step != null && Number.isFinite(size) && size > 0 ? size : fallbackLoadStep(unit);
  // Settled to a millionth first, so floating-point noise never tips a value that sits on a midpoint.
  const steps = Math.round(Math.round((value / increment) * 1e6) / 1e6);
  return Math.round(steps * increment * 1000) / 1000;
}
