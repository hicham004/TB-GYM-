import { inject } from '@angular/core';
import { CanDeactivateFn, Router, Routes, type Params, type UrlTree } from '@angular/router';
import { clientGuard, coachGuard } from '../../core/auth/auth.guards';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { REDESIGNED } from '../../core/theme/redesigned-route';

/**
 * Leaving mid-check-in saves the last answer first, so nothing typed is lost to a tab tap. Typed
 * structurally so this file does not pull the lazily loaded flow into the routes chunk.
 */
export const saveBeforeLeaving: CanDeactivateFn<{
  canLeave(destination: string): Promise<boolean>;
}> = (flow, _route, _state, next) => flow.canLeave(next.url);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The old Client check-ins page (audit A14b): a client's check-ins are assigned and read on their
 * record now, so a bookmark of it opens that client's Check-ins, or the check-in it named; one that
 * names no client opens Clients. The record's own read decides whether the client is the coach's.
 */
export function clientCheckInsMoved({ queryParams }: { queryParams: Params }): UrlTree {
  const router = inject(Router);
  const clientId = String(queryParams['clientId'] ?? '');
  const assignmentId = String(queryParams['assignmentId'] ?? '');
  if (!ID.test(clientId)) return router.createUrlTree(['/clients']);
  return router.createUrlTree(
    ID.test(assignmentId)
      ? ['/clients', clientId, 'checkins', assignmentId]
      : ['/clients', clientId, 'checkins'],
  );
}

export const checkInRoutes: Routes = [
  {
    // The forms as cards (audit A14b); each opens on its own page below.
    path: 'forms',
    data: REDESIGNED,
    canActivate: [coachGuard],
    title: $localize`Check-in forms | TB Gym`,
    loadComponent: () => import('./checkin-forms').then((module) => module.CheckInForms),
  },
  {
    // `new` opens an empty form (`?start=weekly` a weekly check-in to start from); the first save
    // moves the address to the form's own. Leaving with changes asks first.
    path: 'forms/:formId',
    data: REDESIGNED,
    canActivate: [coachGuard],
    canDeactivate: [confirmBeforeLeaving],
    title: $localize`Check-in form | TB Gym`,
    loadComponent: () => import('./checkin-form').then((module) => module.CheckInForm),
  },
  { path: 'clients', redirectTo: clientCheckInsMoved },
  {
    // The client's check-ins and each check-in follow their mode (M6, checked in dark in R5.4b).
    path: 'me',
    data: REDESIGNED,
    canActivate: [clientGuard],
    title: $localize`Check-ins | TB Gym`,
    loadComponent: () => import('./my-checkins').then((module) => module.MyCheckIns),
  },
  {
    path: 'me/:assignmentId',
    data: REDESIGNED,
    canActivate: [clientGuard],
    canDeactivate: [saveBeforeLeaving],
    title: $localize`Check-in | TB Gym`,
    loadComponent: () => import('./checkin-flow').then((module) => module.CheckInFlow),
  },
  { path: '', redirectTo: 'forms', pathMatch: 'full' },
];
