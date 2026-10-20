import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { signInAfter } from './session-expiry';
import { TenantStore } from '../tenancy/tenant.store';

/** A session that ended (WEB-1) goes to sign-in too, with the sentence that says why. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.initialize();
  return auth.user() && !auth.ended() ? true : signInAfter(router, state.url, auth.ended());
};

export const publicHomeGuard: CanMatchFn = async () => {
  const auth = inject(AuthStore);
  await auth.initialize();
  return !auth.user();
};

/**
 * A session that ended is cleared here, once the person has left their page: the leave guards have
 * already run by now, so typed work was offered before the sheets close with the session.
 */
export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.initialize();
  if (auth.ended()) {
    auth.expire();
    return true;
  }
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
