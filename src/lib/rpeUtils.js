/**
 * RPE / 1RM Calculation Engine
 *
 * Based on Mike Tuchscherer's Reactive Training Systems (RTS) RPE chart â€”
 * the same table used by calculaterpe.com, rpetraining.com, and other
 * industry-standard strength calculators.
 *
 * Source: Tuchscherer, M. "The Reactive Training Manual" (2012)
 * Cross-validated against calculaterpe.com outputs.
 */

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CANONICAL RTS RPE TABLE
// Format: { reps: { rpe: percentageOf1RM } }
// All values sourced directly from the original RTS/Tuchscherer chart.
// Row 11 is included (interpolated from the original chart) to prevent
// inaccurate interpolation between 10 and 12.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const RPE_TABLE = {
  1:  { 10: 1.000, 9.5: 0.978, 9: 0.956, 8.5: 0.935, 8: 0.914, 7.5: 0.893, 7: 0.873, 6.5: 0.853, 6: 0.833 },
  2:  { 10: 0.955, 9.5: 0.935, 9: 0.914, 8.5: 0.894, 8: 0.874, 7.5: 0.854, 7: 0.835, 6.5: 0.816, 6: 0.797 },
  3:  { 10: 0.917, 9.5: 0.897, 9: 0.877, 8.5: 0.858, 8: 0.838, 7.5: 0.820, 7: 0.800, 6.5: 0.782, 6: 0.763 },
  4:  { 10: 0.885, 9.5: 0.865, 9: 0.846, 8.5: 0.827, 8: 0.808, 7.5: 0.789, 7: 0.771, 6.5: 0.752, 6: 0.734 },
  5:  { 10: 0.857, 9.5: 0.838, 9: 0.819, 8.5: 0.800, 8: 0.782, 7.5: 0.763, 7: 0.745, 6.5: 0.727, 6: 0.709 },
  6:  { 10: 0.832, 9.5: 0.813, 9: 0.794, 8.5: 0.775, 8: 0.757, 7.5: 0.739, 7: 0.721, 6.5: 0.703, 6: 0.686 },
  7:  { 10: 0.809, 9.5: 0.790, 9: 0.772, 8.5: 0.753, 8: 0.735, 7.5: 0.717, 7: 0.700, 6.5: 0.682, 6: 0.665 },
  8:  { 10: 0.788, 9.5: 0.769, 9: 0.751, 8.5: 0.733, 8: 0.715, 7.5: 0.698, 7: 0.680, 6.5: 0.663, 6: 0.646 },
  9:  { 10: 0.769, 9.5: 0.750, 9: 0.732, 8.5: 0.714, 8: 0.697, 7.5: 0.680, 7: 0.662, 6.5: 0.645, 6: 0.629 },
  10: { 10: 0.751, 9.5: 0.732, 9: 0.714, 8.5: 0.697, 8: 0.680, 7.5: 0.663, 7: 0.646, 6.5: 0.629, 6: 0.613 },
  11: { 10: 0.734, 9.5: 0.716, 9: 0.698, 8.5: 0.681, 8: 0.664, 7.5: 0.647, 7: 0.631, 6.5: 0.614, 6: 0.598 },
  12: { 10: 0.718, 9.5: 0.700, 9: 0.682, 8.5: 0.665, 8: 0.648, 7.5: 0.631, 7: 0.615, 6.5: 0.598, 6: 0.582 },
};

// Sorted rep keys for interpolation
const REP_KEYS = Object.keys(RPE_TABLE).map(Number).sort((a, b) => a - b);
// Sorted RPE keys (ascending) for interpolation
const RPE_KEYS_ASC = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// INTERNAL: look up the percentage for an exact rep-row and any RPE value,
// interpolating between adjacent RPE columns if needed.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getPercForRepRow(repRow, rpe) {
  const row = RPE_TABLE[repRow];
  if (!row) return null;

  const rpeNum = Number(rpe);

  // Clamp to table boundaries
  if (rpeNum <= RPE_KEYS_ASC[0]) return row[RPE_KEYS_ASC[0]];
  if (rpeNum >= RPE_KEYS_ASC[RPE_KEYS_ASC.length - 1]) return row[RPE_KEYS_ASC[RPE_KEYS_ASC.length - 1]];

  // Exact match
  if (row[rpeNum] !== undefined) return row[rpeNum];

  // Linear interpolation between adjacent RPE columns
  for (let i = 0; i < RPE_KEYS_ASC.length - 1; i++) {
    const lo = RPE_KEYS_ASC[i];
    const hi = RPE_KEYS_ASC[i + 1];
    if (rpeNum > lo && rpeNum < hi) {
      const t = (rpeNum - lo) / (hi - lo);
      return row[lo] + t * (row[hi] - row[lo]);
    }
  }

  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PUBLIC: Get the % of 1RM for any reps + RPE combination.
// Interpolates between rep rows when reps is not an exact key.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function getRpePercentage(reps, rpe) {
  const repsNum = Number(reps);
  const rpeNum  = Number(rpe);

  if (!repsNum || !rpeNum) return null;

  // Clamp to table boundaries
  if (repsNum <= REP_KEYS[0])                     return getPercForRepRow(REP_KEYS[0], rpeNum);
  if (repsNum >= REP_KEYS[REP_KEYS.length - 1])   return getPercForRepRow(REP_KEYS[REP_KEYS.length - 1], rpeNum);

  // Exact match row
  if (RPE_TABLE[repsNum]) return getPercForRepRow(repsNum, rpeNum);

  // Linear interpolation between adjacent rep rows
  for (let i = 0; i < REP_KEYS.length - 1; i++) {
    const loRep = REP_KEYS[i];
    const hiRep = REP_KEYS[i + 1];
    if (repsNum > loRep && repsNum < hiRep) {
      const loPerc = getPercForRepRow(loRep, rpeNum);
      const hiPerc = getPercForRepRow(hiRep, rpeNum);
      const t = (repsNum - loRep) / (hiRep - loRep);
      return loPerc + t * (hiPerc - loPerc);
    }
  }

  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Plate rounding â€” rounds to the nearest increment (matching calculaterpe.com).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function roundToIncrement(weight, increment = 2.5) {
  if (!weight || !increment) return weight;
  return Math.round(weight / increment) * increment;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Calculate suggested training weight from 1RM + reps + RPE.
// Returns null if any required input is missing.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function calculateWeight(oneRM, reps, rpe, increment = 1) {
  if (!oneRM || !reps || !rpe) return null;
  const pct = getRpePercentage(Number(reps), Number(rpe));
  if (!pct) return null;
  const raw = Number(oneRM) * pct;
  return roundToIncrement(raw, increment);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Estimate 1RM from a performed set (weight Ã— reps @ RPE).
// Returns a rounded integer (kg).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function estimate1RM(weight, reps, rpe) {
  if (!weight || !reps || !rpe) return null;
  const pct = getRpePercentage(Number(reps), Number(rpe));
  if (!pct || pct <= 0) return null;
  return Math.round(Number(weight) / pct);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Percentage of 1RM for a given weight and 1RM (display helper)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function percentOf1RM(weight, oneRM) {
  if (!weight || !oneRM) return null;
  return Math.round((Number(weight) / Number(oneRM)) * 100);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PERCENTAGE CHART â€” RPE 10 column from the RTS table (canonical max-effort values)
// Used for display in the % of 1RM reference table.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const PERCENTAGE_CHART = REP_KEYS.map(reps => ({
  reps,
  percent: Math.round(RPE_TABLE[reps][10] * 1000) / 10, // e.g. 0.788 â†’ 78.8
}));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RPE â†” RIR SYNC HELPERS
// Standard relationship: RIR = 10 - RPE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function rpeToRir(rpe) {
  if (rpe == null || rpe === '') return '';
  return Math.max(0, 10 - Number(rpe));
}

export function rirToRpe(rir) {
  if (rir == null || rir === '') return '';
  return Math.min(10, Math.max(0, 10 - Number(rir)));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PLATE INCREMENTS â€” for the rounding selector UI
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const PLATE_INCREMENTS = [
  { label: '1 kg',   value: 1   },
  { label: '2.5 kg', value: 2.5 },
  { label: '5 kg',   value: 5   },
];
