import { ActivatedRouteSnapshot, Data } from '@angular/router';

/**
 * Route data for a screen rebuilt on brand v2: it follows the person's light or dark mode. Every
 * other screen still has colours in its styles that only work on light, so App keeps it light
 * (`data-mode="light"` on <main>) even inside a dark shell. R5.3 removes both once every screen
 * is rebuilt.
 */
export const REDESIGNED: Data = { redesigned: true };

/**
 * For a route two screens share by role: `/` is Coach Today (rebuilt in R3.2) for staff and the
 * client's Today (not yet checked in dark) for a client.
 */
export const REDESIGNED_FOR_STAFF: Data = { redesigned: 'staff' };

export type RedesignedFor = 'everyone' | 'staff' | null;

/** Who the active route, or a route above it, is rebuilt for. */
export function redesignedFor(root: ActivatedRouteSnapshot): RedesignedFor {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    const marker: unknown = route.data['redesigned'];
    if (marker === true) return 'everyone';
    if (marker === 'staff') return 'staff';
  }
  return null;
}
