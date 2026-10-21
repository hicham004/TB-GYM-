import type { TenantRole } from '../api/api.models';

/**
 * A member's role in the workspace, in words. Its own file because the coach shell names the role on
 * every page: `display-labels.ts` holds a hundred more labels the shell never shows, and whatever the
 * shell imports is in every page's first download (audit WEB-5).
 */
export function tenantRoleLabel(role: TenantRole | undefined): string {
  switch (role) {
    case 'Owner':
      return $localize`Owner`;
    case 'Coach':
      return $localize`Coach`;
    case 'Client':
      return $localize`Client`;
    default:
      return '';
  }
}
