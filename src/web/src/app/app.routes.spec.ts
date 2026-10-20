import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { memberGuard } from './core/auth/auth.guards';
import { confirmBeforeLeaving, confirmSheetLeave } from './core/forms/leave-guard';

const route = (path: string) => {
  const found = routes.find((item) => item.path === path);
  if (!found) throw new Error(`No route is at "${path}".`);
  return found;
};

describe('the app routes', () => {
  // Audit COACH-1: every page that holds typed work asks before the router drops it, as the
  // other sheet hosts and Name and region already did.
  it('asks before Browser Back or a link leaves an invite sheet with typed work in it', () => {
    expect(route('invitations').canDeactivate).toContain(confirmSheetLeave);
    expect(route('team').canDeactivate).toContain(confirmSheetLeave);
  });

  it('asks before leaving the Brand and Nutrition settings with changes not saved', () => {
    expect(route('workspace/brand').canDeactivate).toContain(confirmBeforeLeaving);
    expect(route('workspace/nutrition').canDeactivate).toContain(confirmBeforeLeaving);
    expect(route('workspace').canDeactivate).toContain(confirmBeforeLeaving);
  });

  // Audit COACH-14: someone with no role in the workspace is told so on Today, as on every page.
  it('opens Messages and Notifications only to someone with a role in the workspace', () => {
    expect(route('messages').canActivate).toContain(memberGuard);
    expect(route('notifications').canActivate).toContain(memberGuard);
  });

  it('names neither kind of invitation in the title of its link', () => {
    expect(route('invite').title).toBe('Invitation | TB Gym');
  });
});
