import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiClient } from '../api/api-client';
import type { CurrentUser, TenantMembership } from '../api/api.models';
import { AuthStore } from '../auth/auth.store';
import { TenantContext } from '../tenancy/tenant-context';
import { TenantStore } from '../tenancy/tenant.store';
import { MessageUnreadStore } from './message-unread.store';
import { MessagingRealtimeService } from './messaging-realtime.service';

const ALPHA_USER: CurrentUser = {
  id: 'user-alpha',
  email: 'alpha@example.test',
  displayName: 'Alpha',
  preferredCulture: 'en-LB',
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
  emailConfirmed: true,
  roles: [],
};

const BETA_USER: CurrentUser = { ...ALPHA_USER, id: 'user-beta', displayName: 'Beta' };

const ALPHA_TENANT: TenantMembership = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Gym',
  tenantSlug: 'alpha-gym',
  role: 'Coach',
};

const BETA_TENANT: TenantMembership = {
  tenantId: 'tenant-beta',
  tenantName: 'Beta Gym',
  tenantSlug: 'beta-gym',
  role: 'Client',
};

interface Harness {
  store: MessageUnreadStore;
  user: WritableSignal<CurrentUser | null>;
  membership: WritableSignal<TenantMembership | undefined>;
  /** The realtime connection's count of "the conversation list changed" invalidations. */
  refreshRequests: WritableSignal<number>;
  unreadCount: Mock<() => Observable<number>>;
}

/** A null `member` is someone with no membership in the selected workspace. */
function harness(
  user: CurrentUser | null = ALPHA_USER,
  member: TenantMembership | null = ALPHA_TENANT,
): Harness {
  const userState = signal<CurrentUser | null>(user);
  const membership = signal<TenantMembership | undefined>(member ?? undefined);
  const refreshRequests = signal(0);
  const unreadCount = vi.fn<() => Observable<number>>(() => of(0));

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: { getMessagingUnreadCount: unreadCount } },
      { provide: AuthStore, useValue: { user: userState, loading: signal(false) } },
      { provide: TenantStore, useValue: { selectedMembership: membership } },
      {
        provide: MessagingRealtimeService,
        useValue: { listRefreshRequests: refreshRequests.asReadonly() },
      },
    ],
  });

  return {
    store: TestBed.inject(MessageUnreadStore),
    user: userState,
    membership,
    refreshRequests,
    unreadCount,
  };
}

/** Effects are scheduled, then the read's promise resolves on a later turn. */
async function flush(): Promise<void> {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
}

describe('MessageUnreadStore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('reads how many messages wait for the member in their coaching space', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(3));

    await flush();

    expect(context.store.unread()).toBe(3);
    expect(context.store.isAvailable()).toBe(true);
    expect(context.unreadCount).toHaveBeenCalledTimes(1);
  });

  it('says it is loading while the count is out, and stops once it answers', async () => {
    const context = harness();
    const reply = new Subject<number>();
    context.unreadCount.mockReturnValue(reply);

    await flush();
    expect(context.store.loading()).toBe(true);

    reply.next(2);
    reply.complete();
    await flush();
    expect(context.store.loading()).toBe(false);
    expect(context.store.unread()).toBe(2);
  });

  it('asks nothing and offers no messaging without a membership', async () => {
    const context = harness(ALPHA_USER, null);

    await flush();

    expect(context.store.isAvailable()).toBe(false);
    expect(context.store.unread()).toBe(0);
    expect(context.unreadCount).not.toHaveBeenCalled();
  });

  it('asks nothing and offers no messaging to someone signed out', async () => {
    const context = harness(null, ALPHA_TENANT);

    await flush();

    expect(context.store.isAvailable()).toBe(false);
    expect(context.unreadCount).not.toHaveBeenCalled();

    // The workspace may still be selected after a sign-out: a realtime report or a screen still asks nothing.
    context.refreshRequests.set(1);
    await flush();
    await context.store.refresh();
    expect(context.unreadCount).not.toHaveBeenCalled();
  });

  it('clears the count before reading the new workspace’s, never showing the old one there', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(4));
    await flush();
    expect(context.store.unread()).toBe(4);

    const reply = new Subject<number>();
    context.unreadCount.mockReturnValue(reply);
    context.membership.set(BETA_TENANT);
    await flush();
    // The new workspace's count is still out: the badge says nothing rather than the old 4.
    expect(context.store.unread()).toBe(0);
    expect(context.unreadCount).toHaveBeenCalledTimes(2);

    reply.next(1);
    reply.complete();
    await flush();
    expect(context.store.unread()).toBe(1);
  });

  it('clears the count and reads again when another account signs in to the same workspace', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(6));
    await flush();

    const reply = new Subject<number>();
    context.unreadCount.mockReturnValue(reply);
    context.user.set(BETA_USER);
    await flush();
    // The workspace did not change, so only the account says the 6 was someone else's.
    expect(context.store.unread()).toBe(0);
    expect(context.unreadCount).toHaveBeenCalledTimes(2);

    reply.next(2);
    reply.complete();
    await flush();
    expect(context.store.unread()).toBe(2);
  });

  it('clears the count on sign-out and asks nothing more', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(5));
    await flush();

    context.user.set(null);
    await flush();

    expect(context.store.unread()).toBe(0);
    expect(context.store.isAvailable()).toBe(false);
    expect(context.unreadCount).toHaveBeenCalledTimes(1);
  });

  /** The defect this guards: a slow count for the workspace just left overwriting the new one. */
  it('discards a count that answers after the person has moved to another workspace', async () => {
    const context = harness();
    const stale = new Subject<number>();
    const fresh = new Subject<number>();
    context.unreadCount.mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    await flush();

    context.membership.set(BETA_TENANT);
    await flush();
    fresh.next(2);
    fresh.complete();
    await flush();
    expect(context.store.unread()).toBe(2);

    stale.next(99);
    stale.complete();
    await flush();
    expect(context.store.unread()).toBe(2);
  });

  it('reads the count again when the session is invalidated, clearing it first', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(4));
    await flush();

    const reply = new Subject<number>();
    context.unreadCount.mockReturnValue(reply);
    TestBed.inject(TenantContext).invalidate();
    expect(context.store.unread()).toBe(0);
    await flush();
    expect(context.unreadCount).toHaveBeenCalledTimes(2);

    reply.next(1);
    reply.complete();
    await flush();
    expect(context.store.unread()).toBe(1);
  });

  it('shows no badge, rather than the last number, when a read fails', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(4));
    await flush();

    context.unreadCount.mockReturnValue(throwError(() => new Error('offline')));
    await context.store.refresh();

    expect(context.store.unread()).toBe(0);
    expect(context.store.loading()).toBe(false);
  });

  it('reads the count once for each change the realtime connection reports', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(1));
    await flush();
    expect(context.unreadCount).toHaveBeenCalledTimes(1);

    context.unreadCount.mockReturnValue(of(2));
    context.refreshRequests.set(1);
    await flush();
    expect(context.store.unread()).toBe(2);
    expect(context.unreadCount).toHaveBeenCalledTimes(2);

    // A session invalidation reads the count once; the report already answered is not read again.
    TestBed.inject(TenantContext).invalidate();
    await flush();
    expect(context.unreadCount).toHaveBeenCalledTimes(3);

    context.unreadCount.mockReturnValue(of(5));
    context.refreshRequests.set(2);
    await flush();
    expect(context.store.unread()).toBe(5);
    expect(context.unreadCount).toHaveBeenCalledTimes(4);
  });

  it('reads nothing for a realtime report that comes while nobody is a member', async () => {
    const context = harness(ALPHA_USER, null);
    await flush();

    context.refreshRequests.set(1);
    await flush();

    expect(context.unreadCount).not.toHaveBeenCalled();
  });

  it('re-reads the count when a screen asks, and asks nothing without a member', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(1));
    await flush();

    context.unreadCount.mockReturnValue(of(7));
    await context.store.refresh();
    expect(context.store.unread()).toBe(7);

    context.membership.set(undefined);
    await flush();
    const asked = context.unreadCount.mock.calls.length;
    await context.store.refresh();
    expect(context.unreadCount.mock.calls.length).toBe(asked);
  });

  it('takes a total a screen has just read, never below zero', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(3));
    await flush();

    context.store.set(8);
    expect(context.store.unread()).toBe(8);

    context.store.set(-2);
    expect(context.store.unread()).toBe(0);
  });

  it('never shows a negative count the server sent', async () => {
    const context = harness();
    context.unreadCount.mockReturnValue(of(-4));

    await flush();

    expect(context.store.unread()).toBe(0);
  });

  it('empties the badge at once on clear, and drops a count still on its way', async () => {
    const context = harness();
    const reply = new Subject<number>();
    context.unreadCount.mockReturnValue(reply);
    await flush();
    expect(context.store.loading()).toBe(true);

    context.store.clear();
    expect(context.store.unread()).toBe(0);
    expect(context.store.loading()).toBe(false);

    reply.next(9);
    reply.complete();
    await flush();
    expect(context.store.unread()).toBe(0);
    expect(context.store.loading()).toBe(false);
  });
});
