import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import {
  comparisonOf,
  CURRENT_ID,
  earlierDetail,
  reviewDashboard,
  reviewDetail,
  reviewList,
  REVIEW_CLIENT_ID,
} from '../src/testing/checkin-review-fixtures';
import { COACH_NOW, LEA_ID } from '../src/testing/coach-today-fixtures';
import {
  expect,
  expectNoHorizontalOverflow,
  json,
  mockSession,
  OWNER_MEMBERSHIP,
  SIGNED_IN_USER,
  test,
  useRtl,
  waitForFonts,
} from './support';

/**
 * The check-in review (C5, R4.3) in a real browser: Lea, Maya's coach at Atlas Performance, on Thu
 * 1 Oct 2026 at 15:00 in Beirut, reading the weekly check-in Maya sent this morning beside last
 * week's. Every read the page makes is answered, so the console guard stays meaningful. The
 * progress photos are flat placeholder pictures, never people.
 */
const ID = REVIEW_CLIENT_ID;
const lea = { ...SIGNED_IN_USER, id: LEA_ID, displayName: 'Lea Khoury' };
const COACH = { ...OWNER_MEMBERSHIP, role: 'Coach' };
const REVIEW_PATH = `/clients/${ID}/checkins/${CURRENT_ID}`;
const FEATURES = ['Training', 'Nutrition', 'CheckIns', 'Messaging'];

const clientDetails = {
  id: ID,
  userId: '00000000-0000-4000-8000-0000000000b1',
  firstName: 'Maya',
  lastName: 'Fakhoury',
  email: 'maya.fakhoury@mail.example',
  phoneNumber: null,
  goals: 'Lose 6 kg and feel strong for my wedding in December.',
  coachNotes: null,
  onboardingStatus: 'Completed',
  onboardingCompletedAtUtc: '2026-07-14T09:00:00Z',
  isCoachBlocked: false,
  version: 3,
  assignedCoachUserId: LEA_ID,
  assignedCoachName: 'Lea Khoury',
  release: null,
};

function commercial(closed: Record<string, string> = {}) {
  return {
    clientProfileId: ID,
    isRelationshipBlocked: false,
    featureAccess: FEATURES.map((feature) => ({
      feature,
      isAllowed: !closed[feature],
      reason: closed[feature] ?? 'Granted',
      enrollmentId: 'e-1',
      accessibleFrom: '2026-07-21',
      accessibleUntilExclusive: '2026-12-14',
    })),
    enrollments: [
      {
        id: 'e-1',
        productId: 'p-1',
        offerId: 'o-1',
        renewedFromEnrollmentId: null,
        productName: 'Online Coaching',
        offerLabel: '12 weeks',
        priceAmount: 330,
        priceCurrency: 'USD',
        paidAmount: 330,
        balanceAmount: 0,
        startDate: '2026-07-21',
        endDateExclusive: '2026-12-14',
        lastActiveDate: '2026-12-13',
        storedStatus: 'Active',
        effectiveStatus: 'Active',
        statusReason: null,
        features: FEATURES,
        payments: [],
        createdAtUtc: '2026-07-20T09:00:00Z',
        version: 1,
      },
    ],
  };
}

const workspace = {
  id: OWNER_MEMBERSHIP.tenantId,
  name: 'Atlas Performance',
  slug: 'atlas-performance',
  timeZoneId: 'Asia/Beirut',
  defaultCulture: 'en-LB',
  defaultCurrencyCode: 'USD',
  weekStartsOn: 'Monday',
  currentDate: '2026-10-01',
  version: 1,
};

const conversation = {
  conversation: {
    id: 'conversation-1',
    clientProfileId: ID,
    counterpart: { userId: clientDetails.userId, displayName: 'Maya Fakhoury', role: 'Client' },
    callerRole: 'Coach',
    canModerate: true,
    startedAtUtc: '2026-07-29T09:00:00Z',
    lastActivityAtUtc: '2026-09-30T17:35:00Z',
    lastSequence: 4,
    unreadCount: 0,
    lastReadSequence: 4,
    lastReadAtUtc: '2026-09-30T17:35:00Z',
    isAvailable: true,
    accessReason: 'Granted',
    lastMessage: null,
    isReadOnly: false,
    isAwaitingReply: false,
  },
  readState: {
    conversationId: 'conversation-1',
    userId: LEA_ID,
    role: 'Coach',
    lastReadSequence: 4,
    lastReadAtUtc: '2026-09-30T17:35:00Z',
    unreadCount: 0,
    latestSequence: 4,
  },
};

/** A flat, dated placeholder for a progress photo: a coloured card, never a person. */
function placeholder(colour: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="#10302a"/>
    </linearGradient></defs>
    <rect width="400" height="500" fill="url(#g)"/>
    <text x="200" y="260" font-family="sans-serif" font-size="28" fill="#fbfaf5"
      text-anchor="middle">${label}</text></svg>`;
}

const photoColours: Record<string, string> = {
  'front-2-sep': '#4f6057',
  'front-23-sep': '#3d6b5a',
  'front-1-oct': '#5f8f63',
  'side-1-oct': '#6b7f45',
};

type Handlers = Record<string, (route: Route) => unknown>;

interface Opened {
  requests: string[];
}

async function openReview(
  page: Page,
  width: number,
  height: number,
  options: { path?: string; closed?: Record<string, string>; extra?: Handlers } = {},
): Promise<Opened> {
  await page.clock.setFixedTime(new Date(COACH_NOW));
  await page.setViewportSize({ width, height });
  const current = reviewDetail();
  const earlier = earlierDetail();
  const reviewed = reviewDetail({
    status: 'Reviewed',
    reviewedAtUtc: COACH_NOW,
    reviewedByUserId: LEA_ID,
    version: 5,
  });
  const requests: string[] = [];
  const photoHandlers: Handlers = Object.fromEntries(
    Object.entries(photoColours).map(([id, colour]) => [
      `GET /api/media/asset-${id}/content/thumbnail`,
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: placeholder(colour, id.replace('front-', 'Front · ').replace('side-', 'Side · ')),
        }),
    ]),
  );
  const reads: Handlers = {
    [`GET /api/clients/${ID}`]: (route) => json(route, 200, clientDetails),
    [`GET /api/commercial/clients/${ID}`]: (route) => json(route, 200, commercial(options.closed)),
    'GET /api/workspace': (route) => json(route, 200, workspace),
    [`GET /api/checkins/clients/${ID}/assignments`]: (route) =>
      json(route, 200, reviewList(current)),
    [`GET /api/checkins/clients/${ID}/assignments/${CURRENT_ID}/response`]: (route) =>
      json(route, 200, requests.includes('review') ? reviewed : current),
    [`GET /api/checkins/clients/${ID}/checkin-comparison`]: (route) =>
      json(route, 200, comparisonOf(current, earlier)),
    [`GET /api/progress/clients/${ID}/dashboard`]: (route) => json(route, 200, reviewDashboard()),
    'POST /api/media/access': (route) => {
      const assetIds = (route.request().postDataJSON() as { assetIds: string[] }).assetIds;
      return json(route, 200, { items: assetIds.map((assetId) => ({ assetId })) });
    },
    [`POST /api/checkins/clients/${ID}/assignments/${CURRENT_ID}/response/review`]: (route) => {
      requests.push('review');
      return json(route, 200, reviewed);
    },
    'POST /api/messaging/conversations': (route) => {
      requests.push('conversation');
      return json(route, 200, conversation);
    },
    'POST /api/messaging/conversations/conversation-1/messages': (route) => {
      const { body } = route.request().postDataJSON() as { body: string };
      requests.push(`message:${body}`);
      return json(route, 200, {
        id: '00000000-0000-4000-8000-000000000099',
        conversationId: 'conversation-1',
        sequence: 5,
        senderUserId: LEA_ID,
        isFromCaller: true,
        sentAtUtc: COACH_NOW,
        availableAtUtc: COACH_NOW,
        editedAtUtc: null,
        revisionNumber: 1,
        body,
        isDeleted: false,
        deletionKind: null,
        deletedAtUtc: null,
        canEdit: true,
        canDelete: true,
        canModerate: false,
        isUnreadByCaller: false,
        version: 1,
        deliveryState: 'Persisted',
      });
    },
    'GET /api/messaging/saved-replies': (route) =>
      json(route, 200, {
        maximum: 100,
        items: [
          {
            id: 'reply-1',
            title: 'Great week',
            body: 'Great week! Keep the same plan for next week.',
            createdAtUtc: '2026-09-01T09:00:00Z',
            updatedAtUtc: '2026-09-01T09:00:00Z',
            version: 1,
          },
        ],
      }),
    ...photoHandlers,
    ...options.extra,
  };
  await mockSession(page, { memberships: [COACH], user: lea, extra: reads });
  await page.goto(options.path ?? REVIEW_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Maya Fakhoury' })).toBeVisible();
  await waitForFonts(page);
  return { requests };
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

async function photosShown(page: Page) {
  const images = page.locator('app-photo-compare img');
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((all) => all.every((image) => (image as HTMLImageElement).naturalWidth)),
    )
    .toBe(true);
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  test(`a check-in under review at ${width}px reads beside the last one and passes axe`, async ({
    page,
  }) => {
    await openReview(page, width, height);

    await expect(page).toHaveTitle('Check-in review | TB Gym');
    await expect(page.getByRole('heading', { level: 2, name: 'Weekly check-in' })).toBeVisible();
    await expect(page.locator('.facts-line')).toHaveText(
      'Sent Thu 1 Oct · Due Wed 30 Sep · 1 day late',
    );
    await expect(page.locator('.answers-line')).toHaveText(
      '5 answers are different from Wed 23 Sep.',
    );
    await expect(page.locator('.row')).toHaveCount(6);
    await expect(page.locator('.row.changed')).toHaveCount(5);
    await expect(page.locator('.weight .figure')).toHaveText('71.4 kg');
    await photosShown(page);
    // The section stays marked while one of its check-ins is open.
    await expect(
      page
        .getByRole('navigation', { name: 'Client sections' })
        .getByRole('link', { name: 'Check-ins', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    // One filled button: the header's Message steps back while the reply box is on the page.
    await expect(page.getByRole('button', { name: 'Message Maya' })).toHaveClass(
      /tb-button--outlined/,
    );
    await expect(page.locator('main .tb-button--filled')).toHaveCount(1);

    await expectNoHorizontalOverflow(page);
    await axe(page);
    await page.screenshot({ path: `test-results/r43-review-${width}.png`, fullPage: true });
  });
}

test('a reply goes into the chat, then the check-in is marked reviewed', async ({ page }) => {
  const { requests } = await openReview(page, 1440, 900);

  await page.getByRole('button', { name: 'Saved replies' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Great week', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your reply to Maya' })).toHaveValue(
    'Great week! Keep the same plan for next week.',
  );
  await page.getByRole('textbox', { name: 'Your reply to Maya' }).fill('Great week, Maya!');
  await page.getByRole('button', { name: 'Send and mark reviewed' }).click();

  await expect(page.locator('.review-head app-status-pill')).toHaveText('Reviewed');
  expect(requests).toEqual(['conversation', 'message:Great week, Maya!', 'review']);
  await expect(page.locator('.reviewed-line')).toHaveText('Reviewed Thu 1 Oct by you');
  await expect(page.getByRole('link', { name: 'Open chat' })).toHaveAttribute(
    'href',
    '/messages?conversation=conversation-1',
  );
  await expect(page.getByRole('button', { name: 'Send reply' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'test-results/r43-reviewed-1440.png', fullPage: true });
});

test('an unsent reply is asked about before leaving', async ({ page }) => {
  await openReview(page, 1440, 900, {
    extra: {
      [`GET /api/checkins/clients/${ID}/assignments`]: (route) => json(route, 200, reviewList()),
    },
  });

  await page.getByRole('textbox', { name: 'Your reply to Maya' }).fill('Great week.');
  await page.getByRole('link', { name: 'All check-ins' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without sending?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(new RegExp(`${REVIEW_PATH}$`));
  await expect(page.getByRole('textbox', { name: 'Your reply to Maya' })).toHaveValue(
    'Great week.',
  );
});

test('the check-in list leads with the one to review and opens it', async ({ page }) => {
  await openReview(page, 390, 844, { path: `/clients/${ID}/checkins` });

  await expect(page.getByRole('heading', { level: 3, name: 'To review 1' })).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r43-list-390.png', fullPage: true });

  // The title's link covers the row, so a tap anywhere on it opens the review.
  const row = page.locator('.row.openable').first();
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`${REVIEW_PATH}$`));
  await expect(page.getByRole('heading', { level: 2, name: 'Weekly check-in' })).toBeVisible();
});

test('the review follows dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openReview(page, 1440, 900);

  await expect(page.locator('main')).not.toHaveAttribute('data-mode', 'light');
  await photosShown(page);
  await axe(page);
  await page.screenshot({ path: 'test-results/r43-review-dark-1440.png', fullPage: true });
});

test('the review reads right to left', async ({ page }) => {
  await openReview(page, 1440, 900);
  await useRtl(page);

  await expectNoHorizontalOverflow(page);
  await axe(page);
});

for (const width of [390, 1440]) {
  test(`the review reflows at 200% text at ${width}px`, async ({ page }) => {
    await openReview(page, width, 900);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: 'Mark reviewed' })).toBeVisible();
  });
}

test('closed check-ins say why and read nothing', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/checkins/')) asked.push(request.url());
  });
  await openReview(page, 390, 844, { closed: { CheckIns: 'NoEntitlement' } });

  await expect(page.getByRole('heading', { level: 2, name: 'Check-ins are closed' })).toBeVisible();
  await expect(page.getByText('Check-ins aren’t part of Maya’s plan.')).toBeVisible();
  expect(asked).toEqual([]);
  await axe(page);
});
