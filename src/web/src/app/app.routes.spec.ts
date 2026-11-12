import type { Routes } from '@angular/router';
import { RenderMode } from '@angular/ssr';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';
import {
  authGuard,
  memberGuard,
  ownerGuard,
  publicHomeGuard,
  sessionKnownGuard,
} from './core/auth/auth.guards';
import { confirmBeforeLeaving, confirmSheetLeave } from './core/forms/leave-guard';
import { REDESIGNED, WEBSITE_PAGE } from './core/theme/redesigned-route';
import { Home } from './features/home/home';
import { NotFound } from './features/not-found/not-found';
import { platformAdminGuard } from './features/platform-admin/platform-admin.guard';
import { PlatformCoaches } from './features/platform-admin/platform-coaches';
import { PlatformHouse } from './features/platform-admin/platform-house';
import { Train } from './features/train/train';
import { TrainSignUpPage } from './features/train/train-sign-up';
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

  // Notes plan N4a: the certificate record, a platform admin's page like Platform billing, whose Back
  // closes its sheets rather than asking.
  it('opens Coaches to the platform admin alone, as a page of its own', async () => {
    const coaches = route('admin/coaches');
    expect(coaches.canActivate).toEqual([authGuard, platformAdminGuard]);
    expect(coaches.canDeactivate).toBeUndefined();
    expect(coaches.title).toBe('Coaches | TB Gym');
    // In TB Gym's colours outside any workspace, as Platform billing is.
    expect(coaches.data).toEqual({ houseBrand: true, redesigned: true });
    expect(coaches.data).toEqual(route('admin/billing').data);
    expect(await (coaches.loadComponent as () => Promise<unknown>)()).toBe(PlatformCoaches);
  });

  // Notes plan N9a2: which space is the house and its settings, a platform admin's page like Coaches,
  // whose Change sheet keeps what was typed through Browser Back, as Legal documents' does.
  it('opens House to the platform admin alone, as a page of its own whose Change sheet asks before Back drops what was typed', async () => {
    const house = route('admin/house');
    expect(house.canActivate).toEqual([authGuard, platformAdminGuard]);
    expect(house.canDeactivate).toEqual([confirmSheetLeave]);
    expect(house.canDeactivate).toEqual(route('admin/legal').canDeactivate);
    expect(house.title).toBe('House | TB Gym');
    expect(house.data).toEqual({ houseBrand: true, redesigned: true });
    expect(house.data).toEqual(route('admin/coaches').data);
    expect(await (house.loadComponent as () => Promise<unknown>)()).toBe(PlatformHouse);
  });

  // Notes plan N9a2: TB Gym's own sign-up opens for a visitor and for someone signed in alike, so it
  // only waits for the session's answer; the server decides who may sign up.
  it('opens TB Gym’s own sign-up at /train to anyone once the session is known, in TB Gym’s colours, drawn in the browser', async () => {
    const train = route('train');
    expect(routes.filter((item) => item.path === 'train')).toHaveLength(1);
    expect(train.canActivate).toEqual([sessionKnownGuard]);
    expect(train.canMatch).toBeUndefined();
    expect(train.canActivateChild).toBeUndefined();
    expect(train.canDeactivate).toBeUndefined();
    expect(train.data).toEqual({ houseBrand: true });

    const pages = await (train.loadChildren as () => Promise<Routes>)();
    // The form's title fits a visitor creating an account and someone signing up with theirs alike.
    expect(pages.map((page) => [page.path, page.title])).toEqual([
      ['', 'Train with TB Gym'],
      ['sign-up', 'Sign up | Train with TB Gym'],
    ]);
    expect(pages.map((page) => page.canActivate ?? page.canDeactivate ?? null)).toEqual([
      null,
      null,
    ]);
    expect(await (pages[0].loadComponent as () => Promise<unknown>)()).toBe(Train);
    expect(await (pages[1].loadComponent as () => Promise<unknown>)()).toBe(TrainSignUpPage);

    // Never rendered ahead of time: no finished HTML of it for nginx to answer with.
    const rendered = serverRoutes.map((item) => item.path);
    expect(rendered).not.toContain('train');
    expect(rendered).not.toContain('train/sign-up');
    // Before the not-found page, which would answer it otherwise.
    expect(routes.indexOf(train)).toBeLessThan(routes.findIndex((item) => item.path === '**'));
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

  // Notes plan N2: the website from inside the app. Anyone may open it, signed in or not, so nothing
  // decides who matches it; it only waits for the session, so it never draws a visitor's header first.
  it('opens the homepage again at /about to anyone, once the session is known, with no shell around it', async () => {
    const about = route('about');
    expect(routes.filter((item) => item.path === 'about')).toHaveLength(1);
    expect(about.canActivate).toEqual([sessionKnownGuard]);
    expect(about.canMatch).toBeUndefined();
    expect(about.canDeactivate).toBeUndefined();
    expect(about.redirectTo).toBeUndefined();
    expect(about.data).toEqual(WEBSITE_PAGE);
    expect(about.data).toEqual({ websitePage: true, houseBrand: true });
    expect(await (about.loadComponent as () => Promise<unknown>)()).toBe(Home);
    // The homepage's own title, word for word.
    const [home] = routes.filter((item) => item.path === '');
    expect(about.title).toBe('TB Gym: coach both sides of the week');
    expect(about.title).toBe(home.title);
    // Drawn in the browser, never ahead of time: no finished HTML of it for nginx to answer with.
    expect(serverRoutes.map((item) => item.path)).not.toContain('about');
    // Before the not-found page, which would answer it otherwise.
    expect(routes.indexOf(about)).toBeLessThan(routes.findIndex((item) => item.path === '**'));
  });

  it('keeps / as it was: the homepage for a visitor alone, and Today for anyone signed in', async () => {
    const [home, today, ...others] = routes.filter((item) => item.path === '');
    expect(others).toEqual([]);

    expect(home.pathMatch).toBe('full');
    expect(home.canMatch).toEqual([publicHomeGuard]);
    expect(home.canActivate).toBeUndefined();
    expect(home.title).toBe('TB Gym: coach both sides of the week');
    // No mark of the website's page: a visitor has no shell to take away, and / is never noindex.
    expect(home.data).toBeUndefined();
    expect(await (home.loadComponent as () => Promise<unknown>)()).toBe(Home);

    expect(today.pathMatch).toBe('full');
    expect(today.canMatch).toBeUndefined();
    expect(today.canActivate).toEqual([authGuard]);
    expect(today.title).toBe('Today | TB Gym');
    expect(today.data).toEqual(REDESIGNED);
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
