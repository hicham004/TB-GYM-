import { Routes } from '@angular/router';
import { confirmBeforeLeaving } from '../../core/forms/leave-guard';
import { REDESIGNED } from '../../core/theme/redesigned-route';

export const notificationRoutes: Routes = [
  {
    // Lazy, and separately lazy from the inbox: a member who only ever reads notifications never
    // loads the settings screen or its reactive-forms dependency.
    path: 'settings',
    title: $localize`Notification settings | TB Gym`,
    // Rebuilt in R5.1c: it follows the person's mode and asks before unsaved changes are dropped.
    data: REDESIGNED,
    canDeactivate: [confirmBeforeLeaving],
    loadComponent: () =>
      import('./notification-preferences').then((module) => module.NotificationPreferencesPage),
  },
  {
    path: '',
    title: $localize`Notifications | TB Gym`,
    // Rebuilt in R5.1c for coaches and clients, so it follows the person's light or dark mode.
    data: REDESIGNED,
    loadComponent: () => import('./notifications').then((module) => module.Notifications),
  },
];
