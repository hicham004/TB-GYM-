import { Routes } from '@angular/router';

export const clientRoutes: Routes = [
  {
    path: '',
    title: 'TB Gym | Clients',
    loadComponent: () => import('./clients').then((module) => module.Clients),
  },
];
