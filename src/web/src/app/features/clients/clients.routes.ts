import { Routes } from '@angular/router';

export const clientRoutes: Routes = [
  {
    path: '',
    title: $localize`Clients | TB Gym`,
    loadComponent: () => import('./clients').then((module) => module.Clients),
  },
  {
    // Before ':clientId', so "former" is never read as a client id. The API makes it owner-only.
    path: 'former',
    title: $localize`Former clients | TB Gym`,
    data: { view: 'former' },
    loadComponent: () => import('./clients').then((module) => module.Clients),
  },
  {
    path: ':clientId',
    title: $localize`Client profile | TB Gym`,
    loadComponent: () => import('./client-details').then((module) => module.ClientDetails),
  },
];
