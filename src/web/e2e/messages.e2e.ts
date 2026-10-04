import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { profileOverview } from '../src/testing/client-profile-fixtures';
import { MAYA } from '../src/testing/coach-today-fixtures';
import {
  COACH_MEMBERSHIP,
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

// R2.5a: the chat (M7), for a client with one coach and for a coach with an inbox (C6 reuses it).
// Lines and names are the Atlas demo's (DemoWorkspaceCast), on a fixed clock so day names hold.
const NOW = new Date('2026-09-30T18:30:00Z');
const TENANT = '00000000-0000-4000-8000-000000000003';
const MAYA_ID = '00000000-0000-4000-8000-0000000000bb';
const LEA_ID = '00000000-0000-4000-8000-0000000000cc';
const THREAD = '00000000-0000-4000-8000-00000000c001';

type Line = [sentAtUtc: string, fromLea: boolean, body: string];
const MAYA_THREAD: Line[] = [
  [
    '2026-09-09T18:00:00Z',
    true,
    "Phase 2 starts tomorrow: heavier squats, fewer reps. You've earned it.",
  ],
  ['2026-09-09T21:30:00Z', false, "New squat PR today!! Never thought I'd enjoy leg day"],
  ['2026-09-09T21:45:00Z', true, 'Proud of you 👏 Clean reps, too.'],
  ['2026-09-27T20:10:00Z', false, "Dress fitting on Saturday… it's already a bit loose 🙈"],
  [
    '2026-09-27T20:40:00Z',
    true,
    "Love that! Keep protein high this week and don't skip your steps.",
  ],
  [
    '2026-09-29T19:02:00Z',
    false,
    'Quick one: can I swap the split squats for lunges? The gym is packed',
  ],
  ['2026-09-29T19:03:00Z', false, 'Same sets and reps'],
  [
    '2026-09-29T19:20:00Z',
    true,
    'Yes, walking lunges, same sets and reps. Keep the last set close to failure.',
  ],
  [
    '2026-09-30T17:35:00Z',
    true,
    "Hi Maya! Lower A today. If last week's squats felt easy, add 2.5 kg on the last set.",
  ],
];

const person = (userId: string, displayName: string, role: string) => ({
  userId,
  displayName,
  role,
});
const LEA = person(LEA_ID, 'Lea Haddad', 'Coach');

function messageView(sequence: number, line: Line, callerIsLea: boolean, lastRead: number) {
  const [sentAtUtc, fromLea, body] = line;
  const isFromCaller = fromLea === callerIsLea;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    conversationId: THREAD,
    sequence,
    senderUserId: fromLea ? LEA_ID : MAYA_ID,
    isFromCaller,
    sentAtUtc,
    availableAtUtc: sentAtUtc,
    editedAtUtc: null,
    revisionNumber: 1,
    body,
    isDeleted: false,
    deletionKind: null,
    deletedAtUtc: null,
    canEdit: isFromCaller,
    canDelete: isFromCaller,
    canModerate: callerIsLea && !isFromCaller,
    isUnreadByCaller: !isFromCaller && sequence > lastRead,
    version: 1,
    deliveryState: 'Persisted',
  };
}

function summary(
  id: string,
  counterpart: ReturnType<typeof person>,
  callerRole: string,
  last: { sequence: number; at: string; fromCaller: boolean; body: string },
  unreadCount: number,
) {
  return {
    id,
    clientProfileId: `profile-${id}`,
    counterpart,
    callerRole,
    canModerate: callerRole !== 'Client',
    startedAtUtc: '2026-07-29T09:00:00Z',
    lastActivityAtUtc: last.at,
    lastSequence: last.sequence,
    unreadCount,
    lastReadSequence: last.sequence - unreadCount,
    lastReadAtUtc: last.at,
    isAvailable: true,
    accessReason: 'Granted',
    lastMessage: {
      messageId: `${id}-last`,
      sequence: last.sequence,
      senderUserId: last.fromCaller ? 'me' : counterpart.userId,
      isFromCaller: last.fromCaller,
      sentAtUtc: last.at,
      body: last.body,
      isDeleted: false,
      deletionKind: null,
    },
    isReadOnly: false,
    // The other person spoke last (MSG-022).
    isAwaitingReply: !last.fromCaller,
  };
}

/** Signs in as Maya (the client) or Lea (her coach) and answers the messaging API for the thread. */
async function openMessages(
  page: Page,
  as: 'maya' | 'lea',
  width: number,
  height: number,
): Promise<{ sent: string[] }> {
  const callerIsLea = as === 'lea';
  // Maya has not read Lea's newest message yet; Lea has read everything.
  const lastRead = callerIsLea ? MAYA_THREAD.length : MAYA_THREAD.length - 1;
  const items = MAYA_THREAD.map((line, index) =>
    messageView(index + 1, line, callerIsLea, lastRead),
  );
  const sent: string[] = [];
  const role = callerIsLea ? 'Coach' : 'Client';
  const readState = (read: number) => ({
    conversationId: THREAD,
    userId: callerIsLea ? LEA_ID : MAYA_ID,
    role,
    lastReadSequence: read,
    lastReadAtUtc: NOW.toISOString(),
    unreadCount: items.length - read,
    latestSequence: items.length,
  });
  const last = MAYA_THREAD.at(-1)!;
  const mayaSummary = summary(
    THREAD,
    callerIsLea ? person(MAYA_ID, 'Maya Fakhoury', 'Client') : LEA,
    role,
    { sequence: items.length, at: last[0], fromCaller: callerIsLea, body: last[2] },
    callerIsLea ? 0 : 1,
  );
  const inbox = callerIsLea
    ? [
        summary(
          'nour',
          person('nour-user', 'Nour Hamdan', 'Client'),
          'Coach',
          {
            sequence: 14,
            at: '2026-09-30T15:50:00Z',
            fromCaller: false,
            body: 'Is my week up yet? Going to the gym at 6',
          },
          1,
        ),
        mayaSummary,
        summary(
          'rita',
          person('rita-user', 'Rita Daher', 'Client'),
          'Coach',
          {
            sequence: 22,
            at: '2026-09-25T18:30:00Z',
            fromCaller: false,
            body: "Yes for sure, I'll pay on Friday",
          },
          0,
        ),
        summary(
          'tarek',
          person('tarek-user', 'Tarek Ghanem', 'Client'),
          'Coach',
          {
            sequence: 17,
            at: '2026-09-23T19:00:00Z',
            fromCaller: true,
            body: 'Excellent. Your next block is ready and starts right after this one.',
          },
          0,
        ),
        summary(
          'yasmine',
          person('yasmine-user', 'Yasmine Chahine', 'Client'),
          'Coach',
          {
            sequence: 19,
            at: '2026-09-22T20:30:00Z',
            fromCaller: true,
            body: 'Your belt agrees 😄 Proud of the consistency.',
          },
          0,
        ),
      ]
    : [mayaSummary];

  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height });
  await mockSession(page, {
    memberships: [
      callerIsLea
        ? { ...COACH_MEMBERSHIP, tenantId: TENANT, tenantName: 'Atlas Performance' }
        : {
            tenantId: TENANT,
            tenantName: 'Atlas Performance',
            tenantSlug: 'atlas-performance',
            role: 'Client',
          },
    ],
    user: {
      ...SIGNED_IN_USER,
      id: callerIsLea ? LEA_ID : MAYA_ID,
      displayName: callerIsLea ? 'Lea Haddad' : 'Maya Fakhoury',
    },
    unreadMessages: callerIsLea ? 1 : 1,
    extra: {
      'GET /api/client-access/me': (route: Route) =>
        json(
          route,
          200,
          ['Training', 'Nutrition', 'CheckIns', 'Messaging', 'ResourceLibrary'].map((feature) => ({
            feature,
            isAllowed: true,
            reason: 'Granted',
          })),
        ),
      // The server filters and searches every conversation (MSG-022); this answers the same way.
      'GET /api/messaging/conversations': (route: Route) => {
        const url = new URL(route.request().url());
        const filter = url.searchParams.get('filter');
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const unread = (item: (typeof inbox)[number]) => item.unreadCount > 0;
        const waiting = (item: (typeof inbox)[number]) => item.isAwaitingReply;
        return json(route, 200, {
          items: inbox.filter(
            (item) =>
              (filter === 'Unread'
                ? unread(item)
                : filter === 'AwaitingReply'
                  ? waiting(item)
                  : true) && item.counterpart.displayName.toLowerCase().includes(search),
          ),
          hasMore: false,
          nextBeforeActivityAtUtc: null,
          nextBeforeConversationId: null,
          counts: {
            all: inbox.length,
            unread: inbox.filter(unread).length,
            awaitingReply: inbox.filter(waiting).length,
          },
        });
      },
      // The client beside the coach's thread, from the read their page uses.
      [`GET /api/clients/profile-${THREAD}/overview`]: (route: Route) =>
        json(
          route,
          200,
          profileOverview({
            today: '2026-09-30',
            client: { ...MAYA, clientProfileId: `profile-${THREAD}` },
            lastActivityAtUtc: '2026-09-30T10:00:00Z',
            lastWorkout: {
              kind: 'WorkoutCompleted',
              client: { ...MAYA, clientProfileId: `profile-${THREAD}` },
              occurredAtUtc: '2026-09-30T10:00:00Z',
              subjectId: 'workout-1',
              title: 'Lower A',
              durationSeconds: 3120,
              personalRecords: [
                { exerciseName: 'Back squat', repetitions: 5, load: 85, unit: 'Kilogram' },
              ],
            },
          }),
        ),
      [`GET /api/messaging/conversations/${THREAD}/messages`]: (route: Route) =>
        json(route, 200, {
          conversationId: THREAD,
          items: [...items],
          hasOlder: false,
          oldestSequence: 1,
          latestSequence: items.length,
          latestEventSequence: items.length,
          readState: readState(callerIsLea ? items.length : items.length - 1),
        }),
      [`GET /api/messaging/conversations/${THREAD}/realtime-events`]: (route: Route) =>
        json(route, 200, {
          conversationId: THREAD,
          items: [],
          hasMore: false,
          nextAfterEventSequence: null,
          latestEventSequence: items.length,
        }),
      [`POST /api/messaging/conversations/${THREAD}/read`]: (route: Route) =>
        json(route, 200, readState(items.length)),
      [`POST /api/messaging/conversations/${THREAD}/messages`]: (route: Route) => {
        const body = route.request().postDataJSON().body as string;
        sent.push(body);
        const view = messageView(
          items.length + 1,
          [NOW.toISOString(), callerIsLea, body],
          callerIsLea,
          99,
        );
        items.push(view);
        return json(route, 201, view);
      },
    },
  });
  await page.goto('/messages');
  await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeAttached();
  await waitForFonts(page);
  return { sent };
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

/** axe, no sideways scroll, and a screenshot for the owner's review. */
async function check(page: Page, name: string, width: number) {
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({
    path: `test-results/r25a-messages-${name}-${width}.png`,
    fullPage: width < 900,
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`a client at ${width}px lands in the chat with their coach and replies`, async ({
    page,
  }) => {
    const { sent } = await openMessages(page, 'maya', width, height);

    // One coach, one conversation: no inbox to choose from, the thread is the page.
    await expect(page.getByRole('heading', { name: 'Lea Haddad', level: 2 })).toBeVisible();
    await expect(page.getByText('Your coach', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeFocused();

    // Days read as a chat, and the coach's unread note sits under a "New messages" line.
    await expect(page.getByRole('heading', { name: 'Today', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Yesterday', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Wed 9 Sep', level: 3 })).toBeVisible();
    await expect(page.locator('.new-divider')).toHaveText('New messages');
    await expect(page.getByText('Refresh')).toHaveCount(0);
    await check(page, 'client', width);

    await page
      .getByRole('textbox', { name: 'Write a message' })
      .fill('Squats felt easy, adding the 2.5 kg 💪');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.feed li').last()).toContainText(
      'Squats felt easy, adding the 2.5 kg',
    );
    await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveValue('');
    expect(sent).toEqual(['Squats felt easy, adding the 2.5 kg 💪']);

    // The newest message and the composer are on screen, above the tab bar.
    await expect(page.locator('.feed li').last()).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
    await check(page, 'client-sent', width);
  });
}

test('a coach at 1440px keeps the inbox beside the thread and sends with Enter', async ({
  page,
}) => {
  const { sent } = await openMessages(page, 'lea', 1440, 900);
  const inbox = page.getByRole('navigation', { name: 'Conversations' });
  await expect(inbox.getByRole('button')).toHaveCount(5);
  await expect(inbox.getByRole('button', { name: 'Nour Hamdan, 1 unread messages' })).toBeVisible();
  await expect(page.getByText('Choose a conversation')).toBeVisible();
  await check(page, 'coach-inbox', 1440);

  await inbox.getByRole('button', { name: 'Maya Fakhoury, no unread messages' }).click();
  await expect(
    page.getByRole('heading', { name: 'Maya Fakhoury', level: 2, exact: true }),
  ).toBeVisible();
  // On a wide screen the inbox stays, and so does the reader's place in it.
  await expect(inbox).toBeVisible();
  await expect(page.getByRole('button', { name: 'All conversations' })).toBeHidden();

  // Actions wait behind each message's options; the coach can remove the client's words.
  await page.getByRole('button', { name: 'Options for message 7' }).click();
  await expect(page.getByRole('button', { name: 'Remove message 7 as coach' })).toBeVisible();
  await check(page, 'coach-thread', 1440);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove message 7 as coach' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Options for message 7' })).toBeFocused();

  const composer = page.getByRole('textbox', { name: 'Write a message' });
  await composer.fill('Great question. Walking lunges it is.');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect(sent).toEqual(['Great question. Walking lunges it is.']);
});

test('a coach on a phone moves from the inbox to a thread and back', async ({ page }) => {
  await openMessages(page, 'lea', 390, 844);
  const inbox = page.getByRole('navigation', { name: 'Conversations' });
  await expect(page.getByText('Choose a conversation')).toBeHidden();

  await inbox.getByRole('button', { name: 'Maya Fakhoury, no unread messages' }).click();
  await expect(
    page.getByRole('heading', { name: 'Maya Fakhoury', level: 2, exact: true }),
  ).toBeFocused();
  await expect(inbox).toBeHidden();
  await check(page, 'coach-thread', 390);

  await page.getByRole('button', { name: 'All conversations' }).click();
  await expect(inbox).toBeVisible();
  await expect(
    inbox.getByRole('button', { name: 'Maya Fakhoury, no unread messages' }),
  ).toBeFocused();
  await check(page, 'coach-inbox', 390);
});

test('the chat reflows at 200% text on a phone', async ({ page }) => {
  await openMessages(page, 'maya', 390, 844);
  await expect(page.getByRole('heading', { name: 'Lea Haddad', level: 2 })).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  await expectNoHorizontalOverflow(page);
  await page.getByRole('textbox', { name: 'Write a message' }).fill('Still readable?');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
});

test('the chat mirrors in right-to-left', async ({ page }) => {
  await openMessages(page, 'maya', 390, 844);
  await expect(page.getByRole('heading', { name: 'Lea Haddad', level: 2 })).toBeVisible();
  await useRtl(page);
  await expectNoHorizontalOverflow(page);
  // The reader's own bubbles sit at the inline end, which is the left in a right-to-left thread.
  const mine = await page.locator('.feed li.mine app-chat-bubble').first().boundingBox();
  const theirs = await page.locator('.feed li.theirs app-chat-bubble').first().boundingBox();
  expect(mine!.x).toBeLessThan(theirs!.x);
});

// R3.5b: the coach's inbox finds who is waiting, and the client sits beside the thread (C6).
test('a coach at 1440px finds who is waiting and sees the client beside the thread', async ({
  page,
}) => {
  await openMessages(page, 'lea', 1440, 900);
  const inbox = page.getByRole('navigation', { name: 'Conversations' });
  const chips = inbox.getByRole('group', { name: 'Show' });
  await expect(chips.getByRole('radio')).toHaveCount(3);
  await expect(inbox.locator('.chip')).toHaveText(['All 5', 'Unread 1', 'Waiting for reply 2']);
  await expect(
    inbox.getByRole('button', { name: 'Rita Daher, waiting for your reply' }),
  ).toBeVisible();

  // The radio is the chip's own input; a reader clicks the chip around it.
  await inbox.locator('.chip', { hasText: 'Waiting for reply' }).click();
  await expect(chips.getByRole('radio', { name: /Waiting for reply/ })).toBeChecked();
  await expect(inbox.locator('.conversation')).toHaveCount(2);
  await expect(page).toHaveURL(/show=waiting/);
  await inbox.getByRole('searchbox', { name: 'Search conversations' }).fill('rit');
  await expect(inbox.locator('.conversation')).toHaveCount(1);
  await inbox.getByRole('searchbox', { name: 'Search conversations' }).fill('zz');
  await expect(inbox.getByText('No conversation matches “zz”')).toBeVisible();
  await inbox.getByRole('button', { name: 'Clear search' }).first().click();
  await inbox.locator('.chip').first().click();
  await expect(inbox.locator('.conversation')).toHaveCount(5);

  await inbox.getByRole('button', { name: 'Maya Fakhoury, no unread messages' }).click();
  const panel = page.getByRole('complementary', { name: 'About Maya Fakhoury' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Online coaching');
  await expect(panel).toContainText('Lower A');
  await expect(panel).toContainText('Back squat 85 kg × 5');
  await expect(panel.getByRole('link', { name: 'Open profile' })).toHaveAttribute(
    'href',
    `/clients/profile-${THREAD}`,
  );
  // The column has the room, so the thread offers no second way to the same details.
  await expect(page.getByRole('button', { name: 'Client details' })).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r35b-messages-coach-panel-1440.png' });
});

test('a coach on a phone opens the client as a sheet from the thread', async ({ page }) => {
  await openMessages(page, 'lea', 390, 844);
  const inbox = page.getByRole('navigation', { name: 'Conversations' });
  await expect(inbox.getByRole('searchbox', { name: 'Search conversations' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r35b-messages-coach-inbox-390.png', fullPage: true });

  await inbox.getByRole('button', { name: 'Maya Fakhoury, no unread messages' }).click();
  await expect(page.getByRole('complementary', { name: 'About Maya Fakhoury' })).toBeHidden();
  await page.getByRole('button', { name: 'Client details' }).click();
  const sheet = page.getByRole('dialog', { name: 'About Maya Fakhoury' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Online coaching');
  await expect(sheet).toContainText('Lower A');
  await axe(page);
  await page.screenshot({ path: 'test-results/r35b-messages-coach-sheet-390.png' });
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Client details' })).toBeFocused();
});

// R3.5c: a coach's own saved replies, dropped into the composer and never sent by themselves.
test('a coach on a phone drops a saved reply into the message and keeps a new one', async ({
  page,
}) => {
  const created: { title: string; body: string }[] = [];
  const replies = [
    {
      id: 'reply-1',
      title: 'Check-in reminder',
      body: 'Your check-in is due today. It takes five minutes.',
      updatedAtUtc: '2026-09-30T08:00:00Z',
      version: 1,
    },
    {
      id: 'reply-2',
      title: 'Deload week',
      body: 'Lighter this week: same sessions, two sets fewer each.',
      updatedAtUtc: '2026-09-30T08:00:00Z',
      version: 1,
    },
  ];
  const { sent } = await openMessages(page, 'lea', 390, 844);
  // Answered after the session mocks, so it takes precedence over their catch-all.
  await page.route('**/api/messaging/saved-replies', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { title: string; body: string };
      created.push(body);
      const reply = {
        id: `reply-${replies.length + 1}`,
        updatedAtUtc: NOW.toISOString(),
        version: 1,
        ...body,
      };
      replies.push(reply);
      return json(route, 200, reply);
    }
    return json(route, 200, { items: replies, maximum: 100 });
  });
  await page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('button', { name: 'Maya Fakhoury, no unread messages' })
    .click();

  const composer = page.getByRole('textbox', { name: 'Write a message' });
  await composer.fill('Hi Maya!');
  await page.getByRole('button', { name: 'Saved replies' }).click();
  const sheet = page.getByRole('dialog', { name: 'Saved replies' });
  await expect(sheet.getByRole('button', { name: 'Check-in reminder', exact: true })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/r35c-saved-replies-390.png' });

  await sheet.getByRole('searchbox', { name: 'Search saved replies' }).fill('lighter');
  await expect(sheet.getByRole('button', { name: 'Check-in reminder', exact: true })).toHaveCount(
    0,
  );
  await sheet.getByRole('button', { name: 'Deload week', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(composer).toHaveValue(
    'Hi Maya!\nLighter this week: same sessions, two sets fewer each.',
  );
  await expect(composer).toBeFocused();
  expect(sent).toEqual([]);

  // Keep what was written as a new reply.
  await page.getByRole('button', { name: 'Saved replies' }).click();
  await sheet.getByRole('button', { name: 'Save what you wrote' }).click();
  await sheet.getByRole('textbox', { name: 'Title' }).fill('Deload hello');
  await expect(sheet.getByRole('textbox', { name: 'Text' })).toHaveValue(
    'Hi Maya!\nLighter this week: same sessions, two sets fewer each.',
  );
  await axe(page);
  await sheet.getByRole('button', { name: 'Save reply' }).click();
  await expect(sheet.getByRole('button', { name: 'Deload hello', exact: true })).toBeVisible();
  expect(created).toEqual([
    {
      title: 'Deload hello',
      body: 'Hi Maya!\nLighter this week: same sessions, two sets fewer each.',
    },
  ]);
  expect(sent).toEqual([]);
});
