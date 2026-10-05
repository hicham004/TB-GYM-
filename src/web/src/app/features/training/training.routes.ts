import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { REDESIGNED } from '../../core/theme/redesigned-route';

export const trainingRoutes: Routes = [
  {
    path: 'programs',
    canActivate: [coachGuard],
    title: $localize`Programs | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./program-list').then((module) => module.ProgramList),
  },
  {
    // `new` opens an empty program (`?draft=` reopens one not published yet); one route for both,
    // so publishing a new program keeps the page.
    path: 'programs/:templateId',
    canActivate: [coachGuard],
    canDeactivate: [confirmBeforeLeaving],
    title: $localize`Program builder | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./program-builder').then((module) => module.ProgramBuilder),
  },
  {
    path: 'exercises',
    canActivate: [coachGuard],
    title: $localize`Exercise library | TB Gym`,
    loadComponent: () => import('./exercise-library').then((module) => module.ExerciseLibrary),
  },
  {
    path: 'program',
    canActivate: [clientGuard],
    title: $localize`Training | TB Gym`,
    loadComponent: () => import('./training-program').then((module) => module.TrainingProgram),
  },
  {
    path: 'today',
    canActivate: [clientGuard],
    title: $localize`Today's training | TB Gym`,
    loadComponent: () => import('./today-training').then((module) => module.TodayTraining),
  },
  { path: '', redirectTo: 'programs', pathMatch: 'full' },
];
