import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { ApiClient } from '../core/api/api-client';
import { AuthStore } from '../core/auth/auth.store';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { MESSAGING_HUB_CONNECTION } from '../core/messaging/messaging-realtime.service';
import { NotificationStore } from '../core/notifications/notification.store';
import { CsrfService } from '../core/security/csrf.service';
import { TenantStore } from '../core/tenancy/tenant.store';
import { settle } from '../../testing/dom';
import { installDialogSupport } from '../../testing/dialog';

const USER = {
  id: 'user-1',
  email: 'hicham@example.test',
  displayName: 'Hicham Haddad',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const ATLAS = {
  tenantId: 'tenant-atlas',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas',
  role: 'Owner',
};

const BEIRUT = {
  tenantId: 'tenant-beirut',
  tenantName: 'Beirut Barbell',
  tenantSlug: 'beirut',
  role: 'Owner',
};

/** A hub connection that never connects, so nothing here depends on the realtime channel. */
const idleConnection = {
  state: 'Disconnected',
  on: vi.fn(),
  off: vi.fn(),
  onreconnecting: vi.fn(),
  onreconnected: vi.fn(),
  onclose: vi.fn(),
  start: vi.fn(() => new Promise<void>(() => undefined)),
  stop: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(true),
};

let uninstallDialog: () => void;

async function render(notificationCounts: { atlas: Subject<number>; beirut: Subject<number> }) {
  const api = {
    getCsrfToken: vi.fn(() => of({ token: 'csrf' })),
    getCurrentUser: vi.fn(() => of(USER)),
    getTenants: vi.fn(() => of([ATLAS, BEIRUT])),
    getUnreadNotificationCount: vi.fn(() => notificationCounts.atlas),
    getMessagingUnreadCount: vi.fn(() => of(0)),
    logout: vi.fn(() => of(undefined)),
  };
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: MESSAGING_HUB_CONNECTION, useValue: () => idleConnection },
    ],
  });

  const fixture = TestBed.createComponent(App);
  await settle(fixture);
  await TestBed.inject(AuthStore).initialize();
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api,
    tenants: TestBed.inject(TenantStore),
    notifications: TestBed.inject(NotificationStore),
    messages: TestBed.inject(MessageUnreadStore),
    router: TestBed.inject(Router),
  };
}

/**
 * The shell with the real session, tenant and badge stores behind it. What is under test is the
 * thing a stubbed store cannot show: that switching workspace from the shell's own control
 * invalidates the tenant context, so a reply for the workspace that was left is discarded instead
 * of painting the new one.
 */
describe('coach shell tenancy', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
    localStorage.clear();
  });

  it('switches workspace from the shell and drops the previous workspace’s reply', async () => {
    const atlas = new Subject<number>();
    const beirut = new Subject<number>();
    const { fixture, host, api, tenants } = await render({ atlas, beirut });

    expect(tenants.selectedTenantId()).toBe('tenant-atlas');
    expect(host.querySelector('app-coach-shell')).not.toBeNull();

    api.getUnreadNotificationCount.mockReturnValue(beirut);
    host.querySelector<HTMLButtonElement>('.workspace-button')!.click();
    await settle(fixture);
    const options = host.querySelectorAll<HTMLButtonElement>('#workspace-menu .menu-item');
    options[1].click();
    await settle(fixture);

    expect(tenants.selectedTenantId()).toBe('tenant-beirut');
    // The workspace that was left answers late, and its count never lands.
    atlas.next(9);
    await settle(fixture);
    expect(host.querySelector('.notifications-link .count')).toBeNull();

    beirut.next(2);
    await settle(fixture);
    expect(host.querySelector('.notifications-link .count')?.textContent?.trim()).toBe('2');
  });

  it('sends the user back to the overview of the workspace they switched to', async () => {
    const { fixture, host, router } = await render({
      atlas: new Subject<number>(),
      beirut: new Subject<number>(),
    });
    await router.navigateByUrl('/clients');
    await settle(fixture);

    host.querySelector<HTMLButtonElement>('.workspace-button')!.click();
    await settle(fixture);
    host.querySelectorAll<HTMLButtonElement>('#workspace-menu .menu-item')[1].click();
    await settle(fixture);

    expect(router.url).toBe('/');
  });

  it('clears both counts and signs out through the account menu', async () => {
    const atlas = new Subject<number>();
    const { fixture, host, api, notifications } = await render({
      atlas,
      beirut: new Subject<number>(),
    });
    atlas.next(4);
    await settle(fixture);
    expect(notifications.unread()).toBe(4);

    host.querySelector<HTMLButtonElement>('.account-button')!.click();
    await settle(fixture);
    const signOut = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Sign out',
    )!;
    signOut.click();
    await settle(fixture);

    expect(notifications.unread()).toBe(0);
    expect(api.logout).toHaveBeenCalled();
    // Signed out, the coach shell is gone and no app chrome is left for the sign-in page to sit in.
    expect(host.querySelector('app-coach-shell')).toBeNull();
    expect(host.querySelector('header.topbar')).toBeNull();
  });
});
