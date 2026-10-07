import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { REDESIGNED } from '../../core/theme/redesigned-route';

export const nutritionRoutes: Routes = [
  {
    path: 'plans',
    canActivate: [coachGuard],
    title: $localize`Meal plans | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./meal-plan-list').then((module) => module.MealPlanList),
  },
  {
    // `new` opens an empty plan (`?draft=` reopens one not published yet); one route for both, so
    // publishing a new plan keeps the page.
    path: 'plans/:planId',
    canActivate: [coachGuard],
    canDeactivate: [confirmBeforeLeaving],
    title: $localize`Meal plan builder | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./meal-plan-builder').then((module) => module.MealPlanBuilder),
  },
  {
    path: 'library',
    canActivate: [coachGuard],
    title: $localize`Recipes and foods | TB Gym`,
    loadComponent: () => import('./nutrition-library').then((module) => module.NutritionLibrary),
  },
  {
    path: 'today',
    canActivate: [clientGuard],
    title: $localize`Today's nutrition | TB Gym`,
    loadComponent: () => import('./today-nutrition').then((module) => module.TodayNutrition),
  },
  { path: '', redirectTo: 'plans', pathMatch: 'full' },
];
