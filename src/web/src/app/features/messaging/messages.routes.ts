import { Routes } from '@angular/router';

export const messagingRoutes: Routes = [
  {
    path: '',
    title: $localize`Messages | TB Gym`,
    loadComponent: () => import('./messages').then((module) => module.Messages),
  },
];
