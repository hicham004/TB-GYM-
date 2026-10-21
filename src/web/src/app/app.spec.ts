import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ClientAccessStore } from './core/access/client-access.store';
import { AuthStore } from './core/auth/auth.store';
import { MessageUnreadStore } from './core/messaging/message-unread.store';
import { NotificationStore } from './core/notifications/notification.store';
import { TenantStore } from './core/tenancy/tenant.store';
import { FULL_SCREEN } from './core/theme/redesigned-route';
import { settle } from '../testing/dom';
import { fakeClientAccess } from '../testing/today-fixtures';

const OWNER = {
  id: 'user-1',
  email: 'coach@example.test',
  displayName: 'Tarek Bou',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const MEMBERSHIP = {
  tenantId: 'tenant-1',
  tenantName: 'TB Gym',
  tenantSlug: 'tb-gym',
  role: 'Owner' as const,
};

async function render(
  options: {
    signedIn?: boolean;
    owner?: boolean;
    coach?: boolean;
    unread?: number;
    unreadMessages?: number;
    client?: boolean;
    loading?: boolean;
    memberships?: (typeof MEMBERSHIP)[];
    selectedTenantId?: string;
    routes?: Routes;
  } = {},
) {
  const clear = vi.fn();
  const clearMessages = vi.fn();
  const user = signal<typeof OWNER | null>(options.signedIn ? OWNER : null);
  const loading = signal(Boolean(options.loading));
  const select = vi.fn();
  const canCoach = Boolean(options.owner || options.coach);
  const membership = options.owner
    ? MEMBERSHIP
    : { ...MEMBERSHIP, role: options.coach ? ('Coach' as const) : ('Client' as const) };
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      // A catch-all so signing out can navigate to /auth/sign-in without the router rejecting the
      // URL. The shell itself is what is under test; where it navigates to is a routing concern.
      provideRouter(options.routes ?? [{ path: '**', children: [] }]),
      { provide: ClientAccessStore, useValue: fakeClientAccess() },
      {
        provide: NotificationStore,
        useValue: {
          unread: signal(options.unread ?? 0),
          loading: signal(false),
          isAvailable: signal(Boolean(options.signedIn)),
          clear,
          refresh: vi.fn().mockResolvedValue(undefined),
          set: vi.fn(),
          decrement: vi.fn(),
        },
      },
      {
        provide: MessageUnreadStore,
        useValue: {
          unread: signal(options.unreadMessages ?? 0),
          loading: signal(false),
          isAvailable: signal(Boolean(options.signedIn)),
          clear: clearMessages,
          refresh: vi.fn().mockResolvedValue(undefined),
          set: vi.fn(),
        },
      },
      {
        provide: AuthStore,
        useValue: {
          user,
          loading,
          initialize: vi.fn().mockResolvedValue(undefined),
          logout: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: TenantStore,
        useValue: {
          memberships: signal(options.signedIn ? (options.memberships ?? [MEMBERSHIP]) : []),
          selectedTenantId: signal(
            options.signedIn ? (options.selectedTenantId ?? 'tenant-1') : null,
          ),
          selectedMembership: signal(options.signedIn ? membership : undefined),
          canCoach: signal(canCoach),
          isOwner: signal(Boolean(options.owner)),
          isClient: signal(Boolean(options.client)),
          select,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    clear,
    clearMessages,
    select,
    auth: { user, loading },
  };
}

describe('App', () => {
  // The shell a test draws is remembered for the next start (shell/launch-shell.ts): each test starts with none.
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('creates the application shell', async () => {
    const { fixture, host } = await render({ signedIn: true, memberships: [] });

    expect(fixture.componentInstance).toBeTruthy();
    expect(host.querySelector('.brand')?.textContent).toContain('TB Gym');
  });

  /**
   * Three shells, and only ever one of them. A client must never be handed the coach sidebar, and a
   * signed-out visitor must never be handed either: the shell follows the membership the tenant
   * store validated, while the server and the route guards remain the thing that decides access.
   */
  it('gives an owner the coach shell and nobody else the client or public one', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    expect(host.querySelector('app-coach-shell')).not.toBeNull();
    expect(host.querySelector('app-client-tabs')).toBeNull();
    // The pre-existing member top bar belongs to the other shell.
    expect(host.querySelector('.authenticated-nav')).toBeNull();
  });

  /**
   * A client gets the bottom tabs and no top bar at all: Notifications and Me are in Today's header,
   * and workspace switching and sign-out are on the Me page (339:2140).
   */
  it('gives a client the bottom tabs after the page, with no top bar', async () => {
    const { host } = await render({ signedIn: true, client: true, unread: 2, unreadMessages: 3 });

    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('header.topbar')).toBeNull();
    expect(host.querySelector('.workspace-picker')).toBeNull();
    const tabs = host.querySelector('app-client-tabs');
    expect(tabs).not.toBeNull();
    // After <main>, so the tabs come last in reading and focus order.
    expect(host.querySelector('main')?.compareDocumentPosition(tabs!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(host.querySelector('main')?.classList).toContain('client-main');
    expect(host.classList).toContain('client-layout');
  });

  /** The workout player fills the screen (R5.4a): no tab bar over Finish workout, no page margin. */
  it('takes the tabs and the page margin away on a full-screen route, and brings them back', async () => {
    const { fixture, host } = await render({
      signedIn: true,
      client: true,
      routes: [
        { path: 'training/today', data: FULL_SCREEN, children: [] },
        { path: '**', children: [] },
      ],
    });
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/training/today');
    await settle(fixture);
    expect(host.querySelector('app-client-tabs')).toBeNull();
    expect(host.querySelector('main')?.classList).toContain('full-screen');

    await router.navigateByUrl('/');
    await settle(fixture);
    expect(host.querySelector('app-client-tabs')).not.toBeNull();
    expect(host.querySelector('main')?.classList).not.toContain('full-screen');
  });

  it('lets a client skip to the page, without a fragment navigation', async () => {
    const { host } = await render({ signedIn: true, client: true });
    const skip = host.querySelector<HTMLAnchorElement>('a.skip-link')!;
    const main = host.querySelector<HTMLElement>('main')!;

    expect(host.firstElementChild).toBe(skip);
    expect(main.getAttribute('tabindex')).toBe('-1');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    skip.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(main);
  });

  it('lets an owner or a coach skip the sidebar and the top bar to the page (audit WEB-13)', async () => {
    for (const role of [{ owner: true }, { coach: true }]) {
      const { host } = await render({ signedIn: true, ...role });
      const skip = host.querySelector<HTMLAnchorElement>('a.skip-link')!;
      const main = host.querySelector<HTMLElement>('main')!;

      // Before the sidebar, so it is the first thing a keyboard reaches.
      expect(host.firstElementChild).toBe(skip);
      expect(skip.textContent?.trim()).toBe('Skip to content');
      expect(skip.compareDocumentPosition(host.querySelector('app-coach-shell')!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(main.getAttribute('tabindex')).toBe('-1');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      skip.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(main);
      TestBed.resetTestingModule();
    }
  });

  /**
   * Signed-out pages (the homepage, sign-in and the rest of /auth, invitations) draw their own
   * header, so a visitor gets no app chrome at all: no coach sidebar, no member bar, no client tabs.
   */
  it('keeps the signed-out shell separate from both', async () => {
    const { host } = await render();

    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('app-client-tabs')).toBeNull();
    expect(host.querySelector('header.topbar')).toBeNull();
    expect(host.querySelector('main router-outlet')).not.toBeNull();
  });

  /**
   * An account with a session but no workspace keeps the member top bar: it has no membership, so
   * there is no coach navigation to show and nothing to switch between.
   */
  it('keeps the member top bar for a signed-in account without a workspace', async () => {
    const { host } = await render({ signedIn: true, memberships: [] });

    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('app-client-tabs')).toBeNull();
    expect(host.querySelector('.authenticated-nav')).not.toBeNull();
    expect(host.querySelector('.workspace-picker')).toBeNull();
  });

  /** A known session that is being re-read keeps its shell rather than flashing another one. */
  it('waits for the first membership list instead of flashing the member bar', async () => {
    const { host } = await render({ signedIn: true, owner: true, loading: true, memberships: [] });

    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('.authenticated-nav')).toBeNull();
    expect(host.querySelector('.launch')).not.toBeNull();
  });

  /**
   * The installed app starts on a launch screen, not on a bar saying "Checking session". Only the
   * first wait is a launch. Signing in waits again, and that draws nothing over the sign-in form
   * and leaves its margins alone (audit WEB-9): the button already says it is signing in.
   */
  it('draws the launch screen for the first wait only, and nothing over the form while signing in', async () => {
    const { fixture, host, auth } = await render({ loading: true });

    expect(host.querySelector('.launch')?.getAttribute('role')).toBe('status');
    expect(host.querySelector('.launch')?.textContent).toContain('Loading TB Gym');
    expect(host.querySelector('.topbar')).toBeNull();

    auth.loading.set(false);
    await settle(fixture);
    expect(host.querySelector('.launch')).toBeNull();

    auth.loading.set(true);
    await settle(fixture);
    expect(host.querySelector('.launch')).toBeNull();
    expect(host.querySelector('.topbar')).toBeNull();
    expect(host.textContent).not.toContain('Checking session');

    // Signed in, memberships still on their way: the form keeps its place until the app moves on.
    auth.user.set(OWNER);
    await settle(fixture);
    expect(host.querySelector('.topbar')).toBeNull();
    expect(host.querySelector('main')?.classList.contains('app-main')).toBe(false);
  });

  describe('the frame of the shell this device last drew (audit UIQ-5)', () => {
    it('draws a returning coach’s sidebar and top bar, empty, while the session answers', async () => {
      localStorage.setItem('tb-gym.launch-shell', 'coach');
      const { fixture, host, auth } = await render({ loading: true, owner: true });

      expect(host.classList).toContain('coach-layout');
      expect(host.querySelector('.frame-sidebar')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('.frame-topbar')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading TB Gym');
      expect(host.querySelector('.launch')).toBeNull();
      expect(host.querySelector('main')?.classList).toContain('coach-main');
      // The page area takes the person's mode with the frame, never a light page between dark bars.
      expect(host.querySelector('main')?.hasAttribute('data-mode')).toBe(false);

      auth.user.set(OWNER);
      auth.loading.set(false);
      await settle(fixture);

      // The shell takes the frame's places: the page keeps its own.
      expect(host.querySelector('.frame-sidebar')).toBeNull();
      expect(host.querySelector('.frame-topbar')).toBeNull();
      expect(host.querySelector('app-coach-shell')).not.toBeNull();
      expect(host.querySelector('main')?.classList).toContain('coach-main');
    });

    it('draws a returning client’s tabs, empty, after the page', async () => {
      localStorage.setItem('tb-gym.launch-shell', 'client');
      const { fixture, host, auth } = await render({ loading: true, client: true });

      expect(host.classList).toContain('client-layout');
      expect(host.querySelector('main + .frame-tabs')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('.frame-sidebar')).toBeNull();
      expect(host.querySelector('main')?.classList).toContain('client-main');

      auth.user.set(OWNER);
      auth.loading.set(false);
      await settle(fixture);

      expect(host.querySelector('.frame-tabs')).toBeNull();
      expect(host.querySelector('main + app-client-tabs')).not.toBeNull();
    });

    it('remembers the shell drawn for the next start, and forgets it once nobody is signed in', async () => {
      const { fixture, auth } = await render({ signedIn: true, owner: true });
      expect(localStorage.getItem('tb-gym.launch-shell')).toBe('coach');

      auth.user.set(null);
      await settle(fixture);

      expect(localStorage.getItem('tb-gym.launch-shell')).toBeNull();
    });

    it('asks for the serif the signed-in pages greet with as soon as the shell is known, once', async () => {
      const load = vi.fn().mockResolvedValue([]);
      Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
      try {
        localStorage.setItem('tb-gym.launch-shell', 'client');
        const { fixture, auth } = await render({ loading: true, client: true });
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith('1em "TB Home Serif"');

        auth.user.set(OWNER);
        auth.loading.set(false);
        await settle(fixture);
        expect(load).toHaveBeenCalledTimes(1);

        TestBed.resetTestingModule();
        localStorage.clear();
        await render();
        // A visitor's pages never asked for it.
        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        delete (document as { fonts?: unknown }).fonts;
      }
    });

    it('draws the plain launch screen when this device remembers no shell, or something else', async () => {
      localStorage.setItem('tb-gym.launch-shell', 'admin');
      const { host } = await render({ loading: true, owner: true });

      expect(host.querySelector('.launch')).not.toBeNull();
      expect(host.querySelector('.frame-sidebar')).toBeNull();
      expect(host.classList).not.toContain('coach-layout');
    });
  });

  it('hands over from the launch screen to the shell when the session answers', async () => {
    const { fixture, host, auth } = await render({ loading: true, client: true });
    expect(host.querySelector('.launch')).not.toBeNull();

    auth.user.set(OWNER);
    auth.loading.set(false);
    await settle(fixture);

    expect(host.querySelector('.launch')).toBeNull();
    expect(host.querySelector('app-client-tabs')).not.toBeNull();
  });

  it('clears both badges as part of signing out from the member bar', async () => {
    const { host, clear, clearMessages } = await render({ signedIn: true, memberships: [] });

    const signOut = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sign out',
    );
    signOut?.click();
    // Signing out first asks any open editor (none here) whether its work is saved.
    await new Promise((resolve) => setTimeout(resolve));

    expect(clear).toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalled();
  });
});
