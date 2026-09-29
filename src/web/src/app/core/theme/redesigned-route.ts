import { ActivatedRouteSnapshot, Data } from '@angular/router';

/**
 * Route data for a screen rebuilt on brand v2: it follows the person's light or dark mode. Every
 * other screen still has colours in its styles that only work on light, so App keeps it light
 * (`data-mode="light"` on <main>) even inside a dark shell. R5.3 removes both once every screen
 * is rebuilt.
 */
export const REDESIGNED: Data = { redesigned: true };

/** Whether the active route, or a route above it, is marked REDESIGNED. */
export function isRedesignedRoute(root: ActivatedRouteSnapshot): boolean {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.data['redesigned'] === true) return true;
  }
  return false;
}
