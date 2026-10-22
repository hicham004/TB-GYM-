import { Routes } from '@angular/router';
import { confirmBeforeLeaving, confirmSheetLeave } from './core/forms/leave-guard';
import {
  authGuard,
  clientGuard,
  coachGuard,
  memberGuard,
  ownerGuard,
  publicHomeGuard,
  sessionKnownGuard,
  signedOutGuard,
} from './core/auth/auth.guards';
import { HOUSE_BRAND, REDESIGNED } from './core/theme/redesigned-route';
import { devRoutes } from './dev/dev-routes';
import { platformAdminGuard } from './features/platform-admin/platform-admin.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivateChild: [signedOutGuard],
    loadChildren: () => import('./features/auth/auth.routes').then((module) => module.authRoutes),
  },
  {
    // For a client's and a coach's link alike, so the title names neither (audit COACH-6).
    path: 'invite',
    title: $localize`Invitation | TB Gym`,
    loadComponent: () =>
      import('./features/invitations/accept-invitation').then((module) => module.AcceptInvitation),
  },
  {
    path: '',
    pathMatch: 'full',
    canMatch: [publicHomeGuard],
    title: $localize`TB Gym: coach both sides of the week`,
    loadComponent: () => import('./features/home/home').then((module) => module.Home),
  },
  {
    // What changed, from src/content/changelog.md at build time (UI plan R6.2f); rendered ahead of
    // time like the homepage, and open to anyone, signed in or not.
    path: 'changelog',
    title: $localize`What changed | TB Gym`,
    loadComponent: () =>
      import('./features/changelog/changelog').then((module) => module.Changelog),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    // A coach's Today (R3.2) and a client's Today, both in the person's mode (the client's since R5.4b).
    title: $localize`Today | TB Gym`,
    data: REDESIGNED,
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
    // Its Invite a client sheet asks before Browser Back drops what was typed (audit COACH-1).
    canDeactivate: [confirmSheetLeave],
    // Rebuilt in R5.3a: follows the coach's mode, invites in a sheet.
    data: REDESIGNED,
    title: $localize`Invitations | TB Gym`,
    loadComponent: () =>
      import('./features/invitations/invitations').then((module) => module.Invitations),
  },
  {
    path: 'products',
    canDeactivate: [confirmSheetLeave],
    canActivate: [authGuard, coachGuard],
    title: $localize`Plans you sell | TB Gym`,
    // Plans you sell follows the coach's mode (C8, R5.1a).
    data: REDESIGNED,
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
    // asks only for a role there; someone who has none is told so on Today (audit COACH-14). Who may
    // open which conversation is an explicit participant row the API checks, and a route guard could
    // never stand in for it.
    path: 'messages',
    canActivate: [authGuard, memberGuard],
    // The chat follows dark mode for coaches and clients alike (C6, M7; checked in R3.5b).
    data: REDESIGNED,
    loadChildren: () =>
      import('./features/messaging/messages.routes').then((module) => module.messagingRoutes),
  },
  {
    // Every active member of a workspace has an inbox, whatever their role, so this asks only for a
    // role there rather than a particular one (audit COACH-14).
    path: 'notifications',
    canActivate: [authGuard, memberGuard],
    loadChildren: () =>
      import('./features/notifications/notifications.routes').then(
        (module) => module.notificationRoutes,
      ),
  },
  {
    // Rebuilt in R5.3b: the first run is a few short steps and later it is the answers as cards. A step
    // that is half typed asks before the router, a workspace switch or a sign-out drops it.
    path: 'profile',
    canActivate: [authGuard, clientGuard],
    canDeactivate: [confirmBeforeLeaving],
    data: REDESIGNED,
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
    // Progress follows the client's mode (R5.3c): its Log weight sheet opens over the page.
    path: 'progress/dashboard',
    canDeactivate: [confirmSheetLeave],
    canActivate: [authGuard, clientGuard],
    data: REDESIGNED,
    title: $localize`My progress dashboard | TB Gym`,
    loadComponent: () =>
      import('./features/progress/progress-dashboard').then(
        (module) => module.ProgressDashboardView,
      ),
  },
  {
    // Weight, measurements and photos (R5.3c); `?tab=` names the one that opens.
    path: 'progress',
    canDeactivate: [confirmSheetLeave],
    canActivate: [authGuard, clientGuard],
    data: REDESIGNED,
    title: $localize`Your entries | TB Gym`,
    loadComponent: () =>
      import('./features/progress/progress-entries').then((module) => module.ProgressEntries),
  },
  {
    // The coach's brand (R3.5a, plan §3.1), a Settings page beside the coaching space's details. Leaving
    // with changes asks first, as Name and region does (audit COACH-1).
    path: 'workspace/brand',
    canActivate: [authGuard, ownerGuard],
    canDeactivate: [confirmBeforeLeaving],
    data: REDESIGNED,
    title: $localize`Brand | TB Gym`,
    loadComponent: () =>
      import('./features/workspace/workspace-brand').then((module) => module.WorkspaceBrand),
  },
  {
    // How calories are counted and the AI allowance (R4.4c), a Settings page; the API is the owner's too.
    // Leaving with changes asks first (audit COACH-1).
    path: 'workspace/nutrition',
    canActivate: [authGuard, ownerGuard],
    canDeactivate: [confirmBeforeLeaving],
    data: REDESIGNED,
    title: $localize`Nutrition settings | TB Gym`,
    loadComponent: () =>
      import('./features/workspace/workspace-nutrition').then(
        (module) => module.WorkspaceNutrition,
      ),
  },
  {
    // The notices TB Gym gave up delivering (audit INV-4), a Settings page; the API is the owner's too.
    path: 'workspace/undelivered-notices',
    canActivate: [authGuard, ownerGuard],
    data: REDESIGNED,
    title: $localize`Undelivered notices | TB Gym`,
    loadComponent: () =>
      import('./features/workspace/undelivered-notices').then(
        (module) => module.UndeliveredNotices,
      ),
  },
  {
    // Settings › Name and region (R5.2a): rebuilt in the Settings layout, asks before changes are lost.
    path: 'workspace',
    canActivate: [authGuard, ownerGuard],
    canDeactivate: [confirmBeforeLeaving],
    data: REDESIGNED,
    title: $localize`Name and region | TB Gym`,
    loadComponent: () =>
      import('./features/workspace/workspace-settings').then((module) => module.WorkspaceSettings),
  },
  {
    path: 'team',
    canActivate: [authGuard, ownerGuard],
    // Its Invite a coach sheet asks before Browser Back drops what was typed (audit COACH-1).
    canDeactivate: [confirmSheetLeave],
    data: REDESIGNED,
    title: $localize`Team | TB Gym`,
    loadComponent: () => import('./features/team/team').then((module) => module.Team),
  },
  {
    path: 'billing',
    canActivate: [authGuard, ownerGuard],
    data: { ...HOUSE_BRAND, ...REDESIGNED },
    title: $localize`Billing | TB Gym`,
    loadComponent: () => import('./features/billing/billing').then((module) => module.Billing),
  },
  {
    // The platform admin's screens (ADR 0028, rebuilt in R5.2b): a global role, needing no
    // workspace at all. The overview lists every coaching space; each opens on its own page.
    path: 'admin/billing',
    canActivate: [authGuard, platformAdminGuard],
    data: { ...HOUSE_BRAND, ...REDESIGNED },
    title: $localize`Platform billing | TB Gym`,
    loadComponent: () =>
      import('./features/platform-admin/platform-admin').then((module) => module.PlatformAdmin),
  },
  {
    path: 'admin/billing/:tenantId',
    canActivate: [authGuard, platformAdminGuard],
    data: { ...HOUSE_BRAND, ...REDESIGNED },
    title: $localize`Coaching space | Platform billing | TB Gym`,
    loadComponent: () =>
      import('./features/platform-admin/platform-space').then((module) => module.PlatformSpace),
  },
  {
    // Rebuilt in R5.2a for staff and clients; a half-typed password change asks before it is lost.
    path: 'account/security',
    canActivate: [authGuard],
    canDeactivate: [confirmBeforeLeaving],
    data: REDESIGNED,
    title: $localize`Password and security | TB Gym`,
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
  // The homepage's file by name (nginx answers it with the shell) is the homepage.
  { path: 'index.html', pathMatch: 'full', redirectTo: '' },
  {
    // Any other address says it is not here, inside the person's own shell or the signed-out frame
    // (audit AUTH-10), where it used to go home without a word.
    path: '**',
    canActivate: [sessionKnownGuard],
    data: REDESIGNED,
    title: $localize`Page not found | TB Gym`,
    loadComponent: () => import('./features/not-found/not-found').then((module) => module.NotFound),
  },
];
