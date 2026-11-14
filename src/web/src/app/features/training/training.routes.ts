import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';
import { confirmBeforeLeaving, confirmSheetLeave } from '../../core/forms/leave-guard';
import { FULL_SCREEN, REDESIGNED } from '../../core/theme/redesigned-route';

export const trainingRoutes: Routes = [
  {
    path: 'programs',
    canActivate: [coachGuard],
    // The house's list of programs for trainees edits in sheets (notes plan N9c4).
    canDeactivate: [confirmSheetLeave],
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
  {
    // TB Gym's exercise pool for a client of the house (notes plan N9b4, LIB-006): browsed, searched and
    // filtered, each exercise with its demo playing; the server answers 404 in any other space. It
    // follows the person's mode, under the tab bar (Training stays the tab in use).
    path: 'pool',
    canActivate: [clientGuard],
    title: $localize`Exercises | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./exercise-pool').then((module) => module.ExercisePool),
  },
  {
    // One exercise of the pool: its demo, what it works and how it is done, and a workout started with it.
    path: 'pool/:exerciseId',
    canActivate: [clientGuard],
    title: $localize`Exercise | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./pool-exercise').then((module) => module.PoolExercise),
  },
  {
    // TB Gym's programs for a self-directed trainee of the house (notes plan N9c4, TRN-034): whom each suits, a
    // sample week, the maxes it reads, and Start under a Pro+ pass. The server answers 404 for anyone else.
    path: 'house-programs',
    canActivate: [clientGuard],
    canDeactivate: [confirmSheetLeave],
    title: $localize`Programs | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./house-programs').then((module) => module.HousePrograms),
  },
  { path: '', redirectTo: 'programs', pathMatch: 'full' },
];
