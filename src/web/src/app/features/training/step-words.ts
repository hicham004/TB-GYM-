/**
 * How every coach screen names a "last time + step" set's step (notes plan N6a, TRN-032): the builder's
 * grid, the session sheet, Edit weeks, Build next block and a logged workout say it alike. The caller
 * formats the number and its unit, as each of those screens writes its own numbers.
 */
export function lastTimeStepWords(step: string, unit: string): string {
  return $localize`last time + ${step}:step: ${unit}:unit:`;
}
