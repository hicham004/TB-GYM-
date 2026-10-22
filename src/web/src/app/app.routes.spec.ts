import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';
import { memberGuard, ownerGuard, sessionKnownGuard } from './core/auth/auth.guards';
import { confirmBeforeLeaving, confirmSheetLeave } from './core/forms/leave-guard';
import { NotFound } from './features/not-found/not-found';
import { UndeliveredNotices } from './features/workspace/undelivered-notices';

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

  // Audit INV-4: the notices TB Gym gave up delivering are the owner's to read, as the API answers.
  it('opens Undelivered notices to the owner only, as a page of its own', async () => {
    const notices = route('workspace/undelivered-notices');
    expect(notices.canActivate).toContain(ownerGuard);
    expect(notices.title).toBe('Undelivered notices | TB Gym');
    expect(await (notices.loadComponent as () => Promise<unknown>)()).toBe(UndeliveredNotices);
  });

  it('names neither kind of invitation in the title of its link', () => {
    expect(route('invite').title).toBe('Invitation | TB Gym');
  });

  // Audit AUTH-10: an unknown address says so, where it used to go home without a word.
  it('answers any other address with the not-found page, once the session is known', async () => {
    const last = routes.at(-1)!;
    expect(last.path).toBe('**');
    expect(last.redirectTo).toBeUndefined();
    expect(last.canActivate).toContain(sessionKnownGuard);
    expect(last.title).toBe('Page not found | TB Gym');
    expect(await (last.loadComponent as () => Promise<unknown>)()).toBe(NotFound);
    // The homepage's file by name is the homepage, as nginx answers it with the shell.
    expect(route('index.html').redirectTo).toBe('');
  });

  // Audit UIQ-13: sign-in is finished HTML like the homepage and what changed; nothing else is.
  it('renders the homepage, what changed and sign-in at build time, and every other address in the browser', () => {
    expect(serverRoutes).toEqual([
      { path: '', renderMode: RenderMode.Prerender },
      { path: 'changelog', renderMode: RenderMode.Prerender },
      { path: 'auth/sign-in', renderMode: RenderMode.Prerender },
      { path: '**', renderMode: RenderMode.Client },
    ]);
  });
});
