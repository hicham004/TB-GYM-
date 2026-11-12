import { Routes } from '@angular/router';

/**
 * TB Gym's own sign-up (notes plan N9a2): the page that says where it stands, and the form. Both open
 * for a visitor and for someone signed in, who signs up with the account they have (decision 34). The
 * titles live here, with the pages, so the first download carries none of them.
 */
export const trainRoutes: Routes = [
  {
    path: '',
    title: $localize`Train with TB Gym`,
    loadComponent: () => import('./train').then((module) => module.Train),
  },
  {
    path: 'sign-up',
    title: $localize`Sign up | Train with TB Gym`,
    loadComponent: () => import('./train-sign-up').then((module) => module.TrainSignUpPage),
  },
];
