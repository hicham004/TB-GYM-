import { Routes } from '@angular/router';

export const notificationRoutes: Routes = [
  {
    path: '',
    title: $localize`Notifications | TB Gym`,
    loadComponent: () => import('./notifications').then((module) => module.Notifications),
  },
];
