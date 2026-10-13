import type { PlaceholderSet } from './home-placeholder';

/**
 * The public build draws no stand-in photographs: nothing from the placeholders folder is named
 * or copied (UI plan R6.2h). The private build swaps this module for the one
 * `scripts/private-preview.mjs` writes into that folder (`angular.json`, the `placeholders`
 * configuration), and `scripts/check-prerender.mjs` refuses a production output that names it.
 */
export const PLACEHOLDERS: PlaceholderSet | null = null;
