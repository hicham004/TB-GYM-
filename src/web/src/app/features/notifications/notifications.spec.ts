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
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
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

/**
 * An instant a few seconds before now (each step is ten seconds), so day headings are about today
 * whatever day the test runs; the inbox orders by these, newest first.
 */
function moments(steps: number): string {
  return new Date(Date.now() - steps * 10_000).toISOString();
}

/** A notice whose own target is missing, so it opens nothing: the rows that are buttons, or nothing at all. */
function item(
  id: string,
  createdAtUtc: string,
  isRead = false,
  title = `Notification ${id}`,
): NotificationItem {
  return {
    id,
    kind: 'RenewalRequested',
    title,
    body: 'Open the client’s page to set up a renewal.',
    createdAtUtc,
    readAtUtc: isRead ? '2026-08-31T09:00:00.000Z' : null,
    isRead,
    clientProfileId: null,
    sessionId: null,
    workoutExecutionId: null,
    weekNumber: null,
  };
}

function page(total: number, unreadTotal: number, ...items: NotificationItem[]): NotificationPage {
  return { total, unreadTotal, items, hasMore: total > items.length };
}

interface Harness {
  host: HTMLElement;
  fixture: Awaited<ReturnType<typeof TestBed.createComponent<Notifications>>>;
  user: WritableSignal<CurrentUser | null>;
  membership: WritableSignal<TenantMembership | undefined>;
  list: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  markAll: ReturnType<typeof vi.fn>;
  unreadCount: ReturnType<typeof vi.fn>;
  store: NotificationStore;
}

interface ApiMocks {
  list: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  markAll: ReturnType<typeof vi.fn>;
  unreadCount: ReturnType<typeof vi.fn>;
}

/**
 * @param configure sets up the API replies for this test. Omitted, the inbox is empty and the badge
 * is zero, which is what the empty-state test wants.
 */
async function render(
  configure?: (api: ApiMocks) => void,
  start: TenantMembership = ALPHA,
): Promise<Harness> {
  const user = signal<CurrentUser | null>(USER);
  const membership = signal<TenantMembership | undefined>(start);
  const list = vi.fn(() => of(page(0, 0)));
  const markRead = vi.fn();
  const markAll = vi.fn(() => of(0));
  const unreadCount = vi.fn(() => of(0));
  configure?.({ list, markRead, markAll, unreadCount });

  await TestBed.configureTestingModule({
    imports: [Notifications],
    providers: [
      // Anywhere a notice leads resolves, so following one is a navigation and not an error.
      provideRouter([{ path: '**', children: [] }]),
      {
        provide: ApiClient,
        useValue: {
          listNotifications: list,
          markNotificationRead: markRead,
          markAllNotificationsRead: markAll,
          getUnreadNotificationCount: unreadCount,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: AuthStore, useValue: { user, loading: signal(false) } },
      {
        provide: TenantStore,
        useValue: {
          selectedMembership: membership,
          selectedTenantId: signal(start.tenantId),
          isOwner: signal(start.role === 'Owner'),
          isClient: signal(start.role === 'Client'),
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
    markAll,
    unreadCount,
    store: TestBed.inject(NotificationStore),
  };
}

/** The visible titles, newest first. */
function rowTitles(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.rows li .row-text strong')).map((title) =>
    (title.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

/** The row of the notice with this title. */
function row(host: HTMLElement, title: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('.rows li')).find(
    (li) => li.querySelector('.row-text strong')?.textContent?.trim() === title,
  );
  if (!found) throw new Error(`No notice titled "${title}".`);
  return found;
}

describe('Notifications', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('pages unread notices after a read without skipping the old boundary', async () => {
    const first = Array.from({ length: 25 }, (_, i) => item(`n${i + 1}`, moments(i)));
    const rest = Array.from({ length: 25 }, (_, i) => item(`n${i + 26}`, moments(i + 25)));
    const { fixture, host, list, markRead } = await render((api) => {
      api.list.mockReturnValue(of({ total: 50, unreadTotal: 50, items: first, hasMore: true }));
      api.markRead.mockReturnValue(of({ ...first[0], isRead: true }));
    });
    const component = fixture.componentInstance as unknown as {
      setFilter(v: string): void;
      markRead(n: NotificationItem): Promise<void>;
      loadMore(): Promise<void>;
      items(): NotificationItem[];
      hasMore(): boolean;
    };
    component.setFilter('unread');
    await settle(fixture);
    await component.markRead(first[0]);
    list.mockReturnValue(of({ total: 49, unreadTotal: 49, items: rest, hasMore: false }));
    await component.loadMore();
    await settle(fixture);
    expect(markRead).toHaveBeenCalled();
    expect(list).toHaveBeenLastCalledWith(0, 25, true, 'n25');
    expect(component.items().map((n) => n.id)).toEqual(
      [...first.slice(1), ...rest].map((n) => n.id),
    );
    expect(component.hasMore()).toBe(false);
    expect(host.textContent).toContain('Notification n26');
  });

  it('does not resurrect a read row from a pagination reply already in flight', async () => {
    const first = Array.from({ length: 25 }, (_, i) => item(`n${i + 1}`, moments(i)));
    const pending = new Subject<NotificationPage>();
    const { fixture, list } = await render((api) => {
      api.list.mockReturnValue(of({ total: 50, unreadTotal: 50, items: first, hasMore: true }));
      api.markRead.mockReturnValue(of({ ...first[0], isRead: true }));
    });
    const component = fixture.componentInstance as unknown as {
      setFilter(v: string): void;
      markRead(n: NotificationItem): Promise<void>;
      loadMore(): Promise<void>;
      items(): NotificationItem[];
      hasMore(): boolean;
    };
    component.setFilter('unread');
    await settle(fixture);
    list.mockReturnValue(pending);
    const loading = component.loadMore();
    await component.markRead(first[0]);
    pending.next({
      total: 49,
      unreadTotal: 49,
      items: [first[0], item('n26', moments(26))],
      hasMore: false,
    });
    pending.complete();
    await loading;
    expect(component.items().filter((n) => n.id === 'n1')).toHaveLength(0);
    expect(new Set(component.items().map((n) => n.id)).size).toBe(component.items().length);
    expect(component.hasMore()).toBe(false);
  });

  it('invites with an empty state that says what will arrive', async () => {
    const { host } = await render();

    expect(host.querySelector('app-empty-state')?.textContent).toContain('No notifications yet');
    expect(host.querySelector('app-empty-state')?.textContent).toContain('your coach');
    expect(host.querySelector('.rows')).toBeNull();
    // The live region exists from first render so a later message can be announced at all.
    expect(query(host, '[role="alert"]').textContent?.trim()).toBe('');
    // Nothing is unread, so there is nothing to mark.
    expect(host.textContent).not.toContain('Mark all as read');
  });

  it('says what a coach will be told when the inbox is empty', async () => {
    const { host } = await render(undefined, { ...ALPHA, role: 'Coach' });

    expect(host.querySelector('app-empty-state')?.textContent).toContain('a client leaves a note');
  });

  it('tells a coach that check-ins and messages waiting for them are on Today (R5.4c)', async () => {
    // "You're all caught up" here never means Today has nothing: check-ins and messages are not notices.
    const coach = await render(undefined, { ...ALPHA, role: 'Coach' });
    const pointer = query(coach.host, '.top .pointer');
    expect(pointer.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Check-ins and messages that need you are on Today.',
    );
    expect(query<HTMLAnchorElement>(pointer, 'a').getAttribute('href')).toBe('/');
    expect(coach.host.querySelector('.lede')?.textContent).toContain("You're all caught up.");
    TestBed.resetTestingModule();

    // A client's Today is their own day, not a queue: nothing is said there.
    const client = await render();
    expect(client.host.querySelector('.pointer')).toBeNull();
  });

  it('lists newest first under Today and says how many are unread', async () => {
    const { host } = await render(({ list, unreadCount }) => {
      unreadCount.mockReturnValue(of(2));
      list.mockReturnValue(
        of(
          page(
            3,
            2,
            item('n3', moments(0.1)),
            item('n2', moments(0.2), true),
            item('n1', moments(0.3)),
          ),
        ),
      );
    });

    expect(rowTitles(host)).toEqual(['Notification n3', 'Notification n2', 'Notification n1']);
    expect(query(host, '.day-title').textContent?.trim()).toBe('Today');
    expect(query(host, '.lede').textContent).toContain('2 unread');
    // No Refresh button: the list reads itself again when the tab comes back.
    expect(host.textContent).not.toContain('Refresh');
  });

  it('folds a day older than yesterday under its heading, saying what it holds (audit UIQ-21)', async () => {
    const daysAgo = (days: number, steps = 0) =>
      new Date(Date.now() - days * 86_400_000 - steps * 10_000).toISOString();
    const { host, fixture } = await render(({ list }) => {
      list.mockReturnValue(
        of(
          page(
            5,
            3,
            item('t1', moments(1), false, 'Today’s notice'),
            item('y1', daysAgo(1), true, 'Yesterday’s notice'),
            item('o1', daysAgo(3), false, 'Older unread notice'),
            item('o2', daysAgo(3, 1), true, 'Older read notice'),
            item('w1', daysAgo(10), false, 'Week-old notice'),
          ),
        ),
      );
    });

    // Today and Yesterday stand open, as plain headings; the older days are folded buttons.
    const headings = Array.from(host.querySelectorAll<HTMLElement>('.day-title'));
    expect(headings.slice(0, 2).map((heading) => heading.textContent?.trim())).toEqual([
      'Today',
      'Yesterday',
    ]);
    expect(headings.slice(0, 2).every((heading) => !heading.querySelector('button'))).toBe(true);
    const toggles = Array.from(host.querySelectorAll<HTMLButtonElement>('.day-toggle'));
    expect(toggles).toHaveLength(2);
    expect(toggles.map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual([
      'false',
      'false',
    ]);
    expect(toggles[0].querySelector('.day-count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      ', 2 notifications, 1 unread',
    );
    expect(toggles[1].querySelector('.day-count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      ', 1 notification, 1 unread',
    );
    const older = query<HTMLUListElement>(host, `#${toggles[0].getAttribute('aria-controls')}`);
    expect(older.hidden).toBe(true);
    expect(rowTitles(host)).toContain('Older unread notice');

    // Opening one day leaves the other folded; it folds again on a second tap.
    toggles[0].click();
    await settle(fixture);
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    expect(older.hidden).toBe(false);
    expect(toggles[1].getAttribute('aria-expanded')).toBe('false');
    toggles[0].click();
    await settle(fixture);
    expect(older.hidden).toBe(true);
  });

  it('folds nothing under Unread, which lists what is waiting', async () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const harness = await render(({ list, unreadCount }) => {
      unreadCount.mockReturnValue(of(2));
      list.mockImplementation((_skip: number, _take: number, unreadOnly: boolean) =>
        of(
          unreadOnly
            ? page(2, 2, item('t1', moments(1), false, 'Today’s notice'), item('o1', daysAgo(6)))
            : page(
                3,
                2,
                item('t1', moments(1), false, 'Today’s notice'),
                item('r1', daysAgo(3), true),
                item('o1', daysAgo(6)),
              ),
        ),
      );
    });
    expect(harness.host.querySelectorAll('.day-toggle')).toHaveLength(2);

    query<HTMLInputElement>(harness.host, 'input[type="radio"][value="unread"]').click();
    await settle(harness.fixture);

    expect(harness.host.querySelector('.day-toggle')).toBeNull();
    expect(
      Array.from(harness.host.querySelectorAll<HTMLUListElement>('.rows')).every(
        (rows) => !rows.hidden,
      ),
    ).toBe(true);
    expect(rowTitles(harness.host)).toEqual(['Today’s notice', 'Notification o1']);
  });

  it('opens the newest day listed even when it is older than yesterday', async () => {
    const { host } = await render(({ list }) => {
      list.mockReturnValue(
        of(page(1, 1, item('o1', new Date(Date.now() - 5 * 86_400_000).toISOString()))),
      );
    });

    expect(host.querySelector('.day-toggle')).toBeNull();
    expect(query<HTMLUListElement>(host, '.rows').hidden).toBe(false);
  });

  it('opens each notice where it leads, and offers a button for one with nowhere to go', async () => {
    const at = moments(0.5);
    const notices: NotificationItem[] = [
      {
        ...item('r1', at, false, 'Maya Rahman asked to renew'),
        kind: 'RenewalRequested',
        clientProfileId: 'client-maya',
      },
      {
        ...item('w1', at, false, 'Your coach updated week 3'),
        kind: 'WeeksChanged',
        weekNumber: 3,
      },
      {
        ...item('c1', at, false, 'Your coach left a note on Lower A'),
        kind: 'CoachWorkoutNote',
        workoutExecutionId: 'workout-1',
      },
      {
        ...item('k1', at, false, 'Maya Rahman left a note on Lower A'),
        kind: 'ClientWorkoutNote',
        clientProfileId: 'client-maya',
        sessionId: 'session-1',
      },
      { ...item('p1', at, false, 'Your coach set up a new program'), kind: 'ProgramAssigned' },
      { ...item('l1', at, false, 'Maya Rahman left your coaching space'), kind: 'ClientLeft' },
      { ...item('e1', at, false, 'Your plan has ended'), kind: 'EnrollmentExpired' },
      { ...item('d1', at, false, 'Your coach has changed'), kind: 'CoachDeparted' },
      { ...item('t1', at, false, 'A coach left your team'), kind: 'CoachResigned' },
      item('n1', at),
    ];
    const { host } = await render(({ list }) => {
      list.mockReturnValue(of(page(notices.length, notices.length, ...notices)));
    });

    const href = (title: string) => row(host, title).querySelector('a.row')?.getAttribute('href');
    expect(href('Maya Rahman asked to renew')).toBe('/clients/client-maya/service');
    expect(href('Your coach updated week 3')).toBe('/training/program?week=3');
    expect(href('Your coach left a note on Lower A')).toBe('/training/program?workout=workout-1');
    expect(href('Maya Rahman left a note on Lower A')).toBe(
      '/clients/client-maya/training?session=session-1',
    );
    expect(href('Your coach set up a new program')).toBe('/training/program');
    // Every plan and team notice leads somewhere (audit COACH-12): a coach's own clients when a client
    // left, the client's Today for their plan or their coach, Clients when a coach left the team.
    expect(href('Maya Rahman left your coaching space')).toBe('/clients');
    expect(href('Your plan has ended')).toBe('/');
    expect(href('Your coach has changed')).toBe('/');
    expect(href('A coach left your team')).toBe('/clients');
    expect(row(host, 'Notification n1').querySelector('button.row')?.textContent).toContain(
      'mark as read',
    );
  });

  it('opens a former client notice on the owner’s Former clients list', async () => {
    const { host } = await render(
      ({ list }) => {
        list.mockReturnValue(
          of(
            page(1, 1, {
              ...item('l1', moments(1), false, 'Maya Rahman left your coaching space'),
              kind: 'ClientLeft',
            }),
          ),
        );
      },
      { ...ALPHA, role: 'Owner' },
    );

    expect(query(host, 'a.row').getAttribute('href')).toBe('/clients/former');
  });

  it('marks a linked notice read as it is opened', async () => {
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValue(of(1));
      const notice: NotificationItem = {
        ...item('p1', moments(1), false, 'Your coach set up a new program'),
        kind: 'ProgramAssigned',
      };
      list.mockReturnValue(of(page(1, 1, notice)));
      markRead.mockReturnValue(of({ ...notice, isRead: true }));
    });

    query<HTMLAnchorElement>(harness.host, 'a.row').click();
    await settle(harness.fixture);

    expect(harness.markRead).toHaveBeenCalledWith('p1');
    expect(harness.store.unread()).toBe(0);
  });

  it('marks a notice read even when following its link destroys the inbox first (WEB-2)', async () => {
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValue(of(1));
      const notice: NotificationItem = {
        ...item('p1', moments(1), false, 'Your coach set up a new program'),
        kind: 'ProgramAssigned',
      };
      list.mockReturnValue(of(page(1, 1, notice)));
      markRead.mockReturnValue(of({ ...notice, isRead: true }));
    });
    // The antiforgery token takes a while, as it does on a phone; the link's page is cached.
    let tokenArrives!: () => void;
    const csrf = TestBed.inject(CsrfService) as unknown as { refresh: ReturnType<typeof vi.fn> };
    csrf.refresh.mockReturnValueOnce(new Promise<void>((resolve) => (tokenArrives = resolve)));

    query<HTMLAnchorElement>(harness.host, 'a.row').click();
    harness.fixture.destroy();
    tokenArrives();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The inbox is gone, but the write was never the inbox's.
    expect(harness.markRead).toHaveBeenCalledWith('p1');
    expect(harness.store.unread()).toBe(0);
  });

  it('distinguishes read from unread without relying on colour', async () => {
    const { host } = await render(({ list }) => {
      list.mockReturnValue(
        of(page(2, 1, item('n2', moments(0.1)), item('n1', moments(0.2), true))),
      );
    });

    const unread = row(host, 'Notification n2');
    const read = row(host, 'Notification n1');
    expect(unread.classList.contains('unread')).toBe(true);
    expect(unread.textContent).toContain(', unread');
    expect(read.classList.contains('unread')).toBe(false);
    expect(read.textContent).not.toContain('unread');
    // A read notice with nowhere to go is not a control at all.
    expect(read.querySelector('button, a')).toBeNull();
  });

  it('shows only unread notices when asked, from the server', async () => {
    const harness = await render(({ list, unreadCount }) => {
      unreadCount.mockReturnValue(of(1));
      list
        .mockReturnValueOnce(of(page(2, 1, item('n2', moments(0.1)), item('n1', moments(1), true))))
        .mockReturnValueOnce(of(page(1, 1, item('n2', moments(0.1)))));
    });

    query<HTMLInputElement>(harness.host, 'input[type="radio"][value="unread"]').click();
    await settle(harness.fixture);

    expect(harness.list).toHaveBeenLastCalledWith(0, 25, true);
    expect(rowTitles(harness.host)).toEqual(['Notification n2']);
  });

  it('says all is caught up under Unread and offers the rest', async () => {
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(of(page(1, 0, item('n1', moments(1), true))))
        .mockReturnValue(of(page(0, 0)));
    });

    query<HTMLInputElement>(harness.host, 'input[type="radio"][value="unread"]').click();
    await settle(harness.fixture);
    expect(harness.host.querySelector('app-empty-state')?.textContent).toContain(
      "You're all caught up",
    );

    button(harness.host, 'Show all').click();
    await settle(harness.fixture);
    expect(harness.list).toHaveBeenLastCalledWith(0, 25, false);
  });

  it('marks everything read in one go and clears the badge', async () => {
    const harness = await render(({ list, unreadCount, markAll }) => {
      unreadCount.mockReturnValue(of(2));
      list.mockReturnValue(
        of(
          page(
            3,
            2,
            item('n3', moments(0.1)),
            item('n2', moments(0.2)),
            item('n1', moments(0.3), true),
          ),
        ),
      );
      markAll.mockReturnValue(of(0));
    });
    expect(harness.store.unread()).toBe(2);

    button(harness.host, 'Mark all as read').click();
    await settle(harness.fixture);

    expect(harness.markAll).toHaveBeenCalledTimes(1);
    expect(harness.host.querySelectorAll('.rows li.unread')).toHaveLength(0);
    expect(harness.store.unread()).toBe(0);
    expect(harness.host.textContent).not.toContain('Mark all as read');
    expect(query(harness.host, '.lede').textContent).toContain('all caught up');
  });

  it('keeps notices unread and says so when marking all fails', async () => {
    const harness = await render(({ list, unreadCount, markAll }) => {
      unreadCount.mockReturnValue(of(1));
      list.mockReturnValue(of(page(1, 1, item('n1', moments(0.1)))));
      markAll.mockReturnValue(throwError(() => new Error('offline')));
    });

    button(harness.host, 'Mark all as read').click();
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.rows li.unread')).toHaveLength(1);
    expect(harness.store.unread()).toBe(1);
    expect(query(harness.host, '[role="alert"]').textContent).toContain('could not be marked');
  });

  it('reads the first page again when the tab comes back into view', async () => {
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(of(page(1, 1, item('n1', moments(1)))))
        .mockReturnValueOnce(of(page(2, 2, item('n2', moments(0.1)), item('n1', moments(1)))));
    });

    document.dispatchEvent(new Event('visibilitychange'));
    await settle(harness.fixture);

    expect(rowTitles(harness.host)).toEqual(['Notification n2', 'Notification n1']);
  });

  it('loads earlier notices without repeating an identifier already on screen', async () => {
    const first = page(3, 3, item('n3', moments(0.1)), item('n2', moments(0.2)));
    // The second page overlaps, as it would if something were delivered between the two requests.
    const second = {
      ...page(3, 3, item('n2', moments(0.2)), item('n1', moments(0.3))),
      hasMore: false,
    };
    const harness = await render(({ list }) => {
      list.mockReturnValueOnce(of(first)).mockReturnValueOnce(of(second));
    });

    button(harness.host, 'Show earlier notifications').click();
    await settle(harness.fixture);

    expect(rowTitles(harness.host)).toEqual([
      'Notification n3',
      'Notification n2',
      'Notification n1',
    ]);
    expect(harness.list).toHaveBeenLastCalledWith(0, 25, false, 'n2');
    // Everything is loaded, so the control is gone rather than left offering nothing.
    expect(harness.host.textContent).not.toContain('Show earlier notifications');
  });

  it('advances the cursor despite an overlapping reply and stops on the server boundary', async () => {
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(of(page(4, 4, item('n3', moments(0.1)), item('n2', moments(0.2)))))
        // A new n4 was inserted ahead of the first page. Offset 2 now overlaps on n2, but both
        // returned rows still consume server positions 2 and 3.
        .mockReturnValueOnce(of(page(5, 5, item('n2', moments(0.2)), item('n1', moments(0.3)))))
        .mockReturnValueOnce(of({ ...page(5, 5, item('n0', moments(0.4))), hasMore: false }));
    });

    button(harness.host, 'Show earlier notifications').click();
    await settle(harness.fixture);
    button(harness.host, 'Show earlier notifications').click();
    await settle(harness.fixture);

    expect(harness.list.mock.calls).toEqual([
      [0, 25, false],
      [0, 25, false, 'n2'],
      [0, 25, false, 'n1'],
    ]);
    const titles = rowTitles(harness.host);
    expect(titles).toEqual([
      'Notification n3',
      'Notification n2',
      'Notification n1',
      'Notification n0',
    ]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('marks a notice read and decrements the badge', async () => {
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValue(of(2));
      list.mockReturnValue(of(page(2, 2, item('n2', moments(0.1)), item('n1', moments(0.2)))));
      markRead.mockReturnValue(of(item('n2', moments(0.1), true)));
    });
    expect(harness.store.unread()).toBe(2);

    query<HTMLButtonElement>(row(harness.host, 'Notification n2'), 'button.row').click();
    await settle(harness.fixture);

    expect(harness.markRead).toHaveBeenCalledWith('n2');
    expect(row(harness.host, 'Notification n2').classList.contains('unread')).toBe(false);
    expect(harness.store.unread()).toBe(1);
  });

  it('keeps a notice unread when marking it read fails', async () => {
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValue(of(1));
      list.mockReturnValue(of(page(1, 1, item('n1', moments(0.1)))));
      markRead.mockReturnValue(throwError(() => new Error('offline')));
    });

    query<HTMLButtonElement>(harness.host, 'button.row').click();
    await settle(harness.fixture);

    const notice = row(harness.host, 'Notification n1');
    expect(notice.classList.contains('unread')).toBe(true);
    expect(notice.textContent).toContain(', unread');
    expect(harness.store.unread()).toBe(1);
    expect(query(harness.host, '[role="alert"]').textContent).toContain('could not be marked');
  });

  it('reports a failed load in its live region and shows no rows', async () => {
    const { host } = await render(({ list }) => {
      list.mockReturnValue(throwError(() => new Error('offline')));
    });

    expect(query(host, '[role="alert"]').textContent).toContain('could not be loaded');
    expect(host.querySelectorAll('.rows li')).toHaveLength(0);
  });

  it('clears the inbox and the badge when the workspace changes', async () => {
    const harness = await render(({ list, unreadCount }) => {
      unreadCount.mockReturnValueOnce(of(3)).mockReturnValue(of(0));
      list
        .mockReturnValueOnce(of(page(1, 1, item('alpha', moments(0.1), false, 'Alpha notice'))))
        .mockReturnValue(of(page(0, 0)));
    });
    expect(rowTitles(harness.host)).toEqual(['Alpha notice']);

    harness.membership.set(BETA);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.rows li')).toHaveLength(0);
    expect(harness.host.querySelector('app-empty-state')).not.toBeNull();
    expect(harness.store.unread()).toBe(0);
  });

  it('clears the inbox when the signed-in account changes', async () => {
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(of(page(1, 1, item('mine', moments(0.1), false, 'Mine'))))
        .mockReturnValue(of(page(0, 0)));
    });
    expect(rowTitles(harness.host)).toEqual(['Mine']);

    harness.user.set(OTHER_USER);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.rows li')).toHaveLength(0);
  });

  it('clears the inbox on sign-out and asks for nothing more', async () => {
    const harness = await render(({ list }) => {
      list.mockReturnValue(of(page(1, 1, item('mine', moments(0.1), false, 'Mine'))));
    });
    const callsBefore = harness.list.mock.calls.length;

    harness.user.set(null);
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.rows li')).toHaveLength(0);
    expect(harness.list.mock.calls.length).toBe(callsBefore);
  });

  /**
   * The defect these exist for: a reply for the workspace the user has just left arriving after the
   * current one and being written on top of it. Each resolves the two requests out of order.
   */
  it('discards a list that resolves after the workspace has changed', async () => {
    const stale = new Subject<NotificationPage>();
    const fresh = new Subject<NotificationPage>();
    const harness = await render(({ list }) => {
      list.mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    });

    harness.membership.set(BETA);
    await settle(harness.fixture);

    fresh.next(page(1, 1, item('beta', moments(0.1), false, 'Beta notice')));
    fresh.complete();
    await settle(harness.fixture);
    expect(rowTitles(harness.host)).toEqual(['Beta notice']);

    stale.next(page(1, 1, item('alpha', moments(0.2), false, 'Alpha notice')));
    stale.complete();
    await settle(harness.fixture);

    expect(rowTitles(harness.host)).toEqual(['Beta notice']);
  });

  it('discards an earlier page that resolves after the workspace has changed', async () => {
    const more = new Subject<NotificationPage>();
    const harness = await render(({ list }) => {
      list
        .mockReturnValueOnce(of(page(2, 2, item('alpha', moments(0.1), false, 'Alpha notice'))))
        .mockReturnValueOnce(more)
        .mockReturnValue(of(page(0, 0)));
    });

    button(harness.host, 'Show earlier notifications').click();
    harness.membership.set(BETA);
    await settle(harness.fixture);

    more.next(page(2, 2, item('alpha-2', moments(0.2), false, 'Alpha second')));
    more.complete();
    await settle(harness.fixture);

    expect(harness.host.querySelectorAll('.rows li')).toHaveLength(0);
  });

  it('discards a mark-read success that resolves after the workspace has changed', async () => {
    const pending = new Subject<NotificationItem>();
    const harness = await render(({ list, markRead, unreadCount }) => {
      unreadCount.mockReturnValueOnce(of(1)).mockReturnValue(of(2));
      list
        .mockReturnValueOnce(of(page(1, 1, item('alpha', moments(0.1), false, 'Alpha notice'))))
        // The new workspace has two unread of its own, so a stale decrement would be visible.
        .mockReturnValue(of(page(1, 2, item('beta', moments(0.05), false, 'Beta notice'))));
      markRead.mockReturnValue(pending);
    });

    query<HTMLButtonElement>(row(harness.host, 'Alpha notice'), 'button.row').click();
    // Settled first, so the request is genuinely in flight before the workspace moves.
    await settle(harness.fixture);
    expect(harness.markRead).toHaveBeenCalledWith('alpha');

    harness.membership.set(BETA);
    await settle(harness.fixture);
    expect(rowTitles(harness.host)).toEqual(['Beta notice']);
    expect(harness.store.unread()).toBe(2);

    pending.next(item('alpha', moments(0.1), true, 'Alpha notice'));
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
        .mockReturnValueOnce(of(page(1, 1, item('alpha', moments(0.1), false, 'Alpha notice'))))
        .mockReturnValue(of(page(1, 1, item('beta', moments(0.05), false, 'Beta notice'))));
      markRead.mockReturnValue(pending);
    });

    query<HTMLButtonElement>(row(harness.host, 'Alpha notice'), 'button.row').click();
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
