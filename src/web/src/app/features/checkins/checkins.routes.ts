import { CanDeactivateFn, Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';

/**
 * Leaving mid-check-in saves the last answer first, so nothing typed is lost to a tab tap. Typed
 * structurally so this file does not pull the lazily loaded flow into the routes chunk.
 */
export const saveBeforeLeaving: CanDeactivateFn<{
  canLeave(destination: string): Promise<boolean>;
}> = (flow, _route, _state, next) => flow.canLeave(next.url);

export const checkInRoutes: Routes = [
  {
    path: 'forms',
    canActivate: [coachGuard],
    title: $localize`Check-in forms | TB Gym`,
    loadComponent: () => import('./checkin-forms').then((module) => module.CheckInForms),
  },
  {
    path: 'clients',
    canActivate: [coachGuard],
    title: $localize`Client check-ins | TB Gym`,
    loadComponent: () => import('./checkin-clients').then((module) => module.CheckInClients),
  },
  {
    path: 'me',
    canActivate: [clientGuard],
    title: $localize`Check-ins | TB Gym`,
    loadComponent: () => import('./my-checkins').then((module) => module.MyCheckIns),
  },
  {
    path: 'me/:assignmentId',
    canActivate: [clientGuard],
    canDeactivate: [saveBeforeLeaving],
    title: $localize`Check-in | TB Gym`,
    loadComponent: () => import('./checkin-flow').then((module) => module.CheckInFlow),
  },
  { path: '', redirectTo: 'forms', pathMatch: 'full' },
];
