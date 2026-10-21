import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type { NotificationView } from '../src/app/core/api/generated';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  waitForFonts,
} from './support';

/**
 * Notifications (R5.1c) in a real browser, for a coach and a client: the inbox in days, days older than
 * yesterday folded under their heading (audit UIQ-21), the unread filter, Mark all as read, where each
 * notice leads (every plan and team notice too, audit COACH-12), and the rebuilt settings with its leave
 * warning. Every API call is a per-test mock; guards, interceptors and stores run unchanged.
 */
const ATLAS_CLIENT = {
  ...OWNER_MEMBERSHIP,
  tenantId: '00000000-0000-4000-8000-000000000003',
  role: 'Client',
};
const MAYA = {
  ...SIGNED_IN_USER,
  id: '00000000-0000-4000-8000-0000000000bb',
  email: 'maya@example.test',
  displayName: 'Maya Rahman',
};
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'];

type Handler = (route: Route) => Promise<void> | void;
type Notice = NotificationView;

/**
 * An instant on a day before today (0 is today) at a time that has already passed, on the browser's
 * calendar: the tests run it in UTC (playwright.config.ts).
 */
function at(daysAgo: number, hour: number, minute: number): string {
  const now = new Date();
  const when = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, hour, minute),
  );
  return (when > now ? new Date(now.getTime() - 60_000) : when).toISOString();
}

function notice(
  id: string,
  kind: Notice['kind'],
  title: string,
  body: string,
  createdAtUtc: string,
  isRead: boolean,
  extra: Partial<Notice> = {},
): Notice {
  return {
    id,
    kind,
    title,
    body,
    createdAtUtc,
    readAtUtc: isRead ? createdAtUtc : null,
    isRead,
    version: 1,
    clientProfileId: null,
    sessionId: null,
    workoutExecutionId: null,
    weekNumber: null,
    ...extra,
  };
}

function coachInbox(): Notice[] {
  return [
    notice(
      'c1',
      'ClientWorkoutNote',
      'Maya Rahman left a note on Lower A',
      "Open the workout on the client's Training to read it.",
      at(0, 9, 41),
      false,
      { clientProfileId: 'maya', sessionId: 'session-1', workoutExecutionId: 'workout-1' },
    ),
    notice(
      'c2',
      'RenewalRequested',
      'Karl Nassar asked to renew',
      "This client's coaching plan has ended. Open the client's page to set up a renewal.",
      at(0, 8, 5),
      false,
      { clientProfileId: 'karl' },
    ),
    notice(
      'c3',
      'ClientLeft',
      'Hadi Saleh left your coaching space',
      'Their record is kept, read-only, under Former clients.',
      at(1, 18, 20),
      true,
    ),
    notice(
      'c4',
      'ClientWorkoutNote',
      'Rami Tabet left a note on Upper B',
      "Open the workout on the client's Training to read it.",
      at(3, 7, 15),
      true,
      { clientProfileId: 'rami', sessionId: 'session-2', workoutExecutionId: 'workout-2' },
    ),
    notice(
      'c5',
      'CoachResigned',
      'A coach left your team',
      'Their clients and client invitations are yours now. You can reassign them from Clients.',
      at(12, 10, 0),
      true,
    ),
  ];
}

function clientInbox(): Notice[] {
  return [
    notice(
      'm1',
      'WeeksChanged',
      'Your coach updated week 4',
      'Open Training to see your workouts as they are now.',
      at(0, 9, 12),
      false,
      { weekNumber: 4 },
    ),
    notice(
      'm2',
      'CoachWorkoutNote',
      'Your coach left a note on Lower A',
      'Open the workout to read it.',
      at(0, 7, 55),
      false,
      { sessionId: 'session-3', workoutExecutionId: 'workout-3' },
    ),
    notice(
      'm3',
      'WeeksShared',
      'Your coach shared week 5',
      'Open Training to see the workouts.',
      at(1, 19, 30),
      true,
      { weekNumber: 5 },
    ),
    notice(
      'm4',
      'ProgramAssigned',
      'Your coach set up a new program',
      'Open Training to see your program and its first workouts.',
      at(5, 11, 0),
      true,
    ),
    notice(
      'm5',
      'EnrollmentEndingSoon',
      'Your plan ends soon',
      "If you'd like to keep going, ask your coach to renew it.",
      at(20, 9, 0),
      true,
    ),
  ];
}

/** An inbox the browser can read, filter, mark one of, and mark all of. */
function inboxHandlers(start: Notice[]): { handlers: Record<string, Handler>; reads: string[] } {
  let items = start;
  const reads: string[] = [];
  const unread = () => items.filter((item) => !item.isRead).length;
  const handlers: Record<string, Handler> = {
    'GET /api/notifications': (route) => {
      const onlyUnread = new URL(route.request().url()).searchParams.get('unread') === 'true';
      const listed = onlyUnread ? items.filter((item) => !item.isRead) : items;
      return json(route, 200, { total: listed.length, unreadTotal: unread(), items: listed });
    },
    'POST /api/notifications/read-all': (route) => {
      const marked = unread();
      items = items.map((item) => ({
        ...item,
        isRead: true,
        readAtUtc: item.readAtUtc ?? item.createdAtUtc,
      }));
      reads.push('all');
      return json(route, 200, { marked, unread: 0 });
    },
  };
  for (const item of start) {
    handlers[`POST /api/notifications/${item.id}/read`] = (route) => {
      items = items.map((each) =>
        each.id === item.id ? { ...each, isRead: true, readAtUtc: each.createdAtUtc } : each,
      );
      reads.push(item.id);
      return json(
        route,
        200,
        items.find((each) => each.id === item.id),
      );
    };
  }

  return { handlers, reads };
}

async function openInbox(page: Page, role: 'coach' | 'client', width: number, dark = false) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  const start = role === 'coach' ? coachInbox() : clientInbox();
  const inbox = inboxHandlers(start);
  await mockSession(page, {
    memberships: role === 'coach' ? [OWNER_MEMBERSHIP] : [ATLAS_CLIENT],
    user: role === 'coach' ? SIGNED_IN_USER : MAYA,
    unreadNotifications: start.filter((item) => !item.isRead).length,
    extra: {
      ...inbox.handlers,
      'GET /api/client-access/me': (route) =>
        json(
          route,
          200,
          FEATURES.map((feature) => ({ feature, isAllowed: true, reason: 'Granted' })),
        ),
    },
  });
  await page.goto('/notifications');
  await expect(
    page.getByRole('heading', { name: 'Notifications', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.rows li').first()).toBeVisible();
  await waitForFonts(page);
  return inbox;
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';

    test(`a coach's inbox sits in days at ${width}px, ${mode}, and passes axe`, async ({
      page,
    }) => {
      await openInbox(page, 'coach', width, dark);
      // Today and Yesterday stand open; an older day is folded under its heading, saying what it holds.
      await expect(page.locator('.day-title')).toHaveText([
        'Today',
        'Yesterday',
        /day, 1 notification$/,
        /\d.*, 1 notification$/,
      ]);
      await expect(page.locator('.day-toggle')).toHaveCount(2);
      await expect(page.getByRole('link', { name: /Rami Tabet left a note/ })).toBeHidden();
      await expect(page.locator('.lede')).toHaveText('2 unread');
      await expect(page.locator('.rows li.unread')).toHaveCount(2);
      // The client's note opens that client's Training at the session it is on.
      await expect(page.getByRole('link', { name: /Maya Rahman left a note/ })).toHaveAttribute(
        'href',
        '/clients/maya/training?session=session-1',
      );
      await expect(
        page.getByRole('link', { name: /Hadi Saleh left your coaching space/ }),
      ).toHaveAttribute('href', '/clients/former');
      // Opening a folded day shows its notices, and its coach notice leads to Clients.
      await page.locator('.day-toggle').last().click();
      await expect(page.locator('.day-toggle').last()).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('link', { name: /A coach left your team/ })).toHaveAttribute(
        'href',
        '/clients',
      );
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/r51c-coach-inbox-${width}-${mode}.png`,
        fullPage: true,
      });
    });

    test(`a client's inbox leads into Training at ${width}px, ${mode}, and passes axe`, async ({
      page,
    }) => {
      await openInbox(page, 'client', width, dark);
      await expect(page.getByRole('link', { name: /Your coach updated week 4/ })).toHaveAttribute(
        'href',
        '/training/program?week=4',
      );
      await expect(
        page.getByRole('link', { name: /Your coach left a note on Lower A/ }),
      ).toHaveAttribute('href', '/training/program?workout=workout-3');
      // A plan notice opens the client's Today, once its folded day is opened (audit COACH-12, UIQ-21).
      const ended = page.getByRole('link', { name: /Your plan ends soon/ });
      await expect(ended).toBeHidden();
      await page.locator('.day-toggle').last().click();
      await expect(ended).toHaveAttribute('href', '/');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/r51c-client-inbox-${width}-${mode}.png`,
        fullPage: true,
      });
    });
  }
}

test('Unread shows what is waiting, and Mark all as read clears it and the badge', async ({
  page,
}) => {
  const inbox = await openInbox(page, 'coach', 1440);
  const badge = page.locator('.notifications-link .count');
  await expect(badge).toHaveText('2');

  await page.getByRole('radio', { name: 'Unread' }).click();
  await expect(page.locator('.rows li')).toHaveCount(2);

  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('heading', { name: "You're all caught up" })).toBeVisible();
  await expect(badge).toHaveCount(0);
  expect(inbox.reads).toEqual(['all']);

  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.locator('.rows li')).toHaveCount(5);
  await expect(page.locator('.rows li.unread')).toHaveCount(0);
  await axe(page);
});

test('the inbox reflows at 200% text on a phone', async ({ page }) => {
  await openInbox(page, 'client', 390);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expectNoHorizontalOverflow(page);
});

async function openSettings(page: Page, width: number, dark = false) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  const saves: unknown[] = [];
  let preferences = {
    inAppEnabled: true,
    emailServiceEnabled: false,
    emailChannelAvailable: true,
    emailSuppressed: false,
    emailSuppressionReason: null,
    quietHoursEnabled: false,
    quietHoursStartLocal: null as string | null,
    quietHoursEndLocal: null as string | null,
    tenantTimeZoneId: 'Asia/Beirut',
    version: 3,
  };
  await mockSession(page, {
    memberships: [ATLAS_CLIENT],
    user: MAYA,
    extra: {
      ...inboxHandlers(clientInbox()).handlers,
      'GET /api/client-access/me': (route) =>
        json(
          route,
          200,
          FEATURES.map((feature) => ({ feature, isAllowed: true, reason: 'Granted' })),
        ),
      'GET /api/notifications/preferences': (route) => json(route, 200, preferences),
      'PUT /api/notifications/preferences': (route) => {
        const body = route.request().postDataJSON() as typeof preferences;
        saves.push(body);
        preferences = { ...preferences, ...body, version: preferences.version + 1 };
        return json(route, 200, preferences);
      },
    },
  });
  await page.goto('/notifications/settings');
  await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible();
  await expect(page.getByLabel('Email me about my coaching plan')).toBeVisible();
  await waitForFonts(page);
  return saves;
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    test(`settings show each channel in a card at ${width}px, ${mode}, and pass axe`, async ({
      page,
    }) => {
      await openSettings(page, width, dark);
      await page.getByLabel('Hold emails during quiet hours').check();
      await expect(page.getByLabel('From')).toHaveValue('22:00');
      await expect(page.getByLabel('Until')).toHaveValue('07:00');
      await expect(page.locator('#quietHoursZone')).toContainText('Asia/Beirut');
      await expectNoHorizontalOverflow(page);
      await axe(page);
      await page.screenshot({
        path: `test-results/r51c-settings-${width}-${mode}.png`,
        fullPage: true,
      });
    });
  }
}

test('settings reflow at 200% text on a phone, quiet hours and all', async ({ page }) => {
  await openSettings(page, 390);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.getByLabel('Hold emails during quiet hours').check();
  await expect(page.getByLabel('From')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('settings ask before unsaved changes are left, and save them', async ({ page }) => {
  const saves = await openSettings(page, 1440);
  await page.getByLabel('Email me about my coaching plan').check();

  await page.locator('a.back').click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toBeVisible();
  await axe(page);
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/\/notifications\/settings$/);

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Your notification settings were saved.')).toBeVisible();
  expect(saves).toEqual([expect.objectContaining({ emailServiceEnabled: true, version: 3 })]);

  // Saved, so leaving asks nothing.
  await page.locator('a.back').click();
  await expect(
    page.getByRole('heading', { name: 'Notifications', exact: true, level: 1 }),
  ).toBeVisible();
});
