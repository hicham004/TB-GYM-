import { Routes } from '@angular/router';
import {
  authGuard,
  clientGuard,
  coachGuard,
  ownerGuard,
  signedOutGuard,
} from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'auth',
    canActivateChild: [signedOutGuard],
    loadChildren: () => import('./features/auth/auth.routes').then((module) => module.authRoutes),
  },
  {
    path: 'invite',
    title: $localize`Client invitation | TB Gym`,
    loadComponent: () =>
      import('./features/invitations/accept-invitation').then((module) => module.AcceptInvitation),
  },
  {
    path: '',
    canActivate: [authGuard],
    title: $localize`Dashboard | TB Gym`,
    loadComponent: () =>
      import('./features/dashboard/dashboard').then((module) => module.Dashboard),
  },
  {
    path: 'clients',
    canActivate: [authGuard, coachGuard],
    loadChildren: () =>
      import('./features/clients/clients.routes').then((module) => module.clientRoutes),
  },
  {
    path: 'invitations',
    canActivate: [authGuard, coachGuard],
    title: $localize`Invitations | TB Gym`,
    loadComponent: () =>
      import('./features/invitations/invitations').then((module) => module.Invitations),
  },
  {
    path: 'products',
    canActivate: [authGuard, coachGuard],
    title: $localize`Coaching products | TB Gym`,
    loadComponent: () => import('./features/commercial/products').then((module) => module.Products),
  },
  {
    path: 'training',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/training/training.routes').then((module) => module.trainingRoutes),
  },
  {
    path: 'nutrition',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/nutrition/nutrition.routes').then((module) => module.nutritionRoutes),
  },
  {
    path: 'profile',
    canActivate: [authGuard, clientGuard],
    title: $localize`My profile | TB Gym`,
    loadComponent: () =>
      import('./features/profile/client-profile').then((module) => module.ClientProfilePage),
  },
  {
    path: 'workspace',
    canActivate: [authGuard, ownerGuard],
    title: $localize`Workspace settings | TB Gym`,
    loadComponent: () =>
      import('./features/workspace/workspace-settings').then((module) => module.WorkspaceSettings),
  },
  {
    path: 'account/security',
    canActivate: [authGuard],
    title: $localize`Account security | TB Gym`,
    loadComponent: () =>
      import('./features/account/account-security').then((module) => module.AccountSecurity),
  },
  { path: '**', redirectTo: '' },
];
