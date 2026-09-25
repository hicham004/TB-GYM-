import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthStore } from './core/auth/auth.store';
import { MessageUnreadStore } from './core/messaging/message-unread.store';
import { NotificationStore } from './core/notifications/notification.store';
import { TenantStore } from './core/tenancy/tenant.store';
import { settle } from '../testing/dom';

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

// `/api/tenants` orders by workspace name, so "Alpha Strength" is always memberships[0]. A picker
// that silently falls back to the first option is indistinguishable from a correct one until the
// chosen workspace is not that one.
const ALPHA = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Strength',
  tenantSlug: 'alpha-strength',
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
          user: signal(options.signedIn ? OWNER : null),
          loading: signal(Boolean(options.loading)),
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
    expect(host.querySelector('.client-tabs')).toBeNull();
    // The pre-existing member top bar and its workspace picker belong to the other shell.
    expect(host.querySelector('.authenticated-nav')).toBeNull();
    expect(host.querySelector('.workspace-picker')).toBeNull();
  });

  it('keeps the client shell exactly as it was, with no coach sidebar', async () => {
    const { host } = await render({ signedIn: true, client: true, unread: 2, unreadMessages: 3 });

    expect(host.querySelector('app-coach-shell')).toBeNull();
    const tabs = host.querySelectorAll('.client-tabs a');
    expect(tabs).toHaveLength(5);
    expect([...tabs].map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/checkins/me',
      '/messages',
      '/progress/dashboard',
      '/me',
    ]);
    expect(host.querySelector('.client-tabs')?.textContent).toContain('3 unread messages');
    expect(host.querySelector('a[href="/notifications"]')?.textContent).toContain(
      '2 unread notifications',
    );
    expect(host.querySelector('a[href*="nutrition"]')).toBeNull();
  });

  /**
   * Signed-out pages (the homepage, sign-in and the rest of /auth, invitations) draw their own
   * header, so a visitor gets no app chrome at all: no coach sidebar, no member bar, no client tabs.
   */
  it('keeps the signed-out shell separate from both', async () => {
    const { host } = await render();

    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('.client-tabs')).toBeNull();
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
    expect(host.querySelector('.authenticated-nav')).not.toBeNull();
    expect(host.querySelector('.workspace-picker')).toBeNull();
  });

  /** A known session that is being re-read keeps its shell rather than flashing another one. */
  it('waits for the first membership list instead of flashing the member bar', async () => {
    const { host } = await render({ signedIn: true, owner: true, loading: true, memberships: [] });

    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('.authenticated-nav')).toBeNull();
    expect(host.textContent).toContain('Checking session');
  });

  it('offers the notifications link to every active member', async () => {
    const { host } = await render({ signedIn: true, client: true });

    const link = host.querySelector('nav a[href="/notifications"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Notifications');
  });

  it('hides the notifications link when nobody is signed in', async () => {
    const { host } = await render();

    expect(host.querySelector('a[href="/notifications"]')).toBeNull();
  });

  it('shows no badge when nothing is unread', async () => {
    const { host } = await render({ signedIn: true, client: true, unread: 0 });

    expect(host.querySelector('nav a[href="/notifications"] .badge')).toBeNull();
    expect(host.querySelector('nav a[href="/notifications"]')?.textContent).not.toContain('unread');
  });

  it('announces one unread notification in words as well as in the badge', async () => {
    const { host } = await render({ signedIn: true, client: true, unread: 1 });

    expect(host.querySelector('nav a[href="/notifications"] .badge')?.textContent?.trim()).toBe(
      '1',
    );
    // The number alone would be announced as "Notifications 1" with no explanation of what 1 is.
    expect(
      host.querySelector('nav a[href="/notifications"] .visually-hidden')?.textContent,
    ).toContain('1 unread notifications');
  });

  it('clears both badges as part of signing out', async () => {
    const { host, clear, clearMessages } = await render({
      signedIn: true,
      client: true,
      unread: 4,
      unreadMessages: 2,
    });

    const signOut = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sign out',
    );
    signOut?.click();

    expect(clear).toHaveBeenCalled();
    expect(clearMessages).toHaveBeenCalled();
  });

  /**
   * Two counts, two badges. Summing an unread notification and an unread message would produce a
   * number nobody could explain or act on, so they stay apart in both shells.
   */
  it('keeps the message badge separate from the notification badge', async () => {
    const { host } = await render({
      signedIn: true,
      client: true,
      unread: 4,
      unreadMessages: 2,
    });

    expect(host.querySelector('a[href="/notifications"] .badge')?.textContent?.trim()).toBe('4');
    expect(host.querySelector('.client-tabs a[href="/messages"] .badge')?.textContent?.trim()).toBe(
      '2',
    );
  });

  /** The member shell's picker still shows the workspace the store is actually in. */
  it('shows the active workspace in the member picker even when it is not the first offered', async () => {
    const { host } = await render({
      signedIn: true,
      client: true,
      memberships: [ALPHA, MEMBERSHIP],
      selectedTenantId: 'tenant-1',
    });

    const picker = host.querySelector<HTMLSelectElement>('.workspace-picker select')!;
    expect(picker.value).toBe('tenant-1');
    expect(picker.options[picker.selectedIndex].textContent).toContain('TB Gym');
  });

  it('selects a workspace through the same path as the coach shell', async () => {
    const { fixture, host, select } = await render({
      signedIn: true,
      client: true,
      memberships: [ALPHA, MEMBERSHIP],
      selectedTenantId: 'tenant-1',
    });

    const picker = host.querySelector<HTMLSelectElement>('.workspace-picker select')!;
    picker.value = 'tenant-alpha';
    picker.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(select).toHaveBeenCalledWith('tenant-alpha');
  });
});
