import { Routes } from '@angular/router';

export const clientRoutes: Routes = [
  {
    path: '',
    title: $localize`Clients | TB Gym`,
    loadComponent: () => import('./clients').then((module) => module.Clients),
  },
  {
    path: ':clientId',
    title: $localize`Client profile | TB Gym`,
    loadComponent: () => import('./client-details').then((module) => module.ClientDetails),
  },
];
