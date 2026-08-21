import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';

export const trainingRoutes: Routes = [
  {
    path: 'programs',
    canActivate: [coachGuard],
    title: $localize`Program builder | TB Gym`,
    loadComponent: () => import('./program-builder').then((module) => module.ProgramBuilder),
  },
  {
    path: 'exercises',
    canActivate: [coachGuard],
    title: $localize`Exercise library | TB Gym`,
    loadComponent: () => import('./exercise-library').then((module) => module.ExerciseLibrary),
  },
  {
    path: 'today',
    canActivate: [clientGuard],
    title: $localize`Today's training | TB Gym`,
    loadComponent: () => import('./today-training').then((module) => module.TodayTraining),
  },
  { path: '', redirectTo: 'programs', pathMatch: 'full' },
];
