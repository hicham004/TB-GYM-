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

async function render(
  options: {
    signedIn?: boolean;
    owner?: boolean;
    unread?: number;
    unreadMessages?: number;
  } = {},
) {
  const clear = vi.fn();
  const clearMessages = vi.fn();
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
          loading: signal(false),
          initialize: vi.fn().mockResolvedValue(undefined),
          logout: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: TenantStore,
        useValue: {
          memberships: signal(options.signedIn ? [MEMBERSHIP] : []),
          selectedTenantId: signal(options.signedIn ? 'tenant-1' : null),
          selectedMembership: signal(options.signedIn ? MEMBERSHIP : undefined),
          canCoach: signal(Boolean(options.owner)),
          isOwner: signal(Boolean(options.owner)),
          isClient: signal(false),
          select: vi.fn(),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, clear, clearMessages };
}

describe('App', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates the application shell', async () => {
    const { fixture, host } = await render();

    expect(fixture.componentInstance).toBeTruthy();
    expect(host.querySelector('.brand')?.textContent).toContain('TB Gym');
  });

  /**
   * The owner navigation carries a "Workspace" link to the settings page, and the session controls
   * carry a workspace picker. Both captions read "Workspace", so an owner saw the word twice side
   * by side in the topbar with no way to tell which was which.
   */
  it('names the workspace picker apart from the workspace nav link', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    expect(host.querySelector('nav a[href="/workspace"]')?.textContent?.trim()).toBe('Workspace');
    expect(host.querySelector('.workspace-picker span')?.textContent?.trim()).toBe(
      'Active workspace',
    );

    // No two captions in the topbar say the same thing.
    const captions = Array.from(
      host.querySelectorAll('.authenticated-nav nav a, .authenticated-nav .workspace-picker span'),
    ).map((element) => element.textContent?.trim());
    expect(new Set(captions).size).toBe(captions.length);
  });

  it('offers the picker every workspace the user belongs to', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>('.workspace-picker option'),
    );
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('TB Gym');
  });

  it('offers the notifications link to every active member', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    const link = host.querySelector('nav a[href="/notifications"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Notifications');
  });

  it('hides the notifications link when nobody is signed in', async () => {
    const { host } = await render();

    expect(host.querySelector('nav a[href="/notifications"]')).toBeNull();
  });

  it('shows no badge when nothing is unread', async () => {
    const { host } = await render({ signedIn: true, unread: 0 });

    expect(host.querySelector('nav a[href="/notifications"] .badge')).toBeNull();
    expect(host.querySelector('nav a[href="/notifications"]')?.textContent).not.toContain('unread');
  });

  it('announces one unread notification in words as well as in the badge', async () => {
    const { host } = await render({ signedIn: true, unread: 1 });

    expect(host.querySelector('nav a[href="/notifications"] .badge')?.textContent?.trim()).toBe(
      '1',
    );
    // The number alone would be announced as "Notifications 1" with no explanation of what 1 is.
    expect(
      host.querySelector('nav a[href="/notifications"] .visually-hidden')?.textContent,
    ).toContain('1 unread notifications');
  });

  it('shows a badge for many unread notifications', async () => {
    const { host } = await render({ signedIn: true, unread: 12 });

    expect(host.querySelector('nav a[href="/notifications"] .badge')?.textContent?.trim()).toBe(
      '12',
    );
  });

  it('clears the badge as part of signing out', async () => {
    const { host, clear, clearMessages } = await render({
      signedIn: true,
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

  it('offers the messages link to every active member', async () => {
    const { host } = await render({ signedIn: true, owner: true });

    const link = host.querySelector('nav a[href="/messages"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Messages');
  });

  it('hides the messages link when nobody is signed in', async () => {
    const { host } = await render();

    expect(host.querySelector('nav a[href="/messages"]')).toBeNull();
  });

  it('shows no message badge when nothing is unread', async () => {
    const { host } = await render({ signedIn: true, unreadMessages: 0 });

    expect(host.querySelector('nav a[href="/messages"] .badge')).toBeNull();
    expect(host.querySelector('nav a[href="/messages"]')?.textContent).not.toContain('unread');
  });

  it('announces one unread message in words as well as in the badge', async () => {
    const { host } = await render({ signedIn: true, unreadMessages: 1 });

    expect(host.querySelector('nav a[href="/messages"] .badge')?.textContent?.trim()).toBe('1');
    expect(host.querySelector('nav a[href="/messages"] .visually-hidden')?.textContent).toContain(
      '1 unread messages',
    );
  });

  it('shows a badge for many unread messages', async () => {
    const { host } = await render({ signedIn: true, unreadMessages: 9 });

    expect(host.querySelector('nav a[href="/messages"] .badge')?.textContent?.trim()).toBe('9');
  });

  /**
   * Two counts, two badges. Summing an unread notification and an unread message would produce a
   * number nobody could explain or act on, so the topbar keeps them apart.
   */
  it('keeps the message badge separate from the notification badge', async () => {
    const { host } = await render({ signedIn: true, unread: 4, unreadMessages: 2 });

    expect(host.querySelector('nav a[href="/notifications"] .badge')?.textContent?.trim()).toBe(
      '4',
    );
    expect(host.querySelector('nav a[href="/messages"] .badge')?.textContent?.trim()).toBe('2');
  });
});
