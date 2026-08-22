import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';

export const nutritionRoutes: Routes = [
  {
    path: 'library',
    canActivate: [coachGuard],
    title: $localize`Nutrition library | TB Gym`,
    loadComponent: () => import('./nutrition-library').then((module) => module.NutritionLibrary),
  },
  {
    path: 'today',
    canActivate: [clientGuard],
    title: $localize`Today's nutrition | TB Gym`,
    loadComponent: () => import('./today-nutrition').then((module) => module.TodayNutrition),
  },
  { path: '', redirectTo: 'library', pathMatch: 'full' },
];
