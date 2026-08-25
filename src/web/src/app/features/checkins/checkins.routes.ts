import { Routes } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';

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
    title: $localize`My check-ins | TB Gym`,
    loadComponent: () => import('./my-checkins').then((module) => module.MyCheckIns),
  },
  { path: '', redirectTo: 'forms', pathMatch: 'full' },
];
