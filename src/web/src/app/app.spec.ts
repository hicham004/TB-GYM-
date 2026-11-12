import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ClientAccessStore } from './core/access/client-access.store';
import { AuthStore } from './core/auth/auth.store';
import { MessageUnreadStore } from './core/messaging/message-unread.store';
import { NotificationStore } from './core/notifications/notification.store';
import { TenantStore } from './core/tenancy/tenant.store';
import { FULL_SCREEN, WEBSITE_PAGE } from './core/theme/redesigned-route';
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
    roles?: string[];
    /** The address the browser opened the app at, which the app reads as it starts (notes plan N2). */
    startAt?: string;
  } = {},
) {
  const clear = vi.fn();
  const clearMessages = vi.fn();
  const user = signal<(Omit<typeof OWNER, 'roles'> & { roles: string[] }) | null>(
    options.signedIn ? { ...OWNER, roles: options.roles ?? [] } : null,
  );
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

  if (options.startAt) TestBed.inject(Location).replaceState(options.startAt);
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

  /**
   * The website's own page (`/about`, notes plan N2) fills the window as a visitor sees it, whoever
   * is signed in: its own header leads back, so the app draws none of its three shells around it.
   */
  describe('the website’s own page, opened inside the app (notes plan N2)', () => {
    const ROUTES: Routes = [
      { path: 'about', data: WEBSITE_PAGE, children: [] },
      { path: '**', children: [] },
    ];

    /** What the app draws around the page, as a person meets it. */
    function around(host: HTMLElement) {
      const main = host.querySelector<HTMLElement>('main')!;
      return {
        coachShell: host.querySelector('app-coach-shell') !== null,
        clientTabs: host.querySelector('app-client-tabs') !== null,
        // The coach shell's bar or the member's.
        topBar: host.querySelector('header.topbar') !== null,
        // The app's own skip link, a child of the app itself; the website's page brings its own.
        skipLink: host.querySelector(':scope > a.skip-link') !== null,
        layout: Array.from(host.classList).filter((name) => name.endsWith('-layout')),
        main: Array.from(main.classList).sort(),
        tabindex: main.getAttribute('tabindex'),
        mode: main.getAttribute('data-mode'),
      };
    }

    /** No shell at all: what a visitor has around the homepage. */
    const NOTHING = {
      coachShell: false,
      clientTabs: false,
      topBar: false,
      skipLink: false,
      layout: [],
      main: [],
      tabindex: null,
      mode: 'light',
    };

    const COACH_SHELL = {
      ...NOTHING,
      coachShell: true,
      topBar: true,
      skipLink: true,
      layout: ['coach-layout'],
      main: ['coach-main'],
      tabindex: '-1',
    };

    const PEOPLE = [
      { who: 'an owner', options: { owner: true }, shell: COACH_SHELL, remembered: 'coach' },
      { who: 'a coach', options: { coach: true }, shell: COACH_SHELL, remembered: 'coach' },
      {
        who: 'a client',
        options: { client: true },
        shell: {
          ...NOTHING,
          clientTabs: true,
          skipLink: true,
          layout: ['client-layout'],
          main: ['app-main', 'client-main'],
          tabindex: '-1',
        },
        remembered: 'client',
      },
      {
        who: 'someone signed in with no coaching space',
        options: { memberships: [] },
        shell: { ...NOTHING, topBar: true, main: ['app-main'] },
        remembered: null,
      },
    ];

    /** A navigation a guard holds never lets settle() return: a few turns and a redraw instead. */
    async function turns(fixture: ComponentFixture<unknown>): Promise<void> {
      for (let round = 0; round < 5; round++) {
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
      }
    }

    /**
     * The coach's billing banner is drawn inside <main> once the page is idle and its code has
     * arrived, so it is waited for where it belongs; anywhere else a few turns give it the chance.
     */
    async function billingBanner(
      fixture: ComponentFixture<unknown>,
      host: HTMLElement,
      drawn: boolean,
    ): Promise<void> {
      if (drawn) {
        await vi.waitFor(
          () => {
            fixture.detectChanges();
            expect(host.querySelector('main app-billing-banner')).not.toBeNull();
          },
          { timeout: 3000 },
        );
      } else {
        await turns(fixture);
        expect(host.querySelector('app-billing-banner')).toBeNull();
      }
    }

    for (const { who, options, shell, remembered } of PEOPLE) {
      it(`draws no shell around it for ${who}, and brings theirs back on the next page`, async () => {
        const { fixture, host } = await render({ signedIn: true, ...options, routes: ROUTES });
        const router = TestBed.inject(Router);

        await router.navigateByUrl('/clients');
        await settle(fixture);
        await billingBanner(fixture, host, shell.coachShell);
        expect(around(host)).toEqual(shell);
        expect(localStorage.getItem('tb-gym.launch-shell')).toBe(remembered);

        await router.navigateByUrl('/about');
        await settle(fixture);
        await billingBanner(fixture, host, false);
        expect(around(host)).toEqual(NOTHING);
        expect(host.querySelector('.authenticated-nav')).toBeNull();
        // The page itself is all the one <main> holds.
        const main = host.querySelector('main#main-content')!;
        expect(Array.from(main.children).map((child) => child.localName)).toEqual([
          'router-outlet',
        ]);
        // Nothing of a starting app either: the session has answered.
        expect(
          host.querySelector('.launch, .frame-sidebar, .frame-topbar, .frame-tabs'),
        ).toBeNull();
        // The device still knows which frame to draw at its next start: the visit forgets nothing.
        expect(localStorage.getItem('tb-gym.launch-shell')).toBe(remembered);

        await router.navigateByUrl('/clients');
        await settle(fixture);
        await billingBanner(fixture, host, shell.coachShell);
        expect(around(host)).toEqual(shell);
        expect(localStorage.getItem('tb-gym.launch-shell')).toBe(remembered);
      });
    }

    it('gives a visitor there what a visitor has anywhere: nothing around the page', async () => {
      const { fixture, host } = await render({ routes: ROUTES });
      const router = TestBed.inject(Router);

      await router.navigateByUrl('/changelog');
      await settle(fixture);
      expect(around(host)).toEqual(NOTHING);
      const elsewhere = host.innerHTML;

      await router.navigateByUrl('/about');
      await settle(fixture);
      expect(around(host)).toEqual(NOTHING);
      expect(host.innerHTML).toBe(elsewhere);
      expect(localStorage.getItem('tb-gym.launch-shell')).toBeNull();
    });

    /**
     * An app that starts on the page (a reload there, or the address typed) knows it from its
     * address at once, before the router has recognised anything and before the session has
     * answered: its very first picture must not draw the frame of a shell that will not come. The
     * real route waits for the session as these do (`sessionKnownGuard`).
     */
    async function start(address: string, remembered: 'coach' | 'client') {
      localStorage.setItem('tb-gym.launch-shell', remembered);
      let sessionAnswers!: (allowed: boolean) => void;
      const session = new Promise<boolean>((resolve) => (sessionAnswers = resolve));
      const app = await render({
        loading: true,
        owner: remembered === 'coach',
        client: remembered === 'client',
        startAt: address,
        routes: [
          { path: 'about', data: WEBSITE_PAGE, canActivate: [() => session], children: [] },
          { path: '**', canActivate: [() => session], children: [] },
        ],
      });
      const router = TestBed.inject(Router);
      // What the app drew in its first moment, before the router had started on the address.
      const firstPicture = {
        frame: app.host.querySelector('.frame-sidebar, .frame-topbar, .frame-tabs') !== null,
        launch: app.host.querySelector('.launch') !== null,
      };
      // The app's first navigation. Not awaited: it ends only when the session answers.
      const arrived = router.navigateByUrl(address);
      await turns(app.fixture);
      return {
        ...app,
        router,
        firstPicture,
        answer: async () => {
          app.auth.user.set(OWNER);
          app.auth.loading.set(false);
          sessionAnswers(true);
          await arrived;
          await settle(app.fixture);
        },
      };
    }

    it.each(['coach', 'client'] as const)(
      'draws the plain launch screen, not the %s frame this device remembers, when the app starts there',
      async (remembered) => {
        const { fixture, host, router, answer, firstPicture } = await start('/about', remembered);

        // Not for one frame: the first picture is already the plain launch screen.
        expect(firstPicture).toEqual({ frame: false, launch: true });
        // Still starting: the session has not answered and the first navigation has not ended.
        expect(router.navigated).toBe(false);
        expect(host.querySelector('.frame-sidebar')).toBeNull();
        expect(host.querySelector('.frame-topbar')).toBeNull();
        expect(host.querySelector('.frame-tabs')).toBeNull();
        expect(host.classList).not.toContain('coach-layout');
        expect(host.classList).not.toContain('client-layout');
        expect(Array.from(host.querySelector('main')!.classList)).toEqual([]);
        // One thing says the app is loading, and it is the launch screen.
        const statuses = host.querySelectorAll('[role="status"]');
        expect(statuses).toHaveLength(1);
        expect(statuses[0].classList).toContain('launch');
        expect(statuses[0].textContent).toContain('Loading TB Gym');

        await answer();

        expect(router.url).toBe('/about');
        expect(host.querySelector('.launch')).toBeNull();
        expect(around(host)).toEqual(NOTHING);
        // The frame is kept for the next start, which may be on any page.
        expect(localStorage.getItem('tb-gym.launch-shell')).toBe(remembered);

        await router.navigateByUrl('/');
        await settle(fixture);
        expect(
          host.querySelector(remembered === 'coach' ? 'app-coach-shell' : 'app-client-tabs'),
        ).not.toBeNull();
      },
    );

    it('still draws the remembered frame while the session answers when the app starts on any other page', async () => {
      const { host, router, answer, firstPicture } = await start('/clients', 'coach');

      expect(firstPicture).toEqual({ frame: true, launch: false });
      expect(router.navigated).toBe(false);
      expect(host.querySelector('.frame-sidebar')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('.frame-topbar')?.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('.launch')).toBeNull();
      expect(host.classList).toContain('coach-layout');
      expect(host.querySelector('main')?.classList).toContain('coach-main');

      await answer();

      expect(router.url).toBe('/clients');
      expect(host.querySelector('.frame-sidebar')).toBeNull();
      expect(around(host)).toEqual(COACH_SHELL);
    });

    /**
     * A page that holds typed work asks before it is left. Until the person answers Leave and the
     * navigation ends they are still on that page, so its shell stays around it.
     */
    it('keeps the coach shell around a page that asks before it is left, until the person leaves', async () => {
      let answer!: (leave: boolean) => void;
      const asked = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
      const { fixture, host } = await render({
        signedIn: true,
        coach: true,
        routes: [
          { path: 'about', data: WEBSITE_PAGE, children: [] },
          { path: 'workspace', canDeactivate: [asked], children: [] },
          { path: '**', children: [] },
        ],
      });
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/workspace');
      await settle(fixture);
      expect(around(host)).toEqual(COACH_SHELL);

      // "TB Gym website" pressed with work typed: the page asks, and nothing has moved yet.
      const stayed = router.navigateByUrl('/about');
      await turns(fixture);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(router.url).toBe('/workspace');
      expect(around(host)).toEqual(COACH_SHELL);

      // Stay.
      answer(false);
      expect(await stayed).toBe(false);
      await settle(fixture);
      expect(router.url).toBe('/workspace');
      expect(around(host)).toEqual(COACH_SHELL);

      // Pressed again, then Leave: the shell goes only once the navigation has ended.
      const left = router.navigateByUrl('/about');
      await turns(fixture);
      expect(asked).toHaveBeenCalledTimes(2);
      expect(around(host)).toEqual(COACH_SHELL);

      answer(true);
      expect(await left).toBe(true);
      await settle(fixture);
      expect(router.url).toBe('/about');
      expect(around(host)).toEqual(NOTHING);
    });

    /**
     * The page's code is fetched when it is first opened. If that fails on an app started there, no
     * page was reached: the person's shell is drawn after all, with its ways to every other page.
     */
    it('draws the shell after all when the app starts there and the page cannot be opened', async () => {
      const { fixture, host } = await render({
        signedIn: true,
        owner: true,
        startAt: '/about',
        routes: [
          {
            path: 'about',
            data: WEBSITE_PAGE,
            loadComponent: () => Promise.reject(new Error('The page could not be fetched.')),
          },
          { path: '**', children: [] },
        ],
      });
      const router = TestBed.inject(Router);
      expect(around(host)).toEqual(NOTHING);

      await expect(router.navigateByUrl('/about')).rejects.toThrow('could not be fetched');
      await settle(fixture);

      await billingBanner(fixture, host, true);
      expect(around(host)).toEqual(COACH_SHELL);
    });
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

  /** A platform admin with no workspace reaches the admin's pages from that bar (notes plan N4a). */
  it('links the platform admin’s pages from the member top bar, Coaches last', async () => {
    const admin = await render({ signedIn: true, memberships: [], roles: ['PlatformAdmin'] });

    const links = Array.from(
      admin.host.querySelectorAll<HTMLAnchorElement>('.session-controls a.account-link'),
    )
      .map((link) => [link.textContent?.trim(), link.getAttribute('href')])
      .filter(([, href]) => href?.startsWith('/admin/'));
    expect(links).toEqual([
      ['Platform billing', '/admin/billing'],
      ['Legal documents', '/admin/legal'],
      ['Coaches', '/admin/coaches'],
    ]);
    TestBed.resetTestingModule();

    const member = await render({ signedIn: true, memberships: [] });
    expect(member.host.querySelector('.authenticated-nav')).not.toBeNull();
    expect(member.host.querySelector('a[href^="/admin/"]')).toBeNull();
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
