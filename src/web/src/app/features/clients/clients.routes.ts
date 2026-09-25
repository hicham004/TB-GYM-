import { Routes } from '@angular/router';

const sections = () => import('./client-workspace-sections');

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
    // One client's record (Figma 131:419): a header and one route per section, so each section
    // can be linked to, bookmarked and reloaded. The API authorizes every read and change.
    path: ':clientId',
    loadComponent: () => import('./client-workspace').then((module) => module.ClientWorkspace),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: $localize`Client overview | TB Gym`,
        loadComponent: () => import('./client-overview').then((module) => module.ClientOverview),
      },
      {
        path: 'training',
        title: $localize`Client training | TB Gym`,
        loadComponent: () => sections().then((module) => module.ClientTrainingSection),
      },
      {
        path: 'nutrition',
        title: $localize`Client nutrition | TB Gym`,
        loadComponent: () => sections().then((module) => module.ClientNutritionSection),
      },
      {
        path: 'checkins',
        title: $localize`Client check-ins | TB Gym`,
        loadComponent: () => sections().then((module) => module.ClientCheckInsSection),
      },
      {
        path: 'progress',
        title: $localize`Client progress | TB Gym`,
        loadComponent: () => sections().then((module) => module.ClientProgressSection),
      },
      {
        path: 'service',
        title: $localize`Client service & access | TB Gym`,
        loadComponent: () => sections().then((module) => module.ClientServiceSection),
      },
      {
        path: 'intake',
        title: $localize`Client intake | TB Gym`,
        loadComponent: () => sections().then((module) => module.ClientIntakeSection),
      },
    ],
  },
];
