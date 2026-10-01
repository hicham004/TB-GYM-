import { inject } from '@angular/core';
import { ResolveFn, Routes } from '@angular/router';
import {
  authGuard,
  clientGuard,
  coachGuard,
  ownerGuard,
  publicHomeGuard,
  signedOutGuard,
} from './core/auth/auth.guards';
import { TenantStore } from './core/tenancy/tenant.store';
import { REDESIGNED } from './core/theme/redesigned-route';
import { devRoutes } from './dev/dev-routes';
import { platformAdminGuard } from './features/platform-admin/platform-admin.guard';

/** `/` is a client's Today and everyone else's dashboard; the guard has loaded the membership. */
const homeTitle: ResolveFn<string> = () =>
  inject(TenantStore).isClient() ? $localize`Today | TB Gym` : $localize`Dashboard | TB Gym`;

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
    pathMatch: 'full',
    canMatch: [publicHomeGuard],
    title: $localize`Coaching, connected | TB Gym`,
    loadComponent: () => import('./features/home/home').then((module) => module.Home),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    title: homeTitle,
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
    path: 'checkins',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/checkins/checkins.routes').then((module) => module.checkInRoutes),
  },
  {
    // Both sides of a conversation are active members of the workspace, whatever their role, so this
    // sits behind the plain authenticated guard. Who may open which conversation is an explicit
    // participant row the API checks, and a route guard could never stand in for it.
    path: 'messages',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/messaging/messages.routes').then((module) => module.messagingRoutes),
  },
  {
    // Every active member of a workspace has an inbox, whatever their role, so this sits behind the
    // plain authenticated guard rather than a role guard.
    path: 'notifications',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/notifications/notifications.routes').then(
        (module) => module.notificationRoutes,
      ),
  },
  {
    path: 'profile',
    canActivate: [authGuard, clientGuard],
    title: $localize`My profile | TB Gym`,
    loadComponent: () =>
      import('./features/profile/client-profile').then((module) => module.ClientProfilePage),
  },
  {
    path: 'me',
    canActivate: [authGuard, clientGuard],
    // Rebuilt on brand v2 in R2.5c, so it follows the person's light or dark choice, which is made here.
    data: REDESIGNED,
    title: $localize`Me | TB Gym`,
    loadComponent: () =>
      import('./features/account/client-account').then((module) => module.ClientAccount),
  },
  {
    path: 'progress/dashboard',
    canActivate: [authGuard, clientGuard],
    title: $localize`My progress dashboard | TB Gym`,
    loadComponent: () =>
      import('./features/progress/progress-dashboard').then(
        (module) => module.ProgressDashboardView,
      ),
  },
  {
    path: 'progress',
    canActivate: [authGuard, clientGuard],
    title: $localize`My bodyweight progress | TB Gym`,
    loadComponent: () =>
      import('./features/progress/progress-view').then((module) => module.ProgressView),
  },
  {
    path: 'workspace',
    canActivate: [authGuard, ownerGuard],
    title: $localize`Coaching space | TB Gym`,
    loadComponent: () =>
      import('./features/workspace/workspace-settings').then((module) => module.WorkspaceSettings),
  },
  {
    path: 'team',
    canActivate: [authGuard, ownerGuard],
    title: $localize`Team | TB Gym`,
    loadComponent: () => import('./features/team/team').then((module) => module.Team),
  },
  {
    path: 'billing',
    canActivate: [authGuard, ownerGuard],
    title: $localize`Billing | TB Gym`,
    loadComponent: () => import('./features/billing/billing').then((module) => module.Billing),
  },
  {
    // The platform admin's screen (ADR 0028): a global role, needing no workspace at all.
    path: 'admin/billing',
    canActivate: [authGuard, platformAdminGuard],
    title: $localize`Platform billing | TB Gym`,
    loadComponent: () =>
      import('./features/platform-admin/platform-admin').then((module) => module.PlatformAdmin),
  },
  {
    path: 'account/security',
    canActivate: [authGuard],
    title: $localize`Account security | TB Gym`,
    loadComponent: () =>
      import('./features/account/account-security').then((module) => module.AccountSecurity),
  },
  {
    path: 'account/appearance',
    canActivate: [authGuard],
    data: REDESIGNED,
    title: $localize`Appearance | TB Gym`,
    loadComponent: () =>
      import('./features/account/account-appearance').then((module) => module.AccountAppearance),
  },
  // Empty in production; the development build swaps in the UI lab (see dev/dev-routes.ts).
  ...devRoutes,
  { path: '**', redirectTo: '' },
];
