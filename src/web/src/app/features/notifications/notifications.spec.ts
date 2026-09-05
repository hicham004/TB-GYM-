import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, query, settle } from '../../../testing/dom';
import type { NotificationItem, NotificationPage } from './notification.models';
import { Notifications } from './notifications';

const USER: CurrentUser = {
  id: 'user-1',
  email: 'client@example.test',
  displayName: 'Client One',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const OTHER_USER: CurrentUser = { ...USER, id: 'user-2', displayName: 'Client Two' };

const ALPHA: TenantMembership = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Gym',
  tenantSlug: 'alpha-gym',
  role: 'Client',
};

const BETA: TenantMembership = {
  tenantId: 'tenant-beta',
  tenantName: 'Beta Gym',
  tenantSlug: 'beta-gym',
  role: 'Client',
};

function item(
  id: string,
  createdAtUtc: string,
  isRead = false,
  title = `Notification ${id}`,
): NotificationItem {
  return {
    id,
    kind: 'PaymentRequired',
    title,
    body: 'Open your workspace for the details.',
    createdAtUtc,
    readAtUtc: isRead ? '2026-08-31T09:00:00.000Z' : null,
    isRead,
  };
}

function page(total: number, unreadTotal: number, ...items: NotificationItem[]): NotificationPage {
  return { total, unreadTotal, items };
}

interface Harness {
  host: HTMLElement;
  fixture: Awaited<ReturnType<typeof TestBed.createComponent<Notifications>>>;
  user: WritableSignal<CurrentUser | null>;
  membership: WritableSignal<TenantMembership | undefined>;
  list: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  unreadCount: ReturnType<typeof vi.fn>;
  store: NotificationStore;
}

interface ApiMocks {
  list: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  unreadCount: ReturnType<typeof vi.fn>;
}

/**
 * @param configure sets up the API replies for this test. Omitted, the inbox is empty and the badge
 * is zero, which is what the empty-state test wants.
 */
async function render(configure?: (api: ApiMocks) => void): Promise<Harness> {
  const user = signal<CurrentUser | null>(USER);
  const membership = signal<TenantMembership | undefined>(ALPHA);
  const list = vi.fn(() => of(page(0, 0)));
  const markRead = vi.fn();
  const unreadCount = vi.fn(() => of(0));
  configure?.({ list, markRead, unreadCount });

  await TestBed.configureTestingModule({
    imports: [Notifications],
    providers: [
      // The inbox links to the settings screen, so RouterLink needs a router to resolve against.
      provideRouter([]),
      {
        provide: ApiClient,
        useValue: {
          listNotifications: list,
          markNotificationRead: markRead,
          getUnreadNotificationCount: unreadCount,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: AuthStore, useValue: { user, loading: signal(false) } },
      {
        provide: TenantStore,
        useValue: {
          selectedMembership: membership,
          selectedTenantId: signal(ALPHA.tenantId),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Notifications);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    user,
    membership,
    list,
    markRead,
    unreadCount,
    store: TestBed.inject(NotificationStore),
  };
}

/** The visible titles, with the read/unread marker that shares the heading removed. */
function rowTitles(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.feed li h3')).map((heading) => {
    const clone = heading.cloneNode(true) as HTMLElement;
    clone.querySelector('.state')?.remove();
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

describe('Notifications', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders an accessible empty state when the inbox is empty', async () => {
    const { host } = await render();

    expect(host.querySelector('.empty')?.textContent).toContain('no notifications');
    expect(host.querySelector('.feed')).toBeNull();
    // The live region exists from first render so a later message can be announced at all, and it
    // says nothing until something has happened.
    expect(query(host, '[role="alert"]').textContent?.trim()).toBe('');
  });

  it('renders the inbox newest first with its loaded and total counts', async () => {
    const { host } = await render(({ list }) => {
      list.mockReturnValue(
        of(
          page(
            5,
            2,
            item('n3', '2026-08-31T12:00:00.000Z'),
            item('n2', '2026-08-31T11:00:00.000Z', true),
            item('n1', '2026-08-31T10:00:00.000Z'),
          ),
        ),
      );
    });

    expect(rowTitles(host)).toEqual(['Notification n3', 'Notification n2', 'Notification n1']);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Showing 3 of 5');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('2 unread');
  });

  it('distinguishes read from unread without relying on colour', async () => {
    const { host } = await render(({ list }) => {
      list.mockReturnValue(
        of(
          page(
            2,
            1,
            item('n2', '2026-08-31T12:00:00.000Z'),
            item('n1', '2026-08-31T11:00:00.000Z', true),
          ),
        ),
      );
    });

    const rows = Array.from(host.querySelectorAll('.feed li'));
    expect(rows[0].classList.contains('unread')).toBe(true);
    expect(rows[0].textContent).toContain('Unread');
    expect(rows[1].classList.contains('read')).toBe(true);
    expect(rows[1].textContent).toContain('Read');
    // Only the unread row offers the action, and it names which notification it acts on.
    const actions = Array.from(host.querySelectorAll('button[aria-label^="Mark as read"]'));
    expect(actions).toHaveLength(1);
    expect(actions[0].getAttribute('aria-label')).toBe('Mark as read: Notification n2');
  });

  it('loads more without repeating an identifier already on screen', async () => {
    const first = page(
      3,
      3,
      item('n3', '2026-08-31T12:00:00.000Z'),
      item('n2', '2026-08-31T11:00:00.000Z'),
    );
    // The second page overlaps, as it would if something were delivered between the two requests.
    const second = page(
      3,
      3,
      item('n2', '2026-08-31T11:00:00.000Z'),
      item('n1', '2026-08-31T10:00:00.000Z'),
    );
    const harness = await render(({ list }) => {
      list.mockReturnValueOnce(of(first)).mockReturnValueOnce(of(second));
    });

    button(harness.host, 'Load more notifications').click();
    await settle(harness.fixture);

    expect(rowTitles(harness.host)).toEqual([
      'Notification n3',
      'Notification n2',
      'Notification n1',
    ]);
    expect(harness.list).toHaveBeenLastCalledWith(2, 25);
    // Everything is loaded, so the control is gone rather than left offering nothing.
    expect(harness.host.querySelector('button.link:not([aria-label])')?.textContent).not.toContain(
      'Load more',
    );
  });

  it('advances by consumed server positions when an insertion makes pages overlap', async () => {
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(
          of(
            page(
              4,
              4,
              item('n3', '2026-08-31T12:00:00.000Z'),
              item('n2', '2026-08-31T11:00:00.000Z'),
            ),
          ),
        )
        // A new n4 was inserted ahead of the first page. Offset 2 now overlaps on n2, but both
        // returned rows still consume server positions 2 and 3.
        .mockReturnValueOnce(
          of(
            page(
              5,
              5,
              item('n2', '2026-08-31T11:00:00.000Z'),
              item('n1', '2026-08-31T10:00:00.000Z'),
            ),
          ),
        )
        .mockReturnValueOnce(of(page(5, 5, item('n0', '2026-08-31T09:00:00.000Z'))));
    });

    button(harness.host, 'Load more notifications').click();
    await settle(harness.fixture);
    button(harness.host, 'Load more notifications').click();
    await settle(harness.fixture);

    expect(harness.list.mock.calls).toEqual([
      [0, 25],
      [2, 25],
      [4, 25],
    ]);
    const titles = rowTitles(harness.host);
    expect(titles).toEqual([
      'Notification n3',
      'Notification n2',
      'Notification n1',
      'Notification n0',
    ]);
    expect(new Set(titles).size).toBe(titles.length);
    expect(harness.host.textContent).not.toContain('Load more notifications');
  });

  it('marks a notification read and decrements the badge', async () => {
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValue(of(2));
      list.mockReturnValue(
        of(
          page(
            2,
            2,
            item('n2', '2026-08-31T12:00:00.000Z'),
            item('n1', '2026-08-31T11:00:00.000Z'),
          ),
        ),
      );
      markRead.mockReturnValue(of(item('n2', '2026-08-31T12:00:00.000Z', true)));
    });
    expect(harness.store.unread()).toBe(2);

    query<HTMLButtonElement>(
      harness.host,
      'button[aria-label="Mark as read: Notification n2"]',
    ).click();
    await settle(harness.fixture);

    expect(harness.markRead).toHaveBeenCalledWith('n2');
    const rows = Array.from(harness.host.querySelectorAll('.feed li'));
    expect(rows[0].classList.contains('read')).toBe(true);
    expect(harness.store.unread()).toBe(1);
  });

  it('keeps a notification unread when marking it read fails', async () => {
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValue(of(1));
      list.mockReturnValue(of(page(1, 1, item('n1', '2026-08-31T12:00:00.000Z'))));
      markRead.mockReturnValue(throwError(() => new Error('offline')));
    });

    query<HTMLButtonElement>(
      harness.host,
      'button[aria-label="Mark as read: Notification n1"]',
    ).click();
    await settle(harness.fixture);

    const row = query(harness.host, '.feed li');
    expect(row.classList.contains('unread')).toBe(true);
    expect(row.textContent).toContain('Unread');
    expect(harness.store.unread()).toBe(1);
    expect(query(harness.host, '[role="alert"]').textContent).toContain('could not be marked');
  });

  it('reports a failed load in its live region and shows no rows', async () => {
    const { host } = await render(({ list }) => {
      list.mockReturnValue(throwError(() => new Error('offline')));
    });

    expect(query(host, '[role="alert"]').textContent).toContain('could not be loaded');
    expect(host.querySelectorAll('.feed li')).toHaveLength(0);
  });

  it('clears the inbox and the badge when the workspace changes', async () => {
    const harness = await render(({ list, unreadCount }) => {
      unreadCount.mockReturnValueOnce(of(3)).mockReturnValue(of(0));
      list
        .mockReturnValueOnce(
          of(page(1, 1, item('alpha', '2026-08-31T12:00:00.000Z', false, 'Alpha notice'))),
        )
        .mockReturnValue(of(page(0, 0)));
    });
    expect(rowTitles(harness.host)).toEqual(['Alpha notice']);

    harness.membership.set(BETA);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.feed li')).toHaveLength(0);
    expect(harness.host.querySelector('.empty')).not.toBeNull();
    expect(harness.store.unread()).toBe(0);
  });

  it('clears the inbox when the signed-in account changes', async () => {
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(
          of(page(1, 1, item('mine', '2026-08-31T12:00:00.000Z', false, 'Mine'))),
        )
        .mockReturnValue(of(page(0, 0)));
    });
    expect(rowTitles(harness.host)).toEqual(['Mine']);

    harness.user.set(OTHER_USER);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.feed li')).toHaveLength(0);
  });

  it('clears the inbox on sign-out and asks for nothing more', async () => {
    const harness = await render(({ list }) => {
      list.mockReturnValue(of(page(1, 1, item('mine', '2026-08-31T12:00:00.000Z', false, 'Mine'))));
    });
    const callsBefore = harness.list.mock.calls.length;

    harness.user.set(null);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.feed li')).toHaveLength(0);
    expect(harness.list.mock.calls.length).toBe(callsBefore);
  });

  /**
   * The defect these three exist for: a reply for the workspace the user has just left arriving
   * after the current one and being written on top of it. Each resolves the two requests
   * deliberately out of order, oldest last.
   */
  it('discards a list that resolves after the workspace has changed', async () => {
    const stale = new Subject<NotificationPage>();
    const fresh = new Subject<NotificationPage>();
    const harness = await render(({ list }) => {
      list.mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    });

    harness.membership.set(BETA);
    await settle(harness.fixture);

    fresh.next(page(1, 1, item('beta', '2026-08-31T12:00:00.000Z', false, 'Beta notice')));
    fresh.complete();
    await settle(harness.fixture);
    expect(rowTitles(harness.host)).toEqual(['Beta notice']);

    stale.next(page(1, 1, item('alpha', '2026-08-31T11:00:00.000Z', false, 'Alpha notice')));
    stale.complete();
    await settle(harness.fixture);

    expect(rowTitles(harness.host)).toEqual(['Beta notice']);
  });

  it('discards a Load More page that resolves after the workspace has changed', async () => {
    const more = new Subject<NotificationPage>();
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(
          of(page(2, 2, item('alpha', '2026-08-31T12:00:00.000Z', false, 'Alpha notice'))),
        )
        .mockReturnValueOnce(more)
        .mockReturnValue(of(page(0, 0)));
    });

    button(harness.host, 'Load more notifications').click();
    harness.membership.set(BETA);
    await settle(harness.fixture);

    more.next(page(2, 2, item('alpha-2', '2026-08-31T11:00:00.000Z', false, 'Alpha second')));
    more.complete();
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.feed li')).toHaveLength(0);
  });

  it('discards a mark-read success that resolves after the workspace has changed', async () => {
    const pending = new Subject<NotificationItem>();
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValueOnce(of(1)).mockReturnValue(of(2));
      list
        .mockReturnValueOnce(
          of(page(1, 1, item('alpha', '2026-08-31T12:00:00.000Z', false, 'Alpha notice'))),
        )
        // The new workspace has two unread of its own, so a stale decrement would be visible.
        .mockReturnValue(
          of(page(1, 2, item('beta', '2026-08-31T12:30:00.000Z', false, 'Beta notice'))),
        );
      markRead.mockReturnValue(pending);
    });

    query<HTMLButtonElement>(
      harness.host,
      'button[aria-label="Mark as read: Alpha notice"]',
    ).click();
    // Settled first, so the request is genuinely in flight before the workspace moves. Changing it
    // in the same turn would only exercise the check made before the call.
    await settle(harness.fixture);
    expect(harness.markRead).toHaveBeenCalledWith('alpha');

    harness.membership.set(BETA);
    await settle(harness.fixture);
    expect(rowTitles(harness.host)).toEqual(['Beta notice']);
    expect(harness.store.unread()).toBe(2);

    pending.next(item('alpha', '2026-08-31T12:00:00.000Z', true, 'Alpha notice'));
    pending.complete();
    await settle(harness.fixture);

    // The reply belongs to a workspace that is no longer on screen, so it changes nothing here.
    expect(rowTitles(harness.host)).toEqual(['Beta notice']);
    expect(harness.store.unread()).toBe(2);
  });

  it('discards a mark-read failure that resolves after the workspace has changed', async () => {
    const pending = new Subject<NotificationItem>();
    const harness = await render(({ list, markRead }) => {
      list
        .mockReturnValueOnce(
          of(page(1, 1, item('alpha', '2026-08-31T12:00:00.000Z', false, 'Alpha notice'))),
        )
        .mockReturnValue(
          of(page(1, 1, item('beta', '2026-08-31T12:30:00.000Z', false, 'Beta notice'))),
        );
      markRead.mockReturnValue(pending);
    });

    query<HTMLButtonElement>(
      harness.host,
      'button[aria-label="Mark as read: Alpha notice"]',
    ).click();
    await settle(harness.fixture);
    expect(harness.markRead).toHaveBeenCalledWith('alpha');

    harness.membership.set(BETA);
    await settle(harness.fixture);

    pending.error(new Error('offline'));
    await settle(harness.fixture);

    // The failure belonged to the previous workspace, so it must not be announced over this one.
    expect(query(harness.host, '[role="alert"]').textContent?.trim()).toBe('');
    expect(rowTitles(harness.host)).toEqual(['Beta notice']);
  });
});
