import { EnvironmentProviders } from '@angular/core';

/**
 * Development-only providers. This production version is intentionally empty: the development
 * build configuration swaps in dev-providers.development.ts through `fileReplacements` in
 * angular.json, so a production build never contains the theme preview.
 */
export const devProviders: EnvironmentProviders[] = [];
