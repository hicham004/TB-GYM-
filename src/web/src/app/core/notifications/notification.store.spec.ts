import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import type { CurrentUser, TenantMembership } from '../api/api.models';
import { AuthStore } from '../auth/auth.store';
import { TenantStore } from '../tenancy/tenant.store';
import { NotificationStore } from './notification.store';

const ALPHA_USER: CurrentUser = {
  id: 'user-alpha',
  email: 'alpha@example.test',
  displayName: 'Alpha',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const BETA_USER: CurrentUser = { ...ALPHA_USER, id: 'user-beta', displayName: 'Beta' };

const ALPHA_TENANT: TenantMembership = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Gym',
  tenantSlug: 'alpha-gym',
  role: 'Client',
};

const BETA_TENANT: TenantMembership = {
  tenantId: 'tenant-beta',
  tenantName: 'Beta Gym',
  tenantSlug: 'beta-gym',
  role: 'Client',
};

interface Harness {
  store: NotificationStore;
  user: WritableSignal<CurrentUser | null>;
  membership: WritableSignal<TenantMembership | undefined>;
  unreadCount: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const user = signal<CurrentUser | null>(ALPHA_USER);
  const membership = signal<TenantMembership | undefined>(ALPHA_TENANT);
  const unreadCount = vi.fn(() => of(0));

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: { getUnreadNotificationCount: unreadCount } },
      { provide: AuthStore, useValue: { user, loading: signal(false) } },
      {
        provide: TenantStore,
        useValue: {
          selectedMembership: membership,
          selectedTenantId: signal(ALPHA_TENANT.tenantId),
        },
      },
    ],
  });

  return { store: TestBed.inject(NotificationStore), user, membership, unreadCount };
}

/** Effects are scheduled, not synchronous, so the context effect needs a pass before it has run. */
function flush(): void {
  TestBed.tick();
}

describe('NotificationStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows no badge when nothing is unread', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(0));

    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(0);
    expect(context.store.isAvailable()).toBe(true);
  });

  it('shows a badge of one', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(1));

    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(1);
  });

  it('shows a badge of many', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(17));

    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(17);
  });

  it('clears the badge and re-reads it when the workspace changes', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(4));
    flush();
    await Promise.resolve();
    expect(context.store.unread()).toBe(4);

    context.unreadCount.mockReturnValue(of(2));
    context.membership.set(BETA_TENANT);
    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(2);
    expect(context.unreadCount).toHaveBeenCalledTimes(2);
  });

  it('clears the badge when the signed-in account changes', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(6));
    flush();
    await Promise.resolve();

    context.unreadCount.mockReturnValue(of(0));
    context.user.set(BETA_USER);
    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(0);
  });

  it('clears the badge when the membership disappears', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(3));
    flush();
    await Promise.resolve();
    expect(context.store.unread()).toBe(3);

    context.membership.set(undefined);
    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(0);
    expect(context.store.isAvailable()).toBe(false);
    // Nothing is requested for a workspace the user is no longer a member of.
    expect(context.unreadCount).toHaveBeenCalledTimes(1);
  });

  it('clears the badge on sign-out', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(5));
    flush();
    await Promise.resolve();

    context.user.set(null);
    flush();
    await Promise.resolve();

    expect(context.store.unread()).toBe(0);
    expect(context.store.isAvailable()).toBe(false);
  });

  /**
   * The defect this exists for: a slow count for the previous workspace answering after the current
   * one has already answered, and overwriting it. The two replies are resolved deliberately out of
   * order, oldest last.
   */
  it('discards an unread count that resolves after the workspace has changed', async () => {
    const context = harness();
    const stale = new Subject<number>();
    const fresh = new Subject<number>();
    context.unreadCount.mockReturnValueOnce(stale).mockReturnValueOnce(fresh);

    flush();
    await Promise.resolve();

    context.membership.set(BETA_TENANT);
    flush();
    await Promise.resolve();

    // The new workspace answers first.
    fresh.next(2);
    fresh.complete();
    await Promise.resolve();
    expect(context.store.unread()).toBe(2);

    // The old workspace answers last, and must not be written.
    stale.next(99);
    stale.complete();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.store.unread()).toBe(2);
  });

  it('reports a failed count as no badge rather than as an error', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(throwError(() => new Error('offline')));

    flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.store.unread()).toBe(0);
  });

  it('decrements without going below zero and never shows a negative badge', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(1));
    flush();
    await Promise.resolve();

    context.store.decrement();
    expect(context.store.unread()).toBe(0);

    context.store.decrement();
    expect(context.store.unread()).toBe(0);
  });
});
