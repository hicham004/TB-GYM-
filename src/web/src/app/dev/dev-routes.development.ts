import { Routes } from '@angular/router';
import { REDESIGNED } from '../core/theme/redesigned-route';

/**
 * Development-only routes, swapped in for dev-routes.ts by the development build configuration.
 * The UI lab uses synthetic fixtures and makes no API calls, so it needs no guard; it is not linked
 * from any navigation and does not exist in a production build.
 */
export const devRoutes: Routes = [
  {
    path: 'dev/ui-lab/hero',
    title: 'Hero screens | TB Gym (development)',
    data: REDESIGNED,
    loadComponent: () => import('./hero-lab/hero-lab').then((module) => module.HeroLab),
  },
  {
    path: 'dev/ui-lab',
    title: 'UI lab | TB Gym (development)',
    data: REDESIGNED,
    loadComponent: () => import('./ui-lab/ui-lab').then((module) => module.UiLab),
  },
];
