import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { FULL_SCREEN, REDESIGNED } from '../../core/theme/redesigned-route';

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
    canDeactivate: [confirmBeforeLeaving],
    title: $localize`Exercises | TB Gym`,
    // The library follows the coach's mode (C10, R5.1b).
    data: REDESIGNED,
    loadComponent: () => import('./exercise-library').then((module) => module.ExerciseLibrary),
  },
  {
    path: 'program',
    canActivate: [clientGuard],
    title: $localize`Training | TB Gym`,
    // The client's Training follows their mode (M3, checked in dark in R5.4b).
    data: REDESIGNED,
    loadComponent: () => import('./training-program').then((module) => module.TrainingProgram),
  },
  {
    path: 'today',
    canActivate: [clientGuard],
    // Sets changed but not logged, or a note not sent, are asked about before they are left (WEA-1).
    canDeactivate: [confirmBeforeLeaving],
    title: $localize`Today's training | TB Gym`,
    // The player fills the screen: no tab bar over Finish, as in the prototype (R5.4a). It draws
    // itself dark in either mode (R5.3e); the exercise video sheet over it follows the person's.
    data: { ...FULL_SCREEN, ...REDESIGNED },
    loadComponent: () => import('./today-training').then((module) => module.TodayTraining),
  },
  { path: '', redirectTo: 'programs', pathMatch: 'full' },
];
