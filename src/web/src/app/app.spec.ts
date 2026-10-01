import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { ClientAccessStore } from './core/access/client-access.store';
import { AuthStore } from './core/auth/auth.store';
import { MessageUnreadStore } from './core/messaging/message-unread.store';
import { NotificationStore } from './core/notifications/notification.store';
import { TenantStore } from './core/tenancy/tenant.store';
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
      provideRouter([{ path: '**', children: [] }]),
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
  afterEach(() => {
    TestBed.resetTestingModule();
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
   * first wait is a launch: signing in later waits again, and that keeps the bar over the form.
   */
  it('draws the launch screen for the first wait only, never for one while signing in', async () => {
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
    expect(host.textContent).toContain('Checking session');
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

    expect(clear).toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalled();
  });
});
