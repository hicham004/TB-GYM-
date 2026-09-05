import { Routes } from '@angular/router';

export const notificationRoutes: Routes = [
  {
    // Lazy, and separately lazy from the inbox: a member who only ever reads notifications never
    // loads the settings screen or its reactive-forms dependency.
    path: 'settings',
    title: $localize`Notification settings | TB Gym`,
    loadComponent: () =>
      import('./notification-preferences').then((module) => module.NotificationPreferencesPage),
  },
  {
    path: '',
    title: $localize`Notifications | TB Gym`,
    loadComponent: () => import('./notifications').then((module) => module.Notifications),
  },
];
