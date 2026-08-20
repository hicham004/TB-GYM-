import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { TenantStore } from '../tenancy/tenant.store';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.initialize();
  return auth.user()
    ? true
    : router.createUrlTree(['/auth/sign-in'], { queryParams: { returnUrl: state.url } });
};

export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.initialize();
  return auth.user() ? router.createUrlTree(['/']) : true;
};

export const coachGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const tenants = inject(TenantStore);
  const router = inject(Router);
  await auth.initialize();
  return tenants.canCoach() ? true : router.createUrlTree(['/']);
};

export const ownerGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const tenants = inject(TenantStore);
  const router = inject(Router);
  await auth.initialize();
  return tenants.isOwner() ? true : router.createUrlTree(['/']);
};

export const clientGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const tenants = inject(TenantStore);
  const router = inject(Router);
  await auth.initialize();
  return tenants.isClient() ? true : router.createUrlTree(['/']);
};
