import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'TB Gym | Overview',
    loadComponent: () => import('./features/overview/overview').then((module) => module.Overview),
  },
  {
    path: 'clients',
    loadChildren: () =>
      import('./features/clients/clients.routes').then((module) => module.clientRoutes),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
