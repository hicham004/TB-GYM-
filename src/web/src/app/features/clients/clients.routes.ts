import type { CanDeactivateFn, Routes } from '@angular/router';
import {
  confirmBeforeLeaving,
  confirmSheetLeave,
  type HoldsUnsavedWork,
} from '../../core/forms/leave-guard';
import { REDESIGNED } from '../../core/theme/redesigned-route';

const sections = () => import('./client-workspace-sections');

/**
 * A section of the client's private side (N9d1a: training, nutrition, check-ins, progress, the
 * intake), opened only to the client's own coach. The record draws why it is closed in its place,
 * and never creates it, for anyone else.
 */
const PRIVATE = { ...REDESIGNED, side: 'private' };

/** A private page the record never drew (its why panel stood there) holds no work to ask about. */
export const confirmPageLeave: CanDeactivateFn<HoldsUnsavedWork | null> = (page, ...rest) =>
  page ? confirmBeforeLeaving(page, ...rest) : confirmSheetLeave(page, ...rest);

export const clientRoutes: Routes = [
  {
    // The two lists are rebuilt on brand v2 (R3.3a) and follow light or dark. In a client's record
    // below the Overview and Progress are too (R3.3b), Training (R3.4a), Service & access (R3.4b),
    // Check-ins with each check-in's review (R4.3), the intake (R5.3b) and Nutrition (R5.3d).
    path: '',
    title: $localize`Clients | TB Gym`,
    data: REDESIGNED,
    loadComponent: () => import('./clients').then((module) => module.Clients),
  },
  {
    // Before ':clientId', so "former" is never read as a client id. The API makes it owner-only.
    path: 'former',
    title: $localize`Former clients | TB Gym`,
    data: { ...REDESIGNED, view: 'former' },
    loadComponent: () => import('./clients').then((module) => module.Clients),
  },
  {
    // One client's record (C3): a header and one route per section, so each section can be linked
    // to, bookmarked and reloaded. The API authorizes every read and change.
    path: ':clientId',
    canDeactivate: [confirmSheetLeave],
    loadComponent: () => import('./client-workspace').then((module) => module.ClientWorkspace),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: $localize`Client overview | TB Gym`,
        data: REDESIGNED,
        loadComponent: () => import('./client-overview').then((module) => module.ClientOverview),
      },
      {
        path: 'training',
        canDeactivate: [confirmSheetLeave],
        title: $localize`Client training | TB Gym`,
        data: PRIVATE,
        loadComponent: () => sections().then((module) => module.ClientTrainingSection),
      },
      {
        // The weeks still to come, in the builder's grid (P3b). Nothing is kept until the coach
        // reviews and applies the edit, so leaving with changes asks first.
        path: 'training/:mesocycleId/edit',
        title: $localize`Edit weeks | TB Gym`,
        data: PRIVATE,
        canDeactivate: [confirmPageLeave],
        loadComponent: () => import('./program-edit').then((module) => module.ProgramEditPage),
      },
      {
        path: 'nutrition',
        canDeactivate: [confirmSheetLeave],
        title: $localize`Client nutrition | TB Gym`,
        data: PRIVATE,
        loadComponent: () => sections().then((module) => module.ClientNutritionSection),
      },
      {
        // Assign a check-in opens a sheet here (audit A14b): leaving with something chosen asks first.
        path: 'checkins',
        canDeactivate: [confirmSheetLeave],
        title: $localize`Client check-ins | TB Gym`,
        data: PRIVATE,
        loadComponent: () => import('./client-checkins').then((module) => module.ClientCheckIns),
      },
      {
        // One check-in under review (C5). Its reply box is the page's action, so the header's
        // Message steps back (`replyOnPage`), and an unsent reply is asked about before leaving.
        path: 'checkins/:assignmentId',
        title: $localize`Check-in review | TB Gym`,
        data: { ...PRIVATE, replyOnPage: true },
        canDeactivate: [confirmPageLeave],
        loadComponent: () =>
          import('./client-checkin-review').then((module) => module.ClientCheckInReview),
      },
      {
        path: 'progress',
        canDeactivate: [confirmSheetLeave],
        title: $localize`Client progress | TB Gym`,
        data: PRIVATE,
        loadComponent: () => sections().then((module) => module.ClientProgressSection),
      },
      {
        path: 'service',
        canDeactivate: [confirmSheetLeave],
        title: $localize`Client service & access | TB Gym`,
        data: REDESIGNED,
        loadComponent: () => sections().then((module) => module.ClientServiceSection),
      },
      {
        path: 'intake',
        canDeactivate: [confirmSheetLeave],
        title: $localize`Client intake | TB Gym`,
        data: PRIVATE,
        loadComponent: () => import('./client-intake').then((module) => module.ClientIntake),
      },
    ],
  },
];
