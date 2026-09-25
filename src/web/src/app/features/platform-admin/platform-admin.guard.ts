import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';

/** The platform-admin role, from the session. Presentation only: the API authorizes every request. */
export function isPlatformAdmin(roles: readonly string[] | null | undefined): boolean {
  return roles?.includes('PlatformAdmin') ?? false;
}

export const platformAdminGuard: CanActivateFn = async () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.initialize();
  return isPlatformAdmin(auth.user()?.roles) ? true : router.createUrlTree(['/']);
};
